import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RubricArt } from "@/components/brand/illustrations";
import { ReviewList } from "@/components/review/review-list";
import { EmptyState, Notice, PageHeader } from "@/components/ui-kit";
import { getDb } from "@/lib/db";
import { campaignView } from "@/lib/server/campaign-view";
import { getProgramForMember } from "@/lib/server/programs";
import { inTab, QUEUE_LABEL, reconcileWithChain, REVIEW_TABS, reviewRows, type QueueReason, type ReviewTab } from "@/lib/server/review";
import { getOwnerSession } from "@/lib/server/session";
import { cn } from "@/lib/utils";

export const metadata = { title: "Submissions" };

const TAB_LABEL: Record<ReviewTab, string> = { all: "All", review: "Needs review", approved: "Approved", rejected: "Rejected", paid: "Paid", expired: "Expired (round closed)" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; reason?: string }> };

/** Every submission and what the agent decided (Misthos' review page): tabs, the review queue by reason, bulk decisions. */
export default async function SubmissionsPage({ params, searchParams }: Props) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await getDb();
  const found = await getProgramForMember(db, id, session.sub);
  if (!found) notFound();
  const { program } = found;
  const sp = await searchParams;
  const tab: ReviewTab = (REVIEW_TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as ReviewTab) : "all";
  let chainError = false;
  const view = program.campaignAddress
    ? await campaignView(program.campaignAddress).catch(() => {
        chainError = true;
        return null;
      })
    : null;
  await reconcileWithChain(db, program, view).catch(() => undefined);
  const all = await reviewRows(db, program.id, view?.expiredBelow ?? null);
  const queue = all.filter((r) => r.reason !== null);
  const reasons = [...new Set(queue.map((r) => r.reason!))] as QueueReason[];
  const reason = tab === "review" && reasons.includes(sp.reason as QueueReason) ? (sp.reason as QueueReason) : null;
  const rows = all.filter((r) => inTab(r, tab) && (!reason || r.reason === reason));
  const q = (t: ReviewTab, r?: QueueReason) => `?tab=${t}${r ? `&reason=${r}` : ""}`;

  return (
    <div className="grid gap-6">
      <PageHeader
        crumbs={[{ label: program.name, href: `/app/programs/${id}` }, { label: "Submissions" }]}
        title="Submissions"
        description="Everything contributors sent and what the agent decided. Open one for the evidence, scores, proof and reasoning, and to approve, adjust or reject it."
      />
      {chainError ? <Notice tone="warning">Rialo DevNet didn&apos;t answer just now; on-chain status may be out of date.</Notice> : null}
      <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5 text-[13px]">
        {REVIEW_TABS.filter((t) => t !== "expired" || all.some((r) => r.status === "expired")).map((t) => (
          <Link
            key={t}
            href={q(t)}
            scroll={false}
            aria-current={tab === t ? "page" : undefined}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 transition-colors", tab === t ? "bg-foreground text-background" : "bg-card text-soft shadow-soft hover:text-foreground")}
          >
            {TAB_LABEL[t]} <span className="tabular-nums opacity-70">{all.filter((r) => inTab(r, t)).length}</span>
          </Link>
        ))}
      </nav>
      {tab === "review" && reasons.length ? (
        <nav aria-label="Why it waits for you" className="flex flex-wrap gap-1.5 text-xs" data-testid="queue-reasons">
          <Link href={q("review")} scroll={false} aria-current={!reason ? "page" : undefined} className={cn("rounded-full border px-3 py-1", !reason ? "border-brand bg-brand-subtle text-brand font-medium" : "hover:bg-muted")}>
            Every reason
          </Link>
          {reasons.map((r) => (
            <Link key={r} href={q("review", r)} scroll={false} aria-current={reason === r ? "page" : undefined} className={cn("rounded-full border px-3 py-1", reason === r ? "border-brand bg-brand-subtle text-brand font-medium" : "hover:bg-muted")}>
              {QUEUE_LABEL[r]} <span className="tabular-nums opacity-70">{queue.filter((x) => x.reason === r).length}</span>
            </Link>
          ))}
        </nav>
      ) : null}
      {all.length === 0 ? (
        <section className="bg-card/50 grid justify-items-center gap-3 rounded-[1.25rem] border border-dashed px-6 py-12 text-center">
          <RubricArt className="size-20" />
          <h2 className="display text-[1.5rem] leading-tight">No submissions yet</h2>
          <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
            Contributors join with <span className="font-mono">/join/{program.slug}</span>, sign in with X and paste links to their posts. Each shows up here within a minute, with the agent&apos;s decision and reasons.
          </p>
        </section>
      ) : rows.length === 0 ? (
        <EmptyState art="rubric" title="All clear" action={{ label: "Show all submissions", href: "?" }}>
          Nothing is {TAB_LABEL[tab].toLowerCase()} right now.
        </EmptyState>
      ) : (
        <ReviewList programId={program.id} rows={rows} />
      )}
    </div>
  );
}
