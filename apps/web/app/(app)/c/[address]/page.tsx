import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { CampaignRecord } from "@/components/campaign/campaign-record";
import { getDb, schema } from "@/lib/db";
import { isAddress } from "@/lib/server/agent";
import { campaignView } from "@/lib/server/campaign-view";
import { ContributorProgram } from "./contributor-program";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { address } = await params;
  return { title: isAddress(address) ? `Campaign ${address.slice(0, 6)}…` : "Your contributions" };
}

/**
 * /c/<campaign address> is a campaign's public record (a program's moves to /p/<slug>); /c/<program slug> is a
 * contributor's view of a program they joined (Misthos' /c/[slug]).
 */
export default async function CampaignPage({ params }: Params) {
  const { address } = await params;
  if (!isAddress(address)) return <ContributorProgram slug={address} />;
  const [program] = await (await getDb()).select({ slug: schema.programs.slug, status: schema.programs.status }).from(schema.programs).where(eq(schema.programs.campaignAddress, address)).limit(1);
  if (program && program.status !== "draft") redirect(`/p/${program.slug}`);
  const view = await campaignView(address);
  if (!view) notFound();
  return <CampaignRecord view={view} />;
}
