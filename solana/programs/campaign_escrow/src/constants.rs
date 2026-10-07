use anchor_lang::prelude::*;

#[constant]
pub const CAMPAIGN_SEED: &[u8] = b"campaign";

/// Domain tag of the digest CRE signs (see `settle_digest`), so a report-key signature can't be reused elsewhere.
pub const SETTLE_DOMAIN: &[u8] = b"prefpool:settle:v1";

/// Upper bound on payees per settle: one legacy transaction (1232 bytes) fits about 21 extra accounts next to the
/// Ed25519 instruction, so campaigns are capped below that.
#[constant]
pub const MAX_PAYEES: u16 = 20;
