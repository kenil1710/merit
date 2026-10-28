"use client";

import { PublicKey } from "@rialo/ts-cdk";
import { useCallback, useEffect, useState } from "react";
import { relayClient, savedAddress } from "./wallet";

/** The wallet address stored in this browser, kept in sync when it is created, imported or forgotten (any tab). */
export function useSavedAddress(): string | null {
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setAddress(savedAddress());
    sync();
    window.addEventListener("merit-wallet", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("merit-wallet", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return address;
}

/** A wallet's DevNet balance through the relay; `afterFaucet` re-reads until it moves (the answering node can lag). */
export function useBalance(address: string | null) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const read = useCallback(async () => {
    if (!address) return null;
    try {
      return await relayClient().getBalance(PublicKey.fromString(address));
    } catch {
      return null;
    }
  }, [address]);
  const refresh = useCallback(async () => {
    setBalance(await read());
  }, [read]);
  const afterFaucet = useCallback(async () => {
    const before = balance ?? 0n;
    for (let i = 0; i < 10; i++) {
      const now = await read();
      if (now !== null) setBalance(now);
      if (now !== null && now > before) return;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }, [balance, read]);
  useEffect(() => {
    setBalance(null);
    void refresh();
  }, [refresh]);
  return { balance, refresh, afterFaucet };
}
