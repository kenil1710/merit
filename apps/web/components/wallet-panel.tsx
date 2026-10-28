"use client";

import type { Keypair } from "@rialo/ts-cdk";
import { KeyRound, Lock, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { HexValue } from "@/components/hex-value";
import { Card } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FaucetButton } from "@/components/faucet-button";
import { createWallet, errorAfterEdit, forgetWallet, relayClient, savedAddress, unlockWallet } from "@/lib/client/wallet";
import { formatRlo } from "@/lib/merit/constants";

/** The embedded Rialo wallet: create, unlock, faucet. The key never leaves the browser. */
export function WalletPanel({ onChange, purpose }: { onChange: (keypair: Keypair | null) => void; purpose: string }) {
  const [address, setAddress] = useState<string | null>(null);
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setAddress(savedAddress()), []);

  const refresh = useCallback(async (addr: string) => {
    try {
      const { PublicKey } = await import("@rialo/ts-cdk");
      setBalance(await relayClient().getBalance(PublicKey.fromString(addr)));
    } catch {
      setBalance(null);
    }
  }, []);

  useEffect(() => {
    if (address) void refresh(address);
  }, [address, refresh]);

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

  const unlocked = (k: Keypair) => {
    setKeypair(k);
    setAddress(k.publicKey.toString());
    setPassphrase("");
    onChange(k);
  };

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
          <Button variant="ghost" size="sm" onClick={() => { setKeypair(null); onChange(null); }}>
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
              void run(address ? "Unlocking…" : "Creating…", async () => unlocked(address ? await unlockWallet(passphrase) : await createWallet(passphrase)));
            }}
          >
            <Label htmlFor="wallet-passphrase">{address ? "Passphrase" : "Choose a passphrase"}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="wallet-passphrase"
                type="password"
                autoComplete={address ? "current-password" : "new-password"}
                placeholder={address ? "Passphrase to unlock" : "New passphrase (8+ characters)"}
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  setError((err) => errorAfterEdit(err, e.target.value, !address));
                }}
                className="h-10"
              />
              <Button type="submit" className="h-10 px-4" disabled={!passphrase || Boolean(busy)}>
                <KeyRound className="size-4" />
                {busy ?? (address ? "Unlock" : "Create wallet")}
              </Button>
            </div>
          </form>
        ) : (
          <FaucetButton keypair={keypair} disabled={Boolean(busy)} onFunded={() => refresh(keypair.publicKey.toString())} />
        )}

        {address && !keypair ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground w-fit text-xs underline underline-offset-4"
            onClick={() => {
              if (window.confirm("Remove this wallet from the browser? Without it, any RLO in it is lost.")) {
                forgetWallet();
                setAddress(null);
              }
            }}
          >
            Remove from this browser
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
