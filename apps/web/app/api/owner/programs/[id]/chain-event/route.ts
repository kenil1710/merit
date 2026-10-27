// After the owner signs a campaign transaction in the app (fund, withdraw, pause…), the browser hands its signature
// here; the server checks it on chain and records it in the audit log (heartbeats bury it in the chain's history).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { recordChainEvent } from "@/lib/server/program-pages";
import { getProgramForMember } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";

export const runtime = "nodejs";

const Body = z.object({ signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getOwnerSession();
  if (!session) return jsonError("Your session expired. Sign in again.", 401);
  const id = z.uuid().safeParse((await params).id);
  const body = Body.safeParse(await readJson(request));
  if (!id.success || !body.success) return jsonError("invalid_body", 400);
  const db = await getDb();
  const found = await getProgramForMember(db, id.data, session.sub);
  if (!found || found.role !== "owner") return jsonError("not_found", 404);
  const r = await recordChainEvent(db, { program: found.program, userId: session.sub, signature: body.data.signature });
  if (!r.ok) return jsonError(r.error, r.status);
  return NextResponse.json(r);
}
