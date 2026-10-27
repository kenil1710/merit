// A person's decision on one submission: approve at an amount (on chain at the score it buys) or reject, with a
// reason. Signed, superseding the previous decision, logged in the audit log.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { agentDeps } from "@/lib/server/agent-deps";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { allow } from "@/lib/server/rate-limit";
import { decideByHuman } from "@/lib/server/review";
import { getOwnerSession } from "@/lib/server/session";
import { RloInput } from "@/lib/shared/program";

export const runtime = "nodejs";
export const maxDuration = 60;

const reason = z.string().trim().min(10, "Write at least a sentence (10+ characters).").max(1000);
const Body = z.discriminatedUnion("action", [z.object({ action: z.literal("approve"), amount: RloInput, reason }), z.object({ action: z.literal("reject"), reason })]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getOwnerSession();
  if (!session) return jsonError("Your session expired. Sign in again.", 401);
  if (!allow(`decide:${session.sub}`, 30, 60_000)) return jsonError("Too many decisions at once. Wait a minute.", 429);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return jsonError("not_found", 404);
  const body = Body.safeParse(await readJson(request));
  if (!body.success) return jsonError(body.error.issues[0]?.message ?? "invalid_body", 400);
  const result = await decideByHuman(await getDb(), { submissionId: id.data, userId: session.sub, decision: body.data, deps: agentDeps() });
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json(result);
}
