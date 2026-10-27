# Merit — DevNet evidence

All signatures are on Rialo DevNet (`https://devnet.rialo.io`). Program ids live in
`deployments/devnet.json`.

## Phase 1 — toolchain and Rialo primitives (2026-10-22)

### Environment

- macOS 26.2 on Apple Silicon. Native install, no VM or container: rialoman's installer
  and the `stable@0.18.1` manifest publish `darwin-arm64` builds, and the manifest pins
  `rust_toolchain: 0.0.3`, which `rialoman install stable@0.18.1` installs as `cargo +rialo`.
- The REX WASM components also need `rustup target add wasm32-wasip2` on the host stable
  toolchain.
- RPC: `https://devnet.rialo.io`, `https://devnet.rialo.io:4101` and the CLI preset
  `http://devnet.rialo.io:4100` all serve the same chain. None of them return CORS headers.
  `getSlot` is not available (`-32601`); `getBlockHeight` and `getEpochInfo` work.
- The node reports `api_version 0.23.0-alpha.0` while the client tooling is 0.18.1;
  everything below worked across that gap.

### Faucet

| Step | Signature |
| --- | --- |
| Airdrop 1 RLO → deployer | `5y94BocJSn5tbiALL3w36HMr1FtpGdMEjrSpVuQjc8x87U5mcW4SFZtUoc1swR92fHCSqKTjASFXJmZdXTVD8XTT` |
| Airdrop 1 RLO → deployer | `zHa3NqdFmf3Upf68EYBHyHkwWfVSuENH4FSU2Gd395DQBHY6BT9AJLLmyvHJXL6nSdQHK9jbxa5GXAa5prwoxQY` |
| Airdrop 1 RLO → deployer | `DWR4MwrR2vpnCLSshjmP3Ay7ePtp4P1neGy3WVCnV98PprRGAoEuSS9Kxwm5nQUW1BhW4nvH1fb12BTVUUYmHV5` |
| Airdrop 1 RLO → deployer | `2mBAneabhgXhKVW3skY7UokUaPJ3RhTYuX6cQJp3xYqzPf1ch285EtAQ54cBNps298L6kvaSKYpunXVV6mTq6A26` |
| Airdrop 1 RLO → deployer | `2de3uJFP1VrTJyC3DEFzdHuyS6YvwY5eyZZdqMGXqDdtrJBB8LELRA3rSoheEFEEJ8Xz2b7Bvbg67hEJ2wyLbFaH` |

The faucet caps each request at 1 RLO. A ~190 KB PolkaVM program plus an ~89 KB REX
bundle costs ~1.94 RLO in rent, so one deploy needs at least two faucet calls.

### Venus deploy (`rialo client program deploy-venus .`)

- v1 (commit `79c405b`): program `8BrXCijRFpdtfFLDVWgo6sNKeoLHTJ2WQEoMmr6kRGfJ`,
  REX components `di991aYCkYytunykifbyDMgP5gXPJtBheDfQrJ5CvSX`.
- v2 (commit `8e0d7e8`): program `GAqPJTBP3sTRh4LMbp7v711coKxMLKpBWwd84nM9A7H3`,
  REX components `49yaLnmMdFswFK1j8KXSjR3Nkm26KuqRHvwBppRMS1TP`.

### Reactive timer (`AFTER … CALL [tick]`), no keeper

| Step | Signature | Result |
| --- | --- | --- |
| v1 `create` | `4EyjpfVNGgn97YoEEMkd7x6ZkUpJfUw2YYcZqFurnTZiZxQ9Baepd3QZ3rekseJp2B8GkFpPMDnGZdQRTzGME6sP` | workflow PDA created |
| v1 `start_timer` (`AFTER 5 seconds`) | `5iXuajSkXrbpsRHHwvyr7bgp3u67WzkogQaSPq9GBqUdJ3BYSbK3oxRwf7YNmnrCFbZwwbetYY647oMKioJTE3wx` | timestamp subscription armed |
| v1 triggered `tick` | `2vyVq3PjKfrpPSKYZDSa3q1WmAukdkfs1UMKsypR52mTSc8fpHdRKB4Hq1YfvagGoyKBF9ogvH2Xb4p4sB1pSVtj` | fired in the **same block**: see finding 1 |
| v2 `create` | `2kj3PEzFAcMCEVUJ4cqD4K6Ti1LL3ojX1AgbpLjL1KKUV2g7qMV8N4hPVBa5zeWeiwr7BpsLTLw8hoGs1CjS6F47` | workflow PDA `EBiMKkUJ…` |
| v2 `start_timer(8000)` | `52BAER72pRhvBpnHn8QJKp2EiLwUGffnBrbfFjCoHJMoZ9uCnSaGMnSCynTwQ4RQeMouLEy4xUWZTvH7TAKtNNvV` | target `…876537` |
| v2 triggered `tick` | `GfxjvPRqJAnmKv1FSPFsznv74S9zBXBcGNPbjXtBwwugBbnPnZeff6KTzEWFSC1nH8HitVCcwdkvRKEScJWppLF` | ran at `…876484`, on time |
| v2 `start_timer(30000)` | `5AYA5pr1kPZZJdcTE4zLS8Gx3hhRQHWniBTTDNkygXfHUN9eg9UsHiNpmgqFkBSTnEMZXWDLYdCTTJGZRBUxokzL` | **never fired**: see finding 2 |

### REX `http::get` from validators (custom `rex { }` component)

`fetch_profile` fetches `https://api.github.com/users/octocat` from each validator and
returns `HP1|login|id|bytes`. The callback counts every raw update and accepts only a
non-empty, byte-identical, all-success report.

| request_delay_ms | Probe tx | Callback tx | Report | Invoke → callback |
| --- | --- | --- | --- | --- |
| 5000 | `EJtq2ihZHfZUvjmi8iviuLDL54m9BTjf52R4UEhkdEgYZdmxkxXhmNGaAZuskAoQNVVD8XX38Hw8qzvYCreqn11` | `3LEwTZCN4zXVpNAXxNDHqFoRciE25rqmdKEz9TRA18BrKuqQn55iEBJNyTVyVTwA94X5hocpFa25ZfeRxkYbNb6F` | 4/4 unanimous | ~1.0 s |
| 300 | `2PX25y1dfXhYq9SQGdos4Q3hq2V69SwrzSRw7FKUymaRCNXm87Vi3RP41dN6mtygRP812aLiMtjhCjQ3mDyVEMo7` | `5mL8NmvkLHrCHwHDi3LdrJBAqEBmFpALBf14RHXzvwh8g1Kf7pmfbCAJdTdPzKtDDTJChY8YfWeHpu5Ls74T3Fju` | 4/4 unanimous | 887 ms (6 blocks) |
| 1000 | `3W27jLqzwCggQ8Qu8N4VJspEMjPzih26bh6uSq1FM7D4WbJxJYN7e8QRDdvhNG447qKp4XmuF41P6V5mADeYFPrG` | `4Jsaq2Q53rTLRk71EbvnzxHQ3k1cTwd8gXY9nfPEdB5yKL85BUVSLWoLm154zF66PjtaPEPG4tHPXCJu9qJ8dxoh` | 4/4 unanimous | 592 ms (4 blocks) |
| 2000 | `5sUfAZAv4s1WNtskhBRLiaM2JAta8ezAAGxwyM4UNMsT352X3b2JkketJPnz3jMkNEvgJfkg7n8WKtttKGJfYYK5` | `4jcDZP4MTiN1W6gDiNx9PPe8Yb1jm3wRZzgSUMQ7brdm7EkXcbX6ZxdV7e7i226aGkvf7yeiccyELHscE3K4MXn7` | 4/4 unanimous | 592 ms (4 blocks) |
| 5000 | `2pGMtHtkLeShvY9F8dqKwwybmLuEFqodwyhgzEyoxAGKSvn1ZXXdg59fW4jVjVs6nsNJWSwFGRfZMW29r7Ute4D6` | `4mFB7u4WdqCEbV82K3BK6FjK83iXn7sLz5oKfzV3TpYuugg7zKJgF97AG86KZdEiaeqaFfS1ZdokX3PcMVUoKRPM` | 4/4 unanimous | 590 ms (4 blocks) |
| 10000 | `3yB1xhi3SxbQxxKw1i6eSaTRAZ8ALvwver8mADrkdh2ch9EggaJ2jMjx3bpyDrd9KQNBsQHnxGeLV4sehrA1nkAE` | `3bTyDeyuCxhy3jzza2WSCpA468m4mcqxcN5B9aFYWFPC1ip9NC2ThQjhHN1SVHqgw8aSeypVBofycSKs6V262ZNf` | 4/4 unanimous | 588 ms (4 blocks) |

Reproduce with `scripts/probe-rex-delay.sh`.

### REX confidential computing

`getSecretSharingPubkey` returns epoch-0 key
`c4b81ec7c336e2a26a56b9b6c8ad7eb8c9c5ba760fdfa53712739a37323d6d0d`, and
`rialo client encrypt-secret` produces an HPKE payload for it (tested with a dummy
value only). 0.18.1 supports encrypted values both as `Headers::insert_encrypted` on the
built-in `http_get` and as `EncryptedInput<T>` arguments to custom WASM components.

### Findings

1. **`AFTER n seconds` fires immediately on DevNet.** The 0.18.1 DSL adds `n` (seconds)
   to `Clock::unix_timestamp`, but DevNet's clock reports Unix **milliseconds**. Merit
   arms timers with an absolute millisecond target: `AFTER now_ms + delay_ms CALL [...]`.
2. **A timestamp subscription only lives ~100 commits.** DevNet runs ~6.8 blocks/s, so
   that is ~14.7 s. A 30 s timer expired unfired. Merit's round heartbeat must re-arm at
   well under 15 s and check `round_end` itself; it can never aim at the round end.
3. **REX latency did not depend on `request_delay_ms`** for a fast public endpoint: 300 ms
   through 10 s all gave unanimous 4/4 reports within ~0.6–0.9 s. The value behaves as an
   upper bound. The "no report at 5000 ms" reports from other builders were not reproduced
   against GitHub; this must be re-measured on the real path (REX → Latch → X) in Phase 2.
4. The 0.18.1 Venus parser rejects match-arm guards (`Some(x) if …`) and single-expression
   macro arms inside `rialo!`; use plain `if let` blocks.
5. Encrypted REX inputs are bound to a creator pubkey, and Venus creates REX requests
   with the workflow **payer** as creator. The Latch token ciphertext must be encrypted
   for the workflow payer that triggers verification.

## Phase 2 prep — on-chain cost of timers and REX (2026-10-22)

`merit-hello` was upgraded in place at commit `2e1db18` (same program id
`GAqPJTBP…A7H3`; the in-place upgrade cost ~0.06 RLO versus ~1.94 RLO for a fresh deploy)
to add `start_heartbeat(interval_ms, beats)`: a handler that re-arms itself, the same
shape Merit's round heartbeat will use.

### Heartbeat: 20 beats at a 3 s interval

| Item | Value |
| --- | --- |
| Start tx | `5jA8A3bF9yFaYMSV9RyiM4s6QjDkBUYh8UCzEqcgQsP4y78PQWB4kFk1EjVPsGvwSXj6esddWEFNkjN5p828m79x` |
| Last beat | `5t1GeVUnGs72nvjfBcNGZMKqMNeNukbfPwz13PeiKr7jBiUqwrtT3rmk7TwMYDo1uMz7PCRMtvTPbLxXHLMBCxtX` (`beat #21 remaining=0`) |
| Beats fired | 20 of 20, every ~2.95 s, no gaps |
| `meta.fee` per beat tx | **0 kelvin** |
| Payer balance before / after | 3,976,382,240 / 3,976,382,240 kelvin, **net 0** |
| Float held while armed | one subscription account, 4,892,880 kelvin (0.0049 RLO), refunded when it fires |

### REX verification

| Item | Value |
| --- | --- |
| Probe tx | `YGVh4Ctpw4ekrMskvh83FNzjr7mAjvXgPenGSCqjXA5qDd4vAS7uvUr8AAynKCXBWVTQo7SHNC47FHWtELV5yAc` |
| Payer balance before / after | 3,976,382,240 / 3,964,870,400 kelvin |
| Net cost | **11,511,840 kelvin = 0.0115 RLO per verification**, not refunded |

The REX request account alone keeps 2,303,760 kelvin (for example `G6rpbtxB…U6hT`). 0.18.1
has no close instruction for REX accounts (`rialo client rex` only offers
info/activate/deactivate/create), so this rent cannot be reclaimed today.

Findings:

6. A self re-arming heartbeat costs **0 RLO per tick and 0 RLO per hour** on DevNet today:
   fees are 0, and each subscription's rent is returned when it fires. The payer only
   needs ~0.005 RLO of float per armed timer. Mainnet fees are unknown, so Merit should
   still budget for them.
7. REX verification is the real on-chain cost: **0.0115 RLO each**, paid by the account
   that creates the REX request. That is about the size of a small payout.

## Phase 2 — Latch allow/deny proofs (2026-10-23)

The user created `merit-judge` (`lnk_f68b080362114d7c`) and `merit-x` (`lnk_73ba8d5cc46c4c72`)
in the Latch dashboard. Calls went to `https://onlatch.com/proxy/<upstream path>` with
`Authorization: Bearer <lat_ token>`; the provider keys were never in the request.

| Latch | Call | Result | Latch request id |
| --- | --- | --- | --- |
| merit-judge | `POST /v1/messages`, `claude-haiku-5-5`, `max_tokens 16` | **200**, reply `ok` (18 in / 4 out tokens, `msg_011CgJhEXoqF3GsfcVnQyecv`) | `req_5a217ad5-248` |
| merit-judge | same body with `claude-opus-5-5` | **403** `deniedBy: payload_4`, "Only claude-haiku-5-5 allowed"; never reached Anthropic | `req_515b8551-12c` |
| merit-x | `GET /2/tweets/20?tweet.fields=author_id,created_at` | **200**, `author_id 12`, `created_at 2006-03-21T20:50:14.000Z` | `req_fbe5a2e9-6ed` |
| merit-x | `POST /2/tweets` | **403** `deniedBy: method_0`, "Method POST not allowed"; never reached X | `req_cdb24911-d9e` |

Every response carries `x-latch-rex-signature`, a signature over the decision.
`/proxy/.well-known/latch-self/{capabilities,budget,audit}` returned 200 on both latches,
and the audit log lists exactly the four decisions above. Real spend: about $0.005 (one X
post read) plus a fraction of a cent of Haiku.

What the self endpoints show:

8. `merit-judge` budget: `maxDailyCents 100`, `model_based`, and `modelPricing` for
   `claude-haiku-5-5` of **`inputPer1k 0.1`, `outputPer1k 0.5`**, ten times the values in
   `LATCH_SETUP.md` (0.01 / 0.05). If the unit is cents per 1K tokens, Latch over-counts
   spend 10x, so the $1/day cap trips after about $0.10 of real Haiku use. That fails safe,
   but it starves the judge at roughly 300–400 judgements/day. One 22-token call
   rounded to `currentDailySpendCents 0`, so the unit is still not proven by measurement.
9. `merit-x` capabilities show **`costBudget: null`**: the flat `spend_limit` filter is
   missing. The fixed `rate_limit` of 400/day is the only ceiling (worst case about $2–4/day
   at X's prices).
10. `capabilities` reports one `rateLimit` per latch (the daily fixed one), so whether the
    per-minute rolling limit is also set can't be told from it. The response filter on
    `merit-x` is not shown either.
11. `merit-payout-signer` is blocked: this Latch account offers only the encrypted wizard,
    with no Privy signer secret. The user has asked Latch support. Phase 3 uses a separate
    DevNet agent key until then (see `docs/DECISIONS.md`).

## Phase 3 — program built, not deployed (2026-10-23)

12. **REX reports are bound to their entry.** `on_verify` accepts only the processor-owned report PDA that
    `run_verify` recorded for that entry (see `docs/PROGRAM.md`, "REX report binding").
13. **State is fixed-width.** Merit reserves its tables at creation, so an account never changes size,
    guarded by `programs/merit/tests/state_invariants.rs`.
14. Control functions run on branch 0, so two timers armed by control calls in the same
    block derive the same subscription PDA and the second transaction fails. Handler
    chains get fresh branches. The agent sends approvals one at a time and retries.

## Phase 3 — DevNet deploy and dry runs (2026-10-23)

Program `4qBwWYWn7ougS7sHP21x4yTDk4cwmyEqUiqNmKAYVuk6`, REX component
`SufLA3Vvm5x7ag2RSctyJhgceMQS1ht8rYAadjdvQvb`. First deployed from clean HEAD `9c7d285`
(2.967 RLO, 20 + 20 transactions, none failed). It was then upgraded in place three times,
each from a clean HEAD, at about 0.008 RLO each: `aad225c`, `edb272f`, `de0c31a`. All
signatures are in `deployments/devnet.json` under `merit`.

Keys (Rialo keystore, outside the repo):

| Role | Address |
| --- | --- |
| owner | `BkecjfP5fxz6s3xuAXHPPPxmoebUDkd9DsTeYBZokYwF` |
| agent | `8f4gqYbvcaxFyGo7x6zZWxBQU8ycxtppw54J9saw2iaz` |
| demo contributor | `GZCkutEHercaeY728xVqiPTNSgGgAercDAb9JTXXnePN` |

### Dry runs

| Run | What it proved | Key signatures |
| --- | --- | --- |
| dry1 | `start` with no escrow is rejected (`InvalidArgument`); the heartbeat beats on its own; `end` → the round closes at the next beat → settles | rejected start `2CFCkYsM…`, start `6Li2hChL…`, closed `3BFERrz3…`, settled `4NPrWCJC…` |
| dry2 | `open_ledger` from the CLI failed; Merit now resolves accounts by key | failed `62NaAcMc…` |
| dry3 | `approve` exceeded 200k compute units with both kinds' tables in state; a program upgrade killed an armed heartbeat, and `resume` revived it | over budget `2gvUhWE4…`, resume `2nLs4FGg…` |
| dry4 | REX ran, but validators failed to decode a raw-encrypted `String` | `on_verify` `98yM5zhL…` (3 validator errors) |
| dry5 | **Full path:** approve → timer → REX → Latch → X (token decrypted in the TEE) → unanimous report → `OutsideRound` for post 20 (author 12, 2006). Then end → reimbursement of 34,710,480 kelvin (12,000,000 REX + 22,710,480 ledger rent) → settled | approve `2BXiXhg4…` 08:05:09, verdict `GrNyvFLw…` 08:05:11, repaid `3qRww5Kw…` |

The `merit-x` audit shows the dry5 verification as **4 GETs of `/2/tweets/20`** at
08:05:10.86–08:05:11.13Z, one per validator. Approval to on-chain verdict took about 2 s.
Every dry campaign's escrow and budget was withdrawn back to the owner (10 withdrawals,
all `Success`).

### Findings

15. **The CLI cannot pass `bytes` arguments.** Its supported types are pubkey, ints, f64,
    string, bool, nonce and bytes32. `open_ledger` takes the ciphertext as a hex string.
16. **Accounts are resolved by key.** Merit looks every caller-named account up by key, never by position.
17. **A control instruction gets the default 200k compute units, and the CLI cannot raise
    it.** Each call (de)serializes the whole state: `fund_ops` used ~100k with 3 KB of state.
    Each workflow kind now sizes only its own tables, which brings a campaign to 634 bytes.
    Timer callbacks request the maximum, so they are unaffected.
18. **Encrypted REX inputs must be Borsh-encoded plaintext.** For `token: String` the
    plaintext is a u32 little-endian length followed by the bytes. A raw string fails in the
    component with "Failed to deserialize args: Unexpected length of input".
19. **After an in-place upgrade, run `resume`** on every live campaign, or upgrade only between rounds.

## Phase 3 — real round on DevNet (2026-10-23)

Campaign `G1JjiebaNvYQVBN4tscddqdKRZLfjJR2pgTVrBScx2TN`:
- Escrow 1 RLO, operations budget 0.2 RLO.
- Payout = 0.1 RLO × score/100, minimum score 50.
- Caps: 0.1 RLO per payout, 0.2 RLO per contributor per round, 0.5 RLO per round.
- Round length 10 minutes, at the user's request (`set_round_length` `59BNWyuK…`).

The contributor was the user's X account @KenilVekar1752 (id `1658044857343000579`,
looked up through `merit-x`), and payouts went to the demo contributor wallet
`GZCkutEH…`.

| Time (IST) | Step | Signature |
| --- | --- | --- |
| 14:09:26 | `start`: round 1 opens, heartbeat armed | `2GAxge7B1Ff1UET2cdL9fGxFZuJd3aj4suWa8LFGMeiqrFmJ9GYJhNxy39CeGmoQbHd2xLvNb2itgHdGHVYpeXHX` |
| 14:09:28 | agent `open_ledger` (ledger `BGd9T17T…`) | `ovEUjALw8pNiko9Li3zhWJj44a7EEU95YLtE1ftijF8eHJdA6JWDL2KQYKoTvchPfQ8kgmK4bzYSYJArXzd6KkL` |
| 14:09:56 | user posts [2113550979329368489](https://x.com/KenilVekar1752/status/2113550979329368489) | — |
| 14:10:09 | judge through `merit-x` and `merit-judge`: checks pass, Haiku scores **58** | — |
| 14:10:22 | agent `approve`, score 58 → 58,000,000 kelvin | `62KditLizq1tRcvVUAcAJJpb8rXUSAxH11485dP4v1TAtA4pC8AhJTGkFJwK9Fv1U39e5RbMiKor7NJJMJHpUM8u` |
| 14:10:22 | `run_verify`: REX request created | `5zzj1W5VxKBaMM5y3BY6zbWz3VSCku8KY8mmjK84kSFF2uprumdENMsuLwBs58sPb7jFRSvowb3enHiR8rt1aNdV` |
| 14:10:24 | `on_verify`: unanimous, **Verified** (author matches, created inside the round) | `2zqzmbrANZMSHWj32SCQTH5Q9SMhYCLQX5h5c8PWcayn78kxij9EkJ2sAZAS1NzHvQ63QefNTHLhQDvxZE6hZyAw` |
| ~14:19:30 | heartbeat closes round 1 after **123 beats** | `4fSsNobT3415XooFVtwmaAdFtCykqEDLxC9ahUKbCaAmVfNEHjBRWP9SWVNE3fJdTyshwFRDDMKD2mzdZjPzUFP5` |
| | agent repaid 34,710,480 kelvin from the operations budget | `4A4P2xkrPHcoTpZwB7PcgU42ixr8NTuvzT2nEdsKS8Ume3oHmUFnWC33BDb2nJdgMMyyoXucVygC3qx8ir8cbmUK` |
| | settlement plans entry 0 | `2mhVJXkKgzbJyjUEb5maijgRssKB75qd9i7afwUnBC4fLXMgs47xY1RG5Bh8ic2jQyfZjfDVXmuDDu3rocy18TRH` |
| | **paid 58,000,000 kelvin** to `GZCkutEH…` | `5zJRRMjkp4ENcVSsNra4QFP5tJtRP7KUF3iGnbTLNHXTkwABveG1omB3vmdvW67ohycrFLDz8psTHagkZmrre4PZ` |
| ~14:19:34 | round 1 settled; round 2 opened automatically | `33TJCfrfCdgNQ3c5hvHSffmQDANeq91FRrV6QdJTRHWZ7KR3vecu8QHidMAJcAWDcKsmDDFehoNmXHgUXjDwFPiF` |

The contributor wallet balance went from 0 to **0.058 RLO**. Nobody signed anything after
the approval: closing, repayment, payout and the next round were all native timers.

`merit-x` audit: one GET of the post by the judge (08:40:09Z), then **4 GETs by REX
validators** (08:40:23.77–08:40:24.00Z). Real cost of the round:
- about $0.005–0.025 of X reads (X deduplicates the same post within a UTC day);
- about $0.0003 of Haiku;
- one $0.01 user lookup.

### Closing the real campaign

| Step | Signature |
| --- | --- |
| owner `end` while round 2 is open | `2k1B5ZqxTfTSZcNftnGzu7HTHMvyxdrfz68Q6We7Em6zyk91CTpcpV1ue5eAXBQg8ra2GJVrTq27oyGwREhnh32x` |
| round 2 closed at the next beat (93 beats), no approvals | `2USQJ8prh8SaX4BfbMLwsiokGYvB37VYbYGLTKpjA6q7xGFFHCATiSAEuAteJBdZfkSUfjdJQESjqz8kM5u7tyZ9` |
| settled, phase ENDED | `4qq67itraHYgYpMDcQ2bjLZPvBd6sHryx4qHxxt94qPaZNoxNSdens3JLr3F9R9HEYVtZmxvJkCzx7bbZ6LUavaT` |
| withdraw 942,000,000 kelvin escrow | `2qLHpMqVjUoWXWQbFHD6uwvtjsMnh8LARxdZ2u7ZAdAWRD8mpvnneTT2t6ssh1Vmo9GBVZNmLXvrsRqoYCSmEECA` |
| withdraw 165,289,520 kelvin operations budget | `2PTnpVqqin1ogxtYinRkLTSD8WKuyDy8gcYXXMYGdA3wN9hTuRMs29HTgAD7M65Kn9W3xmtizE91zohz9Zy8ttws` |

Final books:
- **Escrow:** 1,000,000,000 funded = 58,000,000 paid + 942,000,000 withdrawn.
- **Operations budget:** 200,000,000 funded = 34,710,480 repaid to the agent + 165,289,520 withdrawn.
- The PDA keeps only its rent (5,303,520 kelvin).

## Phase 4 — web app, local against DevNet (2026-10-23)

See `docs/WEB.md`. Test results at commit time:
- **Unit tests:** 18 passed. The 14 TypeScript instruction builders match the Rust builders Venus generates byte for byte, and judge-record hashing reproduces round 1's on-chain hash.
- **Live tests** (`MERIT_LIVE=1`): 3 passed.
- **Playwright on real DevNet:** 6 passed.

Live agent-path test (`apps/web/test/agent.live.test.ts`), all signed from TypeScript:

| Step | Signature |
| --- | --- |
| campaign `5FAuKwU3izvGK4MELYNhkRE83XfTbCBkrGq9UwDa38ej` created, funded, started by the owner key | (in the campaign's history) |
| agent `open_ledger` with the `merit-x` token encrypted by `@rialo/ts-cdk` `encryptSecretBytes` (Borsh-framed) | `4xBUvm9cN8k5MtGfSBDoLWrXzESQJQuPRKku2b7kKTiJJSokroFwbTXNjbCcGrnAeFf3xaeVfojcra1mR1gQ9ycb` |
| agent `approve` (post 20, author 12) | `ajufx5TUygZ24igwVfcrY1Q1EaXfn8YPRkhBAWv7VrLds2T5sYq2fW3jwjLG3ohjx8E4f4GSTePB5rvjqcK4fFB` |
| `run_verify` | `cVZ56Ndqpya1m9QQJ67mYWa92GmQGCqkPEe5krYGc5pjhBkFkA5CjGQsZXzUPFNSHH5LBg2rpo5KAM5inDEcCXZ` |
| unanimous report, verdict `OutsideRound` (the token decrypted in the TEE worked) | `4aH26M9uGhD5Nw2Py9LQD2DV8wFqtkqCNLv3wxV8SZmpeuRpUMes76LQMLfvsf4dhJNfjfqdFqE7ddYvzkWZ2tKy` |
| agent repaid 34,710,480 kelvin at settlement | `4UVjsW6DgjL6RcwpY3NbbxYSDmpRhoEMwp9gcSWz82HxTLtJvPsdyeX4eTsK8pUph6zYtyLcv1ZGDiRXwYJ68at7` |

The browser e2e owner runs created, funded, opened, ended and withdrew campaigns
`79LWh6xfxXXApRy5QbXy5UkMZ2t9LAJbaTgyrzY8U9FF` and
`G4PnXBPJDwrT9qZzGTZnTfifBaxT9K2H7yv2g1JjcmYU`. Each owner wallet was fresh,
created in the browser and funded from the faucet through the relay.

20. **Encryption formats agree.** `@rialo/ts-cdk` `encryptSecretBytes` output works where the
    CLI's `encrypt-secret` did. The plaintext must still be Borsh-framed for a `String`
    parameter (finding 18).
21. **`getAccountsByOwner` makes discovery possible.** It returns every account a program
    owns, so the app lists campaigns straight from the chain and needs no registry. Only
    names and briefs live off chain, signed by the owner.

## Program v2 on DevNet (2026-10-26)

Program v2 adds state fields, so it can't decode v1 campaign accounts (see `docs/PROGRAM.md`). The live campaign
H2Tc was therefore ended and emptied first. The upgrade went in place at the same address, and a new v2 campaign
replaced H2Tc under the same program row and `/join` link. All times are UTC.

### 1. Retire H2Tc (v1)

These were sent with the v1 instruction tags (end 9, withdraw 10, withdraw_ops 12).

| Step | Signature |
| --- | --- |
| owner `end` during round 9 | `3Ub1ekm4xBi3DSCUccxZPLrmE5BGYGREKCirBfUduu7avsxrEwdD3NjVz3Av6w1BwHx1g9TREWC9vNtz35FdSaeL` |
| round 9 closed after 303 beats | `5pnTLqtCKGeZ4X2PgCtd2ieUEiT1oUo3LnYt2o4Qz1WEk6mKCXKv7nLNZP2FpzEARtnYK6Ch2zb5eWUvXJ6f1zAs` |
| round 9 settled (nothing owed), phase ENDED | `FMa8ifnGinA5XHfpwof8WVjb6LVxtEJGt2NbB46791xxmnM7Pg7v6Sdzk8KyNtNaChb8AMiJhryvmzNtwAFLCP1` |
| withdraw 937,000,000 kelvin escrow | `5N4bA58CWUiWoJRw5jGL8JVBV9ekx4EPFuTaK3qKRQH4UY7ezvj5ZJFGaNjRTnMtiYhUikg3otk7tfAHnJEUXXZ` |
| withdraw 165,289,520 kelvin operations budget | `3XWYufzwnEmhB1cL2okaYDowL2TzkTDvtvS84jD7cbxCF5acNdaNjjAD8BFMdsUTAt37KWS4AkmkTBX5jzqLRxAG` |

H2Tc's final books:
- **Escrow:** 1,000,000,000 funded = 63,000,000 paid + 937,000,000 withdrawn.
- **Operations budget:** 200,000,000 funded = 34,710,480 repaid to the agent + 165,289,520 withdrawn.
- The PDA keeps only its rent (5,303,520 kelvin).

### 2. Upgrade to v2 (commit `b2dfe7b`)

`rialo client program deploy-venus` ran in place: program `4qBwWYWn7ougS7sHP21x4yTDk4cwmyEqUiqNmKAYVuk6`, REX
components `SufLA3Vvm5x7ag2RSctyJhgceMQS1ht8rYAadjdvQvb`. It took 20 + 20 transactions, none failed, and cost
0.1226 RLO (deployer balance 2.97616288 → 2.85352072).

| Account | First signature | Last signature |
| --- | --- | --- |
| program | `4wKKG9DWKAcTgFLyaBeDttuEUZh3VqZof8KpDxDiKn3UZmXWaC12eFqzKrwX9tQuTNQ16HXoWCxfsUsaiABrFn7P` | `5nwNwreTsu4dBb8NCoVWL4eqRXzNKviPUG748SRN1YPKKXdbfV5Yc1prnceWxX3UzaGyuNDJp7CzzTCYHZ54rAia` |
| REX components | `5j6ccNb5JprbM9Bg7etBK8GMNDK3rZdLXi6CN9h4Figrr5qL66gncET2Lj6ahbcHFUyfEghnZ4ujrT9De37Gavjw` | `4gbpVMV1r38RsXjWaoesDWUd646uWan5xtFvYMNZVG8dBsZnYFgvwruui5bRzxMqzs5n2LDZpFgyRKadw4sejVrV` |

### 3. New v2 campaign "Rialo in your own words"

The campaign is `5LyXppXdVZHcV6bcWjJkTyir3F9PM5TEx6pTTA9jEiwv` (slug `31a79745…c72aac`). It has the same rate, caps,
30-minute rounds and refund deadline (2026-11-09T12:13:44Z) as H2Tc. Its v2 limits:
- 1 RLO per 24 hours;
- owner approval above 0.5 RLO per round;
- no cooldown;
- a 5-minute late grace.

Every step below was signed by `merit-owner-devnet` through the app's own instruction builders
(`apps/web/scripts/owner-send.ts`).

| Step | Signature |
| --- | --- |
| `create_campaign` | `4SC7N1oyUXw6ny3SgkvHJYBXy7u32NPHJe5ExZJcgZsELJ3jUmZZiwnrwCAyFi2fQrB7iXgWSPmFoA65dy5gCw4T` |
| `set_limits` (1e9 / 5e8 / 0 / 300,000 ms) | `5bvG7uGpnhNvzi8dVeQpQhUCBV4BER2Nt81DhNCwxXDhDs2hGxJwHCqNCQ4n7tB5E2fAiYNWkCQg66xH55rciRsN` |
| `fund` 1 RLO | `2hmVQbMTew7z1WAaMDiZsHVhybgffrFFgGau8hP518LGggSWrtSKJjVuxPsFe9DpLKVnxMXyNjQgUZhHA12dWQT5` |
| `fund_ops` 0.2 RLO | `46VVkCHq9vh7JvCHYwSKq3yFSKi8AAnoJ4JrBrNoa2heRT2zTrViYehH5jn5fkusPAF6ppjzHMGoBDztM52HmN7s` |
| `start`: round 1 until 1793034749412 | `2VBbUASX54hCTmcAYbU1wh5bTcoZ6amEBKP6v5jWANEjpAsq6L8A4pkjvFZWyzE2npSKC69VBqSBSokHUvoDV77p` |

The heartbeat runs with no keeper: 61 beats by 16:47. The web decoder reads the account as v2.

### 4–6. Database, tests, deploy

- **Neon:** the `programs` row `7059b65e…` was re-pointed from H2Tc to `5LyX…` at 16:42:51 (audit event
  `program.campaign_migrated`). Its members are unchanged: the owner and reviewers `85mG1x…hsd2` and `4UkC4X…poMC`.
- **e2e on v2:** `owner.spec` and `owner-app.spec` both pass against the upgraded program, creating real campaigns.
- **Vercel:** project `merit` deployed to production as `merit-gr2feaxig-kenils-projects-a3f732d1.vercel.app` (commit
  `b2dfe7b`), aliased to `merit-ruby-two.vercel.app`. The new campaign's signed name and brief were then published to
  the live store.
- **Live e2e:** `public.spec` on `https://merit-ruby-two.vercel.app` passed 6 of 6.
- **Downtime:** about 10 minutes. The deployed web (v1 tags) was out of step with the chain from the upgrade
  (~16:36) to the new production deployment (~16:46).

## Latch plus (2026-10-26)

Code `d8e1f06`..`71d4d6b`: metadata.user_id, X-Merit-Campaign/X-User on both latches with per-campaign Guardrails,
per-campaign child latches, the Cedar policy, merit-x custom_code with `/api/latch/tweet-check`, response-filter
handling, Guardrails probes and filter lists, README "How Merit uses Latch", `docs/LATCH_PLUS.md`.

- **Tests:** 197 unit (vitest) + 5 Rust policy tests (`latch/harness`); e2e 17/17 (two first-run failures were the
  DevNet faucet timing out and a test-order mirror; both pass on re-run).
- **Neon:** migrations 0002–0004 (`latch_calls`, `latch_intents`, `latch_snapshots`) applied before the deploy.
- **Vercel:** `merit` production `merit-hp8jpn5yh-kenils-projects-a3f732d1.vercel.app`, aliased to
  `merit-ruby-two.vercel.app`; `MERIT_CHECK_KEY` added (Sensitive). Live `public.spec` 7/7: Guardrails probes got
  Latch's real 403 for wrong model, too many tokens and POST to X; the check endpoint answers 401 without the key.
- **DevNet upgrade (REX header, `964ba6e`, built from `3ca76b8`):** in place, program `4qBw…`
  (100 transactions, first `5zfmEeu4wBAXN1qEdb3WSdZoE3Yo7ncUWzuUvJKsa2k3sbi6aqx8i7D2S8yaUwpojZ7pgM5C81nK9MD5fQ3TtMtN`, last `3v1DGPdJ71ztFHu4ZqHVnsvTiRqteQtXu9YKAN3wWrREZKnxTSMqmDwTZhZkRBJ1TjHphY8z7EinsSwxVQUVeAf6`),
  REX components `SufL…` (27 transactions, last `2PFzk8ptngbebwf3t4GY7poBpaChkWag5wjpBtXxTb2WfPhrZmy65estZUJ8we2BZk7dS8Twg9rvRDdrkf1pB4YT`). Done between rounds 3
  and 4 of `5LyX…` with no ledger open. The heartbeat stopped at beat 4; `resume`
  `2Xi7D8ATJDA9GKg4dHfnxNLgnDYQMXuzrFSkmtAKaQz4nJ5PQ14mpg6qRbZnjVCinieWwN398JtgcpZofFf5AukJ` restarted it (beat 11
  30 s later). The deployed REX bytecode contains `X-Merit-Campaign` and `Merit-REX/0.2`. Cost was not measured
  (the deployer balance wasn't read before the upgrade).

## Latch plus, dashboard part A (2026-10-27)

The owner made these changes in the Latch dashboard (`docs/LATCH_PLUS.md` A1–A7).

**merit-judge: 12 filters, live.** The owner added these five:

| Filter | Rule |
| --- | --- |
| `response_7` | withholds 4xx/5xx and replies over 16 KB |
| `payload_8` | `$.metadata.user_id` exists |
| `rate_limit_9` | 20 a day, fixed, keyed by `$.metadata.user_id` |
| `header_requirement_10` | `X-Merit-Campaign` must match the campaign/owner regex |
| `cedar_11` | POST `/v1/messages` with a body; `forbid` anonymous |

- **Real use (owner):** a real submission was judged normally after the change.
- **Guardrails (owner):** "Missing campaign header" answered `403 · deniedBy header_requirement_10`.
- **Re-checked with Latch's dry run (`/latch-self/authorize`):**
  - A call with no header is `deny · header_requirement_10 · Missing required header: X-Merit-Campaign`. Its trace
    is `rate_limit_0 › endpoint_1 › method_2 › body_size_3 › payload_4 › rate_limit_5 › spend_limit_6 (skip) ›
    response_7 (skip) › payload_8 › rate_limit_9 › header_requirement_10`.
  - A call with no `user_id` is `deny · payload_8 · metadata.user_id is required`.

**merit-check: created, unused.**
- It has secret `merit-check-key`. Its pipeline is GET only, allowlist `/api/latch/tweet-check/*`, 120 a minute,
  and a response filter (500–504, 1 KB).
- Its token is kept locally as `MERIT_CHECK_LAT` and is deliberately not on Vercel.
- It's ready for when Latch exposes outcalls to Rust custom_code.

**merit-x: Rust custom_code, "Custom policy".**
- Outcalls aren't available to Rust custom_code on this account yet, so the outcall version
  (`latch/merit-x-submissions-outcall.rs`) waits for them.
- The live policy allows GET `/2/tweets/<numeric id>` only (`latch/merit-x-submissions.rs`).
- A real `GET /2/tweets/search` through merit-x answered
  `403 · deniedBy "Rust policy (on_request)" · post lookups by numeric id only` (request `req_8e804c4a-731`). It never
  reached X.

### A8: the extended latch `merit-judge-rialo-own-words` (2026-10-27)

- `whoami`: `lnk_cf50117ef37c4ad3`, parent `lnk_f68b080362114d7c` (merit-judge), chain depth 1, enabled.
- Its own filters are `header_requirement_0` (`^5LyX…jEiwv$`), `rate_limit_1` (100 a day, fixed) and `spend_limit_2`
  (25¢ a day).
- **Inheritance is enforced on real calls.** A real `GET /v1/models` through the child answered
  `403 · deniedBy endpoint_1 · Path /v1/models not in allowlist`. That is the parent's filter, request
  `req_64895f30-114`; nothing reached Anthropic.
- **Deploy:** `MERIT_JUDGE_LAT__5LyX…` was added to the `merit` project (Sensitive). Commits `80851a2` and `c8aa581`
  were deployed as `merit-5jlkft0rq-kenils-projects-a3f732d1.vercel.app`, aliased to `merit-ruby-two.vercel.app`.
  Live `public.spec` passed 7/7: the Campaign latches card shows `merit-judge-rialo-own-words` Live at chain depth 1,
  and all five probes got Latch's real 403.

## First live verification and payout on the upgraded program (2026-10-27)

Post `2114974451507089659` by `@KenilVekar1752` was submitted to "Rialo in your own words" (`5LyX…`), round 29.

| Step | When (UTC) | Evidence |
| --- | --- | --- |
| Judged through the child latch `merit-judge-rialo-own-words` | 06:56:55 | `latch_calls`: via child, 200, `req_8be6e48c-c54`, 2,736 in / 538 out tokens |
| Agent escalated it: score 63, confidence 0.6 (R7_LOW_CONFIDENCE) | 06:56:55 | decision `ePvU7Rh2…` |
| Owner approved (0.063 RLO) | 07:00:26 | decision `4cRkGqT8…`, approve tx `461vmdeR42KBZBsBDS6FDajYwmMDJLVMzh8ADnP2cq9hQWutPZNvCxkWfh9U58fRwgtWdqgqWNJG5QttGhquMaCD` |
| Four validators read the post through merit-x (allowed by the Rust policy) | 07:00:27 | merit-x audit: 4 × `GET /2/tweets/2114974451507089659` allow |
| REX verified on the first attempt | 07:00:27 | ledger `CvV1yUT4dNjp8oMqgRYoWWBPN3MX58Ucf61dPU9rNJ4c` entry 0, status 2; report `8AxiHQa4JLh7fjQTM189KFaqJGp1XNsmgLPeFqBmHX54` (owner `Qrac1eProcessor…`) = `MX1|2114974451507089659|1658044857343000579|2026-10-27T06:56:18.000Z` |
| Agent repaid from the ops budget | 07:17:32 | `2Jm5dneH5DRorgGrPqoTErbnJZMbzfZrcjgtcdtSJJ3Mgqqyt8P8BYtmnXvzxmuGoohvFxmf1JyMUkZXfq8VbB67`: 35,392,560 kelvin (REX + ledger rent); 164,607,440 kelvin of budget left |
| Paid by the program's own timer | 07:17:32 | `DasVS8DH1d9gdfywibgBTx2vAhnqJeS4roFDB1FatkyekV3KGYddDdmgiuepWEjazwZG8hdJfAtCTjKo15HMtUP`: 63,000,000 kelvin to `4UkC4Xt2suVBgXSorLSVvhx4qZDvo3Qua6GgtpVJpoMC`; wallet balance 63,000,000 |
| Round 29 settled, round 30 opened | 07:17:33 | `5iHhTrCQ2vzVSokEmp2AQoPNw7LGvRgi4Y7itgdnwpnG1Jm2JMUNydKMu1rbUtcYy9rPSghk5zTdUafdnSgT6wbm`; escrow 1.000 → 0.937 RLO |

Findings from the same morning:
- **The per-contributor rate limit didn't work as configured** and was later removed (see below).
- **Vercel blocked the `merit` Blob store** around 07:20. Every private read answered 403 "Your store is blocked",
  while list still worked. `/` and `/c/…` returned 500 until reads were made to fail soft.
- **Deploys (2026-10-27):**
  - `merit-2o407jg5e`: the three fixes (`5473a1d`).
  - `merit-2ei94zvy1`: the Blob fail-soft hotfix (`10b3ff9`).
  - Both aliased to `merit-ruby-two.vercel.app`. After the hotfix, `/`, `/explore`, `/c/G1Jj…`, `/p/…`, `/join/…` and
    `/guardrails` answer 200, and live `public.spec` passes 7/7.

## Blob → Neon (2026-10-27)

The Vercel Blob store `merit-store` was blocked at the Hobby limit of 2,000 "advanced operations" per month. Access
resumes 2026-11-26; the store was kept, not deleted.

**What used the operations:** `store.campaigns()` called Blob `list` (an advanced operation) on every render of
`/explore`, `/join`, `/api/owner` and `/api/campaigns`, which are all dynamic. Live e2e runs and visits each paid one
or more. Each approval's judge record was also a `put`.

**What changed:**
- The store's records now live in Neon (`store_records`, migration 0005).
- `lib/server/store.ts` reads with one query, plus the committed seed data as a fallback. There is no Blob import in
  runtime code; `@vercel/blob` is a devDependency used only by the migration script.

**Migration run** (`scripts/migrate-blob-to-neon.mjs --apply`):
- Blob list worked, but every read was refused (403).
- Imported from the committed seed:
  - campaign `G1Jj…`;
  - judge record `2113550979329368489`.
- Rebuilt from Neon:
  - campaign `5LyX…`, from its program row;
  - judge records `2114974451507089659` (5LyX, round 29, hash `4cRkGqT8…`, matching ledger entry 0);
  - judge record `2114722616099713061` (H2Tc, round 5, hash `3vdEuu7T…`; the campaign comes from the signed record,
    because the program row now points to 5LyX).
- Still only in Blob until it unblocks: the records for retired campaigns `GKci…` and `H2Tc…`, and any legacy
  `/join` wallet links. Re-run the script after 2026-11-26 to import them.
- **Deploy:** `afde9e3` as `merit-itg5dgtel-kenils-projects-a3f732d1.vercel.app`, aliased to `merit-ruby-two.vercel.app`.
  - Every public page answers 200, and `/api/campaigns` serves both campaign names from Neon.
  - Live `public.spec` passes 7/7.
  - No Blob errors or warnings in the production logs.
  - e2e passes 17/17 (the round-1 page spec passes when run alone, as before).
- **Per-contributor cap removed:** the owner deleted it. A dry run shows merit-judge with 11 filters, `rate_limit_0` …
  `cedar_11`. The cached Guardrails pipeline snapshots were cleared so the page reads it fresh.

## Final Latch setup (2026-10-27)

- **merit-judge (11 filters):**
  - `rate_limit_0` 20 a minute;
  - `endpoint_1` `/v1/messages`;
  - `method_2` POST;
  - `body_size_3` 64 KB;
  - `payload_4` Haiku, `max_tokens` ≤ 2048, no tools;
  - `rate_limit_5` 500 a day;
  - `spend_limit_6` $1 a day;
  - `response_7` withholds 4xx/5xx and replies over 16 KB;
  - `payload_8` `metadata.user_id` required;
  - `header_requirement_10` the campaign header;
  - `cedar_11`.

  A dry run lists all 11 and allows Merit's request.
- **merit-x (7 filters):**
  - `method_0`, `endpoint_1`, `rate_limit_2` (30 a minute), `rate_limit_3` (400 a day), `response_4`;
  - "Custom policy" (Rust: GET `/2/tweets/<numeric id>` only);
  - `header_requirement_6` (Part B, a campaign address).

  Checked:
  - a dry run with no header is denied by `header_requirement_6`;
  - a dry run with `5LyX…` is allowed;
  - a dry run with an `owner-…` tag is denied (pattern);
  - a real read with no header is `403 · header_requirement_6` (`req_64b79d4c-d0e`) and reached no X call.

  Validator reads with the header are proven when the next approved post reaches REX verified.
- **merit-judge-rialo-own-words:** child of merit-judge, kept with its original token.
- **merit-check:** created and unused, ready for when Latch exposes outcalls.

### Part B proven: REX validators pass merit-x's header requirement (2026-10-27)

- **Post:** `2115000077697929331` (`@KenilVekar1752`, "Rialo in your own words", round 32).
- **Merit's own read** at 08:38:49 was allowed.
- **Approved** by the owner at 08:40 (approve tx `bs5ig96mXw…`).
- **Validator reads:** four REX reads at 08:40:23.490–.780, all allowed, with `header_requirement_6` in place.
- **On chain:** ledger `Bo7VYgYPHof1Sots7FULWKJAJ6uyFHcrpDKoCE6yVRWr`, entry 0, status Verified, first attempt, score 60
  (0.06 RLO), report `7w3qn5kdA2BdrZfjU2mnAJWdojDEoxbGBgHL4unuxfkK`.

## Negative tests of the Merit program on DevNet (2026-10-27)

These tests send invalid instructions to Merit's own program, which must reject them on chain.
- **Targets:** two fresh test campaigns only, never a live campaign.
  - Test campaign A: `B8Z2YehXyyLeqQeM6mEbTpMVjGTrrRrhjr371eG6DaSn`.
  - Test campaign B: `5mRrC8meQRsNkxiSZPN6qgCMAYjbb1wgm5UaD44esFU`, created but never started; used only in the account-position case.
- **Keys:**
  - owner: `merit-contributor-demo`;
  - agent: `merit-agent-devnet`;
  - a throwaway "stranger" key funded from the faucet.
- **Method:** each instruction was sent without preflight, so every rejection is a confirmed on-chain transaction
  that carries Merit's own log line.
- **Script and results:** `apps/web/scripts/negative-devnet.ts`. Full signatures for all 45 steps (setup included)
  are in `deployments/devnet-negative.json`.
- **Fake data:** posts use ids no X post has (`10000000000000000NN`). Their REX checks fail verification, so nothing
  in this test is ever paid.

**Result: every invalid instruction was rejected.**

| Case | Result | Merit's log / error | Signature |
| --- | --- | --- | --- |
| create_campaign rejects an agent equal to the owner | rejected | Merit rejected campaign: agent must be a separate key | `3cTCgPVdzPc2tXR2…` |
| create_campaign rejects caps out of order (payout cap above round cap) | rejected | Merit rejected campaign config: CapOrder | `4ZHHtjbEBovMiGc5…` |
| create_campaign rejects a rate above the per-payout cap | rejected | Merit rejected campaign config: CapOrder | `5KNXY91wHFKfw2dq…` |
| create_campaign rejects a zero rate | rejected | Merit rejected campaign config: ZeroRate | `5f14M19B3z3rrC9a…` |
| open_ledger rejected before the round opens | rejected | Merit rejected ledger: not the agent of an open round 1 | `3QdZ2ziReBpChWUy…` |
| stranger: withdraw from A | rejected | Merit rejected instruction: not the campaign owner | `4AzQshf7TfPwj89y…` |
| stranger: set_agent on A to itself | rejected | Merit rejected instruction: not the campaign owner | `2Tm34gngpP3bx7LQ…` |
| stranger: end A | rejected | Merit rejected instruction: not the campaign owner | `2Ygz9Genaj2gug4P…` |
| stranger: withdraw_ops from A | rejected | Merit rejected instruction: not the campaign owner | `8EERafzGCNyup3HV…` |
| owner: withdraw more than the unreserved escrow | rejected | Merit rejected withdraw: 1000000000 requested, 50000000 unreserved | `42hnAResop7FjTx4…` |
| stranger: open a ledger for A (not A's agent) | rejected | Merit rejected ledger: not the agent of an open round 1 | `3H8zSFB5hgzrmXaf…` |
| agent: open a ledger with a slug that isn't ledger_seed(campaign, round) | rejected | Merit rejected ledger: slug is not ledger_seed(campaign, round) | `4zH3drw7vzDvwhJx…` |
| approve: score 101 (above 100) | rejected | Merit rejected approval of post 1000000000000000001: ScoreRange | `54mDN7xLtAJxKYgT…` |
| approve: score 40, below the campaign minimum 50 | rejected | Merit rejected approval of post 1000000000000000001: ScoreBelowMinimum | `2x71yQ4v6Lrbx5JQ…` |
| approve: x_user_id 0 | rejected | Merit rejected approval of post 1000000000000000001: ZeroId | `56UhTZLNsX8xeT7k…` |
| stranger: approve on A's ledger (not the ledger agent) | rejected | Merit rejected instruction: not the ledger agent | `37YeHP6bJhEYpUpm…` |
| approve: alice again, 0.05 + 0.05 over her 0.08 RLO per-contributor cap | rejected | Merit rejected approval of post 1000000000000000005: ContributorCap | `2RJXFTf17Z6AeUZk…` |
| on_verify for entry 1 called directly with entry 0's real REX report | not conclusive (see below) |  | `4yKznKPmdNDoYDQB…` |
| approve naming campaign A in its data but passing campaign B's account | rejected | {"InstructionError":[0,"NotEnoughAccountKeys"]} | `5PJAFNL67xykpmFs…` |
| approve: the same post again (duplicate) | rejected | Merit rejected approval of post 1000000000000000001: DuplicatePost | `52xvnMzhRG8WKDyf…` |
| approve: alice's X account with a different wallet (identity mismatch) | rejected | Merit rejected approval of post 1000000000000000004: IdentityMismatch | `2QeZd8GS5cVA3fYo…` |
| approve: carol 0.025 RLO, over the 0.1 RLO round cap (0.1 already approved) | rejected | Merit rejected approval of post 1000000000000000006: RoundCap | `4YdKkL2GDjN9ddES…` |
| stranger: revoke entry 0 | rejected | Merit rejected instruction: not the ledger agent | `4aA4CyZ3C6n3RyvK…` |
| agent: revoke an entry that doesn't exist (index 9) | rejected | Merit rejected revoke of entry 9: already settled or not this round | `2CYenWFCnjonwFco…` |
| agent: revoke entry 0 again | rejected | {"InstructionError":[0,"InvalidArgument"]} | `3wdrs1eUaV4D7TqE…` |
| approve with a cooldown but no payee registration | rejected | {"InstructionError":[0,"InvalidAccountData"]} | `56Scc3M9fTNzngzr…` |
| approve inside the payee's 1-hour cooldown | rejected | Merit rejected approval: wallet registered at 1793090852882, cooldown 3600000 ms | `gBtDKjJ7qLFR2JA5…` |
| stranger: open a payee for A (not A's agent) | rejected | {"InstructionError":[0,"InvalidArgument"]} | `31yvGwqiHXhzbosy…` |
| approve while the campaign is paused | rejected | Merit rejected approval: round 1 is closed or the campaign is paused | `21h91KgDm8re7ipF…` |
| on_verify for entry 2 called directly with another entry's real REX report (7HTgYemAmku4G74qY3u9uV7TRhMxRt4efaHYV7skJEFh) | rejected | Merit rejected report: not this entry's REX report account | `5VjnEgakhyyPkirT…` |
| on_verify for pending entry 2, handed entry 0's real REX report (timed retry) | rejected | Merit rejected report: not this entry's REX report account (InvalidAccountData) | `5VjnEgakhyyPkirT…` |

Notes:
- **REX report binding and account resolution are proven on chain.**
  - *Report binding:* the first attempt came too late (entry 1 had already finished its own REX check, and
    `on_verify` ignores entries that are no longer pending). The timed retry sent `on_verify` for pending entry 2 with
    another entry's report (approve `3bXV6887…`, same second), and Merit rejected it. Entry 2 then completed through
    its own report `7zxztBXX…`.
  - *Account resolution:* the data named campaign A but the account slot held campaign B. It failed with
    `NotEnoughAccountKeys`, because Merit resolves caller-named accounts by key.
  - The `state_invariants` source tests guard both at build time.
- **The per-payout cap can't be exceeded at approval time.** `create_campaign` already requires
  rate ≤ payout cap ≤ contributor cap ≤ round cap. A score of 100 must fit one payout, so that cap is tested at
  creation ("rate above the per-payout cap" → `CapOrder`).
- **Some rejections come from the runtime's account checks** (`InvalidArgument` / `InvalidAccountData`) before Merit
  logs anything: a second revoke of the same entry, an approval naming a payee account that doesn't exist, and a
  stranger's `open_payee`. They are still rejected.
- **Cleanup:** campaign A was ended (`5NeYdKAb…`). Its escrow and operations budget go back to the test owner once
  it settles.
- **Cleanup done:** A settled and ended with nothing paid (every entry was revoked or failed verification). Its
  escrow went back to the test owner (`5X1Xo2uDR4dVXLN4yP6TgjXZ9ZdkECturMHueux92Xwh1KEGWBiKRkXinXk2QcEp9VPBVFdJc9ZbizBdiMqztRMU`,
  0.15 RLO), and so did its operations budget (`4eKTYDJh3GDUC8b6Xz7eo5AikkpNiXccHtGDtS6TBHZa4UjJycZhnCykVaYXXfMZ9JLcRE6aRT8ukvSsiQ6TfrYq`,
  0.0406 RLO). The other 0.0594 RLO had repaid the agent for three REX checks and the ledger rent.
- **Round 32 paid:** the program's settlement timer paid 0.06 RLO for post `2115000077697929331`
  (`24MkbwAh…`, found in ledger `Bo7V…`'s own transactions).
