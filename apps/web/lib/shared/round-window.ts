// Which round a post can still be paid in, from the campaign's on-chain state. Shared by the submit route, the agent,
// the review queue (expired items) and the contributor's messages, so they all say the same thing.

/** X post ids are snowflakes: their top bits are the creation time in ms since X's epoch. */
const X_EPOCH_MS = 1_288_834_974_657n;

export function postTimeFromId(postId: string): Date | null {
  if (!/^\d{1,20}$/.test(postId)) return null;
  const ms = (BigInt(postId) >> 22n) + X_EPOCH_MS;
  // Ids from before snowflakes (2010) carry no time.
  return ms > X_EPOCH_MS ? new Date(Number(ms)) : null;
}

export type RoundClock = {
  phase: bigint;
  round: bigint;
  roundStartMs: bigint;
  roundEndMs: bigint;
  /** Program v2: approvals for a closed round are still taken this long after it closes (0 on v1 campaigns). */
  submitGraceMs?: bigint;
  roundLengthMs?: bigint;
  paused?: boolean;
};

const OPEN = 1n;
const SETTLING = 2n;

/** The grace the program applies: the configured one, at most half a round (`merit_core::effective_grace`). */
export function effectiveGraceMs(c: Pick<RoundClock, "submitGraceMs" | "roundLengthMs">): number {
  const grace = Number(c.submitGraceMs ?? 0n);
  const half = c.roundLengthMs ? Number(c.roundLengthMs) / 2 : grace;
  return Math.max(0, Math.min(grace, half));
}

/** The round that still takes approvals now (open, or closed but inside its grace), or null. */
export function approvableRound(c: RoundClock, now = Date.now()): { number: number; startsAt: Date; endsAt: Date; inGrace: boolean } | null {
  if (c.paused) return null;
  const end = Number(c.roundEndMs);
  const window = { number: Number(c.round), startsAt: new Date(Number(c.roundStartMs)), endsAt: new Date(end) };
  if (c.phase === OPEN && now < end) return { ...window, inGrace: false };
  const grace = effectiveGraceMs(c);
  if ((c.phase === OPEN || c.phase === SETTLING) && grace > 0 && now < end + grace) return { ...window, inGrace: true };
  return null;
}

/**
 * Rounds numbered below this can't be paid any more: work waiting for a person from them has expired. Null when
 * the chain wasn't read (nothing is called expired on a guess).
 */
export function expiredBelow(c: RoundClock | null, now = Date.now()): number | null {
  if (!c) return null;
  const live = approvableRound(c, now);
  // Paused: the open round can still be paid once the owner resumes, so it hasn't expired.
  if (c.paused && c.phase === OPEN) return Number(c.round);
  return live ? live.number : Number(c.round) + 1;
}

const hhmm = (d: Date) => `${d.toISOString().slice(11, 16)} UTC`;

/**
 * Why a post can't go into the round that takes approvals now, in words a contributor can act on; null when it can.
 * `v2` says whether the program takes late work at all (program v2's grace).
 */
export function lateMessage(c: RoundClock, postAt: Date | null, now = Date.now()): string | null {
  if (!postAt) return null;
  const live = approvableRound(c, now);
  const grace = effectiveGraceMs(c);
  const graceMin = Math.round(grace / 60_000);
  if (live && postAt >= live.startsAt && postAt < live.endsAt) return null;
  if (live?.inGrace && postAt >= live.endsAt) {
    return `Round ${live.number} closed at ${hhmm(live.endsAt)} and this post was written after that, so it belongs to round ${live.number + 1}. That round opens when round ${live.number} has paid (by about ${hhmm(new Date(live.endsAt.getTime() + grace))}). Submit it then.`;
  }
  const start = live?.startsAt ?? new Date(Number(c.roundStartMs));
  if (postAt < start) {
    if (grace === 0) {
      return `This post was written at ${hhmm(postAt)}, before round ${Number(c.round)} opened (${hhmm(start)}). The Merit program pays each post only in the round it was written in, and this program's version can't take work for a round after it closes, so it can't be paid. Post something new for this round.`;
    }
    return `This post was written at ${hhmm(postAt)}, in an earlier round. Late work is taken for ${graceMin} minute${graceMin === 1 ? "" : "s"} after a round closes, before it pays out; that round has already settled, so it can't be paid. Post something new for round ${Number(c.round)}.`;
  }
  return null;
}

/**
 * Where a campaign's round stands. "grace" is a closed round still taking late posts written during it; "settling"
 * covers paying out and the two waits on the owner (funds, approval to pay).
 */
export type RoundState = "open" | "grace" | "settling" | "waiting_funds" | "awaiting_owner" | "paused" | "idle" | "ended";

/** The one set of round labels every page shows. A past round is "closed". */
export type RoundLabel = "Open" | "Grace period" | "Settling" | "Closed" | "Paused" | "Not started";

export function roundLabel(state: RoundState | "closed"): RoundLabel {
  switch (state) {
    case "open":
      return "Open";
    case "grace":
      return "Grace period";
    case "settling":
    case "waiting_funds":
    case "awaiting_owner":
      return "Settling";
    case "paused":
      return "Paused";
    case "idle":
      return "Not started";
    default:
      return "Closed";
  }
}

/** Why a Settling round waits, when it waits on a person: shown after the label ("Settling · needs funds"). */
export function roundLabelNote(state: RoundState | "closed", owner = false): string | null {
  if (state === "waiting_funds") return owner ? "add funds" : "waiting for funds";
  if (state === "awaiting_owner") return owner ? "needs your approval" : "waiting for the owner";
  return null;
}

/** The label with its note, for a badge: "Grace period", "Settling · waiting for funds". */
export function roundBadgeText(state: RoundState | "closed", owner = false): string {
  const note = roundLabelNote(state, owner);
  return note ? `${roundLabel(state)} · ${note}` : roundLabel(state);
}

export type RoundStatus = {
  state: RoundState;
  /** One of the shared labels (`roundLabel`). */
  label: RoundLabel;
  /** The campaign's current round number on chain. */
  round: number;
  startsAt: Date;
  endsAt: Date;
  /** Whether a contributor can submit now (the open round, or a closed one inside its grace for posts written in it). */
  takesSubmissions: boolean;
  /** When the next round is expected to open (settlement starts after the grace, then takes a few steps); null when it waits on a person. */
  nextOpensAt: Date | null;
  /** What a live countdown counts to, and its words: "closes in", "grace ends in", "next round in". Null when nothing is due. */
  countdown: { to: Date; prefix: string } | null;
  /** One line for a contributor, in UTC, starting with the round and its label. */
  text: string;
};

/** Settlement's steps (peek, pay, reimburse, open) run SETTLE_STEP_MS apart; allow a little more than that. */
const SETTLE_SLACK_MS = 60_000;
/** Past this, settlement is late (DevNet slow, or the timer needs a resume): no next-open time is promised. */
const STALLED_MS = 10 * 60_000;

/**
 * Where a campaign's round clock stands, read from its on-chain state. Every page that shows a round (Explore, /join,
 * a program's join page, the contributor view, the public record and receipts, the owner app) uses this one reading
 * and its labels, so they never disagree. Between two rounds the campaign is in its Grace period (late posts written
 * during the round are still taken), then Settling (paying out) until the next round opens.
 */
export function roundStatus(c: RoundClock, now = Date.now()): RoundStatus {
  const round = Number(c.round);
  const startsAt = new Date(Number(c.roundStartMs));
  const endsAt = new Date(Number(c.roundEndMs));
  const grace = effectiveGraceMs(c);
  const make = (state: RoundState, rest: Omit<RoundStatus, "state" | "label" | "round" | "startsAt" | "endsAt">): RoundStatus => ({
    state,
    label: roundLabel(state),
    round,
    startsAt,
    endsAt,
    ...rest,
  });
  const none = { takesSubmissions: false, nextOpensAt: null, countdown: null };
  if (c.phase === 4n || c.phase === 5n) return make("ended", { ...none, text: "Campaign ended · Closed" });
  if (c.phase === 0n) return make("idle", { ...none, text: "Not started: no round is open until the owner funds the campaign" });
  if (c.phase === 3n) return make("waiting_funds", { ...none, text: `Round ${round} · Settling: waiting for the owner to add funds` });
  if (c.phase === 6n) return make("awaiting_owner", { ...none, text: `Round ${round} · Settling: waiting for the owner's approval to pay` });
  if (c.paused) return make("paused", { ...none, text: `Round ${round} · Paused by the owner` });
  if (c.phase === OPEN && now < endsAt.getTime()) {
    return make("open", { takesSubmissions: true, nextOpensAt: null, countdown: { to: endsAt, prefix: "closes in" }, text: `Round ${round} · Open until ${hhmm(endsAt)}` });
  }
  // Closed: the grace (if any) runs, then settlement pays and opens the next round.
  const settleAt = endsAt.getTime() + grace;
  const nextOpensAt = new Date(Math.max(settleAt, now) + SETTLE_SLACK_MS);
  if (now < settleAt) {
    return make("grace", {
      takesSubmissions: true,
      nextOpensAt,
      countdown: { to: new Date(settleAt), prefix: "grace ends in" },
      text: `Round ${round} · Grace period until ${hhmm(new Date(settleAt))}: posts written before ${hhmm(endsAt)} are still taken. Round ${round + 1} opens at about ${hhmm(nextOpensAt)}`,
    });
  }
  if (now > settleAt + STALLED_MS) {
    return make("settling", { ...none, text: `Round ${round} · Settling (it was due by ${hhmm(new Date(settleAt + SETTLE_SLACK_MS))})` });
  }
  return make("settling", {
    takesSubmissions: false,
    nextOpensAt,
    countdown: { to: nextOpensAt, prefix: "next round in" },
    text: `Round ${round} · Settling: paying out. Round ${round + 1} opens at about ${hhmm(nextOpensAt)}`,
  });
}

/** Ended or refunded (phase 4 or 5). Phase 6, waiting for the owner's approval, is not ended. */
export const isEndedPhase = (phase: bigint | number) => phase === 4n || phase === 5n || phase === 4 || phase === 5;
