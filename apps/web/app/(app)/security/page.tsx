import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, Notice, PageHeader, Section, TableFrame } from "@/components/ui-kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Security",
  description: "How Merit was reviewed: two AI-assisted code reviews, 30 on-chain negative tests, every finding and its status, and the known limits.",
};

const REPO = "https://github.com/kenil1710/merit/blob/main";
const AUDIT = `${REPO}/docs/AUDIT.md`;
const REAUDIT = `${REPO}/docs/REAUDIT.md`;
const EVIDENCE = `${REPO}/docs/EVIDENCE.md#negative-tests-of-the-merit-program-on-devnet-2026-10-27`;
const NEGATIVE = `${REPO}/deployments/devnet-negative.json`;
const LIMITS = `https://github.com/kenil1710/merit#known-limits-and-roadmap`;

type Status = "Fixed" | "Fixed in part" | "Won't fix now" | "Noted";
type Finding = { id: string; severity: "High" | "Medium" | "Low" | "Info"; what: string; status: Status; note: string };

// From docs/AUDIT.md and docs/REAUDIT.md (their status lines are the source; keep this table in step with them).
const FINDINGS: Finding[] = [
  { id: "H-1", severity: "High", what: "Pre-funding a future round's ledger address froze settlement", status: "Fixed", note: "Program v3. Confirmed on DevNet first, then fixed and re-tested there." },
  { id: "H-2", severity: "High", what: "The old v1 submit path skipped the agent's checks", status: "Fixed", note: "Endpoints return 410; the agent is the only path to an approval." },
  { id: "M-1", severity: "Medium", what: "No way out of a stuck Settling round", status: "Fixed", note: "skip_stuck (tightened in v4). Its skip paths are tested in unit tests only, not on chain." },
  { id: "M-2", severity: "Medium", what: "A post could verify in two rounds after an early close", status: "Fixed", note: "Program v3; tested on DevNet." },
  { id: "M-3", severity: "Medium", what: "The owner can change limits that apply to the open round", status: "Fixed in part", note: "Frozen while a round settles; a change during an open round still applies to it." },
  { id: "M-4", severity: "Medium", what: "Open redirect after X sign-in", status: "Fixed", note: "Same-origin return paths only; checked live." },
  { id: "M-5", severity: "Medium", what: "“Read it” could drain the judge's daily budget", status: "Fixed in part", note: "Per-owner, wallet, network and global limits. No dedicated latch for it yet." },
  { id: "N-1", severity: "Medium", what: "skip_stuck was available too early (re-audit)", status: "Fixed", note: "Program v4: needs a resume and 10 quiet minutes; tested on DevNet." },
  { id: "L-1", severity: "Low", what: "Two agent runs on one submission at once", status: "Won't fix now", note: "Can't double-pay (the chain refuses a duplicate); can show a wrong status." },
  { id: "L-2", severity: "Low", what: "Signed cookies didn't name their type", status: "Fixed", note: "" },
  { id: "L-3", severity: "Low", what: "Missing Origin checks on some POSTs", status: "Fixed", note: "" },
  { id: "L-4", severity: "Low", what: "Rate limits were per server instance", status: "Fixed", note: "Counted in Neon; side effects are N-2 and N-3." },
  { id: "L-5", severity: "Low", what: "The RPC relay forwarded unchecked params", status: "Fixed", note: "" },
  { id: "L-6", severity: "Low", what: "The agent pays contributors' payee rent", status: "Won't fix now", note: "Needs a program change; the agent balance is watched by hand." },
  { id: "L-7", severity: "Low", what: "Pause and refund edge cases", status: "Fixed in part", note: "Nothing pays while paused; one refund case is documented." },
  { id: "L-8", severity: "Low", what: "Judge records keyed by post, not by campaign and post", status: "Fixed in part", note: "Public views never write; the key change needs a migration." },
  { id: "L-9", severity: "Low", what: "Two different “verifications left” numbers", status: "Fixed", note: "" },
  { id: "L-10", severity: "Low", what: "No Content Security Policy", status: "Fixed in part", note: "A CSP is live but allows inline scripts." },
  { id: "L-11", severity: "Low", what: "The agent backstop runs once a day", status: "Won't fix now", note: "Vercel Hobby allows one cron a day; documented." },
  { id: "L-12", severity: "Low", what: "Tables that grew without bound", status: "Fixed", note: "Daily cleanup." },
  { id: "L-13", severity: "Low", what: "Docs overstated some results", status: "Fixed", note: "For example: 30 sent, 29 rejected, 1 no-op." },
  { id: "N-2", severity: "Low", what: "Shared rate limits count refused calls", status: "Won't fix now", note: "One client can use up “Read it” or the probes for everyone for a while." },
  { id: "N-3", severity: "Low", what: "The wallet relay depends on Neon", status: "Won't fix now", note: "If Neon is down the in-browser wallet can't read or send." },
  { id: "I-1", severity: "Info", what: "Wasted thread search calls", status: "Fixed", note: "" },
  { id: "I-2", severity: "Info", what: "Decision signatures have no domain prefix", status: "Won't fix now", note: "Not exploitable today; planned for the next record version." },
  { id: "I-3", severity: "Info", what: "The public record checks the hash, not the signature", status: "Fixed", note: "The page now says which check it runs." },
  { id: "I-4", severity: "Info", what: "The append-only audit table can be altered by the app's role", status: "Won't fix now", note: "Needs a separate database role." },
  { id: "N-4", severity: "Info", what: "Cron cleanup can block that day's retries", status: "Won't fix now", note: "" },
  { id: "N-5, N-6, I-5, I-6", severity: "Info", what: "Notes on a changed field, an account index, upgrades and reviewer powers", status: "Noted", note: "Documented; nothing to fix." },
];

const TONE: Record<Status, string> = {
  Fixed: "bg-success-subtle text-success",
  "Fixed in part": "bg-warning-subtle text-warning",
  "Won't fix now": "bg-muted text-muted-foreground",
  Noted: "bg-muted text-muted-foreground",
};

const LIMIT_LIST = [
  "Owner limit changes made while a round is open apply to that round (M-3).",
  "skip_stuck's skip paths are covered by unit tests only, not on chain (M-1).",
  "The Content Security Policy still allows inline scripts (L-10).",
  "Shared rate limits count refused calls, so one client can switch off “Read it” or the probes for a while (N-2).",
  "The wallet relay needs Neon: if it is down, the in-browser wallet can't read or send (N-3).",
  "The agent is a DevNet key held by Merit's server; the program's caps are the wall around it.",
  "The X account ↔ wallet link is attested by Merit (X sign-in plus a wallet signature), not proven on chain.",
  "DevNet only, test RLO.",
];

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-foreground inline-flex items-center gap-0.5 underline underline-offset-4">
      {children}
      <ArrowUpRight className="size-3" aria-hidden="true" />
    </a>
  );
}

/** How Merit was checked, said plainly: what was reviewed, by whom, what was found, and what is still open. */
export default function SecurityPage() {
  const count = (s: Status) => FINDINGS.filter((f) => f.status === s).length;
  return (
    <div className="grid gap-10">
      <PageHeader
        title={<>How Merit was <em>checked</em></>}
        description="What was reviewed, how, what was found and what is still open. Every claim here links to the report or the on-chain evidence behind it."
      />

      <Notice tone="warning">
        <span data-testid="not-an-audit">
          <strong>This is not a professional third-party audit.</strong> Merit was reviewed by two AI-assisted code reviews, not by a security firm. Treat it as DevNet software
          holding test RLO.
        </span>
      </Notice>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Two independent AI-assisted code reviews" description="Each ran in a fresh session that did not build or fix the code.">
          <ul className="text-soft grid gap-3 text-sm leading-relaxed">
            <li>
              <span className="text-foreground font-medium">Review 1 (audit), 2026-10-28.</span> Read the docs and all the code (web, agent, Latch wiring, the on-chain program),
              scanned the history and the live bundles for secrets, and checked the live site. Read-only: it sent no transactions. <Ext href={AUDIT}>docs/AUDIT.md</Ext>
            </li>
            <li>
              <span className="text-foreground font-medium">Review 2 (re-audit), 2026-10-28.</span> Checked each fix against the code and the live site, judged whether every
              “won&apos;t fix” reason was fair, and found new issues (N-1 to N-6). <Ext href={REAUDIT}>docs/REAUDIT.md</Ext>
            </li>
            <li>The fixes were made in a separate session. Neither review ran the test suites itself, and their on-chain findings came from reading the code; where the reports say a finding was confirmed on DevNet, that was done afterwards and is in the evidence.</li>
          </ul>
        </Card>
        <Card title="30 negative tests on chain" description="Invalid instructions sent to Merit's own program on DevNet, which must refuse them.">
          <div className="grid gap-3 text-sm">
            <p>
              <span className="display text-4xl tabular-nums">30</span>
              <span className="text-muted-foreground"> sent · 29 rejected on chain · 1 no-op</span>
            </p>
            <p className="text-soft leading-relaxed">
              Strangers calling owner and agent instructions, bad campaign configs, over-cap and duplicate approvals, approvals inside a payee cooldown or while paused, and
              forged REX reports, against two test campaigns only. One forged report landed after its
              entry had finished its own check, so it changed nothing and proves nothing; its retry against a pending entry was rejected. Every case has its transaction
              signature.
            </p>
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              <Ext href={EVIDENCE}>Evidence (EVIDENCE.md)</Ext>
              <Ext href={NEGATIVE}>All signatures (JSON)</Ext>
            </p>
          </div>
        </Card>
      </div>

      <Section
        title="Findings and their status"
        description={`${FINDINGS.length} rows from both reports: ${count("Fixed")} fixed, ${count("Fixed in part")} fixed in part, ${count("Won't fix now")} won't fix now, ${count("Noted")} noted. The reports have the details and the exact status line for each.`}
      >
        <TableFrame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24 pl-4">Finding</TableHead>
                <TableHead>What</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="hidden pr-4 md:table-cell">Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FINDINGS.map((f) => (
                <TableRow key={f.id} data-testid="finding-row">
                  <TableCell className="pl-4 align-top">
                    <span className="font-mono text-xs">{f.id}</span>
                    <span className="text-muted-foreground block text-xs">{f.severity}</span>
                  </TableCell>
                  <TableCell className="align-top text-sm whitespace-normal">
                    {f.what}
                    {f.note ? <span className="text-muted-foreground mt-0.5 block text-xs md:hidden">{f.note}</span> : null}
                  </TableCell>
                  <TableCell className="align-top">
                    <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium whitespace-nowrap", TONE[f.status])}>{f.status}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden pr-4 align-top text-xs whitespace-normal md:table-cell">{f.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
      </Section>

      <Section title="Known limits" description="Still true today. The README keeps the full list.">
        <ul className="bg-card shadow-soft text-soft grid gap-2 rounded-[1.25rem] p-6 text-sm leading-relaxed">
          {LIMIT_LIST.map((l) => (
            <li key={l} className="flex gap-3">
              <span className="bg-warning mt-2 size-1.5 shrink-0 rounded-full" aria-hidden="true" />
              {l}
            </li>
          ))}
          <li className="pt-2">
            <Ext href={LIMITS}>README: Known limits and roadmap</Ext>
          </li>
        </ul>
      </Section>

      <p className="text-muted-foreground text-sm">
        Live policy checks are on{" "}
        <Link href="/guardrails" className="text-foreground underline underline-offset-4">
          Guardrails
        </Link>
        : every Latch filter in use, and buttons that send a bad request and show Latch&apos;s real refusal.
      </p>
    </div>
  );
}
