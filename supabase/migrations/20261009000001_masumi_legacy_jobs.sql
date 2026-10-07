-- Task 9.1 fix: jobs created by the x402-funded research agent (8.15) have no Masumi payment. The previous migration's
-- default marked them awaiting_payment, so the job tick polled the payment service with a null identifier.
update masumi_research_jobs set status = 'legacy_x402' where blockchain_identifier is null and status = 'awaiting_payment';
