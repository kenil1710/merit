/**
 * 64-bit SimHash over 3-word shingles (FNV-1a 64 per shingle). Near-identical texts land within a few bits of each
 * other; we pair it with Postgres pg_trgm similarity for the percentage shown to people.
 */
const MASK = (1n << 64n) - 1n;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

function fnv1a64(s: string): bigint {
  let h = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(s)) {
    h ^= BigInt(byte);
    h = (h * FNV_PRIME) & MASK;
  }
  return h;
}

export function normalizeForSimilarity(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Unsigned 64-bit fingerprint, or null when there are too few words to be meaningful. */
export function simhash64(text: string): bigint | null {
  const words = normalizeForSimilarity(text).split(" ").filter(Boolean);
  if (words.length < 8) return null;
  const weights = new Array<number>(64).fill(0);
  for (let i = 0; i + 3 <= words.length; i++) {
    const h = fnv1a64(words.slice(i, i + 3).join(" "));
    for (let b = 0; b < 64; b++) weights[b]! += (h >> BigInt(b)) & 1n ? 1 : -1;
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) if (weights[b]! > 0) out |= 1n << BigInt(b);
  return out;
}

export function hamming(a: bigint, b: bigint): number {
  let x = (a ^ b) & MASK;
  let n = 0;
  while (x) {
    x &= x - 1n;
    n++;
  }
  return n;
}

/** Postgres bigint is signed: store the unsigned fingerprint in two's complement. */
export const toSigned64 = (u: bigint): bigint => (u >= 1n << 63n ? u - (1n << 64n) : u);
export const fromSigned64 = (s: bigint): bigint => (s < 0n ? s + (1n << 64n) : s);
