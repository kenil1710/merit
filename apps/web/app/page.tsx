import { ArrowRight, Check, FileCheck2, Gavel, ShieldCheck, Timer } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BlobField, CornerLabel } from "@/components/brand/blobs";
import { CoinsArt, SealArt } from "@/components/brand/illustrations";
import { PAPER_URL, SiteFooter, SiteHeader } from "@/components/site-chrome";
import { Button } from "@/components/ui/button";
import { RpcClient, listCampaigns } from "@/lib/merit/chain";
import { RPC_UPSTREAM, formatRlo } from "@/lib/merit/constants";
import type { JudgeRecord } from "@/lib/merit/judgement";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

const ROUND1 = { campaign: "G1JjiebaNvYQVBN4tscddqdKRZLfjJR2pgTVrBScx2TN", post: "2113550979329368489" };

const steps: { icon: typeof Gavel; title: string; body: string }[] = [
  { icon: FileCheck2, title: "Escrow on Rialo", body: "A project locks RLO in a campaign workflow with caps per payout, per contributor per round and per round." },
  { icon: Gavel, title: "An AI judge, on a leash", body: "Contributors submit an X post. Claude scores it through the merit-judge latch: Haiku only, bounded tokens, a daily budget." },
  { icon: ShieldCheck, title: "Validators verify the post", body: "Approval starts REX. Each validator fetches the post itself and they must agree on its author and time." },
  { icon: Timer, title: "Rounds settle themselves", body: "When the round ends a native AFTER timer pays every verified entry in order. Nobody presses a button." },
];

const layers: { title: string; items: string[] }[] = [
  { title: "On Rialo", items: ["Escrow and every cap", "Approvals in a per-round ledger", "REX verification of each post", "Round timers, payouts, refunds"] },
  { title: "In Latch", items: ["Anthropic and X credentials", "Per-latch policy and rate limits", "Spend budget for the judge", "An audit log of every call"] },
  { title: "Off chain", items: ["X sign-in", "The judge call and its reasons", "The agent key that sends approve", "Only the reasons' hash goes on chain"] },
];

export default async function Home() {
  const [campaigns, seed] = await Promise.all([
    listCampaigns(new RpcClient(RPC_UPSTREAM)).catch(() => []),
    store.judgement(ROUND1.post),
  ]);
  const paid = campaigns.reduce((sum, c) => sum + c.totalPaid, 0n);
  const reimbursed = campaigns.reduce((sum, c) => sum + c.totalOpsReimbursed, 0n);
  const record = seed ? (JSON.parse(seed.canonical) as JudgeRecord) : null;

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <section className="relative">
          <CornerLabel className="text-foreground absolute top-6 right-4 hidden text-right sm:right-6 md:block" />
          <div className="mx-auto grid max-w-[1240px] grid-cols-[minmax(0,1fr)] items-center gap-14 px-4 pt-14 pb-6 sm:px-6 md:pt-24 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-10">
            <div>
              <CornerLabel className="text-foreground mb-8 md:hidden" />
              <h1 className="display text-[3rem] leading-[0.98] sm:text-[4.5rem] lg:text-[5.25rem]">
                Pay for <em>real</em> work.
              </h1>
              <p className="text-soft mt-7 max-w-[34rem] text-lg leading-relaxed sm:text-xl">
                Merit escrows RLO, has an AI judge score each submission through a governed credential, lets Rialo validators verify
                the post with REX, and settles every round with a native timer. The chain checks the work before it pays.
              </p>
              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-12 rounded-xl px-6 text-base">
                  <Link href="/app">Run a campaign</Link>
                </Button>
                <Button asChild size="lg" variant="ghost" className="bg-card/70 hover:bg-card h-12 rounded-xl px-6 text-base">
                  <Link href={`/c/${ROUND1.campaign}`}>
                    See a real round <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
              <p className="text-muted-foreground mt-6 font-mono text-xs">Test RLO only · every number on this site is read from Rialo DevNet</p>
            </div>
            <div className="flex justify-center lg:justify-end">
              <BlobField className="text-foreground h-auto w-full max-w-[36rem]" />
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-[1240px] items-center gap-10 px-4 pt-20 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="max-w-[26rem]">
            <DecisionMoment record={record} text={seed?.text} handle={seed?.xUsername} />
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-10">
            <BigNumber label="RLO paid to contributors">{formatRlo(paid, 3)}</BigNumber>
            <BigNumber label="Campaign workflows on chain">{campaigns.length}</BigNumber>
            <BigNumber label="RLO repaid to the agent for REX">{formatRlo(reimbursed, 3)}</BigNumber>
            <BigNumber label="Keepers needed for payouts">0</BigNumber>
          </dl>
        </section>

        <Section id="how-it-works">
          <Heading title={<>Four steps, <em>no</em> trusted middleman.</>}>
            Each step is something you can check: a policy in Latch, a report from validators, or a transaction on Rialo.
          </Heading>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <div key={s.title} className="bg-card shadow-soft rounded-[20px] p-6">
                <div className="flex items-center justify-between">
                  <s.icon className="text-brand size-5" strokeWidth={1.5} />
                  <span className="text-muted-foreground font-mono text-xs">0{i + 1}</span>
                </div>
                <h3 className="display mt-6 text-[1.5rem] leading-tight">{s.title}</h3>
                <p className="text-soft mt-2 text-sm leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="guardrails">
          <Heading title={<>What runs <em>where</em>.</>}>
            The money and the verification live on Rialo. Credentials live in Latch. Merit&apos;s server only judges and signs approvals,
            inside caps it cannot change.
          </Heading>
          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {layers.map((l) => (
              <div key={l.title} className="bg-card shadow-soft rounded-[20px] p-6">
                <p className="label">{l.title}</p>
                <ul className="mt-4 grid gap-2.5 text-sm">
                  {l.items.map((item) => (
                    <li key={item} className="flex gap-2.5">
                      <Check className="text-brand mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-muted-foreground mt-6 text-sm">
            The model behind the timers:{" "}
            <a className="text-foreground underline underline-offset-4" href={PAPER_URL} target="_blank" rel="noreferrer">
              Reactive Transactions: A Model for Native Automation on Rialo
            </a>
            .
          </p>
        </Section>

        <Section>
          <div className="bg-primary text-primary-foreground relative overflow-hidden rounded-[2rem] px-7 py-16 text-center sm:px-12 md:py-24">
            <CoinsArt className="pointer-events-none absolute -bottom-6 -left-6 size-44 opacity-25 sm:size-56" />
            <SealArt className="pointer-events-none absolute -top-8 -right-6 size-40 opacity-25 sm:size-52" />
            <h2 className="display relative mx-auto max-w-3xl text-[2.5rem] leading-[1.02] sm:text-[3.75rem]">
              Run your first campaign on Merit.
            </h2>
            <p className="relative mx-auto mt-5 max-w-md text-lg leading-relaxed opacity-80">
              A wallet in your browser, a faucet, and a few fields. The chain does the rest.
            </p>
            <div className="relative mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" variant="secondary" className="h-12 rounded-xl px-6 text-base">
                <Link href="/app">Run a campaign</Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="hover:bg-primary-foreground/10 h-12 rounded-xl px-6 text-base text-inherit hover:text-inherit">
                <Link href="/join">Contribute</Link>
              </Button>
            </div>
          </div>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}

/** The hero's right side: round 1's real decision, as it appears on chain. */
function DecisionMoment({ record, text, handle }: { record: JudgeRecord | null; text?: string; handle?: string }) {
  if (!record) return null;
  return (
    <Link
      href={`/c/${ROUND1.campaign}`}
      className="bg-card block w-full rounded-[20px] border border-foreground p-6 transition-transform hover:-translate-y-0.5"
      aria-label="Open round 1 of the first real campaign"
    >
      <div className="flex items-center justify-between">
        <p className="label">Round 1 · real decision</p>
        <span className="bg-success-subtle text-success inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-xs font-medium">
          <Check className="size-3" /> Paid
        </span>
      </div>
      <p className="mt-4 font-medium">@{handle}</p>
      <p className="text-soft mt-2 line-clamp-4 text-sm leading-relaxed whitespace-pre-line">{text}</p>
      <div className="mt-5 flex items-end justify-between border-t pt-5">
        <div>
          <p className="text-muted-foreground text-xs">Judge score</p>
          <p className="display mt-1 text-5xl leading-none tabular-nums">{record.score}</p>
        </div>
        <div className="text-right">
          <p className="text-muted-foreground text-xs">Paid by the round timer</p>
          <p className="mt-1 font-mono text-lg tabular-nums">0.0580 RLO</p>
        </div>
      </div>
      <ul className="text-soft mt-4 grid gap-1.5 text-xs">
        {record.reasons.slice(0, 2).map((r) => (
          <li key={r} className="flex gap-2">
            <span className="text-brand">·</span>
            {r}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap gap-2">
        <span className="bg-success-subtle text-success inline-flex h-6 items-center gap-1.5 rounded-md px-2 font-mono text-xs">
          <ShieldCheck className="size-3.5" /> REX unanimous 4/4
        </span>
        <span className="bg-brand-subtle text-brand-soft inline-flex h-6 items-center rounded-md px-2 font-mono text-xs">hash matches chain</span>
      </div>
    </Link>
  );
}

function Section({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-[1240px] scroll-mt-24 px-4 pt-32 sm:px-6 md:pt-40">
      {children}
    </section>
  );
}

function Heading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="max-w-[44rem]">
      <h2 className="display text-[2.5rem] leading-[1.04] sm:text-[3.25rem] lg:text-[3.75rem]">{title}</h2>
      {children ? <p className="text-soft mt-5 max-w-[36rem] text-lg leading-relaxed">{children}</p> : null}
    </div>
  );
}

function BigNumber({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dd className="display text-5xl leading-none tabular-nums sm:text-6xl">{children}</dd>
      <dt className="text-muted-foreground mt-3 text-sm">{label}</dt>
    </div>
  );
}
