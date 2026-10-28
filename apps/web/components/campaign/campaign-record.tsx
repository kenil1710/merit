import Link from "next/link";
import type { ReactNode } from "react";
import { DecisionRounds } from "@/components/campaign/decisions";
import { HexValue } from "@/components/hex-value";
import { KelvinText } from "@/components/kelvin-text";
import { phaseStatus, StatusBadge } from "@/components/status-badge";
import { Card, PageHeader, Section, Stat } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { formatRlo, REX_COST_KELVIN } from "@/lib/merit/constants";
import type { CampaignView } from "@/lib/server/campaign-view";
import { ArrowRight } from "lucide-react";

const rlo = (kelvin: string, digits = 4) => formatRlo(BigInt(kelvin), digits);
const utc = (ms: number) => (ms ? `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC` : "—");
const duration = (ms: number) =>
  ms % 86_400_000 === 0 ? `${ms / 86_400_000} d` : ms % 3_600_000 === 0 ? `${ms / 3_600_000} h` : `${Math.round(ms / 60_000)} min`;

type Activity = { signature: string; blockTime?: number; lines: string[]; failed: boolean };

/** Consecutive silent heartbeat steps collapse into one row. */
function collapse(events: Activity[]): (Activity & { quiet: number })[] {
  const out: (Activity & { quiet: number })[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (!e.lines.length && !e.failed && last && !last.lines.length && !last.failed) last.quiet += 1;
    else out.push({ ...e, quiet: 1 });
  }
  return out;
}

function activityKind(line: string): { label: string; tone: string } {
  if (/paid|repaid/.test(line)) return { label: "Payout", tone: "bg-success-subtle text-success" };
  if (/verdict|verifying|approved/.test(line)) return { label: "Decision", tone: "bg-brand-subtle text-brand-soft" };
  if (/round|settl|heartbeat|ending/.test(line)) return { label: "Round", tone: "bg-secondary text-foreground" };
  if (/fund|withdr|refund|budget/.test(line)) return { label: "Treasury", tone: "bg-warning-subtle text-warning" };
  return { label: "Campaign", tone: "bg-secondary text-foreground" };
}

/**
 * A campaign's public record from the chain: rules, books, every round's decisions with the judge's reasons and REX
 * proof, and recent activity. `/p/[slug]` shows it for a program; `/c/[address]` for campaigns without one.
 */
export function CampaignRecord({ view, joinHref = "/join", roundBase, extra }: { view: CampaignView; joinHref?: string; roundBase?: string; extra?: ReactNode }) {
  const { config, books, round } = view;
  const verificationsLeft = Number(BigInt(books.ops) / REX_COST_KELVIN);
  const decisions = view.rounds.reduce((n, r) => n + r.decisions.length, 0);

  return (
    <div className="grid gap-10">
      <PageHeader
        crumbs={[{ label: "Explore", href: "/explore" }, { label: view.meta?.name ?? "Campaign" }]}
        title={view.meta?.name ?? "Unnamed campaign"}
        meta={<StatusBadge status={phaseStatus(view.phaseCode)} />}
        description={view.meta?.brief}
        actions={
          view.status.state === "open" || view.status.state === "closing" || view.status.state === "paying" ? (
            <Button asChild>
              <Link href={joinHref}>
                Contribute <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="text-muted-foreground -mt-6 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">Campaign <HexValue value={view.address} label="campaign address" /></span>
        <span className="inline-flex items-center gap-1.5">Owner <HexValue value={view.owner} label="owner address" /></span>
        <span className="inline-flex items-center gap-1.5">Agent <HexValue value={view.agent} label="agent address" /></span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Escrow held" value={rlo(books.escrow, 3)} hint="RLO locked in the campaign workflow" />
        <Stat label="Paid out" value={rlo(books.paid, 3)} hint={`RLO across ${decisions} decision${decisions === 1 ? "" : "s"}`} />
        <Stat
          label="Operations budget"
          value={rlo(books.ops, 3)}
          hint={`≈ ${verificationsLeft} verifications left · ${rlo(books.opsReimbursed, 4)} repaid to the agent`}
        />
        <Stat
          label={`Round ${round.number}`}
          value={round.beats}
          hint={view.phaseCode === 1 ? `heartbeats · closes ${utc(round.endMs)}` : `heartbeats in the last round · opened ${utc(round.startMs)}`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Rules enforced on chain" description="The program computes every payout from the score and checks every cap; the agent can't exceed them.">
          <dl className="grid grid-cols-[1fr_auto] gap-y-2.5 text-sm">
            <dt className="text-soft">Score 100 pays</dt><dd className="font-mono tabular-nums">{rlo(config.rateKelvin)} RLO</dd>
            <dt className="text-soft">Minimum score</dt><dd className="font-mono tabular-nums">{config.minScore}</dd>
            <dt className="text-soft">Per payout</dt><dd className="font-mono tabular-nums">{rlo(config.capPerPayout)} RLO</dd>
            <dt className="text-soft">Per contributor per round</dt><dd className="font-mono tabular-nums">{rlo(config.capPerContributor)} RLO</dd>
            <dt className="text-soft">Per round</dt><dd className="font-mono tabular-nums">{rlo(config.capPerRound)} RLO</dd>
            <dt className="text-soft">Round length</dt><dd className="font-mono tabular-nums">{duration(config.roundLengthMs)}</dd>
            <dt className="text-soft">Refund deadline</dt><dd className="font-mono tabular-nums">{utc(config.refundDeadlineMs)}</dd>
          </dl>
        </Card>
        <Card title="Books" description="Every RLO that entered the campaign, and where it went.">
          <dl className="grid grid-cols-[1fr_auto] gap-y-2.5 text-sm">
            <dt className="text-soft">Escrow funded</dt><dd className="font-mono tabular-nums">{rlo(books.funded)} RLO</dd>
            <dt className="text-soft">Paid to contributors</dt><dd className="text-success font-mono tabular-nums">{rlo(books.paid)} RLO</dd>
            <dt className="text-soft">Withdrawn by owner</dt><dd className="font-mono tabular-nums">{rlo(books.withdrawn)} RLO</dd>
            <dt className="text-soft">Refunded at deadline</dt><dd className="font-mono tabular-nums">{rlo(books.refunded)} RLO</dd>
            <dt className="text-soft">Operations budget funded</dt><dd className="font-mono tabular-nums">{rlo(books.opsFunded)} RLO</dd>
            <dt className="text-soft">Repaid to agent (REX + rent)</dt><dd className="font-mono tabular-nums">{rlo(books.opsReimbursed)} RLO</dd>
          </dl>
        </Card>
      </div>

      <Section title="Decisions" description="Open a row for the judge's reasons, the validators' REX proof and every transaction.">
        <DecisionRounds rounds={view.rounds} roundBase={roundBase} />
      </Section>

      {extra}

      <Section title="Activity" description="What the program recorded, newest first. Silent heartbeat steps are grouped.">
        <ul className="bg-card shadow-soft divide-y rounded-[20px]" data-testid="activity">
          {collapse(view.activity).map((a) => {
            const line = a.lines.join(" · ");
            const kind = a.failed ? { label: "Failed", tone: "bg-danger-subtle text-danger" } : line ? activityKind(line) : { label: "Heartbeat", tone: "bg-muted text-muted-foreground" };
            return (
              <li key={a.signature} className="grid gap-x-4 gap-y-1 px-5 py-3 text-sm sm:grid-cols-[10.5rem_6rem_minmax(0,1fr)_auto] sm:items-center">
                <span className="text-muted-foreground font-mono text-xs">{a.blockTime ? utc(a.blockTime) : ""}</span>
                <span className={`inline-flex h-5 w-fit items-center rounded-md px-1.5 text-xs font-medium ${kind.tone}`}>{kind.label}</span>
                <span className={line ? "" : "text-muted-foreground"}>
                  {line ? <KelvinText text={line.replace(/^Merit /, "")} /> : a.quiet > 1 ? `${a.quiet} heartbeat steps` : "Heartbeat step"}
                </span>
                <HexValue value={a.signature} href={`/tx/${a.signature}`} label="transaction" head={8} tail={0} />
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
