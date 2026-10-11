# MUT-42 — Expenses on the hosted ledger (design brief)

**Status:** approved by the owner 2026-10-11 (D1 own receipts table, D2 seeded category table, D3 own summary endpoint; the rest as written). **Epic:** MUT-34. **Builds on:** `hosted-portal.md` §3 and §5, ADR-037 (and its MUT-39 amendment). **Consumed by:** MUT-44 (portal expense capture). **Branch:** `feature/mut-42-expenses`.

The Jira re-cut wins over the original ticket text. It narrows scope to hosted profiles only, makes the routes session-only, sets the audit actor to `USER`, and leaves the receipt uploader to this brief.

## 1. Problem and acceptance criteria

On a hosted profile, a tenant may write exactly one thing: expenses. The hosted service has no expense model, and neither does Malafat. The offline app has one: `Expense` with a required `profileId`, optional `clientId`/`projectId`, categories, vendors and receipts.

Acceptance criteria (ticket, plus the two carried over from MUT-39):

1. Original currency is preserved on every row; no implicit conversion in storage or reporting.
2. Expenses are invisible to Malafat's API key, asserted by a cross-principal test.
   - *From MUT-39:* Malafat's key cannot see, read or write hosted-profile expenses.
3. *From MUT-39:* an expense write against a Malafat-fed hosted profile succeeds from a session.
4. Attachments add no new bucket and reuse the existing signed-URL TTL configuration.
5. Summaries report expenses per currency alongside the existing income figures.
6. Personal versus firm-associated is expressed by the profile (optionally client/project). No new classification field.
7. Migration is additive and reversible, following the M4–M6 pattern. Migrations are forward-only (DEPLOYMENT.md), so "reversible" means: new tables only, nothing existing altered; old code runs against the new schema; a revert is one follow-up migration dropping the new tables, written out in the migration header.

Guardrails: amounts are minor units; filenames and object keys never carry user input (M6 rule); indexes are documented.

Out of scope: recurring expenses, OCR, approvals, budgets, vendor normalisation, any Malafat exposure, local profiles (they never reach the server).

## 2. Where Malafat could see expenses today, and how each is closed

The re-cut's "routes are session-only" is necessary but not sufficient. Four other paths exist:

| Path | Today | Closed by |
|---|---|---|
| Expense routes | — | `security: [{ session: [] }]` on every route (layer 2 of the matrix) |
| Store, below the routes | MUT-39's guard lets any principal call a `read` method | **New `{ read: Domain }` class.** Expense reads are classified `{ read: 'expenses' }`. A principal whose matrix column is `none` (the API key) is refused even a read. |
| `GET /v1/audit` (key-only) | Lists every audit row of the organization | The audit list query excludes the expense entity types (`expense`, `expense_receipt`, `expense_category`). The rows are still written, because audit is the record of what happened. |
| `GET /v1/operations/{key}` (key-only) | Returns the stored response of any idempotent write in the organization, by key | **Session idempotency keys are namespaced per user.** A session's key is claimed under `s:` + SHA-256 of user id and key (66 characters, so it fits the existing 128-character column; nothing is altered). Malafat's lookup can never match it, and the two principals can no longer collide on a key. |
| `GET /v1/attachments*` (key + session) | Lists the `attachments` table | Receipts are **not** stored in `attachments` (D1). |

**The cross-principal test (AC 2)** works like this:
1. Create expenses, a category and a receipt with distinctive values (vendor `ZZ-EXPENSE-CANARY`, amount `987.65`).
2. Call every API-key-reachable operation in the published document with Malafat's full-scope key.
3. Assert that no response body contains any expense, receipt or category id, the canary vendor or the canary amount.

The test is generated from the inventory, like `route-security.test.ts`, so any later route is covered automatically.

## 3. Decisions

**D1 — Receipts get their own table, `expense_receipts`, on the same bucket and TTL.**
- Malafat reads the `attachments` table through `GET /v1/attachments*`. Receipts kept there would need excluding from every one of those queries, today's and future ones, to stay invisible. That is an opt-out, and the matrix work exists to avoid opt-outs.
- A separate table is invisible by construction. Its store methods also classify cleanly under `expenses`; the `attachments` row is read-only to a session, so `attachments.create` would be refused anyway.
- It reuses `AttachmentStorage` (same bucket), `attachmentUrlTtlSeconds` (same TTL), and the M6 MIME/size rules from `attachments/rules.ts` (PDF/JPEG/PNG, 10 MB).
- Object keys are `org/{organizationId}/expense-receipts/{receiptId}`, with no user input.
- Uploader: `uploadedByUserId` (non-null, FK `users`). This answers the re-cut's question. A receipt is only ever uploaded by a person, so a principal-neutral field would describe a case that can't happen.
- *Rejected:* `attachments` + `expenseId` + `uploadedByUserId`. One table for both is tidier, but it moves Malafat-invisibility from structure to filters.

**D2 — Categories are a per-organization table, mirroring the offline `ExpenseCategory`, seeded on first use.**
- `expense_categories(id, organizationId, name, color?, archivedAt?)`, unique `(organizationId, lower(name))`. Expenses carry `categoryId?`, as offline does.
- The first `GET /v1/expense-categories` on an organization with none seeds a preset in the signed-in user's locale (`en`/`ar`), audited as `SYSTEM`:
  - the offline **law-firm** preset when the profile's writer of record is `MALAFAT`;
  - the **general** preset otherwise (a personal profile).
  This is the same "catch-up on read" shape as lazy posting.
- The preset data is copied into `server/` (a separate package). A parity test reads `src/db/defaultExpenseCategories.ts` and fails if the two drift, the way the drift test reads the brief.
- Categories are never deleted, only archived. Archived ones can't be chosen for a new or edited expense, but old expenses keep them.
- *Rejected:* free-text `category`. It is simpler, but summaries fragment ("Rent" vs "rent"), there is no colour, and it moves away from the offline shape the ticket asks us to mirror.

**D3 — The expense summary is its own session-only operation: `GET /v1/summaries/expenses?from&to`.**
- `GET /v1/summaries/organization` is shared with Malafat's key, so expenses can't go there without a principal-dependent response shape. Instead the portal shows the new block next to it.
- Expenses are flows, so the summary takes a date range. It defaults to the current month in the organization's timezone.
- The response has one block per currency, never summed across currencies:
  ```
  { from, to, currencies: [{ currency, total, count,
      byCategory: [{ categoryId|null, total, count }],
      byCustomer: [{ customerId|null, total, count }] }] }
  ```
  `customerId: null` is "not linked to a client" (the firm's own or personal spending, per AC 6).
- The matrix's "Routes covered" cells change: the summaries row becomes `/v1/summaries/* (except expenses)`, and expenses gains `/v1/expense-categories*` and `/v1/summaries/expenses`. Brief and const move together, and the drift test enforces it.

**D4 — Expense scopes are session-only and never issuable to a key.**
- `expenses:read` and `expenses:write` are added as a separate `SESSION_SCOPES` list. `Scope` becomes the union of the two lists.
- `parseScopes` (key issuance) keeps accepting only the key vocabulary, so the scope list published to Malafat is unchanged. A key "holding" `expenses:read` would be meaningless and confusing on Malafat's connection screen.
- This replaces the `writability.ts` comment saying `expenses:*` "join the closed SCOPES vocabulary".

**D5 — Expense deletion is soft.**
- `DELETE` sets `deletedAt`. The row disappears from lists, detail and summaries and stays for audit. Its receipts are soft-deleted with it, and their objects are removed from the bucket, as M6 does.

**D6 — Links to a client or matter are validated, not constrained by currency.**
- `customerId` and `projectId` must belong to the organization (404 otherwise, like any cross-organization id).
- With only `projectId`, `customerId` is taken from the project. With both, they must agree (`422 PROJECT_CUSTOMER_MISMATCH`).
- Archived customers and projects may still be linked: last year's expense on a closed matter is legitimate.
- An expense's currency is independent of the project's. An ILS court fee on a USD matter is normal, and AC 1 forbids converting it.

## 4. Data model (one additive migration, `mut42_expenses`)

| Table | Columns | Indexes (and the query each serves) |
|---|---|---|
| `expenses` | `id uuid`, `organizationId`, `occurredOn varchar(10)` (calendar date, organization timezone), `amountMinor bigint` (> 0), `currency varchar(3)`, `title?`, `vendor?`, `categoryId?` → `expense_categories`, `customerId?` → `customers`, `projectId?` → `projects`, `notes?`, `createdByUserId` → `users`, `version int`, `createdAt`, `updatedAt`, `deletedAt?` | `(organizationId, occurredOn DESC, id DESC)` — list and summary by date; `(organizationId, customerId, occurredOn)` and `(organizationId, projectId, occurredOn)` — the client and matter tabs; `(organizationId, categoryId)` — category in use |
| `expense_categories` | `id`, `organizationId`, `name` (1–60), `color?` (`#rrggbb`), `createdAt`, `updatedAt`, `archivedAt?`, `version` | unique `(organizationId, lower(name))` — duplicate check and seeding guard |
| `expense_receipts` | `id`, `organizationId`, `expenseId` → `expenses`, `filename`, `mimeType`, `sizeBytes`, `status` (reuses `AttachmentStatus`), `storageKey`, `uploadedByUserId` → `users`, `requestId?`, `createdAt`, `completedAt?`, `deletedAt?` | `(organizationId, expenseId, createdAt)` — receipts of an expense |

- Wire fields mirror the offline `Expense`: `title`, `vendor`, `categoryId`, `customerId` (offline `clientId`), `projectId`, `amount` + `currency`, `occurredOn` (offline `occurredAt`, used as a date), `notes`, `createdAt`, `updatedAt`.
- Amounts travel as canonical decimal strings, as everywhere else on this API.
- The revert is `DROP TABLE expense_receipts, expenses, expense_categories;`. It is written in the migration header; nothing else is touched.

## 5. API (all `security: [{ session: [] }]`, all with `X-Mutaba3a-Profile`)

| Operation | Scope | Notes |
|---|---|---|
| `GET /v1/expenses` | `expenses:read` | Filters: `from`, `to`, `currency`, `categoryId`, `customerId`, `projectId`, `linked=none` (no client). Newest first; cursor pagination (the existing `limit`/`cursor` contract) |
| `GET /v1/expenses/{id}` | `expenses:read` | The expense with its READY receipts |
| `POST /v1/expenses` | `expenses:write` | `Idempotency-Key` (namespaced per user); `201` |
| `PATCH /v1/expenses/{id}` | `expenses:write` | `If-Match: <version>`; any field except currency may change. Currency is fixed after create, so a wrong currency is a delete-and-recreate and no row is ever "converted" |
| `DELETE /v1/expenses/{id}` | `expenses:write` | `204`; soft (D5); idempotent |
| `POST /v1/expenses/{id}/receipts` | `expenses:write` | `{ filename, mimeType, sizeBytes }` → `{ receipt, upload: { url, headers, expiresAt } }`; `Idempotency-Key`; at most 10 receipts per expense |
| `POST /v1/expenses/{id}/receipts/{receiptId}/complete` | `expenses:write` | Checks the object exists with the declared size and type (M6 rule) |
| `GET /v1/expenses/{id}/receipts/{receiptId}/download` | `expenses:read` | 15-minute signed URL (configured TTL), `Content-Disposition: attachment` |
| `DELETE /v1/expenses/{id}/receipts/{receiptId}` | `expenses:write` | `204`; soft, and the object is removed |
| `GET /v1/expense-categories` | `expenses:read` | Seeds on first use (D2); `?includeArchived=true` |
| `POST /v1/expense-categories` | `expenses:write` | `{ name, color? }`; `Idempotency-Key` |
| `PATCH /v1/expense-categories/{id}` | `expenses:write` | `If-Match`; `{ name?, color?, archived? }` |
| `GET /v1/summaries/expenses` | `expenses:read` | D3 |

**Errors** (existing vocabulary; new reasons join `VALIDATION_REASONS`/`CONFLICT_REASONS`):
- `422 VALIDATION_FAILED`: `AMOUNT_NOT_POSITIVE`, `UNSUPPORTED_CURRENCY`, `INVALID_DATE`, `PROJECT_CUSTOMER_MISMATCH`, `CATEGORY_ARCHIVED`, `TOO_MANY_RECEIPTS`, `MIME_TYPE_UNSUPPORTED`, `FILE_TOO_LARGE` (the last two from M6).
- `409 CONFLICT`: `CATEGORY_NAME_TAKEN`; stale `If-Match` uses the existing version conflict.
- `404 NOT_FOUND` for an unknown, deleted or cross-organization id. `403 PRINCIPAL_NOT_ACCEPTED` for an API key on any of these operations.

**Audit** (actor `USER`, `actorId` = user id): `expense.created|updated|deleted`, `expense_receipt.added|deleted`, `expense_category.created|updated`. Seeding is `expense_category.seeded`, actor `SYSTEM`. All excluded from `GET /v1/audit` (§2).

**Contract:** a minor version, `1.11.0-mut42`. Malafat's vendored contract needs no refresh: no operation, scope or schema it uses changes. A test pins `parseScopes` and `MALAFAT_REQUIRED_SCOPES` as unchanged.

## 6. Component sketch

```
routes/expenses.ts ──┐                       (session-only, requireScope expenses:*)
routes/expense-categories.ts ─┤── requestScopedStore ──► ExpenseRepository (memory | prisma)
routes/summaries.ts (+ /expenses) ─┘         guard: { read: 'expenses' } / { write: 'expenses' }
                                              │
expenses/compose.ts   pure: validate + shape (amount, date, links, category)
expenses/summary.ts   pure: per-currency blocks, byCategory / byCustomer
expenses/presets.ts   law-firm / general presets (parity-tested against src/db)
attachments/storage.ts + rules.ts   reused unchanged (bucket, TTL, MIME/size)
idempotency.ts        key namespaced per user for sessions
routes/audit.ts       excludes expense entity types
```

## 7. Reuse and impact

- **Reused unchanged:** `AttachmentStorage`, attachment rules, `idempotent`/`If-Match` middleware, keyset pagination, `formatMoney`/`parseAmount`, `todayFor`, the MUT-39 guard and route-inventory tests (which pick the new routes up automatically).
- **Changed:**
  - the store guard gains `{ read: Domain }`;
  - `idempotent()` namespaces session keys;
  - `audit.list` takes an exclusion filter;
  - `scopes.ts` gains `SESSION_SCOPES`;
  - the matrix "Routes covered" cells move (brief and const together).
- **Not touched:** Malafat-facing operations and their shapes, the offline app, Dexie, sync. ADR-013 and ADR-024 stand.
- **Interaction with the route tests:**
  - `route-security.test.ts` has a fixed list of exactly 22 session operations; it grows by 13.
  - `writability-routes.test.ts` derives everything, except one hard-coded count of 20 session reads.

## 8. i18n, cost, infrastructure

- **i18n:** the server returns no prose. Category seeds are stored in the user's locale. MUT-44 owns every string.
- **Cost:**
  - three small tables, and receipts in the existing bucket, with no new service or secret;
  - each session request already pays one integration lookup (MUT-39), and the expense summary is one indexed range scan per call.
- **Infrastructure:** none. No Terraform change: same bucket, same service account permissions.

## 9. Tests (the plan follows approval, as `mut-42-hosted-expenses-tests.md`)

The main test groups:
- the store contract on memory and Postgres;
- the guard classification, including `{ read }`;
- routes: CRUD, If-Match, idempotency replay, links and mismatches, archived category, soft delete, receipts upload/complete/download/delete with the 10-receipt cap;
- the cross-principal canary sweep (§2);
- the operations-lookup and audit exclusions;
- per-currency summaries with no cross-currency sum;
- preset parity and seeding (once, actor `SYSTEM`, locale);
- MUT-39's two carried AC: a session expense write on a Malafat-fed profile succeeds, and the key is refused at route and store level;
- the migration applied from empty on `test:db`.

## 10. Refinements made while planning the tests (2026-10-11, within the approved decisions)

- **Body references that don't exist** are 422 with the ledger's existing reasons, `CUSTOMER_NOT_FOUND` and `PROJECT_NOT_FOUND`, as in M4 and M7. 404 stays for path ids.
- **Amount and date errors** use the existing `AMOUNT_INVALID` and `DATE_INVALID`; `AMOUNT_NOT_POSITIVE`, `UNSUPPORTED_CURRENCY` and `INVALID_DATE` are not added. An unsupported currency is a schema failure, which is already a 422.
- **New reasons:**
  - validation: `PROJECT_CUSTOMER_MISMATCH`, `CATEGORY_NOT_FOUND`, `CATEGORY_ARCHIVED`, `TOO_MANY_RECEIPTS`;
  - conflict: `CATEGORY_NAME_TAKEN`.
- **Starting a receipt upload carries no `Idempotency-Key`,** exactly like M6's `POST /v1/attachments/uploads`. A repeated start leaves an unfinished PENDING row, which is never listed. The 10-receipt cap counts READY receipts, checked at start and at complete.
- **Category name uniqueness** is a stored `nameKey` (trimmed, NFKC, lower-cased) with a unique index on `(organizationId, nameKey)`. Prisma can't express a unique index on `lower(name)`.
- **`DELETE /v1/expenses/{id}`** answers 204 for a live or already-deleted expense of the organization, and 404 for an id it never had. Only the first delete is audited.
- **List items carry no receipts;** `GET /v1/expenses/{id}` does. This avoids a query per row.

## 11. Result (2026-10-11)

- **Built as approved, with the §10 refinements.** One more was found in implementation: `idempotency_keys.key` is `VARCHAR(128)`. A session key is therefore claimed under `s:` + SHA-256(user id, key), 66 characters, not `user:{id}:{key}`, which could exceed the column. Nothing existing is altered.
- **Gates:**
  - `npm test`: 1056 passed, 10 skipped;
  - `npm run test:db`: 1117 passed;
  - the migration applies from an empty database with no schema drift;
  - lint, typecheck, build and `openapi:check` pass.
- **Mutation checks:**
  - without the audit exclusion, the canary sweep and the audit test fail;
  - without key namespacing, the idempotency test fails.
- **Debt:** TD-041 (the summary aggregates in process).
