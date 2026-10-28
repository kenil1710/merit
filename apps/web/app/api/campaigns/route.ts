// Registers a campaign's public name and brief. The campaign must already
// exist on chain at workflowAddress(owner, slug), and the owner's wallet must
// sign the exact name and brief, so nobody else can describe it.

import { NextResponse, type NextRequest } from "next/server";
import { loadState } from "@/lib/merit/chain";
import { unhex } from "@/lib/merit/codec";
import { campaignMessage, verifySignature } from "@/lib/merit/messages";
import { workflowAddress } from "@/lib/merit/pda";
import { rpc } from "@/lib/server/agent";
import { sameOrigin } from "@/lib/server/http";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await store.campaigns());
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  const body = (await request.json()) as { address?: string; slug?: string; name?: string; brief?: string; signature?: string };
  const { address, slug, name, brief, signature } = body;
  if (!address || !slug || !/^[0-9a-f]{64}$/.test(slug) || !name || !brief || !signature) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }
  if (name.length > 80 || brief.length > 1200) return NextResponse.json({ error: "Name or brief too long." }, { status: 400 });
  const state = await loadState(rpc, address);
  if (!state || state.kind !== 1n) return NextResponse.json({ error: "No campaign at that address." }, { status: 404 });
  if (workflowAddress(state.owner, unhex(slug)) !== address) return NextResponse.json({ error: "Slug does not match the campaign." }, { status: 400 });
  if (!verifySignature(campaignMessage(address, name, brief), signature, state.owner)) {
    return NextResponse.json({ error: "Only the campaign owner can describe it." }, { status: 403 });
  }
  try {
    await store.saveCampaign({ address, owner: state.owner, slug, name, brief, createdAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: "This campaign is already described." }, { status: 409 });
  }
  return NextResponse.json({ address });
}
