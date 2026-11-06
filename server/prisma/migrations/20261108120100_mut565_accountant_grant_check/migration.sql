-- MUT-565 (ADR-251): an ACCOUNTANT grant covers a person (their client books), never one profile. The operator
-- action refuses it with 422 first; this keeps a raw insert from doing it either.
--
-- To revert, ship a new migration: ALTER TABLE "entitlement_grants" DROP CONSTRAINT "entitlement_grants_accountant_person_check";

ALTER TABLE "entitlement_grants"
  ADD CONSTRAINT "entitlement_grants_accountant_person_check" CHECK ("tier" <> 'ACCOUNTANT' OR "userId" IS NOT NULL);
