"use client";

import { UnpluggedArt } from "@/components/brand/illustrations";
import { Button } from "@/components/ui/button";

/** Shown when a page fails to load. Says what happened and offers the one useful next step. */
export function ErrorPanel({ reset, what = "this page" }: { reset: () => void; what?: string }) {
  return (
    <div
      role="alert"
      className="bg-card shadow-soft grid items-center gap-6 rounded-[20px] p-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-10"
    >
      <UnpluggedArt className="size-24 sm:size-32" />
      <div>
        <h1 className="display text-[2rem] leading-tight sm:text-[2.5rem]">
          Couldn&apos;t load {what}
        </h1>
        <p className="text-soft mt-2 max-w-lg text-sm leading-relaxed">
          Merit couldn&apos;t reach Rialo DevNet or a Latch latch just now. Nothing was signed or
          sent. It usually works again within a few seconds.
        </p>
        <Button className="mt-5" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
