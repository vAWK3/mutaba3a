# Test Plan: MUT-5, income fast path

Brief: `.claude/designs/mut-5-income-fast-path.md`. TDD: the tests in each block are written first and must fail (red) before any implementation.

**Baseline on main `b9f0bfc`:** `IncomeDrawer.test.tsx` has 16 passing and 1 skipped.

---

## Unit: `src/lib/__tests__/utils.test.ts` (`parseAmountInput`, E2)

**Accepted inputs:**

| Input | Result |
|---|---|
| `"1200"` | 120000 |
| `"1,200.50"` | 120050 |
| `"0.5"` | 50 |
| `"١٢٠٠"` | 120000 |
| `"١٬٢٠٠٫٥٠"` | 120050 |
| `"۱۲۰۰"` (Extended Arabic-Indic) | 120000 |
| `" $ 1,200 "` | 120000 |
| `"₪100"` | 10000 |
| `"‏١٠٠"` (with an RLM mark) | 10000 |
| `"-50"` | -5000 |

**Rejected inputs** (each returns `null`): `"12,5"`, `"1.200,50"`, `"1.2.3"`, `""`, `"abc"`, `"1,2,3"`.

**Unchanged behaviour:**
- Every existing `parseCurrencyInput` and `parseAmountToMinor` case still passes.
- `formatCurrencyInput("١٢.٥")` → `"12.5"`.

## Unit: `src/lib/__tests__/incomeEntry.test.ts` (new; P2, P3, E3)

### `buildIncomeWrite`

| Case | Expected write |
|---|---|
| create as Earned | `status: 'unpaid'`, no `paidAt` |
| create as Invoiced | `status: 'unpaid'`, no `paidAt` |
| create as Received | `status: 'paid'`, `paidAt` = now, received = the amount |
| paid → paid edit | `paidAt` stays as the existing value, **not** now |
| unpaid → unpaid edit | `paidAt` and `receivedAmountMinor` are absent from the write |
| unpaid → paid edit | `paidAt` = now, received = the amount |
| paid → unpaid edit | `paidAt` and `receivedAmountMinor` cleared |
| any transition to Received | due date dropped |
| any edit, `hasRecords: true` | `status`, `paidAt` and `receivedAmountMinor` all absent from the write |
| every edit case | asserted with `!('paidAt' in write)`, not `toBeUndefined()` (review A2) |

### Recorded-total guard (`amountBelowRecorded`)

- An edit to 400 with 500 recorded is an error.
- An edit to 500 with 500 recorded is OK.
- With no records, any positive amount is OK.

### `shouldExpandDetails`

- Expands when:
  - only notes is set;
  - only a due date is set;
  - only a project is set;
  - the currency differs from the profile's default;
  - the profile is empty.
- Stays collapsed when only title, amount, client and date are set and the currency is the profile's default.

### `resolveDefaultCurrency`

- With a profile whose default is ILS → ILS.
- With no profile, settings default EUR → EUR.
- Neither → USD.

## Repository: `src/db/__tests__/paymentRecords.test.ts` (P2, R2)

- `transactionRepo.update` with `amountMinor` below the live recorded total throws `PaymentRecordError`, and the row is unchanged.
- Unpaid entry with 500 recorded, amount 1000 → 500: the entry becomes `status: 'paid'`, `receivedAmountMinor` 500, and `paidAt` is set.
- Paid entry (records total 1000), amount 1000 → 1200: the entry becomes `status: 'unpaid'` with `receivedAmountMinor` 1000.
- An amount change on an entry **without** records triggers no recalculation (`receivedAmountMinor` untouched).
- A non-amount edit (title) on a record-backed entry triggers no recalculation.
- Soft-deleted records don't count toward the total.
- The existing ADR-030 "locked transactions" and overpayment tests stay green.

## Component: `src/components/ui/__tests__/EntityTypeahead.test.tsx` (E1, R4 regression contract)

**Intentional changes:**
- Typing highlights the first option (`aria-selected="true"`), and Enter selects it.
- After a selection, with the list closed, Enter is not `defaultPrevented`, and an enclosing `<form>` receives `submit`.
- Escape on an open list closes it and the event doesn't reach a `document` keydown listener (so the drawer stays open).

**Preserved, each pinned by a test:**
- click to pick
- the create-new option is picked with Enter when it's the only option
- ArrowDown on a closed list opens it
- Tab closes the list without picking

**Consumers rerun unchanged:** `src/hosted/components/__tests__/ClientPicker.test.tsx`, `ProjectPicker.test.tsx`, `ExpenseDrawer.test.tsx`, and the VendorTypeahead consumers (`ExpenseDrawer.*.test.tsx`).

## Component: `ClientTypeahead` (P5, R8). Cases live in `src/components/ui/__tests__/ClientTypeahead.test.tsx` (new) or the existing EntityTypeahead suite.

- Typing "acme corp" for the existing "Acme Corp" and blurring picks it (`onChange` gets its id).
- Typing "Acm" and blurring picks nothing, and `onPendingTextChange("Acm")` fires.
- Clearing the box fires `onPendingTextChange("")` and `onChange("")`.

## Component: `src/components/__tests__/IncomeDrawer.test.tsx`

### Fast path

| AC | Case |
|---|---|
| AC1 | Fill only title, amount and client, then Save. The written tx has the active `profileId`, the profile's default currency, `occurredAt` = today, `status: 'unpaid'`, and no `projectId`. |
| AC2 | The defaults line shows the status (Earned), the currency code and today's date. With two profiles it also shows the profile name. |
| AC2 | A profile whose default is ILS saves ILS. Changing the profile in More details moves an untouched currency to the new profile's default, but not after the user picked a currency. |
| AC3 | More details: `aria-expanded="false"`. The status switch, currency, date, due date, project, notes and profile are absent until the toggle is clicked, then all are present (P1). Project appears only while the Projects area is on. |
| AC4 | `defaultClientId` → the client name is shown in the client field. With no `defaultClientId` the field is empty. |
| AC5 | No project → saves with `projectId` undefined. |
| AC6 | Title with no amount → the `validation.amountRequired` text, no transaction written, nothing thrown. "12,5" → `amountInvalid`. "0" → `amountPositive`. |
| AC7 | Edit with notes → More details expanded. Edit with only the core fields and the profile's default currency → collapsed (P3). Un-skip and fix "should load existing transaction in edit mode". |
| AC8 | Amount "١٬٢٠٠" saves `amountMinor` 120000. |
| AC9 | The three MUT-19 tests stay green. They may only change to open More details first; their assertions are not weakened. |
| (E4) | **All Profiles mode** with no `defaultProfileId` and two profiles: the profile select is in the fast path, and saving without it shows `validation.profileRequired`. |
| (E4) | An invalid field inside More details auto-expands it. |
| — | EUR is selectable and saved. |
| (P5) | Type "Acm", don't pick, Save → the `validation.clientNotPicked` text, and nothing is written. Type the exact name of an existing client, Tab away, Save → saved with that `clientId`. |
| (T3) | The amount group renders with `dir="ltr"` (RTL guardrail). |
| (T2) | i18n parity: every new `drawer.income.*` and `validation.*` key exists and is non-empty in both `en.json` and `ar.json`. |
| (P1) | Received chosen in More details saves `status: 'paid'`, and the due date field hides. |
| — | Regression: a locked entry still shows the notice, and Save stays disabled. |

### Keyboard (guardrail)

- Focus starts in the title in create mode.
- Tab → amount, Tab → client.
- Type the client, Enter picks it, Enter saves.
- **Unit level:** focus order, plus the E1 contract (Enter not prevented on a closed list). Confirmed limitation: user-event 14.6.1 (`keypress.js`) only finds submit buttons *inside* the `<form>`, and the drawer's Save is `form=`-linked from the footer.
- **E2E (approved: R3 = A):** `e2e/income-fast-path.spec.ts` covers the whole path in Chromium:
  1. open the income drawer;
  2. type the title, press Tab, type the amount, press Tab;
  3. type the client, press Enter to pick it, press Enter again to save;
  4. assert the drawer closes and the entry is listed.

  It runs through a temporary Playwright config pointed at the worktree dev server on port 5191 (`playwright.config.ts` pins 5173, TD-004).

### Payment fields on edit (P2, R2)

- Edit a drawer-paid entry's title (no records) → `paidAt` unchanged at the repository level.
- Edit a part-paid unpaid entry's title (with a `PaymentRecord`) → `receivedAmountMinor` unchanged.
- **Record-backed entry:**
  - the status switch is disabled and the `drawer.income.paymentsRecordedHint` text shows;
  - an amount below the recorded total → `amountBelowRecorded` error, and nothing is written;
  - an amount raised above the recorded total → after save, the entry is unpaid with the difference owed.

## Manual (browser, worktree dev server on port 5191)

- **English and Arabic:** keyboard-only path, amount group LTR with the affix placement, chevron mirrored, defaults line localized.
- **All Profiles mode:** client profile → Add income.
- **Payment drawer:** the prefix now renders styled (A8), and Arabic digits are accepted.

## Gate

```bash
npx vitest run
npm run test:tz
npm run lint
npx tsc -b
npm run build
```

All must be green, and there must be no new skips.
