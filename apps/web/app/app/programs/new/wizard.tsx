"use client";

import { ArrowLeft, ArrowRight, Check, Eye, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { z } from "zod";
import { ContextEditor } from "@/components/app/context-editor";
import { FocusHeader, FocusMain } from "@/components/app/focus-frame";
import { GoLive } from "@/components/app/go-live";
import { DevNetBadge } from "@/components/app/owner-shell";
import { VaultArt } from "@/components/brand/illustrations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { contextPayload, emptyContextDraft, type ContextDraft } from "@/lib/context-draft";
import { LIMIT_HELP, ON_CHAIN_LIMITS } from "@/lib/limits-help";
import { deriveDefaultLimits, itemNoun, limitWarnings, perfectPayout, rlo, tryParseRlo } from "@/lib/program-math";
import { ContextReadInput, parseMustInclude } from "@/lib/shared/context";
import { BudgetInput, LimitsInput, ProgramBasics, Rubric, SOURCE_LABELS, type SourceType } from "@/lib/shared/program";
import { cn } from "@/lib/utils";
import { fromNow, localAndUtc, minutesLabel, toLocalInput } from "@/lib/when";
import { STEP_META, STEPS } from "./wizard-steps";

// ─── Form state (strings, as typed) ─────────────────────────────────────────

type Criterion = { name: string; description: string };
type Category = { name: string; description: string; sourceTypes: SourceType[]; maxPoints: string; criteria: Criterion[]; rules: string };
type Limits = { maxPerPayout: string; maxPerContributor: string; maxPerRound: string; maxPerDay: string; autoApproveThreshold: string; payeeCooldownHours: string };
type Unit = "minutes" | "hours" | "days";
type Form = {
  basics: { name: string; slug: string; description: string; logoUrl: string };
  context: ContextDraft;
  rubric: { categories: Category[]; generalRules: string };
  budget: {
    ratePerPoint: string;
    roundLength: string;
    roundUnit: Unit;
    startMode: "now" | "later";
    /** datetime-local value in the owner's zone, used when startMode is "later". */
    firstRoundStartsAt: string;
    refundDeadlineDays: string;
    autoApproveConfidence: string;
    maxAutoApproveItem: string;
    minScore: string;
    minAccountAgeDays: string;
    minXFollowers: string;
    belowMinimum: "review" | "reject" | "block";
    maxSubmissionsPerRound: string;
    escrow: string;
    opsBudget: string;
  };
  limits: Limits;
  /** Until the owner edits a limit, limits (and the suggested escrow) follow the rubric. */
  limitsEdited: boolean;
  escrowEdited: boolean;
  slugEdited: boolean;
};

/** Sources the agent can judge today. GitHub and articles follow (see docs/PARITY.md, D3). */
const LIVE_SOURCES: SourceType[] = ["x_post"];

const STARTER_CATEGORIES: Category[] = [
  {
    name: "Threads and posts",
    description: "Original X posts or threads that teach something real about building on Rialo.",
    sourceTypes: ["x_post"],
    maxPoints: "10",
    criteria: [
      { name: "Depth", description: "Explains how or why, not just what." },
      { name: "Clarity", description: "Easy to follow for a developer new to Rialo." },
      { name: "Accuracy", description: "Claims match how Rialo actually works." },
    ],
    rules: "Original work only. A thread counts as one submission. Announcement reposts and memes are not paid.",
  },
];

const UNIT_MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

const initialForm = (): Form => ({
  basics: { name: "", slug: "", description: "", logoUrl: "" },
  context: emptyContextDraft(),
  rubric: { categories: STARTER_CATEGORIES, generalRules: "" },
  budget: {
    ratePerPoint: "0.001",
    roundLength: "5",
    roundUnit: "minutes",
    startMode: "now",
    firstRoundStartsAt: "",
    refundDeadlineDays: "30",
    autoApproveConfidence: "0.8",
    maxAutoApproveItem: "",
    minScore: "50",
    minAccountAgeDays: "30",
    minXFollowers: "0",
    belowMinimum: "review",
    maxSubmissionsPerRound: "5",
    escrow: "",
    opsBudget: "0.1",
  },
  limits: { maxPerPayout: "", maxPerContributor: "", maxPerRound: "", maxPerDay: "", autoApproveThreshold: "", payeeCooldownHours: "24" },
  limitsEdited: false,
  escrowEdited: false,
  slugEdited: false,
});

const DRAFT_KEY = "merit:new-program-draft:v1";

function loadDraft(): { form: Form; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { form: Form; savedAt: string };
    if (!d?.form?.basics || !d.form.rubric?.categories) return null;
    const init = initialForm();
    return { ...d, form: { ...init, ...d.form, context: { ...init.context, ...d.form.context }, budget: { ...init.budget, ...d.form.budget }, limits: { ...init.limits, ...d.form.limits } } };
  } catch {
    return null;
  }
}

const toKey = (s: string, i: number) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "c_$1").slice(0, 32) || `item_${i + 1}`;
const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** Rate, perfect payouts and the limits in effect (derived until the owner edits them). */
function effective(f: Form) {
  const rate = tryParseRlo(f.budget.ratePerPoint);
  const perfect = f.rubric.categories.map((c) => (rate !== null && Number(c.maxPoints) > 0 ? perfectPayout(Number(c.maxPoints), rate) : null));
  const maxItem = perfect.reduce<bigint>((m, p) => (p !== null && p > m ? p : m), 0n);
  const derived = deriveDefaultLimits(maxItem);
  const limits: Limits = f.limitsEdited
    ? f.limits
    : { ...f.limits, maxPerPayout: derived.maxPerPayout, maxPerContributor: derived.maxPerContributor, maxPerRound: derived.maxPerRound, maxPerDay: derived.maxPerDay, autoApproveThreshold: derived.autoApproveThreshold };
  const maxAutoApproveItem = f.limitsEdited ? f.budget.maxAutoApproveItem : derived.maxAutoApproveItem;
  // A suggested escrow of one full round, until the owner types their own.
  const escrow = f.escrowEdited ? f.budget.escrow : limits.maxPerRound;
  return { rate, perfect, maxItem, limits, maxAutoApproveItem, escrow };
}

function startDate(f: Form, now: Date): Date | null {
  if (f.budget.startMode === "now") return now;
  const t = Date.parse(f.budget.firstRoundStartsAt);
  return Number.isNaN(t) ? null : new Date(t);
}

const roundMinutes = (f: Form) => Number(f.budget.roundLength) * UNIT_MINUTES[f.budget.roundUnit];

/** Typed strings → the shape the shared zod schemas (and the API) expect. */
function toPayload(f: Form, now: Date) {
  const e = effective(f);
  const start = startDate(f, now);
  return {
    basics: f.basics,
    context: contextPayload(f.context),
    rubric: {
      generalRules: f.rubric.generalRules,
      categories: f.rubric.categories.map((c, i) => ({
        key: toKey(c.name, i),
        name: c.name,
        description: c.description,
        sourceTypes: c.sourceTypes,
        maxPoints: Number(c.maxPoints),
        criteria: c.criteria.map((k, j) => ({ key: toKey(k.name, j), name: k.name, description: k.description })),
        rules: c.rules,
      })),
    },
    budget: {
      ratePerPoint: f.budget.ratePerPoint,
      roundLengthMinutes: String(roundMinutes(f)),
      firstRoundStartsAt: start ? start.toISOString() : "",
      refundDeadlineDays: f.budget.refundDeadlineDays,
      autoApproveConfidence: f.budget.autoApproveConfidence,
      maxAutoApproveItem: e.maxAutoApproveItem,
      minScore: f.budget.minScore,
      minAccountAgeDays: f.budget.minAccountAgeDays,
      minXFollowers: f.budget.minXFollowers,
      belowMinimum: f.budget.belowMinimum,
      maxSubmissionsPerRound: f.budget.maxSubmissionsPerRound,
      escrow: e.escrow,
      opsBudget: f.budget.opsBudget,
    },
    limits: e.limits,
  };
}

/** Zod's default messages in plain words. */
function humanize(i: z.core.$ZodIssue): string {
  const issue = i as { code: string; origin?: string; minimum?: number | bigint; maximum?: number | bigint; format?: string };
  if (!/^(Too small|Too big|Invalid)/.test(i.message)) return i.message;
  if (issue.code === "too_small" && issue.origin === "string") return Number(issue.minimum) <= 1 ? "Required." : `Use at least ${issue.minimum} characters.`;
  if (issue.code === "too_big" && issue.origin === "string") return `Keep it under ${issue.maximum} characters.`;
  if (issue.code === "too_small" && issue.origin === "array") return `Add at least ${issue.minimum}.`;
  if (issue.code === "too_big" && issue.origin === "array") return `At most ${issue.maximum}.`;
  if (issue.code === "too_small") return `Must be at least ${issue.minimum}.`;
  if (issue.code === "too_big") return `Must be at most ${issue.maximum}.`;
  if (issue.format === "url") return "Use a full https:// link.";
  return "Check this value.";
}

function issues(schema: z.ZodType, value: unknown, prefix: string): Record<string, string> {
  const r = schema.safeParse(value);
  const out: Record<string, string> = {};
  if (!r.success) for (const i of r.error.issues) out[[prefix, ...i.path].join(".")] ??= humanize(i);
  return out;
}

/** Field ids → error keys, for validating a field when the owner leaves it. */
const ID_KEYS: Record<string, string> = {
  name: "basics.name",
  slug: "basics.slug",
  description: "basics.description",
  logo: "basics.logoUrl",
  rate: "budget.ratePerPoint",
  len: "budget.roundLengthMinutes",
  start: "budget.firstRoundStartsAt",
  deadline: "budget.refundDeadlineDays",
  minscore: "budget.minScore",
  age: "budget.minAccountAgeDays",
  followers: "budget.minXFollowers",
  maxsubs: "budget.maxSubmissionsPerRound",
  conf: "budget.autoApproveConfidence",
  autoitem: "budget.maxAutoApproveItem",
  escrow: "budget.escrow",
  ops: "budget.opsBudget",
  perpayout: "limits.maxPerPayout",
  percontributor: "limits.maxPerContributor",
  perround: "limits.maxPerRound",
  perday: "limits.maxPerDay",
  threshold: "limits.autoApproveThreshold",
  cooldown: "limits.payeeCooldownHours",
};

// ─── Small field helpers ────────────────────────────────────────────────────

function Field({ id, label, hint, error, warning, children }: { id: string; label: ReactNode; hint?: ReactNode; error?: string; warning?: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-danger text-xs">
          {error}
        </p>
      ) : null}
      {warning && !error ? <p className="text-soft text-xs leading-relaxed">{warning}</p> : null}
      {hint ? <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p> : null}
    </div>
  );
}

function UnitInput(props: { id: string; value: string; onChange: (v: string) => void; unit: string; placeholder?: string; invalid?: boolean }) {
  return (
    <div className="relative">
      <Input
        id={props.id}
        inputMode="decimal"
        autoComplete="off"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={props.invalid}
        className="pr-20 font-mono tabular-nums"
      />
      <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs">{props.unit}</span>
    </div>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn("h-8 rounded-lg border px-3 text-sm transition-colors", value === v ? "border-brand bg-brand-subtle text-brand font-medium" : "hover:bg-muted")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

const Card = ({ title, children, description }: { title: string; description?: ReactNode; children: ReactNode }) => {
  const id = `${title.toLowerCase().replace(/[^a-z]+/g, "-")}-h`;
  return (
    <section className="bg-card shadow-soft grid gap-4 rounded-[1.25rem] p-5 sm:p-6" aria-labelledby={id}>
      <div>
        <h2 id={id} className="text-base font-medium">
          {title}
        </h2>
        {description ? <div className="text-muted-foreground mt-1 text-sm">{description}</div> : null}
      </div>
      {children}
    </section>
  );
};

// ─── Wizard ─────────────────────────────────────────────────────────────────

export function ProgramWizard({ owner, host }: { owner: string; host: string }) {
  const router = useRouter();
  const stepFromUrl = (q: URLSearchParams) => Math.min(STEPS.length, Math.max(1, Number(q.get("step")) || 1)) - 1;
  const [requested, setRequested] = useState(() => stepFromUrl(new URLSearchParams(window.location.search)));
  useEffect(() => {
    const onPop = () => setRequested(stepFromUrl(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [restored] = useState(() => loadDraft());
  const [form, setForm] = useState<Form>(() => restored?.form ?? initialForm());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, { message: string; value: string }>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const dirty = restored !== null || JSON.stringify(form) !== JSON.stringify(initialForm());
  const [now] = useState(() => new Date());
  const payload = toPayload(form, now);
  const eff = effective(form);
  const saved = useRef(false);

  function validate(s: number): Record<string, string> {
    if (s === 0) return issues(ProgramBasics, payload.basics, "basics");
    if (s === 1) return issues(ContextReadInput, { about: payload.context.about, links: payload.context.links, mustInclude: payload.context.mustInclude }, "context");
    if (s === 2) {
      const out = issues(Rubric, payload.rubric, "rubric");
      form.rubric.categories.forEach((c, i) => {
        if (c.sourceTypes.some((t) => !LIVE_SOURCES.includes(t))) out[`rubric.categories.${i}.sourceTypes`] ??= "Only X posts can be judged today.";
      });
      return out;
    }
    if (s === 3) {
      const out = { ...issues(BudgetInput, payload.budget, "budget"), ...issues(LimitsInput, payload.limits, "limits") };
      if (form.budget.startMode === "later") {
        const t = Date.parse(form.budget.firstRoundStartsAt);
        if (Number.isNaN(t)) out["budget.firstRoundStartsAt"] = "Pick a date and time.";
        else if (t < now.getTime() - 60_000) out["budget.firstRoundStartsAt"] = "That's in the past. Pick a later time or start now.";
      }
      const perPayout = tryParseRlo(eff.limits.maxPerPayout);
      if (perPayout !== null && eff.maxItem > perPayout && !out["limits.maxPerPayout"])
        out["limits.maxPerPayout"] = `A perfect submission earns ${rlo(eff.maxItem)}: one payout must allow at least that.`;
      if (tryParseRlo(eff.escrow) === 0n) out["budget.escrow"] = "Fund the escrow with something: approvals wait for it.";
      return out;
    }
    return {};
  }
  const firstInvalid = [0, 1, 2, 3].find((s) => Object.keys(validate(s)).length > 0) ?? 4;
  const step = Math.min(requested, firstInvalid);

  useEffect(() => {
    if (saved.current) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, savedAt: new Date().toISOString() }));
    } catch {
      /* storage unavailable: the form still works, it just isn't saved */
    }
  }, [form]);

  const goTo = (s: number) => {
    setRequested(s);
    window.history.pushState(null, "", `/app/programs/new?step=${s + 1}`);
    window.scrollTo({ top: 0 });
  };
  const update = <K extends "basics" | "rubric" | "budget">(section: K, patch: Partial<Form[K]>) => setForm((f) => ({ ...f, [section]: { ...f[section], ...patch } }));
  const updateCategory = (i: number, patch: Partial<Category>) =>
    setForm((f) => ({ ...f, rubric: { ...f.rubric, categories: f.rubric.categories.map((c, j) => (j === i ? { ...c, ...patch } : c)) } }));
  /** The first edit to any limit freezes the derived values so they stop following the rubric. */
  const editLimit = (patch: Partial<Limits> & { maxAutoApproveItem?: string }) =>
    setForm((f) => {
      const e = effective(f);
      const { maxAutoApproveItem, ...limits } = patch;
      return {
        ...f,
        limitsEdited: true,
        limits: { ...(f.limitsEdited ? f.limits : e.limits), ...limits },
        budget: { ...f.budget, maxAutoApproveItem: maxAutoApproveItem ?? (f.limitsEdited ? f.budget.maxAutoApproveItem : e.maxAutoApproveItem) },
      };
    });

  function onFieldBlur(ev: React.FocusEvent) {
    const key = ID_KEYS[(ev.target as HTMLElement).id];
    if (!key) return;
    const t = new Set(touched).add(key);
    setTouched(t);
    const all = validate(step);
    setErrors((prev) => {
      const out = { ...prev };
      for (const k of t) {
        if (all[k]) out[k] = all[k];
        else delete out[k];
      }
      return out;
    });
  }

  function next() {
    const e = validate(step);
    setErrors(e);
    if (Object.keys(e).length === 0) goTo(step + 1);
  }

  function discardDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    setForm(initialForm());
    setErrors({});
    setServerErrors({});
    goTo(0);
  }

  async function save() {
    setFormError(null);
    setPending(true);
    try {
      const sent = toPayload(form, new Date());
      const res = await fetch("/api/owner/programs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sent) });
      const body = (await res.json()) as { programId?: string; error?: string; fieldErrors?: Record<string, string> };
      if (res.ok && body.programId) {
        saved.current = true;
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* ignore */
        }
        setCreated(body.programId);
        // The rail's program switcher lives in the /app layout: refresh it so the new draft shows up.
        router.refresh();
        return;
      }
      if (body.fieldErrors) {
        const at = (key: string) => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), sent);
        setServerErrors(Object.fromEntries(Object.entries(body.fieldErrors).map(([k, message]) => [k, { message, value: JSON.stringify(at(k)) }])));
        const keys = Object.keys(body.fieldErrors);
        const first = ["basics", "context", "rubric", "budget"].findIndex((p) => keys.some((k) => k.startsWith(p) || (p === "budget" && k.startsWith("limits"))));
        if (first >= 0) goTo(first);
      }
      setFormError(body.error ?? "Couldn't save the program.");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  // A flagged field shows its error only while it's still wrong; server errors stay until that value changes.
  const liveErrors = validate(step);
  const e: Record<string, string> = {};
  for (const k of new Set([...touched, ...Object.keys(errors)])) if (liveErrors[k]) e[k] = liveErrors[k];
  for (const [k, se] of Object.entries(serverErrors)) {
    const v = k.split(".").reduce<unknown>((o, part) => (o && typeof o === "object" ? (o as Record<string, unknown>)[part] : undefined), payload);
    if (!e[k] && JSON.stringify(v) === se.value) e[k] = se.message;
  }
  const warnings = limitWarnings({
    maxCategoryPayout: eff.maxItem > 0n ? eff.maxItem : null,
    maxAutoApproveItem: tryParseRlo(eff.maxAutoApproveItem),
    maxPerPayout: tryParseRlo(eff.limits.maxPerPayout),
    maxPerContributor: tryParseRlo(eff.limits.maxPerContributor),
    maxPerRound: tryParseRlo(eff.limits.maxPerRound),
    autoApproveThreshold: tryParseRlo(eff.limits.autoApproveThreshold),
  });
  const warn = (field: string) => warnings.find((w) => w.field === field)?.text;
  const start = startDate(form, now);
  const minutes = roundMinutes(form);
  const end = start && minutes > 0 ? new Date(start.getTime() + minutes * 60_000) : null;
  const amount = (i: number) => (eff.perfect[i] !== null && eff.perfect[i] !== undefined ? rlo(eff.perfect[i]!) : "—");
  const meta = STEP_META[step]!;

  return (
    <>
      <FocusHeader
        progress={<WizardProgress step={step} onGo={created ? undefined : goTo} />}
        status={<DevNetBadge />}
        exit={
          <Button asChild variant="ghost" size="sm">
            <Link href={created ? `/app/programs/${created}` : "/app"}>{live ? "Go to overview" : created ? "Finish later" : "Save and exit"}</Link>
          </Button>
        }
      />
      <FocusMain>
        <div className="grid items-start gap-12 pt-8 sm:pt-12 lg:grid-cols-[minmax(0,640px)_minmax(0,1fr)] xl:gap-20">
          <div className="min-w-0">
            <p className="text-brand text-sm font-medium">
              Step {step + 1} of {STEPS.length}
              <span className="text-muted-foreground font-normal"> · {STEPS[step]}</span>
            </p>
            <h1 className="display mt-2 text-[2.5rem] leading-[1.05] sm:text-[3.25rem]">{meta.title}</h1>
            <p className="text-soft mt-3 max-w-[56ch] text-[15px] leading-relaxed">{meta.intro}</p>
            {dirty && !created ? (
              <p className="text-muted-foreground mt-3 text-xs" aria-live="polite">
                Draft saved on this device ·{" "}
                <button type="button" className="hover:text-foreground underline underline-offset-4" onClick={discardDraft}>
                  Discard draft
                </button>
              </p>
            ) : null}

            <div className="mt-8 grid gap-6" onBlur={onFieldBlur}>
              {step === 0 ? (
                <>
                  <Field id="name" label="Program name" error={e["basics.name"]}>
                    <Input
                      id="name"
                      placeholder="Rialo Builders"
                      value={form.basics.name}
                      onChange={(ev) => {
                        const name = ev.target.value;
                        setForm((f) => ({ ...f, basics: { ...f.basics, name, ...(f.slugEdited ? {} : { slug: toSlug(name) }) } }));
                      }}
                      aria-invalid={!!e["basics.name"]}
                    />
                  </Field>
                  <Field id="slug" label="Join link" hint="Filled in from the name. Lowercase letters, numbers and dashes." error={e["basics.slug"]}>
                    <div
                      className={cn(
                        "border-input focus-within:border-ring focus-within:ring-ring/50 dark:bg-input/30 flex h-9 items-center overflow-hidden rounded-lg border focus-within:ring-3",
                        e["basics.slug"] && "border-destructive",
                      )}
                    >
                      <span className="text-muted-foreground bg-muted/50 flex h-full shrink-0 items-center border-r px-2.5 font-mono text-[13px]">{host}/join/</span>
                      <input
                        id="slug"
                        placeholder="rialo-builders"
                        value={form.basics.slug}
                        onChange={(ev) => setForm((f) => ({ ...f, slugEdited: true, basics: { ...f.basics, slug: ev.target.value } }))}
                        className="placeholder:text-muted-foreground h-full min-w-0 flex-1 bg-transparent px-2.5 font-mono text-sm outline-none"
                        aria-invalid={!!e["basics.slug"]}
                      />
                    </div>
                  </Field>
                  <Field id="description" label="Description" hint="Shown on the join page and on Explore. Say what you pay for and who it's for." error={e["basics.description"]}>
                    <Textarea
                      id="description"
                      rows={4}
                      placeholder="Pays builders in RLO for original threads that help others ship on Rialo."
                      value={form.basics.description}
                      onChange={(ev) => update("basics", { description: ev.target.value })}
                      aria-invalid={!!e["basics.description"]}
                    />
                  </Field>
                  <Field id="logo" label="Logo URL (optional)" hint="A square https image." error={e["basics.logoUrl"]}>
                    <Input id="logo" type="url" placeholder="https://example.com/logo.png" value={form.basics.logoUrl} onChange={(ev) => update("basics", { logoUrl: ev.target.value })} aria-invalid={!!e["basics.logoUrl"]} />
                  </Field>
                  <div className="bg-muted/50 rounded-lg px-3.5 py-3 text-sm">
                    <p className="font-medium">Network: Rialo DevNet</p>
                    <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">Merit runs on DevNet only. Escrow and payouts are test RLO from the faucet; nothing real is paid.</p>
                  </div>
                </>
              ) : null}

              {step === 1 ? (
                <ContextEditor
                  value={form.context}
                  onChange={(patch) => setForm((f) => ({ ...f, context: { ...f.context, ...patch } }))}
                  errors={{
                    about: e["context.about"],
                    links: Object.entries(e).find(([k]) => k.startsWith("context.links"))?.[1],
                    mustInclude: Object.entries(e).find(([k]) => k.startsWith("context.mustInclude"))?.[1],
                  }}
                />
              ) : null}

              {step === 2 ? (
                <>
                  <ScoringExplainer rate={eff.rate} />
                  {form.rubric.categories.map((c, i) => (
                    <fieldset key={i} className="bg-card shadow-soft grid gap-4 rounded-[1.25rem] p-5 sm:p-6">
                      <div className="flex items-center justify-between">
                        <legend className="text-sm font-medium">Category {i + 1}</legend>
                        {form.rubric.categories.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setForm((f) => ({ ...f, rubric: { ...f.rubric, categories: f.rubric.categories.filter((_, j) => j !== i) } }))}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                            Remove
                          </Button>
                        ) : null}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
                        <Field id={`c${i}-name`} label="Name" error={e[`rubric.categories.${i}.name`] ?? e[`rubric.categories.${i}.key`]}>
                          <Input id={`c${i}-name`} placeholder="Threads and posts" value={c.name} onChange={(ev) => updateCategory(i, { name: ev.target.value })} />
                        </Field>
                        <Field id={`c${i}-max`} label="Max points" error={e[`rubric.categories.${i}.maxPoints`]}>
                          <UnitInput id={`c${i}-max`} unit="points" placeholder="10" value={c.maxPoints} onChange={(v) => updateCategory(i, { maxPoints: v })} />
                        </Field>
                      </div>
                      <p className="bg-muted/60 rounded-xl px-3.5 py-2.5 text-sm">
                        A perfect {itemNoun(c.name)} (10/10) earns <span className="mono-num font-medium">{amount(i)}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          ({c.maxPoints || "0"} points × {eff.rate !== null ? rlo(eff.rate) : "rate"} per point). A 7/10 average earns 70% of that.
                        </span>
                      </p>
                      <Field id={`c${i}-desc`} label="What counts" error={e[`rubric.categories.${i}.description`]}>
                        <Textarea id={`c${i}-desc`} rows={2} placeholder="Original posts or threads that teach something about building on Rialo." value={c.description} onChange={(ev) => updateCategory(i, { description: ev.target.value })} />
                      </Field>
                      <div className="grid gap-1.5">
                        <span className="text-sm font-medium">Accepted sources</span>
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          {LIVE_SOURCES.map((t) => (
                            <label key={t} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="accent-brand size-4"
                                checked={c.sourceTypes.includes(t)}
                                onChange={(ev) => updateCategory(i, { sourceTypes: ev.target.checked ? [...c.sourceTypes, t] : c.sourceTypes.filter((x) => x !== t) })}
                              />
                              {SOURCE_LABELS[t]}
                            </label>
                          ))}
                        </div>
                        <p className="text-muted-foreground text-xs">The agent and the validators&apos; REX check read X posts. GitHub work and articles aren&apos;t judged by Merit yet.</p>
                        {e[`rubric.categories.${i}.sourceTypes`] ? <p className="text-danger text-xs">{e[`rubric.categories.${i}.sourceTypes`] === "Only X posts can be judged today." ? e[`rubric.categories.${i}.sourceTypes`] : "Pick at least one source."}</p> : null}
                      </div>
                      <div className="grid gap-2">
                        <span className="text-sm font-medium">Scoring criteria</span>
                        <p className="text-muted-foreground -mt-1 text-xs">The agent scores each from 0 to 10 and explains why. The category&apos;s points are their average ÷ 10 × max points.</p>
                        {c.criteria.map((k, j) => (
                          <div key={j} className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
                            <Input
                              aria-label={`Criterion ${j + 1} name`}
                              placeholder={["Depth", "Clarity", "Accuracy"][j] ?? "Criterion"}
                              value={k.name}
                              onChange={(ev) => updateCategory(i, { criteria: c.criteria.map((x, m) => (m === j ? { ...x, name: ev.target.value } : x)) })}
                            />
                            <Input
                              aria-label={`Criterion ${j + 1} description`}
                              placeholder="What a 10 looks like, e.g. explains how and why"
                              value={k.description}
                              onChange={(ev) => updateCategory(i, { criteria: c.criteria.map((x, m) => (m === j ? { ...x, description: ev.target.value } : x)) })}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove criterion ${j + 1}`}
                              disabled={c.criteria.length === 1}
                              onClick={() => updateCategory(i, { criteria: c.criteria.filter((_, m) => m !== j) })}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </div>
                        ))}
                        {Object.keys(e).some((k) => k.startsWith(`rubric.categories.${i}.criteria`)) ? <p className="text-danger text-xs">Each criterion needs a unique name and a description.</p> : null}
                        {c.criteria.length < 8 ? (
                          <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => updateCategory(i, { criteria: [...c.criteria, { name: "", description: "" }] })}>
                            <Plus className="size-4" aria-hidden="true" />
                            Add criterion
                          </Button>
                        ) : null}
                      </div>
                      <Field id={`c${i}-rules`} label="Rules (plain language, optional)" error={e[`rubric.categories.${i}.rules`]}>
                        <Textarea id={`c${i}-rules`} rows={2} placeholder="Threads should be at least 3 posts. Memes and reposts are not paid." value={c.rules} onChange={(ev) => updateCategory(i, { rules: ev.target.value })} />
                      </Field>
                    </fieldset>
                  ))}
                  {form.rubric.categories.length < 10 ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="justify-self-start"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          rubric: { ...f.rubric, categories: [...f.rubric.categories, { name: "", description: "", sourceTypes: ["x_post"], maxPoints: "10", criteria: [{ name: "", description: "" }], rules: "" }] },
                        }))
                      }
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      Add category
                    </Button>
                  ) : null}
                  <Field id="general" label="Rules for every submission (optional)" error={e["rubric.generalRules"]}>
                    <Textarea id="general" rows={3} placeholder="English only. Original work about building on Rialo." value={form.rubric.generalRules} onChange={(ev) => update("rubric", { generalRules: ev.target.value })} />
                  </Field>
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <Card title="Schedule">
                    <div className="grid gap-1.5">
                      <span className="text-sm font-medium">First round starts</span>
                      <Choice
                        label="First round starts"
                        value={form.budget.startMode}
                        options={[
                          ["now", "As soon as it's live"],
                          ["later", "Schedule for later"],
                        ]}
                        onChange={(mode) =>
                          update("budget", { startMode: mode, ...(mode === "later" && !form.budget.firstRoundStartsAt ? { firstRoundStartsAt: toLocalInput(new Date(Date.now() + 86_400_000)) } : {}) })
                        }
                      />
                    </div>
                    {form.budget.startMode === "later" ? (
                      <Field id="start" label="Start date and time (your local time)" error={e["budget.firstRoundStartsAt"]} hint={start ? `${localAndUtc(start)} · starts ${fromNow(start)}` : undefined}>
                        <Input id="start" type="datetime-local" value={form.budget.firstRoundStartsAt} onChange={(ev) => update("budget", { firstRoundStartsAt: ev.target.value })} />
                      </Field>
                    ) : (
                      <p className="text-muted-foreground text-sm">Round 1 opens in the last step, when you go live.</p>
                    )}
                    <Field
                      id="len"
                      label="Round length"
                      error={e["budget.roundLengthMinutes"]}
                      hint={
                        start && end && minutes > 0
                          ? `Round 1: ${localAndUtc(start).split(" · ")[0]} to ${localAndUtc(end).split(" · ")[0]}. When a round closes, the program's own timer pays approved work and opens the next one.`
                          : "1 minute to 7 days. The program's own timer closes each round and pays it."
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="w-28">
                          <UnitInput id="len" unit="" placeholder="5" value={form.budget.roundLength} onChange={(v) => update("budget", { roundLength: v })} />
                        </div>
                        <Choice
                          label="Round length unit"
                          value={form.budget.roundUnit}
                          options={[
                            ["minutes", "Minutes"],
                            ["hours", "Hours"],
                            ["days", "Days"],
                          ]}
                          onChange={(roundUnit) => update("budget", { roundUnit })}
                        />
                      </div>
                    </Field>
                    <Field id="deadline" label="Refund deadline" error={e["budget.refundDeadlineDays"]} hint="After this, you can take back whatever is left in escrow, even if the campaign hasn't ended.">
                      <div className="max-w-48">
                        <UnitInput id="deadline" unit="days" placeholder="30" value={form.budget.refundDeadlineDays} onChange={(v) => update("budget", { refundDeadlineDays: v })} />
                      </div>
                    </Field>
                  </Card>

                  <Card title="Pay">
                    <Field
                      id="rate"
                      label="Rate per point"
                      error={e["budget.ratePerPoint"]}
                      hint={form.rubric.categories.map((c, i) => (
                        <span key={i} className="block">
                          A perfect {itemNoun(c.name)} (10/10) earns <span className="mono-num text-foreground">{amount(i)}</span>.
                        </span>
                      ))}
                    >
                      <div className="max-w-48">
                        <UnitInput id="rate" unit="RLO" placeholder="0.001" value={form.budget.ratePerPoint} onChange={(v) => update("budget", { ratePerPoint: v })} invalid={!!e["budget.ratePerPoint"]} />
                      </div>
                    </Field>
                    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                      <Field id="minscore" label="Minimum score to pay" hint="Out of 100. The program refuses approvals below it." error={e["budget.minScore"]}>
                        <UnitInput id="minscore" unit="of 100" placeholder="50" value={form.budget.minScore} onChange={(v) => update("budget", { minScore: v })} />
                      </Field>
                      <Field id="conf" label="Minimum agent confidence" hint={LIMIT_HELP.autoApproveConfidence} error={e["budget.autoApproveConfidence"]}>
                        <UnitInput id="conf" unit="0.5–1" placeholder="0.8" value={form.budget.autoApproveConfidence} onChange={(v) => update("budget", { autoApproveConfidence: v })} />
                      </Field>
                      <Field id="autoitem" label="Largest item paid without your review" hint={LIMIT_HELP.maxAutoApproveItem} warning={warn("maxAutoApproveItem")} error={e["budget.maxAutoApproveItem"]}>
                        <UnitInput id="autoitem" unit="RLO" value={eff.maxAutoApproveItem} onChange={(v) => editLimit({ maxAutoApproveItem: v })} />
                      </Field>
                      <Field id="maxsubs" label="Submissions per contributor per round" hint="More are refused politely, before any review cost." error={e["budget.maxSubmissionsPerRound"]}>
                        <UnitInput id="maxsubs" unit="per round" placeholder="5" value={form.budget.maxSubmissionsPerRound} onChange={(v) => update("budget", { maxSubmissionsPerRound: v })} />
                      </Field>
                    </div>
                  </Card>

                  <Card title="Who can take part" description="Checked against the contributor's X account when they join and on every submission.">
                    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                      <Field id="age" label="Minimum X account age" error={e["budget.minAccountAgeDays"]}>
                        <UnitInput id="age" unit="days" placeholder="30" value={form.budget.minAccountAgeDays} onChange={(v) => update("budget", { minAccountAgeDays: v })} />
                      </Field>
                      <Field id="followers" label="Minimum X followers" hint="0 means no minimum." error={e["budget.minXFollowers"]}>
                        <UnitInput id="followers" unit="followers" placeholder="0" value={form.budget.minXFollowers} onChange={(v) => update("budget", { minXFollowers: v })} />
                      </Field>
                    </div>
                    <div className="grid gap-1.5">
                      <span className="text-sm font-medium">Accounts below these minimums</span>
                      <Choice
                        label="Accounts below these minimums"
                        value={form.budget.belowMinimum}
                        options={[
                          ["review", "Send their work to my review"],
                          ["reject", "Reject their work"],
                          ["block", "They can't join"],
                        ]}
                        onChange={(belowMinimum) => update("budget", { belowMinimum })}
                      />
                    </div>
                  </Card>

                  <Card
                    title="Limits"
                    description={
                      <>
                        The first three are enforced by the Merit program on Rialo: the agent can&apos;t exceed them.{" "}
                        {form.limitsEdited ? "You've edited these." : "Suggested from your rubric; they follow it until you edit one."}
                      </>
                    }
                  >
                    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                      {(
                        [
                          ["perpayout", "maxPerPayout", "Max per payout"],
                          ["percontributor", "maxPerContributor", "Max per contributor per round"],
                          ["perround", "maxPerRound", "Max per round"],
                          ["perday", "maxPerDay", "Max per rolling 24 hours"],
                          ["threshold", "autoApproveThreshold", "Your approval needed above"],
                        ] as const
                      ).map(([id, key, label]) => (
                        <Field
                          key={id}
                          id={id}
                          label={
                            <span className="inline-flex items-center gap-1.5">
                              {label}
                              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", ON_CHAIN_LIMITS.has(key) ? "bg-success-subtle text-success" : "bg-muted text-soft")}>
                                {ON_CHAIN_LIMITS.has(key) ? "On chain" : "Agent · program v2"}
                              </span>
                            </span>
                          }
                          hint={LIMIT_HELP[key]}
                          warning={warn(key)}
                          error={e[`limits.${key}`]}
                        >
                          <UnitInput id={id} unit="RLO" value={eff.limits[key]} onChange={(v) => editLimit({ [key]: v })} invalid={!!e[`limits.${key}`]} />
                        </Field>
                      ))}
                      <Field
                        id="cooldown"
                        label={
                          <span className="inline-flex items-center gap-1.5">
                            New wallet cooldown <span className="bg-muted text-soft rounded-full px-1.5 py-0.5 text-[10px] font-medium">Agent · program v2</span>
                          </span>
                        }
                        hint={LIMIT_HELP.payeeCooldownHours}
                        error={e["limits.payeeCooldownHours"]}
                      >
                        <UnitInput id="cooldown" unit="hours" placeholder="24" value={form.limits.payeeCooldownHours} onChange={(v) => setForm((f) => ({ ...f, limits: { ...f.limits, payeeCooldownHours: v } }))} />
                      </Field>
                    </div>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      &ldquo;Agent · program v2&rdquo;: the agent applies these before approving, and the program will enforce them itself once its v2 upgrade ships.
                    </p>
                  </Card>

                  <Card title="Funding" description="Sent on chain when you go live. You can add more or withdraw what isn't reserved later.">
                    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                      <Field id="escrow" label="Escrow" hint="What the program pays contributors from. Suggested: one full round." error={e["budget.escrow"]}>
                        <UnitInput id="escrow" unit="RLO" value={eff.escrow} onChange={(v) => setForm((f) => ({ ...f, escrowEdited: true, budget: { ...f.budget, escrow: v } }))} invalid={!!e["budget.escrow"]} />
                      </Field>
                      <Field id="ops" label="Operations budget" hint="Repays the agent 0.012 RLO per REX verification, plus about 0.024 RLO ledger rent per round with approvals." error={e["budget.opsBudget"]}>
                        <UnitInput id="ops" unit="RLO" value={form.budget.opsBudget} onChange={(v) => update("budget", { opsBudget: v })} />
                      </Field>
                    </div>
                  </Card>
                </>
              ) : null}

              {step === 4 ? (
                <div className="grid gap-4">
                  <ReviewBlock title="Program" onEdit={created ? undefined : () => goTo(0)}>
                    <p className="font-medium">{form.basics.name}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs">Rialo DevNet · test RLO</p>
                    <p className="text-muted-foreground mt-0.5 font-mono text-xs">
                      {host}/join/{form.basics.slug}
                    </p>
                  </ReviewBlock>
                  <ReviewBlock title="Context for the agent" onEdit={created ? undefined : () => goTo(1)}>
                    <p className="line-clamp-3">{form.context.about}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {form.context.understanding ? `Summary written · ${contextPayload(form.context).understanding?.keyFacts.length ?? 0} key facts` : "No summary: the agent uses your text as written."}
                    </p>
                    {form.context.mustInclude.trim() ? <p className="text-muted-foreground mt-1 text-xs">Posts must include {parseMustInclude(form.context.mustInclude).join(", ")}</p> : null}
                  </ReviewBlock>
                  <ReviewBlock title="Pays for" onEdit={created ? undefined : () => goTo(2)}>
                    <ul className="grid gap-1.5">
                      {form.rubric.categories.map((c, i) => (
                        <li key={i} className="flex items-baseline justify-between gap-4">
                          <span className="min-w-0 truncate">{c.name || `Category ${i + 1}`}</span>
                          <span className="text-muted-foreground shrink-0 text-xs">
                            a perfect one earns <span className="mono-num text-foreground text-sm">{amount(i)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </ReviewBlock>
                  <ReviewBlock title="Rounds" onEdit={created ? undefined : () => goTo(3)}>
                    <p>{form.budget.startMode === "now" ? "Round 1 opens when you go live" : start ? `Round 1 opens ${localAndUtc(start)}` : "—"}</p>
                    <p className="text-muted-foreground mt-0.5">
                      Every {minutesLabel(minutes)} · refund deadline {form.budget.refundDeadlineDays} days
                    </p>
                  </ReviewBlock>
                  <ReviewBlock title="Who can take part" onEdit={created ? undefined : () => goTo(3)}>
                    <p>
                      X accounts at least {form.budget.minAccountAgeDays} days old
                      {Number(form.budget.minXFollowers) > 0 ? ` with ${form.budget.minXFollowers}+ followers` : ""}; others{" "}
                      {{ review: "go to your review", reject: "are rejected", block: "can't join" }[form.budget.belowMinimum]}
                    </p>
                    <p className="text-muted-foreground mt-0.5">Up to {form.budget.maxSubmissionsPerRound} submissions per contributor per round</p>
                  </ReviewBlock>
                  <ReviewBlock title="Without your review" onEdit={created ? undefined : () => goTo(3)}>
                    <p>
                      Items up to {eff.maxAutoApproveItem} RLO with confidence ≥ {form.budget.autoApproveConfidence}, score ≥ {form.budget.minScore}
                    </p>
                  </ReviewBlock>
                  <ReviewBlock title="Limits on chain" onEdit={created ? undefined : () => goTo(3)}>
                    <ul className="grid gap-0.5">
                      <li>{eff.limits.maxPerPayout} RLO per payout</li>
                      <li>{eff.limits.maxPerContributor} RLO per contributor per round</li>
                      <li>{eff.limits.maxPerRound} RLO per round</li>
                    </ul>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Agent until program v2: {eff.limits.maxPerDay} RLO per 24 hours · your approval above {eff.limits.autoApproveThreshold} RLO · {form.limits.payeeCooldownHours} h wallet cooldown
                    </p>
                  </ReviewBlock>
                  <ReviewBlock title="Funding" onEdit={created ? undefined : () => goTo(3)}>
                    <p>
                      {eff.escrow} RLO escrow · {form.budget.opsBudget} RLO operations budget
                    </p>
                  </ReviewBlock>

                  {created ? (
                    <section className="bg-card shadow-lift grid gap-5 rounded-[1.5rem] p-6 sm:p-8" aria-labelledby="go-live-h">
                      <div>
                        <p className="text-brand text-sm font-medium">{live ? "Live on Rialo DevNet" : "Draft saved"}</p>
                        <h2 id="go-live-h" className="display mt-1 text-[2rem] leading-tight">
                          {live ? (
                            <>
                              You&apos;re <em>live</em>
                            </>
                          ) : (
                            <>
                              Go <em>live</em> on Rialo
                            </>
                          )}
                        </h2>
                      </div>
                      <GoLive
                        program={{
                          id: created,
                          name: form.basics.name,
                          description: form.basics.description,
                          owner,
                          plannedEscrow: (tryParseRlo(eff.escrow) ?? 0n).toString(),
                          plannedOps: (tryParseRlo(form.budget.opsBudget) ?? 0n).toString(),
                          firstRoundStartsAt: payload.budget.firstRoundStartsAt,
                        }}
                        onLive={() => {
                          setLive(true);
                          router.refresh();
                        }}
                      />
                      {live ? (
                        <Button asChild size="lg" className="h-11 w-fit px-5 text-[15px]">
                          <Link href={`/app/programs/${created}`}>
                            Go to the program
                            <ArrowRight className="size-4" aria-hidden="true" />
                          </Link>
                        </Button>
                      ) : null}
                    </section>
                  ) : (
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      Saving keeps a draft; nothing touches the chain yet. Then sign the campaign onto Rialo, fund it and open round 1, here or later from the program&apos;s setup.
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            {formError ? (
              <p role="alert" className="text-danger mt-6 text-sm">
                {formError}
              </p>
            ) : null}

            {created ? null : (
              <div
                data-sticky-actions
                className="bg-background/90 supports-[backdrop-filter]:bg-background/75 sticky bottom-0 z-20 -mx-4 mt-10 flex items-center justify-between gap-2 border-t px-4 py-4 supports-[backdrop-filter]:backdrop-blur-md sm:mx-0 sm:px-0"
              >
                {step > 0 ? (
                  <Button type="button" variant="ghost" disabled={pending} onClick={() => goTo(step - 1)}>
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    Back
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
                  <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
                    <SheetTrigger asChild>
                      <Button type="button" variant="outline" className="lg:hidden">
                        <Eye className="size-4" aria-hidden="true" />
                        Preview
                      </Button>
                    </SheetTrigger>
                    <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl p-5">
                      <SheetTitle className="sr-only">Join page preview</SheetTitle>
                      <PreviewContent form={form} amount={amount} step={step} limits={eff.limits} host={host} />
                    </SheetContent>
                  </Sheet>
                  {step < STEPS.length - 1 ? (
                    <Button type="button" onClick={next}>
                      Continue
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Button>
                  ) : (
                    <Button type="button" onClick={save} disabled={pending}>
                      {pending ? "Saving…" : "Save and go live"}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          <aside className="hidden lg:block" aria-label="Preview">
            <div className="sticky top-24 pb-8">
              <PreviewContent form={form} amount={amount} step={step} limits={eff.limits} host={host} />
            </div>
          </aside>
        </div>
      </FocusMain>
    </>
  );
}

function ReviewBlock({ title, onEdit, children }: { title: string; onEdit?: () => void; children: ReactNode }) {
  return (
    <section className="bg-card shadow-soft grid gap-2 rounded-[1.25rem] p-5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h2>
        {onEdit ? (
          <button type="button" onClick={onEdit} className="text-muted-foreground hover:text-foreground rounded-sm text-xs underline-offset-4 hover:underline" aria-label={`Edit ${title.toLowerCase()}`}>
            Edit
          </button>
        ) : null}
      </div>
      <div className="leading-relaxed">{children}</div>
    </section>
  );
}

/** "Step 2 of 5" on phones; the steps (done ones clickable) from 768px. */
function WizardProgress({ step, onGo }: { step: number; onGo?: (s: number) => void }) {
  return (
    <>
      <div className="flex w-full max-w-40 flex-col gap-1.5 md:hidden">
        <span className="text-muted-foreground text-center text-xs">
          Step {step + 1} of {STEPS.length}
        </span>
        <span className="bg-muted h-1 overflow-hidden rounded-full" aria-hidden="true">
          <span className="bg-brand block h-full rounded-full transition-[width] duration-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </span>
      </div>
      <ol className="hidden items-center gap-2 text-sm md:flex" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined} className="flex items-center gap-2">
            {i > 0 ? <span aria-hidden="true" className={cn("h-px w-4 lg:w-6", i <= step ? "bg-brand" : "bg-border")} /> : null}
            <span
              aria-hidden="true"
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-[11px] font-medium tabular-nums transition-colors",
                i < step && "bg-brand text-primary-foreground",
                i === step && "ring-brand text-brand bg-card ring-2",
                i > step && "bg-muted text-muted-foreground",
              )}
            >
              {i < step ? <Check className="size-3.5" strokeWidth={2.5} /> : i + 1}
            </span>
            {i < step && onGo ? (
              <button type="button" className="text-soft hover:text-foreground hidden rounded-sm xl:inline" onClick={() => onGo(i)}>
                {label}
              </button>
            ) : (
              <span className={cn("hidden xl:inline", i === step ? "text-foreground font-medium" : "text-muted-foreground")}>{label}</span>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

function ScoringExplainer({ rate }: { rate: bigint | null }) {
  return (
    <div className="bg-brand-subtle/60 rounded-[1.25rem] p-5 text-sm">
      <p className="font-medium">How a score becomes RLO</p>
      <ol className="text-soft mt-2 grid list-decimal gap-1 pl-5">
        <li>The agent scores each criterion from 0 to 10.</li>
        <li>The category&apos;s points are the average score ÷ 10 × its max points.</li>
        <li>Payout = points × the rate per point{rate !== null ? ` (${rlo(rate)}, set in the next step)` : ""}, within the limits the program enforces on chain.</li>
      </ol>
    </div>
  );
}

/** What contributors will see, updating as the owner types, then what matters for the current step. */
function PreviewContent({ form, amount, step, limits, host }: { form: Form; amount: (i: number) => string; step: number; limits: Limits; host: string }) {
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <span className="relative flex size-2" aria-hidden="true">
          <span className="bg-brand/40 absolute inset-0 animate-ping rounded-full [animation-duration:2.4s]" />
          <span className="bg-brand relative size-2 rounded-full" />
        </span>
        Live preview of your join page
      </p>
      <div className="bg-card shadow-lift overflow-hidden rounded-[1.25rem]">
        <div className="bg-muted/60 flex items-center gap-3 border-b px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="bg-border size-2.5 rounded-full" />
            <span className="bg-border size-2.5 rounded-full" />
            <span className="bg-border size-2.5 rounded-full" />
          </span>
          <span className="bg-background text-muted-foreground min-w-0 flex-1 truncate rounded-md px-2.5 py-1 font-mono text-[11px]">
            {host}/join/{form.basics.slug || "your-program"}
          </span>
        </div>
        <div className="p-5 sm:p-6">
          <p className="text-muted-foreground text-xs">Contributor program · Rialo DevNet</p>
          <p className="display mt-1 text-[1.75rem] leading-tight [overflow-wrap:anywhere]">{form.basics.name || "Your program"}</p>
          <p className="text-soft mt-2 line-clamp-4 text-sm leading-relaxed">{form.basics.description || "Your description appears here."}</p>
          {form.context.about.trim() ? (
            <div className="bg-background/60 mt-4 rounded-xl border px-3.5 py-2.5 text-xs">
              <p className="font-medium">About</p>
              <p className="text-soft mt-1 line-clamp-5 leading-relaxed whitespace-pre-line">{form.context.about}</p>
            </div>
          ) : null}
          {form.context.mustInclude.trim() ? (
            <p className="text-soft mt-3 text-xs">
              Every post must include <span className="text-foreground font-medium">{parseMustInclude(form.context.mustInclude).join(", ")}</span>
            </p>
          ) : null}
          <p className="text-muted-foreground mt-5 text-xs font-medium">Pays for</p>
          <ul className="mt-2 grid gap-2">
            {form.rubric.categories.map((c, i) => (
              <li key={i} className="bg-background/60 flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name || `Category ${i + 1}`}</span>
                  <span className="text-muted-foreground text-xs">{c.sourceTypes.map((t) => SOURCE_LABELS[t]).join(", ") || "No sources yet"}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="text-muted-foreground block text-[10px]">up to</span>
                  <span className="mono-num text-sm font-medium">{amount(i)}</span>
                </span>
              </li>
            ))}
          </ul>
          <span className="bg-primary text-primary-foreground mt-5 flex h-9 items-center justify-center rounded-lg text-sm font-medium">Sign in with X to join</span>
        </div>
      </div>

      {step === 3 ? (
        <div className="bg-card shadow-soft relative overflow-hidden rounded-[1.25rem] p-5 text-sm">
          <VaultArt className="pointer-events-none absolute top-4 right-4 size-16" />
          <p className="font-medium">The program enforces on chain</p>
          <dl className="mt-3 grid gap-1.5 pr-0 sm:pr-20">
            {(
              [
                ["Per payout", limits.maxPerPayout],
                ["Per contributor per round", limits.maxPerContributor],
                ["Per round", limits.maxPerRound],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-soft">{label}</dt>
                <dd className="mono-num">{v ? `${v} RLO` : "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground mt-3 text-xs leading-relaxed">Whatever the agent decides, the Merit program on Rialo won&apos;t pay past these.</p>
        </div>
      ) : step === 4 ? (
        <div className="bg-card shadow-soft rounded-[1.25rem] p-5 text-sm">
          <p className="font-medium">Going live signs</p>
          <ol className="text-soft mt-3 grid gap-2">
            {["Create the campaign on Rialo (your rules, on chain)", "Sign its name and brief", "Fund the escrow and the operations budget", "Open round 1, then publish"].map((t, i) => (
              <li key={t} className="flex gap-2.5">
                <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="bg-card shadow-soft rounded-[1.25rem] p-5 text-sm">
          <p className="font-medium">What a perfect submission earns</p>
          <ul className="mt-3 grid gap-1.5">
            {form.rubric.categories.map((c, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="text-soft truncate">{c.name || `Category ${i + 1}`}</span>
                <span className="mono-num">{amount(i)}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-3 text-xs leading-relaxed">Max points × rate per point. Most work scores below 10/10 and earns proportionally less.</p>
        </div>
      )}
    </div>
  );
}
