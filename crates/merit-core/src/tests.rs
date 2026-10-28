use super::*;

const NOW: u64 = 1_761_000_000_000;
const RLO: u64 = 1_000_000_000;

fn cfg() -> Config {
    Config {
        rate_kelvin: RLO / 10,
        min_score: 60,
        cap_per_payout: RLO / 10,
        cap_per_contributor: RLO / 5,
        cap_per_round: RLO / 2,
        round_length_ms: 300_000,
        refund_deadline_ms: NOW + 86_400_000,
    }
}

fn wallet(n: u8) -> [u8; 32] {
    [n; 32]
}

fn verified(n: u8, x_user_id: u64, post_id: u64, amount: u64) -> Entry {
    Entry {
        contributor: wallet(n),
        x_user_id,
        post_id,
        amount,
        status: entry::VERIFIED,
        attempts: 1,
    }
}

fn ledger(list: &[Entry]) -> ([Entry; MAX_ENTRIES], usize) {
    let mut entries = [Entry::EMPTY; MAX_ENTRIES];
    entries[..list.len()].copy_from_slice(list);
    (entries, list.len())
}

#[test]
fn config_rules() {
    assert_eq!(validate_config(&cfg(), NOW), Ok(()));
    assert_eq!(validate_config(&Config { rate_kelvin: 0, ..cfg() }, NOW), Err(ConfigError::ZeroRate));
    assert_eq!(validate_config(&Config { min_score: 101, ..cfg() }, NOW), Err(ConfigError::ScoreRange));
    assert_eq!(
        validate_config(&Config { rate_kelvin: RLO, ..cfg() }, NOW),
        Err(ConfigError::CapOrder)
    );
    assert_eq!(
        validate_config(&Config { cap_per_round: RLO / 10, ..cfg() }, NOW),
        Err(ConfigError::CapOrder)
    );
    assert_eq!(
        validate_config(&Config { round_length_ms: 59_999, ..cfg() }, NOW),
        Err(ConfigError::RoundLength)
    );
    assert_eq!(
        validate_config(&Config { round_length_ms: MAX_ROUND_MS + 1, ..cfg() }, NOW),
        Err(ConfigError::RoundLength)
    );
    assert_eq!(validate_config(&Config { round_length_ms: MAX_ROUND_MS, ..cfg() }, NOW), Ok(()));
    assert_eq!(
        validate_config(&Config { refund_deadline_ms: NOW + 1_000, ..cfg() }, NOW),
        Err(ConfigError::Deadline)
    );
}

#[test]
fn payout_scales_with_score_and_never_overflows() {
    assert_eq!(payout_for_score(RLO / 10, 100), Some(RLO / 10));
    assert_eq!(payout_for_score(RLO / 10, 75), Some(75_000_000));
    assert_eq!(payout_for_score(RLO / 10, 0), Some(0));
    assert_eq!(payout_for_score(RLO / 10, 101), None);
    assert_eq!(payout_for_score(u64::MAX, 100), Some(u64::MAX));
}

#[test]
fn approval_computes_amount_from_score() {
    let (entries, count) = ledger(&[]);
    assert_eq!(check_approval(&cfg(), &entries, count, wallet(1), 7, 70, 80, u64::MAX), Ok(80_000_000));
}

#[test]
fn approval_rejects_bad_input() {
    let (entries, count) = ledger(&[]);
    let c = cfg();
    assert_eq!(check_approval(&c, &entries, count, wallet(1), 7, 70, 59, u64::MAX), Err(ApproveError::ScoreBelowMinimum));
    assert_eq!(check_approval(&c, &entries, count, wallet(1), 7, 70, 101, u64::MAX), Err(ApproveError::ScoreRange));
    assert_eq!(check_approval(&c, &entries, count, wallet(0), 7, 70, 80, u64::MAX), Err(ApproveError::ZeroId));
    assert_eq!(check_approval(&c, &entries, count, wallet(1), 0, 70, 80, u64::MAX), Err(ApproveError::ZeroId));
    assert_eq!(check_approval(&c, &entries, count, wallet(1), 7, 0, 80, u64::MAX), Err(ApproveError::ZeroId));
    let free = Config { min_score: 0, ..c };
    assert_eq!(check_approval(&free, &entries, count, wallet(1), 7, 70, 0, u64::MAX), Err(ApproveError::ZeroAmount));
}

#[test]
fn approval_enforces_contributor_and_round_caps() {
    let c = cfg();
    // Two full payouts reach the 0.2 RLO contributor cap.
    let (entries, count) = ledger(&[verified(1, 7, 70, RLO / 10), verified(1, 7, 71, RLO / 10)]);
    assert_eq!(check_approval(&c, &entries, count, wallet(1), 7, 72, 60, u64::MAX), Err(ApproveError::ContributorCap));
    // Another contributor still fits.
    assert_eq!(check_approval(&c, &entries, count, wallet(2), 8, 72, 100, u64::MAX), Ok(RLO / 10));

    // Five full payouts reach the 0.5 RLO round cap.
    let (entries, count) = ledger(&[
        verified(1, 1, 1, RLO / 10),
        verified(2, 2, 2, RLO / 10),
        verified(3, 3, 3, RLO / 10),
        verified(4, 4, 4, RLO / 10),
        verified(5, 5, 5, RLO / 10),
    ]);
    assert_eq!(check_approval(&c, &entries, count, wallet(6), 6, 6, 60, u64::MAX), Err(ApproveError::RoundCap));
}

#[test]
fn failed_verification_releases_budget_but_inconclusive_keeps_it() {
    let c = cfg();
    let mut failed = verified(1, 7, 70, RLO / 10);
    failed.status = entry::FAILED;
    let (entries, count) = ledger(&[failed, verified(1, 7, 71, RLO / 10)]);
    assert_eq!(check_approval(&c, &entries, count, wallet(1), 7, 72, 100, u64::MAX), Ok(RLO / 10));

    let mut inconclusive = failed;
    inconclusive.status = entry::INCONCLUSIVE;
    let (entries, count) = ledger(&[inconclusive, verified(1, 7, 71, RLO / 10)]);
    assert_eq!(check_approval(&c, &entries, count, wallet(1), 7, 72, 100, u64::MAX), Err(ApproveError::ContributorCap));
}

#[test]
fn approval_rejects_duplicates_and_identity_splits() {
    let c = cfg();
    let (entries, count) = ledger(&[verified(1, 7, 70, RLO / 20)]);
    assert_eq!(check_approval(&c, &entries, count, wallet(2), 8, 70, 80, u64::MAX), Err(ApproveError::DuplicatePost));
    // Same X account, second wallet: would let one person split the cap.
    assert_eq!(check_approval(&c, &entries, count, wallet(2), 7, 71, 80, u64::MAX), Err(ApproveError::IdentityMismatch));
    // Same wallet, second X account.
    assert_eq!(check_approval(&c, &entries, count, wallet(1), 8, 71, 80, u64::MAX), Err(ApproveError::IdentityMismatch));
}

#[test]
fn approval_stops_at_ledger_capacity() {
    let c = Config { cap_per_round: u64::MAX / 2, ..cfg() };
    let list: Vec<Entry> = (0..MAX_ENTRIES as u64)
        .map(|i| verified(i as u8 + 1, i + 1, i + 1, 1))
        .collect();
    let (entries, count) = ledger(&list);
    assert_eq!(check_approval(&c, &entries, count, wallet(99), 99, 99, 80, u64::MAX), Err(ApproveError::LedgerFull));
}

#[test]
fn consensus_requires_every_output_to_agree() {
    let a: &[u8] = b"MX1|1|2|2026-10-23T06:00:00.000Z";
    let b: &[u8] = b"MX1|1|3|2026-10-23T06:00:00.000Z";
    assert_eq!(consensus([Vote::Success(a); 4]), Consensus::Unanimous(a.to_vec()));
    assert_eq!(
        consensus([Vote::Success(a), Vote::Success(a), Vote::Success(b), Vote::Success(a)]),
        Consensus::NotUnanimous { outputs: 4, success: 4 }
    );
    assert_eq!(
        consensus([Vote::Success(a), Vote::Success(a), Vote::Success(a), Vote::Bad]),
        Consensus::NotUnanimous { outputs: 4, success: 3 }
    );
    // Too few validators to count, even if they agree.
    assert_eq!(
        consensus([Vote::Success(a), Vote::Success(a)]),
        Consensus::NotUnanimous { outputs: 2, success: 2 }
    );
    assert_eq!(consensus([]), Consensus::NotUnanimous { outputs: 0, success: 0 });
    let empty: &[u8] = b"";
    assert_eq!(consensus([Vote::Success(empty); 4]), Consensus::NotUnanimous { outputs: 4, success: 4 });
    let long = [b'x'; MAX_PROOF_BYTES + 1];
    assert_eq!(
        consensus([Vote::Success(&long); 4]),
        Consensus::NotUnanimous { outputs: 4, success: 4 }
    );
}

#[test]
fn rfc3339_parsing() {
    // The real response from the Phase 2 merit-x proof (post 20).
    assert_eq!(parse_rfc3339_utc_ms("2006-03-21T20:50:14.000Z"), Some(1_142_974_214_000));
    assert_eq!(parse_rfc3339_utc_ms("1970-01-01T00:00:00Z"), Some(0));
    assert_eq!(parse_rfc3339_utc_ms("2024-02-29T23:59:59.999Z"), Some(1_709_251_199_999));
    assert_eq!(parse_rfc3339_utc_ms("2023-02-29T00:00:00Z"), None);
    assert_eq!(parse_rfc3339_utc_ms("2026-10-23T06:00:00+02:00"), None);
    assert_eq!(parse_rfc3339_utc_ms("2026-13-01T00:00:00Z"), None);
    assert_eq!(parse_rfc3339_utc_ms("2026-10-23 06:00:00Z"), None);
    assert_eq!(parse_rfc3339_utc_ms("2026-10-23T06:00:00.5Z"), None);
    assert_eq!(parse_rfc3339_utc_ms(""), None);
}

#[test]
fn proof_parsing() {
    assert_eq!(
        parse_post_proof(b"MX1|20|12|2006-03-21T20:50:14.000Z"),
        Some(PostProof { post_id: 20, author_id: 12, created_ms: 1_142_974_214_000 })
    );
    assert_eq!(parse_post_proof(b"MX2|20|12|2006-03-21T20:50:14.000Z"), None);
    assert_eq!(parse_post_proof(b"MX1|20|12"), None);
    assert_eq!(parse_post_proof(b"MX1|20|12|2006-03-21T20:50:14.000Z|x"), None);
    assert_eq!(parse_post_proof(b"MX1|-20|12|2006-03-21T20:50:14.000Z"), None);
    assert_eq!(parse_post_proof(b"MX1|20|+12|2006-03-21T20:50:14.000Z"), None);
    assert_eq!(parse_post_proof(b"MX1|99999999999999999999|12|2006-03-21T20:50:14.000Z"), None);
}

#[test]
fn proof_must_match_post_author_and_round() {
    let proof = PostProof { post_id: 20, author_id: 12, created_ms: NOW + 10 };
    assert_eq!(judge_proof(&proof, 20, 12, NOW, NOW + 300_000), Verdict::Verified);
    assert_eq!(judge_proof(&proof, 21, 12, NOW, NOW + 300_000), Verdict::WrongPost);
    assert_eq!(judge_proof(&proof, 20, 13, NOW, NOW + 300_000), Verdict::WrongAuthor);
    assert_eq!(judge_proof(&proof, 20, 12, NOW + 11, NOW + 300_000), Verdict::OutsideRound);
    assert_eq!(judge_proof(&proof, 20, 12, NOW - 300_000, NOW + 10), Verdict::OutsideRound);
}

#[test]
fn settlement_pays_in_order_within_balance() {
    let c = cfg();
    let (entries, count) = ledger(&[
        verified(1, 1, 1, 50_000_000),
        verified(2, 2, 2, 80_000_000),
        verified(3, 3, 3, 30_000_000),
    ]);
    let mut outcome = [settle::TODO; MAX_ENTRIES];
    let mut paid = 0;
    let mut available = 120_000_000;
    let mut payouts = Vec::new();
    loop {
        match next_step(&c, &entries, count, &mut outcome, paid, available, false, u64::MAX) {
            Step::Pay { index, amount } => {
                outcome[index] = settle::PAID;
                paid += amount;
                available -= amount;
                payouts.push(index);
            }
            Step::WaitFunds { index } => {
                // Entry 2 (30M) would fit, but approval order holds: stop at entry 1.
                assert_eq!(index, 1);
                break;
            }
            other => panic!("unexpected {other:?}"),
        }
    }
    assert_eq!(payouts, vec![0]);
    assert_eq!(available, 70_000_000);

    // The owner tops up; settlement resumes where it stopped.
    available += 100_000_000;
    let mut rest = Vec::new();
    loop {
        match next_step(&c, &entries, count, &mut outcome, paid, available, false, u64::MAX) {
            Step::Pay { index, amount } => {
                outcome[index] = settle::PAID;
                paid += amount;
                available -= amount;
                rest.push(index);
            }
            Step::Done => break,
            other => panic!("unexpected {other:?}"),
        }
    }
    assert_eq!(rest, vec![1, 2]);
    assert_eq!(paid, 160_000_000);
}

#[test]
fn settlement_waits_for_pending_then_skips_after_grace() {
    let c = cfg();
    let mut pending = verified(1, 1, 1, 10);
    pending.status = entry::PENDING;
    let (entries, count) = ledger(&[pending, verified(2, 2, 2, 10)]);
    let mut outcome = [settle::TODO; MAX_ENTRIES];
    assert_eq!(next_step(&c, &entries, count, &mut outcome, 0, RLO, false, u64::MAX), Step::WaitVerification);
    assert_eq!(outcome[0], settle::TODO);
    assert_eq!(next_step(&c, &entries, count, &mut outcome, 0, RLO, true, u64::MAX), Step::Pay { index: 1, amount: 10 });
    assert_eq!(outcome[0], settle::SKIPPED_UNVERIFIED);
}

#[test]
fn settlement_skips_failed_and_over_cap_entries() {
    let c = cfg();
    let mut failed = verified(1, 1, 1, 10);
    failed.status = entry::FAILED;
    // A ledger cannot normally hold an over-cap entry; settlement re-checks anyway.
    let over = verified(2, 2, 2, c.cap_per_payout + 1);
    let (entries, count) = ledger(&[failed, over, verified(3, 3, 3, 10)]);
    let mut outcome = [settle::TODO; MAX_ENTRIES];
    assert_eq!(next_step(&c, &entries, count, &mut outcome, 0, RLO, false, u64::MAX), Step::Pay { index: 2, amount: 10 });
    assert_eq!(outcome[0], settle::SKIPPED_UNVERIFIED);
    assert_eq!(outcome[1], settle::SKIPPED_CAP);

    // Contributor cap counts only what this round already paid them.
    let (entries, count) = ledger(&[verified(1, 1, 1, RLO / 10), verified(1, 1, 2, RLO / 10), verified(1, 1, 3, RLO / 10)]);
    let mut outcome = [settle::PAID, settle::PAID, settle::TODO, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    assert_eq!(next_step(&c, &entries, count, &mut outcome, RLO / 5, RLO, false, u64::MAX), Step::Done);
    assert_eq!(outcome[2], settle::SKIPPED_CAP);

    // Round cap counts the running round total.
    let (entries, count) = ledger(&[verified(1, 1, 1, 10)]);
    let mut outcome = [settle::TODO; MAX_ENTRIES];
    assert_eq!(next_step(&c, &entries, count, &mut outcome, c.cap_per_round - 9, RLO, false, u64::MAX), Step::Done);
    assert_eq!(outcome[0], settle::SKIPPED_CAP);
}

#[test]
fn settlement_never_pays_an_entry_twice() {
    let c = cfg();
    let (entries, count) = ledger(&[verified(1, 1, 1, 10)]);
    let mut outcome = [settle::TODO; MAX_ENTRIES];
    assert_eq!(next_step(&c, &entries, count, &mut outcome, 0, RLO, false, u64::MAX), Step::Pay { index: 0, amount: 10 });
    outcome[0] = settle::PAID;
    assert_eq!(next_step(&c, &entries, count, &mut outcome, 10, RLO, false, u64::MAX), Step::Done);
}

#[test]
fn abandon_marks_only_verified_as_unfunded() {
    let mut pending = verified(2, 2, 2, 10);
    pending.status = entry::PENDING;
    let (entries, count) = ledger(&[verified(1, 1, 1, 10), pending, verified(3, 3, 3, 10)]);
    let mut outcome = [settle::TODO; MAX_ENTRIES];
    outcome[0] = settle::PAID;
    assert_eq!(abandon_unfunded(&entries, count, &mut outcome), 1);
    assert_eq!(&outcome[..3], &[settle::PAID, settle::SKIPPED_UNVERIFIED, settle::UNFUNDED]);
}

#[test]
fn withdraw_only_unreserved_escrow() {
    assert_eq!(unreserved(phase::IDLE, 100, 30), 100);
    assert_eq!(unreserved(phase::ENDED, 100, 30), 100);
    assert_eq!(unreserved(phase::OPEN, 100, 30), 70);
    assert_eq!(unreserved(phase::OPEN, 20, 30), 0);
    assert_eq!(unreserved(phase::SETTLING, 100, 30), 0);
    assert_eq!(unreserved(phase::WAITING_FUNDS, 100, 30), 0);
    assert_eq!(unreserved(phase::REFUNDED, 100, 30), 0);
}

#[test]
fn rounds_stop_at_the_refund_deadline() {
    assert_eq!(next_round_window(NOW, 300_000, NOW + 1_000_000), Some((NOW, NOW + 300_000)));
    assert_eq!(next_round_window(NOW, 300_000, NOW + 120_000), Some((NOW, NOW + 120_000)));
    assert_eq!(next_round_window(NOW, 300_000, NOW + 59_999), None);
    assert_eq!(next_round_window(NOW, 300_000, NOW), None);
}

#[test]
fn ledger_seed_is_unique_per_campaign_and_round() {
    let a = ledger_seed(&[1; 32], 1);
    assert_eq!(&a[..12], b"merit-ledger");
    assert_ne!(a, ledger_seed(&[1; 32], 2));
    assert_ne!(a, ledger_seed(&[2; 32], 1));
}

#[test]
fn verification_is_done_when_every_entry_is_final_or_grace_passed() {
    let mut pending = verified(2, 2, 2, 10);
    pending.status = entry::PENDING;
    let mut retriable = verified(3, 3, 3, 10);
    retriable.status = entry::INCONCLUSIVE;
    let mut exhausted = retriable;
    exhausted.attempts = MAX_VERIFY_ATTEMPTS;
    let mut failed = verified(4, 4, 4, 10);
    failed.status = entry::FAILED;

    let (entries, count) = ledger(&[verified(1, 1, 1, 10), failed, exhausted]);
    assert!(verification_done(&entries, count, false));
    let (entries, count) = ledger(&[verified(1, 1, 1, 10), pending]);
    assert!(!verification_done(&entries, count, false));
    assert!(verification_done(&entries, count, true));
    let (entries, count) = ledger(&[retriable]);
    assert!(!verification_done(&entries, count, false));
    let (entries, count) = ledger(&[]);
    assert!(verification_done(&entries, count, false));
}

#[test]
fn ops_budget_gates_verifications_and_repays_the_agent() {
    let rent = 20_000_000;
    let mut twice = verified(2, 2, 2, 10);
    twice.attempts = 2;
    let (entries, count) = ledger(&[verified(1, 1, 1, 10), twice]);
    assert_eq!(verification_cost(&entries, count), 3 * REX_COST_KELVIN);

    // Exactly enough for one more attempt plus rent.
    let exact = 4 * REX_COST_KELVIN + rent;
    assert!(ops_budget_allows_verification(exact, &entries, count, rent));
    assert!(!ops_budget_allows_verification(exact - 1, &entries, count, rent));
    // The first approval of a round must also cover the ledger rent.
    let (empty, none) = ledger(&[]);
    assert!(!ops_budget_allows_verification(REX_COST_KELVIN, &empty, none, rent));

    assert_eq!(reimbursement(RLO, &entries, count, rent), 3 * REX_COST_KELVIN + rent);
    assert_eq!(reimbursement(1_000, &entries, count, rent), 1_000);
}

#[test]
fn ops_budget_is_withdrawable_only_between_rounds() {
    assert_eq!(unreserved_ops(phase::IDLE, 50), 50);
    assert_eq!(unreserved_ops(phase::ENDED, 50), 50);
    for busy in [phase::OPEN, phase::SETTLING, phase::WAITING_FUNDS, phase::REFUNDED] {
        assert_eq!(unreserved_ops(busy, 50), 0);
    }
}

#[test]
fn hex_decoding() {
    assert_eq!(decode_hex("00ff7Aa0"), Some(vec![0x00, 0xff, 0x7a, 0xa0]));
    assert_eq!(decode_hex(""), None);
    assert_eq!(decode_hex("abc"), None);
    assert_eq!(decode_hex("zz"), None);
    assert_eq!(decode_hex("0x00"), None);
}

// ---------------------------------------------------------------------------
// Program v2
// ---------------------------------------------------------------------------

const MIN: u64 = 60_000;

#[test]
fn grace_takes_approvals_after_close_until_settlement_may_start() {
    let end = NOW + 30 * MIN;
    let grace = effective_grace(SUBMIT_GRACE_MS, 30 * MIN);
    assert_eq!(grace, 5 * MIN);
    assert!(accepts_approvals(phase::OPEN, false, end - 1, end, grace));
    assert!(accepts_approvals(phase::SETTLING, false, end + 4 * MIN, end, grace));
    assert!(!accepts_approvals(phase::SETTLING, false, end + 5 * MIN, end, grace));
    assert!(!settlement_may_start(end + 4 * MIN, end, grace, NOW + 86_400_000));
    assert!(settlement_may_start(end + 5 * MIN, end, grace, NOW + 86_400_000));
    // The refund deadline outranks the grace.
    assert!(settlement_may_start(end + MIN, end, grace, end + MIN));
    // v1 behaviour with no grace.
    assert!(!accepts_approvals(phase::SETTLING, false, end, end, 0));
    // Paused, waiting for funds or awaiting the owner: no approvals.
    assert!(!accepts_approvals(phase::OPEN, true, end - 1, end, grace));
    assert!(!accepts_approvals(phase::WAITING_FUNDS, false, end, end, grace));
    assert!(!accepts_approvals(phase::AWAITING_APPROVAL, false, end, end, grace));
    // At most half a round.
    assert_eq!(effective_grace(SUBMIT_GRACE_MS, 2 * MIN), MIN);
}

#[test]
fn next_round_starts_where_the_last_ended() {
    let deadline = NOW + 86_400_000;
    let prev_end = NOW;
    // Opened after a 5-minute grace: still covers posts written in the gap.
    assert_eq!(next_round_window_after(prev_end, NOW + 5 * MIN, 30 * MIN, deadline), Some((NOW, NOW + 30 * MIN)));
    // A short round still stays open at least a minute.
    assert_eq!(next_round_window_after(prev_end, NOW + 2 * MIN, 2 * MIN, deadline), Some((NOW, NOW + 3 * MIN)));
    // After a long wait (funds, owner approval), back-dated one round at most.
    assert_eq!(next_round_window_after(prev_end, NOW + 600 * MIN, 30 * MIN, deadline), Some((NOW + 570 * MIN, NOW + 601 * MIN)));
    // Cut at the deadline; none when it is too close.
    assert_eq!(next_round_window_after(prev_end, NOW + MIN, 30 * MIN, NOW + 10 * MIN), Some((NOW, NOW + 10 * MIN)));
    assert_eq!(next_round_window_after(prev_end, NOW + MIN, 30 * MIN, NOW + MIN + 59_999), None);
}

#[test]
fn rolling_day_cap_counts_the_last_24_hours() {
    let mut hours = [0u64; DAY_BUCKETS];
    let mut paid = [0u64; DAY_BUCKETS];
    let t = 1_000 * HOUR_MS;
    record_payout(&mut hours, &mut paid, t, 100);
    record_payout(&mut hours, &mut paid, t + 10, 50);
    record_payout(&mut hours, &mut paid, t + 5 * HOUR_MS, 30);
    assert_eq!(rolling_paid(&hours, &paid, t + 5 * HOUR_MS), 180);
    assert_eq!(day_room(500, &hours, &paid, t + 5 * HOUR_MS), 320);
    assert_eq!(day_room(0, &hours, &paid, t), u64::MAX);
    // 24 hours later the first bucket has left the window...
    assert_eq!(rolling_paid(&hours, &paid, t + 24 * HOUR_MS), 30);
    // ...and is recycled by a payout in the same slot.
    record_payout(&mut hours, &mut paid, t + 24 * HOUR_MS, 7);
    assert_eq!(rolling_paid(&hours, &paid, t + 24 * HOUR_MS), 37);
    assert_eq!(day_room(150, &hours, &paid, t), 150);
}

#[test]
fn daily_cap_at_approval_and_at_payout() {
    let c = cfg();
    let (entries, count) = ledger(&[verified(1, 11, 101, RLO / 10)]);
    // 0.1 already owed this round + 0.08 new > 0.15 left today.
    assert_eq!(check_approval(&c, &entries, count, wallet(2), 12, 102, 80, RLO * 15 / 100), Err(ApproveError::DailyCap));
    assert_eq!(check_approval(&c, &entries, count, wallet(2), 12, 102, 80, RLO / 5), Ok(RLO * 8 / 100));
    let mut outcome = [settle::TODO; MAX_ENTRIES];
    assert_eq!(next_step(&c, &entries, count, &mut outcome, 0, RLO, true, RLO / 20), Step::Done);
    assert_eq!(outcome[0], settle::SKIPPED_DAILY);
}

#[test]
fn revoked_entries_release_caps_and_are_never_paid() {
    let c = cfg();
    let revoked = Entry { status: entry::REVOKED, ..verified(1, 11, 101, RLO / 10) };
    let (entries, count) = ledger(&[revoked, verified(1, 11, 102, RLO / 10)]);
    // The revoked 0.1 no longer counts against the contributor's 0.2.
    assert_eq!(check_approval(&c, &entries, count, wallet(1), 11, 103, 100, u64::MAX), Ok(RLO / 10));
    assert!(verification_done(&entries, count, false));
    let mut outcome = [settle::TODO; MAX_ENTRIES];
    assert_eq!(next_step(&c, &entries, count, &mut outcome, 0, RLO, true, u64::MAX), Step::Pay { index: 1, amount: RLO / 10 });
    assert_eq!(outcome[0], settle::REVOKED);
    // A revoked post can't be approved again in the same round.
    assert_eq!(check_approval(&c, &entries, count, wallet(1), 11, 101, 100, u64::MAX), Err(ApproveError::DuplicatePost));
}

#[test]
fn large_rounds_wait_for_the_owner() {
    let (entries, count) = ledger(&[verified(1, 11, 101, RLO / 10), verified(2, 12, 102, RLO / 10), Entry { status: entry::FAILED, ..verified(3, 13, 103, RLO / 10) }]);
    let mut outcome = [settle::TODO; MAX_ENTRIES];
    assert_eq!(round_due(&entries, count, &outcome), RLO / 5);
    assert!(needs_owner_approval(RLO / 10, RLO / 5, false));
    assert!(!needs_owner_approval(RLO / 10, RLO / 5, true));
    assert!(!needs_owner_approval(0, RLO / 5, false));
    assert!(!needs_owner_approval(RLO / 5, RLO / 5, false));
    outcome[0] = settle::PAID;
    assert_eq!(round_due(&entries, count, &outcome), RLO / 10);
    assert_eq!(unreserved(phase::AWAITING_APPROVAL, RLO, RLO / 2), 0);
    assert_eq!(unreserved_ops(phase::AWAITING_APPROVAL, RLO), 0);
}

#[test]
fn payee_cooldown_and_limits() {
    assert!(payee_ready(0, NOW, NOW));
    assert!(!payee_ready(3_600_000, NOW, NOW + 3_599_999));
    assert!(payee_ready(3_600_000, NOW, NOW + 3_600_000));
    let c = cfg();
    assert!(validate_limits(&c, 0, 0, 0));
    assert!(validate_limits(&c, RLO, 86_400_000, SUBMIT_GRACE_MS));
    assert!(!validate_limits(&c, RLO / 20, 0, 0)); // below one payout
    assert!(!validate_limits(&c, 0, MAX_COOLDOWN_MS + 1, 0));
    assert!(!validate_limits(&c, 0, 0, MAX_SUBMIT_GRACE_MS + 1));
}

// ── Program v3: audit fixes ──

#[test]
fn h1_a_prefunded_ledger_address_reads_as_no_ledger() {
    assert!(ledger_absent(0, 0, false), "nothing there");
    assert!(ledger_absent(0, 1, false), "1 kelvin sent by a stranger");
    assert!(ledger_absent(0, 890_880, false), "rent minimum sent by a stranger");
    assert!(!ledger_absent(3_000, 30_000_000, true), "a real ledger");
    assert!(!ledger_absent(3_000, 30_000_000, false), "data owned by someone else is never an empty ledger");
    assert!(!ledger_absent(0, 5, true), "a program-owned account is never treated as absent once it holds kelvin");
}

#[test]
fn m1_settlement_is_stuck_only_after_stuck_ms_without_progress() {
    assert!(!settlement_stuck(phase::SETTLING, NOW, NOW + STUCK_MS - 1));
    assert!(settlement_stuck(phase::SETTLING, NOW, NOW + STUCK_MS));
    for p in [phase::IDLE, phase::OPEN, phase::WAITING_FUNDS, phase::ENDED, phase::REFUNDED, phase::AWAITING_APPROVAL] {
        assert!(!settlement_stuck(p, NOW, NOW + 10 * STUCK_MS), "phase {p}");
    }
}

#[test]
fn m2_a_ledger_takes_the_campaigns_earlier_end_after_an_early_close() {
    let end = NOW + 300_000;
    assert_eq!(synced_round_end(end, NOW + 60_000), NOW + 60_000, "closed early: the ledger shrinks");
    assert_eq!(synced_round_end(end, end), end);
    assert_eq!(synced_round_end(end, end + 300_000), end, "never grows");
    // A post written after the early close fails round N's window and is judged in round N+1 only.
    let proof = PostProof { post_id: 7, author_id: 9, created_ms: NOW + 120_000 };
    assert_eq!(judge_proof(&proof, 7, 9, NOW, synced_round_end(end, NOW + 60_000)), Verdict::OutsideRound);
}

#[test]
fn m3_limits_freeze_while_a_round_settles() {
    for p in [phase::SETTLING, phase::WAITING_FUNDS, phase::AWAITING_APPROVAL] {
        assert!(!limits_change_allowed(p, (RLO, RLO / 2), (0, 0)), "lowering the daily cap in phase {p}");
        assert!(!limits_change_allowed(p, (RLO, RLO), (0, 1)), "adding an approval threshold in phase {p}");
        assert!(limits_change_allowed(p, (RLO, RLO), (5, 5)), "cooldown/grace only in phase {p}");
    }
    for p in [phase::IDLE, phase::OPEN, phase::ENDED] {
        assert!(limits_change_allowed(p, (RLO, 0), (0, 1)), "phase {p}");
    }
}
