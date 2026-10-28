import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DecisionsTable } from "@/components/campaign/decisions";
import { HexValue } from "@/components/hex-value";
import { RoundStatusPill } from "@/components/rounds/round-status";
import { Card, EmptyState, PageHeader, Section, Stat } from "@/components/ui-kit";
import { getDb } from "@/lib/db";
import { rloText, utc } from "@/lib/format";
import { loadState } from "@/lib/merit/chain";
import { rpc } from "@/lib/server/agent";
import { campaignView } from "@/lib/server/campaign-view";
import { publicProgram } from "@/lib/server/contributors";
import { roundRows } from "@/lib/server/program-pages";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; n: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { n } = await params;
  return { title: `Round ${Number(n) || ""} receipt` };
}

/**
 * One round's public receipt (Misthos' /p/[slug]/rounds/[roundId]): its window and status, the ledger account that
 * commits each approval's record hash, every entry with its REX verdict and outcome, and the payout transactions.
 */
export default async function RoundReceipt({ params }: Params) {
  const { slug, n } = await params;
  const number = Number(n);
  if (!Number.isInteger(number) || number < 1) notFound();
  const db = await getDb();
  const program = await publicProgram(db, slug);
  if (!program?.campaignAddress) notFound();
  const [state, view] = await Promise.all([loadState(rpc, program.campaignAddress), campaignView(program.campaignAddress)]);
  if (!state || !view) notFound();
  const row = (await roundRows(db, program.id, view, state)).find((r) => r.number === number);
  if (!row) notFound();
  const chain = view.rounds.find((r) => r.round === number);
  const decisions = chain?.decisions ?? [];
  const paid = decisions.filter((d) => d.paid);
  const unpaid = decisions.filter((d) => !d.paid);
  const current = number === Number(state.round);
  return (
    <div className="grid gap-8">
      <PageHeader
        crumbs={[{ label: program.name, href: `/p/${program.slug}` }, { label: `Round ${number}` }]}
        title={`Round ${number} receipt`}
        meta={<RoundStatusPill status={row.status} />}
        description={`${utc(row.startsAt)} → ${utc(row.endsAt)}. Settled by the Merit program's own timers on Rialo DevNet (test RLO).`}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="receipt-stats">
        <Stat label="Approved on chain" value={decisions.length} hint={`${row.submissions} submitted`} />
        <Stat label="Paid" value={rloText(row.paid, 3)} hint={`${paid.length} payout${paid.length === 1 ? "" : "s"}`} />
        <Stat label="Not paid" value={unpaid.length} hint="unverified, revoked, over a cap or still settling" />
        <Stat label="Heartbeats" value={current ? Number(state.beats) : "—"} hint={current ? "this round so far" : "counted only for the current round"} />
      </div>
      <Card title="On-chain record" description="The ledger is the round's commitment: each entry stores the SHA-256 of its signed decision record.">
        <dl className="grid grid-cols-[1fr_auto] gap-y-2.5 text-sm">
          <dt className="text-soft">Campaign</dt>
          <dd><HexValue value={view.address} label="campaign" /></dd>
          <dt className="text-soft">Round ledger</dt>
          <dd>{chain?.ledger ? <HexValue value={chain.ledger} label="round ledger" /> : "none (nothing approved)"}</dd>
          <dt className="text-soft">Agent</dt>
          <dd>{chain?.agent ? <HexValue value={chain.agent} label="agent" head={6} tail={4} /> : "—"}</dd>
        </dl>
      </Card>
      <Section title="Entries" description="Open a row for the judge's reasons, the hash check and the validators' REX proof.">
        {decisions.length ? <DecisionsTable decisions={decisions} round={number} /> : <EmptyState className="py-8">Nothing was approved on chain in round {number}.</EmptyState>}
      </Section>
      <Section title="Payout transactions">
        {paid.length ? (
          <ul className="bg-card shadow-soft divide-y rounded-[20px]" data-testid="receipt-payouts">
            {paid.map((d) => (
              <li key={d.postId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span>{d.xUsername ? `@${d.xUsername}` : <HexValue value={d.contributor} label="wallet" head={6} tail={4} />} · post …{d.postId.slice(-6)}</span>
                <span className="text-success font-mono tabular-nums">{rloText(/Merit paid (\d+) kelvin/.exec(d.tx.payoutLine ?? "")?.[1] ?? d.amountKelvin)}</span>
                {d.tx.payout ? <HexValue value={d.tx.payout} href={`/tx/${d.tx.payout}`} label="payout" head={8} tail={0} /> : <span className="text-muted-foreground text-xs">paid</span>}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState className="py-8">{current && row.status !== "closed" ? "Payouts happen when this round settles." : "No payouts in this round."}</EmptyState>
        )}
      </Section>
    </div>
  );
}
