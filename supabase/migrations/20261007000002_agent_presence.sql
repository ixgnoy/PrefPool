-- Redesigned web app (FRONTEND_PRD §5.3–5.6): agent connection status and pause toggle.
alter table agents add column last_seen_at timestamptz;
alter table agents add column paused boolean not null default false;
