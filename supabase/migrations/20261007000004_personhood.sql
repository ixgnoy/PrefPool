-- World ID "verified human" tier (docs/superpowers/specs/2026-10-07-world-id-personhood-design.md).
-- Only the nullifier for action 'cardanofish-seller' is kept: no proof, no identity data.
alter table agents add column personhood_kind text check (personhood_kind in ('world', 'simulated'));
alter table agents add column personhood_nullifier text unique;
alter table agents add column personhood_verified_at timestamptz;
-- Snapshot of the answering agent's nullifier: one human, one envelope per campaign, even under races.
alter table envelopes add column personhood_nullifier text;
create unique index envelopes_campaign_human on envelopes (campaign_id, personhood_nullifier)
  where personhood_nullifier is not null;
