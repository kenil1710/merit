// Before the owner signs create_campaign: record the campaign address (owner wallet + a fresh slug) and hand back
// the exact config to sign, computed here from the saved program, so publish can check the chain against it.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { loadState } from "@/lib/merit/chain";
import { agentAddress, rpc } from "@/lib/server/agent";
import { configured, env } from "@/lib/server/env";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { campaignConfig, campaignLimits, getProgramForMember, recordCampaign } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getOwnerSession();
  if (!session) return jsonError("Your session expired. Sign in again.", 401);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return jsonError("not_found", 404);
  const ready = configured(env.agentSecret);
  if (!ready.ok) return jsonError(`The server's agent key is not configured (${ready.missing}).`, 503);
  const slugHex = (await readJson(request) as { slugHex?: unknown } | null)?.slugHex;
  if (typeof slugHex !== "string") return jsonError("Missing campaign slug.", 400);
  const db = await getDb();
  const result = await recordCampaign(db, {
    programId: id.data,
    userId: session.sub,
    slugHex,
    agent: agentAddress(),
    loadCampaign: (a) => loadState(rpc, a),
  });
  if (!result.ok) return jsonError(result.error, result.status);
  const { program } = (await getProgramForMember(db, id.data, session.sub))!;
  const c = campaignConfig(program, program.agentAddress!);
  return NextResponse.json({
    campaignAddress: result.campaignAddress,
    slugHex: program.campaignSlugHex,
    config: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.toString()])),
    limits: Object.fromEntries(Object.entries(campaignLimits(program)).map(([k, v]) => [k, v.toString()])),
  });
}
