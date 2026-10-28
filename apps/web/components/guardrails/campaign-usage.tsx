import Link from "next/link";
import { EmptyState, Section, TableFrame } from "@/components/ui-kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usageLabel, type CampaignUsage } from "@/lib/server/latch-usage";

const short = (a: string) => (a.length > 20 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
export const cents = (c: number) => (c < 0.01 && c > 0 ? "<0.01¢" : `${c.toFixed(2)}¢`);

function Counts({ s }: { s: { calls: number; allowed: number; denied: number; failed: number; child: boolean } }) {
  if (s.calls === 0) return <span className="text-muted-foreground">none</span>;
  return (
    <span className="tabular-nums">
      {s.calls}
      <span className="text-muted-foreground">
        {" "}· {s.allowed} ok{s.denied ? ` · ${s.denied} denied` : ""}
        {s.failed ? ` · ${s.failed} other` : ""}
      </span>
      {s.child ? <span className="bg-brand-subtle text-brand ml-1.5 rounded px-1 text-[11px]">own latch</span> : null}
    </span>
  );
}

/** Merit's latch calls grouped by the X-Merit-Campaign header they carried. */
export function CampaignUsageTable({ usage, window, readAt }: { usage: CampaignUsage[]; window: "today" | "7d"; readAt: Date }) {
  const tab = (w: "today" | "7d", label: string) =>
    w === window ? (
      <span className="bg-muted rounded-md px-2 py-1 font-medium">{label}</span>
    ) : (
      <Link href={w === "today" ? "/guardrails#per-campaign" : "/guardrails?window=7d#per-campaign"} className="text-muted-foreground hover:text-foreground rounded-md px-2 py-1">
        {label}
      </Link>
    );
  return (
    <Section
      title="Per campaign"
      description={`Every call Merit sends names its campaign in the X-Merit-Campaign header, which both latches require. Latch's audit log keeps no headers, so this is Merit's own log of the same calls, grouped by that header, and every count and spend on this page comes from it. Spend uses merit-judge's own pricing; REX validators' reads go straight to merit-x and show only in its audit. Times are UTC: "Today" is since 00:00 UTC, read at ${readAt.toISOString().slice(11, 19)} UTC.`}
      actions={
        <div id="per-campaign" className="flex scroll-mt-24 gap-1 text-sm">
          {tab("today", "Today (UTC)")}
          {tab("7d", "7 days")}
        </div>
      }
    >
      {usage.length === 0 ? (
        <EmptyState title="No calls yet">No call through merit-judge or merit-x {window === "today" ? "since 00:00 UTC" : "in the last 7 days"}.</EmptyState>
      ) : (
        <TableFrame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Campaign</TableHead>
                <TableHead>merit-judge</TableHead>
                <TableHead className="text-right">Judge spend</TableHead>
                <TableHead>merit-x</TableHead>
                <TableHead className="pr-4">Denied by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.map((u) => (
                <TableRow key={u.campaign}>
                  <TableCell className="pl-4">
                    <p className="font-medium">{usageLabel(u)}</p>
                    <p className="text-muted-foreground font-mono text-xs" title={u.campaign}>
                      {short(u.campaign)}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm"><Counts s={u.judge} /></TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{cents(u.judge.cents)}</TableCell>
                  <TableCell className="text-sm"><Counts s={u.x} /></TableCell>
                  <TableCell className="pr-4 font-mono text-xs">
                    {u.deniedBy.length ? u.deniedBy.map((d) => <p key={`${d.latch}${d.filter}`}>{d.latch.replace("merit-", "")} · {d.filter} ×{d.count}</p>) : <span className="text-muted-foreground font-sans text-sm">none</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
      )}
    </Section>
  );
}
