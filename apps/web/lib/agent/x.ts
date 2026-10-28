import { z } from "zod";
import { FetchError, type FetchOutcome } from "./types";

/**
 * X posts through the merit-x latch (GET only; post and user lookup). The post comes with its author's account age
 * and followers. Threads: when the post has replies, one recent search for the author's own posts in the conversation
 * rebuilds the self-reply chain (Misthos' fetcher). If that search is refused (the latch allows one path segment
 * after /2/tweets/, and caps responses at 12 KB) or fails, the single post is judged with a note for the reviewer.
 */

export const MAX_THREAD_POSTS = 10;
const RECENT_SEARCH_WINDOW_MS = 7 * 86_400_000 - 3_600_000;

export type XGet = (path: string) => Promise<unknown>;
/** What an upstream refusal looks like (LatchDenied in production; tests pass their own). */
export type Denied = { status: number; deniedBy?: string };
const denied = (e: unknown): Denied | null => (e && typeof e === "object" && "status" in e ? (e as Denied) : null);

const Metrics = z.object({ retweet_count: z.number(), reply_count: z.number(), like_count: z.number(), quote_count: z.number(), impression_count: z.number() }).partial();
const Post = z.object({
  id: z.string(),
  text: z.string(),
  author_id: z.string(),
  created_at: z.string().optional(),
  conversation_id: z.string().optional(),
  in_reply_to_user_id: z.string().optional(),
  lang: z.string().optional(),
  public_metrics: Metrics.optional(),
  note_tweet: z.object({ text: z.string() }).optional(),
  referenced_tweets: z.array(z.object({ type: z.string(), id: z.string() })).optional(),
  entities: z.object({ urls: z.array(z.object({ expanded_url: z.string().optional() })).optional() }).partial().optional(),
});
type Post = z.infer<typeof Post>;
const Lookup = z.object({
  data: Post.optional(),
  includes: z
    .object({
      users: z
        .array(z.object({ id: z.string(), username: z.string(), name: z.string().optional(), created_at: z.string().optional(), public_metrics: z.object({ followers_count: z.number() }).partial().optional() }))
        .optional(),
    })
    .optional(),
  errors: z.array(z.object({ title: z.string().optional(), type: z.string().optional() })).optional(),
});
const Search = z.object({ data: z.array(Post).optional(), meta: z.object({ next_token: z.string().optional() }).optional() });

export function lookupPath(id: string): string {
  const q = new URLSearchParams({
    "tweet.fields": "author_id,created_at,public_metrics,text,referenced_tweets,conversation_id,lang,note_tweet,entities",
    expansions: "author_id",
    "user.fields": "created_at,public_metrics,username,name",
  });
  return `/2/tweets/${id}?${q}`;
}

export function threadSearchPath(conversationId: string, authorId: string): string {
  const q = new URLSearchParams({
    query: `conversation_id:${conversationId} from:${authorId} -is:retweet`,
    max_results: String(MAX_THREAD_POSTS),
    "tweet.fields": "author_id,created_at,conversation_id,in_reply_to_user_id,referenced_tweets,note_tweet,text,entities",
  });
  return `/2/tweets/search/recent?${q}`;
}

const postText = (p: Post) => {
  const text = p.note_tweet?.text ?? p.text;
  const quoted = p.referenced_tweets?.find((r) => r.type === "quoted");
  return quoted ? `${text}\n[Quotes another post: https://x.com/i/web/status/${quoted.id}]` : text;
};
const byId = (a: Post, b: Post) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);

export interface SelfThread {
  posts: Post[];
  truncated: boolean;
  note: string | null;
}

/** The author's own reply chain from `root`: other people's posts never link in. */
export function buildSelfThread(root: Post, found: Post[], opts: { max?: number; moreAvailable?: boolean } = {}): SelfThread {
  const max = opts.max ?? MAX_THREAD_POSTS;
  const author = root.author_id;
  const parentOf = (p: Post) => p.referenced_tweets?.find((r) => r.type === "replied_to")?.id;
  const selfReplies = found.filter((p) => p.id !== root.id && p.author_id === author && p.in_reply_to_user_id === author);
  const children = new Map<string, Post[]>();
  for (const p of [...selfReplies].sort(byId)) {
    const parent = parentOf(p);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), p]);
  }
  const posts = [root];
  let truncated = false;
  for (;;) {
    const next = children.get(posts.at(-1)!.id)?.[0];
    if (!next) break;
    if (posts.length >= max) {
      truncated = true;
      break;
    }
    posts.push(next);
  }
  if (opts.moreAvailable) truncated = true;
  const inChain = new Set(posts.map((p) => p.id));
  const known = new Set([root.id, ...found.map((p) => p.id)]);
  const last = posts.at(-1)!;
  const orphan = selfReplies.some((p) => !inChain.has(p.id) && !known.has(parentOf(p) ?? "") && byId(p, last) > 0);
  const note = truncated
    ? `The thread is longer than ${max} posts; only the first ${posts.length} were read.`
    : orphan
      ? "A post in the thread is missing (deleted or unavailable); the thread was read up to the gap."
      : null;
  return { posts, truncated, note };
}

/**
 * merit-x allows post lookups only (its endpoint filter refuses /2/tweets/search), so the thread search would cost a
 * logged 403 for every post with replies. It runs only when MERIT_X_THREAD_SEARCH=1, once the latch allows search.
 */
const THREAD_SEARCH = () => process.env.MERIT_X_THREAD_SEARCH === "1";

export async function fetchXPost(id: string, get: XGet, now: () => Date = () => new Date(), opts: { threadSearch?: boolean } = {}): Promise<FetchOutcome> {
  if (!/^\d{1,20}$/.test(id)) throw new FetchError("Not an X post id.", false);
  let body: z.infer<typeof Lookup>;
  try {
    const parsed = Lookup.safeParse(await get(lookupPath(id)));
    if (!parsed.success) throw new FetchError("Unexpected X API response.", false);
    body = parsed.data;
  } catch (e) {
    if (e instanceof FetchError) throw e;
    const d = denied(e);
    if (d?.status === 404) return { status: "not_found", detail: "The post no longer exists." };
    if (d && (d.status === 429 || d.status >= 500)) throw new FetchError(`X is busy (${d.status}).`, true, d.status);
    throw new FetchError(`X couldn't be read through merit-x${d ? ` (${d.status})` : ""}.`, false, d?.status);
  }
  const { data, includes } = body;
  if (!data) return { status: "not_found", detail: "The post was deleted, is private, or never existed." };
  const author = includes?.users?.find((u) => u.id === data.author_id);
  const refs = data.referenced_tweets ?? [];
  const m = data.public_metrics ?? {};
  const isRepost = refs.some((r) => r.type === "retweeted");

  let thread: SelfThread = { posts: [data], truncated: false, note: null };
  const posted = data.created_at ? Date.parse(data.created_at) : NaN;
  if (!isRepost && (m.reply_count ?? 0) > 0) {
    if (!(opts.threadSearch ?? THREAD_SEARCH())) {
      thread.note = "Replies weren't read (merit-x allows post lookups only), so only this post was judged.";
    } else if (Number.isFinite(posted) && now().getTime() - posted > RECENT_SEARCH_WINDOW_MS) {
      thread.note = "Replies weren't read: X search only covers the last 7 days, so only this post was judged.";
    } else {
      try {
        const res = Search.safeParse(await get(threadSearchPath(data.conversation_id ?? data.id, data.author_id)));
        thread = res.success
          ? buildSelfThread(data, res.data.data ?? [], { moreAvailable: !!res.data.meta?.next_token })
          : { ...thread, note: "The replies couldn't be read from X, so only this post was judged." };
      } catch (e) {
        const d = denied(e);
        if (d && (d.status === 429 || d.status >= 500) && !d.deniedBy) throw new FetchError(`X is busy (${d.status}).`, true, d.status);
        thread.note = "The replies couldn't be read (merit-x allows post lookups only), so only this post was judged.";
      }
    }
  }
  const posts = thread.posts;
  const text = posts.length > 1 ? posts.map((p, i) => `[Post ${i + 1} of ${posts.length}]\n${postText(p)}`).join("\n\n") : (data.note_tweet?.text ?? data.text);
  return {
    status: "ok",
    resource: {
      sourceType: "x_post",
      resourceId: data.id,
      url: `https://x.com/${author?.username ?? "i/web"}/status/${data.id}`,
      timestamp: data.created_at ?? null,
      text,
      author: {
        id: data.author_id,
        handle: author?.username ?? null,
        name: author?.name ?? null,
        createdAt: author?.created_at ?? null,
        followers: author?.public_metrics?.followers_count ?? null,
      },
      x: {
        isRepost,
        isReply: refs.some((r) => r.type === "replied_to"),
        isQuote: refs.some((r) => r.type === "quoted"),
        likes: m.like_count ?? 0,
        reposts: m.retweet_count ?? 0,
        replies: m.reply_count ?? 0,
        quotes: m.quote_count ?? 0,
        impressions: m.impression_count ?? null,
        lang: data.lang ?? null,
        urls: [...new Set(posts.flatMap((p) => (p.entities?.urls ?? []).flatMap((u) => (u.expanded_url ? [u.expanded_url] : []))))].slice(0, 50),
        thread: { postIds: posts.map((p) => p.id), truncated: thread.truncated, note: thread.note },
      },
    },
  };
}
