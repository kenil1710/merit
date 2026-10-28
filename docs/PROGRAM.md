# Merit Venus program (`programs/merit`)

Status: **deployed on Rialo DevNet (program v3).** Program id
`4qBwWYWn7ougS7sHP21x4yTDk4cwmyEqUiqNmKAYVuk6`, REX component `SufLA3Vvm5x7ag2RSctyJhgceMQS1ht8rYAadjdvQvb` (pinned in
`require_authorized_rex`).
- **Last in-place upgrade:** 2026-10-28, program v3 (audit fixes, below). Before that 2026-10-26 (`964ba6e`): the
  REX fetch sends `X-Merit-Campaign`.
- **Negative tests:** the rejection paths are checked on DevNet (`docs/EVIDENCE.md`, "Negative tests";
  `apps/web/scripts/negative-devnet.ts`), including the audit's H-1, M-1, M-2 and M-3 cases on v3.

Built with rialo-venus 0.18.1. The money rules live in `crates/merit-core`: plain Rust,
no Rialo types, called by the program for every decision, so `cargo test -p merit-core`
tests the code that runs on chain.

## Two workflows, one program

Venus derives a workflow PDA from `(program, payer, slug)`, and only that payer can call
its control functions. Merit uses this as its permission system:

| Workflow | Created by | Holds | Who can drive it |
| --- | --- | --- | --- |
| **Campaign** | owner | payout escrow, operations budget, caps, round clock, settlement outcome | owner; its own timers |
| **Round ledger** | agent | approvals of one round, the encrypted `merit-x` token, REX results | agent; its own REX callbacks |

A ledger lives at `PDA(program, round_agent, Nonce(blake3("merit-ledger" ‖ campaign ‖ round)))`.
`open_ledger` rejects any other slug, and settlement derives the address itself, so
nobody can point a campaign at a different ledger.

## Lifecycle

```
owner  create_campaign(agent, rate, min_score, caps…, round_length_ms, refund_deadline_ms)
owner  fund(amount)            exact transfer into payout escrow
owner  fund_ops(amount)        operations budget (repays REX + ledger rent)
owner  start()                 round 1 opens, heartbeat armed
agent  open_ledger(campaign, round, encrypted lat_)   first approval of a round
agent  approve(campaign, contributor, x_user_id, post_id, score, submission_hash)
         └─ AFTER +1ms → run_verify → REX fetch_post (X via merit-x latch) → on_verify
heartbeat (no keeper):
  beat every 5 s while open ─▶ round ends ─▶ settle_peek
  settle_peek: wait until every verification is final (or 60 s grace)
             → settle_reimburse (repay agent from ops budget)
             → settle_pay, one payout per step, approval order
             → next round / ENDED / IDLE (escrow empty) / REFUNDED (deadline)
```

Owner controls: `end`, `withdraw` (unreserved escrow only), `withdraw_ops` (between
rounds), `refund` (after the deadline), `resume` (re-arm a stopped heartbeat), `set_agent`,
`set_round_length` (60 s to 7 days, applies to the next round), `skip_stuck` (v3: past a settlement step
that keeps failing).

## Rules enforced on chain

- **Amount from score.** The agent supplies a 0–100 score; the program pays
  `rate × score / 100`. `rate ≤ per-payout cap ≤ per-contributor cap ≤ per-round cap` is
  checked when the campaign is created.
- **Caps at approval and again at payout:** per payout, per contributor per round (keyed
  by X user id), and per round. The ledger holds at most 16 approvals per round.
- **Identity:** within a round, one X account maps to one wallet and one wallet to one X
  account, so nobody can split a cap across wallets.
- **REX verification** (`fetch_post`, `http::get` from every validator): the report counts
  only if at least 3 validator outputs exist and all are byte-identical successes. The
  post must be the approved id, written by the approved X user id, and created inside
  the round. A post's creation time falls in exactly one round's window, so it can't be
  paid in two rounds. Before program v3 that failed after an early close: a ledger kept its
  original end while the next round started at the early close, so a post written in
  between fit both (audit M-2). v3 syncs the ledger's end to the campaign's on every
  `approve` and `retry_verify`. Within a round, `DuplicatePost` refuses the same post twice.
- **Report authenticity:** `on_verify` accepts only the processor-owned report PDA
  recorded in `run_verify` for that entry (see "REX report binding" below).
- **Settlement order:** strictly in approval order. A verified entry the escrow cannot
  cover stops settlement in `WAITING_FUNDS`; `fund` resumes it. At the refund deadline,
  verified-but-unfunded entries are marked `UNFUNDED` and everything left is refunded.
- **Withdrawals:** none while settling or waiting; while a round is open, only what
  exceeds the round cap.
- **Fixed-width state.** Every field is a scalar or a vector sized once by `reserve_tables`, so an account never
  changes size; `tests/state_invariants.rs` fails the build if that changes.
- **Timer epochs.** Each timer carries the epoch it was armed in; `resume` bumps the
  epoch, so an older chain stops when it next fires.

## Who starts the REX check, and why that is safe

The agent's own `approve` arms a timer in the agent's ledger, and that handler creates
the REX request. The agent is the creator and payer (0.0115 RLO each), and the encrypted
`merit-x` token is bound to that creator.
- **The agent can't steer the request.** The request's inputs come only from the ledger
  entry (post id, encrypted token), and its component is pinned to the bytecode deployed
  with Merit.
- **The agent can't fake the result.** The callback accepts only the report at the PDA
  recorded for that entry, owned by the REX processor, and the campaign pays only
  entries that report verified.
- **A misbehaving agent's damage is bounded.** It can approve within the caps, spend
  the operations budget, and `revoke` unpaid entries (withholding those payouts). It can't
  change an amount, pay an unverified entry, or redirect a payout.

## REX report binding

Each verification is bound to its own REX request. `run_verify` records
`derive_report_address(agent, multi_account_slug(ledger, branch, rex_index))` for the entry, and `on_verify` accepts
only that account, owned by the REX processor, with a report created by the ledger's agent. Anything else is
rejected and the entry stays pending. This relies on generated internals (`multi_account_slug`, `branch_number`,
`rex_accounts_block_index`, `triggering_event_account_index`) pinned to 0.18.1. The DevNet negative tests check it
(`docs/EVIDENCE.md`).

## Costs (DevNet, measured or quoted by RPC)

| Item | Kelvin | RLO | Paid by |
| --- | --- | --- | --- |
| Heartbeat / settlement step | 0 | 0 | owner (float of ~0.005 per armed timer, refunded) |
| REX verification | 11,511,840 | 0.0115 | agent, repaid from the ops budget at 12,000,000 |
| Campaign PDA rent (~3.2 KB, estimated size) | ~23.0M | ~0.023 | owner, once |
| Round ledger rent (~3.3 KB, estimated size) | ~24.1M | ~0.024 | agent, repaid from the ops budget; only rounds with approvals |

0.18.1 has no clean way to close a ledger: a closed ledger would be re-created by Venus's
postflight write. Reclaiming ledger rent is listed under "next".

## Program v2 (2026-10-26)

Adds, all enforced on chain:

| Instruction | Who | What |
| --- | --- | --- |
| `pause` / `unpause` | owner | Stops approvals and payouts (a payout already scheduled too, since v3). The round clock keeps running; a closed round waits to settle. |
| `close_round` | owner | Ends the open round now without ending the campaign; the next one opens on its own. |
| `set_limits(max_per_day, approval_threshold, cooldown_ms, submit_grace_ms)` | owner | Rolling 24-hour cap (hourly buckets, checked at approval and at payout), owner approval above a round total, payee cooldown, late-submission grace. |
| `approve_round` | owner | A round above the threshold sits in phase 6 (`AWAITING_APPROVAL`) until this. |
| `revoke(campaign, index)` | agent | Takes an unpaid approval back (status 5, `REVOKED`), releasing its caps. Refused once the entry is settled or its round is over. |
| `open_payee(campaign, x_user_id, wallet)` / `set_payee(wallet)` | agent | Payee account (kind 3) at `PDA(program, agent, Nonce(blake3("merit-payee" ‖ campaign ‖ x_user_id)))`. A new or changed wallet starts the cooldown; `approve` takes the payee account and refuses until it has passed. |

**Late-submission grace.** A closed round still takes approvals for `min(submit_grace_ms, round/2)` (default 5
minutes) after it closes; settlement waits that long before it repays the agent or pays anyone. The next round starts
where the last one ended (back-dated at most one round), so every post belongs to exactly one round.

**Not compatible with v1 accounts.** Venus stores state as bincode, and v2 adds fields, so a v1 campaign no longer
decodes under v2. Live v1 campaigns were therefore ended and withdrawn before the upgrade, and replaced by new v2
campaigns. The web decoder reads both layouts.

## Program v3 (2026-10-28, audit fixes)

No state layout change and no existing instruction changed (the vectors are byte-identical), so live v2 campaigns
keep decoding and v3 was upgraded in place.

| Finding | Change |
| --- | --- |
| H-1: pre-funding a ledger address froze settlement | An account at the ledger address with no data that the program doesn't own (`merit_core::ledger_absent`) reads as "no approvals"; `open_ledger` and `open_payee` assign a pre-funded, empty, system-owned PDA to the program before Venus writes it (Venus's `create_account` fails on an address that holds kelvin). |
| M-1: no way out of a stuck `SETTLING` | `skip_stuck(ledger)` (owner): after `STUCK_MS` (10 min) with no settlement step succeeding, it skips the step that keeps failing (the agent's reimbursement, or the next payout, recorded `UNFUNDED`), or ends the round with nothing paid if its ledger can't be read, then re-arms settlement. `refund` also accepts a stuck `SETTLING`. A payout to an executable account is recorded `UNFUNDED` instead of failing. While settling, `last_beat_ms` is the time of the last step that succeeded. |
| M-2: a post could verify in two rounds after `close_round` | `approve` and `retry_verify` sync the ledger's round end to the campaign's (`synced_round_end`). |
| M-3: limits changed after a round closed | `set_limits` can't change `max_per_day` or `approval_threshold` while the campaign is `SETTLING`, `WAITING_FUNDS` or `AWAITING_APPROVAL` (`limits_change_allowed`); cooldown and grace still can. |
| L-7: pause didn't stop a scheduled payout | `settle_pay` pays nothing while paused (before the deadline); `settle_peek` waits. |

**Owner powers, stated plainly.** The owner can pause (payouts wait), end, withdraw escrow no open round reserves,
and set the daily cap and the round-approval threshold between rounds. A round above the threshold waits for
`approve_round`; if the owner never approves it, the deadline refund returns the escrow and the round's entries stay
unpaid (`TODO`) on chain. `skip_stuck` records the skipped payout as `UNFUNDED`.

**Still open:** a `refund` from `WAITING_FUNDS`, `AWAITING_APPROVAL` or a stuck `SETTLING` doesn't mark verified
entries `UNFUNDED` (it has no ledger account to read), so they stay `TODO`.

## Instruction tags (bincode u32 LE prefix, programs v2 and v3)

From `wit/merit-manifest.json`; every tag moved in v2; v3 only added `skip_stuck` (28).

| Instruction | Tag |
| --- | --- |
| set_payee / create_campaign / open_ledger / open_payee | 2 / 3 / 5 / 6 |
| fund / start / end / withdraw | 9 / 10 / 11 / 12 |
| fund_ops / withdraw_ops / refund / resume | 13 / 14 / 15 / 16 |
| set_agent / set_round_length | 17 / 18 |
| pause / unpause / close_round / set_limits / approve_round | 19 / 20 / 21 / 22 / 23 |
| **approve** / retry_verify / revoke | **24** / 25 / 26 |
| skip_stuck (v3) | 28 |
| callbacks: on_verify 0, run_verify 1, beat 4, settle_pay 7, settle_reimburse 8, settle_peek 27 | |

## Agent key

Until the `merit-payout-signer` latch exists, the agent is a separate DevNet key,
`merit-agent-devnet` = `8f4gqYbvcaxFyGo7x6zZWxBQU8ycxtppw54J9saw2iaz`, kept in the Rialo
keystore outside the repo. The on-chain caps are the wall. To swap in the Privy wallet:
`set_agent(<privy pubkey>)` (applies from the next round), re-encrypt the `merit-x` token
for that pubkey, and fund it for REX float.
