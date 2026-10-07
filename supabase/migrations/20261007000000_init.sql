-- Agent Survey Marketplace: platform schema. The server is the only client (direct Postgres connection);
-- RLS is enabled with no policies so the Supabase anon/publishable key can read nothing.

create table campaigns (
  id               text primary key check (id ~ '^[0-9a-f]{64}$'),
  spec             jsonb not null,
  state            text not null check (state in (
                     'DRAFT','REJECTED','AWAITING_FUNDING','FUNDING_SUBMITTED','FUNDING_FAILED','FUNDED','ACTIVE',
                     'AGGREGATING','INSUFFICIENT_COHORT','SETTLEMENT_READY','SETTLEMENT_SUBMITTED','SETTLEMENT_FAILED',
                     'SETTLED','REFUNDED')),
  buyer_address    text not null,
  buyer_pkh        text not null,
  buyer_stake      text,
  access_token_hash text not null unique,
  reject_reasons   jsonb,
  deadline_ms      bigint not null,
  refund_after_ms  bigint not null,
  pending_fund_tx  text,
  fund_tx_hash     text,
  escrow_tx_ref    text,
  settlement_tx_hash text,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index campaigns_state_idx on campaigns (state);

create table agents (
  id          text primary key,
  kind        text not null check (kind in ('synthetic','live','plugin','masumi')),
  address     text not null unique,
  token_hash  text not null unique,
  policy      jsonb,
  profile     jsonb,
  created_at  timestamptz not null default now()
);

create table auth_nonces (
  address    text primary key,
  nonce      text not null,
  expires_at timestamptz not null
);

create table sessions (
  token_hash text primary key,
  address    text not null,
  expires_at timestamptz not null
);

create table agent_decisions (
  campaign_id text not null references campaigns(id),
  agent_id    text not null references agents(id),
  kind        text not null check (kind in ('answer','abstain')),
  reason      text,
  created_at  timestamptz not null default now(),
  primary key (campaign_id, agent_id)
);

create table envelopes (
  campaign_id        text not null references campaigns(id),
  respondent_address text not null,
  envelope           jsonb not null,
  received_at_ms     bigint not null,
  primary key (campaign_id, respondent_address)
);

create table cre_jobs (
  id          text primary key,
  campaign_id text not null unique references campaigns(id),
  status      text not null check (status in ('queued','running','done','failed')),
  log         text,
  claimed_at  timestamptz,
  finished_at timestamptz
);

create table reports (
  campaign_id text primary key references campaigns(id),
  settlement  jsonb not null,
  research    jsonb,
  report_hash text not null unique,
  evm_tx      text,
  created_at  timestamptz not null default now()
);

create table masumi_jobs (
  id          text primary key,
  agent_id    text not null references agents(id),
  campaign_id text not null references campaigns(id),
  status      text not null,
  output      jsonb,
  created_at  timestamptz not null default now()
);

alter table campaigns enable row level security;
alter table agents enable row level security;
alter table auth_nonces enable row level security;
alter table sessions enable row level security;
alter table agent_decisions enable row level security;
alter table envelopes enable row level security;
alter table cre_jobs enable row level security;
alter table reports enable row level security;
alter table masumi_jobs enable row level security;
