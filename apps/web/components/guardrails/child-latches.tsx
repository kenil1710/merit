import { Card, Notice, Section } from "@/components/ui-kit";
import { cn } from "@/lib/utils";

export type ChildLatchView = {
  campaign: string;
  name: string | null;
  latch: "merit-judge" | "merit-x";
  whoami: { latchName?: string; chainDepth?: number; enabled?: boolean; error?: string };
  budget: { maxDailyCents?: number; currentDailySpendCents?: number; remaining?: number; message?: string; error?: string };
  audit: { method: string; path: string; decision: string; deniedBy?: string; timestamp: string }[];
};

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export const CHILD_WINDOW_DAYS = 7;

/**
 * One source and one window for a campaign latch's card: the requests in Latch's own audit log of that latch over the
 * last 7 days (UTC). `complete` is false when the oldest entry Latch returned is still inside the window, so older
 * ones may exist and the count is a lower bound.
 */
export function childWindow(audit: ChildLatchView["audit"], now: number) {
  const since = now - CHILD_WINDOW_DAYS * 86_400_000;
  const inWindow = audit.filter((e) => Date.parse(e.timestamp) >= since).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const oldest = audit.reduce((m, e) => Math.min(m, Date.parse(e.timestamp)), Infinity);
  const complete = audit.length === 0 || oldest < since;
  const allowed = inWindow.filter((e) => e.decision === "allow").length;
  return { entries: inWindow, total: inWindow.length, allowed, denied: inWindow.length - allowed, complete, since: new Date(since) };
}

/** Each campaign's own extended latch, read live with its own token: it inherits the parent's policy and only narrows it. */
export function ChildLatches({ children: latches, readAt }: { children: ChildLatchView[]; readAt: Date }) {
  return (
    <Section
      title="Campaign latches"
      description="A campaign can run on its own extended latch of merit-judge or merit-x: it inherits every parent filter live (attenuate_only) and adds tighter ones, such as a smaller daily spend cap. Merit uses it for that campaign's calls and REX reads, and falls back to the parent only when a campaign has none."
    >
      {latches.length === 0 ? (
        <Notice tone="info">No campaign has its own latch yet; every campaign uses merit-judge and merit-x directly.</Notice>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {latches.map((c) => {
            const extended = (c.whoami.chainDepth ?? 0) >= 1;
            const w = childWindow(c.audit, readAt.getTime());
            return (
              <Card
                key={`${c.latch}${c.campaign}`}
                className="min-w-0"
                title={<span className="font-mono">{c.whoami.latchName ?? `${c.latch} (child)`}</span>}
                description={
                  <>
                    {c.name ?? "Campaign"} <span className="font-mono">{short(c.campaign)}</span> · extends <span className="font-mono">{c.latch}</span>
                  </>
                }
                actions={
                  <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium", c.whoami.error || c.whoami.enabled === false ? "bg-danger-subtle text-danger" : "bg-success-subtle text-success")}>
                    {c.whoami.error ? "Unreachable" : c.whoami.enabled === false ? "Disabled" : "Live"}
                  </span>
                }
              >
                <div className="grid gap-4 text-sm">
                  {!c.whoami.error && !extended ? <Notice tone="danger">This token is not an extended latch (chain depth 0). Use a child created with Extend.</Notice> : null}
                  {c.whoami.error ? <Notice tone="danger">{c.whoami.error}. Merit does not fall back to the parent for this campaign.</Notice> : null}
                  <div className="bg-muted/50 rounded-xl p-4" data-testid="child-usage">
                    <p className="label">Requests through this latch · last {CHILD_WINDOW_DAYS} days (UTC)</p>
                    <p className="mt-2">
                      <span className="display text-2xl tabular-nums" data-testid="child-count">
                        {w.complete ? w.total : `${w.total}+`}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}
                        since {w.since.toISOString().slice(0, 16).replace("T", " ")} UTC · {w.allowed} allowed{w.denied ? ` · ${w.denied} denied` : ""}
                      </span>
                    </p>
                    <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                      Counted from Latch&apos;s own audit log of this latch, the same entries listed below, so it includes REX validators&apos; reads.
                      {w.complete ? "" : " Latch returned only its newest entries, so older ones in the window may exist."} The &quot;Per campaign&quot; table further
                      down counts Merit&apos;s own calls instead (parent and child latches, no validator reads). Chain depth {c.whoami.chainDepth ?? "?"}.{" "}
                      {c.budget.maxDailyCents !== undefined
                        ? `Daily spend cap: Latch's counter shows ${c.budget.currentDailySpendCents ?? 0}¢ of ${c.budget.maxDailyCents}¢ used today (whole cents).`
                        : c.budget.message ?? c.budget.error ?? ""}
                    </p>
                  </div>
                  <p className="label -mb-2">
                    {w.total > 5 ? `Newest 5 of these ${w.complete ? w.total : `${w.total}+`} requests` : `These ${w.total} request${w.total === 1 ? "" : "s"}`} (Latch&apos;s audit log, UTC)
                  </p>
                  <ul className="grid gap-1 font-mono text-xs" data-testid="child-audit">
                    {w.entries.slice(0, 5).map((e, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span className="truncate">{e.timestamp.slice(5, 10)} {e.timestamp.slice(11, 19)} {e.method} {e.path}</span>
                        <span className={e.decision === "allow" ? "text-success" : "text-danger"}>{e.decision === "allow" ? "allow" : `deny · ${e.deniedBy}`}</span>
                      </li>
                    ))}
                    {w.total === 0 ? <li className="text-muted-foreground font-sans">No requests in the last {CHILD_WINDOW_DAYS} days.</li> : null}
                  </ul>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Section>
  );
}
