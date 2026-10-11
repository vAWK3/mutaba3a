# Design Brief: MUT-5, the income entry is the work record (3-field fast path)

- **Date:** 2026-10-11
- **Epic:** MUT-1. The parent brief is `.claude/designs/mut-1-client-accounting-core.md` §4, Phase 3.
- **Ticket:** https://barmajiyat.atlassian.net/browse/MUT-5
- **Blocker:** MUT-19 was fixed in code on 2026-10-08 (`9c10354`, MUT-1 Phase 0). On main `b9f0bfc`, `IncomeDrawer.test.tsx` has 16 passing and 1 skipped. Jira still shows MUT-19 as To Do.
- **Status:** draft. P1–P4 need Basel's approval.
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
- No schema change and no migration.
- Project is never required.
- Every existing field stays reachable.

### P1: where the Earned / Invoiced / Received segment goes

The ticket doesn't place it.

- **Recommended:** keep it visible as the compact segment above the title. "I did X and got paid" (Received) is a first-class way to log work, and hiding it would turn the most common paid log into a detour.
- **Alternatives:** move it inside More details, or show it as a chip in the defaults line.

### P2: payment fields on edit (A5)

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

### P3: when More details opens in edit mode

AC7 says "expanded when any of those fields has a value". Date, currency and profile always have one, so read literally, More details would always be open in edit mode.

- **Recommended:** expand when any of these holds:
  - due date, project or notes is set;
  - the currency differs from the profile's default;
  - the profile couldn't be resolved.

  Otherwise it stays collapsed, and the defaults line shows the date, currency and profile.
- **Alternative:** always expanded in edit mode.

### P4: required fields

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
│ [ Earned | Invoiced | Received ]          (P1)   │
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
buildIncomeWrite(form, existing?) -> Partial<Transaction>   // P2 rules
shouldExpandDetails(tx, profileDefaultCurrency) -> boolean  // P3
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

State: pending
Actual answer: unanswered
Accepted scope: none
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

State: pending
Actual answer: unanswered
Accepted scope: none
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

State: pending
Actual answer: unanswered
Accepted scope: none
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

State: pending
Actual answer: unanswered
Accepted scope: none
History: —
