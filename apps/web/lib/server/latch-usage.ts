import "server-only";

import { and, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";

/** Latch's model_based pricing: cents per 1,000 tokens, per model (as /latch-self/budget reports it). */
export type ModelPricing = Record<string, { inputPer1k: number; outputPer1k: number }>;

/** What a call cost under the latch's own pricing, in cents. Unknown models are priced at the dearest one listed. */
export function latchCents(pricing: ModelPricing, model: string | null, inputTokens: number, outputTokens: number): number {
  const rates = Object.values(pricing);
  const p = (model && pricing[model]) || rates.sort((a, b) => b.outputPer1k - a.outputPer1k)[0];
  if (!p) return 0;
  return (inputTokens / 1000) * p.inputPer1k + (outputTokens / 1000) * p.outputPer1k;
}

export type CampaignUsage = {
  campaign: string;
  name: string | null;
  slug: string | null;
  judge: { calls: number; allowed: number; denied: number; failed: number; cents: number; child: boolean };
  x: { calls: number; allowed: number; denied: number; failed: number; child: boolean };
  deniedBy: { latch: string; filter: string; count: number }[];
  lastAt: Date | null;
};

/** Merit's latch calls since `since`, grouped by the X-Merit-Campaign value they carried. */
export async function usageByCampaign(db: Db, since: Date, pricing: ModelPricing): Promise<CampaignUsage[]> {
  const c = schema.latchCalls;
  const rows = await db
    .select({
      campaign: c.campaign,
      latch: c.latch,
      model: c.model,
      calls: sql<number>`count(*)::int`,
      allowed: sql<number>`(count(*) filter (where ${c.status} between 200 and 299))::int`,
      denied: sql<number>`(count(*) filter (where ${c.deniedBy} is not null))::int`,
      child: sql<boolean>`bool_or(${c.via} = 'child')`,
      inputTokens: sql<number>`coalesce(sum(${c.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${c.outputTokens}), 0)::int`,
      lastAt: sql<Date>`max(${c.createdAt})`,
    })
    .from(c)
    .where(gte(c.createdAt, since))
    .groupBy(c.campaign, c.latch, c.model);
  const denials = await db
    .select({ campaign: c.campaign, latch: c.latch, filter: c.deniedBy, count: sql<number>`count(*)::int` })
    .from(c)
    .where(and(gte(c.createdAt, since), isNotNull(c.deniedBy)))
    .groupBy(c.campaign, c.latch, c.deniedBy);
  const campaigns = [...new Set(rows.map((r) => r.campaign))];
  const programs = campaigns.length
    ? await db.select({ address: schema.programs.campaignAddress, name: schema.programs.name, slug: schema.programs.slug }).from(schema.programs).where(inArray(schema.programs.campaignAddress, campaigns))
    : [];

  const out = new Map<string, CampaignUsage>();
  for (const r of rows) {
    const p = programs.find((x) => x.address === r.campaign);
    const u = out.get(r.campaign) ?? {
      campaign: r.campaign,
      name: p?.name ?? null,
      slug: p?.slug ?? null,
      judge: { calls: 0, allowed: 0, denied: 0, failed: 0, cents: 0, child: false },
      x: { calls: 0, allowed: 0, denied: 0, failed: 0, child: false },
      deniedBy: [],
      lastAt: null,
    };
    const side = r.latch === "merit-judge" ? u.judge : u.x;
    side.calls += r.calls;
    side.allowed += r.allowed;
    side.denied += r.denied;
    side.failed += r.calls - r.allowed - r.denied;
    side.child ||= Boolean(r.child);
    if (r.latch === "merit-judge") u.judge.cents += latchCents(pricing, r.model, r.inputTokens, r.outputTokens);
    const last = new Date(r.lastAt);
    if (!u.lastAt || last > u.lastAt) u.lastAt = last;
    out.set(r.campaign, u);
  }
  for (const d of denials) out.get(d.campaign)?.deniedBy.push({ latch: d.latch, filter: d.filter ?? "?", count: d.count });
  return [...out.values()].sort((a, b) => b.judge.calls + b.x.calls - (a.judge.calls + a.x.calls));
}


/** A campaign tag as people read it: owner-<user id> is an owner's "Read it", made before any campaign exists. */
export function usageLabel(u: Pick<CampaignUsage, "campaign" | "name">): string {
  if (u.name) return u.name;
  return u.campaign.startsWith("owner-") ? "Owner · Read it (no campaign yet)" : "Campaign";
}

/** One latch's totals across campaigns (merit-judge's spend is what Merit's log prices, to the hundredth of a cent). */
export function latchTotals(usage: CampaignUsage[], latch: "merit-judge" | "merit-x"): { calls: number; cents: number } {
  const side = (u: CampaignUsage) => (latch === "merit-judge" ? u.judge : u.x);
  return { calls: usage.reduce((n, u) => n + side(u).calls, 0), cents: latch === "merit-judge" ? usage.reduce((n, u) => n + u.judge.cents, 0) : 0 };
}

/** The start of the current UTC day: "Today" everywhere on Guardrails means since 00:00 UTC. */
export const startOfUtcDay = (now = Date.now()) => new Date(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z");
