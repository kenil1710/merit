// A contributor submits a post for a campaign. Fails closed at every step:
// signed in with X, wallet linked, round open, post written by that account
// inside the round, not already judged. Then the judge scores it; a score at
// or above the campaign minimum is approved on chain, which starts REX
// verification. Payment happens later, on chain, when the round ends.

import { NextResponse, type NextRequest } from "next/server";
import { loadState } from "@/lib/merit/chain";
import { PHASE_NAMES } from "@/lib/merit/constants";
import type { StoredJudgement } from "@/lib/merit/judgement";
import { approveOnChain, ensureLedger, rpc } from "@/lib/server/agent";
import { ConfigError } from "@/lib/server/env";
import { judgePost } from "@/lib/server/judge";
import { LatchDenied, readPost } from "@/lib/server/latch";
import { getSession } from "@/lib/server/session";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/// Leave time for the approval and its REX check to land before the round closes.
const CLOSING_MARGIN_MS = 20_000;

function postIdFrom(url: string): string | null {
  const match = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/(\d{1,20})(?:[/?#].*)?$/.exec(url.trim());
  return match?.[1] ?? null;
}

function refuse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return refuse("Sign in with X first.", 401);
    const link = await store.link(session.xUserId);
    if (!link) return refuse("Link a Rialo wallet first.");
    const { campaign: address, postUrl } = (await request.json()) as { campaign?: string; postUrl?: string };
    if (!address || !postUrl) return refuse("Missing campaign or post link.");
    const postId = postIdFrom(postUrl);
    if (!postId) return refuse("That is not an X post link (x.com/<handle>/status/<id>).");

    const meta = await store.campaign(address);
    if (!meta) return refuse("Unknown campaign.", 404);
    const campaign = await loadState(rpc, address);
    if (!campaign) return refuse("Campaign not found on chain.", 404);
    const now = Date.now();
    if (campaign.phase !== 1n) return refuse(`This campaign is not taking submissions (${PHASE_NAMES[String(campaign.phase)]}).`);
    if (now > Number(campaign.roundEndMs) - CLOSING_MARGIN_MS) return refuse("This round closes in under 20 seconds. Submit in the next round.");
    if (await store.judgement(postId)) return refuse("This post was already submitted.");

    const post = await readPost(postId, address);
    if (post.author_id !== session.xUserId) return refuse(`That post is not from @${session.username}.`);
    const created = Date.parse(post.created_at);
    if (created < Number(campaign.roundStartMs)) return refuse("That post was written before this round opened. Post again now.");

    const verdict = await judgePost(post, session.xUserId, meta.brief, address);
    const base: StoredJudgement = {
      campaign: address,
      round: Number(campaign.round),
      contributor: link.wallet,
      xUsername: session.username,
      canonical: verdict.canonical,
      submissionHash: verdict.submissionHash,
      text: post.text,
      judgedAt: new Date().toISOString(),
    };
    const passedChecks = Object.values(verdict.record.checks).every(Boolean);
    if (!passedChecks || BigInt(verdict.record.score) < campaign.minScore) {
      const outcome = passedChecks ? "below_minimum" : "failed_checks";
      await store.saveJudgement(postId, { ...base, outcome });
      return NextResponse.json({ outcome, score: verdict.record.score, reasons: verdict.record.reasons, minScore: Number(campaign.minScore) });
    }

    let opened: string | undefined;
    try {
      opened = (await ensureLedger(campaign)).opened;
      const approveSignature = await approveOnChain(campaign, {
        contributor: link.wallet,
        xUserId: BigInt(session.xUserId),
        postId: BigInt(postId),
        score: BigInt(verdict.record.score),
        submissionHash: verdict.submissionHash,
      });
      await store.saveJudgement(postId, { ...base, outcome: "approved", openLedgerSignature: opened, approveSignature });
      return NextResponse.json({ outcome: "approved", score: verdict.record.score, reasons: verdict.record.reasons, approveSignature, openLedgerSignature: opened });
    } catch (error) {
      const message = (error as Error).message;
      await store.saveJudgement(postId, { ...base, outcome: "approve_failed", openLedgerSignature: opened, error: message });
      return refuse(`The judge scored ${verdict.record.score}, but the on-chain approval failed: ${message}`, 502);
    }
  } catch (error) {
    if (error instanceof LatchDenied) return refuse(error.message, 502);
    if (error instanceof ConfigError) return refuse(`Server not configured: ${error.message}`, 503);
    return refuse((error as Error).message, 500);
  }
}
