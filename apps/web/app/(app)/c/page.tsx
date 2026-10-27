import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ProgramStatus } from "@/components/app/program-status";
import { EmptyState, PageHeader } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { joinedPrograms } from "@/lib/server/contributors";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Programs you joined" };

/** The contributor's home: every program they joined, with what's approved, waiting and rejected there. */
export default async function ContributorHome() {
  const session = await getSession();
  if (!session) {
    return (
      <div className="grid gap-8">
        <PageHeader title="Programs you joined" description="Sign in with X to see the programs you joined and your submissions." />
        <EmptyState art="link" title="Not signed in" action={{ label: "Find a program", href: "/join" }}>
          Open a program&apos;s join link and sign in with X there.
        </EmptyState>
      </div>
    );
  }
  const joined = await joinedPrograms(await getDb(), session.xUserId);
  return (
    <div className="grid gap-8">
      <PageHeader title={<>Your <em>programs</em></>} description={`Signed in with X as @${session.username}.`} />
      {joined.length === 0 ? (
        <EmptyState art="link" title="No programs yet" action={{ label: "Find a program", href: "/join" }}>
          Open a program&apos;s join link to join it.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="joined">
          {joined.map((j) => (
            <li key={j.contributor.id}>
              <Link href={`/c/${j.program.slug}`} className="bg-card shadow-soft hover:shadow-lift group grid gap-4 rounded-[1.25rem] p-5 transition-shadow">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate font-medium">{j.program.name}</p>
                  <ProgramStatus status={j.program.status} ended={!!j.program.endedAt} />
                </div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  {(
                    [
                      ["Approved", j.approved],
                      ["With team", j.review],
                      ["Rejected", j.rejected],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <dt className="label">{k}</dt>
                      <dd className="display mt-1 text-xl tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
                <span className="text-muted-foreground group-hover:text-foreground inline-flex items-center gap-1 text-sm">
                  Your contributions <ArrowRight className="size-3.5" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Button asChild variant="ghost" className="w-fit">
        <Link href="/join">Find more programs</Link>
      </Button>
    </div>
  );
}
