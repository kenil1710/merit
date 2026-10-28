// Campaigns owned by a wallet, with their slug (needed to sign owner
// instructions; it is public and grants nothing without the owner's key).

import { NextResponse, type NextRequest } from "next/server";
import { listCampaigns } from "@/lib/merit/chain";
import { verificationsLeft } from "@/lib/merit/constants";
import { isAddress, rpc } from "@/lib/server/agent";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const owner = request.nextUrl.searchParams.get("wallet") ?? "";
  if (!isAddress(owner)) return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  const [all, metas] = await Promise.all([listCampaigns(rpc), store.campaigns()]);
  const byAddress = new Map(metas.map((m) => [m.address, m]));
  const ledgerRent = await rpc.call<number>("getMinimumBalanceForRentExemption", [{ data_length: 3_400 }]).catch(() => 24_067_680);
  const campaigns = all
    .filter((c) => c.owner === owner)
    .map((c) => ({
      address: c.address,
      name: byAddress.get(c.address)?.name ?? null,
      slug: byAddress.get(c.address)?.slug ?? null,
      phase: Number(c.phase),
      ending: c.ending,
      round: Number(c.round),
      roundStartMs: Number(c.roundStartMs),
      roundEndMs: Number(c.roundEndMs),
      refundDeadlineMs: Number(c.refundDeadlineMs),
      roundLengthMs: Number(c.roundLengthMs),
      nextRoundLengthMs: Number(c.nextRoundLengthMs),
      escrow: c.escrowKelvin.toString(),
      ops: c.opsBudgetKelvin.toString(),
      paid: c.totalPaid.toString(),
      capPerRound: c.capPerRound.toString(),
      agent: c.agent,
      // Each round with approvals costs one ledger's rent plus 0.012 RLO per verification.
      verificationsLeft: verificationsLeft(c.opsBudgetKelvin, BigInt(ledgerRent)),
    }));
  return NextResponse.json({ campaigns });
}
