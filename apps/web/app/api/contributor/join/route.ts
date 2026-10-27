// Joining, step 2: the wallet's signature over the join message proves it; the program's minimums decide whether
// this X account may join at all.

import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { joinMessage, verifySignature } from "@/lib/merit/messages";
import { loadState } from "@/lib/merit/chain";
import { ensurePayee, isAddress, rpc } from "@/lib/server/agent";
import { audit } from "@/lib/db";
import { joinProgram, publicProgram } from "@/lib/server/contributors";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { consumeNonce } from "@/lib/server/nonces";
import { getSession } from "@/lib/server/session";

export const runtime = "nodejs";

const Body = z.object({
  slug: z.string().max(60),
  wallet: z.string().refine(isAddress, "Not a Rialo address."),
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
});

/** `after()`, or nothing outside a request (unit tests): the agent registers the payee before approving anyway. */
function afterResponse(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    /* no request scope */
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Sign in with X first.", 401);
  const body = Body.safeParse(await readJson(request));
  if (!body.success) return jsonError("invalid_body", 400);
  const { slug, wallet, nonce, signature } = body.data;
  const db = await getDb();
  const program = await publicProgram(db, slug);
  if (!program) return jsonError("not_found", 404);
  const message = joinMessage({ program: program.slug, xUserId: session.xUserId, username: session.username, wallet, nonce });
  if (!verifySignature(message, signature, wallet)) return jsonError("The wallet signature doesn't verify.", 400);
  if (!(await consumeNonce(db, nonce, "wallet_link", session.xUserId))) return jsonError("That signature was already used or expired. Sign again.", 401);
  const result = await joinProgram(db, { program, xUserId: session.xUserId, wallet, message, signature });
  if (!result.ok) return jsonError(result.error, result.status);
  // Program v2: register the payee on chain now, so the new-wallet cooldown runs from joining, not the first approval.
  const campaignAddress = program.campaignAddress;
  if (campaignAddress) {
    afterResponse(async () => {
      try {
        const campaign = await loadState(rpc, campaignAddress);
        if (!campaign || campaign.version < 2 || campaign.cooldownMs === 0n) return;
        const r = await ensurePayee(campaign, BigInt(session.xUserId), wallet);
        if (r.signature) await audit(db, { programId: program.id, actor: "agent", action: "payee.registered", entity: "contributor", entityId: result.contributor.id, data: { wallet, payee: r.payee }, signature: r.signature });
      } catch {
        // Best effort: the agent registers it again before the first approval.
      }
    });
  }
  return NextResponse.json({ contributorId: result.contributor.id }, { status: 201 });
}
