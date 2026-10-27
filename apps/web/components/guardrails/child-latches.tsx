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

/** Each campaign's own extended latch, read live with its own token: it inherits the parent's policy and only narrows it. */
export function ChildLatches({ children: latches }: { children: ChildLatchView[] }) {
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
                  <div className="bg-muted/50 rounded-xl p-4">
                    <p className="label">Its own spend today</p>
                    {c.budget.maxDailyCents !== undefined ? (
                      <>
                        <p className="mt-2">
                          <span className="display text-2xl tabular-nums">{c.budget.currentDailySpendCents}¢</span>
                          <span className="text-muted-foreground"> · chain depth {c.whoami.chainDepth}</span>
                        </p>
                        <p className="text-muted-foreground mt-2 text-xs">
                          The budget endpoint shows {c.budget.maxDailyCents}¢; this latch&apos;s own daily cap is set in its pipeline and
                          enforced by the proxy.
                        </p>
                      </>
                    ) : (
                      <p className="text-soft mt-2">{c.budget.message ?? c.budget.error ?? "No budget"}.</p>
                    )}
                  </div>
                  <ul className="grid gap-1 font-mono text-xs">
                    {c.audit.slice(0, 5).map((e, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span className="truncate">{e.timestamp.slice(11, 19)} {e.method} {e.path}</span>
                        <span className={e.decision === "allow" ? "text-success" : "text-danger"}>{e.decision === "allow" ? "allow" : `deny · ${e.deniedBy}`}</span>
                      </li>
                    ))}
                    {c.audit.length === 0 ? <li className="text-muted-foreground font-sans">No requests yet.</li> : null}
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
