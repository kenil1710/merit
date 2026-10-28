// Retired with /api/submit. A payout wallet is named, and signed for, when a contributor joins a program.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function POST() {
  return NextResponse.json({ error: "This endpoint is retired. Your wallet is set when you join a program at /join." }, { status: 410 });
}
