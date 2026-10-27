import "server-only";

import { and, count, desc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { audit, schema, type Db } from "@/lib/db";
import { minimumStatus } from "@/lib/minimums";
import { Slug } from "@/lib/shared/program";
import type { Program } from "./programs";

/**
 * The contributor side, ported from Misthos: X accounts as users, joining a program with a signed payout wallet
 * (refused when the X account is below a "can't join" minimum), the contributor's own submissions with their latest
 * decision and appeal, the programs an X account joined, and "ask for a second look".
 */

export type Contributor = typeof schema.contributors.$inferSelect;
export type XAccount = { xUserId: string; handle: string; createdAt: Date | null; followers: number | null };

/** Saves the X account as read at sign-in (its age and followers are what the minimums are checked against). */
export async function upsertXUser(db: Db, x: XAccount) {
  const [row] = await db
    .insert(schema.users)
    .values({ xUserId: x.xUserId, xHandle: x.handle, xCreatedAt: x.createdAt, xFollowers: x.followers })
    .onConflictDoUpdate({ target: schema.users.xUserId, set: { xHandle: x.handle, xCreatedAt: x.createdAt, xFollowers: x.followers } })
    .returning();
  return row!;
}

export async function userByX(db: Db, xUserId: string) {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.xUserId, xUserId)).limit(1);
  return row ?? null;
}

export const accountOf = (u: { xCreatedAt: Date | null; xFollowers: number | null } | null) => ({ createdAt: u?.xCreatedAt ?? null, followers: u?.xFollowers ?? null });

/** A published program by its join link; drafts have no public pages. */
export async function publicProgram(db: Db, slug: string): Promise<Program | null> {
  const parsed = Slug.safeParse(slug);
  if (!parsed.success) return null;
  const [p] = await db.select().from(schema.programs).where(eq(schema.programs.slug, parsed.data)).limit(1);
  return p && p.status !== "draft" ? p : null;
}

export async function membership(db: Db, programId: string, xUserId: string): Promise<Contributor | null> {
  const [c] = await db
    .select()
    .from(schema.contributors)
    .where(and(eq(schema.contributors.programId, programId), eq(schema.contributors.xUserId, xUserId), ne(schema.contributors.status, "removed")))
    .limit(1);
  return c ?? null;
}

export type JoinResult = { ok: true; contributor: Contributor } | { ok: false; status: number; error: string };

/** Join with a payout wallet already proven by signature. Idempotent for the same wallet. */
export async function joinProgram(
  db: Db,
  p: { program: Program; xUserId: string; wallet: string; message: string; signature: string; now?: Date },
): Promise<JoinResult> {
  const { program } = p;
  const user = await userByX(db, p.xUserId);
  if (!user) return { ok: false, status: 401, error: "Sign in with X again." };
  const existing = await membership(db, program.id, p.xUserId);
  if (existing) return existing.walletAddress === p.wallet ? { ok: true, contributor: existing } : { ok: false, status: 409, error: "You already joined with another wallet." };
  if (program.endedAt) return { ok: false, status: 409, error: "This campaign has ended." };
  if (program.status !== "active" || program.joiningPaused) return { ok: false, status: 409, error: "Joining is paused for this program." };
  const minimums = minimumStatus(program, accountOf(user), p.now);
  if (minimums.outcome === "block") return { ok: false, status: 403, error: minimums.text };
  const now = p.now ?? new Date();
  const [taken] = await db
    .select({ id: schema.contributors.id })
    .from(schema.contributors)
    .where(and(eq(schema.contributors.programId, program.id), eq(schema.contributors.walletAddress, p.wallet)))
    .limit(1);
  if (taken) return { ok: false, status: 409, error: "Another contributor already uses that wallet here." };
  const [contributor] = await db
    .insert(schema.contributors)
    .values({
      programId: program.id,
      userId: user.id,
      xUserId: p.xUserId,
      xHandle: user.xHandle ?? "",
      walletAddress: p.wallet,
      walletVerifiedAt: now,
      walletProofMessage: p.message,
      walletProofSignature: p.signature,
    })
    .returning();
  await audit(db, {
    programId: program.id,
    actor: `user:${user.id}`,
    action: "contributor.joined",
    entity: "contributor",
    entityId: contributor!.id,
    data: { xUserId: p.xUserId, wallet: p.wallet, belowMinimum: minimums.below },
  });
  return { ok: true, contributor: contributor! };
}

export type SubmissionItem = {
  submission: typeof schema.submissions.$inferSelect;
  decision: typeof schema.decisions.$inferSelect | null;
  appeal: typeof schema.appeals.$inferSelect | null;
  /** The campaign round it was submitted in. */
  roundNumber: number | null;
};

/** The contributor's submissions, newest first, each with its latest decision and appeal. */
export async function contributorSubmissions(db: Db, contributorId: string): Promise<SubmissionItem[]> {
  const subs = await db.select().from(schema.submissions).where(eq(schema.submissions.contributorId, contributorId)).orderBy(desc(schema.submissions.createdAt));
  if (!subs.length) return [];
  const ids = subs.map((s) => s.id);
  const roundIds = [...new Set(subs.flatMap((s) => (s.roundId ? [s.roundId] : [])))];
  const [decisions, appeals, rounds] = await Promise.all([
    db.select().from(schema.decisions).where(inArray(schema.decisions.submissionId, ids)).orderBy(desc(schema.decisions.createdAt)),
    db.select().from(schema.appeals).where(inArray(schema.appeals.submissionId, ids)),
    roundIds.length ? db.select({ id: schema.rounds.id, number: schema.rounds.number }).from(schema.rounds).where(inArray(schema.rounds.id, roundIds)) : [],
  ]);
  return subs.map((submission) => ({
    submission,
    decision: decisions.find((d) => d.submissionId === submission.id) ?? null,
    appeal: appeals.find((a) => a.submissionId === submission.id) ?? null,
    roundNumber: rounds.find((r) => r.id === submission.roundId)?.number ?? null,
  }));
}

export type JoinedProgram = { contributor: Contributor; program: Program; submitted: number; approved: number; rejected: number; review: number };

/** Every published program an X account joined, with counts by outcome. */
export async function joinedPrograms(db: Db, xUserId: string): Promise<JoinedProgram[]> {
  const rows = await db
    .select({ c: schema.contributors, p: schema.programs })
    .from(schema.contributors)
    .innerJoin(schema.programs, eq(schema.programs.id, schema.contributors.programId))
    .where(and(eq(schema.contributors.xUserId, xUserId), ne(schema.contributors.status, "removed"), ne(schema.programs.status, "draft")))
    .orderBy(desc(schema.contributors.createdAt));
  if (!rows.length) return [];
  const counts = await db
    .select({ contributorId: schema.submissions.contributorId, status: schema.submissions.status, n: count() })
    .from(schema.submissions)
    .where(inArray(schema.submissions.contributorId, rows.map((r) => r.c.id)))
    .groupBy(schema.submissions.contributorId, schema.submissions.status);
  return rows.map(({ c, p }) => {
    const mine = counts.filter((x) => x.contributorId === c.id);
    const sum = (...st: string[]) => mine.filter((x) => st.includes(x.status)).reduce((s, x) => s + Number(x.n), 0);
    return { contributor: c, program: p, submitted: sum(...schema.submissionStatus.enumValues), approved: sum("approved", "partial", "paid"), rejected: sum("rejected"), review: sum("escalated", "pending", "processing") };
  });
}

/** Second looks a contributor can ask for per day, across programs. */
export const DAILY_APPEALS = 5;

/**
 * "Ask for a second look" at a rejected decision: the contributor's own submission, once per submission, at most
 * DAILY_APPEALS a day. Recorded with the decision hash it questions; the owner answers with a decision of their own.
 */
export async function requestAppeal(
  db: Db,
  p: { xUserId: string; submissionId: string; note: string; now?: Date },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const now = p.now ?? new Date();
  const [row] = await db
    .select({ s: schema.submissions, c: schema.contributors })
    .from(schema.submissions)
    .innerJoin(schema.contributors, eq(schema.contributors.id, schema.submissions.contributorId))
    .where(eq(schema.submissions.id, p.submissionId))
    .limit(1);
  if (!row || row.c.xUserId !== p.xUserId) return { ok: false, status: 404, error: "not_found" };
  const [latest] = await db
    .select({ action: schema.decisions.action, hash: schema.decisions.decisionHash })
    .from(schema.decisions)
    .where(eq(schema.decisions.submissionId, p.submissionId))
    .orderBy(desc(schema.decisions.createdAt))
    .limit(1);
  if (!latest || latest.action !== "reject") return { ok: false, status: 409, error: "You can ask for a second look at a rejected submission." };
  const [recent] = await db
    .select({ n: count() })
    .from(schema.appeals)
    .where(and(eq(schema.appeals.contributorId, row.c.id), gte(schema.appeals.createdAt, new Date(now.getTime() - 86_400_000))));
  if (Number(recent?.n ?? 0) >= DAILY_APPEALS) return { ok: false, status: 429, error: `You can ask for up to ${DAILY_APPEALS} second looks a day.` };
  const [inserted] = await db
    .insert(schema.appeals)
    .values({ submissionId: p.submissionId, contributorId: row.c.id, programId: row.s.programId, note: p.note, decisionHash: latest.hash })
    .onConflictDoNothing({ target: schema.appeals.submissionId })
    .returning({ id: schema.appeals.id });
  if (!inserted) return { ok: false, status: 409, error: "You already asked for a second look at this one." };
  await audit(db, {
    programId: row.s.programId,
    actor: `user:${row.c.userId}`,
    action: "appeal.requested",
    entity: "submission",
    entityId: p.submissionId,
    data: { decisionHash: latest.hash, note: p.note },
  });
  return { ok: true };
}

/** Published programs that are taking contributors, newest first (the Contribute page lists them). */
export async function joinablePrograms(db: Db): Promise<Program[]> {
  return db
    .select()
    .from(schema.programs)
    .where(and(eq(schema.programs.status, "active"), eq(schema.programs.joiningPaused, false), isNull(schema.programs.endedAt)))
    .orderBy(desc(schema.programs.createdAt))
    .limit(30);
}
