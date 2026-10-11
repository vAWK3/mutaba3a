# Design Brief: MUT-5, the income entry is the work record (3-field fast path)

- **Date:** 2026-10-11
- **Epic:** MUT-1. The parent brief is `.claude/designs/mut-1-client-accounting-core.md` §4, Phase 3.
- **Ticket:** https://barmajiyat.atlassian.net/browse/MUT-5
- **Blocker:** MUT-19 was fixed in code on 2026-10-08 (`9c10354`, MUT-1 Phase 0). On main `b9f0bfc`, `IncomeDrawer.test.tsx` has 16 passing and 1 skipped. Jira still shows MUT-19 as To Do.
- **Status:** decisions approved 2026-10-11 (P1–P4 and eng review R1–R8; see the Decision ledger). Awaiting Basel's go-ahead to build.
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
| A5 | **The edit path rewrites payment tracking.** `onSubmit` sends `paidAt: now` for every paid entry and `receivedAmountMinor: undefined` for every unpaid one. `transactionRepo.update` writes both as given. | `IncomeDrawer.tsx:198-199`, `src/db/repository.ts:352-373` | Retitling a paid job moves its payment date to today, which changes Home → Recent payments and the client's Last payment. Retitling a part-paid job erases what was received: Owed Now is overstated until the next payment recalculates it, while its `PaymentRecord`s survive. See P2. |
| A6 | The currency default is hardcoded to `'USD'`. The schema allows EUR but the select doesn't offer it. `BusinessProfile.defaultCurrency` is never read. | `:115`, `:380-381` | Default to the profile's currency; add EUR. |
| A7 | **Several openers don't resolve a profile:** the client profile's Add income, the Home empty state, and `/transactions`. In All Profiles mode `initialProfileId` is `''`, so the required profile field would sit hidden behind More details. | `ClientWorkSection.tsx:78`, `OverviewPage.tsx:70`, `TransactionsPage.tsx:181`, `IncomeDrawer.tsx:86-92` | E4 |
| A8 | `.input-with-prefix` and `.input-prefix` have no CSS anywhere. The payment drawer's currency prefix renders unstyled today. | `find src -name '*.css'` finds no rule | E5. Adding the styles fixes both drawers. |
| A9 | The edit-mode test is skipped. | `IncomeDrawer.test.tsx:358` `it.skip` | AC7 needs edit-mode coverage, so un-skip it. |
| A10 | Nothing autofocuses: `Drawer` has no focus management. | `src/components/drawers/Drawer.tsx` | Focus the title in create mode. |

## 3. Decisions

**Locked by the ticket and the epic:**
- No new drawer component.
- No schema change and no migration. (A repository *code* change is approved under P2; there is still no Dexie version bump.)
- Project is never required.
- Every existing field stays reachable.

### P1: the Earned / Invoiced / Received switch lives inside More details (approved: R5 = B)

- New entries default to Earned, or to the opener's `defaultStatus`. A duplicate defaults to Invoiced, as today.
- The defaults line names the current status, so AC2's "defaults are visible" still holds: `Earned · USD · 11 Oct 2026 · Studio`.
- The due date sits next to the switch and hides for Received, as today.

### P2: payment fields on edit; records own payment state (approved: R2 = A)

**Entries with no live `PaymentRecord`** (`buildIncomeWrite`, pure):

| Transition | Write |
|---|---|
| create | as today |
| paid → paid | keep the existing `paidAt`. `receivedAmountMinor` = the amount. |
| unpaid → unpaid | `paidAt` and `receivedAmountMinor` **absent from the write** (not `undefined`: Dexie deletes `undefined` keys). |
| unpaid → paid | `paidAt` = now, received = the amount. Backdating is MUT-18. |
| paid → unpaid | clear both, as today (MUT-19 test). |

**Entries with live `PaymentRecord`s** (read with `usePaymentRecords(txId)`):
- The status switch is read-only in edit, with a hint: "Payments are recorded for this entry. Manage them from the client page."
- The write never carries `status`, `paidAt` or `receivedAmountMinor`.
- An amount below the recorded total is a field error (`validation.amountBelowRecorded`, showing the total).
- `transactionRepo.update` also rejects it (ADR-030; the drawer check only turns it into a translated message).
- When `amountMinor` changes, `transactionRepo.update` runs `recalculateReceivedAmount` in the same Dexie transaction. An unpaid entry cut to exactly its recorded total becomes paid, and a paid entry raised above it becomes unpaid with the difference owed.

TD-029 (write a `PaymentRecord` on create-as-received, plus a backfill) moves to its own ticket.

### P3: More details in edit mode (approved: R6 = A)

`shouldExpandDetails` returns true when any of these holds:
- a due date, project or notes is set;
- the currency differs from the profile default;
- the profile is missing.

Status is not part of the rule; the defaults line shows it.

### P4: required fields (approved: R7 = amount only)

- Amount only, as today. Title and client stay optional.
- Basel asked how a Malafat client, matter or task could feed these fields. That is answered separately and proposed as a follow-up under MUT-25; it is not MUT-5 scope.
- MUT-5 keeps the client field on `EntityTypeahead`, whose option source is swappable (hosted `ClientPicker` already feeds it Malafat-linked customers), and keeps the title as free text. A later suggestion source needs no rework.

### P5: a client typed but not picked (approved: R8 = A)

- `ClientTypeahead` picks an exact, case-insensitive name match on blur. This applies to every client picker.
- An optional `onPendingTextChange` callback reports any remaining unpicked text. The income drawer then refuses to save with `validation.clientNotPicked` ("Pick a client from the list, or press Enter to create it").

### Engineering calls (no decision needed)

- **E1, `EntityTypeahead` keyboard.**
  - Typing highlights the first option, and Enter on an open list picks it.
  - Enter on a closed list is no longer swallowed, so it falls through to form submission. ArrowDown still opens the list.
  - Escape on an open list closes only the list (`stopPropagation`), so the drawer's document-level Escape no longer discards the form.
  - The change is shared (approved: R4 = A), so all five consumers get it: Client, Project and Vendor typeahead, plus hosted ClientPicker and ProjectPicker.
  - Preserved and pinned by tests: click to pick, create-new, ArrowDown opens, Tab closes.
  - The keyboard path is: title, Tab, amount, Tab, type the client, Enter to pick, Enter to save.
  - It is proven end to end by a Playwright spec (approved: R3 = A), because user-event can't submit through a `form=`-linked button.
- **E2, one amount parser.**
  - New `parseAmountInput(raw): number | null` in `src/lib/utils.ts`.
  - It normalizes first:
    - Arabic-Indic U+0660–0669 and Extended U+06F0–06F9 digits become ASCII;
    - U+066B becomes `.`;
    - U+066C and U+060C become `,`;
    - whitespace, NBSPs, bidi marks and currency symbols are stripped.
  - Grammar: `^-?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$`. Rounding stays `Math.round(n*100)`, as today.
  - `parseAmountToMinor` and `parseCurrencyInput` become `parseAmountInput(v) ?? 0` wrappers. `formatCurrencyInput` normalizes digits first, so the payment drawer accepts Arabic digits for free.
  - Review S1 verified that every other wrapper caller feeds `type="number"` input or pre-cleaned input, so no realistic input changes behaviour.
- **E3, currency follows the profile.** In create mode, currency follows the selected profile's `defaultCurrency` (falling back to settings, then USD) until the user touches the currency field (RHF `dirtyFields`).
- **E4, profile visibility.**
  - When the profile is unresolved (A7), the profile select moves into the fast path.
  - Any invalid field inside More details auto-expands it, through `handleSubmit`'s `onInvalid`.
- **E5, prefix styles.** `.input-with-prefix` styles go into `src/index.css` using logical properties.
- **E6, pure helpers.** New module `src/lib/incomeEntry.ts` holds `buildIncomeWrite`, `shouldExpandDetails` and `resolveDefaultCurrency`. They are pure and unit-tested without React, and the drawer only wires them.
- **E7, validation messages.** Zod messages become i18n keys rendered with `t()`. Today each field hardcodes one key regardless of the error.

## 4. Proposed solution

```
┌ New Income ───────────────────────────────────────────────┐
│ What did you do?  [ Logo redesign                     ]   │ ← autofocus (create)
│ Amount            [ USD │ 1,200                       ]   │ ← text + inputMode=decimal, dir=ltr
│ Client            [ Acme…                           ▾ ]   │ ← ClientTypeahead (prefilled from a client profile)
│ Profile           [ select ]   ← only when unresolved (E4)
│ ▸ More details · Earned · USD · 11 Oct 2026 · Studio      │ ← <button aria-expanded>, defaults visible
│   ┊ [ Earned | Invoiced | Received ]   (P1; read-only    │
│   ┊                                     if records, P2)   │
│   ┊ Due date (not for Received)                           │
│   ┊ Currency [USD | ILS | EUR]   Date [ … ]               │
│   ┊ Project (only while the Projects area is on)          │
│   ┊ Notes                                                 │
│   ┊ Profile (when resolved)                               │
└─────────────────────────────────────── [Cancel] [Save] ───┘
```

The profile name appears in the defaults line only when more than one profile exists. Locked-entry behaviour (MUT-13) is unchanged.

**Edit flow (P2):**

```
open edit ─▶ usePaymentRecords(txId)
              ├─ live records? ── yes ─▶ status read-only; write = {title, client, project, amount, currency, date, due, notes, profile}
              │                          amount < Σrecords ─▶ field error (and repo rejects)
              │                          amount changed ─▶ transactionRepo.update ─▶ recalculateReceivedAmount (same Dexie tx)
              └─ no ─▶ buildIncomeWrite(form, existing)  (P2 table; omitted keys stay untouched)
```

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
buildIncomeWrite(form, existing?, { hasRecords }) -> Partial<Transaction>   // P2 rules; omits keys, never sets undefined
shouldExpandDetails(tx, profileDefaultCurrency) -> boolean                // P3
resolveDefaultCurrency(profile?, settings?) -> Currency                     // profile → settings → 'USD'

transactionRepo.update(id, data)
  + throws PaymentRecordError when data.amountMinor < Σ live records (ADR-030)
  + when data.amountMinor changes and live records exist: recalculateReceivedAmount(id), same Dexie transaction
```

| Input | Error key |
|---|---|
| empty | `validation.amountRequired` |
| unparseable or ambiguous | `validation.amountInvalid` |
| ≤ 0 | `validation.amountPositive` |
| edit below the recorded payments | `validation.amountBelowRecorded` (shows the recorded total) |
| client text typed but not picked | `validation.clientNotPicked` |
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
| `IncomeDrawer.tsx` | Field order, disclosure, defaults line, validation, write rules, record-backed status lock |
| `EntityTypeahead.tsx` | Keyboard (E1). Five consumers inherit it. |
| `ClientTypeahead.tsx` | Exact match picked on blur; optional `onPendingTextChange` (P5) |
| `src/db/repository.ts` | `transactionRepo.update`: rejects an amount below the recorded total, and recalculates on an amount change (P2) |
| `e2e/income-fast-path.spec.ts` | New Playwright spec for the keyboard path (R3), run through a temporary config |
| `src/lib/utils.ts` | Parser (E2). Wrapper callers: Expense, PartialPayment, PlanAssumption and Retainer drawers. Only previously silently-wrong inputs ("12,5", "1,2,3") change, to 0 or an error. |
| `src/lib/incomeEntry.ts` | New pure module |
| `src/index.css` | `.input-with-prefix`, disclosure row |
| `en.json` / `ar.json` | New keys (§8) |
| Schema, sync | **No change.** No Dexie version bump; drawer writes use the raw repo (`provider.ts:123`), not the op-log. |

## 8. i18n and RTL

New keys, in both locales:
- `drawer.income.titleLabel` ("What did you do?")
- `drawer.income.titlePlaceholder`
- `drawer.income.moreDetails`
- `drawer.income.lessDetails`
- `drawer.income.paymentsRecordedHint`
- `validation.amountInvalid`
- `validation.amountPositive`
- `validation.amountBelowRecorded`
- `validation.clientNotPicked`

A parity test asserts every new key exists in both locales (review T2).

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

---

## Build notes (`/eng-build`, 2026-10-11)

The build ran on `feature/mut-1-client-core`, from `0972362` to the final commit. These are the differences from the plan, and why.

- **A7 was partly wrong.** "All Profiles" mode no longer exists: `useActiveProfile` is strict (`isAllProfiles = false`) and always resolves the default or first profile. The profile is therefore unresolved only when no profile exists. E4's fast-path profile select stays as that safety net, and its test uses the no-profile case.
- **`buildIncomeWrite` became `buildIncomeCreate` and `buildIncomeUpdate`.** Each returns a typed write, with no `delete` cast. The rules are unchanged.
- **The currency-follows-profile rule tracks an explicit pick,** not RHF dirtiness. Re-picking the mount-time default isn't dirty, so the old check could still override it.
- **A client typed but not picked** is a `clientDraft` form field validated on its own. Zod 4 changed when object-level refinements run.
- **A race found by the Playwright spec.** Enter-Enter right after "create Acme Studio" submitted while the client was still saving. The typed name counted as unpicked, the save was refused, and the error vanished a moment later. Fix:
  - `ClientTypeahead` treats a picked label, including one being created, as picked;
  - it reports `onCreatingChange`;
  - the drawer holds a save that arrives meanwhile and runs it once the client exists.
- **Two problems found in the Arabic browser pass:**
  - theme.css `:lang(ar) { direction: rtl }` beat `dir="ltr"`. The prefix group now sets `direction: ltr` from selectors that out-rank it.
  - The defaults line reordered under bidi. Each part is now a `<bdi>`.
- **Folded in at Basel's request (scope guard).** A save from the drawer didn't refresh the client profile or `/income`. This was pre-existing: their `income`/`receivables` keys were missing from `useQueries`' invalidation. `invalidateTransactionQueries` is now exported, covers both key families, and is reused by `useIncomeQueries`.
- **Follow-ups filed:**
  - **MUT-60:** TD-029 write side, plus a backfill.
  - **MUT-61:** the Malafat client/matter/task intake.
  - **MUT-62:** a title column in the `/income` ledger, which has none. Basel chose a follow-up.
- **Debt at build time, resolved at the merge with main:** the build logged "cutting an amount to the recorded total stamps `paidAt` with today" as TD-046. Main's `84f2622` (MUT-18, its ADR-038) makes `recalculateReceivedAmount` take `paidAt` from the latest record, so the entry was dropped. MUT-5's decision is **ADR-039**, renumbered at the merge.

---

## Pre-landing review (`/qa-reconcile` → `/review`, 2026-10-11)

**Reviewers:**
- six specialists: testing, maintainability, security, performance, design, simplification;
- a Claude adversarial pass. Three specialists and the adversarial pass were retried after an API outage. The adversarial retry also covered the red team's job: it was given every earlier finding and asked for what they missed.

Codex was unavailable. Basel chose "fix all as recommended".

**What changed against this brief:**
- **P2 / ADR-039 is now enforced in the repository for every caller.** Payment-state fields are stripped and re-derived on a record-backed entry, and a currency change is rejected. The amount check runs only on a real amount change.
- **The E1 keyboard contract was tightened.** Enter is held during an async pick and on unresolved typed text, and a prefix match is highlighted, never a substring. The input points `aria-activedescendant` at the highlighted option.
- **E2 parser:** a currency-token whitelist, space grouping, no leading 0 group, at most 2 decimals in the drawer, safe integers, string math.
- **The drawer waits for payment records,** locks currency once payments are recorded, and toasts a refused save.
- **Due date:** a Received save leaves it untouched (the bug existed before MUT-5 and was fixed here).

**Left as is, with reasons:**
- **Old zero or negative entries can't be saved after edits,** because amounts must be positive. None are expected in the data.
- **Raising the amount of a drawer-paid entry with no payment records counts the larger amount as received.** These entries become record-backed with MUT-60.
- **Some simplifications were offered and not taken:** spreading form values, inlining `isBelowRecordedTotal`, dropping the `invalidateIncomeQueries` wrapper, and merging `parseCurrencyInput` into `parseAmountToMinor`.

---

## Eng review (`/plan-eng-review`, 2026-10-11)

- **Target:** this brief plus `mut-5-income-fast-path-tests.md`, on `feature/mut-1-client-core` at `1f9ae7b`.
- **Report file:** this brief.

### Scope Challenge

**Already exists, and is reused:**
- `PartialPaymentDrawer`'s `input-with-prefix` markup
- `usePaymentRecords(txId)` (`useQueries.ts:221`)
- `assertWithinTransactionTotal` / ADR-030 (`repository.ts:1401`)
- `recalculateReceivedAmount` (`repository.ts:1362`)
- `todayISO()`, which is already local (`utils.ts:220`, MUT-17)
- the AC4 client-profile prefill, covered by `ClientDetailPage.test.tsx:422`

**Complexity:**
- 7 production files (`IncomeDrawer.tsx`, `EntityTypeahead.tsx`, `utils.ts`, **new** `src/lib/incomeEntry.ts`, `index.css`, `en.json`, `ar.json`)
- 4 test files (`IncomeDrawer.test.tsx`, `utils.test.ts`, `EntityTypeahead.test.tsx`, **new** `incomeEntry.test.ts`)
- 11 files and 1 new module in all. That's 8 or more, so the gate trips (D1).

Search: unavailable (Aside not installed). The combobox keyboard model follows WAI-ARIA APG from in-distribution knowledge **[Layer 1]**. No TODOS.md exists: this project tracks follow-ups in Jira and `.claude/TECH_DEBT.md`.

**Findings:**

**S1 [P3] (confidence 9/10), `src/lib/utils.ts:53-68`.** The E2 strict-grammar wrappers change the four other callers.
- *Verified:* every caller feeds `type="number"` input, so none can produce "12,5" or "1,2,3":
  - `PlanAssumptionDrawer.tsx:328`
  - `RetainerDrawer.tsx:334`
  - `ExpenseDrawer.tsx:435` (`amountInputMode="number"`)
  - the payment drawer, through `formatCurrencyInput`, which already strips `,`
- *Disposition:* factual correction. The plan stands with no behaviour change for realistic inputs, and no question is needed.

### Section 1: Architecture

**A1 [P1] (confidence 9/10), `src/db/repository.ts:383-388`.** P2 doesn't cover entries that have payment records.
- `markPaid` with a remaining balance calls `paymentRecordRepo.create(...)`. "Mark paid", "Record payment" and partial payments therefore all leave `PaymentRecord`s.
- P2's paid → unpaid branch clears `receivedAmountMinor` while those records survive. ADR-033 §3 then lists them as payments of an entry that claims to be unpaid.
- Changing the amount of a record-backed entry (`repository.ts:352-373`, `db.transactions.update(id, { ...data })`) never re-runs `recalculateReceivedAmount`. Two failure states follow:
  - an unpaid entry reduced to exactly the recorded total keeps `status: 'unpaid'` with 0 left;
  - one reduced below it is overpaid, which ADR-030 forbids.
- *Disposition:* D2.

**A2 [P2] (confidence 9/10), `IncomeDrawer.test.tsx:444-446`.** "Omit" must mean the key is absent.
- The test comment records that Dexie deletes any key whose value is `undefined`.
- *Disposition:* factual correction. `buildIncomeWrite` leaves the keys out, and a test asserts `!('paidAt' in write)`.
- Sync is not involved: drawer writes go through `getRepositories().base`, which is the raw Dexie repository (`provider.ts:123`), not the synced one.

### Section 2: Code quality

**Q1 [P2] (confidence 9/10), `src/components/ui/ClientTypeahead.tsx:84-112`.** Typed text that is never picked is silently dropped.
- `inputValue` is local state, and `onChange` fires only on a pick or a clear.
- With client in the fast path, typing "Acme" and clicking Save saves the entry with no client.
- *Disposition:* D8.

**Q2 [P2] (confidence 9/10), `src/components/drawers/Drawer.tsx:12-16` and `EntityTypeahead.tsx:100-103`.** Escape on an open list also closes the drawer.
- `Drawer` listens for Escape on `document`.
- `EntityTypeahead`'s Escape case doesn't call `stopPropagation`, so a keyboard user loses everything they typed.
- *Disposition:* part of the E1 keyboard contract (D4).

### Section 3: Tests

**T1 [P2] (confidence 10/10), `node_modules/@testing-library/user-event/dist/esm/event/behavior/keypress.js`.** user-event 14.6.1 can't drive "Enter saves".
- It submits on Enter only through `form.querySelector('… button[type="submit"]')`, which searches inside the `<form>`.
- The drawer's Save sits in the `Drawer` footer and joins the form only through `form="income-form"`.
- Browsers do submit implicitly in that case.
- *Disposition:* D3.

**T2 [P3] (confidence 9/10).** No general i18n parity test exists: `src/lib/features/__tests__/i18nParity.test.ts` covers only `settings.features`.
- *Disposition:* required proof of the i18n guardrail. Add a parity assertion that the new keys exist in `en.json` and `ar.json`.

**T3 [P3] (confidence 8/10).** The RTL guardrail is manual-only.
- *Disposition:* required proof. A unit test asserts that the amount group renders `dir="ltr"`.

**Regression contract (iron rule).** `EntityTypeahead` has five consumers:
- `ClientTypeahead`
- `ProjectTypeahead`
- `VendorTypeahead`
- hosted `ClientPicker`
- hosted `ProjectPicker`, inside `hosted/components/ExpenseDrawer.tsx:200`, whose submit button is also `form=`-linked

*Disposition:* D4.

**Coverage diagram:**

```
CODE PATHS                                         USER FLOWS
[+] parseAmountInput (utils)                       [+] Log work fast (create)
  ├── [GAP→unit] ASCII / grouped / decimals          ├── [GAP→unit] 3 fields + Save (AC1)
  ├── [GAP→unit] Arabic-Indic / Extended / ٫ ٬       ├── [GAP→unit] defaults visible (AC2)
  ├── [GAP→unit] ambiguous → null                    ├── [GAP] [→E2E] keyboard path (D3)
  └── [★★★ TESTED] legacy wrappers utils.test:111    └── [GAP→unit] All Profiles: profile surfaces
[+] buildIncomeWrite (incomeEntry)                 [+] Edit an entry
  ├── [GAP→unit] create × 3 statuses                 ├── [★★ TESTED, skipped] load edit :358 → un-skip
  ├── [GAP→unit] paid→paid keeps paidAt              ├── [GAP→unit] expansion rule (P3)
  ├── [GAP→unit] unpaid→unpaid keys absent           ├── [GAP→unit] retitle paid keeps paidAt (A5)
  ├── [★★ TESTED] paid→unpaid clears :391            └── [GAP→unit] record-backed edits (D2)
  └── [GAP→unit] record-backed rules (D2)          [+] Error states
[+] EntityTypeahead keyboard                         ├── [★★ TESTED] amount required :256
  ├── [★★ TESTED] open/select by click               ├── [GAP→unit] amountInvalid / amountPositive
  ├── [GAP→unit] highlight-first, Enter passthrough  └── [GAP→unit] invalid hidden field expands
  └── [GAP→unit] Escape stays in list (D4)
COVERAGE: 4/22 paths tested today | QUALITY ★★★:1 ★★:3 | GAPS: 18 (1 E2E)
```

### Section 4: Performance

No issues. Opening an edit adds one indexed `paymentRecords.where('transactionId')` read (only needed if D2 = A), on the local Dexie with no network.

### Outside voice

Unavailable. Codex isn't installed, and the in-host fallback needs TaskOutput, which this session doesn't have. Missing coverage is recorded and is not counted as clean.

### Failure modes

| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| amount parse | A user types "12,5" meaning 12.5 | `amountInvalid` test | a field error, never a silent 1250 |
| edit write | A retitle sends `paidAt: undefined` | key-absence test | nothing; this is the critical-gap guard |
| record-backed edit | The amount is cut below what was paid | D2 = A: field error + repo guard | a field error |
| typeahead Enter | Enter in the hosted expense picker submits | D4 contract test | expected submit |
| typed client not picked | Saves with no client | D8 | depends on D8 |

---

## Decision ledger

### R1: file arrangement (complexity gate)
Finding: Scope Challenge complexity, 11 files and 1 new module (reviewer: Claude, plan-eng-review).
Plan baseline: the original proposal, brief §4 and §7.
Runtime evidence: n/a (structure only).

Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1 arrangement | pending | Original: `src/lib/incomeEntry.ts` + its unit test | Smaller: helpers private in `IncomeDrawer.tsx`, component tests only |
| Feature list | brief §4 | unchanged | unchanged |
| D2, D3, D4, D8 | pending | pending | pending |

Question D1:
D1 — File arrangement for MUT-5 (complexity gate)
Header: Arrangement
Options:
A) Original arrangement (recommended)
Pure helpers in new src/lib/incomeEntry.ts with incomeEntry.test.ts; 11 files total. Write rules, the expansion rule and the currency default are unit-tested without React.
B) Smaller arrangement
Helpers stay private inside IncomeDrawer.tsx and are covered only through component tests; 9 files. Every edge case needs a full render and a Dexie round trip.

State: approved
Actual answer: A) Original arrangement (recommended), Basel, AskUserQuestion batch 1, 2026-10-11
Accepted scope: new src/lib/incomeEntry.ts (pure buildIncomeWrite, shouldExpandDetails, resolveDefaultCurrency) with src/lib/__tests__/incomeEntry.test.ts; feature list unchanged
History: —

### R2: payment fields on edit (P2, amended by A1)
Finding: A1 [P1] (confidence 9/10), repository.ts:383-388 / 352-373 (reviewer: Claude).
Plan baseline: P2 as drafted. It is unapproved (pending the owner).
Runtime evidence: `markPaid` writes records; `update` never recalculates; `IncomeDrawer.tsx:198-199` rewrites `paidAt` and `receivedAmountMinor` on every save.

Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| Record-less entries | rewritten every save | P2 rules | P2 rules | unchanged (bug stays) |
| Record-backed status segment | editable | read-only in edit, with a hint | editable | editable |
| Amount below recorded total | allowed | field error + repo rejects (ADR-030) | field error vs `receivedAmountMinor` only | allowed |
| Amount change on a record-backed entry | no recalc | `transactionRepo.update` recalculates | no recalc | no recalc |
| TD-029 | open | separate ticket | separate ticket | separate ticket |

Question D2:
D2 — How editing treats payment data (P2)
Header: Edit money
Options:
A) Records own payment state (recommended)
P2 rules for entries with no payment records. When an entry has live records: the status segment is read-only in edit, with a hint to manage payments from the client page; an amount below the recorded total is a field error and the repository rejects it (ADR-030); an amount change recalculates received and status inside transactionRepo.update. Adds repository.ts and a paymentRecords test. TD-029 becomes its own ticket.
B) Draft P2 rules only
P2 as drafted: keep paidAt and received when the status doesn't change; an amount below received is a field error. Nothing special for entries with payment records, so Received→Invoiced can still orphan them and amount edits leave status stale.
C) Separate bug ticket
MUT-5 keeps today's write behaviour; file a bug for the date reset and the wiped received amount.

State: approved
Actual answer: A) Records own payment state (recommended), Basel, AskUserQuestion batch 1, 2026-10-11
Accepted scope: P2 rules for record-less entries (keys omitted, not undefined); for entries with live PaymentRecords: status segment read-only in edit with hint, amount < recorded total = field error (validation.amountBelowRecorded) and transactionRepo.update rejects it (ADR-030), amount change recalculates receivedAmountMinor/status via recalculateReceivedAmount inside transactionRepo.update; tests in src/db/__tests__/paymentRecords.test.ts + incomeEntry.test.ts + IncomeDrawer.test.tsx; TD-029 split to its own Jira ticket
History: —

### R3: keyboard-path verification depth
Finding: T1 [P2] (confidence 10/10), user-event keypress.js (reviewer: Claude).
Plan baseline: test plan "Keyboard" section, risk noted, depth not chosen.
Runtime evidence: user-event 14.6.1 searches only inside the `<form>`.

Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| Unit contract (Enter not swallowed) | planned | yes | yes |
| Full-path proof | none | Playwright spec `e2e/income-fast-path.spec.ts`, temp config on port 5191 | one manual walk in the browser pane, recorded on Jira |

Question D3:
D3 — How to prove "Tab, Tab, Enter saves"
Header: Keyboard
Options:
A) Playwright spec (recommended)
Unit test pins the typeahead contract, plus e2e/income-fast-path.spec.ts drives title → Tab → amount → Tab → client → Enter in Chromium against the worktree dev server via a temporary config. Keeps failing if the path breaks later.
B) Unit contract + one walk
Unit test pins the contract; I walk the path once in the browser pane and record it on the Jira ticket. Nothing fails later if it breaks.

State: approved
Actual answer: A) Playwright spec (recommended), Basel, AskUserQuestion batch 1, 2026-10-11
Accepted scope: EntityTypeahead unit contract (Enter on closed list not defaultPrevented) + e2e/income-fast-path.spec.ts run via a temporary Playwright config against the worktree dev server (port 5191)
History: —

### R4: EntityTypeahead keyboard contract (regression)
Finding: E1 + Q2 [P2] (confidence 9/10), EntityTypeahead.tsx:74-103, Drawer.tsx:12-16 (reviewer: Claude).
Plan baseline: E1 (shared change), not yet approved.
Runtime evidence: Enter on a closed list re-opens it; Escape on an open list also closes the drawer; there are 5 consumers.

Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| Highlight first match on typing | no | all consumers | income drawer only (prop) |
| Enter on closed list | re-opens, swallowed | submits the form, all consumers | income drawer only |
| Escape on open list | closes list and drawer | closes the list only, all consumers | income drawer only |
| Preserved | — | click pick, create-new, ArrowDown opens, Tab closes | same |
| Tests | — | one EntityTypeahead case per preserved/changed behaviour; hosted ClientPicker/ProjectPicker/ExpenseDrawer suites rerun | prop on/off cases |

Question D4:
D4 — Change the shared typeahead's keys everywhere?
Header: Typeahead
Options:
A) One contract, all pickers (recommended)
Every picker gets: first match highlighted while typing, Enter on a closed list submits the form, Escape closes only the list. Preserved and pinned by tests: click to pick, create-new, ArrowDown opens, Tab closes. In the hosted expense drawer, Enter in a closed picker now submits.
B) Opt-in prop, income only
The same behaviour behind a prop that only the income drawer sets. The other four forms keep today's keys, including Escape closing the whole drawer.

State: approved
Actual answer: A) One contract, all pickers (recommended), Basel, AskUserQuestion batch 1, 2026-10-11
Accepted scope: EntityTypeahead for all 5 consumers: highlight first option on input, Enter on closed list falls through (no preventDefault), Escape on open list stops propagation; preserved and pinned: click pick, create-new, ArrowDown opens, Tab closes; hosted ClientPicker/ProjectPicker/ExpenseDrawer + VendorTypeahead suites rerun
History: —

### R5: status segment placement (P1)
Finding: the ticket leaves the Earned/Invoiced/Received segment unplaced (owner decision; reviewer: Claude).
Plan baseline: P1 recommendation, visible above the title (unapproved).
Runtime evidence: the segment is at `IncomeDrawer.tsx:330-355`, second in the form; it defaults to Earned (`:106`).

Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| Segment location | 2nd in form | above title, always visible | inside More details | chip in the defaults line, opens a popover |

Question D5:
D5 — Where the Earned / Invoiced / Received switch goes (P1)
Header: Status
Options:
A) Visible above the title (recommended)
The three-way switch stays visible as a compact row above the title. Logging a paid job is one click; the fast path shows the switch plus three fields.
B) Inside More details
The switch moves into More details; new entries default to Earned. Logging a paid job means opening More details first.
C) Chip in the defaults line
A small "Earned ▾" chip in the defaults line that opens the switch. The fast path stays at exactly three fields.

State: approved
Actual answer: B) Inside More details, Basel, AskUserQuestion batch 2, 2026-10-11 (not the recommendation)
Accepted scope: the status switch moves into More details; new entries default to Earned (or the opener's defaultStatus); the defaults line shows the current status with currency, date and profile so AC2's 'defaults visible' holds; status is not part of the P3 expansion rule
History: —

### R6: when More details opens in edit (P3)
Finding: AC7 read literally (date, currency and profile always have values) means always open (owner decision; reviewer: Claude).
Plan baseline: P3 recommendation (unapproved).
Runtime evidence: n/a (new behaviour).

Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| Edit mode, More details | n/a | open if due date/project/notes is set, the currency isn't the profile default, or there's no profile; otherwise collapsed, with date, currency and profile in the defaults line | always open |

Question D6:
D6 — When More details opens on an existing entry (P3)
Header: Edit view
Options:
A) Only when it holds extra info (recommended)
Open when a due date, project or notes is set, the currency isn't the profile default, or the profile is missing. Otherwise collapsed; the defaults line still shows date, currency and profile.
B) Always open in edit
Every existing entry opens with More details expanded, so all fields are in view.

State: approved
Actual answer: A) Only when it holds extra info (recommended), Basel, AskUserQuestion batch 2, 2026-10-11
Accepted scope: shouldExpandDetails = dueDate || projectId || notes || currency !== profile default || !profileId; status excluded (shown in the defaults line)
History: —

### R7: required fields (P4)
Finding: the ticket names only amount validation (owner decision; reviewer: Claude).
Plan baseline: P4 recommendation, amount only (unapproved).
Runtime evidence: the schema requires profile, amount, currency and date (`IncomeDrawer.tsx:39-50`); title and client are optional.

Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| Required on new entries | amount (+ defaulted profile, currency, date) | same | + title | + title + client |
| Required on edits | same | same | unchanged (legacy entries stay saveable) | unchanged |

Question D7:
D7 — Which fields are required on a new entry (P4)
Header: Required
Options:
A) Amount only, as today (recommended)
Title and client stay optional, exactly as now. Nothing new blocks a save.
B) Amount and title
New entries need a title (what you did). Existing entries without one stay saveable.
C) Amount, title and client
New entries need a title and a client. Income with no client becomes impossible to create; existing entries stay saveable.

State: approved
Actual answer: free text, Basel, AskUserQuestion batch 2, 2026-10-11: "amount only is required, client can be chosen from list of malafat clients for example (think of this scenario), and title can be also as 'matter' or 'task' from whatever we got from malafat? how can we connect those?"
Accepted scope: A) amount only, as today (title and client optional). The Malafat client/matter/task linking question is answered in chat and proposed as a follow-up ticket under MUT-25; it is NOT MUT-5 scope (local profiles have no Malafat link in v1, hosted income is read-only by ADR-037). MUT-5 keeps the client field on EntityTypeahead (option source swappable, as hosted ClientPicker proves) and the title free text, so a later suggestion source needs no rework
History: —

### R8: client typed but not picked
Finding: Q1 [P2] (confidence 9/10), ClientTypeahead.tsx:84-112 (reviewer: Claude).
Plan baseline: not in the plan (new finding).
Runtime evidence: `inputValue` is local state; `onChange` fires only on a pick or a clear, so typed text is dropped on Save.

Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| Exact name typed, not picked | dropped | picked on blur (all client pickers) | picked on blur (all client pickers) | dropped |
| Other text, not picked | dropped silently | income drawer field error on Save | dropped silently | dropped silently |
| Follow-up | — | none | Jira ticket for the remainder | Jira ticket |

Question D8:
D8 — What happens to a client name typed but never picked
Header: Typed client
Options:
A) Auto-pick exact, else error (recommended)
An exact (case-insensitive) name match is picked when you leave the field, in every client picker. Any other unpicked text makes Save show "Pick a client from the list, or press Enter to create it".
B) Auto-pick exact match only
An exact name match is picked when you leave the field; any other unpicked text is still dropped silently. A ticket covers the rest.
C) Leave as is
Unpicked text keeps being dropped silently; file a ticket.

State: approved
Actual answer: A) Auto-pick exact, else error (recommended), Basel, AskUserQuestion batch 2, 2026-10-11
Accepted scope: ClientTypeahead picks an exact case-insensitive name match on blur (all client pickers); an optional onPendingTextChange callback lets the income drawer show validation.clientNotPicked on Save when unpicked text remains; tests in ClientTypeahead/EntityTypeahead + IncomeDrawer
History: —

Approval readiness: PASS. Checked R1–R8 against the actual answers in AskUserQuestion batch 1 (R1–R4) and batch 2 (R5–R8), 2026-10-11.

---

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above. Tests are written first (TDD).

- [ ] **T1 (P1, human: ~3h / CC: ~10 min).** `utils`: add `parseAmountInput` with digit and separator normalization; route the wrappers and `formatCurrencyInput` through it.
  - Surfaced by: A1–A3, S1
  - Files: `src/lib/utils.ts`, `src/lib/__tests__/utils.test.ts`
  - Verify: `npx vitest run src/lib/__tests__/utils.test.ts`
- [ ] **T2 (P1, human: ~4h / CC: ~15 min).** `incomeEntry`: add the pure `buildIncomeWrite` (omits keys), `shouldExpandDetails` and `resolveDefaultCurrency`.
  - Surfaced by: P2/R2, P3/R6, A2, E3
  - Files: `src/lib/incomeEntry.ts`, `src/lib/__tests__/incomeEntry.test.ts`
  - Verify: `npx vitest run src/lib/__tests__/incomeEntry.test.ts`
- [ ] **T3 (P1, human: ~4h / CC: ~15 min).** Repository: `transactionRepo.update` rejects an amount below the recorded total and recalculates on an amount change.
  - Surfaced by: A1 / R2
  - Files: `src/db/repository.ts`, `src/db/__tests__/paymentRecords.test.ts`
  - Verify: `npx vitest run src/db`
- [ ] **T4 (P1, human: ~3h / CC: ~15 min).** Typeahead: highlight the first match, let Enter through on a closed list, keep Escape inside the list; pin the preserved behaviours.
  - Surfaced by: A4, Q2 / R4
  - Files: `src/components/ui/EntityTypeahead.tsx`, `src/components/ui/__tests__/EntityTypeahead.test.tsx`
  - Verify: `npx vitest run src/components/ui src/hosted/components`
- [ ] **T5 (P2, human: ~2h / CC: ~10 min).** `ClientTypeahead`: pick an exact match on blur; add the optional `onPendingTextChange`.
  - Surfaced by: Q1 / R8
  - Files: `src/components/ui/ClientTypeahead.tsx`, plus tests
  - Verify: `npx vitest run src/components/ui`
- [ ] **T6 (P1, human: ~1.5 days / CC: ~45 min).** `IncomeDrawer`: the fast path (title autofocus, amount with prefix, client), More details with the defaults line (status, currency, date, profile), the profile surfacing when unresolved, auto-expand on an invalid hidden field, i18n-keyed errors, the record-backed status lock, EUR. Un-skip the edit test.
  - Surfaced by: P1–P5, A5–A7, A9, A10, E4, E7
  - Files: `src/components/drawers/IncomeDrawer.tsx`, `src/components/__tests__/IncomeDrawer.test.tsx`
  - Verify: `npx vitest run src/components/__tests__/IncomeDrawer.test.tsx`
- [ ] **T7 (P2, human: ~2h / CC: ~10 min).** Styles and i18n: the `.input-with-prefix` and disclosure styles (logical properties); new keys in both locales; a parity test.
  - Surfaced by: A8, T2, T3
  - Files: `src/index.css`, `src/lib/i18n/translations/{en,ar}.json`, a parity test
  - Verify: `npx vitest run` and the manual RTL pass
- [ ] **T8 (P2, human: ~3h / CC: ~20 min).** E2E: `e2e/income-fast-path.spec.ts` plus a temporary Playwright config for port 5191.
  - Surfaced by: T1 / R3
  - Files: `e2e/income-fast-path.spec.ts`
  - Verify: `npx playwright test -c <temp config> e2e/income-fast-path.spec.ts`
- [ ] **T9 (P2, human: ~2h / CC: ~15 min).** Knowledge files:
  - CHANGELOG
  - COMPONENT_REGISTRY (an IncomeDrawer entry, the EntityTypeahead keyboard contract)
  - PATTERNS ("records own payment state")
  - DECISIONS: a new ADR for the edit rule. Take the next `^## ADR` number on main at build time.
  - TECH_DEBT: TD-029 now points at its ticket
  - TEST_PLAN

  Surfaced by: R2, R4, the CLAUDE.md protocol.
- [ ] **T10 (P3, CC: ~5 min).** Jira: open the TD-029 ticket (a record on create-as-received, plus a backfill); propose the Malafat client/matter linking intake under MUT-25.
  - Surfaced by: R2, R7

## NOT in scope

- **TD-029 write side** (a `PaymentRecord` on create-as-received, plus a backfill). It needs a Dexie upgrade; it gets its own ticket.
- **Backdating the payment date when marking Received in the drawer.** That's MUT-18.
- **Picking Malafat clients, matters or tasks in the drawer.** It's cross-repo, and local profiles have no Malafat link in v1 (ADR-013), while hosted income is read-only (ADR-037). It's proposed under MUT-25.
- **Profile-aware `+ Add` menus.** That's MUT-57.
- **The expense drawer layout.** It's a separate optional area (the ticket's scope-out).
- **`enabledCurrencies` in the currency select.** That setting is read only by the Settings page today, so wiring it into drawers is separate work.

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| T1 parser | `src/lib/` | — |
| T2 helpers | `src/lib/` | T1 |
| T3 repo | `src/db/` | — |
| T4, T5 typeahead | `src/components/ui/` | — |
| T6 drawer | `src/components/drawers/` | T1, T2, T3, T4, T5 |
| T7 css/i18n | `src/index.css`, `src/lib/i18n/` | — (keys are used by T6) |
| T8 e2e | `e2e/` | T6 |

Lanes A (T1→T2), B (T3) and C (T4→T5) are independent. Even so, the owner's convention is one worktree per epic, so this runs **sequentially in `.claude/worktrees/mut-1-client-core`**: T1 → T2 → T3 → T4 → T5 → T7 → T6 → T8 → T9.

## Completion summary

- Step 0, Scope Challenge: scope accepted as-is (R1 = original arrangement); 1 finding (S1, factual correction)
- Architecture Review: 2 issues found (A1 → R2 approved; A2 factual correction)
- Code Quality Review: 2 issues found (Q1 → R8 approved; Q2 folded into R4)
- Test Review: diagram produced, 3 gaps identified (T1 → R3 approved; T2 and T3 added as required proof)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written (Scope Challenge)
- TODOS.md updates: 0 items. The project has no TODOS.md; 2 follow-up Jira tickets are proposed instead (T10).
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; the native fallback needs TaskOutput, absent in this session)
- Parallelization: 3 independent lanes, run sequentially in 1 worktree by owner convention
- Lake Score: 0/4 answers picked a 10/10 option. The highest offered was 9/10, and all 4 scored answers chose the most complete option.

## Suppressed findings (appendix)

- **(confidence 4/10)** `captureUpdateOps` (`synced-repository.ts:52`) emits ops for `undefined` values. Drawer writes don't pass through it (they use the raw repo), so it has no MUT-5 impact. It is relevant to MUT-55/MUT-46 if sync ever routes transaction updates.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 1 | unavailable | codex CLI not installed; no native fallback (TaskOutput absent) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 7 issues, 0 critical gaps (all resolved by approved decisions R1–R8) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable. There is no outside coverage, and this is not counted as clean.
- **VERDICT:** no review is CLEAR. Eng Review closed with issues mapped to approved work (status issues_open, 0 unresolved, 0 critical gaps). The UI layout changed materially (P1 = status inside More details), so a design review is optional before the build.

NO UNRESOLVED DECISIONS
