// Decodes Merit workflow accounts (bincode, field order from the manifest).

import { Reader } from "./codec";
import { KIND } from "./constants";

export type Entry = {
  index: number;
  contributor: string;
  xUserId: bigint;
  postId: bigint;
  score: bigint;
  amount: bigint;
  submissionHash: string;
  status: bigint;
  attempts: bigint;
  checkedMs: bigint;
  reportAccount: string;
};

export type MeritState = {
  address: string;
  kelvin: bigint;
  kind: bigint;
  owner: string;
  agent: string;
  nextAgent: string;
  campaign: string;
  rateKelvin: bigint;
  minScore: bigint;
  capPerPayout: bigint;
  capPerContributor: bigint;
  capPerRound: bigint;
  roundLengthMs: bigint;
  nextRoundLengthMs: bigint;
  refundDeadlineMs: bigint;
  phase: bigint;
  ending: boolean;
  timerEpoch: bigint;
  escrowKelvin: bigint;
  totalFunded: bigint;
  totalPaid: bigint;
  totalWithdrawn: bigint;
  totalRefunded: bigint;
  opsBudgetKelvin: bigint;
  totalOpsFunded: bigint;
  totalOpsReimbursed: bigint;
  roundReimbursed: boolean;
  round: bigint;
  roundStartMs: bigint;
  roundEndMs: bigint;
  roundAgent: string;
  beats: bigint;
  lastBeatMs: bigint;
  roundPaidKelvin: bigint;
  outcome: bigint[];
  entryCount: bigint;
  entries: Entry[];
  xTokenBytes: number;
  rexBytecodeAccount: string;
  /** Program v2 fields (`programs/merit`); v1 accounts decode with the defaults below. */
  version: 1 | 2;
  paused: boolean;
  /** Rolling 24-hour payout cap in kelvin (0 = none). */
  maxPerDay: bigint;
  /** A round paying more than this waits for the owner's approve_round (0 = never). */
  approvalThreshold: bigint;
  /** A payee's wallet must be registered this long before an approval pays it (0 = no cooldown). */
  cooldownMs: bigint;
  /** Approvals for a closed round are still taken this long after it closes. */
  submitGraceMs: bigint;
  roundApproved: boolean;
  /** Rolling cap buckets: hour number and kelvin paid in it. */
  dayHours: bigint[];
  dayPaid: bigint[];
  /** Payee accounts (kind 3): the X account, its registered wallet and since when. */
  payeeXUser: bigint;
  payeeWallet: string;
  payeeSinceMs: bigint;
};

const V1_DEFAULTS = {
  version: 1 as const,
  paused: false,
  maxPerDay: 0n,
  approvalThreshold: 0n,
  cooldownMs: 0n,
  submitGraceMs: 0n,
  roundApproved: false,
  dayHours: [] as bigint[],
  dayPaid: [] as bigint[],
  payeeXUser: 0n,
  payeeWallet: "11111111111111111111111111111111",
  payeeSinceMs: 0n,
};

export function decodeState(address: string, data: Uint8Array, kelvin: bigint): MeritState {
  const r = new Reader(data);
  r.u64(); // Venus branch counter (next_branch_number_to_allocate)
  const head = {
    kind: r.u64(), owner: r.pubkey(), agent: r.pubkey(), nextAgent: r.pubkey(), campaign: r.pubkey(),
    rateKelvin: r.u64(), minScore: r.u64(), capPerPayout: r.u64(), capPerContributor: r.u64(), capPerRound: r.u64(),
    roundLengthMs: r.u64(), nextRoundLengthMs: r.u64(), refundDeadlineMs: r.u64(), phase: r.u64(), ending: r.bool(),
    timerEpoch: r.u64(), escrowKelvin: r.u64(), totalFunded: r.u64(), totalPaid: r.u64(), totalWithdrawn: r.u64(),
    totalRefunded: r.u64(), opsBudgetKelvin: r.u64(), totalOpsFunded: r.u64(), totalOpsReimbursed: r.u64(),
    roundReimbursed: r.bool(), round: r.u64(), roundStartMs: r.u64(), roundEndMs: r.u64(), roundAgent: r.pubkey(),
    beats: r.u64(), lastBeatMs: r.u64(), roundPaidKelvin: r.u64(),
  };
  const outcome = r.vecU64();
  const entryCount = r.u64();
  const contributors = r.vecPubkey();
  const xUsers = r.vecU64();
  const posts = r.vecU64();
  const scores = r.vecU64();
  const amounts = r.vecU64();
  const hashes = r.vecPubkey();
  const statuses = r.vecU64();
  const attempts = r.vecU64();
  const checked = r.vecU64();
  const reports = r.vecPubkey();
  const xToken = r.rawBytes();
  // v1 ends with the REX bytecode account; v2 adds its fields before it.
  const v2 =
    r.remaining() > 32
      ? {
          version: 2 as const,
          paused: r.bool(),
          maxPerDay: r.u64(),
          approvalThreshold: r.u64(),
          cooldownMs: r.u64(),
          submitGraceMs: r.u64(),
          roundApproved: r.bool(),
          dayHours: r.vecU64(),
          dayPaid: r.vecU64(),
          payeeXUser: r.u64(),
          payeeWallet: r.pubkey(),
          payeeSinceMs: r.u64(),
        }
      : V1_DEFAULTS;
  const rexBytecodeAccount = r.pubkey();
  const count = Math.min(Number(entryCount), contributors.length);
  const entries: Entry[] = Array.from({ length: count }, (_, index) => ({
    index,
    contributor: contributors[index],
    xUserId: xUsers[index],
    postId: posts[index],
    score: scores[index],
    amount: amounts[index],
    submissionHash: hashes[index],
    status: statuses[index],
    attempts: attempts[index],
    checkedMs: checked[index],
    reportAccount: reports[index],
  }));
  return { address, kelvin, ...head, outcome, entryCount, entries, xTokenBytes: xToken.length, rexBytecodeAccount, ...v2 };
}

export const isCampaign = (state: MeritState) => state.kind === KIND.CAMPAIGN;
export const isLedger = (state: MeritState) => state.kind === KIND.LEDGER;
