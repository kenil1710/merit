/**
 * The agent's vocabulary (ported from Misthos). Merit judges X posts today; GitHub and articles follow (D3), so the
 * resource carries only what an X post has.
 */

export const FLAG_CODES = [
  "OWNERSHIP_MISMATCH",
  "OUT_OF_WINDOW",
  "DATE_UNVERIFIED",
  "DUPLICATE_URL",
  "NEAR_DUPLICATE",
  "NEW_ACCOUNT",
  "ENGAGEMENT_ANOMALY",
  "DELETED",
  "WALLET_CHANGED_RECENTLY",
  "PROMPT_INJECTION_ATTEMPT",
  "MISSING_REQUIRED",
  "TOO_SHORT",
  "LOW_FOLLOWERS",
  "OFF_TOPIC",
  "CONTRADICTS_BRIEF",
] as const;
export type FlagCode = (typeof FLAG_CODES)[number];

export type Evidence = Record<string, string | number | boolean | null>;

/** A deterministic finding. Hard flags can never lead to payment; soft flags block automatic approval. */
export interface Flag {
  code: FlagCode;
  severity: "hard" | "soft";
  message: string;
  evidence: Evidence;
}

/** An X post (or the author's self-reply thread) as every check and the judge see it; also what is cached. */
export interface Resource {
  sourceType: "x_post";
  resourceId: string;
  url: string;
  timestamp: string | null;
  /** The post, or the thread as "[Post i of n]" blocks. */
  text: string;
  author: { id: string | null; handle: string | null; name: string | null; createdAt: string | null; followers: number | null };
  x: {
    isRepost: boolean;
    isReply: boolean;
    isQuote: boolean;
    likes: number;
    reposts: number;
    replies: number;
    quotes: number;
    impressions: number | null;
    lang: string | null;
    urls: string[];
    thread: { postIds: string[]; truncated: boolean; note: string | null };
  };
}

export type FetchOutcome = { status: "ok"; resource: Resource } | { status: "not_found"; detail: string };

/** Upstream failure. `retryable` errors are retried; the rest become an escalation. */
export class FetchError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}
