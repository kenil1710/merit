// Suspend or reinstate a contributor (owner only, with a reason): the agent stops approving a suspended one.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { setContributorStatus } from "@/lib/server/program-pages";
import { getMembership } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";

export const runtime = "nodejs";

const Body = z.object({ status: z.enum(["active", "suspended"]), reason: z.string().trim().min(10).max(500) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; cid: string }> }) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getOwnerSession();
  if (!session) return jsonError("Your session expired. Sign in again.", 401);
  const { id, cid } = await params;
  const body = Body.safeParse(await readJson(request));
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(cid).success) return jsonError("not_found", 404);
  if (!body.success) return jsonError("Give a reason of at least 10 characters.", 400);
  const db = await getDb();
  if ((await getMembership(db, id, session.sub)) !== "owner") return jsonError("Only the owner can change a contributor's status.", 403);
  if (!(await setContributorStatus(db, { programId: id, contributorId: cid, userId: session.sub, ...body.data }))) return jsonError("not_found", 404);
  return NextResponse.json({ ok: true, status: body.data.status });
}
