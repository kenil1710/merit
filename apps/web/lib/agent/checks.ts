import { includesToken } from "@/lib/shared/context";
import { detectInjection } from "./injection";
import type { Flag, Resource } from "./types";

/**
 * Every deterministic check on an X post, ported from Misthos (rules-v9) plus Merit's minimum length. Order is stable
 * so records hash identically on replay. Hard flags end in rejection; soft flags send the work to a person.
 */

export const NEAR_DUPLICATE_HARD = 0.8;
export const NEAR_DUPLICATE_SOFT = 0.6;
export const NEAR_DUPLICATE_MIN_CHARS = 120;
/** Below this, a post is too thin to judge (Merit's rule since round 1). */
export const MIN_POST_CHARS = 60;
const DAY_MS = 86_400_000;

export interface PriorMatch {
  submissionId: string;
  contributorId: string;
  xHandle: string;
  url: string;
  submittedAt: Date;
  /** pg_trgm similarity 0–1 */
  similarity: number;
  /** SimHash Hamming distance (0–64) when both fingerprints exist */
  hamming: number | null;
  /** When the matched post was published on X. */
  contentAt?: Date | null;
}

export interface CheckContext {
  resource: Resource | null;
  notFoundDetail?: string;
  contributor: {
    id: string;
    xUserId: string;
    xHandle: string;
    walletChangedAt: Date | null;
    xFollowers?: number | null;
    xCreatedAt?: Date | null;
  };
  round: { startsAt: Date; endsAt: Date };
  program: {
    minAccountAgeDays: number;
    payeeCooldownSeconds: number;
    minXFollowers?: number;
    belowMinimum?: "review" | "reject" | "block";
    mustInclude?: string[];
  };
  /** Other contributors' earlier submissions of the same post that passed the ownership check. */
  sameResource: { submissionId: string; xHandle: string; submittedAt: Date }[];
  /** Most similar earlier submissions in the program (other posts). */
  similar: PriorMatch[];
  submittedAt: Date;
}

const pct = (n: number) => Math.round(n * 100);
const day = (d: Date) => d.toISOString().slice(0, 10);
const minute = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** The post's own words: thread markers and links don't count toward the minimum length. */
export function ownText(text: string): string {
  return text
    .replace(/^\[Post \d+ of \d+\]$/gm, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function runChecks(ctx: CheckContext): Flag[] {
  const flags: Flag[] = [];
  const r = ctx.resource;

  if (!r) {
    flags.push({ code: "DELETED", severity: "hard", message: ctx.notFoundDetail ?? "The post no longer exists.", evidence: { sourceType: "x_post" } });
    return flags;
  }

  // ── Ownership ──────────────────────────────────────────────────────────
  if (r.author.id !== ctx.contributor.xUserId) {
    flags.push({
      code: "OWNERSHIP_MISMATCH",
      severity: "hard",
      message: `Posted by @${r.author.handle ?? "unknown"}, not by the linked account @${ctx.contributor.xHandle}.`,
      evidence: { postAuthorId: r.author.id, postAuthorHandle: r.author.handle, linkedXUserId: ctx.contributor.xUserId },
    });
  } else if (r.x.isRepost) {
    flags.push({ code: "OWNERSHIP_MISMATCH", severity: "hard", message: "This is a repost of someone else's post, not original work.", evidence: { repost: true } });
  }

  // ── Round window ───────────────────────────────────────────────────────
  if (r.timestamp) {
    const t = new Date(r.timestamp);
    if (t < ctx.round.startsAt || t >= ctx.round.endsAt) {
      const before = t < ctx.round.startsAt;
      const gap = Math.abs(t.getTime() - (before ? ctx.round.startsAt : ctx.round.endsAt).getTime());
      const close = day(t) === day(ctx.round.startsAt) || day(t) === day(ctx.round.endsAt);
      const f = close ? minute : day;
      let message: string;
      if (gap < 3_600_000) {
        const n = gap < 60_000 ? Math.max(1, Math.round(gap / 1000)) : Math.round(gap / 60_000);
        const unit = gap < 60_000 ? "second" : "minute";
        message = `Posted ${n} ${unit}${n === 1 ? "" : "s"} ${before ? "before this round started" : "after this round ended"} (${minute(ctx.round.startsAt)} to ${minute(ctx.round.endsAt)}).`;
      } else {
        message = `Posted ${close ? "at" : "on"} ${f(t)}, outside this round (${f(ctx.round.startsAt)} to ${f(ctx.round.endsAt)}).`;
      }
      flags.push({
        code: "OUT_OF_WINDOW",
        severity: "hard",
        message,
        evidence: { timestamp: r.timestamp, roundStart: ctx.round.startsAt.toISOString(), roundEnd: ctx.round.endsAt.toISOString() },
      });
    }
  } else {
    flags.push({ code: "DATE_UNVERIFIED", severity: "soft", message: "X returned no post time, so the round window can't be confirmed.", evidence: {} });
  }

  // ── Duplicates ─────────────────────────────────────────────────────────
  // The verified author is never the duplicate: only one account can own a post.
  const isVerifiedAuthor = !!r.author.id && r.author.id === ctx.contributor.xUserId;
  const firstDup = [...(isVerifiedAuthor ? [] : ctx.sameResource)].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())[0];
  if (firstDup) {
    flags.push({
      code: "DUPLICATE_URL",
      severity: "hard",
      message: `Already submitted by @${firstDup.xHandle} on ${day(firstDup.submittedAt)}.`,
      evidence: { matchedSubmissionId: firstDup.submissionId, matchedHandle: firstDup.xHandle, matchedAt: firstDup.submittedAt.toISOString() },
    });
  }

  if (r.text.length >= NEAR_DUPLICATE_MIN_CHARS) {
    // The post published first on X is the original: a copy merely submitted first never makes it the duplicate.
    const mine = r.timestamp ? Date.parse(r.timestamp) : NaN;
    const best = ctx.similar.filter(
      (m) => (m.similarity >= NEAR_DUPLICATE_SOFT || (m.hamming !== null && m.hamming <= 3)) && !(m.contentAt && Number.isFinite(mine) && m.contentAt.getTime() > mine),
    )[0];
    if (best) {
      const sim = Math.max(best.similarity, best.hamming !== null ? 1 - best.hamming / 64 : 0);
      const otherPerson = best.contributorId !== ctx.contributor.id;
      flags.push({
        code: "NEAR_DUPLICATE",
        severity: otherPerson && sim >= NEAR_DUPLICATE_HARD ? "hard" : "soft",
        message: otherPerson
          ? `${pct(sim)}% identical to a submission by @${best.xHandle} on ${day(best.submittedAt)}.`
          : `${pct(sim)}% identical to your own earlier submission from ${day(best.submittedAt)}.`,
        evidence: {
          matchedSubmissionId: best.submissionId,
          matchedHandle: best.xHandle,
          matchedUrl: best.url,
          matchedAt: best.submittedAt.toISOString(),
          trigramSimilarity: Math.round(best.similarity * 1000) / 1000,
          simhashDistance: best.hamming,
        },
      });
    }
  }

  // ── Length and what every post must include ────────────────────────────
  const own = ownText(r.text);
  if (own.length < MIN_POST_CHARS) {
    flags.push({
      code: "TOO_SHORT",
      severity: "hard",
      message: `Only ${own.length} characters of the author's own words; this program pays posts of at least ${MIN_POST_CHARS}.`,
      evidence: { chars: own.length, minimum: MIN_POST_CHARS },
    });
  }
  const missing = (ctx.program.mustInclude ?? []).filter((t) => !includesToken(r.text, r.x.urls, t));
  if (missing.length) {
    flags.push({
      code: "MISSING_REQUIRED",
      severity: "soft",
      message: `Missing what every post in this program must include: ${missing.join(", ")}.`,
      evidence: { missing: missing.join(", ") },
    });
  }

  // ── Minimum followers and account age ──────────────────────────────────
  // The post author's live numbers, falling back to the ones saved at the contributor's X sign-in.
  const strict = (ctx.program.belowMinimum ?? "review") !== "review";
  const minFollowers = ctx.program.minXFollowers ?? 0;
  const minAge = ctx.program.minAccountAgeDays;
  const followers = r.author.followers ?? ctx.contributor.xFollowers ?? null;
  const createdAt = (r.author.createdAt ? new Date(r.author.createdAt) : null) ?? ctx.contributor.xCreatedAt ?? null;
  if (minFollowers > 0 && followers === null && strict)
    flags.push({
      code: "LOW_FOLLOWERS",
      severity: "soft",
      message: `The X follower count isn't known; this program asks for at least ${minFollowers}, so the team reviews it.`,
      evidence: { followers: null, minimum: minFollowers },
    });
  if (minFollowers > 0 && followers !== null && followers < minFollowers)
    flags.push({
      code: "LOW_FOLLOWERS",
      severity: strict ? "hard" : "soft",
      message: strict
        ? `The account has ${followers} followers; this program pays accounts with at least ${minFollowers}.`
        : `The account has ${followers} followers; this program reviews work from accounts under ${minFollowers}.`,
      evidence: { followers, minimum: minFollowers },
    });
  if (minAge > 0 && createdAt === null && strict)
    flags.push({
      code: "NEW_ACCOUNT",
      severity: "soft",
      message: `The X account's age isn't known; this program asks for at least ${minAge} days, so the team reviews it.`,
      evidence: { accountCreatedAt: null, minAccountAgeDays: minAge },
    });
  if (minAge > 0 && createdAt !== null) {
    const ageDays = Math.floor((ctx.submittedAt.getTime() - createdAt.getTime()) / DAY_MS);
    if (ageDays < minAge)
      flags.push({
        code: "NEW_ACCOUNT",
        severity: strict ? "hard" : "soft",
        message: strict
          ? `The X account is ${ageDays} days old; this program pays accounts at least ${minAge} days old.`
          : `The X account is ${ageDays} days old; this program asks for at least ${minAge}.`,
        evidence: { accountCreatedAt: createdAt.toISOString(), ageDays, minAccountAgeDays: minAge },
      });
  }

  // ── Engagement ─────────────────────────────────────────────────────────
  const f = r.author.followers ?? 0;
  const engagement = r.x.likes + r.x.reposts;
  const inflated = engagement > Math.max(200, f * 5);
  const impossible = r.x.impressions !== null && r.x.impressions > 0 && r.x.likes > r.x.impressions * 0.5 && r.x.likes > 20;
  if (inflated || impossible) {
    flags.push({
      code: "ENGAGEMENT_ANOMALY",
      severity: "soft",
      message: impossible
        ? `${r.x.likes} likes on ${r.x.impressions} impressions is not a natural ratio.`
        : `${engagement} likes and reposts from an account with ${f} followers is unusual.`,
      evidence: { likes: r.x.likes, reposts: r.x.reposts, impressions: r.x.impressions, followers: f },
    });
  }

  // ── Wallet ─────────────────────────────────────────────────────────────
  const wc = ctx.contributor.walletChangedAt;
  if (wc && ctx.submittedAt.getTime() - wc.getTime() < ctx.program.payeeCooldownSeconds * 1000) {
    flags.push({
      code: "WALLET_CHANGED_RECENTLY",
      severity: "soft",
      message: `The payout wallet changed on ${day(wc)}; payouts to it wait out the cooldown.`,
      evidence: { walletChangedAt: wc.toISOString(), cooldownSeconds: ctx.program.payeeCooldownSeconds },
    });
  }

  // ── Prompt injection ───────────────────────────────────────────────────
  const injection = detectInjection([{ source: "content", text: r.text }]);
  if (injection.length) {
    flags.push({
      code: "PROMPT_INJECTION_ATTEMPT",
      severity: "hard",
      message: `Contains text aimed at the grader ("${injection[0]!.snippet}").`,
      evidence: { patterns: injection.map((m) => m.pattern).join(","), snippet: injection[0]!.snippet },
    });
  }

  return flags;
}
