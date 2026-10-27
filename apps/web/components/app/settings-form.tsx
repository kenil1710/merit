"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Notice } from "@/components/ui-kit";
import { ConfirmDialog } from "@/components/ui-kit/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { recordChainEvent } from "@/lib/client/chain-event";
import { useOwnerWallet } from "@/lib/client/owner-wallet";
import { sendInstruction } from "@/lib/client/wallet";
import { unhex } from "@/lib/merit/codec";
import { ix } from "@/lib/merit/instructions";
import { UnlockWallet } from "./owner-sign-in";

export type SettingsValues = {
  name: string;
  description: string;
  joiningPaused: boolean;
  minAccountAgeDays: number;
  minXFollowers: number;
  belowMinimum: "review" | "reject" | "block";
  maxSubmissionsPerRound: number;
};

/** The join page and submission rules (database), saved with an audit entry of what changed. */
export function SettingsForm({ programId, initial, canEdit }: { programId: string; initial: SettingsValues; canEdit: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/owner/programs/${programId}/settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't save.");
      toast.success("Settings saved");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const num = (k: keyof SettingsValues) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: Number(e.target.value.replace(/\D/g, "") || "0") }));
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      data-testid="settings-form"
    >
      <fieldset disabled={!canEdit || busy} className="grid gap-4">
        <legend className="mb-1 font-medium">Join page</legend>
        <div className="grid gap-1.5">
          <Label htmlFor="s-name">Name</Label>
          <Input id="s-name" value={v.name} onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="s-desc">Description</Label>
          <Textarea id="s-desc" rows={3} value={v.description} onChange={(e) => setV((x) => ({ ...x, description: e.target.value }))} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-brand size-4" checked={v.joiningPaused} onChange={(e) => setV((x) => ({ ...x, joiningPaused: e.target.checked }))} />
          Pause joining (people who joined can still submit)
        </label>
      </fieldset>
      <fieldset disabled={!canEdit || busy} className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 font-medium">Submission rules</legend>
        <div className="grid gap-1.5">
          <Label htmlFor="s-age">Minimum X account age (days)</Label>
          <Input id="s-age" inputMode="numeric" value={v.minAccountAgeDays} onChange={num("minAccountAgeDays")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="s-followers">Minimum X followers</Label>
          <Input id="s-followers" inputMode="numeric" value={v.minXFollowers} onChange={num("minXFollowers")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="s-below">Below the minimums</Label>
          <select id="s-below" className="bg-background h-9 rounded-lg border px-2 text-sm" value={v.belowMinimum} onChange={(e) => setV((x) => ({ ...x, belowMinimum: e.target.value as SettingsValues["belowMinimum"] }))}>
            <option value="review">Their work goes to your review</option>
            <option value="reject">Their work is rejected</option>
            <option value="block">They can&apos;t join</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="s-max">Submissions per contributor per round</Label>
          <Input id="s-max" inputMode="numeric" value={v.maxSubmissionsPerRound} onChange={num("maxSubmissionsPerRound")} />
        </div>
      </fieldset>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {canEdit ? (
        <Button type="submit" className="w-fit" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
      ) : (
        <p className="text-muted-foreground text-sm">Only the owner can change settings.</p>
      )}
    </form>
  );
}

/** On-chain settings the owner signs: the next rounds' length, and ending the campaign. */
export function ChainSettings({ programId, owner, slugHex, roundMinutes, ended }: { programId: string; owner: string; slugHex: string; roundMinutes: number; ended: boolean }) {
  const router = useRouter();
  const { keypair } = useOwnerWallet();
  const [minutes, setMinutes] = useState(String(roundMinutes));
  const [busy, setBusy] = useState<"length" | "end" | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  if (!keypair) return <UnlockWallet owner={owner} purpose="Your wallet signs on-chain settings in this browser." />;
  const slug = unhex(slugHex);
  async function send(kind: "length" | "end") {
    setBusy(kind);
    try {
      const m = Number(minutes);
      if (kind === "length" && (!Number.isFinite(m) || m < 1 || m > 7 * 24 * 60)) throw new Error("A round is 1 minute to 7 days.");
      const { signature } = await sendInstruction(keypair!, kind === "length" ? ix.setRoundLength(owner, slug, BigInt(Math.round(m * 60_000))) : ix.end(owner, slug));
      await recordChainEvent(programId, signature);
      toast.success(kind === "length" ? `Rounds of ${m} min from the next round` : "Campaign ending: the open round settles, then it stops");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor="s-round">Round length (minutes)</Label>
        <div className="flex gap-2">
          <Input id="s-round" inputMode="numeric" className="max-w-32 font-mono" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          <Button size="sm" variant="outline" disabled={!!busy || ended || Number(minutes) === roundMinutes} onClick={() => void send("length")}>
            {busy === "length" ? "Signing…" : "Set"}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">Applies from the next round.</p>
      </div>
      <div className="grid gap-2 border-t pt-4">
        <p className="text-sm font-medium">End the campaign</p>
        <p className="text-muted-foreground text-xs">No new rounds. The open round still closes and pays verified work; then you can withdraw the rest.</p>
        <Button size="sm" variant="outline" className="text-danger w-fit" disabled={!!busy || ended} onClick={() => setConfirmEnd(true)}>
          {busy === "end" ? "Ending…" : ended ? "Ended" : "End campaign"}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="End the campaign?"
        description="This can't be undone: no new rounds open. Work already approved in the open round is still verified and paid."
        confirmLabel="End campaign"
        destructive
        onConfirm={() => {
          setConfirmEnd(false);
          void send("end");
        }}
      />
    </div>
  );
}
