# Latch, part two: Merit's extra guardrails (dashboard, click by click)

This adds a per-contributor cap, a campaign header, Cedar, a response filter, a "submissions only" custom_code
filter, a small `merit-check` latch for that filter's outcall, and one extended latch for the live campaign. Only
`merit-*` secrets and latches are touched. Leave every other secret and latch (for example `gemini-agent`) alone.

**Order matters.** Merit already sends every new header and field (deployed first). Each step below adds a filter
that *requires* something Merit is already sending, so live judging never breaks. Do part A now, in order. Do part
B only after I tell you the REX program upgrade is live.

**If anything goes wrong:** open the filter you just added and switch it to **Disabled** (`"disabled": true`). That
undoes it at once, with no redeploy. Then tell me what `/guardrails` showed.

**How to check each step:** open `https://merit-ruby-two.vercel.app/guardrails`. Each latch card lists
**Every filter in use** (from Latch's own trace, refreshed every 6 hours) and has **Try a bad request** buttons that
show Latch's real `403` and `deniedBy`. A button for a rule that isn't installed yet says
"Latch would allow this today … Nothing was sent", so pressing it is always safe.

Filter JSON below is the exact schema from Latch's filter reference. If a dashboard form differs, use the JSON
editor for that filter. Filter names are free text; the ones below make `deniedBy` readable.

**Status (2026-10-27):**
- A1–A7 are done and live. merit-judge has 11 filters: `response_7`, `payload_8`, `header_requirement_10` and
  `cedar_11` were added. The per-contributor cap (A2) was removed again: see A2.
- `merit-check` exists but is unused (A6).
- merit-x runs the simpler Rust policy (A7).
- A8 is in progress.
- Part B is not started.

---

## Part A (now)

### A1. merit-judge: require a named contributor

Latches → **merit-judge** → Pipeline → open the existing **payload** filter (shown as `payload_4` today; unnamed
filters are numbered by position, so the number shifts as filters are added) → **Add rule**:

```json
{ "path": "$.metadata.user_id", "operator": "exists",
  "reason": "metadata.user_id (the contributor's X id) is required." }
```

Save. The filter now has 5 rules. Merit sends the contributor's X user id on every judgment, `owner-<user id>` for
the owner's "Read it", and `guardrails-probe` / `guardrails-snapshot` from the Guardrails page.

Check: Guardrails → merit-judge → **Wrong model** still answers `403 · deniedBy payload_…`.

*Done as its own payload filter, `payload_8`, with this one rule. A call without `user_id` is answered
`403 · deniedBy payload_8: metadata.user_id is required`.*

### A2. merit-judge: 10 a day per contributor

**Add filter → rate_limit**, and place it **right after the payload filter** (so a call without `user_id` is refused
by the payload rule first):

```json
{ "type": "rate_limit", "name": "10 a day per contributor",
  "maxRequests": 10, "windowSeconds": 86400, "keyBy": "json_path",
  "jsonPath": "$.metadata.user_id", "counting": "fixed" }
```

Notes:
- This counts **requests**. A judgment is one request, or two when the model's first answer is malformed (Merit
  retries once), so a contributor gets 5 to 10 judgments a day. Use 20 if you want 10 guaranteed.
- A request denied later in the pipeline gives its slot back (Latch changelog #311), so a refused call never uses a
  contributor's quota. A contributor over the cap gets a clear "merit-judge's rate limit (10 a day per contributor)"
  on their submission, which stays pending and is retried by the daily cron.

*Removed (2026-10-27): it didn't key per contributor as configured. Re-add it only once a dry run with two different
ids shows two separate buckets.*

### A3. merit-judge: the campaign header

**Add filter → header_requirement**, placed **first** in the pipeline:

```json
{ "type": "header_requirement", "name": "Campaign named",
  "headers": [{ "name": "X-Merit-Campaign",
                "pattern": "^([1-9A-HJ-NP-Za-km-z]{32,44}|owner-[0-9a-f-]{36})$" }] }
```

The value is a campaign address (base58), or `owner-<user id>` for "Read it" before a campaign exists.

Check: Guardrails → merit-judge → **Missing campaign header** → `403 · deniedBy Campaign named`.

### A4. merit-judge: the Cedar policy

**Add filter → cedar**, placed **right after "Campaign named"**. Name: `Cedar: POST /v1/messages, named caller`.
Paste this policy text exactly (it is `latch/merit-judge.cedar`):

```cedar
// merit-judge: the Messages API only, POST only, with a body,
// from a caller that names its campaign.
permit (
  principal,
  action == Action::"POST",
  resource == Endpoint::"/v1/messages"
)
when { context.hasBody };

// Merit sends X-User with the same value as X-Merit-Campaign. Without it,
// Latch's principal is User::"anonymous", and the call is refused.
forbid (principal == User::"anonymous", action, resource);
```

What it can and can't say. Latch builds the Cedar request from fixed fields only: `principal` is
`User::"<X-User header>"` (`User::"anonymous"` without one), `action` is `Action::"<HTTP method>"`, `resource` is
`Endpoint::"<path>"`, and `context` is `{ callerIp, host, hasBody }`. So Cedar expresses **only POST**, **only
`/v1/messages`**, and **the caller names itself**. It **can't** read the body, so "only `claude-haiku-5-5`" and
"`max_tokens` ≤ 2048" stay in the payload filter: a policy that mentions `context.model` fails Latch's schema check
on save. If your Cedar reference panel (`GET /admin/cedar/schema`) shows more `context` fields than these, send them
to me and I'll fold the model and token rules in. The policy is checked in `apps/web/test/cedar.test.ts` with the
same Cedar engine Latch uses.

Check: **Missing campaign header** still answers 403 (now from "Campaign named", which runs first). Save errors from
Cedar validation: send me the exact text.

### A5. merit-judge: the response filter

**Add filter → response**. Order doesn't matter: a response filter always runs after the upstream replies.

```json
{ "type": "response", "name": "Successful, small replies only", "rules": [
  { "blockStatusCodes": [400, 401, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504, 529],
    "maxResponseBytes": 16384 } ] }
```

A judgment is at most 2,000 output tokens (about 8 KB of JSON), so a reply over 16 KB is never a real one. A blocked
reply reaches Merit as Latch's 403 with `deniedBy: "Successful, small replies only"`; the judge retries it once and
then leaves the submission pending for the cron. Note: a response filter can't undo the call, so a blocked reply may
still have cost tokens (it is metered as usual).

Check: submit nothing; just confirm the filter appears in **Every filter in use** for merit-judge after the next
refresh (within 6 hours), or in the dashboard pipeline view right away.

### A6. The `merit-check` secret and latch (the custom_code filter's outcall)

merit-x's custom_code filter (A7) asks Merit "is this post a submission?" before letting a read through. That
question goes through its own small latch, so the policy never holds Merit's key, the call is audited, and you can
revoke it in one click.

1. **Secrets → New secret → Bind a credential**

   | Field | Value |
   | --- | --- |
   | Name | `merit-check-key` |
   | Type | `api_key` |
   | Credential | the value of `MERIT_CHECK_KEY` in `~/merit/.env` (I generated it; it is also set on Vercel) |
   | Inject as | `custom_header`, key `x-merit-check-key` |

2. **Latches → New latch → Manual pipeline**

   | Field | Value |
   | --- | --- |
   | Name | `merit-check` |
   | Secret | `merit-check-key` |
   | Upstream | `https://merit-ruby-two.vercel.app` |
   | Venue | the default for your account (enclave) |
   | Expiry | 2027-01-31 |
   | Body logging | Off |

   Pipeline, in this order:

   ```json
   { "type": "method", "name": "GET only", "allowed": ["GET"] }
   ```
   ```json
   { "type": "endpoint", "name": "Submission check only", "mode": "allowlist",
     "patterns": ["/api/latch/tweet-check/*"] }
   ```
   ```json
   { "type": "rate_limit", "name": "120 a minute", "maxRequests": 120, "windowSeconds": 60, "keyBy": "latch" }
   ```
   ```json
   { "type": "response", "name": "Tiny answers only", "rules": [
     { "blockStatusCodes": [500, 502, 503, 504], "maxResponseBytes": 1024 } ] }
   ```

3. Copy the `merit-check` **`lat_` token** (shown once).

*Status: created. The token is in `~/merit/.env` as `MERIT_CHECK_LAT`. It is **unused**, and deliberately not on
Vercel. It's ready for when outcalls are available to Rust custom_code on this account. Merit's side (`/api/latch/tweet-check`, `MERIT_CHECK_KEY` on Vercel) is
deployed and waiting. When outcalls arrive, A7 is replaced with `latch/merit-x-submissions-outcall.rs`, with this
token pasted in.*

Check (optional, from a terminal): `curl -s https://onlatch.com/proxy/api/latch/tweet-check/1 -H "authorization: Bearer <merit-check lat_>"`
answers `MERIT-NO 1` (HTTP 404). Without the token, Merit's endpoint itself answers `MERIT-NO unauthorized`.

### A7. merit-x: post lookups by numeric id only (Rust custom_code)

*Status: live, as "Custom policy". Latch reports its denials as `deniedBy: "Rust policy (on_request)"`.*

The first design, which asks Merit whether a post is a submission, needs outcalls from Rust custom_code, which this
account doesn't offer yet. It is kept as `latch/merit-x-submissions-outcall.rs`. The policy that is live is
`latch/merit-x-submissions.rs`:

```rust
if !ctx.method.eq_ignore_ascii_case("GET") {
    return PolicyResult::deny("merit-x is read-only");
}
let full: &str = &ctx.path;
let path = full.split('?').next().unwrap_or("");
match path.strip_prefix("/2/tweets/") {
    Some(id) if !id.is_empty() && id.len() <= 20 && id.bytes().all(|b| b.is_ascii_digit()) => PolicyResult::allow(),
    _ => PolicyResult::deny("merit-x allows GET /2/tweets/<numeric id> only"),
}
```

(Your pasted version may word its reason differently. Latch's live answer is "post lookups by numeric id only".)

What it does:
- It allows `GET /2/tweets/<numeric id>`, with or without a query. REX validators read
  `/2/tweets/<id>?tweet.fields=author_id,created_at`, and Merit's judge reads the same path with more fields, so
  **both pass**.
- It denies any other method, any non-numeric segment (`/2/tweets/search`, `/2/tweets/abc`), the bare
  `/2/tweets?ids=…` lookup, and `/2/users/…`. Merit uses none of these.
- It is narrower than the endpoint filter, which still allows `/2/tweets`, `/2/tweets/*` and `/2/users/*`.

What it doesn't do: it can't tell a Merit submission from any other public post. Someone holding the merit-x token
could still read an arbitrary post by id, within the 30-a-minute and 400-a-day limits. Closing that needs the
outcall version above.

Check: Guardrails → merit-x → **Non-numeric tweet path** sends `GET /2/tweets/search` and gets
`403 · deniedBy Rust policy (on_request)`. It uses `/2/tweets/search`, not `/2/tweets/search/recent`, because a
two-segment path is already stopped by the endpoint filter before the custom code runs.

Note: Guardrails sends this one probe for real rather than as a dry run. That's safe: X has no post called "search",
so nothing is billed even if it got through.

### A8. An extended latch for "Rialo in your own words"

The live campaign gets its own child of merit-judge. It keeps every parent filter (live inheritance, so tightening
merit-judge later tightens it too) and adds a smaller spend cap that belongs to this campaign alone.

Latches → **merit-judge** → **Extend**:

| Field | Value |
| --- | --- |
| Name | `merit-judge-rialo-own-words` |
| Mutability | `attenuate_only` (the child can only be made stricter) |
| Inheritance | `live` |
| Expiry | 2026-11-30 (the campaign runs until 2026-11-09) |
| Body logging | Off |

Add these filters to the child (the parent's filters run first, then these):

```json
{ "type": "header_requirement", "name": "Only Rialo in your own words",
  "headers": [{ "name": "X-Merit-Campaign", "pattern": "^5LyXppXdVZHcV6bcWjJkTyir3F9PM5TEx6pTTA9jEiwv$" }] }
```
```json
{ "type": "rate_limit", "name": "100 a day", "maxRequests": 100, "windowSeconds": 86400, "keyBy": "latch", "counting": "fixed" }
```
```json
{ "type": "spend_limit", "name": "25¢ a day", "maxDailyCents": 25, "pricing": "model_based",
  "modelPricing": { "claude-haiku-5-5": { "inputPer1k": 0.1, "outputPer1k": 0.5 } } }
```

The header rule binds the token to this one campaign: it is useless for any other. The pricing matches merit-judge's
own, so 25¢ is a quarter of the parent's $1 day.

Then:
1. Copy the child's **`lat_` token** (shown once) into `~/merit/.env` on a new line:
   `MERIT_JUDGE_LAT__5LyXppXdVZHcV6bcWjJkTyir3F9PM5TEx6pTTA9jEiwv=lat_...`
2. Tell me. I add it to the `merit` Vercel project as a Sensitive variable and redeploy. Until then Merit keeps
   using merit-judge for this campaign; nothing breaks in between.

How Merit uses it: for this campaign's judge calls Merit sends the child token; every other campaign, and the owner's
"Read it", use merit-judge. **The parent is used only when a campaign has no child.** If the child denies (its 25¢
cap, its 100 a day), is disabled or expires, the call fails and the submission waits; Merit never retries it on the
parent, so the smaller cap really holds. Guardrails then shows a **Campaign latches** card: its name, chain depth 1,
its own spend against 25¢, and its own audit. The per-campaign table marks those calls "own latch".

Optional, same steps: a child of **merit-x** (`merit-x-rialo-own-words`, the same header rule, `rate_limit`
100 a day) set as `MERIT_X_LAT__5LyX…jEiwv=lat_...`. Merit then also encrypts that child token into each new round's
REX ledger, so validators' reads for this campaign count against the child, from the round after I redeploy.

---

## Part B (only after I confirm the REX upgrade)

The REX component in Merit's program sends `X-Merit-Campaign` only after an in-place DevNet upgrade, which I run
separately and confirm with a verified post. Before that, validators don't send the header, so requiring it on
merit-x would refuse every verification.

### B1. merit-x: the campaign header

Latches → **merit-x** → **Add filter → header_requirement**, placed **first**:

```json
{ "type": "header_requirement", "name": "Campaign named",
  "headers": [{ "name": "X-Merit-Campaign", "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$" }] }
```

merit-x never sees an `owner-…` tag (only the judge does), so the pattern is a campaign address only.

Check: the next verification on the live campaign reaches **REX verified**, and the merit-x card's latest decisions
show validator reads as `allow`.

---

## What to send me

1. Anything that didn't match this guide (a label, a missing option, a Cedar or Rust compile error, word for word).
   When outcalls become available in Rust custom_code, tell me: A7 can then become the submissions-only version.
2. After A8: just "child token added" (the token stays in `~/merit/.env`).
3. Nothing else: Guardrails shows me the rest.
