//! `merit-tools ledger <program> <agent> <campaign> <round>` prints a round
//! ledger's slug (hex) and PDA. `merit-tools workflow <program> <payer> <slug-hex>`
//! prints a workflow PDA. Both use `rialo_venus::derive_workflow_address`, the
//! derivation the program checks on chain. `merit-tools vectors` prints the
//! generated Rust instruction builders' output (accounts + bincode data) for
//! every user-facing instruction; the web app's TypeScript builders are tested
//! against it byte for byte.

use rialo_s_program::pubkey::Pubkey;
use rialo_types::Nonce;
use std::str::FromStr;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).expect("hex"))
        .collect()
}

fn key(text: &str) -> Pubkey {
    Pubkey::from_str(text).expect("base58 pubkey")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("ledger") => {
            let (program, agent, campaign) = (key(&args[2]), key(&args[3]), key(&args[4]));
            let round: u64 = args[5].parse().expect("round");
            let seed = merit_core::ledger_seed(&campaign.to_bytes(), round);
            let nonce = Nonce::from(&seed[..]);
            let (pda, _) = rialo_venus::derive_workflow_address(&program, &agent, nonce);
            println!("slug {}", hex(nonce.as_bytes()));
            println!("pda {pda}");
        }
        Some("workflow") => {
            let (program, payer) = (key(&args[2]), key(&args[3]));
            let nonce = Nonce::from(&unhex(&args[4])[..]);
            let (pda, _) = rialo_venus::derive_workflow_address(&program, &payer, nonce);
            println!("pda {pda}");
        }
        Some("vectors") => vectors(),
        _ => eprintln!("usage: merit-tools ledger <program> <agent> <campaign> <round> | workflow <program> <payer> <slug-hex>"),
    }
}

fn vectors() {
    use merit::interface as ix;
    use rialo_s_program::instruction::Instruction;

    let program = key("4qBwWYWn7ougS7sHP21x4yTDk4cwmyEqUiqNmKAYVuk6");
    let rex = key("SufLA3Vvm5x7ag2RSctyJhgceMQS1ht8rYAadjdvQvb");
    let owner = key("BkecjfP5fxz6s3xuAXHPPPxmoebUDkd9DsTeYBZokYwF");
    let agent = key("8f4gqYbvcaxFyGo7x6zZWxBQU8ycxtppw54J9saw2iaz");
    let contributor = key("GZCkutEHercaeY728xVqiPTNSgGgAercDAb9JTXXnePN");
    let campaign = key("G1JjiebaNvYQVBN4tscddqdKRZLfjJR2pgTVrBScx2TN");
    let slug: [u8; 32] = core::array::from_fn(|i| (i as u8).wrapping_mul(7).wrapping_add(3));
    let seed = merit_core::ledger_seed(&campaign.to_bytes(), 3);
    let ledger_nonce = Nonce::from(&seed[..]);
    let hash = key("fTzfxvv2a2TjbEFRfaDSKK8i8QrzCtvm3ispnZuhfZb");
    let payee_seed = merit_core::payee_seed(&campaign.to_bytes(), 1_658_044_857_343_000_579);
    let payee_nonce = Nonce::from(&payee_seed[..]);
    let (payee, _) = rialo_venus::derive_workflow_address(&program, &agent, payee_nonce);

    let cases: Vec<(&str, Instruction)> = vec![
        ("create_campaign", ix::create_campaign(&program, &owner, slug, agent, 100_000_000, 50, 100_000_000, 200_000_000, 500_000_000, 300_000, 1_792_829_402_922, rex)),
        ("fund", ix::fund(&program, &owner, slug, 1_000_000_000)),
        ("fund_ops", ix::fund_ops(&program, &owner, slug, 200_000_000)),
        ("start", ix::start(&program, &owner, slug)),
        ("end", ix::end(&program, &owner, slug)),
        ("withdraw", ix::withdraw(&program, &owner, slug, 942_000_000)),
        ("withdraw_ops", ix::withdraw_ops(&program, &owner, slug, 165_289_520)),
        ("refund", ix::refund(&program, &owner, slug)),
        ("resume", ix::resume(&program, &owner, slug)),
        ("set_agent", ix::set_agent(&program, &owner, slug, contributor)),
        ("set_round_length", ix::set_round_length(&program, &owner, slug, 600_000)),
        ("open_ledger", ix::open_ledger(&program, &agent, ledger_nonce, campaign, 3, "00ff10ab".to_string(), rex)),
        ("approve", ix::approve(&program, &agent, ledger_nonce, campaign, contributor, 1_658_044_857_343_000_579, 2_113_550_979_329_368_489, 58, hash, payee)),
        ("retry_verify", ix::retry_verify(&program, &agent, ledger_nonce, campaign, 1)),
        ("pause", ix::pause(&program, &owner, slug)),
        ("unpause", ix::unpause(&program, &owner, slug)),
        ("close_round", ix::close_round(&program, &owner, slug)),
        ("set_limits", ix::set_limits(&program, &owner, slug, 1_000_000_000, 400_000_000, 3_600_000, 300_000)),
        ("approve_round", ix::approve_round(&program, &owner, slug)),
        ("revoke", ix::revoke(&program, &agent, ledger_nonce, campaign, 2)),
        ("open_payee", ix::open_payee(&program, &agent, payee_nonce, campaign, 1_658_044_857_343_000_579, contributor, rex)),
        ("set_payee", ix::set_payee(&program, &agent, payee_nonce, owner)),
        ("skip_stuck", ix::skip_stuck(&program, &owner, slug, campaign)),
    ];
    let mut out = Vec::new();
    for (name, instruction) in cases {
        let accounts: Vec<String> = instruction
            .accounts
            .iter()
            .map(|meta| format!("{{\"pubkey\":\"{}\",\"isSigner\":{},\"isWritable\":{}}}", meta.pubkey, meta.is_signer, meta.is_writable))
            .collect();
        out.push(format!(
            "{{\"name\":\"{name}\",\"programId\":\"{}\",\"accounts\":[{}],\"data\":\"{}\"}}",
            instruction.program_id,
            accounts.join(","),
            hex(&instruction.data)
        ));
    }
    println!(
        "{{\"slug\":\"{}\",\"ledgerSlug\":\"{}\",\"payeeSlug\":\"{}\",\"payee\":\"{}\",\"cases\":[{}]}}",
        hex(&slug),
        hex(ledger_nonce.as_bytes()),
        hex(payee_nonce.as_bytes()),
        payee,
        out.join(",")
    );
}
