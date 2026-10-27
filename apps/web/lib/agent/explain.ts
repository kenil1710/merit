import { formatRlo } from "@/lib/merit/constants";
import type { RubricCategory } from "@/lib/shared/program";
import type { EngineDecision } from "./engine";
import type { JudgmentOutput } from "./judge";
import type { Flag, Resource } from "./types";

const rlo = (k: bigint) => `${formatRlo(k).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")} RLO`;

/**
 * The one-paragraph explanation shown to contributors and owners and kept in the decision record (Misthos' explain,
 * in RLO). Deterministic: built from facts (flags, scores, the rule), quoting the model's summary where useful.
 */
export function explain(p: {
  decision: EngineDecision;
  flags: Flag[];
  judgment: JudgmentOutput | null;
  categories: RubricCategory[];
  resource: Resource | null;
  priorCount: number;
  minScore: number;
  judgeError?: string;
}): string {
  const { decision: d, judgment: j } = p;
  const flags = [...p.flags, ...d.addedFlags];
  const cat = p.categories.find((c) => c.key === d.categoryKey);
  const scoreLine = () => {
    if (!j || !cat) return "";
    const parts = cat.criteria.map((k) => `${j.rubric_scores[k.key] ?? 0}/10 on ${k.name.toLowerCase()}`);
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
    return ` Scored ${list}.`;
  };
  const thread = p.resource && p.resource.x.thread.postIds.length > 1 ? ` A ${p.resource.x.thread.postIds.length}-post thread.` : "";
  const provenance = () => (p.resource ? ` Posted inside the round by the linked account.${thread}` : "");
  const dupLine = () => (p.priorCount > 0 ? ` No duplicate found across ${p.priorCount} prior submission${p.priorCount === 1 ? "" : "s"}.` : "");
  const cap = d.cappedBy === "maxPerPayout" ? " Capped at the program's per-payout limit." : "";
  const contradictions = flags.filter((f) => f.code === "CONTRADICTS_BRIEF").map((f) => f.message);
  const factLine = () =>
    contradictions.length ? ` Fact check: ${contradictions.length === 1 ? "1 claim conflicts" : `${contradictions.length} claims conflict`} with the brief. ${contradictions.join(" ")}` : "";
  const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

  if (d.action === "reject" && d.rule === "R5A_CLEAR_SPAM") {
    return tidy(`Rejected automatically as clearly outside this program's rubric. ${j!.quality_summary}${scoreLine()}${factLine()} The program team can override this decision.`);
  }
  if (d.action === "reject" && d.rule === "R5B_OFF_TOPIC") {
    return tidy(`Rejected automatically: not about what this program pays for, according to its brief. ${j?.quality_summary ?? ""}${factLine()} The program team can override this decision.`);
  }
  if (d.action === "reject" && d.rule === "R8B_BELOW_MIN_SCORE") {
    return tidy(`Not approved: it scored ${d.score === 0 ? "below" : "under"} this program's minimum of ${p.minScore}/100, so the program won't pay it. ${j?.quality_summary ?? ""}${scoreLine()}${factLine()}`);
  }
  if (d.action === "reject") {
    const f = flags.find((x) => x.severity === "hard")!;
    const tail: Partial<Record<Flag["code"], string>> = {
      NEAR_DUPLICATE: " Recycled content isn't paid under this program's rules.",
      DUPLICATE_URL: " Each piece of work is paid once.",
      OWNERSHIP_MISMATCH: " Only work by the linked account is paid.",
      OUT_OF_WINDOW: " Only work from inside the round counts.",
    };
    return `Rejected. ${f.message}${tail[f.code] ?? ""}${factLine()}`;
  }
  if (d.action === "approve" || d.action === "partial") {
    const label = d.action === "partial" ? "Partially approved" : "Approved";
    return tidy(`${label} · ${rlo(d.amount)} (score ${d.score}/100).${provenance()} ${j!.quality_summary}${scoreLine()}${dupLine()}${cap}${factLine()}`);
  }

  const rec = d.amount > 0n ? ` The agent recommends ${rlo(d.amount)}.` : "";
  const why: Record<string, string> = {
    R2_INJECTION: `${flags.find((f) => f.code === "PROMPT_INJECTION_ATTEMPT")?.message ?? "Contains text aimed at the grader."} Submissions that try to influence scoring always get a human review.`,
    R2B_JUDGE_INJECTION: "The reviewing model noticed text aimed at it, so a person reviews this one, whatever the scores.",
    R3_NO_JUDGMENT: `The agent couldn't complete its review${p.judgeError ? ` (${p.judgeError})` : ""}.`,
    R4_CATEGORY_INVALID: "The agent couldn't match this to a rubric category.",
    R5_AGENT_RECOMMENDS_REVIEW:
      j?.recommended_action === "reject" ? "The agent recommends rejecting this (no payment) and wants a reviewer to confirm." : "The agent wants a reviewer's judgment on this one.",
    R6_SOFT_FLAGS: flags
      .filter((f) => f.severity === "soft" && f.code !== "CONTRADICTS_BRIEF")
      .map((f) => f.message)
      .join(" "),
    R7_LOW_CONFIDENCE: `The agent's confidence (${j ? Math.round(j.confidence * 100) : 0}%) is below this program's auto-approval threshold.`,
    R8_ZERO_AMOUNT: "The work scored zero points.",
    R9_ABOVE_AUTO_CAP: "The amount is above what this program approves without review.",
    R9C_NOT_ENOUGH_FUNDS: "Not enough funds in the escrow: approving it would owe more than the escrow holds after the work already approved.",
    R9D_BUDGET_UNKNOWN: "The escrow balance couldn't be read from Rialo, so a person reviews this one.",
    R9G_OPS_BUDGET_LOW: "The operations budget can't repay another validator check, so the program would refuse the approval. Top it up, then approve.",
    R9E_OVER_ROUND_CAP: "Approving it would go past this round's per-contributor or per-round cap, which the program enforces.",
  };
  const summary = j ? ` ${j.quality_summary}` : "";
  return tidy(`Escalated for review. ${why[d.rule] ?? ""}${factLine()}${rec}${summary}${scoreLine()}`);
}
