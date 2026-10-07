pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("Cm1NmUPngoFke9pc8zXsK2qebBEfPb76bS3gHfjMS2hN");

#[program]
pub mod campaign_escrow {
    use super::*;

    /// Lock a campaign's budget in its escrow PDA.
    pub fn fund(ctx: Context<Fund>, args: FundArgs) -> Result<()> {
        crate::instructions::fund::handle_fund(ctx, args)
    }

    /// Pay the CRE-signed payee list (remaining accounts) and close the escrow to the company.
    pub fn settle<'info>(ctx: Context<'info, Settle<'info>>, report_hash: [u8; 32]) -> Result<()> {
        crate::instructions::settle::handle_settle(ctx, report_hash)
    }

    /// Return the whole escrow to the company after refund_after.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        crate::instructions::refund::handle_refund(ctx)
    }
}
