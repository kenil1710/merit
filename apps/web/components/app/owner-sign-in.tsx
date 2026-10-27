"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { shortHex } from "@/components/hex-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInOwner, useOwnerWallet } from "@/lib/client/owner-wallet";
import { createWallet, savedAddress, unlockWallet } from "@/lib/client/wallet";

/**
 * Sign in as an owner with the Rialo wallet in this browser: unlock it (or create one), then sign a one-time
 * message. Nothing is sent on chain and nothing costs RLO.
 */
export function OwnerSignIn() {
  const router = useRouter();
  const { setKeypair } = useOwnerWallet();
  const [address, setAddress] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setAddress(savedAddress()), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setBusy(address ? "Unlocking…" : "Creating wallet…");
      const keypair = address ? await unlockWallet(passphrase) : await createWallet(passphrase);
      setBusy("Signing in…");
      await signInOwner(keypair);
      setKeypair(keypair);
      setPassphrase("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      {address ? (
        <div className="bg-muted/50 rounded-xl px-3.5 py-2.5 text-sm">
          <p className="text-muted-foreground text-xs">Wallet in this browser</p>
          <p className="mt-0.5 font-mono text-[13px]">{shortHex(address, 10, 8)}</p>
        </div>
      ) : (
        <p className="text-soft text-sm leading-relaxed">
          No wallet in this browser yet. Choose a passphrase: Merit creates a Rialo wallet here and encrypts it with it.
        </p>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="owner-passphrase">{address ? "Passphrase" : "Choose a passphrase"}</Label>
        <Input
          id="owner-passphrase"
          type="password"
          autoComplete={address ? "current-password" : "new-password"}
          placeholder={address ? "Passphrase to unlock" : "New passphrase (8+ characters)"}
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className="h-10"
        />
      </div>
      <Button type="submit" className="h-10" disabled={!passphrase || !!busy}>
        <KeyRound className="size-4" />
        {busy ?? (address ? "Unlock and sign in" : "Create wallet and sign in")}
      </Button>
      {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}
      <p className="text-muted-foreground text-xs leading-relaxed">
        Signing in is a free signature, not a transaction. The key is generated and encrypted in this browser and never sent anywhere.
      </p>
    </form>
  );
}

/** Unlock the wallet the owner signed in with, to sign transactions on this page. */
export function UnlockWallet({ owner, purpose }: { owner: string; purpose: string }) {
  const { setKeypair } = useOwnerWallet();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="bg-muted/50 grid gap-3 rounded-[1.25rem] p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const keypair = await unlockWallet(passphrase);
          if (keypair.publicKey.toString() !== owner) throw new Error(`This browser's wallet isn't ${shortHex(owner)}, the one you signed in with.`);
          setKeypair(keypair);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm font-medium">Unlock your wallet</p>
      <p className="text-soft text-sm">{purpose}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="password"
          aria-label="Wallet passphrase"
          autoComplete="current-password"
          placeholder="Passphrase to unlock"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className="h-10"
        />
        <Button type="submit" className="h-10 px-4" disabled={!passphrase || busy}>
          <KeyRound className="size-4" />
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </div>
      {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}
    </form>
  );
}
