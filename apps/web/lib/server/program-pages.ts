import "server-only";

import { and, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { audit, schema, type Db } from "@/lib/db";
import { rolling } from "@/lib/shared/day-cap";
import { effectiveGraceMs } from "@/lib/shared/round-window";
import type { MeritState } from "@/lib/merit/state";
import { rpc } from "./agent";
import type { CampaignView, DecisionView } from "./campaign-view";
import type { Program } from "./programs";

/**
 * The data behind the owner's program pages (Misthos' contributors, rounds, treasury, audit log and metrics), from
 * the database and the chain. On-chain numbers are the source of truth; the database adds who and why.
 */

const paidOf = (d: DecisionView) => (d.tx.payout ? BigInt(/Merit paid (\d+) kelvin/.exec(d.tx.payoutLine ?? "")?.[1] ?? d.amountKelvin) : 0n);

// ─── Contributors ───────────────────────────────────────────────────────────

export type ContributorRow = {
  id: string;
  xHandle: string;
  wallet: string | null;
  status: string;
  joinedAt: string;
  submissions: number;
  approved: number;
  paid: string;
  lastAt: string | null;
};

export async function contributorRows(db: Db, programId: string): Promise<ContributorRow[]> {
  const rows = await db
    .select({
      c: schema.contributors,
      submissions: sql<number>`count(${schema.submissions.id})::int`,
      approved: sql<number>`count(*) filter (where ${schema.submissions.status} in ('approved','partial','paid'))::int`,
      paid: sql<string>`coalesce(sum(${schema.submissions.amount}) filter (where ${schema.submissions.status} = 'paid'), 0)::text`,
      lastAt: sql<Date | null>`max(${schema.submissions.createdAt})`,
    })
    .from(schema.contributors)
    .leftJoin(schema.submissions, eq(schema.submissions.contributorId, schema.contributors.id))
    .where(eq(schema.contributors.programId, programId))
    .groupBy(schema.contributors.id)
    .orderBy(desc(schema.contributors.createdAt));
  return rows.map(({ c, submissions, approved, paid, lastAt }) => ({
    id: c.id,
    xHandle: c.xHandle,
    wallet: c.walletAddress,
    status: c.status,
    joinedAt: c.createdAt.toISOString(),
    submissions,
    approved,
    paid,
    lastAt: lastAt ? new Date(lastAt).toISOString() : null,
  }));
}

export async function contributorDetail(db: Db, programId: string, contributorId: string) {
  const [row] = await db
    .select({ c: schema.contributors, u: schema.users })
    .from(schema.contributors)
    .innerJoin(schema.users, eq(schema.users.id, schema.contributors.userId))
    .where(and(eq(schema.contributors.id, contributorId), eq(schema.contributors.programId, programId)))
    .limit(1);
  if (!row) return null;
  const [subs, history] = await Promise.all([
    db
      .select({ s: schema.submissions, round: schema.rounds.number })
      .from(schema.submissions)
      .leftJoin(schema.rounds, eq(schema.rounds.id, schema.submissions.roundId))
      .where(eq(schema.submissions.contributorId, contributorId))
      .orderBy(desc(schema.submissions.createdAt))
      .limit(200),
    db
      .select()
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.entity, "contributor"), eq(schema.auditEvents.entityId, contributorId)))
      .orderBy(desc(schema.auditEvents.createdAt))
      .limit(50),
  ]);
  return {
    contributor: row.c,
    user: { followers: row.u.xFollowers, createdAt: row.u.xCreatedAt?.toISOString() ?? null },
    submissions: subs.map(({ s, round }) => ({ id: s.id, url: s.url, status: s.status, amount: s.amount?.toString() ?? null, createdAt: s.createdAt.toISOString(), round })),
    history: history.map((e) => ({ action: e.action, at: e.createdAt.toISOString(), data: e.dataJson as Record<string, unknown>, signature: e.signature })),
  };
}

/** Suspend or reinstate a contributor: the agent stops (or resumes) approving their work. Audited. */
export async function setContributorStatus(db: Db, p: { programId: string; contributorId: string; userId: string; status: "active" | "suspended"; reason: string }) {
  const [c] = await db
    .update(schema.contributors)
    .set({ status: p.status })
    .where(and(eq(schema.contributors.id, p.contributorId), eq(schema.contributors.programId, p.programId)))
    .returning({ id: schema.contributors.id });
  if (!c) return false;
  await audit(db, { programId: p.programId, actor: `user:${p.userId}`, action: p.status === "suspended" ? "contributor.suspended" : "contributor.reinstated", entity: "contributor", entityId: c.id, data: { reason: p.reason } });
  return true;
}

// ─── Rounds ─────────────────────────────────────────────────────────────────

export type RoundStatus = "open" | "grace" | "settling" | "waiting_funds" | "awaiting_owner" | "paused" | "settled";

export type RoundRow = {
  number: number;
  startsAt: string | null;
  endsAt: string | null;
  status: RoundStatus;
  submissions: number;
  approved: number;
  paid: string;
  owed: string;
  ledger: string | null;
};

export function currentRoundStatus(state: Pick<MeritState, "phase" | "paused" | "roundEndMs" | "submitGraceMs" | "roundLengthMs">, now = Date.now()): RoundStatus {
  if (state.paused && state.phase < 4n) return "paused";
  const end = Number(state.roundEndMs);
  const inGrace = now >= end && now < end + effectiveGraceMs(state);
  switch (Number(state.phase)) {
    case 1:
      return now < end ? "open" : inGrace ? "grace" : "settling";
    case 2:
      return inGrace ? "grace" : "settling";
    case 3:
      return "waiting_funds";
    case 6:
      return "awaiting_owner";
    default:
      return "settled";
  }
}

export async function roundRows(db: Db, programId: string, view: CampaignView | null, state: MeritState | null): Promise<RoundRow[]> {
  const [dbRounds, counts] = await Promise.all([
    db.select().from(schema.rounds).where(eq(schema.rounds.programId, programId)),
    db
      .select({ round: schema.rounds.number, n: count() })
      .from(schema.submissions)
      .innerJoin(schema.rounds, eq(schema.rounds.id, schema.submissions.roundId))
      .where(eq(schema.submissions.programId, programId))
      .groupBy(schema.rounds.number),
  ]);
  const numbers = new Set<number>([...dbRounds.map((r) => r.number), ...(view?.rounds.map((r) => r.round) ?? [])]);
  const current = state ? Number(state.round) : null;
  return [...numbers]
    .sort((a, b) => b - a)
    .map((number) => {
      const chain = view?.rounds.find((r) => r.round === number);
      const local = dbRounds.find((r) => r.number === number);
      const decisions = chain?.decisions ?? [];
      const paid = decisions.reduce((t, d) => t + paidOf(d), 0n);
      const owed = decisions.filter((d) => !d.tx.payout && (d.status === "Verified" || d.status === "Verifying")).reduce((t, d) => t + BigInt(d.amountKelvin), 0n);
      const isCurrent = number === current && state;
      return {
        number,
        startsAt: isCurrent ? new Date(Number(state.roundStartMs)).toISOString() : (local?.startsAt.toISOString() ?? null),
        endsAt: isCurrent ? new Date(Number(state.roundEndMs)).toISOString() : (local?.endsAt.toISOString() ?? null),
        status: isCurrent ? currentRoundStatus(state) : "settled",
        submissions: Number(counts.find((c) => c.round === number)?.n ?? 0),
        approved: decisions.length,
        paid: paid.toString(),
        owed: isCurrent ? owed.toString() : "0",
        ledger: chain?.ledger ?? null,
      };
    });
}

export async function roundSubmissions(db: Db, programId: string, number: number) {
  return db
    .select({ id: schema.submissions.id, url: schema.submissions.url, status: schema.submissions.status, amount: schema.submissions.amount, createdAt: schema.submissions.createdAt, xHandle: schema.contributors.xHandle, wallet: schema.contributors.walletAddress, postId: schema.submissions.resourceId })
    .from(schema.submissions)
    .innerJoin(schema.rounds, eq(schema.rounds.id, schema.submissions.roundId))
    .innerJoin(schema.contributors, eq(schema.contributors.id, schema.submissions.contributorId))
    .where(and(eq(schema.submissions.programId, programId), eq(schema.rounds.number, number)))
    .orderBy(desc(schema.submissions.createdAt));
}

// ─── Chain events the owner signed in the app ──────────────────────────────

const CHAIN_KINDS: [RegExp, string][] = [
  [/^Merit escrow funded with (\d+)/, "chain.funded"],
  [/^Merit operations budget funded with (\d+)/, "chain.ops_funded"],
  [/^Merit owner withdrew (\d+) kelvin of operations budget/, "chain.ops_withdrawn"],
  [/^Merit owner withdrew (\d+)/, "chain.withdrawn"],
  [/^Merit refunded (\d+)/, "chain.refunded"],
  [/^Merit campaign .* created by/, "chain.created"],
  [/^Merit round \d+ open until/, "chain.round_opened"],
  [/^Merit campaign ending/, "chain.ending"],
  [/^Merit campaign paused/, "chain.paused"],
  [/^Merit campaign unpaused/, "chain.unpaused"],
  [/^Merit round \d+ closed early/, "chain.round_closed"],
  [/^Merit limits:/, "chain.limits_set"],
  [/^Merit owner approved round/, "chain.round_approved"],
  [/^Merit agent for the next round/, "chain.agent_set"],
  [/^Merit heartbeat resumed/, "chain.resumed"],
];

export function classifyChainLines(lines: string[]): { action: string; amount: string | null; line: string } | null {
  for (const line of lines) {
    for (const [re, action] of CHAIN_KINDS) {
      const m = re.exec(line);
      if (m) return { action, amount: m[1] ?? null, line };
    }
  }
  return null;
}

/**
 * Records a transaction the owner signed in the app (fund, withdraw, pause…) in the audit log, after checking on
 * chain that it succeeded and touched this program's campaign. Idempotent by signature.
 */
export async function recordChainEvent(db: Db, p: { program: Program; userId: string; signature: string; loadTx?: (sig: string) => Promise<{ err: unknown; logs: string[]; accounts?: string[] }> }) {
  if (!p.program.campaignAddress) return { ok: false as const, status: 409, error: "No campaign yet." };
  const [seen] = await db.select({ id: schema.auditEvents.id }).from(schema.auditEvents).where(eq(schema.auditEvents.signature, p.signature)).limit(1);
  if (seen) return { ok: true as const, duplicate: true };
  const tx = await (p.loadTx ?? ((s) => rpc.logs(s)))(p.signature).catch(() => null);
  if (!tx || tx.err) return { ok: false as const, status: 409, error: "That transaction didn't succeed on chain." };
  const lines = tx.logs.map((l) => /Program log: (Merit .*)$/.exec(l)?.[1] ?? (l.startsWith("Merit ") ? l : null)).filter((l): l is string => Boolean(l));
  if (!tx.accounts?.includes(p.program.campaignAddress)) return { ok: false as const, status: 409, error: "That transaction isn't about this campaign." };
  const kind = classifyChainLines(lines);
  if (!kind) return { ok: false as const, status: 409, error: "Not a campaign action Merit records." };
  await audit(db, { programId: p.program.id, actor: `user:${p.userId}`, action: kind.action, entity: "campaign", entityId: p.program.campaignAddress, data: { line: kind.line, amount: kind.amount }, signature: p.signature });
  return { ok: true as const, action: kind.action };
}

// ─── Treasury ───────────────────────────────────────────────────────────────

export async function treasuryMoves(db: Db, programId: string) {
  const rows = await db
    .select()
    .from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.programId, programId), inArray(schema.auditEvents.action, ["chain.funded", "chain.ops_funded", "chain.withdrawn", "chain.ops_withdrawn", "chain.refunded"])))
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(100);
  return rows.map((e) => ({ action: e.action, amount: ((e.dataJson as { amount?: string }).amount ?? "0") as string, at: e.createdAt.toISOString(), signature: e.signature }));
}

export function payoutsOf(view: CampaignView | null) {
  return (view?.rounds ?? []).flatMap((r) =>
    r.decisions.filter((d) => d.tx.payout).map((d) => ({ round: r.round, postId: d.postId, xUsername: d.xUsername ?? null, contributor: d.contributor, amount: paidOf(d).toString(), signature: d.tx.payout! })),
  );
}

export function dayCap(state: MeritState | null, now = Date.now()) {
  if (!state || state.version < 2 || state.maxPerDay === 0n) return null;
  const used = rolling(state.dayHours, state.dayPaid, now);
  return { max: state.maxPerDay.toString(), used: used.toString() };
}

// ─── Audit log ──────────────────────────────────────────────────────────────

export type AuditFilters = { actor?: "agent" | "people" | "chain"; kind?: string; from?: string; to?: string };

export async function auditRows(db: Db, programId: string, f: AuditFilters) {
  const where = [eq(schema.auditEvents.programId, programId)];
  if (f.actor === "agent") where.push(eq(schema.auditEvents.actor, "agent"));
  if (f.actor === "people") where.push(sql`${schema.auditEvents.actor} like 'user:%' and ${schema.auditEvents.action} not like 'chain.%'`);
  if (f.actor === "chain") where.push(sql`${schema.auditEvents.action} like 'chain.%'`);
  if (f.kind) where.push(sql`split_part(${schema.auditEvents.action}, '.', 1) = ${f.kind}`);
  if (f.from && !Number.isNaN(Date.parse(f.from))) where.push(gte(schema.auditEvents.createdAt, new Date(f.from)));
  if (f.to && !Number.isNaN(Date.parse(f.to))) where.push(lte(schema.auditEvents.createdAt, new Date(Date.parse(f.to) + 86_400_000)));
  const [rows, kinds] = await Promise.all([
    db
      .select({ e: schema.auditEvents, wallet: schema.users.walletAddress, xHandle: schema.users.xHandle })
      .from(schema.auditEvents)
      .leftJoin(schema.users, sql`${schema.auditEvents.actor} = 'user:' || ${schema.users.id}::text`)
      .where(and(...where))
      .orderBy(desc(schema.auditEvents.createdAt))
      .limit(300),
    db
      .selectDistinct({ kind: sql<string>`split_part(${schema.auditEvents.action}, '.', 1)` })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.programId, programId)),
  ]);
  return {
    rows: rows.map(({ e, wallet, xHandle }) => ({
      id: e.id,
      at: e.createdAt.toISOString(),
      actor: e.actor === "agent" ? "agent" : e.actor === "system" ? "system" : xHandle ? `@${xHandle}` : wallet ?? e.actor,
      actorKind: e.actor === "agent" ? "agent" : e.action.startsWith("chain.") ? "chain" : "people",
      action: e.action,
      entity: e.entity,
      entityId: e.entityId,
      data: e.dataJson as Record<string, unknown>,
      signature: e.signature,
    })),
    kinds: kinds.map((k) => k.kind).sort(),
  };
}

// ─── Metrics ────────────────────────────────────────────────────────────────

export async function metrics(db: Db, programIds: string[], now = new Date()) {
  if (!programIds.length) return null;
  const inPrograms = inArray(schema.submissions.programId, programIds);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const [[subs], [decs], flags, [contribs], [review], usage, [rounds]] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        paid: sql<number>`count(*) filter (where ${schema.submissions.status} = 'paid')::int`,
        paidKelvin: sql<string>`coalesce(sum(${schema.submissions.amount}) filter (where ${schema.submissions.status} = 'paid'), 0)::text`,
      })
      .from(schema.submissions)
      .where(inPrograms),
    db
      .select({
        reviewed: sql<number>`count(distinct ${schema.decisions.submissionId})::int`,
        auto: sql<number>`count(*) filter (where ${schema.decisions.decidedBy} = 'agent' and ${schema.decisions.action} in ('approve','partial'))::int`,
        escalated: sql<number>`count(*) filter (where ${schema.decisions.action} = 'escalate')::int`,
        rejected: sql<number>`count(*) filter (where ${schema.decisions.decidedBy} = 'agent' and ${schema.decisions.action} = 'reject')::int`,
        human: sql<number>`count(*) filter (where ${schema.decisions.decidedBy} = 'human')::int`,
      })
      .from(schema.decisions)
      .innerJoin(schema.submissions, eq(schema.submissions.id, schema.decisions.submissionId))
      .where(inPrograms),
    db
      .select({ code: sql<string>`f->>'code'`, n: sql<number>`count(*)::int` })
      .from(sql`${schema.decisions} cross join lateral jsonb_array_elements(${schema.decisions.flagsJson}) f`)
      .innerJoin(schema.submissions, eq(schema.submissions.id, schema.decisions.submissionId))
      .where(and(inPrograms, eq(schema.decisions.decidedBy, "agent")))
      .groupBy(sql`f->>'code'`)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        total: sql<number>`count(distinct ${schema.contributors.id})::int`,
        active: sql<number>`count(distinct ${schema.contributors.id}) filter (where ${schema.submissions.createdAt} >= ${monthAgo})::int`,
        paid: sql<number>`count(distinct ${schema.contributors.id}) filter (where ${schema.submissions.status} = 'paid')::int`,
      })
      .from(schema.contributors)
      .leftJoin(schema.submissions, eq(schema.submissions.contributorId, schema.contributors.id))
      .where(inArray(schema.contributors.programId, programIds)),
    db
      .select({ median: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${schema.submissions.processedAt} - ${schema.submissions.createdAt})))` })
      .from(schema.submissions)
      .where(and(inPrograms, sql`${schema.submissions.processedAt} is not null`)),
    db
      .select({ provider: schema.apiUsage.provider, units: sql<number>`sum(${schema.apiUsage.units})::int`, usd: sql<string>`sum(${schema.apiUsage.estCostUsd})::text` })
      .from(schema.apiUsage)
      .where(inArray(schema.apiUsage.programId, programIds))
      .groupBy(schema.apiUsage.provider),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.rounds).where(inArray(schema.rounds.programId, programIds)),
  ]);
  return {
    programs: programIds.length,
    submissions: subs!.total,
    reviewed: decs!.reviewed,
    autoApproved: decs!.auto,
    autoRejected: decs!.rejected,
    escalated: decs!.escalated,
    humanDecisions: decs!.human,
    flags: flags.map((f) => ({ code: f.code, n: f.n })),
    contributors: contribs!.total,
    activeContributors: contribs!.active,
    paidContributors: contribs!.paid,
    medianReviewSeconds: review?.median === null || review?.median === undefined ? null : Math.round(Number(review.median)),
    roundsWithSubmissions: rounds!.n,
    paidSubmissions: subs!.paid,
    paidKelvin: subs!.paidKelvin,
    usage: usage.map((u) => ({ provider: u.provider, units: u.units, usd: Number(u.usd) })),
  };
}

// ─── Public record ──────────────────────────────────────────────────────────

/** The latest decision per submission, rejected and escalated ones included (Misthos' public "Recent decisions"). */
export async function recentDecisions(db: Db, programId: string, limit = 20) {
  const rows = await db
    .select({ d: schema.decisions, xHandle: schema.contributors.xHandle, url: schema.submissions.url, status: schema.submissions.status })
    .from(schema.decisions)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.decisions.submissionId))
    .innerJoin(schema.contributors, eq(schema.contributors.id, schema.submissions.contributorId))
    .where(and(eq(schema.submissions.programId, programId), sql`${schema.decisions.createdAt} = (select max(d2.created_at) from decisions d2 where d2.submission_id = ${schema.decisions.submissionId})`))
    .orderBy(desc(schema.decisions.createdAt))
    .limit(limit);
  return rows.map(({ d, xHandle, url, status }) => ({
    id: d.id,
    action: d.action,
    status,
    decidedBy: d.decidedBy,
    score: d.score,
    amount: d.amount.toString(),
    summary: d.summary,
    hash: d.decisionHash,
    at: d.createdAt.toISOString(),
    xHandle,
    url,
  }));
}
