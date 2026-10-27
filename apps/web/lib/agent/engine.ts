import type { RubricCategory } from "@/lib/shared/program";
import type { JudgmentOutput } from "./judge";
import type { Flag, Resource } from "./types";

/**
 * The decision engine: Misthos' rules-v9, unchanged in order and meaning, plus what the Merit program on Rialo needs.
 * The program prices a 0–100 score against its rate (the largest category's perfect payout), refuses scores below
 * its minimum, and enforces per-payout, per-contributor and per-round caps; the engine decides the score it would
 * approve and never asks the program for something it would refuse.
 */

/** Bump whenever a rule below changes. Recorded in every decision. */
export const RULE_VERSION = "rules-v9-merit1";

export const contradictionLine = (claim: string, briefSays: string) => `Says "${claim.trim()}"; the brief says "${briefSays.trim()}".`;

/** Clear spam: the model is very sure the work doesn't qualify and every criterion scored 0 or 1. */
export const SPAM_CONFIDENCE = 0.9;
export const SPAM_MAX_SCORE = 1;

/** The judge's own notes that mean "someone tried to steer me": always a person's call. */
export const JUDGE_INJECTION_NOTE = new RegExp(
  [
    "influenc\\w* (the |your |its )?(grad|scor|review|judg|model|rubric|decision|rating|evaluat)",
    "manipulat\\w* (the |your |its )?(grad|scor|review|judg|model|rubric|decision|rating|evaluat)",
    "instruct",
    "grader",
    "inject",
    "jailbreak",
    "prompt",
    "full marks",
    "(max|maximum|perfect|top|high) (score|marks|points)",
    "pre-?approv",
    "already approved",
    "approved by the (program )?owner",
    "\\bgam(e|es|ing)\\b.*(rubric|scor|review|grad)",
    "(rubric|scor).*\\bgam(e|es|ing)\\b",
    "addressed to the (ai|reviewer|judge|model|grader)",
    "\\b(ai|llm|model)\\b.*\\b(review|judge|grad|scor)",
    "ignore (the |all |previous |your )",
    "override",
    "bribe",
    "coerc",
  ].join("|"),
  "i",
);

/** Flags that end in rejection: the work can't be paid, whatever its quality. */
export const REJECT_FLAGS = new Set(["DELETED", "OWNERSHIP_MISMATCH", "DUPLICATE_URL", "OUT_OF_WINDOW", "NEAR_DUPLICATE", "TOO_SHORT", "LOW_FOLLOWERS", "NEW_ACCOUNT"]);

export interface EngineInput {
  flags: Flag[];
  judgment: JudgmentOutput | null;
  judgeError?: string;
  categories: RubricCategory[];
  resource: Resource | null;
  ratePerPoint: bigint;
  autoApproveConfidence: number;
  /** The program's on-chain rate: kelvin for a score of 100. */
  rateKelvin: bigint;
  /** The program refuses approvals below this score. */
  minScore: number;
  maxPerPayout: bigint;
  maxAutoApproveItem: bigint;
  /** Escrow minus approved, unpaid work; "unknown" when the chain couldn't be read; omitted: nothing to check. */
  availableBudget?: bigint | "unknown";
  /** Room left under the per-contributor and per-round caps this round (the smaller of the two); omitted: unchecked. */
  capRoom?: bigint;
  /** The operations budget can't repay one more REX verification (the program refuses approvals then). */
  opsShort?: boolean;
}

export type EngineAction = "approve" | "partial" | "reject" | "escalate";

export interface EngineDecision {
  action: EngineAction;
  /** What the program will pay for `score` (approve/partial); the recommendation for escalate; 0 for reject. */
  amount: bigint;
  /** The 0–100 score sent on chain for this amount. */
  score: number;
  points: string | null;
  categoryKey: string | null;
  auto: boolean;
  rule: string;
  addedFlags: Flag[];
  cappedBy: "maxPerPayout" | null;
}

/** points = maxPoints × Σscores / (10 × n), exact, shown with 2 decimals; amount = points × rate. */
export function computeAmount(cat: RubricCategory, scores: Record<string, number>, rate: bigint) {
  const n = BigInt(cat.criteria.length);
  const sum = BigInt(cat.criteria.reduce((s, k) => s + Math.min(10, Math.max(0, scores[k.key] ?? 0)), 0));
  const num = BigInt(cat.maxPoints) * sum;
  const den = 10n * n;
  const amount = (rate * num) / den;
  const hundredths = (num * 100n) / den;
  const points = `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")}`;
  return { amount, points };
}

/** The largest 0–100 score whose on-chain price doesn't exceed `amount`, and what the program pays for it. */
export function scoreFor(amount: bigint, rateKelvin: bigint): { score: number; paid: bigint } {
  if (rateKelvin <= 0n || amount <= 0n) return { score: 0, paid: 0n };
  const score = Number((amount * 100n) / rateKelvin > 100n ? 100n : (amount * 100n) / rateKelvin);
  return { score, paid: (rateKelvin * BigInt(score)) / 100n };
}

export function decide(i: EngineInput): EngineDecision {
  const base = { addedFlags: [] as Flag[], cappedBy: null as EngineDecision["cappedBy"], auto: true };
  const hardReject = i.flags.find((f) => f.severity === "hard" && REJECT_FLAGS.has(f.code));
  if (hardReject) {
    return { ...base, action: "reject", amount: 0n, score: 0, points: null, categoryKey: i.judgment?.category ?? null, rule: "R1_REJECT_FLAG" };
  }

  let amount = 0n;
  let points: string | null = null;
  let cat: RubricCategory | undefined;
  const addedFlags: Flag[] = [];
  if (i.judgment) {
    cat = i.categories.find((c) => c.key === i.judgment!.category && i.resource && c.sourceTypes.includes(i.resource.sourceType));
    if (cat && i.judgment.recommended_action === "reject") points = "0.00";
    else if (cat) ({ amount, points } = computeAmount(cat, i.judgment.rubric_scores, i.ratePerPoint));
  }
  let cappedBy: EngineDecision["cappedBy"] = null;
  if (amount > i.maxPerPayout) {
    amount = i.maxPerPayout;
    cappedBy = "maxPerPayout";
  }
  // What the program actually pays: the score is an integer 0–100 against its rate.
  const priced = scoreFor(amount, i.rateKelvin);
  amount = priced.paid;
  const out = (action: EngineAction, rule: string, auto = action !== "escalate"): EngineDecision => ({
    action,
    amount: action === "reject" ? 0n : amount,
    // A reject still carries the score the judge gave (a post below the minimum shows its real score); it pays 0.
    score: priced.score,
    points,
    categoryKey: cat?.key ?? i.judgment?.category ?? null,
    auto,
    rule,
    addedFlags,
    cappedBy,
  });

  const offTopic = i.judgment?.relevance === "off_topic";
  if (offTopic)
    addedFlags.push({ code: "OFF_TOPIC", severity: "soft", message: "Not about what this program pays for, according to the program's brief.", evidence: { relevance: "off_topic" } });
  for (const f of (i.judgment?.fact_checks ?? []).filter((x) => x.verdict === "contradicts"))
    addedFlags.push({ code: "CONTRADICTS_BRIEF", severity: "soft", message: contradictionLine(f.claim, f.brief_says), evidence: { claim: f.claim, briefSays: f.brief_says } });

  if (i.flags.some((f) => f.code === "PROMPT_INJECTION_ATTEMPT")) return out("escalate", "R2_INJECTION");
  if (!i.judgment) return out("escalate", "R3_NO_JUDGMENT");
  if (i.judgment.soft_flags.some((f) => JUDGE_INJECTION_NOTE.test(f))) return out("escalate", "R2B_JUDGE_INJECTION");
  if (!cat) return out("escalate", "R4_CATEGORY_INVALID");
  if (offTopic && i.judgment.confidence >= SPAM_CONFIDENCE) return out("reject", "R5B_OFF_TOPIC");
  const scores = cat.criteria.map((k) => i.judgment!.rubric_scores[k.key] ?? 0);
  if (i.judgment.recommended_action === "reject" && i.judgment.confidence >= SPAM_CONFIDENCE && scores.every((x) => x <= SPAM_MAX_SCORE)) {
    return out("reject", "R5A_CLEAR_SPAM");
  }
  if (i.judgment.recommended_action === "reject" || i.judgment.recommended_action === "escalate") return out("escalate", "R5_AGENT_RECOMMENDS_REVIEW");
  // Merit: the program refuses approvals below its minimum score, so such work can't be paid at all.
  if (priced.score < i.minScore) return out("reject", "R8B_BELOW_MIN_SCORE");
  if ([...i.flags, ...addedFlags].some((f) => f.severity === "soft")) return out("escalate", "R6_SOFT_FLAGS");
  if (i.judgment.confidence < i.autoApproveConfidence) return out("escalate", "R7_LOW_CONFIDENCE");
  if (amount === 0n) return out("escalate", "R8_ZERO_AMOUNT");
  if (amount > i.maxAutoApproveItem) return out("escalate", "R9_ABOVE_AUTO_CAP");
  if (i.availableBudget === "unknown") return out("escalate", "R9D_BUDGET_UNKNOWN");
  if (i.availableBudget !== undefined && amount > i.availableBudget) return out("escalate", "R9C_NOT_ENOUGH_FUNDS");
  if (i.capRoom !== undefined && amount > i.capRoom) return out("escalate", "R9E_OVER_ROUND_CAP");
  if (i.opsShort) return out("escalate", "R9G_OPS_BUDGET_LOW");
  return out(i.judgment.recommended_action === "partial" ? "partial" : "approve", "R10_AUTO_APPROVE");
}
