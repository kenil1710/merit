"use client";

import { ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui-kit/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatRlo } from "@/lib/merit/constants";
import { QUEUE_LABEL_CLIENT, type ReviewRowView } from "./types";
import { StatusPill, type Optimistic } from "./review-drawer";
import { cn } from "@/lib/utils";

const ReviewDrawer = dynamic(() => import("./review-drawer").then((m) => m.ReviewDrawer), { ssr: false });
const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;
const SELECTABLE = new Set(["escalated", "rejected", "expired"]);

/**
 * The owner's submissions as calm rows: status, who, the agent's one-line reason, flags and amount; open one for the
 * drawer. Escalated and rejected rows can be selected for a bulk decision with one reason.
 */
export function ReviewList({ programId, rows }: { programId: string; rows: ReviewRowView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Record<string, Optimistic & { from: string }>>({});

  const shown = rows.map((r) => {
    const o = pending[r.id]?.from === r.status ? pending[r.id] : undefined;
    return o ? { ...r, status: o.status, amount: o.amount ?? r.amount, summary: "Your decision is being signed…", reason: null } : r;
  });
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set(s).add(id)));
  const openRow = (id: string) => {
    setOpened(true);
    setOpen(id);
  };

  async function runBulk(action: "approve" | "reject") {
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/programs/${programId}/review/bulk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [...selected], action, reason }) });
      const body = (await res.json()) as { error?: string; results?: { id: string; ok: boolean; error?: string }[] };
      if (!res.ok) throw new Error(body.error ?? "Couldn't apply that.");
      const done = body.results?.filter((r) => r.ok).length ?? 0;
      const failed = body.results?.filter((r) => !r.ok) ?? [];
      if (done) toast.success(`${action === "approve" ? "Approved" : "Rejected"} ${done} submission${done === 1 ? "" : "s"}`);
      if (failed.length) toast.error(`${failed.length} not changed: ${failed[0]!.error}`);
      setSelected(new Set());
      setReason("");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {selected.size ? (
        <div className="bg-card shadow-lift sticky top-4 z-20 grid gap-3 rounded-[1.25rem] p-4" data-testid="bulk-bar">
          <p className="text-sm font-medium">{selected.size} selected</p>
          <Textarea rows={2} aria-label="Reason for all selected" placeholder="One reason for all of them (10+ characters), shown to each contributor" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || reason.trim().length < 10} onClick={() => setBulk("approve")}>
              Approve at recommended amounts
            </Button>
            <Button size="sm" variant="outline" disabled={busy || reason.trim().length < 10} onClick={() => setBulk("reject")}>
              Reject selected
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}
      <ul className="bg-card shadow-soft divide-border/70 divide-y overflow-hidden rounded-[1.25rem]" data-testid="review-rows">
        {shown.map((r) => (
          <li key={r.id} className="flex items-stretch">
            <label className={cn("flex w-11 shrink-0 items-center justify-center", !SELECTABLE.has(r.status) && "invisible")}>
              <input type="checkbox" className="accent-brand size-4" aria-label={`Select submission by @${r.xHandle}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} disabled={!SELECTABLE.has(r.status)} />
            </label>
            <div
              tabIndex={0}
              role="button"
              aria-label={`Review submission by @${r.xHandle}`}
              onClick={() => openRow(r.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openRow(r.id))}
              className="hover:bg-muted/40 grid min-w-0 flex-1 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 py-4 pr-5 transition-colors sm:grid-cols-[8.5rem_minmax(0,1fr)_auto_auto]"
              data-testid="review-row"
            >
              <span className="hidden sm:block">
                <StatusPill status={r.status} waiting={r.reason === "waiting_funds"} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
                  <span className="sm:hidden">
                    <StatusPill status={r.status} waiting={r.reason === "waiting_funds"} />
                  </span>
                  <span className="font-medium">@{r.xHandle}</span>
                  <span className="text-muted-foreground text-xs">{utc(r.createdAt)}</span>
                  {r.reason ? <span className="bg-warning-subtle text-warning rounded-full px-2 py-0.5 text-[11px]">{QUEUE_LABEL_CLIENT[r.reason]}</span> : null}
                  {r.decidedBy === "human" ? <span className="bg-muted text-soft rounded-full px-2 py-0.5 text-[11px]">Team decision</span> : null}
                </div>
                <p className="text-soft mt-1 line-clamp-1 text-[13px]">{r.summary ?? "Queued"}</p>
                {r.flags.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {r.flags.map((f) => (
                      <span key={f.code} className={cn("rounded-full px-2 py-0.5 font-mono text-[10px]", f.severity === "hard" ? "bg-danger-subtle text-danger" : "bg-warning-subtle text-warning")}>
                        {f.code}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <span className="text-right">
                {r.amount && r.amount !== "0" ? (
                  <span className="display text-xl tabular-nums">
                    {formatRlo(BigInt(r.amount), 3)}
                    <span className="text-muted-foreground ml-1 font-sans text-xs">RLO</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground text-sm">—</span>
                )}
                {r.score !== null ? <span className="text-muted-foreground block text-[11px]">score {r.score}</span> : null}
              </span>
              <ChevronRight className="text-muted-foreground hidden size-4 sm:block" strokeWidth={1.5} aria-hidden="true" />
            </div>
          </li>
        ))}
      </ul>
      {opened ? (
        <ReviewDrawer
          submissionId={open}
          onClose={() => setOpen(null)}
          onOptimistic={(id, o) =>
            setPending((p) => {
              const next = { ...p };
              const from = rows.find((x) => x.id === id)?.status;
              if (o && from) next[id] = { ...o, from };
              else delete next[id];
              return next;
            })
          }
        />
      ) : null}
      <ConfirmDialog
        open={bulk !== null}
        onOpenChange={(o) => !o && setBulk(null)}
        title={bulk === "approve" ? `Approve ${selected.size} at the agent's amounts?` : `Reject ${selected.size}?`}
        description={bulk === "approve" ? "Each is approved on chain now, at the amount the agent recommended; items without one are skipped." : "Each contributor sees your reason and can ask for a second look."}
        rows={[{ label: "Reason", value: reason }]}
        confirmLabel={bulk === "approve" ? "Approve all" : "Reject all"}
        destructive={bulk === "reject"}
        onConfirm={() => {
          const a = bulk;
          setBulk(null);
          if (a) void runBulk(a);
        }}
      />
    </>
  );
}
