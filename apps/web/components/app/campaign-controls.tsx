"use client";

import { Pause, Play, ShieldCheck, TimerOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Notice } from "@/components/ui-kit";
import { ConfirmDialog } from "@/components/ui-kit/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOwnerWallet } from "@/lib/client/owner-wallet";
import { recordChainEvent } from "@/lib/client/chain-event";
import { sendInstruction } from "@/lib/client/wallet";
import { unhex } from "@/lib/merit/codec";
import { formatRlo, parseRlo } from "@/lib/merit/constants";
import { ix, type PlainInstruction } from "@/lib/merit/instructions";
import { UnlockWallet } from "./owner-sign-in";

/** What the controls need from the campaign's on-chain state (strings: it crosses to the client). */
export type ControlsState = {
  version: 1 | 2;
  phase: number;
  paused: boolean;
  round: number;
  roundEndMs: number;
  maxPerDay: string;
  approvalThreshold: string;
  cooldownMs: string;
  submitGraceMs: string;
  capPerPayout: string;
  /** What the round waiting for approval would pay. */
  roundDue: string;
};

type Action = "pause" | "unpause" | "close" | "approve-round" | "limits";

/**
 * The owner's program v2 controls, signed in this browser: pause and resume approvals and payouts, close the open
 * round now, let a round above the approval threshold pay out, and the limits the program enforces on chain.
 */
export function CampaignControls({ programId, owner, slugHex, state }: { programId: string; owner: string; slugHex: string; state: ControlsState }) {
  const router = useRouter();
  const { keypair } = useOwnerWallet();
  const [busy, setBusy] = useState<Action | null>(null);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limits, setLimits] = useState({
    maxPerDay: state.maxPerDay === "0" ? "" : formatRlo(BigInt(state.maxPerDay), 4),
    approvalThreshold: state.approvalThreshold === "0" ? "" : formatRlo(BigInt(state.approvalThreshold), 4),
    cooldownHours: String(Number(state.cooldownMs) / 3_600_000),
    graceMinutes: String(Number(state.submitGraceMs) / 60_000),
  });

  if (state.version < 2) {
    return <Notice tone="info">This campaign runs on program v1: pause, close round now, on-chain limits and owner approval need a campaign created on program v2.</Notice>;
  }
  if (!keypair) return <UnlockWallet owner={owner} purpose="Your wallet signs these controls in this browser." />;

  const slug = unhex(slugHex);
  const done = state.phase >= 4;
  async function send(action: Action, instruction: PlainInstruction, message: string) {
    setBusy(action);
    setError(null);
    try {
      const { signature } = await sendInstruction(keypair!, instruction);
      await recordChainEvent(programId, signature);
      toast.success(message);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  function saveLimits() {
    try {
      const l = {
        maxPerDay: limits.maxPerDay.trim() ? parseRlo(limits.maxPerDay) : 0n,
        approvalThreshold: limits.approvalThreshold.trim() ? parseRlo(limits.approvalThreshold) : 0n,
        cooldownMs: BigInt(Math.round(Number(limits.cooldownHours || "0") * 3_600_000)),
        submitGraceMs: BigInt(Math.round(Number(limits.graceMinutes || "0") * 60_000)),
      };
      if (l.maxPerDay > 0n && l.maxPerDay < BigInt(state.capPerPayout)) throw new Error(`The daily cap must be at least one payout (${formatRlo(BigInt(state.capPerPayout), 4)} RLO), or empty for none.`);
      if (l.cooldownMs < 0n || l.cooldownMs > 30n * 86_400_000n) throw new Error("The cooldown is 0 to 720 hours.");
      if (l.submitGraceMs < 0n || l.submitGraceMs > 3_600_000n) throw new Error("The grace is 0 to 60 minutes.");
      void send("limits", ix.setLimits(owner, slug, l), "Limits saved on chain");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="grid gap-5" data-testid="campaign-controls">
      {state.paused ? <Notice tone="warning">Paused: the agent can&apos;t approve anything and nothing is paid. The round clock keeps running; a closed round waits to settle until you resume.</Notice> : null}
      {state.phase === 6 ? (
        <Notice tone="warning">
          Round {state.round} would pay {formatRlo(BigInt(state.roundDue), 4)} RLO, above your approval threshold. It waits for you.
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {state.paused ? (
          <Button size="sm" disabled={!!busy || done} onClick={() => void send("unpause", ix.unpause(owner, slug), "Resumed")}>
            <Play className="size-4" /> {busy === "unpause" ? "Resuming…" : "Resume"}
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={!!busy || done} onClick={() => setConfirm("pause")}>
            <Pause className="size-4" /> Pause
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={!!busy || state.phase !== 1 || Date.now() >= state.roundEndMs} onClick={() => setConfirm("close")}>
          <TimerOff className="size-4" /> {busy === "close" ? "Closing…" : "Close round now"}
        </Button>
        {state.phase === 6 ? (
          <Button size="sm" disabled={!!busy} onClick={() => setConfirm("approve-round")}>
            <ShieldCheck className="size-4" /> {busy === "approve-round" ? "Approving…" : `Approve round ${state.round} payout`}
          </Button>
        ) : null}
      </div>

      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          saveLimits();
        }}
        aria-label="Limits enforced on chain"
      >
        <Field id="lim-day" label="Max paid per 24 hours (RLO)" hint="Rolling, by the hour. Empty: no daily cap." value={limits.maxPerDay} onChange={(v) => setLimits((l) => ({ ...l, maxPerDay: v }))} />
        <Field id="lim-threshold" label="Your approval above (RLO per round)" hint="A round paying more waits for you. Empty: never." value={limits.approvalThreshold} onChange={(v) => setLimits((l) => ({ ...l, approvalThreshold: v }))} />
        <Field id="lim-cooldown" label="New-wallet cooldown (hours)" hint="A wallet registered or changed this recently isn't paid yet." value={limits.cooldownHours} onChange={(v) => setLimits((l) => ({ ...l, cooldownHours: v }))} />
        <Field id="lim-grace" label="Late-submission grace (minutes)" hint="Work written in a round is still taken this long after it closes, before it pays (at most half a round)." value={limits.graceMinutes} onChange={(v) => setLimits((l) => ({ ...l, graceMinutes: v }))} />
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" variant="outline" disabled={!!busy || done}>
            {busy === "limits" ? "Saving on chain…" : "Save limits"}
          </Button>
        </div>
      </form>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "pause" ? "Pause the campaign?" : confirm === "close" ? `Close round ${state.round} now?` : `Let round ${state.round} pay out?`}
        description={
          confirm === "pause"
            ? "The agent stops approving and nothing is paid until you resume. Contributors can't submit meanwhile."
            : confirm === "close"
              ? "The round closes now instead of at its scheduled time. Late work is still taken during the grace, then it settles and the next round opens on its own."
              : "Settlement continues and pays the verified work in approval order, within every cap."
        }
        rows={confirm === "approve-round" ? [{ label: "Round total", value: `${formatRlo(BigInt(state.roundDue), 4)} RLO` }] : []}
        confirmLabel={confirm === "pause" ? "Pause" : confirm === "close" ? "Close round" : "Approve payout"}
        destructive={confirm === "close"}
        onConfirm={() => {
          const a = confirm;
          setConfirm(null);
          if (a === "pause") void send("pause", ix.pause(owner, slug), "Paused");
          if (a === "close") void send("close", ix.closeRound(owner, slug), `Round ${state.round} closed`);
          if (a === "approve-round") void send("approve-round", ix.approveRound(owner, slug), `Round ${state.round} approved for payout`);
        }}
      />
    </div>
  );
}

function Field({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode="decimal" className="max-w-44 font-mono tabular-nums" value={value} onChange={(e) => onChange(e.target.value)} />
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}
