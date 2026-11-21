-- MUT-568 (ADR-259): ledger rows posted by an issued document. A new enum value sits alone in its migration
-- (PATTERNS: Postgres refuses to use a value inside the transaction that added it).
ALTER TYPE "ReceivableOrigin" ADD VALUE 'ISSUED_DOCUMENT';
ALTER TYPE "PaymentOrigin" ADD VALUE 'ISSUED_DOCUMENT';
