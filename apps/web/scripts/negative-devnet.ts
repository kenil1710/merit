// Negative tests of Merit's own program on Rialo DevNet: invalid instructions must be rejected, on chain.
//
// Everything runs against fresh test campaigns created here (owner: the merit-contributor-demo keystore key; agent:
// merit-agent-devnet; a throwaway "stranger" key), never against a live campaign. Each instruction is sent without
// preflight, so a rejection lands on chain with its signature and Merit's own log line as the proof.
//
// Usage: npx tsx scripts/negative-devnet.ts <state.json> run|cleanup
//   run      create test campaigns A and B, run every case, print one JSON line per case
//   cleanup  close the round, end both campaigns and withdraw what's left to the owner (after settlement)
//   h1       audit H-1: a stranger pre-funds a future round's ledger address on test campaign C (60 s rounds);
//            prints the campaign's phase over time. On a vulnerable program C stays in SETTLING for good.
//   h1-check reads C again (phase, last settlement transactions)
//   v3       program v3 (audit H-1, M-1, M-2, M-3) on test campaign D (60 s rounds) and the stuck C:
//            pre-funded ledger addresses, skip_stuck, the ledger window after close_round, set_limits while settling
//   v4       program v4 (re-audit N-1) on test campaign E: skip_stuck needs a resume and 10 quiet minutes after it
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair, PublicKey, TransactionBuilder, createRialoClient, encryptSecretBytes, transferInstruction, type Instruction } from "@rialo/ts-cdk";
import { base58 } from "@scure/base";
import { RpcClient, findLedger, loadState } from "../lib/merit/chain";
import { hex, unhex } from "../lib/merit/codec";
import { PROGRAM_ID, SYSTEM_PROGRAM_ID } from "../lib/merit/constants";
import { ix, toCdkInstruction, type PlainInstruction } from "../lib/merit/instructions";
import { ledgerAddress, ledgerSlug, nonce, payeeAddress, payeeSlug, randomSlug, workflowAddress } from "../lib/merit/pda";

const [statePath, mode] = process.argv.slice(2);
const RPC = "https://devnet.rialo.io";
const rpc = new RpcClient(RPC);
const client = createRialoClient({ chain: { id: "rialo:devnet", name: "devnet", rpcUrl: RPC } });
const RLO = 1_000_000_000n;

const keystore = (alias: string) => {
  const s = Uint8Array.from(JSON.parse(readFileSync(path.join(os.homedir(), "Library/Application Support/rialo", `${alias}.keypair`), "utf8")) as number[]);
  return Keypair.fromSecretKey(s.subarray(0, 32));
};
const owner = keystore("merit-contributor-demo");
const agent = keystore("merit-agent-devnet");
type State = { stranger: string; slugA: string; slugB: string; slugC?: string; slugD?: string; slugE?: string; cases: unknown[] };
const state: State = existsSync(statePath!)
  ? (JSON.parse(readFileSync(statePath!, "utf8")) as State)
  : { stranger: base58.encode(crypto.getRandomValues(new Uint8Array(32))), slugA: hex(randomSlug()), slugB: hex(randomSlug()), cases: [] };
const save = () => writeFileSync(statePath!, JSON.stringify(state, null, 1));
save();
const stranger = Keypair.fromSecretKey(base58.decode(state.stranger));
const slugA = unhex(state.slugA);
const slugB = unhex(state.slugB);
const O = owner.publicKey.toString();
const A_ = agent.publicKey.toString();
const S = stranger.publicKey.toString();
const campaignA = workflowAddress(O, nonce(slugA));
const campaignB = workflowAddress(O, nonce(slugB));

const meritLines = (logs: string[]) => logs.map((l) => /Program log: (Merit .*)$/.exec(l)?.[1]).filter((x): x is string => !!x);

/** Sends one instruction signed by `signer` (no preflight) and waits for its on-chain outcome. */
async function send(signer: Keypair, instruction: PlainInstruction | Instruction): Promise<{ signature: string | null; ok: boolean; err: string | null; merit: string[] }> {
  const tx = TransactionBuilder.create()
    .setPayer(signer.publicKey)
    .setValidFrom(BigInt(Date.now()))
    .setConfigHashPrefix(await client.getConfigHashPrefix())
    .addInstruction(typeof instruction.programId === "string" ? toCdkInstruction(instruction as PlainInstruction) : (instruction as Instruction))
    .build()
    .sign(signer);
  let signature: string;
  try {
    const s = (await client.sendTransaction(tx.serialize(), { skipPreflight: true })) as unknown;
    signature = typeof s === "string" ? s : s instanceof Uint8Array ? base58.encode(s) : String(s);
  } catch (e) {
    return { signature: null, ok: false, err: `not accepted by the node: ${(e as Error).message.slice(0, 200)}`, merit: [] };
  }
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const { err, logs } = await rpc.logs(signature);
      return { signature, ok: !err, err: err ? JSON.stringify(err).slice(0, 200) : null, merit: meritLines(logs) };
    } catch {
      // not landed yet
    }
  }
  return { signature, ok: false, err: "not confirmed within 60 s", merit: [] };
}

/** The same instruction, but signed and paid by someone else while naming the original's accounts. */
const asSigner = (instruction: PlainInstruction, signer: string): PlainInstruction => ({
  ...instruction,
  accounts: instruction.accounts.map((m, i) => (i === 0 ? { ...m, pubkey: signer } : m)),
});

async function step(name: string, signer: Keypair, instruction: PlainInstruction | Instruction, expect: "accepted" | "rejected") {
  const r = await send(signer, instruction);
  const pass = expect === "accepted" ? r.ok : !r.ok;
  const line = { case: name, expect, pass, ...r };
  console.log(JSON.stringify(line));
  state.cases.push(line);
  save();
  if (expect === "accepted" && !r.ok) throw new Error(`setup step failed: ${name}`);
  return r;
}

async function encryptedXToken(): Promise<string> {
  const env = Object.fromEntries(
    readFileSync(path.join(os.homedir(), "merit/.env"), "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"(.*)"$/, "$1")]),
  );
  const token = new TextEncoder().encode(env.MERIT_X_LAT!);
  const framed = new Uint8Array(4 + token.length);
  new DataView(framed.buffer).setUint32(0, token.length, true);
  framed.set(token, 4);
  return hex(encryptSecretBytes(framed, agent.publicKey.toBytes(), await client.getSecretSharingPubkey()));
}

/** DevNet airdrops can take far longer than the SDK's confirm loop: request, then wait for the balance to reach `min`. */
async function airdrop(kp: Keypair, amount: bigint, min: bigint) {
  const who = kp.publicKey.toString();
  if ((await rpc.balance(who)) >= min) return;
  await client.requestAirdrop(kp.publicKey, amount);
  for (let i = 0; i < 60 && (await rpc.balance(who)) < min; i++) await new Promise((r) => setTimeout(r, 3000));
  if ((await rpc.balance(who)) < min) throw new Error(`airdrop to ${who} did not land in 3 minutes`);
}

const wallet = () => Keypair.generate().publicKey.toString();
const fakeHash = () => Keypair.generate().publicKey.toString();
// Post ids no X post has: a REX check of them fails verification, so nothing here is ever paid.
const post = (n: number) => 1_000_000_000_000_000_000n + BigInt(n);

async function run() {
  console.log(JSON.stringify({ owner: O, agent: A_, stranger: S, campaignA, campaignB }));
  // Fees for the stranger, escrow for the owner (DevNet faucet).
  if ((await rpc.balance(S)) < RLO / 10n) await client.requestAirdropAndConfirm(stranger.publicKey, RLO / 5n);
  while ((await rpc.balance(O)) < RLO) await client.requestAirdropAndConfirm(owner.publicKey, RLO);

  const deadline = BigInt(Date.now() + 2 * 86_400_000);
  const config = { agent: A_, rateKelvin: RLO / 20n, minScore: 50n, capPerPayout: RLO / 20n, capPerContributor: (RLO * 8n) / 100n, capPerRound: RLO / 10n, roundLengthMs: 20n * 60_000n, refundDeadlineMs: deadline };

  // ── Campaign config ──
  await step("create_campaign rejects an agent equal to the owner", owner, ix.createCampaign(O, randomSlug(), { ...config, agent: O }), "rejected");
  await step("create_campaign rejects caps out of order (payout cap above round cap)", owner, ix.createCampaign(O, randomSlug(), { ...config, capPerPayout: RLO, capPerRound: RLO / 10n }), "rejected");
  // A score of 100 must fit one payout, so a valid campaign can't exceed its per-payout cap at approval time.
  await step("create_campaign rejects a rate above the per-payout cap", owner, ix.createCampaign(O, randomSlug(), { ...config, rateKelvin: RLO / 10n }), "rejected");
  await step("create_campaign rejects a zero rate", owner, ix.createCampaign(O, randomSlug(), { ...config, rateKelvin: 0n }), "rejected");
  await step("setup: create test campaign A", owner, ix.createCampaign(O, slugA, config), "accepted");
  await step("setup: create test campaign B", owner, ix.createCampaign(O, slugB, config), "accepted");
  await step("setup: fund A 0.15 RLO", owner, ix.fund(O, slugA, (RLO * 15n) / 100n), "accepted");
  await step("setup: fund A's operations budget 0.1 RLO", owner, ix.fundOps(O, slugA, RLO / 10n), "accepted");

  const token = await encryptedXToken();
  const lslug1 = ledgerSlug(campaignA, 1n);
  await step("open_ledger rejected before the round opens", agent, ix.openLedger(A_, lslug1, campaignA, 1n, token), "rejected");
  await step("setup: start A (round 1)", owner, ix.start(O, slugA), "accepted");

  // ── Owner-only instructions from a stranger, naming A's real account ──
  await step("stranger: withdraw from A", stranger, asSigner(ix.withdraw(O, slugA, RLO / 10n), S), "rejected");
  await step("stranger: set_agent on A to itself", stranger, asSigner(ix.setAgent(O, slugA, S), S), "rejected");
  await step("stranger: end A", stranger, asSigner(ix.end(O, slugA), S), "rejected");
  await step("stranger: withdraw_ops from A", stranger, asSigner(ix.withdrawOps(O, slugA, RLO / 20n), S), "rejected");
  await step("owner: withdraw more than the unreserved escrow", owner, ix.withdraw(O, slugA, RLO), "rejected");

  // ── Ledgers: only the campaign's agent ──
  await step("stranger: open a ledger for A (not A's agent)", stranger, ix.openLedger(S, ledgerSlug(campaignA, 1n), campaignA, 1n, token), "rejected");
  await step("agent: open a ledger with a slug that isn't ledger_seed(campaign, round)", agent, ix.openLedger(A_, randomSlug(), campaignA, 1n, token), "rejected");
  await step("setup: agent opens A's round-1 ledger", agent, ix.openLedger(A_, lslug1, campaignA, 1n, token), "accepted");

  const approve = (o: { contributor: string; x: bigint; p: bigint; score: bigint; campaign?: string }) =>
    ix.approve(A_, lslug1, { campaign: o.campaign ?? campaignA, contributor: o.contributor, xUserId: o.x, postId: o.p, score: o.score, submissionHash: fakeHash(), payee: payeeAddress(A_, campaignA, o.x) });
  const alice = wallet();
  const bob = wallet();
  const carol = wallet();

  // ── approve: the program's own rules ──
  await step("approve: score 101 (above 100)", agent, approve({ contributor: alice, x: 11n, p: post(1), score: 101n }), "rejected");
  await step("approve: score 40, below the campaign minimum 50", agent, approve({ contributor: alice, x: 11n, p: post(1), score: 40n }), "rejected");
  await step("approve: x_user_id 0", agent, approve({ contributor: alice, x: 0n, p: post(1), score: 50n }), "rejected");
  await step("stranger: approve on A's ledger (not the ledger agent)", stranger, asSigner(approve({ contributor: alice, x: 11n, p: post(1), score: 100n }), S), "rejected");
  await step("setup: approve alice's post 1 at score 100 (0.05 RLO)", agent, approve({ contributor: alice, x: 11n, p: post(1), score: 100n }), "accepted");
  // Round has room (0.05 of 0.1), so only alice's own cap can stop this one.
  await step("approve: alice again, 0.05 + 0.05 over her 0.08 RLO per-contributor cap", agent, approve({ contributor: alice, x: 11n, p: post(5), score: 100n }), "rejected");

  // Forged report: entry 1's on_verify handed entry 0's real REX report. Sent right after entry 1's approval, while
  // it is still pending. (The handler ignores entries that are no longer pending, so a late try proves nothing.)
  await step("setup: approve bob's post 2 at score 100 (round now at its 0.1 RLO cap)", agent, approve({ contributor: bob, x: 22n, p: post(2), score: 100n }), "accepted");
  let ledger = await findLedger(rpc, (await loadState(rpc, campaignA))!, 1n);
  for (let i = 0; i < 20 && !ledger?.entries?.[0]?.reportAccount; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    ledger = await findLedger(rpc, (await loadState(rpc, campaignA))!, 1n);
  }
  const report0 = ledger?.entries?.[0]?.reportAccount;
  if (report0) {
    const ledgerA = ledgerAddress(A_, campaignA, 1n);
    const onVerify: PlainInstruction = {
      programId: PROGRAM_ID,
      accounts: [
        { pubkey: A_, isSigner: true, isWritable: true },
        { pubkey: ledgerA, isSigner: false, isWritable: true },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: report0, isSigner: false, isWritable: false },
      ],
      // bincode: variant 0 (on_verify), workflow slug, branch_number (usize as u64), index
      data: (() => {
        const b = new Uint8Array(4 + 32 + 8 + 8);
        const v = new DataView(b.buffer);
        v.setUint32(0, 0, true);
        b.set(nonce(lslug1), 4);
        v.setBigUint64(36, 0n, true);
        v.setBigUint64(44, 1n, true);
        return b;
      })(),
    };
    await step("on_verify for entry 1 called directly with entry 0's real REX report", agent, onVerify, "rejected");
    const after = await findLedger(rpc, (await loadState(rpc, campaignA))!, 1n);
    console.log(JSON.stringify({ case: "entry 1 after the forged call", status: String(after?.entries?.[1]?.status), reportAccount: after?.entries?.[1]?.reportAccount }));
  } else console.log(JSON.stringify({ case: "on_verify forgery", skipped: "entry 0 had no REX report account in 30 s" }));

  // Account position: the data names A, but the campaign slot holds B (same owner, same program, same shape).
  const swapped = approve({ contributor: carol, x: 33n, p: post(3), score: 50n });
  swapped.accounts = swapped.accounts.map((m) => (m.pubkey === campaignA ? { ...m, pubkey: campaignB } : m));
  await step("approve naming campaign A in its data but passing campaign B's account", agent, swapped, "rejected");

  await step("approve: the same post again (duplicate)", agent, approve({ contributor: alice, x: 11n, p: post(1), score: 50n }), "rejected");
  await step("approve: alice's X account with a different wallet (identity mismatch)", agent, approve({ contributor: carol, x: 11n, p: post(4), score: 50n }), "rejected");
  await step("approve: carol 0.025 RLO, over the 0.1 RLO round cap (0.1 already approved)", agent, approve({ contributor: carol, x: 33n, p: post(6), score: 50n }), "rejected");

  // ── revoke ──
  await step("stranger: revoke entry 0", stranger, asSigner(ix.revoke(A_, lslug1, campaignA, 0n), S), "rejected");
  await step("agent: revoke an entry that doesn't exist (index 9)", agent, ix.revoke(A_, lslug1, campaignA, 9n), "rejected");
  await step("setup: agent revokes entry 0", agent, ix.revoke(A_, lslug1, campaignA, 0n), "accepted");
  await step("agent: revoke entry 0 again", agent, ix.revoke(A_, lslug1, campaignA, 0n), "rejected");

  // ── payee cooldown (program v2) ──
  await step("setup: owner sets a 1-hour payee cooldown on A", owner, ix.setLimits(O, slugA, { maxPerDay: RLO, approvalThreshold: RLO, cooldownMs: 3_600_000n, submitGraceMs: 0n }), "accepted");
  const dave = wallet();
  await step("approve with a cooldown but no payee registration", agent, approve({ contributor: dave, x: 44n, p: post(7), score: 50n }), "rejected");
  await step("setup: agent registers dave's wallet as payee", agent, ix.openPayee(A_, payeeSlug(campaignA, 44n), campaignA, 44n, dave), "accepted");
  await step("approve inside the payee's 1-hour cooldown", agent, approve({ contributor: dave, x: 44n, p: post(7), score: 50n }), "rejected");
  await step("stranger: open a payee for A (not A's agent)", stranger, ix.openPayee(S, payeeSlug(campaignA, 55n), campaignA, 55n, S), "rejected");

  // ── paused ──
  await step("setup: owner pauses A", owner, ix.pause(O, slugA), "accepted");
  await step("approve while the campaign is paused", agent, approve({ contributor: bob, x: 22n, p: post(8), score: 50n }), "rejected");
  await step("setup: owner unpauses A", owner, ix.unpause(O, slugA), "accepted");
}

/** The forged-report case again, timed tightly: approve a fresh entry and send on_verify with another entry's report at once. */
async function forge() {
  const lslug1 = ledgerSlug(campaignA, 1n);
  const ledger = await findLedger(rpc, (await loadState(rpc, campaignA))!, 1n);
  const donor = ledger?.entries?.find((e) => e.reportAccount)?.reportAccount;
  const index = BigInt(ledger?.entries?.length ?? 0);
  if (!donor) throw new Error("no entry with a REX report to borrow");
  await step("setup: owner sets the cooldown back to 0", owner, ix.setLimits(O, slugA, { maxPerDay: RLO, approvalThreshold: RLO, cooldownMs: 0n, submitGraceMs: 0n }), "accepted");
  const erin = wallet();
  const onVerify: PlainInstruction = {
    programId: PROGRAM_ID,
    accounts: [
      { pubkey: A_, isSigner: true, isWritable: true },
      { pubkey: ledgerAddress(A_, campaignA, 1n), isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: donor, isSigner: false, isWritable: false },
    ],
    data: (() => {
      const b = new Uint8Array(4 + 32 + 8 + 8);
      const v = new DataView(b.buffer);
      v.setUint32(0, 0, true);
      b.set(nonce(lslug1), 4);
      v.setBigUint64(36, 0n, true);
      v.setBigUint64(44, index, true);
      return b;
    })(),
  };
  // Approve and forge back to back: the forged call reaches the ledger while the new entry is still pending.
  const approval = send(agent, ix.approve(A_, lslug1, { campaign: campaignA, contributor: erin, xUserId: 66n, postId: post(9), score: 100n, submissionHash: fakeHash(), payee: payeeAddress(A_, campaignA, 66n) }));
  await new Promise((r) => setTimeout(r, 400));
  const forged = await step(`on_verify for entry ${index} called directly with another entry's real REX report (${donor})`, agent, onVerify, "rejected");
  console.log(JSON.stringify({ case: "the approval it raced", ...(await approval) }));
  const after = await findLedger(rpc, (await loadState(rpc, campaignA))!, 1n);
  console.log(JSON.stringify({ case: `entry ${index} right after`, status: String(after?.entries?.[Number(index)]?.status), reportAccount: after?.entries?.[Number(index)]?.reportAccount, forgedSignature: forged.signature }));
}

async function cleanup() {
  for (const [label, slug] of [["A", slugA], ["B", slugB]] as const) {
    const s = await loadState(rpc, workflowAddress(O, nonce(slug)));
    if (!s) continue;
    console.log(JSON.stringify({ campaign: label, phase: String(s.phase), escrow: String(s.escrowKelvin), ops: String(s.opsBudgetKelvin) }));
    if (s.phase === 1n) await step(`cleanup: end ${label}`, owner, ix.end(O, slug), "accepted");
  }
}

/** After settlement: return A's unreserved escrow and operations budget to the test owner. */
async function withdrawAll() {
  const s = (await loadState(rpc, campaignA))!;
  console.log(JSON.stringify({ phase: String(s.phase), escrow: String(s.escrowKelvin), ops: String(s.opsBudgetKelvin) }));
  if (s.escrowKelvin > 0n) await step("cleanup: withdraw A's escrow", owner, ix.withdraw(O, slugA, s.escrowKelvin), "accepted");
  if (s.opsBudgetKelvin > 0n) await step("cleanup: withdraw A's operations budget", owner, ix.withdrawOps(O, slugA, s.opsBudgetKelvin), "accepted");
}

/**
 * Audit H-1. Test campaign C runs 60 s rounds with no approvals, so its round ledgers are never opened. A stranger
 * sends a little RLO to the address round 1's ledger will have. Settlement must still read that account as an
 * empty ledger and open round 2; a vulnerable program fails every settle_peek and stays in SETTLING.
 */
async function h1() {
  state.slugC ??= hex(randomSlug());
  save();
  const slugC = unhex(state.slugC);
  const campaignC = workflowAddress(O, nonce(slugC));
  const ledger1 = ledgerAddress(A_, campaignC, 1n);
  console.log(JSON.stringify({ campaignC, ledger1 }));
  await airdrop(stranger, RLO / 5n, RLO / 20n);
  await airdrop(owner, RLO, RLO / 5n);
  const deadline = BigInt(Date.now() + 2 * 86_400_000);
  const small = RLO / 100n;
  await step("setup: create test campaign C (60 s rounds)", owner, ix.createCampaign(O, slugC, { agent: A_, rateKelvin: small, minScore: 50n, capPerPayout: small, capPerContributor: small, capPerRound: small, roundLengthMs: 60_000n, refundDeadlineMs: deadline }), "accepted");
  await step("setup: fund C 0.02 RLO", owner, ix.fund(O, slugC, small * 2n), "accepted");
  await step("setup: fund C's operations budget 0.02 RLO", owner, ix.fundOps(O, slugC, small * 2n), "accepted");
  // Rent-exempt minimum for an empty account: the cheapest transfer the runtime keeps as an account.
  await step("stranger: pre-fund C's round-1 ledger address (H-1)", stranger, transferInstruction(stranger.publicKey, PublicKey.fromString(ledger1), 1_000_000n), "accepted");
  const pre = await rpc.account(ledger1);
  console.log(JSON.stringify({ case: "round-1 ledger address after the transfer", kelvin: String(pre?.kelvin), owner: pre?.owner, dataLen: pre?.data.length }));
  await step("setup: start C (round 1)", owner, ix.start(O, slugC), "accepted");
  // Round 1: 60 s, grace min(5 min, 30 s), then settlement steps. Watch for 4 minutes.
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 15_000));
    const c = await loadState(rpc, campaignC);
    console.log(JSON.stringify({ t: i * 15 + 15, phase: String(c?.phase), round: String(c?.round) }));
    if (c && c.round >= 2n) break;
  }
  await h1Check();
}

async function h1Check() {
  const campaignC = workflowAddress(O, nonce(unhex(state.slugC!)));
  const c = await loadState(rpc, campaignC);
  const sigs = await rpc.signatures(campaignC, 5);
  const recent = await Promise.all(sigs.map(async (s) => ({ signature: s.signature, err: s.err ? JSON.stringify(s.err).slice(0, 120) : null, merit: meritLines((await rpc.logs(s.signature).catch(() => ({ logs: [] as string[] }))).logs) })));
  const line = { case: "H-1: campaign C after a stranger pre-funded its round-1 ledger", expect: "settles and opens round 2", pass: !!c && c.round >= 2n, phase: String(c?.phase), round: String(c?.round), recent };
  console.log(JSON.stringify(line));
  state.cases.push(line);
  save();
}

/** H-1 on a stuck C: the owner's resume re-arms the same failing step, and refund doesn't accept SETTLING. */
async function h1Owner() {
  const slugC = unhex(state.slugC!);
  await step("H-1: owner resume on stuck C (re-arms settle_peek)", owner, ix.resume(O, slugC), "accepted");
  await new Promise((r) => setTimeout(r, 30_000));
  await step("H-1: owner refund on stuck C (SETTLING, before the deadline)", owner, ix.refund(O, slugC), "rejected");
  await h1Check();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until `check` holds for campaign `address`, polling every 5 s, up to `ms`. */
async function until(address: string, ms: number, check: (c: NonNullable<Awaited<ReturnType<typeof loadState>>>) => boolean) {
  for (let t = 0; t < ms; t += 5000) {
    const c = await loadState(rpc, address);
    if (c && check(c)) return c;
    await sleep(5000);
  }
  throw new Error(`timed out waiting on ${address}`);
}

/**
 * Program v3 on chain. D: 60 s rounds, 30 s grace. A stranger pre-funds D's round-1 and round-2 ledger addresses;
 * round 1 (no approvals) must settle anyway, and the agent must still open round 2's ledger. Then close_round after
 * that ledger opened, and an approval syncs the ledger's end to the early close (M-2). While round 2 settles,
 * set_limits may not change the daily cap or threshold (M-3), and skip_stuck/refund are refused (M-1, not stuck).
 * Finally the v2-stuck C: once STUCK_MS has passed, skip_stuck lets it finish the round.
 */
async function v3() {
  state.slugD ??= hex(randomSlug());
  save();
  const slugD = unhex(state.slugD);
  const D = workflowAddress(O, nonce(slugD));
  const L1 = ledgerAddress(A_, D, 1n);
  const L2 = ledgerAddress(A_, D, 2n);
  console.log(JSON.stringify({ campaignD: D, ledger1: L1, ledger2: L2 }));
  await airdrop(stranger, RLO / 5n, RLO / 20n);
  await airdrop(owner, RLO, RLO / 5n);
  const small = RLO / 100n;
  await step("setup: create test campaign D (60 s rounds)", owner, ix.createCampaign(O, slugD, { agent: A_, rateKelvin: small, minScore: 50n, capPerPayout: small, capPerContributor: small, capPerRound: small, roundLengthMs: 60_000n, refundDeadlineMs: BigInt(Date.now() + 2 * 86_400_000) }), "accepted");
  await step("setup: fund D 0.02 RLO", owner, ix.fund(O, slugD, small * 2n), "accepted");
  await step("setup: fund D's operations budget 0.05 RLO", owner, ix.fundOps(O, slugD, small * 5n), "accepted");
  await step("stranger: pre-fund D's round-1 ledger address", stranger, transferInstruction(stranger.publicKey, PublicKey.fromString(L1), 1_000_000n), "accepted");
  await step("stranger: pre-fund D's round-2 ledger address", stranger, transferInstruction(stranger.publicKey, PublicKey.fromString(L2), 1_000_000n), "accepted");
  await step("setup: start D (round 1)", owner, ix.start(O, slugD), "accepted");
  await step("M-1 v3: skip_stuck while the round is open", owner, ix.skipStuck(O, slugD, L1), "rejected");

  // H-1: round 1 had no approvals and a pre-funded ledger address; it must settle and open round 2.
  const r2 = await until(D, 240_000, (c) => c.round >= 2n && c.phase === 1n).catch(() => null);
  const h1 = { case: "H-1 v3: a round whose ledger address a stranger pre-funded settles and opens the next round", expect: "round 2 open", pass: !!r2, round: String(r2?.round) };
  console.log(JSON.stringify(h1));
  state.cases.push(h1);
  save();
  if (!r2) return;

  // H-1: the agent opens round 2's ledger at its pre-funded address.
  const token = await encryptedXToken();
  await step("H-1 v3: agent opens a ledger at a pre-funded address", agent, ix.openLedger(A_, ledgerSlug(D, 2n), D, 2n, token), "accepted");
  const opened = await rpc.account(L2);
  console.log(JSON.stringify({ case: "round-2 ledger account", owner: opened?.owner, dataLen: opened?.data.length, kelvin: String(opened?.kelvin) }));

  // M-2: close the round after its ledger opened, then approve; the ledger's end follows the campaign's.
  await step("setup: owner closes D's round 2 early", owner, ix.closeRound(O, slugD), "accepted");
  const closed = (await loadState(rpc, D))!;
  const approval = await step("M-2 v3: approve after close_round (inside the grace) syncs the ledger's end", agent, ix.approve(A_, ledgerSlug(D, 2n), { campaign: D, contributor: wallet(), xUserId: 77n, postId: post(77), score: 100n, submissionHash: fakeHash(), payee: payeeAddress(A_, D, 77n) }), "accepted");
  const ledger2 = await findLedger(rpc, closed, 2n);
  const m2 = { case: "M-2 v3: ledger round_end_ms equals the campaign's after an early close", expect: String(closed.roundEndMs), pass: ledger2?.roundEndMs === closed.roundEndMs, ledgerEnd: String(ledger2?.roundEndMs), merit: approval.merit };
  console.log(JSON.stringify(m2));
  state.cases.push(m2);
  save();

  // M-3 and M-1 while D settles round 2 (closed, inside its grace or settling).
  const settling = await until(D, 90_000, (c) => c.phase === 2n).catch(() => null);
  if (settling) {
    await step("M-3 v3: set_limits lowering the daily cap while a round settles", owner, ix.setLimits(O, slugD, { maxPerDay: small, approvalThreshold: 0n, cooldownMs: 0n, submitGraceMs: 300_000n }), "rejected");
    await step("M-3 v3: set_limits adding an approval threshold while a round settles", owner, ix.setLimits(O, slugD, { maxPerDay: 0n, approvalThreshold: 1n, cooldownMs: 0n, submitGraceMs: 300_000n }), "rejected");
    await step("M-3 v3: set_limits changing only the cooldown while a round settles", owner, ix.setLimits(O, slugD, { maxPerDay: 0n, approvalThreshold: 0n, cooldownMs: 60_000n, submitGraceMs: 300_000n }), "accepted");
    await step("M-1 v3: skip_stuck while settlement is making progress", owner, ix.skipStuck(O, slugD, L2), "rejected");
    await step("M-1 v3: refund from SETTLING that isn't stuck", owner, ix.refund(O, slugD), "rejected");
    await step("stranger: skip_stuck on D", stranger, asSigner(ix.skipStuck(O, slugD, L2), S), "rejected");
  } else console.log(JSON.stringify({ case: "M-3/M-1 on D", skipped: "D never read as settling" }));
}

/** M-1 on v3: the campaign C stuck under v2 (H-1). Once STUCK_MS has passed with no step, skip_stuck recovers it. */
async function v3Stuck() {
  const slugC = unhex(state.slugC!);
  const C = workflowAddress(O, nonce(slugC));
  const before = (await loadState(rpc, C))!;
  console.log(JSON.stringify({ phase: String(before.phase), round: String(before.round), lastBeatMs: String(before.lastBeatMs) }));
  await step("M-1 v3: owner skip_stuck on the stuck campaign C", owner, ix.skipStuck(O, slugC, ledgerAddress(A_, C, before.round)), "accepted");
  const after = await until(C, 120_000, (c) => c.round > before.round || c.phase !== 2n).catch(() => null);
  const line = { case: "M-1 v3: a stuck campaign leaves SETTLING after skip_stuck", expect: "next round or ended", pass: !!after, phase: String(after?.phase), round: String(after?.round) };
  console.log(JSON.stringify(line));
  state.cases.push(line);
  save();
}

/**
 * Program v4 (re-audit N-1). E: 60 s rounds, an approval in round 1 so settlement has work. While E settles,
 * skip_stuck without a resume is refused; after a resume it is refused for 10 minutes; refund too. The resume itself
 * must leave settlement healthy (E reaches round 2), and settle_peek's progress keeps it from ever reading as stuck.
 */
async function v4() {
  state.slugE ??= hex(randomSlug());
  save();
  const slugE = unhex(state.slugE);
  const E = workflowAddress(O, nonce(slugE));
  console.log(JSON.stringify({ campaignE: E }));
  await airdrop(owner, RLO, RLO / 5n);
  const small = RLO / 100n;
  await step("setup: create test campaign E (60 s rounds)", owner, ix.createCampaign(O, slugE, { agent: A_, rateKelvin: small, minScore: 50n, capPerPayout: small, capPerContributor: small, capPerRound: small, roundLengthMs: 60_000n, refundDeadlineMs: BigInt(Date.now() + 2 * 86_400_000) }), "accepted");
  await step("setup: fund E 0.02 RLO", owner, ix.fund(O, slugE, small * 2n), "accepted");
  await step("setup: fund E's operations budget 0.05 RLO", owner, ix.fundOps(O, slugE, small * 5n), "accepted");
  await step("setup: start E (round 1)", owner, ix.start(O, slugE), "accepted");
  const token = await encryptedXToken();
  await step("setup: agent opens E's round-1 ledger", agent, ix.openLedger(A_, ledgerSlug(E, 1n), E, 1n, token), "accepted");
  await step("setup: approve a post on E (its REX check fails; settlement has an entry to wait on)", agent, ix.approve(A_, ledgerSlug(E, 1n), { campaign: E, contributor: wallet(), xUserId: 88n, postId: post(88), score: 100n, submissionHash: fakeHash(), payee: payeeAddress(A_, E, 88n) }), "accepted");
  const L1 = ledgerAddress(A_, E, 1n);
  const settling = await until(E, 120_000, (c) => c.phase === 2n).catch(() => null);
  if (!settling) return console.log(JSON.stringify({ case: "N-1 on E", skipped: "E never read as settling" }));
  await step("N-1 v4: skip_stuck while settling, with no resume", owner, ix.skipStuck(O, slugE, L1), "rejected");
  await step("N-1 v4: owner resume while settling", owner, ix.resume(O, slugE), "accepted");
  await step("N-1 v4: skip_stuck right after a resume (no 10 quiet minutes)", owner, ix.skipStuck(O, slugE, L1), "rejected");
  await step("N-1 v4: refund right after a resume (not stuck)", owner, ix.refund(O, slugE), "rejected");
  const r2 = await until(E, 300_000, (c) => c.round >= 2n).catch(() => null);
  const line = { case: "N-1 v4: after the resume, E settles round 1 (REX verdict in, entry skipped as unverified) and opens round 2", expect: "round 2", pass: !!r2, round: String(r2?.round), phase: String(r2?.phase) };
  console.log(JSON.stringify(line));
  state.cases.push(line);
  save();
}

async function v4Cleanup() {
  const slugE = unhex(state.slugE!);
  const E = workflowAddress(O, nonce(slugE));
  let e = (await loadState(rpc, E))!;
  if (e.phase !== 4n && e.phase !== 5n && !e.ending) await step("cleanup: end E", owner, ix.end(O, slugE), "accepted");
  e = await until(E, 300_000, (c) => c.phase === 4n || c.phase === 0n || c.phase === 5n);
  if (e.escrowKelvin > 0n) await step("cleanup: withdraw E's escrow", owner, ix.withdraw(O, slugE, e.escrowKelvin), "accepted");
  if (e.opsBudgetKelvin > 0n) await step("cleanup: withdraw E's operations budget", owner, ix.withdrawOps(O, slugE, e.opsBudgetKelvin), "accepted");
}

/** Ends D and returns its funds once it can. */
async function v3Cleanup() {
  const slugD = unhex(state.slugD!);
  const D = workflowAddress(O, nonce(slugD));
  let d = (await loadState(rpc, D))!;
  if (d.phase !== 4n && d.phase !== 5n && !d.ending) await step("cleanup: end D", owner, ix.end(O, slugD), "accepted");
  d = await until(D, 300_000, (c) => c.phase === 4n || c.phase === 0n || c.phase === 5n);
  if (d.escrowKelvin > 0n) await step("cleanup: withdraw D's escrow", owner, ix.withdraw(O, slugD, d.escrowKelvin), "accepted");
  if (d.opsBudgetKelvin > 0n) await step("cleanup: withdraw D's operations budget", owner, ix.withdrawOps(O, slugD, d.opsBudgetKelvin), "accepted");
}

/** Ends C and returns its escrow and budget (once it can). */
async function h1Cleanup() {
  const slugC = unhex(state.slugC!);
  const c = (await loadState(rpc, workflowAddress(O, nonce(slugC))))!;
  console.log(JSON.stringify({ phase: String(c.phase), escrow: String(c.escrowKelvin), ops: String(c.opsBudgetKelvin) }));
  if (c.phase !== 4n && c.phase !== 5n) await step("cleanup: end C", owner, ix.end(O, slugC), "accepted");
  const after = (await loadState(rpc, workflowAddress(O, nonce(slugC))))!;
  if (after.phase === 4n || after.phase === 0n) {
    if (after.escrowKelvin > 0n) await step("cleanup: withdraw C's escrow", owner, ix.withdraw(O, slugC, after.escrowKelvin), "accepted");
    if (after.opsBudgetKelvin > 0n) await step("cleanup: withdraw C's operations budget", owner, ix.withdrawOps(O, slugC, after.opsBudgetKelvin), "accepted");
  }
}

if (mode === "run") await run();
else if (mode === "h1") await h1();
else if (mode === "h1-check") await h1Check();
else if (mode === "h1-owner") await h1Owner();
else if (mode === "v3") await v3();
else if (mode === "v3-stuck") await v3Stuck();
else if (mode === "v3-cleanup") await v3Cleanup();
else if (mode === "v4") await v4();
else if (mode === "v4-cleanup") await v4Cleanup();
else if (mode === "h1-cleanup") await h1Cleanup();
else if (mode === "cleanup") await cleanup();
else if (mode === "forge") await forge();
else if (mode === "withdraw") await withdrawAll();
else throw new Error("usage: negative-devnet.ts <state.json> run|forge|cleanup");
