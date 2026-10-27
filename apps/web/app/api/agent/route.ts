import { NextResponse } from "next/server";
import { agentAddress } from "@/lib/server/agent";
import { configured, env } from "@/lib/server/env";

export const runtime = "nodejs";

export function GET() {
  const ready = configured(env.agentSecret);
  if (!ready.ok) return NextResponse.json({ error: ready.missing }, { status: 503 });
  return NextResponse.json({ agent: agentAddress() });
}
