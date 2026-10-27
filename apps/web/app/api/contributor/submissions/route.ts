// A contributor submits a link for a program they joined. See lib/server/submissions.ts and lib/agent/pipeline.ts.

import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { agentAddress } from "@/lib/server/agent";
import { agentDeps } from "@/lib/server/agent-deps";
import { membership, publicProgram } from "@/lib/server/contributors";
import { ConfigError } from "@/lib/server/env";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { LatchDenied } from "@/lib/server/latch";
import { allow } from "@/lib/server/rate-limit";
import { getSession } from "@/lib/server/session";
import { runAgent, submitWork } from "@/lib/server/submissions";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ programSlug: z.string().max(60), url: z.string().trim().min(1).max(500) });

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Sign in with X first.", 401);
  if (!allow(`submit:${session.xUserId}`, 6, 60_000)) return jsonError("Too many submissions at once. Wait a minute.", 429);
  const body = Body.safeParse(await readJson(request));
  if (!body.success) return jsonError("Paste a link to your post.", 400);
  const db = await getDb();
  const program = await publicProgram(db, body.data.programSlug);
  if (!program) return jsonError("not_found", 404);
  const contributor = await membership(db, program.id, session.xUserId);
  if (!contributor) return jsonError("Join this program first.", 403);
  try {
    const deps = agentDeps();
    const result = await submitWork(db, { program, contributor, url: body.data.url, deps, agentAddress: agentAddress() });
    if (!result.ok) return jsonError(result.error, result.status);
    // X or the model was busy: one more try once the response is sent (the cron backstop picks up the rest).
    if (result.status === "pending") after(() => new Promise((r) => setTimeout(r, 5_000)).then(() => runAgent(db, result.submissionId, deps)));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof LatchDenied) return jsonError(error.message, 502);
    if (error instanceof ConfigError) return jsonError(`Server not configured: ${error.message}`, 503);
    return jsonError((error as Error).message, 500);
  }
}
