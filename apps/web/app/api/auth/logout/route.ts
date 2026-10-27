import { NextResponse, type NextRequest } from "next/server";
import { clearSession } from "@/lib/server/session";

export async function POST(request: NextRequest) {
  await clearSession();
  return NextResponse.redirect(new URL("/join", request.nextUrl.origin), 303);
}
