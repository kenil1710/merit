// Runs one SQL statement against the Neon database in .env.local (DATABASE_URL) and prints the rows as JSON.
// Usage: node scripts/neon-query.mjs "<sql>" [params as JSON array]
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"(.*)"$/, "$1")]),
);
const sql = neon(env.DATABASE_URL);
const [query, params] = process.argv.slice(2);
console.log(JSON.stringify(await sql.query(query, params ? JSON.parse(params) : []), null, 1));
