// Finishes "Sign in with X": exchanges the code, reads the signed-in user's
// own id, handle, account age and followers once (programs' minimums are
// checked against them), and keeps only the id and handle in a signed cookie.

import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { upsertXUser } from "@/lib/server/contributors";
import { env } from "@/lib/server/env";
import { setSession, takeOAuthState } from "@/lib/server/session";

export const runtime = "nodejs";

function fail(request: NextRequest, message: string, returnTo = "/join") {
  const url = new URL(returnTo, request.nextUrl.origin);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const saved = await takeOAuthState();
  if (!saved || !params.get("state") || params.get("state") !== saved.state) return fail(request, "Sign-in expired or was tampered with. Try again.");
  if (params.get("error")) return fail(request, "X sign-in was cancelled.", saved.returnTo);
  const code = params.get("code");
  if (!code) return fail(request, "X did not return a code.", saved.returnTo);

  const token = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic " + Buffer.from(`${env.xClientId()}:${env.xClientSecret()}`).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${env.publicUrl()}/api/auth/x/callback`,
      code_verifier: saved.verifier,
    }),
  });
  if (!token.ok) return fail(request, "X rejected the sign-in.", saved.returnTo);
  const { access_token: accessToken } = (await token.json()) as { access_token?: string };
  if (!accessToken) return fail(request, "X returned no access token.", saved.returnTo);

  const me = await fetch("https://api.x.com/2/users/me?user.fields=created_at,public_metrics", { headers: { authorization: `Bearer ${accessToken}` } });
  type Me = { id?: string; username?: string; created_at?: string; public_metrics?: { followers_count?: number } };
  const user = ((await me.json()) as { data?: Me }).data;
  if (!me.ok || !user?.id || !user.username) return fail(request, "Could not read your X account.", saved.returnTo);

  const created = user.created_at ? new Date(user.created_at) : null;
  await upsertXUser(await getDb(), {
    xUserId: user.id,
    handle: user.username,
    createdAt: created && !Number.isNaN(created.getTime()) ? created : null,
    followers: user.public_metrics?.followers_count ?? null,
  });
  await setSession(user.id, user.username);
  return NextResponse.redirect(new URL(saved.returnTo, request.nextUrl.origin));
}
