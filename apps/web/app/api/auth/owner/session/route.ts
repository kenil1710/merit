import { NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOwnerSession();
  return NextResponse.json(session ? { address: session.addr } : { address: null }, { headers: { "Cache-Control": "no-store" } });
}
