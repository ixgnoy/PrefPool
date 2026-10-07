use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};
use solana_sdk_ids::ed25519_program;
use solana_sha256_hasher::hashv;

use crate::{constants::*, error::EscrowError, state::Campaign};

/// Permissionless: anyone (normally the platform relayer) may submit it and pays only fees. What it can do is fixed by
/// CRE's signature: the payees (remaining accounts, in order) must be exactly the list CRE signed, each gets
/// `reward_lamports`, and everything left (unused budget + rent) goes back to the company as the account closes.
#[derive(Accounts)]
pub struct Settle<'info> {
    pub submitter: Signer<'info>,
    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.campaign_id.as_ref()],
        bump = campaign.bump,
        has_one = company,
        close = company
    )]
    pub campaign: Account<'info, Campaign>,
    /// CHECK: must equal campaign.company (has_one); only receives lamports.
    #[account(mut)]
    pub company: UncheckedAccount<'info>,
    /// CHECK: the instructions sysvar, checked by address.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[event]
pub struct Settled {
    pub campaign_id: [u8; 32],
    pub report_hash: [u8; 32],
    pub payees: u16,
    pub paid_lamports: u64,
}

/// What CRE signs: sha256(domain || escrow address || campaign id || report hash || n (u16 LE) || payees).
/// The escrow address is a PDA of this program, so it also pins the program id.
pub fn settle_digest(escrow: &Pubkey, campaign_id: &[u8; 32], report_hash: &[u8; 32], payees: &[Pubkey]) -> [u8; 32] {
    let n = (payees.len() as u16).to_le_bytes();
    let mut parts: Vec<&[u8]> = vec![SETTLE_DOMAIN, escrow.as_ref(), campaign_id, report_hash, &n];
    parts.extend(payees.iter().map(|p| p.as_ref()));
    hashv(&parts).to_bytes()
}

pub fn handle_settle<'info>(ctx: Context<'info, Settle<'info>>, report_hash: [u8; 32]) -> Result<()> {
    let c = &ctx.accounts.campaign;
    let now_ms = Clock::get()?.unix_timestamp.checked_mul(1000).ok_or(EscrowError::Overflow)?;
    require!(now_ms >= c.deadline_ms && now_ms < c.refund_after_ms, EscrowError::OutsideSettleWindow);

    let payees = ctx.remaining_accounts;
    let n = payees.len();
    require!(n == 0 || (n >= c.min_cohort as usize && n <= c.max_responses as usize), EscrowError::BadPayeeCount);
    let escrow_key = c.key();
    for p in payees {
        require!(p.is_writable && p.key() != escrow_key && !p.executable, EscrowError::BadPayeeAccount);
    }

    let keys: Vec<Pubkey> = payees.iter().map(|p| p.key()).collect();
    let digest = settle_digest(&escrow_key, &c.campaign_id, &report_hash, &keys);
    verify_previous_ed25519(&ctx.accounts.instructions, &c.report_pk, &digest)?;

    let reward = c.reward_lamports;
    let paid = reward.checked_mul(n as u64).ok_or(EscrowError::Overflow)?;
    let escrow_info = ctx.accounts.campaign.to_account_info();
    escrow_info.sub_lamports(paid)?; // fund() guarantees budget >= reward * max_responses
    for p in payees {
        p.add_lamports(reward)?;
    }

    emit!(Settled { campaign_id: ctx.accounts.campaign.campaign_id, report_hash, payees: n as u16, paid_lamports: paid });
    Ok(()) // `close = company` then sends the rest (refund + rent) to the company
}

/// The instruction right before this one must be the Ed25519 precompile checking exactly one signature, with key,
/// signature and message all inside that same instruction (offsets' instruction index = u16::MAX), by `pk` over `msg`.
/// The runtime has already verified the signature itself when the transaction got here.
fn verify_previous_ed25519(ix_sysvar: &AccountInfo, pk: &[u8; 32], msg: &[u8; 32]) -> Result<()> {
    let current = load_current_index_checked(ix_sysvar)?;
    require!(current > 0, EscrowError::MissingReportSignature);
    let ix = load_instruction_at_checked(current as usize - 1, ix_sysvar)?;
    require!(ix.program_id == ed25519_program::ID && ix.accounts.is_empty(), EscrowError::MissingReportSignature);
    let d = &ix.data;
    require!(d.len() >= 16 && d[0] == 1, EscrowError::MissingReportSignature);
    let u16_at = |i: usize| u16::from_le_bytes([d[i], d[i + 1]]);
    let (sig_off, sig_ix, pk_off, pk_ix, msg_off, msg_len, msg_ix) =
        (u16_at(2) as usize, u16_at(4), u16_at(6) as usize, u16_at(8), u16_at(10) as usize, u16_at(12) as usize, u16_at(14));
    require!(sig_ix == u16::MAX && pk_ix == u16::MAX && msg_ix == u16::MAX, EscrowError::MissingReportSignature);
    require!(sig_off + 64 <= d.len() && pk_off + 32 <= d.len() && msg_off + msg_len <= d.len(), EscrowError::MissingReportSignature);
    require!(&d[pk_off..pk_off + 32] == pk && msg_len == 32 && &d[msg_off..msg_off + 32] == msg, EscrowError::WrongReportSignature);
    Ok(())
}
