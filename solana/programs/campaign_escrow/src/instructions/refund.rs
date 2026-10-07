use anchor_lang::prelude::*;

use crate::{constants::*, error::EscrowError, state::Campaign};

/// Company escape hatch: if nobody settled within the window, the whole escrow (budget + rent) goes back.
#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub company: Signer<'info>,
    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.campaign_id.as_ref()],
        bump = campaign.bump,
        has_one = company,
        close = company
    )]
    pub campaign: Account<'info, Campaign>,
}

#[event]
pub struct Refunded {
    pub campaign_id: [u8; 32],
    pub lamports: u64,
}

pub fn handle_refund(ctx: Context<Refund>) -> Result<()> {
    let now_ms = Clock::get()?.unix_timestamp.checked_mul(1000).ok_or(EscrowError::Overflow)?;
    require!(now_ms >= ctx.accounts.campaign.refund_after_ms, EscrowError::RefundTooEarly);
    emit!(Refunded { campaign_id: ctx.accounts.campaign.campaign_id, lamports: ctx.accounts.campaign.to_account_info().lamports() });
    Ok(())
}
