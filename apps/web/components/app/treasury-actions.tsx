"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Notice } from "@/components/ui-kit";
import { ConfirmDialog } from "@/components/ui-kit/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordChainEvent } from "@/lib/client/chain-event";
import { useOwnerWallet } from "@/lib/client/owner-wallet";
import { sendInstruction } from "@/lib/client/wallet";
import { unhex } from "@/lib/merit/codec";
import { formatRlo, parseRlo } from "@/lib/merit/constants";
import { ix } from "@/lib/merit/instructions";
import { UnlockWallet } from "./owner-sign-in";

type Kind = "fund" | "withdraw" | "fundOps" | "withdrawOps";
const LABEL: Record<Kind, string> = { fund: "Add to escrow", withdraw: "Withdraw from escrow", fundOps: "Add to operations budget", withdrawOps: "Withdraw operations budget" };

/** Add funds and withdraw what the program allows, signed in this browser; each move lands in the audit log. */
export function TreasuryActions({ programId, owner, slugHex, unreserved, opsWithdrawable, ended }: { programId: string; owner: string; slugHex: string; unreserved: string; opsWithdrawable: string; ended: boolean }) {
  const router = useRouter();
  const { keypair } = useOwnerWallet();
  const [amounts, setAmounts] = useState<Record<Kind, string>>({ fund: "", withdraw: "", fundOps: "", withdrawOps: "" });
  const [confirm, setConfirm] = useState<{ kind: Kind; kelvin: bigint } | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!keypair) return <UnlockWallet owner={owner} purpose="Your wallet signs fund and withdraw transactions in this browser." />;
  const slug = unhex(slugHex);
  const max: Partial<Record<Kind, bigint>> = { withdraw: BigInt(unreserved), withdrawOps: BigInt(opsWithdrawable) };

  function ask(kind: Kind) {
    setError(null);
    try {
      const kelvin = parseRlo(amounts[kind]);
      if (kelvin <= 0n) throw new Error("Enter an amount above zero.");
      if (max[kind] !== undefined && kelvin > max[kind]!) throw new Error(`At most ${formatRlo(max[kind]!, 4)} RLO can be withdrawn now.`);
      setConfirm({ kind, kelvin });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function run(kind: Kind, kelvin: bigint) {
    setBusy(kind);
    try {
      const instruction = { fund: ix.fund, withdraw: ix.withdraw, fundOps: ix.fundOps, withdrawOps: ix.withdrawOps }[kind](owner, slug, kelvin);
      const { signature } = await sendInstruction(keypair!, instruction);
      await recordChainEvent(programId, signature);
      toast.success(`${LABEL[kind]}: ${formatRlo(kelvin, 4)} RLO`);
      setAmounts((a) => ({ ...a, [kind]: "" }));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4" data-testid="treasury-actions">
      <div className="grid gap-4 sm:grid-cols-2">
        {(["fund", "withdraw", "fundOps", "withdrawOps"] as Kind[]).map((k) => (
          <div key={k} className="grid content-start gap-1.5">
            <Label htmlFor={`t-${k}`}>{LABEL[k]} (RLO)</Label>
            <div className="flex gap-2">
              <Input id={`t-${k}`} inputMode="decimal" className="max-w-36 font-mono tabular-nums" value={amounts[k]} onChange={(e) => setAmounts((a) => ({ ...a, [k]: e.target.value }))} />
              <Button size="sm" variant={k.startsWith("fund") ? "default" : "outline"} disabled={!!busy || (k.startsWith("fund") && ended) || !amounts[k]} onClick={() => ask(k)}>
                {busy === k ? "Signing…" : k.startsWith("fund") ? "Add" : "Withdraw"}
              </Button>
            </div>
            {max[k] !== undefined ? <p className="text-muted-foreground text-xs">Up to {formatRlo(max[k]!, 4)} RLO now.</p> : null}
          </div>
        ))}
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? `${LABEL[confirm.kind]}?` : ""}
        description={confirm?.kind === "fund" ? "If a round is waiting for funds, settlement resumes right away." : confirm?.kind.startsWith("withdraw") ? "The program only releases what no open round or settlement needs." : undefined}
        rows={confirm ? [{ label: "Amount", value: `${formatRlo(confirm.kelvin, 4)} RLO`, mono: true }] : []}
        confirmLabel={confirm?.kind.startsWith("fund") ? "Add funds" : "Withdraw"}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c) void run(c.kind, c.kelvin);
        }}
      />
    </div>
  );
}
