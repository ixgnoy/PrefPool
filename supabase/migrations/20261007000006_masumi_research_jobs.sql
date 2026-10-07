-- Task 8.15: PrefPool as a hireable Masumi agent (/masumi/research). One row per MIP-003 job; the job's status is
-- derived live from its campaign's state, so only the link and the purchaser's reference are stored.
create table masumi_research_jobs (
  id                        text primary key,
  campaign_id               text not null references campaigns(id),
  identifier_from_purchaser text,
  created_at                timestamptz not null default now()
);
alter table masumi_research_jobs enable row level security;
