import { EXAMPLE_RUBRIC } from "@/lib/shared/program";

/** A complete wizard payload (decimal RLO strings, as the browser posts them). */
export function programPayload(overrides: { slug?: string; start?: Date } = {}) {
  return {
    basics: { name: "Rialo Builders", slug: overrides.slug ?? "rialo-builders", description: "Pays for original threads about building on Rialo.", logoUrl: "" },
    context: {
      about: "Rialo is a blockchain with native timers, REX verification and Latch guardrails. Post about building on it.",
      links: ["https://rialo.io"],
      mustInclude: ["@RialoHQ"],
      understanding: null,
    },
    rubric: EXAMPLE_RUBRIC,
    budget: {
      ratePerPoint: "0.001",
      roundLengthMinutes: "5",
      firstRoundStartsAt: (overrides.start ?? new Date()).toISOString(),
      refundDeadlineDays: "30",
      autoApproveConfidence: "0.8",
      maxAutoApproveItem: "0.01",
      minScore: "50",
      minAccountAgeDays: "30",
      minXFollowers: "10",
      belowMinimum: "review",
      maxSubmissionsPerRound: "5",
      escrow: "0.2",
      opsBudget: "0.1",
    },
    limits: {
      maxPerPayout: "0.01",
      maxPerContributor: "0.02",
      maxPerRound: "0.05",
      maxPerDay: "0.1",
      autoApproveThreshold: "0.05",
      payeeCooldownHours: "24",
    },
  };
}
