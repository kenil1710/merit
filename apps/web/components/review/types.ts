/** Review rows as the client sees them (lib/server/review.ts builds them; this file stays free of server code). */
export type QueueReasonView = "low_confidence" | "below_minimums" | "over_budget" | "waiting_funds" | "second_look" | "injection" | "agent_review" | "flags" | "no_judgment" | "queued";

export type ReviewRowView = {
  id: string;
  url: string;
  postId: string;
  status: string;
  amount: string | null;
  score: number | null;
  createdAt: string;
  xHandle: string;
  summary: string | null;
  rule: string | null;
  flags: { code: string; severity: string }[];
  reason: QueueReasonView | null;
  decidedBy: "agent" | "human" | null;
};

export const QUEUE_LABEL_CLIENT: Record<QueueReasonView, string> = {
  low_confidence: "Low confidence",
  below_minimums: "Below minimums",
  over_budget: "Over budget",
  waiting_funds: "Waiting for funds",
  second_look: "Second look",
  injection: "Aimed at the grader",
  agent_review: "Agent asks for review",
  flags: "Flags to check",
  no_judgment: "Agent couldn't finish",
  queued: "Queued",
};
