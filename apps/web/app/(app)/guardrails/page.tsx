import { KeyRound, ShieldCheck, Timer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CampaignUsageTable } from "@/components/guardrails/campaign-usage";
import { ChildLatches, type ChildLatchView } from "@/components/guardrails/child-latches";
import { FilterList } from "@/components/guardrails/filter-list";
import { Probes } from "@/components/guardrails/probes";
import { Card, Notice, PageHeader } from "@/components/ui-kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { configured, env } from "@/lib/server/env";
import { childLatches, latchSelf, type LatchName } from "@/lib/server/latch";
import { PROBES, liveCampaign, pipelineSnapshot, type ProbeKey, type Snapshot } from "@/lib/server/latch-probes";
import { cents } from "@/components/guardrails/campaign-usage";
import { latchTotals, startOfUtcDay, usageByCampaign, type CampaignUsage, type ModelPricing } from "@/lib/server/latch-usage";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Guardrails" };

type Capabilities = {
  upstream?: string; methods?: string[]; endpoints?: string[];
  rateLimit?: { maxRequests: number; windowSeconds: number; counting?: string };
  payloadRules?: { path: string; operator: string; value?: unknown }[];
  costBudget?: { maxDailyCents?: number } | null;
  cedar?: unknown[];
  customCode?: unknown[];
};
type Budget = { maxDailyCents?: number; currentDailySpendCents?: number; remaining?: number; modelPricing?: ModelPricing; message?: string; error?: string };
type AuditEntry = { method: string; path: string; decision: string; deniedBy?: string; timestamp: string; evaluationMs?: number };

const latches: { name: LatchName; purpose: string; token: () => string }[] = [
  { name: "merit-judge", purpose: "Claude scoring. Only Haiku, bounded max_tokens, no tools, a named campaign and contributor on every call, and a $1/day budget.", token: env.judgeLat },
  { name: "merit-x", purpose: "Read-only X access for the judge and for REX validators: GET only, post lookups only, and only for posts Merit is working on.", token: env.xLat },
];

const warn = (what: string) => (e: Error) => {
  console.warn(`guardrails: ${what} pipeline not read (${e.message.slice(0, 160)})`);
  return null;
};

async function snapshots(): Promise<Partial<Record<LatchName, Snapshot | null>>> {
  try {
    const db = await getDb();
    const campaign = (await liveCampaign(db)) ?? "5LyXppXdVZHcV6bcWjJkTyir3F9PM5TEx6pTTA9jEiwv";
    const [judge, x] = await Promise.all((["merit-judge", "merit-x"] as const).map((l) => (configured(l === "merit-judge" ? env.judgeLat : env.xLat).ok ? pipelineSnapshot(db, l, campaign).catch(warn(l)) : null)));
    return { "merit-judge": judge, "merit-x": x };
  } catch (e) {
    warn("pipelines")(e as Error);
    return {};
  }
}

const rule = (r: { path: string; operator: string; value?: unknown }) =>
  `${r.path} ${r.operator.replace(/_/g, " ")}${r.value === undefined ? "" : ` ${JSON.stringify(r.value)}`}`;

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium", ok ? "bg-success-subtle text-success" : "bg-danger-subtle text-danger")}>
      {children}
    </span>
  );
}

async function campaignUsage(window: "today" | "7d", pricing: ModelPricing, now: number): Promise<CampaignUsage[] | null> {
  const since = window === "7d" ? new Date(now - 7 * 86_400_000) : startOfUtcDay(now);
  try {
    return await usageByCampaign(await getDb(), since, pricing);
  } catch {
    return null;
  }
}

async function childViews(): Promise<ChildLatchView[]> {
  const children = childLatches();
  if (children.length === 0) return [];
  const names = await getDb()
    .then((db) => db.select({ address: schema.programs.campaignAddress, name: schema.programs.name }).from(schema.programs).where(inArray(schema.programs.campaignAddress, children.map((c) => c.campaign))))
    .catch(() => []);
  return Promise.all(
    children.map(async (c) => {
      const self = await latchSelf(c.token);
      const raw = self.audit as { entries?: AuditEntry[] } | AuditEntry[] | undefined;
      return {
        campaign: c.campaign,
        latch: c.latch,
        name: names.find((n) => n.address === c.campaign)?.name ?? null,
        whoami: (self.whoami ?? {}) as ChildLatchView["whoami"],
        budget: (self.budget ?? {}) as ChildLatchView["budget"],
        audit: Array.isArray(raw) ? raw : raw?.entries ?? [],
      };
    }),
  );
}

export default async function Guardrails({ searchParams }: { searchParams: Promise<{ window?: string }> }) {
  const window = (await searchParams).window === "7d" ? "7d" : "today";
  const readAt = new Date();
  const live = await Promise.all(
    latches.map(async (l) => {
      const ready = configured(l.token);
      return { ...l, data: ready.ok ? await latchSelf(l.token()) : null, missing: ready.ok ? null : ready.missing };
    }),
  );
  const pricing = ((live[0]?.data?.budget ?? {}) as Budget).modelPricing ?? {};
  // One source for every count and spend on the page: Merit's own log of its latch calls (Latch's budget counter
  // reports whole cents, and its audit list is only the newest few entries).
  const [today, week, children, pipelines] = await Promise.all([campaignUsage("today", pricing, readAt.getTime()), campaignUsage("7d", pricing, readAt.getTime()), childViews(), snapshots()]);
  const usage = window === "7d" ? week : today;
  const probesFor = (latch: LatchName) =>
    (Object.entries(PROBES) as [ProbeKey, (typeof PROBES)[ProbeKey]][]).filter(([, p]) => p.latch === latch).map(([key, p]) => ({ key, label: p.label, rule: p.rule, step: p.step }));
  return (
    <div className="grid gap-10">
      <PageHeader
        title="Guardrails"
        description={
          <>
            Merit never holds an Anthropic or X key. Every call goes through a Latch latch that checks it against a policy before the credential is attached. This page reads each latch&apos;s capabilities, budget and audit log on every load, with that latch&apos;s own token, on the server. All times are UTC; read at{" "}
            <span className="font-mono">{readAt.toISOString().slice(11, 19)} UTC</span> ·{" "}
            <a href={window === "7d" ? "/guardrails?window=7d" : "/guardrails"} className="text-foreground underline underline-offset-4">
              Refresh
            </a>{" "}
            · How the code was reviewed:{" "}
            <Link href="/security" className="text-foreground underline underline-offset-4">
              Security
            </Link>
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-2">
        {live.map((l) => {
          const caps = (l.data?.capabilities ?? {}) as Capabilities & { error?: string };
          const budget = (l.data?.budget ?? {}) as Budget;
          const raw = l.data?.audit as { entries?: AuditEntry[] } | AuditEntry[] | undefined;
          const audit = (Array.isArray(raw) ? raw : raw?.entries ?? []).slice(0, 8);
          const reachable = !l.missing && !caps.error;
          const spent = today ? latchTotals(today, l.name).cents : (budget.currentDailySpendCents ?? 0);
          const used = budget.maxDailyCents ? Math.min(100, (Math.max(spent, budget.currentDailySpendCents ?? 0) / budget.maxDailyCents) * 100) : 0;
          return (
            <Card
              key={l.name}
              className="min-w-0"
              title={<span className="font-mono">{l.name}</span>}
              description={l.purpose}
              actions={<Pill ok={reachable}>{l.missing ? "Not configured" : caps.error ? "Unreachable" : "Live"}</Pill>}
            >
              {l.missing ? (
                <Notice tone="danger">{l.missing}</Notice>
              ) : (
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 text-sm">
                  <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-2">
                    <dt className="text-muted-foreground">Upstream</dt><dd className="font-mono break-all">{caps.upstream}</dd>
                    <dt className="text-muted-foreground">Methods</dt><dd className="font-mono">{caps.methods?.join(", ")}</dd>
                    <dt className="text-muted-foreground">Endpoints</dt><dd className="font-mono break-all">{caps.endpoints?.join("  ")}</dd>
                    {caps.rateLimit ? (
                      <><dt className="text-muted-foreground">Rate limit</dt><dd className="font-mono">{caps.rateLimit.maxRequests} / {caps.rateLimit.windowSeconds}s {caps.rateLimit.counting}</dd></>
                    ) : null}
                    {caps.payloadRules?.length ? (
                      <><dt className="text-muted-foreground">Payload</dt><dd className="grid gap-0.5 font-mono text-xs">{caps.payloadRules.map((r) => <span key={rule(r)}>{rule(r)}</span>)}</dd></>
                    ) : null}
                  </dl>

                  <div>
                    <p className="label mb-2">Every filter in use</p>
                    <FilterList snapshot={pipelines[l.name] ?? null} caps={caps} />
                  </div>

                  <div>
                    <p className="label mb-2">Try a bad request</p>
                    <Probes probes={probesFor(l.name)} />
                  </div>

                  <div className="bg-muted/50 rounded-xl p-4">
                    <p className="label">Spend today (since 00:00 UTC)</p>
                    {budget.maxDailyCents !== undefined ? (
                      <>
                        <p className="mt-2">
                          <span className="display text-3xl tabular-nums">{today ? cents(latchTotals(today, l.name).cents) : `${budget.currentDailySpendCents}¢`}</span>
                          <span className="text-muted-foreground"> of {budget.maxDailyCents}¢ · {today ? `${latchTotals(today, l.name).calls} calls` : `${budget.remaining}¢ left`}</span>
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          From Merit&apos;s log. Latch&apos;s own counter shows {budget.currentDailySpendCents ?? 0}¢: it counts whole cents and enforces the cap.
                        </p>
                        <div className="bg-background mt-3 h-1.5 overflow-hidden rounded-full">
                          <div className="bg-brand h-full rounded-full" style={{ width: `${used}%` }} />
                        </div>
                      </>
                    ) : (
                      <p className="text-soft mt-2">{budget.message ?? budget.error ?? "No budget"}. The daily rate limit is the ceiling.</p>
                    )}
                  </div>

                  <div>
                    <p className="label mb-2">Latest decisions in Latch&apos;s audit log (newest 8, includes probes)</p>
                    <div className="overflow-x-auto rounded-xl border">
                      <Table className="table-fixed">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-40 pl-4">Time (UTC)</TableHead>
                            <TableHead>Request</TableHead>
                            <TableHead className="w-32 pr-4 text-right">Decision</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {audit.map((e, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-muted-foreground pl-4 font-mono text-xs">{e.timestamp.replace("T", " ").slice(0, 19)}</TableCell>
                              <TableCell className="truncate font-mono text-xs">{e.method} {e.path}</TableCell>
                              <TableCell className="pr-4 text-right">
                                <Pill ok={e.decision === "allow"}>{e.decision === "allow" ? "allow" : `deny · ${e.deniedBy}`}</Pill>
                              </TableCell>
                            </TableRow>
                          ))}
                          {audit.length === 0 ? (
                            <TableRow><TableCell colSpan={3} className="text-muted-foreground pl-4">No entries.</TableCell></TableRow>
                          ) : null}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          );
        })}

        <Card
          className="border-brand/30 border border-dashed bg-transparent shadow-none"
          title={<span className="font-mono">merit-payout-signer</span>}
          description="A TEE latch that would sign the agent's Rialo transactions with a Privy wallet."
          actions={<span className="bg-warning-subtle text-warning inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium">Waiting on Latch rollout</span>}
        >
          <div className="grid gap-4 text-sm">
            <div className="flex gap-3">
              <KeyRound className="text-brand mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
              <p className="text-soft">It would refuse anything but Merit&apos;s <span className="font-mono">approve</span> (tag 17) with a score of at most 100, signed only by the authorized agent key.</p>
            </div>
            <div className="flex gap-3">
              <ShieldCheck className="text-brand mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
              <p className="text-soft">Until Latch offers the Privy signer on this account, the agent is a separate DevNet key and the program&apos;s caps are the wall: per payout, per contributor per round, per round, and the operations budget.</p>
            </div>
            <div className="flex gap-3">
              <Timer className="text-brand mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
              <p className="text-soft">The owner can rotate the agent with <span className="font-mono">set_agent</span> from the next round, with no redeploy.</p>
            </div>
          </div>
        </Card>
      </div>
      <ChildLatches readAt={readAt}>{children}</ChildLatches>
      {usage ? <CampaignUsageTable usage={usage} window={window} readAt={readAt} /> : <Notice tone="warning">Per-campaign usage needs the database, which isn&apos;t reachable right now.</Notice>}
    </div>
  );
}
