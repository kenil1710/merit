// Owner review: queue reasons, tabs, human approve/reject/override with signed records and audit, bulk, counts.

import { Keypair } from "@rialo/ts-cdk";
import { desc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { signRecord, verifyRecord } from "@/lib/agent/record";
import type { MeritState } from "@/lib/merit/state";
import { EXAMPLE_RUBRIC } from "@/lib/shared/program";

vi.stubEnv("MERIT_DB", "pglite");
const { getDb, schema } = await import("@/lib/db");
const { upsertWalletUser, addReviewer } = await import("@/lib/server/programs");
const { upsertXUser, requestAppeal } = await import("@/lib/server/contributors");
const review = await import("@/lib/server/review");

const NOW = Date.now();
const key = Keypair.generate();
const signer = { address: key.publicKey.toString(), sign: (m: Uint8Array) => key.sign(m).toBytes() };
let seq = 0;

const campaign = (o: Partial<MeritState> = {}) =>
  ({ phase: 1n, round: 2n, roundStartMs: BigInt(NOW - 60_000), roundEndMs: BigInt(NOW + 600_000), escrowKelvin: 1_000_000_000n, capPerRound: 500_000_000n, capPerContributor: 200_000_000n, opsBudgetKelvin: 100_000_000n, ...o }) as MeritState;
const deps = (o: { campaign?: MeritState; ledger?: MeritState | null; approve?: () => Promise<{ signature: string }> } = {}) => ({
  loadCampaign: vi.fn(async () => o.campaign ?? campaign()),
  loadLedger: vi.fn(async () => o.ledger ?? null),
  approve: vi.fn(o.approve ?? (async () => ({ signature: "humanApproveSig" }))),
  revoke: vi.fn(async () => ({ signature: "revokeSig" })),
  signer,
});

async function setup() {
  const db = await getDb();
  const owner = await upsertWalletUser(db, Keypair.generate().publicKey.toString());
  const [p] = await db
    .insert(schema.programs)
    .values({
      slug: `rev-${++seq}`, name: "Review", description: "d", ownerUserId: owner.id, ownerWallet: owner.walletAddress!, campaignAddress: Keypair.generate().publicKey.toString(),
      rubricJson: EXAMPLE_RUBRIC, ratePerPoint: 10_000_000n, // rate for 100 = 0.1 RLO
      limitsJson: { maxPerPayout: "100000000", maxPerContributor: "200000000", maxPerRound: "500000000", maxPerDay: "1", autoApproveThreshold: "1", payeeCooldownSeconds: 0, maxAutoApproveItem: "1" },
      autoApproveConfidence: 0.8, minScore: 50, roundLengthMinutes: 5, firstRoundStartsAt: new Date(NOW), status: "active",
    })
    .returning();
  await db.insert(schema.programMembers).values({ programId: p!.id, userId: owner.id, role: "owner" });
  const user = await upsertXUser(db, { xUserId: `x${seq}`, handle: `h${seq}`, createdAt: new Date("2020-01-01"), followers: 100 });
  const [c] = await db.insert(schema.contributors).values({ programId: p!.id, userId: user.id, xUserId: `${900 + seq}`, xHandle: `h${seq}`, walletAddress: Keypair.generate().publicKey.toString() }).returning();
  return { db, program: p!, owner, contributor: c! };
}

/** A submission with an agent decision, as the pipeline would leave it. */
async function submission(ctx: Awaited<ReturnType<typeof setup>>, o: { status: "escalated" | "rejected" | "approved"; rule: string; amount?: bigint; flags?: { code: string; severity: "hard" | "soft"; message: string; evidence: object }[]; round?: number }) {
  const { db, program, contributor } = ctx;
  const window = { startsAt: new Date(NOW - 60_000), endsAt: new Date(NOW + 600_000) };
  const [round] = await db
    .insert(schema.rounds)
    .values({ programId: program.id, number: o.round ?? 2, ...window })
    .onConflictDoUpdate({ target: [schema.rounds.programId, schema.rounds.number], set: window })
    .returning();
  const [s] = await db.insert(schema.submissions).values({ programId: program.id, roundId: round!.id, contributorId: contributor.id, url: "https://x.com/u/status/1", sourceType: "x_post", resourceId: `${++seq}00`, status: o.status }).returning();
  const record = signRecord(
    {
      schema: "merit.decision/v1", network: "rialo:devnet", campaign: program.campaignAddress!, program: { id: program.id, slug: program.slug },
      submission: { id: s!.id, url: s!.url, postId: s!.resourceId, submittedAt: s!.createdAt.toISOString() },
      contributor: { id: contributor.id, xUserId: contributor.xUserId, xHandle: contributor.xHandle, wallet: contributor.walletAddress },
      round: { number: o.round ?? 2, startsAt: "a", endsAt: "b" }, contentHash: null, context: null, flags: (o.flags ?? []) as never, judgment: null,
      ruleVersion: "rules-v9-merit1", rule: o.rule, decision: { action: o.status === "approved" ? "approve" : o.status === "rejected" ? "reject" : "escalate", categoryKey: "threads", points: "7.00", score: 70, amount: String(o.amount ?? 0n), auto: true },
      decidedBy: { type: "agent" }, summary: "agent summary", decidedAt: new Date().toISOString(),
    },
    signer,
  );
  await db.insert(schema.decisions).values({
    submissionId: s!.id, flagsJson: o.flags ?? [], action: o.status === "approved" ? "approve" : o.status === "rejected" ? "reject" : "escalate", amount: o.amount ?? 0n, score: 70, categoryKey: "threads",
    summary: "agent summary", decisionJson: record.decisionJson, decisionHash: record.decisionHash, signature: record.signature, signerAddress: signer.address, ruleVersion: "rules-v9-merit1", decidedBy: "agent",
  });
  return s!;
}

const latest = async (id: string) => (await (await getDb()).select().from(schema.decisions).where(eq(schema.decisions.submissionId, id)).orderBy(desc(schema.decisions.createdAt)).limit(1))[0]!;

describe("queue reasons", () => {
  it.each([
    ["R7_LOW_CONFIDENCE", [], "low_confidence"],
    ["R6_SOFT_FLAGS", [{ code: "LOW_FOLLOWERS" }], "below_minimums"],
    ["R6_SOFT_FLAGS", [{ code: "MISSING_REQUIRED" }], "flags"],
    ["R9C_NOT_ENOUGH_FUNDS", [], "over_budget"],
    ["R9E_OVER_ROUND_CAP", [], "over_budget"],
    ["R11_CHAIN_REFUSED", [], "over_budget"],
    ["R2_INJECTION", [], "injection"],
    ["R5_AGENT_RECOMMENDS_REVIEW", [], "agent_review"],
    ["R3_NO_JUDGMENT", [], "no_judgment"],
  ] as const)("%s → %s", (rule, flags, reason) => {
    expect(review.queueReason({ status: "escalated", rule, flags: [...flags], openAppeal: false, waitingFunds: false })).toBe(reason);
  });
  it("puts waiting-for-funds and second looks first, and leaves decided work out", () => {
    expect(review.queueReason({ status: "approved", rule: "R10_AUTO_APPROVE", flags: [], openAppeal: false, waitingFunds: true })).toBe("waiting_funds");
    expect(review.queueReason({ status: "rejected", rule: "R1_REJECT_FLAG", flags: [], openAppeal: true, waitingFunds: false })).toBe("second_look");
    expect(review.queueReason({ status: "rejected", rule: "R1_REJECT_FLAG", flags: [], openAppeal: false, waitingFunds: false })).toBeNull();
    expect(review.queueReason({ status: "pending", rule: null, flags: [], openAppeal: false, waitingFunds: false })).toBe("queued");
  });
});

describe("human decisions", () => {
  it("approves on chain at the score the amount buys, signed, superseding, audited", async () => {
    const ctx = await setup();
    const s = await submission(ctx, { status: "escalated", rule: "R7_LOW_CONFIDENCE", amount: 70_000_000n });
    const d = deps();
    const r = await review.decideByHuman(ctx.db, { submissionId: s.id, userId: ctx.owner.id, decision: { action: "approve", amount: 65_000_000n, reason: "Solid thread, adjusted for length." }, deps: d });
    expect(r).toMatchObject({ ok: true, status: "approved" });
    const dec = await latest(s.id);
    expect(d.approve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ score: 65n, submissionHash: dec.decisionHash, contributor: ctx.contributor.walletAddress }));
    expect(dec).toMatchObject({ decidedBy: "human", decidedByUserId: ctx.owner.id, overrideReason: "Solid thread, adjusted for length.", score: 65, amount: 65_000_000n, action: "approve" });
    expect(verifyRecord(dec.decisionJson, dec.decisionHash, dec.signature!, signer.address)).toBe(true);
    expect(JSON.parse(dec.decisionJson).decidedBy).toMatchObject({ type: "human", userId: ctx.owner.id, supersedes: expect.any(String) });
    const events = await ctx.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId, s.id));
    expect(events.map((e) => e.action)).toContain("decision.human_approved");
    expect((await ctx.db.select().from(schema.submissions).where(eq(schema.submissions.id, s.id)))[0]).toMatchObject({ status: "approved", approveSignature: "humanApproveSig" });
  });

  it("refuses what the program would refuse: below the minimum score, over the cap, a closed round, no funds, no ops budget", async () => {
    const ctx = await setup();
    const s = await submission(ctx, { status: "escalated", rule: "R7_LOW_CONFIDENCE" });
    const run = (amount: bigint, d = deps()) => review.decideByHuman(ctx.db, { submissionId: s.id, userId: ctx.owner.id, decision: { action: "approve", amount, reason: "Good enough for me." }, deps: d });
    expect(await run(40_000_000n)).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/score of 40\/100.*from 50\/100/) });
    expect(await run(200_000_000n)).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/per-payout cap/) });
    expect(await run(60_000_000n, deps({ campaign: campaign({ phase: 2n }) }))).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/round has closed/) });
    expect(await run(60_000_000n, deps({ campaign: campaign({ round: 3n }) }))).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/round has closed/) });
    expect(await run(60_000_000n, deps({ campaign: campaign({ escrowKelvin: 1_000n }) }))).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/Not enough in the escrow/) });
    expect(await run(60_000_000n, deps({ campaign: campaign({ opsBudgetKelvin: 1n }) }))).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/operations budget/) });
    expect(await run(60_000_000n, deps({ approve: async () => Promise.reject(new Error("cap per round")) }))).toMatchObject({ ok: false, status: 502 });
    expect((await ctx.db.select().from(schema.submissions).where(eq(schema.submissions.id, s.id)))[0]!.status).toBe("escalated");
  });

  it("rejects with a reason and answers an open second look", async () => {
    const ctx = await setup();
    const s = await submission(ctx, { status: "rejected", rule: "R1_REJECT_FLAG" });
    await requestAppeal(ctx.db, { xUserId: ctx.contributor.xUserId, submissionId: s.id, note: "please look again" });
    const rows = await review.reviewRows(ctx.db, ctx.program.id);
    expect(rows[0]).toMatchObject({ reason: "second_look" });
    expect(await review.reviewCount(ctx.db, ctx.program.id)).toBe(1);
    // A rejection can't be rejected again, but it can be overridden into an approval.
    expect(await review.decideByHuman(ctx.db, { submissionId: s.id, userId: ctx.owner.id, decision: { action: "reject", reason: "Still not original." }, deps: deps() })).toMatchObject({ ok: false, status: 409 });
    const r = await review.decideByHuman(ctx.db, { submissionId: s.id, userId: ctx.owner.id, decision: { action: "approve", amount: 60_000_000n, reason: "The thread continues; it is original." }, deps: deps() });
    expect(r).toMatchObject({ ok: true, status: "approved" });
    const [appeal] = await ctx.db.select().from(schema.appeals).where(eq(schema.appeals.submissionId, s.id));
    expect(appeal).toMatchObject({ resolutionHash: r.ok ? r.decisionHash : "" });
    expect(appeal!.resolvedAt).not.toBeNull();
    const events = await ctx.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId, s.id));
    expect(events.map((e) => e.action)).toContain("decision.override_approved");
    expect(await review.reviewCount(ctx.db, ctx.program.id)).toBe(0);
  });

  it("takes back an unpaid approval with program v2's revoke; never a paid one, never on v1", async () => {
    const ctx = await setup();
    const s = await submission(ctx, { status: "approved", rule: "R10_AUTO_APPROVE", amount: 70_000_000n });
    const entry = { index: 3, postId: BigInt(s.resourceId), contributor: ctx.contributor.walletAddress, status: 2n };
    const ledger = { entries: [entry] } as unknown as MeritState;
    const outcome = Array(16).fill(0n);
    const reject = (d: ReturnType<typeof deps>) => review.decideByHuman(ctx.db, { submissionId: s.id, userId: ctx.owner.id, decision: { action: "reject", reason: "The post was deleted after approval." }, deps: d });
    expect(await reject(deps({ campaign: campaign({ version: 1, outcome }), ledger }))).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/program v1/) });
    expect(await reject(deps({ campaign: campaign({ version: 2, outcome: outcome.map((_, i) => (i === 3 ? 1n : 0n)) }), ledger }))).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/already settled/) });
    const d = deps({ campaign: campaign({ version: 2, outcome }), ledger });
    expect(await reject(d)).toMatchObject({ ok: true, status: "rejected", revokeSignature: "revokeSig" });
    expect(d.revoke).toHaveBeenCalledWith(expect.anything(), 3n);
    expect(d.approve).not.toHaveBeenCalled();
    const events = await ctx.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId, s.id));
    expect(events.find((e) => e.action === "decision.revoked")).toMatchObject({ signature: "revokeSig" });
    expect((await ctx.db.select().from(schema.submissions).where(eq(schema.submissions.id, s.id)))[0]).toMatchObject({ status: "rejected", amount: null });
    // An approval can't be approved again.
    const again = await submission(ctx, { status: "approved", rule: "R10_AUTO_APPROVE", amount: 70_000_000n });
    expect(await review.decideByHuman(ctx.db, { submissionId: again.id, userId: ctx.owner.id, decision: { action: "approve", amount: 60_000_000n, reason: "Bump it a little." }, deps: deps() })).toMatchObject({ ok: false, status: 409 });
  });

  it("lets reviewers decide, and hides programs from everyone else", async () => {
    const ctx = await setup();
    const s = await submission(ctx, { status: "escalated", rule: "R6_SOFT_FLAGS" });
    const reviewer = Keypair.generate().publicKey.toString();
    await addReviewer(ctx.db, { programId: ctx.program.id, userId: ctx.owner.id, wallet: reviewer });
    const rUser = await upsertWalletUser(ctx.db, reviewer);
    const stranger = await upsertWalletUser(ctx.db, Keypair.generate().publicKey.toString());
    expect(await review.decideByHuman(ctx.db, { submissionId: s.id, userId: stranger.id, decision: { action: "reject", reason: "Not for this program." }, deps: deps() })).toMatchObject({ ok: false, status: 404 });
    expect(await review.reviewDetail(ctx.db, s.id, stranger.id, null)).toBeNull();
    expect(await review.decideByHuman(ctx.db, { submissionId: s.id, userId: rUser.id, decision: { action: "reject", reason: "Not for this program." }, deps: deps() })).toMatchObject({ ok: true, status: "rejected" });
    const detail = await review.reviewDetail(ctx.db, s.id, ctx.owner.id, null);
    expect(detail!.decisions.map((d) => [d.decidedBy, d.verified])).toEqual([
      ["human", true],
      ["agent", true],
    ]);
  });
});

describe("expired: work whose round closed before anyone decided", () => {
  it("moves out of Needs review into Expired, isn't counted, and can't be approved", async () => {
    const ctx = await setup();
    const old = await submission(ctx, { status: "escalated", rule: "R7_LOW_CONFIDENCE", amount: 70_000_000n, round: 1 });
    const appealed = await submission(ctx, { status: "rejected", rule: "R1_REJECT_FLAG", round: 1 });
    await requestAppeal(ctx.db, { xUserId: ctx.contributor.xUserId, submissionId: appealed.id, note: "please look again" });
    const live = await submission(ctx, { status: "escalated", rule: "R7_LOW_CONFIDENCE", amount: 70_000_000n, round: 2 });
    // Round 2 is open: round 1 can't pay any more.
    const rows = await review.reviewRows(ctx.db, ctx.program.id, 2);
    expect(rows.filter((x) => review.inTab(x, "review")).map((x) => x.id)).toEqual([live.id]);
    expect(rows.filter((x) => review.inTab(x, "expired")).map((x) => x.id).sort()).toEqual([old.id, appealed.id].sort());
    expect(rows.find((x) => x.id === old.id)).toMatchObject({ status: "expired", reason: null, round: 1, summary: expect.stringMatching(/^Round 1 closed before anyone decided/) });
    expect(await review.reviewCount(ctx.db, ctx.program.id, 2)).toBe(1);
    expect(await review.reviewCount(ctx.db, ctx.program.id)).toBe(3);
    // Without the chain, nothing is called expired on a guess.
    expect((await review.reviewRows(ctx.db, ctx.program.id, null)).filter((x) => x.status === "expired")).toEqual([]);
    expect(await review.reviewDetail(ctx.db, old.id, ctx.owner.id, { expiredBelow: 2, rounds: [] } as never)).toMatchObject({ submission: { expired: true, round: 1 } });
    const approve = await review.decideByHuman(ctx.db, { submissionId: old.id, userId: ctx.owner.id, decision: { action: "approve", amount: 60_000_000n, reason: "Late but good work." }, deps: deps() });
    expect(approve).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/^Expired: its round has closed/) });
    expect(await review.decideByHuman(ctx.db, { submissionId: old.id, userId: ctx.owner.id, decision: { action: "reject", reason: "Its round closed first." }, deps: deps() })).toMatchObject({ ok: true, status: "rejected" });
  });

  it("a round that closed (no round open) expires its own waiting work too", async () => {
    const ctx = await setup();
    await submission(ctx, { status: "escalated", rule: "R7_LOW_CONFIDENCE", round: 2 });
    const settling = campaign({ phase: 2n, roundEndMs: BigInt(NOW - 1_000) });
    const { expiredBelow } = await import("@/lib/shared/round-window");
    expect(expiredBelow(settling, NOW)).toBe(3);
    expect(await review.reviewCount(ctx.db, ctx.program.id, expiredBelow(settling, NOW))).toBe(0);
  });
});

describe("bulk and tabs", () => {
  it("approves at the agent's amounts, skips items without one, and reports each", async () => {
    const ctx = await setup();
    const a = await submission(ctx, { status: "escalated", rule: "R7_LOW_CONFIDENCE", amount: 70_000_000n });
    const b = await submission(ctx, { status: "escalated", rule: "R3_NO_JUDGMENT" });
    const d = deps();
    const r = await review.bulkDecide(ctx.db, { programId: ctx.program.id, userId: ctx.owner.id, ids: [a.id, b.id], action: "approve", reason: "Reviewed together today.", deps: d });
    expect(r.ok && r.results).toEqual([
      { id: a.id, ok: true },
      { id: b.id, ok: false, error: "No recommended amount: open it and set one." },
    ]);
    expect(d.approve).toHaveBeenCalledTimes(1);
    const rej = await review.bulkDecide(ctx.db, { programId: ctx.program.id, userId: ctx.owner.id, ids: [b.id], action: "reject", reason: "Reviewed together today.", deps: d });
    expect(rej.ok && rej.results).toEqual([{ id: b.id, ok: true }]);
    const rows = await review.reviewRows(ctx.db, ctx.program.id);
    expect(rows.filter((x) => review.inTab(x, "approved")).map((x) => x.id)).toEqual([a.id]);
    expect(rows.filter((x) => review.inTab(x, "rejected")).map((x) => x.id)).toEqual([b.id]);
    expect(rows.filter((x) => review.inTab(x, "review"))).toEqual([]);
  });
  it("refuses other programs' submissions and non-members", async () => {
    const ctx = await setup();
    const other = await setup();
    const s = await submission(other, { status: "escalated", rule: "R7_LOW_CONFIDENCE", amount: 70_000_000n });
    const r = await review.bulkDecide(ctx.db, { programId: ctx.program.id, userId: ctx.owner.id, ids: [s.id], action: "reject", reason: "Reviewed together today.", deps: deps() });
    expect(r.ok && r.results).toEqual([{ id: s.id, ok: false, error: "not_found" }]);
    expect(await review.bulkDecide(ctx.db, { programId: ctx.program.id, userId: other.owner.id, ids: [s.id], action: "reject", reason: "x".repeat(10), deps: deps() })).toMatchObject({ ok: false, status: 404 });
  });
});
