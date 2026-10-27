import "server-only";

import { and, count, eq, gte, ne } from "drizzle-orm";
import { processSubmission, RetryableError, type PipelineDeps, type ProcessResult } from "@/lib/agent/pipeline";
import { audit, schema, type Db } from "@/lib/db";
import { PHASE_NAMES } from "@/lib/merit/constants";
import { approvableRound, effectiveGraceMs, lateMessage, postTimeFromId } from "@/lib/shared/round-window";
import type { Contributor } from "./contributors";
import type { Program } from "./programs";

/**
 * A contributor submits a link. Refused up front when it can't be judged at all (not a member, no open round, not an X
 * post link, already submitted, over the per-round limit); otherwise saved as pending and handed to the agent
 * (lib/agent/pipeline.ts), which checks, judges, decides and approves on chain. If X or the model is busy the
 * submission stays pending and is retried.
 */

/// Leave time for the approval and its REX check to land before the round closes.
const CLOSING_MARGIN_MS = 20_000;

export type SubmitResult =
  | { ok: true; submissionId: string; status: ProcessResult["status"] | "pending"; summary: string; score: number | null }
  | { ok: false; status: number; error: string };

export function postIdFrom(url: string): string | null {
  const match = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/(\d{1,20})(?:[/?#].*)?$/.exec(url.trim());
  return match?.[1] ?? null;
}

const refuse = (status: number, error: string): SubmitResult => ({ ok: false, status, error });

export async function submitWork(
  db: Db,
  p: { program: Program; contributor: Contributor; url: string; deps: PipelineDeps; agentAddress: string; now?: number },
): Promise<SubmitResult> {
  const { program, contributor, deps } = p;
  const now = p.now ?? Date.now();
  if (contributor.status !== "active") return refuse(403, "You can't submit to this program.");
  if (!contributor.walletAddress) return refuse(409, "Link your payout wallet first.");
  if (program.endedAt || program.status !== "active" || !program.campaignAddress) return refuse(409, "This program isn't taking submissions right now.");
  const postId = postIdFrom(p.url);
  if (!postId) return refuse(400, "That is not an X post link (x.com/<handle>/status/<id>).");

  const campaign = await deps.loadCampaign(program.campaignAddress);
  if (!campaign) return refuse(409, "This program isn't taking submissions right now.");
  const live = approvableRound(campaign, now);
  if (!live) {
    if (campaign.phase === 2n || campaign.phase === 3n) {
      return refuse(409, `Round ${campaign.round} has closed and is paying out; round ${campaign.round + 1n} opens right after. Submit then.`);
    }
    return refuse(409, `This program isn't taking submissions right now (${campaign.paused ? "paused by its team" : PHASE_NAMES[String(campaign.phase)]}).`);
  }
  const late = lateMessage(campaign, postTimeFromId(postId), now);
  if (late) return refuse(409, late);
  const closesAt = Number(campaign.roundEndMs) + (live.inGrace ? effectiveGraceMs(campaign) : 0);
  if (now > closesAt - CLOSING_MARGIN_MS) {
    return refuse(409, live.inGrace ? "Late work for this round is no longer taken. Submit new work in the next round." : "This round closes in under 20 seconds. Submit in the next round.");
  }
  if (campaign.agent !== p.agentAddress) return refuse(503, "This program's agent isn't the one this server runs.");

  const [dupe] = await db
    .select({ id: schema.submissions.id })
    .from(schema.submissions)
    .where(and(eq(schema.submissions.contributorId, contributor.id), eq(schema.submissions.resourceId, postId), ne(schema.submissions.status, "rejected")))
    .limit(1);
  if (dupe) return refuse(409, "You already submitted this post.");
  const [mine] = await db
    .select({ n: count() })
    .from(schema.submissions)
    .where(and(eq(schema.submissions.contributorId, contributor.id), gte(schema.submissions.createdAt, live.startsAt)));
  if (Number(mine?.n ?? 0) >= program.maxSubmissionsPerRound) {
    return refuse(429, `You've submitted ${program.maxSubmissionsPerRound} this round, the most this program takes. Submit again next round.`);
  }

  // The round it was submitted in, so it counts there whatever the agent decides (on-chain entries only cover approvals).
  const roundTimes = { startsAt: live.startsAt, endsAt: live.endsAt };
  const [round] = await db
    .insert(schema.rounds)
    .values({ programId: program.id, number: live.number, ...roundTimes })
    .onConflictDoUpdate({ target: [schema.rounds.programId, schema.rounds.number], set: roundTimes })
    .returning({ id: schema.rounds.id });
  const [submission] = await db
    .insert(schema.submissions)
    .values({ programId: program.id, roundId: round!.id, contributorId: contributor.id, url: p.url.trim(), sourceType: "x_post", resourceId: postId, status: "pending" })
    .returning({ id: schema.submissions.id });
  await audit(db, { programId: program.id, actor: `user:${contributor.userId}`, action: "submission.created", entity: "submission", entityId: submission!.id, data: { postId } });
  return runAgent(db, submission!.id, deps);
}

/** Run the agent once; a transient failure leaves the submission pending with the reason. */
export async function runAgent(db: Db, submissionId: string, deps: PipelineDeps): Promise<SubmitResult> {
  try {
    const r = await processSubmission(db, submissionId, deps);
    return { ok: true, submissionId, status: r.status, summary: r.summary, score: r.score };
  } catch (e) {
    const message = (e as Error).message;
    await db.update(schema.submissions).set({ lastError: message.slice(0, 500) }).where(eq(schema.submissions.id, submissionId));
    if (e instanceof RetryableError) return { ok: true, submissionId, status: "pending", summary: `Waiting to be reviewed: ${message} It's retried automatically.`, score: null };
    return { ok: true, submissionId, status: "pending", summary: `Waiting for the team: ${message}`, score: null };
  }
}
