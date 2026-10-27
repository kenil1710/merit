// Sends one Merit instruction exactly as given (program id, account metas,
// data hex), signed by a Rialo keystore key, and prints the signature, status
// and Merit log lines. Used by the Phase 5 checks to submit instructions the
// generated builders would never produce.
// Usage: node scripts/send-raw.mjs <keystore alias> <json: {accounts:[{pubkey,isSigner,isWritable}], data}>
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair, PublicKey, TransactionBuilder, createRialoClient } from "@rialo/ts-cdk";

const [alias, spec] = process.argv.slice(2);
const { accounts, data } = JSON.parse(spec);
const secret = Uint8Array.from(JSON.parse(readFileSync(path.join(os.homedir(), "Library/Application Support/rialo", `${alias}.keypair`), "utf8")));
const signer = Keypair.fromSecretKey(secret.subarray(0, 32));
const client = createRialoClient({ chain: { id: "rialo:devnet", name: "devnet", rpcUrl: "https://devnet.rialo.io" } });
const instruction = {
  programId: PublicKey.fromString("4qBwWYWn7ougS7sHP21x4yTDk4cwmyEqUiqNmKAYVuk6"),
  accounts: accounts.map((a) => ({ pubkey: PublicKey.fromString(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
  data: Uint8Array.from(Buffer.from(data, "hex")),
};
const tx = TransactionBuilder.create().setPayer(signer.publicKey).setValidFrom(BigInt(Date.now()))
  .setConfigHashPrefix(await client.getConfigHashPrefix()).addInstruction(instruction).build().sign(signer);
let signature;
try {
  signature = (await client.sendAndConfirmTransaction(tx.serialize())).signature;
} catch (error) {
  console.log(JSON.stringify({ signature: null, status: "rejected before execution", error: String(error.message ?? error).slice(0, 300) }));
  process.exit(0);
}
const res = await fetch("https://devnet.rialo.io", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [{ signature }] }) }).then((r) => r.json());
const tx2 = res.result?.value ?? res.result;
const logs = tx2?.meta?.logMessages ?? [];
console.log(JSON.stringify({ signature, status: tx2?.meta?.err ? `failed ${JSON.stringify(tx2.meta.err)}` : "success",
  merit: logs.filter((l) => l.includes("Merit")).map((l) => l.replace(/^.*Program log: /, "")) }));
