use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Reward must cover the rent-exempt minimum of a payee account")]
    RewardTooSmall,
    #[msg("Cohort bounds must satisfy 1 <= min_cohort <= max_responses <= MAX_PAYEES")]
    BadCohort,
    #[msg("Deadline must be in the future and before refund_after")]
    BadSchedule,
    #[msg("Budget must cover reward * max_responses")]
    BudgetTooSmall,
    #[msg("Settle is only allowed in [deadline, refund_after)")]
    OutsideSettleWindow,
    #[msg("Refund is only allowed from refund_after")]
    RefundTooEarly,
    #[msg("Payee count must be 0 or within [min_cohort, max_responses]")]
    BadPayeeCount,
    #[msg("The previous instruction must be one Ed25519 verification of the report key over the settle digest")]
    MissingReportSignature,
    #[msg("The Ed25519 instruction signs a different key or message")]
    WrongReportSignature,
    #[msg("Payee accounts must be writable and must not be the escrow itself")]
    BadPayeeAccount,
    #[msg("Arithmetic overflow")]
    Overflow,
}
