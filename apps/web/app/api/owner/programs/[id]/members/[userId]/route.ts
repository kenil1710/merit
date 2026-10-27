import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { jsonError, sameOrigin } from "@/lib/server/http";
import { removeReviewer } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getOwnerSession();
  if (!session) return jsonError("Your session expired. Sign in again.", 401);
  const p = await params;
  const ids = z.object({ id: z.uuid(), userId: z.uuid() }).safeParse(p);
  if (!ids.success) return jsonError("not_found", 404);
  const result = await removeReviewer(await getDb(), { programId: ids.data.id, userId: session.sub, memberUserId: ids.data.userId });
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json({ ok: true });
}
