"use client";

import { Plus, Wallet } from "lucide-react";
import { FaucetButton } from "@/components/faucet-button";
import { shortHex } from "@/components/hex-value";
import { Button } from "@/components/ui/button";
import { useBalance, useSavedAddress } from "@/lib/client/use-wallet";
import { openWalletPanel } from "@/lib/client/wallet";
import { formatRlo } from "@/lib/merit/constants";
import { cn } from "@/lib/utils";

/**
 * The browser wallet in one line, for pages that spend or receive RLO (/join, the owner dashboard, the wizard):
 * address, balance and the faucet, with "Manage" opening the wallet panel. Without a wallet it offers to create one.
 */
export function WalletStrip({ className }: { className?: string }) {
  const address = useSavedAddress();
  const { balance, afterFaucet } = useBalance(address);
  return (
    <div className={cn("bg-card shadow-soft flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl px-4 py-3 text-sm", className)} data-testid="wallet-strip">
      <span className="inline-flex min-w-0 items-center gap-2.5">
        <Wallet className="text-brand size-4 shrink-0" strokeWidth={1.5} />
        {address ? (
          <span className="min-w-0">
            <span className="text-muted-foreground block text-xs">Wallet in this browser</span>
            <span className="font-mono text-[13px]">{shortHex(address, 6, 4)}</span>
          </span>
        ) : (
          <span className="text-soft">No wallet in this browser yet.</span>
        )}
      </span>
      {address ? (
        <>
          <span>
            <span className="text-muted-foreground block text-xs">Balance</span>
            <span className="mono-num font-medium" data-testid="strip-balance">
              {balance === null ? "…" : `${formatRlo(balance)} RLO`}
            </span>
          </span>
          <FaucetButton address={address} size="sm" onFunded={afterFaucet} />
          <Button variant="ghost" size="sm" className="ml-auto" onClick={openWalletPanel}>
            Manage wallet
          </Button>
        </>
      ) : (
        <Button size="sm" className="ml-auto" onClick={openWalletPanel}>
          <Plus className="size-3.5" /> Create wallet
        </Button>
      )}
    </div>
  );
}
