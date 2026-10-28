"use client";

import { AlertTriangle, Download, KeyRound, Lock, RefreshCw, Upload, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { FaucetButton } from "@/components/faucet-button";
import { CopyButton } from "@/components/ui-kit/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useUnlockedWallet } from "@/lib/client/owner-wallet";
import { useBalance, useSavedAddress } from "@/lib/client/use-wallet";
import { createWallet, downloadBackup, errorAfterEdit, forgetWallet, importBackup, lockWallet, newPassphraseError, unlockWallet } from "@/lib/client/wallet";
import { formatRlo } from "@/lib/merit/constants";
import { NewPassphraseFields } from "./passphrase-fields";

export const FORGET_WORD = "FORGET";

/**
 * The wallet panel, mounted once in the root layout and opened from any wallet chip (`openWalletPanel`). It manages
 * the one wallet stored in this browser: address, balance, faucet, lock, encrypted backup, import and forget.
 */
export function WalletSheetHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("merit-wallet-open", show);
    return () => window.removeEventListener("merit-wallet-open", show);
  }, []);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-testid="wallet-sheet">
        <div className="grid gap-6 p-6">
          <div>
            <SheetTitle className="inline-flex items-center gap-2 text-lg font-medium">
              <Wallet className="text-brand size-5" strokeWidth={1.5} /> Your Rialo wallet
            </SheetTitle>
            <SheetDescription className="text-muted-foreground mt-1 text-sm leading-relaxed">
              Generated and encrypted in this browser (PBKDF2 → AES-GCM). The key is never sent anywhere. DevNet only: RLO here is test currency.
            </SheetDescription>
          </div>
          {open ? <WalletManager onClose={() => setOpen(false)} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function WalletManager({ onClose }: { onClose: () => void }) {
  const address = useSavedAddress();
  const keypair = useUnlockedWallet();
  const [forgetting, setForgetting] = useState(false);
  if (!address) return <NoWallet />;
  if (forgetting) return <ForgetWallet address={address} onCancel={() => setForgetting(false)} onDone={() => setForgetting(false)} />;
  const unlocked = keypair?.publicKey.toString() === address;
  return (
    <div className="grid gap-6">
      <Overview address={address} />
      <Block title={unlocked ? "Unlocked in this tab" : "Locked"}>
        {unlocked ? (
          <LockButton onLocked={onClose} />
        ) : (
          <>
            <UnlockForm />
            <SignOut onDone={onClose} />
          </>
        )}
      </Block>
      <Block title="Backup" hint="The file holds the key encrypted with your passphrase: keep both. Without them a forgotten wallet can't be recovered.">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => downloadBackup() && toast.success("Encrypted backup downloaded")}>
            <Download className="size-4" /> Download encrypted backup
          </Button>
        </div>
        <ImportBackup existing={address} />
      </Block>
      <Block title="Forget this wallet" hint="Removes the key from this browser so you can create or import another.">
        <Button variant="outline" className="text-danger hover:text-danger w-fit" onClick={() => setForgetting(true)}>
          <AlertTriangle className="size-4" /> Forget this wallet…
        </Button>
      </Block>
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t pt-5">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {hint ? <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Address with copy, balance with refresh, and the faucet with its cooldown. Also used on its own (WalletStrip). */
export function Overview({ address }: { address: string }) {
  const { balance, refresh, afterFaucet } = useBalance(address);
  return (
    <div className="bg-muted/50 grid gap-4 rounded-2xl p-4" data-testid="wallet-overview">
      <div className="min-w-0">
        <p className="label">Address</p>
        <p className="mt-1 font-mono text-[13px] break-all" data-testid="wallet-address">{address}</p>
        <div className="mt-2">
          <CopyButton value={address} label="Copy address" copiedLabel="Address copied" />
        </div>
      </div>
      <div>
        <p className="label">Balance</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="display text-3xl leading-none tabular-nums" data-testid="wallet-balance">
            {balance === null ? "…" : formatRlo(balance)}
          </span>
          <span className="text-muted-foreground text-xs">RLO</span>
          <button type="button" className="text-muted-foreground hover:text-foreground ml-auto rounded p-1" aria-label="Refresh balance" onClick={() => void refresh()}>
            <RefreshCw className="size-3.5" />
          </button>
        </p>
      </div>
      <FaucetButton address={address} size="sm" onFunded={afterFaucet} />
    </div>
  );
}

function LockButton({ onLocked }: { onLocked: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-2">
      <Button
        variant="outline"
        className="w-fit"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await lockWallet();
          toast.success("Wallet locked and signed out");
          onLocked();
          router.refresh();
        }}
      >
        <Lock className="size-4" /> {busy ? "Locking…" : "Lock wallet"}
      </Button>
      <p className="text-muted-foreground text-xs leading-relaxed">Clears the key from memory and ends your signed owner session. Signing again needs the passphrase, also after a reload.</p>
    </div>
  );
}

/** Locked but maybe still signed in to the owner app (after a reload): end that session too. */
function SignOut({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground w-fit text-xs underline underline-offset-4"
      onClick={async () => {
        await lockWallet();
        toast.success("Signed out");
        onDone();
        router.refresh();
      }}
    >
      Sign out of the owner app
    </button>
  );
}

function UnlockForm() {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await unlockWallet(passphrase);
          setPassphrase("");
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Label htmlFor="sheet-unlock">Passphrase</Label>
      <div className="flex gap-2">
        <Input
          id="sheet-unlock"
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
        <Button type="submit" className="h-10" disabled={!passphrase || busy}>
          <KeyRound className="size-4" /> {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </div>
      {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}
    </form>
  );
}

function NoWallet() {
  const router = useRouter();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-6">
      <p className="bg-muted/50 rounded-xl px-3.5 py-2.5 text-sm">No wallet in this browser yet. Create one, or import an encrypted backup.</p>
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const invalid = newPassphraseError(passphrase, confirm);
          if (invalid) return setError(invalid);
          setBusy(true);
          setError(null);
          try {
            await createWallet(passphrase, confirm);
            toast.success("Wallet created. Download its backup next.");
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <NewPassphraseFields id="sheet-new" value={passphrase} confirm={confirm} onChange={setPassphrase} onConfirmChange={setConfirm} />
        <Button type="submit" className="h-10" disabled={!passphrase || !confirm || busy}>
          <KeyRound className="size-4" /> {busy ? "Creating…" : "Create wallet"}
        </Button>
        {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}
      </form>
      <Block title="Import a backup" hint="A file from “Download encrypted backup”, with the passphrase it was made with.">
        <ImportBackup existing={null} />
      </Block>
    </div>
  );
}

function ImportBackup({ existing }: { existing: string | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text) return;
        setBusy(true);
        setError(null);
        try {
          await importBackup(text, passphrase);
          toast.success("Wallet imported and unlocked");
          setText(null);
          setPassphrase("");
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        data-testid="import-file"
        aria-label="Backup file"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          setError(null);
          if (!file) return;
          if (file.size > 64_000) return setError("That file is too big to be a wallet backup.");
          setFileName(file.name);
          setText(await file.text());
        }}
      />
      <Button type="button" variant="outline" className="w-fit" onClick={() => fileRef.current?.click()}>
        <Upload className="size-4" /> {fileName ? `Backup: ${fileName}` : "Import backup"}
      </Button>
      {existing ? <p className="text-muted-foreground text-xs">Importing a different wallet needs this one forgotten first.</p> : null}
      {text ? (
        <div className="flex gap-2">
          <Input
            type="password"
            aria-label="Backup passphrase"
            autoComplete="current-password"
            placeholder="The backup's passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="h-10"
          />
          <Button type="submit" className="h-10" disabled={!passphrase || busy}>
            {busy ? "Checking…" : "Import"}
          </Button>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}
    </form>
  );
}

function ForgetWallet({ address, onCancel, onDone }: { address: string; onCancel: () => void; onDone: () => void }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [backedUp, setBackedUp] = useState(false);
  return (
    <div className="grid gap-5" data-testid="forget-wallet">
      <div className="bg-danger-subtle text-danger grid gap-2 rounded-2xl p-4 text-sm leading-relaxed">
        <p className="inline-flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4" /> This deletes the wallet from this browser
        </p>
        <p>
          Merit has no copy of your key. Without an encrypted backup and its passphrase, the wallet <span className="font-mono">{address.slice(0, 8)}…</span>, any RLO in it, and the
          programs it owns or the payouts it receives can&apos;t be reached again.
        </p>
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">1. Download the backup first</p>
        <Button
          variant={backedUp ? "outline" : "default"}
          className="w-fit"
          onClick={() => {
            if (downloadBackup()) {
              setBackedUp(true);
              toast.success("Encrypted backup downloaded");
            }
          }}
        >
          <Download className="size-4" /> {backedUp ? "Backup downloaded" : "Download encrypted backup"}
        </Button>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="forget-confirm" className="text-sm font-medium">
          2. Type {FORGET_WORD} to confirm
        </Label>
        <Input id="forget-confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={FORGET_WORD} className="h-10 font-mono" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          disabled={typed !== FORGET_WORD}
          onClick={async () => {
            await lockWallet();
            forgetWallet();
            toast.success("Wallet forgotten. You can create a new one.");
            onDone();
            router.refresh();
          }}
        >
          Forget this wallet
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
