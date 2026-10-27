import { z } from "zod";
import { ContextSaveInput } from "./context";
import { SOURCE_TYPES, type SourceType as SourceTypeName } from "./sources";

/**
 * Program configuration schemas. The wizard posts decimal RLO strings ("0.5"); the server parses them into
 * kelvin (9 decimals). Stored JSON keeps kelvin as decimal-integer strings (JSON has no bigint).
 *
 * How a program maps onto the Merit Venus program on Rialo:
 * - rate for a score of 100 = max category points × ratePerPoint (the program prices every approval from the score)
 * - per payout / per contributor per round / per round caps are enforced on chain at approval and again at payout
 * - maxPerDay, autoApproveThreshold (large-round approval) and payeeCooldownHours need program v2; until then the
 *   agent applies them off chain and the UI says so
 */

export { SOURCE_LABEL, SOURCE_LABELS, SOURCE_TYPES, listSources } from "./sources";
export const SourceType = z.enum(SOURCE_TYPES);
export type SourceType = SourceTypeName;

export const KELVIN_DECIMALS = 9;

/** Paths under the app root that a program slug must never shadow. */
export const RESERVED_SLUGS = new Set(["admin", "api", "app", "c", "docs", "join", "new", "p", "settings", "static", "www", "merit", "explore", "guardrails", "tx", "owner"]);

export const Slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/, "3–40 characters: lowercase letters, numbers and hyphens")
  .refine((s) => !s.includes("--"), "No double hyphens")
  .refine((s) => !RESERVED_SLUGS.has(s), "This name is reserved");

/** Decimal RLO entered by a person, e.g. "1" or "0.05" → kelvin. */
export function parseRloInput(s: string): bigint {
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt(frac.padEnd(KELVIN_DECIMALS, "0"));
}

export const RloInput = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,9})?$/, "Enter an amount like 1 or 0.05")
  .transform((s) => parseRloInput(s));

/** Kelvin serialized for JSON storage. */
export const KelvinString = z.string().regex(/^\d{1,24}$/);

const Key = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{0,31}$/, "Lowercase letters, numbers and underscores");

export const RubricCriterion = z.object({
  key: Key,
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().min(5).max(400),
});

const RubricCategoryFields = z.object({
  key: Key,
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().min(5).max(600),
  sourceTypes: z.array(SourceType).min(1).max(SOURCE_TYPES.length),
  /** Points awarded for a perfect submission; amount = points × ratePerPoint. */
  maxPoints: z.number().int().min(1).max(1000),
  criteria: z.array(RubricCriterion).min(1).max(8),
  /** Plain-language rules the agent applies, e.g. "Threads must be at least 4 posts." */
  rules: z.string().trim().max(2000).default(""),
  /** GitHub pull requests only: unmerged PRs are flagged NOT_MERGED. */
  requireMerged: z.boolean().optional(),
});

export const RubricCategory = RubricCategoryFields.transform(
  ({ requireMerged, ...c }): z.infer<typeof RubricCategoryFields> =>
    c.sourceTypes.includes("github_pr") ? { ...c, requireMerged: requireMerged ?? true } : c,
);

export const requiresMerged = (c: { requireMerged?: boolean }) => c.requireMerged !== false;

export const Rubric = z
  .object({
    categories: z.array(RubricCategory).min(1).max(10),
    generalRules: z.string().trim().max(4000).default(""),
  })
  .superRefine((r, ctx) => {
    const seen = new Set<string>();
    r.categories.forEach((c, i) => {
      if (seen.has(c.key)) ctx.addIssue({ code: "custom", path: ["categories", i, "key"], message: "Duplicate category key" });
      seen.add(c.key);
    });
  });
export type Rubric = z.infer<typeof Rubric>;
export type RubricCategory = z.infer<typeof RubricCategory>;

export const ProgramBasics = z.object({
  name: z.string().trim().min(2).max(80),
  slug: Slug,
  description: z.string().trim().min(10).max(1000),
  logoUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(500)]).default(""),
});

/**
 * Caps as entered (decimal RLO). Mirrors the program's validate_config: per payout ≤ per contributor ≤ per round,
 * plus Misthos' daily cap (≥ per round) and the owner-approval threshold.
 */
export const LimitsInput = z
  .object({
    maxPerPayout: RloInput,
    maxPerContributor: RloInput,
    maxPerRound: RloInput,
    maxPerDay: RloInput,
    autoApproveThreshold: RloInput,
    payeeCooldownHours: z.coerce.number().int().min(0).max(24 * 30),
  })
  .superRefine((l, ctx) => {
    if (l.maxPerPayout === 0n) ctx.addIssue({ code: "custom", path: ["maxPerPayout"], message: "Must be above zero" });
    if (l.maxPerContributor < l.maxPerPayout) ctx.addIssue({ code: "custom", path: ["maxPerContributor"], message: "Must be at least the per-payout cap" });
    if (l.maxPerRound < l.maxPerContributor) ctx.addIssue({ code: "custom", path: ["maxPerRound"], message: "Must be at least the per-contributor cap" });
    if (l.maxPerDay < l.maxPerRound) ctx.addIssue({ code: "custom", path: ["maxPerDay"], message: "Must be at least the per-round cap" });
  });
export type LimitsInput = z.infer<typeof LimitsInput>;

export const BudgetInput = z.object({
  ratePerPoint: RloInput.refine((v) => v > 0n, "Must be above zero"),
  /** Round length in minutes: 1 minute to 7 days (what the program's timers support). */
  roundLengthMinutes: z.coerce.number().int().min(1).max(7 * 24 * 60),
  firstRoundStartsAt: z.coerce.date(),
  refundDeadlineDays: z.coerce.number().int().min(1).max(365),
  autoApproveConfidence: z.coerce.number().min(0.5).max(1),
  /** Items paying more than this always go to review, even when confident. */
  maxAutoApproveItem: RloInput,
  /** Scores below this are never approved (the program refuses them too). */
  minScore: z.coerce.number().int().min(0).max(100).default(50),
  minAccountAgeDays: z.coerce.number().int().min(0).max(3650),
  minXFollowers: z.coerce.number().int().min(0).max(10_000_000).default(0),
  belowMinimum: z.enum(["review", "reject", "block"]).default("review"),
  maxSubmissionsPerRound: z.coerce.number().int().min(1).max(100).default(5),
  /** Funding the setup checklist sends on chain after creation. */
  escrow: RloInput,
  opsBudget: RloInput,
});
export type BudgetInput = z.infer<typeof BudgetInput>;

export const ProgramInput = z
  .object({
    basics: ProgramBasics,
    context: ContextSaveInput,
    rubric: Rubric,
    budget: BudgetInput,
    limits: LimitsInput,
  })
  .superRefine((p, ctx) => {
    const top = BigInt(Math.max(...p.rubric.categories.map((c) => c.maxPoints))) * p.budget.ratePerPoint;
    if (top > p.limits.maxPerPayout) {
      ctx.addIssue({
        code: "custom",
        path: ["limits", "maxPerPayout"],
        message: "A perfect submission (max points × rate) must fit one payout",
      });
    }
  });
export type ProgramInput = z.infer<typeof ProgramInput>;

/** Limits as stored in programs.limits_json (kelvin strings). */
export const StoredLimits = z.object({
  maxPerPayout: KelvinString,
  maxPerContributor: KelvinString,
  maxPerRound: KelvinString,
  maxPerDay: KelvinString,
  autoApproveThreshold: KelvinString,
  payeeCooldownSeconds: z.number().int().min(0),
  maxAutoApproveItem: KelvinString,
});
export type StoredLimits = z.infer<typeof StoredLimits>;

export function toStoredLimits(limits: LimitsInput, budget: BudgetInput): StoredLimits {
  return {
    maxPerPayout: limits.maxPerPayout.toString(),
    maxPerContributor: limits.maxPerContributor.toString(),
    maxPerRound: limits.maxPerRound.toString(),
    maxPerDay: limits.maxPerDay.toString(),
    autoApproveThreshold: limits.autoApproveThreshold.toString(),
    payeeCooldownSeconds: limits.payeeCooldownHours * 3600,
    maxAutoApproveItem: budget.maxAutoApproveItem.toString(),
  };
}

/** The on-chain rate (kelvin for a score of 100) for a rubric: the largest category's max points × rate. */
export function onChainRate(rubric: Rubric, ratePerPoint: bigint): bigint {
  return BigInt(Math.max(...rubric.categories.map((c) => c.maxPoints))) * ratePerPoint;
}

/** An example rubric to start from (the wizard's "start from the example"). */
export const EXAMPLE_RUBRIC: Rubric = {
  categories: [
    {
      key: "threads",
      name: "Threads and posts",
      description: "Original X posts or threads that teach something real about building on Rialo.",
      sourceTypes: ["x_post"],
      maxPoints: 10,
      criteria: [
        { key: "depth", name: "Depth", description: "Explains how something works, not just that it exists." },
        { key: "clarity", name: "Clarity", description: "Easy to follow for a developer new to Rialo." },
        { key: "accuracy", name: "Accuracy", description: "Claims match how Rialo actually works." },
      ],
      rules: "Original work only. Threads count as one submission.",
    },
  ],
  generalRules: "",
};
