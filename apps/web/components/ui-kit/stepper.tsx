import { Check, Minus, X } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StepStatus = "done" | "current" | "waiting" | "failed" | "skipped";

export interface Step {
  key: string;
  /** One line. */
  label: ReactNode;
  status: StepStatus;
  /** Short and right-aligned: a time, an amount, a countdown. */
  meta?: ReactNode;
  /** Shown under the label: evidence, a fix, a link. Keep it short. */
  detail?: ReactNode;
  /** What a screen reader hears after the label (defaults to the status: "done", "waiting", …). */
  statusLabel?: string;
  /** Shown inside the node when the step isn't done/failed (defaults to the step number). */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
}

const STATUS_LABEL: Record<StepStatus, string> = {
  done: "done",
  current: "in progress",
  waiting: "waiting",
  failed: "failed",
  skipped: "skipped",
};

function Node({ step, index, size }: { step: Step; index: number; size: "sm" | "md" }) {
  const Icon = step.icon;
  const dim = size === "sm" ? "size-6" : "size-8";
  const glyph = size === "sm" ? "size-3.5" : "size-4";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative z-10 flex shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums transition-colors duration-300",
        dim,
        step.status === "done" && "bg-brand text-primary-foreground",
        step.status === "current" && "bg-card text-brand ring-brand ring-2",
        step.status === "waiting" && "bg-muted text-muted-foreground",
        step.status === "failed" && "bg-danger text-background",
        step.status === "skipped" && "text-muted-foreground border border-dashed",
      )}
    >
      {step.status === "done" ? (
        <Check className={glyph} strokeWidth={2.5} />
      ) : step.status === "failed" ? (
        <X className={glyph} strokeWidth={2.5} />
      ) : step.status === "skipped" ? (
        <Minus className={glyph} strokeWidth={2} />
      ) : Icon ? (
        <Icon className={glyph} strokeWidth={1.75} />
      ) : (
        index + 1
      )}
      {step.status === "current" ? (
        <span className="bg-brand/25 absolute inset-0 animate-ping rounded-full [animation-duration:2.4s]" />
      ) : null}
    </span>
  );
}

/**
 * The one stepper / timeline used across Merit: a submission's journey, a round's lifecycle, setup progress,
 * verification checks, a contributor's milestones. One line per step; states are done, in progress (gently
 * pulsing), waiting, failed (with the reason under it) and skipped. Vertical by default; horizontal for short
 * lifecycles (scrolls sideways on small screens).
 */
export function Stepper({
  steps,
  orientation = "vertical",
  size = "md",
  className,
  label,
}: {
  steps: Step[];
  orientation?: "vertical" | "horizontal" | "responsive";
  size?: "sm" | "md";
  className?: string;
  /** Accessible name for the list, e.g. "Submission progress". */
  label?: string;
}) {
  // Horizontal steppers become vertical on phones, where six steps don't fit side by side.
  if (orientation === "responsive")
    return (
      <>
        <Stepper {...{ steps, size, label }} className={cn("sm:hidden", className)} />
        <Stepper
          {...{ steps, size, label }}
          orientation="horizontal"
          className={cn("hidden sm:flex", className)}
        />
      </>
    );
  if (orientation === "horizontal")
    return (
      <ol aria-label={label} className={cn("-mx-1 flex overflow-x-auto px-1 pb-1", className)}>
        {steps.map((s, i) => (
          <li
            key={s.key}
            className="relative flex min-w-[8.5rem] flex-1 flex-col items-start gap-2 pr-3"
            aria-current={s.status === "current" ? "step" : undefined}
          >
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-4 left-8 right-0 h-px",
                  s.status === "done" ? "bg-brand" : "bg-border",
                  size === "sm" && "top-3 left-6",
                )}
              />
            ) : null}
            <Node step={s} index={i} size={size} />
            <span className="grid gap-0.5">
              <span
                className={cn(
                  "text-sm leading-snug",
                  s.status === "waiting" || s.status === "skipped"
                    ? "text-muted-foreground"
                    : "text-foreground font-medium",
                )}
              >
                {s.label}
                <span className="sr-only"> ({s.statusLabel ?? STATUS_LABEL[s.status]})</span>
              </span>
              {s.meta ? <span className="text-muted-foreground text-xs">{s.meta}</span> : null}
              {s.detail ? <span className="text-xs">{s.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    );
  return (
    <ol aria-label={label} className={cn("grid", className)}>
      {steps.map((s, i) => (
        <li
          key={s.key}
          className="relative flex gap-3 pb-5 last:pb-0"
          aria-current={s.status === "current" ? "step" : undefined}
        >
          {i < steps.length - 1 ? (
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-8 bottom-0 left-4 w-px -translate-x-1/2",
                s.status === "done" ? "bg-brand" : "bg-border",
                size === "sm" && "top-6 left-3",
              )}
            />
          ) : null}
          <Node step={s} index={i} size={size} />
          <div className={cn("min-w-0 flex-1", size === "sm" ? "pt-0.5" : "pt-1.5")}>
            <div className="flex items-baseline justify-between gap-3">
              <span
                className={cn(
                  "text-sm leading-snug",
                  s.status === "waiting" || s.status === "skipped"
                    ? "text-muted-foreground"
                    : "text-foreground font-medium",
                  s.status === "failed" && "text-danger",
                )}
              >
                {s.label}
                <span className="sr-only"> ({s.statusLabel ?? STATUS_LABEL[s.status]})</span>
              </span>
              {s.meta ? (
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {s.meta}
                </span>
              ) : null}
            </div>
            {s.detail ? (
              <div className="text-soft mt-1 text-[13px] leading-relaxed">{s.detail}</div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
