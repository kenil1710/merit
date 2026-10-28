import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { PageHeader, Section } from "@/components/ui-kit";
import { getDb } from "@/lib/db";
import { perfectPayout, rlo } from "@/lib/program-math";
import { joinablePrograms } from "@/lib/server/contributors";
import { PageSkeleton } from "@/components/ui-kit/skeletons";
import { namedCampaigns } from "@/lib/server/live-campaigns";
import { JoinFlow } from "./JoinFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contribute" };

export default async function JoinPage() {
  const [{ campaigns }, programs] = await Promise.all([
    namedCampaigns(),
    getDb()
      .then(joinablePrograms)
      .catch(() => []),
  ]);
  // Every running campaign, open or between rounds: a campaign that is paying out says when its next round opens.
  const live = campaigns
    .filter(({ status }) => status.state !== "ended" && status.state !== "idle")
    .map(({ state, meta, status }) => ({
      address: state.address,
      name: meta.name,
      brief: meta.brief,
      roundEndMs: Number(state.roundEndMs),
      round: Number(state.round),
      minScore: Number(state.minScore),
      rateKelvin: state.rateKelvin.toString(),
      state: status.state,
      takesSubmissions: status.takesSubmissions,
      nextOpensAtMs: status.nextOpensAt?.getTime() ?? null,
      statusText: status.text,
    }));
  return (
    <div className="grid gap-8">
      <PageHeader
        title={<>Contribute and get <em>paid</em></>}
        description="Sign in with X, keep a Rialo wallet in this browser, and submit a post. The judge scores it; if it passes, validators verify it and the round pays you automatically when it ends."
      />
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
      ) : null}
      <Suspense fallback={<PageSkeleton stats={0} rows={4} />}>
        <JoinFlow campaigns={live} />
      </Suspense>
    </div>
  );
}
