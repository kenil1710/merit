import { cn } from "@/lib/utils";

/** Merit's mark: a rounded hexagon holding a check stroke. Pure SVG, inherits currentColor. */
export const HEX_PATH =
  "M12 2.6c.5 0 1 .13 1.45.39l6.4 3.7A2.9 2.9 0 0 1 21.3 9.2v5.6a2.9 2.9 0 0 1-1.45 2.51l-6.4 3.7a2.9 2.9 0 0 1-2.9 0l-6.4-3.7A2.9 2.9 0 0 1 2.7 14.8V9.2a2.9 2.9 0 0 1 1.45-2.51l6.4-3.7c.45-.26.95-.39 1.45-.39Z";
export const CHECK_PATH = "M8.2 12.3l2.55 2.55L15.9 9.6";

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-5", className)} fill="none">
      <path d={HEX_PATH} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d={CHECK_PATH} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Mark className="text-foreground size-[22px]" />
      <span className="font-heading text-[1.3125rem] leading-none font-semibold tracking-[-0.02em]">Merit</span>
    </span>
  );
}
