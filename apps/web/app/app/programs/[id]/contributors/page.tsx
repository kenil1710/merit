import Link from "next/link";
import { HexValue } from "@/components/hex-value";
import { EmptyState, PageHeader, TableFrame } from "@/components/ui-kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rloText, utc } from "@/lib/format";
import { memberProgram } from "@/lib/server/owner-page";
import { contributorRows } from "@/lib/server/program-pages";
import { cn } from "@/lib/utils";

export const metadata = { title: "Contributors" };

const STATUS_TONE: Record<string, string> = { active: "bg-success-subtle text-success", suspended: "bg-warning-subtle text-warning", removed: "bg-muted text-muted-foreground" };

/** Everyone who joined, with what they sent, what was approved and what they were paid (Misthos' contributors page). */
export default async function ContributorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, program, base } = await memberProgram((await params).id);
  const rows = await contributorRows(db, program.id);
  return (
    <div className="grid gap-6">
      <PageHeader crumbs={[{ label: program.name, href: base }, { label: "Contributors" }]} title="Contributors" description="Everyone who joined with X and linked a payout wallet. Open one for their submissions, payouts and account history." />
      {rows.length === 0 ? (
        <EmptyState art="stack" title="No contributors yet" action={{ label: "Open the join page", href: `/join/${program.slug}` }}>
          Share <span className="font-mono">/join/{program.slug}</span>: contributors sign in with X, link a Rialo wallet and show up here.
        </EmptyState>
      ) : (
        <TableFrame>
          <Table data-testid="contributors">
            <TableHeader>
              <TableRow>
                <TableHead>Contributor</TableHead>
                <TableHead>Wallet</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Submitted</TableHead>
                <TableHead className="text-right">Approved</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Last submission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`${base}/contributors/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                      @{r.xHandle}
                    </Link>
                    <span className="text-muted-foreground block text-xs">joined {utc(r.joinedAt)}</span>
                  </TableCell>
                  <TableCell>{r.wallet ? <HexValue value={r.wallet} label="wallet" head={6} tail={4} /> : "—"}</TableCell>
                  <TableCell>
                    <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium capitalize", STATUS_TONE[r.status])}>{r.status}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.submissions}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.approved}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{r.paid === "0" ? "—" : rloText(r.paid)}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{utc(r.lastAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
      )}
    </div>
  );
}
