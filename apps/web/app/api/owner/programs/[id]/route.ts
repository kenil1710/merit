import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { jsonError } from "@/lib/server/http";
import { campaignConfig, getProgramForMember } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getOwnerSession();
  if (!session) return jsonError("sign_in_required", 401);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return jsonError("not_found", 404);
  const found = await getProgramForMember(await getDb(), id.data, session.sub);
  if (!found) return jsonError("not_found", 404);
  const { program, role, context } = found;
  return NextResponse.json(
    json({ program, role, context, config: program.agentAddress ? campaignConfig(program, program.agentAddress) : null }),
  );
}
