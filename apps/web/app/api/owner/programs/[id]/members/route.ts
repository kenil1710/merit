// A program's members: the owner and the reviewers they added by Rialo wallet.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { isAddress } from "@/lib/server/agent";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { addReviewer, getMembership, listMembers } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await getOwnerSession();
  if (!session) return jsonError("sign_in_required", 401);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return jsonError("not_found", 404);
  const db = await getDb();
  if (!(await getMembership(db, id.data, session.sub))) return jsonError("not_found", 404);
  return NextResponse.json({ members: await listMembers(db, id.data) });
}

export async function POST(request: NextRequest, { params }: Params) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getOwnerSession();
  if (!session) return jsonError("Your session expired. Sign in again.", 401);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return jsonError("not_found", 404);
  const wallet = (await readJson(request) as { wallet?: unknown } | null)?.wallet;
  if (typeof wallet !== "string" || !isAddress(wallet)) return jsonError("Not a Rialo address.", 400);
  const result = await addReviewer(await getDb(), { programId: id.data, userId: session.sub, wallet });
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json({ userId: result.userId, role: "reviewer" }, { status: 201 });
}
