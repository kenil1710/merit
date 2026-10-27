import { NextResponse, type NextRequest } from "next/server";
import { jsonError, sameOrigin } from "@/lib/server/http";
import { clearOwnerSession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  await clearOwnerSession();
  return NextResponse.json({ ok: true });
}
