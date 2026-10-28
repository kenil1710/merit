// When a wallet can next use the DevNet faucet (the relay's per-wallet, per-IP and balance limits), for the UI.

import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { RpcClient } from "@/lib/merit/chain";
import { RPC_UPSTREAM } from "@/lib/merit/constants";
import { isAddress } from "@/lib/server/agent";
import { faucetVerdict, hashIp } from "@/lib/server/faucet";
import { jsonError } from "@/lib/server/http";
import { clientKey } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet") ?? "";
  if (!isAddress(wallet)) return jsonError("invalid wallet address", 400);
  try {
    const balance = await new RpcClient(RPC_UPSTREAM).balance(wallet).catch(() => null);
    const verdict = await faucetVerdict(await getDb(), wallet, hashIp(clientKey(request)), balance);
    const body = verdict.ok ? { ok: true, reason: null, message: null, nextAt: null } : { ok: false, reason: verdict.reason, message: verdict.message, nextAt: verdict.nextAt?.toISOString() ?? null };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, reason: "unavailable", message: "The faucet is unavailable right now.", nextAt: null }, { status: 503 });
  }
}
