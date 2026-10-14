# MUT-194 — Edit and delete a logged currency conversion (server + hosted portal)

Status: approved (plan eng-reviewed twice and design-reviewed, 2026-10-14). Full plan and decision ledgers:
`~/.gstack/projects/vAWK3-mutaba3a-flutter/MUT-194-plan.md`. This brief condenses the mini-crm parts; the
mobile (mutaba3a-flutter) half is built separately. ADR-075 supersedes ADR-070 §2.

## Problem

ADR-070 (MUT-161) made hosted conversions create + read only. A mistaken conversion can only be "fixed" by a
reversing entry and a corrected one. Malafat's `GET /v1/audit` also lists `conversion.created`, because the
audit route only excludes `EXPENSE_ENTITY_TYPES`.

## Acceptance criteria (server + portal)

1. PATCH with the current version updates the conversion and bumps `version`. A stale `If-Match` → 409
   `VERSION_MISMATCH` with `currentVersion`. A currency without its amount → 422 `AMOUNT_REQUIRED`. A merged
   same-currency pair → 422 `SAME_CURRENCY`. A future `occurredOn` → 422.
2. DELETE → 204, and 204 again on repeat. The conversion is gone from list and get; an `anchor` on it → 404
   `ANCHOR_NOT_FOUND`. An unknown id → 404.
3. Both routes work with a device session and refuse an API key.
4. `/v1/summaries/organization` and `/v1/summaries/expenses` stay byte-identical after an edit and a delete.
5. `GET /v1/audit` (Malafat's key) shows no `conversion.*` event, including with `?entityType=conversion`.
6. Portal: a row click, or Enter on its row button, opens the edit drawer. Save PATCHes with the loaded version.
   A 409 refills the form with the latest values. Delete confirms, naming both legs. A JOD conversion can be edited.
9. Works in English and Arabic (RTL) on the portal.

## Server

### Data
- `Conversion` gains `version Int @default(1)`, `updatedAt DateTime` (declared like Expense's) and `deletedAt DateTime?`.
- Migration `<ts>_mut194_conversion_versions`: add `version` (NOT NULL DEFAULT 1), add `updatedAt` NOT NULL
  DEFAULT CURRENT_TIMESTAMP, `UPDATE conversions SET "updatedAt" = "createdAt"`, then drop the `updatedAt`
  default (the schema declares none, like Expense, so `prisma migrate diff` stays clean), add `deletedAt`. No index change.

### Ports and repositories
- `ConversionRecord` + `version`, `updatedAt`, `deletedAt`. `UpdateConversionPatch` (occurredOn, amountMinor,
  currency, toAmountMinor, toCurrency, notes).
- `ConversionRepository.update(orgId, id, expectedVersion, patch, at): UpdateResult<ConversionRecord>` and
  `softDelete(orgId, id, at): {record, changed} | null`, the ExpenseRepository signatures.
- Prisma and memory implement both with the expense pattern (`updateMany where {id, org, deletedAt:null, version}` +
  re-read). `getById` and `list` hide deleted rows in both.
- Store guard: `update`, `softDelete` → `{ write: 'conversions' }`.

### Rules (`conversions/compose.ts`, pure)
`conversionPatch(existing, body)`:
- `currency` without `amount` (or `toCurrency` without `toAmount`) → 422 `AMOUNT_REQUIRED` on the amount field.
  A currency's minor units depend on it, so a currency change without its amount would rescale the money.
- Each amount is parsed in the merged currency (the body's, else the row's), keeping the leg's `field`.
- `assertDifferentCurrencies` on the merged pair.
- `occurredOn` checked with `conversionDate`; the route runs `assertNotFuture` only when it is sent.
- `notes: null` clears.

### Routes
- `PATCH /v1/conversions/{conversionId}`: SESSION_ONLY, `[requireScope('conversions:write'), ifMatch()]`,
  `UpdateConversionRequestSchema` (strict, all optional, notes nullable; empty body accepted like expenses).
  `mustGet` → `conversionPatch` → `update` → 404 / 409 `versionMismatch` → audit `conversion.updated {fields, version}` → 200.
- `DELETE /v1/conversions/{conversionId}`: `[requireScope('conversions:write')]` → `softDelete` → null 404 → audit
  `conversion.deleted` only when `changed` → 204.
- `ConversionSchema` + `version`, `updatedAt`; the serializer exposes both.

### Audit leak
`SESSION_ONLY_ENTITY_TYPES = [...EXPENSE_ENTITY_TYPES, 'conversion']`, passed by `routes/audit.ts`.

### Contract
OpenAPI + `src/hosted/api/schema.d.ts` regenerated; `API_VERSION` `1.22.0-mut182` (MUT-182, merged first) → `1.23.0-mut194`.

## Hosted portal

Mirrors the Expense trio (ExpenseDrawer/ExpensesList/expenseQueries).

- `api/client.ts`: `updateConversion(profileId, id, body, version)` (PATCH, `ifMatchVersion`), `deleteConversion`.
- `data/conversionQueries.ts`: `useUpdateConversion` (invalidates the list and `profileKey(p,'conversion',id)`),
  `useDeleteConversion` (the list).
- `ConversionDrawer`: `mode?: 'create' | 'edit'` (default create, so create callers don't change), `conversionId?`,
  `onDeleted?`. Edit loads `useConversion`, prefills both legs, date, notes, through a reset effect keyed on
  `[existing?.id, existing?.version]` (a same-version background refetch never wipes typing). Submit sends both legs,
  `occurredOn`, `notes` (null clears) at `String(existing.version)`. On 409 (D6): invalidate
  `profileKey(p,'conversion',id)` so the query refetches, the reset effect refills with the latest version, the
  existing `hosted.conversions.errors.conflict` toast shows, the drawer stays open. Delete (D7):
  `confirm(t('hosted.conversions.drawer.deleteConfirm', { from, to }))` with both legs formatted by `formatDecimal`
  (what `DecimalAmount`, which ConversionsList's rows render through, uses). Edit and Delete are hidden while
  loading; a load error shows an error drawer body. After a successful edit `markSaved(id)`.
- `ConversionsList`: `onRowClick` → `?conversion=<id>`; `closeDrawer` clears `newConversion` and `conversion`;
  `afterDelete` drops `anchor` when it pointed at the deleted id; renders the edit drawer for `filters.conversion`.
- `HostedTable` (D8 / eng D11): with `onRowClick`, the first column's cell content renders inside
  `<button type="button" className="row-link">` calling `onRowClick(row)` with `stopPropagation`. The `<tr>` keeps
  its mouse `onClick`; no `role`/`tabIndex` on it. `.row-link` resets button chrome and takes the focus ring.
  Fixes ExpensesList's mouse-only rows too.
- `data/filters.ts`: `parseConversionsPage` accepts `conversion` (uuid).
- JOD (D7, closes TD-117): `conversionFormSchema` `CURRENCY_OPTIONS` = USD/ILS/EUR/JOD with a per-leg
  `superRefine` on `currencyExponent` (7428c63's pattern); `filters.ts` `CURRENCIES` and `FilterControls`'
  `CurrencyFilter` gain JOD.
- i18n en + ar: `hosted.conversions.drawer.editTitle`, `hosted.conversions.drawer.deleteConfirm`,
  `hosted.conversions.errors.loadFailed`. The conflict message already exists.

## Error states

| Case | Server | Portal |
|---|---|---|
| Stale version | 409 CONFLICT `VERSION_MISMATCH` + `currentVersion` | conflict toast, refetch, refill, drawer open |
| Missing If-Match | 422 field `If-Match` | n/a (always sent) |
| Currency without amount | 422 `AMOUNT_REQUIRED` | n/a (both legs always sent) |
| Same currency | 422 `SAME_CURRENCY` on `toCurrency` | client-side refine + field error |
| Future date | 422 `DATE_INVALID` | field error |
| Unknown / deleted id | 404 | toast (network/fallback) |

## Reuse
`ifMatch`, `versionMismatch`, `UpdateResult`, the expense update/softDelete shape, `ledgerPageStart`,
`assertDifferentCurrencies`/`parseConversionAmount`/`conversionDate`, ExpenseDrawer's edit/delete wiring,
`formatDecimal`, `useSavedFlashStore`, ClientsPage's link-in-cell precedent for the row button.

## Impact, i18n, cost, infra
- One migration on a small per-org table (metadata-only defaults, one tiny backfill). No new index or service.
- Contract minor bump; the server deploys before the mobile build that calls PATCH/DELETE.
- Widening `CURRENCIES` also lets the receivables currency filter offer JOD (the server accepts JOD everywhere).
- Arabic strings for every new key; the confirm's amounts are LTR-safe through `Intl`.
- No third-party spend, no new dependency.
