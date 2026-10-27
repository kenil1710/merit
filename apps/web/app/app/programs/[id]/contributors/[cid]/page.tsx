import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ContributorStatus } from "@/components/app/contributor-status";
import { HexValue } from "@/components/hex-value";
import { StatusPill } from "@/components/review/review-drawer";
import { Card, EmptyState, PageHeader } from "@/components/ui-kit";
import { rloText, utc } from "@/lib/format";
import { memberProgram } from "@/lib/server/owner-page";
import { contributorDetail } from "@/lib/server/program-pages";

export const metadata = { title: "Contributor" };

const HISTORY: Record<string, string> = {
  "contributor.joined": "Joined and linked the payout wallet",
  "contributor.suspended": "Suspended",
  "contributor.reinstated": "Reinstated",
  "payee.registered": "Wallet registered on chain (cooldown starts)",
};

/** One contributor: account, wallet and its history, every submission, and suspend / reinstate. */
export default async function ContributorPage({ params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  const { db, program, role, base } = await memberProgram(id);
  if (!z.uuid().safeParse(cid).success) notFound();
  const d = await contributorDetail(db, program.id, cid);
  if (!d) notFound();
  const c = d.contributor;
  const paid = d.submissions.filter((s) => s.status === "paid").reduce((t, s) => t + BigInt(s.amount ?? "0"), 0n);
  return (
    <div className="grid gap-6">
      <PageHeader
        crumbs={[{ label: program.name, href: base }, { label: "Contributors", href: `${base}/contributors` }, { label: `@${c.xHandle}` }]}
        title={`@${c.xHandle}`}
        meta={<span className="bg-muted rounded-md px-2 py-0.5 text-xs font-medium capitalize">{c.status}</span>}
        description={`${d.submissions.length} submission${d.submissions.length === 1 ? "" : "s"} · ${rloText(paid)} paid`}
      />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card title="Account">
          <dl className="grid grid-cols-[1fr_auto] gap-y-2.5 text-sm">
            <dt className="text-soft">X</dt>
            <dd>
              <a href={`https://x.com/${c.xHandle}`} className="underline-offset-4 hover:underline" target="_blank" rel="noreferrer">
                @{c.xHandle}
              </a>
            </dd>
            <dt className="text-soft">Followers</dt>
            <dd className="tabular-nums">{d.user.followers ?? "—"}</dd>
            <dt className="text-soft">X account since</dt>
            <dd>{d.user.createdAt ? d.user.createdAt.slice(0, 10) : "—"}</dd>
            <dt className="text-soft">Payout wallet</dt>
            <dd>{c.walletAddress ? <HexValue value={c.walletAddress} label="wallet" /> : "—"}</dd>
            <dt className="text-soft">Wallet proven</dt>
            <dd>{utc(c.walletVerifiedAt?.toISOString())}</dd>
          </dl>
        </Card>
        <Card title="History" description="Wallet changes and status changes, from the audit log.">
          {d.history.length ? (
            <ul className="grid gap-2 text-sm" data-testid="contributor-history">
              {d.history.map((h, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    {HISTORY[h.action] ?? h.action}
                    {typeof h.data.reason === "string" ? <span className="text-muted-foreground"> · “{h.data.reason}”</span> : null}
                  </span>
                  <span className="text-muted-foreground text-xs">{utc(h.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">Nothing recorded yet.</p>
          )}
          {role === "owner" ? (
            <div className="mt-4 border-t pt-4">
              <ContributorStatus programId={program.id} contributorId={c.id} status={c.status} handle={c.xHandle} />
            </div>
          ) : null}
        </Card>
      </div>
      {d.submissions.length ? (
        <ul className="bg-card shadow-soft divide-y rounded-[1.25rem]" data-testid="contributor-submissions">
          {d.submissions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
              <StatusPill status={s.status} />
              <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs underline-offset-4 hover:underline">
                {s.url.replace(/^https:\/\//, "")}
              </a>
              <span className="text-muted-foreground text-xs">{s.round ? `round ${s.round} · ` : ""}{utc(s.createdAt)}</span>
              <span className="font-mono tabular-nums">{s.amount ? rloText(s.amount) : "—"}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No submissions yet.</EmptyState>
      )}
      <p className="text-muted-foreground text-sm">
        <Link href={`${base}/submissions`} className="underline underline-offset-4">
          Review submissions
        </Link>{" "}
        to approve or reject their work.
      </p>
    </div>
  );
}
