//! merit: campaign escrow, round ledgers, reactive settlement and REX
//! verification of X posts on Rialo DevNet.
//!
//! One program, two workflow kinds sharing one fixed-width state:
//!
//! - **Campaign** (`kind::CAMPAIGN`), created by the owner. Holds the RLO
//!   escrow, the caps and the round clock. While a round is open a native
//!   `AFTER` heartbeat re-arms itself every `BEAT_MS`; when the round ends the
//!   same chain settles it, one payout per step, then opens the next round,
//!   ends, or refunds at the deadline. Nothing off-chain drives it.
//! - **Ledger** (`kind::LEDGER`), created by the agent authority, one per
//!   campaign round at a PDA seeded by `merit_core::ledger_seed`. The agent
//!   records AI-approved submissions here; the program computes each amount
//!   from the score and enforces the caps. Every approval then starts a REX
//!   `http::get` of the X post through the `merit-x` latch; only a unanimous
//!   report that names the approved post, author and round marks it verified.
//!
//! REX verifications and ledger rent are paid by the agent (the creator of
//! those accounts) and repaid at settlement from the campaign's operations
//! budget, which the owner funds separately from the payout escrow. When the
//! budget cannot cover another verification, approvals stop.
//!
//! Venus derives a workflow PDA from the transaction payer, so only the owner
//! can drive a campaign and only the agent can write its ledgers. Settlement
//! reads the ledger at the address it derives itself and pays only verified
//! entries, so a forged ledger is never consulted. The agent is a plain
//! pubkey in campaign state and can be rotated by the owner (`set_agent`), for
//! example to the Privy wallet behind the `merit-payout-signer` latch.
//!
//! All state here is fixed-width from creation (`reserve_tables`), so the
//! account never changes size and the escrow never moves except through the
//! explicit transfers below.

use rialo_venus_proc_macro::rialo;

rialo! {
    workflow {
        state {
            kind: u64,
            owner: Pubkey,
            agent: Pubkey,
            next_agent: Pubkey,
            campaign: Pubkey,
            rate_kelvin: u64,
            min_score: u64,
            cap_per_payout: u64,
            cap_per_contributor: u64,
            cap_per_round: u64,
            round_length_ms: u64,
            next_round_length_ms: u64,
            refund_deadline_ms: u64,
            phase: u64,
            ending: bool,
            // Timers carry the epoch they were armed in; `resume` bumps it so
            // a stale chain dies when it fires instead of running twice.
            timer_epoch: u64,
            escrow_kelvin: u64,
            total_funded: u64,
            total_paid: u64,
            total_withdrawn: u64,
            total_refunded: u64,
            // Campaign: operations budget, kept apart from the payout escrow.
            // It repays the agent for REX verifications and ledger rent.
            ops_budget_kelvin: u64,
            total_ops_funded: u64,
            total_ops_reimbursed: u64,
            round_reimbursed: bool,
            round: u64,
            round_start_ms: u64,
            round_end_ms: u64,
            round_agent: Pubkey,
            beats: u64,
            last_beat_ms: u64,
            round_paid_kelvin: u64,
            // Campaign: settlement outcome per ledger index (`settle::*`).
            outcome: Vec<u64>,
            // Ledger: approvals in order. Parallel fixed-length vectors.
            entry_count: u64,
            e_contributor: Vec<Pubkey>,
            e_x_user: Vec<u64>,
            e_post: Vec<u64>,
            e_score: Vec<u64>,
            e_amount: Vec<u64>,
            e_hash: Vec<Pubkey>,
            e_status: Vec<u64>,
            e_attempts: Vec<u64>,
            e_checked_ms: Vec<u64>,
            // Ledger: the REX report PDA each entry's latest verification
            // must arrive in (see `run_verify` / `on_verify`).
            e_report: Vec<Pubkey>,
            // Ledger: the merit-x `lat_` token, encrypted to the REX TEE key
            // for this ledger's payer (the agent). Validators decrypt it only
            // inside the enclave; it is never plaintext on chain.
            x_token: EncryptedInput<String>,
            // Program v2. Campaign: pause, limits and the rolling day.
            paused: bool,
            max_per_day: u64,
            approval_threshold: u64,
            cooldown_ms: u64,
            submit_grace_ms: u64,
            round_approved: bool,
            day_hours: Vec<u64>,
            day_paid: Vec<u64>,
            // Payee: the wallet the agent registered for an X account, and
            // since when (the cooldown runs from there).
            payee_x_user: u64,
            payee_wallet: Pubkey,
            payee_since_ms: u64,
        }

        rex {
            pub fn fetch_post(post_id: u64, campaign: String, token: String) -> Result<String, String> {
                use rialo::rex_component::http;
                use serde_json::Value;

                // merit-x requires X-Merit-Campaign on every call, validators
                // included; the value is the ledger's campaign address (base58).
                let campaign_ok = (32..=44).contains(&campaign.len())
                    && campaign.bytes().all(|b| b.is_ascii_alphanumeric() && !b"0OIl".contains(&b));
                if !campaign_ok {
                    return Err("bad campaign".to_string());
                }

                let url = format!(
                    "https://onlatch.com/proxy/2/tweets/{}?tweet.fields=author_id,created_at",
                    post_id
                );
                let headers = vec![
                    ("Authorization".to_string(), format!("Bearer {}", token.trim())),
                    ("Accept".to_string(), "application/json".to_string()),
                    ("User-Agent".to_string(), "Merit-REX/0.2".to_string()),
                    ("X-Merit-Campaign".to_string(), campaign),
                ];
                // Errors never echo the request: it carries the token.
                let response = http::get(&url, &headers, 10_000)
                    .map_err(|_| "request failed".to_string())?;
                if response.status != 200 {
                    return Err(format!("HTTP {}", response.status));
                }
                let body = serde_json::from_slice::<Value>(&response.body)
                    .map_err(|_| "invalid JSON".to_string())?;
                let data = body.get("data").ok_or_else(|| "missing data".to_string())?;
                let mut fields = Vec::new();
                for name in ["id", "author_id", "created_at"] {
                    let value = data
                        .get(name)
                        .and_then(Value::as_str)
                        .ok_or_else(|| format!("missing {}", name))?;
                    let clean = value.bytes().all(|b| {
                        b.is_ascii_alphanumeric() || b == b'-' || b == b':' || b == b'.'
                    });
                    if value.is_empty() || value.len() > 32 || !clean {
                        return Err(format!("bad {}", name));
                    }
                    fields.push(value.to_string());
                }
                // Small and deterministic: every honest validator must return
                // the same bytes for the report to count.
                Ok(format!("MX1|{}|{}|{}", fields[0], fields[1], fields[2]))
            }
        }

        program {
            use merit_core as rules;
            use rialo_rex_processor_interface::{instruction::derive_report_address, state::RexReport};
            use rialo_s_program::{
                account_info::AccountInfo, entrypoint::ProgramResult, msg, program::invoke,
                program_error::ProgramError, pubkey::Pubkey, rent::Rent, system_instruction,
                system_program, sysvar::Sysvar,
            };
            use rialo_types::{EncryptedInput, Nonce, RexData, RexOutput};
            use rialo_venus::{derive_workflow_address, read_from_storage};

            // ---------------------------------------------------------------
            // Campaign: owner instructions
            // ---------------------------------------------------------------

            initiating fn create_campaign(
                &mut self,
                agent: Pubkey,
                rate_kelvin: u64,
                min_score: u64,
                cap_per_payout: u64,
                cap_per_contributor: u64,
                cap_per_round: u64,
                round_length_ms: u64,
                refund_deadline_ms: u64,
            ) -> ProgramResult {
                self.require_signer()?;
                self.require_authorized_rex()?;
                let now = self.now_ms()?;
                let config = rules::Config {
                    rate_kelvin,
                    min_score,
                    cap_per_payout,
                    cap_per_contributor,
                    cap_per_round,
                    round_length_ms,
                    refund_deadline_ms,
                };
                if let Err(error) = rules::validate_config(&config, now) {
                    msg!("Merit rejected campaign config: {:?}", error);
                    return Err(ProgramError::InvalidArgument);
                }
                // The owner funds and the agent approves; one key must not do both.
                if agent == Pubkey::default() || agent == *self.payer_account().key {
                    msg!("Merit rejected campaign: agent must be a separate key");
                    return Err(ProgramError::InvalidArgument);
                }
                self.kind = rules::kind::CAMPAIGN;
                self.owner = *self.payer_account().key;
                self.agent = agent;
                self.next_agent = agent;
                self.round_agent = agent;
                self.campaign = self.workflow_pda();
                self.rate_kelvin = rate_kelvin;
                self.min_score = min_score;
                self.cap_per_payout = cap_per_payout;
                self.cap_per_contributor = cap_per_contributor;
                self.cap_per_round = cap_per_round;
                self.round_length_ms = round_length_ms;
                self.next_round_length_ms = round_length_ms;
                self.refund_deadline_ms = refund_deadline_ms;
                self.phase = rules::phase::IDLE;
                self.submit_grace_ms = rules::SUBMIT_GRACE_MS;
                self.reserve_tables();
                msg!(
                    "Merit campaign {} created by {} with agent {}",
                    self.campaign,
                    self.owner,
                    self.agent
                );
                Ok(())
            }

            // Moves exactly `amount_kelvin` from the owner into escrow. Funding
            // a campaign that is waiting for funds resumes its settlement.
            control fn fund(&mut self, amount_kelvin: u64) -> ProgramResult {
                self.require_campaign_owner()?;
                if amount_kelvin == 0
                    || self.ending
                    || self.phase == rules::phase::ENDED
                    || self.phase == rules::phase::REFUNDED
                {
                    return Err(ProgramError::InvalidArgument);
                }
                self.deposit(amount_kelvin)?;
                self.escrow_kelvin = self
                    .escrow_kelvin
                    .checked_add(amount_kelvin)
                    .ok_or(ProgramError::InvalidArgument)?;
                self.total_funded = self.total_funded.saturating_add(amount_kelvin);
                msg!("Merit escrow funded with {} kelvin (escrow {})", amount_kelvin, self.escrow_kelvin);
                if self.phase == rules::phase::WAITING_FUNDS {
                    self.phase = rules::phase::SETTLING;
                    self.timer_epoch = self.timer_epoch.saturating_add(1);
                    let ledger = self.round_ledger_address();
                    let epoch = self.timer_epoch;
                    let target = self.after_ms(rules::SETTLE_STEP_MS)?;
                    AFTER target CALL [settle_peek ledger: ledger epoch: epoch];
                }
                Ok(())
            }

            // Opens a round and arms the heartbeat. Later rounds open on their own.
            control fn start(&mut self) -> ProgramResult {
                self.require_campaign_owner()?;
                if self.phase != rules::phase::IDLE || self.ending || self.escrow_kelvin == 0 {
                    return Err(ProgramError::InvalidArgument);
                }
                let now = self.now_ms()?;
                let Some((start, end)) =
                    rules::next_round_window(now, self.next_round_length_ms, self.refund_deadline_ms)
                else {
                    msg!("Merit cannot start: the refund deadline is too close");
                    return Err(ProgramError::InvalidArgument);
                };
                self.open_round(start, end);
                let epoch = self.timer_epoch;
                let target = now.saturating_add(rules::BEAT_MS);
                AFTER target CALL [beat epoch: epoch];
                Ok(())
            }

            // Stops new rounds. An open round closes at the next heartbeat and
            // still settles; the rest of the escrow becomes withdrawable.
            control fn end(&mut self) -> ProgramResult {
                self.require_campaign_owner()?;
                if self.phase == rules::phase::ENDED || self.phase == rules::phase::REFUNDED {
                    return Err(ProgramError::InvalidArgument);
                }
                let now = self.now_ms()?;
                self.ending = true;
                if self.phase == rules::phase::OPEN && now < self.round_end_ms {
                    self.round_end_ms = now;
                }
                if self.phase == rules::phase::IDLE {
                    self.phase = rules::phase::ENDED;
                }
                msg!("Merit campaign ending (phase {})", self.phase);
                Ok(())
            }

            control fn withdraw(&mut self, amount_kelvin: u64) -> ProgramResult {
                self.require_campaign_owner()?;
                let free = rules::unreserved(self.phase, self.escrow_kelvin, self.cap_per_round);
                if amount_kelvin == 0 || amount_kelvin > free {
                    msg!("Merit rejected withdraw: {} requested, {} unreserved", amount_kelvin, free);
                    return Err(ProgramError::InsufficientFunds);
                }
                let owner = self.payer_account().clone();
                self.release(&owner, amount_kelvin)?;
                self.escrow_kelvin -= amount_kelvin;
                self.total_withdrawn = self.total_withdrawn.saturating_add(amount_kelvin);
                msg!("Merit owner withdrew {} kelvin (escrow {})", amount_kelvin, self.escrow_kelvin);
                Ok(())
            }

            // Funds the operations budget that repays the agent's REX costs.
            control fn fund_ops(&mut self, amount_kelvin: u64) -> ProgramResult {
                self.require_campaign_owner()?;
                if amount_kelvin == 0
                    || self.phase == rules::phase::ENDED
                    || self.phase == rules::phase::REFUNDED
                {
                    return Err(ProgramError::InvalidArgument);
                }
                self.deposit(amount_kelvin)?;
                self.ops_budget_kelvin = self
                    .ops_budget_kelvin
                    .checked_add(amount_kelvin)
                    .ok_or(ProgramError::InvalidArgument)?;
                self.total_ops_funded = self.total_ops_funded.saturating_add(amount_kelvin);
                msg!(
                    "Merit operations budget funded with {} kelvin (budget {}, ~{} verifications)",
                    amount_kelvin,
                    self.ops_budget_kelvin,
                    self.ops_budget_kelvin / rules::REX_COST_KELVIN
                );
                Ok(())
            }

            control fn withdraw_ops(&mut self, amount_kelvin: u64) -> ProgramResult {
                self.require_campaign_owner()?;
                let free = rules::unreserved_ops(self.phase, self.ops_budget_kelvin);
                if amount_kelvin == 0 || amount_kelvin > free {
                    return Err(ProgramError::InsufficientFunds);
                }
                let owner = self.payer_account().clone();
                self.release(&owner, amount_kelvin)?;
                self.ops_budget_kelvin -= amount_kelvin;
                msg!("Merit owner withdrew {} kelvin of operations budget", amount_kelvin);
                Ok(())
            }

            // Owner fallback for the deadline refund the heartbeat normally does.
            control fn refund(&mut self) -> ProgramResult {
                self.require_campaign_owner()?;
                let now = self.now_ms()?;
                let refundable = self.phase == rules::phase::IDLE
                    || self.phase == rules::phase::ENDED
                    || self.phase == rules::phase::WAITING_FUNDS
                    || self.phase == rules::phase::AWAITING_APPROVAL;
                if now < self.refund_deadline_ms || !refundable {
                    return Err(ProgramError::InvalidArgument);
                }
                self.refund_all()
            }

            // Re-arms a heartbeat that stopped (for example a timer that expired
            // during a network stall). The epoch bump retires any older chain.
            control fn resume(&mut self) -> ProgramResult {
                self.require_campaign_owner()?;
                self.timer_epoch = self.timer_epoch.saturating_add(1);
                let epoch = self.timer_epoch;
                let target = self.after_ms(rules::SETTLE_STEP_MS)?;
                if self.phase == rules::phase::OPEN {
                    AFTER target CALL [beat epoch: epoch];
                } else if self.phase == rules::phase::SETTLING {
                    let ledger = self.round_ledger_address();
                    AFTER target CALL [settle_peek ledger: ledger epoch: epoch];
                } else {
                    return Err(ProgramError::InvalidArgument);
                }
                msg!("Merit heartbeat resumed (epoch {})", epoch);
                Ok(())
            }

            // Rotates the agent authority from the next round on, e.g. to the
            // Privy wallet behind the merit-payout-signer latch.
            control fn set_agent(&mut self, agent: Pubkey) -> ProgramResult {
                self.require_campaign_owner()?;
                if agent == Pubkey::default() || agent == self.owner {
                    return Err(ProgramError::InvalidArgument);
                }
                self.next_agent = agent;
                if self.phase == rules::phase::IDLE {
                    self.agent = agent;
                    self.round_agent = agent;
                }
                msg!("Merit agent for the next round: {}", agent);
                Ok(())
            }

            control fn set_round_length(&mut self, round_length_ms: u64) -> ProgramResult {
                self.require_campaign_owner()?;
                if rules::validate_round_length(round_length_ms).is_err() {
                    return Err(ProgramError::InvalidArgument);
                }
                self.next_round_length_ms = round_length_ms;
                if self.phase == rules::phase::IDLE {
                    self.round_length_ms = round_length_ms;
                }
                Ok(())
            }

            // ---------------------------------------------------------------
            // Campaign: reactive heartbeat and settlement (no keeper)
            // ---------------------------------------------------------------

            handler fn beat(&mut self, epoch: u64) -> ProgramResult {
                if epoch != self.timer_epoch || self.phase != rules::phase::OPEN {
                    msg!("Merit stale beat ignored");
                    return Ok(());
                }
                let now = self.now_ms()?;
                self.beats = self.beats.saturating_add(1);
                self.last_beat_ms = now;
                if now < self.round_end_ms && now < self.refund_deadline_ms {
                    let target = now.saturating_add(rules::BEAT_MS);
                    AFTER target CALL [beat epoch: epoch];
                } else {
                    self.phase = rules::phase::SETTLING;
                    let ledger = self.round_ledger_address();
                    let target = now.saturating_add(rules::SETTLE_STEP_MS);
                    msg!("Merit round {} closed after {} beats; settling", self.round, self.beats);
                    AFTER target CALL [settle_peek ledger: ledger epoch: epoch];
                }
                Ok(())
            }

            // Reads the round ledger and decides the next step: pay one entry,
            // wait for a verification, wait for funds, or finish the round.
            handler fn settle_peek(&mut self, ledger: Pubkey, epoch: u64) -> ProgramResult {
                let _ = ReadAccountInfo::from(ledger);
                let ledger_account = self.account(&ledger)?;
                if epoch != self.timer_epoch || self.phase != rules::phase::SETTLING {
                    msg!("Merit stale settlement step ignored");
                    return Ok(());
                }
                if ledger != self.round_ledger_address() {
                    return Err(ProgramError::InvalidArgument);
                }
                let (entries, recipients, count) = self.load_ledger(&ledger_account)?;
                let now = self.now_ms()?;
                let grace = self.grace_ms();
                // Paused, or still inside the round's grace (late approvals
                // may land): look again at the next beat.
                if (self.paused && now < self.refund_deadline_ms)
                    || !rules::settlement_may_start(now, self.round_end_ms, grace, self.refund_deadline_ms)
                {
                    let later = now.saturating_add(rules::BEAT_MS);
                    AFTER later CALL [settle_peek ledger: ledger epoch: epoch];
                    return Ok(());
                }
                let closed = now >= self.round_end_ms.saturating_add(grace).saturating_add(rules::VERIFY_GRACE_MS)
                    || now >= self.refund_deadline_ms;
                let target = now.saturating_add(rules::SETTLE_STEP_MS);
                if !rules::verification_done(&entries, count, closed) {
                    // Pay nothing until every verification is final, so payouts
                    // keep approval order and the reimbursement is complete.
                    let later = now.saturating_add(rules::BEAT_MS);
                    AFTER later CALL [settle_peek ledger: ledger epoch: epoch];
                    return Ok(());
                }
                if count > 0 && !self.round_reimbursed {
                    let agent = self.round_agent;
                    AFTER target CALL [settle_reimburse ledger: ledger agent: agent epoch: epoch];
                    return Ok(());
                }
                let due = rules::round_due(&entries, count, &self.outcome);
                if now < self.refund_deadline_ms
                    && rules::needs_owner_approval(self.approval_threshold, due, self.round_approved)
                {
                    self.phase = rules::phase::AWAITING_APPROVAL;
                    msg!(
                        "Merit round {} would pay {} kelvin, above the owner's threshold {}; waiting for approve_round",
                        self.round,
                        due,
                        self.approval_threshold
                    );
                    return Ok(());
                }
                let config = self.config();
                let day_room = self.day_room(now);
                let step = rules::next_step(
                    &config,
                    &entries,
                    count,
                    &mut self.outcome,
                    self.round_paid_kelvin,
                    self.escrow_kelvin,
                    true,
                    day_room,
                );
                if let rules::Step::Pay { index, amount } = step {
                    let recipient = recipients[index];
                    let slot = index as u64;
                    msg!("Merit settling entry {}: {} kelvin to {}", index, amount, recipient);
                    AFTER target CALL [settle_pay ledger: ledger recipient: recipient index: slot epoch: epoch];
                } else if self.finish_step(step, &entries, count, now)? {
                    let next_epoch = self.timer_epoch;
                    let first_beat = now.saturating_add(rules::BEAT_MS);
                    AFTER first_beat CALL [beat epoch: next_epoch];
                }
                Ok(())
            }

            // Pays one entry, re-checking everything against the ledger as it
            // is now, then hands back to `settle_peek`.
            handler fn settle_pay(
                &mut self,
                ledger: Pubkey,
                recipient: Pubkey,
                index: u64,
                epoch: u64,
            ) -> ProgramResult {
                let _ = ReadAccountInfo::from(ledger);
                let _ = WriteAccountInfo::from(recipient);
                let ledger_account = self.account(&ledger)?;
                let recipient_account = self.account(&recipient)?;
                if epoch != self.timer_epoch || self.phase != rules::phase::SETTLING {
                    msg!("Merit stale payout ignored");
                    return Ok(());
                }
                if ledger != self.round_ledger_address() {
                    return Err(ProgramError::InvalidArgument);
                }
                let (entries, recipients, count) = self.load_ledger(&ledger_account)?;
                let now = self.now_ms()?;
                let config = self.config();
                let day_room = self.day_room(now);
                let step = rules::next_step(
                    &config,
                    &entries,
                    count,
                    &mut self.outcome,
                    self.round_paid_kelvin,
                    self.escrow_kelvin,
                    true,
                    day_room,
                );
                let mut paid = false;
                if let rules::Step::Pay { index: due, amount } = step {
                    if due as u64 == index
                        && recipients[due] == recipient
                        && recipient_account.key == &recipient
                        && recipient != self.workflow_pda()
                        && recipient != ledger
                    {
                        self.release(&recipient_account, amount)?;
                        self.outcome[due] = rules::settle::PAID;
                        self.escrow_kelvin -= amount;
                        self.round_paid_kelvin = self.round_paid_kelvin.saturating_add(amount);
                        self.total_paid = self.total_paid.saturating_add(amount);
                        rules::record_payout(&mut self.day_hours, &mut self.day_paid, now, amount);
                        paid = true;
                        msg!(
                            "Merit paid {} kelvin to {} for post {} (round {})",
                            amount,
                            recipient,
                            entries[due].post_id,
                            self.round
                        );
                    }
                }
                if !paid {
                    msg!("Merit payout {} no longer due; re-planning", index);
                }
                if self.paused {
                    msg!("Merit payouts paused by the owner");
                }
                let target = now.saturating_add(rules::SETTLE_STEP_MS);
                AFTER target CALL [settle_peek ledger: ledger epoch: epoch];
                Ok(())
            }

            // Repays the round agent, from the operations budget, for the REX
            // verifications it started and the rent of the round ledger.
            handler fn settle_reimburse(&mut self, ledger: Pubkey, agent: Pubkey, epoch: u64) -> ProgramResult {
                let _ = ReadAccountInfo::from(ledger);
                let _ = WriteAccountInfo::from(agent);
                let ledger_account = self.account(&ledger)?;
                let agent_account = self.account(&agent)?;
                if epoch != self.timer_epoch || self.phase != rules::phase::SETTLING {
                    msg!("Merit stale reimbursement ignored");
                    return Ok(());
                }
                if ledger != self.round_ledger_address() || agent != self.round_agent {
                    return Err(ProgramError::InvalidArgument);
                }
                if !self.round_reimbursed {
                    let (entries, _, count) = self.load_ledger(&ledger_account)?;
                    let rent = Rent::get()?.minimum_balance(ledger_account.data_len());
                    let amount = rules::reimbursement(self.ops_budget_kelvin, &entries, count, rent);
                    if amount > 0 && agent_account.key == &agent {
                        self.release(&agent_account, amount)?;
                        self.ops_budget_kelvin -= amount;
                        self.total_ops_reimbursed = self.total_ops_reimbursed.saturating_add(amount);
                    }
                    self.round_reimbursed = true;
                    msg!(
                        "Merit repaid agent {} kelvin for round {} (budget {} left)",
                        amount,
                        self.round,
                        self.ops_budget_kelvin
                    );
                }
                let now = self.now_ms()?;
                let target = now.saturating_add(rules::SETTLE_STEP_MS);
                AFTER target CALL [settle_peek ledger: ledger epoch: epoch];
                Ok(())
            }

            // ---------------------------------------------------------------
            // Ledger: agent instructions and REX verification
            // ---------------------------------------------------------------

            // The agent opens one ledger per campaign round. `x_token_hex` is the
            // hex of the merit-x latch token encrypted (`rialo client encrypt-secret
            // --creator-pubkey <agent>`) to the REX TEE key.
            initiating fn open_ledger(
                &mut self,
                campaign: Pubkey,
                round: u64,
                x_token_hex: String,
            ) -> ProgramResult {
                let _ = ReadAccountInfo::from(campaign);
                let campaign_account = self.account(&campaign)?;
                self.require_signer()?;
                self.require_authorized_rex()?;
                let seed = rules::ledger_seed(&campaign.to_bytes(), round);
                if self.workflow_pda_slug.as_bytes() != Nonce::from(&seed[..]).as_bytes() {
                    msg!("Merit rejected ledger: slug is not ledger_seed(campaign, round)");
                    return Err(ProgramError::InvalidArgument);
                }
                let parent = self.load_campaign(&campaign_account)?;
                let now = self.now_ms()?;
                if parent.round_agent != *self.payer_account().key
                    || parent.round != round
                    || !Self::takes_approvals(&parent, now)
                {
                    msg!("Merit rejected ledger: not the agent of an open round {}", round);
                    return Err(ProgramError::InvalidArgument);
                }
                let Some(x_token) = rules::decode_hex(&x_token_hex) else {
                    return Err(ProgramError::InvalidArgument);
                };
                if x_token.len() > 1_024 {
                    return Err(ProgramError::InvalidArgument);
                }
                self.kind = rules::kind::LEDGER;
                self.owner = parent.owner;
                self.agent = *self.payer_account().key;
                self.next_agent = self.agent;
                self.round_agent = self.agent;
                self.campaign = campaign;
                self.rate_kelvin = parent.rate_kelvin;
                self.min_score = parent.min_score;
                self.cap_per_payout = parent.cap_per_payout;
                self.cap_per_contributor = parent.cap_per_contributor;
                self.cap_per_round = parent.cap_per_round;
                self.round_length_ms = parent.round_length_ms;
                self.next_round_length_ms = parent.round_length_ms;
                self.refund_deadline_ms = parent.refund_deadline_ms;
                self.phase = rules::phase::OPEN;
                self.round = round;
                self.round_start_ms = parent.round_start_ms;
                self.round_end_ms = parent.round_end_ms;
                self.reserve_tables();
                self.x_token = EncryptedInput::new(x_token);
                msg!("Merit ledger opened for campaign {} round {}", campaign, round);
                Ok(())
            }

            // Records one AI-approved submission. The program, not the agent,
            // turns the score into an amount and enforces every cap.
            control fn approve(
                &mut self,
                campaign: Pubkey,
                contributor: Pubkey,
                x_user_id: u64,
                post_id: u64,
                score: u64,
                submission_hash: Pubkey,
                payee: Pubkey,
            ) -> ProgramResult {
                let _ = ReadAccountInfo::from(campaign);
                let _ = ReadAccountInfo::from(payee);
                let campaign_account = self.account(&campaign)?;
                self.require_ledger_agent()?;
                if campaign != self.campaign {
                    return Err(ProgramError::InvalidArgument);
                }
                let parent = self.load_campaign(&campaign_account)?;
                let now = self.now_ms()?;
                if parent.round != self.round
                    || parent.round_agent != self.agent
                    || !Self::takes_approvals(&parent, now)
                {
                    msg!("Merit rejected approval: round {} is closed or the campaign is paused", self.round);
                    return Err(ProgramError::InvalidArgument);
                }
                if parent.cooldown_ms > 0 {
                    let payee_account = self.account(&payee)?;
                    let registered = self.load_state(&payee_account)?;
                    if registered.kind != rules::kind::PAYEE
                        || registered.campaign != campaign
                        || registered.agent != self.agent
                        || registered.payee_x_user != x_user_id
                        || registered.payee_wallet != contributor
                    {
                        msg!("Merit rejected approval: no payee registration for X user {} and this wallet", x_user_id);
                        return Err(ProgramError::InvalidArgument);
                    }
                    if !rules::payee_ready(parent.cooldown_ms, registered.payee_since_ms, now) {
                        msg!(
                            "Merit rejected approval: wallet registered at {}, cooldown {} ms",
                            registered.payee_since_ms,
                            parent.cooldown_ms
                        );
                        return Err(ProgramError::InvalidArgument);
                    }
                }
                let config = self.config();
                let entries = self.ledger_entries();
                let count = self.entry_count as usize;
                self.require_ops_budget(&parent, &entries, count)?;
                let day_room = rules::day_room(parent.max_per_day, &parent.day_hours, &parent.day_paid, now);
                let amount = match rules::check_approval(
                    &config,
                    &entries,
                    count,
                    contributor.to_bytes(),
                    x_user_id,
                    post_id,
                    score,
                    day_room,
                ) {
                    Ok(amount) => amount,
                    Err(error) => {
                        msg!("Merit rejected approval of post {}: {:?}", post_id, error);
                        return Err(ProgramError::InvalidArgument);
                    }
                };
                self.e_contributor[count] = contributor;
                self.e_x_user[count] = x_user_id;
                self.e_post[count] = post_id;
                self.e_score[count] = score;
                self.e_amount[count] = amount;
                self.e_hash[count] = submission_hash;
                self.e_status[count] = rules::entry::PENDING;
                self.e_attempts[count] = 1;
                self.entry_count += 1;
                msg!(
                    "Merit approved post {} by X user {}: score {} -> {} kelvin (entry {})",
                    post_id,
                    x_user_id,
                    score,
                    amount,
                    count
                );
                let index = count as u64;
                let target = now.saturating_add(1);
                AFTER target CALL [run_verify index: index];
                Ok(())
            }

            // Retries a verification that ended without a unanimous report.
            control fn retry_verify(&mut self, campaign: Pubkey, index: u64) -> ProgramResult {
                let _ = ReadAccountInfo::from(campaign);
                let campaign_account = self.account(&campaign)?;
                self.require_ledger_agent()?;
                if campaign != self.campaign {
                    return Err(ProgramError::InvalidArgument);
                }
                let parent = self.load_campaign(&campaign_account)?;
                let entries = self.ledger_entries();
                self.require_ops_budget(&parent, &entries, self.entry_count as usize)?;
                let slot = index as usize;
                let now = self.now_ms()?;
                if slot >= self.entry_count as usize
                    || self.e_status[slot] != rules::entry::INCONCLUSIVE
                    || self.e_attempts[slot] >= rules::MAX_VERIFY_ATTEMPTS
                    || now
                        >= self
                            .round_end_ms
                            .saturating_add(rules::effective_grace(parent.submit_grace_ms, parent.round_length_ms))
                            .saturating_add(rules::VERIFY_GRACE_MS)
                {
                    return Err(ProgramError::InvalidArgument);
                }
                self.e_status[slot] = rules::entry::PENDING;
                self.e_attempts[slot] += 1;
                let target = now.saturating_add(1);
                AFTER target CALL [run_verify index: index];
                Ok(())
            }

            // Runs in its own timer branch so every verification gets fresh
            // REX and subscription PDAs.
            handler fn run_verify(&mut self, index: u64) -> ProgramResult {
                let slot = index as usize;
                if self.kind != rules::kind::LEDGER
                    || slot >= self.entry_count as usize
                    || self.e_status[slot] != rules::entry::PENDING
                {
                    return Ok(());
                }
                self.require_authorized_rex()?;
                // The REX request below is created at this nonce (the same
                // derivation the Venus expansion uses), and its report lands in
                // the processor-owned PDA for (agent, nonce). Recording that PDA
                // lets `on_verify` reject any other account passed as the report.
                let rex_nonce = super::interface::multi_account_slug(
                    &self.workflow_pda(),
                    self.branch_number,
                    self.rex_accounts_block_index,
                );
                self.e_report[slot] =
                    derive_report_address(self.payer_account().key, rex_nonce).0;
                let post_id = self.e_post[slot];
                let token = self.x_token.clone();
                let campaign = self.campaign.to_string();
                msg!("Merit verifying post {} (attempt {})", post_id, self.e_attempts[slot]);
                AFTER report = [fetch_post
                    post_id: post_id
                    campaign: campaign
                    token: token
                    request_delay_ms: 5_000u64
                ]
                CALL [on_verify index: index report: report];
                Ok(())
            }

            // Venus 0.18.1: the event payload must be the last handler argument.
            handler fn on_verify(&mut self, index: u64, report: RexReport) -> ProgramResult {
                let slot = index as usize;
                if self.kind != rules::kind::LEDGER
                    || slot >= self.entry_count as usize
                    || self.e_status[slot] != rules::entry::PENDING
                {
                    return Ok(());
                }
                // Accept only the report PDA recorded for this entry in run_verify,
                // owned by the REX processor and created by this ledger's agent.
                let report_account = &self.accounts[self.triggering_event_account_index];
                if report_account.key != &self.e_report[slot]
                    || report_account.owner != &rialo_rex_processor_interface::ID
                    || report.rex_id.creator != self.agent
                {
                    msg!("Merit rejected report: not this entry's REX report account");
                    return Err(ProgramError::InvalidAccountData);
                }
                // Every raw update counts, so a malformed one can never make
                // a report look unanimous.
                let mut payloads: Vec<Option<Vec<u8>>> = Vec::new();
                for update in &report.updates {
                    let mut payload = None;
                    if let Ok(output) = update.try_data_as_output() {
                        if let RexOutput::Success(response) = output {
                            if let RexData::Raw(bytes) = response.response {
                                payload = Some(bytes);
                            }
                        } else if let RexOutput::RexError(error) = output {
                            msg!("Merit REX validator error: {}", error);
                        }
                    }
                    payloads.push(payload);
                }
                let consensus = rules::consensus(payloads.iter().map(|payload| {
                    if let Some(bytes) = payload {
                        rules::Vote::Success(bytes.as_slice())
                    } else {
                        rules::Vote::Bad
                    }
                }));
                let now = self.now_ms()?;
                self.e_checked_ms[slot] = now;
                let mut status = rules::entry::INCONCLUSIVE;
                if let rules::Consensus::Unanimous(payload) = &consensus {
                    if let Some(proof) = rules::parse_post_proof(payload) {
                        let verdict = rules::judge_proof(
                            &proof,
                            self.e_post[slot],
                            self.e_x_user[slot],
                            self.round_start_ms,
                            self.round_end_ms,
                        );
                        status = if verdict == rules::Verdict::Verified {
                            rules::entry::VERIFIED
                        } else {
                            rules::entry::FAILED
                        };
                        msg!(
                            "Merit post {} verdict {:?}: author {} created {}",
                            proof.post_id,
                            verdict,
                            proof.author_id,
                            proof.created_ms
                        );
                    } else {
                        msg!("Merit unanimous report did not parse");
                    }
                } else if let rules::Consensus::NotUnanimous { outputs, success } = consensus {
                    msg!("Merit report not unanimous: {}/{} usable", success, outputs);
                }
                self.e_status[slot] = status;
                Ok(())
            }

            // ---------------------------------------------------------------
            // Program v2: owner controls
            // ---------------------------------------------------------------

            // Stops approvals and payouts. The round clock keeps running; a
            // round that closes while paused waits to settle until `unpause`.
            control fn pause(&mut self) -> ProgramResult {
                self.require_campaign_owner()?;
                if self.paused || self.phase == rules::phase::ENDED || self.phase == rules::phase::REFUNDED {
                    return Err(ProgramError::InvalidArgument);
                }
                self.paused = true;
                msg!("Merit campaign paused (phase {})", self.phase);
                Ok(())
            }

            control fn unpause(&mut self) -> ProgramResult {
                self.require_campaign_owner()?;
                if !self.paused {
                    return Err(ProgramError::InvalidArgument);
                }
                self.paused = false;
                msg!("Merit campaign unpaused (phase {})", self.phase);
                Ok(())
            }

            // Closes the open round now without ending the campaign: it settles
            // (after its grace) and the next round opens as usual.
            control fn close_round(&mut self) -> ProgramResult {
                self.require_campaign_owner()?;
                let now = self.now_ms()?;
                if self.phase != rules::phase::OPEN || now >= self.round_end_ms {
                    return Err(ProgramError::InvalidArgument);
                }
                self.round_end_ms = now;
                msg!("Merit round {} closed early by the owner at {}", self.round, now);
                Ok(())
            }

            // Rolling 24-hour cap (0 = none), owner approval above a round total
            // (0 = never), payee cooldown, and the late-submission grace.
            control fn set_limits(
                &mut self,
                max_per_day: u64,
                approval_threshold: u64,
                cooldown_ms: u64,
                submit_grace_ms: u64,
            ) -> ProgramResult {
                self.require_campaign_owner()?;
                if !rules::validate_limits(&self.config(), max_per_day, cooldown_ms, submit_grace_ms) {
                    return Err(ProgramError::InvalidArgument);
                }
                self.max_per_day = max_per_day;
                self.approval_threshold = approval_threshold;
                self.cooldown_ms = cooldown_ms;
                self.submit_grace_ms = submit_grace_ms;
                msg!(
                    "Merit limits: {} kelvin per 24h, owner approval above {}, cooldown {} ms, grace {} ms",
                    max_per_day,
                    approval_threshold,
                    cooldown_ms,
                    submit_grace_ms
                );
                Ok(())
            }

            // The owner lets a round above the approval threshold pay out.
            control fn approve_round(&mut self) -> ProgramResult {
                self.require_campaign_owner()?;
                if self.phase != rules::phase::AWAITING_APPROVAL {
                    return Err(ProgramError::InvalidArgument);
                }
                self.round_approved = true;
                self.phase = rules::phase::SETTLING;
                self.timer_epoch = self.timer_epoch.saturating_add(1);
                let ledger = self.round_ledger_address();
                let epoch = self.timer_epoch;
                let target = self.after_ms(rules::SETTLE_STEP_MS)?;
                msg!("Merit owner approved round {} for payout", self.round);
                AFTER target CALL [settle_peek ledger: ledger epoch: epoch];
                Ok(())
            }

            // ---------------------------------------------------------------
            // Program v2: agent controls
            // ---------------------------------------------------------------

            // Takes an approval back before it is paid (an owner override or a
            // re-check that found the post gone). Releases its share of the caps.
            control fn revoke(&mut self, campaign: Pubkey, index: u64) -> ProgramResult {
                let _ = ReadAccountInfo::from(campaign);
                let campaign_account = self.account(&campaign)?;
                self.require_ledger_agent()?;
                if campaign != self.campaign {
                    return Err(ProgramError::InvalidArgument);
                }
                let parent = self.load_campaign(&campaign_account)?;
                let slot = index as usize;
                let live = parent.phase == rules::phase::OPEN
                    || parent.phase == rules::phase::SETTLING
                    || parent.phase == rules::phase::WAITING_FUNDS
                    || parent.phase == rules::phase::AWAITING_APPROVAL;
                if !live
                    || parent.round != self.round
                    || slot >= self.entry_count as usize
                    || parent.outcome.get(slot).copied() != Some(rules::settle::TODO)
                {
                    msg!("Merit rejected revoke of entry {}: already settled or not this round", index);
                    return Err(ProgramError::InvalidArgument);
                }
                let status = self.e_status[slot];
                if status != rules::entry::PENDING
                    && status != rules::entry::VERIFIED
                    && status != rules::entry::INCONCLUSIVE
                {
                    return Err(ProgramError::InvalidArgument);
                }
                self.e_status[slot] = rules::entry::REVOKED;
                msg!("Merit revoked entry {} (post {})", index, self.e_post[slot]);
                Ok(())
            }

            // Registers the wallet an X account is paid at; the cooldown runs
            // from here. One account per (agent, campaign, X account).
            initiating fn open_payee(&mut self, campaign: Pubkey, x_user_id: u64, wallet: Pubkey) -> ProgramResult {
                let _ = ReadAccountInfo::from(campaign);
                let campaign_account = self.account(&campaign)?;
                self.require_signer()?;
                self.require_authorized_rex()?;
                let seed = rules::payee_seed(&campaign.to_bytes(), x_user_id);
                if self.workflow_pda_slug.as_bytes() != Nonce::from(&seed[..]).as_bytes() {
                    msg!("Merit rejected payee: slug is not payee_seed(campaign, x_user_id)");
                    return Err(ProgramError::InvalidArgument);
                }
                let parent = self.load_campaign(&campaign_account)?;
                let payer = *self.payer_account().key;
                if (parent.round_agent != payer && parent.next_agent != payer)
                    || x_user_id == 0
                    || wallet == Pubkey::default()
                {
                    return Err(ProgramError::InvalidArgument);
                }
                let now = self.now_ms()?;
                self.kind = rules::kind::PAYEE;
                self.owner = parent.owner;
                self.agent = payer;
                self.next_agent = payer;
                self.round_agent = payer;
                self.campaign = campaign;
                self.payee_x_user = x_user_id;
                self.payee_wallet = wallet;
                self.payee_since_ms = now;
                self.reserve_tables();
                msg!("Merit payee X user {} registered wallet {} at {}", x_user_id, wallet, now);
                Ok(())
            }

            // A changed wallet restarts the cooldown.
            control fn set_payee(&mut self, wallet: Pubkey) -> ProgramResult {
                self.require_signer()?;
                if self.kind != rules::kind::PAYEE || *self.payer_account().key != self.agent || wallet == Pubkey::default() {
                    return Err(ProgramError::InvalidArgument);
                }
                if wallet != self.payee_wallet {
                    let now = self.now_ms()?;
                    self.payee_wallet = wallet;
                    self.payee_since_ms = now;
                    msg!("Merit payee X user {} changed wallet to {} at {}", self.payee_x_user, wallet, now);
                }
                Ok(())
            }

            // ---------------------------------------------------------------
            // Helpers
            // ---------------------------------------------------------------

            fn open_round(&mut self, start: u64, end: u64) {
                self.round = self.round.saturating_add(1);
                self.round_start_ms = start;
                self.round_end_ms = end;
                self.agent = self.next_agent;
                self.round_agent = self.next_agent;
                self.round_length_ms = self.next_round_length_ms;
                self.round_paid_kelvin = 0;
                self.round_reimbursed = false;
                self.round_approved = false;
                self.beats = 0;
                for state in self.outcome.iter_mut() {
                    *state = rules::settle::TODO;
                }
                self.phase = rules::phase::OPEN;
                self.timer_epoch = self.timer_epoch.saturating_add(1);
                msg!(
                    "Merit round {} open until {} with agent {}",
                    self.round,
                    self.round_end_ms,
                    self.round_agent
                );
            }

            // Handles `WaitFunds` and `Done`. Returns true when it opened the
            // next round, so the caller arms its first heartbeat.
            fn finish_step(
                &mut self,
                step: rules::Step,
                entries: &[rules::Entry],
                count: usize,
                now: u64,
            ) -> Result<bool, ProgramError> {
                if let rules::Step::WaitFunds { index } = step {
                    if now >= self.refund_deadline_ms {
                        rules::abandon_unfunded(entries, count, &mut self.outcome);
                        self.refund_all()?;
                        return Ok(false);
                    }
                    self.phase = rules::phase::WAITING_FUNDS;
                    msg!(
                        "Merit waiting for funds: entry {} needs {} kelvin, escrow {}",
                        index,
                        entries[index].amount,
                        self.escrow_kelvin
                    );
                    return Ok(false);
                }
                msg!("Merit round {} settled: {} kelvin paid", self.round, self.round_paid_kelvin);
                if now >= self.refund_deadline_ms {
                    self.refund_all()?;
                    return Ok(false);
                }
                if self.ending {
                    self.phase = rules::phase::ENDED;
                    return Ok(false);
                }
                if self.escrow_kelvin == 0 {
                    self.phase = rules::phase::IDLE;
                    return Ok(false);
                }
                if let Some((start, end)) = rules::next_round_window_after(
                    self.round_end_ms,
                    now,
                    self.next_round_length_ms,
                    self.refund_deadline_ms,
                ) {
                    self.open_round(start, end);
                    return Ok(true);
                }
                self.phase = rules::phase::IDLE;
                Ok(false)
            }

            fn refund_all(&mut self) -> ProgramResult {
                let owner = self.payer_account().clone();
                if *owner.key != self.owner {
                    return Err(ProgramError::MissingRequiredSignature);
                }
                let amount = self.escrow_kelvin.saturating_add(self.ops_budget_kelvin);
                if amount > 0 {
                    self.release(&owner, amount)?;
                }
                self.escrow_kelvin = 0;
                self.ops_budget_kelvin = 0;
                self.total_refunded = self.total_refunded.saturating_add(amount);
                self.phase = rules::phase::REFUNDED;
                msg!("Merit refunded {} kelvin (escrow and budget) to owner {}", amount, self.owner);
                Ok(())
            }

            // Moves exactly `amount` from the owner into the campaign PDA.
            fn deposit(&self, amount: u64) -> ProgramResult {
                let payer = self.payer_account().clone();
                let workflow = self.accounts[1].clone();
                if !payer.is_writable || !workflow.is_writable || workflow.owner != self.program_id {
                    return Err(ProgramError::InvalidArgument);
                }
                let system = self
                    .accounts
                    .iter()
                    .find(|account| system_program::check_id(account.key))
                    .cloned()
                    .ok_or(ProgramError::NotEnoughAccountKeys)?;
                invoke(
                    &system_instruction::transfer(payer.key, workflow.key, amount),
                    &[payer, workflow, system],
                )
            }

            // Approvals and retries stop once the campaign's operations budget
            // cannot repay one more verification plus this ledger's rent.
            fn require_ops_budget(
                &self,
                parent: &State,
                entries: &[rules::Entry],
                count: usize,
            ) -> ProgramResult {
                let rent = Rent::get()?.minimum_balance(self.accounts[1].data_len());
                if !rules::ops_budget_allows_verification(parent.ops_budget_kelvin, entries, count, rent) {
                    msg!(
                        "Merit rejected: operations budget {} cannot cover another verification",
                        parent.ops_budget_kelvin
                    );
                    return Err(ProgramError::InsufficientFunds);
                }
                Ok(())
            }

            // Finds a caller-named account by key: Merit never relies on an
            // account's position in the instruction.
            fn account(&self, key: &Pubkey) -> Result<AccountInfo<'account_info>, ProgramError> {
                self.accounts
                    .iter()
                    .find(|account| account.key == key)
                    .cloned()
                    .ok_or(ProgramError::NotEnoughAccountKeys)
            }

            // The only way kelvin leaves the campaign PDA.
            fn release(&self, to: &AccountInfo, amount: u64) -> ProgramResult {
                let workflow = &self.accounts[1];
                if workflow.owner != self.program_id
                    || !workflow.is_writable
                    || !to.is_writable
                    || to.key == workflow.key
                    || amount > self.escrow_kelvin.saturating_add(self.ops_budget_kelvin)
                {
                    return Err(ProgramError::InvalidArgument);
                }
                let rent = Rent::get()?.minimum_balance(workflow.data_len());
                let balance = workflow.kelvins();
                if balance < rent.saturating_add(amount) {
                    msg!("Merit escrow short: balance {} rent {} amount {}", balance, rent, amount);
                    return Err(ProgramError::InsufficientFunds);
                }
                let credited = to.kelvins().checked_add(amount).ok_or(ProgramError::InvalidArgument)?;
                **workflow.try_borrow_mut_kelvins()? = balance - amount;
                **to.try_borrow_mut_kelvins()? = credited;
                Ok(())
            }

            fn load_state(&self, account: &AccountInfo) -> Result<State, ProgramError> {
                if account.owner != self.program_id || account.data_len() == 0 {
                    return Err(ProgramError::InvalidAccountData);
                }
                let state = read_from_storage::<State>(&account.data.borrow())?;
                if state.__rex_bytecode_account != self.__rex_bytecode_account {
                    return Err(ProgramError::InvalidAccountData);
                }
                Ok(state)
            }

            fn load_campaign(&self, account: &AccountInfo) -> Result<State, ProgramError> {
                let state = self.load_state(account)?;
                if state.kind != rules::kind::CAMPAIGN || state.campaign != *account.key {
                    return Err(ProgramError::InvalidAccountData);
                }
                Ok(state)
            }

            // A ledger that was never opened (no approvals this round) reads
            // as empty.
            fn load_ledger(
                &self,
                account: &AccountInfo,
            ) -> Result<([rules::Entry; rules::MAX_ENTRIES], [Pubkey; rules::MAX_ENTRIES], usize), ProgramError> {
                let mut entries = [rules::Entry::EMPTY; rules::MAX_ENTRIES];
                let mut recipients = [Pubkey::default(); rules::MAX_ENTRIES];
                if account.kelvins() == 0 && account.data_len() == 0 {
                    return Ok((entries, recipients, 0));
                }
                let ledger = self.load_state(account)?;
                if ledger.kind != rules::kind::LEDGER
                    || ledger.campaign != self.workflow_pda()
                    || ledger.round != self.round
                    || ledger.agent != self.round_agent
                {
                    return Err(ProgramError::InvalidAccountData);
                }
                let count = (ledger.entry_count as usize).min(rules::MAX_ENTRIES);
                for index in 0..count {
                    entries[index] = rules::Entry {
                        contributor: ledger.e_contributor[index].to_bytes(),
                        x_user_id: ledger.e_x_user[index],
                        post_id: ledger.e_post[index],
                        amount: ledger.e_amount[index],
                        status: ledger.e_status[index],
                        attempts: ledger.e_attempts[index],
                    };
                    recipients[index] = ledger.e_contributor[index];
                }
                Ok((entries, recipients, count))
            }

            fn ledger_entries(&self) -> [rules::Entry; rules::MAX_ENTRIES] {
                let mut entries = [rules::Entry::EMPTY; rules::MAX_ENTRIES];
                let count = (self.entry_count as usize).min(rules::MAX_ENTRIES);
                for index in 0..count {
                    entries[index] = rules::Entry {
                        contributor: self.e_contributor[index].to_bytes(),
                        x_user_id: self.e_x_user[index],
                        post_id: self.e_post[index],
                        amount: self.e_amount[index],
                        status: self.e_status[index],
                        attempts: self.e_attempts[index],
                    };
                }
                entries
            }

            fn round_ledger_address(&self) -> Pubkey {
                let seed = rules::ledger_seed(&self.workflow_pda().to_bytes(), self.round);
                derive_workflow_address(self.program_id, &self.round_agent, Nonce::from(&seed[..])).0
            }

            fn grace_ms(&self) -> u64 {
                rules::effective_grace(self.submit_grace_ms, self.round_length_ms)
            }

            fn day_room(&self, now: u64) -> u64 {
                rules::day_room(self.max_per_day, &self.day_hours, &self.day_paid, now)
            }

            // The campaign's current round takes approvals: open, or closed and
            // inside its grace, and not paused.
            fn takes_approvals(parent: &State, now: u64) -> bool {
                rules::accepts_approvals(
                    parent.phase,
                    parent.paused,
                    now,
                    parent.round_end_ms,
                    rules::effective_grace(parent.submit_grace_ms, parent.round_length_ms),
                )
            }

            fn config(&self) -> rules::Config {
                rules::Config {
                    rate_kelvin: self.rate_kelvin,
                    min_score: self.min_score,
                    cap_per_payout: self.cap_per_payout,
                    cap_per_contributor: self.cap_per_contributor,
                    cap_per_round: self.cap_per_round,
                    round_length_ms: self.round_length_ms,
                    refund_deadline_ms: self.refund_deadline_ms,
                }
            }

            // Writes every variable-length field at its final size, so the
            // workflow PDA never resizes later. Each
            // kind sizes only the tables it uses; the other kind's stay empty
            // forever. Every call (de)serializes the whole state, so this
            // keeps campaign calls cheap enough for the 200k compute budget.
            fn reserve_tables(&mut self) {
                let campaign = self.kind == rules::kind::CAMPAIGN;
                let campaign_len = if campaign { rules::MAX_ENTRIES } else { 0 };
                let ledger_len = if self.kind == rules::kind::LEDGER { rules::MAX_ENTRIES } else { 0 };
                let day_len = if campaign { rules::DAY_BUCKETS } else { 0 };
                self.outcome = vec![rules::settle::TODO; campaign_len];
                self.day_hours = vec![0; day_len];
                self.day_paid = vec![0; day_len];
                self.entry_count = 0;
                self.e_contributor = vec![Pubkey::default(); ledger_len];
                self.e_x_user = vec![0; ledger_len];
                self.e_post = vec![0; ledger_len];
                self.e_score = vec![0; ledger_len];
                self.e_amount = vec![0; ledger_len];
                self.e_hash = vec![Pubkey::default(); ledger_len];
                self.e_status = vec![rules::entry::EMPTY; ledger_len];
                self.e_attempts = vec![0; ledger_len];
                self.e_checked_ms = vec![0; ledger_len];
                self.e_report = vec![Pubkey::default(); ledger_len];
            }

            fn require_signer(&self) -> ProgramResult {
                if !self.payer_account().is_signer {
                    return Err(ProgramError::MissingRequiredSignature);
                }
                Ok(())
            }

            fn require_campaign_owner(&self) -> ProgramResult {
                self.require_signer()?;
                if self.kind != rules::kind::CAMPAIGN || *self.payer_account().key != self.owner {
                    msg!("Merit rejected instruction: not the campaign owner");
                    return Err(ProgramError::MissingRequiredSignature);
                }
                Ok(())
            }

            fn require_ledger_agent(&self) -> ProgramResult {
                self.require_signer()?;
                if self.kind != rules::kind::LEDGER || *self.payer_account().key != self.agent {
                    msg!("Merit rejected instruction: not the ledger agent");
                    return Err(ProgramError::MissingRequiredSignature);
                }
                Ok(())
            }

            // Pins the REX component deployed with this program, so nobody can
            // create a campaign or ledger wired to a look-alike verifier.
            fn require_authorized_rex(&self) -> ProgramResult {
                if self.__rex_bytecode_account
                    != Pubkey::from_str_const("SufLA3Vvm5x7ag2RSctyJhgceMQS1ht8rYAadjdvQvb")
                {
                    msg!("Merit rejected instruction: unauthorized REX bytecode account");
                    return Err(ProgramError::InvalidAccountData);
                }
                Ok(())
            }

            // DevNet's clock reports Unix milliseconds; normalize in case a
            // runtime reports seconds.
            fn now_ms(&self) -> Result<u64, ProgramError> {
                let raw = self.unix_timestamp();
                if raw < 0 {
                    return Err(ProgramError::InvalidArgument);
                }
                if raw < 100_000_000_000 {
                    return Ok((raw as u64).saturating_mul(1_000));
                }
                Ok(raw as u64)
            }

            fn after_ms(&self, delay_ms: u64) -> Result<u64, ProgramError> {
                Ok(self.now_ms()?.saturating_add(delay_ms))
            }
        }
    }
}
