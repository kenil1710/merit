import Link from "next/link";
import { RoundStatusPill } from "@/components/rounds/round-status";
import { EmptyState, Notice, PageHeader, TableFrame } from "@/components/ui-kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rloText, utc } from "@/lib/format";
import { loadState } from "@/lib/merit/chain";
import { rpc } from "@/lib/server/agent";
import { campaignView } from "@/lib/server/campaign-view";
import { memberProgram } from "@/lib/server/owner-page";
import { roundRows } from "@/lib/server/program-pages";

export const metadata = { title: "Rounds" };

/** Every round: its window, status (from the chain), submissions, approvals and payouts (Misthos' rounds page). */
export default async function RoundsPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, program, base } = await memberProgram((await params).id);
  let chainError = false;
  const [state, view] = program.campaignAddress
    ? await Promise.all([loadState(rpc, program.campaignAddress), campaignView(program.campaignAddress)]).catch(() => {
        chainError = true;
        return [null, null] as const;
      })
    : [null, null];
  const rows = await roundRows(db, program.id, view, state);
  return (
    <div className="grid gap-6">
      <PageHeader
        crumbs={[{ label: program.name, href: base }, { label: "Rounds" }]}
        title="Rounds"
        description="Each round closes, settles and pays on its own timers. Open one for every approval, its REX verdict and the payout transaction."
      />
      {chainError ? <Notice tone="warning">Rialo DevNet didn&apos;t answer just now; round statuses may be missing.</Notice> : null}
      {rows.length === 0 ? (
        <EmptyState art="seal" title="No rounds yet" action={program.campaignAddress ? undefined : { label: "Go live", href: `${base}/setup` }}>
          Round 1 opens when the campaign goes live. Rounds then follow each other until the refund deadline.
        </EmptyState>
      ) : (
        <TableFrame>
          <Table data-testid="rounds">
            <TableHeader>
              <TableRow>
                <TableHead>Round</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Window</TableHead>
                <TableHead className="text-right">Submitted</TableHead>
                <TableHead className="text-right">Approved</TableHead>
                <TableHead className="text-right">Paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.number}>
                  <TableCell>
                    <Link href={`${base}/rounds/${r.number}`} className="font-medium underline-offset-4 hover:underline">
                      Round {r.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <RoundStatusPill status={r.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {utc(r.startsAt)} → {utc(r.endsAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.submissions}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.approved}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{r.paid === "0" ? (r.owed !== "0" ? `${rloText(r.owed)} owed` : "—") : rloText(r.paid)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
      )}
    </div>
  );
}
