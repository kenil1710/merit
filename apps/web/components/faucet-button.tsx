"use client";

import type { Keypair } from "@rialo/ts-cdk";
import { base58 } from "@scure/base";
import { Droplets } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { relayClient } from "@/lib/client/wallet";
import { FAUCET_MAX_KELVIN } from "@/lib/merit/constants";

type Status = { ok: boolean; reason: string | null; message: string | null; nextAt: string | null };

/** "Next faucet in 5 h" (or minutes under an hour). */
export function nextFaucetText(nextAt: string | null, now = Date.now()): string | null {
  if (!nextAt) return null;
  const ms = Date.parse(nextAt) - now;
  if (!(ms > 0)) return null;
  const min = Math.ceil(ms / 60_000);
  return min >= 60 ? `Next faucet in ${Math.ceil(min / 60)} h` : `Next faucet in ${min} min`;
}

/**
 * "Get 1 DevNet RLO", with the relay's limits shown before the click: once per wallet per day, a few per network
 * per day, and not for a wallet that already holds 1 RLO.
 */
export function FaucetButton({ keypair, disabled, onFunded, size = "default" }: { keypair: Keypair; disabled?: boolean; onFunded: () => Promise<void> | void; size?: "sm" | "default" }) {
  const wallet = keypair.publicKey.toString();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/faucet?wallet=${wallet}`, { cache: "no-store" });
      setStatus((await res.json()) as Status);
    } catch {
      setStatus(null);
    }
  }, [wallet]);
  useEffect(() => {
    void load();
  }, [load]);

  const blocked = status && !status.ok;
  const note = blocked ? (status.reason === "balance" ? "Holds 1 RLO already" : nextFaucetText(status.nextAt) ?? status.message) : "1 RLO per wallet per day";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size={size}
        className={size === "default" ? "h-10" : undefined}
        disabled={disabled || busy || Boolean(blocked)}
        onClick={async () => {
          setBusy(true);
          try {
            // DevNet can take well over the SDK's default few seconds to run an airdrop: wait up to a minute.
            const client = relayClient();
            const signature = await client.requestAirdrop(keypair.publicKey, FAUCET_MAX_KELVIN);
            await client.confirmTransaction(base58.encode(signature), { maxRetries: 60, retryDelayMs: 1000 });
            await onFunded();
            toast.success("1 DevNet RLO received");
          } catch (e) {
            toast.error((e as Error).message.replace(/^.*?: /, ""));
          } finally {
            setBusy(false);
            void load();
          }
        }}
      >
        <Droplets className="size-4" />
        {busy ? "Requesting…" : "Get 1 DevNet RLO"}
      </Button>
      <span className="text-muted-foreground text-xs" data-testid="faucet-note">
        {note}
      </span>
    </span>
  );
}
