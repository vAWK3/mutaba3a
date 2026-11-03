-- MUT-534 (ADR-243): each come-back stage is mailed, and the offer opened, once per person, ever (epic rule 2): a retry
-- never claims it twice. Its own migration, after the one that adds COMEBACK_OFFERED.
--
-- To revert, ship a new migration: DROP INDEX "billing_retention_events_one_comeback_stage";
CREATE UNIQUE INDEX "billing_retention_events_one_comeback_stage" ON "billing_retention_events"("userId", "reason") WHERE "kind" = 'COMEBACK_OFFERED';
