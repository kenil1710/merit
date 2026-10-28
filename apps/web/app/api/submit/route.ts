// Retired. The v1 submit path skipped the agent's eligibility, rules, duplicate and injection checks, so it is gone:
// contributors join a program at /join/<slug> and submit there, and the agent is the only path to an approval.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function POST() {
  return NextResponse.json({ error: "This endpoint is retired. Join a program at /join and submit from its page." }, { status: 410 });
}
