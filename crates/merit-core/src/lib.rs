//! Pure settlement rules for Merit.
//!
//! The Venus program in `programs/merit` calls these functions for every
//! money decision: how much an approval is worth, whether it fits the caps,
//! whether a REX report is unanimous, whether the X post matches the
//! approval, and which approved entry the heartbeat pays next. Keeping them
//! free of Rialo types lets `cargo test -p merit-core` exercise the exact
//! code the program runs.

#![forbid(unsafe_code)]

/// Approvals per round ledger. State is fixed-width (see `programs/merit`),
/// so this is a hard ceiling, not a hint.
pub const MAX_ENTRIES: usize = 16;
pub const MIN_ROUND_MS: u64 = 60_000;
pub const MAX_ROUND_MS: u64 = 7 * 86_400_000;
/// Heartbeat interval while a round is open. A DevNet timestamp subscription
/// only lives ~100 commits (~15 s), so this must stay well below that.
pub const BEAT_MS: u64 = 5_000;
/// Delay between settlement steps (one payout per step).
pub const SETTLE_STEP_MS: u64 = 500;
/// How long settlement waits after the round ends for in-flight or retried
/// verifications before treating them as unverified.
pub const VERIFY_GRACE_MS: u64 = 60_000;
/// REX verifications per approval (first try plus retries). Each one costs
/// the agent ~0.0115 RLO that is never refunded.
pub const MAX_VERIFY_ATTEMPTS: u64 = 2;
pub const MAX_SCORE: u64 = 100;
/// What one REX verification costs its creator on DevNet: measured at
/// 11,511,840 kelvin (`docs/EVIDENCE.md`), rounded up. The campaign's
/// operations budget repays the agent this much per attempt.
pub const REX_COST_KELVIN: u64 = 12_000_000;
/// A report needs at least this many validator outputs to count, and all of
/// them must agree byte for byte.
pub const MIN_REPORT_OUTPUTS: u64 = 3;
pub const MAX_PROOF_BYTES: usize = 96;
/// Program v2: a closed round still takes approvals this long after it
/// closes (at most half a round, see `effective_grace`); settlement waits for
/// it. New campaigns start with this; the owner changes it with `set_limits`.
pub const SUBMIT_GRACE_MS: u64 = 300_000;
pub const MAX_SUBMIT_GRACE_MS: u64 = 3_600_000;
/// The rolling 24-hour cap counts payouts in hourly buckets.
pub const HOUR_MS: u64 = 3_600_000;
pub const DAY_BUCKETS: usize = 24;
pub const MAX_COOLDOWN_MS: u64 = 30 * 86_400_000;
/// Program v3: settlement that has made no progress for this long is stuck
/// (a step keeps failing); the owner may then skip the step that fails.
pub const STUCK_MS: u64 = 600_000;

pub mod kind {
    pub const CAMPAIGN: u64 = 1;
    pub const LEDGER: u64 = 2;
    /// Program v2: one per (campaign agent, X account): the wallet the agent
    /// registered for that account and since when (the payee cooldown).
    pub const PAYEE: u64 = 3;
}

/// Campaign lifecycle.
pub mod phase {
    /// No round open. The owner can fund and start one.
    pub const IDLE: u64 = 0;
    pub const OPEN: u64 = 1;
    pub const SETTLING: u64 = 2;
    /// Settlement stopped at a verified approval the escrow cannot cover.
    pub const WAITING_FUNDS: u64 = 3;
    pub const ENDED: u64 = 4;
    pub const REFUNDED: u64 = 5;
    /// Program v2: the round would pay more than the owner's approval
    /// threshold; settlement waits for `approve_round`.
    pub const AWAITING_APPROVAL: u64 = 6;
}

/// Ledger entry status, written by the agent's ledger workflow.
pub mod entry {
    pub const EMPTY: u64 = 0;
    pub const PENDING: u64 = 1;
    pub const VERIFIED: u64 = 2;
    /// A unanimous report that contradicts the approval (wrong author, wrong
    /// post, outside the round). Retrying cannot change it.
    pub const FAILED: u64 = 3;
    /// No unanimous report. Can be retried while attempts remain.
    pub const INCONCLUSIVE: u64 = 4;
    /// Program v2: the agent took the approval back before payout (an owner
    /// override or a re-check). Releases its share of the caps.
    pub const REVOKED: u64 = 5;
}

/// Per-entry settlement outcome, written by the campaign workflow.
pub mod settle {
    pub const TODO: u64 = 0;
    pub const PAID: u64 = 1;
    pub const SKIPPED_UNVERIFIED: u64 = 2;
    pub const SKIPPED_CAP: u64 = 3;
    pub const UNFUNDED: u64 = 4;
    pub const REVOKED: u64 = 5;
    /// Over the rolling 24-hour cap at payout time.
    pub const SKIPPED_DAILY: u64 = 6;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Config {
    /// Payout in kelvin for a score of 100.
    pub rate_kelvin: u64,
    pub min_score: u64,
    pub cap_per_payout: u64,
    pub cap_per_contributor: u64,
    pub cap_per_round: u64,
    pub round_length_ms: u64,
    pub refund_deadline_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConfigError {
    ZeroRate,
    ScoreRange,
    CapOrder,
    RoundLength,
    Deadline,
}

pub fn validate_round_length(round_length_ms: u64) -> Result<(), ConfigError> {
    if !(MIN_ROUND_MS..=MAX_ROUND_MS).contains(&round_length_ms) {
        return Err(ConfigError::RoundLength);
    }
    Ok(())
}

pub fn validate_config(cfg: &Config, now_ms: u64) -> Result<(), ConfigError> {
    if cfg.rate_kelvin == 0 {
        return Err(ConfigError::ZeroRate);
    }
    if cfg.min_score > MAX_SCORE {
        return Err(ConfigError::ScoreRange);
    }
    // A score of 100 must fit one payout, and one payout must fit both
    // the contributor and the round budget.
    if cfg.rate_kelvin > cfg.cap_per_payout
        || cfg.cap_per_payout > cfg.cap_per_contributor
        || cfg.cap_per_contributor > cfg.cap_per_round
    {
        return Err(ConfigError::CapOrder);
    }
    validate_round_length(cfg.round_length_ms)?;
    if cfg.refund_deadline_ms <= now_ms.saturating_add(MIN_ROUND_MS) {
        return Err(ConfigError::Deadline);
    }
    Ok(())
}

/// Payout for a score. The program computes the amount itself; the agent
/// only supplies the score.
pub fn payout_for_score(rate_kelvin: u64, score: u64) -> Option<u64> {
    if score > MAX_SCORE {
        return None;
    }
    let amount = (rate_kelvin as u128) * (score as u128) / (MAX_SCORE as u128);
    u64::try_from(amount).ok()
}

/// One ledger entry as the rules see it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Entry {
    pub contributor: [u8; 32],
    pub x_user_id: u64,
    pub post_id: u64,
    pub amount: u64,
    pub status: u64,
    /// REX verifications started for this entry.
    pub attempts: u64,
}

impl Entry {
    pub const EMPTY: Entry = Entry {
        contributor: [0; 32],
        x_user_id: 0,
        post_id: 0,
        amount: 0,
        status: entry::EMPTY,
        attempts: 0,
    };

    /// No verification is running or can still be retried.
    fn verification_final(&self) -> bool {
        self.status == entry::VERIFIED
            || self.status == entry::FAILED
            || self.status == entry::REVOKED
            || (self.status == entry::INCONCLUSIVE && self.attempts >= MAX_VERIFY_ATTEMPTS)
    }

    /// Entries that still hold budget. A definite verification failure
    /// releases its share of the caps.
    fn holds_budget(&self) -> bool {
        self.status == entry::PENDING
            || self.status == entry::VERIFIED
            || self.status == entry::INCONCLUSIVE
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApproveError {
    LedgerFull,
    ZeroId,
    ScoreRange,
    ScoreBelowMinimum,
    ZeroAmount,
    DuplicatePost,
    /// The X account is already bound to a different wallet in this round,
    /// or this wallet to a different X account.
    IdentityMismatch,
    PayoutCap,
    ContributorCap,
    RoundCap,
    /// Program v2: the rolling 24-hour cap.
    DailyCap,
}

/// Checks a new approval against the round's ledger and returns its amount.
pub fn check_approval(
    cfg: &Config,
    entries: &[Entry],
    entry_count: usize,
    contributor: [u8; 32],
    x_user_id: u64,
    post_id: u64,
    score: u64,
    day_room: u64,
) -> Result<u64, ApproveError> {
    if entry_count >= MAX_ENTRIES || entry_count > entries.len() {
        return Err(ApproveError::LedgerFull);
    }
    if x_user_id == 0 || post_id == 0 || contributor == [0; 32] {
        return Err(ApproveError::ZeroId);
    }
    if score > MAX_SCORE {
        return Err(ApproveError::ScoreRange);
    }
    if score < cfg.min_score {
        return Err(ApproveError::ScoreBelowMinimum);
    }
    let amount = payout_for_score(cfg.rate_kelvin, score).ok_or(ApproveError::ScoreRange)?;
    if amount == 0 {
        return Err(ApproveError::ZeroAmount);
    }
    if amount > cfg.cap_per_payout {
        return Err(ApproveError::PayoutCap);
    }

    let mut contributor_total = 0u64;
    let mut round_total = 0u64;
    for existing in &entries[..entry_count] {
        if existing.post_id == post_id {
            return Err(ApproveError::DuplicatePost);
        }
        if (existing.x_user_id == x_user_id) != (existing.contributor == contributor) {
            return Err(ApproveError::IdentityMismatch);
        }
        if !existing.holds_budget() {
            continue;
        }
        round_total = round_total.saturating_add(existing.amount);
        if existing.x_user_id == x_user_id {
            contributor_total = contributor_total.saturating_add(existing.amount);
        }
    }
    if contributor_total.saturating_add(amount) > cfg.cap_per_contributor {
        return Err(ApproveError::ContributorCap);
    }
    if round_total.saturating_add(amount) > cfg.cap_per_round {
        return Err(ApproveError::RoundCap);
    }
    // Everything this round still owes counts against the day as well.
    if round_total.saturating_add(amount) > day_room {
        return Err(ApproveError::DailyCap);
    }
    Ok(amount)
}

/// One validator's contribution to a REX report.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Vote<'a> {
    Success(&'a [u8]),
    /// An error, an undecodable update, or a non-raw response.
    Bad,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Consensus {
    Unanimous(Vec<u8>),
    /// Fewer than `MIN_REPORT_OUTPUTS`, any bad vote, or any disagreement.
    NotUnanimous { outputs: u64, success: u64 },
}

pub fn consensus<'a, I: IntoIterator<Item = Vote<'a>>>(votes: I) -> Consensus {
    let mut outputs = 0u64;
    let mut success = 0u64;
    let mut agreed: Option<&[u8]> = None;
    let mut matching = true;
    for vote in votes {
        outputs += 1;
        match vote {
            Vote::Success(payload) => {
                success += 1;
                if payload.is_empty() || payload.len() > MAX_PROOF_BYTES {
                    matching = false;
                } else if let Some(expected) = agreed {
                    if expected != payload {
                        matching = false;
                    }
                } else {
                    agreed = Some(payload);
                }
            }
            Vote::Bad => {
                matching = false;
            }
        }
    }
    if matching && outputs >= MIN_REPORT_OUTPUTS && success == outputs {
        if let Some(payload) = agreed {
            return Consensus::Unanimous(payload.to_vec());
        }
    }
    Consensus::NotUnanimous { outputs, success }
}

/// What the REX component reports about an X post.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PostProof {
    pub post_id: u64,
    pub author_id: u64,
    pub created_ms: u64,
}

/// Parses `MX1|<post id>|<author id>|<created_at RFC 3339>`.
pub fn parse_post_proof(payload: &[u8]) -> Option<PostProof> {
    let text = core::str::from_utf8(payload).ok()?;
    let mut parts = text.split('|');
    if parts.next()? != "MX1" {
        return None;
    }
    let post_id = parse_decimal(parts.next()?)?;
    let author_id = parse_decimal(parts.next()?)?;
    let created_ms = parse_rfc3339_utc_ms(parts.next()?)?;
    if parts.next().is_some() {
        return None;
    }
    Some(PostProof {
        post_id,
        author_id,
        created_ms,
    })
}

fn parse_decimal(text: &str) -> Option<u64> {
    if text.is_empty() || text.len() > 20 || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

/// Parses X's `created_at`: `YYYY-MM-DDTHH:MM:SS[.fff]Z`, UTC only.
pub fn parse_rfc3339_utc_ms(text: &str) -> Option<u64> {
    let bytes = text.as_bytes();
    if bytes.len() < 20 || *bytes.last()? != b'Z' {
        return None;
    }
    let num = |from: usize, to: usize| -> Option<u64> {
        let slice = bytes.get(from..to)?;
        if !slice.iter().all(|b| b.is_ascii_digit()) {
            return None;
        }
        core::str::from_utf8(slice).ok()?.parse().ok()
    };
    if bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' || bytes[13] != b':' || bytes[16] != b':' {
        return None;
    }
    let year = num(0, 4)?;
    let month = num(5, 7)?;
    let day = num(8, 10)?;
    let hour = num(11, 13)?;
    let minute = num(14, 16)?;
    let second = num(17, 19)?;
    let millis = match bytes.len() {
        20 => 0,
        24 if bytes[19] == b'.' => num(20, 23)?,
        _ => return None,
    };
    if year < 1970
        || !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(year, month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let days = days_from_civil(year, month, day);
    Some((((days * 24 + hour) * 60 + minute) * 60 + second) * 1_000 + millis)
}

fn is_leap(year: u64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: u64, month: u64) -> u64 {
    match month {
        2 => {
            if is_leap(year) {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Days since 1970-01-01 (Howard Hinnant's algorithm, years >= 1970).
fn days_from_civil(year: u64, month: u64, day: u64) -> u64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Verified,
    WrongPost,
    WrongAuthor,
    OutsideRound,
}

/// The post must be the approved one, written by the approved X account,
/// and created inside the round. A post's creation time falls in exactly one
/// round, so one post can never be paid in two rounds.
pub fn judge_proof(
    proof: &PostProof,
    post_id: u64,
    x_user_id: u64,
    round_start_ms: u64,
    round_end_ms: u64,
) -> Verdict {
    if proof.post_id != post_id {
        return Verdict::WrongPost;
    }
    if proof.author_id != x_user_id {
        return Verdict::WrongAuthor;
    }
    if proof.created_ms < round_start_ms || proof.created_ms >= round_end_ms {
        return Verdict::OutsideRound;
    }
    Verdict::Verified
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    Pay { index: usize, amount: u64 },
    /// An earlier entry is still being verified; payouts keep approval order.
    WaitVerification,
    WaitFunds { index: usize },
    Done,
}

/// Picks the next settlement action and records skips in `outcome`.
///
/// Entries are paid strictly in approval order. Unverified entries are
/// skipped once `verification_closed`; verified entries that would break a
/// cap are skipped; the first verified entry the escrow cannot cover stops
/// settlement until the owner funds more.
pub fn next_step(
    cfg: &Config,
    entries: &[Entry],
    entry_count: usize,
    outcome: &mut [u64],
    round_paid: u64,
    available: u64,
    verification_closed: bool,
    day_room: u64,
) -> Step {
    let count = entry_count.min(entries.len()).min(outcome.len());
    for index in 0..count {
        if outcome[index] != settle::TODO {
            continue;
        }
        let current = entries[index];
        match current.status {
            entry::VERIFIED => {}
            entry::PENDING | entry::INCONCLUSIVE => {
                if !verification_closed {
                    return Step::WaitVerification;
                }
                outcome[index] = settle::SKIPPED_UNVERIFIED;
                continue;
            }
            entry::REVOKED => {
                outcome[index] = settle::REVOKED;
                continue;
            }
            _ => {
                outcome[index] = settle::SKIPPED_UNVERIFIED;
                continue;
            }
        }
        let mut contributor_paid = 0u64;
        for (other, state) in entries[..count].iter().zip(outcome.iter()) {
            if *state == settle::PAID && other.x_user_id == current.x_user_id {
                contributor_paid = contributor_paid.saturating_add(other.amount);
            }
        }
        if current.amount == 0
            || current.amount > cfg.cap_per_payout
            || contributor_paid.saturating_add(current.amount) > cfg.cap_per_contributor
            || round_paid.saturating_add(current.amount) > cfg.cap_per_round
        {
            outcome[index] = settle::SKIPPED_CAP;
            continue;
        }
        if current.amount > day_room {
            outcome[index] = settle::SKIPPED_DAILY;
            continue;
        }
        if current.amount > available {
            return Step::WaitFunds { index };
        }
        return Step::Pay {
            index,
            amount: current.amount,
        };
    }
    Step::Done
}

/// Settlement starts once every verification in the ledger is final, or once
/// the grace period after the round has passed.
pub fn verification_done(entries: &[Entry], entry_count: usize, closed: bool) -> bool {
    closed || entries[..entry_count.min(entries.len())].iter().all(Entry::verification_final)
}

/// What the agent spent on REX for this ledger.
pub fn verification_cost(entries: &[Entry], entry_count: usize) -> u64 {
    entries[..entry_count.min(entries.len())]
        .iter()
        .fold(0u64, |total, entry| total.saturating_add(entry.attempts.saturating_mul(REX_COST_KELVIN)))
}

/// Whether the campaign's operations budget still covers one more
/// verification on top of everything this ledger already used, plus the
/// ledger's own rent. When it does not, approvals and retries stop.
pub fn ops_budget_allows_verification(
    ops_budget: u64,
    entries: &[Entry],
    entry_count: usize,
    ledger_rent: u64,
) -> bool {
    verification_cost(entries, entry_count)
        .saturating_add(REX_COST_KELVIN)
        .saturating_add(ledger_rent)
        <= ops_budget
}

/// What settlement repays the agent for a round: its REX attempts plus the
/// ledger rent, never more than the budget holds.
pub fn reimbursement(ops_budget: u64, entries: &[Entry], entry_count: usize, ledger_rent: u64) -> u64 {
    verification_cost(entries, entry_count)
        .saturating_add(ledger_rent)
        .min(ops_budget)
}

/// Operations budget the owner may take back: only between rounds.
pub fn unreserved_ops(phase_now: u64, ops_budget: u64) -> u64 {
    match phase_now {
        phase::IDLE | phase::ENDED => ops_budget,
        _ => 0,
    }
}

/// Marks every verified, unpaid entry as unfunded (deadline or owner end).
pub fn abandon_unfunded(entries: &[Entry], entry_count: usize, outcome: &mut [u64]) -> u64 {
    let count = entry_count.min(entries.len()).min(outcome.len());
    let mut abandoned = 0;
    for index in 0..count {
        if outcome[index] == settle::TODO {
            outcome[index] = if entries[index].status == entry::VERIFIED {
                abandoned += 1;
                settle::UNFUNDED
            } else {
                settle::SKIPPED_UNVERIFIED
            };
        }
    }
    abandoned
}

/// Escrow the owner may withdraw now. While a round is open the whole round
/// budget stays locked; while settling or waiting for funds nothing moves.
pub fn unreserved(phase_now: u64, escrow: u64, cap_per_round: u64) -> u64 {
    match phase_now {
        phase::IDLE | phase::ENDED => escrow,
        phase::OPEN => escrow.saturating_sub(cap_per_round),
        _ => 0,
    }
}

/// The grace the program applies: the configured one, at most half a round,
/// so a short round still leaves the next one most of its length.
pub fn effective_grace(submit_grace_ms: u64, round_length_ms: u64) -> u64 {
    submit_grace_ms.min(round_length_ms / 2)
}

/// Whether the campaign's current round takes approvals now: while open, or
/// closed but inside its grace (settlement has not started), and not paused.
pub fn accepts_approvals(phase_now: u64, paused: bool, now_ms: u64, round_end_ms: u64, grace_ms: u64) -> bool {
    if paused {
        return false;
    }
    match phase_now {
        phase::OPEN => now_ms < round_end_ms.saturating_add(grace_ms),
        phase::SETTLING => now_ms < round_end_ms.saturating_add(grace_ms),
        _ => false,
    }
}

/// Settlement of a closed round starts once its grace has passed (or at the
/// refund deadline, which no grace outlives).
pub fn settlement_may_start(now_ms: u64, round_end_ms: u64, grace_ms: u64, deadline_ms: u64) -> bool {
    now_ms >= round_end_ms.saturating_add(grace_ms) || now_ms >= deadline_ms
}

pub fn hour_of(ms: u64) -> u64 {
    ms / HOUR_MS
}

/// Kelvin paid in the 24 hours up to `now_ms` (hourly buckets).
pub fn rolling_paid(hours: &[u64], paid: &[u64], now_ms: u64) -> u64 {
    let now = hour_of(now_ms);
    hours
        .iter()
        .zip(paid)
        .filter(|(hour, _)| **hour <= now && hour.saturating_add(DAY_BUCKETS as u64) > now)
        .fold(0u64, |total, (_, amount)| total.saturating_add(*amount))
}

/// Room left under the rolling 24-hour cap (`u64::MAX` when there is none).
pub fn day_room(max_per_day: u64, hours: &[u64], paid: &[u64], now_ms: u64) -> u64 {
    if max_per_day == 0 {
        return u64::MAX;
    }
    max_per_day.saturating_sub(rolling_paid(hours, paid, now_ms))
}

/// Adds a payout to its hour's bucket, recycling a bucket from a day ago.
pub fn record_payout(hours: &mut [u64], paid: &mut [u64], now_ms: u64, amount: u64) {
    if hours.len() != DAY_BUCKETS || paid.len() != DAY_BUCKETS {
        return;
    }
    let hour = hour_of(now_ms);
    let slot = (hour % DAY_BUCKETS as u64) as usize;
    if hours[slot] != hour {
        hours[slot] = hour;
        paid[slot] = 0;
    }
    paid[slot] = paid[slot].saturating_add(amount);
}

/// What the round would pay: verified entries still to settle.
pub fn round_due(entries: &[Entry], entry_count: usize, outcome: &[u64]) -> u64 {
    let count = entry_count.min(entries.len()).min(outcome.len());
    entries[..count]
        .iter()
        .zip(outcome)
        .filter(|(entry, state)| entry.status == entry::VERIFIED && **state == settle::TODO)
        .fold(0u64, |total, (entry, _)| total.saturating_add(entry.amount))
}

/// A round paying more than the threshold waits for the owner's approval.
pub fn needs_owner_approval(threshold: u64, due: u64, approved: bool) -> bool {
    threshold > 0 && !approved && due > threshold
}

/// A payee's wallet must have been registered at least `cooldown_ms` ago.
pub fn payee_ready(cooldown_ms: u64, since_ms: u64, now_ms: u64) -> bool {
    cooldown_ms == 0 || now_ms >= since_ms.saturating_add(cooldown_ms)
}

/// Limits the owner sets with `set_limits`.
pub fn validate_limits(cfg: &Config, max_per_day: u64, cooldown_ms: u64, submit_grace_ms: u64) -> bool {
    (max_per_day == 0 || max_per_day >= cfg.cap_per_payout)
        && cooldown_ms <= MAX_COOLDOWN_MS
        && submit_grace_ms <= MAX_SUBMIT_GRACE_MS
}

/// The next round's window after a settled one. It starts where the last one
/// ended (no gap: a post written while the last round settled, or in its
/// grace, belongs to exactly one round), back-dated at most one round length,
/// and stays open at least `MIN_ROUND_MS` from now. `None` when the refund
/// deadline is too close.
pub fn next_round_window_after(prev_end_ms: u64, now_ms: u64, round_length_ms: u64, deadline_ms: u64) -> Option<(u64, u64)> {
    if now_ms.saturating_add(MIN_ROUND_MS) > deadline_ms {
        return None;
    }
    let start = prev_end_ms.max(now_ms.saturating_sub(round_length_ms)).min(now_ms);
    let end = start
        .saturating_add(round_length_ms)
        .max(now_ms.saturating_add(MIN_ROUND_MS))
        .min(deadline_ms);
    Some((start, end))
}

/// The next round's window, cut short at the refund deadline. `None` when
/// fewer than `MIN_ROUND_MS` remain.
pub fn next_round_window(now_ms: u64, round_length_ms: u64, deadline_ms: u64) -> Option<(u64, u64)> {
    if now_ms.saturating_add(MIN_ROUND_MS) > deadline_ms {
        return None;
    }
    Some((now_ms, now_ms.saturating_add(round_length_ms).min(deadline_ms)))
}

/// Decodes lowercase or uppercase hex (the encrypted `merit-x` token arrives
/// as a hex string, because the Rialo CLI cannot pass raw bytes).
pub fn decode_hex(text: &str) -> Option<Vec<u8>> {
    let bytes = text.as_bytes();
    if bytes.is_empty() || bytes.len() % 2 != 0 {
        return None;
    }
    let nibble = |b: u8| -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    };
    bytes
        .chunks(2)
        .map(|pair| Some(nibble(pair[0])? << 4 | nibble(pair[1])?))
        .collect()
}

/// Program v3 (audit H-1). Whether an account at a round's ledger address
/// reads as "no ledger": nothing there, or only kelvin someone sent to the
/// predictable address before the agent opened it. Such an account has no
/// data and is not owned by the program; a real ledger always has both.
pub fn ledger_absent(data_len: usize, kelvins: u64, owned_by_program: bool) -> bool {
    data_len == 0 && (kelvins == 0 || !owned_by_program)
}

/// Program v3 (audit M-1), tightened in v4 (re-audit N-1). Settlement is
/// stuck only when the owner has tried `resume` during this settlement
/// (`resumed_ms`, 0 when not) and no step has succeeded for `STUCK_MS` since
/// the later of that resume and the last step that did. `approve_round` and
/// `fund` reset both, so neither opens a window to skip a payout that would
/// have succeeded.
pub fn settlement_stuck(phase_now: u64, last_progress_ms: u64, resumed_ms: u64, now_ms: u64) -> bool {
    phase_now == phase::SETTLING
        && resumed_ms > 0
        && now_ms >= last_progress_ms.max(resumed_ms).saturating_add(STUCK_MS)
}

/// Program v3 (audit M-2). A ledger keeps its own copy of the round window. If
/// the owner shortened the round after the ledger opened (`close_round`, `end`),
/// the ledger takes the campaign's earlier end, so a post written after the
/// early close can only belong to the next round.
pub fn synced_round_end(ledger_end_ms: u64, campaign_end_ms: u64) -> u64 {
    ledger_end_ms.min(campaign_end_ms)
}

/// Program v3 (audit M-3). While a closed round is being settled (or waits for
/// funds or the owner's approval) the owner can't change what it pays: the
/// 24-hour cap and the approval threshold stay as they were when it closed.
pub fn limits_change_allowed(phase_now: u64, max_per_day: (u64, u64), approval_threshold: (u64, u64)) -> bool {
    let settling = matches!(phase_now, phase::SETTLING | phase::WAITING_FUNDS | phase::AWAITING_APPROVAL);
    !settling || (max_per_day.0 == max_per_day.1 && approval_threshold.0 == approval_threshold.1)
}

/// Seed of a round ledger's workflow PDA. Longer than a Rialo `Nonce`, so
/// `Nonce::from(&[u8])` hashes it with Blake3. Both the agent (who creates
/// the ledger) and the campaign (which reads it at settlement) derive the
/// address from this, so nobody can point settlement at another account.
pub fn ledger_seed(campaign: &[u8; 32], round: u64) -> [u8; 52] {
    let mut seed = [0u8; 52];
    seed[..12].copy_from_slice(b"merit-ledger");
    seed[12..44].copy_from_slice(campaign);
    seed[44..].copy_from_slice(&round.to_le_bytes());
    seed
}

/// Seed of a payee's workflow PDA (program v2), one per campaign and X
/// account for each agent key, so the agent can't keep two registrations for
/// one account to dodge the cooldown.
pub fn payee_seed(campaign: &[u8; 32], x_user_id: u64) -> [u8; 51] {
    let mut seed = [0u8; 51];
    seed[..11].copy_from_slice(b"merit-payee");
    seed[11..43].copy_from_slice(campaign);
    seed[43..].copy_from_slice(&x_user_id.to_le_bytes());
    seed
}

#[cfg(test)]
mod tests;
