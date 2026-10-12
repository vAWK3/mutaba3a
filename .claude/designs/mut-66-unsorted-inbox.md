# MUT-66 — Unsorted inbox: save an entry with no profile, file it later (design brief)

**Status:** planning (`/eng-ticket`, 2026-10-12). **Epic:** MUT-63 (Mutaba3a Capture). **Builds on:** `.claude/designs/mut-65-personal-profile-income.md` (the `POST /v1/income` contract, as planned — not yet built), `.claude/designs/mut-42-hosted-expenses.md` (the landed `POST /v1/expenses` contract), `hosted-portal.md` §5 (writability matrix), ADR-037. **Blocks (outward):** MUT-68 (keypad capture needs an "unsorted" target to save to), MUT-69 (recent-entries/undo needs an inbox to file from). **Branch:** not yet created (planning only).

## 0. Tracker / status summary

Jira, `barmajiyat.atlassian.net` (cloudId `0d7aa5cf-389d-46d9-b734-1a96f4966c18`), project MUT. **MUT-66 is `To Do`.** Fetched directly (`getJiraIssue`, issue id 11177, comments included): zero comments on the ticket itself. This document does not transition the ticket and writes no code.

## 1. Related tickets and blocker gate

- **Epic:** MUT-63, "Mutaba3a Capture: log income and expenses from your iPhone in seconds."
- **Outward links, confirmed live on Jira (not just ticket prose):** `blocks MUT-68` ("Keypad-first capture with targets, presets and an offline outbox", To Do) and `blocks MUT-69` ("Recent entries on the phone: see what landed, fix it, undo it, file it", To Do). The ticket text's own "Links" section matches the actual issue links exactly — no drift between prose and graph.
- **Inward links: none.** MUT-66 carries no `is blocked by` link, and no blocker is named in its description prose. **Nothing on Jira blocks planning or building this ticket.**
- **Same-session planning dependency (not a Jira link): MUT-65.** MUT-66's own description names it directly — "income with Received/Owed (MUT-65 rules)". MUT-65 was planned in this same session; its design doc and test plan are on disk at `.claude/designs/mut-65-personal-profile-income.md`/`-tests.md`, status "planning", **not yet implemented**. Treating that doc as MUT-65's settled contract (per instructions — "don't second-guess it"):
  - **Settled enough to build against:** the `POST /v1/income` request/response shape (§4.1 there), the `kind: 'received'|'owed'` vocabulary, the `CUSTOMER_REQUIRED_FOR_OWED` rule, the `sessionScopesFor(profileWriter)` / `mayWriteFor` per-profile writability refactor, and the locked-in `POST /v1/receivables/{id}/settle` mark-settled write (Jira comment 11000 resolution, already folded into the doc — not re-litigated here).
  - **Open questions MUT-65 itself flagged (§9 there) that MUT-66 inherits, not introduces:** (a) Owed's due-date defaults to `occurredOn` when none is given — the ticket text never asked for a due-date field, so this is an assumption, not an AC, on both tickets now; (b) the hosted portal's read-only copy becomes stale for personal profiles once MUT-65 ships — irrelevant to MUT-66 (server-only, no portal UI in scope here, confirmed by MUT-66's own "out of scope" list).
  - **A finding from this pass, new, not anticipated by either MUT-65 or MUT-42: §4.3 below.** MUT-66's atomicity requirement (one entry → one real record, in one transaction) needs `PaymentRepository.create`, `ReceivableRepository.createAdjustment` (MUT-65, planned, not yet built) and `ExpenseRepository.create` (MUT-42, landed) to be composable inside a caller-supplied transaction, not just able to open their own. Neither doc anticipated this because neither needed cross-repository atomicity on its own. This should be flagged back onto MUT-65 before it's implemented (a tx-parameter is cheap to add at construction time) rather than retrofitted after.
- **Conclusion:** no blocker gate trips. MUT-65's design is settled enough to plan and build MUT-66's filing action against today, with the one forward-dependency above flagged rather than silently assumed.

## 2. The problem, restated precisely

"General" at intake means *unsorted*, not *uncategorized-within-a-profile*: the user knows an amount happened before they've decided which business it belongs to. Every hosted record today — `Customer`, `Project`, `Expense`, and (per MUT-65, planned) `Payment`/`Receivable` — hangs off an `Organization`. There is structurally nowhere to put money that doesn't have one yet. **This is the first user-owned, not organization-owned, resource server-side** — flagged explicitly per the planning brief, because it changes an assumption three other subsystems were built on (see §5).

## 3. Data model

### 3.1 Decision: one new table, owned by `User`, with no `Organization` FK at all

```prisma
enum InboxEntryKind {
  INCOME
  EXPENSE
}

/// A user's own unsorted capture, before it is filed to a profile (MUT-66).
/// Deliberately has no Organization FK: the one user-owned, not
/// organization-owned, row shape in this schema. Hard-deleted on explicit
/// delete and on successful filing — there is no audit value in a tombstone
/// for a pre-ledger scratch note once the real write (with its own audit
/// row) exists.
model InboxEntry {
  id            String         @id @default(uuid()) @db.Uuid
  userId        String         @db.Uuid
  user          User           @relation(fields: [userId], references: [id])
  kind          InboxEntryKind
  amountMinor   BigInt
  currency      String         @db.VarChar(3)
  /// The date as the capturing device understood it. No organization
  /// timezone exists yet to validate "future" against — that check happens
  /// at filing time, against the chosen profile's own timezone (§4.4).
  occurredOn    String         @db.VarChar(10)
  note          String?
  /// Persisted, unlike MUT-65/42's captureSource (which is audit-metadata
  /// only): an inbox entry can sit unfiled for a while, and the UI needs to
  /// keep showing "captured via Siri" across that whole lifetime, not just
  /// at the moment of a write.
  captureSource String?        @db.VarChar(20)
  version       Int            @default(1)
  createdAt     DateTime
  updatedAt     DateTime

  @@index([userId, createdAt(sort: Desc), id(sort: Desc)])
  @@map("inbox_entries")
}
```

`User` gains `inboxEntries InboxEntry[]`, the same shape as its existing `expenses`/`expenseReceipts` relations. One additive migration, `prisma/migrations/<ts>_mut66_inbox/migration.sql`: new table only, nothing existing altered (the MUT-37/MUT-42 precedent for a net-new, non-organization or additive table).

### 3.2 Why a new table, not a reuse — justified against each AC

| AC | How the no-org-FK shape meets it |
|---|---|
| "A device session can create, list, edit and delete its own unsorted entries" | Every repository method is scoped by `userId`, the first parameter, exactly as every existing method is scoped by `organizationId` first. Cross-user reads are impossible by construction (ADR-025 point 2's guarantee, substituting `userId` for `organizationId`) — not a filter added on top. |
| "another user can never see them (test)" | Same as above: there is no query shape that can return another user's rows, because no method accepts anything but the caller's own `userId`. |
| "Removing a user's last membership does not delete their inbox" | **True for free, not by a guard.** `InboxEntry` has no FK to `Organization` or `Membership` at all, so `DELETE /admin/v1/users/{id}/memberships/{organizationId}` cannot cascade into it and there is no join that could orphan it. This is the single strongest argument for the new-table-no-FK shape over any alternative that threads a nullable `organizationId` through an existing table. |
| "the operator can see an inbox count per user for support" | §3.4 below. |
| "Unsorted entries appear in no profile summary, total or report" | No summary query (`summaries.ts`, `expenses/summary.ts`) references `inbox_entries` at all — true by construction, asserted by a literal test (§8 of the test plan) rather than left to be noticed later. |

**Rejected alternative: a nullable `organizationId` on `Expense`/`Payment`/`Receivable`.** This was MUT-65's own move for *nullable client/project* (§2.1 there: loosen existing columns because the Malafat-fed rows never exercise the new null). It does not generalise to *nullable organization*, because the entire request pipeline — `X-Mutaba3a-Profile` resolution, the per-profile writability guard, every list/summary query's `WHERE organizationId = ?` — assumes an organization is always resolved before a repository call happens. Every one of MUT-65's three loosened columns keeps the row inside an organization; this ticket needs a row with no organization to be inside at all. Reusing a ledger table for it would mean teaching every reader of that table to handle a null organization, which is a far larger and riskier change than one small, genuinely additive table.

**Rejected alternative: key the table by `(userId, organizationId?)` with a nullable org.** Rejected for the same reason as above, one level down: it reintroduces exactly the FK that must be absent for the "survives last-membership removal" AC to hold by construction rather than by a cleanup job.

### 3.3 The two "kind" vocabularies do not collide — a point the ticket text leaves implicit

The ticket's inbox `kind: income | expense` is a coarse capture-time choice. MUT-65's `kind: received | owed` is a *finer* distinction that only makes sense once a client (or its absence) is in the picture — and an inbox entry never carries a client (the ticket's own field list: "amount, currency, date, optional note, capture source" — nothing relational). So **the Received/Owed choice, and any `customerId`/`projectId`/`title`/`dueDate`, are supplied at file time, not at capture time.** `InboxEntry.kind: 'INCOME'` only commits to "this becomes a `POST /v1/income` call of some kind," not which one. §4.2 makes this precise in the request shape.

### 3.4 Operator visibility (AC 6)

`GET /admin/v1/users/{userId}` (existing route, `routes/admin-users.ts`, `UserDetailSchema`) gains one additive field: `inboxEntryCount: number`, from a new `InboxEntryRepository.countByUser(userId)` — one indexed `COUNT(*)` on `(userId)`, not a list. No new admin route; this is the smallest change that meets the AC's literal wording ("can see an inbox count per user").

## 4. The "file" action

### 4.1 Two routes, not one — and why

The ticket's own AC phrases filing as two separate things ("Filing as an expense…" / "Filing as income…"), and that phrasing is load-bearing, not incidental: **`requireScope` is a static, per-route declaration (ADR-037 decision 5 — "routes declare accepted principals/scopes in the contract")**, but the scope a file action needs (`expenses:write` vs `payments:write`) depends on the *inbox entry's own* `kind`, which is only known after loading it. A single `POST /v1/inbox/{id}/file` route would need a scope resolved from request/entry content, which the "declared in the contract" discipline this codebase just built (MUT-38/39) exists specifically to avoid. Two routes keep every scope check static:

- `POST /v1/inbox/{entryId}/file-as-expense` — `security: [{ session: [] }]`, `requireScope('expenses:write')`
- `POST /v1/inbox/{entryId}/file-as-income` — `security: [{ session: [] }]`, `requireScope('payments:write')`

Both require `X-Mutaba3a-Profile` (they are organization-scoped — the *destination* is a specific profile, even though the entry being filed is not) and `Idempotency-Key`. Calling the route whose kind doesn't match the entry's own (e.g. `file-as-income` on an `EXPENSE`-kind entry) is `409 CONFLICT { reason: 'ENTRY_KIND_MISMATCH' }` — a defensive check, since a correct client never does this (the entry's kind is always visible in the list it came from).

### 4.2 Request/response shapes

```
POST /v1/inbox/{entryId}/file-as-expense
security: [{ session: [] }]
scope:    expenses:write
headers:  X-Mutaba3a-Profile, Idempotency-Key (both required)
body: {
  categoryId?: string,
  vendor?: string,
  title?: string,
  customerId?: string,
  projectId?: string,
}
```
Amount, currency, `occurredOn` and note come from the inbox entry itself — not re-entered. `customerId`/`projectId`/`categoryId` are validated by MUT-42's own, unmodified `resolveLinks`/`assertCategoryChoosable` (`expenses/compose.ts`), reused verbatim.

```
POST /v1/inbox/{entryId}/file-as-income
security: [{ session: [] }]
scope:    payments:write
headers:  X-Mutaba3a-Profile, Idempotency-Key (both required)
body: {
  kind: 'received' | 'owed',        // MUT-65's vocabulary, chosen here, not at capture
  customerId?: string,              // required when kind === 'owed' (MUT-65's own rule)
  projectId?: string,
  title?: string,                   // 'owed' only
  dueDate?: string,                 // 'owed' only
  method?: 'CASH' | 'BANK',         // 'received' only
}
```
Amount, currency, `occurredOn` and the entry's `note` (→ MUT-65's `notes`, `received` only) again come from the entry. Validation is MUT-65's own pure compose logic (§4.1/§4.2 of `mut-65-personal-profile-income.md`), called exactly as `routes/income.ts` would call it internally — **MUT-66 does not reimplement `CUSTOMER_REQUIRED_FOR_OWED`, `PROJECT_CUSTOMER_MISMATCH`, or the future-date check; it calls the same functions.**

Response, both routes: `201` with the created record's own existing serialization (`ExpenseSchema` / MUT-65's `IncomeResponseSchema`) — nothing inbox-specific in the response body, because once filed the inbox entry is gone and the response is simply "here is the real record."

### 4.3 Atomicity — the one piece of new repository-level machinery

**Requirement (ticket, literal):** "creates the expense and removes the inbox entry in one transaction… On success the inbox entry is gone; on failure it stays untouched." This is a cross-repository transaction — `Expense` (or `Payment`/`Receivable`) and `InboxEntry` are different tables, written by what are today two separate repository objects sharing one `PrismaClient` instance (`server/src/repositories/prisma.ts` is a single file; every repository already calls `this.prisma.$transaction(...)` for its own internal multi-table writes, e.g. the existing private `settleReceivable(tx: Tx, …)` helper, which already takes an **explicit `tx` handle** so it can be composed inside a caller's open transaction — this exact idiom already exists in the codebase for exactly this reason).

**Decision:** add two orchestration methods to a new `InboxEntryRepository`, and refactor the three existing/planned creation paths to accept an optional explicit transaction handle so they can be composed instead of duplicated:

```ts
// ports.ts
export interface InboxEntryRepository {
  create(input: CreateInboxEntryInput, at: Date): Promise<InboxEntryRecord>;
  getById(userId: string, id: string): Promise<InboxEntryRecord | null>;
  list(userId: string, page: { limit: number; cursor: InboxEntryCursor | null }): Promise<InboxEntryPage>;
  update(userId: string, id: string, expectedVersion: number, patch: UpdateInboxEntryPatch, at: Date): Promise<UpdateResult<InboxEntryRecord>>;
  /** Hard delete. false for an id this user never had (never "was it someone else's"). */
  delete(userId: string, id: string): Promise<boolean>;
  countByUser(userId: string): Promise<number>;
  /**
   * Atomic: creates the expense and deletes this entry in one transaction.
   * 'not_found' covers unknown id, not this user's, wrong kind, or already
   * filed/deleted — never distinguished, same non-leaking convention as
   * MUT-65's DELETE /v1/income/{id}.
   */
  fileAsExpense(params: { userId: string; inboxEntryId: string; expense: CreateExpenseInput }, at: Date): Promise<{ kind: 'filed'; expense: ExpenseRecord } | { kind: 'not_found' }>;
  /** Same shape, for the Payment (received) or Receivable-adjustment (owed) write. */
  fileAsIncome(params: { userId: string; inboxEntryId: string; write: IncomeWriteInput }, at: Date): Promise<{ kind: 'filed'; result: IncomeWriteResult } | { kind: 'not_found' }>;
}
```

Implementation shape in `prisma.ts`: extract the row-insert core of `ExpenseRepository.create` into a `createExpenseRow(tx: Tx, input, at)` helper (today's `create` becomes `prisma.$transaction((tx) => createExpenseRow(tx, input, at))`, unchanged behaviour); `InboxEntryRepository.fileAsExpense` opens **one** `$transaction`, calls `createExpenseRow(tx, …)`, then deletes the inbox-entry row inside the same `tx`, guarded by `WHERE userId = ? AND id = ?` (zero rows affected ⇒ roll back ⇒ `'not_found'`). The identical shape applies to `fileAsIncome` against MUT-65's planned `PaymentRepository.create` / `ReceivableRepository.createAdjustment`, once those exist with the same tx-parameter split. **No business rule is duplicated** — `createExpenseRow`/the income-write helpers are the exact same code the standalone `POST /v1/expenses` and (planned) `POST /v1/income` routes already run; only the transaction boundary moves outward to also cover the entry's deletion.

In `memory.ts` (in-process `MemoryLedgerStore`, used by route/unit tests), atomicity is simulated the same way the existing in-memory implementations already do for their own multi-step writes: every check (entry exists, owned, right kind, destination validation already done by the route before this call) runs to completion before any map is mutated, and the two mutations (insert financial record, delete entry) happen with no `await` between them.

**All destination-side validation (writability, `CUSTOMER_REQUIRED_FOR_OWED`, link resolution, category/project/customer existence, future-date) happens *before* `fileAsExpense`/`fileAsIncome` is ever called** — in the route handler, using the same pure/async validators the standalone create routes use. This guarantees "on failure it stays untouched" structurally: a validation failure never reaches the repository method that would touch the entry at all, and `READ_ONLY_PROFILE`/`INSUFFICIENT_SCOPE` refusals happen in middleware, before the handler even runs.

### 4.4 Idempotency — reused unmodified

Both file routes declare `Idempotency-Key` required and are wrapped with the existing `idempotent(store, 'inbox.fileAsExpense' | 'inbox.fileAsIncome')` middleware, **exactly as built, with zero new code**, because both routes are organization-scoped (`X-Mutaba3a-Profile` resolves `auth.organization`), so the existing `idempotency_keys` table (keyed `(organizationId, key)`) and the existing session-namespacing (`s:` + SHA-256(user id, key), MUT-42 D4) apply unmodified. A replay with the same key returns the persisted response and never re-invokes the handler, so it can never re-read an already-filed (already-deleted) entry — idempotent by the same mechanism MUT-65 designed for `POST /v1/income`, not a new one.

The plain inbox CRUD routes (create/edit/delete) are **not** given an `Idempotency-Key` requirement. They are not organization-scoped (§4.5), so they have no `auth.organization` for the existing idempotency table's key to live under, and extending that table to a second scoping key (`userId`) for a feature whose own AC never asks for create-idempotency would be infrastructure built for a requirement that doesn't exist. This mirrors existing precedent: `POST /v1/sessions` (sign-in) and the `/admin/v1/users*` routes are also non-organization-scoped POSTs with no `Idempotency-Key` requirement. Flagged explicitly as a deliberate, scoped departure from ADR-025 decision 5's "every state-changing POST requires Idempotency-Key" — that rule was written for the organization-scoped ledger; nothing in MUT-66's AC asks for it on capture, only on filing (§4.4 covers filing).

### 4.5 Plain CRUD routes — organization-independent, following `/v1/me`'s own shape

`GET /v1/inbox`, `POST /v1/inbox`, `PATCH /v1/inbox/{id}`, `DELETE /v1/inbox/{id}` carry no `X-Mutaba3a-Profile` and read `c.get('identity')` (user + session), exactly as `GET /v1/me` and `DELETE /v1/sessions/current` already do (`routes/sessions.ts`). They join `ORGANIZATION_INDEPENDENT_ROUTES` (`sessions.ts:30`) alongside those two. **Confirmed by reading `sessions.ts` directly, not assumed:** `GET /v1/me` declares `security: [{ session: [] }]` and calls **no** `requireScope` at all — there is no scope check for an identity-shaped, non-organization route today. Inbox CRUD follows the identical shape: a valid session is sufficient; no new scope is minted for "inbox," and the existing writability matrix (which is fundamentally a *per-organization, per-profile* table) is not extended with a domain that has nothing to do with any organization. This avoids a worse alternative — adding `inbox` as a `Domain` would mean `GET /v1/me`'s `access: Record<Domain, Access>` map, which is emitted *per hosted profile*, would carry a redundant, identical `inbox` entry on every profile a user has, for a resource that isn't profile-scoped at all.

### 4.6 Store guard — one new, narrow `MethodAccess` case

`store-guard.ts`'s `MethodAccess` union (`'read' | 'control' | 'operator' | { read: Domain } | { write: Domain }`) has no case for "any session may call this; no other principal may; no per-organization domain applies." `'control'` is the closest but wrong: its contract is "any principal," which would let an API key call `inboxEntries.create` — wrong, since inbox is a device-session concept the ticket explicitly scopes to a signed-in person. This is the one place the new ownership shape (§2) requires a genuinely new primitive, not just a new row in an existing table:

```ts
export type MethodAccess = 'read' | 'control' | 'operator' | 'sessionOnly' | { read: Domain } | { write: Domain };
// storeRefusal gains: if (access === 'sessionOnly') return principal === 'session' ? null : principalNotAccepted();
```

```ts
// STORE_ACCESS
inboxEntries: {
  create: 'sessionOnly', getById: 'sessionOnly', list: 'sessionOnly', update: 'sessionOnly', delete: 'sessionOnly',
  countByUser: 'operator',          // only /admin's per-user support lookup calls this
  fileAsExpense: { write: 'expenses' },
  fileAsIncome: { write: 'payments' },
},
```

`fileAsExpense`/`fileAsIncome` keep the **existing** `{ write: Domain }` shape, not `'sessionOnly'` — deliberately, because they write into organization-scoped ledger domains and must be refused exactly where a direct create already would be. This is what makes both of the ticket's writability ACs true *for free*, with no inbox-specific logic:
- `expenses` is profile-independent in the matrix (`session: 'read-write'` regardless of writer of record) → filing-as-expense succeeds "onto any profile the user belongs to" (AC, verbatim) — because `expenses` already behaves that way for every other expense write.
- `payments` is one of MUT-65's three `PROFILE_DEPENDENT_DOMAINS` → filing-as-income is granted only when `profileWriter === null` (personal profile) and refused `READ_ONLY_PROFILE` on a Malafat-fed one (AC, verbatim) — because MUT-65's planned `mayWriteFor` already encodes exactly that rule for `payments`, and `fileAsIncome`'s classification routes through the identical check.

No new scope is minted (`expenses:write`/`payments:write` already exist); the closed scope vocabulary (ADR-025 point 3) is untouched.

## 5. Where the code lives

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | + `InboxEntryKind` enum, + `InboxEntry` model, + `User.inboxEntries` relation (§3.1) |
| `server/prisma/migrations/<ts>_mut66_inbox/migration.sql` | New table only; additive |
| `server/src/repositories/ports.ts` | + `InboxEntryRecord`, `CreateInboxEntryInput`, `UpdateInboxEntryPatch`, `InboxEntryCursor`, `InboxEntryPage`, `InboxEntryRepository`; `LedgerStore.inboxEntries` |
| `server/src/repositories/prisma.ts` | `InboxEntryRepository` implementation; extract `createExpenseRow(tx, …)` from `ExpenseRepository.create`; depends on MUT-65 landing (or being amended) to expose tx-parameterized `Payment`/`Receivable`-adjustment creation (§4.3) |
| `server/src/repositories/memory.ts` | `InboxEntryRepository` implementation (simulated atomicity, §4.3) |
| `server/src/inbox/compose.ts` (new) | Pure validation: amount > 0, known currency, `occurredOn` is a valid ISO date (no future-date rejection at capture — §3.1 note); `ENTRY_KIND_MISMATCH` check |
| `server/src/inbox/cursor.ts` (new) | Keyset cursor, mirrors `expenses/cursor.ts` exactly (`(createdAt, id)` instead of `(occurredOn, id)`) |
| `server/src/routes/inbox.ts` (new) | `GET/POST /v1/inbox`, `PATCH/DELETE /v1/inbox/{id}`, `POST /v1/inbox/{id}/file-as-expense`, `POST /v1/inbox/{id}/file-as-income` |
| `server/src/routes/sessions.ts` | `ORGANIZATION_INDEPENDENT_ROUTES` gains the four plain CRUD operation keys |
| `server/src/routes/admin-users.ts` | `GET /admin/v1/users/{userId}` response gains `inboxEntryCount` (§3.4) |
| `server/src/auth/store-guard.ts` | + `'sessionOnly'` `MethodAccess` case; + `inboxEntries` classification (§4.6) |
| `server/src/schemas.ts` | `InboxEntrySchema`, `CreateInboxEntryRequestSchema`, `UpdateInboxEntryRequestSchema`, `InboxEntryPageSchema`, `FileAsExpenseRequestSchema`, `FileAsIncomeRequestSchema`; `UserDetailSchema` gains `inboxEntryCount`; `ENTRY_KIND_MISMATCH` joins `CONFLICT_REASONS` |
| `server/src/serializers.ts` | `serializeInboxEntry(...)` |
| `server/src/app.ts` | Mount `inboxRoutes(store)` the same way every other domain router is mounted |
| `server/openapi/openapi.yaml` | Regenerated (`npm run openapi:check`); minor version bump, `1.13.0-mut66` (after MUT-65's presumed `1.12.0-mut65`) |

No change to `src/` (the local/offline app) or `src/hosted/**` (the portal) — the ticket's own "out of scope" list excludes a portal UI, and the consumer is the phone capture app (MUT-68/69), calling `/v1` directly, exactly as MUT-65 is scoped.

## 6. Quality-bar pass

**DRY / reuse.** Reused unmodified: `idempotent()` and its session-namespacing (MUT-42 D4); `expenses/compose.ts`'s `resolveLinks`/`assertCategoryChoosable`/`parseExpenseAmount`; MUT-65's planned pure income-compose validators; the `ORGANIZATION_INDEPENDENT_ROUTES` precedent and `/v1/me`'s no-scope shape; the keyset-cursor pattern (`pagination.ts`/`expenses/cursor.ts`); the `STORE_ACCESS` exhaustive-map discipline (extended with one case, not replaced); the existing `tx`-handle idiom (`settleReceivable(tx, …)`) for cross-write atomicity. New, and justified as new: `InboxEntryRepository` (the first user-owned, non-organization-scoped repository — a genuinely new ownership shape, not a variant of an existing one); the `'sessionOnly'` `MethodAccess` case (the first guard case that is neither "any principal" nor "a per-organization domain"); the tx-parameter split on `ExpenseRepository.create` (and, once built, MUT-65's `PaymentRepository.create`/`ReceivableRepository.createAdjustment`) — needed only so the *same* creation logic can be composed into a larger transaction, not duplicated.

**Testability.** Every new validation is a pure function (`inbox/compose.ts`), testable with no store. `fileAsExpense`/`fileAsIncome` are thin orchestration over already-tested (or, for the income side, already-planned-and-tested) creation logic — a contract test on both `MemoryLedgerStore` and Prisma proves the transaction boundary itself (MUT-66's own job) without re-testing Expense/Payment/Receivable creation rules (MUT-42's/MUT-65's job).

**Scalability.** `GET /v1/inbox` is cursor-paginated by `(createdAt desc, id desc)`, never "load everything" — the planning brief explicitly asks what thousands of entries per user does to this, and the answer is: the same keyset discipline every other list in this API already uses, with the same default/limit convention (`pagination.ts`). `countByUser` is one indexed `COUNT(*)`, not a list, for the operator's per-user figure (AC 6) — this matters precisely because TD-044 already recorded the cost of "load the whole collection" as a named mistake elsewhere in this codebase (the portal's Clients view); the same mistake is avoidable here from the start rather than fixed later.

**Cost.** One new table, zero new infrastructure, zero new bucket or secret. The two file routes add one more repository-level `$transaction` call each — the same per-request cost shape as every existing create route.

**Constraints respected:** ADR-004 (original currency preserved; an inbox entry is never converted, and neither is the record it becomes); ADR-025 point 2's "cross-organization reads impossible by construction" generalises cleanly to "cross-user reads impossible by construction" for this one user-scoped table; ADR-037 decision 5 (routes declare `security`; the two file routes declare real scopes, the four CRUD routes follow `/v1/me`'s already-established no-scope shape rather than inventing a new carve-out); the closed, non-hierarchical scope vocabulary gains nothing (no `inbox:*` scope exists or is needed).

## 7. Gaps found, flagged for the ticket (not silently decided)

1. **No future-date validation on inbox-entry capture** (§3.1). There is no organization timezone to validate against before a profile is chosen. Deferred entirely to file time, where MUT-65/42's existing future-date checks apply against the destination organization's own timezone. The ticket's AC never mentions this; flagging rather than silently picking a UTC-based stand-in, which ADR-022's whole history (MUT-17) is a record of getting wrong by accident.
2. **The cross-repository transaction dependency on MUT-65 (§4.3)** is new information for MUT-65, not something its own doc anticipated (it was planned before MUT-66, with no cross-repo composition need of its own). Recommend folding the tx-parameter split into MUT-65's implementation from the start rather than patching it in afterward.
3. **Inbox-entry `edit` scope is left intentionally narrow** — this doc allows editing amount/currency/date/note/captureSource (everything capturable), matching "edit… its own unsorted entries" (AC, verbatim), but not `kind` (income vs expense), which is fixed after create, the same convention MUT-42 uses for `Expense.currency`. Not stated as fixed in the ticket text; flagged as an assumption carried over from the nearest precedent rather than invented fresh.

## 8. Business / product impact

MUT-63 (Mutaba3a Capture) is built on "log it in seconds" — the one thing that breaks that promise fastest is a capture flow that stops to ask "which business is this for?" before it will save anything. This ticket removes that stall: "General" becomes a real, durable place to put money the instant it happens, with filing — the only point where a profile's rules (MUT-65's Received/Owed, MUT-42's expense links) actually apply — deferred to whenever the user is ready. It is a direct, named blocker of MUT-68 (the keypad needs an unsorted target to exist before it can offer one) and MUT-69 (recent-entries/undo needs an inbox to file *from*), so neither can ship without this landing first.
