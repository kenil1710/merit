// Which round a post can still be paid in (v1: only the open one; v2: also a closed round inside its grace).

import { describe, expect, it } from "vitest";
import { accountRole } from "@/lib/shared/account-role";
import { approvableRound, effectiveGraceMs, expiredBelow, lateMessage, postTimeFromId } from "@/lib/shared/round-window";

const MIN = 60_000;
const T0 = Date.parse("2026-10-26T12:00:00Z");
const clock = (o: Partial<Parameters<typeof approvableRound>[0]> = {}) => ({
  phase: 1n,
  round: 4n,
  roundStartMs: BigInt(T0),
  roundEndMs: BigInt(T0 + 30 * MIN),
  roundLengthMs: BigInt(30 * MIN),
  ...o,
});
/** A snowflake id written at `ms` (X's epoch 1288834974657). */
const idAt = (ms: number) => ((BigInt(ms) - 1_288_834_974_657n) << 22n).toString();

describe("post time from its id", () => {
  it("reads the creation time of round 1's real post", () => {
    expect(postTimeFromId("2113550979329368489")?.toISOString()).toBe("2026-10-23T08:39:56.007Z");
  });
  it("has no time for pre-snowflake ids or junk", () => {
    expect(postTimeFromId("20")).toBeNull();
    expect(postTimeFromId("abc")).toBeNull();
  });
});

describe("v1 campaign (no grace)", () => {
  it("takes approvals only while the round is open", () => {
    expect(approvableRound(clock(), T0 + MIN)).toMatchObject({ number: 4, inGrace: false });
    expect(approvableRound(clock({ phase: 2n }), T0 + 30 * MIN + 1)).toBeNull();
    expect(approvableRound(clock(), T0 + 30 * MIN)).toBeNull();
  });
  it("expires waiting work from every round before the open one, and the closed one once it closes", () => {
    expect(expiredBelow(clock(), T0 + MIN)).toBe(4);
    expect(expiredBelow(clock({ phase: 2n }), T0 + 31 * MIN)).toBe(5);
    expect(expiredBelow(null)).toBeNull();
  });
  it("explains why a post from the last round can't be paid", () => {
    const msg = lateMessage(clock({ round: 5n, roundStartMs: BigInt(T0 + 30 * MIN), roundEndMs: BigInt(T0 + 60 * MIN) }), new Date(T0 + 28 * MIN), T0 + 31 * MIN);
    expect(msg).toMatch(/before round 5 opened.*can't take work for a round after it closes/);
    expect(lateMessage(clock(), new Date(T0 + 5 * MIN), T0 + 6 * MIN)).toBeNull();
  });
});

describe("v2 campaign (5-minute grace)", () => {
  const v2 = (o = {}) => clock({ submitGraceMs: BigInt(5 * MIN), ...o });
  it("still takes approvals for the closed round inside the grace, before it settles", () => {
    expect(approvableRound(v2({ phase: 2n }), T0 + 33 * MIN)).toMatchObject({ number: 4, inGrace: true });
    expect(approvableRound(v2({ phase: 2n }), T0 + 35 * MIN)).toBeNull();
    expect(expiredBelow(v2({ phase: 2n }), T0 + 33 * MIN)).toBe(4);
    expect(expiredBelow(v2({ phase: 2n }), T0 + 36 * MIN)).toBe(5);
  });
  it("takes a post written in the closed round, and sends one written after it to the next round", () => {
    const settling = v2({ phase: 2n });
    expect(lateMessage(settling, new Date(T0 + 29 * MIN), T0 + 32 * MIN)).toBeNull();
    expect(lateMessage(settling, new Date(T0 + 31 * MIN), T0 + 32 * MIN)).toMatch(/belongs to round 5.*Submit it then/);
  });
  it("caps the grace at half a round", () => {
    expect(effectiveGraceMs(v2({ roundLengthMs: BigInt(4 * MIN) }))).toBe(2 * MIN);
  });
  it("a paused campaign takes no approvals but its open round hasn't expired", () => {
    expect(approvableRound(v2({ paused: true }), T0 + MIN)).toBeNull();
    expect(expiredBelow(v2({ paused: true }), T0 + MIN)).toBe(4);
  });
});

describe("account chip role", () => {
  it("shows the role in the current program, else Owner if the wallet owns any", () => {
    expect(accountRole([{ role: "reviewer" }], { role: "reviewer" })).toBe("Reviewer");
    expect(accountRole([{ role: "reviewer" }, { role: "owner" }], { role: "reviewer" })).toBe("Reviewer");
    expect(accountRole([{ role: "reviewer" }])).toBe("Reviewer");
    expect(accountRole([{ role: "reviewer" }, { role: "owner" }])).toBe("Owner");
    expect(accountRole([])).toBe("Owner");
  });
});
