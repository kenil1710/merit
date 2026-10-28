"use client";

import type { Keypair } from "@rialo/ts-cdk";
import { KeyRound, Lock, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { HexValue } from "@/components/hex-value";
import { Card } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FaucetButton } from "@/components/faucet-button";
import { NewPassphraseFields } from "@/components/wallet/passphrase-fields";
import { useUnlockedWallet } from "@/lib/client/owner-wallet";
import { useBalance, useSavedAddress } from "@/lib/client/use-wallet";
import { createWallet, errorAfterEdit, lockWallet, newPassphraseError, openWalletPanel, unlockWallet } from "@/lib/client/wallet";
import { formatRlo } from "@/lib/merit/constants";

/** The embedded Rialo wallet: create, unlock, faucet. The key never leaves the browser. */
export function WalletPanel({ onChange, purpose }: { onChange: (keypair: Keypair | null) => void; purpose: string }) {
  const address = useSavedAddress();
  const unlocked = useUnlockedWallet();
  const keypair = unlocked && unlocked.publicKey.toString() === address ? unlocked : null;
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const { balance, afterFaucet } = useBalance(address);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onChange(keypair), [keypair, onChange]);

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <Wallet className="text-brand size-4" strokeWidth={1.5} /> Rialo wallet
        </span>
      }
      description={purpose}
      actions={
        keypair ? (
          <Button variant="ghost" size="sm" onClick={() => void lockWallet()}>
            <Lock className="size-3.5" /> Lock
          </Button>
        ) : null
      }
    >
      <div className="grid gap-5" data-testid="wallet-panel">
        {address ? (
          <div className="bg-muted/50 grid gap-4 rounded-2xl p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="min-w-0">
              <p className="label">Address</p>
              <div className="mt-1.5"><HexValue value={address} label="wallet address" head={10} tail={8} /></div>
            </div>
            <div className="sm:text-right">
              <p className="label">Balance</p>
              <p className="display mt-1 text-3xl leading-none tabular-nums">
                {balance === null ? "…" : formatRlo(balance)}
                <span className="text-muted-foreground ml-1 font-sans text-xs">RLO</span>
              </p>
            </div>
          </div>
        ) : null}

        {!keypair ? (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const invalid = address ? null : newPassphraseError(passphrase, confirm);
              if (invalid) return setError(invalid);
              void run(address ? "Unlocking…" : "Creating…", async () => {
                await (address ? unlockWallet(passphrase) : createWallet(passphrase, confirm));
                setPassphrase("");
                setConfirm("");
              });
            }}
          >
            {address ? (
              <>
                <Label htmlFor="wallet-passphrase">Passphrase</Label>
                <Input
                  id="wallet-passphrase"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Passphrase to unlock"
                  value={passphrase}
                  onChange={(e) => {
                    setPassphrase(e.target.value);
                    setError((err) => errorAfterEdit(err, e.target.value, false));
                  }}
                  className="h-10"
                />
              </>
            ) : (
              <NewPassphraseFields id="wallet-passphrase" value={passphrase} confirm={confirm} onChange={setPassphrase} onConfirmChange={setConfirm} />
            )}
            <Button type="submit" className="h-10 w-fit px-4" disabled={!passphrase || (!address && !confirm) || Boolean(busy)}>
              <KeyRound className="size-4" />
              {busy ?? (address ? "Unlock" : "Create wallet")}
            </Button>
          </form>
        ) : (
          <FaucetButton address={keypair.publicKey.toString()} disabled={Boolean(busy)} onFunded={afterFaucet} />
        )}

        {address ? (
          <button type="button" className="text-muted-foreground hover:text-foreground w-fit text-xs underline underline-offset-4" onClick={openWalletPanel}>
            Backup, import or forget this wallet
          </button>
        ) : null}
        {error ? <p className="text-danger text-sm">{error}</p> : null}
        <p className="text-muted-foreground text-xs leading-relaxed">
          Generated and encrypted in this browser (PBKDF2 → AES-GCM) and never sent anywhere. DevNet only: RLO here has no value.
        </p>
      </div>
    </Card>
  );
}
