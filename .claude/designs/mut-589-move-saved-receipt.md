# MUT-589 — Choose a shared receipt's profile; move a saved expense (with its receipts) to another profile

Epic MUT-252 · Story · Jira Backlog · relates MUT-257 (In Review), MUT-503 (Done, ADR-228), MUT-590, MUT-537 (In Review, same phone screens)
Copy to `.claude/designs/mut-589-move-saved-receipt.md` at build. Next numbers: **ADR-255**, **API 1.109.0-mut589** (current `1.108.0-mut565`, `server/src/app.ts:348`); confirm both are still free at build.

## Decisions (Basel, 2026-11-11)
- **D1 Fields: map by name, and show what changes.** The confirm step lists every field that changes:
  - **Category:** same `nameKey` on the target. Otherwise, both names resolve to the same preset template key (so it works across Arabic and English names, ADR-208). Otherwise, the target's preset `other` category. Otherwise, none (`categoryId` is nullable).
  - **Vendor:** find or create on the target by registration, then by name (`withResolvedVendor`). The free-text `vendor` is kept.
  - **Client (`customerId`) and matter (`projectId`):** cleared. They never cross profiles.
  - **Expense groups:** the target's groups are date-based, so membership recomputes there. The source's `ExpenseGroupOverride` rows are deleted.
  - **VAT:** kept when the target is a firm (`firmEnabledAt`). Otherwise the VAT columns and `allocationNumber` are cleared, and `amountMinor` (gross) stays.
  - **Money keeps its currency** (ADR-004). Amount, currency, date, title and notes are unchanged.
- **D2 Who may move:**
  - The person must be a member of both profiles, and neither profile may be lapsed (402).
  - Moving **out of** a co-owned business profile needs `ownsProfile` (403 `NOT_OWNER`, as in MUT-453).
  - A profile whose writer of record is Malafat refuses with 403.
- **D3 Share, early tap:** the person can choose the profile at once. The choice is held on the run item, and the move fires as soon as the receipt is READY. Save stays disabled until the move settles.
- **D4 Scope: any expense, with or without receipts** (Basel widened the ticket's "saved receipt with its expense"). Note this on the ticket.

## Server (mini-crm `server/`)
1. **Pure planner `planExpenseMove(expense, sourceCtx, targetCtx)`** in a new file, `server/src/expenses/move-plan.ts`.
   - Input: the expense, plus the target's categories, preset map, firm flag and vendor match.
   - Output: `{ patch, changes: [{field, from, to}] }`.
   - No I/O, so it gets full unit tests. It reuses `presets.ts` (name → template key) and the `nameKey` normaliser.
2. **`GET /v1/expenses/{id}/move-preview?profileId=`** (session, `expenses:read`).
   - Answers `{ changes, receiptCount, expenseVersion }`.
   - It runs the same gates as the move, so a refusal shows before the person confirms.
3. **`POST /v1/expenses/{id}/move {profileId, expectedVersion}`** (session only, `expenses:write`, `idempotent(store,'expenses.move')`).
   - The compose step lives in `server/src/expenses/compose.ts` (or a new file, `expense-move.ts`), next to `moveLibraryReceipt`.
   - Gates, in order:
     1. 422 `SAME_PROFILE`.
     2. 404 `EXPENSE_NOT_FOUND`.
     3. Owner check on the source (D2).
     4. Target: `writableTarget` (404 `PROFILE_NOT_FOUND`, 402 lapsed). Reused from receipts-compose: export it, don't copy it.
     5. 409 `VERSION_CONFLICT` when `expectedVersion` is stale, so the client reloads the preview.
     6. 409 `RECEIPT_NOT_READY` if any of its receipts isn't READY.
   - Then: plan, resolve the vendor on the target, and copy every receipt object to `movedReceiptStorageKey(target, id, nonce)` (at most 10).
   - **One transaction** (`expenses.moveToProfile`, a new store method in ports, prisma, memory and the `STORE_ACCESS` guard):
     - Lock the expense row and its receipts.
     - Set the expense's `organizationId`, apply the patch, and `version + 1`.
     - Set each receipt's `organizationId` and `storageKey`, and rewrite `approved.categoryId` to the mapped id. The rest of `approved` is kept as history.
     - Delete the group overrides.
     - Write both audit rows: `expense.moved_out` `{toProfileId, changes}` and `expense.moved_in` `{fromProfileId, changes}`.
   - Before the commit, a failure removes this move's copies. After it, nothing throws (ADR-228 D8): the old objects are deleted, and the result is reported but never raised. Then `touchExpenseVendor` on the target.
   - The same id is kept, so links and receipt FKs survive.
   - Answers 200 `{ expense, fromProfileId, changes }`.
4. **`POST /v1/receipts/{id}/move` on a FILED receipt** stays 409 `RECEIPT_ALREADY_FILED` with `details.expenseId`. Clients route to the expense move. No change to MUT-503.
5. Schemas go in `schemas.ts`, then `openapi:generate`. `API_VERSION` goes to 1.109.0-mut589. Add ADR-255, which amends ADR-228 ("filed receipts stay out").
6. **Reading race:** a filed receipt has finished reading, and the MUT-503 `releaseMovedRead` path already covers a key that changed.

## Portal (`src/hosted/`)
- **Generalise `MoveReceiptDrawer` into `MoveToProfileDrawer`** (more than 70% of it overlaps). It keeps the same `.hp-profile-row` radios, named primary button and banners.
  - It gains an optional **changes list**: after a profile is chosen, it fetches the preview and shows what changes.
  - `MoveReceiptDrawer` becomes a thin wrapper, so existing tests stay.
- Where it opens:
  - The `ExpenseDrawer` footer: **Move**, beside Delete, hidden when `readOnly` or `!hasOtherProfiles`.
  - A filed receipt card's ⋯ in `ReceiptsGallery` / `ReceiptReview`: "Move with its expense".
  - It mounts through a URL key, `?moveExpense=<id>`, in `ProfileDrawers` (drawer-first).
- Data layer:
  - `client.ts`: `expenseMovePreview` and `moveExpense`.
  - `expenseQueries`: a mutation that invalidates both profiles' expense lists, summaries and receipts.
  - The existing `useMovedToast` shows "Moved to X · Open".
- **Local (signed-out) mode:** Move is hidden (no receipts library, `copy()` throws), as in MUT-503.

## Phone (Flutter `mutaba3a-flutter/mutaba3a`)
- **Share "Saves to":**
  - `ShareReviewLine` (`receipt_review_sheet.dart:1164`) gains `onChangeProfile`. The line becomes a button, and it stays plain text when there is only one profile.
  - It opens `showMoveReceiptSheet`, in a mode that returns the chosen profile.
  - `ShareReviewController` gains `retarget(localId, profileId)` and `pendingProfileId`.
  - The screen (`shared_receipt_review_screen.dart`):
    - Before the receipt arrives, it stores the pending choice.
    - On `arrived` (or at once if READY), it calls `receiptMoverProvider.move`, then `retarget`.
    - Save and Attach are disabled while a move is in flight.
    - An error leaves the item on its source and shows the existing `receiptsMoveError*` banner.
  - Each run item keeps its own profile, which covers "1 of N".
- **Remembered default:** `LastShareProfileStore` in `lib/domain/services/`.
  - Per-user JSON on `secureStorageProvider`, like `LocaleStore`. Not the App Group, which has no plugin on Android.
  - Written only when the person chooses a profile. Cleared in `sign_out_flow.dart`.
  - `app.dart:502` puts it first in the share chain, used only if it is still a writable membership. The Receipts tab's chain is unchanged.
- **Move a saved expense:**
  - `ExpenseRepository.movePreview` and `move`, plus `expenseMoverProvider` (`ActionKeys` idempotency). On a retry answered 404 or in-progress, it re-reads the expense on the target, as in MUT-503.
  - A new `move_expense_sheet.dart` reuses the move sheet's profile rows (`ProfilePickerRow`, `moveTargetsOf`, `_reasonFor`), adds the changes list and a named confirm.
  - Where it opens:
    - The receipt viewer ⋯ shows for filed receipts too: "Move with its expense".
    - Recent's details sheet gets a new `RecentActionKind.move` in `_serverActions`, for any server expense (D4).
  - After a move: invalidate both profiles' expense, receipt and recent providers, and show the "Moved to X · Open" snack.
- **i18n:** new `receiptsMove*` and `expenseMove*` keys plus `shareReviewSavesToChange`, in ar and en. Arabic comes first, and the layout follows RTL.

## Tests (TDD, written first)
- **Server unit** (`move-plan.test.ts`):
  - Category matched by name; matched by preset key across ar and en; falls back to `other`; falls back to none.
  - Client and matter cleared.
  - VAT kept on a firm target; cleared and gross unchanged on a non-firm target.
  - The `changes` list is exact.
- **Server route** (`routes-expenses-move.test.ts`, memory store):
  - Happy path with 0, 1 and 3 receipts: the same id, new keys, old keys removed.
  - Totals move between the profiles.
  - Status codes: 422 same profile; 404 not found or not a member; 402 lapsed source; 402 lapsed target; 403 `NOT_OWNER` on a co-owned source; 403 Malafat; 409 stale version; 409 receipt not READY.
  - The same Idempotency-Key twice gives one move and one pair of audit rows.
  - A failed copy leaves the source untouched; a refused transaction removes only this move's copies; a failed post-commit delete still answers 200.
  - Group overrides are dropped.
  - The preview equals the applied changes.
- **Prisma store contract:** `store-prisma-expense-move.test.ts` (`test:db`).
- **Portal:** `MoveToProfileDrawer.test.tsx` (changes list, one profile → no Move), the expense hooks invalidate both profiles, and the ExpenseDrawer shows or hides Move.
- **Phone:**
  - `share_review_run_test` covers retarget and pending.
  - `last_share_profile_store_test` covers per-user storage, clearing on sign-out, and ignoring a stale profile.
  - `expense_mover_test` and `move_expense_sheet_test`.
  - The `shared_receipt_review_screen_test` cases: tap → choose → saves there; an early tap moves on arrival.
- **Commands:**
  - Root: `npm run lint && npm run typecheck && npm run test:run && npm run build` (Node 22, through `heavy`).
  - Server: `npm --prefix server run typecheck|lint|openapi:check|test`.
  - Flutter: `flutter analyze`, `flutter test --concurrency=2`.

## Release-QA (scenarios)
- **portal** `expenses.yaml`:
  - `move-expense`: Open an expense, choose Move, choose Personal, and see the changes. Confirm → it's gone here and on Personal, and the totals update.
  - `move-expense-refused`: a lapsed or read-only target is disabled, with a reason.
- **portal** `receipts.yaml`: `move-filed`, from a filed card's ⋯.
- **ios** `share.yaml`:
  - `share-choose-profile`
  - `share-run-two-profiles` (1 of 2 goes to a different profile)
  - `share-default-remembered` (a cold start keeps the choice)
- **ios** `receipts.yaml`: `move-filed`. **ios** `recent`: `move-expense`.
- **Android:** the ticket asks for android flows, but `qa/features/android` doesn't exist in the Flutter repo. Record the Android share flow on the QA emulator under the existing ios ids, or file the gap. Flagged below.

## Not in scope
Bulk move, moving income or other records, a picker before the upload, the move in signed-out local mode.

## Cost, scale and risk
- Two calls per move (preview, then move).
- At most 10 GCS rewrites inside the bucket, never through the API.
- Queries are indexed by `(organizationId, …)`. No migration: no new columns.
- **Risk:** MUT-537 (In Review) edits the same phone receipt viewer and review sheet. Build after it merges, or rebase on it.

## Eng review (self-run; /plan-eng-review was unavailable in this session) — folded in
- **R1 Receipt attached mid-move.** `POST /receipts/{id}/file` can add a receipt after the copies are made. In the transaction, re-read the expense's receipts under lock; if the set differs from the copied set, abort with 409 `VERSION_CONFLICT` and remove the copies. The client reloads the preview.
- **R2 Preview drift.** The target's categories or vendors can change between preview and move. The move recomputes the plan inside the transaction and answers the **applied** `changes`; the toast or snack is built from those.
- **R3 Vendor created on the target before the transaction.** If the transaction fails, the vendor can be left behind with no expense. That is acceptable: approve already does this. Note it in TECH_DEBT.
- **R4 Deleted expense** (`deletedAt`): 404. A receipt in PENDING_UPLOAD under the expense can't happen (filing needs READY), but it is guarded anyway (409).
- **R5 Malafat writer for expenses.** At build, confirm how a Malafat-written expense or profile is detected (`writerOfRecord`, `captureSource`); mirror the settle route's rule.
- **R6 Share edge cases:**
  - Discarding an item with a pending choice cancels the move.
  - A pending choice when the account changes is cleared with the run.
  - A move that lands after the person has left the screen still runs `retarget` through the provider, which is not widget-bound.
- **R7 Phone caches.** The Recent list caches by profile; invalidate both profiles' Recent and summary providers.
- **R8 Totals.** The server derives them, so there's no stored total to fix. Portal invalidation covers summaries, Reports Glance (cross-profile) and client books.
