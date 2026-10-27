// Owner or reviewer: run the agent again on a submission (fresh fetch, current rules and brief). The new decision
// names the one it supersedes. Not once it's approved on chain (that needs the program's revoke, v2).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { reprocessSubmission } from "@/lib/agent/pipeline";
import { getDb, schema } from "@/lib/db";
import { agentDeps } from "@/lib/server/agent-deps";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { getMembership } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ reason: z.string().trim().min(3, "Say briefly why.").max(280) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getOwnerSession();
  if (!session) return jsonError("Your session expired. Sign in again.", 401);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return jsonError("not_found", 404);
  const body = Body.safeParse(await readJson(request));
  if (!body.success) return jsonError(body.error.issues[0]?.message ?? "Say briefly why.", 400);
  const db = await getDb();
  const [s] = await db.select({ programId: schema.submissions.programId }).from(schema.submissions).where(eq(schema.submissions.id, id.data)).limit(1);
  if (!s || !(await getMembership(db, s.programId, session.sub))) return jsonError("not_found", 404);
  const result = await reprocessSubmission(db, id.data, agentDeps(), { userId: session.sub, reason: body.data.reason });
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json({ status: result.result.status, rule: result.result.rule, summary: result.result.summary });
}
