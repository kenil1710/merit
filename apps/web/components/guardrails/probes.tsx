"use client";

import { FlaskConical, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ProbeKey, ProbeResult } from "@/lib/server/latch-probes";
import { cn } from "@/lib/utils";

export type ProbeInfo = { key: ProbeKey; label: string; rule: string; step: string };

function Result({ r }: { r: ProbeResult & { error?: string } }) {
  if (r.error) return <p className="text-danger">{r.error}</p>;
  return (
    <div className="grid gap-2">
      <p className="font-mono text-xs break-all">
        {r.request.method} {r.request.path}
        {r.request.campaignHeader ? "" : "  (no X-Merit-Campaign)"}
      </p>
      {r.outcome === "denied" ? (
        <p>
          <span className="bg-danger-subtle text-danger mr-2 inline-flex h-5 items-center rounded-md px-1.5 font-mono text-xs font-medium">{r.status}</span>
          deniedBy <span className="font-mono">{r.deniedBy}</span>: {r.reason}
          {r.requestId ? <span className="text-muted-foreground font-mono text-xs"> · {r.requestId}</span> : null}
        </p>
      ) : r.outcome === "allowed" ? (
        <p className="text-warning">Latch let it through (status {r.status}): the enclave rule isn&apos;t installed.</p>
      ) : r.outcome === "would-allow" ? (
        <p className="text-warning">Latch would allow this today: the rule isn&apos;t installed yet. Nothing was sent.</p>
      ) : (
        <p className="text-danger">{r.reason}</p>
      )}
      {r.trace.length ? (
        <ol className="text-muted-foreground grid gap-0.5 font-mono text-xs">
          {r.trace.map((s, i) => (
            <li key={i} className={cn(s.decision === "deny" && "text-danger")}>
              {i + 1}. {s.filterName} <span className="opacity-70">({s.filterType})</span> · {s.decision}
              {s.reason ? `: ${s.reason}` : ""}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** One button per rule: Latch is asked first, and only a request it denies is sent, so a probe never spends. */
export function Probes({ probes }: { probes: ProbeInfo[] }) {
  const [busy, setBusy] = useState<ProbeKey | null>(null);
  const [results, setResults] = useState<Partial<Record<ProbeKey, ProbeResult & { error?: string }>>>({});
  async function run(key: ProbeKey) {
    setBusy(key);
    try {
      const res = await fetch("/api/guardrails/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ probe: key }) });
      const body = (await res.json()) as ProbeResult & { error?: string };
      setResults((r) => ({ ...r, [key]: res.ok ? body : ({ error: body.error ?? `Failed (${res.status})`, trace: [] } as never) }));
    } catch {
      setResults((r) => ({ ...r, [key]: { error: "Network error.", trace: [] } as never }));
    } finally {
      setBusy(null);
    }
  }
  return (
    <ul className="grid gap-3">
      {probes.map((p) => (
        <li key={p.key} className="bg-muted/50 grid gap-3 rounded-xl p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{p.label}</p>
              <p className="text-muted-foreground text-xs">
                {p.rule} · {p.step}
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run(p.key)} aria-label={`Try: ${p.label}`}>
              {busy === p.key ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" strokeWidth={1.5} />}
              Try it
            </Button>
          </div>
          {results[p.key] ? (
            <div aria-live="polite" data-testid={`probe-${p.key}`}>
              <Result r={results[p.key]!} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
