import Link from "next/link";
import { HexValue } from "@/components/hex-value";
import { EmptyState, PageHeader } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { utc } from "@/lib/format";
import { memberProgram } from "@/lib/server/owner-page";
import { auditRows, type AuditFilters } from "@/lib/server/program-pages";
import { cn } from "@/lib/utils";

export const metadata = { title: "Audit log" };

const ACTOR_TONE: Record<string, string> = { agent: "bg-brand-subtle text-brand-soft", people: "bg-secondary text-foreground", chain: "bg-warning-subtle text-warning" };

const summary = (data: Record<string, unknown>) => {
  const changes = Object.entries(data).filter(([, v]) => v && typeof v === "object" && "from" in (v as object) && "to" in (v as object));
  if (changes.length) return changes.map(([k, v]) => `${k}: ${String((v as { from: unknown }).from)} → ${String((v as { to: unknown }).to)}`).join(" · ");
  return ["reason", "line", "rule", "error", "postId", "wallet"].map((k) => (typeof data[k] === "string" ? String(data[k]) : null)).find(Boolean) ?? null;
};

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

/** Append-only: who did what and when, from the database (it refuses edits) and the owner's checked chain actions. */
export default async function AuditPage({ params, searchParams }: Props) {
  const { db, program, base } = await memberProgram((await params).id);
  const sp = await searchParams;
  const filters: AuditFilters = {
    actor: sp.actor === "agent" || sp.actor === "people" || sp.actor === "chain" ? sp.actor : undefined,
    kind: sp.kind && /^[a-z_]{1,30}$/.test(sp.kind) ? sp.kind : undefined,
    from: sp.from,
    to: sp.to,
  };
  const { rows, kinds } = await auditRows(db, program.id, filters);
  const filtered = Object.values(filters).some(Boolean);
  return (
    <div className="grid gap-6">
      <PageHeader
        crumbs={[{ label: program.name, href: base }, { label: "Audit log" }]}
        title="Audit log"
        description="Every decision, override, setting and fund move. The database refuses to edit or delete these rows."
      />
      <form method="get" className="bg-card shadow-soft flex flex-wrap items-end gap-3 rounded-[1.25rem] p-4 text-sm" aria-label="Filter the audit log">
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">Who</span>
          <select name="actor" defaultValue={filters.actor ?? ""} className="bg-background h-9 rounded-lg border px-2">
            <option value="">Everyone</option>
            <option value="agent">The agent</option>
            <option value="people">People</option>
            <option value="chain">On-chain actions</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">Kind</span>
          <select name="kind" defaultValue={filters.kind ?? ""} className="bg-background h-9 rounded-lg border px-2">
            <option value="">Any</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">From</span>
          <input type="date" name="from" defaultValue={filters.from} className="bg-background h-9 rounded-lg border px-2" />
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">To</span>
          <input type="date" name="to" defaultValue={filters.to} className="bg-background h-9 rounded-lg border px-2" />
        </label>
        <Button type="submit" className="h-9">
          Filter
        </Button>
        {filtered ? (
          <Link href="?" className="text-soft text-sm underline underline-offset-4">
            Clear filters
          </Link>
        ) : null}
      </form>
      {rows.length === 0 ? (
        <EmptyState art="seal" title={filtered ? "Nothing matches" : "Nothing yet"} action={filtered ? { label: "Clear filters", href: "?" } : undefined}>
          {filtered ? "No event matches these filters." : "Events appear as the program is created, contributors join and the agent decides."}
        </EmptyState>
      ) : (
        <ul className="bg-card shadow-soft divide-y rounded-[1.25rem]" data-testid="audit-rows">
          {rows.map((r) => {
            const s = summary(r.data);
            return (
              <li key={r.id} className="grid gap-x-4 gap-y-1 px-5 py-3 text-sm sm:grid-cols-[10.5rem_7rem_minmax(0,1fr)_auto] sm:items-center">
                <span className="text-muted-foreground font-mono text-xs">{utc(r.at)}</span>
                <span className={cn("w-fit truncate rounded-md px-1.5 py-0.5 text-xs font-medium", ACTOR_TONE[r.actorKind])}>{r.actor.startsWith("@") || r.actorKind !== "people" ? r.actor : `${r.actor.slice(0, 6)}…`}</span>
                <span className="min-w-0">
                  <span className="font-mono text-xs">{r.action}</span>
                  {s ? <span className="text-soft block truncate text-[13px]">{s}</span> : null}
                </span>
                {r.signature ? <HexValue value={r.signature} href={`/tx/${r.signature}`} label="transaction" head={8} tail={0} /> : <span />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
