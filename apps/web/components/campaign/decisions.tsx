"use client";

import { ChevronRight, ExternalLink, FileCheck2, Gavel, ShieldCheck, Wallet } from "lucide-react";
import { useState } from "react";
import { HexValue } from "@/components/hex-value";
import { entryStatus, StatusBadge } from "@/components/status-badge";
import { TableFrame } from "@/components/ui-kit";
import { Stepper, type Step } from "@/components/ui-kit/stepper";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRlo } from "@/lib/merit/constants";
import type { DecisionView } from "@/lib/server/campaign-view";

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
                  <span className="text-muted-foreground text-xs"> / 100</span>
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
                  {d.tx.payout ? <StatusBadge status="paid" className="mt-1" /> : null}
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

function journey(d: DecisionView): Step[] {
  const verified = d.status === "Verified";
  const failed = d.status === "Failed verification" || d.status === "Inconclusive";
  return [
    { key: "judged", label: "Judged by Claude through merit-judge", status: "done", icon: Gavel, meta: d.judge ? `score ${d.score}` : undefined },
    { key: "approved", label: "Approved on chain by the agent", status: d.tx.approve ? "done" : "current", icon: FileCheck2 },
    {
      key: "verified",
      label: "Verified by validators (REX)",
      status: verified ? "done" : failed ? "failed" : "current",
      icon: ShieldCheck,
      meta: d.rex ? `${d.rex.outputs.length} reports` : undefined,
    },
    {
      key: "paid",
      label: "Paid when the round settled",
      status: d.tx.payout ? "done" : failed ? "skipped" : "waiting",
      icon: Wallet,
      meta: d.tx.payout ? `${formatRlo(BigInt(d.amountKelvin))} RLO` : undefined,
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
                <StatusBadge status={entryStatus(d.status, Boolean(d.tx.payout))} />
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
                      <span className="text-muted-foreground font-sans text-sm"> / 100</span>
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
                  <dd>{d.tx.payout ? <HexValue value={d.tx.payout} href={`/tx/${d.tx.payout}`} label="payout transaction" /> : "—"}</dd>
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
