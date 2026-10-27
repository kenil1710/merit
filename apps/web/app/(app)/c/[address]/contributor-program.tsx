import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CoinsArt } from "@/components/brand/illustrations";
import { Submissions } from "@/components/contributor/submissions";
import { HexValue } from "@/components/hex-value";
import { Notice } from "@/components/ui-kit";
import { Stepper } from "@/components/ui-kit/stepper";
import { getDb } from "@/lib/db";
import { formatRlo } from "@/lib/merit/constants";
import { minimumStatus } from "@/lib/minimums";
import { perfectPayout, rlo } from "@/lib/program-math";
import { contributorView } from "@/lib/server/contributor-view";
import { accountOf, membership, publicProgram, userByX } from "@/lib/server/contributors";
import { getSession } from "@/lib/server/session";

const utc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** A contributor's view of one program (Misthos' /c/[slug]): earnings, submissions with their proof, rounds, account. */
export async function ContributorProgram({ slug }: { slug: string }) {
  const db = await getDb();
  const program = await publicProgram(db, slug);
  if (!program) notFound();
  const session = await getSession();
  if (!session) redirect(`/join/${program.slug}`);
  const me = await membership(db, program.id, session.xUserId);
  if (!me) redirect(`/join/${program.slug}`);
  const [view, user] = await Promise.all([contributorView(db, program, me), userByX(db, session.xUserId)]);
  const c = view.campaign;
  const open = c?.phaseCode === 1;
  const ended = !!program.endedAt || (c?.phaseCode ?? 0) >= 4;
  const minimums = minimumStatus(program, accountOf(user), new Date(), true);
  const closed = ended
    ? "This campaign has ended. Verified work from its last round is still paid."
    : !open
      ? c?.phaseCode === 2
        ? "The round is closing and paying out. The next one opens in a moment."
        : c?.phaseCode === 3
          ? "This round is waiting for the team to add funds."
          : "No round is open right now."
      : null;
  const best = program.rubricJson.categories.reduce((m, k) => (perfectPayout(k.maxPoints, program.ratePerPoint) > m ? perfectPayout(k.maxPoints, program.ratePerPoint) : m), 0n);

  return (
    <div className="grid gap-8">
      <div>
        <Link href="/c" className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Programs you joined
        </Link>
        <p className="text-muted-foreground text-sm">{program.name} · Rialo DevNet</p>
        <h1 className="display mt-1 text-[2.5rem] leading-[1.05] sm:text-[3.25rem]">
          Your <em>contributions</em>
        </h1>
        {c ? (
          <p className="mt-4">
            <span className="bg-card shadow-soft inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm">
              <span aria-hidden="true" className={`size-2 rounded-full ${open ? "bg-success" : "bg-muted-foreground/50"}`} />
              {open ? `Round ${c.round.number} closes ${utc(c.round.endMs)}` : ended ? "Campaign ended" : `Round ${c.round.number} · ${c.phase}`}
            </span>
          </p>
        ) : null}
      </div>

      {view.chainError ? <Notice tone="warning">Rialo DevNet didn&apos;t answer just now; on-chain status may be out of date.</Notice> : null}

      <section aria-label="Your earnings" className="bg-card shadow-lift relative overflow-hidden rounded-[1.5rem] p-6 sm:p-8" data-testid="earnings">
        <CoinsArt className="pointer-events-none absolute right-6 bottom-4 hidden size-32 md:block" />
        <dl className="relative grid gap-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] md:pr-36">
          <div>
            <dt className="text-muted-foreground text-sm">Paid to you</dt>
            <dd className="display mt-1 text-[3.5rem] leading-none tabular-nums sm:text-[4.25rem]">{formatRlo(view.paid)}</dd>
            <dd className="text-muted-foreground mt-2 text-xs">RLO on Rialo DevNet</dd>
          </div>
          <div className="md:border-l md:pl-6">
            <dt className="text-muted-foreground text-sm">This round so far</dt>
            <dd className="display mt-1 text-[2rem] leading-none tabular-nums">{formatRlo(view.thisRound)}</dd>
            <dd className="text-muted-foreground mt-2 text-xs leading-relaxed">{open && c ? `RLO approved, round closes ${utc(c.round.endMs)}` : "RLO approved"}</dd>
          </div>
          <div className="md:border-l md:pl-6">
            <dt className="text-muted-foreground text-sm">Approved, not yet paid</dt>
            <dd className="display mt-1 text-[2rem] leading-none tabular-nums">{formatRlo(view.awaiting)}</dd>
            <dd className="text-muted-foreground mt-2 text-xs leading-relaxed">RLO, paid by the program when the round closes</dd>
          </div>
        </dl>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 gap-8">
          {minimums.below ? <Notice tone={minimums.outcome === "review" ? "info" : "warning"}>{minimums.text}</Notice> : null}
          <section className="bg-card shadow-soft min-w-0 rounded-[1.5rem] p-5 sm:p-7">
            <Submissions slug={program.slug} items={view.items} closed={closed} roundLabel={open && c ? `round ${c.round.number}` : null} />
          </section>
        </div>

        <aside className="grid gap-6 lg:sticky lg:top-6">
          <section aria-labelledby="rounds-h" className="bg-card shadow-soft rounded-[1.5rem] p-5 sm:p-6" data-testid="rounds">
            <h2 id="rounds-h" className="display text-[1.5rem] leading-tight">
              Rounds
            </h2>
            {view.rounds.length === 0 ? (
              <p className="text-muted-foreground mt-3 text-sm">Your rounds show up here once you submit.</p>
            ) : (
              <Stepper
                className="mt-5"
                size="sm"
                label="Your rounds"
                steps={view.rounds.map((r) => ({
                  key: String(r.round),
                  label: `Round ${r.round} · ${r.state === "closing" ? "closing" : r.state}`,
                  // A closed round is finished whether or not it paid: never "waiting".
                  status: r.state === "open" ? "current" : r.state === "closing" ? "waiting" : "done",
                  statusLabel: r.state === "open" ? "open" : r.state === "closing" ? "closing, paying out" : "closed",
                  meta: r.paid > 0n ? `${formatRlo(r.paid)} RLO` : undefined,
                  detail: `${r.submitted} submitted · ${r.approved} approved`,
                }))}
              />
            )}
          </section>

          <section className="bg-card shadow-soft grid gap-4 rounded-[1.5rem] p-5 sm:p-6">
            <h2 className="display text-[1.5rem] leading-tight">Account</h2>
            <dl className="grid grid-cols-[80px_minmax(0,1fr)] items-baseline gap-y-3 text-sm">
              <dt className="text-muted-foreground">X</dt>
              <dd>@{me.xHandle}</dd>
              <dt className="text-muted-foreground">Followers</dt>
              <dd className="mono-num">{user?.xFollowers?.toLocaleString("en") ?? "—"}</dd>
              <dt className="text-muted-foreground">Wallet</dt>
              <dd>{me.walletAddress ? <HexValue value={me.walletAddress} label="payout wallet" head={8} tail={6} /> : "Not linked"}</dd>
            </dl>
          </section>

          <section className="bg-card shadow-soft grid gap-2 rounded-[1.5rem] p-5 text-sm sm:p-6">
            <h2 className="font-medium">What this program pays for</h2>
            {program.rubricJson.categories.map((k) => (
              <p key={k.key} className="text-soft">
                <span className="text-foreground font-medium">{k.name}</span> · up to {rlo(perfectPayout(k.maxPoints, program.ratePerPoint))}. Scored on {k.criteria.map((x) => x.name.toLowerCase()).join(", ")}.
              </p>
            ))}
            <Link href={`/join/${program.slug}`} className="text-muted-foreground hover:text-foreground mt-1 text-xs underline underline-offset-4">
              Full rules · up to {rlo(best)} per post
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
