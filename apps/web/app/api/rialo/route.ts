// Same-origin JSON-RPC relay to Rialo DevNet. DevNet sends no CORS headers,
// so the browser talks to this route instead. It fails closed: one request
// per call (no batches), an explicit method allowlist, and the faucet capped
// at 1 RLO per call, once per wallet per day, a few per IP per day, and not
// for a wallet that already holds 1 RLO (lib/server/faucet.ts, in Postgres).

import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { RpcClient } from "@/lib/merit/chain";
import { FAUCET_MAX_KELVIN, PROGRAM_ID, RPC_UPSTREAM } from "@/lib/merit/constants";
import { isAddress } from "@/lib/server/agent";
import { faucetVerdict, hashIp, releaseGrant, reserveGrant } from "@/lib/server/faucet";
import { allow, clientKey, ipKey, rule } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TX_BASE64 = 8 * 1024;

const READ_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getSignaturesForAddress",
  "getTransaction",
  "getSignatureStatuses",
  "getBlockHeight",
  "getEpochInfo",
  "getHealth",
  "getRecentValidatorConfigHash",
  "getMinimumBalanceForRentExemption",
  "getSecretSharingPubkey",
  "getAccountsByOwner",
]);

function rpcError(id: unknown, code: number, message: string, status = 400) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

function firstParam(params: unknown): Record<string, unknown> | undefined {
  return Array.isArray(params) && params[0] && typeof params[0] === "object" ? (params[0] as Record<string, unknown>) : undefined;
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return rpcError(null, -32600, "request too large", 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return rpcError(null, -32700, "parse error");
  }
  if (Array.isArray(body)) return rpcError(null, -32600, "batch requests are not allowed");
  if (!body || typeof body !== "object") return rpcError(null, -32600, "invalid request");
  const { id, method, params } = body as { id?: unknown; method?: unknown; params?: unknown };
  if (typeof method !== "string") return rpcError(id, -32600, "missing method");
  // One network's share of the relay: generous for a wallet's confirm loops, not an open proxy.
  if (!(await allow(rule(`relay:${ipKey(request)}`, 300, 60_000)))) return rpcError(id, -32005, "too many requests, slow down", 429);

  if (method === "getAccountsByOwner" && firstParam(params)?.owner !== PROGRAM_ID) {
    return rpcError(id, -32602, "only Merit program accounts can be listed");
  }
  if (method === "sendTransaction") {
    if (!Array.isArray(params) || typeof params[0] !== "string" || params[0].length > MAX_TX_BASE64) {
      return rpcError(id, -32602, "invalid transaction");
    }
  } else if (method === "requestAirdrop") {
    const kelvins = firstParam(params)?.kelvins;
    const wallet = firstParam(params)?.pubkey;
    if (typeof kelvins !== "number" || !Number.isSafeInteger(kelvins) || kelvins <= 0 || BigInt(kelvins) > FAUCET_MAX_KELVIN) {
      return rpcError(id, -32602, "faucet requests are capped at 1 RLO");
    }
    if (typeof wallet !== "string" || !isAddress(wallet)) return rpcError(id, -32602, "invalid wallet address");
    // Forward exactly what was checked, never the caller's own params.
    return faucet(request, id, wallet, BigInt(kelvins), [{ pubkey: wallet, kelvins }]);
  } else if (!READ_METHODS.has(method)) {
    return rpcError(id, -32601, `method ${method} is not allowed through this relay`);
  }

  return forward(id, method, params);
}

async function forward(id: unknown, method: string, params: unknown) {
  const upstream = await fetch(RPC_UPSTREAM, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: id ?? 1, method, params }),
    cache: "no-store",
  });
  const text = await upstream.text();
  return new NextResponse(text, { status: upstream.ok ? 200 : 502, headers: { "content-type": "application/json" } });
}

/** The faucet, limited per wallet and per IP in Postgres. Fails closed: without the database it sends nothing. */
async function faucet(request: NextRequest, id: unknown, wallet: string, kelvin: bigint, params: unknown) {
  let db;
  try {
    db = await getDb();
  } catch {
    return rpcError(id, -32005, "the faucet is unavailable right now, try again later", 503);
  }
  const ipHash = hashIp(clientKey(request));
  const balance = await new RpcClient(RPC_UPSTREAM).balance(wallet).catch(() => null);
  const verdict = await faucetVerdict(db, wallet, ipHash, balance);
  if (!verdict.ok) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: id ?? null, error: { code: -32005, message: verdict.message, data: { reason: verdict.reason, nextAt: verdict.nextAt?.toISOString() ?? null } } },
      { status: 429 },
    );
  }
  const grant = await reserveGrant(db, wallet, ipHash, kelvin);
  if (!grant) return rpcError(id, -32005, "This wallet just got faucet RLO. Next faucet in 24 h.", 429);
  const response = await forward(id, "requestAirdrop", params);
  const body = (await response.clone().json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok || !body || body.error) await releaseGrant(db, grant.id).catch(() => undefined);
  return response;
}

export function GET() {
  return rpcError(null, -32600, "use POST", 405);
}
