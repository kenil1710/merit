// Asked by merit-x's custom_code filter, through the merit-check latch, before an X post read goes through:
// "is every one of these post ids a pending or recent Merit submission?" The merit-check latch injects
// x-merit-check-key; nobody else holds it. The answer is plain text so the policy needs no JSON parser: exactly
// "MERIT-OK <ids>" means yes, anything else means no (the policy fails closed).

import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { checkKeyMatches, knownPosts, parseIds } from "@/lib/server/tweet-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (body: string, status: number) => new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(request: NextRequest, { params }: { params: Promise<{ ids: string }> }) {
  if (!process.env.MERIT_CHECK_KEY?.trim()) return text("MERIT-NO not configured", 503);
  if (!checkKeyMatches(request.headers.get("x-merit-check-key"), process.env.MERIT_CHECK_KEY.trim())) return text("MERIT-NO unauthorized", 401);
  const ids = parseIds((await params).ids);
  if (!ids) return text("MERIT-NO bad ids", 400);
  const known = await knownPosts(await getDb(), ids);
  const missing = ids.filter((id) => !known.has(id));
  return missing.length ? text(`MERIT-NO ${missing.join(",")}`, 404) : text(`MERIT-OK ${ids.join(",")}`, 200);
}
