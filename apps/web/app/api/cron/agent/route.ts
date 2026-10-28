// Backstop for the agent (D4: no worker): submissions still pending a few minutes after they were sent (X or the
// model was busy) are processed again. Called by Vercel Cron with CRON_SECRET; refuses everyone else.

import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { agentDeps } from "@/lib/server/agent-deps";
import { pruneRateHits } from "@/lib/server/rate-limit";
import { runAgent } from "@/lib/server/submissions";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse(null, { status: 401 });
  const db = await getDb();
  await pruneRateHits(db);
  const stale = await db
    .select({ id: schema.submissions.id })
    .from(schema.submissions)
    .where(and(eq(schema.submissions.status, "pending"), lt(schema.submissions.createdAt, new Date(Date.now() - 2 * 60_000))))
    .orderBy(asc(schema.submissions.createdAt))
    .limit(3);
  const deps = agentDeps();
  const results = [];
  for (const { id } of stale) results.push({ id, ...(await runAgent(db, id, deps)) });
  return NextResponse.json({ processed: results.length, results });
}
