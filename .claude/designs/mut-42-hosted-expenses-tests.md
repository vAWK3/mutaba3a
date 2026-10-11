# MUT-42 — expenses on the hosted ledger (test plan)

Companion to `mut-42-hosted-expenses.md` (approved 2026-10-11). Written before implementation. Paths are under `server/`.

## Refinements made while planning (recorded in the brief, §10)

- Body references that don't exist use the ledger's existing 422 reasons, `CUSTOMER_NOT_FOUND` and `PROJECT_NOT_FOUND` (M4/M7 convention), not 404. 404 stays for path ids.
- A non-positive amount is the existing `AMOUNT_INVALID`, and a bad date the existing `DATE_INVALID`.
  - New validation reasons: `PROJECT_CUSTOMER_MISMATCH`, `CATEGORY_NOT_FOUND`, `CATEGORY_ARCHIVED`, `TOO_MANY_RECEIPTS`.
  - New conflict reason: `CATEGORY_NAME_TAKEN`.
- Starting a receipt upload carries no `Idempotency-Key`, exactly like M6's `POST /v1/attachments/uploads`. A repeated start leaves an unfinished PENDING row, which is never listed. The 10-receipt cap counts READY receipts and is checked at start and at complete.
- Category names are unique per organization through a stored `nameKey` (trimmed, NFKC, lower-cased), because Prisma can't express an index on `lower(name)`.
- `DELETE /v1/expenses/{id}` answers 204 for a live or already-deleted expense of the organization, and 404 for an id that was never there. Only the first delete is audited.

## Store contract: `src/repositories/__tests__/store-contract-expenses.ts` (memory + Postgres)

**Expenses:**
- Create and read back with every field. `amountMinor` round-trips as a bigint.
- Organization-scoped: the other organization's id reads null.
- Listing:
  - newest first by `(occurredOn, id)`, with no gaps or repeats across pages, including several rows on the same date;
  - filters: `from`/`to` (inclusive), `currency`, `categoryId`, `customerId`, `projectId`, `unlinked` (no customer).
- `update`:
  - bumps the version;
  - refuses a stale version with no side effects;
  - `not_found` for a deleted or unknown expense;
  - a key set to `null` clears the field, and an absent key leaves it unchanged.
- `softDelete`:
  - hides the row from get, list and update;
  - a second call returns the row with `changed: false`;
  - an unknown id returns null.

**Categories:**
- Create, then list in creation order.
- The name is unique per organization, case-insensitively, by `UniqueViolation`. The same name is fine in another organization.
- `update` renames, recolours, and archives or unarchives with a version check; a rename onto a taken name raises `UniqueViolation`.
- `list({ includeArchived: false })` hides archived categories.
- `seed`:
  - inserts the preset only when the organization has no categories, and returns whether it did;
  - a second seed returns false;
  - two concurrent seeds insert the preset exactly once.

**Receipts:**
- `create` gives a placeholder key; then `setKey`, `complete` → READY.
- `listByExpense` lists READY, non-deleted receipts, oldest first.
- `softDelete` works.
- `softDeleteByExpense` returns every live receipt it removed, pending ones included.
- Organization-scoped throughout.

## Pure units

| File | What is pinned |
|---|---|
| `src/expenses/__tests__/summary.test.ts` | One block per currency, never summed across currencies. Each block has total and count, `byCategory` and `byCustomer` with a `null` bucket, sorted by total descending then id, `null` last. Empty input gives no blocks. Amounts are formatted per currency. |
| `src/expenses/__tests__/presets.test.ts` | **Parity:** the server's general and law-firm presets equal `../src/db/defaultExpenseCategories.ts`'s `GENERAL_CATEGORIES` and `LAW_FIRM_CATEGORIES` (names, Arabic names, colours, order), parsed from the source. `presetFor('MALAFAT', 'ar')` is the law-firm preset in Arabic, and `presetFor(null, 'en')` is the general one in English. |
| `src/expenses/__tests__/cursor.test.ts` | The expense cursor round-trips. A malformed, foreign or tampered cursor gives 422 with field `cursor`. |
| `src/attachments/__tests__/rules.test.ts` (extended) | `checkFile` is the MIME/size/filename part of `checkUpload`, and both agree. `receiptStorageKey` is `org/{org}/expense-receipts/{id}`, with no user input. |
| `src/auth/__tests__/scopes.test.ts` (new or extended) | `parseScopes` refuses `expenses:read`/`expenses:write` (key issuance is unchanged). `SCOPES` and `MALAFAT_REQUIRED_SCOPES` are pinned exactly as before. `sessionScopes()` now includes both expense scopes. |

## Guard: `src/auth/__tests__/store-guard.test.ts` (extended)

- The generated table handles `{ read: d }`: allowed unless the principal's column for `d` is `none`, otherwise `PRINCIPAL_NOT_ACCEPTED`.
- Every method of `expenses`, `expenseCategories` and `expenseReceipts` is classified in the `expenses` domain, as `{ read }` or `{ write }`.
- Under the API key's guard every one of them is refused; under a session's guard every one is allowed.

## Routes: `src/__tests__/routes-expenses.test.ts`

Setup: firm A, Malafat-fed (connected integration, a customer, a project); firm B, personal (no integration); one user who is a member of both; Malafat's full-scope key on A; memory attachment storage.

**Carried from MUT-39:**
- A session `POST /v1/expenses` on A (Malafat-fed) succeeds with 201.
- The key gets `403 PRINCIPAL_NOT_ACCEPTED` on every expense operation (generated over the inventory).

**CRUD:**
- **Create:** 201 with the exact wire shape; currency is kept as sent; ILS on a USD matter is accepted and stored as ILS.
- **Idempotency:** a replay returns the same body with `Idempotent-Replayed`; the same key with a different body gives 422 `IDEMPOTENCY_KEY_REUSED`.
- **Validation:** `AMOUNT_INVALID` (0, negative, too many decimals), `DATE_INVALID`, an unsupported currency (422), `CUSTOMER_NOT_FOUND`, `PROJECT_NOT_FOUND`, `PROJECT_CUSTOMER_MISMATCH`, `CATEGORY_NOT_FOUND`, `CATEGORY_ARCHIVED`.
- **Links:** a project alone derives its customer. Another organization's customer gives `CUSTOMER_NOT_FOUND`, and nothing about it leaks. Archived customers and projects may be linked.
- **PATCH:**
  - needs `If-Match`; a stale version gives 409 `VERSION_MISMATCH`;
  - `null` clears a field;
  - `currency` in the body is refused with 422 (strict schema), so a row's currency never changes;
  - the amount is re-parsed in the row's currency;
  - an already-archived category may be kept but not newly chosen.
- **DELETE:** 204, then gone from get, list and summary. A second DELETE is 204 and not audited again. An unknown id is 404. Receipts are soft-deleted and their objects removed.
- **List:** filters and newest-first pagination through the API; a personal profile (B) works the same.

**Receipts:**
- start → PUT (memory storage) → complete → listed on the detail → download URL valid for the configured TTL (`attachmentUrlTtlSeconds`) → delete removes the object;
- `UPLOAD_INCOMPLETE` and `UPLOAD_MISMATCH`;
- the 11th READY receipt gives `TOO_MANY_RECEIPTS`;
- unsupported MIME type or oversize file → M6 reasons;
- with no bucket configured, 503 `ATTACHMENTS_NOT_CONFIGURED`.

**Categories:**
- The first list on A seeds the law-firm preset in the user's locale: Arabic for an `ar` user, otherwise English. It is audited once, as `SYSTEM`, and a second list does not seed again.
- The first list on B seeds the general preset.
- Create: 201, then 409 `CATEGORY_NAME_TAKEN` for any case variant.
- PATCH: rename, colour, archive; `includeArchived` shows archived categories.

**Summary:**
- `GET /v1/summaries/expenses` defaults to the current month in the organization's timezone.
- `from`/`to` are inclusive.
- `to` before `from` gives 422 `END_BEFORE_START`.
- One block per currency, with `byCategory` and `byCustomer` (`null` = not linked to a client).
- Deleted expenses are excluded.

**Audit:**
- actor `USER` with the user id on every expense, receipt and category write;
- actor `SYSTEM` on seeding.

## Invisible to Malafat: `src/__tests__/expenses-invisible.test.ts`

- **Canary sweep:**
  1. A session creates a canary expense (vendor `ZZ-EXPENSE-CANARY`, amount `987.65`), a category, and a READY receipt, all with distinctive ids.
  2. Malafat's full-scope key calls **every** key-reachable operation in the published document, with real ids where a path needs one (the expense's own ids included).
  3. No response body contains the canary vendor, the canary amount, or any expense, receipt or category id.
- **`/v1/audit`:** with the key, no `expense*` entity type appears, though the rows exist in the store.
- **Idempotency:**
  - the session's `Idempotency-Key` `K` is unknown to `GET /v1/operations/K` with the key (404);
  - Malafat using the same `K` for a payment is not refused as a mismatch;
  - the claim is stored under `s:` + SHA-256 of user id and `K` (66 characters, within the column), never under `K`.
- **Store level:** a request-scoped store under an API-key guard is refused on `expenses.list`/`getById` (`{ read }`). This is defence below the routes.

## Existing suites that change

- `route-security.test.ts`: `SESSION_OPERATIONS` gains the 13 expense operations; session-only operations are now the 2 identity routes plus 13. The key is still refused on all of them.
- `writability-routes.test.ts`: the lists that used every session operation now take GET operations only. The category list joins `LAZY` as a known seeding read (it writes `expense_categories` as `SYSTEM`). `SESSION_READS` is now 26 (20 + 6 expense GETs).
- `writability-drift.test.ts`: unchanged code; the brief's "Routes covered" cells and the const change together.
- Version pins in `routes-m*`: `1.11.0-mut42`.

## Gates

lint, typecheck, `npm test`, `npm run test:db` (the migration applied from empty), `openapi:check`, build.
