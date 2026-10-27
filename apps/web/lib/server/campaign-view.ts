import "server-only";

// Builds the public record of a campaign from the chain, plus the judge's
// stored reasons (checked against the hash each ledger entry carries).

import { RpcClient, findLedger, loadReport, loadState, meritEvents, type ValidatorOutput } from "@/lib/merit/chain";
import { ENTRY_STATUS_NAMES, PHASE_NAMES, RPC_UPSTREAM } from "@/lib/merit/constants";
import { verifyJudgement, type JudgeRecord } from "@/lib/merit/judgement";
import type { MeritState } from "@/lib/merit/state";
import { expiredBelow } from "@/lib/shared/round-window";
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
  rounds: RoundView[];
  /** Rounds numbered below this can't pay any more (work still waiting for a person from them has expired). */
  expiredBelow: number;
  activity: { signature: string; blockTime?: number; lines: string[]; failed: boolean }[];
};

const s = (v: bigint) => v.toString();

async function payoutFor(contributor: string, postId: string, round: number) {
  const pattern = new RegExp(`^Merit paid (\\d+) kelvin to ${contributor} for post ${postId} \\(round ${round}\\)$`);
  for (const event of await meritEvents(rpc, contributor, 25)) {
    const line = event.lines.find((l) => pattern.test(l));
    if (line && !event.failed) return { payout: event.signature, payoutLine: line };
  }
  return {};
}

async function decisions(ledger: MeritState): Promise<DecisionView[]> {
  const events = await meritEvents(rpc, ledger.address, 50);
  return Promise.all(
    ledger.entries.map(async (entry) => {
      const postId = entry.postId.toString();
      const approve = events.find((e) => !e.failed && e.lines.some((l) => l.startsWith(`Merit approved post ${postId} `)));
      const verdict = events.find((e) => !e.failed && e.lines.some((l) => l.startsWith(`Merit post ${postId} verdict`)));
      const stored = await store.judgement(postId);
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
      const report = entry.reportAccount !== "11111111111111111111111111111111" ? await loadReport(rpc, entry.reportAccount) : null;
      const rex = report
        ? {
            reportAccount: entry.reportAccount,
            round: report.round.toString(),
            outputs: report.outputs,
            unanimous: report.outputs.length >= 3 && report.outputs.every((o) => o.ok && o.payload === report.outputs[0].payload),
          }
        : undefined;
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
        judge,
        submissionHash: entry.submissionHash,
        rex,
        tx: {
          approve: approve?.signature,
          verdict: verdict?.signature,
          verdictLine: verdict?.lines.find((l) => l.includes("verdict")),
          ...(await payoutFor(entry.contributor, postId, Number(ledger.round))),
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
      return { round: Number(n), ledger: ledger?.address, agent: ledger?.agent, decisions: ledger ? await decisions(ledger) : [] };
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
    rounds,
    expiredBelow: expiredBelow(state)!,
    activity,
  };
}
