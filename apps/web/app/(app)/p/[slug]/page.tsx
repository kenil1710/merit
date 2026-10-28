import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CampaignRecord } from "@/components/campaign/campaign-record";
import { HexValue } from "@/components/hex-value";
import { EmptyState, Section } from "@/components/ui-kit";
import { getDb } from "@/lib/db";
import { rloText, utc } from "@/lib/format";
import { campaignView } from "@/lib/server/campaign-view";
import { publicProgram } from "@/lib/server/contributors";
import { recentDecisions } from "@/lib/server/program-pages";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const program = await publicProgram(await getDb(), (await params).slug).catch(() => null);
  return { title: program ? `${program.name} · public record` : "Public record" };
}

const ACTION: Record<string, [string, string]> = {
  approve: ["Approved", "bg-brand-subtle text-brand-soft"],
  partial: ["Partial", "bg-brand-subtle text-brand-soft"],
  reject: ["Rejected", "bg-danger-subtle text-danger"],
  escalate: ["With the team", "bg-warning-subtle text-warning"],
};

/** A program's public audit page: the on-chain record plus every recent decision, rejected and escalated included. */
export default async function PublicProgramPage({ params }: Params) {
  const { slug } = await params;
  const db = await getDb();
  const program = await publicProgram(db, slug);
  if (!program?.campaignAddress) notFound();
  const [view, decisions] = await Promise.all([campaignView(program.campaignAddress), recentDecisions(db, program.id)]);
  if (!view) notFound();
  return (
    <CampaignRecord
      view={{ ...view, meta: { address: view.address, owner: view.owner, slug: program.campaignSlugHex ?? "", createdAt: program.createdAt.toISOString(), ...view.meta, name: program.name, brief: program.description } }}
      joinHref={`/join/${program.slug}`}
      roundBase={`/p/${program.slug}/rounds/`}
      extra={
        <Section title="Recent decisions" description="Every decision, not only approvals. Each is a signed record; approved ones also have their hash on chain.">
          {decisions.length ? (
            <ul className="bg-card shadow-soft divide-y rounded-[20px]" data-testid="recent-decisions">
              {decisions.map((d) => {
                const [label, tone] = d.status === "paid" ? ["Paid", "bg-success-subtle text-success"] : (ACTION[d.action] ?? [d.action, "bg-muted"]);
                return (
                  <li key={d.id} className="grid gap-1 px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium", tone)}>{label}</span>
                      <a href={d.url} target="_blank" rel="noreferrer" className="font-medium underline-offset-4 hover:underline">
                        @{d.xHandle}
                      </a>
                      {d.decidedBy === "human" ? <span className="bg-muted text-soft rounded-full px-2 py-0.5 text-[11px]">Team decision</span> : null}
                      <span className="text-muted-foreground text-xs">{utc(d.at)}</span>
                      {d.amount !== "0" ? <span className="ml-auto font-mono tabular-nums">{rloText(d.amount)}</span> : null}
                    </div>
                    <p className="text-soft line-clamp-2 text-[13px]">{d.summary}</p>
                    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                      record <HexValue value={d.hash} label="record hash" head={8} tail={4} />
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState>No decisions yet.</EmptyState>
          )}
        </Section>
      }
    />
  );
}
