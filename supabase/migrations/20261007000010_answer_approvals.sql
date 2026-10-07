-- Owner approval queue (policy approve_all). The plugin keeps the sealed answer; this holds only the owner's copy
-- (ciphertext to the transcript key) and the decision. Rows for finished campaigns are inert.
create table answer_approvals (
  campaign_id     text not null references campaigns(id),
  agent_id        text not null references agents(id),
  envelope        jsonb not null,
  state           text not null check (state in ('pending','approved','rejected')),
  requested_at_ms bigint not null,
  decided_at_ms   bigint,
  primary key (campaign_id, agent_id)
);
alter table answer_approvals enable row level security;
