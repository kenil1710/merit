import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb, schema, type Db } from "@/lib/db";
import type { StoredJudgement } from "@/lib/merit/judgement";

/** What Merit's database knows about one approved post besides its judge record. */
export type ApprovalFacts = { judgement: StoredJudgement; submissionStatus: string };

/**
 * An approved post's judge record, rebuilt from the decision whose hash the ledger entry carries on chain. The pipeline
 * saves this record after approving; when that save was lost (the Blob store was blocked on 2026-10-27, before the
 * move to Neon went live), the public record rebuilds it from here. Decision hashes are unique, so the chain's hash
 * picks exactly the decision that was approved, even when a submission was reprocessed and has more than one.
 */
export async function approvalFromDecision(db: Db, submissionHash: string): Promise<ApprovalFacts | null> {
  const d = schema.decisions;
  const s = schema.submissions;
  const [row] = await db
    .select({
      resourceId: s.resourceId,
      sourceType: s.sourceType,
      status: s.status,
      approveSignature: s.approveSignature,
      campaignAddress: schema.programs.campaignAddress,
      wallet: schema.contributors.walletAddress,
      xHandle: schema.contributors.xHandle,
      decisionJson: d.decisionJson,
      decisionHash: d.decisionHash,
      createdAt: d.createdAt,
    })
    .from(d)
    .innerJoin(s, eq(s.id, d.submissionId))
    .innerJoin(schema.programs, eq(schema.programs.id, s.programId))
    .innerJoin(schema.contributors, eq(schema.contributors.id, s.contributorId))
    .where(eq(d.decisionHash, submissionHash))
    .limit(1);
  if (!row) return null;
  const [resource] = await db
    .select({ text: schema.fetchedResources.contentText })
    .from(schema.fetchedResources)
    .where(and(eq(schema.fetchedResources.sourceType, row.sourceType), eq(schema.fetchedResources.resourceId, row.resourceId)))
    .limit(1);
  let record: { campaign?: string; round?: { number?: number } } = {};
  try {
    record = JSON.parse(row.decisionJson);
  } catch {
    /* not JSON: the campaign comes from the program row */
  }
  return {
    submissionStatus: row.status,
    judgement: {
      // The signed record names the campaign it was approved on (a program row can be re-pointed to a newer one).
      campaign: record.campaign ?? row.campaignAddress ?? "",
      round: record.round?.number ?? 0,
      outcome: "approved",
      contributor: row.wallet ?? undefined,
      xUsername: row.xHandle,
      approveSignature: row.approveSignature ?? undefined,
      canonical: row.decisionJson,
      submissionHash: row.decisionHash,
      text: resource?.text ?? "",
      judgedAt: new Date(row.createdAt).toISOString(),
    },
  };
}

/** Same, opening the database itself; null when it isn't reachable (the record then shows the chain alone). */
export async function approvalFacts(submissionHash: string): Promise<ApprovalFacts | null> {
  try {
    return await approvalFromDecision(await getDb(), submissionHash);
  } catch {
    return null;
  }
}
