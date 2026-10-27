/**
 * Deterministic prompt-injection pre-check. Submission content is untrusted: anything that reads like an
 * instruction to the grader is flagged PROMPT_INJECTION_ATTEMPT, which always escalates to a human.
 * Matching runs on a normalized copy (NFKC, zero-width removed, leetspeak-lite, whitespace collapsed).
 */
const PATTERNS: { id: string; re: RegExp }[] = [
  {
    id: "ignore_instructions",
    re: /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|earlier|all|any|your|the|system)\b.{0,30}\b(instructions?|prompts?|rules?|guidelines?|directions?)\b/,
  },
  {
    id: "new_instructions",
    re: /\b(new|updated|real|actual|hidden)\s+(instructions?|system prompt|rules)\b/,
  },
  {
    id: "role_reassignment",
    re: /\byou are (now |no longer )?(an? |the )?(ai|assistant|grader|judge|reviewer|evaluator|model|chatbot|llm)\b/,
  },
  {
    id: "address_grader",
    re: /\b(dear|attention|note (to|for)|message (to|for)|hey)\s+(the\s+)?(ai|assistant|grader|judge|reviewer|evaluator|model|llm|bot)\b/,
  },
  {
    id: "score_demand",
    re: /\b(give|assign|award|rate|score|grade|mark)\b.{0,25}\b(this|me|it|the submission|my (post|work|thread|pr))\b.{0,25}(\b(max(imum)?|full|perfect|highest|top)\b|10\s*\/\s*10|100\s*%|\bten out of ten\b)/,
  },
  {
    id: "approve_demand",
    re: /\b(you (must|should|will)|please|make sure to|be sure to)\s+(approve|accept|pass|pay)\b/,
  },
  {
    id: "system_prompt",
    re: /\b(system|developer)\s*(prompt|message|instructions?)\b|<\s*\/?\s*(system|instructions?|submission[_ ]content|assistant|user)\s*>/,
  },
  {
    id: "output_control",
    re: /\b(respond|reply|output|answer|return)\s+(only\s+)?(with|in)\s+(json|the following|this|yes|approve)\b|"?(recommended_action|rubric_scores|confidence|total_points)"?\s*[:=]/,
  },
  {
    id: "mode_switch",
    re: /\b(admin|god|debug|maintenance|root|sudo|unrestricted)\s+mode\b|\byou are now (in|operating in|running in)\b.{0,30}\bmode\b/,
  },
  {
    id: "max_payout_demand",
    re: /\b(approve|award|grant|pay (me|this|it|us|my \w+))\b.{0,30}\b(max(imum)?|full|highest|top|largest)\s+(amount|payout|reward|points|score|bounty)\b/,
  },
  {
    // A chat-role label opening a sentence ("… ] SYSTEM: you are …"), as pasted from a fake transcript.
    id: "role_label",
    re: /(^|[\].!?:] )(system|assistant|developer|admin(istrator)?)\s*:\s/,
  },
  {
    id: "jailbreak",
    re: /\b(jailbreak|dan mode|developer mode|do anything now|prompt injection)\b/,
  },
];

export function normalizeForInjection(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u2060-\u2064\uFEFF\u00AD]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Second pass for obfuscation like "1gn0re prev10us 1nstruct10ns". */
const deLeet = (s: string) =>
  s.replace(/[10!|3]/g, (c) => ({ "1": "i", "0": "o", "!": "i", "|": "l", "3": "e" })[c]!);

export interface InjectionMatch {
  pattern: string;
  snippet: string;
  source: string;
}

/** Scan each labelled text; at most one match per pattern. */
export function detectInjection(texts: { source: string; text: string }[]): InjectionMatch[] {
  const matches: InjectionMatch[] = [];
  for (const { source, text } of texts) {
    if (!text) continue;
    const base = normalizeForInjection(text);
    for (const norm of [base, deLeet(base)]) {
      for (const { id, re } of PATTERNS) {
        if (matches.some((x) => x.pattern === id)) continue;
        const m = re.exec(norm);
        if (m) {
          const start = Math.max(0, m.index - 20);
          matches.push({
            pattern: id,
            source,
            snippet: norm.slice(start, m.index + m[0].length + 20).trim(),
          });
        }
      }
    }
  }
  return matches;
}
