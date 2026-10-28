import Link from "next/link";
import { ProgramCard } from "@/components/app/program-home";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui-kit";
import { getDb } from "@/lib/db";
import { programSummaries, type ProgramSummary } from "@/lib/server/program-summary";
import { programsForMember } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";
import { cn } from "@/lib/utils";
import { isEndedPhase } from "@/lib/shared/round-window";

export const metadata = { title: "All programs" };

const FILTERS = [
  ["all", "All"],
  ["draft", "Drafts"],
  ["live", "Live"],
  ["ended", "Ended"],
] as const;
type Filter = (typeof FILTERS)[number][0];

const ended = (s: ProgramSummary) => !!s.program.endedAt || isEndedPhase(s.state?.phase ?? 0n);
const MATCH: Record<Filter, (s: ProgramSummary) => boolean> = {
  all: () => true,
  draft: (s) => s.program.status === "draft",
  live: (s) => s.program.status !== "draft" && !ended(s),
  ended,
};

export default async function ProgramsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await getOwnerSession();
  if (!session) return null;
  const raw = (await searchParams).status;
  const filter: Filter = FILTERS.some(([k]) => k === raw) ? (raw as Filter) : "all";
  const all = await programSummaries(await programsForMember(await getDb(), session.sub));
  const shown = all.filter(MATCH[filter]);
  return (
    <div className="grid gap-8">
      <PageHeader
        title="All programs"
        description="Every program you own or review."
        actions={
          <Button asChild size="sm">
            <Link href="/app/programs/new">New program</Link>
          </Button>
        }
      />
      <nav aria-label="Filter programs" className="flex flex-wrap gap-2">
        {FILTERS.map(([key, label]) => {
          const count = all.filter(MATCH[key]).length;
          return (
            <Link
              key={key}
              href={key === "all" ? "/app/programs" : `/app/programs?status=${key}`}
              aria-current={filter === key ? "page" : undefined}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors", filter === key ? "border-brand bg-brand-subtle text-brand font-medium" : "hover:bg-muted")}
            >
              {label}
              <span className="text-muted-foreground tabular-nums">{count}</span>
            </Link>
          );
        })}
      </nav>
      {shown.length ? (
        <section aria-label="Programs" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((s) => (
            <ProgramCard key={s.program.id} s={s} />
          ))}
        </section>
      ) : (
        <EmptyState art="stack" title={all.length ? "Nothing here" : "No programs yet"} action={{ label: "New program", href: "/app/programs/new" }}>
          {all.length ? "No program matches this filter." : "Create your first program: the wizard takes about five minutes."}
        </EmptyState>
      )}
    </div>
  );
}
