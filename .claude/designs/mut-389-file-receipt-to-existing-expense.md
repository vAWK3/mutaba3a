# MUT-389: file a To-review receipt onto an expense that already exists

Status: plan, 2026-10-22. Epic MUT-252. Server only (`server/`); no phone or portal UI.
Blocked by MUT-255 (merged to local main f36f4d42, In Review; its code is on main). Blocks MUT-257 (phone scan & review) and MUT-260 (portal gallery).
Deploy: the receipts library, MUT-389's route included, ships dark behind `RECEIPTS_LIBRARY` (off in production, §4b, D5 answer). Main can deploy again; the flag goes on when MUT-260 or MUT-258 ships (P4).

## 1. What changes, in one paragraph

A To-review receipt can be filed onto an expense the person already typed. A new `POST /v1/receipts/{receiptId}/file` with body `{ expenseId }` moves the receipt to FILED on that expense in one transaction, idempotently. No expense is created and no expense field changes. It is MUT-255's approve without the insert: the same receipt lock and conditional update, with the expense locked and its receipt count checked in between.

## 2. Decisions (overturn any before /eng-build)

| # | Decision | Why | Alternative not taken |
|---|---|---|---|
| D1 | New store method `expenseReceipts.fileOntoExpense({ organizationId, receiptId, expenseId, maxReceipts }, at)`. It shares the receipt lock and the conditional FILED update with `fileAsExpense` through two private helpers in `prisma.ts` (and one in `memory.ts`). `fileAsExpense` keeps its behavior. | The ticket says "reuses MUT-255's lock → conditional-update path", and MUT-255's P2 promised that seam. Two callers justify the extraction. | A `mode` flag on `fileAsExpense`. That would make one function with two return shapes and an optional expense input. |
| D2 | Inside the transaction, the expense row is locked `FOR NO KEY UPDATE` after the receipt (the repo's row-lock rule, `DECISIONS.md:1961`; it doesn't block inserts that reference the expense). Then it is re-checked live and on the profile, and its READY live receipts are counted against `maxReceipts`. | Two receipts filed onto an expense holding 9 at once must not end at 11. A file racing an expense delete must not leave a FILED receipt on a deleted expense. The lock order (receipt → expense) can't deadlock with `expenses.softDelete`, which locks the expense and then updates only receipts already linked to it. | Count outside the transaction, as the MUT-44 routes do. That is racy. |
| D3 | The limit counts **READY, live** receipts, the same rule as `listByExpense` and the MUT-44 `assertRoomForReceipt`. `MAX_RECEIPTS_PER_EXPENSE` stays in `expenses/compose.ts`; the route passes it in as `maxReceipts`. | One definition of "10 receipts". Policy stays in the route layer. | Count PENDING_UPLOAD too. MUT-44 doesn't. |
| D4 | The update writes `expenseId`, `filingStatus = FILED` and `version + 1`, plus `suggested` when the request sends one (it replaces the stored one, as approve; D4 answer). Otherwise `suggested` is kept, and `approved`, `approvedAt` and `approvedByUserId` are always left as they are. A never-approved receipt keeps `approved: null`, so `editRates` (which filters `approved` not null) skips it. A receipt approved earlier and unlinked by an expense delete keeps that earlier approval: it was a real event and was already counted in its week. (D2 answer, 2026-10-22.) | That's the ticket's rule ("approved stays empty, because no fields were approved"): filing approves no fields, so it writes none. | Clear `approved` on file. That would drop a counted approval from later edit-rate reads. |
| D5 | Response **200** `{ expense: ExpenseDetail, receipt }`, a new `FileReceiptResponse` component: the expense with its READY receipts (the `GET /v1/expenses/{id}` shape) plus the filed receipt. Nothing is created, so it's not a 201. (D3 answer, 2026-10-22.) | The attach screen's next view is the expense with its receipts; one round trip. | `{ expense, receipt }` reusing `ApproveReceiptResponse` (refreshes nothing, misleading name); the receipt only (an extra GET). |
| D6 | Already FILED returns 409 `CONFLICT` `RECEIPT_ALREADY_FILED` with `details.expenseId` (MUT-255 D2), **even when it is filed on the requested expense**. A replay with the same Idempotency-Key answers the first 200. | It matches approve. A client that lost its first answer can compare `details.expenseId` with what it asked for. | Answer 200 when already filed on the same expense. That would mean a second success path with no audit row. |
| D7 | Errors, checked in this order: receipt missing, deleted or another profile's → 404 "No such receipt"; receipt FILED → 409; receipt PENDING_UPLOAD → 422 `ATTACHMENT_NOT_READY`; expense missing, deleted or another profile's → 404 "No such expense"; expense full → 422 `TOO_MANY_RECEIPTS`. The idempotency layer stores every 4xx as final, so the route description repeats approve's rule: retry with a **new** key once the cause is fixed. | Receipt-side refusals come first because the receipt lock is taken first. | — |
| D8 | The expense row is not touched (no `version` or `updatedAt` bump), as with a MUT-44 attach. The entries feed's `receiptCount` is computed live (`countReadyByExpenseIds`). | Same as MUT-44; an If-Match edit of the expense in flight stays valid. | Bump the expense version. That would make an open edit sheet fail with a stale If-Match for no field change. |
| D9 | No closed-month or firm-approval check is built here; a MUT-44 attach has none either. Filing changes evidence, not amounts or dates. `fileOntoExpense` carries the same two seams as `fileAsExpense` (`TODO(blocked-by MUT-307)` and `TODO(blocked-by MUT-312)`, between the expense lock and the update). MUT-307 and MUT-312 decide whether evidence can be attached to an approved, posted or closed-month expense on both paths. | Keeps the two attach paths consistent and the seams findable. | Build the checks now (scope creep). |
| D10 | Audit `expense_receipt.filed` with `{ expenseId, mode: 'existing' }` (approve writes `mode: 'new'`). No `expense.*` row is written. | It's in the ticket's scope, and the expense didn't change. | — |

No new ADR. Add a short "Extended by MUT-389" paragraph to ADR-167 (`.claude/DECISIONS.md:4559`), covering D2–D4 and D6.

## 3. Store (`server/src/repositories/`)

`ports.ts`:
- `FileOntoExpenseResult = { kind: 'filed'; expense: ExpenseRecord; receipt: ExpenseReceiptRecord } | { kind: 'not_found' } | { kind: 'not_ready' } | { kind: 'already_filed' } | { kind: 'expense_not_found' } | { kind: 'too_many_receipts' }`.
- `ExpenseReceiptRepository.fileOntoExpense(params: { organizationId; receiptId; expenseId; maxReceipts: number; suggested?: ReceiptSuggestion }, at): Promise<FileOntoExpenseResult>`, with a doc comment in the style of `fileAsExpense`'s.

`prisma.ts`:
- Extract from `fileAsExpense`:
  - `lockToReviewReceipt(tx, organizationId, receiptId)` → `null` (ok) or `{ kind: 'not_found' | 'already_filed' | 'not_ready' }`. The same `SELECT … FOR UPDATE` and checks as today.
  - `markReceiptFiled(tx, { organizationId, receiptId, expenseId, data })`. It runs the conditional `updateMany … WHERE filingStatus = 'TO_REVIEW' AND status = 'READY' AND deletedAt IS NULL`, throws on `count !== 1`, and reads the receipt back. `data` carries approve's extra fields; file passes only `suggested`, when sent.
- `fileOntoExpense`, in one `$transaction`:
  1. `lockToReviewReceipt`; on a refusal, return it.
  2. `SELECT "deletedAt" FROM "expenses" WHERE "id" = $expenseId AND "organizationId" = $org FOR NO KEY UPDATE`. Missing or deleted → `expense_not_found`. The MUT-307/312 TODO seams follow (D9).
  3. `tx.expenseReceipt.count({ where: { organizationId, expenseId, status: 'READY', deletedAt: null } }) >= maxReceipts` → `too_many_receipts`.
  4. `markReceiptFiled`, then `tx.expense.findUniqueOrThrow` → `{ kind: 'filed', expense, receipt }`.

`memory.ts`: mirror it. Extract the receipt checks into one helper that `fileAsExpense` also uses. Use `this.expenses.getById` for the live/org check; the count reuses `listByExpense`.

`auth/store-guard.ts`: `fileOntoExpense: { write: 'expenses' }` next to `fileAsExpense` (line ~213), so a read-only (billing-locked) profile is refused like approve.

## 4. Route (`server/src/routes/receipts.ts`)

`POST /v1/receipts/{receiptId}/file`, between approve and delete:
- `security: SESSION_ONLY`; `middleware: [requireScope('expenses:write'), idempotent(store, 'receipts.file')]`; `storage()` first (503 `ATTACHMENTS_NOT_CONFIGURED` without a bucket, like its siblings).
- Body `FileReceiptRequestSchema = z.object({ expenseId: z.string().uuid(), suggested: ReceiptSuggestionSchema.optional() }).strict().openapi('FileReceiptRequest')` in `schemas.ts`, next to `ApproveReceiptRequestSchema` (also `.strict()`, same `suggested` description). D4 answer.
- Map the result per D7: `already_filed` → `alreadyFiled()`; `not_ready` → `ATTACHMENT_NOT_READY`; `expense_not_found` → `NOT_FOUND` "No such expense"; `too_many_receipts` → `tooManyReceipts()`, a new export in `expenses/compose.ts` next to `MAX_RECEIPTS_PER_EXPENSE` that `assertRoomForReceipt` (`expenses.ts:361-364`) also switches to, so the message lives once.
- `audit(c, 'expense_receipt.filed', 'expense_receipt', receipt.id, { expenseId, mode: 'existing' })`; then `listByExpense` and 200 `{ expense: { ...serializeExpense(expense), receipts: receipts.map(serializeExpenseReceipt) }, receipt: serializeExpenseReceipt(receipt) }`. New `FileReceiptResponseSchema = z.object({ expense: ExpenseDetailSchema, receipt: ExpenseReceiptSchema }).openapi('FileReceiptResponse')` in `schemas.ts` (D5).
- Description: what it does, the 409 with `details.expenseId`, the 404s, the 422s, and the new-key retry rule.

`RECEIPT_ALREADY_FILED`, `TOO_MANY_RECEIPTS` and `ATTACHMENT_NOT_READY` already exist (`schemas.ts:1138`), so no error-code change is needed.

Registration: unchanged. `receiptRoutes` is already hosted-only (`app.ts`, decision P1).

## 4b. The receipts library behind a config flag (D5 answer, 2026-10-22)

Today the library is always on (`app.ts:269`, `receiptsLibrary: true`), and P4's hold is a promise, so nothing merged to main (MUT-148 included) can ship until MUT-260/258. The switch already exists: `receiptsLibrary` picks the expense-delete mode (`expenses.ts:214`, `'unlink' | 'remove'`), and local mode passes false. This makes it a deploy setting:

- `config.ts`: `RECEIPTS_LIBRARY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true')`, the `PORTAL_LEGACY_REDIRECT` pattern (`config.ts:85-87`: never `z.coerce.boolean`, which reads "false" as true).
- `AppDependencies.receiptsLibrary?: boolean`, default **false**; `index.ts` passes `config.RECEIPTS_LIBRARY`. `portalRouteDeps.receiptsLibrary` takes it, and `receiptRoutes` (all `/v1/receipts*`, including MUT-389's file route) is mounted only when it is true. `GET /admin/v1/receipts/edit-rates` stays mounted; it returns zeros while nothing is approved.
- Off means the pre-MUT-255 behavior: no library routes (404), and deleting an expense removes its receipts and their files (`'remove'`). The MUT-255 migration is additive with FILED defaults, so it runs safely either way. MUT-255 R3's order (portal deploys before the server) still holds.
- `src/scripts/export-openapi.ts` passes `receiptsLibrary: true`, so the spec and `hosted:types` keep the library routes whatever the deploy setting.
- Dev and QA keep it on: `server/.env.example` documents `RECEIPTS_LIBRARY=true`, and the local `:8787` server and the release-qa floor servers set it.
- Terraform: `variable "receipts_library_enabled"` (bool, default false) in `variables.tf`, with the description "turn on only when MUT-260 or MUT-258 ships". `main.tf` sets the env `RECEIPTS_LIBRARY = "true"` only when it is on, following the `sentry_enabled` env block (`main.tf:601`). Production changes nothing until someone flips it.
- Turning it off after it was on hides To-review receipts (they stay in the database and the export). DEPLOYMENT.md says: turn it on once, with the first library screen, and don't turn it back off.
- P4 becomes "the flag stays off in production until MUT-260 or MUT-258 ships". ADR-167's paragraph records that, and the MUT-255 Jira ticket gets a comment.

Tests (route level, `routes-receipts.test.ts` plus `routes-expenses.test.ts`):
- Flag off (createApp's default): `GET /v1/receipts`, `POST /v1/receipts/uploads` and `POST /v1/receipts/{id}/file` → 404. Deleting an expense soft-deletes its READY receipts and removes their objects (`storage.removed` holds the key).
- Flag on: the existing MUT-255 tests and the MUT-389 tests build the app with `receiptsLibrary: true`. Every existing test that expects unlink-on-delete passes it explicitly.
- `config.test.ts` (or the nearest config test): an unset value → false, `'true'` → true, and `'false'` → false (guards against the coerce trap).
- Terraform: `terraform validate` plus a `tftest` case asserting no `RECEIPTS_LIBRARY` env while the variable is false, next to `tests/sentry_dsn.tftest.hcl`.

## 5. Ripple

- `openapi/openapi.yaml` via `npm run openapi:generate`; `openapi:check`.
- Portal types: `npm run hosted:types` → `src/hosted/api/schema.d.ts` (no portal code uses the route yet).
- `route-security.test.ts:56` list: add `'POST /v1/receipts/{receiptId}/file'`.
- `API_VERSION` (`app.ts:160`, now `1.48.0-mut148` on main b857e063) → `1.49.0-mut389`. Minor: a new route. Agree the number with the mut-390 session first (its worktree is cut from b857e063 and will want the next minor too).
- Records export, the local format and the Flutter app need no change. The receipt shape is unchanged, and the phone doesn't call the library routes until MUT-257.

## 6. Tests (TDD, written first)

Store contract, `store-contract-receipts.ts` (memory + Prisma):
1. Files a READY To-review receipt onto a live expense. The receipt becomes FILED on it with `version + 1`; `suggested` is kept; `approved`/`approvedAt` stay null. `listByExpense` includes it, and the expense count is unchanged (still 1). Variant: a `suggested` sent with the file replaces the stored one.
2. A FILED receipt → `already_filed`, whether it is filed on another expense or on the requested one.
3. PENDING_UPLOAD → `not_ready`. Another profile's receipt, or a deleted one → `not_found`.
4. Expense deleted, another profile's, or missing → `expense_not_found`, and the receipt stays To review.
5. An expense holding 10 READY receipts → `too_many_receipts`. One holding 9 READY plus 1 PENDING_UPLOAD → filed (D3).
6. A receipt approved earlier, then unlinked by an expense delete, keeps its `approved` and `approvedAt` when filed (D4).
7. The existing `fileAsExpense` cases stay green (the regression proof for the D1 extraction).
8. Prisma only (`options.concurrent`). Each test forces the overlap: a raw transaction takes the expense row lock (`FOR NO KEY UPDATE`) and does the competing write, the file starts and blocks on that lock, then the raw transaction commits.
   - Competing write = a 10th READY receipt linked to the expense, which holds 9 → the file answers `too_many_receipts`.
   - Competing write = `expenses.softDelete`'s update (deletedAt set) → the file answers `expense_not_found` and the receipt stays TO_REVIEW: never a FILED receipt on a deleted expense.

Routes, `routes-receipts.test.ts`:
- AC1: upload → complete → file → 200. The receipt is FILED and listed in the response's `expense.receipts` and in `GET /v1/expenses/{id}` `receipts`. `GET /v1/expenses` holds the same number of expenses. Counts are `{ toReview: 0, filed: 1 }`. One `expense_receipt.filed` audit row with `mode: 'existing'`, and no `expense.created` row.
- AC2:
  - A different key on a filed receipt → 409 `CONFLICT`, `reason: RECEIPT_ALREADY_FILED`, `details.expenseId`.
  - Another profile's receipt → 404. Another profile's expense → 404. A deleted expense → 404.
  - PENDING_UPLOAD → 422 `ATTACHMENT_NOT_READY`.
- AC3: 10 receipts on the expense → 422 `TOO_MANY_RECEIPTS`.
- AC4: replaying the same Idempotency-Key → the same 200 body, still one audit row.
- `GET /admin/v1/receipts/edit-rates` → `approved` doesn't change after a file.
- `storage: null` → 503. An API key → 401/403 (route-security list). A billing-locked (read-only) profile is refused, like approve (the store-guard entry).
- AC5: `openapi:check` and `test:db` green.

Commands, in `server/`:
```
npm run typecheck && npm run lint && npm test && npm run test:db && npm run openapi:check
```
At the root, `npm run hosted:types && npm run typecheck`. Use a private test DB (as MUT-255 used `mutaba3a_test_mut255`), never the shared `mutaba3a_test`.

## 7. Order of work (checkpoint commits)

1. Contract tests 1–8, red. Extract the helpers and add `fileOntoExpense` in both stores plus the store-guard entry, green.
2. Route, schema, route tests and the route-security entry. Then `openapi:generate`, `hosted:types` and the API version.
3. §4b: config, app wiring, export script, `.env.example`, Terraform variable plus tftest, and DEPLOYMENT.md, with their tests.
4. The ADR-167 paragraph (D2–D4, D6 and P4-as-flag), `.claude/CHANGELOG.md`, `TEST_PLAN.md`, a release-notes line "receipts library dark until receipts_library_enabled", and a comment on MUT-255.

Release-QA: no user-visible flow; the catalog gets no entry (same as MUT-255). MUT-257 and MUT-260 add the phone and web flows that use this route. `/qa-reconcile` checks the route tests against the ACs.

## 8. Out of scope

- The "attach to an existing expense" choice in the phone (MUT-257) and portal (MUT-260) UIs.
- Moving a filed receipt to another expense (unfile → file).
- A closed-month rule for attaching (MUT-312, D9).
- Closing MUT-44's own count race. Its upload and complete routes count outside a transaction, so a MUT-44 complete running at the same moment as a file can still reach 11. This race exists today between two MUT-44 completes.
- Known effect, not fixed: a MUT-44 upload started while the expense held 9 READY receipts, finished after a file brought it to 10, is refused at complete (422 `TOO_MANY_RECEIPTS`) after its bytes are already in the bucket. MUT-44 has the same effect today between two of its own uploads.

## Business / product impact

- The person who typed an expense and photographed the receipt later can attach it instead of duplicating the expense or losing the paper. That is the most common receipt flow for an accountant-facing record.
- It unblocks MUT-257 (phone scan & review) and MUT-260 (portal gallery). Both need "attach to an existing expense" next to "approve as new", and MUT-260 or MUT-258 is what releases MUT-255's held deploy.
- It unholds main. The library ships dark behind `RECEIPTS_LIBRARY`, so MUT-148 (Sentry) and later API work can deploy before any library screen exists.
- Risk is low: one route, one store method, one off-by-default flag, no migration and no shape change.

## Build notes (2026-10-22, /eng-build)

Built on `feature/mut-389-file-receipt-existing-expense` in worktree `.claude/worktrees/mut-389`, cut from main b857e063. Four commits: 6c8173a4 store, 8d9ed0c5 route, e319f6a4 flag, 88c7bc35 docs/version. Where the build differs from the plan, and why:
- **API `1.50.0-mut389`, not 1.49.0:** the mut-390 worktree had already taken `1.49.0-mut390` (and ADR-168). Whichever merges second renumbers.
- **No "billing-locked profile refused" test.** Billing READ_ONLY is reported by `/v1/me` (MUT-358) but not enforced on server writes yet, so there is no such refusal to prove. The guard entry's real effect (session-only, expenses domain) is covered by `store-guard.test.ts`, which walks every `expenseReceipts` method.
- **The forced-overlap tests live in their own Prisma file,** `store-prisma-receipt-file-lock.test.ts`, following `store-prisma-lock-order.test.ts` (a holder connection plus a `pg_stat_activity` wait check). A mutation run without the expense lock failed both ("the filing never waited").
- **No local `.env` or floor-server change.** Local and QA servers run without `ATTACHMENTS_BUCKET`, so every receipt route already answers 503 there and the flag changes nothing. Only `.env.example` documents it.
- **Tests that need the whole surface set `receiptsLibrary: true` explicitly:** `route-security`, `writability-routes`, and the receipts and expenses harnesses. `createApp` defaults it off.
- `test:db` flaked twice under full parallel load (`store-records-export-parity`, `deploy-bootstrap`). Both pass alone, and a full rerun was 3219/3219 green.

## Eng review (2026-10-22)

Target: this plan (`.claude/designs/mut-389-file-receipt-to-existing-expense.md`). Evidence: mini-crm local main f06a0712 (main moved to b857e063 with MUT-148 during the review; references re-checked there, see O1) and the MUT-255 brief. The gstack design-doc finder returned an unrelated May design doc (`basel-main-design-20260524-100930.md`), which was not used.

### Scope record

feature answers: none proposed (every file is required); structure: A, Original arrangement (D1, answered 2026-10-22); accepted scope: the plan as written, 7 source files plus 3 test files and docs; pending remedies: R1.
Scope update after D5 (2026-10-22): the user added the library flag (§4b). It brings config.ts, index.ts, export-openapi.ts, .env.example, two Terraform files plus a tftest, DEPLOYMENT.md and one config test. Scope Challenge result: scope accepted, then expanded by the user's choice.

### Corrections applied (factual, no behavior change)

- C1 (surface-check): `npm run openapi:export` does not exist. The script is `openapi:generate` (`server/package.json:28`), so §5 is corrected.
- C2: the neighboring request schemas use `.strict()` (`schemas.ts:2355-2358`, `ApproveReceiptRequestSchema`), so `FileReceiptRequestSchema` is `.strict()` too. §4 is corrected.

### Reality rows

- REALITY: premise-table pass 15 premises checked, unverified=0 (listByExpense READY-only `prisma.ts:1608-1609`; limit 10 `expenses/compose.ts:15`; expense delete updates the expense row first `prisma.ts:1427`; editRates skips null approved `prisma.ts:1693`; approve audits mode new `receipts.ts:311`; GET expense lists receipts `expenses.ts:131-132`; guard map typed over LedgerStore `store-guard.ts:31-33`) `server/src/repositories/prisma.ts:1608`
- REALITY: already-done pass no MUT-389 commit or `fileOntoExpense` symbol on local main f06a0712 `server/src/routes/receipts.ts:282`
- REALITY: surface-check finding `openapi:export` is not a script; `openapi:generate` is (C1, applied) `server/package.json:28`
- REALITY: binding-decisions pass honors MUT-255 P1 (hosted-only), P4 (deploy hold) and D2 (409 with details.expenseId), and MUT-299 D8 "one receipt one record" `.claude/designs/mut-255-receipts-library.md:226`
- REALITY: numbers finding limit 10 [measured: compose.ts:15]; API was 1.47.0-mut388 at f06a0712 but is 1.48.0-mut148 on main b857e063 [measured: app.ts:160], so the bump is 1.49.0 [estimated, agree with mut-390] (O1, applied) `server/src/app.ts:160`
- REALITY: deferred-asks pass all 5 scope bullets and 5 ACs are mapped to §3–§6; the `approved` wording is raised as R1 `.claude/designs/mut-389-file-receipt-to-existing-expense.md:20`
- REALITY: pr-count pass one branch, one local merge (no ship-policy.json, default 1) `.claude/designs/mut-389-file-receipt-to-existing-expense.md:96`
- REALITY: transaction-semantics n/a no driver, pool or protocol change; row-lock order is reviewed in Section 1 `server/src/repositories/prisma.ts:1425`

## Decision ledger

### R1: what `approved` holds after a once-approved receipt is filed onto another expense
Finding: 1, P2, confidence 8/10, plan §2 D4 vs the ticket's scope line, reviewer: Claude (native). The ticket says "`approved` stays empty, because no fields were approved". MUT-255's unlink keeps `approved` when an expense is deleted (`prisma.ts:1433` sets only expenseId/filingStatus/version). So a receipt approved into expense X, whose X is then deleted, carries X's approval when it is filed onto Y.
Plan baseline: D4 (original proposal, unapproved): leave `approved`, `approvedAt` and `approvedByUserId` as they are.
Runtime evidence: `editRates` counts rows by `approvedAt` with `approved` not null (`prisma.ts:1690-1694`), so clearing those fields changes a re-run of a past week. `ExpenseReceiptSchema` returns `approved` to clients.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 approved fields when filing a once-approved receipt | kept (D4 proposal, pending) | kept as they are | cleared: approved, approvedAt, approvedByUserId → null |
| Never-approved receipt | approved stays null (ticket) | null, unchanged | null, unchanged |
| Store contract test 6 | asserts kept | asserts kept | asserts cleared |
| D1 structure | original arrangement (D1 answer) | unchanged | unchanged |
Question D2:
D2 — What should a re-filed receipt keep from its earlier approval?
Project/branch/task: mini-crm main, eng review of the MUT-389 plan.
ELI10: When a receipt is approved into expense X, the server saves a snapshot of the amount, date and vendor the person approved; the weekly "how often do people fix what the reader read" figure is built from those snapshots. If X is later deleted, MUT-255 sends the receipt back to To review but keeps the snapshot. If the person then files it onto an existing expense Y, should the snapshot stay? The ticket says approved "stays empty", written for the usual case of a receipt never approved. This is the rare approve, delete, then refile case.
Stakes if we pick wrong: Keep it and the receipt shows approved values from a deleted expense; clear it and re-running a past week's edit-rate figure drops one approval it had counted.
Recommendation: A because the approval really happened, the snapshot is dated, and it keeps the operator's weekly figure stable when re-run.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Keep the earlier approval (recommended)
  ✅ Re-running last week's edit-rate figure gives the same numbers it gave on Monday
  ✅ No data is thrown away; approvedAt says plainly that the approval is older than the filing
  ❌ The receipt's approved amount can differ from the expense it now sits on, which a UI could misread
B) Clear it when filing
  ✅ Matches the ticket's wording literally: a filed-onto-existing receipt never has approved values
  ✅ The receipt never shows numbers that belong to a deleted expense
  ❌ A past week's edit-rate figure can change after the fact when the same receipt is refiled
Net: metric history stability against a receipt that only describes its current expense.
Header: Re-filed
Options:
A) Keep earlier approval (recommended)
Leave approved, approvedAt and approvedByUserId untouched when filing (plan D4). Contract test 6 asserts they are kept. Effort: none beyond the plan. Risk: a UI could show the old approved values; MUT-260 should show the expense's own fields.
B) Clear on file
Set approved, approvedAt and approvedByUserId to null in the file update. Contract test 6 asserts they are cleared. Effort human ~15 min / CC ~2 min. Risk: past edit-rate figures can shift when re-run.

State: approved
Actual answer: A) Keep earlier approval (recommended), D2 answer 2026-10-22
Accepted scope: plan D4 as written: the file update writes expenseId, filingStatus FILED and version + 1 only; approved, approvedAt and approvedByUserId stay untouched; store contract test 6 asserts they are kept.
History: none
Note after the outside review (O6, a factual correction): the "past weeks stay stable" reason holds only for this path. A once-approved receipt that is unlinked and then approved again through `fileAsExpense` overwrites `approved` and `approvedAt` (`prisma.ts:1676-1682`), so it moves out of its old week. The answer stands; D4's reason is now "filing approves no fields, so it writes none".

### Outside voice (Claude Plan subagent, native fallback; codex not installed)

The subagent completed in 238 s, inside the five-minute timer. Its 10 findings were checked against the code:

| # | Sev | Finding | Verified | Disposition |
|---|---|---|---|---|
| O1 | Med | The API version and base are stale. Main is b857e063 (MUT-148 merged), `API_VERSION = '1.48.0-mut148'` (`app.ts:160`), and ADR-167 is at `DECISIONS.md:4559`. The `mut-390` worktree (cut from b857e063) will want the next minor too. | yes | Factual correction applied: bump to `1.49.0-mut389` after agreeing the number with the mut-390 session. |
| O2 | Med | Lock the expense `FOR NO KEY UPDATE`, not `FOR UPDATE`. FOR UPDATE conflicts with the FOR KEY SHARE that FK checks take, so it would block MUT-44 receipt inserts on that expense. | yes; `DECISIONS.md:1961` (qa-reconcile 2026-10-14, owner answer D3): "row locks are `FOR NO KEY UPDATE`" | Applied as a binding decision (exact prior approval); D2 and §3 corrected. |
| O3 | Med | Concurrency tests 8a/8b via `Promise.all` don't force the overlap, and 8b passes either way. | yes | Applied as required proof of D2: each test holds the expense row lock in a raw transaction, starts the file, then commits the competing write, so the file is waiting on the lock when the other side commits. |
| O4 | Med | P4's deploy hold has no flag (`receiptsLibrary: true` hardcoded, `app.ts:269`), so MUT-148 and everything after it on main is held until MUT-260/258 ship. | yes | R4, pending. |
| O5 | Low | D5's reason contradicts D8: the expense is unchanged, so returning it refreshes nothing, and the `ApproveReceiptResponse` name misleads. | yes | R2, pending. |
| O6 | Low | D4's "history stays stable" premise is false on the re-approve path. | yes (`prisma.ts:1676-1682`) | Factual correction to the reason; the decision (D2 answer) stands. |
| O7 | Low | D9 names only MUT-312; `fileAsExpense` also carries `TODO(blocked-by MUT-307)` (`prisma.ts:1670`). | yes | Applied: both TODO seams go at the same spot in `fileOntoExpense` (comments only). |
| O8 | Low | The 422 message would be copied into `receipts.ts`. | yes (`expenses.ts:361-364`) | Applied as implementation of §4's "same message" contract: one `tooManyReceipts()` in `expenses/compose.ts`, used by both routes. |
| O9 | Low | The strict body can't carry a review-time `suggested`, which approve accepts. | yes (`schemas.ts:2355-2357`) | R3, pending. |
| O10 | Low | No behavior test for a read-only profile. A pending upload on a full expense now fails at complete after its bytes are uploaded. | yes | Applied: a route test "billing-locked profile → refused" (required proof of §3's guard line), and the pending-upload effect is noted in §8. |

### R2: what the file route returns
Finding: O5, Low, confidence 8/10, plan §2 D5, reviewer: outside voice (verified).
Plan baseline: D5 (original proposal): 200 `{ expense, receipt }`, reusing `ApproveReceiptResponseSchema`.
Runtime evidence: D8 leaves the expense row untouched. `GET /v1/expenses/{id}` returns `ExpenseDetailSchema` (expense plus READY receipts) via `listByExpense` (`expenses.ts:128-134`).
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R2 response body | `{ expense, receipt }` as ApproveReceiptResponse | `{ expense: ExpenseDetail (with receipts), receipt }`, new component FileReceiptResponse | unchanged (plan D5) | the FILED receipt only (ExpenseReceipt) |
| Status | 200 | 200 | 200 | 200 |
| R3 body `suggested` | pending | pending | pending | pending |
| R4 deploy hold | pending | pending | pending | pending |
Question D3:
D3 — What should filing a receipt return to the app?
Project/branch/task: mini-crm main, eng review of the MUT-389 plan.
ELI10: After the app attaches a scanned receipt to an expense, it has to show that expense with the new receipt in its list. The plan returns the expense and the receipt in the same shape approve uses. But the expense itself didn't change, so the app still has to fetch the list of receipts again. Returning the expense together with its receipts (the shape GET /v1/expenses/{id} already returns) gives the app everything in one answer.
Stakes if we pick wrong: The phone and portal make an extra request after every attach, or carry a response type named "ApproveReceiptResponse" for an action that approves nothing.
Recommendation: A because the attach screen's next view is the expense with its receipts, and the shape already exists.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Expense with its receipts (recommended)
  ✅ One round trip: the app gets the updated receipt list without a second GET
  ✅ Reuses the existing ExpenseDetail shape, so the portal types already know it
  ❌ One more small query per call (at most 10 receipt rows) and a new response component
B) Keep plan D5
  ✅ The same parser as approve, with no new OpenAPI component
  ❌ Returns an unchanged expense the app already has, under a misleading type name
C) Receipt only
  ✅ The smallest response, with no extra query at all
  ❌ The app must GET the expense again to show its receipt list
Net: one extra indexed query against an extra round trip on every attach.
Header: Response
Options:
A) Expense with its receipts (recommended)
200 `{ expense: ExpenseDetail, receipt }` as a new `FileReceiptResponse` component; the store returns the expense, and the route lists its receipts with `listByExpense`. Route test AC1 asserts the receipt is in `expense.receipts`. Effort human ~30 min / CC ~5 min. Low risk.
B) Keep plan D5
200 `{ expense, receipt }` reusing `ApproveReceiptResponseSchema`. Effort none. Risk: a misleading type name in `schema.d.ts`, and clients refetch the receipt list.
C) Receipt only
200 with the FILED receipt (`ExpenseReceiptSchema`); the store needn't read the expense back. Effort human ~15 min / CC ~3 min. Risk: an extra GET in every client.

State: approved
Actual answer: A) Expense with its receipts (recommended), D3 answer 2026-10-22
Accepted scope: 200 `{ expense: ExpenseDetail, receipt }` as a new `FileReceiptResponse` component; the store returns the expense, the route lists its receipts with `listByExpense`; route test AC1 asserts the receipt is in `expense.receipts`. Plan D5 and §4 amended.
History: D5 original proposal was `{ expense, receipt }` reusing ApproveReceiptResponse (superseded by this answer).

### R3: whether the file body carries a review-time `suggested`
Finding: O9, Low, confidence 7/10, plan §4 (strict body), reviewer: outside voice (verified).
Plan baseline: §4 (original proposal): body `{ expenseId }` only, `.strict()`.
Runtime evidence: `ApproveReceiptRequestSchema` takes an optional `suggested` that replaces the stored one (`schemas.ts:2355-2357`, `prisma.ts:1682`). Without it, a reader that runs at review time needs a separate If-Match `PATCH /v1/receipts/{id}/suggestion` first.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 body | `{ expenseId }` strict | `{ expenseId, suggested? }` strict; a sent `suggested` replaces the stored one in the same update | unchanged |
| D4 approved fields | untouched (D2 answer) | untouched | untouched |
| editRates | skips (approved null) | skips | skips |
| R2 response | expense with receipts (D3 answer) | unchanged | unchanged |
Question D4:
D4 — Should filing accept what the phone read at review time, like approve does?
Project/branch/task: mini-crm main, eng review of the MUT-389 plan.
ELI10: The phone may read a receipt (date, amount, vendor) only when the person opens it to review. Approve lets the app send that reading along, and the server keeps it with the receipt. The planned file route takes only the expense id, so a reading done at review time would need a separate save request first, or be lost. Adding an optional field now keeps both actions the same.
Stakes if we pick wrong: Without it, MUT-257 either adds a second request (with its own version check) before every attach, or drops readings that MUT-254's vendor learning could use.
Recommendation: A because it mirrors approve exactly, is optional, and costs a few lines plus one test.
Completeness: A=10/10, B=8/10
Pros / cons:
A) Accept optional suggested (recommended)
  ✅ Attach and approve take the same reading the same way, so MUT-257 has one code path
  ✅ No second request with a version check before attaching
  ❌ A slightly wider request body to document and test
B) Body stays expenseId only
  ✅ The smallest possible contract; adding the field later is additive and safe
  ❌ MUT-257 must PATCH the suggestion first or lose a review-time reading
Net: a few lines now against a second request in every attach later.
Header: Suggestion
Options:
A) Accept optional suggested (recommended)
Body `{ expenseId, suggested? }`, strict; a sent suggestion replaces the stored one in the file update (as approve). Contract test 1 gains a variant that asserts the replacement. Effort human ~30 min / CC ~5 min. Low risk.
B) Body stays expenseId only
Keep §4 as planned. The suggestion is set only through the PATCH route. Effort none. Risk: MUT-257 needs an extra request or loses the reading.

State: approved
Actual answer: A) Accept optional suggested (recommended), D4 answer 2026-10-22
Accepted scope: body `{ expenseId, suggested? }`, strict; a sent suggestion replaces the stored one in the file update (as approve), an absent one leaves it; contract test 1 gains a variant asserting the replacement. Plan §2 D4, §3 and §4 amended.
History: §4 original proposal was `{ expenseId }` only (superseded by this answer).

### R4: MUT-255's deploy hold now holds all of main
Finding: O4, Med, confidence 9/10, `server/src/app.ts:269` (`receiptsLibrary: true`) and plan lines 5 and 120, reviewer: outside voice (verified).
Plan baseline: P4 (Basel, 2026-10-22): MUT-255 isn't deployed until MUT-260 or MUT-258 ships; MUT-389 rides that hold.
Runtime evidence: MUT-148 (b857e063) is merged on top of MUT-255, so it is held too. The library and the unlink-on-delete behavior already switch on `receiptsLibrary` (`PortalRouteDependencies`), which is hardcoded true on the hosted server.
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R4 library gating | hardcoded on; manual hold | in MUT-389: `receiptsLibrary` from config, off in prod until MUT-260/258, so main can deploy | unchanged, MUT-389 rides the hold | investigate the flag's reach (routes, unlink, export) before choosing; no change | not in MUT-389; raise it as its own ticket |
| MUT-389 scope | the plan | plan + flag | the plan | the plan | the plan |
Question D5:
D5 — MUT-255's release hold now blocks everything on main. Fix it inside MUT-389?
Project/branch/task: mini-crm main, eng review of the MUT-389 plan.
ELI10: You chose to keep MUT-255 out of production until a screen that shows the receipts library ships (MUT-260 or MUT-258). That hold is a promise, not a switch: the library is always on in the code. Since then MUT-148 (Sentry for the API) merged on top of it, so it can't ship either, and neither can anything else merged to main, MUT-389 included. The code already has a `receiptsLibrary` switch, so reading it from config (off in production) would let main ship again. That is MUT-255's release gate, though, not this ticket's feature.
Stakes if we pick wrong: Either MUT-389 grows a config change unrelated to its feature, or API fixes on main (Sentry now) wait for the portal gallery.
Recommendation: D because it's MUT-255's gate and you sequence releases yourself; a short ticket of its own keeps MUT-389 small and puts the choice on the board.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add the flag in MUT-389
  ✅ Main can deploy again as soon as MUT-389 lands, Sentry included
  ✅ The hold becomes enforced by the code instead of remembered
  ❌ Grows MUT-389 with config, release and test work that has nothing to do with filing receipts
B) Keep: MUT-389 rides the hold
  ✅ No change to MUT-389, and P4 stays exactly as you decided it
  ❌ Nothing on main reaches production until a library screen ships
C) Investigate first
  ✅ A bounded look at what the flag must cover (routes, unlink, export) before choosing
  ❌ Delays the plan for a question MUT-389 doesn't need answered
D) Raise it as its own ticket (recommended)
  ✅ MUT-389 stays the size of its feature, and the hold question gets its own decision on the board
  ✅ You keep sequencing releases, now knowing MUT-148 is held
  ❌ Main stays held until that ticket or a library screen lands
Net: a small separate ticket against widening this one.
Header: Deploy hold
Options:
A) Apply: flag in MUT-389
Read `receiptsLibrary` from config (off in production) inside MUT-389 so main can deploy. Effort human ~3h / CC ~25 min with tests and the release note. Risk: scope growth.
B) Keep: rides the hold
MUT-389 unchanged; the hold stays manual. Effort none. Risk: main stays undeployable.
C) Investigate first
A bounded pass (CC ~5 min) over everything `receiptsLibrary` gates, then this question again. No change meanwhile.
D) Defer: own ticket (recommended)
Not in MUT-389. File a MUT ticket "put the receipts library behind a config flag so main can deploy" via /pm-intake. MUT-389 is unchanged.

State: approved
Actual answer: A) Apply: flag in MUT-389 (not the recommendation), D5 answer 2026-10-22
Accepted scope: the `receiptsLibrary` switch comes from config, off unless set, so main can deploy with the library dark; see §4b. Effort human ~3h / CC ~25 min with tests and the release note.
History: none

Approval readiness: PASS. Checked: D1 (structure), R1 (D2), R2 (D3), R3 (D4), R4 (D5), each with its own answer of 2026-10-22. O2 cites the exact prior approval `DECISIONS.md:1961` (owner answer D3, 2026-10-14). O3 and O10 are required proof of approved behavior (D2's guarantee, §3's guard line). C1, C2, O1, O6, O7 and O8 are factual corrections, comment-only seams, or the implementation of a stated contract, with no behavior change.

## Review sections

**Section 1, Architecture.**
- [P2] (confidence: 8/10) plan §2 D4 vs the ticket: the `approved` snapshot on a re-filed receipt. Approved (D2: keep).
- The lock order (receipt, then expense) can't deadlock with `expenses.softDelete` (`prisma.ts:1425-1438`). It updates the expense row first and then only receipts already linked to it, so an unlinked receipt is never in its predicate. The outside voice confirmed this independently.
- Security: session-only, `expenses:write`, profile header ownership, and the store-guard `{ write: 'expenses' }` entry. Same doors as approve.
- Dispositions: R1 accepted via D2.

**Section 2, Code quality.**
- No new native issues beyond C1/C2 (Scope Challenge).
- Shared-code rubric for D1: callers are `prisma.ts:1663-1689` and `memory.ts:1881-1896` (existing `fileAsExpense`) plus the proposed `fileOntoExpense` in both stores. About 20 implementation lines saved [estimated]; one lock and FILED rule instead of two.
- O8 adds `tooManyReceipts()` (callers `expenses.ts:361-364` and the new route).
- Dispositions: n/a.

**Section 3, Tests.** Diagram:
```
CODE PATHS                                             USER FLOWS (API clients)
[+] fileOntoExpense (prisma + memory)                  [+] Attach a scanned receipt to a typed expense
  ├── [PLANNED ★★★] filed; suggested kept/replaced        ├── [PLANNED ★★★] AC1 upload→complete→file, expense.receipts
  ├── [PLANNED ★★★] already_filed / not_ready / not_found ├── [PLANNED ★★ ] AC4 replay same key → same 200
  ├── [PLANNED ★★★] expense_not_found (deleted/other/none)└── [PLANNED ★★ ] 4xx then new key (documented)
  ├── [PLANNED ★★★] too_many (10 READY) / 9+pending ok  [+] Error states
  ├── [PLANNED ★★★] forced overlap: 10th receipt, delete  ├── [PLANNED ★★★] 409 details.expenseId, 404s, 422s
  └── [PLANNED ★★ ] approved kept on re-file (D2)         └── [PLANNED ★★ ] read-only profile refused
[=] fileAsExpense via shared helpers                   [+] Library flag
  └── [★★★ TESTED] store-contract-receipts.ts:118-160     ├── [PLANNED ★★ ] off: 404 + delete removes receipts
[+] RECEIPTS_LIBRARY config                               └── [PLANNED ★★ ] on: MUT-255 + MUT-389 suites
  └── [PLANNED ★★ ] unset/'false' → off, 'true' → on    [+] Terraform: [PLANNED ★★] tftest no env while off
COVERAGE: every new path has a named planned test; 0 gaps after O3/O10
```
- REGRESSION (carried forward, exact prior contract): approve's behavior after the helper extraction, protected by the existing contract tests at `store-contract-receipts.ts:118-160`.
- Test plan artifact: `~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261022-122848.md`.
- Dispositions: O3 and O10 applied (required proof).

**Section 4, Performance.** No issues.
- One count of at most 10 rows on `@@index([organizationId, expenseId, createdAt])`, two row locks, and one `listByExpense` for the response (at most 10 rows). Scale: per attach, user-paced.
- No loops and no unbounded reads.

## What already exists (reused)
- `fileAsExpense`'s lock and conditional update, shared through D1's helpers.
- `idempotent()`, `alreadyFiled()`, `listByExpense`, `ExpenseDetailSchema`, `MAX_RECEIPTS_PER_EXPENSE`.
- The `receiptsLibrary` switch (`expenses.ts:214`, `portal-routes.ts:45`).
- The `PORTAL_LEGACY_REDIRECT` env-boolean pattern and the `sentry_enabled` Terraform pattern.

## NOT in scope
- Phone and portal attach UIs (MUT-257, MUT-260).
- Moving a filed receipt between expenses.
- Closed-month, firm-approval or posted-expense rules for attaching. MUT-312 and MUT-307 own them; seams only (D9).
- Closing MUT-44's own count race (§8).
- Turning the library on in production. That happens when MUT-260 or MUT-258 ships.

## Failure modes
- **File races an expense delete.** The expense row lock is rechecked under it: 404, and the receipt stays To review. Forced-overlap test. The user sees a clear error.
- **Two attaches fill the last slot.** The count runs under the expense lock, so one gets 422 `TOO_MANY_RECEIPTS`. Forced-overlap test. Clear error.
- **The client lost its first answer.** A replay returns the same 200. With a new key, the 409 names the expense. Tests AC4 and AC2.
- **The flag is mis-set in production.** It is off by default, the parse is strict, and a config test plus a tftest cover it. When off, the library routes 404 (clear), and deletes behave as before MUT-255.
- **Critical gaps: 0.**

## Worktree parallelization
Sequential implementation, no parallelization opportunity: the store, route and flag work share `app.ts`, `schemas.ts` and the receipts tests.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~3h / CC: ~20min)** — store — `fileOntoExpense` with the shared helpers, an expense lock `FOR NO KEY UPDATE`, count under the lock, `suggested` passthrough, MUT-307/312 seams
  - Surfaced by: O2, R3/D4, O7, D1
  - Files: `server/src/repositories/{ports,prisma,memory}.ts`, `server/src/auth/store-guard.ts`
  - Verify: contract tests 1–8 on memory and Prisma (`npm run test:db`, private DB)
- [ ] **T2 (P1, human: ~1h / CC: ~10min)** — tests — forced-overlap concurrency tests (10th receipt, expense delete)
  - Surfaced by: O3
  - Files: `server/src/repositories/__tests__/store-contract-receipts.ts`
  - Verify: `npm run test:db`
- [ ] **T3 (P1, human: ~2h / CC: ~15min)** — route — `POST /v1/receipts/{receiptId}/file` returning `{ expense: ExpenseDetail, receipt }`, `FileReceiptRequest` with optional `suggested`, `tooManyReceipts()`
  - Surfaced by: R2/D3, R3/D4, O8
  - Files: `server/src/routes/receipts.ts`, `server/src/routes/expenses.ts`, `server/src/expenses/compose.ts`, `server/src/schemas.ts`
  - Verify: `routes-receipts.test.ts` (AC1–AC4, read-only refusal), `route-security.test.ts`
- [ ] **T4 (P1, human: ~3h / CC: ~25min)** — config/infra — the `RECEIPTS_LIBRARY` flag (off by default), app wiring, export script on, `.env.example`, Terraform variable plus tftest, DEPLOYMENT.md
  - Surfaced by: O4/R4, D5
  - Files: `server/src/{config,index,app}.ts`, `server/src/scripts/export-openapi.ts`, `server/.env.example`, `server/infrastructure/terraform/{variables,main}.tf`, `server/infrastructure/terraform/tests/`, `server/DEPLOYMENT.md`
  - Verify: flag-off and flag-on route tests, the config test, `terraform validate` plus `terraform test`
- [ ] **T5 (P2, human: ~30min / CC: ~5min)** — release — API `1.49.0-mut389` (agree with mut-390), `openapi:generate`, `hosted:types`, ADR-167 paragraph, CHANGELOG, TEST_PLAN, MUT-255 Jira comment
  - Surfaced by: O1, C1
  - Files: `server/src/app.ts`, `server/openapi/openapi.yaml`, `src/hosted/api/schema.d.ts`, `.claude/DECISIONS.md`, `.claude/CHANGELOG.md`, `.claude/TEST_PLAN.md`
  - Verify: `npm run openapi:check`, root `npm run typecheck`

## Completion summary
- Step 0: Scope Challenge: scope accepted as-is (D1), then expanded by the user's D5 choice (library flag)
- Reality rows: 8/8 applicable rows emitted (7 tier 1, 1 tier 2 n/a); 0 unverified premises
- Architecture Review: 1 issue found (R1)
- Code Quality Review: 0 issues found (C1 and C2 recorded under Scope Challenge)
- Test Review: diagram produced, 0 gaps identified natively (O3 and O10 from the outside voice, applied)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Claude Plan subagent (native fallback; codex not installed), completed in 238 s; 10 findings, 3 answered by the user (D3–D5), 7 applied as corrections or required proof
- Parallelization: 1 lane, 0 parallel / 5 sequential
- Lake Score: 1/1 (D4 scored for completeness; the 10/10 option was chosen)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Plan fallback (codex not installed) | Independent 2nd opinion | 1 | unavailable (in-host completed) | 10 findings: 3 decided by the user, 7 applied |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 1 issue, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — (server-only) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex isn't installed. The native Claude Plan subagent completed inside the five-minute timer (in-host), so outside coverage is recorded as unavailable.
- **VERDICT:** No review is CLEAR; eng review required. The Eng Review shows ISSUES OPEN because its one finding (R1) is answered and folded into the plan, not because anything is open. All five decisions are answered. The plan is ready for `/eng-build MUT-389`.

NO UNRESOLVED DECISIONS
