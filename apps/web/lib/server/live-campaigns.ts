import "server-only";

import { RpcClient, listCampaigns } from "@/lib/merit/chain";
import { RPC_UPSTREAM } from "@/lib/merit/constants";
import type { MeritState } from "@/lib/merit/state";
import { roundStatus, type RoundStatus } from "@/lib/shared/round-window";
import { store, type CampaignMeta } from "./store";

export type NamedCampaign = { state: MeritState; meta: CampaignMeta; status: RoundStatus };

/**
 * Every campaign with a published name, read live from the program's accounts, with its round status. /join and
 * Explore both list from here, so they agree on which rounds are open and when the next one opens.
 */
export async function namedCampaigns(now = Date.now()): Promise<{ campaigns: NamedCampaign[]; unnamed: number }> {
  const [onChain, metas] = await Promise.all([listCampaigns(new RpcClient(RPC_UPSTREAM)), store.campaigns()]);
  const named = new Map(metas.map((m) => [m.address, m]));
  const campaigns = onChain
    .filter((c) => named.has(c.address))
    .map((state) => ({ state, meta: named.get(state.address)!, status: roundStatus(state, now) }))
    .sort((a, b) => rank(a.status) - rank(b.status) || Number(b.state.roundStartMs - a.state.roundStartMs));
  return { campaigns, unnamed: onChain.length - campaigns.length };
}

const ORDER = ["open", "closing", "paying", "awaiting_owner", "waiting_funds", "paused", "idle", "ended"];
const rank = (s: RoundStatus) => ORDER.indexOf(s.state);
