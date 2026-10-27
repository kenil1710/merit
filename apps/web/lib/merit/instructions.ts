// Instruction builders for every user-facing Merit instruction. They mirror
// the Rust builders Venus generates (`merit::interface`) account for account
// and byte for byte; test/instructions.test.ts checks them against
// `merit-tools vectors`.

import { PublicKey, type Instruction } from "@rialo/ts-cdk";
import { Writer } from "./codec";
import { PROGRAM_ID, REX_COMPONENTS_ID, SUBSCRIBER_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "./constants";
import { multiAccountSlug, nonce, subscriptionAddress, workflowAddress } from "./pda";

/// Variant tags from programs/merit/wit/merit-manifest.json.
export const TAGS = {
  create_campaign: 3,
  open_ledger: 5,
  open_payee: 6,
  set_payee: 2,
  fund: 9,
  start: 10,
  end: 11,
  withdraw: 12,
  fund_ops: 13,
  withdraw_ops: 14,
  refund: 15,
  resume: 16,
  set_agent: 17,
  set_round_length: 18,
  pause: 19,
  unpause: 20,
  close_round: 21,
  set_limits: 22,
  approve_round: 23,
  approve: 24,
  retry_verify: 25,
  revoke: 26,
} as const;

type Meta = { pubkey: string; isSigner: boolean; isWritable: boolean };

export type PlainInstruction = { programId: string; accounts: Meta[]; data: Uint8Array };

type Shape = {
  /// Timers armed by this instruction (subscription PDAs at branch 0).
  subscriptions: number;
  /// Caller-named accounts in declaration order (all read-only here).
  userAccounts: string[];
};

function build(name: keyof typeof TAGS, payer: string, slug: Uint8Array, shape: Shape, fields: (w: Writer) => void): PlainInstruction {
  const slugNonce = nonce(slug);
  const workflow = workflowAddress(payer, slugNonce);
  const accounts: Meta[] = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: workflow, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  if (shape.subscriptions > 0) {
    accounts.push({ pubkey: SUBSCRIBER_PROGRAM_ID, isSigner: false, isWritable: false });
    for (let i = 0; i < shape.subscriptions; i++) {
      const slugForAccount = multiAccountSlug(workflow, 0, accounts.length);
      accounts.push({ pubkey: subscriptionAddress(payer, slugForAccount), isSigner: false, isWritable: true });
    }
  }
  for (const pubkey of shape.userAccounts) accounts.push({ pubkey, isSigner: false, isWritable: false });
  const writer = new Writer().u32(TAGS[name]).fixed(slugNonce, 32);
  fields(writer);
  return { programId: PROGRAM_ID, accounts, data: writer.bytes() };
}

const none: Shape = { subscriptions: 0, userAccounts: [] };
const oneTimer: Shape = { subscriptions: 1, userAccounts: [] };

export type CampaignConfig = {
  agent: string;
  rateKelvin: bigint;
  minScore: bigint;
  capPerPayout: bigint;
  capPerContributor: bigint;
  capPerRound: bigint;
  roundLengthMs: bigint;
  refundDeadlineMs: bigint;
};

export const ix = {
  createCampaign: (owner: string, slug: Uint8Array, c: CampaignConfig) =>
    build("create_campaign", owner, slug, none, (w) =>
      w.pubkey(c.agent).u64(c.rateKelvin).u64(c.minScore).u64(c.capPerPayout).u64(c.capPerContributor)
        .u64(c.capPerRound).u64(c.roundLengthMs).u64(c.refundDeadlineMs).pubkey(REX_COMPONENTS_ID)),
  // `fund` re-arms settlement when a campaign was waiting for funds.
  fund: (owner: string, slug: Uint8Array, amount: bigint) => build("fund", owner, slug, oneTimer, (w) => w.u64(amount)),
  fundOps: (owner: string, slug: Uint8Array, amount: bigint) => build("fund_ops", owner, slug, none, (w) => w.u64(amount)),
  start: (owner: string, slug: Uint8Array) => build("start", owner, slug, oneTimer, () => {}),
  end: (owner: string, slug: Uint8Array) => build("end", owner, slug, none, () => {}),
  withdraw: (owner: string, slug: Uint8Array, amount: bigint) => build("withdraw", owner, slug, none, (w) => w.u64(amount)),
  withdrawOps: (owner: string, slug: Uint8Array, amount: bigint) => build("withdraw_ops", owner, slug, none, (w) => w.u64(amount)),
  refund: (owner: string, slug: Uint8Array) => build("refund", owner, slug, none, () => {}),
  // `resume` arms either a beat or a settle step; Venus reserves one slot
  // for the if/else pair.
  resume: (owner: string, slug: Uint8Array) => build("resume", owner, slug, oneTimer, () => {}),
  setAgent: (owner: string, slug: Uint8Array, agent: string) => build("set_agent", owner, slug, none, (w) => w.pubkey(agent)),
  setRoundLength: (owner: string, slug: Uint8Array, ms: bigint) => build("set_round_length", owner, slug, none, (w) => w.u64(ms)),
  openLedger: (agent: string, ledgerSlug: Uint8Array, campaign: string, round: bigint, tokenHex: string) =>
    build("open_ledger", agent, ledgerSlug, { subscriptions: 0, userAccounts: [campaign] }, (w) =>
      w.pubkey(campaign).u64(round).string(tokenHex).pubkey(REX_COMPONENTS_ID)),
  // `payee` is the contributor's payee account (program v2); with no cooldown the program ignores it.
  approve: (agent: string, ledgerSlug: Uint8Array, a: { campaign: string; contributor: string; xUserId: bigint; postId: bigint; score: bigint; submissionHash: string; payee: string }) =>
    build("approve", agent, ledgerSlug, { subscriptions: 1, userAccounts: [a.campaign, a.payee] }, (w) =>
      w.pubkey(a.campaign).pubkey(a.contributor).u64(a.xUserId).u64(a.postId).u64(a.score).pubkey(a.submissionHash).pubkey(a.payee)),
  retryVerify: (agent: string, ledgerSlug: Uint8Array, campaign: string, index: bigint) =>
    build("retry_verify", agent, ledgerSlug, { subscriptions: 1, userAccounts: [campaign] }, (w) => w.pubkey(campaign).u64(index)),
  // Program v2: owner controls.
  pause: (owner: string, slug: Uint8Array) => build("pause", owner, slug, none, () => {}),
  unpause: (owner: string, slug: Uint8Array) => build("unpause", owner, slug, none, () => {}),
  closeRound: (owner: string, slug: Uint8Array) => build("close_round", owner, slug, none, () => {}),
  setLimits: (owner: string, slug: Uint8Array, l: { maxPerDay: bigint; approvalThreshold: bigint; cooldownMs: bigint; submitGraceMs: bigint }) =>
    build("set_limits", owner, slug, none, (w) => w.u64(l.maxPerDay).u64(l.approvalThreshold).u64(l.cooldownMs).u64(l.submitGraceMs)),
  approveRound: (owner: string, slug: Uint8Array) => build("approve_round", owner, slug, oneTimer, () => {}),
  // Program v2: agent controls.
  revoke: (agent: string, ledgerSlug: Uint8Array, campaign: string, index: bigint) =>
    build("revoke", agent, ledgerSlug, { subscriptions: 0, userAccounts: [campaign] }, (w) => w.pubkey(campaign).u64(index)),
  openPayee: (agent: string, payeeSlug: Uint8Array, campaign: string, xUserId: bigint, wallet: string) =>
    build("open_payee", agent, payeeSlug, { subscriptions: 0, userAccounts: [campaign] }, (w) => w.pubkey(campaign).u64(xUserId).pubkey(wallet).pubkey(REX_COMPONENTS_ID)),
  setPayee: (agent: string, payeeSlug: Uint8Array, wallet: string) => build("set_payee", agent, payeeSlug, none, (w) => w.pubkey(wallet)),
};

export function toCdkInstruction(plain: PlainInstruction): Instruction {
  return {
    programId: PublicKey.fromString(plain.programId),
    accounts: plain.accounts.map((meta) => ({ pubkey: PublicKey.fromString(meta.pubkey), isSigner: meta.isSigner, isWritable: meta.isWritable })),
    data: plain.data,
  };
}
