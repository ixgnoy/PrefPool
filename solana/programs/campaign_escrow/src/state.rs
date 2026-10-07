use anchor_lang::prelude::*;

/// One escrow per campaign at PDA ["campaign", campaign_id]. Its lamports above rent are the locked budget.
#[account]
#[derive(InitSpace)]
pub struct Campaign {
    pub campaign_id: [u8; 32],
    /// Funder; receives the refund and the account's rent when the escrow closes.
    pub company: Pubkey,
    /// CRE's Ed25519 report key: only a payee list it signed can settle this escrow.
    pub report_pk: [u8; 32],
    pub reward_lamports: u64,
    pub budget_lamports: u64,
    pub max_responses: u16,
    pub min_cohort: u16,
    /// Unix milliseconds, like the rest of the platform.
    pub deadline_ms: i64,
    pub refund_after_ms: i64,
    pub bump: u8,
}
