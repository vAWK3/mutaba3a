# MUT-100 — Contingency fee agreements: test plan

TDD: each file below is written first and watched fail for the right reason. Figures in the acceptance examples: VAT 18 %, VAT on top (VAT_EXCLUSIVE, STANDARD_RATED), upfront ₪1,500, rate 20 % (2000 bp).

Commands (Node 22, see TD-054): `cd server && npm run typecheck && npm run lint && npm test && npm run test:db && npm run openapi:check`; root `npm run hosted:types:check && npm run typecheck`.

## 1. Pure domain — `server/src/agreements/__tests__/contingency.test.ts`

| Case | Proves |
|---|---|
| SEPARATE, award 100,000 → commission 20,000, billable 20,000 | AC 1 |
| CREDITED, award 100,000, counted 1,500 → applied 1,500, billable 18,500 | AC 2 |
| CREDITED, award 5,000 → commission 1,000, applied 1,000, billable 0 | AC 3 (upfront kept, nothing billed) |
| NO_RECOVERY → all zeros | AC 4 |
| 33.33 % (3333 bp) × 100.01 → half-up; 20.5 % (2050 bp) half-up | rounding AC, CEO §6 |
| rate bounds 0 / 1 / 10000 / 10001 / 20.5 (non-integer) | rate-bounds AC |
| counted: credits reduce it, VAT_EXCLUSIVE uses stored `netMinor`, VAT_INCLUSIVE stored `amountMinor` | AC 6, R4/D6 |
| counted: two credits whose recomputed split differs by 1 from the stored nets → stored nets win | R4/D6 |
| counted: unposted and unpaid upfront still count; voided and commission lines never count; never below 0 | AC 6 |
| upfront 0 → counted 0 | ₪0 upfront |

## 2. Summaries — `server/src/summaries/__tests__/compute.test.ts` (added rows; existing rows untouched)

| Case | Proves |
|---|---|
| contingency-only project → kind FIXED, agreed = upfront | D6 |
| awaiting outcome, upfront paid → PENDING (never PAID_IN_FULL) | ticket scope |
| after AWARDED with the commission posted and unpaid → OUTSTANDING; `contingency.outcome = AWARDED` | ticket scope |
| hearing FIXED + contingency → agreed sums both | AC 7 |
| FIXED + RETAINER mix → kind FIXED, monthly set, agreed = FIXED sum | R5/D7 regression row |

## 3. Routes — `server/src/__tests__/routes-mut100.test.ts`

Create / terms / cancel / supplements:
- create SEPARATE and CREDITED; upfront ₪0 with `installments: []` (nothing posted); `contingency` echoed on the agreement and the preview.
- FIXED with `installments: []` → 422 `details.reason = NO_INSTALLMENTS` (the one intentional change, R5/D7).
- rate 0 / 10001 → 422 `COMMISSION_RATE_INVALID`; negative upfront → 422 `AMOUNT_INVALID`.
- PATCH `/contingency`: If-Match; changes rate; nothing changed → 422 `CHANGE_NOTHING_CHANGED`; FIXED → 422 `NOT_CONTINGENCY`; stale → 409 `VERSION_MISMATCH`; after an outcome → 409 `OUTCOME_ALREADY_RECORDED`; audit `agreement.contingency_terms_changed {from,to}`.
- cancel before an outcome with nothing posted → 200; after a NO_RECOVERY outcome → 409 `OUTCOME_ALREADY_RECORDED`; supplement → 422 `NOT_FIXED`.

Outcome:
- AC 1–4 end to end: SEPARATE 100,000 → one receivable 23,600 (20,000 + 3,600) dated on the outcome date; CREDITED 100,000 → 21,830 (18,500 + 3,330); CREDITED 5,000 → no receivable, outcome recorded; NO_RECOVERY → no receivable, upfront receivables untouched.
- AC 5 VAT change: 17 % from 2024-01-01, 18 % from 2025-01-01; agreement 2024-06-01, outcome 2026-10-01 → upfront at 17 %, commission at 18 %.
- due date: outcome date + payment terms by default; `dueDate` override wins.
- AC 6 credit on the upfront between preview and record → 409 `PREVIEW_STALE` (R2/D4); after re-preview, counted reflects the credit's stored net.
- AC 7 a FIXED hearing agreement on the same project leaves the commission unchanged and counts in `agreed`.
- AC 8 second record → 409 `OUTCOME_ALREADY_RECORDED`; terms after outcome → 409.
- concurrency: two records with the same fresh token race → one 200, one 409.
- idempotent replay of a record returns the same response and posts once.
- correct while unpaid: old receivable credited in full, old installment VOID, new one posted; correct with a rate fix (20 % → 25 %) and a treatment flip (R3/D5); correction matrix AWARDED→NO_RECOVERY (credit, void, nothing posted), NO_RECOVERY→AWARDED (no credit, new line), CREDITED zero-billable → larger award.
- AC 10 correct after a payment → 409 `OUTCOME_HAS_PAYMENTS`; a payment allocated between preview and correct → 409 (`PREVIEW_STALE` from the token, `OUTCOME_HAS_PAYMENTS` from the store when the token cannot see it), never 500.
- correct without an outcome → 409 `OUTCOME_NOT_RECORDED`; `correctionReason` missing → 422.
- crash heal: a commission installment left unposted posts on the next read, dated on the outcome date.
- AC 11 audit metadata of `agreement.outcome_recorded` and `agreement.outcome_corrected` pinned, money as decimal strings.
- AC 12 validation: award 0 / negative / 3 decimals → 422 `AMOUNT_INVALID`; NO_RECOVERY with an award → 422 `AMOUNT_INVALID` (`field: awardedAmount`); AWARDED without a label → 422 `COMMISSION_LABEL_REQUIRED`; future and pre-agreement outcome dates → 422 `OUTCOME_DATE_INVALID`; FIXED agreement → 422 `NOT_CONTINGENCY`; 2050 bp accepted.
- `VAT_RATE_MISSING` when billable > 0, standard-rated, no rate on the outcome date.
- session write → 403 `READ_ONLY_PROFILE` (also covered generically by `writability-routes.test.ts`).
- project summary: `contingency` block, AWAITING → AWARDED, status PENDING while awaiting.

## 4. Store contract — `server/src/repositories/__tests__/store-contract-mut100.ts` (memory always, Prisma under `test:db`)

- create persists the terms; `updateContingencyTerms` bumps the version, `stale` on a wrong one.
- `recordOutcome` writes outcome + commission installment + totals + version in one step; `stale` on a wrong version and when an outcome already exists.
- `correctOutcome` credits the old receivable in full, voids the old installment, writes the new outcome/terms/installment; all-or-nothing on a stale version; `has_payments` (nothing written) when the receivable gained a payment between preview and write.
- `isCommission` round-trips; `listUnpostedDue` returns an unposted commission installment.

## 5. Migrations — `server/src/repositories/__tests__/migration-mut100.test.ts` (`test:db`)

- both MUT-100 migrations apply in order on a scratch database built from the history before them; the CHECK refuses a CONTINGENCY row without a rate or treatment, and a rate outside 1..10000; `prisma migrate diff` against `schema.prisma` is empty.

## 6. Regression contract (R5/D7)

Every existing server suite passes with its assertions unchanged: routes-m2..m8, compute, schedule, store contracts (memory + Prisma), writability-drift, writability-routes, route-security. Edits allowed in existing files: the API version pins (`1.16.0-mut100`) and record fixtures gaining the new fields (`commissionRateBasisPoints`, `isCommission`, …) so they still typecheck.

`npm run typecheck` is the proof for R9/D1 (audit metadata is JSON-typed).
