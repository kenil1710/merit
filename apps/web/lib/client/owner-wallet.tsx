"use client";

// The owner's unlocked wallet, kept in memory for the /app session: unlock once (at sign-in) and every page in the
// owner app can sign until a reload or Lock. The encrypted key itself stays in localStorage (see wallet.ts).

import type { Keypair } from "@rialo/ts-cdk";
import { createContext, useContext, useState, type ReactNode } from "react";
import { signMessage } from "./wallet";
import { ownerSignInMessage, OWNER_NETWORK } from "@/lib/merit/messages";

const Ctx = createContext<{ keypair: Keypair | null; setKeypair: (k: Keypair | null) => void } | null>(null);

export function OwnerWalletProvider({ children }: { children: ReactNode }) {
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  return <Ctx.Provider value={{ keypair, setKeypair }}>{children}</Ctx.Provider>;
}

export function useOwnerWallet() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useOwnerWallet outside OwnerWalletProvider");
  return value;
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
