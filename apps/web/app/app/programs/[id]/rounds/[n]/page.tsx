import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DecisionsTable } from "@/components/campaign/decisions";
import { HexValue } from "@/components/hex-value";
import { StatusPill } from "@/components/review/review-drawer";
import { RoundStatusPill } from "@/components/rounds/round-status";
import { Card, EmptyState, PageHeader, Section } from "@/components/ui-kit";
import { rloText, utc } from "@/lib/format";
import { loadState } from "@/lib/merit/chain";
import { rpc } from "@/lib/server/agent";
import { campaignView } from "@/lib/server/campaign-view";
import { memberProgram } from "@/lib/server/owner-page";
import { roundRows, roundSubmissions } from "@/lib/server/program-pages";

export const metadata = { title: "Round" };

/** One round for the team: window, status, what was submitted, the on-chain approvals and payouts. */
export default async function RoundPage({ params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const number = Number(n);
  if (!Number.isInteger(number) || number < 1) notFound();
  const { db, program, base } = await memberProgram(id);
  const [state, view] = program.campaignAddress ? await Promise.all([loadState(rpc, program.campaignAddress), campaignView(program.campaignAddress)]).catch(() => [null, null] as const) : [null, null];
  const row = (await roundRows(db, program.id, view, state)).find((r) => r.number === number);
  if (!row) notFound();
  const chain = view?.rounds.find((r) => r.round === number);
  const subs = await roundSubmissions(db, program.id, number);
  return (
    <div className="grid gap-8">
      <PageHeader
        crumbs={[{ label: program.name, href: base }, { label: "Rounds", href: `${base}/rounds` }, { label: `Round ${number}` }]}
        title={`Round ${number}`}
        meta={<RoundStatusPill status={row.status} />}
        description={`${utc(row.startsAt)} → ${utc(row.endsAt)}`}
        actions={
          <Link href={`/p/${program.slug}/rounds/${number}`} className="text-soft hover:text-foreground inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline">
            Public receipt <ArrowUpRight className="size-3.5" strokeWidth={1.5} />
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Submitted" value={String(row.submissions)} />
        <Tile label="Approved on chain" value={String(row.approved)} />
        <Tile label="Paid" value={rloText(row.paid)} />
        <Tile label="Still owed" value={row.owed === "0" ? "—" : rloText(row.owed)} />
      </div>
      {chain?.ledger ? (
        <Card title="On chain">
          <p className="text-sm">
            Round ledger <HexValue value={chain.ledger} label="round ledger" />, written by the agent {chain.agent ? <HexValue value={chain.agent} label="agent" head={6} tail={4} /> : null}. Each entry holds the decision record&apos;s hash.
          </p>
        </Card>
      ) : null}
      <Section title="Approvals" description="Open a row for the judge's reasons, the validators' REX proof and every transaction.">
        {chain?.decisions.length ? <DecisionsTable decisions={chain.decisions} round={number} /> : <EmptyState className="py-8">Nothing was approved on chain in round {number}.</EmptyState>}
      </Section>
      <Section title="Submitted in this round">
        {subs.length ? (
          <ul className="bg-card shadow-soft divide-y rounded-[1.25rem]" data-testid="round-submissions">
            {subs.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                <StatusPill status={s.status} />
                <span className="font-medium">@{s.xHandle}</span>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs underline-offset-4 hover:underline">
                  post …{s.postId.slice(-6)}
                </a>
                <span className="text-muted-foreground text-xs">{utc(s.createdAt.toISOString())}</span>
                <span className="font-mono tabular-nums">{s.amount ? rloText(s.amount) : "—"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState className="py-8">No submissions were recorded for round {number}.</EmptyState>
        )}
      </Section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card shadow-soft rounded-2xl p-4">
      <p className="label">{label}</p>
      <p className="display mt-1.5 text-2xl leading-none tabular-nums">{value}</p>
    </div>
  );
}
