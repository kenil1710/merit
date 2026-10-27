// The signed-in owner's programs: list them, or save a new one as a draft.

import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { createProgram, listPrograms } from "@/lib/server/programs";
import { allow } from "@/lib/server/rate-limit";
import { getOwnerSession } from "@/lib/server/session";
import { ProgramInput } from "@/lib/shared/program";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOwnerSession();
  if (!session) return jsonError("sign_in_required", 401);
  return NextResponse.json({ programs: await listPrograms(await getDb(), session.sub) });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getOwnerSession();
  if (!session) return jsonError("Your session expired. Sign in again.", 401);
  if (!allow(`program-create:${session.sub}`, 20, 3_600_000)) return jsonError("That's a lot of new programs. Try again later.", 429);
  const parsed = ProgramInput.safeParse(await readJson(request));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return NextResponse.json({ error: "Some fields need attention.", fieldErrors }, { status: 400 });
  }
  const result = await createProgram(await getDb(), { ownerUserId: session.sub, ownerWallet: session.addr, input: parsed.data });
  if (!result.ok) {
    return NextResponse.json({ error: "That join link is taken. Pick another.", fieldErrors: { "basics.slug": "Already taken" } }, { status: 409 });
  }
  return NextResponse.json({ programId: result.programId, slug: result.slug }, { status: 201 });
}
