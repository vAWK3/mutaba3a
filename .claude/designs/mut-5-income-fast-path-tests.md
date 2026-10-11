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

## Unit: `src/lib/__tests__/incomeEntry.test.ts` (new; D2, D3, E3)

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

### `amountBelowReceived` guard

- An edit to 400 with 500 already received is an error.
- An edit to 500 with 500 received is OK.

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

## Component: `src/components/ui/__tests__/EntityTypeahead.test.tsx` (E1)

- Typing highlights the first option (`aria-selected="true"`), and Enter selects it.
- After a selection, with the list closed, Enter is not `defaultPrevented`, and an enclosing `<form>` receives `submit`.
- ArrowDown on a closed list still opens it.
- Escape closes the list. The existing tests stay green.

## Component: `src/components/__tests__/IncomeDrawer.test.tsx`

### Fast path

| AC | Case |
|---|---|
| AC1 | Fill only title, amount and client, then Save. The written tx has the active `profileId`, the profile's default currency, `occurredAt` = today, `status: 'unpaid'`, and no `projectId`. |
| AC2 | The defaults line shows the currency code and today's date. With two profiles it also shows the profile name. |
| AC2 | A profile whose default is ILS saves ILS. Changing the profile in More details moves an untouched currency to the new profile's default, but not after the user picked a currency. |
| AC3 | More details: `aria-expanded="false"`. Currency, date, due date, project, notes and profile are absent until the toggle is clicked, then all are present. Project appears only while the Projects area is on. |
| AC4 | `defaultClientId` → the client name is shown in the client field. With no `defaultClientId` the field is empty. |
| AC5 | No project → saves with `projectId` undefined. |
| AC6 | Title with no amount → the `validation.amountRequired` text, no transaction written, nothing thrown. "12,5" → `amountInvalid`. "0" → `amountPositive`. |
| AC7 | Edit with notes → More details expanded. Edit with only the core fields and the profile's default currency → collapsed (D3). Un-skip and fix "should load existing transaction in edit mode". |
| AC8 | Amount "١٬٢٠٠" saves `amountMinor` 120000. |
| AC9 | The three MUT-19 tests stay green. They may only change to open More details first; their assertions are not weakened. |
| (E4) | **All Profiles mode** with no `defaultProfileId` and two profiles: the profile select is in the fast path, and saving without it shows `validation.profileRequired`. |
| (E4) | An invalid field inside More details auto-expands it. |
| — | EUR is selectable and saved. |
| — | Regression: a locked entry still shows the notice, and Save stays disabled. |

### Keyboard (guardrail)

- Focus starts in the title in create mode.
- Tab → amount, Tab → client.
- Type the client, Enter picks it, Enter saves.
- **Risk:** `user-event` may not perform implicit submission when the submit button sits outside the `<form>` (via the `form=` attribute; the Drawer footer). If it can't, the unit test asserts the E1 contract (Enter not prevented on a closed list), and the full path moves to a Playwright spec (`e2e/`, with a temporary config pointed at the worktree dev server).

### Payment fields on edit (D2)

- Edit a paid entry's title → `paidAt` unchanged at the repository level.
- Edit a part-paid unpaid entry's title (with a `PaymentRecord`) → `receivedAmountMinor` unchanged.
- Edit that entry's amount to below what was received → `amountBelowReceived` error, and nothing is written.

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
