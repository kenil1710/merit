// A judge decision and the hash the agent writes on chain (`submission_hash`).
// The record is serialized exactly like Python's `json.dumps(record,
// sort_keys=True)` (the format of scripts/judge-post.py, used for round 1),
// so any copy of the reasons can be checked against the chain.

import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";

export type JudgeRecord = {
  /// The campaign the decision is for (absent on round 1's record): binds the hash to one campaign.
  campaign?: string;
  post_id: string;
  author_id: string;
  created_at: string;
  checks: Record<string, boolean>;
  score: number;
  reasons: string[];
  usage: Record<string, unknown>;
};

export type StoredJudgement = {
  campaign: string;
  round: number;
  /// approved | below_minimum | failed_checks | approve_failed
  outcome?: string;
  contributor?: string;
  xUsername?: string;
  approveSignature?: string;
  openLedgerSignature?: string;
  error?: string;
  /// The exact canonical JSON that was hashed.
  canonical: string;
  submissionHash: string;
  text: string;
  judgedAt: string;
};

function quote(text: string): string {
  let out = '"';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (code < 0x20 || (code >= 0x7f && code <= 0xffff)) out += "\\u" + code.toString(16).padStart(4, "0");
    else if (code > 0xffff) {
      const v = code - 0x10000;
      out += "\\u" + (0xd800 + (v >> 10)).toString(16) + "\\u" + (0xdc00 + (v & 0x3ff)).toString(16);
    } else out += ch;
  }
  return out + '"';
}

/// Python `json.dumps(value, sort_keys=True)` with default separators and
/// `ensure_ascii=True`. Integers only; floats are rejected.
export function pythonJson(value: unknown): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("only integers can be hashed");
    return String(value);
  }
  if (typeof value === "string") return quote(value);
  if (Array.isArray(value)) return "[" + value.map(pythonJson).join(", ") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    return "{" + keys.map((k) => quote(k) + ": " + pythonJson((value as Record<string, unknown>)[k])).join(", ") + "}";
  }
  throw new Error(`cannot hash ${typeof value}`);
}

export function hashCanonical(canonical: string): string {
  return base58.encode(sha256(new TextEncoder().encode(canonical)));
}

export function sealRecord(record: JudgeRecord): { canonical: string; submissionHash: string } {
  const canonical = pythonJson(record);
  return { canonical, submissionHash: hashCanonical(canonical) };
}

/// Checks a stored judgement against the hash the ledger holds on chain.
export function verifyJudgement(stored: StoredJudgement, onChainHash: string): { record: JudgeRecord; matches: boolean } {
  const record = JSON.parse(stored.canonical) as JudgeRecord;
  const matches = hashCanonical(stored.canonical) === onChainHash && stored.submissionHash === onChainHash;
  return { record, matches };
}
