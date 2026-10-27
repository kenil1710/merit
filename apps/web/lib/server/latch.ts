import "server-only";

// Every call to X and Anthropic goes through Merit's Latch latches. The
// server holds only `lat_` tokens; the provider keys stay inside Latch.
// Every call names its campaign in X-Merit-Campaign (merit-judge and merit-x
// require it) and is written to latch_calls, which is how the Guardrails page
// groups spend and decisions per campaign: Latch's audit log keeps no headers.

import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "@/lib/db";
import { recordLatchCall } from "./latch-log";
import { postIdOf, recordIntent } from "./tweet-check";
import { env } from "./env";

export const LATCH_PROXY = "https://onlatch.com/proxy";
export const CAMPAIGN_HEADER = "X-Merit-Campaign";
/**
 * The same value again as X-User: Latch's Cedar filter sees request headers only through its principal,
 * User::"<x-user header>" (User::"anonymous" without one), so this is what lets merit-judge's Cedar policy refuse a
 * call that doesn't name its campaign.
 */
export const CEDAR_PRINCIPAL_HEADER = "X-User";
/** What merit-judge's and merit-x's header_requirement accepts: a campaign address, or owner-<user id> for "Read it". */
export const CAMPAIGN_HEADER_PATTERN = "^([1-9A-HJ-NP-Za-km-z]{32,44}|owner-[0-9a-f-]{36})$";

export type LatchName = "merit-judge" | "merit-x";

export class LatchDenied extends Error {
  constructor(public status: number, public deniedBy: string | undefined, public reason: string) {
    super(deniedBy ? `Latch denied (${deniedBy}): ${reason}` : `Latch returned ${status}: ${reason}`);
  }
}

/**
 * The token for a campaign's calls. A campaign can have its own extended (child) latch of merit-judge or merit-x,
 * created in the dashboard with attenuate_only and tighter limits, and set on the server as
 * MERIT_JUDGE_LAT__<campaign> / MERIT_X_LAT__<campaign>. Without one, the parent token is used. A configured child
 * is never bypassed: if it denies, is disabled or has expired, the call fails rather than falling back.
 */
export function latchToken(latch: LatchName, campaign: string): { token: string; via: "child" | "parent" } {
  const parent = latch === "merit-judge" ? env.judgeLat : env.xLat;
  const child = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(campaign) ? process.env[`${childVar(latch)}${campaign}`]?.trim() : undefined;
  return child ? { token: child, via: "child" } : { token: parent(), via: "parent" };
}

export const childVar = (latch: LatchName) => (latch === "merit-judge" ? "MERIT_JUDGE_LAT__" : "MERIT_X_LAT__");

/** Campaigns that have their own child latch configured, with which ones. */
export function childLatches(): { campaign: string; latch: LatchName; token: string }[] {
  return (["merit-judge", "merit-x"] as const).flatMap((latch) =>
    Object.entries(process.env)
      .filter(([k, v]) => k.startsWith(childVar(latch)) && v?.trim())
      .map(([k, v]) => ({ campaign: k.slice(childVar(latch).length), latch, token: v!.trim() })),
  );
}

/** The tag Merit sends for a call: the campaign address, or owner-<user id> before a campaign exists. */
export function campaignTag(campaign: string): string {
  if (!new RegExp(CAMPAIGN_HEADER_PATTERN).test(campaign)) throw new Error(`not a campaign tag: ${campaign.slice(0, 50)}`);
  return campaign;
}

/** The headers that name a call's campaign: X-Merit-Campaign (header_requirement) and X-User (Cedar's principal). */
export function campaignHeaders(campaign: string): Record<string, string> {
  const tag = campaignTag(campaign);
  return { [CAMPAIGN_HEADER]: tag, [CEDAR_PRINCIPAL_HEADER]: tag };
}

const upstreamPath = (url: string) => new URL(url).pathname.replace(/^\/proxy/, "") || "/";

async function viaLatch(latch: LatchName, path: string, campaign: string, init: RequestInit = {}) {
  const { token, via } = latchToken(latch, campaign);
  const url = `${LATCH_PROXY}${path}`;
  const log = { latch, via, campaign, method: (init.method ?? "GET").toUpperCase(), path: upstreamPath(url) };
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, ...campaignHeaders(campaign) },
      cache: "no-store",
    });
  } catch (error) {
    await recordLatchCall({ ...log, status: 0 });
    throw error;
  }
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep text
  }
  const b = (typeof body === "object" && body) as { deniedBy?: string; reason?: string; error?: string; title?: string };
  await recordLatchCall({ ...log, status: response.status, deniedBy: b?.deniedBy ?? null, latchRequestId: response.headers.get("x-latch-request-id") });
  if (!response.ok) {
    throw new LatchDenied(response.status, b?.deniedBy, b?.reason ?? b?.error ?? b?.title ?? text.slice(0, 200));
  }
  return body;
}

/**
 * A GET through merit-x (post lookup) for one campaign. Throws LatchDenied with X's or the latch's status.
 * A post read is announced first (latch_intents): merit-x's custom_code filter lets it through only for posts
 * Merit is working on, and asks Merit before it does.
 */
export async function xGet(path: string, campaign: string): Promise<unknown> {
  const postId = postIdOf(path);
  // Without the intent the check still finds a stored submission; with neither, merit-x denies (fail closed).
  if (postId) await getDb().then((db) => recordIntent(db, postId, campaign)).catch((e: Error) => console.warn(`latch_intents: not recorded (${e.message.slice(0, 120)})`));
  return viaLatch("merit-x", path, campaign);
}

export type XPost = { id: string; author_id: string; created_at: string; text: string };

export async function readPost(postId: string, campaign: string): Promise<XPost> {
  if (!/^\d{1,20}$/.test(postId)) throw new Error("invalid post id");
  const body = (await xGet(`/2/tweets/${postId}?tweet.fields=author_id,created_at`, campaign)) as { data?: XPost };
  if (!body.data) throw new Error("X returned no post (deleted, private, or not found)");
  return body.data;
}

/**
 * fetch for the Anthropic client: records each call (status, Latch's deniedBy and request id, the model's token
 * usage) without touching the response the SDK reads.
 */
function loggedFetch(latch: LatchName, campaign: string, via: "child" | "parent"): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const log = { latch, via, campaign, method: (init?.method ?? "GET").toUpperCase(), path: upstreamPath(url) };
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      await recordLatchCall({ ...log, status: 0 });
      throw error;
    }
    let body: { deniedBy?: string; model?: string; usage?: { input_tokens?: number; output_tokens?: number } } = {};
    try {
      body = (await response.clone().json()) as typeof body;
    } catch {
      // not JSON (a stream or an HTML error page): log the status alone
    }
    await recordLatchCall({
      ...log,
      status: response.status,
      deniedBy: body.deniedBy ?? null,
      latchRequestId: response.headers.get("x-latch-request-id"),
      model: body.model ?? null,
      inputTokens: body.usage?.input_tokens ?? null,
      outputTokens: body.usage?.output_tokens ?? null,
    });
    return response;
  };
}

/** Claude through merit-judge, on behalf of one campaign (or owner-<user id> for "Read it"). */
export function judgeClient(campaign: string): Anthropic {
  const { token, via } = latchToken("merit-judge", campaign);
  // Latch authenticates the lat_ token as a bearer token and injects the real
  // x-api-key upstream. apiKey: null keeps a stray ANTHROPIC_API_KEY unused.
  return new Anthropic({
    apiKey: null,
    authToken: token,
    baseURL: LATCH_PROXY,
    defaultHeaders: campaignHeaders(campaign),
    fetch: loggedFetch("merit-judge", campaign, via),
    maxRetries: 1,
    timeout: 60_000,
  });
}

export type LatchSelf = { capabilities: unknown; budget: unknown; audit: unknown; whoami?: unknown };

async function selfRead(token: string, name: string): Promise<unknown> {
  const response = await fetch(`${LATCH_PROXY}/.well-known/latch-self/${name}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new LatchDenied(response.status, undefined, body.error ?? response.statusText);
  return body;
}

/** The latch's own view of itself. Self-discovery bypasses the pipeline, so it needs no campaign header. */
export async function latchSelf(token: string): Promise<LatchSelf> {
  const [capabilities, budget, audit, whoami] = await Promise.all(
    ["capabilities", "budget", "audit", "whoami"].map((name) => selfRead(token, name).catch((error: Error) => ({ error: error.message }))),
  );
  return { capabilities, budget, audit, whoami };
}
