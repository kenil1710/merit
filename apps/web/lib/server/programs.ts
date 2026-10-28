import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { MAX_ROUND_MS } from "@/lib/merit/constants";
import { unhex } from "@/lib/merit/codec";
import { workflowAddress } from "@/lib/merit/pda";
import type { MeritState } from "@/lib/merit/state";
import { audit, schema, type Db } from "@/lib/db";
import { contextHash, contextInputHash } from "@/lib/shared/context";
import { onChainRate, toStoredLimits, type ProgramInput } from "@/lib/shared/program";
import { isEndedPhase } from "@/lib/shared/round-window";

/**
 * Programs and their members. A program is a draft in the database until its owner creates the campaign on Rialo,
 * funds it and publishes; publishing is checked against the chain, so the database never claims a campaign the
 * chain doesn't have. Every write is audited.
 */

export type Program = typeof schema.programs.$inferSelect;
export type Role = (typeof schema.memberRole.enumValues)[number];
const DAY_MS = 86_400_000;

export async function upsertWalletUser(db: Db, address: string) {
  const [found] = await db.select().from(schema.users).where(eq(schema.users.walletAddress, address)).limit(1);
  if (found) return found;
  const [created] = await db
    .insert(schema.users)
    .values({ walletAddress: address })
    .onConflictDoNothing({ target: schema.users.walletAddress })
    .returning();
  return created ?? (await db.select().from(schema.users).where(eq(schema.users.walletAddress, address)).limit(1))[0]!;
}

export async function getMembership(db: Db, programId: string, userId: string): Promise<Role | null> {
  const [m] = await db
    .select({ role: schema.programMembers.role })
    .from(schema.programMembers)
    .where(and(eq(schema.programMembers.programId, programId), eq(schema.programMembers.userId, userId)))
    .limit(1);
  return m?.role ?? null;
}

export type CreateProgramResult = { ok: true; programId: string; slug: string } | { ok: false; error: "slug_taken" };

/** Saves a draft with its owner membership and context version 1, in one transaction with its audit event. */
export async function createProgram(
  db: Db,
  p: { ownerUserId: string; ownerWallet: string; input: ProgramInput },
): Promise<CreateProgramResult> {
  const { basics, context, rubric, budget, limits } = p.input;
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [taken] = await t.select({ id: schema.programs.id }).from(schema.programs).where(eq(schema.programs.slug, basics.slug)).limit(1);
    if (taken) return { ok: false as const, error: "slug_taken" as const };
    const [program] = await t
      .insert(schema.programs)
      .values({
        slug: basics.slug,
        name: basics.name,
        description: basics.description,
        logoUrl: basics.logoUrl || null,
        ownerUserId: p.ownerUserId,
        ownerWallet: p.ownerWallet,
        rubricJson: rubric,
        ratePerPoint: budget.ratePerPoint,
        limitsJson: toStoredLimits(limits, budget),
        autoApproveConfidence: budget.autoApproveConfidence,
        minScore: budget.minScore,
        minAccountAgeDays: budget.minAccountAgeDays,
        minXFollowers: budget.minXFollowers,
        belowMinimum: budget.belowMinimum,
        maxSubmissionsPerRound: budget.maxSubmissionsPerRound,
        contextVersion: 1,
        roundLengthMinutes: budget.roundLengthMinutes,
        firstRoundStartsAt: budget.firstRoundStartsAt,
        refundDeadlineDays: budget.refundDeadlineDays,
        plannedEscrow: budget.escrow,
        plannedOpsBudget: budget.opsBudget,
      })
      .returning({ id: schema.programs.id });
    const programId = program!.id;
    await t.insert(schema.programMembers).values({ programId, userId: p.ownerUserId, role: "owner" });
    await t.insert(schema.programContexts).values({
      ownerUserId: p.ownerUserId,
      programId,
      version: 1,
      about: context.about,
      linksJson: context.links,
      mustIncludeJson: context.mustInclude,
      understandingJson: context.understanding,
      contextHash: contextHash({ version: 1, ...context }),
      inputHash: contextInputHash(context),
    });
    await audit(t, {
      programId,
      actor: `user:${p.ownerUserId}`,
      action: "program.created",
      entity: "program",
      entityId: programId,
      data: { slug: basics.slug, ratePerPoint: budget.ratePerPoint.toString(), limits: toStoredLimits(limits, budget) },
    });
    return { ok: true as const, programId, slug: basics.slug };
  });
}

export type ProgramListItem = Pick<Program, "id" | "slug" | "name" | "status" | "campaignAddress" | "createdAt" | "endedAt"> & { role: Role };

/** Every program the user owns or reviews, newest first. */
export async function listPrograms(db: Db, userId: string): Promise<ProgramListItem[]> {
  const rows = await db
    .select({
      id: schema.programs.id,
      slug: schema.programs.slug,
      name: schema.programs.name,
      status: schema.programs.status,
      campaignAddress: schema.programs.campaignAddress,
      createdAt: schema.programs.createdAt,
      endedAt: schema.programs.endedAt,
      role: schema.programMembers.role,
    })
    .from(schema.programMembers)
    .innerJoin(schema.programs, eq(schema.programs.id, schema.programMembers.programId))
    .where(eq(schema.programMembers.userId, userId))
    .orderBy(desc(schema.programs.createdAt));
  return rows;
}

/** The program with the caller's role, or null for non-members (callers answer 404, never 403). */
export async function getProgramForMember(db: Db, programId: string, userId: string) {
  const role = await getMembership(db, programId, userId);
  if (!role) return null;
  const [program] = await db.select().from(schema.programs).where(eq(schema.programs.id, programId)).limit(1);
  if (!program) return null;
  const [context] = await db
    .select()
    .from(schema.programContexts)
    .where(and(eq(schema.programContexts.programId, programId), eq(schema.programContexts.version, program.contextVersion ?? 1)))
    .limit(1);
  return { program, role, context: context ?? null };
}

/** The create_campaign config the program's settings imply; publishing checks the chain against exactly this. */
export function campaignConfig(p: Program, agent: string, now = Date.now()) {
  const limits = p.limitsJson;
  return {
    agent,
    rateKelvin: onChainRate(p.rubricJson, p.ratePerPoint),
    minScore: BigInt(p.minScore),
    capPerPayout: BigInt(limits.maxPerPayout),
    capPerContributor: BigInt(limits.maxPerContributor),
    capPerRound: BigInt(limits.maxPerRound),
    roundLengthMs: BigInt(Math.min(p.roundLengthMinutes * 60_000, MAX_ROUND_MS)),
    refundDeadlineMs: BigInt(Math.max(now, p.firstRoundStartsAt.getTime()) + p.refundDeadlineDays * DAY_MS),
  };
}

/** Program v2's set_limits from the program's settings: the rolling 24-hour cap, owner approval above a round total,
 * the new-wallet cooldown and the 5-minute late-submission grace. */
export function campaignLimits(p: Program) {
  const limits = p.limitsJson;
  const perDay = BigInt(limits.maxPerDay);
  return {
    maxPerDay: perDay >= BigInt(limits.maxPerPayout) ? perDay : 0n,
    approvalThreshold: BigInt(limits.autoApproveThreshold),
    cooldownMs: BigInt(limits.payeeCooldownSeconds) * 1000n,
    submitGraceMs: 300_000n,
  };
}

type LoadCampaign = (address: string) => Promise<MeritState | null>;

/**
 * Records where the owner is about to create the campaign: the PDA derived from the owner's wallet and a fresh slug.
 * Recorded before the transaction, so a closed tab resumes at the same address. A recorded address can only be
 * replaced while nothing exists there on chain.
 */
export async function recordCampaign(
  db: Db,
  p: { programId: string; userId: string; slugHex: string; agent: string; loadCampaign: LoadCampaign },
): Promise<{ ok: true; campaignAddress: string } | { ok: false; error: string; status: number }> {
  if (!/^[0-9a-f]{64}$/.test(p.slugHex)) return { ok: false, error: "Bad campaign slug.", status: 400 };
  const found = await getProgramForMember(db, p.programId, p.userId);
  if (!found) return { ok: false, error: "not_found", status: 404 };
  if (found.role !== "owner") return { ok: false, error: "Only the owner can create the campaign.", status: 403 };
  const { program } = found;
  if (program.status !== "draft") return { ok: false, error: "This program is already published.", status: 409 };
  const campaignAddress = workflowAddress(program.ownerWallet, unhex(p.slugHex));
  if (program.campaignAddress === campaignAddress) return { ok: true, campaignAddress };
  if (program.campaignAddress && (await p.loadCampaign(program.campaignAddress))) {
    return { ok: false, error: "This program's campaign already exists on chain.", status: 409 };
  }
  await db
    .update(schema.programs)
    .set({ campaignAddress, campaignSlugHex: p.slugHex, agentAddress: p.agent })
    .where(eq(schema.programs.id, program.id));
  await audit(db, {
    programId: program.id,
    actor: `user:${p.userId}`,
    action: "program.campaign_recorded",
    entity: "program",
    entityId: program.id,
    data: { campaignAddress, agent: p.agent },
  });
  return { ok: true, campaignAddress };
}

/** Why the chain doesn't match the program yet, in the owner's words; null when it does. */
export function publishBlocker(program: Program, state: MeritState | null, now = Date.now()): string | null {
  if (!program.campaignAddress || !program.agentAddress) return "Create the campaign on Rialo first.";
  if (!state || state.kind !== 1n) return "The campaign isn't on Rialo yet.";
  if (state.owner !== program.ownerWallet) return "The campaign on chain belongs to another wallet.";
  const want = campaignConfig(program, program.agentAddress, now);
  const mismatch =
    state.agent !== want.agent ||
    state.rateKelvin !== want.rateKelvin ||
    state.minScore !== want.minScore ||
    state.capPerPayout !== want.capPerPayout ||
    state.capPerContributor !== want.capPerContributor ||
    state.capPerRound !== want.capPerRound ||
    state.roundLengthMs !== want.roundLengthMs;
  if (mismatch) return "The campaign on chain doesn't match this program's rules.";
  if (isEndedPhase(state.phase) || state.ending) return "The campaign on chain has ended.";
  if (state.totalFunded === 0n) return "Fund the escrow first.";
  if (state.round === 0n && program.firstRoundStartsAt.getTime() <= now) return "Open round 1 first.";
  return null;
}

/** Marks a draft published once the chain shows its campaign created with the program's rules and funded. */
export async function publishProgram(
  db: Db,
  p: { programId: string; userId: string; loadCampaign: LoadCampaign; now?: number },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const found = await getProgramForMember(db, p.programId, p.userId);
  if (!found) return { ok: false, error: "not_found", status: 404 };
  if (found.role !== "owner") return { ok: false, error: "Only the owner can publish.", status: 403 };
  const { program } = found;
  if (program.status !== "draft") return { ok: true };
  const state = program.campaignAddress ? await p.loadCampaign(program.campaignAddress) : null;
  const blocker = publishBlocker(program, state, p.now);
  if (blocker) return { ok: false, error: blocker, status: 409 };
  await db.update(schema.programs).set({ status: "active" }).where(eq(schema.programs.id, program.id));
  await audit(db, {
    programId: program.id,
    actor: `user:${p.userId}`,
    action: "program.published",
    entity: "program",
    entityId: program.id,
    data: { campaignAddress: program.campaignAddress, round: state!.round.toString(), escrow: state!.escrowKelvin.toString() },
  });
  return { ok: true };
}

// ─── Members ────────────────────────────────────────────────────────────────

export async function listMembers(db: Db, programId: string) {
  return db
    .select({ userId: schema.users.id, wallet: schema.users.walletAddress, role: schema.programMembers.role, addedAt: schema.programMembers.createdAt })
    .from(schema.programMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.programMembers.userId))
    .where(eq(schema.programMembers.programId, programId))
    .orderBy(asc(schema.programMembers.createdAt));
}

/** Owner only: add a reviewer by Rialo wallet (they sign in with it to see the program). */
export async function addReviewer(
  db: Db,
  p: { programId: string; userId: string; wallet: string },
): Promise<{ ok: true; userId: string } | { ok: false; error: string; status: number }> {
  if ((await getMembership(db, p.programId, p.userId)) !== "owner") return { ok: false, error: "not_found", status: 404 };
  const reviewer = await upsertWalletUser(db, p.wallet);
  const existing = await getMembership(db, p.programId, reviewer.id);
  if (existing) return { ok: false, error: existing === "owner" ? "That's the owner's wallet." : "Already a reviewer.", status: 409 };
  await db.insert(schema.programMembers).values({ programId: p.programId, userId: reviewer.id, role: "reviewer" });
  await audit(db, {
    programId: p.programId,
    actor: `user:${p.userId}`,
    action: "member.added",
    entity: "member",
    entityId: reviewer.id,
    data: { wallet: p.wallet, role: "reviewer" },
  });
  return { ok: true, userId: reviewer.id };
}

/** Owner only: remove a reviewer. The owner can't be removed. */
export async function removeReviewer(
  db: Db,
  p: { programId: string; userId: string; memberUserId: string },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if ((await getMembership(db, p.programId, p.userId)) !== "owner") return { ok: false, error: "not_found", status: 404 };
  const role = await getMembership(db, p.programId, p.memberUserId);
  if (!role) return { ok: false, error: "not_found", status: 404 };
  if (role === "owner") return { ok: false, error: "The owner can't be removed.", status: 409 };
  await db
    .delete(schema.programMembers)
    .where(and(eq(schema.programMembers.programId, p.programId), eq(schema.programMembers.userId, p.memberUserId), inArray(schema.programMembers.role, ["reviewer"])));
  await audit(db, { programId: p.programId, actor: `user:${p.userId}`, action: "member.removed", entity: "member", entityId: p.memberUserId });
  return { ok: true };
}

/** Full rows of every program the user is a member of, with their role, newest first (for summaries). */
export async function programsForMember(db: Db, userId: string): Promise<(Program & { role: Role })[]> {
  const rows = await db
    .select({ program: schema.programs, role: schema.programMembers.role })
    .from(schema.programMembers)
    .innerJoin(schema.programs, eq(schema.programs.id, schema.programMembers.programId))
    .where(eq(schema.programMembers.userId, userId))
    .orderBy(desc(schema.programs.createdAt));
  return rows.map((r) => ({ ...r.program, role: r.role }));
}

export type SettingsChanges = Partial<Pick<Program, "name" | "description" | "joiningPaused" | "minAccountAgeDays" | "minXFollowers" | "belowMinimum" | "maxSubmissionsPerRound">>;

/** Owner-only edit of the off-chain settings, audited with what changed (before → after). */
export async function updateSettings(db: Db, p: { programId: string; userId: string; changes: SettingsChanges }) {
  if ((await getMembership(db, p.programId, p.userId)) !== "owner") return { ok: false as const, status: 403, error: "Only the owner can change settings." };
  const [before] = await db.select().from(schema.programs).where(eq(schema.programs.id, p.programId)).limit(1);
  if (!before) return { ok: false as const, status: 404, error: "not_found" };
  const changed = Object.fromEntries(Object.entries(p.changes).filter(([k, v]) => v !== undefined && before[k as keyof Program] !== v));
  if (!Object.keys(changed).length) return { ok: true as const };
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.update(schema.programs).set({ ...changed, updatedAt: new Date() }).where(eq(schema.programs.id, p.programId));
    await audit(t, {
      programId: p.programId,
      actor: `user:${p.userId}`,
      action: "program.settings_changed",
      entity: "program",
      entityId: p.programId,
      data: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, { from: before[k as keyof Program], to: v }])),
    });
  });
  return { ok: true as const };
}
