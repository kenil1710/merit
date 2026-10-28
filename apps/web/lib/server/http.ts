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

/**
 * Where to send the user after sign-in: only a path on this site. The path is resolved against our origin and kept
 * only if the result is still our origin, so `/\evil.example`, `//evil.example`, `https:…` and control characters
 * all fall back.
 */
export function safeReturnTo(raw: string | null | undefined, origin: string, fallback = "/join"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const base = new URL(origin);
    const url = new URL(raw, base);
    return url.origin === base.origin ? url.pathname + url.search + url.hash : fallback;
  } catch {
    return fallback;
  }
}
