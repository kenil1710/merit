import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JoinWallet } from "@/components/contributor/join-wallet";
import { Stepper } from "@/components/ui-kit/stepper";
import { Button } from "@/components/ui/button";
import { getDb, schema } from "@/lib/db";
import { loadState } from "@/lib/merit/chain";
import type { MeritState } from "@/lib/merit/state";
import { minimumRuleText, minimumStatus, type MinimumStatus } from "@/lib/minimums";
import { perfectPayout, rlo } from "@/lib/program-math";
import { listSources } from "@/lib/shared/program";
import { rpc } from "@/lib/server/agent";
import { accountOf, membership, publicProgram, userByX } from "@/lib/server/contributors";
import { getSession } from "@/lib/server/session";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const program = await publicProgram(await getDb(), (await params).slug);
  return program ? { title: `Join ${program.name}`, description: program.description } : {};
}

const utc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** A program's join page (Misthos' layout): what it pays for, the rules (minimums shown before sign-in), how it works, and joining in two steps. */
export default async function JoinProgramPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const db = await getDb();
  const program = await publicProgram(db, slug);
  if (!program) notFound();
  const sp = await searchParams;
  const session = await getSession();
  const [state, context, member, user] = await Promise.all([
    program.campaignAddress ? loadState(rpc, program.campaignAddress).catch(() => null) : Promise.resolve(null as MeritState | null),
    db
      .select()
      .from(schema.programContexts)
      .where(and(eq(schema.programContexts.programId, program.id), eq(schema.programContexts.version, program.contextVersion ?? 1)))
      .limit(1)
      .then((r) => r[0] ?? null),
    session ? membership(db, program.id, session.xUserId) : Promise.resolve(null),
    session ? userByX(db, session.xUserId) : Promise.resolve(null),
  ]);
  const minimums = session ? minimumStatus(program, accountOf(user)) : null;
  const blocked = !member && minimums?.outcome === "block";
  const ruleText = minimumRuleText(program);
  const ended = !!program.endedAt || (state?.phase ?? 0n) >= 4n;
  const open = state?.phase === 1n;
  const best = program.rubricJson.categories.reduce((m, c) => (perfectPayout(c.maxPoints, program.ratePerPoint) > m ? perfectPayout(c.maxPoints, program.ratePerPoint) : m), 0n);
  const first = program.rubricJson.categories[0];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14">
      <article className="min-w-0">
        <p className="text-brand text-sm font-medium">Contributor program</p>
        <h1 className="display mt-2 text-[2.75rem] leading-[1.02] [overflow-wrap:anywhere] sm:text-[3.75rem]">{program.name}</h1>
        <p className="text-soft mt-4 max-w-[60ch] text-[17px] leading-relaxed">{program.description}</p>
        <ul className="mt-6 flex flex-wrap gap-2 text-sm" aria-label="At a glance">
          {state && state.round > 0n ? (
            <li className="bg-card shadow-soft inline-flex items-center gap-2 rounded-full px-3.5 py-1.5" data-testid="join-round">
              <span aria-hidden="true" className={`size-2 rounded-full ${open ? "bg-success" : "bg-muted-foreground/50"}`} />
              {open ? `Round ${state.round} is open until ${utc(Number(state.roundEndMs))}` : ended ? "Campaign ended" : `Round ${state.round} is settling`}
            </li>
          ) : null}
          <li className="bg-card shadow-soft rounded-full px-3.5 py-1.5">
            Up to <span className="mono-num font-medium">{rlo(best)}</span> per post
          </li>
          <li className="bg-card shadow-soft inline-flex items-center gap-2 rounded-full px-3.5 py-1.5">
            <span className="bg-success size-1.5 rounded-full" aria-hidden="true" />
            Paid in test RLO on Rialo DevNet
          </li>
        </ul>

        {context ? (
          <section aria-labelledby="about-h" className="mt-14">
            <h2 id="about-h" className="display text-[1.875rem] leading-tight">
              About
            </h2>
            <p className="text-soft mt-3 max-w-[65ch] leading-relaxed whitespace-pre-line">{context.about}</p>
          </section>
        ) : null}

        <h2 className="display mt-14 text-[1.875rem] leading-tight">What it pays for</h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {program.rubricJson.categories.map((c) => (
            <li key={c.key} className="bg-card shadow-soft grid content-start gap-3 rounded-[1.25rem] p-5 sm:p-6">
              <div>
                <p className="text-muted-foreground text-xs">up to</p>
                <p className="display text-[2.25rem] leading-none tabular-nums">
                  {rlo(perfectPayout(c.maxPoints, program.ratePerPoint)).replace(" RLO", "")}
                  <span className="text-muted-foreground ml-1 font-sans text-xs">RLO</span>
                </p>
              </div>
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-soft mt-1 text-sm leading-relaxed">{c.description}</p>
              </div>
              <p className="text-muted-foreground text-xs">
                {listSources(c.sourceTypes)} · scored on {c.criteria.map((k) => k.name.toLowerCase()).join(", ")}
              </p>
              {c.rules ? <p className="bg-muted/60 rounded-xl px-3 py-2 text-[13px] leading-relaxed">{c.rules}</p> : null}
            </li>
          ))}
        </ul>

        <h2 className="mt-12 text-base font-medium">Rules</h2>
        <ul className="text-soft mt-3 grid gap-2 text-sm leading-relaxed" data-testid="join-rules">
          {context?.mustIncludeJson.length ? (
            <li>
              Every post must include <span className="text-foreground font-medium">{context.mustIncludeJson.join(", ")}</span>.
            </li>
          ) : null}
          <li>
            Up to {program.maxSubmissionsPerRound} submission{program.maxSubmissionsPerRound === 1 ? "" : "s"} per round, written during the round.
          </li>
          {ruleText ? <li>{ruleText}</li> : null}
          <li>Disagree with a decision? You can ask for a second look once per submission.</li>
        </ul>
        {program.rubricJson.generalRules ? <p className="text-soft mt-3 text-sm leading-relaxed whitespace-pre-line">{program.rubricJson.generalRules}</p> : null}

        <h2 className="display mt-14 text-[1.875rem] leading-tight">How it works</h2>
        <Stepper
          className="mt-6"
          orientation="responsive"
          label="How it works"
          steps={[
            ["Join", "Sign in with X and sign with the Rialo wallet you want to be paid in. Free, about a minute."],
            ["Post", "Write something this program pays for, from your own X account, during an open round."],
            ["Submit the link", "The agent checks it's yours and inside the round, scores it and tells you why. Validators then confirm the post themselves (REX)."],
            ["Get paid", "When the round closes, the program's own timer pays verified work in RLO. Every payout is public."],
          ].map(([t, d], i) => ({ key: t!, label: t, status: i === 0 ? (member ? "done" : "current") : "waiting", detail: d }))}
        />

        <h2 className="display mt-14 text-[1.875rem] leading-tight">What a 10 looks like</h2>
        <div className="bg-card shadow-soft mt-5 rounded-[1.25rem] p-6 text-sm">
          <p className="font-medium">A perfect post earns {rlo(perfectPayout(first?.maxPoints ?? 0, program.ratePerPoint))} when it scores 10 on:</p>
          <ul className="text-soft mt-2 grid list-disc gap-1 pl-5">
            {(first?.criteria ?? []).map((k) => (
              <li key={k.key}>
                <span className="text-foreground">{k.name}:</span> {k.description}
              </li>
            ))}
          </ul>
        </div>
        {program.campaignAddress ? (
          <p className="text-muted-foreground mt-8 max-w-[62ch] text-sm leading-relaxed">
            Payouts come from an escrow with caps the Merit program enforces on Rialo, and every decision is on the campaign&apos;s{" "}
            <Link href={`/c/${program.campaignAddress}`} className="text-foreground underline underline-offset-4">
              public record
            </Link>
            .
          </p>
        ) : null}
      </article>

      <aside className="bg-card shadow-lift order-first h-fit rounded-[1.5rem] p-6 sm:p-7 lg:sticky lg:top-6 lg:order-none" data-testid="join-panel">
        {ended ? (
          <div className="grid gap-4">
            <h2 className="display text-[1.75rem] leading-tight">Campaign ended</h2>
            <p className="text-soft text-sm">This campaign isn&apos;t taking new contributors or submissions. Verified work from its last round is still paid.</p>
            {member ? (
              <Button asChild variant="outline">
                <Link href={`/c/${program.slug}`}>See your contributions</Link>
              </Button>
            ) : null}
          </div>
        ) : member ? (
          <div className="grid gap-4">
            <h2 className="display text-[1.75rem] leading-tight">
              You&apos;re <em>in</em>
            </h2>
            <p className="text-soft text-sm">Joined as @{member.xHandle}.</p>
            <Button asChild size="lg" className="h-11 text-[15px]">
              <Link href={`/c/${program.slug}`}>Go to your contributions</Link>
            </Button>
          </div>
        ) : program.joiningPaused ? (
          <>
            <h2 className="display text-[1.75rem] leading-tight">Joining is paused</h2>
            <p className="text-soft mt-2 text-sm">This program isn&apos;t accepting new contributors right now.</p>
          </>
        ) : (
          <div className="grid gap-5">
            <div>
              <h2 className="display text-[1.75rem] leading-tight">Join in two steps</h2>
              <p className="text-muted-foreground mt-1 text-sm">Free, about a minute.</p>
            </div>
            {!session && ruleText ? <p className="bg-muted/60 rounded-xl px-3.5 py-2.5 text-sm" data-testid="rule-before-sign-in">{ruleText}</p> : null}
            <Stepper
              label="Join steps"
              steps={[
                {
                  key: "x",
                  label: session ? `Signed in as @${session.username}` : "Sign in with X",
                  status: session ? "done" : "current",
                  detail: session ? undefined : (
                    <span className="grid gap-3">
                      <span>So the agent can confirm which posts are yours. Merit reads your public profile once and never posts.</span>
                      <Button asChild className="w-full">
                        <a href={`/api/auth/x/start?returnTo=${encodeURIComponent(`/join/${program.slug}`)}`}>Sign in with X</a>
                      </Button>
                      {sp.error ? (
                        <span role="alert" className="text-danger text-sm">
                          {sp.error}
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                ...(minimums?.applies
                  ? [
                      {
                        key: "account",
                        label: minimums.below ? "Below this program's minimums" : "Your account meets the minimums",
                        status: (minimums.below ? (minimums.outcome === "review" ? "current" : "failed") : "done") as "done" | "current" | "failed",
                        detail: <AccountNumbers status={minimums} />,
                      },
                    ]
                  : []),
                {
                  key: "wallet",
                  label: "Sign with your payout wallet",
                  status: blocked ? "waiting" : session ? "current" : "waiting",
                  detail: blocked ? (
                    "Joining needs an X account that meets the minimums above."
                  ) : session ? (
                    <span className="grid gap-3">
                      <span>RLO is paid to this Rialo wallet. Signing proves it&apos;s yours; it costs nothing.</span>
                      <JoinWallet slug={program.slug} />
                    </span>
                  ) : (
                    "RLO is paid to a Rialo wallet kept in your browser."
                  ),
                },
              ]}
            />
          </div>
        )}
      </aside>
    </div>
  );
}

function AccountNumbers({ status }: { status: MinimumStatus }) {
  return (
    <span className="grid gap-2" data-testid="account-numbers">
      <span className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {status.followers ? (
          <span>
            <span className="text-foreground mono-num font-medium">{status.followers.have === null ? "?" : status.followers.have.toLocaleString("en")}</span> followers · needs{" "}
            {status.followers.need.toLocaleString("en")}
          </span>
        ) : null}
        {status.age ? (
          <span>
            <span className="text-foreground mono-num font-medium">{status.age.days === null ? "?" : status.age.days.toLocaleString("en")}</span> days old · needs {status.age.need}
          </span>
        ) : null}
      </span>
      <span>{status.text}</span>
    </span>
  );
}
