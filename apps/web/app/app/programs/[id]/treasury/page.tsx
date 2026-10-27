import { HexValue } from "@/components/hex-value";
import { TreasuryActions } from "@/components/app/treasury-actions";
import { Card, EmptyState, Notice, PageHeader, Section, Stat } from "@/components/ui-kit";
import { rloText, utc } from "@/lib/format";
import { loadState } from "@/lib/merit/chain";
import { rpc } from "@/lib/server/agent";
import { campaignView } from "@/lib/server/campaign-view";
import { memberProgram } from "@/lib/server/owner-page";
import { dayCap, payoutsOf, treasuryMoves } from "@/lib/server/program-pages";
import { verificationsLeft } from "@/lib/server/program-summary";

export const metadata = { title: "Treasury" };

const MOVE: Record<string, string> = {
  "chain.funded": "Escrow funded",
  "chain.ops_funded": "Operations budget funded",
  "chain.withdrawn": "Escrow withdrawn",
  "chain.ops_withdrawn": "Operations budget withdrawn",
  "chain.refunded": "Refunded at the deadline",
};

/** The escrow and the operations budget: balances and books from the chain, moves, payouts, the daily cap, actions. */
export default async function TreasuryPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, program, role, base } = await memberProgram((await params).id);
  let chainError = false;
  const [state, view] = program.campaignAddress
    ? await Promise.all([loadState(rpc, program.campaignAddress), campaignView(program.campaignAddress)]).catch(() => {
        chainError = true;
        return [null, null] as const;
      })
    : [null, null];
  const [moves, payouts] = [await treasuryMoves(db, program.id), payoutsOf(view)];
  const cap = dayCap(state);
  const phase = state ? Number(state.phase) : 0;
  const unreserved = !state ? 0n : phase === 0 || phase === 4 ? state.escrowKelvin : phase === 1 ? (state.escrowKelvin > state.capPerRound ? state.escrowKelvin - state.capPerRound : 0n) : 0n;
  const opsFree = state && (phase === 0 || phase === 4) ? state.opsBudgetKelvin : 0n;
  return (
    <div className="grid gap-8">
      <PageHeader crumbs={[{ label: program.name, href: base }, { label: "Treasury" }]} title="Treasury" description="The payout escrow and the operations budget live in the campaign on Rialo. Only the program moves them, within its rules." />
      {chainError ? <Notice tone="warning">Rialo DevNet didn&apos;t answer just now; balances are missing.</Notice> : null}
      {!state ? (
        <EmptyState art="vault" title="No campaign yet" action={{ label: "Go live", href: `${base}/setup` }}>
          The escrow is created and funded when you take the program live.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Escrow" value={rloText(state.escrowKelvin, 3)} hint={`${rloText(unreserved, 3)} withdrawable now`} />
            <Stat label="Operations budget" value={rloText(state.opsBudgetKelvin, 3)} hint={`≈ ${verificationsLeft(state)} verifications left`} />
            <Stat label="Paid out" value={rloText(state.totalPaid, 3)} hint={`${payouts.length} payout${payouts.length === 1 ? "" : "s"}`} />
            <Stat label="24-hour cap" value={cap ? rloText(cap.used, 3) : "None"} hint={cap ? `of ${rloText(cap.max, 3)} in the last 24 hours (on chain)` : state.version < 2 ? "Needs a program v2 campaign" : "Set one in Settings"} />
          </div>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Card title="Books" description="Every RLO that entered the campaign, and where it went (on chain).">
              <dl className="grid grid-cols-[1fr_auto] gap-y-2.5 text-sm">
                <dt className="text-soft">Escrow funded</dt><dd className="font-mono tabular-nums">{rloText(state.totalFunded)}</dd>
                <dt className="text-soft">Paid to contributors</dt><dd className="text-success font-mono tabular-nums">{rloText(state.totalPaid)}</dd>
                <dt className="text-soft">Withdrawn by owner</dt><dd className="font-mono tabular-nums">{rloText(state.totalWithdrawn)}</dd>
                <dt className="text-soft">Refunded at deadline</dt><dd className="font-mono tabular-nums">{rloText(state.totalRefunded)}</dd>
                <dt className="text-soft">Operations budget funded</dt><dd className="font-mono tabular-nums">{rloText(state.totalOpsFunded)}</dd>
                <dt className="text-soft">Repaid to agent (REX + rent)</dt><dd className="font-mono tabular-nums">{rloText(state.totalOpsReimbursed)}</dd>
                <dt className="text-soft">Campaign account</dt><dd><HexValue value={state.address} label="campaign" /></dd>
              </dl>
            </Card>
            {role === "owner" && program.campaignSlugHex ? (
              <Card title="Move funds" description="Withdrawals: while a round is open the round's cap stays locked; nothing moves while it settles.">
                <TreasuryActions programId={program.id} owner={program.ownerWallet} slugHex={program.campaignSlugHex} unreserved={unreserved.toString()} opsWithdrawable={opsFree.toString()} ended={phase >= 4} />
              </Card>
            ) : null}
          </div>
        </>
      )}
      <Section title="Deposits and withdrawals" description="Moves signed in Merit, checked on chain.">
        {moves.length ? (
          <ul className="bg-card shadow-soft divide-y rounded-[1.25rem]" data-testid="treasury-moves">
            {moves.map((m, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span>{MOVE[m.action] ?? m.action}</span>
                <span className="text-muted-foreground text-xs">{utc(m.at)}</span>
                <span className="font-mono tabular-nums">{rloText(m.amount)}</span>
                {m.signature ? <HexValue value={m.signature} href={`/tx/${m.signature}`} label="transaction" head={8} tail={0} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState className="py-8">No deposits or withdrawals recorded yet. The books above add up everything on chain.</EmptyState>
        )}
      </Section>
      <Section title="Payouts" description="Paid by the program's own timers when each round settled.">
        {payouts.length ? (
          <ul className="bg-card shadow-soft divide-y rounded-[1.25rem]" data-testid="treasury-payouts">
            {payouts.map((p) => (
              <li key={p.signature} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span>
                  Round {p.round} · {p.xUsername ? `@${p.xUsername}` : <HexValue value={p.contributor} label="wallet" head={6} tail={4} />}
                </span>
                <span className="text-success font-mono tabular-nums">{rloText(p.amount)}</span>
                <HexValue value={p.signature} href={`/tx/${p.signature}`} label="payout" head={8} tail={0} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState art="coins" className="py-8">
            Nothing paid yet. Approved work is paid when its round settles.
          </EmptyState>
        )}
      </Section>
    </div>
  );
}
