// Links the signed-in X account to a Rialo wallet. The wallet proves
// ownership by signing a message that names both and is less than ten
// minutes old.

import { NextResponse, type NextRequest } from "next/server";
import { linkMessage, verifySignature } from "@/lib/merit/messages";
import { isAddress } from "@/lib/server/agent";
import { getSession } from "@/lib/server/session";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in with X first." }, { status: 401 });
  const { wallet, signature, issuedAt } = (await request.json()) as { wallet?: string; signature?: string; issuedAt?: string };
  if (!wallet || !isAddress(wallet) || !signature || !issuedAt) return NextResponse.json({ error: "Missing wallet, signature or time." }, { status: 400 });
  const age = Date.now() - Date.parse(issuedAt);
  if (!(age >= -60_000 && age < 600_000)) return NextResponse.json({ error: "Signature is too old. Sign again." }, { status: 400 });
  const message = linkMessage(session.xUserId, session.username, wallet, issuedAt);
  if (!verifySignature(message, signature, wallet)) return NextResponse.json({ error: "Wallet signature does not verify." }, { status: 400 });
  await store.saveLink({ xUserId: session.xUserId, username: session.username, wallet, message, signature, linkedAt: new Date().toISOString() });
  return NextResponse.json({ wallet });
}
