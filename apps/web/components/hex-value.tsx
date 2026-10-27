"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const shortHex = (value: string, head = 6, tail = 4) =>
  value.length > head + tail + 1 ? `${value.slice(0, head)}…${tail ? value.slice(-tail) : ""}` : value;

/** Address, signature or hash: short form, full value on hover, a copy button, optional link. */
export function HexValue({ value, href, label, head, tail }: { value: string; href?: string; label: string; head?: number; tail?: number }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the full value is still in the tooltip */
    }
  }
  const short = shortHex(value, head, tail);
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[13px]">
      <Tooltip>
        <TooltipTrigger asChild>
          {href?.startsWith("/") ? (
            <Link href={href} className="hover:text-brand-soft underline-offset-4 hover:underline">
              {short}
            </Link>
          ) : (
            <span tabIndex={0}>{short}</span>
          )}
        </TooltipTrigger>
        <TooltipContent className="font-mono">{value}</TooltipContent>
      </Tooltip>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="text-muted-foreground hover:text-foreground -my-1 inline-flex size-6 items-center justify-center rounded transition-colors duration-150"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      {href && !href.startsWith("/") ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${label}`}
          className="text-muted-foreground hover:text-foreground -my-1 inline-flex size-6 items-center justify-center rounded transition-colors duration-150"
        >
          <ExternalLink className="size-3.5" />
        </a>
      ) : null}
    </span>
  );
}
