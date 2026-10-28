// The community tester's report (2026-10-28): round status between rounds, the round-32 drawer, the faucet's limits,
// Guardrails' labels and day, passphrase errors, "Read it" timing, score text and the decisions list.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("MERIT_DB", "pglite");
const { getDb, schema } = await import("@/lib/db");
const { roundStatus } = await import("@/lib/shared/round-window");
const { faucetVerdict, reserveGrant, releaseGrant, hashIp } = await import("@/lib/server/faucet");
const { approvalFromDecision } = await import("@/lib/server/judge-records");
const { journey, groupRounds } = await import("@/components/campaign/decisions");
const { usageLabel, latchTotals, startOfUtcDay } = await import("@/lib/server/latch-usage");
const { errorAfterEdit } = await import("@/lib/client/wallet");
const { readContext } = await import("@/lib/agent/context");
const { nextFaucetText } = await import("@/components/faucet-button");
const { readingText } = await import("@/components/app/context-editor");
const { upsertWalletUser } = await import("@/lib/server/programs");
const { upsertXUser } = await import("@/lib/server/contributors");
const { EXAMPLE_RUBRIC } = await import("@/lib/shared/program");
const { Keypair } = await import("@rialo/ts-cdk");

const MIN = 60_000;
const T0 = Date.parse("2026-10-28T08:12:29.412Z");
// The live campaign's clock: 30-minute rounds and a 5-minute grace, as read from 5LyX on chain.
const clock = (o: Partial<Parameters<typeof roundStatus>[0]> = {}) => ({
  phase: 1n,
  round: 80n,
  roundStartMs: BigInt(T0),
  roundEndMs: BigInt(T0 + 30 * MIN),
  roundLengthMs: BigInt(30 * MIN),
  submitGraceMs: BigInt(5 * MIN),
  ...o,
});

describe("round status: /join and Explore read the chain the same way", () => {
  it("an open round takes submissions until it ends", () => {
    const s = roundStatus(clock(), T0 + 10 * MIN);
    expect(s).toMatchObject({ state: "open", label: "Open", takesSubmissions: true, nextOpensAt: null });
    expect(s.text).toBe("Round 80 · Open until 08:42 UTC");
    expect(s.countdown).toMatchObject({ prefix: "closes in" });
    expect(s.countdown?.to.toISOString()).toBe(s.endsAt.toISOString());
  });

  it("between rounds is the Grace period, then Settling: it says when the next one opens", () => {
    // The tester's case: the chain had flipped to Settling during the 5-minute grace.
    const s = roundStatus(clock({ phase: 2n }), T0 + 31 * MIN);
    expect(s).toMatchObject({ state: "grace", label: "Grace period" });
    expect(s.takesSubmissions).toBe(true); // late work for round 80, inside the grace
    expect(s.nextOpensAt?.toISOString()).toBe("2026-10-28T08:48:29.412Z"); // end + grace + a minute of settle steps
    expect(s.text).toBe("Round 80 · Grace period until 08:47 UTC: posts written before 08:42 UTC are still taken. Round 81 opens at about 08:48 UTC");
    expect(s.countdown?.prefix).toBe("grace ends in");
    // Phase still Open on chain but past the end (the last heartbeat hasn't fired yet) reads the same.
    expect(roundStatus(clock(), T0 + 31 * MIN).state).toBe("grace");
  });

  it("after the grace it is Settling; a long stall promises no time", () => {
    const paying = roundStatus(clock({ phase: 2n }), T0 + 36 * MIN);
    expect(paying).toMatchObject({ state: "settling", label: "Settling", takesSubmissions: false });
    expect(paying.nextOpensAt).not.toBeNull();
    expect(paying.countdown?.prefix).toBe("next round in");
    const stalled = roundStatus(clock({ phase: 2n }), T0 + 60 * MIN);
    expect(stalled.nextOpensAt).toBeNull();
    expect(stalled.countdown).toBeNull();
    expect(stalled.text).toMatch(/Settling \(it was due by 08:48 UTC\)/);
  });

  it("with no grace configured a closed round goes straight to Settling", () => {
    expect(roundStatus(clock({ phase: 2n, submitGraceMs: 0n }), T0 + 31 * MIN)).toMatchObject({ state: "settling", takesSubmissions: false });
  });

  it("states that wait on a person, and the end", () => {
    expect(roundStatus(clock({ phase: 3n }), T0).state).toBe("waiting_funds");
    expect(roundStatus(clock({ phase: 6n }), T0).state).toBe("awaiting_owner");
    expect(roundStatus(clock({ paused: true }), T0).state).toBe("paused");
    expect(roundStatus(clock({ phase: 0n }), T0).state).toBe("idle");
    expect(roundStatus(clock({ phase: 4n }), T0)).toMatchObject({ state: "ended", takesSubmissions: false });
  });
});

describe("decision drawer: chain status first", () => {
  const base = { score: 60, amountKelvin: "60000000", judge: undefined, rex: undefined };
  const statusOf = (steps: ReturnType<typeof journey>) => Object.fromEntries(steps.map((s) => [s.key, s.status]));

  it("a paid entry is done all the way, even with no judge record or transaction links (round 32)", () => {
    const steps = journey({ ...base, status: "Verified", paid: true, settled: true });
    expect(statusOf(steps)).toEqual({ judged: "done", approved: "done", verified: "done", paid: "done" });
    expect(steps.some((s) => s.status === "current")).toBe(false);
  });

  it("an entry is approved the moment it is on the ledger; verifying is the only step in progress", () => {
    expect(statusOf(journey({ ...base, status: "Verifying", paid: false, settled: false }))).toEqual({ judged: "done", approved: "done", verified: "current", paid: "waiting" });
  });

  it("a settled round never leaves a step in progress", () => {
    const steps = journey({ ...base, status: "Verifying", paid: false, settled: true });
    expect(statusOf(steps)).toEqual({ judged: "done", approved: "done", verified: "failed", paid: "skipped" });
    expect(steps.find((s) => s.key === "verified")!.label).toBe("Not verified before the round settled");
  });

  it("shows the score as 60/100", () => {
    expect(journey({ ...base, status: "Verified", paid: true, settled: true })[0]!.meta).toBe("score 60/100");
  });
});

describe("decisions list: empty rounds fold, filter by paid", () => {
  const d = (paid: boolean) => ({ paid }) as never;
  const rounds = [
    { round: 80, decisions: [] },
    { round: 79, decisions: [] },
    { round: 33, decisions: [] },
    { round: 32, decisions: [d(true)] },
    { round: 31, decisions: [] },
    { round: 29, decisions: [d(true)] },
    { round: 5, decisions: [d(false)] },
  ] as never;

  it("runs of empty rounds become one line", () => {
    expect(groupRounds(rounds, "all").map((g) => (g.kind === "empty" ? `${g.from}-${g.to}` : g.round.round))).toEqual(["80-79", "33-33", 32, "31-31", 29, 5]);
  });

  it("filters to paid, or to approved and not paid", () => {
    expect(groupRounds(rounds, "paid").flatMap((g) => (g.kind === "round" ? [g.round.round] : []))).toEqual([32, 29]);
    expect(groupRounds(rounds, "approved").flatMap((g) => (g.kind === "round" ? [g.round.round] : []))).toEqual([5]);
  });
});

describe("judge records rebuilt from Neon by the on-chain hash", () => {
  it("picks the decision the ledger carries, even when the submission was reprocessed", async () => {
    const db = await getDb();
    const owner = await upsertWalletUser(db, Keypair.generate().publicKey.toString());
    const [p] = await db
      .insert(schema.programs)
      .values({
        slug: `jr-${Date.now()}`, name: "P", description: "d", ownerUserId: owner.id, ownerWallet: owner.walletAddress!, rubricJson: EXAMPLE_RUBRIC, ratePerPoint: 1n,
        limitsJson: { maxPerPayout: "1", maxPerContributor: "1", maxPerRound: "1", maxPerDay: "1", autoApproveThreshold: "1", payeeCooldownSeconds: 0, maxAutoApproveItem: "1" },
        autoApproveConfidence: 0.8, roundLengthMinutes: 5, firstRoundStartsAt: new Date(), campaignAddress: "5LyXppXdVZHcV6bcWjJkTyir3F9PM5TEx6pTTA9jEiwv",
      })
      .returning();
    const user = await upsertXUser(db, { xUserId: "1658044857343000579", handle: "tester", createdAt: new Date("2020-01-01"), followers: 500 });
    const [c] = await db.insert(schema.contributors).values({ programId: p!.id, userId: user.id, xUserId: "1658044857343000579", xHandle: "tester", walletAddress: "4UkC4Xt2suVBgXSorLSVvhx4qZDvo3Qua6GgtpVJpoMC" }).returning();
    const [s] = await db.insert(schema.submissions).values({ programId: p!.id, contributorId: c!.id, url: "u", sourceType: "x_post", resourceId: "2115000077697929331", status: "paid", approveSignature: "bs5ig96m" }).returning();
    const decision = (hash: string, round: number, at: Date) => ({ submissionId: s!.id, flagsJson: [], action: "approve" as const, score: 60, summary: "s", decisionJson: JSON.stringify({ round: { number: round }, campaign: "5LyX" }), decisionHash: hash, ruleVersion: "v", decidedBy: "agent" as const, createdAt: at });
    await db.insert(schema.decisions).values([decision("3cVA9U9v", 32, new Date("2026-10-27T08:38:53Z")), decision("4FyRMdxF", 32, new Date("2026-10-27T08:40:22Z"))]);
    await db.insert(schema.fetchedResources).values({ sourceType: "x_post", resourceId: "2115000077697929331", payloadJson: {}, contentText: "Rialo in my words", contentHash: "h" });

    const facts = await approvalFromDecision(db, "4FyRMdxF");
    expect(facts?.submissionStatus).toBe("paid");
    expect(facts?.judgement).toMatchObject({ campaign: "5LyX", round: 32, outcome: "approved", xUsername: "tester", approveSignature: "bs5ig96m", submissionHash: "4FyRMdxF", text: "Rialo in my words" });
    expect((await approvalFromDecision(db, "3cVA9U9v"))?.judgement.judgedAt).toBe("2026-10-27T08:38:53.000Z");
    expect(await approvalFromDecision(db, "nope")).toBeNull();
  });
});

describe("faucet limits (Postgres)", () => {
  const W = "4UkC4Xt2suVBgXSorLSVvhx4qZDvo3Qua6GgtpVJpoMC";
  const NOW = Date.parse("2026-10-28T08:00:00Z");
  beforeEach(async () => {
    await (await getDb()).delete(schema.faucetGrants);
  });

  it("one grant per wallet per 24 hours, then 'next faucet in Xh'", async () => {
    const db = await getDb();
    expect(await faucetVerdict(db, W, hashIp("1.1.1.1"), 0n, NOW)).toEqual({ ok: true });
    expect(await reserveGrant(db, W, hashIp("1.1.1.1"), 1_000_000_000n, NOW)).not.toBeNull();
    const again = await faucetVerdict(db, W, hashIp("2.2.2.2"), 0n, NOW + 40_000); // 40 s later, another network
    expect(again).toMatchObject({ ok: false, reason: "wallet", nextAt: new Date(NOW + 86_400_000) });
    expect(!again.ok && again.message).toMatch(/Next faucet in 24 h/);
    expect(await faucetVerdict(db, W, hashIp("1.1.1.1"), 0n, NOW + 86_400_001)).toEqual({ ok: true });
  });

  it("skips a wallet that already holds 1 RLO", async () => {
    expect(await faucetVerdict(await getDb(), W, hashIp("1.1.1.1"), 1_000_000_000n, NOW)).toMatchObject({ ok: false, reason: "balance", nextAt: null });
  });

  it("allows 3 per IP per day across wallets", async () => {
    const db = await getDb();
    const ip = hashIp("9.9.9.9");
    for (let i = 0; i < 3; i++) await reserveGrant(db, Keypair.generate().publicKey.toString(), ip, 1n, NOW + i);
    expect(await faucetVerdict(db, W, ip, 0n, NOW + 10)).toMatchObject({ ok: false, reason: "ip" });
  });

  it("two requests at once for one wallet: only the first is kept; a failed airdrop doesn't count", async () => {
    const db = await getDb();
    const [a, b] = await Promise.all([reserveGrant(db, W, "ip", 1n, NOW), reserveGrant(db, W, "ip", 1n, NOW)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    await releaseGrant(db, (a ?? b)!.id);
    expect(await faucetVerdict(db, W, "ip", 0n, NOW + 1)).toEqual({ ok: true });
  });

  it("the UI says when the next faucet is", () => {
    expect(nextFaucetText(new Date(NOW + 5 * 3_600_000 - 1).toISOString(), NOW)).toBe("Next faucet in 5 h");
    expect(nextFaucetText(new Date(NOW + 20 * MIN).toISOString(), NOW)).toBe("Next faucet in 20 min");
    expect(nextFaucetText(null, NOW)).toBeNull();
  });
});

describe("Guardrails: one source, one day, readable labels", () => {
  const u = (campaign: string, name: string | null, judge: number, cents: number, x = 0) =>
    ({ campaign, name, slug: null, judge: { calls: judge, allowed: judge, denied: 0, failed: 0, cents, child: false }, x: { calls: x, allowed: x, denied: 0, failed: 0, child: false }, deniedBy: [], lastAt: null }) as import("@/lib/server/latch-usage").CampaignUsage;

  it("labels an owner's Read it", () => {
    expect(usageLabel(u("owner-64d7dfcf-0046-4995-aecc-7e00e995a080", null, 1, 0.1))).toBe("Owner · Read it (no campaign yet)");
    expect(usageLabel(u("5LyX", "Rialo in your own words", 3, 0.1))).toBe("Rialo in your own words");
  });

  it("totals a latch's calls and spend from Merit's log, to the hundredth of a cent", () => {
    expect(latchTotals([u("a", null, 3, 0.12), u("b", null, 2, 0.07, 4)], "merit-judge")).toEqual({ calls: 5, cents: 0.19 });
    expect(latchTotals([u("a", null, 3, 0.12, 4)], "merit-x")).toEqual({ calls: 4, cents: 0 });
  });

  it("'Today' starts at 00:00 UTC, whatever the server's timezone (02:15 IST is still yesterday in UTC)", () => {
    expect(startOfUtcDay(Date.parse("2026-10-28T02:14:00Z")).toISOString()).toBe("2026-10-28T00:00:00.000Z");
    expect(startOfUtcDay(Date.parse("2026-10-27T20:45:00Z")).toISOString()).toBe("2026-10-27T00:00:00.000Z");
  });
});

describe("passphrase errors clear as the input becomes valid", () => {
  it("a too-short error clears at 8 characters; an unlock error clears on any edit", () => {
    const short = "Use a passphrase of at least 8 characters.";
    expect(errorAfterEdit(short, "1234567", true)).toBe(short);
    expect(errorAfterEdit(short, "12345678", true)).toBeNull();
    expect(errorAfterEdit("Wrong passphrase.", "x", false)).toBeNull();
    expect(errorAfterEdit(null, "", true)).toBeNull();
  });
});

describe("Read it: parallel links, a deadline, a clear timeout", () => {
  const ok = { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ summary: "s", key_facts: [], on_topic: [], off_topic: [] }) }] };

  it("reads links in parallel and skips one that doesn't answer in time", async () => {
    const started = Date.now();
    const out = await readContext(
      { about: "A program about Rialo.", links: ["https://a.example", "https://slow.example", "https://b.example"] },
      {
        fetchPage: (url) => new Promise((r) => setTimeout(() => r({ title: url, text: "Rialo text", hidden: "" }), url.includes("slow") ? 5_000 : 150)),
        client: { create: async () => ok } as never,
        userId: "owner-1",
        pageTimeoutMs: 400,
      },
    );
    expect(Date.now() - started).toBeLessThan(1_500); // not 150 + 5000 + 150
    expect(out.sources.map((s) => [s.url, s.ok])).toEqual([["https://a.example", true], ["https://slow.example", false], ["https://b.example", true]]);
    expect(out.sources[1]!.note).toMatch(/didn't answer within/);
    expect(out.understanding?.summary).toBe("s");
  });

  it("a slow model gives a clear timeout error instead of a long 'Reading…'", async () => {
    const create = vi.fn(() => new Promise(() => undefined));
    const out = await readContext({ about: "x", links: [] }, { fetchPage: async () => null, client: { create } as never, userId: "owner-1", deadlineMs: 3_500 });
    expect(out.error).toMatch(/didn't answer within 4 seconds/);
    expect((create.mock.calls[0] as unknown as [unknown, { maxRetries: number }])[1].maxRetries).toBe(0);
  });

  it("shows what it is doing", () => {
    expect(readingText(2, 3)).toBe("Reading 3 links… 2s");
    expect(readingText(9, 3)).toBe("Asking the agent… 9s");
    expect(readingText(3, 0)).toBe("Asking the agent… 3s");
    expect(readingText(17, 1)).toBe("Almost done… 17s");
  });
});

describe("score text", () => {
  it("never renders as '60 / 100' or '60/ 100'", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".tsx")) files.push(p);
      }
    };
    walk(path.resolve(import.meta.dirname, "../components"));
    walk(path.resolve(import.meta.dirname, "../app"));
    const bad = files.filter((f) => /\s\/\s?100\b|[^\s{}]\/\s100\b/.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")));
    expect(bad).toEqual([]);
  });
});
