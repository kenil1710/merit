// "Ask for a second look" at a rejected decision. Once per submission; the owner answers with a decision of their own.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requestAppeal } from "@/lib/server/contributors";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { allow, ipKey, rule } from "@/lib/server/rate-limit";
import { getSession } from "@/lib/server/session";

export const runtime = "nodejs";

const Body = z.object({ note: z.string().trim().min(1, "Say briefly why.").max(280) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Sign in with X first.", 401);
  if (!(await allow(rule(`appeal:${session.xUserId}`, 3, 60_000), rule(`appeal-ip:${ipKey(request)}`, 20, 10 * 60_000)))) return jsonError("Too many requests at once. Wait a minute and try again.", 429);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return jsonError("not_found", 404);
  const body = Body.safeParse(await readJson(request));
  if (!body.success) return jsonError(body.error.issues[0]?.message ?? "Add a short note.", 400);
  const result = await requestAppeal(await getDb(), { xUserId: session.xUserId, submissionId: id.data, note: body.data.note });
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json({ ok: true }, { status: 201 });
}
