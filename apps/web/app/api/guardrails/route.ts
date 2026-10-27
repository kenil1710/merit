// Live view of Merit's Latch latches, read with their own lat_ tokens from
// /.well-known/latch-self. Tokens never leave the server.

import { NextResponse } from "next/server";
import { configured, env } from "@/lib/server/env";
import { latchSelf } from "@/lib/server/latch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const latches = await Promise.all(
    [
      { name: "merit-judge", purpose: "Claude scoring (Anthropic)", token: env.judgeLat },
      { name: "merit-x", purpose: "X post and user reads (judge and REX validators)", token: env.xLat },
    ].map(async ({ name, purpose, token }) => {
      const ready = configured(token);
      if (!ready.ok) return { name, purpose, error: ready.missing };
      return { name, purpose, ...(await latchSelf(token())) };
    }),
  );
  return NextResponse.json({ readAt: new Date().toISOString(), latches });
}
