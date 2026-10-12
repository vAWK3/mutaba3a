-- MUT-100: the CONTINGENCY agreement type, alone. Postgres refuses a new enum value inside the transaction that
-- added it ("unsafe use of new value"), so everything that names it lives in the next migration (eng review D3).

-- AlterEnum
ALTER TYPE "AgreementType" ADD VALUE 'CONTINGENCY';
