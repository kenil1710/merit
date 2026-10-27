//! Source-level guards for invariants the Venus program relies on but the
//! compiler cannot see.

const PROGRAM_SOURCE: &str = include_str!("../src/lib.rs");

fn state_block() -> &'static str {
    let start = PROGRAM_SOURCE.find("state {").expect("state block");
    let end = PROGRAM_SOURCE[start..].find("\n        }").expect("state block end");
    &PROGRAM_SOURCE[start + "state {".len()..start + end]
}

/// Venus resizes the workflow PDA to the serialized state after every call
/// and moves the rent difference to or from the payer, which would sweep or
/// drain escrow. Every field must therefore keep one size forever: fixed-size
/// scalars, or vectors that `reserve_tables` sizes once at creation.
#[test]
fn state_is_fixed_width() {
    let mut vectors = Vec::new();
    for line in state_block().lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("//") {
            continue;
        }
        let (name, ty) = line.trim_end_matches(',').split_once(':').expect("field");
        let ty = ty.trim();
        match ty {
            "u64" | "bool" | "Pubkey" | "EncryptedInput<String>" => {}
            "Vec<u64>" | "Vec<Pubkey>" => vectors.push(name.trim().to_string()),
            other => panic!("state field `{}` has non-fixed-width type `{}`", name.trim(), other),
        }
    }
    assert!(!vectors.is_empty());
    let reserve = &PROGRAM_SOURCE[PROGRAM_SOURCE.find("fn reserve_tables").expect("reserve_tables")..];
    let reserve = &reserve[..reserve.find("\n            }").expect("reserve_tables end")];
    for name in vectors {
        assert!(
            reserve.contains(&format!("self.{name} = vec![")),
            "`{name}` is not sized in reserve_tables"
        );
    }
}

/// `EncryptedInput` and the vectors are written only at creation.
#[test]
fn variable_fields_are_only_assigned_in_initializers() {
    for (index, _) in PROGRAM_SOURCE.match_indices("self.x_token =") {
        let before = &PROGRAM_SOURCE[..index];
        let function = before.rfind(" fn ").map(|at| &before[at..]).unwrap_or("");
        assert!(function.starts_with(" fn open_ledger"), "x_token assigned outside open_ledger");
    }
}

/// Every reactive handler must ignore timers from a retired chain.
#[test]
fn campaign_handlers_check_the_timer_epoch() {
    for handler in ["handler fn beat", "handler fn settle_peek", "handler fn settle_pay"] {
        let start = PROGRAM_SOURCE.find(handler).expect(handler);
        let body = &PROGRAM_SOURCE[start..start + 1_200];
        assert!(body.contains("epoch != self.timer_epoch"), "{handler} skips the epoch check");
    }
}

/// The REX callback must authenticate the report account before trusting it.
#[test]
fn on_verify_authenticates_the_report_account() {
    let start = PROGRAM_SOURCE.find("handler fn on_verify").expect("on_verify");
    let body = &PROGRAM_SOURCE[start..];
    let check = body.find("report_account.owner != &rialo_rex_processor_interface::ID").expect("owner check");
    let use_of_updates = body.find("&report.updates").expect("report use");
    assert!(check < use_of_updates, "report is read before it is authenticated");
    assert!(body[..use_of_updates].contains("report_account.key != &self.e_report[slot]"));
}

/// Kelvin leaves the campaign PDA only through `release`.
#[test]
fn escrow_moves_only_through_release() {
    assert_eq!(PROGRAM_SOURCE.matches("try_borrow_mut_kelvins").count(), 2);
    let release = PROGRAM_SOURCE.find("fn release").expect("release");
    for (index, _) in PROGRAM_SOURCE.match_indices("try_borrow_mut_kelvins") {
        assert!(index > release && index < release + 1_500);
    }
}

/// `ReadAccountInfo::from(x)` / `WriteAccountInfo::from(x)` calls exist only so
/// the account is passed with the instruction; the program looks every
/// caller-named account up by key and never uses their results directly.
#[test]
fn caller_named_accounts_are_resolved_by_key() {
    for marker in ["ReadAccountInfo::from(", "WriteAccountInfo::from("] {
        for (index, _) in PROGRAM_SOURCE.match_indices(marker) {
            let line_start = PROGRAM_SOURCE[..index].rfind('\n').unwrap_or(0);
            let line = PROGRAM_SOURCE[line_start..index].trim();
            if line.starts_with("//") {
                continue;
            }
            assert_eq!(line, "let _ =", "the result of {marker} must be discarded");
        }
    }
    assert!(PROGRAM_SOURCE.contains(".find(|account| account.key == key)"));
}

/// Program v2 fields come after `x_token` and before Venus's REX bytecode
/// field, so `apps/web/lib/merit/state.ts` can tell v1 accounts (nothing after
/// `x_token` but that field) from v2 ones, in this exact order.
#[test]
fn v2_fields_follow_x_token_in_decoder_order() {
    let fields: Vec<&str> = state_block()
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("//"))
        .map(|l| l.split(':').next().unwrap().trim())
        .collect();
    let at = fields.iter().position(|f| *f == "x_token").expect("x_token");
    assert_eq!(
        &fields[at + 1..],
        &[
            "paused", "max_per_day", "approval_threshold", "cooldown_ms", "submit_grace_ms", "round_approved",
            "day_hours", "day_paid", "payee_x_user", "payee_wallet", "payee_since_ms",
        ]
    );
}

fn body_of(signature: &str) -> &'static str {
    let start = PROGRAM_SOURCE.find(signature).expect(signature);
    let rest = &PROGRAM_SOURCE[start..];
    let end = rest[1..].find("\n            // ").map(|e| e + 1).unwrap_or(rest.len());
    &rest[..end]
}

/// Approvals and ledgers follow one gate: the round is open or inside its
/// grace, and the campaign isn't paused.
#[test]
fn approvals_use_the_grace_and_pause_gate() {
    for f in ["initiating fn open_ledger", "control fn approve("] {
        assert!(body_of(f).contains("Self::takes_approvals(&parent, now)"), "{f} skips the gate");
    }
    assert!(body_of("control fn approve(").contains("rules::payee_ready(parent.cooldown_ms"));
    assert!(body_of("control fn approve(").contains("day_room"));
}

/// Settlement waits out a pause and the grace before it reimburses or pays,
/// asks the owner above the threshold, and counts every payout in the day.
#[test]
fn settlement_respects_pause_grace_threshold_and_day() {
    let peek = body_of("handler fn settle_peek");
    let wait = peek.find("rules::settlement_may_start").expect("grace wait");
    assert!(peek.find("self.paused").expect("pause wait") < wait);
    assert!(wait < peek.find("settle_reimburse").expect("reimburse"));
    assert!(peek.find("needs_owner_approval").expect("threshold") < peek.find("rules::next_step").expect("plan"));
    let pay = body_of("handler fn settle_pay");
    assert!(pay.contains("rules::record_payout"));
    assert!(pay.contains("day_room"));
}
