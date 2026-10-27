import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { PageHeader, Section } from "@/components/ui-kit";
import { getDb } from "@/lib/db";
import { perfectPayout, rlo } from "@/lib/program-math";
import { joinablePrograms } from "@/lib/server/contributors";
import { PageSkeleton } from "@/components/ui-kit/skeletons";
import { RpcClient, listCampaigns } from "@/lib/merit/chain";
import { RPC_UPSTREAM } from "@/lib/merit/constants";
import { store } from "@/lib/server/store";
import { JoinFlow } from "./JoinFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contribute" };

export default async function JoinPage() {
  const [onChain, metas, programs] = await Promise.all([
    listCampaigns(new RpcClient(RPC_UPSTREAM)),
    store.campaigns(),
    getDb()
      .then(joinablePrograms)
      .catch(() => []),
  ]);
  const names = new Map(metas.map((m) => [m.address, m]));
  const open = onChain
    .filter((c) => c.phase === 1n && names.has(c.address))
    .map((c) => ({
      address: c.address,
      name: names.get(c.address)!.name,
      brief: names.get(c.address)!.brief,
      roundEndMs: Number(c.roundEndMs),
      round: Number(c.round),
      minScore: Number(c.minScore),
      rateKelvin: c.rateKelvin.toString(),
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
        <JoinFlow campaigns={open} />
      </Suspense>
    </div>
  );
}
