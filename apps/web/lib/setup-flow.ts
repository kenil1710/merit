/**
 * The path from a saved draft to a live campaign on Rialo, as pure state, so the wizard's last step, the setup page
 * and the program overview tell the same story. Every step but "publish" is a fact on chain.
 */

export type SetupKey = "create" | "describe" | "fund" | "ops" | "open" | "publish";
export type SetupStatus = "done" | "current" | "waiting" | "skipped";

export interface SetupState {
  /** The campaign exists at the recorded address. */
  created: boolean;
  /** Name and brief signed by the owner and listed on Explore. */
  described: boolean;
  /** Escrow ever funded (a campaign drained by payouts still counts). */
  funded: boolean;
  /** Operations budget funded, or none was planned. */
  opsFunded: boolean;
  /** Round 1 opened, or it is scheduled for later. */
  opened: boolean;
  scheduledLater: boolean;
  published: boolean;
}

export const SETUP_STEPS: { key: SetupKey; label: string }[] = [
  { key: "create", label: "Create the campaign on Rialo" },
  { key: "describe", label: "Sign the name and brief" },
  { key: "fund", label: "Fund the escrow" },
  { key: "ops", label: "Fund the operations budget" },
  { key: "open", label: "Open round 1" },
  { key: "publish", label: "Publish" },
];

const DONE: Record<SetupKey, (s: SetupState) => boolean> = {
  create: (s) => s.created,
  describe: (s) => s.described,
  fund: (s) => s.funded,
  ops: (s) => s.opsFunded,
  open: (s) => s.opened,
  publish: (s) => s.published,
};

export function setupCurrent(s: SetupState): SetupKey | "live" {
  return SETUP_STEPS.find((step) => !(step.key === "open" && s.scheduledLater) && !DONE[step.key](s))?.key ?? "live";
}

export function setupSteps(s: SetupState): { key: SetupKey; label: string; status: SetupStatus }[] {
  const current = setupCurrent(s);
  return SETUP_STEPS.map((step) => ({
    ...step,
    status: DONE[step.key](s) ? "done" : step.key === "open" && s.scheduledLater ? "skipped" : step.key === current ? "current" : "waiting",
  }));
}
