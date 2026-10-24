# MUT-397 — Receipt cap race: MUT-44 completion counts under the expense lock

Epic MUT-252. Server only. No migration, no API change: same routes, same
answers. It must land before `RECEIPTS_LIBRARY` is switched on together with
MUT-257/260's "attach to an existing expense".

Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned →
In Progress → In Review.

## Today

- MUT-389 `fileOntoExpense` (`prisma.ts:1774`) works in one transaction:
  `lockToReviewReceipt`, then the expense `FOR NO KEY UPDATE` (live), then a
  READY count against `maxReceipts`, then `markReceiptFiled`.
- The MUT-44 complete route (`routes/expenses.ts:303`) runs these steps with
  no lock between them:
  `mustGetReceipt` → READY? idempotent → `verifyUploadedObject` →
  `assertRoomForReceipt` (counts with `listByExpense`) →
  `store.expenseReceipts.complete`.
  - Two completions, or a completion and a filing, can both pass the count at
    9 and end at 11.

## Design

### Store: `expenseReceipts.completeOnExpense`

`ports.ts`, next to `fileOntoExpense`:

```ts
completeOnExpense(params: { organizationId: string; expenseId: string; receiptId: string; maxReceipts: number }, at: Date):
  Promise<
    | { kind: 'completed'; receipt: ExpenseReceiptRecord }
    | { kind: 'already_ready'; receipt: ExpenseReceiptRecord }
    | { kind: 'expense_not_found' }
    | { kind: 'receipt_not_found' }
    | { kind: 'too_many_receipts' }
  >;
```

**Prisma**, in one `$transaction`:
1. Lock the expense: `SELECT "deletedAt" FROM "expenses" WHERE id AND organizationId FOR NO KEY UPDATE` (DECISIONS.md:1961). Missing or deleted means `expense_not_found`.
2. Lock the receipt row, **only if it is on this expense**:
   `SELECT status, "deletedAt" FROM "expense_receipts" WHERE id AND organizationId AND "expenseId" = $expenseId FOR NO KEY UPDATE`.
   - The store then never locks another expense's receipt.
   - No row, or a deleted one, means `receipt_not_found`.
   - READY means `already_ready`, which keeps the route idempotent when two
     completions of one receipt race.
3. Count READY on the expense (as `fileOntoExpense` does). If at the cap,
   answer `too_many_receipts`.
4. `UPDATE … SET status READY, completedAt` and return the row.

Lock order and deadlocks. **The rule** (written into ADR-167 and as code
comments):
- For receipts that sit on an expense (`expenseId` set), the expense lock comes
  first, then the receipt. `expenses.softDelete` already works this way: its
  `updateMany` locks the expense, then it updates that expense's receipts. The
  new completion follows the same order.
- Filing's order (receipt, then expense) is safe only because its receipt has
  `expenseId IS NULL`, so neither delete nor completion ever matches it.
- **Invariant:** a PENDING_UPLOAD receipt's `expenseId` never changes. Filing
  needs READY, and unlink touches only READY rows. That is also why the
  library complete route (`receipts.ts:170`) can stay unlocked. A future
  "attach a pending upload" feature must revisit both points.

**Memory:** the same steps **in the same order** (expense first, so a deleted
expense answers `expense_not_found` even when its receipts were soft-deleted
with it).

**Transaction options:** `{ timeout: 10_000, maxWait: 5_000 }`. Lock waits now
count inside the interactive transaction; the default 5 s would turn a long
wait into a P2028 (500) instead of the 422.

**Store guard** (`auth/store-guard.ts`): add `completeOnExpense` to the
receipt methods it scopes, the way `fileOntoExpense` is.

### Route (`routes/expenses.ts` complete)

```
mustGetReceipt → READY? idempotent 200   (fast path, unchanged; 404 text stays "No such expense"/"No such receipt" as today)
verifyUploadedObject(storage, receipt)    (storage I/O stays outside the transaction)
completeOnExpense(...):
  completed / already_ready → 200 (audit only on completed)
  expense_not_found / receipt_not_found → 404 NOT_FOUND (as today)
  too_many_receipts → 422 tooManyReceipts()
```

- `assertRoomForReceipt` stays only on the upload **start** (advisory, as the
  ticket says).
- `expenseReceipts.complete` loses its last caller. Check with grep: if
  nothing else calls it, remove it from ports, Prisma, memory and the guard.

### Docs

- ADR-167, "Extended by MUT-389" (`.claude/DECISIONS.md` ~4650):
  - the "Known gap" bullet is marked resolved by MUT-397;
  - add the lock-order rule and the PENDING `expenseId` invariant.
- Update the `fileOntoExpense` comment (`prisma.ts:1782`) in the same commit.
- Unchanged and noted: a `too_many_receipts` loser keeps its verified object
  and its PENDING_UPLOAD row, as today's 422 does. Those rows count toward the
  pending-upload cap; there is no sweeper (an existing MUT-255 known gap).
- Unchanged and noted: `lockToReviewReceipt` uses `FOR UPDATE`, stronger than
  the rule. The two still conflict correctly, so it is left alone here.
- `CHANGELOG.md`, and `TEST_PLAN.md` rows.

## Tests

- `store-contract-receipts.ts` (memory, and Prisma via `test:db` on a
  **private** test DB `mutaba3a_test_mut397`):
  - completes a PENDING receipt;
  - `already_ready` when it is READY;
  - `receipt_not_found` for another expense's receipt and for a deleted one;
  - `expense_not_found` for a deleted expense;
  - `too_many_receipts` at the cap, with the receipt left PENDING_UPLOAD;
  - expense and receipt both deleted → `expense_not_found`, so the order of
    checks matches across both stores.
- `store-prisma-receipt-complete-lock.test.ts`, following
  `store-prisma-receipt-file-lock.test.ts`:
  - A holder connection takes the expense lock (as a filing would). The
    completion is started, and a probe tied to the holder through
    `pg_blocking_pids` proves it is blocked.
  - The holder files a receipt to reach 10, then commits. The completion
    resolves `too_many_receipts`, and exactly 10 are READY.
  - The holder's "filing" is raw SQL inside its own transaction (`UPDATE … SET
    "expenseId", "filingStatus"='FILED'` on a READY library receipt), as the
    existing test does. `store.fileOntoExpense` would itself block on the
    holder.
  - **Forced two-waiter case:** at 9 READY, the holder takes the expense lock
    and changes nothing. Start two completions and poll `pg_blocking_pids`
    until **two** waiters show on the holder. Then release. Expect exactly one
    `completed`, one `too_many_receipts`, and 10 READY.
  - Mutation check on both cases: with the lock statement removed, the
    blocking probe fails. Run once by hand and noted; not committed.
- The route tests in `routes-expenses.test.ts` stay green: idempotent once
  READY, 422 at 10, 404 for a deleted expense. Add a route row for a
  completion on a deleted expense, which must answer 404 through the new path.
- Commands: `npm --prefix server run typecheck`, `lint`, `test`, and
  `test:db` with `MUTABA3A_TEST_DATABASE_URL` pointing at the private DB.

## Acceptance criteria → proof

| AC | Proof |
| --- | --- |
| Completion and filing serialise; at 9, exactly 10 end READY; the loser gets 422 and its receipt keeps its state | lock test (both cases) + contract tests |
| Prisma forced-overlap test with `pg_blocking_pids`; fails without the lock | lock test + mutation check |
| Completion on a deleted expense still answers 404, under the lock | contract test + route row |
| Existing MUT-44 route tests green | `routes-expenses.test.ts` |
| Contract tests on memory and Prisma; typecheck, lint, test, test:db | commands above |

## Business / product impact

- Keeps the 10-receipts-per-expense cap true once receipts can be attached
  from the library (MUT-257/260). That cap protects storage cost and the
  receipts zip in the accountant pack.
- One of the conditions for switching `RECEIPTS_LIBRARY` on in production.

## Decision ledger

Remedies were auto-decided per Basel's standing instruction (2026-10-24).
None changed scope, cost or the outcome.

| ID | Finding | Source | Disposition |
| --- | --- | --- | --- |
| R1 | `complete` has other callers (library route receipts.ts:170, tests) | native | accepted: kept; the plan's "remove if unused" resolves to keep |
| R2 | Deadlock argument missed softDelete; receipt lock must be scoped to the expense (Medium, 9/10, prisma.ts:1520) | outside #1 | accepted: lock-order rule + `expenseId` predicate |
| R3 | Two-completions case not a forced overlap (Medium, 9/10) | outside #2 | accepted: two-waiter forced overlap; raw-SQL holder filing spelled out |
| R4 | Order of checks must match across the two stores (Medium, 8/10) | outside #3 | accepted, plus a test case |
| R5 | `FOR UPDATE` vs `NO KEY UPDATE` mismatch (Low) | outside #4 | noted, left alone |
| R6 | Library complete stays safe only via the PENDING-expenseId invariant (Low) | outside #5 | accepted: written into the ADR |
| R7 | Transaction timeout now includes lock wait (Low) | outside #6 | accepted: explicit timeout |
| R8 | 404 text (Low) | outside #7 | accepted: unchanged text |
| R9 | Loser's pending row and object (Low) | outside #8 | noted |
| R10 | Doc locations (Low) | outside #9 | accepted |

Approval readiness: PASS.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Claude Plan subagent (Codex not installed) | Independent 2nd opinion | 1 | unavailable (native fallback completed) | 9 findings, all dispositioned |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved into plan) | 1 issue, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — (no UI) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** Codex not installed. A native Claude Plan subagent completed with 9 findings, none critical, all folded in.
- **VERDICT:** Eng review complete, findings folded in; ready for /eng-build.

NO UNRESOLVED DECISIONS
