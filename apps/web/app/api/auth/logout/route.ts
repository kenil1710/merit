import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/server/http";
import { clearSession } from "@/lib/server/session";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  await clearSession();
  return NextResponse.redirect(new URL("/join", request.nextUrl.origin), 303);
}
