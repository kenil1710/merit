import Link from "next/link";
import { HexValue } from "@/components/hex-value";
import { ChainSettings, SettingsForm } from "@/components/app/settings-form";
import { Card, PageHeader } from "@/components/ui-kit";
import { loadState } from "@/lib/merit/chain";
import { rpc } from "@/lib/server/agent";
import { memberProgram } from "@/lib/server/owner-page";
import { isEndedPhase } from "@/lib/shared/round-window";

export const metadata = { title: "Settings" };

/** Join page, submission rules and context (database), and the round schedule and ending (signed on chain). */
export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { program: p, role, context, base } = await memberProgram((await params).id);
  const state = p.campaignAddress ? await loadState(rpc, p.campaignAddress).catch(() => null) : null;
  return (
    <div className="grid gap-6">
      <PageHeader crumbs={[{ label: p.name, href: base }, { label: "Settings" }]} title="Settings" description="What contributors see, who may submit, and the campaign's schedule on chain." />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Program">
          <SettingsForm
            programId={p.id}
            canEdit={role === "owner"}
            initial={{ name: p.name, description: p.description, joiningPaused: p.joiningPaused, minAccountAgeDays: p.minAccountAgeDays, minXFollowers: p.minXFollowers, belowMinimum: p.belowMinimum, maxSubmissionsPerRound: p.maxSubmissionsPerRound }}
          />
        </Card>
        <div className="grid gap-6">
          <Card title="Campaign on chain" description="Signed by your wallet.">
            {state && role === "owner" && p.campaignSlugHex ? (
              <ChainSettings programId={p.id} owner={p.ownerWallet} slugHex={p.campaignSlugHex} roundMinutes={Math.round(Number(state.nextRoundLengthMs) / 60_000)} ended={isEndedPhase(state.phase) || state.ending} />
            ) : (
              <p className="text-muted-foreground text-sm">{state ? "Only the owner signs these." : "Available once the campaign is live."}</p>
            )}
            <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
              Pause, close the round now, and the on-chain limits (24-hour cap, your approval, cooldown, late grace) are on the{" "}
              <Link href={base} className="underline underline-offset-4">
                overview
              </Link>
              .
            </p>
          </Card>
          <Card title="Agent">
            <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
              <dt className="text-soft">Agent key</dt>
              <dd>{state ? <HexValue value={state.agent} label="agent" head={6} tail={4} /> : "—"}</dd>
              <dt className="text-soft">Context version</dt>
              <dd className="tabular-nums">{context?.version ?? "—"}</dd>
            </dl>
            {context?.about ? <p className="text-soft mt-3 line-clamp-4 text-sm leading-relaxed">{context.about}</p> : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
