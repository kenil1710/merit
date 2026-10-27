// Messages a wallet signs off-chain. Shared so the browser signs exactly what
// the server verifies.

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { hex } from "./codec";

export function linkMessage(xUserId: string, username: string, wallet: string, issuedAt: string): string {
  return `Merit: link X account ${xUserId} (@${username}) to Rialo wallet ${wallet}. Issued ${issuedAt}.`;
}

export function campaignMessage(address: string, name: string, brief: string): string {
  const digest = hex(sha256(new TextEncoder().encode(`${name}\n${brief}`)));
  return `Merit: describe campaign ${address} as sha256 ${digest}.`;
}

export function verifySignature(message: string, signatureBase58: string, wallet: string): boolean {
  try {
    return ed25519.verify(base58.decode(signatureBase58), new TextEncoder().encode(message), base58.decode(wallet), { zip215: false });
  } catch {
    return false;
  }
}

/// Owner sign-in, shaped like Sign-In with Ethereum (EIP-4361) for a Rialo wallet. The domain and URI bind the
/// signature to this site, the nonce makes it single-use, and it is never a transaction.
export type OwnerSignIn = { domain: string; address: string; uri: string; network: string; nonce: string; issuedAt: string };

export const OWNER_NETWORK = "rialo:devnet";
const OWNER_STATEMENT = "Sign in to Merit as a campaign owner. This signature costs nothing and sends no transaction.";

export function ownerSignInMessage(m: OwnerSignIn): string {
  return [
    `${m.domain} wants you to sign in with your Rialo account:`,
    m.address,
    "",
    OWNER_STATEMENT,
    "",
    `URI: ${m.uri}`,
    `Network: ${m.network}`,
    `Nonce: ${m.nonce}`,
    `Issued At: ${m.issuedAt}`,
  ].join("\n");
}

const OWNER_PATTERN = new RegExp(
  [
    "^(?<domain>[^\\s/]+) wants you to sign in with your Rialo account:",
    "(?<address>[1-9A-HJ-NP-Za-km-z]{32,44})",
    "",
    OWNER_STATEMENT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "",
    "URI: (?<uri>\\S+)",
    "Network: (?<network>\\S+)",
    "Nonce: (?<nonce>[0-9a-f]{32})",
    "Issued At: (?<issuedAt>\\S+)$",
  ].join("\\n"),
);

/// Parses a message built by ownerSignInMessage; anything else (extra lines, another statement) is rejected.
export function parseOwnerSignIn(message: string): OwnerSignIn | null {
  const g = OWNER_PATTERN.exec(message)?.groups;
  if (!g) return null;
  const m = { domain: g.domain, address: g.address, uri: g.uri, network: g.network, nonce: g.nonce, issuedAt: g.issuedAt };
  return ownerSignInMessage(m) === message ? m : null;
}

/// Joining a program: the X account names the Rialo wallet it will be paid in, and the wallet signs it. The nonce
/// is single-use and bound to the X account.
export function joinMessage(m: { program: string; xUserId: string; username: string; wallet: string; nonce: string }): string {
  return `Merit: join ${m.program} as X account ${m.xUserId} (@${m.username}), paid to Rialo wallet ${m.wallet}. Nonce ${m.nonce}.`;
}
