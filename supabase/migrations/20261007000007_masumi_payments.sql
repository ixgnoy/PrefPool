-- Task 9.1: the research agent is paid over the Masumi payment protocol. A job now exists before its campaign: the
-- campaign is created (and funded by the platform wallet) only once the payment service reports FundsLocked.
alter table masumi_research_jobs alter column campaign_id drop not null;
alter table masumi_research_jobs
  add column status                       text not null default 'awaiting_payment', -- awaiting_payment|running|completed|failed
  add column input                        jsonb,
  add column input_hash                   text,
  add column blockchain_identifier        text unique,
  add column pay_by_ms                    bigint,
  add column submit_result_ms             bigint,
  add column result                       text,
  add column result_hash                  text,
  add column message                      text,
  add column updated_at                   timestamptz not null default now();
create index masumi_research_jobs_open on masumi_research_jobs (status) where status in ('awaiting_payment', 'running');
