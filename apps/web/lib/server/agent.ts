import "server-only";

// The agent authority: opens each round's ledger and records approvals on
// chain. Until the merit-payout-signer latch exists this is a DevNet key held
// by the server (MERIT_AGENT_SECRET_KEY); the program's caps bound what it can
// do. Swapping in the Privy wallet only changes `signAndSend`.

import {
  Keypair,
  PublicKey,
  TransactionBuilder,
  createRialoClient,
  encryptSecretBytes,
  type RialoClient,
} from "@rialo/ts-cdk";
import { base58 } from "@scure/base";
import { RpcClient, loadState } from "@/lib/merit/chain";
import { hex } from "@/lib/merit/codec";
import { RPC_UPSTREAM } from "@/lib/merit/constants";
import { ix, toCdkInstruction, type PlainInstruction } from "@/lib/merit/instructions";
import { ledgerAddress, ledgerSlug, payeeAddress, payeeSlug } from "@/lib/merit/pda";
import type { MeritState } from "@/lib/merit/state";
import { env } from "./env";
import { latchToken } from "./latch";

let cached: Keypair | null = null;

export function agentKeypair(): Keypair {
  if (cached) return cached;
  const raw = env.agentSecret();
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw) as number[]) : base58.decode(raw);
  if (bytes.length !== 32 && bytes.length !== 64) throw new Error("MERIT_AGENT_SECRET_KEY must be 32 or 64 bytes");
  const keypair = Keypair.fromSecretKey(bytes.subarray(0, 32));
  if (bytes.length === 64 && keypair.publicKey.toString() !== base58.encode(bytes.subarray(32))) {
    throw new Error("MERIT_AGENT_SECRET_KEY: public half does not match the secret");
  }
  cached = keypair;
  return keypair;
}

export function agentAddress(): string {
  return agentKeypair().publicKey.toString();
}

function client(): RialoClient {
  return createRialoClient({ chain: { id: "rialo:devnet", name: "Rialo DevNet", rpcUrl: RPC_UPSTREAM } });
}

export const rpc = new RpcClient(RPC_UPSTREAM);

// Control instructions arm their timer from Venus branch 0, so two agent
// transactions on one ledger in the same block collide. Send one at a time.
let queue: Promise<unknown> = Promise.resolve();

export async function signAndSend(instruction: PlainInstruction): Promise<string> {
  const run = async () => {
    const keypair = agentKeypair();
    const c = client();
    const tx = TransactionBuilder.create()
      .setPayer(keypair.publicKey)
      .setValidFrom(BigInt(Date.now()))
      .setConfigHashPrefix(await c.getConfigHashPrefix())
      .addInstruction(toCdkInstruction(instruction))
      .build()
      .sign(keypair);
    const confirmed = await c.sendAndConfirmTransaction(tx.serialize());
    const signature = confirmed.signature;
    const { err, logs } = await rpc.logs(signature);
    if (err) {
      const reason = logs.map((l) => /Program log: (Merit .*)$/.exec(l)?.[1]).filter(Boolean).pop();
      throw new Error(`transaction ${signature} failed${reason ? `: ${reason}` : ""}`);
    }
    return signature;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

/// The campaign's merit-x token (its own child latch when configured, else
/// merit-x), Borsh-framed (u32 LE length + bytes) because the REX component's
/// `token: String` parameter is Borsh-decoded after the TEE decrypts it, then
/// encrypted for the agent (the REX creator). A ledger keeps the token it was
/// opened with, so a new child latch takes over from the next round.
async function encryptedXToken(campaign: string): Promise<string> {
  const token = new TextEncoder().encode(latchToken("merit-x", campaign).token);
  const framed = new Uint8Array(4 + token.length);
  new DataView(framed.buffer).setUint32(0, token.length, true);
  framed.set(token, 4);
  const sspk = await client().getSecretSharingPubkey();
  return hex(encryptSecretBytes(framed, agentKeypair().publicKey.toBytes(), sspk));
}

export async function ensureLedger(campaign: MeritState): Promise<{ ledger: string; opened?: string }> {
  const agent = agentAddress();
  const ledger = ledgerAddress(agent, campaign.address, campaign.round);
  if (await loadState(rpc, ledger)) return { ledger };
  const opened = await signAndSend(ix.openLedger(agent, ledgerSlug(campaign.address, campaign.round), campaign.address, campaign.round, await encryptedXToken(campaign.address)));
  return { ledger, opened };
}

/**
 * Program v2's payee registration: the wallet an X account is paid at, on chain, and since when. The campaign's
 * cooldown runs from there, so it's registered as early as possible (when a contributor joins or links a wallet) and
 * re-checked before each approval. A changed wallet restarts the cooldown. Returns the payee account.
 */
export async function ensurePayee(campaign: MeritState, xUserId: bigint, wallet: string): Promise<{ payee: string; signature?: string; since?: bigint }> {
  const agent = agentAddress();
  const payee = payeeAddress(agent, campaign.address, xUserId);
  const current = await loadState(rpc, payee);
  if (!current) return { payee, signature: await signAndSend(ix.openPayee(agent, payeeSlug(campaign.address, xUserId), campaign.address, xUserId, wallet)) };
  if (current.payeeWallet !== wallet) return { payee, signature: await signAndSend(ix.setPayee(agent, payeeSlug(campaign.address, xUserId), wallet)) };
  return { payee, since: current.payeeSinceMs };
}

export async function approveOnChain(campaign: MeritState, a: { contributor: string; xUserId: bigint; postId: bigint; score: bigint; submissionHash: string }) {
  const agent = agentAddress();
  const payee = campaign.cooldownMs > 0n ? (await ensurePayee(campaign, a.xUserId, a.contributor)).payee : payeeAddress(agent, campaign.address, a.xUserId);
  return signAndSend(ix.approve(agent, ledgerSlug(campaign.address, campaign.round), { campaign: campaign.address, ...a, payee }));
}

/** Program v2: takes an approval back before it's paid (an owner override). */
export async function revokeOnChain(campaign: MeritState, index: bigint) {
  return signAndSend(ix.revoke(agentAddress(), ledgerSlug(campaign.address, campaign.round), campaign.address, index));
}

export function isAddress(text: string): boolean {
  try {
    return PublicKey.fromString(text).toBytes().length === 32;
  } catch {
    return false;
  }
}
