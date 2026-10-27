import "server-only";

import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { scoreFor } from "@/lib/agent/engine";
import { roundRoom, type PipelineDeps } from "@/lib/agent/pipeline";
import { signRecord, verifyRecord, type DecisionRecord } from "@/lib/agent/record";
import type { Flag } from "@/lib/agent/types";
import { audit, schema, type Db } from "@/lib/db";
import { QUEUE_LABEL_CLIENT, type QueueReasonView } from "@/components/review/types";
import type { CampaignView, DecisionView } from "./campaign-view";
import { approvableRound, type RoundClock } from "@/lib/shared/round-window";
import { getMembership, type Program } from "./programs";

/**
 * Owner review (Misthos' review queue and drawer, on Rialo). Owners and reviewers see every submission with the
 * agent's decision; they approve (the agent key approves on chain at the score their amount buys), reject, or
 * override, always with a reason. Each human decision is a new signed record naming the one it supersedes, logged in
 * the audit log. Work already approved on chain can't be taken back until program v2's revoke.
 */

export const REVIEW_TABS = ["all", "review", "approved", "rejected", "paid", "expired"] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];

/** Why something waits for a person, from the rule that decided it (and the chain). */
export type QueueReason = QueueReasonView;
export const QUEUE_LABEL = QUEUE_LABEL_CLIENT;

export function queueReason(p: { status: string; rule: string | null; flags: { code: string }[]; openAppeal: boolean; waitingFunds: boolean }): QueueReason | null {
  if (p.waitingFunds) return "waiting_funds";
  if (p.openAppeal) return "second_look";
  if (p.status === "pending" || p.status === "processing") return "queued";
  if (p.status !== "escalated") return null;
  switch (p.rule) {
    case "R7_LOW_CONFIDENCE":
      return "low_confidence";
    case "R9C_NOT_ENOUGH_FUNDS":
    case "R9D_BUDGET_UNKNOWN":
    case "R9E_OVER_ROUND_CAP":
    case "R9G_OPS_BUDGET_LOW":
    case "R9_ABOVE_AUTO_CAP":
    case "R11_CHAIN_REFUSED":
      return "over_budget";
    case "R2_INJECTION":
    case "R2B_JUDGE_INJECTION":
      return "injection";
    case "R3_NO_JUDGMENT":
    case "R4_CATEGORY_INVALID":
      return "no_judgment";
    case "R5_AGENT_RECOMMENDS_REVIEW":
      return "agent_review";
    default:
      return p.flags.some((f) => f.code === "LOW_FOLLOWERS" || f.code === "NEW_ACCOUNT") ? "below_minimums" : "flags";
  }
}

const ruleOf = (decisionJson: string | null) => {
  try {
    return decisionJson ? ((JSON.parse(decisionJson) as { rule?: string }).rule ?? null) : null;
  } catch {
    return null;
  }
};

/**
 * Brings submission statuses in line with the chain: an approval whose payout transaction exists is paid; the open
 * round's approvals wait for funds while the campaign does. Best effort (the chain is the source of truth anyway).
 */
export async function reconcileWithChain(db: Db, program: Program, view: CampaignView | null) {
  if (!view) return;
  const entries = view.rounds.flatMap((r) => r.decisions.map((d) => ({ round: r.round, d })));
  const approved = await db
    .select({ id: schema.submissions.id, resourceId: schema.submissions.resourceId, wallet: schema.contributors.walletAddress, waiting: schema.submissions.waitingForFundsAt })
    .from(schema.submissions)
    .innerJoin(schema.contributors, eq(schema.contributors.id, schema.submissions.contributorId))
    .where(and(eq(schema.submissions.programId, program.id), inArray(schema.submissions.status, ["approved", "partial"])));
  for (const s of approved) {
    const hit = entries.find((e) => e.d.postId === s.resourceId && e.d.contributor === s.wallet);
    if (hit?.d.tx.payout) {
      const paid = /Merit paid (\d+) kelvin/.exec(hit.d.tx.payoutLine ?? "")?.[1];
      await db.update(schema.submissions).set({ status: "paid", amount: paid ? BigInt(paid) : undefined, waitingForFundsAt: null }).where(eq(schema.submissions.id, s.id));
    } else {
      const waiting = view.phaseCode === 3 && hit?.round === view.round.number;
      if (waiting !== !!s.waiting) await db.update(schema.submissions).set({ waitingForFundsAt: waiting ? new Date() : null }).where(eq(schema.submissions.id, s.id));
    }
  }
}

export type ReviewRow = {
  id: string;
  url: string;
  postId: string;
  status: string;
  amount: string | null;
  score: number | null;
  createdAt: string;
  xHandle: string;
  summary: string | null;
  rule: string | null;
  flags: { code: string; severity: string }[];
  reason: QueueReason | null;
  decidedBy: "agent" | "human" | null;
  round: number | null;
};

/** Waiting for a person (queued, escalated, or a second look on a rejection): what expires when its round closes. */
const WAITS = new Set(["pending", "processing", "escalated"]);
const waitsForPerson = (status: string, openAppeal: boolean) => WAITS.has(status) || (status === "rejected" && openAppeal);

/**
 * Every submission, newest first. Pass `expiredBelow` (from `expiredBelow()` in lib/shared/round-window.ts) and work
 * still waiting for a person from a round that can't pay any more shows as "expired" instead of "Needs review".
 */
export async function reviewRows(db: Db, programId: string, expiredBelow: number | null = null): Promise<ReviewRow[]> {
  const subs = await db
    .select({ s: schema.submissions, xHandle: schema.contributors.xHandle, round: schema.rounds.number })
    .from(schema.submissions)
    .innerJoin(schema.contributors, eq(schema.contributors.id, schema.submissions.contributorId))
    .leftJoin(schema.rounds, eq(schema.rounds.id, schema.submissions.roundId))
    .where(eq(schema.submissions.programId, programId))
    .orderBy(desc(schema.submissions.createdAt))
    .limit(500);
  if (!subs.length) return [];
  const ids = subs.map((r) => r.s.id);
  const [decisions, appeals] = await Promise.all([
    db.select().from(schema.decisions).where(inArray(schema.decisions.submissionId, ids)).orderBy(desc(schema.decisions.createdAt)),
    db.select({ submissionId: schema.appeals.submissionId }).from(schema.appeals).where(and(inArray(schema.appeals.submissionId, ids), isNull(schema.appeals.resolvedAt))),
  ]);
  const open = new Set(appeals.map((a) => a.submissionId));
  return subs.map(({ s, xHandle, round }) => {
    const d = decisions.find((x) => x.submissionId === s.id) ?? null;
    const flags = ((d?.flagsJson ?? []) as Flag[]).map((f) => ({ code: f.code, severity: f.severity }));
    const rule = ruleOf(d?.decisionJson ?? null);
    const roundNumber = round ?? (d ? ((JSON.parse(d.decisionJson) as { round?: { number?: number } }).round?.number ?? null) : null);
    const expired = expiredBelow !== null && roundNumber !== null && roundNumber < expiredBelow && waitsForPerson(s.status, open.has(s.id));
    if (expired) {
      return {
        id: s.id,
        url: s.url,
        postId: s.resourceId,
        status: "expired",
        amount: null,
        score: d?.score ?? null,
        createdAt: s.createdAt.toISOString(),
        xHandle,
        summary: `Round ${roundNumber} closed before anyone decided, so the program can't pay it any more. ${d?.summary ?? ""}`.trim(),
        rule,
        flags,
        reason: null,
        decidedBy: d?.decidedBy ?? null,
        round: roundNumber,
      };
    }
    return {
      id: s.id,
      url: s.url,
      postId: s.resourceId,
      status: s.status,
      amount: s.amount?.toString() ?? (d && d.amount > 0n ? d.amount.toString() : null),
      score: d?.score ?? null,
      createdAt: s.createdAt.toISOString(),
      xHandle,
      summary: d?.summary ?? (s.lastError ? `Waiting: ${s.lastError}` : null),
      rule,
      flags,
      reason: queueReason({ status: s.status, rule, flags, openAppeal: open.has(s.id), waitingFunds: !!s.waitingForFundsAt }),
      decidedBy: d?.decidedBy ?? null,
      round: roundNumber,
    };
  });
}

export function inTab(r: ReviewRow, tab: ReviewTab): boolean {
  if (tab === "all") return true;
  if (tab === "review") return r.reason !== null;
  if (tab === "approved") return r.status === "approved" || r.status === "partial";
  if (tab === "rejected") return r.status === "rejected";
  if (tab === "expired") return r.status === "expired";
  return r.status === "paid";
}

/**
 * What needs a person in a program: escalated, open second looks, approvals waiting for funds. With `expiredBelow`,
 * work from rounds that can't pay any more isn't counted (it's expired, not waiting).
 */
export async function reviewCount(db: Db, programId: string, expiredBelow: number | null = null): Promise<number> {
  const live =
    expiredBelow === null
      ? sql`true`
      : sql`(${schema.submissions.waitingForFundsAt} is not null or not exists (select 1 from rounds r where r.id = ${schema.submissions.roundId} and r.number < ${expiredBelow}))`;
  const [row] = await db
    .select({ n: count() })
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.programId, programId),
        sql`(${schema.submissions.status} = 'escalated' or ${schema.submissions.waitingForFundsAt} is not null or exists (select 1 from appeals a where a.submission_id = ${schema.submissions.id} and a.resolved_at is null))`,
        live,
      ),
    );
  return Number(row?.n ?? 0);
}

export type DecisionDetail = {
  id: string;
  action: string;
  amount: string;
  score: number | null;
  points: string | null;
  categoryKey: string | null;
  summary: string;
  rule: string | null;
  flags: Flag[];
  /** The judge's output; partial on older records (round 1 kept only reasons). */
  llm: { rubric_scores?: Record<string, number>; reasons?: string[]; confidence?: number; quality_summary?: string; soft_flags?: string[] } | null;
  model: string | null;
  promptVersion: string | null;
  ruleVersion: string;
  decidedBy: "agent" | "human";
  overrideReason: string | null;
  decisionHash: string;
  signature: string | null;
  signer: string | null;
  /** The signature checks out against the record's hash, and the hash against its JSON. */
  verified: boolean;
  createdAt: string;
};

export async function reviewDetail(db: Db, submissionId: string, userId: string, view: CampaignView | null) {
  const [row] = await db
    .select({ s: schema.submissions, c: schema.contributors, p: schema.programs })
    .from(schema.submissions)
    .innerJoin(schema.contributors, eq(schema.contributors.id, schema.submissions.contributorId))
    .innerJoin(schema.programs, eq(schema.programs.id, schema.submissions.programId))
    .where(eq(schema.submissions.id, submissionId))
    .limit(1);
  if (!row || !(await getMembership(db, row.s.programId, userId))) return null;
  const [decisions, [appeal], [resource], [round]] = await Promise.all([
    db.select().from(schema.decisions).where(eq(schema.decisions.submissionId, submissionId)).orderBy(desc(schema.decisions.createdAt)),
    db.select().from(schema.appeals).where(eq(schema.appeals.submissionId, submissionId)).limit(1),
    db.select().from(schema.fetchedResources).where(and(eq(schema.fetchedResources.sourceType, "x_post"), eq(schema.fetchedResources.resourceId, row.s.resourceId))).limit(1),
    row.s.roundId ? db.select({ number: schema.rounds.number }).from(schema.rounds).where(eq(schema.rounds.id, row.s.roundId)).limit(1) : Promise.resolve([]),
  ]);
  const openAppeal = !!appeal && !appeal.resolvedAt;
  const expired = !!view && round !== undefined && round.number < view.expiredBelow && waitsForPerson(row.s.status, openAppeal);
  const chain: DecisionView | null =
    view?.rounds.flatMap((r) => r.decisions).find((d) => d.postId === row.s.resourceId && d.contributor === row.c.walletAddress) ?? null;
  const detail: DecisionDetail[] = decisions.map((d) => ({
    id: d.id,
    action: d.action,
    amount: d.amount.toString(),
    score: d.score,
    points: d.points,
    categoryKey: d.categoryKey,
    summary: d.summary,
    rule: ruleOf(d.decisionJson),
    flags: (d.flagsJson ?? []) as Flag[],
    llm: (d.llmOutputJson as DecisionDetail["llm"]) ?? null,
    model: d.model,
    promptVersion: d.promptVersion,
    ruleVersion: d.ruleVersion,
    decidedBy: d.decidedBy,
    overrideReason: d.overrideReason,
    decisionHash: d.decisionHash,
    signature: d.signature,
    signer: d.signerAddress,
    verified: !!(d.signature && d.signerAddress && verifyRecord(d.decisionJson, d.decisionHash, d.signature, d.signerAddress)),
    createdAt: d.createdAt.toISOString(),
  }));
  const p = row.p;
  return {
    submission: { id: row.s.id, url: row.s.url, postId: row.s.resourceId, status: row.s.status, amount: row.s.amount?.toString() ?? null, createdAt: row.s.createdAt.toISOString(), lastError: row.s.lastError, waitingForFunds: !!row.s.waitingForFundsAt, round: round?.number ?? null, expired },
    contributor: { xHandle: row.c.xHandle, wallet: row.c.walletAddress },
    program: {
      slug: p.slug,
      ratePerPoint: p.ratePerPoint.toString(),
      rateKelvin: (BigInt(Math.max(...p.rubricJson.categories.map((k) => k.maxPoints))) * p.ratePerPoint).toString(),
      maxPerPayout: p.limitsJson.maxPerPayout,
      minScore: p.minScore,
      campaignAddress: p.campaignAddress,
    },
    categories: p.rubricJson.categories.map((k) => ({ key: k.key, name: k.name, criteria: k.criteria.map((x) => ({ key: x.key, name: x.name })) })),
    content: resource ? { text: resource.contentText.slice(0, 6000), truncated: resource.contentText.length > 6000 } : null,
    appeal: appeal ? { note: appeal.note, createdAt: appeal.createdAt.toISOString(), resolvedAt: appeal.resolvedAt?.toISOString() ?? null } : null,
    decisions: detail,
    chain,
  };
}

export type HumanDecision = { action: "approve"; amount: bigint; reason: string } | { action: "reject"; reason: string };
export type HumanResult = { ok: true; status: string; decisionHash: string; revokeSignature?: string } | { ok: false; status: number; error: string };

/**
 * A person's decision: approve (at an amount, sent on chain at the score that amount buys) or reject, with a reason.
 * Signed by the agent key as a record that names the person, the reason and the decision it supersedes.
 */
export async function decideByHuman(
  db: Db,
  p: { submissionId: string; userId: string; decision: HumanDecision; deps: Pick<PipelineDeps, "loadCampaign" | "loadLedger" | "approve" | "revoke" | "signer">; now?: Date },
): Promise<HumanResult> {
  const now = p.now ?? new Date();
  const [row] = await db
    .select({ s: schema.submissions, c: schema.contributors, prog: schema.programs })
    .from(schema.submissions)
    .innerJoin(schema.contributors, eq(schema.contributors.id, schema.submissions.contributorId))
    .innerJoin(schema.programs, eq(schema.programs.id, schema.submissions.programId))
    .where(eq(schema.submissions.id, p.submissionId))
    .limit(1);
  if (!row || !(await getMembership(db, row.s.programId, p.userId))) return { ok: false, status: 404, error: "not_found" };
  const { s, c, prog } = row;
  if (s.status === "paid") return { ok: false, status: 409, error: "This submission was already paid." };
  // Approved on chain but not paid: a rejection takes it back with program v2's revoke, before settlement pays it.
  let revokeIndex: bigint | null = null;
  let revokeCampaign = null as Awaited<ReturnType<PipelineDeps["loadCampaign"]>>;
  if (s.status === "approved" || s.status === "partial") {
    if (p.decision.action !== "reject") return { ok: false, status: 409, error: "It's approved on chain already." };
    if (!p.deps.revoke || !prog.campaignAddress) return { ok: false, status: 409, error: "Taking an approval back needs program v2's revoke." };
    revokeCampaign = await p.deps.loadCampaign(prog.campaignAddress).catch(() => null);
    if (!revokeCampaign) return { ok: false, status: 503, error: "Rialo DevNet didn't answer. Try again in a moment." };
    if (revokeCampaign.version < 2) return { ok: false, status: 409, error: "This campaign runs on program v1, which can't take an approval back." };
    const ledger = await p.deps.loadLedger(revokeCampaign).catch(() => null);
    const entry = ledger?.entries.find((e) => e.postId.toString() === s.resourceId && e.contributor === c.walletAddress);
    const live = [1n, 2n, 3n, 6n].includes(revokeCampaign.phase);
    if (!entry || !live || revokeCampaign.outcome[entry.index] !== 0n) {
      return { ok: false, status: 409, error: "Its round has already settled (or it isn't in the round being settled), so it can't be taken back." };
    }
    if (entry.status !== 1n && entry.status !== 2n && entry.status !== 4n) return { ok: false, status: 409, error: "Validators already failed it; it won't be paid." };
    revokeIndex = BigInt(entry.index);
  }
  const [latest] = await db.select().from(schema.decisions).where(eq(schema.decisions.submissionId, s.id)).orderBy(desc(schema.decisions.createdAt)).limit(1);
  if (!latest) return { ok: false, status: 409, error: "The agent hasn't decided yet." };
  if (p.decision.action === "reject" && s.status === "rejected") return { ok: false, status: 409, error: "It's rejected already." };

  const prior = JSON.parse(latest.decisionJson) as Partial<DecisionRecord> & { record?: unknown };
  let score = 0;
  let amount = 0n;
  let campaign = null as Awaited<ReturnType<PipelineDeps["loadCampaign"]>>;
  if (p.decision.action === "approve") {
    if (!prog.campaignAddress) return { ok: false, status: 409, error: "This program has no campaign on Rialo." };
    if (!c.walletAddress) return { ok: false, status: 409, error: "The contributor has no payout wallet." };
    const rateKelvin = BigInt(Math.max(...prog.rubricJson.categories.map((k) => k.maxPoints))) * prog.ratePerPoint;
    if (p.decision.amount <= 0n) return { ok: false, status: 400, error: "The amount must be above zero." };
    if (p.decision.amount > BigInt(prog.limitsJson.maxPerPayout)) return { ok: false, status: 400, error: "The amount is above the program's per-payout cap." };
    ({ score, paid: amount } = scoreFor(p.decision.amount, rateKelvin));
    if (score < prog.minScore) {
      return { ok: false, status: 400, error: `That amount is a score of ${score}/100; the program only pays from ${prog.minScore}/100 (at least ${(rateKelvin * BigInt(prog.minScore)) / 100n} kelvin).` };
    }
    campaign = await p.deps.loadCampaign(prog.campaignAddress).catch(() => null);
    if (!campaign) return { ok: false, status: 503, error: "Rialo DevNet didn't answer. Try again in a moment." };
    const priorRound = prior.round?.number;
    const live = approvableRound(campaign as RoundClock, now.getTime());
    if (!live || (priorRound !== undefined && live.number !== priorRound)) {
      return { ok: false, status: 409, error: "Expired: its round has closed, so the program can't pay it any more (validators check the post's time against its round). You can still reject it with a reason." };
    }
    const room = roundRoom(campaign, await p.deps.loadLedger(campaign).catch(() => null), c.walletAddress);
    if (amount > room.available) return { ok: false, status: 409, error: "Not enough in the escrow for this after the work already approved. Add funds first." };
    if (amount > room.capRoom) return { ok: false, status: 409, error: "That goes past this round's per-contributor or per-round cap." };
    if (room.opsShort) return { ok: false, status: 409, error: "The operations budget can't repay another validator check. Top it up first." };
  }

  const action = p.decision.action;
  const summary = action === "approve" ? `Approved by the team at score ${score}/100: “${p.decision.reason}”` : `Rejected by the team: “${p.decision.reason}”`;
  const signed = signRecord(
    {
      schema: "merit.decision/v1",
      network: "rialo:devnet",
      campaign: prog.campaignAddress ?? "",
      program: { id: prog.id, slug: prog.slug },
      submission: { id: s.id, url: s.url, postId: s.resourceId, submittedAt: s.createdAt.toISOString() },
      contributor: { id: c.id, xUserId: c.xUserId, xHandle: c.xHandle, wallet: c.walletAddress },
      round: prior.round ?? null,
      contentHash: prior.contentHash ?? null,
      context: prior.context ?? null,
      flags: (latest.flagsJson ?? []) as Flag[],
      judgment: prior.judgment ?? null,
      ruleVersion: latest.ruleVersion,
      rule: action === "approve" ? "HUMAN_APPROVE" : "HUMAN_REJECT",
      decision: { action, categoryKey: latest.categoryKey, points: latest.points, score, amount: amount.toString(), auto: false },
      decidedBy: { type: "human", userId: p.userId, reason: p.decision.reason, supersedes: latest.decisionHash },
      summary,
      decidedAt: now.toISOString(),
    },
    p.deps.signer,
  );

  let approveSignature: string | null = null;
  let revokeSignature: string | null = null;
  if (revokeIndex !== null) {
    try {
      revokeSignature = (await p.deps.revoke!(revokeCampaign!, revokeIndex)).signature;
    } catch (e) {
      await audit(db, { programId: prog.id, actor: `user:${p.userId}`, action: "decision.revoke_refused", entity: "submission", entityId: s.id, data: { error: (e as Error).message.slice(0, 300) } });
      return { ok: false, status: 502, error: `The Merit program refused to take it back: ${(e as Error).message.slice(0, 200)}` };
    }
  }
  if (action === "approve") {
    try {
      approveSignature = (
        await p.deps.approve(campaign!, { contributor: c.walletAddress!, xUserId: BigInt(c.xUserId), postId: BigInt(s.resourceId), score: BigInt(score), submissionHash: signed.decisionHash })
      ).signature;
    } catch (e) {
      await audit(db, { programId: prog.id, actor: `user:${p.userId}`, action: "decision.human_approve_refused", entity: "submission", entityId: s.id, data: { error: (e as Error).message.slice(0, 300), score } });
      return { ok: false, status: 502, error: `The Merit program refused the approval: ${(e as Error).message.slice(0, 200)}` };
    }
  }
  const status = action === "approve" ? "approved" : "rejected";
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.insert(schema.decisions).values({
      submissionId: s.id,
      flagsJson: signed.record.flags,
      llmOutputJson: latest.llmOutputJson,
      action,
      amount,
      score,
      categoryKey: latest.categoryKey,
      points: latest.points,
      summary,
      decisionJson: signed.decisionJson,
      decisionHash: signed.decisionHash,
      signature: signed.signature,
      signerAddress: p.deps.signer.address,
      model: latest.model,
      promptVersion: latest.promptVersion,
      ruleVersion: latest.ruleVersion,
      decidedBy: "human",
      decidedByUserId: p.userId,
      overrideReason: p.decision.reason,
      supersedesId: latest.id,
    });
    await t
      .update(schema.submissions)
      .set({ status, amount: action === "approve" ? amount : null, approveSignature: approveSignature ?? s.approveSignature, processedAt: now, lastError: null })
      .where(eq(schema.submissions.id, s.id));
    await t.update(schema.appeals).set({ resolvedAt: now, resolutionHash: signed.decisionHash }).where(and(eq(schema.appeals.submissionId, s.id), isNull(schema.appeals.resolvedAt)));
    await audit(t, {
      programId: prog.id,
      actor: `user:${p.userId}`,
      action: revokeSignature ? "decision.revoked" : action === "approve" ? (latest.action === "reject" ? "decision.override_approved" : "decision.human_approved") : latest.action === "approve" ? "decision.override_rejected" : "decision.human_rejected",
      entity: "submission",
      entityId: s.id,
      data: { reason: p.decision.reason, score, amount: amount.toString(), decisionHash: signed.decisionHash, supersedes: latest.decisionHash, revokeSignature },
      signature: approveSignature ?? revokeSignature,
    });
  });
  return { ok: true, status, decisionHash: signed.decisionHash, ...(revokeSignature ? { revokeSignature } : {}) };
}

/** Bulk: approve at the agent's recommended amounts, or reject, with one reason; each item is its own decision. */
export async function bulkDecide(
  db: Db,
  p: { programId: string; userId: string; ids: string[]; action: "approve" | "reject"; reason: string; deps: Parameters<typeof decideByHuman>[1]["deps"] },
) {
  if (!(await getMembership(db, p.programId, p.userId))) return { ok: false as const, status: 404, error: "not_found" };
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of p.ids) {
    const [s] = await db.select({ programId: schema.submissions.programId }).from(schema.submissions).where(eq(schema.submissions.id, id)).limit(1);
    if (!s || s.programId !== p.programId) {
      results.push({ id, ok: false, error: "not_found" });
      continue;
    }
    let decision: HumanDecision = { action: "reject", reason: p.reason };
    if (p.action === "approve") {
      const [latest] = await db.select({ amount: schema.decisions.amount }).from(schema.decisions).where(eq(schema.decisions.submissionId, id)).orderBy(desc(schema.decisions.createdAt)).limit(1);
      if (!latest || latest.amount <= 0n) {
        results.push({ id, ok: false, error: "No recommended amount: open it and set one." });
        continue;
      }
      decision = { action: "approve", amount: latest.amount, reason: p.reason };
    }
    const r = await decideByHuman(db, { submissionId: id, userId: p.userId, decision, deps: p.deps });
    results.push(r.ok ? { id, ok: true } : { id, ok: false, error: r.error });
  }
  return { ok: true as const, results };
}
