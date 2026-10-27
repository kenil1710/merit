import "server-only";

import type { Db } from "@/lib/db";
import { campaignView, type CampaignView, type DecisionView } from "./campaign-view";
import { contributorSubmissions, type Contributor } from "./contributors";
import type { Program } from "./programs";

/**
 * A contributor's view of one program: their submissions from the database, each matched to its ledger entry on
 * chain (REX verdict, report, payout), the totals that follow, and a row per round. On-chain facts win: an approval
 * is only "paid" once the program's payout transaction exists.
 */

export type Shown = "reviewing" | "with_team" | "expired" | "rejected" | "verifying" | "verified" | "failed" | "waiting_funds" | "paid";

export type ContributorItem = {
  id: string;
  url: string;
  postId: string;
  createdAt: string;
  shown: Shown;
  score: number | null;
  /** The program's minimum score, when the post was rejected for scoring below it. */
  belowMinimum: number | null;
  /** The decision's explanation (one paragraph, from facts). */
  summary: string;
  /** The judge's own observations. */
  reasons: string[];
  decisionHash: string | null;
  /** Kelvin paid, or approved and expected (before caps), or null. */
  amount: string | null;
  round: number | null;
  appeal: { note: string; at: string; resolved: boolean } | null;
  canAppeal: boolean;
  chain: DecisionView | null;
};

/** open: takes submissions; closing: ended, in its late grace or settling; closed: can't take or pay anything more. */
export type RoundState = "open" | "closing" | "closed";
export type RoundRow = { round: number; submitted: number; approved: number; paid: bigint; open: boolean; state: RoundState };

export type ContributorView = {
  items: ContributorItem[];
  paid: bigint;
  awaiting: bigint;
  thisRound: bigint;
  rounds: RoundRow[];
  campaign: CampaignView | null;
  chainError: boolean;
};

/** The reasons as the record lists them (judge records, or the wrapped off-chain ones); the summary otherwise. */
function reasonsOf(decision: { decisionJson: string; summary: string } | null): string[] {
  if (!decision) return [];
  try {
    const parsed = JSON.parse(decision.decisionJson) as { reasons?: unknown; record?: { reasons?: unknown }; judgment?: { output?: { reasons?: unknown } } | null };
    const list = parsed.reasons ?? parsed.record?.reasons ?? parsed.judgment?.output?.reasons;
    if (Array.isArray(list) && list.length) return list.map(String);
  } catch {
    /* not JSON: fall back to the summary */
  }
  return [];
}

/**
 * The score to show. Records written before 2026-10-27 stored 0 for every reject; their real score is recovered from
 * the points the judge gave (score = points ÷ the category's max points, as the engine prices it).
 */
export function shownScore(decision: { score: number | null; action: string; points: string | null; categoryKey: string | null } | null, program: Pick<Program, "rubricJson">): number | null {
  if (!decision) return null;
  if ((decision.score ?? 0) > 0 || decision.action !== "reject" || !decision.points) return decision.score;
  const max = program.rubricJson.categories.find((c) => c.key === decision.categoryKey)?.maxPoints;
  const points = Number(decision.points);
  return max && Number.isFinite(points) ? Math.min(100, Math.floor((points * 100) / max)) : decision.score;
}

/**
 * A round's state for the contributor: the open round; a round that ended but can still pay (its late grace, or
 * settling: at or above `expiredBelow`); or closed. Without the chain, every past round is closed.
 */
export function roundState(round: number, openRound: number | null, expiredBelow: number | null): RoundState {
  if (round === openRound) return "open";
  return expiredBelow !== null && round >= expiredBelow ? "closing" : "closed";
}

/** The program's minimum, when a rejection was for scoring below it. */
const belowMinimum = (decision: { action: string; decisionJson: string } | null, minScore: number): number | null => {
  if (decision?.action !== "reject") return null;
  try {
    return (JSON.parse(decision.decisionJson) as { rule?: string }).rule === "R8B_BELOW_MIN_SCORE" ? minScore : null;
  } catch {
    return null;
  }
};

const paidKelvin = (d: DecisionView) => BigInt(/Merit paid (\d+) kelvin/.exec(d.tx.payoutLine ?? "")?.[1] ?? d.amountKelvin);

export async function contributorView(db: Db, program: Program, contributor: Contributor): Promise<ContributorView> {
  const items = await contributorSubmissions(db, contributor.id);
  let campaign: CampaignView | null = null;
  let chainError = false;
  if (program.campaignAddress) {
    try {
      campaign = await campaignView(program.campaignAddress);
    } catch {
      chainError = true;
    }
  }
  const entries = (campaign?.rounds ?? []).flatMap((r) => r.decisions.map((d) => ({ round: r.round, d })));
  const out: ContributorItem[] = items.map(({ submission: s, decision, appeal, roundNumber }) => {
    const hit = entries.find((e) => e.d.postId === s.resourceId && e.d.contributor === contributor.walletAddress);
    const d = hit?.d ?? null;
    let shown: Shown;
    const expired = !!campaign && roundNumber !== null && roundNumber < campaign.expiredBelow;
    if (s.status === "rejected") shown = "rejected";
    else if ((s.status === "escalated" || s.status === "pending" || s.status === "processing") && expired) shown = "expired";
    else if (s.status === "escalated") shown = "with_team";
    else if (s.status === "pending" || s.status === "processing") shown = "reviewing";
    else if (!d) shown = "verifying";
    else if (d.tx.payout) shown = "paid";
    else if (d.status === "Failed verification" || d.status === "Inconclusive") shown = "failed";
    else if (d.status === "Verified") shown = campaign?.phaseCode === 3 && hit!.round === campaign.round.number ? "waiting_funds" : "verified";
    else shown = "verifying";
    const amount = d ? (d.tx.payout ? paidKelvin(d) : BigInt(d.amountKelvin)) : s.amount;
    return {
      id: s.id,
      url: s.url,
      postId: s.resourceId,
      createdAt: s.createdAt.toISOString(),
      shown,
      score: shownScore(decision, program),
      belowMinimum: belowMinimum(decision, program.minScore),
      summary: decision?.summary ?? "",
      reasons: reasonsOf(decision),
      decisionHash: decision?.decisionHash ?? null,
      amount: amount !== null && amount !== undefined && shown !== "rejected" && shown !== "failed" && shown !== "expired" ? amount.toString() : null,
      round: hit?.round ?? roundNumber,
      appeal: appeal ? { note: appeal.note, at: appeal.createdAt.toISOString(), resolved: !!appeal.resolvedAt } : null,
      canAppeal: !appeal && decision?.action === "reject",
      chain: d,
    };
  });
  const sum = (f: (i: ContributorItem) => boolean) => out.filter(f).reduce((t, i) => t + BigInt(i.amount ?? "0"), 0n);
  const current = campaign?.phaseCode === 1 ? campaign.round.number : null;
  const stateOf = (round: number) => roundState(round, current, campaign?.expiredBelow ?? null);
  const roundNumbers = [...new Set([...(current ? [current] : []), ...out.map((i) => i.round).filter((r): r is number => r !== null)])].sort((a, b) => b - a);
  return {
    items: out,
    paid: sum((i) => i.shown === "paid"),
    awaiting: sum((i) => i.shown === "verifying" || i.shown === "verified" || i.shown === "waiting_funds"),
    thisRound: current ? sum((i) => i.round === current && i.shown !== "rejected") : 0n,
    rounds: roundNumbers.map((round) => {
      const mine = out.filter((i) => i.round === round);
      return {
        round,
        submitted: mine.length,
        approved: mine.filter((i) => ["verifying", "verified", "waiting_funds", "paid"].includes(i.shown)).length,
        paid: mine.filter((i) => i.shown === "paid").reduce((t, i) => t + BigInt(i.amount ?? "0"), 0n),
        open: round === current,
        state: stateOf(round),
      };
    }),
    campaign,
    chainError,
  };
}
