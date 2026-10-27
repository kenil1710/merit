"use client";

import { Check, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ABOUT_PLACEHOLDER, contextPayload, type ContextDraft, type UnderstandingDraft } from "@/lib/context-draft";
import { CONTEXT_ABOUT_MIN } from "@/lib/shared/context";

type Source = { url: string; ok: boolean; title?: string | null; note?: string | null };

/**
 * Context for the agent: what the program is about (required), links it reads once, and what every post must include.
 * "Read it" asks the agent what it understood (through merit-judge); the owner keeps or edits that before saving, or
 * writes it themselves.
 */
export function ContextEditor({
  value,
  onChange,
  errors = {},
  idPrefix = "ctx",
}: {
  value: ContextDraft;
  onChange: (patch: Partial<ContextDraft>) => void;
  errors?: Partial<Record<"about" | "links" | "mustInclude", string>>;
  idPrefix?: string;
}) {
  const id = (s: string) => `${idPrefix}-${s}`;
  const u = value.understanding;
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const tooShort = value.about.trim().length < CONTEXT_ABOUT_MIN;
  async function read() {
    setReading(true);
    setReadError(null);
    try {
      const p = contextPayload(value);
      const res = await fetch("/api/owner/context/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ about: p.about, links: p.links, mustInclude: p.mustInclude }),
      });
      const body = (await res.json()) as { understanding?: { summary: string; keyFacts: string[]; onTopic: string[]; offTopic: string[] } | null; sources?: Source[]; error?: string | null };
      setSources(body.sources ?? []);
      if (!res.ok || !body.understanding) throw new Error(body.error ?? "The agent couldn't read it this time.");
      const x = body.understanding;
      onChange({ understanding: { summary: x.summary, keyFacts: x.keyFacts.join("\n"), onTopic: x.onTopic.join("\n"), offTopic: x.offTopic.join("\n") } });
    } catch (e) {
      setReadError((e as Error).message);
    } finally {
      setReading(false);
    }
  }
  const setU = (patch: Partial<UnderstandingDraft>) => onChange({ understanding: { ...(u ?? { summary: "", keyFacts: "", onTopic: "", offTopic: "" }), ...patch } });
  return (
    <div className="grid gap-6">
      <Field id={id("about")} label="About this program" error={errors.about} hint="What the project is, what to post about, what to avoid. The agent treats this as the truth when it reviews work.">
        <Textarea id={id("about")} rows={7} placeholder={ABOUT_PLACEHOLDER} value={value.about} onChange={(e) => onChange({ about: e.target.value })} aria-invalid={!!errors.about} />
      </Field>
      <Field id={id("links")} label="Links (optional)" error={errors.links} hint="Website, docs or your X handle, one per line (up to 3).">
        <Textarea
          id={id("links")}
          rows={3}
          placeholder={"https://rialo.io\nhttps://docs.rialo.io\n@RialoHQ"}
          value={value.links}
          onChange={(e) => onChange({ links: e.target.value })}
          aria-invalid={!!errors.links}
          className="font-mono text-[13px]"
        />
      </Field>
      <Field id={id("must")} label="Posts must include (optional)" error={errors.mustInclude} hint="A link, @mention or #hashtag. Checked automatically; work without it goes to you for review.">
        <Input id={id("must")} placeholder="@RialoHQ, #BuildOnRialo, rialo.io" value={value.mustInclude} onChange={(e) => onChange({ mustInclude: e.target.value })} aria-invalid={!!errors.mustInclude} />
      </Field>

      <section aria-labelledby={id("understood")} className="bg-card shadow-soft grid gap-4 rounded-2xl border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={id("understood")} className="inline-flex items-center gap-2 font-medium">
            <Sparkles className="text-brand size-4" strokeWidth={1.5} aria-hidden="true" />
            Here&apos;s what I understood
          </h2>
          <Button type="button" size="sm" variant={u ? "outline" : "default"} disabled={reading || tooShort} onClick={read}>
            {reading ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Reading…
              </>
            ) : u ? (
              "Read again"
            ) : (
              "Read it"
            )}
          </Button>
        </div>
        {readError ? (
          <p role="alert" className="bg-warning-subtle rounded-lg px-3 py-2.5 text-sm">
            {readError}
          </p>
        ) : null}
        {!u ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {tooShort
              ? "Write a few sentences above, then let the agent read them and your links."
              : "Let the agent read your text and links: you'll see its summary, key facts and topics, and can edit anything."}{" "}
            <button type="button" className="text-foreground underline underline-offset-4" onClick={() => setU({})}>
              Or write it yourself
            </button>
            . Optional: without it the agent uses your text as written.
          </p>
        ) : (
          <div className="grid gap-4">
            <UField id={id("summary")} label="Summary" rows={3} value={u.summary} onChange={(v) => setU({ summary: v })} />
            <UField id={id("facts")} label="Key facts the agent checks claims against" hint="One per line." rows={4} value={u.keyFacts} onChange={(v) => setU({ keyFacts: v })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <UField id={id("on")} label="On topic" rows={4} value={u.onTopic} onChange={(v) => setU({ onTopic: v })} />
              <UField id={id("off")} label="Off topic" rows={4} value={u.offTopic} onChange={(v) => setU({ offTopic: v })} />
            </div>
            <button type="button" className="text-muted-foreground hover:text-foreground w-fit text-xs underline underline-offset-4" onClick={() => onChange({ understanding: null })}>
              Remove the summary
            </button>
          </div>
        )}
        {sources.length ? (
          <ul className="grid gap-1.5 border-t pt-3 text-xs" aria-label="Links the agent read">
            {sources.map((x) => (
              <li key={x.url} className="flex items-start gap-2">
                {x.ok ? <Check className="text-success mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : <TriangleAlert className="text-warning mt-0.5 size-3.5 shrink-0" aria-hidden="true" />}
                <span className="min-w-0">
                  <span className="font-mono break-all">{x.url}</span>
                  {x.note ? <span className="text-muted-foreground"> · {x.note}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p role="alert" className="text-danger text-xs">{error}</p> : null}
      {hint ? <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p> : null}
    </div>
  );
}

function UField(props: { id: string; label: string; hint?: string; rows: number; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Textarea id={props.id} rows={props.rows} value={props.value} onChange={(e) => props.onChange(e.target.value)} className="text-sm" />
      {props.hint ? <p className="text-muted-foreground text-xs">{props.hint}</p> : null}
    </div>
  );
}
