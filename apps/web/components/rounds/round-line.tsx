import { Countdown } from "@/components/countdown";
import { RoundBadge } from "@/components/status-badge";
import type { RoundState } from "@/lib/shared/round-window";

/**
 * A campaign's round in one chip: the shared label, its line from `roundStatus` and a countdown that ticks every
 * second (and refreshes the page at zero). /join, a program's join page and the contributor view all use it.
 */
export function RoundLine({ status }: { status: { state: RoundState; text: string; countdown: { toMs: number; prefix: string } | null } }) {
  return (
    <span className="bg-card shadow-soft inline-flex flex-wrap items-center gap-2 rounded-2xl px-3.5 py-1.5 text-sm" data-testid="round-line">
      <RoundBadge state={status.state} />
      <span>{status.text}</span>
      {status.countdown ? (
        <span className="text-muted-foreground tabular-nums">
          · <Countdown to={status.countdown.toMs} prefix={status.countdown.prefix} />
        </span>
      ) : null}
    </span>
  );
}

/** `roundStatus`'s Date countdown in the plain shape RoundLine takes. */
export const lineOf = (s: { state: RoundState; text: string; countdown: { to: Date; prefix: string } | null }) => ({
  state: s.state,
  text: s.text,
  countdown: s.countdown ? { toMs: s.countdown.to.getTime(), prefix: s.countdown.prefix } : null,
});
