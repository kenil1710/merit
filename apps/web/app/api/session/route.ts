import { NextResponse } from "next/server";
import { configured, env } from "@/lib/server/env";
import { getSession } from "@/lib/server/session";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET() {
  const xReady = configured(env.xClientId, env.xClientSecret, env.publicUrl, env.sessionSecret);
  const session = xReady.ok ? await getSession() : null;
  const link = session ? await store.link(session.xUserId) : null;
  return NextResponse.json({
    signInAvailable: xReady.ok,
    signInMissing: xReady.ok ? null : xReady.missing,
    session: session ? { xUserId: session.xUserId, username: session.username } : null,
    wallet: link?.wallet ?? null,
  });
}
