# Merit web app (`apps/web`)

Next.js 16 (App Router), React 19, Tailwind 4, `@rialo/ts-cdk` 0.18.1, `@anthropic-ai/sdk`.
Status: **deployed** on Vercel as project `merit` (`https://merit-ruby-two.vercel.app`), against Rialo DevNet and Merit's own Neon database.

## Pages

| Route | What it shows | Data source |
| --- | --- | --- |
| `/` | Landing: what Merit does, live totals from the chain | campaign accounts |
| `/explore` | Campaigns with a published name and brief | `getAccountsByOwner(program)` + campaign briefs |
| `/join` | Programs taking contributors (a directory only) | Neon `programs` |
| `/join/[slug]` | A program's join page: X sign-in, eligibility, embedded wallet, join with a wallet signature, then submit | session, `/api/contributor/*` |
| `/c` · `/c/[address]` | A contributor's programs and submissions (a slug); a campaign without a program redirects to its public record | Neon, chain |
| `/p/[slug]` · `/p/[slug]/rounds/[n]` | Public record: every decision in every round, judge reasons (hash-checked), REX proof per validator, verdict, payout links | campaign and ledger accounts, REX report PDAs, Merit log lines |
| `/tx/[sig]` | A transaction's Merit log lines and its full program log | `getTransaction` |
| `/app/*` | Owner app: wizard, go-live, submissions and review queue, contributors, rounds, treasury, audit log, settings, metrics | Neon + chain, owner wallet sign-in |
| `/owner` | The original campaign console (create, fund, open, end, withdraw, resume, refund) | browser-signed transactions via the relay |
| `/guardrails` | `merit-judge` and `merit-x` capabilities, budget, audit and "try a bad request" probes, read live | `/.well-known/latch-self/*` |
| `/security` | How Merit was checked: the two AI-assisted reviews (not a third-party audit), the 30 on-chain negative tests, every finding's status, the known limits | static, links to `docs/` on GitHub |

## Trust boundaries

- **Browser**
  - The embedded wallet is a CDK `Keypair`, encrypted with the user's passphrase (PBKDF2-SHA256, 310k rounds, then AES-GCM) and kept in `localStorage`. The secret key never leaves the browser.
  - The wallet panel (any sidebar wallet chip, or "Manage wallet" on the wallet strip of /join, the owner overview and the wizard) shows the address, balance and faucet cooldown, and can download the encrypted vault as a backup file, import one (the passphrase must open it; it never replaces a different stored wallet) and forget the wallet (type FORGET, backup offered first).
  - The unlocked key lives in memory only, one per tab, shared by the wallet panel and the owner app. Lock clears it and ends the owner's signed session, so signing needs the passphrase again, also after a reload.
  - A new passphrase needs 8+ characters and a matching confirmation; a strength hint nudges toward 12+ characters or four words.
  - Owner instructions are signed in the browser.
  - Joining a program signs an off-chain message naming the X account and the payout wallet (single-use nonce); there is no transaction.
  - A Content-Security-Policy keeps scripts, styles and every fetch on this site.
- **`/api/rialo` relay**
  - The browser's only path to DevNet, which sends no CORS headers.
  - Rejects batch requests and allows a fixed list of methods (reads, `sendTransaction`, `requestAirdrop`).
  - The faucet is capped at 1 RLO per call: once per wallet per day, a few per network per day, and not for a wallet that holds 1 RLO (all in Neon). The relay as a whole allows 300 calls a minute per network.
  - Program-account listing is limited to Merit's program, and requests and transactions have size caps.
- **Server (agent)**
  - Holds the DevNet agent key, which opens round ledgers and approves.
  - Encrypts the `merit-x` token for the agent with `encryptSecretBytes`, framed for Borsh first.
  - Sends one transaction at a time, because control instructions on the same ledger collide on Venus branch 0.
- **Latch**
  - The server holds only `lat_` tokens.
  - The judge calls Claude through `merit-judge` (Anthropic SDK with `authToken` and `baseURL=https://onlatch.com/proxy`).
  - Post reads go through `merit-x`.
- **Judge record**
  - Serialized as Python-compatible `json.dumps(sort_keys=True)`; its SHA-256 is the `submission_hash` the agent writes on chain.
  - The campaign page recomputes it and shows "Hash matches chain", or a mismatch.
- **Audit log**
  - `audit_events` rejects updates and deletes by trigger. The app's database role owns the table, so a compromised
    server could still drop the trigger; a separate migration role would make the claim hold (not done).
- **X sign-in**
  - OAuth 2.0 with PKCE (`users.read tweet.read`).
  - The user's token is used once to read their own id and handle, then dropped.
  - The session is an HMAC-signed, HttpOnly cookie holding only those two values.

## Submit pipeline (fails closed)

The only path to an approval is the agent (`lib/agent/pipeline.ts`), reached from `/join/[slug]`. The v1
`/api/submit` and `/api/link` endpoints were retired after the 2026-10-28 audit (H-2) and answer 410.

1. **Member:** signed in with X, joined the program (eligibility minimums met, joining not paused) with a wallet that
   signed the join message.
2. **Rate limits:** per X account and per network, counted in Neon (`rate_hits`) so every server instance agrees.
3. **Post checks:** an X status link by the member, read through `merit-x`, written inside the round (or its grace),
   not a duplicate URL or a near-duplicate, under the per-round submission limit.
4. **Judge:** hard flags (including the deterministic prompt-injection check) reject before any model spend; the
   post is fenced with a random boundary; Claude scores it through `merit-judge`.
5. **Rules engine:** approve, reject, or send to the owner's review queue (confidence, amount, soft flags). An
   injection flag always goes to review.
6. **On chain:** the agent opens the round ledger if needed and sends `approve`; REX verification starts, and the
   round's own timer pays. A transient failure (X, Latch or the model busy) leaves the submission pending: it is
   retried once in the request, then by the daily cron backstop (06:00 UTC).

## Tests

```bash
cd apps/web
npm test                             # unit: instruction builders vs Rust vectors, judge hashing
MERIT_LIVE=1 npx vitest run          # + live DevNet: decode round 1; full agent path through REX
npx playwright test                  # e2e on real DevNet (isolated server on :3100, own data dir)
```

- **`test/instructions.test.ts`:** each TypeScript builder must match `merit-tools vectors` (the Rust builders Venus generates) account for account and byte for byte. That covers all 23 instructions plus the ledger and payee slugs.
- **`test/agent.live.test.ts`:** an owner creates and opens a campaign; the server's agent module opens the ledger with a token encrypted by the TypeScript CDK and approves jack's 2006 post. Validators must decrypt the token, read the post through Latch and agree, and the program must rule `OutsideRound`. The test then ends the campaign and withdraws.
- **`e2e/owner.spec.ts`:** in a real browser, creates a wallet, uses the faucet, creates, funds, opens, ends and withdraws.
- **`e2e/public.spec.ts`:**
  - the round 1 page shows the hash match, "Unanimous 4/4", the four validator outputs, the verdict, payout links and the approve transaction;
  - Explore lists campaigns;
  - Guardrails is live;
  - the relay refuses abuse;
  - the retired v1 `/api/submit` and `/api/link` answer 410.
- **`e2e/owner-app.spec.ts`, `contributor.spec.ts`, `review.spec.ts`, `pages.spec.ts`:** the owner wizard and go-live
  on DevNet, joining and submitting, the review queue, and every app page.
- **`e2e/wallet.spec.ts`:** the wallet panel end to end (create with confirm and strength, backup, forget, import), Lock
  really locking the owner app across a reload, the Security page, and Explore's shared labels and ticking countdowns.
- **`e2e/live.spec.ts`** (only with `MERIT_E2E_URL`): the faucet's once-per-wallet-per-day cooldown and "Read it"
  answering within 20 seconds, on the deployed site.
- **`test/audit-fixes.test.ts`:** the audit fixes on the web side (sign-in return path, Neon rate limits, typed cookies,
  housekeeping).

## Configuration (`apps/web/.env.local`, gitignored; see `.env.example`)

Production values live in the Vercel project `merit` (sensitive variables), and `vercel env pull` writes them here.

| Variable | What |
| --- | --- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Merit's Neon database (`MERIT_DB=pglite` uses an in-memory one instead) |
| `MERIT_JUDGE_LAT`, `MERIT_X_LAT`, `MERIT_JUDGE_LAT__<campaign>` | Latch tokens: parents, and a campaign's child judge latch |
| `MERIT_AGENT_SECRET_KEY` | The DevNet agent key (`merit-agent-devnet`) |
| `MERIT_SESSION_SECRET` | Signs the session, owner and OAuth cookies |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | The X OAuth 2.0 app ("Sign in with X"), callback `<public url>/api/auth/x/callback` |
| `MERIT_PUBLIC_URL` | The site's own URL |
| `CRON_SECRET` | Bearer for the daily `/api/cron/agent` backstop |
| `MERIT_CHECK_KEY` | Key the merit-check latch sends to `/api/latch/tweet-check` |

**Store.** `lib/server/store.ts` keeps judge records, v1 wallet links (read-only now) and campaign briefs in Neon
(`store_records`), with the committed records in `data/` as a read-only fallback. They were in a Vercel Blob store
until 2026-10-27, when the Hobby plan's 2,000 "advanced operations" ran out; `scripts/migrate-blob-to-neon.mjs` moved
them. Re-run it after the store unblocks on 2026-11-26 to pick up what only Blob holds.
