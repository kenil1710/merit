import { notFound } from "next/navigation";
import { z } from "zod";
import { FocusHeader, FocusMain } from "@/components/app/focus-frame";
import { DevNetBadge } from "@/components/app/owner-shell";
import { CoinsArt } from "@/components/brand/illustrations";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { rlo } from "@/lib/program-math";
import { getProgramForMember } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";
import { SetupFlow } from "./setup-flow";
import Link from "next/link";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const session = await getOwnerSession();
  const id = (await params).id;
  const found = session && z.uuid().safeParse(id).success ? await getProgramForMember(await getDb(), id, session.sub) : null;
  return { title: found ? `Set up ${found.program.name}` : "Set up" };
}

/** Go live, resumable: the stepper reads where the program stands on chain and signs what's left. */
export default async function SetupPage({ params }: Props) {
  const session = await getOwnerSession();
  if (!session) return null;
  const id = (await params).id;
  if (!z.uuid().safeParse(id).success) notFound();
  const found = await getProgramForMember(await getDb(), id, session.sub);
  if (!found) notFound();
  const { program: p } = found;
  return (
    <>
      <FocusHeader
        status={<DevNetBadge />}
        progress={<span className="text-muted-foreground truncate text-xs sm:text-sm">{p.name} · Go live</span>}
        exit={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/app/programs/${p.id}`}>Go to overview</Link>
          </Button>
        }
      />
      <FocusMain>
        <section aria-labelledby="setup-h" className="bg-card shadow-lift relative mx-auto mt-8 grid max-w-[760px] gap-6 overflow-hidden rounded-[1.5rem] p-6 sm:mt-12 sm:p-10">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="text-brand text-sm font-medium">{p.status === "draft" ? "Draft saved" : "Live"}</p>
              <h1 id="setup-h" className="display mt-2 text-[2.25rem] leading-[1.05] sm:text-[3rem]">
                Go <em>live</em> on Rialo
              </h1>
            </div>
            <CoinsArt className="hidden size-24 shrink-0 sm:block" />
          </div>
          <p className="text-soft -mt-2 max-w-[58ch] text-[15px] leading-relaxed">
            Your wallet signs the campaign onto Rialo DevNet with this program&apos;s rules, funds {rlo(p.plannedEscrow)} of escrow and {rlo(p.plannedOpsBudget)} for operations, and opens round 1. Contributors can submit once it&apos;s published.
          </p>
          <SetupFlow
            program={{
              id: p.id,
              name: p.name,
              description: p.description,
              owner: p.ownerWallet,
              plannedEscrow: p.plannedEscrow.toString(),
              plannedOps: p.plannedOpsBudget.toString(),
              firstRoundStartsAt: p.firstRoundStartsAt.toISOString(),
            }}
          />
        </section>
      </FocusMain>
    </>
  );
}
