# Design Brief: MUT-5, the income entry is the work record (3-field fast path)

- **Date:** 2026-10-11
- **Epic:** MUT-1. The parent brief is `.claude/designs/mut-1-client-accounting-core.md` §4, Phase 3.
- **Ticket:** https://barmajiyat.atlassian.net/browse/MUT-5
- **Blocker:** MUT-19 was fixed in code on 2026-10-08 (`9c10354`, MUT-1 Phase 0). On main `b9f0bfc`, `IncomeDrawer.test.tsx` has 16 passing and 1 skipped. Jira still shows MUT-19 as To Do.
- **Status:** draft. D1–D4 need Basel's approval.
- **Test plan:** `.claude/designs/mut-5-income-fast-path-tests.md`

---

## 1. Problem

`src/components/drawers/IncomeDrawer.tsx` lays out its fields in this order:

1. profile\*
2. status segment
3. amount\*
4. currency\*
5. date\*
6. due date
7. client
8. project
9. title
10. notes

Title is second to last, and title is the work record ("what did you do"). Logging "logo redesign for Acme, $1,200" means a trip through the whole form.

Acceptance criteria: as written on MUT-5 (nine checkboxes plus the RTL, i18n, keyboard and no-new-drawer guardrails).

## 2. What the audit found beyond the ticket

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| A1 | **Arabic-Indic digits are stripped, not parsed.** "١٢٠٠" parses to 0. `parseCurrencyInput` and `parseAmountToMinor` are byte-identical duplicates. | `src/lib/utils.ts:53,63` keep only `[0-9.-]` | AC8 ("existing parseCurrencyInput cases … Arabic-Indic digits") describes behaviour that doesn't exist. The parser has to be extended. |
| A2 | The amount input is `type="number"`. Browsers reject "1,200" and Arabic digits before the parser ever sees them. | `IncomeDrawer.tsx:362` | Switch to `type="text" inputMode="decimal" dir="ltr"`. |
| A3 | "12,5" parses to 1250 and "1.200,50" parses to 1.2005, both silently. | same regex | Use a strict grammar. Anything ambiguous gets a field error, never a guess. |
| A4 | **The keyboard path is broken.** Enter on a closed list re-opens it, so Enter never submits. Typing highlights nothing, so Enter picks nothing when more than one option matches. | `src/components/ui/EntityTypeahead.tsx:74-77, 92-98` | This is a shared-component fix (E1). |
| A5 | **The edit path rewrites payment tracking.** `onSubmit` sends `paidAt: now` for every paid entry and `receivedAmountMinor: undefined` for every unpaid one. `transactionRepo.update` writes both as given. | `IncomeDrawer.tsx:198-199`, `src/db/repository.ts:352-373` | Retitling a paid job moves its payment date to today, which changes Home → Recent payments and the client's Last payment. Retitling a part-paid job erases what was received: Owed Now is overstated until the next payment recalculates it, while its `PaymentRecord`s survive. See D2. |
| A6 | The currency default is hardcoded to `'USD'`. The schema allows EUR but the select doesn't offer it. `BusinessProfile.defaultCurrency` is never read. | `:115`, `:380-381` | Default to the profile's currency; add EUR. |
| A7 | **Several openers don't resolve a profile:** the client profile's Add income, the Home empty state, and `/transactions`. In All Profiles mode `initialProfileId` is `''`, so the required profile field would sit hidden behind More details. | `ClientWorkSection.tsx:78`, `OverviewPage.tsx:70`, `TransactionsPage.tsx:181`, `IncomeDrawer.tsx:86-92` | E4 |
| A8 | `.input-with-prefix` and `.input-prefix` have no CSS anywhere. The payment drawer's currency prefix renders unstyled today. | `find src -name '*.css'` finds no rule | E5. Adding the styles fixes both drawers. |
| A9 | The edit-mode test is skipped. | `IncomeDrawer.test.tsx:358` `it.skip` | AC7 needs edit-mode coverage, so un-skip it. |
| A10 | Nothing autofocuses: `Drawer` has no focus management. | `src/components/drawers/Drawer.tsx` | Focus the title in create mode. |

## 3. Decisions

**Locked by the ticket and the epic:**
- No new drawer component.
- No schema change and no migration.
- Project is never required.
- Every existing field stays reachable.

### D1: where the Earned / Invoiced / Received segment goes

The ticket doesn't place it.

- **Recommended:** keep it visible as the compact segment above the title. "I did X and got paid" (Received) is a first-class way to log work, and hiding it would turn the most common paid log into a detour.
- **Alternatives:** move it inside More details, or show it as a chip in the defaults line.

### D2: payment fields on edit (A5)

**Recommended:** fix A5 in MUT-5. The fix is a small pure write-rule with no migration. The rule, `buildIncomeWrite`:

| Transition | Write |
|---|---|
| create | as today |
| paid → paid | keep the existing `paidAt`. `receivedAmountMinor` = the amount. |
| unpaid → unpaid | omit `paidAt` and `receivedAmountMinor`, so both are preserved. An amount below what was already received is a field error (ADR-030 spirit). |
| unpaid → paid | as today: `paidAt` = now, received = the amount. Backdating belongs to MUT-18. |
| paid → unpaid | as today: clear both. The MUT-19 test covers it. |

TD-029 (write a `PaymentRecord` on create-as-received, plus a backfill) goes to its own ticket: it needs a Dexie upgrade, which MUT-5 scopes out.

**Alternatives:** fold all of TD-029 in, which contradicts the ticket's no-migration scope; or leave A5 to a separate bug.

### D3: when More details opens in edit mode

AC7 says "expanded when any of those fields has a value". Date, currency and profile always have one, so read literally, More details would always be open in edit mode.

- **Recommended:** expand when any of these holds:
  - due date, project or notes is set;
  - the currency differs from the profile's default;
  - the profile couldn't be resolved.

  Otherwise it stays collapsed, and the defaults line shows the date, currency and profile.
- **Alternative:** always expanded in edit mode.

### D4: required fields

- **Recommended:** amount only, as today. Title and client stay optional, so no new required fields, and legacy entries without a title or client remain saveable.
- **Alternatives:** require a title on create; or require a title and client on create.

### Engineering calls (no decision needed)

- **E1, `EntityTypeahead` keyboard.**
  - Typing highlights the first option, and Enter on an open list picks it.
  - Enter on a closed list is no longer swallowed, so it falls through to form submission. ArrowDown still opens the list.
  - The change is shared, so all five consumers get it: Client, Project and Vendor typeahead, plus hosted ClientPicker and ProjectPicker.
  - The keyboard path is: title, Tab, amount, Tab, type the client, Enter to pick, Enter to save.
- **E2, one amount parser.**
  - New `parseAmountInput(raw): number | null` in `src/lib/utils.ts`.
  - It normalizes first:
    - Arabic-Indic U+0660–0669 and Extended U+06F0–06F9 digits become ASCII;
    - U+066B becomes `.`;
    - U+066C and U+060C become `,`;
    - whitespace, NBSPs, bidi marks and currency symbols are stripped.
  - Grammar: `^-?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$`. Rounding stays `Math.round(n*100)`, as today.
  - `parseAmountToMinor` and `parseCurrencyInput` become `parseAmountInput(v) ?? 0` wrappers. `formatCurrencyInput` normalizes digits first, so the payment drawer accepts Arabic digits for free.
- **E3, currency follows the profile.** In create mode, currency follows the selected profile's `defaultCurrency` (falling back to settings, then USD) until the user touches the currency field (RHF `dirtyFields`).
- **E4, profile visibility.**
  - When the profile is unresolved (A7), the profile select moves into the fast path.
  - Any invalid field inside More details auto-expands it, through `handleSubmit`'s `onInvalid`.
- **E5, prefix styles.** `.input-with-prefix` styles go into `src/index.css` using logical properties.
- **E6, pure helpers.** New module `src/lib/incomeEntry.ts` holds `buildIncomeWrite`, `shouldExpandDetails` and `resolveDefaultCurrency`. They are pure and unit-tested without React, and the drawer only wires them.
- **E7, validation messages.** Zod messages become i18n keys rendered with `t()`. Today each field hardcodes one key regardless of the error.

## 4. Proposed solution

```
┌ New Income ──────────────────────────────────────┐
│ [ Earned | Invoiced | Received ]          (D1)   │
│ What did you do?  [ Logo redesign            ]   │ ← autofocus (create)
│ Amount            [ USD │ 1,200              ]   │ ← text + inputMode=decimal, dir=ltr
│ Client            [ Acme…                  ▾ ]   │ ← ClientTypeahead (prefilled from a client profile)
│ Profile           [ select ]   ← only when unresolved (E4)
│ ▸ More details · USD · 11 Oct 2026 · Studio      │ ← <button aria-expanded>, defaults visible
│   ┊ Currency [USD | ILS | EUR]   Date [ … ]      │
│   ┊ Due date (not for Received)                  │
│   ┊ Project (only while the Projects area is on) │
│   ┊ Notes                                        │
│   ┊ Profile (when resolved)                      │
└────────────────────────────── [Cancel] [Save] ───┘
```

The profile name appears in the defaults line only when more than one profile exists. Locked-entry behaviour (MUT-13) is unchanged.

```
IncomeDrawer (same file, restructured)
 ├─ Drawer
 ├─ ClientTypeahead ─┐
 ├─ ProjectTypeahead ┴─ EntityTypeahead (E1)
 ├─ useClientProjectCascade, useActiveProfile, useBusinessProfiles, useSettings
 └─ src/lib/incomeEntry.ts  (buildIncomeWrite · shouldExpandDetails · resolveDefaultCurrency)
      └─ src/lib/utils.ts parseAmountInput (E2)
```

## 5. Contracts and error states

```
parseAmountInput(raw: string) -> number | null      // minor units; null = not a number we will guess at
buildIncomeWrite(form, existing?) -> Partial<Transaction>   // D2 rules
shouldExpandDetails(tx, profileDefaultCurrency) -> boolean  // D3
resolveDefaultCurrency(profile?, settings?) -> Currency     // profile → settings → 'USD'
```

| Input | Error key |
|---|---|
| empty | `validation.amountRequired` |
| unparseable or ambiguous | `validation.amountInvalid` |
| ≤ 0 | `validation.amountPositive` |
| edit below the amount already received | `validation.amountBelowReceived` (shows the received amount) |
| missing profile | `validation.profileRequired` (existing key) |

All of these are field-level. Nothing throws. Save failures keep today's behaviour: logged, and the drawer stays open.

## 6. Reuse (COMPONENT_REGISTRY)

**Reused:**
- `Drawer`, `ClientTypeahead`, `ProjectTypeahead`, `EntityTypeahead` (patched)
- `useClientProjectCascade`, `useActiveProfile`, `useBusinessProfiles`, `useSettings`
- `.type-selector`
- the `input-with-prefix` markup from `PartialPaymentDrawer`

**New:** only the pure helpers module. No new component.

**Registry drift:** COMPONENT_REGISTRY lists the legacy `TransactionDrawer` and has no `IncomeDrawer` entry. Add one, and record `EntityTypeahead`'s keyboard contract.

## 7. Impact

| Area | Change |
|---|---|
| `IncomeDrawer.tsx` | Field order, disclosure, defaults line, validation, write rules |
| `EntityTypeahead.tsx` | Keyboard (E1). Five consumers inherit it. |
| `src/lib/utils.ts` | Parser (E2). Wrapper callers: Expense, PartialPayment, PlanAssumption and Retainer drawers. Only previously silently-wrong inputs ("12,5", "1,2,3") change, to 0 or an error. |
| `src/lib/incomeEntry.ts` | New pure module |
| `src/index.css` | `.input-with-prefix`, disclosure row |
| `en.json` / `ar.json` | New keys (§8) |
| Repo, schema, sync | **No change** |

## 8. i18n and RTL

New keys, in both locales:
- `drawer.income.titleLabel` ("What did you do?")
- `drawer.income.titlePlaceholder`
- `drawer.income.moreDetails`
- `drawer.income.lessDetails`
- `validation.amountInvalid`
- `validation.amountPositive`
- `validation.amountBelowReceived`

RTL handling:
- The amount group is `dir="ltr"`, so the code-then-number order holds in Arabic. That matches the epic rule "amounts LTR inside RTL".
- The defaults line formats the date with the active locale (`formatLocalDate`).
- The disclosure chevron mirrors in RTL.

## 9. Cost and infra

None: local Dexie only, no new dependencies, no network.

## 10. Verification

Commands, run in the worktree:

```bash
npx vitest run
npm run test:tz
npm run lint
npx tsc -b
npm run build
```

Browser pass on the worktree dev server (port 5191), in English and Arabic:
- the keyboard-only path;
- All Profiles mode opened from a client profile;
- editing a paid entry and a part-paid entry, checking `paidAt` and the received amount are unchanged.
