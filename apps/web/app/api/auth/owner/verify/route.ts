// Owner sign-in, step 2: check the signed message and start an owner session.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { audit, getDb } from "@/lib/db";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { consumeNonce } from "@/lib/server/nonces";
import { verifyOwnerSignIn } from "@/lib/server/owner-auth";
import { upsertWalletUser } from "@/lib/server/programs";
import { allow, ipKey, rule } from "@/lib/server/rate-limit";
import { setOwnerSession } from "@/lib/server/session";

export const runtime = "nodejs";

const Body = z.object({
  message: z.string().min(1).max(2000),
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
});

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  if (!(await allow(rule(`owner-verify:${ipKey(request)}`, 20, 60_000), rule(`owner-verify-day:${ipKey(request)}`, 100, 86_400_000)))) return jsonError("Too many sign-in attempts. Wait a minute and try again.", 429);
  const body = Body.safeParse(await readJson(request));
  if (!body.success) return jsonError("invalid_body", 400);
  const db = await getDb();
  const result = await verifyOwnerSignIn({
    message: body.data.message,
    signature: body.data.signature,
    expectedOrigin: request.nextUrl.origin,
    consumeNonce: (nonce, address) => consumeNonce(db, nonce, "owner_signin", address),
  });
  if (!result.ok) return jsonError(result.error, 401);
  const user = await upsertWalletUser(db, result.address);
  await audit(db, { actor: `user:${user.id}`, action: "owner.signed_in", entity: "user", entityId: user.id, data: { address: result.address } });
  await setOwnerSession(user.id, result.address);
  return NextResponse.json({ ok: true, address: result.address });
}
