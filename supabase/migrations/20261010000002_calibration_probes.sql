-- Abstention probes (G13): the owner marks up to 5 questions the agent could not have known; the agent had to answer
-- "unknown" there. Null when the owner marked none.
alter table calibration_rounds add column abstain_rate numeric;
