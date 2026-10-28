import "server-only";

import { isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
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
  const [onChain, metas, labels] = await Promise.all([listCampaigns(new RpcClient(RPC_UPSTREAM)), store.campaigns(), campaignLabels()]);
  const named = new Map(metas.map((m) => [m.address, m]));
  const campaigns = onChain
    .filter((c) => named.has(c.address) && !labels.test.has(c.address))
    .map((state) => ({ state, meta: named.get(state.address)!, status: roundStatus(state, now) }))
    .sort((a, b) => rank(a.status) - rank(b.status) || Number(b.state.roundStartMs - a.state.roundStartMs));
  return { campaigns, unnamed: onChain.length - campaigns.length };
}

const ORDER = ["open", "closing", "paying", "awaiting_owner", "waiting_funds", "paused", "idle", "ended"];
const rank = (s: RoundStatus) => ORDER.indexOf(s.state);

/** The campaign_labels table as two sets; empty when the database can't be read (nothing is hidden on a guess). */
export async function campaignLabels(): Promise<{ test: Set<string>; real: Set<string> }> {
  try {
    const rows = await (await getDb()).select().from(schema.campaignLabels);
    return { test: new Set(rows.filter((r) => r.isTest).map((r) => r.address)), real: new Set(rows.filter((r) => !r.isTest).map((r) => r.address)) };
  } catch {
    return { test: new Set(), real: new Set() };
  }
}

/**
 * Whether a campaign on chain is a real one, for totals: not marked test, and known to production (it has a program,
 * a published brief, or a campaign_labels row saying it is real). Campaigns that local e2e runs or scripts create on
 * DevNet are unknown to production, so they never count.
 */
export async function realCampaignFilter(): Promise<((address: string) => boolean) | null> {
  try {
    const db = await getDb();
    const [labels, metas, programs] = await Promise.all([
      campaignLabels(),
      store.campaigns(),
      db.select({ address: schema.programs.campaignAddress }).from(schema.programs).where(isNotNull(schema.programs.campaignAddress)),
    ]);
    const known = new Set([...labels.real, ...metas.map((m) => m.address), ...programs.map((p) => p.address!)]);
    return (address) => known.has(address) && !labels.test.has(address);
  } catch {
    return null;
  }
}
