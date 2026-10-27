// Live DevNet check of the server's agent path, written in TypeScript end to
// end: an owner key creates and opens a campaign, then the agent module opens
// the round ledger with the merit-x token encrypted by @rialo/ts-cdk, and
// approves a known old post (jack's post 20, author 12). Validators must
// decrypt that token in the TEE, read the post through Latch and agree; the
// program then rules "OutsideRound" (the post is from 2006), which proves the
// whole path without paying anything. Cleans up by ending and withdrawing.
// Run with MERIT_LIVE=1 (costs at most 4 X reads, about $0.02).

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair, TransactionBuilder, createRialoClient } from "@rialo/ts-cdk";
import { describe, expect, it } from "vitest";
import { RpcClient, loadState } from "@/lib/merit/chain";
import { RPC_UPSTREAM } from "@/lib/merit/constants";
import { ix, toCdkInstruction, type PlainInstruction } from "@/lib/merit/instructions";
import { ledgerAddress, randomSlug, workflowAddress } from "@/lib/merit/pda";
import { agentAddress, approveOnChain, ensureLedger } from "@/lib/server/agent";

const live = process.env.MERIT_LIVE === "1" ? describe : describe.skip;
const rpc = new RpcClient(RPC_UPSTREAM);
const client = () => createRialoClient({ chain: { id: "rialo:devnet", name: "devnet", rpcUrl: RPC_UPSTREAM } });

function ownerKey(): Keypair {
  const file = path.join(os.homedir(), "Library/Application Support/rialo/merit-owner-devnet.keypair");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8")) as number[]).subarray(0, 32));
}

async function send(owner: Keypair, instruction: PlainInstruction): Promise<string> {
  const c = client();
  const tx = TransactionBuilder.create().setPayer(owner.publicKey).setValidFrom(BigInt(Date.now()))
    .setConfigHashPrefix(await c.getConfigHashPrefix()).addInstruction(toCdkInstruction(instruction)).build().sign(owner);
  const { signature } = await c.sendAndConfirmTransaction(tx.serialize());
  const { err } = await rpc.logs(signature);
  if (err) throw new Error(`${signature} failed`);
  return signature;
}

live("agent path on DevNet", () => {
  it("opens a ledger with a TS-encrypted token, approves, and gets a unanimous REX verdict", async () => {
    const owner = ownerKey();
    const me = owner.publicKey.toString();
    const slug = randomSlug();
    const address = workflowAddress(me, slug);
    const log: Record<string, string> = { campaign: address };
    log.create = await send(owner, ix.createCampaign(me, slug, {
      agent: agentAddress(), rateKelvin: 10_000_000n, minScore: 50n, capPerPayout: 10_000_000n, capPerContributor: 20_000_000n,
      capPerRound: 50_000_000n, roundLengthMs: 120_000n, refundDeadlineMs: BigInt(Date.now() + 3_600_000),
    }));
    log.fund = await send(owner, ix.fund(me, slug, 20_000_000n));
    log.fundOps = await send(owner, ix.fundOps(me, slug, 100_000_000n));
    log.start = await send(owner, ix.start(me, slug));

    const campaign = (await loadState(rpc, address))!;
    const { ledger, opened } = await ensureLedger(campaign);
    log.openLedger = opened!;
    expect(ledger).toBe(ledgerAddress(agentAddress(), address, 1n));
    log.approve = await approveOnChain(campaign, { contributor: me, xUserId: 12n, postId: 20n, score: 80n, submissionHash: me });

    let status = 1n;
    for (let i = 0; i < 20 && status === 1n; i++) {
      await new Promise((r) => setTimeout(r, 1_500));
      status = (await loadState(rpc, ledger))!.entries[0].status;
    }
    // 3 = FAILED: a unanimous report the program judged (OutsideRound). 4 would mean the token never worked.
    expect(status).toBe(3n);

    log.end = await send(owner, ix.end(me, slug));
    let phase = 1n;
    for (let i = 0; i < 30 && phase !== 4n; i++) {
      await new Promise((r) => setTimeout(r, 3_000));
      phase = (await loadState(rpc, address))!.phase;
    }
    expect(phase).toBe(4n);
    const final = (await loadState(rpc, address))!;
    if (final.escrowKelvin > 0n) log.withdraw = await send(owner, ix.withdraw(me, slug, final.escrowKelvin));
    if (final.opsBudgetKelvin > 0n) log.withdrawOps = await send(owner, ix.withdrawOps(me, slug, final.opsBudgetKelvin));
    console.log(JSON.stringify({ ...log, ledger, reimbursed: final.totalOpsReimbursed.toString() }, null, 1));
  }, 240_000);
});
