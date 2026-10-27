// Starts "Sign in with X" (OAuth 2.0 authorization code + PKCE).

import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { configured, env } from "@/lib/server/env";
import { setOAuthState } from "@/lib/server/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ready = configured(env.xClientId, env.xClientSecret, env.publicUrl, env.sessionSecret);
  if (!ready.ok) return NextResponse.json({ error: `X sign-in is not configured: ${ready.missing}` }, { status: 503 });
  const returnTo = request.nextUrl.searchParams.get("returnTo") ?? "/join";
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  await setOAuthState({ state, verifier, returnTo: returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/join" });
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: env.xClientId(),
    redirect_uri: `${env.publicUrl()}/api/auth/x/callback`,
    scope: "users.read tweet.read",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return NextResponse.redirect(url);
}
