-- Encrypt to self (owner transcripts): agents seal a second copy of each answer to the owner's transcript key.
-- The platform stores only ciphertext; the owner's browser derives the private key from a wallet signature.
alter table agents add column transcript_pk text check (transcript_pk ~ '^[0-9a-f]{64}$');

create table answer_copies (
  campaign_id    text not null references campaigns(id),
  agent_id       text not null references agents(id),
  envelope       jsonb not null,
  received_at_ms bigint not null,
  primary key (campaign_id, agent_id)
);
alter table answer_copies enable row level security;
