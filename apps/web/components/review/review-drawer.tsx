"use client";

import { BadgeCheck, ExternalLink, FileCheck2, Gavel, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RexProof } from "@/components/campaign/decisions";
import { HexValue } from "@/components/hex-value";
import { ConfirmDialog } from "@/components/ui-kit/confirm-dialog";
import { Disclosure } from "@/components/ui-kit/disclosure";
import { Stepper, type Step } from "@/components/ui-kit/stepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { rlo, rloInput, tryParseRlo } from "@/lib/program-math";
import type { reviewDetail } from "@/lib/server/review";
import { cn } from "@/lib/utils";

type Detail = NonNullable<Awaited<ReturnType<typeof reviewDetail>>>;
const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

export type Optimistic = { status: "approved" | "rejected"; amount: string | null };

/** The review drawer (Misthos'): where it is, how the agent decided, the proof, and your decision. */
export function ReviewDrawer({ submissionId, onClose, onOptimistic }: { submissionId: string | null; onClose: () => void; onOptimistic?: (id: string, o: Optimistic | null) => void }) {
  return (
    <Sheet open={submissionId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="review-drawer">
        {submissionId ? <DrawerBody key={submissionId} submissionId={submissionId} onOptimistic={onOptimistic} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function journey(d: Detail): Step[] {
  const s = d.submission.status;
  const latest = d.decisions[0];
  const chain = d.chain;
  const failed = chain?.status === "Failed verification" || chain?.status === "Inconclusive";
  const onChain = s === "approved" || s === "partial" || s === "paid";
  return [
    { key: "judged", label: latest?.decidedBy === "human" ? "Decided by the team" : "Judged by the agent", status: latest ? "done" : "current", icon: Gavel, meta: latest?.score != null ? `${latest.score}/100` : undefined },
    {
      key: "approved",
      label: d.submission.expired ? "Expired: its round closed first" : s === "escalated" ? "Waiting for your review" : s === "rejected" ? "Not approved" : "Approved on chain",
      status: onChain ? "done" : d.submission.expired || s === "rejected" ? "failed" : s === "escalated" ? "current" : "waiting",
      icon: FileCheck2,
    },
    { key: "verified", label: "Verified by validators (REX)", status: chain?.status === "Verified" ? "done" : failed ? "failed" : onChain ? "current" : "waiting", icon: ShieldCheck },
    { key: "paid", label: d.submission.waitingForFunds ? "Waiting for funds" : "Paid when the round closes", status: s === "paid" || chain?.tx.payout ? "done" : d.submission.waitingForFunds ? "current" : "waiting", icon: Wallet },
  ];
}

function DrawerBody({ submissionId, onOptimistic }: { submissionId: string; onOptimistic?: (id: string, o: Optimistic | null) => void }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"approve" | "reject" | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/owner/submissions/${submissionId}`, { cache: "no-store" });
    if (!res.ok) return setError("Couldn't load this submission.");
    const d = (await res.json()) as Detail;
    setDetail(d);
    const recommended = d.decisions.find((x) => x.decidedBy === "agent" && BigInt(x.amount) > 0n);
    setAmount((a) => a || (recommended ? rloInput(BigInt(recommended.amount)) : ""));
  }, [submissionId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function post(url: string, body: object, done: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Couldn't save the decision.");
      toast.success(done);
      await load();
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: "approve" | "reject") {
    if (!detail) return;
    const id = detail.submission.id;
    onOptimistic?.(id, { status: action === "approve" ? "approved" : "rejected", amount: action === "approve" ? String(tryParseRlo(amount) ?? 0n) : null });
    const ok = await post(`/api/owner/submissions/${id}/decide`, action === "approve" ? { action, amount, reason } : { action, reason }, action === "approve" ? `Approved ${amount} RLO on chain` : "Rejected");
    if (!ok) onOptimistic?.(id, null);
    else setReason("");
  }

  if (!detail) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>Review submission</SheetTitle>
          <SheetDescription>Loading…</SheetDescription>
        </SheetHeader>
        <div className="grid gap-3 px-5">{error ? <p className="text-danger text-sm">{error}</p> : <Skeleton className="h-40" />}</div>
      </>
    );
  }

  const latest = detail.decisions[0];
  const agent = detail.decisions.find((d) => d.decidedBy === "agent");
  const s = detail.submission.status;
  const onChain = s === "approved" || s === "partial" || s === "paid";
  const canDecide = !!latest && s !== "paid" && s !== "pending" && s !== "processing" && !(detail.submission.expired && s === "rejected");
  const reasonOk = reason.trim().length >= 10;
  const amountKelvin = tryParseRlo(amount);
  const rateKelvin = BigInt(detail.program.rateKelvin);
  const score = amountKelvin !== null && rateKelvin > 0n ? Number((amountKelvin * 100n) / rateKelvin > 100n ? 100n : (amountKelvin * 100n) / rateKelvin) : null;
  const cat = detail.categories.find((k) => k.key === agent?.categoryKey);

  return (
    <>
      <SheetHeader>
        <SheetTitle>Review submission</SheetTitle>
        <SheetDescription>
          @{detail.contributor.xHandle} · {utc(detail.submission.createdAt)}
        </SheetDescription>
      </SheetHeader>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-7 px-5 pb-10 text-sm sm:px-6">
        <div className="bg-muted/60 flex items-center justify-between gap-3 rounded-2xl p-3.5">
          <div className="min-w-0">
            <p className="font-medium">@{detail.contributor.xHandle}</p>
            <a href={detail.submission.url} target="_blank" rel="noreferrer" className="text-muted-foreground inline-flex max-w-full min-w-0 items-center gap-1 text-xs hover:underline">
              <span className="truncate">{detail.submission.url.replace(/^https?:\/\//, "")}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>
          </div>
          <StatusPill status={detail.submission.expired ? "expired" : s} waiting={detail.submission.waitingForFunds} />
        </div>

        {detail.appeal && !detail.appeal.resolvedAt ? (
          <section aria-label="Second look requested" className="bg-warning-subtle rounded-xl px-4 py-3 text-sm" data-testid="appeal-notice">
            <p className="font-medium">@{detail.contributor.xHandle} asked for a second look</p>
            <p className="text-soft mt-1 leading-relaxed">&ldquo;{detail.appeal.note}&rdquo;</p>
            <p className="text-muted-foreground mt-1 text-xs">Your decision below answers it, signed and recorded in the audit log.</p>
          </section>
        ) : null}

        <section aria-labelledby="journey-h">
          <h3 id="journey-h" className="mb-3 font-medium">
            Where it is
          </h3>
          <Stepper size="sm" label="Where this submission is" steps={journey(detail)} />
          {!latest && detail.submission.lastError ? <p className="text-soft mt-3">Waiting: {detail.submission.lastError}</p> : null}
        </section>

        {latest ? (
          <section aria-labelledby="trace-h" className="grid gap-4">
            <h3 id="trace-h" className="font-medium">
              {latest.decidedBy === "human" ? "How it was decided" : "How the agent decided"}
            </h3>
            <p className="leading-relaxed" data-testid="drawer-summary">
              {latest.summary}
            </p>
            {agent?.llm?.rubric_scores && cat ? (
              <div className="bg-muted/50 grid gap-2.5 rounded-xl p-3.5" data-testid="scores">
                {cat.criteria.map((k) => {
                  const v = agent.llm!.rubric_scores![k.key] ?? 0;
                  return (
                    <div key={k.key} className="grid grid-cols-[7rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-xs">
                      <span className="text-soft truncate">{k.name}</span>
                      <span className="bg-muted h-1.5 overflow-hidden rounded-full">
                        <span className="bg-brand block h-full rounded-full" style={{ width: `${v * 10}%` }} />
                      </span>
                      <span className="mono-num text-right">{v}/10</span>
                    </div>
                  );
                })}
                <p className="text-muted-foreground text-xs">
                  {typeof agent.llm.confidence === "number" ? `Confidence ${Math.round(agent.llm.confidence * 100)}% · ` : ""}
                  {agent.points ?? "0"} points · score {agent.score ?? 0}/100
                </p>
              </div>
            ) : null}
            {agent?.llm?.reasons?.length ? (
              <ul className="text-soft grid list-disc gap-1 pl-5 leading-relaxed">
                {agent.llm.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : null}
            {latest.flags.length ? (
              <ul className="grid gap-1.5" aria-label="Checks raised">
                {latest.flags.map((f, i) => (
                  <li key={i} className={cn("rounded-lg px-3 py-2 text-xs", f.severity === "hard" ? "bg-danger-subtle text-danger" : "bg-warning-subtle text-warning")}>
                    <span className="font-mono font-medium">{f.code}</span> · {f.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="text-muted-foreground grid gap-1 text-xs" data-testid="signed-record">
              <span className="inline-flex items-center gap-1.5">
                {latest.verified ? <BadgeCheck className="text-success size-3.5" aria-hidden="true" /> : null}
                {latest.verified ? "Signed decision record, signature verified" : "Unsigned decision record"} · <span className="font-mono">{latest.rule ?? latest.ruleVersion}</span>
              </span>
              <span className="font-mono break-all">{latest.decisionHash}</span>
              {latest.signer ? (
                <span>
                  Signed by <HexValue value={latest.signer} label="signer" head={6} tail={4} />
                </span>
              ) : null}
            </div>
          </section>
        ) : null}

        {detail.chain?.rex ? (
          <section aria-labelledby="rex-h" className="grid gap-3">
            <h3 id="rex-h" className="font-medium">
              Validators&apos; proof
            </h3>
            <RexProof rex={detail.chain.rex} />
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
              {detail.chain.tx.approve ? (
                <>
                  <dt className="text-muted-foreground">Approval</dt>
                  <dd>
                    <HexValue value={detail.chain.tx.approve} href={`/tx/${detail.chain.tx.approve}`} label="approval" head={8} tail={0} />
                  </dd>
                </>
              ) : null}
              {detail.chain.tx.payout ? (
                <>
                  <dt className="text-muted-foreground">Payout</dt>
                  <dd>
                    <HexValue value={detail.chain.tx.payout} href={`/tx/${detail.chain.tx.payout}`} label="payout" head={8} tail={0} />
                  </dd>
                </>
              ) : null}
            </dl>
          </section>
        ) : null}

        {detail.content ? (
          <Disclosure title="What was submitted" className="border-t pt-4">
            <pre className="bg-muted mt-2 max-h-72 overflow-auto rounded-xl p-3 font-sans text-[13px] whitespace-pre-wrap">
              {detail.content.text}
              {detail.content.truncated ? "\n…" : ""}
            </pre>
          </Disclosure>
        ) : null}

        {onChain ? (
          <p className="text-muted-foreground border-t pt-5 text-sm">
            {s === "paid"
              ? "Paid on chain. Payouts are final."
              : "Approved on chain, so the program pays it when the round settles (if validators verify it). Until then you can take it back: reject it with a reason and the agent revokes the approval on chain."}
          </p>
        ) : null}

        {detail.submission.expired ? (
          <p className="text-muted-foreground border-t pt-5 text-sm" data-testid="expired-note">
            Expired: round {detail.submission.round} closed before anyone decided, and the program only pays work from the round it was written in, so it can&apos;t be approved any more. You can still reject it with a reason, which the contributor sees.
          </p>
        ) : null}

        {canDecide ? (
          <section className="grid gap-3 border-t pt-5" data-testid="decide">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">Your decision</h3>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => post(`/api/owner/submissions/${detail.submission.id}/reprocess`, { reason: "Re-run by the team" }, "Re-processed")}>
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Re-process
              </Button>
            </div>
            {!detail.submission.expired && !onChain ? (
              <div className="grid gap-1.5">
                <Label htmlFor="ov-amount">Amount (RLO)</Label>
                <Input id="ov-amount" inputMode="decimal" className="max-w-40 font-mono tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <p className="text-muted-foreground text-xs">
                  {score !== null ? `A score of ${score}/100 on chain. ` : ""}Up to {rlo(BigInt(detail.program.maxPerPayout))} (per-payout cap); the program pays from {detail.program.minScore}/100.
                </p>
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="ov-reason">Reason</Label>
              <Textarea id="ov-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
              <p className="text-muted-foreground text-xs">
                {reasonOk ? "Saved in the signed record and the audit log, and shown to the contributor." : `At least 10 characters (${reason.trim().length}/10).`}
              </p>
            </div>
            {error ? (
              <p role="alert" className="text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              {!detail.submission.expired && !onChain ? (
                <Button disabled={busy || !reasonOk || !amountKelvin} onClick={() => setConfirming("approve")}>
                  {s === "rejected" ? "Override and approve" : agent && amountKelvin !== null && BigInt(agent.amount) !== amountKelvin && agent.amount !== "0" ? "Adjust and approve" : "Approve"}
                </Button>
              ) : null}
              {s !== "rejected" ? (
                <Button variant="outline" disabled={busy || !reasonOk} onClick={() => setConfirming("reject")}>
                  {onChain ? "Take back (revoke)" : "Reject"}
                </Button>
              ) : null}
            </div>
            <ConfirmDialog
              open={confirming !== null}
              onOpenChange={(o) => !o && setConfirming(null)}
              title={confirming === "approve" ? `Approve ${amount} RLO?` : "Reject this submission?"}
              description={
                confirming === "approve"
                  ? "The agent approves it on chain now; validators verify the post, and the program pays it when the round closes."
                  : "The contributor sees your reason and can ask for a second look."
              }
              rows={[
                ...(confirming === "approve" ? [{ label: "Amount", value: `${amount} RLO (score ${score ?? "?"}/100)` }] : []),
                ...(agent ? [{ label: "Agent recommended", value: agent.amount !== "0" ? rlo(BigInt(agent.amount)) : "Nothing" }] : []),
                { label: "Reason", value: reason },
              ]}
              confirmLabel={confirming === "approve" ? "Approve" : "Reject"}
              destructive={confirming === "reject"}
              onConfirm={() => {
                const a = confirming;
                setConfirming(null);
                if (a) void decide(a);
              }}
            />
          </section>
        ) : null}

        {detail.decisions.length > 1 ? (
          <section>
            <h3 className="font-medium">History</h3>
            <ol className="mt-2 grid gap-2" data-testid="history">
              {detail.decisions.map((d) => (
                <li key={d.id} className="text-muted-foreground text-xs">
                  {utc(d.createdAt)} · {d.decidedBy} · {d.action} · <span className="font-mono">{d.decisionHash.slice(0, 10)}…</span>
                  {d.overrideReason ? <div className="text-foreground mt-0.5">“{d.overrideReason}”</div> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </>
  );
}

const PILL: Record<string, [string, string]> = {
  pending: ["Queued", "bg-muted text-muted-foreground"],
  processing: ["Reviewing", "bg-muted text-muted-foreground"],
  escalated: ["Needs review", "bg-warning-subtle text-warning"],
  expired: ["Expired", "bg-muted text-muted-foreground"],
  approved: ["Approved", "bg-brand-subtle text-brand-soft"],
  partial: ["Partial", "bg-brand-subtle text-brand-soft"],
  rejected: ["Rejected", "bg-danger-subtle text-danger"],
  paid: ["Paid", "bg-success-subtle text-success"],
};

export function StatusPill({ status, waiting }: { status: string; waiting?: boolean }) {
  const [label, tone] = waiting ? ["Waiting for funds", "bg-warning-subtle text-warning"] : (PILL[status] ?? [status, "bg-muted"]);
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-xs font-medium whitespace-nowrap", tone)}>{label}</span>;
}
