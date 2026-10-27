import { EmptyState, PageHeader, Section, Stat } from "@/components/ui-kit";
import { getDb } from "@/lib/db";
import { rloText } from "@/lib/format";
import { metrics } from "@/lib/server/program-pages";
import { programsForMember } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";

export const metadata = { title: "Metrics" };

const seconds = (s: number | null) => (s === null ? "—" : s < 90 ? `${s} s` : `${Math.round(s / 60)} min`);

/** Across the programs you own or review: what the agent reviewed and caught, contributors, payouts and spend. */
export default async function MetricsPage() {
  const session = await getOwnerSession();
  if (!session) return null;
  const db = await getDb();
  const programs = await programsForMember(db, session.sub);
  const m = await metrics(db, programs.map((p) => p.id));
  const claude = m?.usage.find((u) => u.provider === "anthropic");
  const x = m?.usage.find((u) => u.provider === "x");
  return (
    <div className="grid gap-8">
      <PageHeader title="Metrics" description={`Across the ${programs.length} program${programs.length === 1 ? "" : "s"} you own or review. Payouts are RLO on Rialo DevNet (test currency).`} />
      {!m || m.submissions === 0 ? (
        <EmptyState art="box" title="Nothing to count yet" action={programs.length ? undefined : { label: "Create a program", href: "/app/programs/new" }}>
          Metrics fill in as contributors submit work and the agent reviews it.
        </EmptyState>
      ) : (
        <>
          <Section title="Review">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="metrics-review">
              <Stat label="Submissions" value={m.submissions} hint={`${m.reviewed} reviewed by the agent`} />
              <Stat label="Auto-approved" value={m.autoApproved} hint={`${m.autoRejected} auto-rejected`} />
              <Stat label="Sent to people" value={m.escalated} hint={`${m.humanDecisions} decisions by the team`} />
              <Stat label="Median review time" value={seconds(m.medianReviewSeconds)} hint="submission to decision" />
            </div>
          </Section>
          <Section title="What the checks caught" description="Flags on the agent's decisions, most frequent first.">
            {m.flags.length ? (
              <ul className="bg-card shadow-soft divide-y rounded-[1.25rem]" data-testid="metrics-flags">
                {m.flags.map((f) => (
                  <li key={f.code} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <span className="font-mono text-xs">{f.code}</span>
                    <span className="tabular-nums">{f.n}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState className="py-6">No flags so far.</EmptyState>
            )}
          </Section>
          <Section title="Contributors and payouts">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Contributors" value={m.contributors} hint={`${m.activeContributors} active in the last 30 days`} />
              <Stat label="Paid contributors" value={m.paidContributors} />
              <Stat label="RLO paid" value={rloText(m.paidKelvin, 3)} hint={`${m.paidSubmissions} paid submissions`} />
              <Stat label="Rounds with work" value={m.roundsWithSubmissions} />
            </div>
          </Section>
          <Section title="Spend" description="Recorded per call by Merit; the Latch budgets on the Guardrails page are the hard limits.">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Claude (merit-judge)" value={claude ? `$${claude.usd.toFixed(4)}` : "$0"} hint={`${claude?.units ?? 0} judge calls`} />
              <Stat label="X reads (merit-x)" value={x ? `$${x.usd.toFixed(4)}` : "—"} hint={x ? `${x.units} reads` : "Not recorded per call; see Guardrails"} />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
