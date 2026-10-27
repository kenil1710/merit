"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { FocusHeader, FocusMain } from "@/components/app/focus-frame";
import { Skeleton } from "@/components/ui/skeleton";
import { STEP_META, STEPS } from "./wizard-steps";

const ProgramWizard = lazy(() => import("./wizard").then((m) => ({ default: m.ProgramWizard })));

/**
 * The wizard restores a draft saved on this device on its first render, so it renders in the browser only. Until
 * then the server paints the same frame with the requested step's headline, so nothing jumps.
 */
export function WizardLoader({ step, owner, host }: { step: number; owner: string; host: string }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const first = <FirstPaint step={step} />;
  if (!hydrated) return first;
  return (
    <Suspense fallback={first}>
      <ProgramWizard owner={owner} host={host} />
    </Suspense>
  );
}

function FirstPaint({ step }: { step: number }) {
  const meta = STEP_META[step]!;
  return (
    <>
      <FocusHeader />
      <FocusMain>
        <div className="grid items-start gap-12 pt-8 sm:pt-12 lg:grid-cols-[minmax(0,640px)_minmax(0,1fr)] xl:gap-20">
          <div className="min-w-0" aria-busy="true">
            <p className="text-brand text-sm font-medium">
              Step {step + 1} of {STEPS.length}
              <span className="text-muted-foreground font-normal"> · {STEPS[step]}</span>
            </p>
            <h1 className="display mt-2 text-[2.5rem] leading-[1.05] sm:text-[3.25rem]">{meta.title}</h1>
            <p className="text-soft mt-3 max-w-[56ch] text-[15px] leading-relaxed">{meta.intro}</p>
            <div className="mt-8 grid gap-6">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-28" />
            </div>
          </div>
          <Skeleton className="hidden h-[420px] rounded-[1.25rem] lg:block" />
        </div>
      </FocusMain>
    </>
  );
}
