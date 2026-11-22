-- MUT-662: the payment request (חשבון עסקה, code 300). Alone in its own migration: Postgres can't use a new enum value
-- in the transaction that adds it.
ALTER TYPE "IssuedDocType" ADD VALUE 'PAYMENT_REQUEST';
