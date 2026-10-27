// Publish a draft: only once the chain shows its campaign with the program's rules, funded (and round 1 open
// unless it is scheduled for later).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { loadState } from "@/lib/merit/chain";
import { rpc } from "@/lib/server/agent";
import { jsonError, sameOrigin } from "@/lib/server/http";
import { publishProgram } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getOwnerSession();
  if (!session) return jsonError("Your session expired. Sign in again.", 401);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return jsonError("not_found", 404);
  const result = await publishProgram(await getDb(), { programId: id.data, userId: session.sub, loadCampaign: (a) => loadState(rpc, a) });
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json({ ok: true });
}
