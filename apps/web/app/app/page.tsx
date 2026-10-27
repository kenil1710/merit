import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NeedsYou, ProgramCard } from "@/components/app/program-home";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-kit";
import { getDb } from "@/lib/db";
import { programSummaries } from "@/lib/server/program-summary";
import { programsForMember } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";

export async function generateMetadata() {
  return { title: (await getOwnerSession()) ? "Your programs" : "Sign in" };
}

export default async function OverviewPage() {
  const session = await getOwnerSession();
  if (!session) return null; // the layout renders sign-in
  const summaries = await programSummaries(await programsForMember(await getDb(), session.sub));

  if (!summaries.length) {
    return (
      <div className="grid gap-8">
        <PageHeader title="Welcome to Merit" description="Set up a contributor program once; the agent reviews every post and the Merit program on Rialo pays approved work from an escrow you own." />
        <section className="bg-card shadow-soft grid gap-8 overflow-hidden rounded-[1.25rem] p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="welcome">
          <div>
            <h2 className="text-base font-medium">Your first program takes about five minutes</h2>
            <ol className="text-soft mt-4 grid gap-3 text-sm">
              {[
                ["Write the rules", "What you pay for, how it's scored, who can take part, and your limits."],
                ["Go live on Rialo", "Sign the campaign onto DevNet, fund its escrow and open round 1."],
                ["Share the join link", "Contributors sign in with X and submit their posts."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums">{i + 1}</span>
                  <span>
                    <span className="text-foreground block font-medium">{t}</span>
                    {d}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Button asChild>
                <Link href="/app/programs/new">Create your first program</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/explore">
                  See live campaigns
                  <ArrowUpRight className="size-3.5" strokeWidth={1.5} />
                </Link>
              </Button>
            </div>
          </div>
          <div className="bg-muted/50 grid content-center gap-3 rounded-[1.25rem] p-6 text-sm">
            <p className="font-medium">What runs where</p>
            {[
              ["On Rialo", "Your escrow, the caps, every approval's record hash, the round timers and every payout."],
              ["REX validators", "Each approved post is fetched by validators; only a unanimous report counts."],
              ["Latch", "Every Claude and X call goes through budgeted, audited latches."],
            ].map(([k, v]) => (
              <p key={k} className="text-soft leading-relaxed">
                <span className="text-foreground font-medium">{k}.</span> {v}
              </p>
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (summaries.length === 1) redirect(`/app/programs/${summaries[0]!.program.id}`);
  return <ProgramsHome summaries={summaries} />;
}

function ProgramsHome({ summaries }: { summaries: Awaited<ReturnType<typeof programSummaries>> }) {
  const needs = summaries.flatMap((s) => s.needs.map((n) => ({ ...n, programId: s.program.id })));
  const names = Object.fromEntries(summaries.map((s) => [s.program.id, s.program.name]));
  return (
    <div className="grid gap-10">
      <PageHeader
        title="Your programs"
        description="What needs you, and how each program is doing."
        actions={
          <Button asChild size="sm">
            <Link href="/app/programs/new">New program</Link>
          </Button>
        }
      />
      <NeedsYou items={needs} names={names} />
      <section aria-label="Programs" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {summaries.map((s) => (
          <ProgramCard key={s.program.id} s={s} />
        ))}
      </section>
    </div>
  );
}
