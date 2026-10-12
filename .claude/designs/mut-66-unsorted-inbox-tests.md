# MUT-66 — unsorted inbox (test plan)

Companion to `mut-66-unsorted-inbox.md`. Written before implementation, mirroring the `mut-65-personal-profile-income-tests.md` / `mut-42-hosted-expenses-tests.md` pairing convention. Paths are under `server/`. Test pyramid target per `CLAUDE.md`: unit 70% / integration 20% / e2e 10%.

## Acceptance-criteria → test map

| # | Acceptance criterion | Covered by |
|---|---|---|
| 1 | A device session can create, list, edit and delete its own unsorted entries; another user can never see them | §1 store contract, §4 route tests (cross-user cases) |
| 2 | Filing as an expense onto any profile the user belongs to creates the expense and removes the inbox entry in one transaction | §2 store contract (atomicity), §4 route tests, §6 mutation checks |
| 3 | Filing as income onto a personal profile follows MUT-65 (Owed requires a client); onto a Malafat-linked profile it is refused with `READ_ONLY_PROFILE` and the entry stays | §4 route tests, §6 mutation checks |
| 4 | Replaying a file request with the same `Idempotency-Key` does not create a second record | §4 route tests (idempotency cases) |
| 5 | Unsorted entries never change any `/v1/summaries/*` result | §5 integration |
| 6 | Removing a user's last membership does not delete their inbox; the operator can see an inbox count per user for support | §1 store contract, §4 route tests, §7 admin |

## 1. Store contract: `src/repositories/__tests__/store-contract-inbox.ts` (memory + Postgres)

- **Create** and read back with every field, including `captureSource` present and absent (absent round-trips as `null`, not `undefined`).
- **Organization-independence, structurally:** the repository's methods take `userId`, never `organizationId` — a type-level assertion (no method on `InboxEntryRepository` accepts an `organizationId` parameter) backs the "cannot leak across users by construction" claim, mirroring how the ledger's organization-scoped methods are asserted to take `organizationId`.
- **Listing:**
  - newest first by `(createdAt, id)`, with no gaps or repeats across pages, including several entries created in the same millisecond;
  - another user's entries never appear, regardless of page size or cursor.
- **`update`:**
  - bumps the version;
  - refuses a stale version with no side effects;
  - `not_found` for a deleted entry, an unknown id, or another user's id (not distinguished);
  - `kind` is not a patchable field (not present on `UpdateInboxEntryPatch`'s type at all — a compile-time guarantee, not a runtime check).
- **`delete`:** hard delete; returns `true` for a live entry of this user, `false` for an unknown id, another user's id, or an already-deleted one (all indistinguishable).
- **`countByUser`:** 0 for a user with none; increments on create, decrements on delete and on successful filing; unaffected by another user's entries.
- **Survives membership removal (AC 6), proven, not assumed:** create a user, a membership, an inbox entry; revoke the membership (even the user's last one); `countByUser` and `list` are unchanged. Assert via the schema itself, not just a repository call: `InboxEntry` has no foreign key to `Organization` or `Membership` (a reflection/introspection test over the Prisma DMMF, so a future edit that accidentally adds one fails this test immediately rather than being discovered by a support ticket).
- **`fileAsExpense` (atomicity):**
  - success: the expense exists with every field from the compose input, and `getById(userId, entryId)` is now null, in that order of observation (both effects happened, from one call);
  - unknown/foreign/already-filed entry id → `{ kind: 'not_found' }`; **no expense is created** (assert via a count, not just the return value);
  - concurrent double-call with the same entry id → exactly one succeeds with `'filed'`, the other gets `'not_found'` (the transaction's row lock / delete-affects-zero-rows path, not a race that creates two expenses).
- **`fileAsIncome` (atomicity):** the same three cases, for both `received` and `owed`, against MUT-65's planned `Payment`/`Receivable`-adjustment creation.
- **Failure mid-transaction leaves the entry untouched:** simulate the financial-row insert throwing (e.g. a unique-constraint violation engineered in a test harness) — the inbox entry is still present and unchanged afterward. This is the literal "on failure it stays untouched" AC, proven at the repository layer where the transaction boundary actually lives, not only inferred from the route-level validation-before-write ordering.

## 2. Unit: `src/inbox/__tests__/compose.test.ts` (new, pure — mirrors `expenses/compose.ts`'s test shape)

- Amount `0` or negative → `AMOUNT_INVALID` (reuses the existing reason, not a new one).
- `occurredOn` malformed → `DATE_INVALID` (reused).
- `occurredOn` in the future → **accepted** at capture time (explicit regression guard for the §3.1/§7.1 decision: capture never rejects a future date, only filing does — a test that asserts this stays true even if someone "fixes" it by reflex later).
- `captureSource` absent → stored as `null`, not required.
- `ENTRY_KIND_MISMATCH`: filing-as-income called against an `EXPENSE`-kind entry (and the mirror case) → the conflict, before any store call (asserted via a spy: zero calls to `store.inboxEntries.fileAsIncome`/`fileAsExpense`).

## 3. Unit: `src/auth/__tests__/store-guard.test.ts` (extended)

- `storeRefusal('session', null, 'sessionOnly')` → `null`; `storeRefusal('apiKey', null, 'sessionOnly')` → `PRINCIPAL_NOT_ACCEPTED`. This is the one new case in `MethodAccess`; both branches are exercised explicitly, not just through a route test, since it's a new primitive the guard didn't have before this ticket.
- `inboxEntries.create/getById/list/update/delete` are classified `'sessionOnly'`; `countByUser` is classified `'operator'`; `fileAsExpense`/`fileAsIncome` are classified `{ write: 'expenses' }`/`{ write: 'payments' }` — read directly off `STORE_ACCESS`, so a reclassification is caught here before it's caught by a route test failing for an unrelated-looking reason.
- `storeRefusal('apiKey', null, { write: 'expenses' })` under `inboxEntries.fileAsExpense`'s classification → the same refusal an API key already gets on `expenses.create` (cross-reference, not a new behavior) — asserted as `PRINCIPAL_NOT_ACCEPTED`, since `expenses`'s API-key column is `none`, not a `READ_ONLY_PROFILE` case.
- `storeRefusal('session', 'MALAFAT', { write: 'payments' })` under `inboxEntries.fileAsIncome`'s classification → `READ_ONLY_PROFILE { domain: 'payments', writerOfRecord: 'MALAFAT' }`, exactly MUT-65's own assertion for `payments.create`/`receivables.createAdjustment`, now re-asserted for the inbox's own method key. This is the test that proves §4.6's claim that no inbox-specific writability logic was needed — if this assertion required anything beyond reading `STORE_ACCESS`, the claim would be false.
- **No new `Domain` was added:** `Domain` (from `writability.ts`) still has exactly the ten entries the MUT-65 plan leaves it with — a literal count assertion, so an implementer reaching for "just add an `inbox` domain" because it's the familiar move fails a test immediately, per §4.5's design reasoning.

## 4. Route tests: `src/__tests__/inbox-routes.test.ts` (new) + `src/__tests__/inbox-filing.test.ts` (new)

Setup, mirroring `income-routes.test.ts` (MUT-65's planned fixture): organization **P** (personal, no integration), organization **M** (Malafat, `CONNECTED` integration), one user with memberships in both, a second user with no shared organization.

**Plain CRUD (`GET/POST /v1/inbox`, `PATCH/DELETE /v1/inbox/{id}`):**
- Create with every optional field present, then absent → `201`/`200` with correct nulls.
- No `X-Mutaba3a-Profile` header sent, and the request still succeeds — the literal proof these routes are organization-independent (a header, if sent, is simply ignored — asserted explicitly, since silently *requiring* it by accident would be a regression invisible to every other test here).
- List: cursor pagination round-trips; a malformed/foreign cursor → `422`, field `cursor`.
- A second user's `GET /v1/inbox` never includes the first user's entries, regardless of how many pages are walked.
- `GET`/`PATCH`/`DELETE` on another user's entry id → `404` (never `403` — the house non-leaking convention, reused).
- `PATCH` with a stale `If-Match` → `409 VERSION_MISMATCH`.
- `DELETE` on a live entry → `204`; a second `DELETE` on the same id → `404` (hard delete, not the soft-delete "204 again" convention `Expense` uses — a deliberate difference, asserted explicitly so it isn't mistaken for a bug against the Expense precedent).
- **No scope required:** a session with a membership in neither P nor M (no organizations at all) can still create/list/edit/delete its own inbox entries — proof the routes need nothing more than a valid session.

**`POST /v1/inbox/{id}/file-as-expense`, on P and M (both, since expenses is profile-independent):**
- An `INCOME`-kind entry's amount/currency/`occurredOn`/note land unchanged on the created `Expense`; the inbox entry is gone (`GET /v1/inbox` no longer lists it; a direct `GET /v1/inbox/{id}}`-shaped lookup — if one exists — or a second file attempt on the same id both answer `404`).

  *(Note: there is no `GET /v1/inbox/{id}` single-entry route in this design — §5 of the brief lists only list/create/edit/delete/file; "gone" is asserted via the list and via a second file/delete attempt both 404ing.)*
- `categoryId`/`customerId`/`projectId` validated exactly as `POST /v1/expenses` already validates them (`CATEGORY_NOT_FOUND`, `CATEGORY_ARCHIVED`, `CUSTOMER_NOT_FOUND`, `PROJECT_NOT_FOUND`, `PROJECT_CUSTOMER_MISMATCH`) — a table-driven test asserts byte-identical error shape between `POST /v1/expenses` and this route for each reason, proving reuse rather than reimplementation.
- An `EXPENSE`-kind entry filed via `file-as-expense` with a destination the user has no membership in → `404` (not a member — same convention as any cross-organization id).
- An `INCOME`-kind entry filed via `file-as-expense` → `409 ENTRY_KIND_MISMATCH`; the entry is untouched (still listed afterward).
- Missing `Idempotency-Key` → `422` (existing middleware behavior, asserted for this new route).
- Replaying the same key + same body → the identical `201` response, **no second expense row**, entry stays gone (not re-created) — asserted via a direct count, the load-bearing half of AC 4.
- Replaying the same key with a different body (e.g. a different `categoryId`) → `409 IDEMPOTENCY_KEY_REUSED`.
- `captureSource` on the original inbox entry threads into the created expense's audit metadata (`expense.created`), exactly the optional-metadata convention MUT-42/65 already use.

**`POST /v1/inbox/{id}/file-as-income`, on P and M:**
- On **P** (personal): `received` with no client → `201`, `Payment.customerId === null`; `owed` with a client → `201`, `Receivable.origin === 'ADJUSTMENT'`; `owed` with no client → `422 VALIDATION_FAILED`, field `customerId`, reason `CUSTOMER_REQUIRED_FOR_OWED` — **byte-identical** error shape to MUT-65's own `POST /v1/income` test for the same case (table-driven comparison, not just "a 422 happens").
- On **M** (Malafat-fed): every one of the above positive cases → `403 READ_ONLY_PROFILE { domain: 'payments', writerOfRecord: 'MALAFAT' }`; **the inbox entry is still listed afterward** (the literal "entry stays" half of AC 3) and a spy on the base store asserts zero calls to `payments.create`/`receivables.createAdjustment` — the refusal happens before the transaction, not as a rollback of one that started.
- `EXPENSE`-kind entry filed via `file-as-income` → `409 ENTRY_KIND_MISMATCH`, on both P and M.
- Idempotency: same two cases as `file-as-expense` (replay returns identical result and creates nothing new; mismatched body → `409`).
- `captureSource` threads into `income.received`/`income.owed`'s audit metadata.

## 5. Integration: `/v1/summaries/*` is unaffected (AC 5)

- Snapshot `GET /v1/summaries/organization` and `GET /v1/summaries/expenses` on organization P with some existing expenses/income.
- Create 50 inbox entries for a user with membership on P (mixed kinds, mixed currencies, some amounts far larger than anything in the existing summary).
- Re-fetch both summaries → **byte-identical** to the snapshot (not just "same totals" — the whole response body, so a stray extra currency block or count would fail this too).
- File one of the 50 entries as an expense on P → now exactly the filed amount's currency block changes, by exactly the filed amount; every other block is unchanged from the snapshot.
- A literal source-level check (not just behavioral): `grep` (or an AST check) over `summaries.ts` and `expenses/summary.ts` finds no reference to `inboxEntries`/`InboxEntry`/`inbox_entries` at all — the AC is true because the summary code structurally cannot see the table, not because every call happens to return the right number today.

## 6. Mutation checks (run once during implementation, then reverted — proves each guard is load-bearing)

- Remove the destination-side validation step before `fileAsIncome`/`fileAsExpense` is called (i.e., call the repository method first and validate after) → the "entry stays untouched on failure" cases in §4 wrongly delete the entry even when the write should have been refused. Shows the validate-before-transact ordering (§4.3) is load-bearing, not incidental.
- Revert `inboxEntries.fileAsIncome`'s classification from `{ write: 'payments' }` to `'sessionOnly'` → the Malafat-fed `READ_ONLY_PROFILE` cases in §4 wrongly succeed. Shows §4.6's "no inbox-specific writability logic needed" claim depends on this classification being exactly `{ write: 'payments' }`, not a weaker one.
- Remove the `WHERE userId = ?` guard from `delete`/`fileAsExpense`/`fileAsIncome`'s row match → the "another user's entry" cases in §4 wrongly succeed instead of `404`/`not_found`. Shows per-user scoping is enforced at the data-access point, not only validated by the route reading the wrong `userId` (which would pass this test vacuously).
- Remove the `'sessionOnly'` case entirely (fall back to treating unclassified as an error, per the guard's existing exhaustiveness requirement) → the whole suite fails to compile/run until `inboxEntries`' five session-only methods are classified, proving the compiler-exhaustive map (ADR-037 decision 7) actually forces this, not just documents it.

## 7. Admin: `src/__tests__/routes-admin-users.test.ts` (extended)

- `GET /admin/v1/users/{userId}` includes `inboxEntryCount`, matching `countByUser` exactly, for a user with 0, 1 and many entries.
- Filing or deleting an entry changes the count on the next admin lookup (no caching).
- The count is unaffected by another user's inbox size.

## 8. Contract and gates

- `ERROR_CODES`/`VALIDATION_REASONS`/`CONFLICT_REASONS` gain exactly one new reason, `ENTRY_KIND_MISMATCH`; every other error shape is reused verbatim from MUT-42/65 (asserted by the table-driven comparisons in §4).
- `openapi.yaml` regenerated; `npm run openapi:check` passes; API version bump (`1.13.0-mut66`).
- `route-security.test.ts`'s fixed session-operation count grows by six (four CRUD + two file routes).
- Malafat's vendored contract: confirm no operation, scope or schema it uses changes — the inbox routes are entirely session-only and new, so no existing key-reachable operation's shape moves; asserted explicitly rather than assumed, per the house convention MUT-42/65 both followed for their own contract checks.
- Full gates: lint, typecheck, `npm test`, `npm run test:db` (the migration applied from empty, and from a copy of the pre-MUT-66 schema with existing users/organizations — every existing row is untouched, since the migration adds one table and one relation, nothing else), `openapi:check`, `build`.

## 9. Not covered here (explicitly deferred, per the ticket's own scope and the design doc §7)

- A portal UI for the inbox (ticket's own "Scope (out)").
- Receipts on unsorted entries (ticket's own "Scope (out)": "they attach after filing").
- MUT-68's keypad capture screen and MUT-69's recent-entries/undo UI — this plan tests the API primitives those tickets will consume (`POST /v1/inbox`, the two file routes), not their own features.
- The cross-repository `tx`-parameter split on MUT-65's `PaymentRepository.create`/`ReceivableRepository.createAdjustment` is tested here only through `fileAsIncome`'s own atomicity cases (§1); MUT-65's own test plan owns the correctness of what those methods create, not this one.
