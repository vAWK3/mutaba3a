# MUT-194 — Test plan (server + hosted portal)

Design: `.claude/designs/mut-194-conversion-edit-delete.md`. TDD: each file below is written red first.

## Server

| File | Cases |
|---|---|
| `server/src/repositories/__tests__/store-contract-conversions.ts` (memory + Postgres) | update: `updated` with version+1 and updatedAt; `stale` returns the current record; `not_found`; a deleted row can't be updated. softDelete: `changed:true`, then `changed:false`, then null for an unknown id. getById and list hide deleted rows. A created row starts at version 1 with updatedAt = createdAt and deletedAt null. |
| `server/src/conversions/__tests__/compose.test.ts` | conversionPatch: currency without amount → AMOUNT_REQUIRED on `amount`; `toCurrency` without `toAmount` → AMOUNT_REQUIRED on `toAmount` (G1); an amount-only patch on a JOD row parses 3 digits (G1); amount re-parsed in a new currency's digits (USD → JOD); merged same-currency → SAME_CURRENCY; a lone `toCurrency` that collides with the row's `currency` → SAME_CURRENCY; `notes:null` clears; untouched fields stay absent. |
| `server/src/__tests__/routes-conversions.test.ts` | PATCH 200 with version+1 and both new fields in the body; stale If-Match → 409 `VERSION_MISMATCH` + `currentVersion`; missing If-Match → 422; future `occurredOn` → 422 but a notes-only edit of an old row is fine; unknown id → 404; PATCH after DELETE → 404. DELETE 204, repeat 204, unknown id → 404 (G2); GET one → 404; list excludes it; `anchor` on a deleted row → 404 `ANCHOR_NOT_FOUND`. Both with a device session. Audit `conversion.updated {fields, version}` and one `conversion.deleted`. Summaries byte-identical after an edit and a delete. The API-key writability sweep covers PATCH and DELETE. |
| `server/src/__tests__/route-security.test.ts` | `CONVERSION_OPERATIONS` gains PATCH and DELETE (an API key is refused). |
| `server/src/__tests__/conversions-invisible.test.ts` (new) | After create, update and delete, `GET /v1/audit` with Malafat's key lists none of the three, including with `?entityType=conversion`, though the store recorded them. |
| `server/src/repositories/__tests__/migration-mut194.test.ts` (Postgres) | An existing row gets `version 1`, `updatedAt = createdAt`, `deletedAt null`; the history then ends at the schema (`prisma migrate diff --exit-code`). |

## Hosted portal

| File | Cases |
|---|---|
| `src/hosted/components/__tests__/conversionFormSchema.test.ts` | JOD accepted on either leg; JOD with 3 decimals valid and 4 invalid; USD with 3 decimals invalid (precision follows each leg's currency); SAME_CURRENCY still refused. |
| `src/hosted/components/__tests__/ConversionDrawer.test.tsx` | Edit mode prefills both legs, date and notes; submit PATCHes both legs at the loaded `version` as If-Match; a 409 shows the conflict toast, keeps the drawer open, refetches, the fields show the server's latest values and the next Save uses the new version (D6); Delete's confirm names both legs and says it can't be undone (D7), then DELETE and `onDeleted`; a cancelled confirm sends nothing; a JOD conversion edits and saves; Arabic edit title (AC9). Existing create tests unchanged. |
| `src/hosted/components/__tests__/HostedTable.test.tsx` (new) | With `onRowClick`, the first cell holds a button reachable by Tab; Enter and Space call `onRowClick` once each (no double fire); a mouse click on another cell calls it once; `getAllByRole('row')` count unchanged; without `onRowClick`, no button. |
| `src/hosted/pages/__tests__/ExpensesList.test.tsx` | Regression: the row-click test stays green unchanged. |
| `src/hosted/pages/__tests__/ConversionsList.test.tsx` | A row click or Enter on the row button opens `?conversion=<id>` with the edit title; deleting the anchored conversion drops `anchor`; the currency filter offers JOD. Replaces "has no row click". |
| `src/hosted/data/__tests__/filters.test.ts` | `parseConversionsPage` keeps a uuid `conversion`, drops a bad one; JOD currency kept. |

## Verification

Server: `npm run typecheck && npm run lint && npm run openapi:check && npm test`, plus `npm run test:db` against
a scratch Postgres database. Root: `npm run lint && npm run typecheck && npm run test:run && npm run build &&
npm run hosted:types:check`. Node 22.
