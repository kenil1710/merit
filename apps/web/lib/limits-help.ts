/** What each limit protects against, in the owner's words, and where it is enforced today. */
export const LIMIT_HELP = {
  maxPerPayout: "The most one approved submission can pay. The program refuses anything above it.",
  maxPerContributor: "The most one contributor can receive in a round. Caps the damage if someone is over-rewarded.",
  maxPerRound: "The most a whole round can pay out. Protects the escrow if many submissions are approved at once.",
  maxPerDay: "The most the campaign should pay in any 24 hours, across rounds.",
  autoApproveThreshold: "Rounds paying out more than this should wait for your signature.",
  payeeCooldownHours: "How long a new or changed payout wallet waits before it can be paid. Protects contributors whose account is taken over.",
  maxAutoApproveItem: "Single submissions worth more than this always go to your review queue.",
  autoApproveConfidence: "How sure the agent must be (0.5 to 1) to approve on its own. Below this, the submission comes to you.",
} as const;

/** Limits the Merit program enforces today; the rest are applied by the agent until program v2 adds them. */
export const ON_CHAIN_LIMITS = new Set(["maxPerPayout", "maxPerContributor", "maxPerRound"]);
