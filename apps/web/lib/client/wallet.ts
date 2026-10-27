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

export async function createWallet(passphrase: string): Promise<Keypair> {
  if (passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
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
  window.dispatchEvent(new Event("merit-wallet"));
  return keypair;
}

export async function unlockWallet(passphrase: string): Promise<Keypair> {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) throw new Error("No wallet in this browser.");
  const vault = JSON.parse(raw) as Vault;
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
  window.dispatchEvent(new Event("merit-wallet"));
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
