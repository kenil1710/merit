import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader, Section } from "@/components/ui-kit";
import { WalletStrip } from "@/components/wallet/wallet-strip";
import { getDb } from "@/lib/db";
import { perfectPayout, rlo } from "@/lib/program-math";
import { joinablePrograms } from "@/lib/server/contributors";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contribute" };

// The directory of programs. Joining and submitting happen on each program's own page, /join/<slug>, so every
// submission goes through the agent's eligibility, rules, duplicate and injection checks.
export default async function JoinPage() {
  const programs = await getDb()
    .then(joinablePrograms)
    .catch(() => []);
  return (
    <div className="grid gap-8">
      <PageHeader
        title={<>Contribute and get <em>paid</em></>}
        description="Pick a program, sign in with X and join with a Rialo wallet in this browser. Then submit a post: the agent judges it, validators verify it, and the round pays you automatically when it ends."
      />
      <section aria-label="Your wallet" className="grid gap-2">
        <WalletStrip />
        <p className="text-muted-foreground px-1 text-xs">Payouts go to this wallet. You can create it here or while joining a program; it never leaves this browser.</p>
      </section>
      {programs.length ? (
        <Section title="Programs taking contributors" description="Open one to see what it pays for and join in two steps.">
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="joinable">
            {programs.map((p) => (
              <li key={p.id}>
                <Link href={`/join/${p.slug}`} className="bg-card shadow-soft hover:shadow-lift group grid gap-2 rounded-[1.25rem] p-5 transition-shadow">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-soft line-clamp-2 text-sm">{p.description}</span>
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                    Up to {rlo(p.rubricJson.categories.reduce((m, c) => (perfectPayout(c.maxPoints, p.ratePerPoint) > m ? perfectPayout(c.maxPoints, p.ratePerPoint) : m), 0n))} per post
                    <ArrowRight className="size-3" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : (
        <EmptyState art="link" title="No programs right now" action={{ label: "Explore past programs", href: "/explore" }}>
          No program is taking contributors at the moment. Check back soon.
        </EmptyState>
      )}
    </div>
  );
}
