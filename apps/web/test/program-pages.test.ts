// The owner's program pages: contributors, rounds, treasury moves recorded from checked chain transactions, the audit
// log's filters, settings with an audit trail, metrics and the public recent decisions.

import { Keypair } from "@rialo/ts-cdk";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { MeritState } from "@/lib/merit/state";
import { EXAMPLE_RUBRIC } from "@/lib/shared/program";
import { rolling } from "@/lib/shared/day-cap";

vi.stubEnv("MERIT_DB", "pglite");
const { getDb, schema, audit } = await import("@/lib/db");
const { upsertWalletUser, updateSettings, addReviewer } = await import("@/lib/server/programs");
const { upsertXUser } = await import("@/lib/server/contributors");
const pages = await import("@/lib/server/program-pages");

const NOW = Date.now();
let seq = 0;
const CAMPAIGN = Keypair.generate().publicKey.toString();

async function setup() {
  const db = await getDb();
  const owner = await upsertWalletUser(db, Keypair.generate().publicKey.toString());
  const [p] = await db
    .insert(schema.programs)
    .values({
      slug: `pages-${++seq}`, name: "Pages", description: "A program for page tests.", ownerUserId: owner.id, ownerWallet: owner.walletAddress!, campaignAddress: seq === 1 ? CAMPAIGN : Keypair.generate().publicKey.toString(),
      rubricJson: EXAMPLE_RUBRIC, ratePerPoint: 10_000_000n,
      limitsJson: { maxPerPayout: "100000000", maxPerContributor: "200000000", maxPerRound: "500000000", maxPerDay: "1000000000", autoApproveThreshold: "300000000", payeeCooldownSeconds: 3600, maxAutoApproveItem: "100000000" },
      autoApproveConfidence: 0.8, minScore: 50, roundLengthMinutes: 30, firstRoundStartsAt: new Date(NOW), status: "active",
    })
    .returning();
  await db.insert(schema.programMembers).values({ programId: p!.id, userId: owner.id, role: "owner" });
  const contributors: (typeof schema.contributors.$inferSelect)[] = [];
  for (const h of ["ada", "bo"]) {
    const user = await upsertXUser(db, { xUserId: `pg${seq}${h}`, handle: `${h}${seq}`, createdAt: new Date("2020-01-01"), followers: 100 });
    const [c] = await db.insert(schema.contributors).values({ programId: p!.id, userId: user.id, xUserId: `7${seq}${h.length}`, xHandle: `${h}${seq}`, walletAddress: Keypair.generate().publicKey.toString() }).returning();
    contributors.push(c!);
  }
  const [round] = await db.insert(schema.rounds).values({ programId: p!.id, number: 1, startsAt: new Date(NOW - 3_600_000), endsAt: new Date(NOW - 1_800_000) }).returning();
  const sub = (c: (typeof contributors)[number], status: "paid" | "rejected" | "escalated", amount: bigint | null, n: number) =>
    db.insert(schema.submissions).values({ programId: p!.id, roundId: round!.id, contributorId: c.id, url: `https://x.com/u/status/${seq}${n}`, sourceType: "x_post", resourceId: `${seq}${n}`, status, amount, processedAt: new Date(NOW - 1_000), createdAt: new Date(NOW - 61_000) }).returning();
  const [s1] = await sub(contributors[0]!, "paid", 70_000_000n, 1);
  const [s2] = await sub(contributors[0]!, "rejected", null, 2);
  const [s3] = await sub(contributors[1]!, "escalated", 50_000_000n, 3);
  for (const [s, action, by] of [[s1, "approve", "agent"], [s2, "reject", "agent"], [s3, "escalate", "agent"]] as const) {
    await db.insert(schema.decisions).values({ submissionId: s!.id, flagsJson: action === "reject" ? [{ code: "NEAR_DUPLICATE", severity: "hard", message: "m", evidence: {} }] : [], action, amount: s!.amount ?? 0n, score: 60, summary: `${action} summary`, decisionJson: "{}", decisionHash: `h${seq}${action}`, ruleVersion: "v", decidedBy: by });
  }
  return { db, program: p!, owner, contributors };
}

const tx = (lines: string[], accounts: string[], err: unknown = null) => async () => ({ err, logs: lines.map((l) => `Program log: ${l}`), accounts });

describe("contributors", () => {
  it("lists totals per contributor and records suspensions with a reason", async () => {
    const { db, program, owner, contributors } = await setup();
    const rows = await pages.contributorRows(db, program.id);
    const ada = rows.find((r) => r.id === contributors[0]!.id)!;
    expect(ada).toMatchObject({ submissions: 2, approved: 1, paid: "70000000", status: "active" });
    expect(await pages.setContributorStatus(db, { programId: program.id, contributorId: ada.id, userId: owner.id, status: "suspended", reason: "Posting copies of others' threads." })).toBe(true);
    const detail = await pages.contributorDetail(db, program.id, ada.id);
    expect(detail!.contributor.status).toBe("suspended");
    expect(detail!.history[0]).toMatchObject({ action: "contributor.suspended", data: { reason: "Posting copies of others' threads." } });
    // Another program's contributor isn't reachable through this one.
    const other = await setup();
    expect(await pages.contributorDetail(db, program.id, other.contributors[0]!.id)).toBeNull();
  });
});

describe("chain events the owner signed", () => {
  it("records a checked fund transaction once, refuses failed or foreign ones", async () => {
    const { db, program, owner } = await setup();
    const sig = "5".repeat(88);
    const fund = tx(["Merit escrow funded with 250000000 kelvin (escrow 1250000000)"], [owner.walletAddress!, program.campaignAddress!]);
    expect(await pages.recordChainEvent(db, { program, userId: owner.id, signature: sig, loadTx: fund })).toMatchObject({ ok: true, action: "chain.funded" });
    expect(await pages.recordChainEvent(db, { program, userId: owner.id, signature: sig, loadTx: fund })).toMatchObject({ ok: true, duplicate: true });
    expect(await pages.recordChainEvent(db, { program, userId: owner.id, signature: "6".repeat(88), loadTx: tx(["Merit escrow funded with 1 kelvin"], [owner.walletAddress!, program.campaignAddress!], { InstructionError: 1 }) })).toMatchObject({ ok: false });
    expect(await pages.recordChainEvent(db, { program, userId: owner.id, signature: "7".repeat(88), loadTx: tx(["Merit escrow funded with 1 kelvin"], [owner.walletAddress!, Keypair.generate().publicKey.toString()]) })).toMatchObject({ ok: false, error: expect.stringMatching(/isn't about this campaign/) });
    expect(await pages.recordChainEvent(db, { program, userId: owner.id, signature: "8".repeat(88), loadTx: tx(["Merit stale beat ignored"], [program.campaignAddress!]) })).toMatchObject({ ok: false });
    await pages.recordChainEvent(db, { program, userId: owner.id, signature: "9".repeat(88), loadTx: tx(["Merit owner withdrew 30000000 kelvin of operations budget"], [program.campaignAddress!]) });
    const moves = await pages.treasuryMoves(db, program.id);
    expect(moves.map((m) => [m.action, m.amount])).toEqual([
      ["chain.ops_withdrawn", "30000000"],
      ["chain.funded", "250000000"],
    ]);
  });
  it("classifies every owner action the program logs", () => {
    expect(pages.classifyChainLines(["Merit campaign paused (phase 1)"])?.action).toBe("chain.paused");
    expect(pages.classifyChainLines(["Merit round 4 closed early by the owner at 1"])?.action).toBe("chain.round_closed");
    expect(pages.classifyChainLines(["Merit limits: 1 kelvin per 24h, owner approval above 0, cooldown 0 ms, grace 300000 ms"])?.action).toBe("chain.limits_set");
    expect(pages.classifyChainLines(["Merit owner withdrew 942000000 kelvin (escrow 0)"])).toMatchObject({ action: "chain.withdrawn", amount: "942000000" });
  });
});

describe("audit log and settings", () => {
  it("changes settings with a before→after audit entry, owner only, and filters the log", async () => {
    const { db, program, owner } = await setup();
    const reviewer = Keypair.generate().publicKey.toString();
    await addReviewer(db, { programId: program.id, userId: owner.id, wallet: reviewer });
    const rUser = await upsertWalletUser(db, reviewer);
    expect(await updateSettings(db, { programId: program.id, userId: rUser.id, changes: { joiningPaused: true } })).toMatchObject({ ok: false, status: 403 });
    expect(await updateSettings(db, { programId: program.id, userId: owner.id, changes: { joiningPaused: true, minXFollowers: 25, name: "Pages" } })).toEqual({ ok: true });
    const [p] = await db.select().from(schema.programs).where(eq(schema.programs.id, program.id));
    expect(p).toMatchObject({ joiningPaused: true, minXFollowers: 25 });
    await audit(db, { programId: program.id, actor: "agent", action: "submission.approved", entity: "submission", entityId: "x", data: { rule: "R10" } });
    const all = await pages.auditRows(db, program.id, {});
    const changed = all.rows.find((r) => r.action === "program.settings_changed")!;
    expect(changed.data).toEqual({ joiningPaused: { from: false, to: true }, minXFollowers: { from: 0, to: 25 } });
    expect(all.kinds).toEqual(expect.arrayContaining(["member", "program", "submission"]));
    expect((await pages.auditRows(db, program.id, { actor: "agent" })).rows.map((r) => r.action)).toEqual(["submission.approved"]);
    expect((await pages.auditRows(db, program.id, { kind: "program" })).rows.map((r) => r.action)).toEqual(["program.settings_changed"]);
    expect((await pages.auditRows(db, program.id, { from: "2999-01-01" })).rows).toEqual([]);
  });
});

describe("rounds, metrics and the public record", () => {
  it("merges database rounds with the chain's, and the open round's status", async () => {
    const { db, program } = await setup();
    const state = { round: 2n, phase: 1n, paused: false, roundStartMs: BigInt(NOW - 60_000), roundEndMs: BigInt(NOW + 60_000), submitGraceMs: 300_000n, roundLengthMs: 1_800_000n } as MeritState;
    const view = { rounds: [{ round: 2, decisions: [] }, { round: 1, ledger: "L", decisions: [{ tx: { payout: "sig", payoutLine: "Merit paid 70000000 kelvin to w for post 1 (round 1)" }, amountKelvin: "70000000", status: "Verified" }] }] } as never;
    const rows = await pages.roundRows(db, program.id, view, state);
    expect(rows.map((r) => [r.number, r.status, r.submissions, r.paid])).toEqual([
      [2, "open", 0, "0"],
      [1, "settled", 3, "70000000"],
    ]);
    expect(pages.currentRoundStatus({ ...state, phase: 2n, roundEndMs: BigInt(NOW - 60_000) })).toBe("grace");
    expect(pages.currentRoundStatus({ ...state, phase: 2n, roundEndMs: BigInt(NOW - 600_000) })).toBe("settling");
    expect(pages.currentRoundStatus({ ...state, phase: 6n })).toBe("awaiting_owner");
    expect(pages.currentRoundStatus({ ...state, paused: true })).toBe("paused");
  });
  it("counts reviews, flags, contributors and payouts", async () => {
    const { db, program } = await setup();
    const m = await pages.metrics(db, [program.id]);
    expect(m).toMatchObject({ submissions: 3, reviewed: 3, autoApproved: 1, autoRejected: 1, escalated: 1, contributors: 2, paidContributors: 1, paidKelvin: "70000000", medianReviewSeconds: 60 });
    expect(m!.flags).toEqual([{ code: "NEAR_DUPLICATE", n: 1 }]);
    expect(await pages.metrics(db, [])).toBeNull();
  });
  it("lists recent decisions publicly, rejections included", async () => {
    const { db, program } = await setup();
    const d = await pages.recentDecisions(db, program.id);
    expect(d.map((x) => x.action).sort()).toEqual(["approve", "escalate", "reject"]);
    expect(d.find((x) => x.action === "approve")).toMatchObject({ status: "paid", amount: "70000000" });
  });
  it("reads the rolling 24-hour cap from the day buckets", () => {
    const hour = BigInt(Math.floor(NOW / 3_600_000));
    expect(rolling([hour, hour - 23n, hour - 24n], [5n, 7n, 100n], NOW)).toBe(12n);
    expect(pages.dayCap({ version: 2, maxPerDay: 50n, dayHours: [hour], dayPaid: [20n] } as MeritState, NOW)).toEqual({ max: "50", used: "20" });
    expect(pages.dayCap({ version: 1 } as MeritState)).toBeNull();
  });
});
