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
