import "server-only";

import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { audit, schema, type Db } from "@/lib/db";
import { LEDGER_RENT_KELVIN, REX_COST_KELVIN } from "@/lib/merit/constants";
import type { StoredJudgement } from "@/lib/merit/judgement";
import type { Entry, MeritState } from "@/lib/merit/state";
import { approvableRound } from "@/lib/shared/round-window";
import { runChecks, type PriorMatch } from "./checks";
import { decide, RULE_VERSION, type EngineDecision } from "./engine";
import { explain } from "./explain";
import { JudgeError, type Judge, type Judgment } from "./judge";
import { signRecord, type SignedRecord } from "./record";
import { fromSigned64, hamming, simhash64, toSigned64 } from "./simhash";
import { FetchError, type FetchOutcome, type Resource } from "./types";

/**
 * Process one submission end to end: fetch the post (and thread), run every check, judge it, decide with rules-v9
 * against the chain (escrow, caps, operations budget), sign the decision record, and approve on chain when the rules
 * say so. Everything lands in one transaction with its audit event. A transient failure (X or the model busy) leaves
 * the submission pending to be retried; nothing is half-written.
 */


export class RetryableError extends Error {
  readonly retryable = true;
}

export type PipelineDeps = {
  /** Reads the post through merit-x on behalf of `campaign` (sent as X-Merit-Campaign). */
  fetchPost: (postId: string, campaign: string) => Promise<FetchOutcome>;
  /** null when the model isn't configured: every decision then goes to a person. */
  judge: Judge | null;
  loadCampaign: (address: string) => Promise<MeritState | null>;
  /** The open round's ledger, or null when it hasn't been opened yet. */
  loadLedger: (campaign: MeritState) => Promise<MeritState | null>;
  approve: (campaign: MeritState, a: { contributor: string; xUserId: bigint; postId: bigint; score: bigint; submissionHash: string }) => Promise<{ signature: string }>;
  /** Program v2: take back an unpaid approval (ledger entry `index` of the round). */
  revoke?: (campaign: MeritState, index: bigint) => Promise<{ signature: string }>;
  signer: { address: string; sign: (msg: Uint8Array) => Uint8Array };
  saveJudgement?: (postId: string, value: StoredJudgement) => Promise<void>;
  now?: () => Date;
};

export type ProcessResult = {
  status: "approved" | "partial" | "rejected" | "escalated";
  decisionHash: string;
  rule: string;
  summary: string;
  score: number;
  amount: bigint;
};

const LIVE_ENTRY = new Set([1n, 2n]); // Verifying, Verified: what the round will still pay

/** What the escrow and the caps can still take this round, from the open round's ledger. */
export function roundRoom(campaign: MeritState, ledger: MeritState | null, wallet: string) {
  const entries: Entry[] = ledger?.entries ?? [];
  const live = entries.filter((e) => LIVE_ENTRY.has(e.status));
  const approved = live.reduce((s, e) => s + e.amount, 0n);
  const mine = live.filter((e) => e.contributor === wallet).reduce((s, e) => s + e.amount, 0n);
  const available = campaign.escrowKelvin > approved ? campaign.escrowKelvin - approved : 0n;
  const roundRoom = campaign.capPerRound > approved ? campaign.capPerRound - approved : 0n;
  const contributorRoom = campaign.capPerContributor > mine ? campaign.capPerContributor - mine : 0n;
  // One more approval costs a REX verification, plus the ledger's rent if it is the round's first.
  const opsNeeded = REX_COST_KELVIN + (ledger ? 0n : LEDGER_RENT_KELVIN);
  return { available, capRoom: roundRoom < contributorRoom ? roundRoom : contributorRoom, opsShort: campaign.opsBudgetKelvin < opsNeeded };
}

async function similarTo(db: Db, p: { programId: string; submissionId: string; text: string; simhash: bigint | null }): Promise<PriorMatch[]> {
  const rows = await db
    .select({
      submissionId: schema.submissions.id,
      contributorId: schema.submissions.contributorId,
      xHandle: schema.contributors.xHandle,
      url: schema.submissions.url,
      submittedAt: schema.submissions.createdAt,
      similarity: sql<number>`similarity(${schema.fetchedResources.contentText}, ${p.text})`,
      simhash: schema.fetchedResources.simhash,
      payload: schema.fetchedResources.payloadJson,
    })
    .from(schema.submissions)
    .innerJoin(schema.contributors, eq(schema.contributors.id, schema.submissions.contributorId))
    .innerJoin(schema.fetchedResources, and(eq(schema.fetchedResources.sourceType, schema.submissions.sourceType), eq(schema.fetchedResources.resourceId, schema.submissions.resourceId)))
    .where(and(eq(schema.submissions.programId, p.programId), ne(schema.submissions.id, p.submissionId), ne(schema.submissions.resourceId, sql`(select resource_id from submissions where id = ${p.submissionId})`)))
    .orderBy(desc(sql`similarity(${schema.fetchedResources.contentText}, ${p.text})`))
    .limit(5);
  return rows.map((r) => ({
    submissionId: r.submissionId,
    contributorId: r.contributorId,
    xHandle: r.xHandle,
    url: r.url,
    submittedAt: r.submittedAt,
    similarity: Number(r.similarity),
    hamming: p.simhash !== null && r.simhash !== null ? hamming(p.simhash, fromSigned64(r.simhash)) : null,
    contentAt: (r.payload as Resource | null)?.timestamp ? new Date((r.payload as Resource).timestamp!) : null,
  }));
}

export async function processSubmission(
  db: Db,
  submissionId: string,
  deps: PipelineDeps,
  opts: { supersedes?: { id: string; hash: string }; reason?: string } = {},
): Promise<ProcessResult> {
  const now = deps.now?.() ?? new Date();
  const [row] = await db
    .select({ s: schema.submissions, p: schema.programs, c: schema.contributors, u: schema.users })
    .from(schema.submissions)
    .innerJoin(schema.programs, eq(schema.programs.id, schema.submissions.programId))
    .innerJoin(schema.contributors, eq(schema.contributors.id, schema.submissions.contributorId))
    .innerJoin(schema.users, eq(schema.users.id, schema.contributors.userId))
    .where(eq(schema.submissions.id, submissionId))
    .limit(1);
  if (!row) throw new Error("No such submission.");
  const { s, p: program, c: contributor, u: user } = row;
  const [context] = await db
    .select()
    .from(schema.programContexts)
    .where(and(eq(schema.programContexts.programId, program.id), eq(schema.programContexts.version, program.contextVersion ?? 1)))
    .limit(1);

  // ── The round, from the chain ────────────────────────────────────────────
  if (!program.campaignAddress) throw new Error("This program has no campaign on Rialo.");
  let campaign: MeritState | null;
  try {
    campaign = await deps.loadCampaign(program.campaignAddress);
  } catch {
    throw new RetryableError("Rialo DevNet didn't answer.");
  }
  const live = campaign ? approvableRound(campaign, now.getTime()) : null;
  if (!campaign || !live) throw new Error("No round takes approvals now: the submission waits for a person or the next round.");
  const round = { number: live.number, startsAt: live.startsAt, endsAt: live.endsAt };

  // ── The post ─────────────────────────────────────────────────────────────
  let outcome: FetchOutcome;
  try {
    outcome = await deps.fetchPost(s.resourceId, program.campaignAddress);
  } catch (e) {
    if (e instanceof FetchError && e.retryable) throw new RetryableError(e.message);
    outcome = { status: "not_found", detail: e instanceof Error ? e.message : "The post couldn't be read." };
  }
  const resource = outcome.status === "ok" ? outcome.resource : null;
  const fingerprint = resource ? simhash64(resource.text) : null;
  const sameResource = await db
    .select({ submissionId: schema.submissions.id, xHandle: schema.contributors.xHandle, submittedAt: schema.submissions.createdAt })
    .from(schema.submissions)
    .innerJoin(schema.contributors, eq(schema.contributors.id, schema.submissions.contributorId))
    .where(and(eq(schema.submissions.programId, program.id), eq(schema.submissions.resourceId, s.resourceId), ne(schema.submissions.id, s.id), ne(schema.submissions.contributorId, contributor.id), ne(schema.submissions.status, "rejected")));
  const similar = resource ? await similarTo(db, { programId: program.id, submissionId: s.id, text: resource.text, simhash: fingerprint }) : [];
  const [{ priorCount }] = (await db
    .select({ priorCount: sql<number>`count(*)::int` })
    .from(schema.submissions)
    .where(and(eq(schema.submissions.programId, program.id), ne(schema.submissions.id, s.id)))) as [{ priorCount: number }];

  const flags = runChecks({
    resource,
    notFoundDetail: outcome.status === "not_found" ? outcome.detail : undefined,
    contributor: { id: contributor.id, xUserId: contributor.xUserId, xHandle: contributor.xHandle, walletChangedAt: contributor.walletChangedAt, xFollowers: user.xFollowers, xCreatedAt: user.xCreatedAt },
    round,
    program: {
      minAccountAgeDays: program.minAccountAgeDays,
      payeeCooldownSeconds: program.limitsJson.payeeCooldownSeconds,
      minXFollowers: program.minXFollowers,
      belowMinimum: program.belowMinimum,
      mustInclude: context?.mustIncludeJson ?? [],
    },
    sameResource,
    similar,
    submittedAt: s.createdAt,
  });

  // ── The judge (skipped when a hard flag already decides: no model spend on work that can't be paid) ──────
  let judgment: Judgment | null = null;
  let judgeError: string | undefined;
  const decided = flags.some((f) => f.severity === "hard" && f.code !== "PROMPT_INJECTION_ATTEMPT");
  if (resource && !decided) {
    if (!deps.judge) judgeError = "the model isn't configured";
    else {
      try {
        judgment = await deps.judge({
          programName: program.name,
          generalRules: program.rubricJson.generalRules,
          categories: program.rubricJson.categories,
          ratePerPoint: program.ratePerPoint,
          resource,
          flags,
          contributorHandle: contributor.xHandle,
          userId: contributor.xUserId,
          campaign: program.campaignAddress,
          brief: context
            ? {
                about: context.about,
                summary: context.understandingJson?.summary ?? null,
                keyFacts: context.understandingJson?.keyFacts ?? [],
                onTopic: context.understandingJson?.onTopic ?? [],
                offTopic: context.understandingJson?.offTopic ?? [],
                mustInclude: context.mustIncludeJson,
              }
            : null,
        });
      } catch (e) {
        if (e instanceof JudgeError && e.retryable) throw new RetryableError(e.message);
        judgeError = e instanceof Error ? e.message : "the model failed";
      }
    }
  }

  // ── The decision, against what the chain can still pay ───────────────────
  let room: ReturnType<typeof roundRoom> | null = null;
  try {
    room = roundRoom(campaign, await deps.loadLedger(campaign), contributor.walletAddress ?? "");
  } catch {
    room = null;
  }
  const limits = program.limitsJson;
  const rateKelvin = BigInt(Math.max(...program.rubricJson.categories.map((k) => k.maxPoints))) * program.ratePerPoint;
  let decision: EngineDecision = decide({
    flags,
    judgment: judgment?.output ?? null,
    judgeError,
    categories: program.rubricJson.categories,
    resource,
    ratePerPoint: program.ratePerPoint,
    autoApproveConfidence: program.autoApproveConfidence,
    rateKelvin,
    minScore: program.minScore,
    maxPerPayout: BigInt(limits.maxPerPayout),
    maxAutoApproveItem: BigInt(limits.maxAutoApproveItem),
    availableBudget: room ? room.available : "unknown",
    capRoom: room?.capRoom,
    opsShort: room?.opsShort,
  });

  const contentHash = resource ? base58.encode(sha256(new TextEncoder().encode(resource.text))) : null;
  const sign = (d: EngineDecision, summary: string): SignedRecord =>
    signRecord(
      {
        schema: "merit.decision/v1",
        network: "rialo:devnet",
        campaign: program.campaignAddress!,
        program: { id: program.id, slug: program.slug },
        submission: { id: s.id, url: s.url, postId: s.resourceId, submittedAt: s.createdAt.toISOString() },
        contributor: { id: contributor.id, xUserId: contributor.xUserId, xHandle: contributor.xHandle, wallet: contributor.walletAddress },
        round: { number: round.number, startsAt: round.startsAt.toISOString(), endsAt: round.endsAt.toISOString() },
        contentHash,
        context: context?.contextHash && context.version ? { version: context.version, hash: context.contextHash } : null,
        flags: [...flags, ...d.addedFlags],
        judgment: judgment ? { model: judgment.model, promptVersion: judgment.promptVersion, output: judgment.output } : null,
        ruleVersion: RULE_VERSION,
        rule: d.rule,
        decision: { action: d.action, categoryKey: d.categoryKey, points: d.points, score: d.score, amount: d.amount.toString(), auto: d.auto },
        decidedBy: opts.supersedes ? { type: "agent", supersedes: opts.supersedes.hash, reason: opts.reason ?? "re-processed" } : { type: "agent" },
        summary,
        decidedAt: now.toISOString(),
      },
      deps.signer,
    );
  const explainFor = (d: EngineDecision) =>
    explain({ decision: d, flags, judgment: judgment?.output ?? null, categories: program.rubricJson.categories, resource, priorCount: Number(priorCount), minScore: program.minScore, judgeError });

  let summary = explainFor(decision);
  let signed = sign(decision, summary);
  let approveSignature: string | null = null;
  if ((decision.action === "approve" || decision.action === "partial") && contributor.walletAddress) {
    try {
      approveSignature = (
        await deps.approve(campaign, { contributor: contributor.walletAddress, xUserId: BigInt(contributor.xUserId), postId: BigInt(s.resourceId), score: BigInt(decision.score), submissionHash: signed.decisionHash })
      ).signature;
    } catch (e) {
      // The program refused (a cap, the budget, the round closing): a person decides, with the reason recorded.
      decision = { ...decision, action: "escalate", auto: false, rule: "R11_CHAIN_REFUSED" };
      summary = `Escalated for review. The agent would approve ${decision.score}/100, but the Merit program refused the approval (${(e as Error).message.slice(0, 160)}). ${judgment?.output.quality_summary ?? ""}`.trim();
      signed = sign(decision, summary);
    }
  }

  const status: ProcessResult["status"] = decision.action === "approve" ? "approved" : decision.action === "partial" ? "partial" : decision.action === "reject" ? "rejected" : "escalated";
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    if (resource) {
      await t
        .insert(schema.fetchedResources)
        .values({ sourceType: "x_post", resourceId: s.resourceId, payloadJson: resource, contentText: resource.text, contentHash: contentHash!, simhash: fingerprint === null ? null : toSigned64(fingerprint), fetchedAt: now })
        .onConflictDoUpdate({
          target: [schema.fetchedResources.sourceType, schema.fetchedResources.resourceId],
          set: { payloadJson: resource, contentText: resource.text, contentHash: contentHash!, simhash: fingerprint === null ? null : toSigned64(fingerprint), fetchedAt: now },
        });
    }
    await t.insert(schema.decisions).values({
      submissionId: s.id,
      flagsJson: signed.record.flags,
      llmOutputJson: judgment?.output ?? null,
      action: decision.action,
      amount: decision.amount,
      score: decision.score,
      categoryKey: decision.categoryKey,
      points: decision.points,
      summary,
      decisionJson: signed.decisionJson,
      decisionHash: signed.decisionHash,
      signature: signed.signature,
      signerAddress: deps.signer.address,
      model: judgment?.model ?? null,
      promptVersion: judgment?.promptVersion ?? null,
      ruleVersion: RULE_VERSION,
      decidedBy: "agent",
      overrideReason: opts.reason ?? null,
      supersedesId: opts.supersedes?.id ?? null,
    });
    await t
      .update(schema.submissions)
      .set({ status, amount: decision.action === "reject" ? null : decision.amount, processedAt: now, lastError: null, approveSignature: approveSignature ?? s.approveSignature })
      .where(eq(schema.submissions.id, s.id));
    if (judgment) {
      await t.insert(schema.apiUsage).values({
        provider: "anthropic",
        endpoint: "POST /v1/messages (merit-judge)",
        units: judgment.usage.attempts,
        estCostUsd: ((judgment.usage.inputTokens * 0.1 + judgment.usage.outputTokens * 0.5) / 1_000_000).toFixed(6),
        programId: program.id,
        metaJson: { inputTokens: judgment.usage.inputTokens, outputTokens: judgment.usage.outputTokens, model: judgment.model },
      });
    }
    await audit(t, {
      programId: program.id,
      actor: "agent",
      action: opts.supersedes ? "decision.reprocessed" : `submission.${status}`,
      entity: "submission",
      entityId: s.id,
      data: { rule: decision.rule, score: decision.score, amount: decision.amount.toString(), decisionHash: signed.decisionHash, supersedes: opts.supersedes?.hash ?? null },
      signature: approveSignature,
    });
  });
  // The public record reads approved decisions from the store and checks them against the ledger's hash.
  if (approveSignature && resource) {
    await deps
      .saveJudgement?.(s.resourceId, {
        campaign: program.campaignAddress!,
        round: round.number,
        outcome: "approved",
        contributor: contributor.walletAddress ?? undefined,
        xUsername: contributor.xHandle,
        approveSignature,
        canonical: signed.decisionJson,
        submissionHash: signed.decisionHash,
        text: resource.text,
        judgedAt: now.toISOString(),
      })
      .catch(() => undefined);
  }
  return { status, decisionHash: signed.decisionHash, rule: decision.rule, summary, score: decision.score, amount: decision.amount };
}

/** Re-run the agent on a submission (fresh fetch, current rules) before anything is approved on chain. */
export async function reprocessSubmission(db: Db, submissionId: string, deps: PipelineDeps, p: { userId: string; reason: string }) {
  const [s] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, submissionId)).limit(1);
  if (!s) return { ok: false as const, status: 404, error: "not_found" };
  if (s.status === "approved" || s.status === "partial" || s.status === "paid") {
    return { ok: false as const, status: 409, error: "It's approved on chain already. To change it, take it back first (reject it with a reason, which revokes the approval)." };
  }
  const [latest] = await db.select().from(schema.decisions).where(eq(schema.decisions.submissionId, submissionId)).orderBy(desc(schema.decisions.createdAt)).limit(1);
  await audit(db, { programId: s.programId, actor: `user:${p.userId}`, action: "submission.reprocess_requested", entity: "submission", entityId: s.id, data: { reason: p.reason } });
  try {
    const result = await processSubmission(db, submissionId, deps, { supersedes: latest ? { id: latest.id, hash: latest.decisionHash } : undefined, reason: p.reason });
    return { ok: true as const, result };
  } catch (e) {
    return { ok: false as const, status: e instanceof RetryableError ? 503 : 409, error: (e as Error).message };
  }
}
