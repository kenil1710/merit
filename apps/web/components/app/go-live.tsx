"use client";

import { PublicKey } from "@rialo/ts-cdk";
import { Rocket } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FaucetButton } from "@/components/faucet-button";
import { HexValue } from "@/components/hex-value";
import { Notice } from "@/components/ui-kit";
import { Stepper, type StepStatus } from "@/components/ui-kit/stepper";
import { Button } from "@/components/ui/button";
import { useOwnerWallet } from "@/lib/client/owner-wallet";
import { recordChainEvent } from "@/lib/client/chain-event";
import { relayClient, sendInstruction, signMessage } from "@/lib/client/wallet";
import { hex, unhex } from "@/lib/merit/codec";
import { ix, type CampaignConfig } from "@/lib/merit/instructions";
import { campaignMessage } from "@/lib/merit/messages";
import { randomSlug } from "@/lib/merit/pda";
import { rlo } from "@/lib/program-math";
import type { SetupKey } from "@/lib/setup-flow";
import { UnlockWallet } from "./owner-sign-in";

export type GoLiveProgram = {
  id: string;
  name: string;
  description: string;
  owner: string;
  plannedEscrow: string;
  plannedOps: string;
  firstRoundStartsAt: string;
};

type Status = {
  role: "owner" | "reviewer";
  campaignAddress: string | null;
  slugHex: string | null;
  current: SetupKey | "live";
  steps: { key: SetupKey; label: string; status: "done" | "current" | "waiting" | "skipped" }[];
  chainError: boolean;
  totalFunded: string;
};

type Local = { status?: StepStatus; signature?: string; error?: string };

/** Rent the program keeps for the campaign account, plus room for fees. */
const RENT_ALLOWANCE = 10_000_000n;

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

/**
 * Go live on Rialo, one signed step at a time: create the campaign with the rules saved in the draft (the server hands
 * back the exact config), sign its name and brief, fund the escrow and the operations budget, open round 1, then
 * publish. Each step's state comes from the chain, so a closed tab resumes where it stopped.
 */
export function GoLive({ program, onLive }: { program: GoLiveProgram; onLive?: () => void }) {
  const { keypair } = useOwnerWallet();
  const [status, setStatus] = useState<Status | null>(null);
  const [local, setLocal] = useState<Partial<Record<SetupKey, Local>>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const notified = useRef(false);
  const planned = BigInt(program.plannedEscrow) + BigInt(program.plannedOps);

  const refresh = useCallback(async () => {
    const s = await api<Status>(`/api/owner/programs/${program.id}/setup`);
    setStatus(s);
    return s;
  }, [program.id]);
  const refreshBalance = useCallback(async () => {
    try {
      setBalance(await relayClient().getBalance(PublicKey.fromString(program.owner)));
    } catch {
      setBalance(null);
    }
  }, [program.owner]);

  useEffect(() => {
    void refresh().catch((e) => setError((e as Error).message));
    void refreshBalance();
  }, [refresh, refreshBalance]);
  useEffect(() => {
    if (status?.current === "live" && !notified.current) {
      notified.current = true;
      onLive?.();
    }
  }, [status?.current, onLive]);

  const mark = (key: SetupKey, value: Local) => setLocal((l) => ({ ...l, [key]: value }));

  /** Waits until the chain shows a step done (the node can lag a moment behind confirmation). */
  async function settle(key: SetupKey): Promise<Status> {
    for (let i = 0; ; i++) {
      const s = await refresh();
      if (s.current !== key || i >= 8) return s;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  async function step(key: SetupKey, s: Status): Promise<string | undefined> {
    const owner = program.owner;
    if (key === "create") {
      const rec = await api<{ campaignAddress: string; slugHex: string; config: Record<keyof CampaignConfig, string>; limits: Record<"maxPerDay" | "approvalThreshold" | "cooldownMs" | "submitGraceMs", string> }>(
        `/api/owner/programs/${program.id}/campaign`,
        { slugHex: s.slugHex ?? hex(randomSlug()) },
      );
      const c = rec.config;
      const config: CampaignConfig = {
        agent: c.agent,
        rateKelvin: BigInt(c.rateKelvin),
        minScore: BigInt(c.minScore),
        capPerPayout: BigInt(c.capPerPayout),
        capPerContributor: BigInt(c.capPerContributor),
        capPerRound: BigInt(c.capPerRound),
        roundLengthMs: BigInt(c.roundLengthMs),
        refundDeadlineMs: BigInt(c.refundDeadlineMs),
      };
      const created = (await sendInstruction(keypair!, ix.createCampaign(owner, unhex(rec.slugHex), config))).signature;
      // Program v2: the limits the agent used to apply on its own, now enforced on chain.
      const l = rec.limits;
      await sendInstruction(keypair!, ix.setLimits(owner, unhex(rec.slugHex), { maxPerDay: BigInt(l.maxPerDay), approvalThreshold: BigInt(l.approvalThreshold), cooldownMs: BigInt(l.cooldownMs), submitGraceMs: BigInt(l.submitGraceMs) }));
      return created;
    }
    const slug = unhex(s.slugHex!);
    if (key === "describe") {
      const address = s.campaignAddress!;
      const signature = signMessage(keypair!, campaignMessage(address, program.name, program.description));
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, slug: s.slugHex, name: program.name, brief: program.description, signature }),
      });
      // 409: already described (a retry after the store write).
      if (!res.ok && res.status !== 409) throw new Error(((await res.json()) as { error?: string }).error ?? "Couldn't publish the name and brief.");
      return undefined;
    }
    if (key === "fund") {
      const amount = BigInt(program.plannedEscrow) - BigInt(s.totalFunded);
      return (await sendInstruction(keypair!, ix.fund(owner, slug, amount > 0n ? amount : BigInt(program.plannedEscrow)))).signature;
    }
    if (key === "ops") return (await sendInstruction(keypair!, ix.fundOps(owner, slug, BigInt(program.plannedOps)))).signature;
    if (key === "open") return (await sendInstruction(keypair!, ix.start(owner, slug))).signature;
    await api(`/api/owner/programs/${program.id}/publish`, {});
    return undefined;
  }

  async function run() {
    if (!keypair) return;
    setRunning(true);
    setError(null);
    try {
      let s = await refresh();
      for (let guard = 0; s.current !== "live" && guard < 10; guard++) {
        const key = s.current;
        mark(key, { status: "current" });
        try {
          const signature = await step(key, s);
          if (signature) await recordChainEvent(program.id, signature);
          mark(key, { status: "done", signature });
        } catch (e) {
          mark(key, { status: "failed", error: (e as Error).message });
          throw e;
        }
        s = await settle(key);
      }
      if (s.current === "live") toast.success(`${program.name} is live`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
      void refreshBalance();
    }
  }

  if (!status) return <p className="text-muted-foreground text-sm">Reading the campaign on Rialo…</p>;
  const live = status.current === "live";
  const short = balance !== null && !live && !status.steps.find((x) => x.key === "fund" && x.status === "done") && balance < planned + RENT_ALLOWANCE;
  const scheduled = status.steps.find((x) => x.key === "open")?.status === "skipped";

  return (
    <div className="grid gap-5" data-testid="go-live">
      <Stepper
        label="Going live"
        steps={status.steps.map((x) => {
          const l = local[x.key];
          return {
            key: x.key,
            label: x.key === "fund" ? `${x.label} · ${rlo(BigInt(program.plannedEscrow))}` : x.key === "ops" ? `${x.label} · ${rlo(BigInt(program.plannedOps))}` : x.label,
            status: l?.status === "failed" ? "failed" : l?.status === "current" && running ? "current" : x.status === "current" && !running ? "waiting" : x.status,
            meta: l?.signature ? <HexValue value={l.signature} href={`/tx/${l.signature}`} label="transaction" head={6} tail={0} /> : undefined,
            detail:
              l?.status === "failed" ? <span className="text-danger">{l.error}</span>
              : x.key === "open" && scheduled ? `Scheduled: you open it from the overview after ${new Date(program.firstRoundStartsAt).toUTCString()}.`
              : undefined,
          };
        })}
      />
      {status.chainError ? <Notice tone="warning">Rialo DevNet didn&apos;t answer just now. The steps below may be out of date.</Notice> : null}
      {live ? null : status.role !== "owner" ? (
        <p className="text-muted-foreground text-sm">Only the owner can take the program live.</p>
      ) : !keypair ? (
        <UnlockWallet owner={program.owner} purpose="Your wallet signs each step in this browser. Nothing leaves it but signed transactions." />
      ) : (
        <div className="grid gap-3">
          <div className="bg-muted/50 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm">
            <span>
              <span className="text-muted-foreground">Wallet balance </span>
              <span className="mono-num font-medium">{balance === null ? "…" : rlo(balance)}</span>
              <span className="text-muted-foreground"> · needs about {rlo(planned + RENT_ALLOWANCE)}</span>
            </span>
            <FaucetButton keypair={keypair} size="sm" disabled={running} onFunded={refreshBalance} />
          </div>
          {short ? <Notice tone="warning">The wallet holds less than the escrow and operations budget you planned. Use the faucet first.</Notice> : null}
          <Button size="lg" className="h-11 w-fit px-5 text-[15px]" disabled={running || short} onClick={run}>
            <Rocket className="size-4" />
            {running ? "Signing on Rialo…" : status.current === "create" ? "Sign and go live" : "Continue going live"}
          </Button>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Each step is signed in this browser and sent through Merit&apos;s relay to Rialo DevNet. DevNet charges no fees; creating the campaign keeps about 0.005 RLO as account rent.
          </p>
        </div>
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}
