# Money v1 — Milestone 3 test plan

Companion to `money-v1-m3-agreements-installments-vat.md`. Written before implementation. Bracketed numbers are the brief's acceptance criteria.

## Unit (pure, no I/O)

| File | Cases |
|---|---|
| `src/__tests__/vat.test.ts` | table-driven, every row asserts net + vat = gross and no `number` in the path: 18 % exclusive on 1000.00 → 180.00 / 1180.00; 18 % inclusive on 1180.00 → 1000.00 / 180.00; inclusive on 100.00 at 18 % → net 84.75, vat 15.25 (half-up on 84.7457…); inclusive on 0.01; exclusive on 0.01 → vat 0.00; 17 % vs 18 % on the same amount; 16 % (PS) on 1234.56 both bases; `ZERO_RATED` / `EXEMPT` / `OUT_OF_SCOPE` → vat 0, rate frozen 0; negative amounts (supplements) round symmetrically; rate 0 bp and 10000 bp bounds; rejects rate > 10000 |
| `src/agreements/__tests__/schedule.test.ts` | amounts: 3 × 333.33 + 333.34 on 1000.00 accepted; 3 × 333.33 → `INSTALLMENTS_DO_NOT_SUM` with difference 0.01; percents 3333/3333/3334 bp on 1000.00 → 333.30 / 333.30 / 333.40; 50/50 on 0.01 → 0.01 / 0.00 (last absorbs negative remainder correctly? no: 0.00 / 0.01 — last absorbs); percents summing to 9999 → `PERCENTS_DO_NOT_SUM`; mixed → `MIXED_INSTALLMENT_BASIS`; 1 and 60 installments ok, 61 rejected; per-installment net/vat sum to agreement net/vat for 7 uneven installments at 18 % inclusive; position and labels preserved |
| `src/agreements/__tests__/status.test.ts` | every cell of (posted?, due vs today, paid) → `PENDING / DUE / OVERDUE / PARTIALLY_PAID / PAID`; due today is `DUE` not `OVERDUE`; paid = gross is `PAID` even when overdue; `PARTIALLY_PAID` beats `OVERDUE`? — no: overdue with partial payment is `OVERDUE` (outstanding > 0 past due) — pinned either way per brief |
| `src/__tests__/dates.test.ts` | `today('Asia/Jerusalem')` vs `today('UTC')` differ across midnight; `YYYY-MM-DD` compare; `addDays` across month/year ends; invalid timezone → `VALIDATION_FAILED` at organization creation (admin route) |
| `src/agreements/__tests__/preview-token.test.ts` | token changes with body, organization and rate; stable otherwise; constant-time verify |

## Storage contract (`store-contract-m3.ts`, memory + Postgres)

| Case |
|---|
| vat rates: append by effective date, unique per (org, effective_from), `effectiveOn(date)` picks the latest ≤ date, organizations isolated |
| create agreement with installments atomically (an invalid installment rolls back the agreement); BigInt round-trips (amounts ≥ 2^53 minor units) |
| post installment: creates the receivable, sets `posted_at`, idempotent (second post returns the same receivable id), transactional under concurrency (two posters → one receivable) |
| supplements: append; resulting amount recorded; installment amounts updated with version bump |
| receivables: list by customer / project / currency / due range, keyset pagination, `paid_minor` seeded to exercise statuses; cross-org isolation |
| cancel: only with no posted installment; installments marked void |
| `projects.hasPostedActivity` true once an agreement exists; `projects.countOutstanding` for the archive guard |

## Routes (`routes-m3.test.ts`, in-memory app, injected clock + organization timezone)

| Area | Cases |
|---|---|
| VAT | `PUT /settings/vat` scope matrix; 0–10000 bp; same date same value → 200; same date different value → 409 `RATE_ALREADY_SET`; `GET /vat-rates` newest first with `current` [1] |
| Preview | `STANDARD_RATED` without a rate → 422 `VAT_RATE_MISSING`; totals and installments match the pure modules; `previewToken` present; preview writes nothing [2] |
| Create | token mismatch → 409 `PREVIEW_STALE`; rate changed after preview → 409 `PREVIEW_STALE`; archived project / customer → 422; `currency` ≠ project currency → 422 `CURRENCY_MISMATCH`; `IMMEDIATE` installment posted with receivable due on `agreementDate`; `DATE` in the past posted, in the future `PENDING`; `MANUAL` pending; audit `agreement.created` + one `installment.posted` per posted installment; replay with the same Idempotency-Key returns the same agreement [2][4][7] |
| Lazy posting | create with a `DATE` installment tomorrow; advance the clock; `GET /agreements/{id}` posts it exactly once; `GET /receivables` now lists it [3-posting] |
| Trigger | manual → 201 receivable with the given `dueDate`; second trigger → 200 same receivable; `DATE`/`IMMEDIATE` installment → 422 `NOT_MANUAL`; cancelled agreement → 409 `AGREEMENT_CANCELLED` [4] |
| Receivables | statuses `DUE` / `OVERDUE` by due date vs org-timezone today (the same instant is `DUE` in Jerusalem and `OVERDUE` in Auckland); seeded `paid_minor` → `PARTIALLY_PAID` / `PAID`; filters; pagination; cross-organization 404 [5] |
| Supplements | positive to last unposted; prorated across three unposted (last absorbs); new installment when all posted; negative within capacity; negative beyond capacity → 422 `SUPPLEMENT_EXCEEDS_UNPOSTED` with `requiresAdjustment.postedReceivables` and `shortfall`; contractual amount and totals updated; agreement `version` bumps; audit `agreement.supplemented` [6] |
| Cancel | with a posted installment → 409; without → 200, idempotent; cancelled agreement rejects supplements and triggers [5-decision] |
| Project lock | `PATCH /projects/{id}` currency after an agreement → 409 `CURRENCY_LOCKED`; archive with outstanding → 409 `PROJECT_HAS_OUTSTANDING` |
| Contract | every new path in `/openapi.json`; `info.version` `1.2.0-m3`; new reasons in the description; `openapi:check` green |

## Regression

- Every M1/M2 test green (117 today); `npm run smoke` unchanged.
- The M2 route test `locks currency once activity is posted` now uses a real agreement instead of `markProjectPosted`.

## Not automated

- Malafat-side wizard and tab (separate brief).
- A manual run on production after deploy: set the rate, preview + create one agreement on the pilot firm, confirm `GET /receivables` shows it.
