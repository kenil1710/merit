// Sends Merit owner instructions (built by lib/merit/instructions.ts, the builders the app uses) signed by a Rialo
// keystore key, one transaction each, and prints every signature with its Merit log lines.
// Usage: npx tsx scripts/owner-send.ts <keystore alias> <slug hex> <steps JSON>
//   steps: [{"ix":"createCampaign","config":{...}}, {"ix":"setLimits","limits":{...}}, {"ix":"fund","amount":"…"}, …]
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair, TransactionBuilder, createRialoClient } from "@rialo/ts-cdk";
import { RpcClient } from "../lib/merit/chain";
import { unhex } from "../lib/merit/codec";
import { ix, toCdkInstruction, type PlainInstruction } from "../lib/merit/instructions";
import { nonce, workflowAddress } from "../lib/merit/pda";

const [alias, slugHex, stepsJson] = process.argv.slice(2);
const secret = Uint8Array.from(JSON.parse(readFileSync(path.join(os.homedir(), "Library/Application Support/rialo", `${alias}.keypair`), "utf8")) as number[]);
const signer = Keypair.fromSecretKey(secret.subarray(0, 32));
const owner = signer.publicKey.toString();
const slug = unhex(slugHex!);
const client = createRialoClient({ chain: { id: "rialo:devnet", name: "devnet", rpcUrl: "https://devnet.rialo.io" } });
const rpc = new RpcClient("https://devnet.rialo.io");
const big = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, /^\d+$/.test(v) ? BigInt(v) : v]));

console.log(JSON.stringify({ owner, campaign: workflowAddress(owner, nonce(slug)) }));
for (const step of JSON.parse(stepsJson!) as { ix: string; config?: Record<string, string>; limits?: Record<string, string>; amount?: string }[]) {
  let instruction: PlainInstruction;
  if (step.ix === "createCampaign") instruction = ix.createCampaign(owner, slug, big(step.config!) as never);
  else if (step.ix === "setLimits") instruction = ix.setLimits(owner, slug, big(step.limits!) as never);
  else if (step.ix === "fund" || step.ix === "fundOps" || step.ix === "withdraw" || step.ix === "withdrawOps") instruction = ix[step.ix](owner, slug, BigInt(step.amount!));
  else instruction = (ix as unknown as Record<string, (o: string, s: Uint8Array) => PlainInstruction>)[step.ix]!(owner, slug);
  const tx = TransactionBuilder.create().setPayer(signer.publicKey).setValidFrom(BigInt(Date.now())).setConfigHashPrefix(await client.getConfigHashPrefix()).addInstruction(toCdkInstruction(instruction)).build().sign(signer);
  const { signature } = await client.sendAndConfirmTransaction(tx.serialize());
  const { err, logs } = await rpc.logs(signature);
  console.log(JSON.stringify({ step: step.ix, signature, ok: !err, merit: logs.map((l) => /Program log: (Merit .*)$/.exec(l)?.[1]).filter(Boolean) }));
  if (err) process.exit(1);
}
