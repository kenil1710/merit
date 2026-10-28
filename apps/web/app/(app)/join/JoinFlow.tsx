"use client";

import type { Keypair } from "@rialo/ts-cdk";
import { ArrowRight, AtSign, Link2, Send } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { HexValue } from "@/components/hex-value";
import { StatusBadge } from "@/components/status-badge";
import { Card, EmptyState, Notice } from "@/components/ui-kit";
import { Stepper, type Step } from "@/components/ui-kit/stepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WalletPanel } from "@/components/wallet-panel";
import { signMessage } from "@/lib/client/wallet";
import { formatRlo } from "@/lib/merit/constants";
import { linkMessage } from "@/lib/merit/messages";
import type { RoundState } from "@/lib/shared/round-window";

type OpenCampaign = {
  address: string;
  name: string;
  brief: string;
  roundEndMs: number;
  round: number;
  minScore: number;
  rateKelvin: string;
  state: RoundState;
  takesSubmissions: boolean;
  nextOpensAtMs: number | null;
  statusText: string;
};
type SessionInfo = { signInAvailable: boolean; signInMissing: string | null; session: { xUserId: string; username: string } | null; wallet: string | null };
type Result = { outcome: string; score: number; reasons: string[]; minScore?: number; approveSignature?: string; openLedgerSignature?: string };

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, until - now);
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <span className="bg-brand-subtle text-brand-soft inline-flex h-6 items-center rounded-md px-2 font-mono text-xs tabular-nums">
      {left === 0 ? "closing" : `${m}:${String(s).padStart(2, "0")} left`}
    </span>
  );
}

export function JoinFlow({ campaigns }: { campaigns: OpenCampaign[] }) {
  const params = useSearchParams();
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  const [campaign, setCampaign] = useState(campaigns[0]?.address ?? "");
  const router = useRouter();
  // Between rounds the page reloads itself once the next round should be open, so it never sits on a stale status.
  useEffect(() => {
    const next = campaigns.map((c) => (c.state === "open" ? c.roundEndMs : c.nextOpensAtMs)).filter((t): t is number => t !== null && t > Date.now());
    if (!next.length) return;
    const id = setTimeout(() => router.refresh(), Math.min(...next) - Date.now() + 5_000);
    return () => clearTimeout(id);
  }, [campaigns, router]);
  const [postUrl, setPostUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(params.get("error"));
  const [result, setResult] = useState<Result | null>(null);

  const load = () => fetch("/api/session").then((r) => r.json()).then(setInfo);
  useEffect(() => {
    void load();
  }, []);

  const signedIn = Boolean(info?.session);
  const linked = Boolean(info?.wallet && keypair && info.wallet === keypair.publicKey.toString());
  const selected = campaigns.find((c) => c.address === campaign);

  const steps: Step[] = [
    { key: "x", label: "Sign in with X", status: signedIn ? "done" : "current", meta: info?.session ? `@${info.session.username}` : undefined },
    { key: "wallet", label: "Link a Rialo wallet", status: linked ? "done" : signedIn ? "current" : "waiting" },
    { key: "post", label: "Submit a post", status: result ? "done" : linked ? "current" : "waiting" },
    {
      key: "decision",
      label: "Judged, verified, paid",
      status: result?.outcome === "approved" ? "current" : result ? "failed" : "waiting",
      meta: result ? `score ${result.score}` : undefined,
    },
  ];

  async function link() {
    if (!keypair || !info?.session) return;
    setBusy("Linking…");
    setError(null);
    try {
      const issuedAt = new Date().toISOString();
      const wallet = keypair.publicKey.toString();
      const signature = signMessage(keypair, linkMessage(info.session.xUserId, info.session.username, wallet, issuedAt));
      const response = await fetch("/api/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet, signature, issuedAt }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    setBusy("Judging and approving… about 15 seconds");
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaign, postUrl }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setResult(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid content-start gap-5">
        <Card
          title={<span className="inline-flex items-center gap-2"><AtSign className="text-brand size-4" strokeWidth={1.5} /> 1 · Sign in with X</span>}
          description="Merit reads only your account id and handle, once. No X token is stored."
        >
          {!info ? (
            <p className="text-muted-foreground text-sm">Checking…</p>
          ) : info.session ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span>
                Signed in as <strong>@{info.session.username}</strong> <span className="text-muted-foreground font-mono">({info.session.xUserId})</span>
              </span>
              <form action="/api/auth/logout" method="post">
                <Button variant="ghost" size="sm" type="submit">Sign out</Button>
              </form>
            </div>
          ) : info.signInAvailable ? (
            <Button asChild className="h-10 px-4">
              <a href="/api/auth/x/start?returnTo=/join">Sign in with X</a>
            </Button>
          ) : (
            <Notice tone="warning">X sign-in is not configured on this server yet ({info.signInMissing}). Nothing below works without it.</Notice>
          )}
        </Card>

        <WalletPanel onChange={setKeypair} purpose="2 · Payouts go to this address. Create one, or unlock the one saved in this browser, then link it to your X account." />
        {keypair && info?.session && !linked ? (
          <Button className="h-10 w-fit px-4" disabled={Boolean(busy)} onClick={link}>
            <Link2 className="size-4" />
            {busy === "Linking…" ? busy : `Link this wallet to @${info.session.username}`}
          </Button>
        ) : null}
        {info?.wallet ? (
          <p className="text-muted-foreground -mt-2 inline-flex flex-wrap items-center gap-2 text-xs">
            Linked wallet <HexValue value={info.wallet} label="linked wallet" /> · linking signs a message, no transaction, no fee
          </p>
        ) : null}

        <Card
          title={<span className="inline-flex items-center gap-2"><Send className="text-brand size-4" strokeWidth={1.5} /> 3 · Submit a post</span>}
          description="Post from your signed-in account after the round opened, then paste the link."
        >
          {campaigns.length === 0 ? (
            <EmptyState art="box" title="No campaign is running" action={{ label: "Explore campaigns", href: "/explore" }}>
              No campaign has a round open or about to open. Running campaigns appear here with a countdown.
            </EmptyState>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="campaign">Campaign</Label>
                <select
                  id="campaign"
                  className="border-input dark:bg-input/30 h-10 rounded-lg border bg-transparent px-2.5 text-sm"
                  value={campaign}
                  onChange={(e) => setCampaign(e.target.value)}
                >
                  {campaigns.map((c) => (
                    <option key={c.address} value={c.address}>
                      {c.name} · round {c.state === "open" ? c.round : `${c.round + 1} next`}
                    </option>
                  ))}
                </select>
              </div>
              {selected ? (
                <div className="bg-muted/50 rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="label">Brief</p>
                    {selected.state === "open" ? <Countdown until={selected.roundEndMs} /> : null}
                  </div>
                  <p className="mt-2 text-sm font-medium" data-testid="round-status">
                    {selected.statusText}.
                  </p>
                  {selected.state === "closing" && selected.takesSubmissions ? (
                    <p className="text-muted-foreground mt-1 text-xs">Posts written during round {selected.round} can still be submitted until it pays out.</p>
                  ) : null}
                  <p className="mt-2 text-sm leading-relaxed">{selected.brief}</p>
                  <p className="text-muted-foreground mt-2 text-xs">
                    Score 100 pays <span className="font-mono">{formatRlo(BigInt(selected.rateKelvin))} RLO</span> · minimum score {selected.minScore}
                  </p>
                </div>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="post-url">Post link</Label>
                <Input id="post-url" className="h-10" placeholder="https://x.com/you/status/…" value={postUrl} onChange={(e) => setPostUrl(e.target.value)} />
              </div>
              <Button className="h-10 w-fit px-4" disabled={!linked || !postUrl || Boolean(busy) || !selected?.takesSubmissions} onClick={submit}>
                {busy && busy !== "Linking…" ? busy : "Submit for judging"}
              </Button>
              {!linked ? <p className="text-muted-foreground text-xs">Sign in and link an unlocked wallet first.</p> : null}
            </div>
          )}
        </Card>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </div>

      <aside className="grid content-start gap-5">
        <Card title="Your progress">
          <Stepper steps={steps} size="sm" />
        </Card>
        {result ? (
          <Card title="Decision">
            <div className="flex items-center gap-3">
              <span className="display text-5xl leading-none tabular-nums">{result.score}</span>
              <StatusBadge status={result.outcome === "approved" ? "approved" : "below_minimum"} />
            </div>
            <ul className="text-soft mt-4 list-disc space-y-1 pl-5 text-sm">{result.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            {result.outcome === "approved" ? (
              <div className="mt-4 grid gap-2 text-sm">
                <span className="inline-flex flex-wrap items-center gap-2">Approved on chain {result.approveSignature ? <HexValue value={result.approveSignature} href={`/tx/${result.approveSignature}`} label="approve transaction" /> : null}</span>
                <p className="text-muted-foreground">Validators are verifying the post now; payment arrives when the round ends.</p>
                <Button asChild variant="outline" size="sm" className="w-fit">
                  <Link href={`/c/${campaign}`}>Watch it on the campaign <ArrowRight className="size-3.5" /></Link>
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground mt-4 text-sm">Not approved{result.minScore !== undefined ? ` (minimum ${result.minScore})` : ""}. Nothing was sent on chain.</p>
            )}
          </Card>
        ) : (
          <Card title="What happens">
            <ol className="text-soft grid list-decimal gap-2 pl-5 text-sm leading-relaxed">
              <li>Merit reads your post through the merit-x latch and checks it is yours and new.</li>
              <li>Claude scores it through the merit-judge latch. The reasons&apos; hash goes on chain.</li>
              <li>A passing score is approved on chain; validators fetch the post and must agree on its author and time.</li>
              <li>When the round ends, an on-chain timer pays you.</li>
            </ol>
          </Card>
        )}
      </aside>
    </div>
  );
}
