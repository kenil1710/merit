# Merit: re-audit of the AUDIT.md fixes

- **Date:** 2026-10-28
- **Scope:** repo at `2e3ce11` (main, clean; the fix commits `da4a5f1..2e3ce11` on top of the audited `9dd522e`),
  the live site <https://merit-ruby-two.vercel.app>, and the program v3 evidence on DevNet.
- **Method:** read-only. I read the diff `9dd522e..HEAD`, then the program and web code around each fix. Live checks
  used GETs, POSTs that the site refuses by design, and DevNet `getTransaction` reads through the site's relay.
- **Not done:** I sent no transactions, changed no code and deployed nothing. I didn't run cargo, vitest or e2e. The
  new on-chain findings come from reading the code and were **not** exercised on DevNet.

## Fix status (2026-10-28, last round)

- **Fixed:** N-1 (program v4).
- **Documented as known limits in the README, not fixed:** M-3 (limit changes apply at once), M-1 (skip paths
  untested on chain), L-10 (inline script allowed), N-2, N-3, N-4 and L-6 (agent balance).
- PROGRAM.md's "between rounds" wording is corrected.
- The "Known limits" section in the README is now the honest status for these.

## Summary

Most fixes are real. The ones that mattered most hold up in both the code and the live site:
- **H-1:** the pre-funded ledger freeze is fixed.
- **H-2:** the v1 submit path is gone.
- **M-2:** the round-window double payment is fixed.
- **M-4:** the open redirect is fixed.

The DevNet transactions I spot-checked say what `devnet-v3-audit.json` claims they say.

Three things need attention:

1. **New (N-1, Medium):** the owner can use `skip_stuck` right after `approve_round` (or after `fund` resumes
   `WAITING_FUNDS`, or after any timer stall). It marks a payout that would have succeeded `UNFUNDED`. The cause is
   that those paths enter `SETTLING` without resetting `last_beat_ms`. The fix for M-1 therefore widens the owner
   withholding problem from M-3.
2. **M-1 is less proven than the status says.** The one `skip_stuck` call on DevNet took the "ledger absent, nothing
   to do" path. Under v3 a plain `resume` would have recovered campaign C too. The branches that skip a payout or a
   reimbursement, the unreadable-ledger branch, and the executable-recipient branch have never run on chain.
3. **M-3 is fixed in part (as marked), but the docs overstate it.** The owner can still change the daily cap and the
   threshold while a round is `OPEN`, which includes the moments after it closes and before the next beat. Verified
   entries already sit in that round's ledger.

Smaller items:
- The new Neon rate limits count refused requests against the shared global caps. One client can switch off "Read it"
  for every owner for a day (N-2).
- The relay now needs Neon on every call (N-3).
- The CSP still allows inline script (L-10 is partly fixed).

| Verdict | Findings |
| --- | --- |
| Really fixed | H-1, H-2, M-2, M-4, L-2, L-3, L-5, L-9, L-12, I-1, I-3 |
| Fixed, but weaker or less proven than stated | M-1 (on-chain coverage; see N-1), L-4 (see N-2, N-3), L-10 (`'unsafe-inline'`), L-13 (M-3 wording) |
| Partly fixed, as marked | M-3, M-5, L-7, L-8, L-11 |
| Won't fix: reason is fair | L-1, I-2, I-4, L-6 (fair for DevNet; one caveat) |
| New | N-1 Medium; N-2, N-3 Low; N-4, N-5, N-6 Info |

---

## Fixed findings, checked

### H-1 · pre-funded ledger freezes settlement: **really fixed**
- `crates/merit-core/src/lib.rs:749-751` `ledger_absent`: an account with no data that the program doesn't own reads
  as "no ledger". `programs/merit/src/lib.rs:1411` uses it in `load_ledger`.
- `lib.rs:1197-1220` `adopt_prefunded`: a pre-funded, empty, system-owned PDA is assigned to the program. Before the
  assign, the code re-derives the address from the payer and slug and checks it. It's called from `open_ledger`
  (`:692`) and `open_payee` (`:1098`).
- **Live proof:** DevNet tx `3P2mQttk…` (case "agent opens a ledger at a pre-funded address") logs
  `Merit adopting pre-funded account 3EU72qie… (1000000 kelvin)` then `Merit ledger opened … round 2`. Campaign D
  settled round 1 over a pre-funded address (`devnet-v3-audit.json`).
- **Gaps (not bugs):**
  - The `open_payee` adopt path never ran on chain.
  - `create_campaign` has no adopt step. Pre-funding a campaign address only blocks that one creation, and the
    attacker would need the slug in advance. Low; noted only.

### H-2 · v1 submit path: **really fixed**
- `apps/web/app/api/submit/route.ts` and `app/api/link/route.ts` are stubs that return 410. `lib/server/judge.ts`,
  `app/api/session/` and `JoinFlow.tsx` are deleted. `(app)/join/` holds only `page.tsx` and `[slug]`.
- **Live:**
  - `POST /api/submit` returns **410**.
  - `POST /api/link` returns **410**.
  - `POST /api/session` returns **404**.
  - `/join` only links to `/join/rialo-in-your-own-words`.

### M-1 · no exit from a stuck `SETTLING`: **fixed in code, under-tested, and introduces N-1**
- **Code:**
  - `skip_stuck` is at `lib.rs:1127-1178`.
  - `refund` accepts a stuck `SETTLING` (`:364`).
  - An executable recipient is recorded `UNFUNDED` (`:562-565`).
  - `settle_peek` and a successful `settle_pay` refresh `last_beat_ms` (`:459`, `:591`).
- **Live:** DevNet tx `3mV8rmLo…` (the `skip_stuck` on C) has **no `Merit …` log line**. It went through the `Ok`
  branch with `count == 0`, so there was nothing to skip, and it just re-armed `settle_peek`. C was recovered because
  v3's `ledger_absent` now reads its pre-funded ledger as empty. A plain `resume` would have done the same.
- **Never run on chain:** the payout skip (`:1159-1161`), the reimbursement skip (`:1142-1144`), the
  unreadable-ledger branch (`:1164-1173`) and the executable-recipient branch. Add negative-devnet cases for them. A
  recipient that can't be credited is the easiest to set up: an executable account, approved by the test agent.
- `skip_stuck` calls `next_step` directly. It skips `settle_peek`'s `verification_done` gate (`:473`) and the
  approval gate (`:486-497`). After a stall during the verification window, it can therefore mark `UNFUNDED` an entry
  that `settle_peek` would not have tried to pay yet. See N-1.

### M-2 · a post verified in two rounds after `close_round`: **really fixed**
- `merit-core:763-765` `synced_round_end` is applied in `approve` (`lib.rs:725`) and in `retry_verify` for the current
  round (`:800-802`). The only way to get a post written after the early close into ledger N is an approval after
  the close, and that approval now syncs the ledger first. The window is half-open
  (`merit-core:455`: `created < start || created >= end` is refused), so the boundary post belongs to exactly one
  round.
- **Live:** DevNet tx `4EiDFAmY…` logs `Merit ledger round 2 now ends at 1793184814711 (closed early)` before the
  approve.

### M-3 · owner withholds verified payouts: **fixed in part, as marked; the docs overstate the fix**
- `limits_change_allowed` (`merit-core:770-773`, `lib.rs:989-996`) refuses changes in `SETTLING`, `WAITING_FUNDS`
  and `AWAITING_APPROVAL`. **Live:** tx `5jojnG1h…` failed with
  `Merit rejected set_limits: the daily cap and approval threshold are fixed while a round settles`.
- **Still possible:**
  - REX verifications land during the round, so verified entries are already in ledger N while it is `OPEN`.
  - The owner can set `approval_threshold = 1` or lower `max_per_day` at any time during `OPEN`. That includes the
    stretch after `round_end_ms` and before the next `beat` flips the phase (up to `BEAT_MS` = 5 s).
  - The closed round then parks in `AWAITING_APPROVAL` or skips entries for the daily cap.
- README:44-45 says "a closed round pays under the rules it closed with" and PROGRAM.md:152 says "between rounds". The
  first is literally true but misleading, and the second is wrong. For a real fix, snapshot the two limits in
  `open_round` and apply changes from the next round.

### M-4 · open redirect after X sign-in: **really fixed**
- `lib/server/http.ts:29-38` `safeReturnTo`: it refuses `\`, control characters and `//`, resolves the path against
  our origin and compares origins. It's applied at start (`auth/x/start/route.ts:14`), in `fail()`
  (`callback/route.ts:16`) and before the final redirect (`callback/route.ts:61`).
- **Live:** the `returnTo` stored in the `merit_oauth` cookie for each input:

  | Input | Stored `returnTo` |
  | --- | --- |
  | `/%5Cevil.example` | `/join` |
  | `//evil.example` | `/join` |
  | `/%09/evil.example` | `/join` |
  | `https://evil.example` | `/join` |
  | `/join/rialo-in-your-own-words?x=1` | kept as is |

### M-5 · "Read it" drains the judge budget: **partly fixed, as marked**
- **Code:** `owner/context/read/route.ts:24-31` sets five Neon-counted rules (owner, wallet, wallet-day, IP, global
  150/day).
- **Still open:**
  - "Read it" still runs on the **parent** merit-judge latch, as stated.
  - Up to 150 calls a day share the parent's $1/day spend limit with contributors' judging. Each call can carry 3
    fetched pages. I didn't check whether 150 maximum-size reads fit under $1. Measure one maximum-size read in
    `latch_calls` to settle it.
  - The global cap is easy to exhaust. See N-2.

### L-2 · cookie type confusion: **really fixed**
`lib/server/session.ts:20-37`: `sign(typ, …)` / `unsign(typ, …)` checks `payload.typ === typ`. **Live:** the
`merit_oauth` payload carries `typ: "oauth"`.

### L-3 · missing Origin checks: **really fixed**
- **Live:**
  - `POST /api/campaigns` with no Origin returns **403**.
  - `POST /api/auth/logout` with no Origin returns **403**.
  - The same POST with Origin `evil.example` returns **403**.
- **Code:** every POST/PATCH/PUT/DELETE under `app/api` calls `sameOrigin`, except four routes that don't need it:
  - the JSON-RPC relay `rialo/route.ts`, which is fine;
  - the cron, which takes the bearer;
  - the fixture, which is gated;
  - the 410 stubs.

### L-4 · per-instance rate limits: **fixed; two new side effects**
`lib/server/rate-limit.ts:14-34` keeps the limits in Postgres (`rate_hits`, migration 0007) with an atomic
upsert-increment. Every call site moved (14 rules). See N-2 (shared caps count refused calls) and N-3 (the relay
depends on Neon).

### L-5 · relay forwards unchecked params: **really fixed**
`app/api/rialo/route.ts:74` forwards `[{ pubkey: wallet, kelvins }]` built from the checked values. `:57` limits each
IP (hashed) to 300 calls a minute. AUDIT.md says "per network"; the code means per client IP.

### L-7 · pause and refund: **partly fixed, as marked**
- `settle_pay` returns without paying while paused (`lib.rs:558-560`).
- `refund` still leaves entries `TODO`, which is documented.
- The pause case wasn't run on DevNet.

### L-8 · judge records keyed by post: **partly fixed, as marked**
`campaign-view.ts:102-108`: page views rebuild the record in memory, and only `repair: true` writes (from
`scripts/check-records.ts`). The `(campaign, post)` key remains.

### L-9 · two "verifications left" counts: **really fixed**
- `lib/merit/constants.ts:24-26` is used by `campaign-record.tsx:45`, `program-summary.ts:80` and `owner/route.ts:39`.
- **Live:** `/p/rialo-in-your-own-words` shows "8 verifications left", which matches the owner count in AUDIT.md.
- Nit: the public page uses the hardcoded `LEDGER_RENT_KELVIN`, while `/api/owner` uses the live rent figure. They
  match today.

### L-10 · no CSP: **partly fixed (the status says Fixed)**
- **Live:** `content-security-policy` and `permissions-policy` are present on `/`.
- `script-src 'self' 'unsafe-inline'` means an injected inline `<script>` or `on*=` handler still runs, and XSS is the
  main threat to the in-browser wallet.
- `connect-src 'self'` and `img-src` limit fetch and image exfiltration. A top-level navigation
  (`location = 'https://evil/?p=…'`) is not covered.
- The status line admits "Not done: nonce-based script-src", so the headline should read "Fixed in part".

### L-11 · daily cron: **won't fix the cadence; fair (Hobby plan)**
The comments and docs now match (`cron/agent/route.ts:1-5`).

### L-12 · unbounded tables: **really fixed**
`lib/server/housekeeping.ts:20-27` is called from the cron. See N-5 for its ordering.

### L-13 · docs honesty: **fixed, except the M-3 wording**
- README:129 and EVIDENCE:560 say 30 sent / 29 rejected / 1 no-op.
- The landing page says "Keepers needed for payouts: 0" (`app/page.tsx:81`).
- The "between rounds" / "rules it closed with" claims overstate M-3 (see above).

### I-1, I-3: **really fixed**
- I-1: `lib/agent/x.ts:117,143-145` gates thread search behind `MERIT_X_THREAD_SEARCH=1`.
- I-3: `components/campaign/decisions.tsx` now says the on-chain hash match is this page's check and that the
  signature is checked in the review drawer.
- I-5 and I-6 are respected and documented (README:47-48).

## Won't fix items: is the reason fair?

- **L-1 (no row lock): fair.**
  - `DuplicatePost` refuses a second approval in the same ledger.
  - With M-2 fixed, a second approval in another round fails `judge_proof` at verification.
  - The worst case is a misleading status plus one wasted REX fee from the ops budget, not a double payment.
- **L-6 (agent pays payee rent): fair on DevNet, with one caveat.** "Watched by hand" means nothing alerts. Decision
  C's warning covers the ops budget, not the agent's own balance. A cheap balance check in the daily cron, logged or
  shown on `/guardrails`, would close the gap without a program change.
- **I-2 (no domain prefix): fair.** Changing it breaks every existing record, and a 32-byte message can't be a valid
  transaction.
- **I-4 (trigger can be dropped): fair.**
  - `docs/WEB.md:46` states it.
  - The only remaining "append-only" claim is a code comment (`app/programs/[id]/audit/page.tsx:22`).

---

## New findings

### N-1 · Medium · `skip_stuck` is available right after `approve_round`, `fund` or a stall, so the owner can drop a payout that would have succeeded

> **Status: Fixed (program v4, cae96a8). `skip_stuck` and the stuck `refund` now need a `resume` and then 10 minutes with no settlement step. `approve_round` and `fund` count as progress and clear the resume mark. `skip_stuck` refuses while verifications can still land. Unit tests are in `merit-core`; the DevNet cases are in `deployments/devnet-v3-audit.json` (v4).**
**Where:**
- `merit-core/src/lib.rs:755-757` (`settlement_stuck` reads `last_beat_ms`)
- `lib.rs:1012-1025` (`approve_round`)
- `:254-261` (`fund` resuming `WAITING_FUNDS`)
- `:373-388` (`resume`)
- `:1127-1162` (`skip_stuck`)

**What:**
- `last_beat_ms` is refreshed only by `beat`, `settle_peek`, a successful `settle_pay` and `skip_stuck`.
- `approve_round` and `fund` move the phase back to `SETTLING` without touching it. It then still holds the time of
  the `settle_peek` that parked the round, usually more than 10 minutes earlier, since the owner has to act.
- So `settlement_stuck` is **true** from the `approve_round` until the first `settle_peek`, `SETTLE_STEP_MS`
  (500 ms) later.

**Attack:**
1. In one transaction, or back to back, the owner sends `approve_round` and then `skip_stuck(ledger)`.
2. The reimbursement is already done (it runs before the approval gate), so `skip_stuck` reaches `next_step` and marks
   the first verified entry `UNFUNDED`.
3. The rest of the round pays normally.

This works once per approval, and once per `WAITING_FUNDS` → `fund` cycle.

**Other ways in:**
- After any real stall, the owner can choose `skip_stuck` over `resume`. Stalls happen: DevNet timer expiry, and
  every program upgrade kills armed timers (EVIDENCE finding 19).
- `skip_stuck` also ignores the `verification_done` gate, so it can skip an entry while verifications are still
  landing.

**Why it matters:**
- It's a quiet way to withhold one contributor's verified payout while the campaign keeps running.
- The README trust model presents `skip_stuck` as a tool for a *stuck* payout. The on-chain `UNFUNDED` record is the
  only trace.
- The owner can already refuse a whole round above the threshold (M-3, won't fix), so the damage is bounded. But this
  path is selective, needs no deadline, and isn't documented.

**Confirm (throwaway campaign):**
1. Set the threshold below one round's payout.
2. Let a round with two verified entries park in `AWAITING_APPROVAL` for more than 10 minutes.
3. Send `approve_round` and `skip_stuck` in one transaction.
4. Entry 0 ends `UNFUNDED`, and entry 1 is paid.

**Fix:**
- Set `self.last_beat_ms = now` in `approve_round`, in `fund` when it resumes, and in `resume`.
- Better: require proof that a step really fails. For example, store `resume_ms` in `resume` and allow `skip_stuck`
  only when `now ≥ max(last_beat_ms, resume_ms) + STUCK_MS`. The owner must then try `resume` first and wait 10
  minutes with no progress.
- In `skip_stuck`, apply the same `verification_done` gate as `settle_peek`.
- Add the case to `negative-devnet.ts`.

### N-2 · Low · shared rate-limit caps count refused calls, so one client can switch off "Read it" and the probes for everyone

> **Status: Won't fix now. Listed under README "Known limits".**
**Where:**
- `lib/server/rate-limit.ts:27-29`: every rule is incremented, even when another rule already refuses the call.
- `owner/context/read/route.ts:24-31`: the limits are counted **before** the body is validated.
- `guardrails/probe/route.ts:20`.

**What:**
- A single free owner session from one IP can send about 150 invalid "Read it" POSTs a day. They cost nothing: no
  model call, a 400 or 429 each time. Every one still raises `context-read:all`, and once it passes 150, "Read it" is
  refused for every owner until the day window ends.
- `probe:all` (60/min) has no session check. A script can hold it shut by sending ~60 POSTs a minute with a forged
  `Origin` header (the check only stops browsers).

**Fix:**
- Check the per-caller rules first, and increment the global rule only when they pass.
- Validate the body before counting.
- Consider failing probes open on a per-IP basis.

### N-3 · Low · the relay now depends on Neon for every call

> **Status: Won't fix now. Listed under README "Known limits".**
**Where:**
- `app/api/rialo/route.ts:57`
- `lib/server/rate-limit.ts:31-33` (fails closed on any database error)

**What:**
- Every wallet RPC call (reads, confirm loops, `sendTransaction`) now does one Neon upsert first.
- If Neon is slow, unreachable or over its free-tier compute, the relay returns 429 "too many requests" for
  everything. The in-browser wallet then can't read balances or send transactions, and the message points at the
  wrong cause.
- It also adds a Neon write and a `rate_hits` row per IP per minute to the hottest route.

**Fix:**
- Fail open for the relay's read methods (keep fail-closed for paid model calls).
- Or move the relay limit to a Vercel Firewall rate-limit rule.
- At least return 503 instead of 429 when the counter can't be reached.

### N-4 · Info · the cron's housekeeping can block its retries

> **Status: Won't fix now. Listed under README "Known limits" (cron and balances).**
`app/api/cron/agent/route.ts:21`: `await housekeeping(db)` runs before the pending-submission retries. If any delete
throws (a lock timeout, a migration not applied), the daily backstop retries nothing that day. Wrap the call in a
try/catch, or run it after the retries.

### N-5 · Info · `last_beat_ms` changed meaning

> **Status: Noted; nothing reads it. PROGRAM.md documents the meaning.**
While `SETTLING`, `last_beat_ms` is now "last settlement step that succeeded" (`lib.rs:457-459`). I checked the
consumers: the web decodes it (`lib/merit/state.ts:106`, `campaign-view.ts:194`), but no page or rule reads it, so
nothing breaks today. Any future "heartbeat stalled" indicator must treat `SETTLING` differently.

### N-6 · Info · `adopt_prefunded` assumes account index 1

> **Status: Noted; it fails safe.**
`lib.rs:1198` takes `self.accounts[1]` as the workflow account, as `deposit` already does. The re-derived address
check (`:1205-1207`) makes a wrong index fail safe (the instruction is rejected) rather than assigning a stranger's
account. That's fine; noted for future Venus changes.

---

## Live checks run (2026-10-28)

| Check | Result |
| --- | --- |
| `GET /` headers | CSP, Permissions-Policy, HSTS, X-Frame-Options DENY present |
| `POST /api/submit`, `/api/link` | 410 |
| `POST /api/session` | 404 |
| `POST /api/campaigns`, `/api/auth/logout` with no or foreign Origin | 403 |
| `GET /api/auth/x/start?returnTo=…` (5 inputs) | Off-site inputs stored as `/join`; the on-site path kept; cookie `typ: "oauth"` |
| `/join` | Directory only (`/join/rialo-in-your-own-words`) |
| `/p/rialo-in-your-own-words` | "8 verifications left"; round 85, Settling (normal between rounds) |
| DevNet `3P2mQttk…` | Pre-funded ledger adopted and opened |
| DevNet `4EiDFAmY…` | Ledger end synced after `close_round`, then approve |
| DevNet `5jojnG1h…` | `set_limits` refused while settling |
| DevNet `3mV8rmLo…` | `skip_stuck` accepted, with no skip performed (empty ledger) |

## Fix first

1. **N-1:** reset `last_beat_ms` on `approve_round`, `fund` and `resume`, and gate `skip_stuck` behind a `resume`
   that made no progress. Run the never-exercised `skip_stuck` branches on DevNet.
2. **M-3:** snapshot `max_per_day` and `approval_threshold` at `open_round` (apply changes from the next round), or
   fix the README/PROGRAM.md wording.
3. **N-2 / N-3:** count the global caps only after per-caller checks pass, and don't let a Neon problem shut the wallet
   relay.
4. **L-10:** nonce-based `script-src` to drop `'unsafe-inline'`.
