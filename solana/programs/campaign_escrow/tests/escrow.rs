use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{
            instruction::{AccountMeta, Instruction},
            system_program,
        },
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    campaign_escrow::{settle_digest, FundArgs, CAMPAIGN_SEED},
    ed25519_dalek::{Signer as _, SigningKey},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const SOL: u64 = 1_000_000_000;
const REWARD: u64 = 10_000_000; // 0.01 SOL
const DEADLINE_MS: i64 = 1_000_000_000_000;
const REFUND_AFTER_MS: i64 = DEADLINE_MS + 86_400_000;

struct T {
    svm: LiteSVM,
    company: Keypair,
    relayer: Keypair,
    cre: SigningKey,
    campaign_id: [u8; 32],
    escrow: Pubkey,
}

fn set_time(svm: &mut LiteSVM, ms: i64) {
    let mut c: Clock = svm.get_sysvar();
    c.unix_timestamp = ms / 1000;
    svm.set_sysvar(&c);
}

fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair) -> Result<(), String> {
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).map_err(|e| e.to_string())?;
    svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.err))
}

fn try_setup(max: u16, min: u16, budget: u64) -> Result<T, String> {
    let mut svm = LiteSVM::new();
    let so = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/campaign_escrow.so"));
    svm.add_program(campaign_escrow::id(), so).unwrap();
    let (company, relayer) = (Keypair::new(), Keypair::new());
    svm.airdrop(&company.pubkey(), 10 * SOL).unwrap();
    svm.airdrop(&relayer.pubkey(), SOL).unwrap();
    set_time(&mut svm, DEADLINE_MS - 3_600_000);
    let cre = SigningKey::from_bytes(&[7u8; 32]);
    let campaign_id = [9u8; 32];
    let escrow = Pubkey::find_program_address(&[CAMPAIGN_SEED, &campaign_id], &campaign_escrow::id()).0;
    let args = FundArgs {
        campaign_id,
        report_pk: cre.verifying_key().to_bytes(),
        reward_lamports: REWARD,
        budget_lamports: budget,
        max_responses: max,
        min_cohort: min,
        deadline_ms: DEADLINE_MS,
        refund_after_ms: REFUND_AFTER_MS,
    };
    let ix = Instruction::new_with_bytes(
        campaign_escrow::id(),
        &campaign_escrow::instruction::Fund { args }.data(),
        campaign_escrow::accounts::Fund { company: company.pubkey(), campaign: escrow, system_program: system_program::ID }
            .to_account_metas(None),
    );
    send(&mut svm, &[ix], &company)?;
    Ok(T { svm, company, relayer, cre, campaign_id, escrow })
}

fn setup() -> T {
    try_setup(20, 15, REWARD * 20).unwrap()
}

/// The Ed25519 precompile instruction with key, signature and message inline (instruction index u16::MAX).
fn ed25519_ix(sk: &SigningKey, msg: &[u8]) -> Instruction {
    let (pk_off, sig_off, msg_off) = (16u16, 48u16, 112u16);
    let mut d = vec![1u8, 0];
    for v in [sig_off, u16::MAX, pk_off, u16::MAX, msg_off, msg.len() as u16, u16::MAX] {
        d.extend_from_slice(&v.to_le_bytes());
    }
    d.extend_from_slice(&sk.verifying_key().to_bytes());
    d.extend_from_slice(&sk.sign(msg).to_bytes());
    d.extend_from_slice(msg);
    Instruction { program_id: solana_sdk_ids::ed25519_program::ID, accounts: vec![], data: d }
}

/// `payees` go into the transaction; `signed` is the list CRE signed (they differ in the tampering tests).
fn settle_ixs(t: &T, payees: &[Pubkey], signed: &[Pubkey], signer: &SigningKey) -> Vec<Instruction> {
    let report_hash = [1u8; 32];
    let digest = settle_digest(&t.escrow, &t.campaign_id, &report_hash, signed);
    let mut metas = campaign_escrow::accounts::Settle {
        submitter: t.relayer.pubkey(),
        campaign: t.escrow,
        company: t.company.pubkey(),
        instructions: solana_instructions_sysvar::ID,
    }
    .to_account_metas(None);
    metas.extend(payees.iter().map(|p| AccountMeta::new(*p, false)));
    vec![
        ed25519_ix(signer, &digest),
        Instruction::new_with_bytes(campaign_escrow::id(), &campaign_escrow::instruction::Settle { report_hash }.data(), metas),
    ]
}

fn refund_ix(t: &T, who: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        campaign_escrow::id(),
        &campaign_escrow::instruction::Refund {}.data(),
        campaign_escrow::accounts::Refund { company: *who, campaign: t.escrow }.to_account_metas(None),
    )
}

fn lamports(t: &T, k: &Pubkey) -> u64 {
    t.svm.get_account(k).map(|a| a.lamports).unwrap_or(0)
}

fn payees(n: usize) -> Vec<Pubkey> {
    (0..n).map(|_| Pubkey::new_unique()).collect()
}

#[test]
fn fund_locks_budget_with_campaign_terms() {
    let t = setup();
    let acc = t.svm.get_account(&t.escrow).unwrap();
    let c = campaign_escrow::Campaign::try_deserialize(&mut acc.data.as_slice()).unwrap();
    assert_eq!((c.company, c.reward_lamports, c.max_responses, c.min_cohort), (t.company.pubkey(), REWARD, 20, 15));
    assert!(acc.lamports >= REWARD * 20);
}

#[test]
fn fund_rejects_budget_below_max_payout_and_oversized_cohorts() {
    assert!(try_setup(20, 15, REWARD * 19).is_err(), "budget < reward * max");
    assert!(try_setup(21, 15, REWARD * 21).is_err(), "max_responses above MAX_PAYEES");
    assert!(try_setup(10, 15, REWARD * 10).is_err(), "min_cohort above max_responses");
}

#[test]
fn settle_pays_every_signed_payee_and_refunds_the_rest_in_one_tx() {
    let mut t = setup();
    let company_before = lamports(&t, &t.company.pubkey());
    let escrow_total = lamports(&t, &t.escrow);
    set_time(&mut t.svm, DEADLINE_MS + 60_000);
    let p = payees(16);
    let ixs = settle_ixs(&t, &p, &p, &t.cre);
    let relayer = t.relayer.insecure_clone();
    send(&mut t.svm, &ixs, &relayer).unwrap();
    for k in &p {
        assert_eq!(lamports(&t, k), REWARD);
    }
    assert_eq!(lamports(&t, &t.escrow), 0, "escrow closed");
    assert_eq!(lamports(&t, &t.company.pubkey()) - company_before, escrow_total - 16 * REWARD);
    assert!(send(&mut t.svm, &ixs, &relayer).is_err(), "second settle with the same signature");
}

#[test]
fn twenty_payees_fit_in_one_transaction() {
    let mut t = setup();
    set_time(&mut t.svm, DEADLINE_MS);
    let p = payees(20);
    let ixs = settle_ixs(&t, &p, &p, &t.cre);
    let relayer = t.relayer.insecure_clone();
    send(&mut t.svm, &ixs, &relayer).unwrap();
    assert_eq!(lamports(&t, &p[19]), REWARD);
}

#[test]
fn settle_with_zero_payees_refunds_everything() {
    let mut t = setup();
    let escrow_total = lamports(&t, &t.escrow);
    let before = lamports(&t, &t.company.pubkey());
    set_time(&mut t.svm, DEADLINE_MS);
    let ixs = settle_ixs(&t, &[], &[], &t.cre);
    let relayer = t.relayer.insecure_clone();
    send(&mut t.svm, &ixs, &relayer).unwrap();
    assert_eq!(lamports(&t, &t.company.pubkey()) - before, escrow_total);
}

#[test]
fn settle_rejects_forged_key_tampered_list_and_bad_counts() {
    let mut t = setup();
    set_time(&mut t.svm, DEADLINE_MS + 1_000);
    let relayer = t.relayer.insecure_clone();
    let p = payees(16);
    let forged = SigningKey::from_bytes(&[8u8; 32]);
    let cases: Vec<(&str, Vec<Instruction>)> = vec![
        ("wrong key", settle_ixs(&t, &p, &p, &forged)),
        ("payee swapped", {
            let mut s = p.clone();
            s[3] = relayer.pubkey();
            settle_ixs(&t, &s, &p, &t.cre)
        }),
        ("payee dropped", settle_ixs(&t, &p[..15], &p, &t.cre)),
        ("below min cohort", {
            let s = payees(14);
            settle_ixs(&t, &s, &s, &t.cre)
        }),
        ("no Ed25519 instruction", vec![settle_ixs(&t, &p, &p, &t.cre).pop().unwrap()]),
    ];
    for (name, ixs) in cases {
        assert!(send(&mut t.svm, &ixs, &relayer).is_err(), "{name}");
    }
    assert!(lamports(&t, &t.escrow) > 0, "escrow untouched");
}

#[test]
fn settle_only_inside_the_window() {
    let mut t = setup();
    let relayer = t.relayer.insecure_clone();
    let p = payees(15);
    set_time(&mut t.svm, DEADLINE_MS - 1_000);
    let ixs = settle_ixs(&t, &p, &p, &t.cre);
    assert!(send(&mut t.svm, &ixs, &relayer).is_err(), "before deadline");
    set_time(&mut t.svm, REFUND_AFTER_MS);
    assert!(send(&mut t.svm, &ixs, &relayer).is_err(), "at refund_after");
}

#[test]
fn refund_only_by_company_after_refund_after() {
    let mut t = setup();
    let company = t.company.insecure_clone();
    let stranger = t.relayer.insecure_clone();
    let escrow_total = lamports(&t, &t.escrow);
    set_time(&mut t.svm, REFUND_AFTER_MS - 1_000);
    let ix = refund_ix(&t, &company.pubkey());
    assert!(send(&mut t.svm, &[ix], &company).is_err(), "too early");
    set_time(&mut t.svm, REFUND_AFTER_MS);
    let ix = refund_ix(&t, &stranger.pubkey());
    assert!(send(&mut t.svm, &[ix], &stranger).is_err(), "not the company");
    let before = lamports(&t, &company.pubkey());
    let ix = refund_ix(&t, &company.pubkey());
    send(&mut t.svm, &[ix], &company).unwrap();
    assert_eq!(lamports(&t, &company.pubkey()) + 5_000 - before, escrow_total); // one signature fee
}

/// Same vector as shared/test/settlePayload.test.ts: the TypeScript signer and the program must agree byte for byte.
#[test]
fn settle_digest_matches_the_typescript_signer() {
    use std::str::FromStr;
    let escrow = Pubkey::from_str("CU78T3P4D3dPqahyzCztjkawahDzwHDJuBu8PwvK9Hu9").unwrap();
    let payees = [
        Pubkey::from_str("Got5vvPkQZbjRC3bLcArjomAHuDDmTfAY8Zmjsbh5MLH").unwrap(),
        Pubkey::from_str("7dVMfGwqd8jg4i3fS3Z1pFcSVcKRc5vLcy92UXM88HwK").unwrap(),
    ];
    let d = settle_digest(&escrow, &[0xcc; 32], &[0x11; 32], &payees);
    let hex: String = d.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(hex, "8d7dc0edf50925cc9c26a37f7ad6cfc4a5863b7a2a39529d57b3e723a3e7fbc8");
}
