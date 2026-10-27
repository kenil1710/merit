import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { hashCanonical, pythonJson } from "@/lib/merit/judgement";
import type { Flag } from "./types";

/**
 * Decision records: every decision (agent or human, approve or not) is canonical JSON hashed with sha256 and signed
 * with ed25519 by the agent key. For an approval the hash is the ledger entry's submission_hash, so the record can be
 * checked against Rialo. A human decision or a re-process names the decision it supersedes; nothing is rewritten.
 */

export const RECORD_SCHEMA = "merit.decision/v1";

export interface DecisionRecord {
  schema: typeof RECORD_SCHEMA;
  network: "rialo:devnet";
  campaign: string;
  program: { id: string; slug: string };
  submission: { id: string; url: string; postId: string; submittedAt: string };
  contributor: { id: string; xUserId: string; xHandle: string; wallet: string | null };
  round: { number: number; startsAt: string; endsAt: string } | null;
  /** sha256 of the exact text that was judged (null if it couldn't be read). */
  contentHash: string | null;
  context: { version: number; hash: string } | null;
  flags: Flag[];
  judgment: { model: string; promptVersion: string; output: unknown } | null;
  ruleVersion: string;
  rule: string;
  decision: { action: string; categoryKey: string | null; points: string | null; score: number; amount: string; auto: boolean };
  decidedBy: { type: "agent"; supersedes?: string; reason?: string } | { type: "human"; userId: string; reason: string; supersedes: string };
  summary: string;
  decidedAt: string;
  signer: string;
}

/**
 * The record as Python's json.dumps(sort_keys=True) would write it (the format round 1's record hashes with). Exact
 * types only: integers stay numbers, fractions (confidence) and bigints become strings, missing fields are dropped.
 */
export function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, canonicalValue(v)]),
    );
  }
  throw new Error(`cannot put ${typeof value} in a decision record`);
}

export type SignedRecord = { record: DecisionRecord; decisionJson: string; decisionHash: string; signature: string };

/** Canonicalize → sha256 (base58: the on-chain submission_hash) → ed25519 signature over the 32 hash bytes. */
export function signRecord(record: Omit<DecisionRecord, "signer">, signer: { address: string; sign: (msg: Uint8Array) => Uint8Array }): SignedRecord {
  const full = { ...record, signer: signer.address } as DecisionRecord;
  const decisionJson = pythonJson(canonicalValue(full));
  const decisionHash = hashCanonical(decisionJson);
  return { record: full, decisionJson, decisionHash, signature: base58.encode(signer.sign(base58.decode(decisionHash))) };
}

/** Anyone can check a record: the hash of its JSON, and the signer's signature over that hash. */
export function verifyRecord(decisionJson: string, decisionHash: string, signature: string, signer: string): boolean {
  if (hashCanonical(decisionJson) !== decisionHash) return false;
  try {
    return ed25519.verify(base58.decode(signature), base58.decode(decisionHash), base58.decode(signer), { zip215: false });
  } catch {
    return false;
  }
}
