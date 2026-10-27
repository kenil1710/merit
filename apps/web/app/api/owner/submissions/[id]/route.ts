// Everything a reviewer needs for one submission: every decision (verified signatures), the content, the appeal,
// and the chain (REX proof, approval and payout). Members only; 404 for everyone else.

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { campaignView } from "@/lib/server/campaign-view";
import { jsonError } from "@/lib/server/http";
import { reviewDetail } from "@/lib/server/review";
import { getOwnerSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getOwnerSession();
  if (!session) return jsonError("sign_in_required", 401);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return jsonError("not_found", 404);
  const db = await getDb();
  const [row] = await db.select({ campaign: schema.programs.campaignAddress }).from(schema.submissions).innerJoin(schema.programs, eq(schema.programs.id, schema.submissions.programId)).where(eq(schema.submissions.id, id.data)).limit(1);
  const view = row?.campaign ? await campaignView(row.campaign).catch(() => null) : null;
  const detail = await reviewDetail(db, id.data, session.sub, view);
  if (!detail) return jsonError("not_found", 404);
  return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
}
