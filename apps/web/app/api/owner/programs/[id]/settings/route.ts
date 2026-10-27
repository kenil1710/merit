// The owner edits the off-chain settings: the join page (name, description, joining paused) and the submission rules.
// On-chain settings (round length, limits, end) are signed in the browser instead.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { updateSettings } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";

export const runtime = "nodejs";

const SettingsBody = z
  .object({
    name: z.string().trim().min(3).max(60),
    description: z.string().trim().min(10).max(500),
    joiningPaused: z.boolean(),
    minAccountAgeDays: z.number().int().min(0).max(3650),
    minXFollowers: z.number().int().min(0).max(1_000_000),
    belowMinimum: z.enum(["review", "reject", "block"]),
    maxSubmissionsPerRound: z.number().int().min(1).max(50),
  })
  .partial();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getOwnerSession();
  if (!session) return jsonError("Your session expired. Sign in again.", 401);
  const id = z.uuid().safeParse((await params).id);
  const body = SettingsBody.safeParse(await readJson(request));
  if (!id.success) return jsonError("not_found", 404);
  if (!body.success) return jsonError(body.error.issues[0]?.message ?? "invalid_body", 400);
  const r = await updateSettings(await getDb(), { programId: id.data, userId: session.sub, changes: body.data });
  if (!r.ok) return jsonError(r.error, r.status);
  return NextResponse.json({ ok: true });
}
