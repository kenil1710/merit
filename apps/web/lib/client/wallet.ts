"use client";

// Merit's embedded Rialo wallet. The secret key never leaves the browser:
// it is encrypted with a passphrase (PBKDF2-SHA256, 310k rounds -> AES-GCM)
// and kept in localStorage. Unlocked keys live only in memory.

import { Keypair, TransactionBuilder, createRialoClient, type RialoClient } from "@rialo/ts-cdk";
import { base58, base64 } from "@scure/base";
import { toCdkInstruction, type PlainInstruction } from "@/lib/merit/instructions";

const STORAGE_KEY = "merit.wallet.v1";
const ROUNDS = 310_000;

type Vault = { address: string; salt: string; iv: string; ciphertext: string };

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ROUNDS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function savedAddress(): string | null {
  const raw = storage()?.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Vault).address : null;
}

export const PASSPHRASE_MIN = 8;

export type Strength = { score: 0 | 1 | 2 | 3 | 4; label: "Too short" | "Weak" | "Fair" | "Good" | "Strong"; hint: string };

/**
 * A rough passphrase strength for the hint under the field: length counts most, then mixing character kinds; one
 * repeated character or a common word scores weak. Not a guarantee, only a nudge toward a longer passphrase.
 */
export function passphraseStrength(p: string): Strength {
  if (p.length < PASSPHRASE_MIN) return { score: 0, label: "Too short", hint: `Use at least ${PASSPHRASE_MIN} characters.` };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((r) => r.test(p)).length;
  const words = p.trim().split(/\s+/).length;
  const common = /^(password|passphrase|12345678|qwertyui|merit|rialo)/i.test(p) || /^(.)\1+$/.test(p);
  let score = (p.length >= 12 ? 2 : 1) + (p.length >= 16 || words >= 4 ? 1 : 0) + (kinds >= 3 ? 1 : 0);
  if (common) score = 1;
  const s = Math.min(4, score) as 1 | 2 | 3 | 4;
  const label = (["Too short", "Weak", "Fair", "Good", "Strong"] as const)[s];
  const hint =
    s >= 4 ? "Hard to guess. Keep it somewhere safe: Merit can't recover it." : s === 3 ? "Good. Four or more random words make it stronger." : "Easy to guess. Use 12+ characters, or four random words.";
  return { score: s, label, hint };
}

/** A new passphrase and its confirmation: the error to show, or null when both can be used. */
export function newPassphraseError(passphrase: string, confirm: string): string | null {
  if (passphrase.length < PASSPHRASE_MIN) return `Use a passphrase of at least ${PASSPHRASE_MIN} characters.`;
  if (passphrase !== confirm) return "The two passphrases don't match.";
  return null;
}

/**
 * A passphrase form's error after an edit: a "too short" error clears as soon as the passphrase is long enough, and
 * an unlock error (wrong passphrase) clears on any edit, since only trying it again can tell.
 */
export function errorAfterEdit(error: string | null, passphrase: string, creating: boolean): string | null {
  if (!error) return null;
  if (!creating) return null;
  return passphrase.length >= PASSPHRASE_MIN ? null : error;
}

export async function createWallet(passphrase: string, confirm = passphrase): Promise<Keypair> {
  const invalid = newPassphraseError(passphrase, confirm);
  if (invalid) throw new Error(invalid);
  const store = storage();
  if (!store) throw new Error("This browser blocks local storage, so the wallet cannot be saved.");
  const keypair = Keypair.generate();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const secret = keypair.secretKeyBytes();
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, await deriveKey(passphrase, salt), secret as BufferSource));
  secret.fill(0);
  const vault: Vault = { address: keypair.publicKey.toString(), salt: base64.encode(salt), iv: base64.encode(iv), ciphertext: base64.encode(ciphertext) };
  store.setItem(STORAGE_KEY, JSON.stringify(vault));
  setUnlocked(keypair);
  window.dispatchEvent(new Event("merit-wallet"));
  return keypair;
}

export async function unlockWallet(passphrase: string): Promise<Keypair> {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) throw new Error("No wallet in this browser.");
  const keypair = await openVault(JSON.parse(raw) as Vault, passphrase);
  setUnlocked(keypair);
  return keypair;
}

async function openVault(vault: Vault, passphrase: string): Promise<Keypair> {
  let secret: Uint8Array;
  try {
    secret = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64.decode(vault.iv) as BufferSource },
        await deriveKey(passphrase, base64.decode(vault.salt)),
        base64.decode(vault.ciphertext) as BufferSource,
      ),
    );
  } catch {
    throw new Error("Wrong passphrase.");
  }
  const keypair = Keypair.fromSecretKey(secret);
  secret.fill(0);
  if (keypair.publicKey.toString() !== vault.address) throw new Error("Wallet data is corrupted.");
  return keypair;
}

export function forgetWallet() {
  storage()?.removeItem(STORAGE_KEY);
  setUnlocked(null);
  window.dispatchEvent(new Event("merit-wallet"));
}

// ─── Backup ──────────────────────────────────────────────────────────────────
// The backup is the stored vault itself: the key stays encrypted with the passphrase, so the file alone can't spend.

const BACKUP_FORMAT = "merit-wallet-backup";

export type Backup = { format: typeof BACKUP_FORMAT; version: 1; kdf: "PBKDF2-SHA256"; rounds: number; cipher: "AES-GCM"; createdAt: string } & Vault;

export function backupFile(now = new Date()): { name: string; json: string } | null {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return null;
  const vault = JSON.parse(raw) as Vault;
  const backup: Backup = { format: BACKUP_FORMAT, version: 1, kdf: "PBKDF2-SHA256", rounds: ROUNDS, cipher: "AES-GCM", createdAt: now.toISOString(), ...vault };
  return { name: `merit-wallet-${vault.address.slice(0, 8)}.json`, json: JSON.stringify(backup, null, 2) };
}

/** Saves the encrypted backup as a file download. */
export function downloadBackup(): boolean {
  const file = backupFile();
  if (!file) return false;
  const url = URL.createObjectURL(new Blob([file.json], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Reads a backup file's text into a vault, or throws a message a person can act on. */
export function parseBackup(text: string): Vault {
  let data: Partial<Backup>;
  try {
    data = JSON.parse(text) as Partial<Backup>;
  } catch {
    throw new Error("That file isn't a Merit wallet backup (not JSON).");
  }
  if (data.format !== BACKUP_FORMAT || data.version !== 1) throw new Error("That file isn't a Merit wallet backup.");
  if (data.rounds !== undefined && data.rounds !== ROUNDS) throw new Error("This backup was made with other settings and can't be read here.");
  const { address, salt, iv, ciphertext } = data;
  if (![address, salt, iv, ciphertext].every((v) => typeof v === "string" && v.length > 0)) throw new Error("The backup is incomplete.");
  return { address: address!, salt: salt!, iv: iv!, ciphertext: ciphertext! };
}

/**
 * Imports a backup into this browser after checking the passphrase opens it. Refuses while another wallet is stored,
 * so an import never silently replaces a key.
 */
export async function importBackup(text: string, passphrase: string): Promise<Keypair> {
  const vault = parseBackup(text);
  const store = storage();
  if (!store) throw new Error("This browser blocks local storage, so the wallet cannot be saved.");
  const current = savedAddress();
  if (current && current !== vault.address) throw new Error("Another wallet is stored in this browser. Forget it first (download its backup before you do).");
  const keypair = await openVault(vault, passphrase);
  store.setItem(STORAGE_KEY, JSON.stringify(vault));
  setUnlocked(keypair);
  window.dispatchEvent(new Event("merit-wallet"));
  return keypair;
}

// ─── Unlocked key, in memory only ────────────────────────────────────────────
// One unlocked keypair per tab, shared by every component (the wallet panel, the owner app, the faucet). A reload or
// Lock clears it; nothing about it is ever written to storage.

let unlocked: Keypair | null = null;
const listeners = new Set<() => void>();

export function getUnlocked(): Keypair | null {
  return unlocked;
}

export function setUnlocked(keypair: Keypair | null) {
  unlocked = keypair;
  for (const l of listeners) l();
}

export function subscribeUnlocked(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Lock: forget the unlocked key and end the owner's signed session, so nothing can sign until the passphrase is
 * entered again, in this tab or after a reload.
 */
export async function lockWallet(): Promise<void> {
  setUnlocked(null);
  await fetch("/api/auth/owner/logout", { method: "POST" }).catch(() => undefined);
  window.dispatchEvent(new Event("merit-wallet"));
}

/** Opens the wallet panel from anywhere (the sidebar chips, the wallet strip). */
export function openWalletPanel() {
  window.dispatchEvent(new Event("merit-wallet-open"));
}

export function relayClient(): RialoClient {
  return createRialoClient({ chain: { id: "rialo:devnet", name: "Rialo DevNet (via Merit relay)", rpcUrl: `${window.location.origin}/api/rialo` } });
}

export function signMessage(keypair: Keypair, message: string): string {
  return base58.encode(keypair.sign(new TextEncoder().encode(message)).toBytes());
}

/// Signs and sends one Merit instruction from the embedded wallet, then
/// reports the program's own log lines (and fails if the transaction did).
export async function sendInstruction(keypair: Keypair, instruction: PlainInstruction): Promise<{ signature: string; lines: string[] }> {
  const client = relayClient();
  const tx = TransactionBuilder.create()
    .setPayer(keypair.publicKey)
    .setValidFrom(BigInt(Date.now()))
    .setConfigHashPrefix(await client.getConfigHashPrefix())
    .addInstruction(toCdkInstruction(instruction))
    .build()
    .sign(keypair);
  const confirmed = await client.sendAndConfirmTransaction(tx.serialize());
  type Meta = { logMessages?: string[]; err?: unknown };
  // Right after confirmation the node may not serve the transaction yet; retry briefly.
  let meta: Meta | undefined;
  for (let attempt = 0; attempt < 8 && !meta; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 750));
    const response = await fetch("/api/rialo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [{ signature: confirmed.signature }] }),
    });
    const result = (await response.json()).result as { meta?: Meta; value?: { meta?: Meta } } | null | undefined;
    meta = result?.value?.meta ?? result?.meta;
  }
  if (!meta) meta = {};
  const lines = (meta.logMessages ?? []).map((l) => /Program log: (Merit .*)$/.exec(l)?.[1]).filter((l): l is string => Boolean(l));
  if (meta.err || confirmed.err) {
    throw new Error(`Transaction ${confirmed.signature} failed${lines.length ? `: ${lines[lines.length - 1]}` : ""}`);
  }
  return { signature: confirmed.signature, lines };
}
