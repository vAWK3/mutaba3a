# Design Brief: MUT-60, record a PaymentRecord when income is saved as Received (+ backfill)

- **Date:** 2026-10-13
- **Epic:** MUT-1 (client accounting core)
- **Ticket:** https://barmajiyat.atlassian.net/browse/MUT-60
- **Relates:** MUT-5 (Done — the edit-path half of this gap, ADR-039), MUT-95 (separate — demo-seed data fix, explicitly scopes the real-data backfill to MUT-60)
- **Blocks:** MUT-169 (editing a payment's date from the ledger needs a `PaymentRecord` to exist first)
- **Status:** Built (2026-10-13), branch `feature/mut-60-payment-record-backfill`. Full suite 3693/3697 pass, 262/262 files; lint/typecheck/build clean. Awaiting `/qa-reconcile`.

## Eng review findings

Self-reviewed (architecture, atomicity, edge cases, test coverage) against the plan below.

| # | Finding | Confidence | Resolution |
|---|---|---|---|
| 0 | At plan time, `main` was mid-merge of `feature/mut-88-settings-five-groups`; once that merge completed (`ae570d3`), its migration claimed Dexie schema **v22** (ADR-072, default-profile repair) — colliding with this plan's original v22 assumption. Two `this.version(22)` registrations would mean Dexie silently runs only one, so either MUT-88's repair or this backfill would never execute for a real user | 10/10 (re-read `database.ts` after the merge landed) | Rebased — this ticket is **v23**; all file:line citations below re-verified against the post-merge repo, not assumed |
| 1 | CSV import (`csvImport.ts:184-211`) is a third, independent writer of record-less "paid" income, bypassing `transactionRepo.create`/this ticket's new method entirely — the v23 backfill only fixes existing data, so every future CSV import of a paid row would reproduce TD-029 forever | 9/10 (quoted the exact lines) | Folded into scope — §D0 below |
| 2 | The new `createReceivedIncome` atomicity relies on Dexie's zone-based nested-transaction reuse (`create` then `markPaid` inside one outer `db.transaction`) — unproven in this codebase as a *new* nesting pattern (vs. existing single-level transactions) | 6/10, medium — verify with a dedicated rollback test | Addressed — §5 test plan includes an explicit atomicity/rollback test for `transactionRepo.test.ts` |
| 3 | `markPaid` silently creates no `PaymentRecord` at all when `remaining <= 0` — reachable only with `amountMinor <= 0`, which the drawer's schema already rejects before submit | 3/10, not reachable from any real caller | Noted, no action — suppressed from main findings per confidence calibration |

No other gaps found in the create/backfill/reader design; the edit path (ADR-039/MUT-5) was confirmed correct by reading the existing `hasRecords` branch, not assumed.

## 1. Problem

`IncomeDrawer`'s create-as-Received path (`buildIncomeCreate` in `src/lib/incomeEntry.ts:60-65`) writes `status: 'paid'`, `paidAt`, and `receivedAmountMinor` straight onto the `Transaction` row. No `PaymentRecord` is created. Every reader that answers "what did the client pay and when" by reading `PaymentRecord`s — `listByTransaction`, a future statement export, and (per MUT-169) any future UI to edit a payment's date — sees nothing for these entries.

`paymentRecordRepo.listByClient`'s reader-side workaround (ADR-033, `src/db/aggregations.ts:209-236`) synthesizes a `source: 'entry'` row for the uncovered amount so the client Payments section doesn't show a blank, but that's a read-time patch, not a fix: the entry still has no actual, editable `PaymentRecord`.

MUT-5/ADR-039 already settled what an edit does once an entry *has* records (status read-only, amount recalculates — `buildIncomeUpdate`, `incomeEntry.ts:74-94`, specifically the `hasRecords` short-circuit at line 77). The only gap left is **create**, plus a one-time backfill for existing data. TD-029 names this exact remainder.

## 2. Current state (file:line map)

| Area | Location | Role |
|---|---|---|
| Create-as-Received write | `src/lib/incomeEntry.ts:60-65` (`buildIncomeCreate`) | Bakes `paidAt`/`receivedAmountMinor` directly — **the bug** |
| Drawer submit (create) | `src/components/drawers/IncomeDrawer.tsx:302` | `createMutation.mutateAsync(buildIncomeCreate(values, nowISO()))` — **the call site to branch** |
| Create mutation hook | `src/hooks/useQueries.ts:155-163` (`useCreateTransaction`) | Generic pass-through to `transactions.create` |
| Transaction create | `src/db/repository.ts:353-363` (`transactionRepo.create`) | Plain insert, no payment-record awareness — **left untouched** |
| Mark-paid precedent | `src/db/repository.ts:413-432` (`transactionRepo.markPaid`) | Already does "create a `PaymentRecord` for the remaining amount, then `recalculateReceivedAmount` derives status/paidAt" — **the pattern to reuse, not reinvent** |
| Payment record create | `src/db/repository.ts:1086-1127` (`paymentRecordRepo.create`) | Validates, wraps `db.transaction('rw', [db.paymentRecords, db.transactions], ...)` around `assertWithinTransactionTotal` + add + `recalculateReceivedAmount` |
| Derive status/paidAt from records | `src/db/repository.ts:1017-1045` (`recalculateReceivedAmount`) | Single source of truth — sums records, sets `status`/`paidAt`/`receivedAmountMinor` |
| Edit path (already correct) | `src/lib/incomeEntry.ts:74-94` (`buildIncomeUpdate`), `IncomeDrawer.tsx:120-124` (`hasRecords`/`paymentStateLocked`) | No change needed — starts applying to every Received entry once create always leaves a record behind |
| ADR-033 synthetic row | `src/db/aggregations.ts:209-236` (`paymentRowsForIncome`), `accumulateIncomeAmount` at `:61-67` | Pushes a `source: 'entry'` row sized `uncoveredMinor`; becomes permanently `0` once backfilled — **no reader change needed** |
| Dexie version history | `src/db/database.ts` | Last version is v22 (`:947-954`, MUT-88, ADR-072 — default-profile repair, no schema change). **New version is v23** — v22 is already claimed by MUT-88, confirmed by reading the merged `database.ts` directly (not assumed from the original ticket, which predates that merge). v18 (`:859-902`) is the closest precedent for a payment-record backfill upgrade, but only handled a transaction with *zero* existing records — v23 must subtract whatever records already exist (from v18's own migration, or from `markPaid`/`recordPartialPayment` usage since) |
| Migration test idiom | `src/db/__tests__/migration-v21.test.ts` | Build a raw `V20_SCHEMA` Dexie db, seed rows, open current version, assert — copy this shape for `migration-v23.test.ts` |
| Demo seed data | `src/demo/seedData/transactions.ts` | Has the same gap, but fixing it is **MUT-95's scope**, not this ticket's — do not touch |

## 3. Design

### A. Create-as-Received composes a `PaymentRecord`, atomically, by reusing `markPaid`

New repository method, placed next to `markPaid` (`repository.ts`, after line 432):

```ts
async createReceivedIncome(
  data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'paidAt' | 'receivedAmountMinor'>,
  paidAt: string
): Promise<Transaction> {
  return db.transaction('rw', [db.transactions, db.paymentRecords], async () => {
    const tx = await this.create({ ...data, status: 'unpaid' });
    await this.markPaid(tx.id, { paidAt });
    return (await db.transactions.get(tx.id))!;
  });
},
```

This is pure composition — zero changes to `create`, `markPaid`, `paymentRecordRepo.create`, or `recalculateReceivedAmount`. `markPaid` already does exactly "create a `PaymentRecord` for the full remaining amount, let `recalculateReceivedAmount` derive `status`/`paidAt`/`receivedAmountMinor`" (`repository.ts:413-432`). The outer `db.transaction` scope (`[db.transactions, db.paymentRecords]`) is a superset of what `paymentRecordRepo.create` opens internally (`repository.ts:1120`), so Dexie nests/reuses it — one atomic write, no partial-failure window.

`src/lib/incomeEntry.ts` changes:
- `buildIncomeCreate` loses its `received` branch — it only ever builds the unpaid/invoiced write now (drop the unused `now` param too):
  ```ts
  export function buildIncomeCreate(values: IncomeEntryValues): IncomeWrite {
    return { ...entryFields(values), status: 'unpaid' };
  }
  ```
- New exported helper for the received path:
  ```ts
  /** Entry fields for a Received create (MUT-60): payment state (status, paidAt,
   * receivedAmountMinor) is derived from the PaymentRecord
   * `transactionRepo.createReceivedIncome` creates alongside it, not written here. */
  export function buildReceivedIncomeEntry(values: IncomeEntryValues): EntryFields {
    return entryFields(values);
  }
  ```
  (`EntryFields` already exists at line 38; export it.)

`src/hooks/useQueries.ts` — new hook mirroring `useCreateTransaction` exactly, including invalidation (the existing comment at `useQueries.ts:203-207` confirms `invalidateTransactionQueries` already covers payment-record lists, so no new invalidation logic is needed):

```ts
export function useCreateReceivedIncome() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ data, paidAt }: {
      data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'paidAt' | 'receivedAmountMinor'>;
      paidAt: string;
    }) => getRepositories().base.transactions.createReceivedIncome(data, paidAt),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}
```

`IncomeDrawer.tsx` — only the create branch of `onSubmit` changes (around line 302):

```ts
const createReceivedMutation = useCreateReceivedIncome(); // new, alongside line 111-112's other mutations

// ...in onSubmit, replacing line 302:
const newTx = values.incomeStatus === 'received'
  ? await createReceivedMutation.mutateAsync({ data: buildReceivedIncomeEntry(values), paidAt: nowISO() })
  : await createMutation.mutateAsync(buildIncomeCreate(values));
```

Everything downstream of `newTx` (duplicate-undo toast, `markSaved` for MUT-81's after-save flash) is unchanged — both mutations resolve to a `Transaction`.

### B. Edit path — no code change

Once every Received create leaves a `PaymentRecord` behind, `hasRecords` (`IncomeDrawer.tsx:122`) is `true` on every subsequent edit of that entry, so `buildIncomeUpdate`'s existing `if (options.hasRecords) return fields;` (`incomeEntry.ts:77`) already does the right thing — status read-only, amount recalculates via `transactionRepo.update`'s record branch (`repository.ts:381-410`). This is exactly what MUT-5/ADR-039 built. Confirm with a test (below) rather than touching the code.

### C. Dexie v23: backfill existing data

Extract the per-transaction calculation as a small pure, exported helper so it can be unit-tested directly for idempotency without spinning up Dexie:

```ts
// database.ts (or a small co-located module, matching where MIGRATED_PAYMENT_NOTE lives)
export function uncoveredPaymentAmount(
  t: Pick<Transaction, 'kind' | 'status' | 'amountMinor' | 'receivedAmountMinor' | 'deletedAt' | 'archivedAt'>,
  existingRecordedMinor: number
): number {
  if (t.kind !== 'income' || t.deletedAt || t.archivedAt) return 0;
  const target = t.status === 'paid' ? t.amountMinor : (t.receivedAmountMinor ?? 0);
  return Math.max(0, target - existingRecordedMinor);
}
```

Then the upgrade, following v18's loop idiom (`database.ts:857-898`) but generalized to subtract whatever records already exist (v18's own backfill, or any `markPaid`/`recordPartialPayment` since) instead of assuming zero:

```ts
this.version(23).upgrade(async (tx) => {
  const now = new Date().toISOString();
  const transactions = await tx.table('transactions').toArray();
  const records = await tx.table('paymentRecords').toArray();
  const recordedByTx = new Map<string, number>();
  for (const r of records) {
    if (r.deletedAt) continue;
    recordedByTx.set(r.transactionId, (recordedByTx.get(r.transactionId) ?? 0) + r.amountMinor);
  }

  for (const t of transactions) {
    const uncovered = uncoveredPaymentAmount(t, recordedByTx.get(t.id) ?? 0);
    if (uncovered <= 0) continue;
    await tx.table('paymentRecords').add({
      id: crypto.randomUUID(),
      transactionId: t.id,
      amountMinor: uncovered,
      paidAt: t.paidAt ?? t.occurredAt,
      notes: MIGRATED_PAYMENT_NOTE,
      createdAt: now,
      updatedAt: now,
    });
  }
});
```

No `.stores()` change — `paymentRecords` already exists (v18). Idempotency is both structural (`uncoveredPaymentAmount` returns `0` once covered, so a second pass over the same data adds nothing) and enforced by Dexie itself (a version's `.upgrade()` runs once per database, tracked by Dexie's own version counter) — the migration-safety test (below) verifies the structural property directly by calling the upgrade logic twice.

### D0. CSV import — a third writer this ticket must also close (found in review)

`src/db/csvImport.ts:184-211` (`importCsvRows`'s income loop) is an independent writer: it calls `db.transactions.add(...)` directly — never `transactionRepo.create` — and sets `status: 'paid'` (line 191: `row.status === 'paid' ? 'paid' : 'unpaid'`) with no `PaymentRecord` and no `receivedAmountMinor` at all. This is the same TD-029 shape, through a third door `IncomeDrawer`/`createReceivedIncome` never touches.

This matters specifically because the v23 backfill only fixes *data that already exists at migration time*. A user who imports a CSV with paid rows **after** they're already on v23 gets record-less paid income again, indefinitely — there's no future migration coming to catch it. Leaving this out would make the ticket's own acceptance criterion ("saving income as Received creates exactly one PaymentRecord") false for an entire import channel, silently.

Fix (small, in scope for this ticket — same root cause, same fix shape): immediately after the `db.transactions.add(...)` call, when `status === 'paid'`, also write the covering `PaymentRecord`:

```ts
await db.transactions.add({ /* ...unchanged... */ });
if (status === 'paid') {
  await paymentRecordRepo.create({
    transactionId: id, // hoist the generated id into a local so both calls use it
    amountMinor,
    paidAt: row.paidAt || row.date,
  });
}
transactions++;
```

(`id` needs hoisting to a local `const id = crypto.randomUUID()` above the `add()` call so both writes reference the same row.) This loop doesn't wrap each row in a `db.transaction` today (pre-existing, not introduced here) — matching that existing non-atomic-per-row style, not a regression.

### D. ADR-033 reader — confirmed no change

`paymentRowsForIncome` (`aggregations.ts:209-236`) computes `uncoveredMinor` fresh on every read. Once every income transaction's records sum to `accumulateIncomeAmount(tx).paid` (which is exactly what C guarantees), `uncoveredMinor` is always `0` and the synthetic `entry` row stops being pushed on its own — matching the ticket's acceptance criterion "the client profile's Payments section shows it once." Nothing to edit here; this is a design confirmation, not a to-do.

## 4. Files touched

- `src/lib/incomeEntry.ts` — simplify `buildIncomeCreate`, add `buildReceivedIncomeEntry`, export `EntryFields`
- `src/components/drawers/IncomeDrawer.tsx` — branch the create call in `onSubmit`
- `src/db/repository.ts` — add `transactionRepo.createReceivedIncome`
- `src/hooks/useQueries.ts` — add `useCreateReceivedIncome`
- `src/db/database.ts` — add `uncoveredPaymentAmount` + `this.version(23).upgrade(...)`
- `src/db/csvImport.ts` — hoist the generated id, write a `PaymentRecord` for paid income rows (found in review, D0)
- Tests: `src/lib/__tests__/incomeEntry.test.ts`, `src/db/__tests__/transactionRepo.test.ts`, `src/db/__tests__/paymentRecords.test.ts`, `src/db/__tests__/csvImport.test.ts`, new `src/db/__tests__/migration-v23.test.ts`

## 5. Test plan

- **`incomeEntry.test.ts`**: `buildIncomeCreate` no longer accepts/handles `incomeStatus: 'received'` meaningfully (update or remove the old received-branch cases); new cases for `buildReceivedIncomeEntry` — returns entry fields with no `status`/`paidAt`/`receivedAmountMinor` keys.
- **`transactionRepo.test.ts`**:
  - `createReceivedIncome` creates exactly one `PaymentRecord` for the full amount, dated `paidAt`, and the returned `Transaction` has `status: 'paid'`, `receivedAmountMinor === amountMinor`.
  - The write is atomic: if `paymentRecordRepo.create`'s validation would reject (e.g., a future `paidAt` — shouldn't be reachable from the drawer, but assert the repo layer rejects it too), no `Transaction` row is left behind.
  - Editing a `createReceivedIncome`-created entry through `transactionRepo.update` takes the `hasRecords` branch (confirms section B needs no code change).
- **`paymentRecords.test.ts`**: after `createReceivedIncome`, `listByTransaction` returns the one record; `paymentRecordRepo.listByClient`'s synthetic `entry` row (ADR-033) does **not** appear for this transaction (confirms section D).
- **`csvImport.test.ts`**: importing an income row with `status: 'paid'` creates one `PaymentRecord` covering the full imported amount, dated `row.paidAt || row.date`; an `unpaid` row creates none.
- **`migration-v23.test.ts`** (new, mirrors `migration-v21.test.ts`'s idiom):
  - Seed a v21-schema db with: a fully-paid income transaction with no records; a part-paid (unpaid, `receivedAmountMinor > 0`) transaction with no records; a transaction already fully covered by an existing record (from a prior `markPaid`) — must get **no** new record; a deleted and an archived paid transaction — must get **no** new record; an expense — must be skipped entirely (`kind !== 'income'`).
  - Open at the current version; assert each expected record was added once, dated `paidAt ?? occurredAt`, with `MIGRATED_PAYMENT_NOTE`.
  - Call `uncoveredPaymentAmount` directly a second time against the post-backfill state (or re-run the upgrade body as a unit) and assert zero new records — the literal "running it twice creates no duplicates" acceptance criterion.
  - A seeded dataset check for Owed Now / Recent payments / Last payment unchanged before/after — reuse whatever aggregate query these existing features call (`summarizeOwedByCurrency` per ADR-033, `paymentRecordRepo.listRecent`) against the same fixture pre- and post-migration.

## 6. Edge cases / guardrails

- **Future-dated legacy data**: a transaction with `paidAt` in the future (shouldn't exist, but legacy data is legacy data) would make the backfilled `PaymentRecord.paidAt` future-dated too — `paymentRecordRepo.create`'s own `isFuturePaymentDate` guard (MUT-18) doesn't run inside a raw Dexie upgrade (it writes via `tx.table(...).add`, not through the repo). **Decision: clamp to `today` at the write site in the v23 upgrade** (`paidAt: (t.paidAt ?? t.occurredAt) > now ? now : (t.paidAt ?? t.occurredAt)`) — a day-one migration shouldn't manufacture data that would be rejected if entered by hand today. Add a migration-v23 test case for a future-dated legacy transaction asserting the backfilled record is clamped.
- **Currency**: `PaymentRecord` has no currency field of its own (it belongs to the transaction, per schema) — no handling needed, confirmed by `paymentRecordRepo.create`'s shape.
- **`migration-safety.ts`'s `ALL_TABLES`** (line 62-85) already omits `paymentRecords` — this is pre-existing TD-074, not introduced or worsened here. Leave it; don't silently fix unrelated debt inside this ticket.

## 7. Out of scope

- Demo/seed data (`src/demo/seedData/transactions.ts`) — MUT-95's job, explicitly scoped out of MUT-60 by MUT-95 itself.
- The ledger/IncomeDrawer UI entry point to *edit* a payment's date — MUT-169, blocked by this ticket, not part of it.
- `migration-safety.ts`'s `ALL_TABLES` gap (TD-074) — pre-existing, separate.
- Expenses — no payment-record concept; unaffected.

## 8. Verification (per CLAUDE.md, Node 22 — TD-054)

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
```

## 9. Business / product impact

Closes the last gap TD-029 named: today, the fastest and most common way to log a paid invoice (fast-add → Received, MUT-5) produces data none of the app's own payment-history surfaces can see — only a read-time patch papers over it. This is also the hard blocker for MUT-169 (editing a backdated/corrected payment date from the ledger), which the user asked for directly this session because their real workflow is "fast-add now, reconcile dates later." Landing MUT-60 turns every Received entry into real, auditable payment history and unblocks that follow-on UI work.
