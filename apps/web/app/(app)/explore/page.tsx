import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { roundBadge, StatusBadge } from "@/components/status-badge";
import { EmptyState, PageHeader } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { formatRlo } from "@/lib/merit/constants";
import { namedCampaigns } from "@/lib/server/live-campaigns";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Explore campaigns" };

const left = (endMs: number) => {
  const m = Math.max(0, Math.round((endMs - Date.now()) / 60_000));
  return m >= 120 ? `in ${Math.round(m / 60)} h` : m > 0 ? `in ${m} min` : "now";
};
const hhmm = (d: Date) => `${d.toISOString().slice(11, 16)} UTC`;

/** Every campaign with a published name and brief, read live from the program's accounts. */
export default async function Explore() {
  const { campaigns, unnamed } = await namedCampaigns();

  return (
    <div className="grid content-start gap-10">
      <PageHeader
        title={<>Explore <em>campaigns</em></>}
        description="Campaigns on Rialo DevNet, read straight from the Merit program's accounts. Open ones take submissions now; every one shows each decision and payout."
      />
      {campaigns.length === 0 ? (
        <EmptyState art="seal" title="No campaigns yet" action={{ label: "Run a campaign", href: "/owner" }}>
          Campaigns appear here as soon as their owner publishes a name and brief.
        </EmptyState>
      ) : (
        <ul aria-label="Campaigns" className="grid items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map(({ state: c, meta, status }) => {
            const open = status.state === "open";
            const between = status.state === "closing" || status.state === "paying";
            return (
              <li key={c.address} className="bg-card shadow-soft flex flex-col rounded-[20px] p-6" data-testid="campaign-card">
                <StatusBadge status={roundBadge(status.state)} className="mb-3 self-start" />
                <h2 className="display text-[1.625rem] leading-tight [overflow-wrap:anywhere]">{meta.name}</h2>
                <p className="text-soft mt-2 line-clamp-3 text-sm leading-relaxed">{meta.brief}</p>
                <div className="mt-5">
                  <p className="text-muted-foreground text-xs">Score 100 pays</p>
                  <p className="display mt-1 text-[2rem] leading-none tabular-nums">
                    {formatRlo(c.rateKelvin, 3)}
                    <span className="text-muted-foreground ml-1 font-sans text-xs">RLO</span>
                  </p>
                </div>
                <dl className="mt-5 grid grid-cols-3 gap-x-3 border-t pt-4 text-sm">
                  <div>
                    <dt className="text-muted-foreground text-xs">{open ? `Round ${c.round} closes` : between ? `Round ${status.round + 1} opens` : "Rounds"}</dt>
                    <dd className="mt-0.5" data-testid="card-round">
                      {open ? left(Number(c.roundEndMs)) : between ? (status.nextOpensAt ? `≈ ${hhmm(status.nextOpensAt)}` : "soon") : c.round.toString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Escrow</dt>
                    <dd className="mono-num mt-0.5">{formatRlo(c.escrowKelvin, 3)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Paid</dt>
                    <dd className="mono-num text-success mt-0.5">{formatRlo(c.totalPaid, 3)}</dd>
                  </div>
                </dl>
                <div className="mt-auto flex items-center justify-between gap-3 pt-6">
                  <Link href={`/c/${c.address}`} className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline">
                    Decisions and payouts
                  </Link>
                  {open || between ? (
                    <Button asChild size="sm">
                      <Link href="/join" aria-label={`Contribute to ${meta.name}`}>
                        Contribute <ArrowRight className="size-3.5" aria-hidden="true" />
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/c/${c.address}`} aria-label={`Open ${meta.name}`}>Open</Link>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {unnamed > 0 ? (
        <p className="text-muted-foreground text-sm">
          {unnamed} more campaign account{unnamed === 1 ? "" : "s"} on chain without a published name and brief (test runs) are not listed.
        </p>
      ) : null}
    </div>
  );
}
