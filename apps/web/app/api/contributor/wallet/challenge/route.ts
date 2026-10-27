// Joining, step 1: a single-use nonce bound to the signed-in X account, and the exact message the wallet signs.

import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { joinMessage } from "@/lib/merit/messages";
import { isAddress } from "@/lib/server/agent";
import { publicProgram } from "@/lib/server/contributors";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { issueNonce } from "@/lib/server/nonces";
import { allow } from "@/lib/server/rate-limit";
import { getSession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Sign in with X first.", 401);
  if (!allow(`wallet-challenge:${session.xUserId}`, 20, 60_000)) return jsonError("Too many attempts. Wait a minute and try again.", 429);
  const body = (await readJson(request)) as { slug?: unknown; wallet?: unknown } | null;
  if (typeof body?.wallet !== "string" || !isAddress(body.wallet)) return jsonError("Not a Rialo address.", 400);
  const db = await getDb();
  const program = typeof body.slug === "string" ? await publicProgram(db, body.slug) : null;
  if (!program) return jsonError("not_found", 404);
  const { nonce } = await issueNonce(db, "wallet_link", session.xUserId);
  const message = joinMessage({ program: program.slug, xUserId: session.xUserId, username: session.username, wallet: body.wallet, nonce });
  return NextResponse.json({ nonce, message }, { headers: { "Cache-Control": "no-store" } });
}
