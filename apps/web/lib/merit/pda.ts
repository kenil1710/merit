// Address derivations, mirroring rialo-venus / rialo-types 0.18.1 exactly
// (checked against the Rust builders in test/vectors.json).

import { PublicKey } from "@rialo/ts-cdk";
import { blake3 } from "@noble/hashes/blake3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { PROGRAM_ID, SUBSCRIBER_PROGRAM_ID } from "./constants";

const NONCE_LEN = 32;

/// `rialo_types::Nonce::from(&[u8])`: zero-padded up to 32 bytes, Blake3 above.
export function nonce(bytes: Uint8Array): Uint8Array {
  if (bytes.length > NONCE_LEN) return blake3(bytes);
  const out = new Uint8Array(NONCE_LEN);
  out.set(bytes);
  return out;
}

export function workflowAddress(payer: string, slug: Uint8Array, programId = PROGRAM_ID): string {
  const [address] = PublicKey.findProgramAddress(
    ["rialo_workflow", base58.decode(payer), nonce(slug)],
    PublicKey.fromString(programId),
  );
  return address.toString();
}

/// Venus `multi_account_slug`: sha256(workflow ‖ branch u64 ‖ index u64).
export function multiAccountSlug(workflow: string, branch: number, index: number): Uint8Array {
  const data = new Uint8Array(48);
  data.set(base58.decode(workflow), 0);
  const view = new DataView(data.buffer);
  view.setBigUint64(32, BigInt(branch), true);
  view.setBigUint64(40, BigInt(index), true);
  return sha256(data);
}

export function subscriptionAddress(payer: string, slug: Uint8Array): string {
  const [address] = PublicKey.findProgramAddress(
    ["rialo_subscribe", base58.decode(payer), nonce(slug)],
    PublicKey.fromString(SUBSCRIBER_PROGRAM_ID),
  );
  return address.toString();
}

/// `merit_core::ledger_seed`: "merit-ledger" ‖ campaign ‖ round (u64 LE).
export function ledgerSeed(campaign: string, round: bigint): Uint8Array {
  const seed = new Uint8Array(52);
  seed.set(new TextEncoder().encode("merit-ledger"), 0);
  seed.set(base58.decode(campaign), 12);
  new DataView(seed.buffer).setBigUint64(44, round, true);
  return seed;
}

export function ledgerSlug(campaign: string, round: bigint): Uint8Array {
  return nonce(ledgerSeed(campaign, round));
}

export function ledgerAddress(agent: string, campaign: string, round: bigint): string {
  return workflowAddress(agent, ledgerSlug(campaign, round));
}

/// `merit_core::payee_seed` (program v2): "merit-payee" ‖ campaign ‖ X user id (u64 LE).
export function payeeSlug(campaign: string, xUserId: bigint): Uint8Array {
  const seed = new Uint8Array(51);
  seed.set(new TextEncoder().encode("merit-payee"), 0);
  seed.set(base58.decode(campaign), 11);
  new DataView(seed.buffer).setBigUint64(43, xUserId, true);
  return nonce(seed);
}

export function payeeAddress(agent: string, campaign: string, xUserId: bigint): string {
  return workflowAddress(agent, payeeSlug(campaign, xUserId));
}

export function randomSlug(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}
