# Merit — independent audit

- **Date:** 2026-10-28
- **Scope:** repo at `9dd522e` (main, clean) and the live site <https://merit-ruby-two.vercel.app>.
- **Method:** read-only. I read the docs, then the code: web/API, agent, Latch wiring, the Venus program and
  `merit-core`, the schema and migrations. I scanned git history with gitleaks and the live client bundles for
  secrets. Live checks used GET requests plus requests that are refused by design (relay abuse, fixture route,
  unauthenticated submit).
- **Not done:** I sent no on-chain transactions, deployed nothing, changed no settings and changed no code. I did not
  run the unit, e2e or cargo tests. On-chain findings come from reading the code and were **not** exercised on
  DevNet; each one says what would confirm it.

## Summary

The core design holds up well:
- The program, not the agent, computes payouts.
- Caps are checked at approval and again at payout.
- REX reports are bound to their entry's report PDA.
- Workflow PDAs serve as the permission system.
- The agent pipeline fails closed when X, Latch or the model is down.
- No secrets are in the repo, its history or the client bundles.

The serious problems are in places the design didn't cover:

1. **Anyone can probably freeze a campaign's escrow for good** by sending a little RLO to a future round's ledger
   address (H-1). Settlement then can't read the ledger. No owner instruction gets a campaign out of `SETTLING`, so
   one failed payout or settlement step locks the funds (M-1).
2. **The old submit flow is still live and skips the v2 agent.** `/api/submit` and the `JoinFlow` form are on `/join`
   today and accept the live campaign. They skip:
   - eligibility minimums;
   - the rules engine and review queue;
   - near-duplicate checks;
   - the deterministic prompt-injection check.

   They auto-approve on score alone, using a weaker prompt (H-2).
3. **The claim "a post can never be paid twice" is false on chain** once an owner closes a round early (M-2).
4. **An owner can hold back verified payouts after the fact** (M-3). The trust model in the README doesn't say so.
5. **Smaller items:**
   - an open redirect in X sign-in (M-4);
   - anyone can drain the judge's daily Latch budget (M-5);
   - a set of Low items and stale or overstated docs.

Counts: **0 Critical (H-1 may be Critical once confirmed), 2 High, 5 Medium, 13 Low, 6 Info.**

---

## Fix status (2026-10-28)

**Fixed:** H-1, H-2, M-1, M-2, M-4, M-5, L-2, L-3, L-4, L-5, L-9, L-10, L-12, L-13, I-1, I-3.
**Fixed in part:** M-3, L-7, L-8, L-11 (docs).
**Won't fix now:** L-1, L-6, I-2, I-4 (reasons are under each finding).
The program fixes are program v3, upgraded in place on DevNet and tested there (`deployments/devnet-v3-audit.json`).

## Findings

### H-1 · High (likely Critical once confirmed) · On-chain program

> **Status: Fixed (program v3, c4207c8). Confirmed first on DevNet under v2: test campaign C froze in SETTLING after a stranger pre-funded its ledger address; resume and refund didn't help. v3 reads an empty, non-program-owned ledger address as no ledger, and open_ledger/open_payee adopt a pre-funded PDA. Tested on v3: a pre-funded round settles, a ledger opens at a pre-funded address, and C was recovered with skip_stuck. Evidence: deployments/devnet-v3-audit.json, EVIDENCE.md.**
**What:** Anyone can make settlement fail for good by pre-funding the ledger address of a round that has no
approvals yet.

**Where:**
- `programs/merit/src/lib.rs:1281-1297` (`load_ledger`)
- `:1260-1262` (`load_state`)
- `:444-454` (`settle_peek`)
- `:357-368` (`refund`)
- `:372-387` (`resume`)

**Why it matters:**
- `load_ledger` treats the ledger as empty only when `kelvins == 0 && data_len == 0`.
- The ledger address is public and predictable: `PDA(program, round_agent, blake3("merit-ledger" ‖ campaign ‖ round))`.
- If anyone sends even 1 kelvin there before the agent opens the ledger, the account exists, owned by the system
  program, with no data. `load_state` then returns `InvalidAccountData`, `settle_peek` returns an error, and the
  timer chain stops while the campaign is in `SETTLING`.
- `resume` re-arms the same failing `settle_peek`.
- `refund` doesn't accept `SETTLING`.
- Most live rounds have no approvals, so the ledger is usually never opened. The escrow and the operations budget are
  then stuck with no way out. If the agent did open that ledger, Venus's create could also fail on an account that
  already holds kelvins, which blocks approvals for that round.

**Reproduce (throwaway campaign only):**
1. Create a campaign with 60 s rounds and start it.
2. Compute the round-2 ledger PDA from `ledger_seed(campaign, 2)` and the agent key.
3. Transfer the rent-exempt minimum to that address.
4. Don't approve anything in round 2.
5. When round 2 ends, the campaign stays in phase 2. `settle_peek` fails with `InvalidAccountData`, and
   `resume`/`refund` don't help.

**Fix:**
- In `load_ledger`, treat any account not owned by `program_id` that has `data_len() == 0` as an empty ledger (or
  check `account.owner == system_program`).
- Do the same check in `open_ledger`/`open_payee`, so a pre-funded PDA doesn't block creation.
- Add the owner escape hatch from M-1.
- Add this case to `negative-devnet.ts`.

---

### H-2 · High · Web / Agent

> **Status: Fixed (da4a5f1, deployed). /api/submit and /api/link return 410; /api/session, JoinFlow and lib/server/judge.ts are deleted. /join is a directory of programs, so the agent at /join/<slug> is the only path to an approval. v1 wallet links stay readable. e2e asserts the 410s live.**
**What:** The v1 submit path (`POST /api/submit`) and its UI are still live and accept the live v2 campaign. They skip
the v2 agent's safeguards.

**Where:**
- `apps/web/app/api/submit/route.ts:33-98`
- `apps/web/app/(app)/join/JoinFlow.tsx:100,116`, rendered by `apps/web/app/(app)/join/page.tsx:64`
- `apps/web/lib/server/judge.ts:13-57`
- `apps/web/app/api/link/route.ts`
- `GET /api/campaigns` lists `5LyXppXd…jEiwv`, so `store.campaign()` finds it.

**Why it matters:** a signed-in X user can go around everything `/join/<slug>` enforces. The old path:
- **Has no membership or eligibility check.** It ignores account age, follower minimums, suspension,
  `maxSubmissionsPerRound` and `joiningPaused`.
- **Has no rules engine.** It ignores `autoApproveConfidence`, `maxAutoApproveItem` and the soft flags. It approves on
  chain whenever `score ≥ minScore`.
- **Has no deterministic injection check (`detectInjection`) and no tag neutralization.** The post goes raw into
  `<post>…</post>`, so a post containing `</post>` can step out of the fence. The reply is parsed with a greedy
  `/\{[\s\S]*\}/` match.
- **Has no near-duplicate or `DUPLICATE_URL` check.** The only duplicate check is `store.judgement(postId)`, and the
  pipeline writes that record only for approvals. So a post the v2 agent **escalated or rejected**, for injection or
  low confidence, can be resubmitted here and auto-approved.
- **Uses a separate wallet link.** It pays the wallet from `/api/link` (the `links` store), not the contributor's
  joined wallet. It calls `ensurePayee` with that wallet, which can switch the on-chain payee and restart the
  cooldown.
- **Has no rate limit and no Origin check.**

On-chain caps still bound the loss to each round's caps.

**Reproduce:**
1. Sign in with X on `/join`.
2. Link a wallet in the old form.
3. Submit a post to the "Rialo in your own words" card (or `POST /api/submit {campaign:"5LyX…", postUrl}`).
4. No membership is needed. Approval happens at score ≥ 50 with no confidence gate.

**Fix:**
- Remove `/api/submit`, `/api/link`, `JoinFlow` and `lib/server/judge.ts`, or make `/api/submit` return 410.
- Send `/join` to `/join/<slug>`.
- If v1 records must stay readable, keep only the read path.

---

### M-1 · Medium · On-chain program

> **Status: Fixed (program v3). New owner instruction skip_stuck: after 10 minutes with no settlement step succeeding, it skips the failing step (reimbursement, or the next payout, recorded UNFUNDED) or ends a round whose ledger can't be read. refund also accepts a stuck SETTLING. A payout to an executable account is recorded UNFUNDED instead of failing. Tested on DevNet (accepted when stuck, rejected when open or progressing, rejected for a stranger). Not done: approve can't check the contributor account (it isn't passed); settle_pay handles it instead.**
**What:** No instruction gets a campaign out of `SETTLING` when a settlement step keeps failing. Any failing payout
transfer therefore locks escrow and ops for good.

**Where:**
- `programs/merit/src/lib.rs:521-586` (`settle_pay`)
- `:357-368` (`refund` excludes `SETTLING`)
- `:372-387` (`resume`)

**Why it matters:**
- `next_step` always picks the first verified entry again.
- If crediting `recipient` fails for any reason, every retry fails the same way. Causes include:
  - an executable or sysvar account chosen by a misbehaving agent (the agent picks `contributor` freely);
  - a runtime rent rule on a brand-new account;
  - a Venus change.
- Even after the refund deadline, `settle_peek` still tries to pay before it refunds. The owner can't revoke (only the
  agent can), and `set_agent` only applies from the next round.

**Reproduce:** approve an entry whose `contributor` is an executable account (the agent key is needed) and let it
verify. The payout step fails on every retry.

**Fix:**
- After the refund deadline, let `refund` accept `SETTLING`, mark unpaid entries `UNFUNDED`, and refund.
- Or let the owner skip the current entry (mark it `SKIPPED`) after N failed steps.
- In `approve`, check that `contributor` isn't executable or owned by a program.

---

### M-2 · Medium · On-chain program / Docs

> **Status: Fixed (program v3). approve and retry_verify sync the ledger's round end to the campaign's, so a post written after close_round/end can't verify in the old round. Tested on DevNet (ledger end synced to the early close). PROGRAM.md no longer overstates it.**
**What:** If a round is shortened after its ledger opens, the same post can be verified and paid in two rounds.

**Where:**
- `programs/merit/src/lib.rs:678-679` (`open_ledger` copies `round_start/end`)
- `:950-959` (`close_round`)
- `:287-296` (`end`)
- `:893-899` (`on_verify` checks the post against the ledger's copy)
- `crates/merit-core/src/lib.rs:700-710` (next round starts at the campaign's new `round_end_ms`)
- `docs/PROGRAM.md` ("it can never be paid twice")

**Why it matters:**
- After `close_round`, the next round starts at the early close time.
- Ledger N still holds the original, later end time.
- A post created between the early close and the original end therefore passes `judge_proof` for both round N
  (approved during N's grace) and round N+1.
- `DuplicatePost` is checked per ledger only.

Today only the agent's off-chain duplicate check stops a double payment. The documented on-chain guarantee doesn't
hold.

**Reproduce (throwaway campaign):**
1. Open a ledger in round N.
2. Have the owner call `close_round`.
3. Post on X.
4. Approve the post in N's grace period.
5. Approve it again in N+1 with a raw `approve`.
6. Both verify.

**Fix:**
- In `run_verify`/`on_verify`, read the campaign's current window. Or, more simply, have `close_round`/`end` refuse
  once the round's ledger exists.
- Or start round N+1 at `max(prev_end, ledger.round_end_ms)`.

---

### M-3 · Medium · On-chain program / Trust model

> **Status: Fixed in part (program v3) and documented. set_limits can't change the daily cap or approval threshold while a round is SETTLING, WAITING_FUNDS or AWAITING_APPROVAL (tested on DevNet). Won't fix: a round above the threshold can still be left unapproved until the refund deadline. That's the owner's approval power by design, now stated in the README and PROGRAM.md trust model.**
**What:** The owner can hold back payouts for work that was already approved and verified, without anyone noticing.

**Where:**
- `programs/merit/src/lib.rs:963-986` (`set_limits`: allowed in any phase)
- `:482-493` (`AWAITING_APPROVAL` arms no timer)
- `:357-368` (`refund` from `AWAITING_APPROVAL`/`WAITING_FUNDS` skips `abandon_unfunded`)

**Why it matters:**
- **Approval threshold:** during `SETTLING`, the owner can set `approval_threshold = 1`. The round then parks in
  phase 6. If the owner never calls `approve_round`, they can `refund` everything at the deadline.
- **Daily cap:** the owner can lower `max_per_day` so verified entries are marked `SKIPPED_DAILY`.
- **No record:** in both cases the outcomes stay `TODO` or `SKIPPED`, and nothing marks the work as owed.

The README trust model only discusses the agent. This is a product decision, but contributors should know about it.

**Fix:**
- Freeze `set_limits` while a round is settling, or apply changes from the next round.
- At the deadline, pay `AWAITING_APPROVAL` rounds instead of refunding them, or at least mark them `UNFUNDED`.
- Document the owner's powers in the trust model.

---

### M-4 · Medium · Web / Auth

> **Status: Fixed (9705c2b, deployed). safeReturnTo resolves the path against our origin and keeps it only if the origin is unchanged; it refuses backslashes and control characters. Checked at start and again before the final redirect. Verified live: returnTo=/\evil.example is stored as /join.**
**What:** After X sign-in, `returnTo` can send the user to another site.

**Where:**
- `apps/web/app/api/auth/x/start/route.ts:17` (the `startsWith("/") && !startsWith("//")` check)
- `apps/web/app/api/auth/x/callback/route.ts:57` (`new URL(saved.returnTo, origin)`)

**Why it matters:** `/\evil.example` passes the check, and WHATWG URL parsing turns it into `https://evil.example/`.
Confirmed live: the `merit_oauth` cookie stores `"returnTo":"/\\evil.example"`. After a real sign-in, the user lands
on an attacker's page, a good spot for a fake "connect your wallet" phish.

**Reproduce:** open `https://merit-ruby-two.vercel.app/api/auth/x/start?returnTo=/%5Cevil.example` and finish the X
sign-in. The final redirect goes to `https://evil.example/`.

**Fix:** resolve the URL and compare origins:
`const u = new URL(returnTo, origin); if (u.origin !== origin) use "/join"`.
Also reject `\` and control characters.

---

### M-5 · Medium · Latch / Availability

> **Status: Fixed (9705c2b, deployed; Neon migration 0007). Read it is limited per owner, per wallet (10 per 10 min and 30 a day), per IP (20 a day) and for everyone (150 a day), all counted in Neon. Not done: a dedicated child latch for Read it (dashboard work).**
**What:** Anyone can use up merit-judge's daily budget with "Read it".

**Where:**
- `apps/web/app/api/owner/context/read/route.ts:22,33`
- `apps/web/app/api/auth/owner/verify/route.ts` (any wallet becomes an "owner"; `upsertWalletUser`)
- `apps/web/lib/server/rate-limit.ts:8` (limits are per instance)

**Why it matters:**
- A fresh wallet signs in as owner, then gets 10 "Read it" calls per 10 min. Each one is a Haiku call of up to 1,200
  output tokens through the **parent** merit-judge latch, tagged `owner-<uuid>`. It can also fetch up to 3 pages.
- Wallets cost nothing, and sign-in is limited only to 20 a minute per IP per instance.
- Burning through the $1/day `spend_limit_6` or the 500/day `rate_limit_5` stops judging for every campaign without a
  child latch. Submissions then wait for the daily cron.
- Whether the live campaign's child latch shares the parent's counters is unverified. README notes that
  "a child's /budget reports the parent's cap".

**Reproduce (don't run against production):** script sign-in with new keypairs and call `/api/owner/context/read` in
a loop. Watch `/guardrails` spend.

**Fix:**
- Give "Read it" its own child latch with a small cap.
- Require at least one created program, or a funded campaign, before allowing "Read it".
- Move limits to Postgres (or Vercel Firewall rate rules) so they hold across instances.

---

### L-1 · Low · Agent pipeline

> **Status: Won't fix now. A second concurrent run can't double-pay: the chain refuses a duplicate approval of the same post (DuplicatePost). The worst case is a misleading status, which scripts/check-records.ts detects. A row lease needs a schema change.**
**What:** A submission is never locked while it's processed, and the on-chain approve happens before the database
write.

**Where:**
- `apps/web/lib/agent/pipeline.ts:269-338`
- `apps/web/app/api/contributor/submissions/route.ts:38` (`after()` retry)
- `apps/web/app/api/cron/agent/route.ts:17-25`
- `apps/web/app/api/owner/submissions/[id]/reprocess/route.ts`

**Why it matters:**
- The `after()` retry, the cron and an owner's reprocess can run `processSubmission` on the same row at the same time.
- If `approve` lands and the transaction that follows fails, the row stays `pending` with no `approveSignature`. A
  retry then gets `DuplicatePost` from the chain and records `R11_CHAIN_REFUSED` / escalated, while the chain holds
  an approval.
- Possible results: misleading status, a second judge call, and a decision record that disagrees with the chain.

**Fix:**
- Claim the row first: `UPDATE … SET status='processing' WHERE status='pending' RETURNING`.
- Write the decision before `approve` and update it afterwards. Or reconcile against the ledger, finding the entry by
  `post_id` before approving.

### L-2 · Low · Web / Auth

> **Status: Fixed (55b5e5d). Each cookie's signed payload names its type and unsign checks it (test in audit-fixes.test.ts). Sessions signed before the deploy are signed out once.**
**What:** One HMAC key signs all three cookies (`merit_session`, `merit_owner`, `merit_oauth`), and the signed data
doesn't say which cookie it is.

**Where:** `apps/web/lib/server/session.ts:19-34`

**Why it matters:** a valid token for one cookie also passes as the other two, with missing fields:
- Paste your `merit_session` into `merit_owner`, and `getOwnerSession()` returns `{sub: undefined}`.
- Downstream code then queries with `undefined`, which gives 500s at best.

No privilege gain was found, but it's fragile.

**Fix:** add `typ: "contributor" | "owner" | "oauth"` to the signed data and check it in `unsign`.

### L-3 · Low · Web / CSRF

> **Status: Fixed. /api/link and /api/submit are retired (H-2); /api/campaigns POST and /api/auth/logout check Origin.**
**What:** These state-changing routes don't check `Origin`:
- `/api/link`
- `/api/submit`
- `/api/campaigns` POST
- `/api/auth/logout`

`/api/link` also has no nonce: replay is bounded only by a 10-minute `issuedAt`.

**Where:**
- `apps/web/app/api/link/route.ts:13-24`
- `apps/web/app/api/submit/route.ts:33`
- `apps/web/app/api/auth/logout/route.ts`

**Why it matters:** only `SameSite=Lax` protects them. Example: an attacker signs a link message for the victim's
X id with the attacker's own wallet, then gets the victim's browser to POST it. Without SameSite, the victim's payouts
would be redirected. `request.json()` parses `text/plain`, so a simple cross-site form POST works.

**Fix:** use `sameOrigin()` on every POST, as the v2 routes do. Retiring these routes (H-2) also fixes this.

### L-4 · Low · Web / Rate limits

> **Status: Fixed (9705c2b). Every app rate limit counts in Neon (rate_hits), so all instances share one count. The daily cron prunes old counters.**
**What:** All app rate limits live in memory, per serverless instance:
- sign-in nonces
- submit
- appeal
- decide
- probes
- Read it

**Where:** `apps/web/lib/server/rate-limit.ts:5-19`

**Why it matters:** Fluid compute spreads requests over instances, so the real limits are N times higher.
`windows.clear()` at 10k keys also resets everyone at once. The faucet, by contrast, is limited correctly in Postgres.

**Fix:** use a Postgres or Upstash counter, or Vercel Firewall rate-limit rules for `/api/auth/*` and
`/api/owner/context/read`.

### L-5 · Low · Web / RPC relay

> **Status: Fixed (55b5e5d). The faucet forwards params rebuilt from the checked values, and the relay allows 300 calls a minute per network (Neon).**
**What:** For `requestAirdrop`, the relay checks `params[0].pubkey`/`kelvins` but forwards the caller's **original**
`params`. Other methods aren't rate-limited at all.

**Where:** `apps/web/app/api/rialo/route.ts:64-71,109`, `:76`

**Why it matters:**
- If DevNet's `requestAirdrop` reads any other field (a second element, or another key for the recipient or amount),
  the checked values and the sent values can differ.
- `sendTransaction` and reads are an open, unthrottled proxy to DevNet on Merit's Vercel quota.

**Fix:**
- Rebuild the params from the checked values: `[{ pubkey: wallet, kelvins }]`.
- Add a per-IP limit to the relay as a whole.

### L-6 · Low · Agent costs

> **Status: Won't fix now; documented in README limits. Charging payee rent to the ops budget needs another program change. The agent balance is watched by hand on DevNet.**
**What:** All campaigns share one server agent. Anyone can create a campaign with that agent and a cooldown. Each
joining contributor then makes the agent pay for an `open_payee` account (rent plus fee), and nothing repays it.

**Where:**
- `apps/web/lib/server/agent.ts:107-114`
- `apps/web/app/api/contributor/join/route.ts:49-61`
- `programs/merit/src/lib.rs:1046-1077`

**Why it matters:** the agent's DevNet balance drains slowly (each join needs a real X account, so it's slow). Once
the agent can't pay fees, every campaign stops.

**Fix:** charge payee rent to the ops budget, as with ledger rent, or register payees lazily at first approval. Alert
on low agent balance.

### L-7 · Low · On-chain program

> **Status: Fixed in part (program v3): settle_pay pays nothing while paused. Won't fix now: refund from WAITING_FUNDS/AWAITING_APPROVAL doesn't mark entries UNFUNDED (it has no ledger account to read); documented in PROGRAM.md.**
**What:**
- **Pause:** `pause` doesn't stop a `settle_pay` that is already scheduled. One more payout can land after the owner
  pauses.
- **Refund:** an owner `refund` from `WAITING_FUNDS`/`AWAITING_APPROVAL` leaves verified entries `TODO`, not
  `UNFUNDED`.

**Where:**
- `programs/merit/src/lib.rs:580-582` (`settle_pay` only logs "paused")
- `:357-368`

**Why it matters:** PROGRAM.md says pause "stops approvals and payouts". The UI may show unpaid verified work as
"due" forever.

**Fix:** check `paused` in `settle_pay` before `release`, and call `abandon_unfunded` in `refund`.

### L-8 · Low · Data correctness

> **Status: Fixed in part (55b5e5d). Public views never write, so two campaigns sharing a post can't overwrite each other's record. Repairs run only from scripts/check-records.ts. Won't fix now: keying records by (campaign, post) would need a store migration.**
**What:** Judge records are keyed by **post id only**, across all campaigns. Reading the public record also writes
to the database.

**Where:**
- `apps/web/lib/server/store.ts:88-91`
- `apps/web/lib/server/campaign-view.ts:96-106`

**Why it matters:**
- If the same post is approved in two programs, the second `saveJudgement` fails (`RecordExists`, ignored).
- After that, every page view of either campaign calls `replaceJudgement` with its own record. The two campaign pages
  overwrite each other and show "hash mismatch" in turn.
- A public GET that writes is also a cost and abuse surface.

**Fix:** key judgements by `(campaign, postId)`, and move the self-heal into `scripts/check-records.ts` or the cron.

### L-9 · Low · Data correctness (live)

> **Status: Fixed (55b5e5d). verificationsLeft() in lib/merit/constants is used everywhere; the public record now matches the owner app.**
**What:** "Verifications left" is computed two ways. The live public record says **≈ 10**, while the owner app
computes **8** from the same 0.129 RLO budget.

**Where:**
- `apps/web/components/campaign/campaign-record.tsx:45` (`ops / REX_COST`)
- `apps/web/lib/server/program-summary.ts:81-83`
- `apps/web/app/api/owner/route.ts:39` (subtracts the ledger rent)

**Why it matters:** the public page overstates what the budget covers. The program refuses an approval unless
`attempts×0.012 + 0.012 + ledger rent ≤ ops`. See <https://merit-ruby-two.vercel.app/p/rialo-in-your-own-words>.

**Fix:** use `verificationsLeft()` everywhere.

### L-10 · Low · Web / Headers

> **Status: Fixed (55b5e5d). Production sends a Content-Security-Policy (self-only scripts, styles and connect, 'unsafe-inline' for Next's bootstrap, 'wasm-unsafe-eval' for wallet crypto) and a Permissions-Policy. Owner go-live e2e passed under it on a production build. Not done: nonce-based script-src.**
**What:** There's no `Content-Security-Policy` (or `Permissions-Policy`). HSTS, `nosniff`, `X-Frame-Options: DENY`
and `Referrer-Policy` are present.

**Where:** `apps/web/next.config.ts:15-26`; live response headers.

**Why it matters:** the embedded wallet keeps an encrypted secret key in `localStorage` and decrypts it in page JS.
Any XSS or compromised dependency can read the passphrase as it's typed. A CSP is the main defense in depth for a
browser wallet.

**Fix:** add a strict CSP (`script-src 'self'` plus Next.js nonces, `connect-src 'self'`) and `Permissions-Policy`.

### L-11 · Low · Agent / Latch

> **Status: Fixed in docs and code comments: the cron is a daily backstop, stated in the README, WEB.md and the route. Won't fix the cadence: Vercel Hobby allows one cron a day.**
**What:** The cron backstop runs **once a day** and takes 3 submissions per run. Code comments say "a few minutes".

**Where:**
- `apps/web/vercel.json` (`0 6 * * *`)
- `apps/web/app/api/cron/agent/route.ts:1-2,22`

**Why it matters:**
- A submission left pending by a Latch or X outage after its one `after()` retry waits up to 24 h.
- By then its round has usually closed, and `approvableRound` refuses it.
- Busy days lose more than 3 pending submissions.

**Fix:** state the real cadence. Expire pending items from closed rounds with a clear message, or retry from the
next request.

### L-12 · Low · Housekeeping

> **Status: Fixed (55b5e5d). The daily cron deletes old nonces, intents, faucet grants, Latch calls (90 days) and rate counters (test in audit-fixes.test.ts).**
**What:** Nothing ever cleans up `latch_intents` (one row per X read), `latch_calls`, `auth_nonces` (only on issue)
or `faucet_grants`.

**Where:**
- `apps/web/lib/server/tweet-check.ts:34`
- `apps/web/lib/server/latch.ts:110`

**Why it matters:** slow, unbounded growth on Neon's free tier.

**Fix:** add TTL deletes to the cron.

### L-13 · Low · Docs honesty

> **Status: Fixed. README and EVIDENCE now say 30 sent, 29 rejected, 1 no-op, and the duplicate row is gone. PROGRAM.md's 'never paid twice' is corrected. WEB.md is rewritten (routes, pipeline, config). The landing page says '0 keepers needed for payouts', and the README mentions the daily cron. latch.ts and the tagline name the X OAuth exception. The trust model covers agent revoke and owner powers. The 'verifications left' numbers match (L-9).**
- **Negative tests:** README (`:118`) says "30 invalid instructions, each rejected on chain", and EVIDENCE (`:560`)
  says "every invalid instruction was rejected". `deployments/devnet-negative.json` shows **29 rejected and 1 not
  rejected**: `on_verify … entry 0's real REX report`, `pass:false`, `err:null`, which landed as a no-op. The
  EVIDENCE table also lists the timed retry as a second row with the **same signature** `5VjnEga…`. The binding was
  proven by the retry, but the headline count is overstated.
- **Payout can't be duplicated:** `docs/PROGRAM.md` says "Since a post's creation time falls in exactly one round, it
  can never be paid twice." That's false on chain after `close_round` (M-2).
- **WEB.md is stale:**
  - "`/` Explore" (it's `/explore`);
  - the "Submit pipeline" section describes the v1 `/api/submit` flow;
  - the Configuration table says X OAuth is "missing";
  - "Before Vercel (needs decisions)" is still there.
- **Cron claim:** the landing page (`apps/web/app/page.tsx:81`) shows "0 Keepers or cron jobs". The payouts really do
  need no keeper, but the app has a Vercel cron (`/api/cron/agent`). Say "0 keepers for payouts".
- **"Every X call through Latch":** `lib/server/latch.ts:3` says "Every call to X … goes through Merit's Latch
  latches", and the tagline says "no backend holding API keys". In fact X OAuth (`/2/oauth2/token`, `/2/users/me`)
  calls `api.x.com` directly with `X_CLIENT_SECRET` held on Vercel. That is the right design for user sign-in, but the
  wording should exclude it.
- **Agent trust model:** the README says a misbehaving agent can do "nothing more" than approve within caps and spend
  ops. It can also revoke verified entries, which blocks payouts, and it may be able to stall settlement (M-1).

---

### Info
- **I-1 · Wasted thread search:** `lib/agent/x.ts` still tries `/2/tweets/search/recent` for posts with replies.
  merit-x always refuses it (endpoint filter), so each such post costs a logged 403. Skip the search until the latch
  allows it.
  _Status: Fixed: the search is skipped unless MERIT_X_THREAD_SEARCH=1._
- **I-2 · Signature domain separation:** decision-record signatures (`lib/agent/record.ts:59-64`) are raw ed25519
  over a 32-byte hash, made with the **same key** that signs transactions, with no domain prefix. It's not
  exploitable today, since a 32-byte message isn't a valid transaction. Prefix with `"merit.decision/v1\n"`.
  _Status: Won't fix now: a domain prefix changes the signed format of every existing decision record. Noted for the next record version._
- **I-3 · Signature not checked publicly:** the public record checks the record's hash against the chain but not the
  agent's ed25519 signature (the review drawer does). The hash check is the stronger one, so this is fine. Say so in
  the UI.
  _Status: Fixed: the drawer says the hash match is its check and that the signature is checked in the owner's review drawer._
- **I-4 · Audit table append-only claim:** `audit_events` is append-only by trigger, but the app's database role owns
  the table and can `DROP TRIGGER`. To make the claim hold, use a separate migration role.
  _Status: Won't fix now (needs a separate migration role on Neon); documented in WEB.md._
- **I-5 · Undecodable accounts on upgrade:** Venus silently closes accounts it can't decode (noted in the memory and
  PROGRAM.md). Any future state change must keep the layout or migrate, as `state_invariants.rs` already warns.
  _Status: Respected: v3 kept the state layout, so 5LyX decodes unchanged (verified after the upgrade)._
- **I-6 · Reviewer powers:** reviewers (not only owners) can approve at any amount up to `maxPerPayout`
  (`decideByHuman` checks membership, not role). That's intended per the parity docs, but should be documented as
  money power.
  _Status: Documented in the README trust model (reviewers can approve up to the per-payout cap)._

---

## Fix first (top 5)

1. **H-1:** make `load_ledger` (and `open_*`) tolerate a pre-funded, empty, system-owned PDA. Add a negative test.
2. **M-1:** add an owner escape hatch from `SETTLING` (refund or skip after the deadline). Today one bad step locks
   the escrow.
3. **H-2:** retire `/api/submit`, `/api/link`, `JoinFlow` and `lib/server/judge.ts`, so v2 is the only path to an
   approval.
4. **M-4:** fix the `returnTo` open redirect with an origin comparison.
5. **M-2 / M-3:** bind REX verification to the campaign's real round window (or forbid `close_round` once a ledger
   exists), and freeze `set_limits` while a round is settling. Then update the trust-model docs (L-13).

---

## Checked and found OK

**Secrets**
- gitleaks over all 3 commits: 2 hits, both false positives (a tx signature in `devnet.json`, an Anthropic message
  id in EVIDENCE).
- Grep of every commit for `lat_`, `sk-ant`, `npg_`, `postgres://…@` and keypair arrays: only placeholders
  (`lat_PASTE_MERIT_…`, `.env.example`).
- `.gitignore` covers `.env*`, keypairs and the private security reports.
- The 28 live client JS chunks and 9 page HTMLs contain no `lat_`, `DATABASE_URL`, `postgres://`, `sk-ant`,
  `CRON_SECRET` or `MERIT_*` secret names. Every server module imports `server-only`.

**Owner sign-in**
- Each nonce is single-use, enforced by an atomic `UPDATE … RETURNING`.
- Nonces are bound to the subject wallet and the purpose, and expire after 10 minutes.
- Domain, URI origin and network are checked, as is `issuedAt` (10-minute max age, 60 s skew).
- The signature is checked before the nonce is consumed, so a forged request can't burn a real nonce.

**X OAuth**
- PKCE S256 with a fresh 48-byte verifier.
- `state` lives in a signed, HttpOnly cookie with a 10-minute lifetime and is deleted on use.
- The user's access token is used once and dropped. The session keeps only the X id and handle.

**Cookies and auth checks**
- Live cookies are `HttpOnly; Secure; SameSite=Lax`.
- Timing-safe HMAC comparison.
- v2 routes check `sameOrigin`.
- Members get 404, never 403, on programs they don't belong to.
- Owner-only actions check the role: publish, recordCampaign, settings, members, contributor status.

**Test fixture and other endpoints**
- `/api/test/fixture` returns **404** live (`MERIT_E2E` plus a non-production build are required).
- `/api/cron/agent` returns **401** without the bearer.
- `/api/latch/tweet-check` returns **401** without the key, with a constant-time compare and a 503 when the key isn't
  set.

**RPC relay** (live): batches refused, method allowlist enforced, `getAccountsByOwner` limited to Merit's program,
body and transaction size caps, faucet limits in Postgres with an atomic reserve-then-check.

**SSRF ("Read it")**
- Only http/https, standard ports, no credentials in the URL.
- DNS is checked when connecting, against private, loopback, link-local/metadata, CGNAT, NAT64, 6to4 and Teredo
  ranges, and mapped IPv6.
- Redirects are followed by hand, each hop checked again, at most 3.
- 10 s timeout, 2 MB cap, HTML only.

**Agent and judge**
- Content is fenced with a random boundary, and tags are neutralized.
- An injection flag escalates to review and never auto-approves.
- Any judge error escalates or leaves the submission pending. Latch rate-limit and response-filter denials are
  retryable.
- Fails closed when the judge isn't configured (`R3_NO_JUDGMENT`).
- Hard flags reject before any model spend.
- Engine amounts are priced through `scoreFor` against the on-chain rate, and `publishBlocker` checks the chain's
  rate, caps and agent against the program at publish time.
- Decision records use Python-compatible canonical JSON, sha256 and ed25519. The public page recomputes the hash
  against the ledger entry.

**Latch**
- Every Anthropic call goes through `judgeClient` (`baseURL` `onlatch.com/proxy`, `apiKey: null`). Every X read goes
  through `xGet`. The repo has no direct `api.anthropic.com` call and no direct X API call apart from OAuth.
- Headers match LATCH_PLUS:
  - `X-Merit-Campaign` plus `X-User` on every proxied call;
  - `metadata.user_id` on every judge call (contributor id, or `owner-<uuid>`);
  - `max_tokens` 2000/1200/600, all ≤ 2048;
  - model `claude-haiku-5-5`, no `tools`;
  - X paths `/2/tweets/<numeric>?…`, which match the Rust policy;
  - the REX component sends `X-Merit-Campaign`.
- A configured child token is never bypassed for the parent.
- **Fragility to note:** `isRateLimit`/`isResponseFilter` match on `deniedBy` names (`rate_limit…`, `response…`). If
  filters are renamed in the dashboard (as LATCH_PLUS suggests, e.g. "Successful, small replies only"), those
  denials become non-retryable. The reason-text fallback covers "rate limit exceeded" and "upstream|response" only.

**Program**
- Signer and role checks on every owner and agent instruction (`require_campaign_owner`, `require_ledger_agent`).
- REX bytecode is pinned.
- Ledger and payee slugs are checked against their seeds.
- Accounts are resolved by key, not position.
- `load_campaign` checks kind and self-address. `load_ledger` checks campaign, round and agent.
- Report PDA binding is checked, along with the processor owner and the creator.
- Consensus needs ≥ 3 outputs, all byte-identical successes. The proof parser is strict.
- Caps are checked at approval and again at payout. Payouts go in approval order.
- `release` checks rent and `escrow + ops`.
- Amounts use checked or saturating arithmetic (`payout_for_score` in u128).
- Timer epochs retire stale chains.
- Withdrawals are limited to unreserved escrow, and `withdraw_ops` only between rounds.

**Data**
- 7 migrations match `_journal.json`.
- Unique constraints on contributor (program, X) and (program, wallet), live submission per (contributor, resource),
  `decision_hash`, and payout signature.
- Public amounts and status come from the chain (ledger entries and `outcome`), not the database.

**Live site**
- All main pages return 200 in 0.4–1.9 s.
- All 14 internal links resolve; the only non-200 is the expected 307 to X sign-in.
- Unknown routes return 404.
- `/c/<campaign>` redirects to `/p/<slug>`.
- The public record's books add up: 1.0 funded = 0.877 escrow + 0.123 paid; ops 0.2 = 0.129 + 0.0707 repaid
  (≈0.0003 rounding).
- REX 4/4 is shown for rounds 29 and 32, matching EVIDENCE.
- The viewport meta tag is present. I did **not** render the pages in a phone-sized browser or read console errors,
  so the mobile layout is unverified.
