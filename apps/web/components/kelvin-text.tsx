"use client";

import { Fragment } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRlo } from "@/lib/merit/constants";

// Program log lines carry raw kelvin ("withdrew 942000000 kelvin", "(escrow 200000000)",
// "budget 65289520 left"). Shown as RLO; the exact kelvin value is in the tooltip.
const KELVIN = /(\d+) kelvin\b|\b(escrow|budget) (\d+)/g;

export function KelvinText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(KELVIN)) {
    const index = match.index ?? 0;
    parts.push(text.slice(last, index));
    const raw = match[1] ?? match[3];
    const prefix = match[2] ? `${match[2]} ` : "";
    parts.push(
      <Fragment key={index}>
        {prefix}
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="font-mono tabular-nums underline decoration-dotted underline-offset-4">
              {formatRlo(BigInt(raw))} RLO
            </span>
          </TooltipTrigger>
          <TooltipContent className="font-mono">{BigInt(raw).toLocaleString("en-US")} kelvin</TooltipContent>
        </Tooltip>
      </Fragment>,
    );
    last = index + match[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
