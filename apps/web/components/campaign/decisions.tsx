"use client";

import { ChevronRight, ExternalLink, FileCheck2, Gavel, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { HexValue } from "@/components/hex-value";
import { entryStatus, StatusBadge } from "@/components/status-badge";
import { EmptyState, TableFrame } from "@/components/ui-kit";
import { Stepper, type Step } from "@/components/ui-kit/stepper";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRlo } from "@/lib/merit/constants";
import type { DecisionView, RoundView } from "@/lib/server/campaign-view";

const utc = (ms?: number) => (ms ? `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC` : "—");

/** One round's decisions as a table; a row opens the review drawer. */
export function DecisionsTable({ decisions, round }: { decisions: DecisionView[]; round: number }) {
  const [open, setOpen] = useState<DecisionView | null>(null);
  return (
    <>
      <TableFrame>
        <Table aria-label={`Round ${round} decisions`}>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Contributor</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Verification</TableHead>
              <TableHead className="text-right">Payout</TableHead>
              <TableHead className="w-10 pr-5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {decisions.map((d) => (
              <TableRow
                key={d.postId}
                className="cursor-pointer"
                onClick={() => setOpen(d)}
                data-testid="decision-row"
              >
                <TableCell className="pl-5">
                  <div className="font-medium">{d.xUsername ? `@${d.xUsername}` : `X user ${d.xUserId}`}</div>
                  <div className="text-muted-foreground font-mono text-xs">post …{d.postId.slice(-6)}</div>
                </TableCell>
                <TableCell>
                  <span className="display text-2xl tabular-nums">{d.score}</span>
                  <span className="text-muted-foreground text-xs">/100</span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={entryStatus(d.status, false)} />
                    {d.rex?.unanimous ? (
                      <span className="bg-brand-subtle text-brand-soft inline-flex h-5 items-center rounded-md px-1.5 font-mono text-[11px]">
                        REX {d.rex.outputs.length}/{d.rex.outputs.length}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="font-mono tabular-nums">{formatRlo(BigInt(d.amountKelvin))} RLO</div>
                  {d.paid ? <StatusBadge status="paid" className="mt-1" /> : null}
                </TableCell>
                <TableCell className="pr-5">
                  <button
                    type="button"
                    aria-label={`Review decision ${d.index + 1}`}
                    className="text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded-md"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableFrame>
      <DecisionDrawer decision={open} onClose={() => setOpen(null)} />
    </>
  );
}

/**
 * Where an entry is, from the chain first: an entry exists on a ledger only once the agent's approve landed, the REX
 * verdict is its status, and paid is the payout. Nothing here waits on an off-chain record or a transaction link, so a
 * paid entry can never read "in progress".
 */
export function journey(d: Pick<DecisionView, "status" | "paid" | "settled" | "judge" | "score" | "rex" | "amountKelvin">): Step[] {
  const verified = d.status === "Verified" || d.paid;
  const failed = d.status === "Failed verification" || d.status === "Inconclusive" || d.status === "Revoked";
  // A settled round that never got a verdict will not get one: it was skipped, not still verifying.
  const unverified = !verified && !failed && d.settled;
  return [
    { key: "judged", label: "Judged by Claude through merit-judge", status: "done", icon: Gavel, meta: `score ${d.score}/100` },
    { key: "approved", label: "Approved on chain by the agent", status: "done", icon: FileCheck2 },
    {
      key: "verified",
      label: unverified ? "Not verified before the round settled" : "Verified by validators (REX)",
      status: verified ? "done" : failed || unverified ? "failed" : "current",
      icon: ShieldCheck,
      meta: d.rex ? `${d.rex.outputs.length} reports` : undefined,
    },
    {
      key: "paid",
      label: d.paid ? "Paid when the round settled" : d.settled ? "Not paid" : "Paid when the round settles",
      status: d.paid ? "done" : failed || d.settled ? "skipped" : "waiting",
      icon: Wallet,
      meta: d.paid ? `${formatRlo(BigInt(d.amountKelvin))} RLO` : undefined,
    },
  ];
}

export function DecisionDrawer({ decision: d, onClose }: { decision: DecisionView | null; onClose: () => void }) {
  return (
    <Sheet open={d !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {d ? (
          <>
            <SheetHeader>
              <SheetTitle>Decision #{d.index + 1}</SheetTitle>
              <SheetDescription>
                {d.xUsername ? `@${d.xUsername}` : `X user ${d.xUserId}`} · verified {utc(d.verifiedAt)}
              </SheetDescription>
            </SheetHeader>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-7 px-5 pb-10 text-sm sm:px-6" data-testid="decision-drawer">
              <div className="bg-muted/60 flex items-center justify-between gap-3 rounded-2xl p-3.5">
                <div className="min-w-0">
                  <p className="font-medium">{d.xUsername ? `@${d.xUsername}` : `X user ${d.xUserId}`}</p>
                  <a
                    href={`https://x.com/${d.xUsername ?? "i/web"}/status/${d.postId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground inline-flex max-w-full min-w-0 items-center gap-1 text-xs hover:underline"
                  >
                    <span className="truncate">x.com/{d.xUsername ?? "i/web"}/status/{d.postId}</span>
                    <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                  </a>
                </div>
                <StatusBadge status={entryStatus(d.status, d.paid)} />
              </div>

              <section aria-labelledby="journey-h">
                <h3 id="journey-h" className="mb-3 font-medium">Where it is</h3>
                <Stepper steps={journey(d)} size="sm" />
              </section>

              {d.judge?.text ? (
                <section aria-labelledby="content-h">
                  <h3 id="content-h" className="mb-3 font-medium">Content</h3>
                  <blockquote className="bg-muted/40 rounded-xl px-4 py-3 leading-relaxed whitespace-pre-line">{d.judge.text}</blockquote>
                </section>
              ) : null}

              <section aria-labelledby="judge-h">
                <h3 id="judge-h" className="mb-3 font-medium">How the judge decided</h3>
                <div className="flex items-end gap-6">
                  <div>
                    <p className="label">Score</p>
                    <p className="display mt-1 text-5xl leading-none tabular-nums">
                      {d.score}
                      <span className="text-muted-foreground font-sans text-sm">/100</span>
                    </p>
                  </div>
                  <div>
                    <p className="label">Payout</p>
                    <p className="mt-1 font-mono tabular-nums">{formatRlo(BigInt(d.amountKelvin))} RLO</p>
                  </div>
                </div>
                {d.judge ? (
                  <>
                    <ul className="mt-4 list-disc space-y-1 pl-5">
                      {d.judge.reasons.map((r) => <li key={r}>{r}</li>)}
                    </ul>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
                      {Object.entries(d.judge.checks).map(([name, ok]) => (
                        <span key={name} className={ok ? "text-success" : "text-danger"}>
                          {ok ? "✓" : "✗"} {name.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                    <div className={`mt-4 rounded-xl px-4 py-3 ${d.judge.hashMatches ? "bg-success-subtle" : "bg-danger-subtle"}`}>
                      <p className={`font-medium ${d.judge.hashMatches ? "text-success" : "text-danger"}`}>
                        {d.judge.hashMatches ? "Hash matches chain" : "Hash mismatch"}
                      </p>
                      <p className="text-soft mt-1 text-xs leading-relaxed">
                        sha256 of the judge record equals the submission hash the agent wrote into the ledger entry:{" "}
                        <span className="font-mono">{d.submissionHash.slice(0, 10)}…</span>
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground mt-3">No stored judge record; only its hash is on chain.</p>
                )}
              </section>

              <section aria-labelledby="rex-h">
                <h3 id="rex-h" className="mb-3 font-medium">REX proof</h3>
                {d.rex ? <RexProof rex={d.rex} /> : <p className="text-muted-foreground">No validator report yet.</p>}
              </section>

              <section aria-labelledby="tx-h">
                <h3 id="tx-h" className="mb-3 font-medium">Transactions</h3>
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2">
                  <dt className="text-muted-foreground">Approved</dt>
                  <dd>{d.tx.approve ? <HexValue value={d.tx.approve} href={`/tx/${d.tx.approve}`} label="approve transaction" /> : "—"}</dd>
                  <dt className="text-muted-foreground">Verdict</dt>
                  <dd>{d.tx.verdict ? <HexValue value={d.tx.verdict} href={`/tx/${d.tx.verdict}`} label="verdict transaction" /> : "—"}</dd>
                  <dt className="text-muted-foreground">Paid</dt>
                  <dd>{d.tx.payout ? <HexValue value={d.tx.payout} href={`/tx/${d.tx.payout}`} label="payout transaction" /> : d.paid ? "paid (no longer listed by DevNet)" : "—"}</dd>
                  <dt className="text-muted-foreground">Recipient</dt>
                  <dd><HexValue value={d.contributor} label="recipient wallet" /></dd>
                </dl>
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Each validator's REX output, decoded from the processor-owned report account. */
export function RexProof({ rex }: { rex: NonNullable<DecisionView["rex"]> }) {
  const first = rex.outputs[0];
  const [, post, author, created] = first?.ok ? first.payload.split("|") : [];
  return (
    <div className="bg-card shadow-soft rounded-2xl p-4" data-testid="rex-proof">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {rex.unanimous ? (
          <span className="bg-success-subtle text-success inline-flex h-6 items-center gap-1.5 rounded-md px-2 font-mono text-xs font-medium">
            <ShieldCheck className="size-3.5" />
            Unanimous {rex.outputs.length}/{rex.outputs.length}
          </span>
        ) : (
          <span className="bg-danger-subtle text-danger inline-flex h-6 items-center rounded-md px-2 font-mono text-xs">Not unanimous</span>
        )}
        <span className="text-muted-foreground font-mono text-xs">block {rex.round}</span>
      </div>
      {post ? (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-muted-foreground">Post</dt>
          <dd className="font-mono">{post}</dd>
          <dt className="text-muted-foreground">Author id</dt>
          <dd className="font-mono">{author}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd className="font-mono">{created}</dd>
        </dl>
      ) : null}
      <ol className="mt-4 grid gap-1.5 border-t pt-3">
        {rex.outputs.map((o, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-x-3 font-mono text-xs">
            <span className="text-muted-foreground">validator {o.validator}…</span>
            <span>
              {o.timestamp.slice(11, 23)}{" "}
              {o.ok && o.payload === first?.payload ? <span className="text-success">same ✓</span> : <span className="text-danger">{o.payload}</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-muted-foreground mt-3 font-mono text-[11px] break-all">{first?.payload}</p>
      <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
        Report <span className="font-mono">{rex.reportAccount.slice(0, 8)}…</span>, owned by the REX processor. The program accepts
        it only from the PDA it recorded for this entry.
      </p>
    </div>
  );
}

export type DecisionFilter = "all" | "approved" | "paid";
type Group = { kind: "round"; round: RoundView } | { kind: "empty"; from: number; to: number };

/**
 * Rounds newest first, with runs of rounds that approved nothing folded into one line, so a long-running campaign
 * doesn't list dozens of empty tables. "approved" means approved on chain and not paid (yet, or ever); "paid" means paid.
 */
export function groupRounds(rounds: RoundView[], filter: DecisionFilter): Group[] {
  const keep = (d: DecisionView) => filter === "all" || (filter === "paid" ? d.paid : !d.paid);
  const out: Group[] = [];
  for (const r of rounds) {
    const decisions = r.decisions.filter(keep);
    if (decisions.length) {
      out.push({ kind: "round", round: { ...r, decisions } });
      continue;
    }
    const last = out[out.length - 1];
    if (last?.kind === "empty" && last.to === r.round + 1) last.to = r.round;
    else out.push({ kind: "empty", from: r.round, to: r.round });
  }
  return out;
}

const PAGE = 10;

/** Every round's decisions: a filter, the latest 10 rounds with decisions, and "Load more". */
export function DecisionRounds({ rounds, roundBase }: { rounds: RoundView[]; roundBase?: string }) {
  const [filter, setFilter] = useState<DecisionFilter>("all");
  const [shown, setShown] = useState(PAGE);
  const groups = groupRounds(rounds, filter);
  // Count only rounds with decisions toward the page; an empty run between them comes along for free.
  const cut = (() => {
    let seen = 0;
    for (let i = 0; i < groups.length; i++) if (groups[i].kind === "round" && ++seen > shown) return i;
    return groups.length;
  })();
  const withDecisions = groups.filter((g) => g.kind === "round").length;
  const counts = {
    all: rounds.reduce((n, r) => n + r.decisions.length, 0),
    approved: rounds.reduce((n, r) => n + r.decisions.filter((d) => !d.paid).length, 0),
    paid: rounds.reduce((n, r) => n + r.decisions.filter((d) => d.paid).length, 0),
  };
  const label = (n: number) => (roundBase ? <Link href={`${roundBase}${n}`} className="underline-offset-4 hover:underline">Round {n}</Link> : `Round ${n}`);
  return (
    <div className="grid gap-6">
      <div role="radiogroup" aria-label="Show decisions" className="bg-muted flex w-fit gap-1 rounded-lg p-1 text-sm" data-testid="decision-filter">
        {(["all", "approved", "paid"] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={filter === f}
            onClick={() => {
              setFilter(f);
              setShown(PAGE);
            }}
            className={`rounded-md px-3 py-1 ${filter === f ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            {f === "all" ? "All" : f === "approved" ? "Approved, not paid" : "Paid"} <span className="text-muted-foreground tabular-nums">{counts[f]}</span>
          </button>
        ))}
      </div>
      {withDecisions === 0 ? (
        <EmptyState className="py-8">
          {filter === "all" ? "No submission has been approved yet." : filter === "paid" ? "Nothing has been paid yet." : "Every approved submission has been paid."}
        </EmptyState>
      ) : (
        groups.slice(0, cut).map((g) =>
          g.kind === "empty" ? (
            <p key={`e${g.from}`} className="text-muted-foreground border-l-2 pl-3 text-sm" data-testid="empty-rounds">
              {g.from === g.to ? `Round ${g.from}` : `Rounds ${g.to}–${g.from}`}: {filter === "all" ? "nothing approved" : "none"}
            </p>
          ) : (
            <div key={g.round.round} className="grid gap-3" data-testid="decision-round">
              <div className="flex flex-wrap items-baseline gap-3">
                <h3 className="font-medium">{label(g.round.round)}</h3>
                {g.round.ledger ? (
                  <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">ledger <HexValue value={g.round.ledger} label="round ledger" /></span>
                ) : null}
              </div>
              <DecisionsTable decisions={g.round.decisions} round={g.round.round} />
            </div>
          ),
        )
      )}
      {cut < groups.length && groups.slice(cut).some((g) => g.kind === "round") ? (
        <Button variant="outline" className="w-fit" onClick={() => setShown((n) => n + PAGE)}>
          Load more rounds
        </Button>
      ) : null}
    </div>
  );
}
