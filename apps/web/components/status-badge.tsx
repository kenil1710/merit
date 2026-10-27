import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** What a decision or campaign can show. Green is reserved for verified and paid. */
export type BadgeStatus =
  | "verifying"
  | "verified"
  | "failed"
  | "inconclusive"
  | "paid"
  | "waiting_funds"
  | "skipped"
  | "open"
  | "settling"
  | "idle"
  | "ended"
  | "refunded"
  | "approved"
  | "below_minimum"
  | "awaiting_owner"
  | "revoked";

const styles: Record<BadgeStatus, string> = {
  verifying: "bg-brand-subtle text-brand-soft",
  verified: "bg-success-subtle text-success",
  failed: "bg-danger-subtle text-danger",
  inconclusive: "bg-warning-subtle text-warning",
  paid: "bg-success-subtle text-success",
  waiting_funds: "bg-warning-subtle text-warning",
  skipped: "bg-muted text-muted-foreground",
  open: "bg-brand-subtle text-brand-soft",
  settling: "bg-warning-subtle text-warning",
  idle: "bg-muted text-muted-foreground",
  ended: "bg-muted text-muted-foreground",
  refunded: "bg-muted text-muted-foreground",
  approved: "bg-brand-subtle text-brand-soft",
  below_minimum: "bg-muted text-muted-foreground",
  awaiting_owner: "bg-warning-subtle text-warning",
  revoked: "bg-muted text-muted-foreground",
};

const labels: Record<BadgeStatus, string> = {
  verifying: "Verifying",
  verified: "Verified",
  failed: "Failed verification",
  inconclusive: "Inconclusive",
  paid: "Paid",
  waiting_funds: "Waiting for funds",
  skipped: "Skipped",
  open: "Round open",
  settling: "Settling",
  idle: "Idle",
  ended: "Ended",
  refunded: "Refunded",
  approved: "Approved",
  below_minimum: "Below minimum",
  awaiting_owner: "Waiting for owner approval",
  revoked: "Revoked",
};

/** Campaign phase code (merit-core `phase::*`) to a badge. */
export function phaseStatus(phase: number): BadgeStatus {
  return (["idle", "open", "settling", "waiting_funds", "ended", "refunded", "awaiting_owner"] as const)[phase] ?? "idle";
}

/** Ledger entry status text (ENTRY_STATUS_NAMES) to a badge. */
export function entryStatus(status: string, paid: boolean): BadgeStatus {
  if (paid) return "paid";
  if (status === "Verified") return "verified";
  if (status === "Verifying") return "verifying";
  if (status === "Inconclusive") return "inconclusive";
  if (status === "Revoked") return "revoked";
  return "failed";
}

export function StatusBadge({ status, className }: { status: BadgeStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap",
        styles[status],
        className,
      )}
    >
      {status === "paid" || status === "verified" ? <Check className="size-3" aria-hidden="true" /> : null}
      {labels[status]}
    </span>
  );
}
