# Money v1 — Milestone 5 test plan

Companion to `money-v1-m5-retainer-changes.md`. Written before implementation.

## Unit (pure)

| File | Cases |
|---|---|
| `src/retainers/__tests__/terms.test.ts` | timeline synthesizes v1 from the agreement; `termsFor` picks the latest version ≤ month, v1 before any change; `validateChange`: before start, after end, after cancel month, not after latest version, nothing changed, cancelled agreement; `diffTerms` lists changed fields |
| `src/retainers/__tests__/proration.test.ts` | 31-day month day 18 → 18/31; 30-day; February 28 and 29; day 1 and last day (= full); half-up rounding pinned on odd amounts; `cancelOutcome`: FULL → no final-charge change, no adjustment; PRORATE unposted → prorated final charge; PRORATE posted → credit = gross − prorated gross, capped at outstanding with `limitedByPayments`; WAIVE posted → credit = outstanding; WAIVE unposted → no charge |
| `src/retainers/__tests__/schedule.test.ts` | PRORATE charges the cancel month (like FULL) |

## Storage contract (`store-contract-m5.ts`, memory + Postgres)

- `retainerVersions.append` is unique per (agreement, version) and lists in version order; cross-organization isolation.
- `createPostedCharge` stores `version`; `cancel` stores `cancelEffectiveDate` and `PRORATE`.

## Routes (`routes-m5.test.ts`)

- Change preview: previous/next terms, first charged month, `chargesKept`; VAT rate resolved on the effective month; reasons for each invalid case; `NOT_RECURRING` on a fixed agreement; 409 `AGREEMENT_CANCELLED`.
- Change: token mismatch → 409 `PREVIEW_STALE`; 201 with `versions` [v1, v2]; a later reconcile charges the month before the effective month at old terms and the effective month at new terms with `version 2`; replay returns the same body; a second change must be after v2; audit `retainer.changed`.
- Cancel preview: FULL / PRORATE / WAIVE on an unposted final month and on a posted one (with a part payment → `limitedByPayments`); `FINAL_MONTH_INVALID` before start.
- Cancel: PRORATE unposted → the final charge posts at the prorated gross when its date arrives; PRORATE posted → credit created, receivable `outstanding` reduced, agreement `finalMonth PRORATE`, `cancelEffectiveDate`; WAIVE posted → receivable settled; missing token when a credit is needed → 422 `PREVIEW_TOKEN_REQUIRED`; already cancelled → unchanged; audit `retainer.cancelled` + `receivable.credited`.
- Contract: new paths in `/openapi.json`; version `1.4.0-m5`; new reasons published.

## Script

- `src/scripts/reconcile.ts` runs against the memory store in a test: posts due items for every organization and prints a per-organization summary; exits non-zero on a store failure.

## Malafat

- Client methods + contract test for the three new calls; `retainers-service` (or `agreements-service`) `previewRetainerChange`, `changeRetainer`, `previewRetainerCancel`; routes with specs and role matrix; i18n parity for the new blocks and `PRORATE`; cancel body accepts `PRORATE` + `previewToken`.
