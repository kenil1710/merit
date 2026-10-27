# Misthos → Merit parity

Merit is a full port of Misthos to Rialo: same product, pages, features and UX. Only the chain (Arc, Circle and USDC
become a Rialo Venus program, RLO and an embedded Rialo wallet), governance (Latch), verification (REX), payouts
(native AFTER timers) and branding (cream and ink) change. This document lists every Misthos feature, page by page,
with Merit's status today and how it maps to Rialo. Sources read (read-only): `~/misthos` `ARCHITECTURE.md`,
`README.md`, `apps/web/src/app/**`, `apps/web/src/components/**`, `apps/web/src/lib/server/**`,
`packages/agent/src/**`, `packages/db/src/schema.ts`, `apps/worker/src/**`.

**Status:** **done** = Merit has it at Misthos' level · **partial** = exists but smaller · **missing** = not built ·
**n/a** = Misthos-only by nature (Arc networks, Circle, EVM) and replaced by a Rialo equivalent.

**Mapping keys:**
- **DB**: needs the off-chain database (decision D1).
- **P**: needs a Venus program upgrade (decision D2).
- **L**: goes through a Latch latch.
- **R**: verified by REX.
- **T**: done by the program's own AFTER timers.

**Progress (2026-10-27):** chunks 1–7 are done and deployed.
- **Program v2** is live on DevNet. The campaign was replaced for it: v1 accounts don't decode under v2.
- **Latch:** the full Latch setup is in place (`docs/LATCH_PLUS.md`).
- **Off-chain store:** moved from Vercel Blob to Neon.

Chunk 7 pages: Contributors (+ detail, suspend), Rounds (+ detail), public record `/p/[slug]` with recent decisions,
round receipt `/p/[slug]/rounds/[n]`, Treasury, Audit log with filters, Settings, Metrics; per-route skeletons, empty
states and toasts. No page says "Soon".

---

## 0. Decisions needed before building

| # | Decision | Why | My recommendation |
|---|---|---|---|
| D1 | **A real database for Merit** | Misthos keeps programs, members, contributors, submissions (including rejected and escalated ones), decisions, rounds, payouts, appeals, audit events and API usage in Postgres, with filters, counts, trigram duplicate search and an append-only audit table. The Vercel Blob store holds files, not queryable rows. It can't run the submissions filters, review queue, contributors totals, metrics, near-duplicate checks or the audit-log filters. | A **new Neon Postgres for Merit only**, added from the Vercel Marketplace to the `merit` project (free tier; nothing shared with Misthos). Port the Misthos Drizzle schema, adapting its columns to Rialo. Blob stays for nothing, or for logos. Needs your OK (it creates an external resource). |
| D2 | **A Venus program upgrade (merit v2)** | Several Misthos guarantees live in its vault contract. Merit's program has no equivalent yet: (a) remove an approved-but-unpaid item (owner override to reject, or re-process); (b) pause and resume; (c) close the round now without ending the campaign; (d) a rolling 24-hour cap; (e) owner approval for a round above a threshold; (f) a payee cooldown for new or changed wallets; (g) recording the agent's decision on chain before payment so settlement can't change it. | Upgrade the program in place at the same address (about 0.01 RLO on DevNet), with new instructions `revoke`, `pause`, `unpause`, `close_round`, `set_limits` (adding `max_per_day`, `approval_threshold`, `cooldown_ms`) and `approve_round`, plus new tests. Live campaigns keep working (fixed-width state with spare fields). Needs your OK before the redeploy. |
| D3 | **Work types** | Misthos judges X posts, GitHub PRs and commits, and articles. Merit's REX component verifies X posts only. | Phase 1: X posts at full Misthos depth (threads, eligibility, all checks). Phase 2: GitHub PRs and commits through a second REX component (public GitHub API; REX already fetched GitHub in Phase 1). Articles: judged and fetched server-side as in Misthos (SSRF-guarded), but **not REX-verified**, shown honestly as "verified by Merit's server, not by validators". |
| D4 | **No worker process** | Misthos runs a Railway worker (pg-boss queues, ticks, retries, Circle executor). Merit's settlement already runs on chain with no worker. | Judge inside the submit request (as now, about 15 s), with retries through `after()` and a Vercel Cron backstop for stuck items. Payouts stay on the program's AFTER timers. No always-on server. |

Everything below assumes D1–D4 as recommended. Rows marked **DB**, **P** or "phase 2" wait on them.

---

## 1. Public pages

| Misthos | Behaviour | Merit today | Status | Rialo / Merit mapping |
|---|---|---|---|---|
| `/` landing | Hero, live metrics per network, how it works, guardrails, decision examples, FAQ, final call, footer | Hero with blob field and corner label, live numbers from chain, four steps, what-runs-where, call to action | partial | Add: real decision examples (from the decisions table), an FAQ ported to Rialo, and network copy as "DevNet only". |
| `/campaigns` Explore | Open campaigns on the selected network, budget-used-up hidden, cards with network, pays-for, max per piece, round countdown, vault balance, contributor count, audit page and Join links, empty state with a network switch | `/explore`: cards with status, rate, round countdown, escrow, paid, Open/Contribute | partial | Add **filters** (open / ended / all, sort by newest, closes soon, most paid), contributor count (**DB**), "pays for" categories (rubric), hiding campaigns whose escrow is empty, and per-campaign join links. The network switch becomes a fixed "Rialo DevNet" badge. |
| `/p/[slug]` public audit page | Totals, rounds, every payout with tx, recent decisions with reasons, a Verify tool per decision ("check this record against the payment on Arc") | `/c/[address]`: stats, rules, books, decisions table plus a review drawer (judge reasons, hash match, REX 4/4, tx links), activity | partial | Move to **`/p/[slug]`** (slug-based). Add a Recent decisions list including **rejected and escalated** (**DB**) and a per-decision **Verify** panel. Verify recomputes the record hash, checks it equals the ledger entry's `submission_hash`, checks the REX report PDA and the payout transaction. That replaces ERC-1271. |
| `/p/[slug]/rounds/[roundId]` round receipt | One round: status, payouts list, on-chain record (decision root, propose/execute tx) | Round sections on the campaign page | missing | New page: round window, ledger PDA, every entry with outcome (paid / skipped / unfunded), heartbeat count, close, reimbursement, settle and pay signatures (**T**). Merit's "decision root" equivalent: the ledger account, which commits each entry's hash on chain. |
| Verify API `/api/public/verify`, `/api/public/decisions/[hash]` | Re-hash a record, check signature and payout event | Hash check inside the drawer | partial | Public `GET /api/public/decisions/[hash]` and `POST /api/public/verify`. They return the record, the on-chain ledger entry, the REX report and the payout transaction. |
| `/join/[slug]` | Program header, what it pays for, rules, example of good work, how it works, two steps (X sign-in, link payout wallet), paused and ended states | `/join` (one page for all campaigns): X sign-in, wallet, link, submit | partial | Per-campaign **`/join/[slug]`** with the Misthos layout: pays-for, rules, example, how it works, joining paused / campaign ended states. **X eligibility** (minimum account age and followers, owner policy review / reject / can't-join) via merit-x `GET /2/users/:id?user.fields=created_at,public_metrics` (**L**). Wallet link by signature: done. |
| `/c` contributor home | Programs you joined, per-program cards | none | missing | Port, with membership in the DB (**DB**). |
| `/c/[slug]` contributor program view | Account (X, wallet, status), what it pays for, your submissions with a step timeline, payouts, **appeal** ("ask for a second look") | Submit result card only | missing | Port with submissions, timeline (judged → approved on chain → REX verified → paid), payouts with tx, and appeals (**DB**). |
| `/docs` (Fumadocs) | Product docs, quickstart, how the agent decides, security, guardrails, audit trail | Markdown in the repo only | missing | Port the structure; rewrite the content for Rialo (Venus program, REX, Latch, timers). |
| SEO: robots, sitemap, OG and Apple icons, not-found, error pages | | OG, icons, not-found | partial | Add robots, sitemap, error and global-error pages. |

## 2. Owner app (`/app`)

| Misthos | Behaviour | Merit today | Status | Rialo / Merit mapping |
|---|---|---|---|---|
| Owner sign-in | RainbowKit + SIWE, one free signature, owner session | Embedded wallet unlocked per page; no server session | partial | **Owner session by signature**: the embedded wallet signs a nonce (like SIWE, nonce table **DB**), giving an HttpOnly session for owner APIs (review, override, settings). |
| App shell | Sidebar with program switcher (status dots), program nav (Overview, Submissions with a review count badge, Contributors, Rounds, Treasury, Audit log, Settings), workspace (All programs, Explore, Joined, Metrics, Docs), wallet chip; top bar with round pill, "Needs you" bell, share; mobile sheet | Sidebar with 4 global links, wallet chip, theme | partial | Port the full shell: program switcher, per-program nav, review badge, round pill (from chain), Needs-you bell (review queue, waiting for funds, low ops budget), share on X. |
| `/app` overview | Welcome panel for first-time owners ("your first program takes about five minutes"), your programs, programs you joined | none (the owner page lists campaigns) | missing | Port. Programs come from the DB plus on-chain state. |
| `/app/programs` all programs | Every program with status and filters | none | missing | Port, with status filters (draft / active / paused / ended). |
| `/app/programs/new` wizard | 5 steps: **Basics** (name, slug, description, logo), **Context** (about text, up to 3 links read once, key facts, on/off-topic), **Rubric** (categories, points, criteria; from an example), **Budget and schedule** (rate per point, round length, first round start, limits, min account age, min followers, below-minimum policy, max submissions per round, auto-approve confidence), **Review**. Creating saves a draft. | One "New campaign" form (name, brief, rate, caps, round length, deadline, escrow, ops) that creates on chain at once | partial | Port the 5-step wizard. Drafts live in the DB; nothing touches the chain until **Publish**, which runs `create_campaign` + `fund` + `fund_ops`. Rubric points map to the on-chain rate (score → kelvin), computed in the program. |
| `/app/programs/[id]/setup` + `/ready` | Setup checklist (deploy vault, fund, publish, share), "the vault will enforce" summary, join link | none | missing | Port: create the campaign workflow (sign), fund escrow, fund ops budget, publish, open round 1, share the join link. |
| Program overview | Title and status, public audit link, pause joining, stats (balance, contributors, needs review, round), what it pays for, vault limits, submission rules | Owner page cards per campaign | partial | Port the page. Stats come from chain (escrow, ops budget, round, beats) plus DB (contributors, needs review). |
| Submissions page | Tabs: All, Needs review, Queued, Reviewing, Approved, Partial, Paid, Rejected; table (status, contributor, agent decision); **review drawer** | Decisions table + drawer on the public page (approved items only) | partial | Port with every submission (**DB**), including rejected and escalated. |
| Review drawer | Where it is (journey stepper), how the agent decided (checks, rubric scores, reasons, confidence), flags with evidence, content, appeal notice, **manual approve with amount / reject with reason** (≥10 characters), confirm dialog, optimistic update, toasts | Read-only drawer: journey, judge reasons, checks, hash match, REX proof, tx links | partial | Port the actions. **Approve** from review → the agent sends `approve` on chain (score from the reviewer's amount; caps still enforced by the program) → REX verifies. **Reject** before approval: DB only. **Override after approval, before payout**: needs `revoke` (**P**). Once settled, decisions are final (as in Misthos). Every human decision is a new hashed record that names the one it supersedes. |
| Review queue | Escalated items: low confidence, soft flags, large amounts, prompt injection always, appeals | none (the agent only approves or skips) | missing | Port the engine's escalate path. Escalated items wait in **Needs review**; nothing goes on chain until a human approves. "Waiting for funds" comes from the campaign's `WAITING_FUNDS` phase plus the ledger outcome (**T**). "Over budget" = approval refused by the program's caps, shown with its reason. |
| Contributors page | Contributors with totals (submissions, approved, paid), status; detail page with account history (wallet changes), submissions, payouts | none | missing | Port (**DB**). Payouts are read from chain logs per wallet. Suspend / remove a contributor: DB (the agent stops approving them). |
| Rounds page + round detail | Rounds with status (open, closed, proposed, approved, executed, failed), payouts per contributor, close round now | Round sections per campaign | partial | Port. Statuses map to chain phases: open → OPEN, closed/proposed → SETTLING, waiting → WAITING_FUNDS, executed → settled. "Close round now" needs `close_round` (**P**); today the only option is `end`. |
| Treasury | Vault balance, add funds, deposits list, payouts list, rolling 24-hour limit, withdraw or pause, deploy vault | Fund / withdraw (escrow and ops) on the owner page; Books on the public page | partial | Port the page: escrow and ops budget, add funds, withdraw unreserved, deposits and withdrawals list (from program logs), payouts list, **Books**. Rolling 24-hour cap and pause need **P**. |
| Audit log | Append-only audit events with filters (actor, kind, date), clear filters, empty state | Activity list (program logs) on the public page | partial | Port with an append-only `audit_events` table (**DB**, triggers as in Misthos) merged with on-chain events, plus the same filters. |
| Settings | Join page (name, description, logo, pause joining), context for the agent (edit brief, re-read links), submission rules (min age, followers, below-minimum policy, max per round), round schedule, vault (deploy, address), limits (edit, owner approval), **end campaign** | Round length, end, refund, resume on the owner page | partial | Port. Join page / context / rules: DB. Round length: `set_round_length` (done). Limits: `set_limits` (**P**). End: done. Agent: `set_agent` (done). Pause joining: DB. |
| Metrics (admin) | Programs onboarded, submissions reviewed, auto-approved, escalated, fraud and duplicates caught, by flag, median review time, contributors (active in 30 days, paid), rounds executed, USDC paid, Claude and X spend | Live numbers on the landing page | missing | Port (**DB** + chain). Claude and X spend read from Latch `/budget` (**L**). "USDC paid" becomes RLO paid. |
| Preview banner, vault-paused banner, focus routes, no-access page | | none | missing | Port; "vault paused" becomes "campaign paused" (**P**). |
| Share on X | Prefilled share text with the join link | none | missing | Port. |

## 3. Agent: judge and decision engine (`packages/agent`)

| Misthos | Behaviour | Merit today | Status | Rialo / Merit mapping |
|---|---|---|---|---|
| Fetchers | X post plus the author's self-reply thread (up to 25 posts, one capped search), GitHub PR and commit, article (SSRF-guarded), cached in `fetched_resources` | One X post through merit-x | partial | X thread via merit-x `GET /2/tweets/search/recent` (**L**). Correction: the `/2/tweets/*` pattern matches one path segment, so merit-x refuses the search today (and caps responses at 12 KB); the agent then judges the single post with a note. Decision (2026-10-26): no search path on merit-x, because search bills per post returned and Latch can't cap it; single-post judging stays (README limits). GitHub phase 2. Articles server-side. Cache in DB. |
| Deterministic checks | `OWNERSHIP_MISMATCH`, `OWNERSHIP_UNVERIFIED`, `DUPLICATE_URL`, `NEAR_DUPLICATE` (pg_trgm + SimHash), `OUT_OF_WINDOW`, `DATE_UNVERIFIED`, `DELETED`, `NOT_MERGED`, `ENGAGEMENT_ANOMALY`, `MISSING_REQUIRED`, `LOW_FOLLOWERS`, `NEW_ACCOUNT`, `WALLET_CHANGED_RECENTLY`, `PROMPT_INJECTION_ATTEMPT`, `OFF_TOPIC`, `CONTRADICTS_BRIEF` | author matches, mentions Rialo, length ≥ 60, duplicate post id; on-chain post window + author (REX) | partial | Port every check. Ownership and window are then **also** proven on chain by REX (**R**), stronger than Misthos. |
| Campaign brief context | About text, up to 3 links read once, key facts, on/off-topic, contradictions quoted | Brief text only | partial | Port (`program_contexts`). |
| Judge | Claude Haiku via a strict `record_judgment` tool, rubric criterion scores, reasons, confidence, quality summary, soft flags, random per-request boundary fence | Haiku via merit-judge, JSON score + 3 reasons | partial | Port the tool-based judge. The **merit-judge latch denies `tools`** (payload rule `$.tools not_exists`), so either: (a) the latch rule is relaxed to allow exactly that one tool name, which is your dashboard change; or (b) strict JSON output with schema validation and no tools. Recommendation: (b), so no latch change is needed. |
| Decision engine (`rules-v9`) | Hard flags reject; injection always to a human; low confidence / soft flags / large amounts escalate; clear spam auto-rejected; points from criterion scores; partial approvals | Score ≥ minimum → approve | partial | Port the engine as is. "Partial" = an approve with a lower score. |
| Decision records | Canonical JSON (sorted keys), keccak, signed by the agent SCA (ERC-1271); overrides and re-processes are new records naming the superseded one | Canonical JSON, sha256, the hash written into the ledger entry on chain | partial | Keep sha256 (anchored on chain, which is stronger than an off-chain signature). Add an ed25519 signature by the agent key over the hash, plus supersedes links (**DB**). |
| Re-process | Fresh fetch + current rules, new record superseding the old, before payout | none | missing | Port; once on chain, needs `revoke` (**P**). |
| Explanations | Facts-based explanation text | Reasons only | partial | Port `explain.ts`. |

## 4. Rounds and payouts

| Misthos | Behaviour | Merit today | Status | Rialo mapping |
|---|---|---|---|---|
| Round schedule | Round length in days, first round start, scheduled close by the worker tick | 1 min – 7 days, AFTER heartbeat closes it | done (better) | **T**: no worker; the program closes, settles and reopens rounds itself. A "first round starts at" date: DB (the owner opens the round, or a scheduled `start` call). |
| Re-check at close | Re-fetch every approved item; deleted or no-longer-owned work is rejected with a signed record | REX verifies at approval time only | partial | Option: a second REX check at close (costs 0.012 RLO per item from the ops budget). Recommendation: re-check through merit-x at close; anything deleted is sent to `revoke` (**P**). |
| Payee registration + cooldown | Each contributor's wallet registered on chain; a new or changed wallet waits `cooldownHours` | Wallet link by signature (off chain) | partial | Off chain now: wallet changes are logged and the agent refuses approvals for wallets linked less than `cooldown` ago (`WALLET_CHANGED_RECENTLY`). On chain: `cooldown_ms` (**P**). |
| `planRound` | Aggregate whole items per contributor within per-payout, per-round and remaining daily caps; carry the rest to the next round with a reason | Program pays in approval order within caps; the rest is skipped or waits for funds | partial | Per-payout and per-round: done on chain. Daily cap: **P**. "Carry to next round": today skipped items stay in their round; carrying needs **P**. |
| Owner approval threshold | Rounds above the threshold wait for the owner's `approveRound` | Settlement is automatic | missing | **P**: `approval_threshold`; settlement pauses in a new phase until the owner signs `approve_round`. |
| Exactly-once payout | `paid[payoutId]` | Per-entry outcome in campaign state, re-checked before each transfer | done | **T**. |
| Execution | Circle SCA with idempotency keys, Gas Station | The program's own timer pays; no executor | n/a | **T**. |

## 5. Data model (`packages/db`) → Merit

| Misthos table | Merit |
|---|---|
| `users`, `auth_nonces` | DB: owner (Rialo wallet), contributor (X id + wallet), nonces for owner sign-in and wallet link. |
| `programs`, `program_contexts`, `program_members` (owner, reviewer) | DB, plus the campaign PDA address and slug; members add a **reviewer** role. |
| `contributors` (status active / suspended / removed, wallet history) | DB (`contributors`); legacy wallet links are in `store_records`. |
| `rounds` | Chain (round number, window, phase, beats) plus a DB cache. |
| `submissions` (pending, processing, approved, partial, rejected, escalated, paid) | DB, for all statuses. Approved ones are also ledger entries on chain. |
| `fetched_resources` | DB cache of X / GitHub / article reads. |
| `decisions` (action, amount, points, flags, llm, model, prompt and rule version, decided by, override reason, hash) | DB; the hash is also on chain. |
| `payouts` | Chain (program logs + ledger outcome), cached in DB. |
| `audit_events` (append-only via triggers) | DB with the same triggers, plus chain events. |
| `api_usage` | DB, plus Latch `/budget` and `/audit`. |
| `appeals` | DB. |

## 6. Worker jobs (`apps/worker`)

| Misthos job | Merit |
|---|---|
| `submission` (pipeline) | Inside the submit request, with `after()` retries and a cron backstop (D4). |
| `round` (close, re-check, register payees, plan, propose, execute) | The program's AFTER timers (close, settle, pay) (**T**); re-check through a cron route calling `revoke` (**P**). |
| `contributor` (payee sync) | Not needed: the wallet is passed at approval and checked by the program. |
| `arc-mainnet` | n/a (DevNet only). |
| Tick, wake, health | Cron route plus a `/api/health` relay. |

## 7. UX details

| Misthos | Merit today | Status |
|---|---|---|
| Loading skeletons per route (`loading.tsx` on overview, programs, submissions, contributors, rounds, treasury, settings, audit) | One app-wide skeleton | partial: per-route skeletons. |
| Empty states with illustrations and one action, on every list | Explore, Contribute, Rounds | partial: every list. |
| Toasts (sonner) for every action | Wallet faucet only | partial: every action. |
| Confirm dialogs for irreversible actions (close round, end campaign, override) | End campaign | partial. |
| Error and global-error panels | Error panel component, not wired | partial. |
| Theme toggle, accessible focus, reduced motion, axe-checked e2e | Theme toggle, focus rings, reduced motion | partial: add axe checks to e2e. |
| Breadcrumbs, page headers, tables, disclosure, copy fields, identicons | Most ported | partial. |
| Network switch (Arc Testnet / Mainnet) | n/a | n/a: a fixed "Rialo DevNet" badge. |
| Wallet connect (RainbowKit, many wallets) | Embedded Rialo wallet | n/a: no Rialo browser wallets in this stack yet; the embedded wallet replaces them. A later option is `@rialo/frost` wallet-standard support. |

## 8. Can't work on Rialo yet (shown honestly in the UI)

| Feature | Why | How the UI shows it |
|---|---|---|
| Transaction signing through the `merit-payout-signer` latch | This Latch account offers no Privy signer secret yet | The Guardrails card says "Waiting on Latch rollout"; the agent is a DevNet key; `set_agent` swaps it in later. |
| REX verification of articles | An article has no stable author identity for validators to agree on | Article decisions are labeled "checked by Merit's server, not by validators". |
| Real-value payouts | Merit runs on DevNet only (test RLO) | A "DevNet · test RLO" badge in the header and on every amount screen. |
| Pause, close-round-now, 24-hour cap, owner approval threshold, on-chain cooldown, revoke | Need the program upgrade (D2) | Disabled controls with "needs program v2" until it ships. |
| Ledger rent reclaim | Venus 0.18.1 has no clean workflow close | Shown in Books as rent kept per round. |

---

## Merit beyond Misthos

Kept on top of every Misthos feature, and where each shows in the UI:

| Addition | What it is | Where in the UI |
|---|---|---|
| **merit-judge latch** | Every Claude call goes through Latch: Haiku only, bounded `max_tokens`, no tools, $1/day budget; the server holds only a `lat_` token | Guardrails page (policy, spend, audit); judge section of the review drawer ("scored through merit-judge") |
| **merit-x latch** | Every X read (judge and REX validators) goes through Latch: GET only, 4 endpoint patterns, 400/day | Guardrails page; REX proof panel |
| **Guardrails page** | Live `capabilities` / `budget` / `audit` per latch, plus a signer placeholder | `/guardrails`, sidebar |
| **REX unanimous verification** | Validators fetch the X post themselves with the TEE-decrypted, encrypted `merit-x` token; only a unanimous, processor-owned report counts | Review drawer "REX proof · Unanimous 4/4"; public audit page; round receipt |
| **Self-running AFTER timer settlement** | The program closes rounds, repays the agent, pays contributors in approval order and reopens rounds; no worker, no keeper | Round pill (heartbeats), rounds page, activity log, landing "0 keepers" |
| **On-chain caps** | Payout computed from the score in the program; per payout / per contributor per round / per round enforced at approval and again at payout | Program overview "Rules enforced on chain", Settings › Limits |
| **Separate operations budget** | REX cost and ledger rent repaid to the agent from a budget apart from the escrow; approvals stop when it runs low | Treasury, Books, owner dashboard tile with a low-budget warning |
| **REX report-owner fix** | `on_verify` accepts only the processor-owned report PDA recorded for that entry | `docs/PROGRAM.md`; REX proof panel ("accepted only from the PDA recorded for this entry") |
| **Account-position fix** | Every caller-named account resolved by key, never by position | `docs/PROGRAM.md` |
| **`set_agent`** | The owner rotates the agent authority (e.g. to the Latch signer's Privy wallet) from the next round | Settings › Agent; Guardrails signer card |
| **Embedded Rialo wallet + faucet** | Key generated and encrypted in the browser, 1 RLO faucet through the capped relay | Join page, owner sign-in, sidebar wallet chip |
| **Books** | Every RLO in and out: escrow funded, paid, withdrawn, refunded, ops funded, repaid | Public audit page, Treasury |
| **Hash anchored on chain** | Each approved decision's record hash is stored in the ledger entry, not only signed off chain | Verify panel ("Hash matches chain") |
| **Strict JSON-RPC relay** | Browser-to-DevNet relay with a method allowlist, no batches, faucet ≤ 1 RLO | Developer-facing; covered by e2e |

---

## Build order (after your OK on D1–D4)

1. **DB + owner session.** Neon schema port, migrations, signature sign-in for owners, programs (drafts) and members.
2. **Wizard → setup → publish**, the app shell with program switcher, the overview with the welcome panel, and all-programs filters.
3. **Contributor side.** `/join/[slug]` with X eligibility, `/c`, `/c/[slug]` with timeline and appeals.
4. **Agent.** Thread fetch, every check, brief context, strict JSON judge, the `rules-v9` engine, explanations, records, escalation queue.
5. **Owner review.** Submissions tabs, review drawer actions (approve / reject; override where allowed), toasts and confirms.
6. **Program v2** (`revoke`, pause, close round, daily cap, approval threshold, cooldown) with tests, then the Treasury, Settings › Limits and Rounds controls.
7. **Rounds + round detail + public round receipt, public audit `/p/[slug]` with Verify, audit log, contributors, metrics.**
8. **Explore filters, per-route skeletons, empty states, error pages, docs, axe e2e, screenshots.**

Each step keeps every Merit addition above, the cream and ink style, and runs e2e before the next.
