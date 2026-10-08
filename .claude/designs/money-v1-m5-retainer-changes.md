# Money v1 — Milestone 5: retainer changes, proration, cancel preview, scheduled reconcile (design brief)

- **Date:** 2026-10-08 · **Status:** decided by the engineering owner under the "complete the epic" instruction; implemented the same day (Mutaba3a `server/`, API `1.4.0-m5`; Malafat side in §6)
- **Tickets:** MAL-939 (epic), MAL-150 (UX brief, wireframe §8) · **Plan:** `money-v1-api-contract.md` §M5 · **Builds on:** M3 rev. 2 §C (basic retainers), M4 (credits, operations)
- **Repo side:** Mutaba3a `server/` (schema, store, routes, tests, OpenAPI) and Malafat `crm-platform/apps/web` (change-retainer dialog, cancel preview, Malafat routes). Malafat schema unchanged (ADR-150).

## 1. Problem and acceptance criteria

M3 shipped retainers in their basic form: one set of terms for the life of the agreement, and a cancel that keeps or waives the final month. Real engagements change: the fee is reviewed annually, the billing day moves, a retainer ends mid-month. Today a change is "cancel + new retainer", which breaks the history and the project view, and a mid-month end either over-charges (FULL) or forgives the month (WAIVE).

1. **Changes** — `POST /v1/retainers/{id}/changes/preview` and `POST /v1/retainers/{id}/changes`: an effective-dated new version of the terms (monthly amount, pricing basis, VAT treatment, billing day, payment terms, end month). History is immutable: versions are appended, never edited; charges already generated keep their terms (wireframe §8 "Charges already generated keep their original terms").
2. **Cancel preview and proration** — `POST /v1/retainers/{id}/cancel/preview`, and `finalMonth: FULL | PRORATE | WAIVE` on cancel. PRORATE charges the final month for the days up to and including the cancellation date, calendar-day basis. When the final month's charge is **already posted**, WAIVE and PRORATE create the explicit adjustment M3 pointed at: a credit on that charge's receivable (M4 credits), bounded by what is still outstanding — what was paid is not refunded by a credit (M4 rule).
3. **Scheduled reconcile** — the reconcile exists since M3 (`POST /v1/retainers/reconcile`, lazy posting on reads). M5 adds the operator-side runner the contract names: `npm run reconcile` (`src/scripts/reconcile.ts`) walks every organization and posts due items in its timezone, for a cron / Cloud Scheduler job. Documented as an operator step; nothing in the API changes.

Acceptance:

- A change effective from a future month leaves every generated charge untouched; the first charge on or after the effective month carries the new terms and the version number; the preview shows previous vs. new terms and the first affected month.
- A change on a cancelled retainer, a non-retainer, a month before the start, after the end/cancel month, or not after the latest version's effective month is refused with a named reason; a change that changes nothing is refused.
- Cancel preview returns the final-month outcome for the chosen option (days ÷ days in month, prorated net/VAT/gross), what happens to an already-posted charge (credit amount, limited by outstanding), the next months that stop, and the retainer's outstanding after the adjustment; cancel applies exactly that and is idempotent (same key → same body; second cancel with a new key → the existing cancellation, unchanged).
- Proration is deterministic BigInt arithmetic, half-up on minor units, pinned by tests for 28/29/30/31-day months.
- Every M1–M4 test stays green; `openapi:check` green; API version `1.4.0-m5`.

## 2. API

| Method & path | Scope | Idempotent | Notes |
|---|---|---|---|
| `POST /v1/retainers/{id}/changes/preview` | `agreements:read` | — | `{ effectiveMonth, monthlyAmount?, pricingBasis?, vatTreatment?, billingDay?, paymentTerms?, endMonth? (null clears), reason }` → `{ previous: Terms, next: Terms, effectiveMonth, firstChargedMonth, chargesKept: IsoMonth[] (generated months ≥ effectiveMonth that keep their terms), previewToken }`. `Terms = { version, effectiveMonth, monthlyAmount, net, vat, gross, pricingBasis, vatTreatment, rateBasisPoints, billingDay, paymentTerms, endMonth }`. The VAT rate for the new version is the one in force on the first day of `effectiveMonth` (resolved as for a new agreement); `VAT_RATE_MISSING` if standard-rated and none |
| `POST /v1/retainers/{id}/changes` | `agreements:write` | `Idempotency-Key` | same body + `previewToken` (covers body, agreement version, latest version's effective month and the rate) → `201 RetainerChargesResponse` (agreement, versions, charges). Audit `retainer.changed` |
| `GET /v1/retainers/{id}/charges` | `payments:read` | — | response gains `versions: RetainerVersion[]` (version 1 synthesized from the agreement when no row exists) and each charge gains `version` |
| `POST /v1/retainers/{id}/cancel/preview` | `agreements:read` | — | `{ effectiveDate, finalMonth: FULL\|PRORATE\|WAIVE }` → `{ effectiveMonth, finalMonth, finalCharge: { serviceMonth, days, daysInMonth, amount, net, vat, gross } \| null, postedCharge: { chargeId, receivableId, gross, paid, credited, outstanding } \| null, adjustment: { amount, net, vat, limitedByPayments } \| null, stoppedFrom: IsoMonth \| null, outstandingAfter, previewToken }` |
| `POST /v1/retainers/{id}/cancel` | `agreements:write` | `Idempotency-Key` | body gains `PRORATE`; optional `previewToken` (required for PRORATE and for WAIVE on a posted charge — anything that creates a credit); applies the cancellation and, when the final month is posted, the credit (`receivable.credited` audit with `source: RETAINER_CANCEL`). Already cancelled → the existing record, unchanged |

New reasons (422): `CHANGE_EFFECTIVE_INVALID` (before start, after end/cancel, or not after the latest version), `CHANGE_NOTHING_CHANGED`, `FINAL_MONTH_INVALID` (effective date before the start month). Existing: `NOT_RECURRING`, `AGREEMENT_CANCELLED` (409 on changing a cancelled retainer), `PREVIEW_STALE`, `VAT_RATE_MISSING`, `BILLING_DAY_INVALID`, `END_BEFORE_START`, `AMOUNT_INVALID`.

## 3. Data model

- `retainer_versions` (new): `id, organizationId, agreementId, version (int, unique per agreement), effectiveMonth, monthlyAmountMinor, netMinor, vatMinor, grossMinor, pricingBasis, vatTreatment, rateBasisPoints, billingDay, paymentTerms, endMonth?, reason, requestId?, createdAt`. Version 1 is **not** stored for existing retainers: the domain synthesizes it from the agreement row (`startMonth`, amount, basis, treatment, rate, billing day, terms, end month). A change appends version n ≥ 2. The agreement row keeps the original terms (immutable, like a fixed agreement's amount before supplements); `retainer.currentVersion` on the wire names the version in force this month.
- `retainer_charges.version` (int, default 1): the version whose terms the charge carries.
- `agreements.cancelEffectiveDate` (date string, nullable): the day the retainer stopped, needed to prorate; `FinalMonth` enum gains `PRORATE`.
- Migration `m5_retainer_versions_proration` — additive; existing rows unaffected (`version` defaults to 1).

## 4. Rules (pure modules)

- `retainers/terms.ts`: `termsTimeline(agreement, versions)` → ordered versions incl. the synthesized v1; `termsFor(timeline, month)` → the latest version with `effectiveMonth ≤ month`; `validateChange(timeline, agreement, change, today)`; `diffTerms(prev, next)` (what changed).
- `retainers/proration.ts`: `prorate({ amountMinor, effectiveDate })` → `{ days, daysInMonth, amountMinor }` with `amount × days ÷ daysInMonth`, half-up; days = day-of-month of the cancellation date (inclusive). `cancelOutcome({ terms, effectiveDate, finalMonth, postedCharge, receivable })` → the preview's `finalCharge`, `adjustment` (= posted gross − prorated gross for PRORATE, = outstanding for WAIVE — both capped at outstanding; `limitedByPayments` when the cap bit).
- `retainers/schedule.ts`: `chargeMonths` unchanged except PRORATE behaves like FULL for *which* months charge (the final month is charged, at the prorated amount); `generateCharges` computes each month's amount/VAT from `termsFor(month)` and, for the cancel month under PRORATE, from `prorate`.

## 5. Decisions (owner's, recorded for review)

1. **Versions, not edits.** The agreement row is never changed by a change; versions are appended and the schedule reads the version in force per service month. (Alternative: overwrite the agreement's amount and keep an audit trail — rejected: the trail would not drive the schedule, and a future-dated change would misreport "current".)
2. **The rate for a new version is the rate in force on the effective month's first day**, not the agreement's frozen rate — a changed fee is a new commitment, priced at today's VAT. Charges already generated keep their rate.
3. **Changes must be strictly forward in version order** (`effectiveMonth` after the latest version's) and may be effective in a month that is already charged — those charges keep their terms; only uncharged months pick up the change. This covers "the change was agreed last month, we are late recording it" without rewriting history.
4. **Proration is calendar-day, inclusive of the cancellation day**, computed on the monthly amount in its pricing basis, VAT then computed on the prorated amount at the version's rate — the same math as a charge. Wireframe §8 shows `18 ÷ 31`.
5. **A posted final month is adjusted by a credit, never by editing the charge.** WAIVE credits the outstanding; PRORATE credits the difference; both are capped at the outstanding (M4: what was paid is not refunded by a credit). The preview says so (`limitedByPayments`). FULL never credits.
6. **The cancel preview token is required only when a credit would be created** (PRORATE, or WAIVE on a posted month), so the M3 cancel body keeps working for FULL and for WAIVE on an unposted month.
7. **Reconcile runs as a script, not a long-lived scheduler.** `npm run reconcile` is idempotent and cheap; a cron / Cloud Scheduler job calls it (operator step). The API's lazy posting remains the primary mechanism.
8. **No cross-version reporting changes.** Summaries (M6) read receivables, which already carry each charge's amounts.

## 6. Malafat side (same brief)

- **Change retainer** dialog on the matter financial page (wireframe §8): new monthly amount, effective month, optional VAT treatment / billing day / payment terms / end month, reason; a Review block fetches the change preview (previous vs new terms, first charged month, charges kept); Apply posts with the token and an `attemptId`. Routes `POST /api/admin/money/retainers/{id}/changes/preview`, `POST …/changes`.
- **Cancel retainer** dialog gains PRORATE and an effect block from `POST /api/admin/money/retainers/{id}/cancel/preview` (final charge, posted charge, credit, stopped-from month, outstanding after) that re-fetches when the date or option changes; cancel sends the token.
- The retainer row on the matter page shows the current version's terms and a version history (from `versions`); charges show their version when more than one exists.
- i18n: `money.retainer.change.*`, `money.retainer.cancelPreview.*`, `enums.finalMonth.PRORATE`, three new reasons.

## 7. Out of scope

Retainer pause/resume; per-version documents; back-dated changes that re-price generated charges (use a credit or a supplement-like adjustment, M6+); a scheduler service inside the API process.
