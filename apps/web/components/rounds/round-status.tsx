import type { RoundStatus } from "@/lib/server/program-pages";
import { cn } from "@/lib/utils";

const LABEL: Record<RoundStatus, [string, string]> = {
  open: ["Open", "bg-brand-subtle text-brand-soft"],
  grace: ["Closed · late work taken", "bg-warning-subtle text-warning"],
  settling: ["Settling", "bg-warning-subtle text-warning"],
  waiting_funds: ["Waiting for funds", "bg-warning-subtle text-warning"],
  awaiting_owner: ["Waiting for your approval", "bg-warning-subtle text-warning"],
  paused: ["Paused", "bg-warning-subtle text-warning"],
  settled: ["Settled", "bg-success-subtle text-success"],
};

export function RoundStatusPill({ status }: { status: RoundStatus }) {
  const [label, tone] = LABEL[status];
  return <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium whitespace-nowrap", tone)}>{label}</span>;
}
