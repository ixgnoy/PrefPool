use anchor_lang::prelude::*;

use crate::{constants::*, error::EscrowError, state::Campaign};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct FundArgs {
    pub campaign_id: [u8; 32],
    pub report_pk: [u8; 32],
    pub reward_lamports: u64,
    pub budget_lamports: u64,
    pub max_responses: u16,
    pub min_cohort: u16,
    pub deadline_ms: i64,
    pub refund_after_ms: i64,
}

#[derive(Accounts)]
#[instruction(args: FundArgs)]
pub struct Fund<'info> {
    #[account(mut)]
    pub company: Signer<'info>,
    #[account(
        init,
        payer = company,
        space = 8 + Campaign::INIT_SPACE,
        seeds = [CAMPAIGN_SEED, args.campaign_id.as_ref()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct Funded {
    pub campaign_id: [u8; 32],
    pub company: Pubkey,
    pub budget_lamports: u64,
}

pub fn handle_fund(ctx: Context<Fund>, args: FundArgs) -> Result<()> {
    // A payout to a fresh wallet must leave it rent-exempt, or the whole settle fails.
    require!(args.reward_lamports >= Rent::get()?.minimum_balance(0), EscrowError::RewardTooSmall);
    require!(
        args.min_cohort >= 1 && args.min_cohort <= args.max_responses && args.max_responses <= MAX_PAYEES,
        EscrowError::BadCohort
    );
    let now_ms = Clock::get()?.unix_timestamp.checked_mul(1000).ok_or(EscrowError::Overflow)?;
    require!(args.deadline_ms > now_ms && args.deadline_ms < args.refund_after_ms, EscrowError::BadSchedule);
    let max_payout = args.reward_lamports.checked_mul(args.max_responses as u64).ok_or(EscrowError::Overflow)?;
    require!(args.budget_lamports >= max_payout, EscrowError::BudgetTooSmall);

    let c = &mut ctx.accounts.campaign;
    c.campaign_id = args.campaign_id;
    c.company = ctx.accounts.company.key();
    c.report_pk = args.report_pk;
    c.reward_lamports = args.reward_lamports;
    c.budget_lamports = args.budget_lamports;
    c.max_responses = args.max_responses;
    c.min_cohort = args.min_cohort;
    c.deadline_ms = args.deadline_ms;
    c.refund_after_ms = args.refund_after_ms;
    c.bump = ctx.bumps.campaign;

    let cpi = anchor_lang::system_program::Transfer {
        from: ctx.accounts.company.to_account_info(),
        to: ctx.accounts.campaign.to_account_info(),
    };
    anchor_lang::system_program::transfer(CpiContext::new(anchor_lang::system_program::ID, cpi), args.budget_lamports)?;

    emit!(Funded { campaign_id: args.campaign_id, company: ctx.accounts.company.key(), budget_lamports: args.budget_lamports });
    Ok(())
}
