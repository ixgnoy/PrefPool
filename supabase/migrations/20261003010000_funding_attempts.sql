-- WS7 Task 7.2: one row per x402 funding quote (MASTER_PLAN "Funding exchange").
-- unsigned_tx/nonce are not in the ws7 sketch: fund/build stores the tx it built for a quote so fund/sign
-- can merge the wallet witness into exactly that tx.
create table funding_attempts (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null references campaigns(id),
  requirements jsonb not null,
  datum_hex text not null,
  funder_address text not null,
  unsigned_tx text,
  nonce text,
  tx_id text unique,
  ttl_ms bigint not null,
  state text not null check (state in ('ISSUED','SUBMITTED','CONFIRMED','DEAD','REJECTED')),
  last_error text,
  created_at timestamptz not null default now()
);
create index on funding_attempts (campaign_id, state);
alter table funding_attempts enable row level security;
