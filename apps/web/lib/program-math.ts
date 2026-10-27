import { formatRlo } from "@/lib/merit/constants";

/**
 * How a score becomes RLO, in one place. Each criterion is scored 0–10 → points = max points × average ÷ 10 →
 * payout = points × rate per point. On chain the program prices a 0–100 score against the largest category's
 * perfect payout, and never pays past its caps.
 */
export function perfectPayout(maxPoints: number, rate: bigint): bigint {
  return BigInt(Math.max(0, Math.floor(maxPoints))) * rate;
}

/** Decimal RLO as typed ("0.5") → kelvin, or null while it isn't a valid amount yet. */
export function tryParseRlo(v: string): bigint | null {
  const m = /^\s*(\d{1,9})(?:\.(\d{1,9}))?\s*$/.exec(v);
  return m ? BigInt(m[1]!) * 1_000_000_000n + BigInt((m[2] ?? "").padEnd(9, "0")) : null;
}

/** Kelvin → the shortest decimal that round-trips ("0.05", "1"), for prefilled inputs. */
export function rloInput(kelvin: bigint): string {
  const whole = kelvin / 1_000_000_000n;
  const frac = (kelvin % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** "0.0500 RLO", trimmed to what matters. */
export const rlo = (kelvin: bigint) => `${formatRlo(kelvin).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")} RLO`;

/**
 * Starting limits from what the rubric can pay: one payout is the best perfect item; a contributor can earn three of
 * those per round; a round pays at most five contributors' worth; a day at most two rounds; owner approval for any
 * round above a third of the round cap. The same shape as Misthos' defaults, in RLO.
 */
export function deriveDefaultLimits(maxItem: bigint) {
  const item = maxItem > 0n ? maxItem : 10_000_000n;
  const perContributor = item * 3n;
  const perRound = perContributor * 5n;
  return {
    maxAutoApproveItem: rloInput(item),
    maxPerPayout: rloInput(item),
    maxPerContributor: rloInput(perContributor),
    maxPerRound: rloInput(perRound),
    maxPerDay: rloInput(perRound * 2n),
    autoApproveThreshold: rloInput(perRound / 3n),
  };
}

export interface LimitNumbers {
  maxCategoryPayout: bigint | null;
  maxAutoApproveItem: bigint | null;
  maxPerPayout: bigint | null;
  maxPerContributor: bigint | null;
  maxPerRound: bigint | null;
  autoApproveThreshold: bigint | null;
}

/** Combinations that are allowed but probably not what the owner meant. Hard rules live in the schema. */
export function limitWarnings(l: LimitNumbers): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  if (l.maxAutoApproveItem !== null && l.maxPerPayout !== null && l.maxAutoApproveItem > l.maxPerPayout)
    out.push({ field: "maxAutoApproveItem", text: `Items up to ${rlo(l.maxAutoApproveItem)} skip review, but one payout can't exceed ${rlo(l.maxPerPayout)}.` });
  if (l.autoApproveThreshold !== null && l.maxPerRound !== null && l.autoApproveThreshold >= l.maxPerRound)
    out.push({ field: "autoApproveThreshold", text: `No round can exceed ${rlo(l.maxPerRound)}, so you'd never be asked to approve one.` });
  if (l.maxCategoryPayout !== null && l.maxAutoApproveItem === 0n) out.push({ field: "maxAutoApproveItem", text: "Every submission will wait for your review." });
  return out;
}

const singularWord = (w: string) => (/ies$/.test(w) ? w.replace(/ies$/, "y") : /(ss|us)$/.test(w) ? w : w.replace(/s$/, ""));

/** "Threads and posts" → "thread or post", for "A perfect thread or post (10/10) earns …". */
export function itemNoun(categoryName: string): string {
  const name = categoryName.trim();
  if (!name) return "submission";
  const parts = name.split(/\s*(?:,|\band\b|&|\bor\b|\/)\s*/i).filter(Boolean);
  const plural = parts.every((p) => /s$/i.test(p) && !/(ss|us)$/i.test(p));
  if (!plural) return `“${name}” submission`;
  const keepCase = (w: string) => (/^[A-Z]{2,}|^[A-Z][a-z]*[A-Z]/.test(w) ? w : w.toLowerCase());
  return parts
    .map((p) => {
      const words = p.split(/\s+/).map(keepCase);
      words[words.length - 1] = singularWord(words[words.length - 1]!);
      return words.join(" ");
    })
    .join(" or ");
}
