// Negative tests of Merit's own program on Rialo DevNet: invalid instructions must be rejected, on chain.
//
// Everything runs against fresh test campaigns created here (owner: the merit-contributor-demo keystore key; agent:
// merit-agent-devnet; a throwaway "stranger" key), never against a live campaign. Each instruction is sent without
// preflight, so a rejection lands on chain with its signature and Merit's own log line as the proof.
//
// Usage: npx tsx scripts/negative-devnet.ts <state.json> run|cleanup
//   run      create test campaigns A and B, run every case, print one JSON line per case
//   cleanup  close the round, end both campaigns and withdraw what's left to the owner (after settlement)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair, TransactionBuilder, createRialoClient, encryptSecretBytes } from "@rialo/ts-cdk";
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
type State = { stranger: string; slugA: string; slugB: string; cases: unknown[] };
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
async function send(signer: Keypair, instruction: PlainInstruction): Promise<{ signature: string | null; ok: boolean; err: string | null; merit: string[] }> {
  const tx = TransactionBuilder.create()
    .setPayer(signer.publicKey)
    .setValidFrom(BigInt(Date.now()))
    .setConfigHashPrefix(await client.getConfigHashPrefix())
    .addInstruction(toCdkInstruction(instruction))
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

async function step(name: string, signer: Keypair, instruction: PlainInstruction, expect: "accepted" | "rejected") {
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

if (mode === "run") await run();
else if (mode === "cleanup") await cleanup();
else if (mode === "forge") await forge();
else if (mode === "withdraw") await withdrawAll();
else throw new Error("usage: negative-devnet.ts <state.json> run|forge|cleanup");
