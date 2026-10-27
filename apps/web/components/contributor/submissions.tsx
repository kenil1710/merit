"use client";

import { ChevronDown, ExternalLink, FileCheck2, Gavel, MessageSquare, ShieldCheck, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { RexProof } from "@/components/campaign/decisions";
import { HexValue } from "@/components/hex-value";
import { Stepper, type Step } from "@/components/ui-kit/stepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatRlo } from "@/lib/merit/constants";
import type { ContributorItem, Shown } from "@/lib/server/contributor-view";
import { cn } from "@/lib/utils";

const SHOWN: Record<Shown, [string, string]> = {
  reviewing: ["Being reviewed", "bg-brand-subtle text-brand-soft"],
  with_team: ["With the team", "bg-warning-subtle text-warning"],
  expired: ["Expired · round closed", "bg-muted text-muted-foreground"],
  rejected: ["Not approved", "bg-danger-subtle text-danger"],
  verifying: ["Approved · verifying", "bg-brand-subtle text-brand-soft"],
  verified: ["Verified · paid at round close", "bg-success-subtle text-success"],
  failed: ["Failed verification", "bg-danger-subtle text-danger"],
  waiting_funds: ["Waiting for funds", "bg-warning-subtle text-warning"],
  paid: ["Paid", "bg-success-subtle text-success"],
};

const POST_URL = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{1,20}(?:[/?#].*)?$/;

/**
 * Submit a link, then every submission as a card: status and amount, the agent's score and reasons, where it is on
 * its way to being paid, the REX proof and payout from the chain, and "ask for a second look" on a rejection.
 */
export function Submissions({
  slug,
  items,
  closed,
  roundLabel,
}: {
  slug: string;
  items: ContributorItem[];
  /** Why new submissions aren't taken right now; shown instead of the form. */
  closed: string | null;
  roundLabel: string | null;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hint = useMemo(() => (!url.trim() ? null : POST_URL.test(url.trim()) ? { ok: true, text: "Looks like an X post." } : { ok: false, text: "Paste a link like x.com/<you>/status/<id>." }), [url]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!hint?.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contributor/submissions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ programSlug: slug, url }) });
      const body = (await res.json()) as { error?: string; status?: string; score?: number };
      if (!res.ok) throw new Error(body.error ?? "Couldn't submit that link.");
      setUrl("");
      toast.success(body.status === "approved" ? `Approved with ${body.score}/100. Validators verify it next.` : body.status === "escalated" ? "Scored; the team reviews it before payment." : "Reviewed. See why below.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-6">
      {closed ? (
        <div className="grid gap-1" data-testid="submissions-closed">
          <h2 className="display text-[1.5rem] leading-tight">Submit your work</h2>
          <p role="status" className="bg-muted/60 rounded-xl px-4 py-3 text-sm">
            {closed}
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="grid min-w-0 gap-2">
          <label htmlFor="submit-url" className="display text-[1.5rem] leading-tight">
            Submit your work
          </label>
          <p className="text-muted-foreground text-sm">This program pays for X posts. One link per submission{roundLabel ? ` · ${roundLabel}` : ""}.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="submit-url" inputMode="url" autoComplete="off" placeholder="https://x.com/you/status/…" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={hint ? !hint.ok : undefined} className="h-10" />
            <Button type="submit" disabled={!hint?.ok || busy} className="h-10">
              {busy ? "Reviewing…" : "Submit"}
            </Button>
          </div>
          <p className={`text-xs ${hint && !hint.ok ? "text-danger" : "text-muted-foreground"}`}>{hint ? hint.text : "The agent checks it's yours and inside the round, scores it and tells you why. About 15 seconds."}</p>
          {error ? (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          ) : null}
        </form>
      )}
      <div className="min-w-0">
        <h2 className="display text-[1.5rem] leading-tight">Your submissions</h2>
        {items.length === 0 ? (
          <p className="text-muted-foreground mt-3 rounded-[1.25rem] border border-dashed px-4 py-10 text-center text-sm">Nothing yet. Paste a link to your first post above.</p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {items.map((i) => (
              <Item key={i.id} i={i} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function journey(i: ContributorItem): Step[] {
  const rejected = i.shown === "rejected";
  const team = i.shown === "with_team";
  const expired = i.shown === "expired";
  const onChain = ["verifying", "verified", "waiting_funds", "paid", "failed"].includes(i.shown);
  return [
    { key: "judged", label: "Scored by the agent", status: i.shown === "reviewing" ? "current" : rejected ? "failed" : "done", icon: Gavel, meta: i.score !== null ? `${i.score}/100` : undefined },
    {
      key: "approved",
      label: expired ? "Its round closed before the team decided, so it can't be paid" : team ? "Waiting for the team's review" : "Approved on chain",
      status: team ? "current" : onChain ? "done" : rejected || expired ? "skipped" : "waiting",
      icon: FileCheck2,
    },
    { key: "verified", label: "Verified by validators (REX)", status: i.shown === "failed" ? "failed" : ["verified", "waiting_funds", "paid"].includes(i.shown) ? "done" : i.shown === "verifying" ? "current" : rejected ? "skipped" : "waiting", icon: ShieldCheck },
    {
      key: "paid",
      label: i.shown === "waiting_funds" ? "Waiting for the team to add funds" : "Paid when the round closes",
      status: i.shown === "paid" ? "done" : i.shown === "verified" || i.shown === "waiting_funds" ? "current" : rejected || i.shown === "failed" ? "skipped" : "waiting",
      icon: Wallet,
      meta: i.shown === "paid" && i.amount ? `${formatRlo(BigInt(i.amount))} RLO` : undefined,
    },
  ];
}

function Item({ i: initial }: { i: ContributorItem }) {
  const [open, setOpen] = useState(false);
  // Shown at once when the contributor sends an appeal; the refreshed page (it re-reads the chain) agrees later.
  const [sent, setSent] = useState<string | null>(null);
  const i = sent && !initial.appeal ? { ...initial, appeal: { note: sent, at: new Date().toISOString(), resolved: false }, canAppeal: false } : initial;
  const [label, tone] = SHOWN[i.shown];
  return (
    <li className="bg-card shadow-soft grid gap-3 rounded-[1.25rem] p-4 sm:p-5" data-testid="submission">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("inline-flex h-6 items-center rounded-md px-2 text-xs font-medium", tone)}>{label}</span>
        <span className="flex items-baseline gap-3">
          {i.score !== null ? (
            <span className="mono-num text-muted-foreground text-xs" data-testid="submission-score">
              score {i.score}/100{i.belowMinimum !== null ? ` · below the minimum ${i.belowMinimum}` : ""}
            </span>
          ) : null}
          {i.amount ? (
            <span className={cn("display text-[1.25rem] leading-none tabular-nums", i.shown === "paid" && "text-success")}>
              {formatRlo(BigInt(i.amount))}
              <span className="text-muted-foreground ml-1 font-sans text-xs">RLO</span>
            </span>
          ) : null}
        </span>
      </div>
      <a href={i.url} target="_blank" rel="noreferrer" className="text-soft hover:text-foreground inline-flex min-w-0 items-center gap-1 text-sm underline-offset-4 hover:underline">
        <span className="truncate font-mono text-xs">{i.url.replace(/^https:\/\//, "")}</span>
        <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
      </a>
      {i.summary ? <p className="text-[15px] leading-relaxed" data-testid="decision-summary">{i.summary}</p> : null}
      {i.reasons.length ? (
        <ul className="text-soft grid list-disc gap-1 pl-5 text-sm leading-relaxed" aria-label="The reviewer's notes">
          {i.reasons.map((r, k) => (
            <li key={k}>{r}</li>
          ))}
        </ul>
      ) : null}
      {i.appeal ? (
        <p className="bg-muted/60 rounded-xl px-3.5 py-2.5 text-sm" data-testid="appeal-sent">
          <MessageSquare className="text-brand mr-1.5 inline size-3.5" aria-hidden="true" />
          {i.appeal.resolved ? "The team answered your request for a second look." : "You asked for a second look. The team will answer with a new decision."}
          <span className="text-muted-foreground mt-1 block text-xs">&ldquo;{i.appeal.note}&rdquo;</span>
        </p>
      ) : i.canAppeal ? (
        <Appeal id={i.id} onSent={setSent} />
      ) : null}
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-xs">
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
        {open ? "Hide details" : "Where it is, and the proof"}
      </button>
      {open ? (
        <div className="grid gap-4 border-t pt-4">
          <Stepper size="sm" label="Where this submission is" steps={journey(i)} />
          {i.chain?.rex ? <RexProof rex={i.chain.rex} /> : null}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
            {i.decisionHash ? (
              <>
                <dt className="text-muted-foreground">Decision hash</dt>
                <dd className="font-mono break-all">
                  {i.decisionHash}
                  {i.chain?.judge ? <span className={i.chain.judge.hashMatches ? "text-success" : "text-danger"}> {i.chain.judge.hashMatches ? "· matches the ledger ✓" : "· doesn't match the ledger"}</span> : null}
                </dd>
              </>
            ) : null}
            {i.chain?.tx.approve ? (
              <>
                <dt className="text-muted-foreground">Approval</dt>
                <dd>
                  <HexValue value={i.chain.tx.approve} href={`/tx/${i.chain.tx.approve}`} label="approval transaction" head={8} tail={0} />
                </dd>
              </>
            ) : null}
            {i.chain?.tx.payout ? (
              <>
                <dt className="text-muted-foreground">Payout</dt>
                <dd>
                  <HexValue value={i.chain.tx.payout} href={`/tx/${i.chain.tx.payout}`} label="payout transaction" head={8} tail={0} />
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}
    </li>
  );
}

function Appeal({ id, onSent }: { id: string; onSent: (note: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <Button variant="outline" size="sm" className="w-fit" onClick={() => setOpen(true)}>
        Ask for a second look
      </Button>
    );
  return (
    <form
      className="bg-muted/50 grid gap-2 rounded-xl p-3.5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await fetch(`/api/contributor/submissions/${id}/appeal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note }) });
        setBusy(false);
        if (!res.ok) return setError(((await res.json()) as { error?: string }).error ?? "Couldn't send that.");
        toast.success("Sent. The team will take a second look.");
        onSent(note.trim());
        router.refresh();
      }}
    >
      <label htmlFor={`appeal-${id}`} className="text-sm font-medium">
        Why should the team look again?
      </label>
      <Textarea id={`appeal-${id}`} rows={2} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. The thread continues in the replies; the first post links the full write-up." />
      <p className="text-muted-foreground text-xs">Once per submission. The team answers with a new, signed decision.</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!note.trim() || busy}>
          {busy ? "Sending…" : "Send"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}
    </form>
  );
}
