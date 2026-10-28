// Addresses and rules shared by the browser and the server. Values mirror
// `crates/merit-core` and `deployments/devnet.json`.

export const RPC_UPSTREAM = "https://devnet.rialo.io";
export const PROGRAM_ID = "4qBwWYWn7ougS7sHP21x4yTDk4cwmyEqUiqNmKAYVuk6";
export const REX_COMPONENTS_ID = "SufLA3Vvm5x7ag2RSctyJhgceMQS1ht8rYAadjdvQvb";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const SUBSCRIBER_PROGRAM_ID = "Subscriber111111111111111111111111111111111";
export const REX_PROCESSOR_ID = "Qrac1eProcessor1111111111111111111111111111";

export const KELVIN_PER_RLO = 1_000_000_000n;
export const MAX_ENTRIES = 16;
export const MAX_SCORE = 100;
export const MIN_ROUND_MS = 60_000;
export const MAX_ROUND_MS = 7 * 86_400_000;
export const REX_COST_KELVIN = 12_000_000n;
/// Rent of a round ledger (~3.3 KB), repaid to the agent from the operations budget for each round with approvals.
export const LEDGER_RENT_KELVIN = 24_067_680n;

/**
 * Verifications the operations budget still covers, as the program counts them: it refuses an approval unless one
 * more verification plus the round's ledger rent fits the budget. Every page uses this one number.
 */
export function verificationsLeft(opsBudgetKelvin: bigint, ledgerRentKelvin = LEDGER_RENT_KELVIN): number {
  return Number(opsBudgetKelvin > ledgerRentKelvin ? (opsBudgetKelvin - ledgerRentKelvin) / REX_COST_KELVIN : 0n);
}
/// The relay never requests more than this per faucet call.
export const FAUCET_MAX_KELVIN = 1_000_000_000n;

export const KIND = { CAMPAIGN: 1n, LEDGER: 2n } as const;

export const PHASE_NAMES: Record<string, string> = {
  "0": "Idle",
  "1": "Round open",
  "2": "Settling",
  "3": "Waiting for funds",
  "4": "Ended",
  "5": "Refunded",
  "6": "Waiting for owner approval",
};

export const ENTRY_STATUS_NAMES: Record<string, string> = {
  "0": "Empty",
  "1": "Verifying",
  "2": "Verified",
  "3": "Failed verification",
  "4": "Inconclusive",
  "5": "Revoked",
};

export const SETTLE_NAMES: Record<string, string> = {
  "0": "Not settled",
  "1": "Paid",
  "2": "Skipped (unverified)",
  "3": "Skipped (over cap)",
  "4": "Unfunded",
  "5": "Revoked",
  "6": "Skipped (24-hour cap)",
};

export function formatRlo(kelvin: bigint, digits = 4): string {
  const negative = kelvin < 0n;
  const abs = negative ? -kelvin : kelvin;
  const whole = abs / KELVIN_PER_RLO;
  const fraction = (abs % KELVIN_PER_RLO).toString().padStart(9, "0").slice(0, digits);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function parseRlo(text: string): bigint {
  const match = /^\s*(\d+)(?:\.(\d{0,9}))?\s*$/.exec(text);
  if (!match) throw new Error("Enter an amount like 0.5");
  return BigInt(match[1]) * KELVIN_PER_RLO + BigInt((match[2] ?? "").padEnd(9, "0"));
}
