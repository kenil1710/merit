# Latch setup for Merit (dashboard, click by click)

> Part two (campaign header, per-contributor cap, Cedar, response filter, custom_code, `merit-check`, extended
> latches) is in `docs/LATCH_PLUS.md`.

Merit uses three latches. You create them in the Latch dashboard, because Latch has
no public management API and this account has no personal access token. Only create
`merit-*` secrets and latches. Leave every other secret and latch (for example
`gemini-agent`) alone.

This guide follows the Latch docs as of 2026-10-22 (Secrets, Latches, Filter reference,
Transaction signing). If a dashboard label differs slightly, use the JSON for each
filter: it is the exact filter schema from the Filter reference.

**Order:** create the three secrets first (step 1), then the three latches (steps 2–4).
Each `lat_…` token is shown **only once**, so copy it right away into `~/merit/.env`:

```
MERIT_JUDGE_LAT=lat_...
MERIT_X_LAT=lat_...
MERIT_SIGNER_LAT=lat_...
```

---

## 1. Secrets (Secrets → New secret → "Bind a credential")

| # | Name | Type | Credential (from `~/merit/.env`) | Inject as |
| --- | --- | --- | --- | --- |
| 1 | `merit-anthropic` | `api_key` | value of `ANTHROPIC_API_KEY` | `custom_header`, key `x-api-key` |
| 2 | `merit-x-bearer` | `bearer_token` | value of `X_BEARER_TOKEN` | `bearer` |
| 3 | `merit-privy-signer` | **Privy signer** (New secret → Privy signer) | App ID = `PRIVY_APP_ID`, App Secret = `PRIVY_APP_SECRET` | (none, signer secret) |

Notes:

- Anthropic expects its key in the `x-api-key` header, not `Authorization: Bearer`. If
  the judge latch later returns Anthropic's own `401`, the injection mode is the cause.
- **Privy signer:** when you save it, Latch enrolls the secret. It creates a P-256
  authorization key and one Privy server wallet per chain type in **your Privy app**,
  then shows two addresses: a `0x…` EVM address and a base58 **Rialo** address.
  **Send me the Rialo address** (it is public). That wallet becomes Merit's on-chain
  agent authority, and I will fund it from the DevNet faucet. Merit never uses the EVM
  wallet.

---

## 2. Latch `merit-judge` (Anthropic)

Latches → New latch → **Manual** pipeline.

| Field | Value |
| --- | --- |
| Name | `merit-judge` |
| Secret | `merit-anthropic` |
| Upstream | `https://api.anthropic.com` |
| Venue | Standard proxy (TEE not required) |
| Expiry | 2027-01-31 (optional, recommended) |
| Body logging | **Off** (prompts contain contributor posts) |

Pipeline, in this order:

1. **endpoint**: only the Messages API.
   ```json
   { "type": "endpoint", "name": "Messages only", "mode": "allowlist", "patterns": ["/v1/messages"] }
   ```
2. **method**
   ```json
   { "type": "method", "name": "POST only", "allowed": ["POST"] }
   ```
3. **body_size**: a judging prompt is a rubric plus at most 10 posts.
   ```json
   { "type": "body_size", "name": "Max 64KB", "maxBytes": 65536 }
   ```
4. **payload**: one small model, bounded output, no tools.
   ```json
   { "type": "payload", "name": "Small model, bounded output", "rules": [
     { "path": "model", "operator": "in", "value": ["claude-haiku-5-5"],
       "reason": "merit-judge may only use claude-haiku-5-5." },
     { "path": "max_tokens", "operator": "exists",
       "reason": "max_tokens is required." },
     { "path": "max_tokens", "operator": "less_than_or_equal", "value": 2048,
       "reason": "max_tokens must be <= 2048." },
     { "path": "tools", "operator": "not_exists",
       "reason": "The judge does not use tools." }
   ]}
   ```
5. **rate_limit**: bursts.
   ```json
   { "type": "rate_limit", "name": "20 per minute", "maxRequests": 20, "windowSeconds": 60, "keyBy": "latch" }
   ```
6. **rate_limit**: daily count, durable.
   ```json
   { "type": "rate_limit", "name": "500 per day", "maxRequests": 500, "windowSeconds": 86400, "keyBy": "latch", "counting": "fixed" }
   ```
7. **spend_limit**: $1.00 per day, model-based pricing.
   ```json
   { "type": "spend_limit", "name": "$1 a day", "maxDailyCents": 100, "pricing": "model_based",
     "modelPricing": { "claude-haiku-5-5": { "inputPer1k": 0.01, "outputPer1k": 0.05 } } }
   ```
   `modelPricing` is in **cents per 1,000 tokens**: Haiku 5.5 costs $0.10 / $0.50 per
   million tokens, which is 0.01¢ / 0.05¢ per 1K. In Phase 2 I will check the unit
   against `/proxy/.well-known/latch-self/budget` after one real call.

**Why these numbers.** Each judgment sends about 3K input tokens (rubric plus up to 10
posts) and at most 2,048 output tokens, thinking included. Worst case that is
3K × $0.10/M + 2,048 × $0.50/M ≈ **$0.0013 per judgment**; a typical one is about
$0.0006. The $1/day cap covers about 750 worst-case judgments a day, far more than a
demo needs, and a runaway loop can never cost more than $1 a day. The fixed 500/day
count is a second, model-independent bound.

---

## 3. Latch `merit-x` (X API, called by REX validators)

| Field | Value |
| --- | --- |
| Name | `merit-x` |
| Secret | `merit-x-bearer` |
| Upstream | `https://api.x.com` |
| Venue | Standard proxy. Rialo protects the token, not Latch: Merit encrypts the `lat_` token to the Rialo TEE key, and validators decrypt it only inside the enclave. |
| Expiry | 2027-01-31 (optional, recommended) |
| Body logging | Off |

Pipeline, in this order:

1. **method**
   ```json
   { "type": "method", "name": "GET only", "allowed": ["GET"] }
   ```
2. **endpoint**: post and user lookup only. `*` matches exactly one path segment, so
   search, timelines, likes and every write path are all excluded.
   ```json
   { "type": "endpoint", "name": "Post and user lookup only", "mode": "allowlist",
     "patterns": ["/2/tweets", "/2/tweets/*", "/2/users/*", "/2/users/by/username/*"] }
   ```
3. **rate_limit**: sized for REX. Every validator in a duty fetches once: 4 on DevNet
   today, at most 5 (the 0.18.1 `DEFAULT_VALIDATORS_PER_DUTY`). 30 per minute allows
   6 verifications a minute.
   ```json
   { "type": "rate_limit", "name": "30 per minute", "maxRequests": 30, "windowSeconds": 60, "keyBy": "latch" }
   ```
4. **rate_limit**: hard daily count, durable across restarts.
   ```json
   { "type": "rate_limit", "name": "400 per day", "maxRequests": 400, "windowSeconds": 86400, "keyBy": "latch", "counting": "fixed" }
   ```
5. **response**: keep every answer under the REX response limit (~13 KB) and withhold
   X error pages.
   ```json
   { "type": "response", "name": "Small, successful answers only", "rules": [
     { "blockStatusCodes": [401, 403, 429, 500, 502, 503], "maxResponseBytes": 12288 } ] }
   ```
6. **spend_limit**: a dollar ceiling on X credits. Pricing is flat and deliberately
   pessimistic: it charges every request as one billable post read, even when X
   deduplicates it.
   ```json
   { "type": "spend_limit", "name": "$2 a day", "maxDailyCents": 200, "pricing": "flat", "costPerRequestCents": 0.5 }
   ```

**Do not use the "Encrypted-link wizard" for this latch yet.** The Rialo REX ciphertext
must be bound to a specific Rialo **creator pubkey**, the account that pays for the
verification REX. Merit produces it with `rialo client encrypt-secret --creator-pubkey …`.
If the wizard exists for Rialo REX, tell me which fields it asks for and I will check in
Phase 2 whether it can produce the same binding.

**X cost per verification** (X's official pay-per-use page, docs.x.com, 2026-10-22):

| Item | Price |
| --- | --- |
| Post read (`GET /2/tweets/:id`, `/2/tweets?ids=`) | $0.005 per post returned |
| User read (`/2/users/...`) | $0.010 per user returned |
| Deduplication | the same resource read again within the same UTC day is not charged (X calls this a "soft guarantee") |
| Monthly cap | 3M post reads per billing cycle |

- One REX verification makes 4–5 validators fetch **one** post with
  `tweet.fields=author_id,created_at` and **no** `expansions`, so no user object is
  billed. With deduplication that costs **$0.005**; if deduplication fails it costs at
  most **$0.025**.
- The judge reads the same post (and up to 9 more thread posts, listed by the
  contributor) on the same day, so the verified post is free again. A 10-post thread
  costs about **$0.05** in total.
- Per submission: **$0.005–$0.05**. The $2/day ceiling caps the worst case at about
  400 billable reads a day.
- Limit: Latch cannot inspect query strings (only the path and body), so it cannot stop
  someone holding the token from adding `expansions=author_id` or 100 `ids=`. The daily
  count, the spend cap and the fact that only validators and Merit's server hold the
  token are what bound this.

---

## 4. Latch `merit-payout-signer` (TEE transaction signer)

Follows the Latch **Transaction signing** guide: Privy server wallet as the only
on-chain signer, an agent authentication key that only authorizes, and payload rules
that gate exactly what gets signed.

| Field | Value |
| --- | --- |
| Name | `merit-payout-signer` |
| Secret | `merit-privy-signer` |
| Upstream | `https://devnet.rialo.io` |
| Venue | **TEE** (required: transaction-signing latches run inside the enclave) |
| Expiry | none |
| Body logging | **On** for requests (the transaction JSON is public anyway, and it feeds Merit's Guardrails page) |

**Agent authentication key** (to allowlist): `GM4VP1it1dLVwAKQbY9yJZ7yAWQokGQsRZgcj5FMWfRn`.
It is an ed25519 key Merit's judge server signs with. It holds no funds and is never an
on-chain signer, and you can revoke it by removing it from the filter below.

### Stage A: now (Phase 2 proof)

Merit's campaign program does not exist until Phase 3, so Phase 2 proves the latch with
the shape from the Latch guide: one native RLO transfer from the Privy wallet, capped.
**Allow:** 0.001 RLO to the deployer. **Deny:** 0.5 RLO is over the cap and rejected
before anything is signed.

1. **rialo_tx_signers**
   ```json
   { "type": "rialo_tx_signers", "name": "Merit agent only",
     "signers": ["GM4VP1it1dLVwAKQbY9yJZ7yAWQokGQsRZgcj5FMWfRn"] }
   ```
2. **payload**
   ```json
   { "type": "payload", "name": "One capped instruction", "rules": [
     { "path": "$.transaction.instructions", "operator": "min_length", "value": 1,
       "reason": "Exactly one instruction." },
     { "path": "$.transaction.instructions", "operator": "max_length", "value": 1,
       "reason": "Exactly one instruction." },
     { "path": "$.transaction.instructions[0].programId", "operator": "equals",
       "value": "11111111111111111111111111111111", "reason": "Stage A: System transfer only." },
     { "path": "$.transaction.instructions[0].data.prefixHex", "operator": "equals",
       "value": "02000000", "reason": "Stage A: transfer instruction only." },
     { "path": "$.transaction.instructions[0].accounts[1].pubkey", "operator": "in",
       "value": ["5g55ZNWSdsVbwNz49jkAVz8YDeKadhEBBK6KWAQEyrpz"], "reason": "Stage A: test recipient only." },
     { "path": "$.transaction.instructions[0].data.args[0].value", "operator": "less_than_or_equal",
       "value": 50000000, "reason": "Over the per-payout cap (0.05 RLO)." }
   ]}
   ```
3. **rate_limit**
   ```json
   { "type": "rate_limit", "name": "10 per minute", "maxRequests": 10, "windowSeconds": 60, "keyBy": "latch" }
   ```
4. **rate_limit**
   ```json
   { "type": "rate_limit", "name": "200 per day", "maxRequests": 200, "windowSeconds": 86400, "keyBy": "latch", "counting": "fixed" }
   ```

### Stage B: Phase 3 edit (same latch, pipeline only)

The pipeline can be edited after creation; only the upstream and secret are fixed. Once
the campaign program is deployed, the payload filter becomes:

- `$.transaction.instructions[0].programId` **equals** `4qBwWYWn7ougS7sHP21x4yTDk4cwmyEqUiqNmKAYVuk6`
  (Merit's program id, already reserved: it will be deployed with this keypair).
- `$.transaction.instructions[0].data.prefixHex` **equals** `11000000` (`approve` is
  variant 17 in the built manifest; Venus encodes instruction data as bincode, a u32
  little-endian tag followed by the fields).
- `$.transaction.instructions[0].data.args[5].value` **less_than_or_equal** `100`. The
  program computes the amount from the score, so Latch caps the score. The typed args are
  `workflow_pda_slug: [u8;32], campaign: pubkey, contributor: pubkey, x_user_id: u64,
  post_id: u64, score: u64, submission_hash: pubkey`. The index assumes Latch counts the
  slug as `args[0]`; I will confirm it with one denied request when the latch exists.
- A second rule allows `open_ledger` (`prefixHex` equals `04000000`), which the agent
  sends once per round. Use an `or` group, or a second latch, if the payload filter
  cannot express two prefixes.
- The Stage A recipient rule is removed (the contributor is an argument, checked on-chain).

Latch is the first wall: an over-cap approve is denied with `403` and `deniedBy` before
it is signed. Each campaign's on-chain caps are the second wall.

---

## After you create them

1. Paste the three `lat_` tokens into `~/merit/.env` as shown at the top.
2. Send me the Privy **Rialo** wallet address shown on `merit-privy-signer`.
3. Tell me if any dashboard field did not match this guide.

I will then prove one allow and one deny on each latch, and read `/capabilities`,
`/budget` and `/audit` for each.
