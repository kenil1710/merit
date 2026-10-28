import "server-only";

import { findLedger, loadState } from "@/lib/merit/chain";
import { verificationsLeft as opsVerificationsLeft } from "@/lib/merit/constants";
import type { MeritState } from "@/lib/merit/state";
import { setupCurrent, type SetupState } from "@/lib/setup-flow";
import { getDb } from "@/lib/db";
import { rpc } from "./agent";
import { expiredBelow, roundBadgeText, roundStatus } from "@/lib/shared/round-window";
import { reviewCount } from "./review";
import type { Program } from "./programs";
import { store } from "./store";

/** Ledger rent kept from the operations budget for each round with approvals (about 0.024 RLO). */
const LOW_VERIFICATIONS = 3n;

export type Need = { text: string; href: string; action: string; kind: "setup" | "funds" | "ops" | "review" };

export type ProgramSummary = {
  program: Program;
  state: MeritState | null;
  /** The chain couldn't be read (DevNet down): show what the database knows, and say so. */
  chainError: boolean;
  setup: SetupState;
  roundPill: RoundPillData | null;
  needs: Need[];
  verificationsLeft: number | null;
  /** Submissions waiting for a person (escalated, second looks, waiting for funds). */
  review: number;
};

async function readChain(address: string | null): Promise<{ state: MeritState | null; error: boolean }> {
  if (!address) return { state: null, error: false };
  try {
    return { state: await loadState(rpc, address), error: false };
  } catch {
    return { state: null, error: true };
  }
}

export function setupState(program: Program, state: MeritState | null, described: boolean, now = Date.now()): SetupState {
  const created = !!state && state.kind === 1n && state.owner === program.ownerWallet;
  return {
    created,
    described,
    funded: created && state!.totalFunded > 0n,
    opsFunded: program.plannedOpsBudget === 0n || (created && state!.totalOpsFunded > 0n),
    opened: created && state!.round >= 1n,
    scheduledLater: (!created || state!.round === 0n) && program.firstRoundStartsAt.getTime() > now,
    published: program.status !== "draft",
  };
}

/** The owner's round pill: "Round 2 · Open" plus a live countdown, with the shared labels; null before the campaign exists. */
export type RoundPillData = { text: string; label: string; tone: "live" | "wait" | "idle"; countdown: { toMs: number; prefix: string } | null };

export function roundPill(state: MeritState | null, program: Program, now = Date.now()): RoundPillData | null {
  if (!state) return null;
  if (state.phase === 0n && state.round === 0n) {
    const later = program.firstRoundStartsAt.getTime() > now;
    return { text: "Round 1", label: "Not started", tone: "idle", countdown: later ? { toMs: program.firstRoundStartsAt.getTime(), prefix: "opens in" } : null };
  }
  const status = roundStatus(state, now);
  const label = roundBadgeText(status.state, true);
  const tone = status.state === "open" ? "live" : status.state === "ended" || status.state === "idle" ? "idle" : "wait";
  const countdown = status.countdown ? { toMs: status.countdown.to.getTime(), prefix: status.countdown.prefix } : null;
  return { text: status.state === "ended" ? "Ended" : `Round ${status.round} · ${label}`, label, tone, countdown };
}

export function verificationsLeft(state: MeritState): number {
  return opsVerificationsLeft(state.opsBudgetKelvin);
}

export async function programSummary(program: Program, now = Date.now()): Promise<ProgramSummary> {
  const db = await getDb();
  const [{ state, error }, meta] = await Promise.all([
    readChain(program.campaignAddress),
    program.campaignAddress ? store.campaign(program.campaignAddress).catch(() => null) : Promise.resolve(null),
  ]);
  const review = await reviewCount(db, program.id, expiredBelow(state, now)).catch(() => 0);
  const setup = setupState(program, state, !!meta, now);
  const base = `/app/programs/${program.id}`;
  const needs: Need[] = [];
  if (review > 0) needs.push({ text: `${review} submission${review === 1 ? " needs" : "s need"} your review.`, href: `${base}/submissions?tab=review`, action: "Review", kind: "review" });
  if (setupCurrent(setup) !== "live") needs.push({ text: `${program.name} isn't live yet.`, href: `${base}/setup`, action: "Continue setup", kind: "setup" });
  const left = state && setup.created ? verificationsLeft(state) : null;
  if (state && setup.published && state.phase === 3n) needs.push({ text: "A round is waiting for funds to pay approved work.", href: base, action: "Add funds", kind: "funds" });
  if (state && setup.published && state.phase === 6n) needs.push({ text: `Round ${state.round} is above your approval threshold and waits for you.`, href: base, action: "Approve payout", kind: "funds" });
  if (state?.paused && state.phase < 4n) needs.push({ text: `${program.name} is paused: nothing is approved or paid.`, href: base, action: "Resume", kind: "funds" });
  if (left !== null && setup.published && state!.phase < 4n && BigInt(left) < LOW_VERIFICATIONS) {
    needs.push({ text: `The operations budget covers about ${left} more verifications.`, href: base, action: "Top it up", kind: "ops" });
  }
  return { program, state, chainError: error, setup, roundPill: roundPill(state, program, now), needs, verificationsLeft: left, review };
}

export async function programSummaries(programs: Program[]) {
  return Promise.all(programs.map((p) => programSummary(p, Date.now())));
}

/** The owner controls' view of the campaign (program v2), with what a round waiting for approval would pay. */
export async function controlsState(state: MeritState): Promise<import("@/components/app/campaign-controls").ControlsState> {
  let roundDue = 0n;
  if (state.phase === 6n) {
    const ledger = await findLedger(rpc, state, state.round).catch(() => null);
    for (const e of ledger?.entries ?? []) if (e.status === 2n && state.outcome[e.index] === 0n) roundDue += e.amount;
  }
  return {
    version: state.version,
    phase: Number(state.phase),
    paused: state.paused,
    round: Number(state.round),
    roundEndMs: Number(state.roundEndMs),
    maxPerDay: state.maxPerDay.toString(),
    approvalThreshold: state.approvalThreshold.toString(),
    cooldownMs: state.cooldownMs.toString(),
    submitGraceMs: state.submitGraceMs.toString(),
    capPerPayout: state.capPerPayout.toString(),
    roundDue: roundDue.toString(),
  };
}
