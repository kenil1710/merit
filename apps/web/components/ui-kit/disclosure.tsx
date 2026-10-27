"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A titled section that opens and closes smoothly: our chevron instead of the native triangle, height animated
 * with a grid-rows transition (no measuring), and the content stays in the DOM for search and screen readers.
 */
export function Disclosure({
  title,
  defaultOpen = false,
  children,
  className,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="hover:text-foreground focus-visible:ring-ring/50 -mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between gap-3 rounded-md px-1 py-1 text-left text-sm font-medium outline-none focus-visible:ring-[3px]"
      >
        {title}
        <ChevronDown
          aria-hidden="true"
          strokeWidth={1.75}
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      <div
        id={id}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
