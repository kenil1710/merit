import { roundBadgeText, type RoundState } from "@/lib/shared/round-window";
import { cn } from "@/lib/utils";

const TONE: Record<RoundState | "closed", string> = {
  open: "bg-brand-subtle text-brand-soft",
  grace: "bg-warning-subtle text-warning",
  settling: "bg-warning-subtle text-warning",
  waiting_funds: "bg-warning-subtle text-warning",
  awaiting_owner: "bg-warning-subtle text-warning",
  paused: "bg-warning-subtle text-warning",
  idle: "bg-muted text-muted-foreground",
  ended: "bg-muted text-muted-foreground",
  closed: "bg-muted text-muted-foreground",
};

/** A round's status with the shared labels (`roundLabel`): Open, Grace period, Settling or Closed. */
export function RoundStatusPill({ status, owner = false }: { status: RoundState | "closed"; owner?: boolean }) {
  return <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium whitespace-nowrap", TONE[status])}>{roundBadgeText(status, owner)}</span>;
}
