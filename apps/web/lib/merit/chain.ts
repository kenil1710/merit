// Read-side chain access shared by server pages and the browser. The browser
// passes "/api/rialo" (same-origin relay); the server talks to DevNet.

import { base64 } from "@scure/base";
import { Reader, hex } from "./codec";
import { KIND, PROGRAM_ID, REX_PROCESSOR_ID } from "./constants";
import { ledgerAddress } from "./pda";
import { decodeState, type MeritState } from "./state";

export class RpcClient {
  constructor(private url: string) {}

  async call<T>(method: string, params: unknown): Promise<T> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
    });
    const body = await response.json();
    if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
    return body.result as T;
  }

  async account(address: string): Promise<{ data: Uint8Array; kelvin: bigint; owner: string } | null> {
    type Value = { kelvin: number; owner: string; data: string | [string, string] } | null;
    const result = await this.call<{ value: Value }>("getAccountInfo", [{ address, encoding: "base64" }]);
    const value = result.value;
    if (!value) return null;
    const encoded = Array.isArray(value.data) ? value.data[0] : value.data;
    return { data: base64.decode(encoded), kelvin: BigInt(value.kelvin), owner: value.owner };
  }

  async balance(address: string): Promise<bigint> {
    const result = await this.call<{ value: number } | number>("getBalance", [{ address }]);
    return BigInt(typeof result === "number" ? result : result.value);
  }

  async signatures(address: string, limit = 50, before?: string): Promise<{ signature: string; blockTime: number; err: unknown }[]> {
    const result = await this.call<{ value: { signature: string; blockTime: number; err: unknown }[] }>(
      "getSignaturesForAddress",
      [{ address, limit, ...(before ? { before } : {}) }],
    );
    return result.value;
  }

  async logs(signature: string): Promise<{ logs: string[]; err: unknown; blockTime?: number; accounts: string[] }> {
    type Tx = { meta?: { logMessages?: string[]; err?: unknown }; blockTime?: number; block_time?: number; transaction?: { message?: { accountKeys?: string[] } } };
    // A just-confirmed transaction may not be served yet; retry briefly before giving up.
    let tx: Tx | null | undefined;
    for (let attempt = 0; attempt < 8 && !tx; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 750));
      const result = await this.call<Tx | { value: Tx } | null>("getTransaction", [{ signature }]);
      tx = result && "value" in result ? result.value : result;
    }
    if (!tx) throw new Error(`transaction ${signature} not found`);
    return { logs: tx.meta?.logMessages ?? [], err: tx.meta?.err ?? null, blockTime: tx.blockTime ?? tx.block_time, accounts: tx.transaction?.message?.accountKeys ?? [] };
  }
}

export async function loadState(rpc: RpcClient, address: string): Promise<MeritState | null> {
  const account = await rpc.account(address);
  if (!account || account.owner !== PROGRAM_ID || account.data.length === 0) return null;
  return decodeState(address, account.data, account.kelvin);
}

export async function listCampaigns(rpc: RpcClient): Promise<MeritState[]> {
  type Owned = { pubkey: string; account: { kelvin: number; data: string | [string, string] } };
  const result = await rpc.call<{ value: Owned[] }>("getAccountsByOwner", [{ owner: PROGRAM_ID, encoding: "base64" }]);
  const out: MeritState[] = [];
  for (const item of result.value) {
    try {
      const encoded = Array.isArray(item.account.data) ? item.account.data[0] : item.account.data;
      const state = decodeState(item.pubkey, base64.decode(encoded), BigInt(item.account.kelvin));
      if (state.kind === KIND.CAMPAIGN && state.campaign === item.pubkey) out.push(state);
    } catch {
      // An account from an older layout; not listed.
    }
  }
  return out;
}

/// Finds the ledger for a round. Past rounds may have had a different agent,
/// so every agent the campaign has named is tried.
export async function findLedger(rpc: RpcClient, campaign: MeritState, round: bigint): Promise<MeritState | null> {
  const agents = [...new Set([campaign.roundAgent, campaign.agent, campaign.nextAgent])];
  for (const agent of agents) {
    const ledger = await loadState(rpc, ledgerAddress(agent, campaign.address, round));
    if (ledger && ledger.kind === KIND.LEDGER && ledger.campaign === campaign.address && ledger.round === round) return ledger;
  }
  return null;
}

export type ValidatorOutput = { ok: boolean; payload: string; timestamp: string; validator: string };

/// Reads a REX report PDA (owned by the REX processor) and decodes every
/// validator's output: bincode RexReport, each update a Borsh RexOutput.
export async function loadReport(rpc: RpcClient, address: string): Promise<{ round: bigint; outputs: ValidatorOutput[] } | null> {
  const account = await rpc.account(address);
  if (!account || account.owner !== REX_PROCESSOR_ID) return null;
  const r = new Reader(account.data);
  r.pubkey(); // rex_id.nonce
  r.pubkey(); // rex_id.creator
  const round = r.u64();
  const count = r.length();
  const outputs: ValidatorOutput[] = [];
  for (let i = 0; i < count; i++) {
    const data = r.rawBytes();
    const validator = hex(r.fixedBytes(96)).slice(0, 16);
    outputs.push({ ...decodeRexOutput(data), validator });
  }
  return { round, outputs };
}

function decodeRexOutput(data: Uint8Array): { ok: boolean; payload: string; timestamp: string } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const text = (at: number, len: number) => new TextDecoder().decode(data.subarray(at, at + len));
  try {
    if (data[0] === 0 && data[1] === 0) {
      const length = view.getUint32(2, true);
      const tsLength = view.getUint32(6 + length, true);
      return { ok: true, payload: text(6, length), timestamp: text(10 + length, tsLength) };
    }
    if (data[0] === 1) return { ok: false, payload: "REX error", timestamp: "" };
  } catch {
    // fall through
  }
  return { ok: false, payload: "unreadable output", timestamp: "" };
}

export type MeritEvent = { signature: string; blockTime?: number; lines: string[]; failed: boolean };

/// Merit's own log lines for an account's recent transactions.
export async function meritEvents(rpc: RpcClient, address: string, limit = 25): Promise<MeritEvent[]> {
  const signatures = await rpc.signatures(address, limit);
  const events = await Promise.all(
    signatures.map(async (s) => {
      const { logs, err } = await rpc.logs(s.signature);
      const lines = logs.map((line) => /Program log: (Merit .*)$/.exec(line)?.[1]).filter((x): x is string => Boolean(x));
      return { signature: s.signature, blockTime: s.blockTime, lines, failed: Boolean(err ?? s.err) };
    }),
  );
  return events;
}
