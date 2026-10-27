// Same-origin JSON-RPC relay to Rialo DevNet. DevNet sends no CORS headers,
// so the browser talks to this route instead. It fails closed: one request
// per call (no batches), an explicit method allowlist, and the faucet capped
// at 1 RLO per call.

import { NextResponse, type NextRequest } from "next/server";
import { FAUCET_MAX_KELVIN, PROGRAM_ID, RPC_UPSTREAM } from "@/lib/merit/constants";

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

// Per-instance faucet throttle. Serverless instances are short-lived, so this
// is a speed bump, not a guarantee; DevNet's faucet has its own limits.
const faucetHits = new Map<string, number[]>();
const FAUCET_WINDOW_MS = 10 * 60_000;
const FAUCET_PER_WINDOW = 3;

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

  if (method === "getAccountsByOwner" && firstParam(params)?.owner !== PROGRAM_ID) {
    return rpcError(id, -32602, "only Merit program accounts can be listed");
  }
  if (method === "sendTransaction") {
    if (!Array.isArray(params) || typeof params[0] !== "string" || params[0].length > MAX_TX_BASE64) {
      return rpcError(id, -32602, "invalid transaction");
    }
  } else if (method === "requestAirdrop") {
    const kelvins = firstParam(params)?.kelvins;
    if (typeof kelvins !== "number" || !Number.isSafeInteger(kelvins) || kelvins <= 0 || BigInt(kelvins) > FAUCET_MAX_KELVIN) {
      return rpcError(id, -32602, "faucet requests are capped at 1 RLO");
    }
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const now = Date.now();
    const recent = (faucetHits.get(ip) ?? []).filter((t) => now - t < FAUCET_WINDOW_MS);
    if (recent.length >= FAUCET_PER_WINDOW) return rpcError(id, -32005, "faucet limit reached, try again in a few minutes", 429);
    faucetHits.set(ip, [...recent, now]);
  } else if (!READ_METHODS.has(method)) {
    return rpcError(id, -32601, `method ${method} is not allowed through this relay`);
  }

  const upstream = await fetch(RPC_UPSTREAM, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: id ?? 1, method, params }),
    cache: "no-store",
  });
  const text = await upstream.text();
  return new NextResponse(text, { status: upstream.ok ? 200 : 502, headers: { "content-type": "application/json" } });
}

export function GET() {
  return rpcError(null, -32600, "use POST", 405);
}
