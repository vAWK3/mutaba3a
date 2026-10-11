# MUT-44 — Hosted UI: expense capture (test plan)

Expands `mut-44-expense-capture.md` §8/§6a into concrete cases. TDD: each case is written and watched red before the code that makes it green.

## 1. Shared extraction — `src/components/expenses/`

- `expenseFormSchema.test.ts`: valid shape passes; amount regex rejects `abc`, `-1`, `1.999`, empty; accepts `0.5`, `12`, `12.50`; category required; title/vendor/notes optional.
- `ExpenseFormFields.test.tsx` (presentational, no host): renders all fields in the §6a order; required-field errors render on submit with empty category; calls `onSubmit`-equivalent with the typed shape; accepts `clientField`/`projectField` slots and renders them where the local/hosted hosts place client/project today.

## 2. Local regression — `src/components/__tests__/`

- `ExpenseDrawer.projectField.test.tsx` — **unmodified**, must stay green through the whole extraction. This is the hard gate; a diff to this file beyond whitespace is a build failure.
- New `ExpenseDrawer.oneTimeFields.test.tsx`: real Dexie round-trip (same harness as the existing file) covering what nothing today exercises — amount persists as `amountMinor` via `parseAmountToMinor`, currency select, date, title, vendor typeahead create-new flow still works, category required-validation still blocks submit, notes persists. Confirms the extraction changed *where* the JSX lives, not *what* it does.
- Recurring-mode fields (frequency/startDate/endMode/endDate, outside `ExpenseFormFields`) stay exercised by whatever recurring coverage exists today — explicitly not touched by this ticket.

## 3. Hosted API client — `src/hosted/api/__tests__/client.test.ts`

- `request()` sends `idempotency-key` header on POST when provided, omits it when not.
- `request()` sends `if-match: <version>` on PATCH when provided.
- `api.createExpense` round-trips `CreateExpenseRequest` shape; 422/409 surface as `ApiError` with `.code`/`.details` intact (existing `toApiError` path, no new error handling needed — just new call sites).
- `api.expenseCategories`, `api.expenses` (list), `api.expense` (get), `api.deleteExpense`, `api.startReceipt`/`completeReceipt`/`deleteReceipt`/`receiptDownload`, `api.expenseSummary` — each one function, one assertion that it hits the right path/method/profile header, per the existing file's style.

## 4. Hosted hooks — `src/hosted/hooks/__tests__/useExpenseQueries.test.tsx`

Using the existing MSW-or-equivalent harness (`src/hosted/__tests__/harness.tsx`):
- `useExpenses`: cursor pagination behaves like `usePayments` (reuse that test's shape).
- `useExpenseCategories`: plain fetch, like `useCustomerDirectory`.
- `useCreateExpense`: on success, invalidates `profileKey(profileId,'expenses',...)` and `profileKey(profileId,'summary','expenses')`; generates a fresh `Idempotency-Key` per call (two calls, two different keys — proves no accidental reuse/caching of the key).
- `useUpdateExpense`: sends the current `version` as `If-Match`; on 409, surfaces the error without invalidating stale data.
- `useDeleteExpense`: invalidates the same keys as create.

## 5. Hosted pickers — `src/hosted/components/__tests__/`

- `ClientPicker.test.tsx` / `ProjectPicker.test.tsx`: options come from `useCustomerDirectory`/`useProjectDirectory`; typing a name with no match renders **no** "create new" option (the behavioral difference from local's `ClientTypeahead`/`ProjectTypeahead` — this is the test that would catch someone copy-pasting the local component by mistake).

## 6. Hosted drawer — `src/hosted/components/__tests__/ExpenseDrawer.test.tsx`

- Create mode: `?newExpense=1` opens it empty, save calls `useCreateExpense`, closing clears the param.
- Edit mode: `?expense=<id>` opens it populated from `useExpense`(-equivalent single fetch), blocked behind a spinner until the fetch resolves (§6a point 3) — assert nothing renders with partial data.
- Escape key and overlay click both close it (§6a point 5); focus returns to the trigger button.
- Each §6a-point-2 error code maps to its field (mock the API to return each code in turn, assert the right field shows the message) or the toast (409, network) — table-driven test over the §6a mapping table.
- Amount input has `dir="ltr"` and lives in a `dir="ltr"` wrapper with the currency control (§6a point 4).
- Receipt cap: with 10 mocked receipts already on the expense, "add" is disabled; with 9, it's enabled.

## 7. Hosted list — `src/hosted/pages/__tests__/views.test.tsx` (extends the existing file)

- Populated: table renders expected columns/rows, same shape assertions as `PaymentsList`'s existing tests.
- Empty (no data): `Empty` with the "Record expense" primary action, which opens the drawer.
- Narrowed-filter empty: `NoMatch` with "clear filters".
- "+ Record expense" button opens the drawer in create mode and sets `?newExpense=1`.

## 8. i18n / RTL

- Existing `i18n/__tests__/parity.test.ts` extended coverage is automatic (it diffs the two JSON files) — no new test needed, just don't let a key go in one file without the other.
- Whatever RTL check MUT-43 already runs, extended to cover the new drawer (reuse, not duplicate).

## 9. Bundle / lint guards

- Existing `check-bundles`-style test(s) continue to pass with the new hosted files (nothing in `src/hosted/**` imports `db`/`sync`/`hooks` (app's) /`components/layout`/`components/drawers`/`lib/stores`/`lib/toastStore` — the eslint rule enforces this at lint time, not as a separate test, but `npm run build:hosted` + the bundle check must still pass clean).

## Commands

`npm run test:run`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run hosted:types:check` (expense paths already exist in `schema.d.ts` from MUT-42; this just confirms no drift), `npm run test:bundles` (MUT-43's bundle/import-boundary check).
