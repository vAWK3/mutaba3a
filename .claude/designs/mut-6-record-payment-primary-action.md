# MUT-6 — Promote "Record payment" to a primary row action

> Status: PLAN (no code written)
> Epic: MUT-1 "Client accounting core"
> Related: MUT-18 (markPaid hardcodes paidAt — out of scope), MUT-3 (client profile rebuild — sequencing risk), MUT-4 (Payments section — AC dependency)

---

## 1. Problem + acceptance criteria

Recording a payment is the most frequent action in the product and is buried in a kebab
menu at four call sites (`ClientDetailPage:468`, `ClientDetailPage:602`,
`ProjectDetailPage:303`, `IncomePage:245`). TODO.md records the complaint verbatim.

Acceptance criteria are the ticket's eight boxes; see §7 for the mapping.

## 2. What the code actually does today (verified)

| Area | Reality |
|---|---|
| `PartialPaymentDrawer.tsx:234` | Create-mode amount input initialises to `''` — **no prefill** |
| `PartialPaymentDrawer.tsx:253` | Only validation is `<= 0`; message is a hardcoded English string |
| `repository.ts:1348 create()` | Validates positive + tx exists + `kind==='income'`. **No overpayment check. No lock check.** |
| `repository.ts:1324 recalculateReceivedAmount` | Writes `db.transactions.update` **directly**, bypassing `transactionRepo.update`'s `lockedAt` guard (`repository.ts:349`) |
| `useQueries.ts:174 invalidatePaymentRecordQueries` | Invalidates `paymentRecords` + `invalidateTransactionQueries`. **Does NOT invalidate `['income']` / `['receivables']` / `['incomeOverviewTotals']` / `['incomeAttentionReceivables']`** |
| `main.tsx:59` | `staleTime: 60_000` |
| `TransactionDisplay` (`types/index.ts:214`) | Already carries `paymentStatus`, `remainingAmountMinor`, and `lockedAt` (via `extends Transaction`) on every list row |

**Consequence of the invalidation gap:** `/income` (`useIncome`) and the client
Receivables tab (`useReceivables`) keep showing stale status/remaining for up to
60s after a payment is saved from the drawer. This breaks AC #5 today and is the
single most important defect this ticket must fix.

## 3. Decisions this plan locks in

**D1 — Overpayment is rejected.** The data model has no credit/refund concept;
`recalculateReceivedAmount` clamps with `Math.max(0, …)` and `sum >= amount`, so an
overpayment is silently swallowed with nothing in the UI showing it. Reject in the
repository (the source of truth, which also covers the sync path), surfaced inline in
the drawer. Rule: `sum(other non-deleted records) + newAmount > tx.amountMinor` → throw.

**D2 — Locked transactions DO accept payments.** `lockedAt` exists for ADR-014
document immutability: it protects the *invoice facts* (amount, currency, client,
date). `receivedAmountMinor` / `status` / `paidAt` are payment tracking, not invoice
facts — and an invoiced receivable being paid is the normal flow, so blocking it would
be wrong. Today this works only *by accident* (the recalc bypasses the guard). Make it
intentional: name the allowlist, keep the button enabled on locked rows, cover it with a
test so a future refactor that routes recalc through `transactionRepo.update` can't
silently break it.

**D3 — No optimistic update.** Writes are local Dexie (sub-ms). Invalidate-on-success
is already the pattern and satisfies the NFR "optimistic update must not leave a stale
Owed Now if the write fails" by construction. Documented, not implemented.

## 4. Design — reuse first

One new shared component, everything else is edits.

### New: `src/components/ui/RecordPaymentButton.tsx` (+ registry entry)

```tsx
<RecordPaymentButton transaction={tx} />
```

- Self-gating: renders `null` unless `kind === 'income' && paymentStatus !== 'paid' && (remainingAmountMinor ?? 0) > 0`.
  One gate in one place replaces four hand-rolled `isReceivable && tx.paymentStatus !== 'paid'` conditions.
- Label `t('transactions.partialPayment.recordPayment')`; remaining amount rendered
  beside it via the existing `formatAmount(remainingAmountMinor, currency, locale)`.
- Calls the existing `useDrawerStore().openPartialPaymentDrawer({ transactionId })`.
- Reuses the existing `Button` (`variant="secondary" size="sm"`) — no new button styles.
- Surviving MUT-3: because the gate and the wiring live in the component, MUT-3's client
  profile rewrite re-mounts it in one line instead of re-deriving the logic.

### Edits

| File | Change |
|---|---|
| `src/components/ui/index.ts` | export `RecordPaymentButton` |
| `ClientDetailPage.tsx` (receivables tab, ~468) | actions `<td>` → flex row: `<RecordPaymentButton>` + `<RowActionsMenu>`; drop the kebab's `recordPayment` entry |
| `ClientDetailPage.tsx` (transactions tab, ~602) | same |
| `IncomePage.tsx` (~245) | same |
| `ProjectDetailPage.tsx` (~303) | same — **scope decision, see §8** |
| `PartialPaymentDrawer.tsx:234` | create-mode `paymentInput` initialises to `formatCurrencyInput(String(remainingAmountMinor / 100))`; still fully editable |
| `PartialPaymentDrawer.tsx:253` | replace hardcoded English errors with i18n keys; show repo overpayment error inline |
| `repository.ts` `paymentRecordRepo.create/update` | overpayment guard (D1) |
| `repository.ts:349` | extract `PAYMENT_FIELDS_ALLOWED_WHILE_LOCKED` constant + comment making D2 explicit |
| **`src/hooks/invalidation.ts` (new)** | extract the shared `invalidateMoneyQueries(queryClient)` used by `useQueries.ts:21`, `useIncomeQueries.ts:61` and `useQueries.ts:174` — fixes the stale-list bug and removes a 13-line duplicated block |
| `src/lib/i18n/translations/{en,ar}.json` | `partialPayment.remainingLabel`, `.overpayment`, `.amountMustBePositive` |

Column-width NFR: the button goes **inside the existing actions cell**, not a new column,
so the amount column cannot be pushed off-screen. RTL mirrors for free (flex + document `dir`).

## 5. Testability

- `src/db/__tests__/paymentRecords.test.ts` — overpayment rejected on `create`;
  overpayment rejected on `update`; payment on a `lockedAt` transaction succeeds and
  flips status to `paid`.
- `src/components/ui/__tests__/RecordPaymentButton.test.tsx` (new) — renders for unpaid
  and partial income; renders nothing for paid income or expenses; click opens the drawer
  with the right `transactionId`.
- `PartialPaymentDrawer` — amount prefilled to remaining; a backdated date is what reaches
  `createMutation`.
- Invalidation — after `useCreatePaymentRecord` succeeds, `['income']` and `['receivables']`
  are invalidated (guards the AC #5 regression permanently).
- Update the existing `IncomePage` / `ClientDetailPage` / `ProjectDetailPage` tests that
  assert kebab contents.

## 6. Scalability + cost

No new queries, no new indexes. The overpayment guard reads payment records the
`create` transaction already opens. The shared invalidator slightly *widens* what
refetches on a payment, but these are local IndexedDB reads on lists already capped
by filters. Net cost: neutral.

## 7. AC coverage

| AC | Covered by |
|---|---|
| 2 clicks from client profile | `RecordPaymentButton` + prefill (§4) |
| Only on unpaid/partial income | component self-gate (§4) |
| Prefilled to remaining, overwritable | `PartialPaymentDrawer.tsx:234` |
| Date defaults today, backdatable, stored | already true — locked by a test |
| Row/remaining/Owed Now refresh with no manual refresh | `invalidateMoneyQueries` (§4) |
| Overpayment: decide + document | **D1 — rejected** |
| Locked transaction behaves correctly | **D2 — allowed, made explicit** |
| Tests: full, partial, backdated, locked | §5 |

## 8. Scope notes for the user

- **ProjectDetailPage** is named in the ticket's Problem but absent from Scope (in).
  Same component, three lines. Recommend including it — shipping three of four surfaces
  with a promoted button produces an inconsistency that reads as a bug.
- **MUT-4** owns the client "Payments section". `paymentRecordRepo.listByClient` and
  `usePaymentsByClient` exist, but no Payments section is rendered on `ClientDetailPage`.
  AC #5's "and the Payments section" is therefore **unverifiable until MUT-4 ships**.
  The shared invalidator already covers `['paymentRecords', 'client', …]`, so MUT-4 will
  inherit correct refresh for free.
- **MUT-3** rewrites `ClientDetailPage`. Build MUT-6 first — the shared component is what
  MUT-3 should mount.

## 9. Verification

`npm run lint` · `npm run typecheck` · `npm run test:run` · `npm run build`

## Business / product impact

- Makes the product's highest-frequency action visible and two clicks away, closing the
  one usability complaint recorded in TODO.md from real users.
- Also fixes a live correctness defect: `/income` and the Receivables tab show stale
  balances for up to a minute after a payment — "what I'm owed" is the whole promise of
  epic MUT-1, and it is currently wrong right after the moment that matters most.
- First story in MUT-1's payment path; unblocks MUT-3 and MUT-4, which both mount this
  component. Low risk: one new component, no schema change, no new queries.

---

# ENG REVIEW RECORD
Target (fixed): `.claude/designs/mut-6-record-payment-primary-action.md` — the MUT-6 plan above.
Reviewer: /plan-eng-review, 2026-10-10, branch `main`.

## Scope Challenge

Result: **scope accepted as-is** (D1 added one surface named in the ticket's own Problem section; that is not a scope reduction).

Complexity gate tripped: 12 source files + 4 test files, 2 new modules proposed.

Scope record:
- feature answers: D1 → "Include all four surfaces" (ProjectDetailPage.tsx:303 joins the three in-scope surfaces).
- structure: D2 → "Smaller arrangement". No `src/hooks/invalidation.ts`. Fix the four missing keys in place in `invalidatePaymentRecordQueries` (`src/hooks/useQueries.ts:174`). The duplicated 13-line key list between `useQueries.ts:21` and `useIncomeQueries.ts:61` stays and is recorded as known debt.
- disposition D3 → "New MUT ticket + TODOS". The paymentRecord sync defect leaves MUT-6 entirely and becomes its own ticket.
- accepted scope: shared `RecordPaymentButton` across four surfaces; amount prefill; overpayment policy (pending R2); locked-transaction behaviour (pending R1); four added invalidation keys; i18n keys; tests per §5.
- pending remedies: R1, R2.

## Decision ledger

### D1: ProjectDetailPage surface
State: approved. Actual answer: "Include all four surfaces".
Accepted scope: `ProjectDetailPage.tsx:303` uses `RecordPaymentButton`; its kebab loses the `recordPayment` entry; `ProjectDetailPage.test.tsx` updated.

### D2: Invalidation arrangement
State: approved. Actual answer: "Smaller arrangement".
Accepted scope: add `['income']`, `['receivables']`, `['incomeOverviewTotals']`, `['incomeAttentionReceivables']` to `invalidatePaymentRecordQueries` (`useQueries.ts:174`). No new module. No edit to `useIncomeQueries.ts`.
Note: plan §4's `src/hooks/invalidation.ts` row is superseded by this answer.

### D3: paymentRecord sync defect
State: approved. Actual answer: "New MUT ticket + TODOS".
Accepted scope: out of MUT-6. Write the TODOS.md entry; create the MUT ticket. No `src/sync/` edit in this ticket.

## 1. Architecture review

`[P1] (confidence: 10/10) src/db/repository.ts:349-351` — the plan's §4 row "extract `PAYMENT_FIELDS_ALLOWED_WHILE_LOCKED` constant" targets this guard:
```
if (existing.lockedAt) {
  const allowedFields = ['archivedAt'];
```
Adding `receivedAmountMinor` / `status` / `paidAt` to that array widens the lock for **every** caller of `transactionRepo.update`, not just the payment path — the generic edit drawer included. ADR-014 exists to stop exactly that. Separately, the payment path does not even reach this guard: `recalculateReceivedAmount` (`repository.ts:1338`) calls `db.transactions.update` directly. So the plan's proposed edit widens a guarantee without affecting the code path it was written for. → **R1** decides the behaviour; the allowlist edit is dropped either way.

`[P2] (confidence: 10/10) plan §4` — `RecordPaymentButton` is placed at `src/components/ui/` and described as calling `useDrawerStore().openPartialPaymentDrawer(...)`. Verified: `grep -rln "lib/stores" src/components/ui/` returns nothing. Every component in `components/ui/` today is props-in (`RowActionsMenu` takes `actions`, `Button` takes `onClick`). A store-aware component in that folder is the first of its kind. → **R3**.

`[P2] (confidence: 9/10) src/db/repository.ts:1359-1380` — the reads that any overpayment guard needs sit **outside** the write transaction:
```
const tx = await db.transactions.get(data.transactionId);
...
await db.transaction('rw', [db.paymentRecords, db.transactions], async () => {
```
Two concurrent creates (two tabs, or a resubmit the drawer's `isPending` does not cover) both read the same pre-state, both pass the guard, both insert. Whatever R2 decides, its check must read inside the `rw` block. Folded into R2's implementation, not a separate approval.

Data flow, as built:
```
row  ──click──▶ RecordPaymentButton ──▶ openPartialPaymentDrawer({transactionId})
                                               │  (URL-mirrored drawer state, ADR-008)
                                               ▼
                                     PartialPaymentDrawer
                                        │ amount ← remainingAmountMinor   (new: prefill)
                                        │ date   ← today, backdatable     (exists)
                                        ▼
                               useCreatePaymentRecord
                                        ▼
                     synced.paymentRecords.create ──▶ captureCreateOp('paymentRecord')
                                        │                      └──▶ op-log ──▶ [D3: never applied, own ticket]
                                        ▼
                     paymentRecordRepo.create
                        ├─ guard: amount > 0            (exists)
                        ├─ guard: kind === 'income'     (exists)
                        ├─ guard: overpayment           (new, R2 — must sit inside the rw block)
                        └─ rw tx: add record ──▶ recalculateReceivedAmount
                                                   └─ db.transactions.update  ← bypasses the lockedAt guard (R1)
                                        ▼
                     invalidatePaymentRecordQueries
                        ├─ ['paymentRecords']  (prefix-matches the by-client key too)
                        ├─ transaction keys    (exists)
                        └─ income + receivables keys  (NEW — this is AC #5)
```

Production failure on the new path: the write succeeds, invalidation fires, but a refetch rejects. The row keeps its old status while the drawer's own Payment History shows the new record — the two disagree on screen. TanStack surfaces the refetch error on the query, and no surface here renders query errors. Named in Failure modes below.

## 2. Code quality review

`[P2] (confidence: 10/10)` — four call sites, **three different gate conditions** for one concept:
- `ClientDetailPage.tsx:468` — no conditional at all; the entry is unconditional in the receivables tab
- `ClientDetailPage.tsx:602` — `...(isReceivable && tx.paymentStatus !== 'paid' ? [...] : [])`
- `ProjectDetailPage.tsx:300` — same as above
- `IncomePage.tsx:245` — `...(tx.status === 'unpaid' && tx.paymentStatus !== 'paid' ? [...] : [])`

This is the real justification for the shared component, and it is stronger than the plan states. The unified gate (`kind === 'income' && paymentStatus !== 'paid' && remainingAmountMinor > 0`) is AC #2, so each surface needs a regression assertion that the gate did not change what that surface shows.

`[P3] (confidence: 10/10) src/hooks/useMutationWithFeedback.ts:85-88`:
```
if (msg.includes('Payment amount') || msg.includes('Partial payments') || msg.includes('already fully paid')) {
  return msg;
}
```
Errors are routed to the user by English substring. A new overpayment error must keep an English repository message beginning `Payment amount` or the toast silently degrades to "Operation failed. Please try again." Repository messages stay English; i18n belongs at the UI layer.

**Shared-code rubric — `RecordPaymentButton`.** Callers verified, first-party, four of them (lines above). Behaviour, inputs and side effect are identical at all four. Destination `src/components/ui/` (pending R3); contract `(transaction: TransactionDisplay)` plus whatever R3 decides about the click handler. Honest accounting: removes ~24 implementation lines of kebab entries and gates, adds ~45 for the component plus 4 usage lines and 1 export — **net implementation lines grow by roughly 25**, before tests. This extraction is justified by reliability (one gate replacing three divergent conditions), not by line savings. The plan should not imply a DRY win it does not have.

Blast radius of a shared failure: a bug in the gate hides or shows the payment affordance on all four surfaces at once. Covered by the per-surface regression assertions above.

### R1: Payments against a locked (invoiced) transaction
Finding: [P1], confidence 10/10, `src/db/repository.ts:349-351` and `:1338`, reviewer /plan-eng-review Section 1.
Plan baseline: plan D2 proposed "allowed", implemented by widening `transactionRepo.update`'s allowlist.
Runtime evidence: payments on a locked transaction succeed today, because `recalculateReceivedAmount` writes `db.transactions.update` directly and never reaches the guard at `:349`. No test covers it. The allowlist edit the plan proposed would not affect this path and would widen the lock for all other callers.
Comparison grid:

| Choice | Current | A) Allow | B) Block |
|---|---|---|---|
| Payment on locked tx | succeeds, untested, by accident | succeeds, documented, tested | throws `TransactionLockedError` |
| `transactionRepo.update` allowlist | `['archivedAt']` | `['archivedAt']` unchanged | `['archivedAt']` unchanged |
| Button on a locked row | shown | shown | hidden, with reason |
| ADR-014 immutability | invoice fields protected | invoice fields protected | invoice fields protected |
| R2 overpayment policy | pending | pending | pending |

State: approved
Actual answer: "Allow, document, test" (R1/D4)
Accepted scope: payments succeed on a `lockedAt` transaction. `transactionRepo.update`'s allowlist stays `['archivedAt']` — the plan's `PAYMENT_FIELDS_ALLOWED_WHILE_LOCKED` edit is dropped. Instead: a comment at `repository.ts:1338` naming `recalculateReceivedAmount` as the sanctioned payment-side writer, and a test in `paymentRecords.test.ts` asserting a payment on a locked transaction succeeds and flips status to `paid`. The button stays visible on locked rows.

### R2: Overpayment policy
Finding: ticket AC "decide and document which"; `src/db/repository.ts:1355` and `:1334-1335`, reviewer /plan-eng-review Section 1.
Plan baseline: plan D1 proposed "reject".
Runtime evidence: no overpayment check exists. `recalculateReceivedAmount:1334-1335` computes `sum` then `isNowFullyPaid = sum >= tx.amountMinor`, and `remainingAmountMinor` clamps with `Math.max(0, …)`, so an overpayment is stored but invisible on every surface.
Comparison grid:

| Choice | Current | A) Reject | B) Allow and show |
|---|---|---|---|
| Sum > amount on create | stored silently | throws, inline message | stored |
| Surfacing the excess | nothing shows it | n/a | new UI on row + drawer |
| Guard location | none | inside the `rw` block | n/a |
| Legacy over-paid rows (`migratedNote`) | remaining is 0, button hidden | unchanged | unchanged |
| R1 locked behaviour | pending | pending | pending |

State: approved
Actual answer: "Reject with a message" (R2/D5)
Accepted scope: `paymentRecordRepo.create` and `.update` reject when `sum(other non-deleted records) + newAmount > tx.amountMinor`. The sum read happens **inside** the existing `db.transaction('rw', …)` block so two concurrent creates cannot both pass. Repository message stays English and begins `Payment amount` so `getErrorMessage` (`useMutationWithFeedback.ts:85`) routes it to the toast; the drawer shows an i18n'd inline message.

### R3: RecordPaymentButton placement and coupling
Finding: [P2], confidence 10/10, plan §4 against `src/components/ui/`, reviewer /plan-eng-review Section 1.
Plan baseline: plan §4 proposed `src/components/ui/RecordPaymentButton.tsx` calling `useDrawerStore()` internally.
Runtime evidence: `grep -rln "lib/stores" src/components/ui/` returns nothing. All current `components/ui` components are props-in.
Comparison grid:

| Choice | Current | A) Props-in, stays in ui/ | B) Store-aware, moves out of ui/ |
|---|---|---|---|
| `components/ui` purity | no store imports | preserved | preserved |
| Gate location | 3 divergent copies | inside the component | inside the component |
| Caller code | kebab entry + gate | `onRecordPayment={() => open…}` | `<RecordPaymentButton transaction={tx} />` |
| Callers already holding the store hook | all four do | all four do | all four do |
| Testability | n/a | render with a spy, no store mock | needs the store mocked |

State: approved
Actual answer: "Props-in, stays in ui/" (R3/D6)
Accepted scope: `src/components/ui/RecordPaymentButton.tsx`, props `{ transaction: TransactionDisplay; onRecordPayment: () => void }`, no store import. The gate stays inside the component. Each of the four callers passes `onRecordPayment={() => openPartialPaymentDrawer({ transactionId: tx.id })}` using the store hook it already holds.

## 3. Test review

Framework: **vitest** (`vitest.config.ts`, `package.json` `test:run`), jsdom per-file via `@vitest-environment jsdom`, `@testing-library/react` + `userEvent`, Dexie exercised for real through `fake-indexeddb` in the `src/db/__tests__` suites.

`[P1] (confidence: 10/10) src/db/__tests__/paymentRecords.test.ts:313-331` — the approved R2 rejection **inverts a currently passing test**:
```
describe('overpayment', () => {
  it('should allow overpayment and still mark as paid', async () => {
```
and `src/db/__tests__/partialPayment.test.ts:79` — `it('should mark as paid when payment exceeds remaining amount')`. Both document today's allow-and-clamp behaviour as intended.

`[P1] (confidence: 10/10) src/db/repository.ts:417` — `transactionRepo.recordPartialPayment` ends in `await paymentRecordRepo.create({…})`, so the R2 guard changes **that** entry point too, not only the drawer's. Its hooks (`useQueries.ts:162`, `useIncomeQueries.ts:207`) have no UI caller today, but it stays part of the repository contract and of `IRepositoryProvider` (`interfaces.ts:110`). → **R4**.

### Coverage diagram

```
CODE PATHS                                                   USER FLOWS
[+] components/ui/RecordPaymentButton.tsx (new)              [+] Recording a payment
  ├── [GAP] gate kind === 'income'                             ├── [GAP] [→E2E] Full settle from client profile, 2 clicks
  ├── [GAP] gate paymentStatus !== 'paid'                      ├── [GAP]        Partial settle, prefill overwritten
  ├── [GAP] gate remainingAmountMinor > 0                      ├── [GAP]        Backdated payment is what gets stored
  └── [GAP] onRecordPayment fires with the row's id            ├── [GAP]        Overpay → clear rejection, nothing saved
[+] db/repository.ts paymentRecordRepo.create                  └── [GAP]        Pay an invoiced (locked) receivable
  ├── [★★  TESTED] amount <= 0 — paymentRecords:82,92        [+] Refresh after save
  ├── [★★  TESTED] transaction missing — :102                  ├── [GAP] [→E2E] Row, /income and Owed Now all update
  ├── [★★  TESTED] kind !== 'income' — :112                    └── [GAP]        Drawer history vs row disagree on refetch fail
  ├── [GAP] overpayment rejected — :314 ASSERTS THE OPPOSITE  [+] Absence
  ├── [GAP] lockedAt set → still succeeds                       ├── [GAP] No button on paid rows
  └── [★★★ TESTED] rw add + recalc — :35,:52,:69                └── [GAP] No button on expenses
[+] db/repository.ts paymentRecordRepo.update                 [+] Interaction
  ├── [★★  TESTED] amount <= 0 — :193                           └── [GAP] Double-click the button
  └── [GAP] overpayment rejected
[+] db/repository.ts recordPartialPayment
  └── [GAP] exceeds remaining — partialPayment:79 ASSERTS THE OPPOSITE
[+] drawers/PartialPaymentDrawer.tsx
  ├── [GAP] create-mode amount prefilled to remaining
  ├── [GAP] backdated date reaches createMutation
  └── [GAP] overpayment inline error rendered
[+] hooks/useQueries.ts invalidatePaymentRecordQueries
  └── [GAP] income + receivables keys invalidated

COVERAGE: 5/25 paths tested (20%)  |  Code paths: 5/17 (29%)  |  User flows: 0/8 (0%)
QUALITY: ★★★:1 ★★:4 ★:0  |  GAPS: 20 (2 E2E, 0 eval), of which 2 are existing tests asserting the opposite
```
Legend: ★★★ behavior + edge + error | ★★ happy path | ★ smoke check | [→E2E] needs integration test

No LLM or prompt surfaces in this change. No eval scope.

### Tests to add

**`src/components/ui/__tests__/RecordPaymentButton.test.tsx`** (new)
- renders for `paymentStatus: 'unpaid'` and for `'partial'`; renders nothing for `'paid'`, for `kind: 'expense'`, and for `remainingAmountMinor: 0`
- click calls `onRecordPayment` exactly once
- the remaining amount is rendered in the row's currency
  `Value: protects=the single gate deciding where the payment affordance appears; fails_when=the gate is inverted, dropped, or stops excluding expenses; why_new=no component owns this today, the condition is inlined three different ways across four pages; seam=none`

**`src/db/__tests__/paymentRecords.test.ts`** (extend)
- rewrite `describe('overpayment')` from allow to reject on `create` — pending R4
- reject on `update` when the new amount pushes the sum past the total
- a payment against a transaction with `lockedAt` set succeeds and flips `status` to `'paid'`
  `Value: protects=overpayment rejection and the deliberate lock exemption for payment fields; fails_when=the guard is dropped, or a refactor routes recalculateReceivedAmount through transactionRepo.update and the lock starts rejecting payments; seam=none`

**`src/db/__tests__/partialPayment.test.ts`** (extend) — rewrite `:79` to match R4's contract.

**`src/hooks/__tests__/useQueries.test.tsx`** (extend — this file uses real Dexie, no `vi.mock`)
- after `useCreatePaymentRecord` succeeds, `['income']` and `['receivables']` are invalidated
  `Value: protects=AC #5, the lists refreshing with no manual refresh; fails_when=a future edit drops the income keys from invalidatePaymentRecordQueries as it does today; seam=none`

**`PartialPaymentDrawer`** (new test file)
- create-mode amount input is prefilled with the remaining balance and is editable
- a backdated date is the value passed to `createMutation.mutateAsync`
  `Value: protects=the one-confirm full settle and the backdated-payment contract in AC #3 and #4; fails_when=prefill is dropped, or the form starts overwriting the chosen date with today; seam=none`

**Existing page tests** — `IncomePage.test.tsx`, `ClientDetailPage.test.tsx`, `ProjectDetailPage.test.tsx` assert kebab contents; each needs its `recordPayment` expectation moved to the new button, and a per-surface assertion that the unified gate shows the same rows that surface showed before.

**Tests made obsolete:** none retired outright. Two are rewritten in place (`paymentRecords.test.ts:314`, `partialPayment.test.ts:79`) pending R4.

## 4. Performance review

No N+1 and no new query per row. The button is a pure function of props already present on `TransactionDisplay`.

`[P3] (confidence: 9/10) src/db/repository.ts:1328-1333` — the R2 guard adds one read per create: `db.paymentRecords.where('transactionId').equals(id)`, the same index `listByTransaction` already uses, scoped to the records of one transaction (realistically under 20 rows). Inside the `rw` block it lengthens the write transaction by one indexed lookup. Negligible.

`[P3] (confidence: 8/10) src/hooks/useQueries.ts:174` — the four added keys mean a payment now invalidates roughly 13 keys instead of 9, and each live `useIncome` / `useReceivables` query refetches through `transactionRepo.list`, which loads then filters in JS (`repository.ts:230-261`, slicing for `limit` only after filtering). Scale unknown — it depends on ledger size, and CLAUDE.md's guardrail caps the default ledger view at the current month. Worth noting this introduces **no new worst case**: `markPaid` already invalidates this exact set via `invalidateIncomeQueries` (`useIncomeQueries.ts:62-75`). The change makes the payment path match the path beside it.

No caching opportunity worth taking here. No blocking call without a timeout; all writes are local IndexedDB.

### R4: Regression contract for the overpayment change (REGRESSION RULE)
Finding: [P1], confidence 10/10, `src/db/__tests__/paymentRecords.test.ts:313-331`, `src/db/__tests__/partialPayment.test.ts:79`, `src/db/repository.ts:417`, reviewer /plan-eng-review Section 3.
Plan baseline: R2 approved "reject with a message" for `paymentRecordRepo.create` and `.update`. The plan did not notice that two passing tests assert the opposite, nor that `transactionRepo.recordPartialPayment` inherits the guard.
Runtime evidence: `paymentRecords.test.ts:314` asserts `receivedAmountMinor === 12000` against a 10000 transaction and `status === 'paid'`. `partialPayment.test.ts:79` asserts the same for `recordPartialPayment`. `repository.ts:417` shows `recordPartialPayment` delegating to `paymentRecordRepo.create`, so it inherits any guard added there. Its hooks have no UI caller; it remains in `IRepositoryProvider` (`interfaces.ts:110`).

Behaviour to preserve: everything else in both suites — accumulation, auto-mark-paid at exactly the full amount, soft-delete recalculation, status reversion.
Intentional change: a payment whose sum would exceed `amountMinor` now throws instead of being stored and clamped.

Comparison grid:

| Choice | Current | A) One guard, both entry points | B) Guard only in the drawer path |
|---|---|---|---|
| `paymentRecordRepo.create` over total | stores it | throws | throws |
| `recordPartialPayment` over total | stores it (`partialPayment:79`) | throws (inherited) | stores it |
| `paymentRecords.test.ts:314` | asserts allow | rewritten to assert reject | rewritten to assert reject |
| `partialPayment.test.ts:79` | asserts allow | rewritten to assert reject | unchanged |
| Guard sites | none | one, in `paymentRecordRepo.create` | two, with a bypass flag |
| R1, R2, R3 | approved | unchanged | unchanged |

State: approved
Actual answer: "One guard, both doors" (R4/D7)
Accepted scope: the overpayment guard lives once, in `paymentRecordRepo.create` (and `.update`), so `transactionRepo.recordPartialPayment` inherits it. No bypass flag. Rewrite `paymentRecords.test.ts:313-331` and `partialPayment.test.ts:79` to assert rejection. Add a DECISIONS.md override entry recording that overpayment moves from allowed-and-clamped to rejected, with the reason and the date — the prior behaviour was documented by those two tests, so flipping it silently is not acceptable.

## Outside Voice

`CODEX_MODE: not_installed` with `codex_reviews=enabled`. The native in-host fallback dispatches a subagent through the Agent tool, which this session is instructed not to use unprompted. No second reviewer ran.

**Outside coverage: unavailable.** This review is one model's opinion. It is not a clean two-model review, and nothing here should be read as cross-model agreement. To close the gap, install Codex and re-run `/plan-eng-review .claude/designs/mut-6-record-payment-primary-action.md`, or say the word and I will dispatch the in-host subagent.

## Approval readiness

| ID | Decision | State | Actual answer |
|---|---|---|---|
| D1 | ProjectDetailPage surface | approved | "Include all four surfaces" |
| D2 | Invalidation arrangement | approved | "Smaller arrangement" |
| D3 | paymentRecord sync defect | approved | "New MUT ticket + TODOS" |
| R1/D4 | Locked-transaction payments | approved | "Allow, document, test" |
| R2/D5 | Overpayment policy | approved | "Reject with a message" |
| R3/D6 | Button placement and coupling | approved | "Props-in, stays in ui/" |
| R4/D7 | Overpayment regression contract | approved | "One guard, both doors" |

**Approval readiness: PASS** — D1, D2, D3, R1, R2, R3, R4 each cite their own actual answer. No accepted remedy rests on a setup, mode or navigation choice.

## NOT in scope

- **paymentRecord sync (D3).** `ops-engine.ts` has no `paymentRecord` case, so captured payment ops are never applied. Own MUT ticket; it is a sync-engine defect with its own regression-test needs, not a rider on a row-action change.
- **MUT-18, `markPaid`'s hardcoded `paidAt`.** Its own bug, named out of scope by the ticket. Note that MUT-6 makes it more visible: a prefilled "Record payment" and "Mark paid" now sit in the same row with different date semantics.
- **The duplicated 13-line invalidation key list** between `useQueries.ts:21` and `useIncomeQueries.ts:61`. D2 chose the smaller arrangement; this stays as known debt and belongs in TECH_DEBT.md.
- **A credit or refund concept.** R2 rejects overpayment instead; representing genuine overpayment needs a data model that does not exist.
- **Removing `markPaid` from the kebab.** After prefill it is a near-duplicate of the new button, but removing it is a product call outside this ticket.

## What already exists — reuse, not rebuild

| Needed | Already there | Action |
|---|---|---|
| Payment capture UI | `PartialPaymentDrawer.tsx` (506 lines: history, edit, delete, backdating) | Reuse unchanged except prefill and the inline error |
| Transactional write + recalc | `paymentRecordRepo.create` + `recalculateReceivedAmount` (`repository.ts:1324,1348`) | Reuse; add the overpayment guard inside the existing `rw` block |
| Remaining amount per row | `TransactionDisplay.remainingAmountMinor`, computed at `repository.ts:265-269` | Reuse; no new query |
| Paid/partial/unpaid state per row | `TransactionDisplay.paymentStatus`, `repository.ts:264-277` | Reuse for the gate |
| Button styling | `Button.tsx` `variant="secondary" size="sm"` | Reuse; no new CSS |
| Amount formatting | `formatAmount(minor, currency, locale)` | Reuse |
| Error toasts | `withErrorToast` / `getErrorMessage` (`useMutationWithFeedback.ts:63`) | Reuse; keep repository messages English so routing still matches |
| Drawer URL mirroring | `useDrawerStore.openPartialPaymentDrawer` (ADR-008) | Reuse |

Genuinely new: `RecordPaymentButton.tsx`, the overpayment guard, four invalidation keys, three i18n key pairs.

## Failure modes

| Path | Realistic production failure | Handling today | User sees |
|---|---|---|---|
| Overpayment guard | User enters more than remaining | Throws `PaymentRecordError`; message starts `Payment amount` so `getErrorMessage:85` returns it verbatim | Clear inline message plus toast. Covered. |
| Payment on a locked transaction | Invoiced receivable gets paid | Succeeds via `recalculateReceivedAmount`'s direct write | Normal success. Covered by the new test (R1). |
| Write succeeds, refetch fails | IndexedDB read error after a successful write | **Nothing.** No surface renders query errors; `withErrorToast` only wraps mutations | **Silent.** Row keeps the old status while the drawer's own history shows the new payment. Two numbers disagree with no explanation. |
| Two tabs, concurrent create | Both pass the guard, both insert | Guard inside the `rw` block (R2) serialises them | Second one is rejected. Covered. |
| Double-click the button | Two drawers / two submits | Drawer's `isPending` disables the footer and inputs | No duplicate. Needs the test; currently untested. |

**Critical gap:** the refetch-failure row — no test, no error handling, and the failure is silent. It predates MUT-6 and applies to every mutation in the app, so it is not this ticket's to fix, but it is the one failure on the new path a user cannot diagnose. Logged to TODOS below.

## Worktree parallelization strategy

Sequential implementation, no parallelization opportunity. One primary module: the payment path. `repository.ts`, `useQueries.ts`, the drawer and the four pages all sit on the same dependency chain — the component must exist before the pages can use it, and the repository guard must exist before its tests. Splitting this across worktrees would create conflicts, not throughput.

Order: repository guards and their tests → `RecordPaymentButton` and its test → drawer prefill → the four call sites → invalidation keys → i18n → page-test updates.

## Revised plan — what changed from the original above

The original §4 table is superseded on three rows:
1. **`src/hooks/invalidation.ts` is dropped** (D2). Fix the four keys in place in `useQueries.ts:174`.
2. **The `repository.ts:349` allowlist edit is dropped** (R1). The guard keeps `['archivedAt']`. The locked-transaction behaviour is documented and tested where it actually happens, at `recalculateReceivedAmount`.
3. **`RecordPaymentButton` is props-in** (R3), not store-aware: `{ transaction, onRecordPayment }`.

Two rows are added:
4. **The overpayment guard covers both entry points** (R4), and `partialPayment.test.ts:79` plus `paymentRecords.test.ts:314` are rewritten, with a DECISIONS.md override entry.
5. **ProjectDetailPage joins the surfaces** (D1).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 — Overpayment guard, one place, both doors.** `paymentRecordRepo.create` and `.update` (`repository.ts:1348`, `:1385`): sum the other non-deleted records **inside** the existing `db.transaction('rw', …)` block and throw when the new total would exceed `tx.amountMinor`. Message stays English, starting `Payment amount`, so `getErrorMessage` (`useMutationWithFeedback.ts:85`) routes it. `recordPartialPayment` inherits it via `repository.ts:417`. *(R2, R4)*
- [ ] **T2 — Rewrite the two inverted tests.** `paymentRecords.test.ts:313-331` and `partialPayment.test.ts:79` flip from asserting allow to asserting reject. Add the `update` overpayment case. *(R4)*
- [ ] **T3 — DECISIONS.md override entry.** Overpayment moves from allowed-and-clamped to rejected: what changed, why, date. The prior behaviour was documented by two tests, so this cannot be a silent flip. *(R4, CLAUDE.md conflict-prevention rule)*
- [ ] **T4 — Locked transactions: document and pin.** Comment at `repository.ts:1338` naming `recalculateReceivedAmount` the sanctioned payment-side writer and why it deliberately does not pass through `transactionRepo.update`'s lock guard. Test in `paymentRecords.test.ts`: a payment against a `lockedAt` transaction succeeds and flips status to `paid`. Do **not** touch the `['archivedAt']` allowlist. *(R1)*
- [ ] **T5 — `src/components/ui/RecordPaymentButton.tsx`.** Props `{ transaction: TransactionDisplay; onRecordPayment: () => void }`, no store import. Gate: `kind === 'income' && paymentStatus !== 'paid' && (remainingAmountMinor ?? 0) > 0`, else `null`. Renders `Button variant="secondary" size="sm"` with the label plus the remaining amount via `formatAmount`. Export from `components/ui/index.ts`. *(R3, Section 2)*
- [ ] **T6 — `RecordPaymentButton.test.tsx`.** Gate assertions for unpaid, partial, paid, expense, zero-remaining; one click fires `onRecordPayment` once; the remaining amount renders in the row's currency. *(Section 3)*
- [ ] **T7 — Wire the four surfaces.** `ClientDetailPage.tsx:468` and `:602`, `IncomePage.tsx:245`, `ProjectDetailPage.tsx:300`: actions cell becomes a flex row holding `<RecordPaymentButton … onRecordPayment={() => openPartialPaymentDrawer({ transactionId: tx.id })} />` plus the kebab; drop the kebab's `recordPayment` entry at all four. Keep the button inside the existing actions cell — no new column — so the amount column cannot be pushed off-screen. *(D1, Section 2)*
- [ ] **T8 — Prefill the drawer.** `PartialPaymentDrawer.tsx:234`: create-mode `paymentInput` initialises to `formatCurrencyInput(String(remainingAmountMinor / 100))`, still editable. Replace the hardcoded English errors at `:253` with i18n keys and render the repository's overpayment message inline. *(AC #3, Section 2)*
- [ ] **T9 — Drawer tests.** Amount prefilled to remaining; a backdated date is what reaches `createMutation.mutateAsync`; the overpayment error renders inline. *(AC #3, #4, #6)*
- [ ] **T10 — Fix the stale lists.** `invalidatePaymentRecordQueries` (`useQueries.ts:174`): add `['income']`, `['receivables']`, `['incomeOverviewTotals']`, `['incomeAttentionReceivables']`. No new module; `useIncomeQueries.ts` untouched. *(D2, AC #5 — this is the live bug)*
- [ ] **T11 — Pin AC #5.** Extend `src/hooks/__tests__/useQueries.test.tsx` (it uses real Dexie, no `vi.mock`, so it is immune to the barrel-interception trap): after `useCreatePaymentRecord` resolves, `['income']` and `['receivables']` are invalidated. *(Section 3)*
- [ ] **T12 — i18n.** `transactions.partialPayment.overpayment`, `.amountMustBePositive`, `.remainingLabel` in both `en.json` and `ar.json`. Verify RTL button placement and that the amount column survives at the narrowest supported desktop width. *(ticket non-functionals)*
- [ ] **T13 — Update the three page tests.** `IncomePage.test.tsx`, `ClientDetailPage.test.tsx`, `ProjectDetailPage.test.tsx`: move the `recordPayment` expectation off the kebab, and add a per-surface assertion that the unified gate shows the same rows each surface showed before. *(Section 2 regression risk — three divergent gates become one)*
- [ ] **T14 — Knowledge files.** `CHANGELOG.md`, `COMPONENT_REGISTRY.md` (register `RecordPaymentButton`), `TECH_DEBT.md` (the duplicated invalidation key list left standing by D2), `TEST_PLAN.md`. *(CLAUDE.md protocol)*
- [ ] **T15 — Out of this ticket, already written to TODOS.md.** Items 3, 4 and 5: paymentRecord sync cannot be applied; silent refetch failure; `Mark paid` / `Record payment` overlap. Item 3 still needs its MUT ticket created. *(D3, D8, D9)*

Verify: `npm run lint` · `npx tsc --noEmit -p tsconfig.app.json` · `npm run test:run` · `npm run build`
(there is no `typecheck` script on `main` yet — MUT-35 added one, and no `test:integration` script has ever existed despite CLAUDE.md Phase 4 naming it; that gap is TODOS item 2.)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| Scope Challenge | 16 files, 2 new modules — gate tripped at 8/2 | Right-size the diff before architecture | 1 | complete | 4 findings; scope accepted as-is, 1 surface added, 1 module dropped |
| 1. Architecture | standard | Boundaries, data flow, failure modes | 1 | complete | 3 findings (1×P1, 2×P2) |
| 2. Code quality | standard | Reuse, error paths, shared-code rubric | 1 | complete | 3 findings (1×P2, 2×P3) |
| 3. Tests | standard | Coverage of every changed behaviour | 1 | complete | 2×P1 — two existing tests assert the opposite of the approved policy |
| 4. Performance | standard | Query patterns, invalidation cost | 1 | complete | 2×P3, both negligible; no new worst case |
| Outside Voice | default-on | Independent second opinion | 0 | **unavailable** | Codex not installed; in-host subagent fallback not permitted in this session |

**OUTSIDE COVERAGE: unavailable.** One model reviewed this plan. No cross-model agreement was established.

**CROSS-MODEL: not applicable** — no second reviewer completed.

**VERDICT: APPROVED WITH CONDITIONS.** The plan is sound and its central insight — that AC #5 is broken in shipped code — is verified at `useQueries.ts:178` against `main.tsx:59`. Three of its proposed implementations were wrong and are superseded: the lock-allowlist edit would have widened ADR-014's guarantee for every caller while missing the path it was written for; the shared invalidation module was a three-file refactor for a four-line omission; and the store-aware component would have been the first store import in `components/ui`. The review also found what the plan missed: the approved overpayment policy inverts two passing tests and silently changes a second repository entry point. Build T1–T14 in order. T15 leaves this ticket.

NO UNRESOLVED DECISIONS
