// Where a program stands on its way live, read from the chain each time (the go-live stepper polls this).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { setupCurrent, setupSteps } from "@/lib/setup-flow";
import { jsonError } from "@/lib/server/http";
import { programSummary } from "@/lib/server/program-summary";
import { getProgramForMember } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getOwnerSession();
  if (!session) return jsonError("sign_in_required", 401);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return jsonError("not_found", 404);
  const found = await getProgramForMember(await getDb(), id.data, session.sub);
  if (!found) return jsonError("not_found", 404);
  const s = await programSummary(found.program);
  return NextResponse.json(
    {
      role: found.role,
      campaignAddress: s.program.campaignAddress,
      slugHex: s.program.campaignSlugHex,
      setup: s.setup,
      current: setupCurrent(s.setup),
      steps: setupSteps(s.setup),
      chainError: s.chainError,
      totalFunded: s.state?.totalFunded.toString() ?? "0",
      totalOpsFunded: s.state?.totalOpsFunded.toString() ?? "0",
      escrow: s.state?.escrowKelvin.toString() ?? "0",
      opsBudget: s.state?.opsBudgetKelvin.toString() ?? "0",
      roundPill: s.roundPill,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
