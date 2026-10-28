// Every round of every program's campaign, as the public record shows it: for each ledger entry, whether its judge
// record exists and matches the on-chain hash, and which transactions the drawer links. Reading it also rebuilds a
// missing judge record from Neon and saves it (campaignView with repair; page views never write), so this doubles
// as the repair.
// Usage: npx tsx --env-file=.env.local --conditions=react-server scripts/check-records.ts [campaign address ...]
import { isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { campaignView } from "@/lib/server/campaign-view";

const args = process.argv.slice(2);
const db = await getDb();
const campaigns = args.length
  ? args
  : (await db.select({ a: schema.programs.campaignAddress }).from(schema.programs).where(isNotNull(schema.programs.campaignAddress))).map((r) => r.a!);
let problems = 0;
for (const address of campaigns) {
  const view = await campaignView(address, { repair: true });
  if (!view) {
    console.log(`${address}: not a live campaign account`);
    continue;
  }
  console.log(`${address} (${view.meta?.name ?? "unnamed"}): round ${view.round.number}, ${view.status.text}`);
  for (const r of view.rounds) {
    for (const d of r.decisions) {
      const issues = [
        !d.judge && "no judge record",
        d.judge && !d.judge.hashMatches && "judge hash mismatch",
        !d.tx.approve && "no approve tx",
        d.status === "Verified" && !d.tx.verdict && "no verdict tx",
        d.paid && !d.tx.payout && "paid but no payout tx",
      ].filter(Boolean);
      problems += issues.length;
      console.log(`  round ${r.round} #${d.index + 1} post ${d.postId} score ${d.score}/100 ${d.status}${d.paid ? " paid" : ""} · approve ${d.tx.approve?.slice(0, 8) ?? "—"} verdict ${d.tx.verdict?.slice(0, 8) ?? "—"} payout ${d.tx.payout?.slice(0, 8) ?? "—"}${issues.length ? `  ⚠ ${issues.join(", ")}` : "  ok"}`);
    }
  }
}
console.log(problems ? `${problems} problem(s)` : "every entry ok");
process.exit(0);
