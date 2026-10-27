import type { Snapshot, TraceStep } from "@/lib/server/latch-probes";
import { cn } from "@/lib/utils";

const VOLATILE = new Set(["remaining", "resetMs", "refunded", "durable", "bodyBytes", "method", "path", "evaluationMs"]);

/** One line per filter, from Latch's own trace metadata. */
export function describeStep(s: TraceStep): string {
  const m = s.metadata ?? {};
  switch (s.filterType) {
    case "method":
      return `allowed ${(m.allowed as string[] | undefined)?.join(", ") ?? "?"}`;
    case "endpoint":
      return `${m.mode ?? "allowlist"} ${(m.patterns as string[] | undefined)?.join("  ") ?? ""}`;
    case "rate_limit":
      return `${m.limit} per ${m.windowSeconds}s · ${m.keyBy}${m.jsonPath ? ` ${m.jsonPath}` : ""}${m.counting ? ` · ${m.counting}` : ""}`;
    case "body_size":
      return `max ${m.maxBytes} bytes`;
    case "payload":
      return `${m.rulesChecked ?? "?"} rules on the body`;
    default: {
      const rest = Object.entries(m).filter(([k]) => !VOLATILE.has(k));
      return rest.length ? JSON.stringify(Object.fromEntries(rest)).slice(0, 160) : "";
    }
  }
}

type Caps = { payloadRules?: { path: string; operator: string; value?: unknown }[]; costBudget?: { maxDailyCents?: number } | null; cedar?: unknown[]; customCode?: unknown[] };

/** Every filter in a latch's pipeline, in order, as Latch reported it, plus what runs after the upstream. */
export function FilterList({ snapshot, caps }: { snapshot: Snapshot | null; caps: Caps }) {
  if (!snapshot) return <p className="text-muted-foreground text-sm">The pipeline couldn&apos;t be read right now.</p>;
  return (
    <div className="grid gap-2">
      <ol className="grid gap-1.5 text-sm">
        {snapshot.trace.map((s, i) => (
          <li key={`${s.filterName}${i}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
            <span className="text-muted-foreground font-mono text-xs leading-5 tabular-nums">{i + 1}</span>
            <span className="min-w-0">
              <span className="font-mono text-xs font-medium">{s.filterName}</span>
              <span className="text-muted-foreground font-mono text-xs"> · {s.filterType}</span>
              <span className={cn("block font-mono text-xs break-all", s.decision === "deny" ? "text-danger" : "text-soft")}>
                {describeStep(s)}
                {s.decision === "deny" ? ` (denied the sample request: ${s.reason})` : s.decision === "skip" && s.reason ? `${describeStep(s) ? " · " : ""}${s.reason}` : ""}
              </span>
            </span>
          </li>
        ))}
        {caps.costBudget?.maxDailyCents !== undefined && !snapshot.trace.some((s) => s.filterType === "spend_limit") ? (
          <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
            <span className="text-muted-foreground font-mono text-xs leading-5">$</span>
            <span className="font-mono text-xs">
              <span className="font-medium">spend_limit</span> · {caps.costBudget.maxDailyCents}¢ a day, metered by the proxy
            </span>
          </li>
        ) : null}
      </ol>
      <p className="text-muted-foreground text-xs">
        Read {snapshot.readAt.replace("T", " ").slice(0, 16)} UTC from Latch&apos;s own trace of an allowed{" "}
        <span className="font-mono">/latch-self/authorize</span> (refreshed every 6 hours; it never calls the upstream).
        {snapshot.authorized ? "" : ` The trace stops at ${snapshot.deniedBy}, which denied the sample request.`} A response filter is listed in order but
        checks the upstream&apos;s reply, after the call.
      </p>
    </div>
  );
}
