import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { formatRlo } from "@/lib/merit/constants";
import { setupCurrent, setupSteps } from "@/lib/setup-flow";
import type { Need, ProgramSummary } from "@/lib/server/program-summary";
import { ProgramStatus } from "./program-status";
import { RoundPill } from "./owner-shell";

/** One program on the owner's home: status, round, escrow, and the next setup step while it isn't live. */
export function ProgramCard({ s }: { s: ProgramSummary }) {
  const { program: p, state } = s;
  const current = setupCurrent(s.setup);
  const steps = setupSteps(s.setup).filter((x) => x.status !== "skipped");
  const done = steps.filter((x) => x.status === "done").length;
  return (
    <Link href={`/app/programs/${p.id}`} className="bg-card shadow-soft hover:shadow-lift group grid content-start gap-4 rounded-[1.25rem] p-5 transition-shadow" data-testid="program-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{p.name}</p>
          <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">/join/{p.slug}</p>
        </div>
        <ProgramStatus status={p.status} ended={!!p.endedAt || (state?.phase ?? 0n) >= 4n} />
      </div>
      {current === "live" ? (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="label">Escrow</p>
            <p className="mono-num mt-1">{state ? `${formatRlo(state.escrowKelvin, 3)} RLO` : "—"}</p>
          </div>
          <div>
            <p className="label">Paid</p>
            <p className="mono-num text-success mt-1">{state ? `${formatRlo(state.totalPaid, 3)} RLO` : "—"}</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden="true">
            <div className="bg-brand h-full rounded-full" style={{ width: `${Math.max(6, (done / steps.length) * 100)}%` }} />
          </div>
          <p className="text-soft text-sm">
            {done} of {steps.length} setup steps done
          </p>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        {s.roundPill ? <RoundPill pill={s.roundPill} className="h-7 text-xs" /> : <span className="text-muted-foreground text-xs">Not on chain yet</span>}
        <ArrowRight className="text-muted-foreground group-hover:text-foreground size-4 transition-colors" aria-hidden="true" />
      </div>
    </Link>
  );
}

/** "Needs you": what to do next across the owner's programs. */
export function NeedsYou({ items, names }: { items: (Need & { programId: string })[]; names: Record<string, string> }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="needs-h" className="bg-card shadow-soft rounded-[1.25rem] p-5">
      <h2 id="needs-h" className="font-medium">
        Needs you
      </h2>
      <ul className="mt-3 divide-y">
        {items.map((n, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
            <span className="min-w-0">
              <span className="text-muted-foreground block text-xs">{names[n.programId]}</span>
              {n.text}
            </span>
            <Link href={n.href} className="text-brand text-sm font-medium underline-offset-4 hover:underline">
              {n.action} →
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
