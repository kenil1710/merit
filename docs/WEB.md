# Merit web app (`apps/web`)

Next.js 16 (App Router), React 19, Tailwind 4, `@rialo/ts-cdk` 0.18.1, `@anthropic-ai/sdk`.
Status: **deployed** on Vercel as project `merit` (`https://merit-ruby-two.vercel.app`), against Rialo DevNet and Merit's own Neon database.

## Pages

| Route | What it shows | Data source |
| --- | --- | --- |
| `/` Explore | Campaigns with a published name and brief | `getAccountsByOwner(program)` + campaign briefs |
| `/c/[address]` | Every decision in every round: post, score, judge reasons (hash-checked), the REX proof (each validator's output), verdict, payout, and links to all transactions | campaign and ledger accounts, REX report PDAs, Merit log lines |
| `/tx/[sig]` | A transaction's Merit log lines and its full program log | `getTransaction` |
| `/join` Contribute | X sign-in → embedded wallet (create, unlock, faucet) → link wallet to X → submit post → decision | session, `/api/link`, `/api/submit` |
| `/owner` Run a campaign | Create and fund (escrow + operations budget) and open round 1; per campaign: fund, withdraw unreserved, fund or withdraw ops, round length, open, end, resume, refund. Shows "verifications left" and warns when low | browser-signed transactions via the relay |
| `/guardrails` | `merit-judge` and `merit-x` capabilities, budget and audit read live; a placeholder card for `merit-payout-signer` | `/.well-known/latch-self/*` |

## Trust boundaries

- **Browser**
  - The embedded wallet is a CDK `Keypair`, encrypted with the user's passphrase (PBKDF2-SHA256, 310k rounds, then AES-GCM) and kept in `localStorage`. The secret key never leaves the browser.
  - Owner instructions are signed in the browser.
  - Linking X to a wallet signs an off-chain message; there is no transaction.
- **`/api/rialo` relay**
  - The browser's only path to DevNet, which sends no CORS headers.
  - Rejects batch requests and allows a fixed list of methods (reads, `sendTransaction`, `requestAirdrop`).
  - The faucet is capped at 1 RLO per call, with a per-IP throttle.
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
- **X sign-in**
  - OAuth 2.0 with PKCE (`users.read tweet.read`).
  - The user's token is used once to read their own id and handle, then dropped.
  - The session is an HMAC-signed, HttpOnly cookie holding only those two values.

## Submit pipeline (fails closed)

1. **Signed in** with X, and a **wallet linked** to that account.
2. **Campaign checks:** it is described, its round is open, and at least 20 s remain.
3. **Post checks:** the URL is an X status link, the post hasn't been submitted before, it's read through `merit-x`, its author is the signed-in account, and it was created after the round opened. Each check refuses before any money or REX is spent.
4. **Judge:** deterministic checks run first, then Claude scores the post. A score below the minimum is stored but sends nothing on chain.
5. **On chain:** the agent opens the round ledger if needed, then sends `approve`. REX verification starts; payment comes from the round's own timer.

## Tests

```bash
cd apps/web
npm test                             # unit: instruction builders vs Rust vectors, judge hashing
MERIT_LIVE=1 npx vitest run          # + live DevNet: decode round 1; full agent path through REX
npx playwright test                  # e2e on real DevNet (isolated server on :3100, own data dir)
```

- **`test/instructions.test.ts`:** each TypeScript builder must match `merit-tools vectors` (the Rust builders Venus generates) account for account and byte for byte. That covers 14 instructions plus the ledger slug.
- **`test/agent.live.test.ts`:** an owner creates and opens a campaign; the server's agent module opens the ledger with a token encrypted by the TypeScript CDK and approves jack's 2006 post. Validators must decrypt the token, read the post through Latch and agree, and the program must rule `OutsideRound`. The test then ends the campaign and withdraws.
- **`e2e/owner.spec.ts`:** in a real browser, creates a wallet, uses the faucet, creates, funds, opens, ends and withdraws.
- **`e2e/public.spec.ts`:**
  - the round 1 page shows the hash match, "Unanimous 4/4", the four validator outputs, the verdict, payout links and the approve transaction;
  - Explore lists campaigns;
  - Guardrails is live;
  - the relay refuses abuse;
  - an unauthenticated submit gets 401.

## Configuration (`apps/web/.env.local`, gitignored; see `.env.local.example`)

| Variable | Status |
| --- | --- |
| `MERIT_JUDGE_LAT`, `MERIT_X_LAT` | set (copied from `~/merit/.env`) |
| `MERIT_AGENT_SECRET_KEY` | set (`merit-agent-devnet`, DevNet only) |
| `MERIT_SESSION_SECRET` | set (random, local) |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | **missing**: sign-in shows "not configured" and the submit flow stays closed |
| `MERIT_PUBLIC_URL` | `http://localhost:3000` |

## Before Vercel (needs decisions)

1. **X OAuth app.** In the X developer portal, the app needs:
   - OAuth 2.0 enabled, as a Web App (confidential client);
   - scopes `users.read tweet.read`;
   - callback `<public url>/api/auth/x/callback`, plus `http://localhost:3000/api/auth/x/callback` for local use.

   Then provide `X_CLIENT_ID` and `X_CLIENT_SECRET`.
2. **Durable store.** `lib/server/store.ts` keeps judge records, wallet links and campaign briefs in Merit's Neon
   database (`store_records`), with the committed records in `data/` as a read-only fallback. They were in a Vercel
   Blob store until 2026-10-27, when the Hobby plan's 2,000 "advanced operations" ran out. Most of those were one
   `list` per page view: `store.campaigns()` listed the store on every render of `/explore`, `/join` and the owner
   pages. `scripts/migrate-blob-to-neon.mjs` moved the records. Re-run it after the store unblocks on 2026-11-26 to
   pick up what only Blob holds. No runtime code uses Blob now; the store itself was kept, not deleted.
3. **The `merit` Vercel project:** a new project, environment variables as above, and the agent key as a sensitive variable (DevNet only).
