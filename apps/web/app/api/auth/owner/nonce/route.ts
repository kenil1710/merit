// Owner sign-in, step 1: a single-use nonce bound to the wallet that will sign it.

import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { isAddress } from "@/lib/server/agent";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { issueNonce } from "@/lib/server/nonces";
import { allow, ipKey, rule } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  // Each nonce is a database row: keep anonymous callers from filling the table.
  if (!(await allow(rule(`owner-nonce:${ipKey(request)}`, 20, 60_000)))) return jsonError("Too many sign-in attempts. Wait a minute and try again.", 429);
  const address = (await readJson(request) as { address?: unknown } | null)?.address;
  if (typeof address !== "string" || !isAddress(address)) return jsonError("Not a Rialo address.", 400);
  const { nonce } = await issueNonce(await getDb(), "owner_signin", address);
  return NextResponse.json({ nonce, domain: request.nextUrl.host, uri: request.nextUrl.origin }, { headers: { "Cache-Control": "no-store" } });
}
