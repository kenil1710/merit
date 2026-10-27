import { parseMustInclude } from "@/lib/shared/context";

/** The context as typed: lists are one item per line, "must include" is comma or space separated. */
export type UnderstandingDraft = { summary: string; keyFacts: string; onTopic: string; offTopic: string };
export type ContextDraft = { about: string; links: string; mustInclude: string; understanding: UnderstandingDraft | null };

export const emptyContextDraft = (): ContextDraft => ({ about: "", links: "", mustInclude: "", understanding: null });

export const ABOUT_PLACEHOLDER =
  "Rialo is a blockchain where programs run their own timers, read the web through REX and spend through Latch guardrails. We want builders to explain what they ship on Rialo: threads that show how something works, tutorials and demos.\n\nPost about: building on Rialo, REX, Latch, native timers.\nAvoid: token price talk, airdrop farming, memes, and AI-written summaries of our docs.";

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);

/** The payload for the API (ContextSaveInput). */
export function contextPayload(d: ContextDraft) {
  return {
    about: d.about,
    links: lines(d.links.replace(/,/g, "\n")),
    mustInclude: parseMustInclude(d.mustInclude),
    understanding: d.understanding
      ? { summary: d.understanding.summary.trim(), keyFacts: lines(d.understanding.keyFacts), onTopic: lines(d.understanding.onTopic), offTopic: lines(d.understanding.offTopic) }
      : null,
  };
}
