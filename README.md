# Merit

**Pay contributors in RLO for verified work: an AI judge scores each post through Latch-governed credentials, Rialo
validators verify it, and the program's own timers pay. No keeper for payouts, and the Anthropic and X API keys
stay inside Latch.**

Live on Rialo DevNet: **[merit-ruby-two.vercel.app](https://merit-ruby-two.vercel.app)**. Current campaign:
"Rialo in your own words" ([join](https://merit-ruby-two.vercel.app/join/rialo-in-your-own-words) ·
[public record](https://merit-ruby-two.vercel.app/p/rialo-in-your-own-words)). DevNet only, test RLO.

## How it works

1. **Post.** A contributor signs in with X, joins a program with an embedded Rialo wallet (the wallet signs the join),
   and submits an X post.
2. **AI judge, through Latch.** Merit reads the post through the `merit-x` latch and scores it against the campaign's
   rubric with Claude Haiku through the `merit-judge` latch. Deterministic checks run first: authorship, round
   window, duplicates, prompt injection, eligibility. A rules engine then approves, rejects, or sends the post to the
   owner's review queue. Merit holds only `lat_` tokens; the Anthropic and X keys stay inside Latch.
3. **Approve on chain.** The agent key records the approval in the round's ledger. The program computes the amount
   from the score and enforces every cap: per payout, per contributor, per round, a rolling 24 hours, and the
   operations budget.
4. **REX verify.** The approval arms a REX request. Rialo validators fetch the post themselves through `merit-x`,
   with the latch token decrypted only inside their enclave. Only a unanimous report that names the approved post,
   author and round marks the entry verified.
5. **Self-running payout.** A native `AFTER` heartbeat closes the round, repays the agent's REX and rent costs from
   the operations budget, pays verified entries in approval order, and opens the next round. No worker or cron is
   involved in paying. (A daily Vercel cron only retries submissions the judge couldn't process at submit time, and
   cleans up old rows.)

## What runs where, and the trust model

| Where | What | Who can change it |
| --- | --- | --- |
| **On Rialo** (Venus program `4qBwWYWn7ougS7sHP21x4yTDk4cwmyEqUiqNmKAYVuk6`) | Escrow, operations budget, caps, approvals, REX verification, round timers, settlement, payouts, refunds, pause, revoke, payee cooldown, owner approval of large rounds | Owner: funding, limits, end and withdraw. Agent: approve and revoke, within the caps. Nobody can pay an unverified entry. |
| **In Latch** | The Anthropic and X credentials; every call checked by a per-latch policy (below); spend and rate caps; an audit log | The Latch dashboard owner |
| **Off chain** (Next.js on Vercel + Neon Postgres) | X sign-in, the judge call, the decision engine, the review queue, the agent key that signs `approve`, signed decision records (their hash is stored on chain and re-checked by the public page) | Merit's server |

**Trust model:**
- **The agent is trusted to judge, not to pay.** The program computes every amount and only pays entries REX
  verified. A misbehaving agent can approve within the caps and spend the operations budget. It can also `revoke`
  unpaid entries, which withholds those payouts (it can't redirect them).
- **The owner funds the campaign and can stop paying, but can't take what is owed without it showing.** The owner
  can pause (payouts wait), end the campaign, set the daily cap and a round-approval threshold, and withdraw escrow
  that no open round reserves. Since program v3 those two limits can't change while a round settles, so a closed
  round pays under the rules it closed with. A round above the threshold waits for `approve_round`; if the owner never
  approves it, the refund deadline returns the escrow to the owner and the entries stay unpaid on chain. A stuck
  payout skipped with `skip_stuck` is recorded `UNFUNDED` (verified, owed, unpaid). Reviewers the owner adds can
  approve any amount up to the per-payout cap from the review queue.
- **REX proves facts about the post:** it exists, its author id, and that it was created inside the round. It can't
  prove the wallet belongs to that X account. That link comes from the X sign-in plus a wallet signature, and a
  payee cooldown guards wallet changes.
- **Latch bounds what a leaked or misused token can do:** which model, how many tokens, which endpoints, how often,
  and how much a day.

## How Merit uses Latch

Every call names its campaign in an `X-Merit-Campaign` header (REX validators included), repeats it as `X-User` for
the Cedar policy, and the judge sends the contributor's X id as `metadata.user_id`. Merit logs each call with
Latch's request id and `deniedBy`. The [Guardrails page](https://merit-ruby-two.vercel.app/guardrails) shows, live:
each latch's filters, today's spend, per-campaign usage, and "try a bad request" buttons that return Latch's real
403. Policy sources are in `latch/`; the dashboard steps are in `docs/LATCH_SETUP.md` and `docs/LATCH_PLUS.md`.

### merit-judge (Anthropic, Claude Haiku): 11 filters

| Filter | Rule | Why |
| --- | --- | --- |
| `rate_limit_0` | 20 a minute | Bursts. |
| `endpoint_1` | `/v1/messages` only | Nothing but the Messages API. |
| `method_2` | POST only | |
| `body_size_3` | 64 KB | A rubric plus at most 10 posts. |
| `payload_4` | `model` in [`claude-haiku-5-5`], `max_tokens` exists and ≤ 2048, no `tools` | One small model, bounded output, no tool use. |
| `rate_limit_5` | 500 a day, fixed | A model-independent daily bound. |
| `spend_limit_6` | $1.00 a day at Latch's model pricing | A runaway loop can't cost more than $1 a day. |
| `response_7` | withhold 4xx/5xx; replies over 16 KB | A real reply is at most 2,000 tokens. The judge retries a withheld reply. |
| `payload_8` | `$.metadata.user_id` exists | Every call names its contributor. |
| `header_requirement_10` | `X-Merit-Campaign` is a campaign address or `owner-<uuid>` | Every call can be traced to a campaign. |
| `cedar_11` | [`latch/merit-judge.cedar`](latch/merit-judge.cedar): POST `/v1/messages` with a body; never an anonymous caller | The same rules written as declarative policy. Body rules stay in `payload_4`. |

### merit-x (X API v2, read only, also used by REX validators): 7 filters

| Filter | Rule | Why |
| --- | --- | --- |
| `method_0` | GET only | Read only. |
| `endpoint_1` | `/2/tweets`, `/2/tweets/*`, `/2/users/*`, `/2/users/by/username/*` | Lookups only: no search, timelines or writes. |
| `rate_limit_2` | 30 a minute | Sized for REX: every validator in a duty fetches once. |
| `rate_limit_3` | 400 a day, fixed | A hard daily count on X reads. |
| `response_4` | withhold 401/403/429/5xx; ≤ 12 KB | Keeps every answer under REX's response limit. |
| custom_code, Rust in the enclave | [`latch/merit-x-submissions.rs`](latch/merit-x-submissions.rs): GET `/2/tweets/<numeric id>` only | No search, batches, user lookups or writes. REX reads pass. |
| `header_requirement_6` | `X-Merit-Campaign` is a campaign address | Every read is attributed, validators included. The REX component sends it. |

### merit-judge-rialo-own-words (an extended latch for one campaign)

A child of merit-judge for "Rialo in your own words": `attenuate_only`, live inheritance, so it keeps all 11 parent
filters. It adds:
- `X-Merit-Campaign` pinned to that campaign's address, so the token is useless for any other campaign;
- 100 calls a day;
- 25¢ a day.

Merit uses `MERIT_JUDGE_LAT__<campaign>` / `MERIT_X_LAT__<campaign>` for a campaign's calls (and for its REX
ledger token). It falls back to the parent only when no child is configured, and never when a configured child
denies.

### merit-check (ready, not yet used)

A small latch that fronts Merit's `/api/latch/tweet-check/<ids>`. It is for a stricter merit-x policy,
[`latch/merit-x-submissions-outcall.rs`](latch/merit-x-submissions-outcall.rs), that asks Merit before every read
whether the post is a real submission. That policy is compiled and tested in `latch/harness`, and goes live when
outcalls are available to Rust custom_code.

### latch-self endpoints Merit reads

| Endpoint | Used for |
| --- | --- |
| `/.well-known/latch-self/capabilities` | Methods, endpoints, payload rules, spend cap |
| `/.well-known/latch-self/budget` | Today's spend; its model pricing also prices per-campaign spend |
| `/.well-known/latch-self/audit` | Each latch's (and each child's) latest decisions |
| `/.well-known/latch-self/whoami` | A child latch's name, chain depth and status |
| `/.well-known/latch-self/authorize` | "Try a bad request" (asked first; only denied requests are sent) and the ordered filter list (one allowed dry run every 6 hours) |

## Proofs

Everything below is on Rialo DevNet; [`docs/EVIDENCE.md`](docs/EVIDENCE.md) has every step and signature.

| What | Proof |
| --- | --- |
| Round 1: a real post judged, approved, REX-verified and paid by the timer (v1) | approve `62KditLizq1tRcvVUAcAJJpb8rXUSAxH11485dP4v1TAtA4pC8AhJTGkFJwK9Fv1U39e5RbMiKor7NJJMJHpUM8u` · verified `2zqzmbrANZMSHWj32SCQTH5Q9SMhYCLQX5h5c8PWcayn78kxij9EkJ2sAZAS1NzHvQ63QefNTHLhQDvxZE6hZyAw` · paid `5zJRRMjkp4ENcVSsNra4QFP5tJtRP7KUF3iGnbTLNHXTkwABveG1omB3vmdvW67ohycrFLDz8psTHagkZmrre4PZ` |
| Program v2: a real post paid by the round-29 settlement | approve `461vmdeR42KBZBsBDS6FDajYwmMDJLVMzh8ADnP2cq9hQWutPZNvCxkWfh9U58fRwgtWdqgqWNJG5QttGhquMaCD` · paid 0.063 RLO `DasVS8DH1d9gdfywibgBTx2vAhnqJeS4roFDB1FatkyekV3KGYddDdmgiuepWEjazwZG8hdJfAtCTjKo15HMtUP` · round settled and next opened `5iHhTrCQ2vzVSokEmp2AQoPNw7LGvRgi4Y7itgdnwpnG1Jm2JMUNydKMu1rbUtcYy9rPSghk5zTdUafdnSgT6wbm` |
| REX 4/4: four validators read the post through merit-x (with the campaign header) and agreed | report `8AxiHQa4JLh7fjQTM189KFaqJGp1XNsmgLPeFqBmHX54` (round 29) and `7w3qn5kdA2BdrZfjU2mnAJWdojDEoxbGBgHL4unuxfkK` (round 32, after the header requirement went live) |
| Negative tests: 30 invalid instructions sent, 29 rejected on chain; the 30th (a forged `on_verify` that arrived after its entry finished) landed as a no-op, and its timed retry was rejected. Program v3: the audit's H-1, M-1, M-2 and M-3 cases | [`deployments/devnet-negative.json`](deployments/devnet-negative.json), made by [`apps/web/scripts/negative-devnet.ts`](apps/web/scripts/negative-devnet.ts) |
| Latch: a bad request gets a real 403 from the right filter | Guardrails page; e2e `apps/web/e2e/public.spec.ts` |

Security findings from this work were reported privately to the Rialo and Latch teams.

## Honest limits and roadmap

**Limits today:**
- **DevNet only, test RLO.**
- **The agent is a DevNet key held by the server.** The on-chain caps are the wall around it.
- **The X-account ↔ wallet link is attested by Merit,** not proven on chain: REX proves the post, not who owns
  the wallet.
- **Threads are judged one post at a time.** Search bills per post returned, so `merit-x` allows lookups only.
- **X spend is bounded by request counts** (400 a day) rather than a dollar cap.
- **No per-contributor judge cap yet.** Every call names its contributor; the latch and campaign caps apply.
- **merit-x checks the shape of a read, not that the post is a submission** (the outcall policy is ready, see above).
- **Ledger rent is not reclaimed:** about 0.024 RLO a round with approvals, repaid to the agent from the operations
  budget.
- **The agent backstop runs once a day.** A submission the judge couldn't process (X, Latch or the model busy, and
  the one in-request retry failed) waits for the 06:00 UTC cron; by then its round has usually closed and it is
  refused with that reason. Vercel Hobby allows one cron a day.
- **One shared agent pays payee rent.** Every joining contributor makes the agent pay for an `open_payee` account,
  and nothing repays it yet.

**Roadmap:**
1. **Payout signer through Latch:** the agent's transactions signed in Latch's enclave with `rialo_tx_signers`, and
   `set_agent` pointed at that wallet.
2. **A per-contributor cap** in merit-judge, keyed on `$.metadata.user_id`.
3. **The merit-x outcall check:** only posts that are real Merit submissions can be read.
4. **Mainnet,** after an audit, with real-value caps.

## Run it locally

Prerequisites: Node 20+, npm, and for the program the Rialo toolchain (`rialoman install stable@0.18.1`, which
provides `cargo +rialo` and `rialo`) plus `rustup target add wasm32-wasip2`.

```bash
git clone https://github.com/kenil1710/merit && cd merit/apps/web
npm install
cp ../../.env.example .env.local      # fill in your own values (Latch tokens, X OAuth app, DevNet agent key)
MERIT_DB=pglite npm run dev           # in-memory Postgres; or set DATABASE_URL to your own Neon database
```

- **Tests:**
  - `npm test` runs the unit tests (live tests run only when Latch tokens are set);
  - `npx playwright test` runs the e2e suite against DevNet with an in-memory database.
- **Database:** `npx drizzle-kit migrate` applies `drizzle/` to `DATABASE_URL_UNPOOLED`.
- **Program:**
  - `cargo test -p merit-core -p merit` runs the program's tests;
  - `cargo build --manifest-path programs/merit/artifact/Cargo.toml` builds the program and its REX component;
  - `rialo client program deploy-venus programs/merit` deploys it (DevNet).
- **Latch:** create the latches with [`docs/LATCH_SETUP.md`](docs/LATCH_SETUP.md), then
  [`docs/LATCH_PLUS.md`](docs/LATCH_PLUS.md).

More: [`docs/PROGRAM.md`](docs/PROGRAM.md) (the Venus program), [`docs/WEB.md`](docs/WEB.md) (the app),
[`docs/DECISIONS.md`](docs/DECISIONS.md), [`docs/PARITY.md`](docs/PARITY.md).

## Credits

Built on [Rialo](https://rialo.io) DevNet (Venus workflows, REX, native timers) and
[Latch](https://onlatch.com) by Subzero Labs. Judging by Claude Haiku through Latch.

## License

[MIT](LICENSE)
