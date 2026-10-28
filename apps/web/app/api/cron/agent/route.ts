// Daily backstop for the agent (D4: no worker). Vercel Cron calls it once a day (06:00 UTC, vercel.json; Hobby allows
// no more): it retries up to 3 submissions still pending (X or the model was busy at submit time and the one
// in-request retry failed). One whose round has closed is refused by the rules and says so. It also deletes rows
// nothing reads again. Called with CRON_SECRET; refuses everyone else. Payouts never depend on it: the program's own
// timers settle every round.

import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { agentDeps } from "@/lib/server/agent-deps";
import { housekeeping } from "@/lib/server/housekeeping";
import { runAgent } from "@/lib/server/submissions";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse(null, { status: 401 });
  const db = await getDb();
  await housekeeping(db);
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
