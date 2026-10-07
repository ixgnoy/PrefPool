-- Buyer-facing wording advice from screening (shared/src/lint.ts), kept for abuse telemetry per buyer.
alter table campaigns add column lint_warnings jsonb;
