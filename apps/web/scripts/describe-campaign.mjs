// Publishes a campaign's name and brief through /api/campaigns, signed by the
// owner key from the Rialo keystore (same message the owner dashboard signs).
// Usage: node scripts/describe-campaign.mjs <base url> <keystore alias> <campaign> <slug hex> <name> <brief>
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";

const [base, alias, address, slug, name, brief] = process.argv.slice(2);
const key = Uint8Array.from(JSON.parse(readFileSync(path.join(os.homedir(), "Library/Application Support/rialo", `${alias}.keypair`), "utf8")));
const digest = Buffer.from(sha256(new TextEncoder().encode(`${name}\n${brief}`))).toString("hex");
const message = `Merit: describe campaign ${address} as sha256 ${digest}.`;
const signature = base58.encode(ed25519.sign(new TextEncoder().encode(message), key.subarray(0, 32)));
const response = await fetch(`${base}/api/campaigns`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address, slug, name, brief, signature }),
});
console.log(response.status, await response.text());
