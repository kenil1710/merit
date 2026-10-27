import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui-kit/stepper";
import { SETUP_STEPS, setupCurrent, setupSteps, type SetupState } from "@/lib/setup-flow";

/**
 * "Get your program live": the path from a draft to its first round as one track with a progress bar; the next step
 * sits under it with the way to do it. Gone once the program is live.
 */
export function SetupChecklist({ state, href }: { state: SetupState; href: string }) {
  const current = setupCurrent(state);
  if (current === "live") return null;
  const steps = setupSteps(state);
  const counted = steps.filter((s) => s.status !== "skipped");
  const done = counted.filter((s) => s.status === "done").length;
  const next = SETUP_STEPS.find((s) => s.key === current)!;
  return (
    <section aria-labelledby="setup-title" className="bg-card shadow-soft rounded-[1.25rem]" data-testid="setup-checklist">
      <div className="grid gap-5 p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h2 id="setup-title" className="display text-[1.75rem] leading-tight">
              Get your program live
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {done} of {counted.length} done. Next: {next.label.toLowerCase()}.
            </p>
          </div>
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full sm:w-56" role="progressbar" aria-valuemin={0} aria-valuemax={counted.length} aria-valuenow={done} aria-label="Setup progress">
            <div className="bg-brand h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(4, (done / counted.length) * 100)}%` }} />
          </div>
        </div>
        <Stepper orientation="responsive" size="sm" label="Setup steps" steps={steps.map((s) => ({ key: s.key, label: s.label, status: s.status }))} />
      </div>
      <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-b-[1.25rem] border-t px-5 py-5 sm:px-7">
        <p className="text-soft max-w-2xl text-sm leading-relaxed">
          Each step is signed by your wallet in this browser. Leave at any point: setup resumes from what the chain shows.
        </p>
        <Button asChild>
          <Link href={href}>
            Continue setup
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
