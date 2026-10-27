# Merit — design decisions

## 2026-10-22: settlement cost model (approved)

Measured on DevNet (see `docs/EVIDENCE.md`): a heartbeat tick costs 0 RLO, and a REX
verification costs 0.0115 RLO that is never refunded. Approved options:

- **A. Heartbeat only while a round is open.** About a 5 s interval (the timer window is
  ~100 commits, ~14.7 s). It stops between rounds and at campaign end or refund.
- **B. Owner-configurable round length.** Demo default 5 minutes; real campaigns can run
  up to 7 days. Long rounds still beat every ~5 s, because a timer cannot be armed
  further out than ~15 s.
- **C. Operations budget inside each campaign**, separate from the payout escrow. It
  pays back whoever starts each REX verification, and verification stops when the
  budget is empty. It never touches the payout escrow or the deployer. The owner
  dashboard shows the budget balance and how many verifications are left, and warns
  when it is low.
- **D. REX only after the AI approves.** Rejected submissions never trigger REX. The
  owner's "retry verification" also draws on the operations budget.

## 2026-10-23: Phase 3 program design

- **The signer latch is blocked.** The Latch account offers only the encrypted wizard, with
  no Privy signer secret, and the user has asked Latch support. Until it is available the
  agent authority is a separate DevNet key, `merit-agent-devnet`
  (`8f4gqYbvcaxFyGo7x6zZWxBQU8ycxtppw54J9saw2iaz`), stored in the Rialo keystore outside
  the repo. The on-chain caps are the wall. The agent is a plain pubkey in campaign
  state, so `set_agent` swaps in the Privy wallet from the next round with no redeploy.
- **Two workflows.** Venus binds a workflow to its payer, so the agent cannot write into
  the owner's campaign. Approvals go into a per-round ledger workflow the agent creates;
  the campaign's heartbeat reads it at an address it derives itself.
- **Who starts the REX check:** the agent. Its `approve` arms a timer in its own ledger,
  and that handler creates the REX request, so the agent pays (0.0115 RLO) and the
  encrypted `merit-x` token is bound to the agent's key. The agent can't steer the
  request: inputs come only from the ledger entry and the REX component is pinned. It
  can't forge the result: the callback accepts only the processor-owned report PDA
  recorded for that entry, and the campaign pays only verified entries. A misbehaving
  agent can do no more than approve within the caps and spend the operations budget.
- **Option C implemented as a campaign operations budget** (`fund_ops`), separate from the
  payout escrow. Settlement repays the agent 12,000,000 kelvin per REX attempt plus the
  ledger rent. Approvals and retries stop when the budget can't cover one more
  verification. `withdraw_ops` works only between rounds, and the deadline refund returns
  it.
- **Retry verification** is a ledger instruction, so the agent signs it. The owner
  dashboard will ask the agent service to send it. At most 2 attempts per approval.
- **Post window = the round.** A post must be created inside the round it is approved in.
  This makes paying one post in two rounds impossible on chain.
