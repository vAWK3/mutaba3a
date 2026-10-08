# Money v1 — Milestone 3, Malafat side: test plan

Companion to `money-v1-m3-malafat-ui.md`. All suites run with `pnpm exec vitest run <path>` from `crm-platform/apps/web`; Mutaba3a is always a recording fake (`fetchImpl` or a `Mutaba3aClient` object). Nothing here needs a database or a network.

## Unit

### `mutaba3a-client.test.ts` — "M3 methods"
- `listVatRates` → `GET /v1/vat-rates`; `setVatRate` → `PUT /v1/settings/vat` with `{rateBasisPoints, effectiveFrom}`, `created` from 201 vs 200.
- `previewAgreement` → `POST /v1/agreements/preview` without an Idempotency-Key; `createAgreement` → `POST /v1/agreements` with the key and the `previewToken` in the body.
- `listAgreements` query string carries `projectId`, `customerId`, `status`, `type`, `limit`, `cursor`; `getAgreement` → `GET /v1/agreements/{id}`.
- `addSupplement`, `cancelAgreement`, `triggerInstallment`, `createRetainer`, `cancelRetainer` carry the Idempotency-Key; `previewRetainer` does not; `listRetainerCharges` → `GET /v1/retainers/{id}/charges`; `listReceivables` query string carries `projectId`, `customerId`, `currency`, `status`, `dueBefore`, `dueAfter`.
- `patchCustomer` → `PATCH /v1/customers/{id}` with `If-Match: <version>`; `getCustomer` → `GET /v1/customers/{id}`.
- A 422 `VALIDATION_FAILED` with `details.reason = SUPPLEMENT_EXCEEDS_UNPOSTED` → reason `validation`, `validationReason` set, `details.requiresAdjustment` preserved on the error.
- A 409 with each of the four new conflict reasons → `conflictReason` set.
- The key never appears in any error message (existing assertion, re-run over the new methods).

### `vat-service.test.ts`
- `getVat`: not connected → `connected: false`, no Mutaba3a call; connected → rates newest first and `current` as returned.
- `setVatRate`: validates basis points 0–10000 and `YYYY-MM-DD` before calling; passes the body through; `created` reflects 201/200; conflicts pass through untouched.

### `agreements-service.test.ts`
- `resolveMatterLink`: looks the project up by `externalId = matterId`; absent → `MoneyConnectionError("not_linked")`; present → `{projectId, currency, customerId}`.
- `getMatterFinancial`: lists agreements by project, fetches each detail (fixed) or charges (recurring), lists receivables by project, returns the composed view with Mutaba3a's figures and statuses verbatim; counts posted and overdue receivables; empty project → empty arrays, `hasAgreements: false`.
- `previewFixedAgreement` / `createFixedAgreement`: body carries `projectId` (never the matter id), the Idempotency-Key is `malafat-agreement-{tenant}-{attemptId}`, the same `attemptId` yields the same key, the `previewToken` is forwarded.
- `previewRetainer` / `createRetainer`: same for retainers (`malafat-retainer-…`).
- `triggerInstallment`, `addSupplement`, `cancelAgreement`, `cancelRetainer`: derived keys per action; `dueDate` optional on trigger; supplement body forwarded with `newInstallment` only for `NEW_INSTALLMENT`.
- `getClientFinancial`: customer by `externalId = clientId`; agreements and receivables by customer; status label per matter: any OVERDUE → `overdue`; any DUE / PARTIALLY_PAID → `outstanding`; agreements but no open receivable → `up_to_date`; no agreements → `none`. Unlinked client → `linked: false`, matters listed with `none`.
- `setClientVatTreatment`: reads the customer for its version, PATCHes with `If-Match`, forwards `vatTreatment` (null clears it).

### `money-amount.test.ts` / `money-input.test.ts`
- `formatMoneyAmount("11800.00", "ILS", "en")` formats without a float round-trip (`"1234567890123.45"` keeps every digit); Arabic uses Western numerals; the sign of a negative amount is kept.
- `normaliseMoneyInput`: `"10,000.5"` → `"10000.50"` for ILS; `"10 000"` → `"10000.00"`; `"1.234"` (too many fraction digits) → `null`; `""` → `null`; `"-5"` → `"-5.00"`; leading `+` and letters → `null`.
- Percent → basis points (`percentToBasisPoints`): `"18"` → 1800, `"17.5"` → 1750, `"17.555"` → `null`, `"101"` → `null`.

### `money-i18n.test.ts` (extended)
- Every `VatTreatment`, `PricingBasis`, `PaymentTerms`, `TriggerType`, `ItemStatus`, `Distribution` value has a string under `money.enums.*`.
- Every published 422 reason and every published 409 reason has a string under `money.reasons.*` / `money.sync.conflicts.*`.
- Parity en/ar/he, no empty strings (existing).

### `mutaba3a-contract.test.ts` (extended)
- Every new path/method the client calls exists in the vendored 1.2.0-m3 contract, including `put` and `patch`.
- Query parameters for `/v1/agreements` and `/v1/receivables` are declared.
- `Agreement`, `Installment`, `Receivable`, `RetainerCharge`, `VatRate`, `AgreementPreviewResponse`, `RetainerPreviewResponse`, `SupplementResponse`, `TriggerInstallmentResponse` carry every field the domain types read.
- The reasons `money.reasons.*` names are the ones the contract description publishes.

## Routes (`api/admin/money/{vat,agreements}/__tests__/route.test.ts`)
- Every non-Partner role → 403 on every verb, no service call; unauthenticated → 401; read-only Partner reads `GET /vat` but gets 403 on every write.
- Body validation: `PUT /vat` rejects a rate outside 0–10000 and a malformed date (400); agreements/retainers routes reject a missing `attemptId`, `previewToken` of the wrong length, unknown `vatTreatment`, more than 60 installments; `trigger` accepts `{}` and `{dueDate}`; supplements require `newInstallment` only when `distribution = NEW_INSTALLMENT` (400 otherwise); `vat-treatment` accepts the four values and `null`.
- Happy paths: 200/201 per route with the service result echoed.
- Error mapping through `moneyErrorResponse`: `not_linked` → 409 `MONEY_NOT_LINKED`; `validation` with `validationReason` → 422 with `details.validationReason` and `details.requiresAdjustment`; `conflict` → 409 with `conflictReason`; unknown error → 500 without leaking.

## Regression scope
- M1 and M2 Money suites (client, connection, sync, contract, i18n, integration routes, sync routes) must stay green.
- Nav tests: the tab list is server-built in the matter page, not in `nav-model`, so counts are unchanged.
- `pnpm openapi:generate` then `pnpm openapi:check`; `pnpm check:api-contract`; `pnpm i18n:check`; `pnpm exec eslint` on the Money paths; `tsc --noEmit` for `apps/web` shows no Money errors.

## Not covered (manual, runbook §5)
- The wizard against the deployed Mutaba3a test environment, end to end.
- Visual check of RTL alignment of the installments table and the review step in Arabic.
