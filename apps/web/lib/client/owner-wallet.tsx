"use client";

// The owner's unlocked wallet, kept in memory for the /app session: unlock once (at sign-in) and every page in the
// owner app can sign until a reload or Lock. It is the tab's one unlocked key (wallet.ts), so the wallet panel and
// the owner app always agree. The encrypted key itself stays in localStorage.

import type { Keypair } from "@rialo/ts-cdk";
import { useSyncExternalStore, type ReactNode } from "react";
import { getUnlocked, setUnlocked, signMessage, subscribeUnlocked } from "./wallet";
import { ownerSignInMessage, OWNER_NETWORK } from "@/lib/merit/messages";

/** Kept so the owner layout reads the same; the key lives in wallet.ts's in-memory store. */
export function OwnerWalletProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** The unlocked keypair in this tab (null when locked), and a setter that every wallet view follows. */
export function useUnlockedWallet(): Keypair | null {
  return useSyncExternalStore(subscribeUnlocked, getUnlocked, () => null);
}

export function useOwnerWallet() {
  return { keypair: useUnlockedWallet(), setKeypair: setUnlocked };
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(SIGN_IN_ERRORS[json.error ?? ""] ?? json.error ?? `Request failed (${res.status})`);
  return json;
}

const SIGN_IN_ERRORS: Record<string, string> = {
  nonce_used: "That sign-in was already used or expired. Try again.",
  stale: "The sign-in took too long. Try again.",
  bad_signature: "The wallet signature didn't verify.",
  wrong_domain: "This sign-in was made for another site.",
};

/** Owner sign-in: fetch a nonce for this wallet, sign the message (no transaction), start the session. */
export async function signInOwner(keypair: Keypair): Promise<string> {
  const address = keypair.publicKey.toString();
  const { nonce, domain, uri } = await post<{ nonce: string; domain: string; uri: string }>("/api/auth/owner/nonce", { address });
  const message = ownerSignInMessage({ domain, address, uri, network: OWNER_NETWORK, nonce, issuedAt: new Date().toISOString() });
  await post("/api/auth/owner/verify", { message, signature: signMessage(keypair, message) });
  return address;
}
