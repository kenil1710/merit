import { ArrowUpRight, Fuel } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { CampaignControls } from "@/components/app/campaign-controls";
import { ProgramStatus } from "@/components/app/program-status";
import { SetupChecklist } from "@/components/app/setup-checklist";
import { HexValue } from "@/components/hex-value";
import { phaseStatus, StatusBadge } from "@/components/status-badge";
import { Card, Notice, PageHeader } from "@/components/ui-kit";
import { getDb } from "@/lib/db";
import { formatRlo } from "@/lib/merit/constants";
import { perfectPayout, rlo } from "@/lib/program-math";
import { listSources } from "@/lib/shared/program";
import { controlsState, programSummary } from "@/lib/server/program-summary";
import { getProgramForMember, listMembers } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";
import { minutesLabel } from "@/lib/when";
import { isEndedPhase } from "@/lib/shared/round-window";

type Props = { params: Promise<{ id: string }> };

async function load(id: string) {
  const session = await getOwnerSession();
  if (!session || !z.uuid().safeParse(id).success) return null;
  return getProgramForMember(await getDb(), id, session.sub);
}

export async function generateMetadata({ params }: Props) {
  const found = await load((await params).id);
  return { title: found?.program.name ?? "Program" };
}

export default async function ProgramOverview({ params }: Props) {
  const found = await load((await params).id);
  if (!found) notFound();
  const { program: p, role } = found;
  const [s, members] = await Promise.all([programSummary(p), listMembers(await getDb(), p.id)]);
  const { state } = s;
  const controls = state && s.setup.created && role === "owner" && p.campaignSlugHex ? await controlsState(state) : null;
  const limits = p.limitsJson;
  const base = `/app/programs/${p.id}`;
  const below = { review: "their work goes to your review", reject: "their work is rejected", block: "they can't join" }[p.belowMinimum];

  return (
    <div className="grid gap-8">
      <PageHeader
        title={p.name}
        description={p.description}
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <ProgramStatus status={p.status} ended={!!p.endedAt || isEndedPhase(state?.phase ?? 0n)} />
            {state ? <StatusBadge status={phaseStatus(Number(state.phase))} /> : null}
            <span className="text-muted-foreground font-mono text-xs">/join/{p.slug}</span>
            {role === "reviewer" ? <span className="text-muted-foreground text-xs">· you review this program</span> : null}
          </span>
        }
        actions={
          p.campaignAddress && s.setup.created ? (
            <Link href={`/p/${p.slug}`} className="text-soft hover:text-foreground inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline">
              Public record <ArrowUpRight className="size-3.5" strokeWidth={1.5} />
            </Link>
          ) : null
        }
      />

      {s.chainError ? <Notice tone="warning">Rialo DevNet didn&apos;t answer just now; on-chain numbers are missing below.</Notice> : null}
      <SetupChecklist state={s.setup} href={`${base}/setup`} />

      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Escrow" value={state ? formatRlo(state.escrowKelvin, 3) : "—"} unit="RLO" />
        <Tile label="Paid" value={state ? formatRlo(state.totalPaid, 3) : "—"} unit="RLO" success />
        <Tile label="Round" value={state ? state.round.toString() : "—"} unit={s.roundPill?.split(" · ")[1]} />
        <Tile
          label={
            <span className="inline-flex items-center gap-1.5">
              <Fuel className="size-3" /> Operations budget
            </span>
          }
          value={state ? formatRlo(state.opsBudgetKelvin, 3) : "—"}
          unit="RLO"
          hint={s.verificationsLeft !== null ? `≈ ${s.verificationsLeft} verifications left` : undefined}
          low={s.verificationsLeft !== null && s.setup.published && s.verificationsLeft < 3}
        />
      </section>

      {controls ? (
        <Card title="Campaign controls" description="Signed by your wallet and enforced by the Merit program on chain.">
          <CampaignControls programId={p.id} owner={p.ownerWallet} slugHex={p.campaignSlugHex!} state={controls} />
        </Card>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card title="What it pays for" description={`${rlo(p.ratePerPoint)} per point · minimum score ${p.minScore}/100`}>
          <ul className="grid gap-2">
            {p.rubricJson.categories.map((c) => (
              <li key={c.key} className="bg-muted/50 flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {listSources(c.sourceTypes)} · {c.criteria.map((k) => k.name).join(", ")}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="text-muted-foreground block text-[10px]">up to</span>
                  <span className="mono-num font-medium">{rlo(perfectPayout(c.maxPoints, p.ratePerPoint))}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Rules enforced on chain" description="The Merit program checks these at approval and again at payout, whatever the agent decides.">
          <Facts
            rows={[
              ["Per payout", rlo(BigInt(limits.maxPerPayout))],
              ["Per contributor per round", rlo(BigInt(limits.maxPerContributor))],
              ["Per round", rlo(BigInt(limits.maxPerRound))],
              ["Round length", minutesLabel(p.roundLengthMinutes)],
              ["Agent", p.agentAddress ? <HexValue key="a" value={p.agentAddress} label="agent" head={6} tail={4} /> : "Set when the campaign is created"],
            ]}
          />
          {state?.version === 2 ? (
            <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
              Also on chain: {state.maxPerDay ? `${rlo(state.maxPerDay)} per 24 hours` : "no daily cap"}, {state.approvalThreshold ? `your approval above ${rlo(state.approvalThreshold)} per round` : "no owner approval"},{" "}
              {Number(state.cooldownMs) / 3_600_000} h new-wallet cooldown, late work taken {Number(state.submitGraceMs) / 60_000} min after a round closes.
            </p>
          ) : (
            <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
              Applied by the agent on this program v1 campaign: {rlo(BigInt(limits.maxPerDay))} per 24 hours, your approval above {rlo(BigInt(limits.autoApproveThreshold))} per round, {limits.payeeCooldownSeconds / 3600} h new-wallet cooldown.
            </p>
          )}
        </Card>

        <Card title="Submission rules">
          <Facts
            rows={[
              ["X account age", `at least ${p.minAccountAgeDays} days`],
              ["X followers", p.minXFollowers ? `at least ${p.minXFollowers}` : "no minimum"],
              ["Below the minimums", below],
              ["Per contributor", `${p.maxSubmissionsPerRound} submissions per round`],
              ["Without your review", `up to ${rlo(BigInt(limits.maxAutoApproveItem))}, confidence ≥ ${p.autoApproveConfidence}`],
            ]}
          />
        </Card>

        <Card title="Team" description="Reviewers sign in with their Rialo wallet to see this program.">
          <ul className="grid gap-2 text-sm">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-3">
                {m.wallet ? <HexValue value={m.wallet} label="wallet" head={8} tail={6} /> : <span>—</span>}
                <span className="text-muted-foreground text-xs capitalize">{m.role}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Tile({ label, value, unit, hint, success, low }: { label: ReactNode; value: string; unit?: string; hint?: string; success?: boolean; low?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ${low ? "bg-danger-subtle" : "bg-card shadow-soft"}`}>
      <p className="label">{label}</p>
      <p className={`display mt-1.5 text-2xl leading-none tabular-nums ${success ? "text-success" : ""}`}>
        {value}
        {unit ? <span className="text-muted-foreground ml-1 font-sans text-xs">{unit}</span> : null}
      </p>
      {hint ? <p className={`mt-1.5 text-xs ${low ? "text-danger" : "text-muted-foreground"}`}>{hint}</p> : null}
    </div>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <dt className="text-soft">{k}</dt>
          <dd className="mono-num min-w-0 text-right [overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
