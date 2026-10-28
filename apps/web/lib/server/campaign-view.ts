import "server-only";

// Builds the public record of a campaign from the chain, plus the judge's
// stored reasons (checked against the hash each ledger entry carries).

import { RpcClient, findLedger, loadReport, loadState, meritEvents, type MeritEvent, type ValidatorOutput } from "@/lib/merit/chain";
import { ENTRY_STATUS_NAMES, PHASE_NAMES, RPC_UPSTREAM } from "@/lib/merit/constants";
import { verifyJudgement, type JudgeRecord } from "@/lib/merit/judgement";
import type { MeritState } from "@/lib/merit/state";
import { expiredBelow, roundStatus, type RoundState } from "@/lib/shared/round-window";
import { approvalFacts } from "./judge-records";
import { store, type CampaignMeta } from "./store";

const rpc = new RpcClient(RPC_UPSTREAM);

export type DecisionView = {
  index: number;
  postId: string;
  xUserId: string;
  xUsername?: string;
  contributor: string;
  score: number;
  amountKelvin: string;
  status: string;
  attempts: number;
  verifiedAt?: number;
  /** Paid on chain: the payout log line, or (when DevNet no longer lists it) the agent's own record of the payout. */
  paid: boolean;
  /** The round has settled: nothing about this entry changes any more. */
  settled: boolean;
  judge?: { reasons: string[]; checks: Record<string, boolean>; createdAt: string; text: string; hashMatches: boolean };
  submissionHash: string;
  rex?: { reportAccount: string; round: string; outputs: ValidatorOutput[]; unanimous: boolean };
  tx: { approve?: string; verdict?: string; verdictLine?: string; payout?: string; payoutLine?: string };
};

export type RoundView = { round: number; ledger?: string; agent?: string; decisions: DecisionView[] };

export type CampaignView = {
  address: string;
  meta: CampaignMeta | null;
  phase: string;
  phaseCode: number;
  owner: string;
  agent: string;
  nextAgent: string;
  ending: boolean;
  config: { rateKelvin: string; minScore: number; capPerPayout: string; capPerContributor: string; capPerRound: string; roundLengthMs: number; nextRoundLengthMs: number; refundDeadlineMs: number };
  books: { escrow: string; funded: string; paid: string; withdrawn: string; refunded: string; ops: string; opsFunded: string; opsReimbursed: string; accountKelvin: string };
  round: { number: number; startMs: number; endMs: number; beats: number; lastBeatMs: number; paidKelvin: string };
  /** The round clock as /join and Explore read it (`roundStatus`). */
  status: { state: RoundState; text: string; takesSubmissions: boolean; nextOpensAtMs: number | null };
  rounds: RoundView[];
  /** Rounds numbered below this can't pay any more (work still waiting for a person from them has expired). */
  expiredBelow: number;
  activity: { signature: string; blockTime?: number; lines: string[]; failed: boolean }[];
};

const s = (v: bigint) => v.toString();

/**
 * The payout transaction for one entry. Settlement's payout step takes the round's ledger as an account, so it is
 * among the ledger's own (few) transactions; the recipient's wallet, which can be busy, is the fallback.
 */
async function payoutFor(ledgerEvents: MeritEvent[], contributor: string, postId: string, round: number): Promise<{ payout?: string; payoutLine?: string }> {
  const pattern = new RegExp(`^Merit paid (\\d+) kelvin to ${contributor} for post ${postId} \\(round ${round}\\)$`);
  const find = (events: MeritEvent[]) => {
    for (const event of events) {
      const line = event.lines.find((l) => pattern.test(l));
      if (line && !event.failed) return { payout: event.signature, payoutLine: line };
    }
    return null;
  };
  return find(ledgerEvents) ?? find(await meritEvents(rpc, contributor, 25)) ?? {};
}

/** The verdict transaction: the REX callback writes it through the report account, which has only a couple of transactions. */
async function verdictFor(ledgerEvents: MeritEvent[], reportAccount: string, postId: string) {
  const prefix = `Merit post ${postId} verdict`;
  const find = (events: MeritEvent[]) => events.find((e) => !e.failed && e.lines.some((l) => l.startsWith(prefix)));
  const hit = find(ledgerEvents) ?? (reportAccount !== NO_REPORT ? find(await meritEvents(rpc, reportAccount, 10).catch(() => [])) : undefined);
  return hit ? { verdict: hit.signature, verdictLine: hit.lines.find((l) => l.startsWith(prefix)) } : {};
}

const NO_REPORT = "11111111111111111111111111111111";

/**
 * A round's decisions, chain first. An entry exists on the ledger only once the agent's approve landed, so every row
 * is approved; the REX verdict is the entry's status; paid is the payout log line. DevNet lists only an account's 20
 * newest transactions and settlement's polling fills those, so the approve transaction comes from the judge record
 * (or the submission row) and the verdict from the report account. A judge record lost before it was saved is
 * rebuilt from the decision whose hash the entry carries, and saved so the next view reads it directly.
 */
async function decisions(ledger: MeritState, settled: boolean): Promise<DecisionView[]> {
  const events = await meritEvents(rpc, ledger.address, 50);
  return Promise.all(
    ledger.entries.map(async (entry) => {
      const postId = entry.postId.toString();
      const approve = events.find((e) => !e.failed && e.lines.some((l) => l.startsWith(`Merit approved post ${postId} `)));
      let stored = await store.judgement(postId);
      const facts = !stored || stored.submissionHash !== entry.submissionHash || !stored.approveSignature ? await approvalFacts(entry.submissionHash) : null;
      if (facts && (!stored || stored.submissionHash !== entry.submissionHash)) {
        const had = stored;
        stored = facts.judgement;
        await (had ? store.replaceJudgement(postId, stored) : store.saveJudgement(postId, stored)).catch(() => undefined);
      }
      let judge: DecisionView["judge"];
      if (stored) {
        const { record, matches } = verifyJudgement(stored, entry.submissionHash);
        // Round 1's judge record, or a merit.decision/v1 record (reasons from the judgment, checks from the flags).
        const r = record as Partial<JudgeRecord> & { summary?: string; flags?: { code: string; severity: string }[]; judgment?: { output?: { reasons?: string[] } } | null; submission?: { submittedAt?: string } };
        judge = {
          reasons: r.reasons ?? r.judgment?.output?.reasons ?? (r.summary ? [r.summary] : []),
          checks: r.checks ?? Object.fromEntries((r.flags ?? []).map((f) => [f.code.toLowerCase(), f.severity !== "hard"])),
          createdAt: r.created_at ?? r.submission?.submittedAt ?? stored.judgedAt,
          text: stored.text,
          hashMatches: matches,
        };
      }
      const report = entry.reportAccount !== NO_REPORT ? await loadReport(rpc, entry.reportAccount) : null;
      const rex = report
        ? {
            reportAccount: entry.reportAccount,
            round: report.round.toString(),
            outputs: report.outputs,
            unanimous: report.outputs.length >= 3 && report.outputs.every((o) => o.ok && o.payload === report.outputs[0].payload),
          }
        : undefined;
      const payout = await payoutFor(events, entry.contributor, postId, Number(ledger.round));
      return {
        index: entry.index,
        postId,
        xUserId: entry.xUserId.toString(),
        xUsername: stored?.xUsername,
        contributor: entry.contributor,
        score: Number(entry.score),
        amountKelvin: s(entry.amount),
        status: ENTRY_STATUS_NAMES[String(entry.status)] ?? String(entry.status),
        attempts: Number(entry.attempts),
        verifiedAt: entry.checkedMs ? Number(entry.checkedMs) : undefined,
        paid: Boolean(payout.payout) || facts?.submissionStatus === "paid",
        settled,
        judge,
        submissionHash: entry.submissionHash,
        rex,
        tx: {
          approve: approve?.signature ?? stored?.approveSignature ?? facts?.judgement.approveSignature,
          ...(await verdictFor(events, entry.reportAccount, postId)),
          ...payout,
        },
      };
    }),
  );
}

export async function campaignView(address: string): Promise<CampaignView | null> {
  const state = await loadState(rpc, address);
  if (!state || state.kind !== 1n) return null;
  const meta = await store.campaign(address);
  const roundNumbers = Array.from({ length: Number(state.round) }, (_, i) => BigInt(Number(state.round) - i));
  const rounds = await Promise.all(
    roundNumbers.map(async (n): Promise<RoundView> => {
      const ledger = await findLedger(rpc, state, n);
      // A ledger below the current round has settled; the current one settles once the campaign leaves Open.
      const settled = n < state.round || state.phase !== 1n;
      return { round: Number(n), ledger: ledger?.address, agent: ledger?.agent, decisions: ledger ? await decisions(ledger, settled) : [] };
    }),
  );
  const activity = await meritEvents(rpc, address, 15);
  return {
    address,
    meta,
    phase: PHASE_NAMES[String(state.phase)] ?? String(state.phase),
    phaseCode: Number(state.phase),
    owner: state.owner,
    agent: state.agent,
    nextAgent: state.nextAgent,
    ending: state.ending,
    config: {
      rateKelvin: s(state.rateKelvin), minScore: Number(state.minScore), capPerPayout: s(state.capPerPayout),
      capPerContributor: s(state.capPerContributor), capPerRound: s(state.capPerRound), roundLengthMs: Number(state.roundLengthMs),
      nextRoundLengthMs: Number(state.nextRoundLengthMs), refundDeadlineMs: Number(state.refundDeadlineMs),
    },
    books: {
      escrow: s(state.escrowKelvin), funded: s(state.totalFunded), paid: s(state.totalPaid), withdrawn: s(state.totalWithdrawn),
      refunded: s(state.totalRefunded), ops: s(state.opsBudgetKelvin), opsFunded: s(state.totalOpsFunded),
      opsReimbursed: s(state.totalOpsReimbursed), accountKelvin: s(state.kelvin),
    },
    round: {
      number: Number(state.round), startMs: Number(state.roundStartMs), endMs: Number(state.roundEndMs),
      beats: Number(state.beats), lastBeatMs: Number(state.lastBeatMs), paidKelvin: s(state.roundPaidKelvin),
    },
    status: (({ state: st, text, takesSubmissions, nextOpensAt }) => ({ state: st, text, takesSubmissions, nextOpensAtMs: nextOpensAt?.getTime() ?? null }))(roundStatus(state)),
    rounds,
    expiredBelow: expiredBelow(state)!,
    activity,
  };
}
