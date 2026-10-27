import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { hex } from "@/lib/merit/codec";
import { pythonJson } from "@/lib/merit/judgement";

/**
 * The program's context for the agent: what the owner writes (trusted), the links it reads once, the tokens every
 * post must include, and the agent's owner-reviewed understanding. Decisions are judged against one saved version
 * and record its hash.
 */

export const CONTEXT_ABOUT_MIN = 40;
export const CONTEXT_ABOUT_MAX = 3000;
export const CONTEXT_MAX_LINKS = 3;
export const CONTEXT_MAX_MUST_INCLUDE = 5;

/** An https link, or an X handle (@name) the program posts from. */
export const ContextLink = z
  .string()
  .trim()
  .max(300)
  .refine(
    (s) => /^@[A-Za-z0-9_]{1,15}$/.test(s) || /^https:\/\/[^\s]+\.[^\s]+$/.test(s),
    "A link starting with https://, or an X handle like @rialo",
  );

/** A link or domain (rialo.io), an @mention or a #hashtag that every post must include. */
export const MustIncludeToken = z
  .string()
  .trim()
  .max(120)
  .refine(
    (s) =>
      /^@[A-Za-z0-9_]{1,15}$/.test(s) ||
      /^#[\p{L}\p{N}_]{1,60}$/u.test(s) ||
      /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s),
    "A link (rialo.io), an @mention or a #hashtag",
  );

export const ContextUnderstanding = z.object({
  summary: z.string().trim().min(1).max(800),
  keyFacts: z.array(z.string().trim().min(1).max(240)).max(10),
  onTopic: z.array(z.string().trim().min(1).max(120)).max(8),
  offTopic: z.array(z.string().trim().min(1).max(120)).max(8),
});
export type ContextUnderstanding = z.infer<typeof ContextUnderstanding>;

/** What the owner submits to be read (wizard or Settings). */
export const ContextReadInput = z.object({
  about: z
    .string()
    .trim()
    .min(CONTEXT_ABOUT_MIN, `Tell the agent a bit more (at least ${CONTEXT_ABOUT_MIN} characters)`)
    .max(CONTEXT_ABOUT_MAX),
  links: z.array(ContextLink).max(CONTEXT_MAX_LINKS).default([]),
  mustInclude: z.array(MustIncludeToken).max(CONTEXT_MAX_MUST_INCLUDE).default([]),
});
export type ContextReadInput = z.infer<typeof ContextReadInput>;

/** What gets saved with the program: the inputs plus the (possibly edited) understanding. */
export const ContextSaveInput = ContextReadInput.extend({
  understanding: ContextUnderstanding.nullable().default(null),
});
export type ContextSaveInput = z.infer<typeof ContextSaveInput>;

/** Split a comma/space separated "must include" field into tokens. */
export function parseMustInclude(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const sha = (value: unknown) => hex(sha256(new TextEncoder().encode(pythonJson(value))));

/** The hash a read is cached under: same owner text, links and tokens → same understanding. */
export function contextInputHash(i: ContextReadInput): string {
  return sha({ about: i.about, links: i.links, must_include: i.mustInclude });
}

/** The hash a decision commits to: the saved context exactly as the agent saw it. */
export function contextHash(c: { version: number; about: string; links: string[]; mustInclude: string[]; understanding: ContextUnderstanding | null }): string {
  return sha({
    version: c.version,
    about: c.about,
    links: c.links,
    must_include: c.mustInclude,
    understanding: c.understanding
      ? { summary: c.understanding.summary, key_facts: c.understanding.keyFacts, on_topic: c.understanding.onTopic, off_topic: c.understanding.offTopic }
      : null,
  });
}

/**
 * Whether a post includes a required token: @mentions and #hashtags as whole words; links and domains anywhere in the
 * text or its expanded links (X shortens links in the text to t.co).
 */
export function includesToken(text: string, urls: string[], token: string): boolean {
  const t = token.trim().toLowerCase();
  const body = text.toLowerCase();
  if (t.startsWith("@") || t.startsWith("#")) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, "u").test(body);
  }
  const bare = t.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  const hay = [body, ...urls.map((u) => u.toLowerCase())].join(" ").replace(/https?:\/\//g, "").replace(/www\./g, "");
  return hay.includes(bare);
}
