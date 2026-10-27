//! merit-hello: the Phase-1 DevNet probe for Merit.
//!
//! It proves three Rialo primitives end to end before the real campaign
//! program is written:
//! - a Venus workflow deployed with `rialo client program deploy-venus`;
//! - a reactive `AFTER <n> seconds CALL [...]` timer with no keeper;
//! - a custom `rex { }` component that calls `http::get` from validators,
//!   with a callback that only accepts a unanimous report.
//!
//! `probe` takes the REX `request_delay_ms` as an argument so different
//! collection windows can be measured against the same endpoint.

use rialo_venus_proc_macro::rialo;

rialo! {
    workflow {
        state {
            owner: Pubkey,
            ticks: u64,
            last_tick_unix: i64,
            probes: u64,
            probe_delay_ms: u64,
            // 0 = none, 1 = unanimous, 2 = not unanimous, 3 = empty report
            last_status: u64,
            last_outputs: u64,
            last_success: u64,
            last_payload: String,
        }

        rex {
            pub fn fetch_profile(login: String) -> Result<String, String> {
                use rialo::rex_component::http;
                use serde_json::Value;

                let headers = vec![
                    ("Accept".to_string(), "application/vnd.github+json".to_string()),
                    ("User-Agent".to_string(), "Merit-Rialo-Probe/0.1".to_string()),
                ];
                let url = format!("https://api.github.com/users/{}", login);
                let response = http::get(&url, &headers, 10_000)
                    .map_err(|error| format!("request failed: {}", error))?;
                if response.status != 200 {
                    return Err(format!("HTTP {}", response.status));
                }
                let body = serde_json::from_slice::<Value>(&response.body)
                    .map_err(|_| "invalid JSON".to_string())?;
                let id = body
                    .get("id")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| "missing id".to_string())?;
                let found = body
                    .get("login")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "missing login".to_string())?;
                // Small, deterministic payload: every honest validator must
                // produce byte-identical output for the report to count.
                Ok(format!("HP1|{}|{}|{}", found, id, response.body.len()))
            }
        }

        program {
            use rialo_rex_processor_interface::state::RexReport;
            use rialo_s_program::{
                entrypoint::ProgramResult, msg, program_error::ProgramError, pubkey::Pubkey,
            };
            use rialo_types::{RexData, RexOutput};

            initiating fn create(&mut self) -> ProgramResult {
                if !self.payer_account().is_signer {
                    return Err(ProgramError::MissingRequiredSignature);
                }
                self.owner = *self.payer_account().key;
                self.ticks = 0;
                self.last_tick_unix = 0;
                self.probes = 0;
                self.probe_delay_ms = 0;
                self.last_status = 0;
                self.last_outputs = 0;
                self.last_success = 0;
                // Callbacks write this later; reserve its width now so Venus
                // never has to resize the PDA inside a handler.
                self.last_payload = Self::fixed(" ", 96);
                msg!("merit-hello created by {}", self.owner);
                Ok(())
            }

            // Arms a native timer. Nothing off-chain calls `tick`.
            //
            // DevNet's clock sysvar reports Unix milliseconds, while the DSL's
            // `AFTER n seconds` adds seconds to it (so it fires almost at once).
            // Use an absolute millisecond target instead. A timestamp
            // subscription only stays active for ~100 commits (~15 s on DevNet).
            control fn start_timer(&mut self, delay_ms: u64) -> ProgramResult {
                self.require_owner()?;
                let now = self.unix_timestamp();
                if now < 0 || delay_ms > 120_000 {
                    return Err(ProgramError::InvalidArgument);
                }
                let target = (now as u64).saturating_add(delay_ms);
                AFTER target CALL [tick];
                msg!("merit-hello timer armed: now={} target={} (+{} ms)", now, target, delay_ms);
                Ok(())
            }

            // Cost probe: a self re-arming heartbeat, the same shape Merit's round
            // settlement uses. Each beat re-arms the next one until `beats` reach 0.
            control fn start_heartbeat(&mut self, interval_ms: u64, beats: u64) -> ProgramResult {
                self.require_owner()?;
                if interval_ms == 0 || interval_ms > 10_000 || beats == 0 || beats > 100 {
                    return Err(ProgramError::InvalidArgument);
                }
                self.probe_delay_ms = interval_ms;
                self.probes = beats;
                let now = self.unix_timestamp();
                if now < 0 {
                    return Err(ProgramError::InvalidArgument);
                }
                let target = (now as u64).saturating_add(interval_ms);
                AFTER target CALL [beat];
                Ok(())
            }

            handler fn beat(&mut self) -> ProgramResult {
                self.ticks = self.ticks.saturating_add(1);
                self.last_tick_unix = self.unix_timestamp();
                self.probes = self.probes.saturating_sub(1);
                msg!("merit-hello beat #{} remaining={}", self.ticks, self.probes);
                if self.probes == 0 || self.last_tick_unix < 0 {
                    return Ok(());
                }
                let target = (self.last_tick_unix as u64).saturating_add(self.probe_delay_ms);
                AFTER target CALL [beat];
                Ok(())
            }

            handler fn tick(&mut self) -> ProgramResult {
                self.ticks = self.ticks.saturating_add(1);
                self.last_tick_unix = self.unix_timestamp();
                msg!("merit-hello tick #{} at unix {}", self.ticks, self.last_tick_unix);
                Ok(())
            }

            // The REX request lives in a timer handler, not in this control
            // call, so each probe gets a fresh branch and fresh REX and
            // subscription PDAs (see MergePay's ARCHITECTURE notes).
            control fn probe(&mut self, delay_ms: u64) -> ProgramResult {
                self.require_owner()?;
                if delay_ms == 0 || delay_ms > 60_000 {
                    return Err(ProgramError::InvalidArgument);
                }
                self.probe_delay_ms = delay_ms;
                AFTER 1 seconds CALL [run_probe];
                Ok(())
            }

            handler fn run_probe(&mut self) -> ProgramResult {
                self.probes = self.probes.saturating_add(1);
                let delay = self.probe_delay_ms;
                let login = "octocat".to_string();
                msg!("merit-hello probe #{} with request_delay_ms={}", self.probes, delay);
                AFTER report = [fetch_profile
                    login: login
                    request_delay_ms: delay
                ]
                CALL [on_report report: report];
                Ok(())
            }

            // Venus 0.18.1: the event payload must be the last handler argument.
            handler fn on_report(&mut self, report: RexReport) -> ProgramResult {
                let mut outputs = 0u64;
                let mut success = 0u64;
                let mut consensus: Option<Vec<u8>> = None;
                let mut matching = true;

                // Count raw updates, not the filtered `outputs()` iterator, so a
                // malformed validator update can never make a report look unanimous.
                for update in &report.updates {
                    outputs += 1;
                    let Ok(output) = update.try_data_as_output() else {
                        matching = false;
                        continue;
                    };
                    match output {
                        RexOutput::Success(response) => {
                            if let RexData::Raw(payload) = response.response {
                                if payload.len() > 96 {
                                    matching = false;
                                    continue;
                                }
                                if let Some(expected) = &consensus {
                                    if expected != &payload {
                                        matching = false;
                                    }
                                } else {
                                    consensus = Some(payload.clone());
                                }
                                success += 1;
                            } else {
                                matching = false;
                            }
                        }
                        RexOutput::RexError(error) => {
                            msg!("merit-hello REX error: {}", error);
                        }
                        RexOutput::UnserializableResponse(error) => {
                            msg!("merit-hello unserializable REX output: {}", error);
                        }
                        _ => {
                            msg!("merit-hello unsupported REX output");
                        }
                    }
                }

                self.last_outputs = outputs;
                self.last_success = success;
                self.last_status = if outputs == 0 {
                    3
                } else if success == outputs && matching {
                    1
                } else {
                    2
                };
                let text = consensus
                    .as_deref()
                    .and_then(|bytes| std::str::from_utf8(bytes).ok())
                    .unwrap_or("-");
                if self.last_status == 1 {
                    self.last_payload = Self::fixed(text, 96);
                }
                msg!(
                    "merit-hello report: status={} usable={}/{} payload={}",
                    self.last_status,
                    success,
                    outputs,
                    text
                );
                Ok(())
            }

            fn require_owner(&self) -> ProgramResult {
                if !self.payer_account().is_signer || self.payer_account().key != &self.owner {
                    return Err(ProgramError::MissingRequiredSignature);
                }
                Ok(())
            }

            fn fixed(value: &str, width: usize) -> String {
                let mut out: String = value.chars().take(width).collect();
                while out.len() < width {
                    out.push('\0');
                }
                out
            }
        }
    }
}
