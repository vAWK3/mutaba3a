# MUT-255 — Receipts library: a receipt can exist before its expense ("To review")

Status: plan, 2026-10-22. Epic MUT-252 (receipt scanning), `firm-v1`. Server only (`server/`); no phone or portal UI in this ticket.
Blocks MUT-257 (phone scan & review), MUT-258 (phone Receipts list), MUT-260 (portal gallery), MUT-301 (portal PDF/QR read).

## 1. What changes, in one paragraph

An `ExpenseReceipt` belongs to a profile (its `organizationId`) and may have no expense. A new `filingStatus` (`TO_REVIEW` | `FILED`) sits beside the existing upload `status` (`PENDING_UPLOAD` | `READY`). A new `/v1/receipts` route family uploads a receipt with no expense, lists the profile's receipts, and **approves** one: it creates the expense and files the receipt in one transaction, idempotently. Deleting an expense now **keeps** its receipts in the library, unlinked and back to To review, instead of deleting them and their files. The MUT-44 per-expense routes (`/v1/expenses/{id}/receipts…`) are unchanged and create receipts that are FILED from the start.

## 2. Decisions (made without a review round; overturn any of them before /eng-build)

| # | Decision | Why | Alternative not taken |
|---|---|---|---|
| D1 | `filingStatus` is a stored column, with a DB CHECK `(filing_status = 'FILED') = (expense_id IS NOT NULL)`. | The To-review list and count need an index on status. The CHECK makes "FILED without a record" impossible. | Derive it from `expenseId IS NULL` (no column). Cheaper, but MUT-308 would have to rewrite every query when `billId` arrives. |
| D2 | `billId` and the "at most one of expense/bill" CHECK are **MUT-308's**, not this ticket's. MUT-255 puts "is this receipt filed?" in one helper (`isFiled(record)`) and returns 409 `CONFLICT` with `details.reason: RECEIPT_ALREADY_FILED`. MUT-308 extends that helper and the D1 CHECK to `expense_id IS NOT NULL OR bill_id IS NOT NULL`. | There is no Bill table yet, so the foreign key can't exist. A bare uuid column with no FK would be dead weight. The brief disagrees with itself (§11 says MUT-308, §21 says MUT-255). | Add a bare `billId` column now. |
| D3 | Suggested fields are stored as JSONB in the brief's `ReceiptSuggestion` shape (§6.1: `readerVersion` + keyed `SuggestedField<T>{value, source, confidence}`), validated by a zod schema. Approved fields are a JSONB snapshot of what approval wrote: `occurredOn`, `amountMinor`, `currency`, `vendor`, `categoryId`, plus `approvedAt` and `approvedByUserId` columns. | It is one shared shape for phone and portal. JSONB keeps the reader's fields free to grow (VAT and registration no. for firms) without migrations. | Typed columns per field. |
| D4 | The edit-rate summary is an **operator route**, `GET /admin/v1/receipts/edit-rates?from&to`. It returns counts only: per field, approved receipts that had a suggestion, and how many of those were changed. It covers all profiles and never returns values. | It is the epic's success measure, read at the Monday review (MUT-330), and sits beside the existing `/admin/v1/*` operator routes. | A script only. |
| D5 | "Download my records" (MUT-325) includes To-review receipts with `expenseId: null`. The records-file codec allows null, and local-mode import skips receipts with no expense. | Everything the person uploaded is theirs to export. | Leave unfiled receipts out. |
| D6 | Vendor: approval writes the typed vendor into `Expense.vendor` (free text, as today). Linking a Vendor record is **MUT-254's** (Backlog, built in parallel per the epic's order). | There is no Vendor table yet. | Wait for MUT-254. |
| D7 | Firm hooks are seams, not code. The approve transaction is the one place MUT-307's `initialApprovalFor` and MUT-312's `assertOpenPeriod` will plug in. Each gets a `TODO(blocked-by MUT-307)` / `TODO(blocked-by MUT-312)` at that line, and a comment on each ticket naming the call site. | Both are Backlog, and their functions don't exist. | Build them here (scope creep). |
| D8 | Scopes reuse `expenses:read` / `expenses:write`, session-only (`SESSION_ONLY`), with no API-key access. Ownership follows the profile header (`sessionAuth(c).organization`), like every expense route. D6 of the brief (a firm submitter sees only their own receipts) is the firm-roles ticket's. | Same rule as MUT-42: Malafat's key never reaches receipts. | A new `receipts:*` scope. |
| D9 | Unlink on expense delete runs **inside** `expenses.softDelete`'s transaction (`unlinkReceipts: true` path in the store), and the route stops calling `storage.remove`. | Today it's two steps outside one transaction (`prisma.ts:1585`). A crash between them would leave half-deleted state. | Keep it in the route. |
| D10 | The To-review count is its own small route (`GET /v1/receipts/counts` → `{toReview, filed}`, one indexed `COUNT … GROUP BY`). The list stays a cursor list without totals (ADR rule at DECISIONS `:1843`). | MUT-258 needs a count on the filter, and the portal needs one on its "To review (n)" tab (DR1). | Put totals in the list response. |

New ADR: **ADR-166** (check the number with any concurrent mini-crm session before claiming it; latest is ADR-165, TD-197).

## 3. Data (Prisma + migration `2026102?000000_mut255_receipts_library`)

`server/prisma/schema.prisma`, `model ExpenseReceipt`:
- `expenseId String? @db.Uuid`, `expense Expense?`.
- `filingStatus ReceiptFilingStatus @default(FILED)` (new enum `TO_REVIEW`, `FILED`). **The default is FILED, not TO_REVIEW** (review R1): during a rolling deploy the old revision's `expenseReceipts.create` doesn't send the column, and a TO_REVIEW default plus an `expense_id` would fail the CHECK on every MUT-44 upload. The library route sets `TO_REVIEW` explicitly.
- `receivedOn String @db.VarChar(10)`: the upload day in the profile timezone (`todayFor(organization, now)`), like `occurredOn` everywhere else (review R2). The list's `from`/`to` filter compares it as a string. There's no timezone-to-instant helper in `dates.ts`, so `createdAt` is not filtered by profile-timezone dates. Backfill existing rows from `createdAt` in the organization's timezone (in SQL, `AT TIME ZONE organizations.timezone`).
- `suggested Json?`, `approved Json?`, `approvedAt DateTime?`, `approvedByUserId String? @db.Uuid` (FK User, SetNull, matching how close-account anonymizes; check this against the MUT-333 decisions before claiming it).
- `version Int @default(1)` for If-Match on the suggestion PATCH (review R10).
- Keep `@@index([organizationId, expenseId, createdAt])`. Add `@@index([organizationId, filingStatus, receivedOn, createdAt])` for the library list and count.

Migration SQL (hand-edited after `prisma migrate dev --create-only`):
1. `ALTER COLUMN expense_id DROP NOT NULL`.
2. Add the columns with the FILED default, so every existing row is FILED with no separate backfill. Backfill `received_on`.
3. `ADD CONSTRAINT expense_receipts_filed_has_record CHECK ((filing_status = 'FILED') = (expense_id IS NOT NULL))`.
4. ~~The expense FK becomes `ON DELETE SET NULL`.~~ **Dropped in review (R1):** nothing hard-deletes expenses, so the FK stays `ON DELETE RESTRICT` (`20261011080000_mut42_expenses/migration.sql:108`), and SET NULL would have contradicted the CHECK.

Rollback: once any receipt has a null `expense_id`, the previous revision's Prisma client cannot read that row (P2032), the same trap DEPLOYMENT.md:743 documents for MUT-235. Rolling back means rolling forward a fix, or soft-deleting the To-review rows first. Add this to DEPLOYMENT.md's migration notes.

Local format (review R3): the snapshot version lives in the portal, `src/hosted/local/migrations/index.ts:10` (`LOCAL_FORMAT_VERSION = CURRENT_STORE_SNAPSHOT_VERSION`). The 2 → 3 step goes there and sets `filingStatus: 'FILED'`, `receivedOn` from `createdAt`, `version: 1`, and `suggested/approved: null` on every receipt. Update the format-fingerprint test. Every hosted export becomes format 3, and an older cached portal refuses it as `too-new` (`recordsFile.ts:49`), so **the portal deploys before the server**. MUT-302, MUT-307 and MUT-308 also bump this number, so claim it with the other mini-crm sessions, as for ADR numbers.

## 4. Store (`server/src/repositories/`)

`ports.ts`:
- `ExpenseReceiptRecord`: `expenseId: string | null`, `filingStatus`, `suggested: ReceiptSuggestion | null`, `approved: ApprovedReceiptFields | null`, `approvedAt`, `approvedByUserId`.
- `CreateExpenseReceiptInput`: `expenseId: string | null`, `suggested?: ReceiptSuggestion | null`. When `expenseId` is set, `filingStatus` is FILED.
- `ExpenseReceiptRepository`, new methods:
  - `list(organizationId, filter: { filingStatus?, from?: Date, to?: Date }, page)` returns READY, live receipts, newest `createdAt` first, with the existing anchor cursor.
  - `countByFilingStatus(organizationId)` returns `{ toReview, filed }` (READY, live only).
  - `setSuggested(organizationId, id, suggested)` is allowed only while TO_REVIEW.
  - `fileAsExpense({ organizationId, receiptId, userId, expense: CreateExpenseInput, approved, suggested? }, at)` runs in **one transaction**, modelled on `inboxEntries.fileAsExpense` (`prisma.ts:1838`). **The order matters** (review R5): the D1 CHECK is immediate, so the receipt can't be FILED before its expense exists.
    1. `SELECT … FOR UPDATE` the receipt row. Missing, deleted or another profile's → `not_found`; PENDING_UPLOAD → `not_ready`; FILED → `already_filed`. All of these return before anything is written.
    2. `createExpenseRow(tx, …)`.
    3. A conditional `UPDATE … SET expense_id, filing_status = 'FILED', approved, approved_at/by[, suggested], version = version + 1 WHERE id = ? AND filing_status = 'TO_REVIEW' AND status = 'READY' AND deleted_at IS NULL`. If it changes 0 rows, **throw** so the expense rolls back. Never return after the insert.

    Returns `{ kind: 'filed', expense, receipt }`. The `TODO(blocked-by MUT-307/312)` seams sit between steps 1 and 2.
  - `editRates({ from, to })` (operator, cross-org, review R7), computed in SQL over `approved_at` in range, among approved receipts that carried a suggestion:
    - Per field, `{ suggested: n, edited: n }`, for `date`, `amount` (edited when `amountMinor` **or** currency differs), `currency` and `vendor`. A field the reader didn't suggest is not counted.
    - The epic's own figure, `amountAndDateUnedited / withAmountAndDateSuggested`.
- Changed:
  - `listByExpense` is unchanged.
  - `countReadyByExpenseIds` adds `expenseId: { not: null }`.
  - `softDeleteByExpense` is **replaced** by `unlinkByExpense(organizationId, expenseId, at)`. On READY receipts it sets `expense_id = NULL` and `TO_REVIEW`, and keeps `approved` for the metric. **PENDING_UPLOAD receipts are soft-deleted instead** and their object keys returned for removal (review R8): an unfinished upload must not turn into an invisible To-review row. `expenses.softDelete` today is two statements outside a transaction (`prisma.ts:1421-1424`). It becomes one `$transaction` that soft-deletes the expense and unlinks its receipts (D9).
- `store-guard.ts`: an entry for each new method.
- `memory.ts`: mirror every method. `create` no longer throws `ForeignKeyViolation` when `expenseId` is null.

## 5. Routes

New `server/src/routes/receipts.ts`, with the same `storage`/`urlTtlSeconds` options as `expenseRoutes`. Every route answers 503 `ATTACHMENTS_NOT_CONFIGURED` when there's no bucket.

**Where it's registered (review R4, decision P1):** hosted server only, in `app.ts`, not in the shared `routes/portal-routes.ts` list that local mode also mounts. Local import keeps unattached receipts; see P1.

| Route | Notes |
|---|---|
| `POST /v1/receipts/uploads` | Body `{filename, mimeType, sizeBytes, suggested?}`; `checkFile` (PDF/JPEG/PNG, ≤ 10 MB); `idempotent(store, 'receipts.create')`; `receiptUploadLimiter` (429) and the 20-pending cap (422 `TOO_MANY_PENDING_UPLOADS`), decision P3. Creates TO_REVIEW + PENDING_UPLOAD with `receivedOn`, key `receiptStorageKey(org, id)`, signed PUT. A replay returns the first response, the same receipt id. |
| `POST /v1/receipts/{id}/upload-url` | **Added in review (R2b).** A fresh signed PUT for a PENDING_UPLOAD receipt (422 `UPLOAD_ALREADY_COMPLETE` once READY). Signed URLs expire after 900 s (`config.ts:30`, `ATTACHMENTS_URL_TTL_SECONDS`), and the phone outbox may replay the start hours later. Without this route, a replayed start would hand back a dead URL forever. |
| `POST /v1/receipts/{id}/complete` | Same verify-object logic as the MUT-44 route. Pull it into `attachments/complete.ts` (`verifyUploadedObject`) and use it from both. |
| `GET /v1/receipts` | `?filingStatus=TO_REVIEW|FILED&from&to&limit&cursor`. `from`/`to` are YYYY-MM-DD in the profile timezone, applied to the upload time (`createdAt`). |
| `GET /v1/receipts/counts` | `{toReview, filed}` (D10). |
| `GET /v1/receipts/{id}` | The receipt with `suggested`, `approved` and `expenseId`. |
| `GET /v1/receipts/{id}/download` | Signed GET (reuses `signDownload`). |
| `PATCH /v1/receipts/{id}/suggestion` | Body `ReceiptSuggestion`, with `ifMatch()` on the receipt's `version` (review R10), because the phone and portal readers can both write it. TO_REVIEW only (409 RECEIPT_ALREADY_FILED otherwise). For MUT-256's reader, which reads after upload. |
| `POST /v1/receipts/{id}/approve` | `idempotent(store, 'receipts.approve')`. Body = `CreateExpenseRequestSchema` fields + optional `suggested`. Validation is a new shared `prepareExpenseCreate(store, organization, body, now)` in `expenses/compose.ts` (review R6), which `POST /v1/expenses` also switches to: date floor, amount parse, links, choosable category. The inbox filing route keeps its own narrower prep, since its amount and date come from the entry. The create goes through `withCategoryForeignKey` inside the transaction. 201 `{expense, receipt}`. 409 `CONFLICT` `RECEIPT_ALREADY_FILED` when already filed without the same key; 422 `ATTACHMENT_NOT_READY`; 404 otherwise. Audit `expense.created` with `captureSource: 'receipt'` (review R9: the existing key, so analytics on `captureSource` count it), plus `expense_receipt.filed`. **Retry rule, documented in the route description:** the idempotency layer stores 4xx answers as final, so a client that gets 422 `ATTACHMENT_NOT_READY` retries with a **new** Idempotency-Key once the upload completes. |
| `DELETE /v1/receipts/{id}` | Soft delete + `storage.remove`, any filing status, idempotent 204 like the attachments route. |
| `GET /admin/v1/receipts/edit-rates` | In `routes/admin.ts`, operator auth like its siblings. |

Changed: `routes/expenses.ts`:
- DELETE no longer removes receipt files. Its description becomes "soft; its receipts stay in the receipts library as To review".
- `mustGetReceipt` already compares `expenseId`, so it's fine with null.

`schemas.ts`:
- `ExpenseReceiptSchema.expenseId` becomes nullable; add `filingStatus`, `suggested`, `approved`, `approvedAt`.
- New `ReceiptSuggestionSchema`. **Unknown keys are stripped, not refused** (review R11): D3 lets reader fields grow, and a strict schema would make every newer reader (MUT-256/301/304) fail approve with a 422 until the server catches up. Known keys are validated: `confidence` 0..1, `source` enum, money in minor units as strings like other amounts. There's a 4 KB cap on the suggestion.
- New `ApproveReceiptRequestSchema`, `ReceiptPageSchema`, `ReceiptCountsSchema`, `ReceiptEditRatesSchema`.

`serializers.ts`: `serializeExpenseReceipt` carries the new fields.

Privacy guardrail: the server stores only what the client sends: the file, the suggestion and the approved fields. No server-side reading. A test asserts that the edit-rates response holds numbers only.

## 6. Ripple (call sites that assume `expenseId` is set)

- `routes/entries.ts:57-61`: `receiptCount` stays linked-only (no change, plus a test).
- Records export (D5). The receipt row in the export carries `filingStatus`, `receivedOn`, `suggested`, `approved` and `approvedAt` (review R12). These are the person's own data and part of the shape the local format round-trips. The export files to change:
  - `prisma-records-export.ts:89,136,176`
  - `memory.ts:1824-1829`
  - `records-file/codec.ts:17` (nullable)
  - portal `src/hosted/local/attachments.ts:81,108` (skip null on import)
  - `hostedExport.ts`
  - `format-fingerprint.test.ts`
- Portal types: `npm run hosted:types`, then `src/hosted/api/schema.d.ts`; `src/types/index.ts:590` compiles unchanged.
- Ops scripts:
  - `server/scripts/profile-rows.sh:145,237-261` and `restore-drill.sh:287-294` count receipts.
  - Add a To-review/filed split where they print receipt counts; they must not assume a join to expenses.
- Flutter app (`lib/data/repositories/receipt_repository.dart`) only reads receipts through the per-expense routes, so `expenseId` is always set there. No phone change; check `ExpenseReceipt.fromJson` tolerates the new fields (it ignores unknown keys).

## 7. Tests (TDD, written first; `npm run typecheck && npm run lint && npm test && npm run test:db && npm run openapi:check` in `server/`)

Store contract (`store-contract-expenses.ts` or a new `store-contract-receipts.ts`, run against memory + Prisma):
1. A receipt created with no expense is TO_REVIEW and appears in `list({filingStatus: TO_REVIEW})` only once READY.
2. `fileAsExpense` creates exactly one expense and moves the receipt to FILED with `approved` set.
3. A second `fileAsExpense` on the same receipt returns `already_filed` and creates no expense (count stays 1).
4. Two concurrent `fileAsExpense` calls (Prisma, `Promise.all`): one is filed, one is `already_filed`.
5. `fileAsExpense` on a PENDING_UPLOAD receipt returns `not_ready`.
6. `fileAsExpense` with an expense that fails inside the transaction (bad category FK) leaves the receipt TO_REVIEW.
7. `expenses.softDelete` unlinks: the receipt goes back to TO_REVIEW with `expenseId` null and the object is not removed.
8. The DB CHECK refuses FILED with a null `expense_id` (Prisma only).
9. `countReadyByExpenseIds` ignores unlinked receipts.
10. `editRates` counts a changed amount, an unchanged date, and a field with no suggestion (not counted).
11. Cursor paging over 3 pages, newest first, with `from`/`to` in a non-UTC profile timezone.

Routes (`routes-receipts.test.ts`):
- AC1: upload → complete → `GET /v1/receipts?filingStatus=TO_REVIEW` lists it; `counts.toReview = 1`.
- AC2: approve → 201, one expense in `GET /v1/expenses`, and the receipt is FILED. The same Idempotency-Key replays 201 with the same ids and no second expense. A different key returns 409 `RECEIPT_ALREADY_FILED`.
- AC3: approve with `suggested.totalMinor` ≠ approved amount → `approved` and `suggested` are both stored. Edit-rates shows amount `{suggested: 1, edited: 1}` and numbers only.
- AC4: the MUT-44 flow on an existing expense still works (existing `routes-expenses.test.ts` stays green, plus "a MUT-44 receipt is FILED").
- AC5: with `storage: null`, every `/v1/receipts*` route answers 503 `ATTACHMENTS_NOT_CONFIGURED`.
- Other route checks:
  - Approve with a date older than the floor → 422 (ADR-086).
  - Approve with an archived category → 422.
  - Another profile's receipt → 404.
  - An API key → 401/403 (`route-security.test.ts`).
  - `portal-routes-coverage.test.ts` lists the new routes.
- Expense delete keeps the receipt: `storage.removed` is empty, and the receipt is back under To review.
- Records export includes a To-review receipt with `expenseId: null`. Local import keeps it and its file, and `sweepBlobs` leaves the object (portal test, decision P1).
- P1: the local app (`createLocalApp`) answers 404 for `GET /v1/receipts`, so the library isn't mounted in local mode.
- P3: the 21st pending upload in 24 h returns 422 `TOO_MANY_PENDING_UPLOADS`, and one older than 24 h doesn't count. The 31st start in a minute for one user returns 429 with `Retry-After`.

Added in review:
- **R1 (CRITICAL regression):** a receipt created through the old `create` input (no `filingStatus`) with an `expenseId` succeeds against the migrated schema. This is a Prisma test that inserts without the column, the rolling-deploy case. It fails if the default is ever TO_REVIEW.
- **R5:** `fileAsExpense` where the final conditional UPDATE matches 0 rows (receipt soft-deleted between the lock and the update, simulated in memory by a hook) leaves zero new expenses.
- **R8:** deleting an expense with one READY and one PENDING_UPLOAD receipt unlinks the READY one and soft-deletes the pending one, and only the pending object is removed.
- **R2b:** `upload-url` on a PENDING_UPLOAD receipt returns a new URL with a later `expiresAt`; on a READY one it returns 422.
- **R11:** a suggestion with an unknown key (`lineItems`) is accepted and stored without that key; a `confidence` of 1.5 returns 422.
- **R10:** a suggestion PATCH with a stale If-Match returns 409.
- **R6:** the existing `routes-expenses.test.ts` create cases stay green after `POST /v1/expenses` moves to `prepareExpenseCreate`. That is the regression proof for the extraction; there are no new create tests.
- AC6: `openapi:check` green after `npm run openapi:export`; `test:db` green.

## 8. Order of work (checkpoint commits)

1. Migration + Prisma schema + memory snapshot v3 + store contract tests 1, 7–9 (red → green).
2. `fileAsExpense`, `list`, `counts`, `setSuggested`, `editRates` + contract tests 2–6, 10–11.
3. `routes/receipts.ts` + schemas + serializer + route tests; `verifyUploadedObject` extracted.
4. Expense delete → unlink (D9) + its tests.
5. Records export + portal codec/import + `hosted:types`.
6. Admin edit-rates route.
7. ADR-166, a CHANGELOG entry, and the API version bump (minor), following the repo's release notes convention.

Release-QA: the server has no user-visible flow in this ticket. Web Playwright flows come with MUT-260, and the phone flows with MUT-257/258. The QA catalog gets no entry; `/qa-reconcile` checks the route tests against the ACs.

**Production deploy is held (decision P4)** until MUT-260 or MUT-258 ships with it. When it goes, the order is:
1. The portal deploys first (local format 3, review R3).
2. Then `migrate deploy`, while the old server revision is still serving. That is safe because the default is FILED (R1).
3. Then the new server.

The migration takes a brief `ALTER TABLE` lock on `expense_receipts`; the table is small. See §3 for rollback.

## 9. Out of scope / follow-ups

- Vendor record link → MUT-254.
- `billId` → MUT-308.
- Firm approval → MUT-307.
- Closed month → MUT-312.
- Phone UI → MUT-257/258.
- Portal UI → MUT-260.
- The portal's and phone's expense-delete confirmations still say receipts are deleted with the expense, if they say so; whoever builds MUT-258/260 updates that copy. Check the portal string during step 4.

## Business / product impact

- The receipt becomes the thing you keep: shared once, saved on the profile, and reviewable later. That is the base every MUT-252 surface (phone scan, phone list, portal gallery, firm books) builds on.
- It unblocks MUT-257, 258, 260 and 301, and gives the epic its success measure (edit rate per field) from day one.
- Risk is contained: one additive migration plus one behavior change (deleting an expense keeps its receipt). Existing MUT-44 and phone share flows are untouched.

## Eng review (2026-10-22)

Target: this plan. The review ran without per-question stops because you answered "continue" to the opening questions. Fixes that remove a contradiction or a defect in the plan were applied above and are tagged R1–R12; each can be reversed. Choices that change behavior or scope are left **pending** (P1–P4).

### Findings and dispositions

| ID | Sev | Conf | Source | Finding | Disposition |
|---|---|---|---|---|---|
| R1 | P0 | 9 | outside + native | A TO_REVIEW DB default plus the CHECK breaks MUT-44 uploads during the rolling deploy; SET NULL contradicted the CHECK (FK is RESTRICT, `mut42_expenses/migration.sql:108`, and nothing hard-deletes expenses) | Applied: default FILED, SET NULL dropped, rollback note |
| R2 | P1 | 9 | native | No timezone-to-instant helper (`dates.ts` has date-only functions) | Applied: `receivedOn` column |
| R2b | P1 | 9 | native | A replayed upload start returns an expired URL (`config.ts:30` TTL 900 s) | Applied: `POST /v1/receipts/{id}/upload-url` |
| R3 | P1 | 9 | outside, verified | Snapshot version lives in the portal (`src/hosted/local/migrations/index.ts:10`); export format 3 needs the portal deployed first | Applied: step moved, deploy order, number coordination |
| R4 | P1 | 9 | outside, verified | `expenseRoutes` is in the shared `portal-routes.ts:50` list, so local mode would get the library | Decided P1: hosted-only, import keeps rows |
| R5 | P1 | 8 | outside | `fileAsExpense` order unspecified; an immediate CHECK fails if FILED is set first | Applied: lock → insert → conditional update → throw on 0 rows |
| R6 | P2 | 9 | native | Approve repeats POST /v1/expenses prep (`expenses.ts:150-153`) | Applied: shared `prepareExpenseCreate` (2 callers) |
| R7 | P2 | 8 | native | Edit-rate amount/currency definition muddled | Applied: per-field + epic composite figure |
| R8 | P2 | 8 | outside | Unlink would turn PENDING_UPLOAD receipts into invisible To-review rows | Applied: soft-delete pending ones |
| R9 | P3 | 9 | outside | New audit key `source` instead of existing `captureSource` (`expenses.ts:159`) | Applied |
| R10 | P3 | 7 | outside | Suggestion PATCH had no If-Match | Applied: `version` + `ifMatch()` |
| R11 | P1 | 8 | outside | A strict suggestion schema contradicts D3 and 422s newer readers; 4xx replays are final | Applied: strip unknown keys, document the new-key retry rule |
| R12 | P3 | 7 | outside | Export columns for the new fields unspecified | Applied |
| R13 | P2 | 8 | outside | No way to file a receipt to an existing expense (the typed-then-scanned case) | Decided P2: follow-up MUT-389 |
| R14 | P2 | 7 | outside | Library uploads have no per-profile cap and no sweeper for PENDING_UPLOAD | Decided P3: 20-pending cap + 30/min limiter |
| R15 | P2 | 8 | native | Keep-on-delete ships before any UI to see or delete To-review receipts (MUT-258/260 Backlog); "deleted" files stay and appear in the export | Decided P4: deploy held for MUT-260/258 |
| R16 | P3 | 7 | outside | Deleting a duplicate expense brings back up to 10 To-review receipts | Accepted as ticket behavior ("Deleting an expense keeps its receipt") |

### Decisions (Basel answered 2026-10-22: all four recommendations taken)

- **P1: hosted-only library (R4). Approved.**
  - `receiptRoutes` is registered on the hosted server only, in `app.ts`'s hosted route list, **not** in the shared `portal-routes.ts` list that local mode (`createLocalApp.ts`) also mounts. Local mode gets no `/v1/receipts*` routes.
  - Local import **keeps** receipt rows with no expense (`src/hosted/local/attachments.ts:81,108`) and their files. They are never skipped, and `sweepBlobs` must not delete their objects. A hosted export restored into local mode keeps its To-review receipts, unseen there, ready for a later re-import into hosted.
  - The shared store change (expense delete unlinks) still runs in local mode, since it lives in the store. A local-mode test asserts that a deleted expense's receipt survives an export/import round trip.
- **P2: filing to an existing expense (R13). Approved as follow-up [MUT-389](https://barmajiyat.atlassian.net/browse/MUT-389).**
  - `POST /v1/receipts/{id}/file {expenseId}`, outside this ticket. MUT-255 blocks MUT-389, and MUT-389 blocks MUT-257 and MUT-260.
  - MUT-255 keeps `fileAsExpense`'s lock and conditional update as one internal function, so MUT-389 can reuse it with an existing expense id instead of an insert.
- **P3: upload limits (R14). Approved.**
  - `POST /v1/receipts/uploads` refuses with 422 `TOO_MANY_PENDING_UPLOADS` when the profile already has **20** PENDING_UPLOAD receipts created in the last 24 h. The check is one indexed count.
  - The route also goes through a new injected `receiptUploadLimiter` (`SlidingWindowRateLimiter`, **30/min**, keyed `receipt-upload:<userId>`). It is wired in `app.ts` like `publicFxIpLimiter` and answers 429 `RATE_LIMITED` with `Retry-After`.
  - Tests: the 21st pending upload returns 422, and an older-than-24 h pending row doesn't count; the 31st start in a minute returns 429.
  - A sweeper for stale PENDING_UPLOAD rows stays out of scope (the cap bounds them).
- **P4: release order (R15). Approved.**
  - MUT-255 is built, merged and tested now, but its **production deploy is held** until the first surface that shows the library ships: MUT-260 (portal) or MUT-258 (phone), whichever is first.
  - Mark the release-notes draft and the merge commit body "deploy with MUT-260/258". Note it on MUT-255 in Jira, so `/release` doesn't ship it alone.
  - The local `:8787` dev server and QA run it as soon as it is merged.

### What already exists (reused)
- The signed-URL pipeline (`attachments/storage.ts`, `checkFile`, `receiptStorageKey`).
- The upload verify logic (to be extracted into `verifyUploadedObject` and shared by the MUT-44 complete route and the new one).
- `idempotent()` and `ifMatch()`.
- The `inboxEntries.fileAsExpense` transaction shape.
- `createExpenseRow`.
- The expense compose helpers.
- The anchor cursor pagination.
- `todayFor`.

### Flow

```
upload start ─▶ PENDING_UPLOAD/TO_REVIEW ─▶ PUT bytes ─▶ complete ─▶ READY/TO_REVIEW
                     │  ▲ upload-url (re-sign)                         │
                     │  └──────────────────                            ├─ PATCH suggestion (If-Match)
                     ▼                                                 ▼
             expense delete: soft-delete                     approve (Idempotency-Key)
                                                             lock ─▶ insert expense ─▶ UPDATE…WHERE TO_REVIEW
                                                                                         │0 rows → throw (rollback)
                                                                                         ▼
                                                                                   READY/FILED ──expense delete──▶ READY/TO_REVIEW
```

### Coverage diagram

```
CODE PATHS                                          USER FLOWS (API clients)
[+] fileAsExpense                                   [+] Share → To review → approve
  ├── [PLANNED ★★★] filed / already_filed / not_ready    ├── [PLANNED ★★★] AC1, AC2 route tests
  ├── [PLANNED ★★★] concurrent approve (Prisma)          ├── [PLANNED ★★ ] replay same key → same ids
  └── [PLANNED ★★ ] 0-row update rolls back (R5)         └── [PLANNED ★★ ] ATTACHMENT_NOT_READY → new key
[+] unlinkByExpense                                 [+] Delete expense keeps receipt
  ├── [PLANNED ★★★] READY unlinked, object kept          └── [PLANNED ★★ ] storage.removed empty
  └── [PLANNED ★★ ] PENDING soft-deleted (R8)
[+] migration                                       [+] Rolling deploy
  ├── [PLANNED ★★ ] CHECK refuses FILED w/o expense      └── [PLANNED ★★★] old-shape insert succeeds (R1) CRITICAL
  └── [GAP]        backfill receivedOn in non-UTC tz → add a migration test row in Asia/Amman
[+] editRates                                       [+] Operator Monday read
  └── [PLANNED ★★ ] counts only                          └── [PLANNED ★ ] route auth → extend admin route-security table
COVERAGE: all planned paths have a named test except the receivedOn backfill (1 gap)
```

### Failure modes
- **Approve races a delete of the same receipt.** Covered by R5: rollback, then 404. The user sees a clear error.
- **The phone replays a start after the URL expired.** Covered by R2b; the client re-signs.
- **A newer reader sends unknown fields.** Covered by R11; they are stripped.
- **Old revision during deploy.** Covered by R1.
- **An expense is deleted while the library has no UI.** Prevented by P4: production gets the change only together with a library screen.
- **Critical gaps: 0.**

### Worktree parallelization
Sequential implementation, no parallelization opportunity. Server store, routes and portal codec all share `ports.ts` and `schemas.ts`.

### NOT in scope
- Vendor link (MUT-254).
- `billId` (MUT-308).
- Firm approval and closed month (MUT-307/312, seams only).
- Phone and portal UI (MUT-257/258/260).
- Filing to an existing expense (P2, [MUT-389](https://barmajiyat.atlassian.net/browse/MUT-389)).
- A sweeper for stale PENDING_UPLOAD rows (bounded by the P3 cap).

## Implementation Tasks
- [ ] **T1 (P1, human: ~3h / CC: ~20min)** — migration — FILED default, `receivedOn` (+ Amman backfill test), `version`, CHECK, no FK change, rollback note
  - Surfaced by: R1, R2, R10
  - Files: `server/prisma/schema.prisma`, `server/prisma/migrations/…_mut255_receipts_library`, `server/DEPLOYMENT.md`
  - Verify: `npm run test:db`
- [ ] **T2 (P1, human: ~4h / CC: ~25min)** — store — `fileAsExpense` in lock/insert/update/throw order, `unlinkByExpense` inside the expense delete transaction
  - Surfaced by: R5, R8
  - Files: `server/src/repositories/{ports,prisma,memory,store-guard}.ts`
  - Verify: store contract tests
- [ ] **T3 (P1, human: ~2h / CC: ~15min)** — local format — 2→3 step in the portal, fingerprint test, coordinate the number
  - Surfaced by: R3
  - Files: `src/hosted/local/migrations/index.ts`
  - Verify: portal tests
- [ ] **T4 (P1, human: ~5h / CC: ~30min)** — routes — receipts routes + `upload-url` + stripped suggestion schema + If-Match + `captureSource` + shared `prepareExpenseCreate`
  - Surfaced by: R2b, R6, R9, R10, R11
  - Files: `server/src/routes/receipts.ts`, `server/src/expenses/compose.ts`, `server/src/schemas.ts`
  - Verify: `routes-receipts.test.ts`, `routes-expenses.test.ts`
- [ ] **T5 (P2, human: ~2h / CC: ~10min)** — export — new columns, null `expenseId`
  - Surfaced by: R12, D5
  - Files: `server/src/repositories/prisma-records-export.ts`, `records-file/codec.ts`
  - Verify: export parity test
- [ ] **T6 (P1, human: ~3h / CC: ~20min)** — hosted-only registration, local import keeps unattached receipts, 20-pending cap + `receiptUploadLimiter`
  - Surfaced by: R4/P1, R14/P3
  - Files: `server/src/app.ts`, `server/src/routes/receipts.ts`, `src/hosted/local/attachments.ts`
  - Verify: route tests + local round-trip test
- [ ] **T7 (P2, human: ~15min / CC: ~5min)** — release gating — mark "deploy with MUT-260/258" on the merge commit, release notes and MUT-255
  - Surfaced by: R15/P4
  - Verify: `/release` dry run lists the hold

## Build notes (2026-10-22, /eng-build)

Where the build differs from the plan above, and why:
- **Local mode keeps deleting receipts with their expense.** The plan had the unlink run in both modes. A local test
  showed a signed-out person would then keep a receipt file they can never see or delete, since local mode has no
  library (P1). `ExpenseRepository.softDelete` now takes `'unlink' | 'remove'`; `PortalRouteDependencies.receiptsLibrary`
  is true on the hosted server and false in `createLocalApp`.
- **ADR-167, not 166**: MUT-388 claimed ADR-166 and API 1.45.0, so this is `1.46.0-mut255`.
- **`receivedOn` has a UTC-day default** as well as `filingStatus`'s FILED one: the previous revision doesn't send it either.
- **No 4 KB cap on the suggestion**: every known field is bounded and unknown ones are dropped, so the stored object
  is bounded by the schema.
- **R5's "0 rows throws" has no direct test**: under the row lock it can't happen. The rollback it guards is covered by
  the "insert fails, receipt stays To review, no expense" contract test on both stores.
- **Audit**: approval writes `expense.created` with the same keys as POST /v1/expenses (plus `receiptId`, and
  `captureSource` only when the client sends one: `receipt` isn't a capture source) and `expense_receipt.filed`.
- **Ops scripts** (`profile-rows.sh`, `restore-drill.sh`) select receipts by profile, not through expenses: no change.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Plan fallback (codex not installed) | Independent 2nd opinion | 1 | unavailable (in-host completed) | 11 findings, 3 high/critical, all folded in or pending |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 16 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — (server-only) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex not installed. The native Claude Plan subagent completed within the five-minute limit (in-host), so outside coverage is unavailable.
- **VERDICT:** All decisions answered 2026-10-22 (P1–P4 as recommended; P2 → MUT-389). 12 review fixes are applied. The plan is ready for `/eng-build MUT-255`. The Eng Review row stays ISSUES OPEN in the log because it counts findings mapped to tasks, not open questions.

NO UNRESOLVED DECISIONS
