import "server-only";

import { NextResponse, type NextRequest } from "next/server";

export const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** Browsers send Origin on every POST; a mismatch means another site is driving the request. */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return !!origin && origin === request.nextUrl.origin;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
