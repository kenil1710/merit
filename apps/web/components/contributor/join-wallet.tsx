"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { shortHex } from "@/components/hex-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWallet, savedAddress, signMessage, unlockWallet } from "@/lib/client/wallet";

/**
 * Join with the Rialo wallet in this browser: unlock it (or create one), sign the join message naming your X account
 * and the wallet, and you're in. A signature, not a transaction; RLO is paid to this wallet.
 */
export function JoinWallet({ slug }: { slug: string }) {
  const router = useRouter();
  const [address, setAddress] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setAddress(savedAddress()), []);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setBusy(address ? "Unlocking…" : "Creating wallet…");
      const keypair = address ? await unlockWallet(passphrase) : await createWallet(passphrase);
      const wallet = keypair.publicKey.toString();
      setBusy("Signing…");
      const post = async (url: string, body: unknown) => {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const json = (await res.json().catch(() => ({}))) as Record<string, string>;
        if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
        return json;
      };
      const { nonce, message } = await post("/api/contributor/wallet/challenge", { slug, wallet });
      await post("/api/contributor/join", { slug, wallet, nonce, signature: signMessage(keypair, message!) });
      router.push(`/c/${slug}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  return (
    <form className="grid gap-3" onSubmit={join}>
      {address ? (
        <p className="bg-muted/50 rounded-xl px-3 py-2 text-sm">
          <span className="text-muted-foreground block text-xs">Wallet in this browser</span>
          <span className="font-mono text-[13px]">{shortHex(address, 10, 8)}</span>
        </p>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="join-passphrase">{address ? "Passphrase" : "Choose a passphrase for a new wallet"}</Label>
        <Input
          id="join-passphrase"
          type="password"
          autoComplete={address ? "current-password" : "new-password"}
          placeholder={address ? "Passphrase to unlock" : "8+ characters"}
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className="h-10"
        />
      </div>
      <Button type="submit" className="h-10 w-full" disabled={!passphrase || !!busy}>
        <KeyRound className="size-4" />
        {busy ?? (address ? "Sign and join" : "Create wallet and join")}
      </Button>
      {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}
    </form>
  );
}
