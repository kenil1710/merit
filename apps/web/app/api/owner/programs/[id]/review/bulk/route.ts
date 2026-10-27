// Bulk review: approve the selected submissions at the agent's recommended amounts, or reject them, with one reason.
// Each is its own signed decision; the answer says which went through.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { agentDeps } from "@/lib/server/agent-deps";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { bulkDecide } from "@/lib/server/review";
import { getOwnerSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  ids: z.array(z.uuid()).min(1).max(20),
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(10, "Write at least a sentence (10+ characters).").max(1000),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getOwnerSession();
  if (!session) return jsonError("Your session expired. Sign in again.", 401);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return jsonError("not_found", 404);
  const body = Body.safeParse(await readJson(request));
  if (!body.success) return jsonError(body.error.issues[0]?.message ?? "invalid_body", 400);
  const result = await bulkDecide(await getDb(), { programId: id.data, userId: session.sub, ...body.data, deps: agentDeps() });
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json(result);
}
