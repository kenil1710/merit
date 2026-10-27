"use client";

import type { Keypair } from "@rialo/ts-cdk";
import { ArrowUpRight, Fuel, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { HexValue } from "@/components/hex-value";
import { KelvinText } from "@/components/kelvin-text";
import { phaseStatus, StatusBadge } from "@/components/status-badge";
import { Card, Notice } from "@/components/ui-kit";
import { ConfirmDialog } from "@/components/ui-kit/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WalletPanel } from "@/components/wallet-panel";
import { sendInstruction, signMessage } from "@/lib/client/wallet";
import { hex, unhex } from "@/lib/merit/codec";
import { MAX_ROUND_MS, MIN_ROUND_MS, formatRlo, parseRlo } from "@/lib/merit/constants";
import { ix, type PlainInstruction } from "@/lib/merit/instructions";
import { campaignMessage } from "@/lib/merit/messages";
import { randomSlug, workflowAddress } from "@/lib/merit/pda";

type Owned = {
  address: string; name: string | null; slug: string | null; phase: number; ending: boolean; round: number;
  roundStartMs: number; roundEndMs: number; refundDeadlineMs: number; roundLengthMs: number; nextRoundLengthMs: number;
  escrow: string; ops: string; paid: string; capPerRound: string; agent: string; verificationsLeft: number;
};

type Log = { label: string; signature?: string; lines?: string[]; error?: string };
type Run = (steps: { label: string; build: () => PlainInstruction | Promise<void> }[]) => Promise<void>;

const LOW_VERIFICATIONS = 3;
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

function unreserved(c: Owned): bigint {
  const escrow = BigInt(c.escrow);
  if (c.phase === 0 || c.phase === 4) return escrow;
  if (c.phase === 1) return escrow > BigInt(c.capPerRound) ? escrow - BigInt(c.capPerRound) : 0n;
  return 0n;
}

export function OwnerDashboard() {
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  const [owned, setOwned] = useState<Owned[]>([]);
  const [agent, setAgent] = useState<string>("");
  const [log, setLog] = useState<Log[]>([]);
  const [busy, setBusy] = useState(false);
  const owner = keypair?.publicKey.toString();

  const reload = useCallback(async () => {
    if (!owner) return setOwned([]);
    const body = await fetch(`/api/owner?wallet=${owner}`).then((r) => r.json());
    setOwned(body.campaigns ?? []);
  }, [owner]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    fetch("/api/agent").then((r) => r.json()).then((b) => setAgent(b.agent ?? ""));
  }, []);

  const run: Run = async (steps) => {
    if (!keypair) return;
    setBusy(true);
    try {
      for (const step of steps) {
        const built = await step.build();
        if (!built) {
          setLog((l) => [{ label: step.label }, ...l]);
          continue;
        }
        try {
          const { signature, lines } = await sendInstruction(keypair, built);
          setLog((l) => [{ label: step.label, signature, lines }, ...l]);
        } catch (e) {
          setLog((l) => [{ label: step.label, error: (e as Error).message }, ...l]);
          break;
        }
      }
    } finally {
      setBusy(false);
      await reload();
    }
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid content-start gap-6">
        <WalletPanel
          onChange={setKeypair}
          purpose="The owner wallet funds escrow and signs every owner instruction here. DevNet charges no fees; creating a campaign keeps about 0.005 RLO as account rent."
        />
        {keypair ? (
          <>
            {owned.map((c) => <ManageCampaign key={c.address} c={c} owner={owner!} busy={busy} run={run} />)}
            <CreateCampaign owner={owner!} agent={agent} busy={busy} keypair={keypair} run={run} />
          </>
        ) : (
          <Notice tone="info">Unlock or create a wallet to see your campaigns and start a new one.</Notice>
        )}
      </div>
      <aside className="xl:sticky xl:top-6 xl:self-start">
        <Card title="Transactions this session" description="Signed in this browser, sent through Merit's relay to Rialo DevNet.">
          {log.length === 0 ? <p className="text-muted-foreground text-sm">Nothing sent yet.</p> : null}
          <ul className="grid gap-3 text-sm">
            {log.map((entry, i) => (
              <li key={i} className="bg-muted/50 rounded-xl p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{entry.label}</span>
                  {entry.signature ? <HexValue value={entry.signature} href={`/tx/${entry.signature}`} label="transaction" head={6} tail={0} /> : null}
                </div>
                {entry.lines?.map((line) => <div key={line} className="text-muted-foreground mt-1 text-xs break-all"><KelvinText text={line} /></div>)}
                {entry.error ? <div className="text-danger mt-1 text-xs">{entry.error}</div> : null}
              </li>
            ))}
          </ul>
        </Card>
      </aside>
    </div>
  );
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p> : null}
    </div>
  );
}

function CreateCampaign({ owner, agent, busy, keypair, run }: { owner: string; agent: string; busy: boolean; keypair: Keypair; run: Run }) {
  const [f, setF] = useState({
    name: "", brief: "", rate: "0.1", minScore: "50", capPayout: "0.1", capContributor: "0.2", capRound: "0.5",
    roundMinutes: "5", deadlineDays: "1", escrow: "1", ops: "0.2", start: true,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  async function create() {
    setError(null);
    try {
      if (!agent) throw new Error("The server's agent key is not configured.");
      if (!f.name.trim() || !f.brief.trim()) throw new Error("Give the campaign a name and a brief: the judge scores against the brief.");
      const roundMs = BigInt(Math.round(Number(f.roundMinutes) * 60_000));
      if (roundMs < BigInt(MIN_ROUND_MS) || roundMs > BigInt(MAX_ROUND_MS)) throw new Error("Round length must be between 1 minute and 7 days.");
      const config = {
        agent,
        rateKelvin: parseRlo(f.rate),
        minScore: BigInt(f.minScore),
        capPerPayout: parseRlo(f.capPayout),
        capPerContributor: parseRlo(f.capContributor),
        capPerRound: parseRlo(f.capRound),
        roundLengthMs: roundMs,
        refundDeadlineMs: BigInt(Date.now() + Math.round(Number(f.deadlineDays) * 86_400_000)),
      };
      if (!(config.rateKelvin <= config.capPerPayout && config.capPerPayout <= config.capPerContributor && config.capPerContributor <= config.capPerRound)) {
        throw new Error("Caps must satisfy: score-100 payout ≤ per payout ≤ per contributor ≤ per round.");
      }
      const slug = randomSlug();
      const address = workflowAddress(owner, slug);
      const escrow = parseRlo(f.escrow);
      const ops = parseRlo(f.ops);
      await run([
        { label: "Create campaign", build: () => ix.createCampaign(owner, slug, config) },
        {
          label: "Publish name and brief",
          build: async () => {
            const signature = signMessage(keypair, campaignMessage(address, f.name.trim(), f.brief.trim()));
            const response = await fetch("/api/campaigns", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ address, slug: hex(slug), name: f.name.trim(), brief: f.brief.trim(), signature }),
            });
            if (!response.ok) throw new Error((await response.json()).error);
          },
        },
        ...(escrow > 0n ? [{ label: `Fund escrow ${formatRlo(escrow)} RLO`, build: () => ix.fund(owner, slug, escrow) }] : []),
        ...(ops > 0n ? [{ label: `Fund operations ${formatRlo(ops)} RLO`, build: () => ix.fundOps(owner, slug, ops) }] : []),
        ...(f.start && escrow > 0n ? [{ label: "Open round 1", build: () => ix.start(owner, slug) }] : []),
      ]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><Plus className="text-brand size-4" strokeWidth={1.75} /> New campaign</span>}
      description="Everything below becomes on-chain rules except the name and brief, which you sign and publish."
    >
      <div className="grid gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" id="c-name"><Input id="c-name" className="h-10" value={f.name} onChange={set("name")} maxLength={80} /></Field>
          <div className="grid content-start gap-1.5">
            <Label>Agent</Label>
            <div className="bg-muted/50 flex h-10 items-center rounded-lg px-3">{agent ? <HexValue value={agent} label="agent" head={10} tail={6} /> : <span className="text-muted-foreground text-sm">not configured</span>}</div>
            <p className="text-muted-foreground text-xs">Merit&apos;s agent key on this server. Rotate later with set_agent.</p>
          </div>
          <div className="sm:col-span-2">
            <Field label="Brief" id="c-brief" hint="What contributors should post. The judge scores every post against this text.">
              <Textarea id="c-brief" className="min-h-24" value={f.brief} onChange={set("brief")} maxLength={1200} />
            </Field>
          </div>
        </div>

        <div className="grid gap-3">
          <p className="label">Payouts and caps (enforced on chain)</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Score 100 pays (RLO)" id="c-rate"><Input id="c-rate" className="h-10" value={f.rate} onChange={set("rate")} /></Field>
            <Field label="Minimum score" id="c-min"><Input id="c-min" className="h-10" value={f.minScore} onChange={set("minScore")} /></Field>
            <Field label="Cap per payout (RLO)" id="c-cap-p"><Input id="c-cap-p" className="h-10" value={f.capPayout} onChange={set("capPayout")} /></Field>
            <Field label="Cap per contributor per round (RLO)" id="c-cap-c"><Input id="c-cap-c" className="h-10" value={f.capContributor} onChange={set("capContributor")} /></Field>
            <Field label="Cap per round (RLO)" id="c-cap-r"><Input id="c-cap-r" className="h-10" value={f.capRound} onChange={set("capRound")} /></Field>
          </div>
        </div>

        <div className="grid gap-3">
          <p className="label">Rounds and funding</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Round length (minutes)" id="c-round" hint="Demo default 5. Up to 7 days (10080)."><Input id="c-round" className="h-10" value={f.roundMinutes} onChange={set("roundMinutes")} /></Field>
            <Field label="Refund deadline (days from now)" id="c-deadline"><Input id="c-deadline" className="h-10" value={f.deadlineDays} onChange={set("deadlineDays")} /></Field>
            <Field label="Initial escrow (RLO)" id="c-escrow"><Input id="c-escrow" className="h-10" value={f.escrow} onChange={set("escrow")} /></Field>
            <Field label="Operations budget (RLO)" id="c-ops" hint="Repays the agent 0.012 RLO per REX verification plus ~0.024 RLO ledger rent per round with approvals.">
              <Input id="c-ops" className="h-10" value={f.ops} onChange={set("ops")} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-[var(--brand)] size-4" checked={f.start} onChange={set("start")} /> Open round 1 right away
          </label>
        </div>

        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button className="h-10 w-fit px-5" disabled={busy} onClick={create}>
          {busy ? "Working…" : "Create and fund"}
        </Button>
      </div>
    </Card>
  );
}

function ManageCampaign({ c, owner, busy, run }: { c: Owned; owner: string; busy: boolean; run: Run }) {
  const [amount, setAmount] = useState("0.5");
  const [minutes, setMinutes] = useState(String(c.nextRoundLengthMs / 60_000));
  const [slugText, setSlugText] = useState(c.slug ?? "");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const slug = /^[0-9a-f]{64}$/.test(slugText) && workflowAddress(owner, unhex(slugText)) === c.address ? unhex(slugText) : null;
  const free = unreserved(c);
  const opsFree = c.phase === 0 || c.phase === 4 ? BigInt(c.ops) : 0n;
  const pastDeadline = Date.now() >= c.refundDeadlineMs;
  const act = (label: string, build: (s: Uint8Array) => PlainInstruction) => slug && run([{ label, build: () => build(slug) }]);
  const low = c.verificationsLeft < LOW_VERIFICATIONS;

  return (
    <Card
      title={<span className="display text-[1.75rem] leading-tight">{c.name ?? "Unnamed campaign"}</span>}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <HexValue value={c.address} label="campaign" head={10} tail={6} />
          <Link href={`/c/${c.address}`} className="hover:text-foreground inline-flex items-center gap-0.5 underline-offset-4 hover:underline">
            Public page <ArrowUpRight className="size-3" />
          </Link>
        </span>
      }
      actions={<StatusBadge status={phaseStatus(c.phase)} />}
    >
      <div className="grid gap-6">
        <div className="grid grid-cols-2 gap-3">
          <Tile label="Escrow" value={formatRlo(BigInt(c.escrow), 3)} unit="RLO" />
          <Tile label="Paid" value={formatRlo(BigInt(c.paid), 3)} unit="RLO" success />
          <Tile label="Round" value={String(c.round)} unit={c.phase === 1 ? `ends ${utc(c.roundEndMs).slice(11)}` : c.ending && c.phase < 4 ? "ending" : ""} />
          <div className={`rounded-2xl p-4 ${low ? "bg-danger-subtle" : "bg-muted/50"}`}>
            <p className="label inline-flex items-center gap-1.5"><Fuel className="size-3" /> Operations budget</p>
            <p className="display mt-1.5 text-2xl leading-none tabular-nums">{formatRlo(BigInt(c.ops), 3)}<span className="text-muted-foreground ml-1 font-sans text-xs">RLO</span></p>
            <p className={`mt-1.5 text-xs ${low ? "text-danger" : "text-muted-foreground"}`}>≈ {c.verificationsLeft} verifications left</p>
          </div>
        </div>
        {low ? (
          <Notice tone="danger">The operations budget is low. When it cannot cover another verification, the program refuses new approvals. Fund it below.</Notice>
        ) : null}

        {!slug ? (
          <Field label="Campaign slug" id={`slug-${c.address}`} hint="Created outside this app? Paste its 32-byte hex slug to manage it here.">
            <Input id={`slug-${c.address}`} className="h-10 font-mono" value={slugText} onChange={(e) => setSlugText(e.target.value.trim())} />
          </Field>
        ) : (
          <div className="grid gap-5">
            <div className="grid gap-2">
              <p className="label">Treasury</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`amt-${c.address}`}>Amount (RLO)</Label>
                  <Input id={`amt-${c.address}`} className="h-9 w-32" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <Button variant="outline" disabled={busy || c.phase >= 4 || c.ending} onClick={() => act("Fund escrow", (s) => ix.fund(owner, s, parseRlo(amount)))}>Fund escrow</Button>
                <Button variant="outline" disabled={busy || c.phase >= 4} onClick={() => act("Fund operations", (s) => ix.fundOps(owner, s, parseRlo(amount)))}>Fund operations</Button>
                <Button variant="outline" disabled={busy || free === 0n} onClick={() => act("Withdraw escrow", (s) => ix.withdraw(owner, s, parseRlo(amount)))}>Withdraw (≤ {formatRlo(free, 3)})</Button>
                <Button variant="outline" disabled={busy || opsFree === 0n} onClick={() => act("Withdraw operations", (s) => ix.withdrawOps(owner, s, parseRlo(amount)))}>Withdraw ops (≤ {formatRlo(opsFree, 3)})</Button>
              </div>
            </div>
            <div className="grid gap-2">
              <p className="label">Rounds</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`len-${c.address}`}>Next round length (minutes)</Label>
                  <Input id={`len-${c.address}`} className="h-9 w-32" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                </div>
                <Button variant="outline" disabled={busy} onClick={() => act("Set round length", (s) => ix.setRoundLength(owner, s, BigInt(Math.round(Number(minutes) * 60_000))))}>Set length</Button>
                <Button disabled={busy || c.phase !== 0 || c.ending || BigInt(c.escrow) === 0n} onClick={() => act("Open a round", (s) => ix.start(owner, s))}>Open a round</Button>
                <Button variant="outline" disabled={busy || (c.phase !== 1 && c.phase !== 2)} onClick={() => act("Resume heartbeat", (s) => ix.resume(owner, s))} title="Re-arm the round timer if it stopped.">Resume heartbeat</Button>
                <Button variant="outline" disabled={busy || !pastDeadline || ![0, 3, 4].includes(c.phase)} onClick={() => act("Refund at deadline", (s) => ix.refund(owner, s))}>Refund</Button>
                <Button variant="destructive" disabled={busy || c.phase >= 4} onClick={() => setConfirmEnd(true)}>End campaign</Button>
              </div>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="End this campaign?"
        description="An open round still settles and pays verified entries; then no new round opens. This cannot be undone."
        rows={[{ label: "Escrow left after settlement", value: "withdrawable by you" }]}
        confirmLabel="End campaign"
        destructive
        onConfirm={() => {
          setConfirmEnd(false);
          act("End campaign", (s) => ix.end(owner, s));
        }}
      />
    </Card>
  );
}

function Tile({ label, value, unit, success }: { label: string; value: string; unit?: string; success?: boolean }) {
  return (
    <div className="bg-muted/50 rounded-2xl p-4">
      <p className="label">{label}</p>
      <p className={`display mt-1.5 text-2xl leading-none tabular-nums ${success ? "text-success" : ""}`}>
        {value}
        {unit ? <span className="text-muted-foreground ml-1 font-sans text-xs">{unit}</span> : null}
      </p>
    </div>
  );
}
