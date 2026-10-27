import "server-only";

import { OWNER_NETWORK, parseOwnerSignIn, verifySignature } from "@/lib/merit/messages";

export type OwnerSignInResult =
  | { ok: true; address: string }
  | { ok: false; error: "malformed" | "wrong_domain" | "wrong_uri" | "wrong_network" | "stale" | "bad_signature" | "nonce_used" };

const MAX_AGE_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 60_000;

/**
 * Verifies an owner sign-in (Merit's SIWE for Rialo). Cheap structural checks first, then the ed25519 signature, and
 * only then the single-use nonce, so a forged request can't burn a real owner's nonce.
 */
export async function verifyOwnerSignIn(input: {
  message: string;
  signature: string;
  expectedOrigin: string;
  consumeNonce: (nonce: string, address: string) => Promise<boolean>;
  now?: Date;
}): Promise<OwnerSignInResult> {
  const m = parseOwnerSignIn(input.message);
  if (!m) return { ok: false, error: "malformed" };
  const origin = new URL(input.expectedOrigin);
  if (m.domain !== origin.host) return { ok: false, error: "wrong_domain" };
  let uriOrigin: string;
  try {
    uriOrigin = new URL(m.uri).origin;
  } catch {
    return { ok: false, error: "wrong_uri" };
  }
  if (uriOrigin !== origin.origin) return { ok: false, error: "wrong_uri" };
  if (m.network !== OWNER_NETWORK) return { ok: false, error: "wrong_network" };
  const issued = Date.parse(m.issuedAt);
  const now = (input.now ?? new Date()).getTime();
  if (Number.isNaN(issued) || issued > now + CLOCK_SKEW_MS || now - issued > MAX_AGE_MS) return { ok: false, error: "stale" };
  if (!verifySignature(input.message, input.signature, m.address)) return { ok: false, error: "bad_signature" };
  if (!(await input.consumeNonce(m.nonce, m.address))) return { ok: false, error: "nonce_used" };
  return { ok: true, address: m.address };
}
