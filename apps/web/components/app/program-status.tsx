import { cn } from "@/lib/utils";

const STYLES = {
  draft: ["Draft", "bg-muted text-muted-foreground"],
  active: ["Live", "bg-success-subtle text-success"],
  paused: ["Paused", "bg-warning-subtle text-warning"],
  archived: ["Ended", "bg-muted text-muted-foreground"],
} as const;

export function ProgramStatus({ status, ended, className }: { status: keyof typeof STYLES; ended?: boolean; className?: string }) {
  const [label, style] = ended ? STYLES.archived : STYLES[status];
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-xs font-medium whitespace-nowrap", style, className)}>{label}</span>;
}
