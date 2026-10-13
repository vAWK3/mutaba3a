# MUT-92: Craft-fix bundle from the Apple-design pass

Jira: MUT-92 (Task, epic MUT-74, Backlog). Brief: `.claude/designs/landing-apple-redesign.md`, "App craft fixes that need no decision".
Planned 2026-10-14 against main `8b07277`.

## Acceptance criteria (from the ticket)

- Each fix has a regression test.
- EN and AR checked for every string change.

## Audit: each fix against current main

Three of the nine fixes landed already through other tickets. They need no code, only a check that their regression test exists.

| # | Fix | State on main | Evidence | Work left |
|---|---|---|---|---|
| F1 | Income drawer currency defaults to the client's last-used currency | **Open** | `IncomeDrawer.tsx:178-184` uses only `resolveDefaultCurrency(profile, settings)` | Build |
| F2 | Drawers sit above any top bar | **Open** | `DemoBanner.css:15` `z-index: 1000`, fixed, top 0; `.drawer-overlay` 200 and `.drawer` 201 (`index.css:2242,2262`). `SampleDataBar` (MUT-78) sits in the flow, so the demo bar is the only one that overlaps | Build |
| F3 | "Record Payment₪3,550" | **Partly open** | `.btn` has `gap: var(--space-2)`, so the two parts are visually apart. The text has no space, so copied text and page-text tools read "Record Payment₪3,550" (`RecordPaymentButton.tsx:77-78`). The accessible name comes from `aria-label` and is fine | Build (one text node) |
| F4 | All Time shows "01/01/2000 – 31/12/2100" | **Open** | `DateRangeControl.tsx:106-114` renders the range for every preset; sentinels come from `utils.ts:359-360` | Build |
| F5 | Payments table repeats "Recorded on the entry" | **Open, and worse since MUT-60** | `ClientPaymentsSection.tsx:55-63`. MUT-60's v23 backfill (`database.ts:986`) writes `MIGRATED_PAYMENT_NOTE` on every legacy paid entry, so those rows now all say "Migrated from accumulated total". 'entry' rows remain for seed data without records (MUT-95) | Build |
| F6 | Expense amounts carry a minus sign | **Open** | `ExpensesLedgerPage.tsx:455,564` pass `showExpenseSign`. `ProjectDetailPage.tsx:271` keeps it, because that list mixes income and expenses | Build |
| F7 | "1 weeks ago" | **Open** | `utils.ts:292-315` `formatRelativeDate` interpolates `time.daysAgo/weeksAgo/monthsAgo/yearsAgo`, with no plural forms (AR: "منذ {weeks} أسبوع") | Build |
| F8 | Demo seed writes future-dated payments | **Done in MUT-78** | `seedData/dates.ts` `notAfter`; covered by `src/demo/__tests__/seedDates.test.ts` | None |
| F9 | About says "Mutaba3a - Mini CRM" | **Done in MUT-88** | `en.json:582` `"name": "Mutaba3a"`; no "Mini CRM" anywhere in `src/` | Add a one-line regression test (AC 1) |

Related items from the brief that the ticket left out, so they stay out of scope:
- "Two Default badges": fixed in MUT-78/ADR-072, and tested in `seedDates.test.ts`.
- Expenses total per currency: already `CurrencyAmounts` (`ExpensesLedgerPage.tsx:272`).
- Payment chip format: moot after MUT-86.
- Landing craft list (`transition: all`, Apple Silicon, `<title>`, 375w toggle): belongs to the landing tickets.

## Plan per fix

Work happens in a new worktree, following the epic routine: `.claude/worktrees/mut-92-craft-fixes` on `feature/mut-92-craft-fixes`, then `npm ci`. Tests come first for each fix.

### F1: currency follows the client

Arrangement per eng review D1 ("Smaller arrangement", 2026-10-14): reuse the existing list query; no new repository method or hook.

- **Read**: `useTransactions({ clientId, kind: 'income', includeArchived: true, limit: 1 }, { enabled })` (`src/hooks/useQueries.ts:110`).
  - It goes through `transactions.list` (`src/db/repository.ts:209`), which already filters out deleted rows, filters by clientId and kind, and sorts by `occurredAt` desc by default.
  - Archived entries count, because they are still the client's history.
  - A same-day tie falls to insertion order. Accepted in D1.
  - The `['transactions', filters]` key is invalidated by every transaction mutation.
- **Drawer** (`IncomeDrawer.tsx:178-184`):
  - The default becomes `clientCurrency ?? profileCurrency`, where `clientCurrency = lastIncome[0]?.currency`.
  - The query is enabled only when `mode === 'create' && !duplicateFromId && !!selectedClientId`.
  - The existing effect keeps `currencyChosen` as the guard: once the user picks a currency, a client or profile change never overrides it.
  - Edit mode and duplicate mode are untouched.
- **Tests**: extend the existing real-Dexie integration suite `src/components/__tests__/IncomeDrawer.test.tsx`, next to "starts in the profile currency" (:227) and "moves an untouched currency with the profile" (:246). Seed real clients and entries, so the `list()` filter and sort are proven end to end:
  - (a) open with `defaultClientId` for a client whose newest income is ILS, in a USD profile → ILS, and it saves as ILS.
  - (b) a client with no income → profile default.
  - (c) picking the client in the typeahead switches the currency.
  - (d) the user picks EUR, then changes client → stays EUR.
  - (e) an older-dated entry created later does not win; a deleted entry and an expense in another currency are ignored; an archived entry counts.
  - (f) edit mode keeps the entry's currency.
  - (g) duplicate keeps the source's currency.
- **Regression contract**: the tests at :227 and :246 pass unchanged (no client selected → the profile currency, as today).

### F2: drawers above top bars

- `DemoBanner.css`: `z-index: 1000` → `150`, with a comment that top bars sit above content (≤100) and below drawers (200/201) and modals.
- Nothing else needs to move: `ProfileQuickPicker` and `ProfilePickerModal` (1000) are modals and should stay above drawers. `LandingPage.css` (1000) never shares a page with a drawer.
- No z-index token scale. YAGNI; MUT-103 owns token sweeps.
- **Test**: `src/styles/__tests__/layering.test.ts` (node env, reads CSS like `brand.test.ts`). It asserts that the `.demo-banner` z-index is above 100 and below `.drawer-overlay`'s, so a future bar can't regress silently.

### F3: Record Payment text

- `RecordPaymentButton.tsx:77`: put `{' '}` between the label and the amount span.
- A whitespace-only flex item is not rendered, so the visual gap stays `gap` only. The text becomes "Record Payment ₪3,550".
- The amount stays: on part-paid rows it is the *remaining* figure, not the Amount column's total. The CSS comment there documents keeping it on purpose.
- **Test**: extend the existing `RecordPaymentButton` test. Assert that `textContent` matches `/Record Payment \S/`, and that the `aria-label` is unchanged (EN + AR).

### F4: All Time hides its range

- `DateRangeControl.tsx:106`: render `.date-range-display` only when `currentPreset !== 'all'`.
- All 7 surfaces use this one component, so one fix covers every page.
- **Test**: in `DateRangeControl.test.tsx`, All Time shows no "2000" or "2100" text, and This month still shows its range.

### F5: Notes only when there are notes

- `ClientPaymentsSection.tsx` `notesFor`: return nothing for `source === 'entry'` and for `notes === MIGRATED_PAYMENT_NOTE`. Both are system provenance, not something the user wrote.
- Hide the Notes column when no row has a user note.
- Remove `clients.profile.payments.recordedOnEntry` from `en.json`, `ar.json` and `types.ts`.
- `transactions.partialPayment.migratedNote` stays only if anything else uses it; grep shows nothing else does, so remove it too.
- The `MIGRATED_PAYMENT_NOTE` constant stays: it is stored data.
- **Tests** (`ClientDetailPage.test.tsx`):
  - Rewrite "marks a payment saved on the entry itself": the row still opens the entry, and its notes cell is empty.
  - Rewrite "translates the note the v18 migration wrote" into "hides the note the migrations wrote".
  - New: a user note still shows.
  - New: the column is absent when no row has a note.

### F6: no minus sign on the Expenses page

- `ExpensesLedgerPage.tsx:455,564`: drop `showExpenseSign`.
- The red `amount-negative` colour stays; `ProjectDetailPage` keeps the sign because its list is mixed.
- **Test**: an Expenses ledger test asserts the row amount text has no leading "-" (both list layouts: flat and grouped).

### F7: plurals in relative dates

- `formatRelativeDate(iso, t, locale)` keeps `time.today` and `time.yesterday` for 0 and 1 days, so their capitalisation stays.
- From 2 days up it uses `new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-n, unit)`. This is CLDR plural rules, so Arabic gets all six forms (قبل أسبوع واحد / قبل أسبوعين / قبل ٣ أسابيع / قبل ١١ أسبوعًا …).
- Precedent: `RecurringMarkPaidDrawer.tsx:324`; ADR-019 ("Intl APIs for formatting").
- Drop the untranslated no-`t` English fallback branch: every caller passes `t`.
- Pass the locale from the 3 callers: `FxRateReadout.tsx:94`, `ClientsPage.tsx:275`, `ProjectsPage.tsx:255`.
- Remove `time.daysAgo/weeksAgo/monthsAgo/yearsAgo` from `en.json`, `ar.json` and `types.ts`.
- **PATTERNS.md**: count strings go through `tp()`; relative time goes through `Intl.RelativeTimeFormat`.
- **Tests** (`src/lib/__tests__/formatRelativeDate.test.ts`, with fake timers):
  - EN: 7 days → "1 week ago", 14 → "2 weeks ago", 45 → "1 month ago", 400 → "1 year ago".
  - AR: 7 / 14 / 21 / 77 days give the one / two / few / many forms, each asserted against `Intl.RelativeTimeFormat('ar')` output, so the test checks the wiring, not CLDR.
  - 0 and 1 days give the `time.today` and `time.yesterday` keys.

### F9: About regression test

- **Test**: a new `src/lib/i18n/__tests__/craftFixKeys.test.ts`, following the per-feature `*Keys.test.ts` pattern (e.g. `incomeDrawerKeys.test.ts`). It walks `en.json` and `ar.json` and asserts:
  - no value contains "Mini CRM" or "mini-crm";
  - `settings.about.name` is "Mutaba3a" in EN;
  - the keys F5 and F7 remove (`clients.profile.payments.recordedOnEntry`, `transactions.partialPayment.migratedNote`, `time.daysAgo|weeksAgo|monthsAgo|yearsAgo`) are gone from both languages, while `time.today` and `time.yesterday` stay in both.

  This is the "EN and AR checked for every string change" AC in test form.

## Files

`src/components/drawers/IncomeDrawer.tsx`, `src/components/ui/DemoBanner.css`, `src/components/ui/RecordPaymentButton.tsx`, `src/components/filters/DateRangeControl.tsx`, `src/components/clients/ClientPaymentsSection.tsx`, `src/pages/expenses/ExpensesLedgerPage.tsx`, `src/lib/utils.ts`, `src/components/layout/FxRateReadout.tsx`, `src/pages/clients/ClientsPage.tsx`, `src/pages/projects/ProjectsPage.tsx`, `src/lib/i18n/translations/{en,ar}.json`, `src/lib/i18n/types.ts`, plus the tests above.

Also `src/db/database.ts`: update the `MIGRATED_PAYMENT_NOTE` doc comment, because the UI now hides that note instead of translating it.

Knowledge files: `CHANGELOG.md`, `PATTERNS.md` (F7), `TEST_PLAN.md`. No component-registry change, no ADR, no TD.

## Cost and scale

F1 adds one `transactions.list` call per drawer open that has a client: 4 whole-table reads, the same shape /income pays on every filter change. It is cached by TanStack Query and invalidated with transactions. Accepted in D1. Nothing else adds reads.

## Verification

Run under Node 22 (TD-054):
- `npm run lint`
- `npm run typecheck`
- `npm run test:run`
- `npm run build`

Then check in a browser preview build, in EN and AR:
- shekel client → ₪ default;
- drawer over the demo bar;
- All Time;
- Payments table;
- Expenses;
- Clients "Last activity".

## Follow-up (not this ticket)

Other count strings without plural forms: `transactions.status.dueIn`/`overdueDays` ("Due in 1 days"), `projectsCount`, `clientsCount`, `crossProfileTxCount`, `receiptsAttached`, `horizonMonths`, and the `…Singular/…Plural` pairs that should become `tp()` objects. Offer as a ticket via `/pm-intake`.

---

# Eng review (/plan-eng-review, 2026-10-14)

Target: `.claude/designs/mut-92-craft-fix-bundle.md` (this file), at main `8b07277`. Reviewer: Claude (plan-eng-review).

## Scope record

- **Feature answers:** none; no cuts were proposed.
- **Structure:** B) Smaller arrangement (D1, AskUserQuestion answer 2026-10-14).
- **Accepted scope:** F1–F7 built and F9 test added, in 15 product files (the Files list above, plus `database.ts` for a comment only). F1 reuses `useTransactions`/`transactions.list`; there are no new classes, services, repository methods or hooks.
- **Pending remedies:** none.

## Scope Challenge

The complexity gate tripped: the original plan had 17 product files. D1 chose the smaller arrangement, which removed 3 files (`interfaces.ts`, `repository.ts`, `useQueries.ts`) and keeps the same behaviour and tests. Result: **scope accepted as-is**.

What already solves each sub-problem:
- **F1:** `transactions.list` (`repository.ts:209`) already has the filter and sort it needs.
- **F7:** `Intl.RelativeTimeFormat`, with precedent at `RecurringMarkPaidDrawer.tsx:324`.
- **F2:** the CSS-test precedent is `src/styles/__tests__/brand.test.ts`.
- **F9:** the key-test precedent is `src/lib/i18n/__tests__/*Keys.test.ts`.
- **F8 and F9 are already fixed** (MUT-78, MUT-88). This is a factual correction to the ticket, with no question needed.

Findings:
1. **[P2] (confidence: 9/10) MUT-169 plan overlaps this one.** `.claude/designs/mut-169-edit-payment-from-ledger.md:107` lists `src/components/clients/ClientPaymentsSection.tsx` ("Render `paidAt` through the D7 parse"), and its scope record (:372) also names `IncomeDrawer.tsx`, `en.json` and `ar.json`. Both are unbuilt and touch the same files.
   - Disposition: recorded as a conflict flag. No remedy is needed, because the hunks don't overlap: MUT-169 changes date rendering, this plan changes `notesFor`, the Notes column and the currency default. Whichever lands second merges main first.

## 1. Architecture review

- **Data flow, F1:** `selectedClientId` → `useTransactions({clientId, kind:'income', includeArchived:true, limit:1})` → `clientCurrency` → effect → `setValue('currency')`, unless `currencyChosen` is set. The store has no other currency source: `openIncomeDrawer` takes no currency (`stores.ts:31-37`), so nothing captured is overwritten.
- **Failure mode, F1:** the query fails or is slow. The drawer keeps the profile default, as today, and Save never waits on this query. If the client query resolves after the user typed "$100" while the currency flips to ₪, the existing symbol-mismatch guard (`IncomeDrawer.tsx` onSubmit, `CURRENCY_MISMATCH`) catches it with a field message, so it never fails silently.
- **F2:** only `.demo-banner` is a fixed top bar. `SampleDataBar` is in the flow (MUT-78), and the Mac and update bars moved into `<main>` (MUT-79). `.demo-banner` at 150 sits above content (≤100: `FxRateReadout.css:47`, typeaheads) and below `.drawer-overlay` 200 and `.drawer` 201. Modals at 1000+ and toasts/menus at 9999 stay above drawers on purpose.
- **F7 locale:** a probe on Node 22 shows `ar` relative time gives Latin digits and all CLDR forms ("قبل أسبوع واحد | قبل أسبوعين | قبل 3 أسابيع | قبل 11 أسبوعًا"). `Intl.NumberFormat('ar')` also gives "3", so the digits match the rest of the app.
- No security, auth or API boundary is touched. No new artifact or distribution path.

No issues found.

## 2. Code quality review

- Every proposed caller and interface exists as quoted: `formatRelativeDate` callers at `FxRateReadout.tsx:94`, `ClientsPage.tsx:275` and `ProjectsPage.tsx:255` (all live: `ClientsLayout.tsx:15` and `router.tsx:84`); `showExpenseSign` at `ExpensesLedgerPage.tsx:455,564` (live at `router.tsx:189`).
- `migratedNote` has one reader (`ClientPaymentsSection.tsx:60`), so removing the key is safe. The plan now updates the `database.ts:32-36` doc comment that names it.
- F3: a `{' '}` text node between flex items is not rendered (an anonymous flex item that is only white space), so the visual gap stays `gap: var(--space-2)` (`index.css:1290`).
- There is no shared-code extraction: each fix is local.

No issues found. Suppressed (appendix): F7 builds a new `Intl.RelativeTimeFormat` per call, where `plural.ts:15` caches per language. That is a few hundred rows at most on Clients/Projects, so microseconds. Confidence it matters: 3/10.

## 3. Test review

Framework: Vitest + RTL, with real Dexie (fake-indexeddb) in the drawer suites; Playwright in `qa/`. Gate under Node 22.

```
CODE PATHS                                                  USER FLOWS
[+] IncomeDrawer currency default (F1)                      [+] Add income for a ₪-only client
  ├── no client → profile currency  [★★★ :227,:246 keep]      ├── [GAP→planned] from client profile (+Add) → ₪
  ├── client w/ history → its newest currency [GAP→(a)]       └── [GAP→planned] pick client in typeahead → ₪
  ├── typeahead pick switches       [GAP→(c)]
  ├── user-picked currency sticks   [GAP→(d)]               [+] Read a list in EN and AR
  ├── ordering: occurredAt/deleted/expense/archived [GAP→(e)]  ├── [GAP→planned] Clients "Last activity" plurals
  └── edit / duplicate untouched    [GAP→(f),(g)]             └── [GAP→planned] Expenses rows without "-"
[+] DemoBanner layering (F2)  [GAP→layering.test.ts]
[+] RecordPaymentButton (F3)                                [+] Client profile Payments
  ├── amount variant text has a space [GAP→extend :125]       ├── [GAP→planned] legacy row: blank notes, opens entry
  └── compact + aria-label          [★★★ :143 keep]           └── [GAP→planned] user note still shows
[+] DateRangeControl (F4)
  ├── All Time hides range          [GAP→new it()]
  └── month preset shows range      [★★ :111 keep]
[+] ClientPaymentsSection notesFor (F5)
  ├── source 'entry' → blank        [rewrite ClientDetailPage :549]
  ├── MIGRATED note → blank         [rewrite :568]
  ├── user note → shown             [GAP→new]
  └── no notes anywhere → no column [GAP→new]
[+] ExpensesLedgerPage amounts (F6) flat + grouped [GAP→new]
[+] formatRelativeDate (F7) EN one/other, AR one/two/few/many, today/yesterday [GAP→new]
[+] i18n keys (F9 + removed keys, EN+AR) [GAP→craftFixKeys.test.ts]

COVERAGE (after plan): 22/22 planned paths have a ★★+ test | E2E: none needed (each fix is one component)
```

- Every GAP above already has a planned test in the per-fix sections, so no new decision is needed.
- The F1 tests moved into the existing integration suite as part of D1's required proof.
- **Regression contracts carried forward** (they must pass unchanged): `IncomeDrawer.test.tsx:227,246`, `DateRangeControl.test.tsx:111`, `RecordPaymentButton.test.tsx:143`, `FxRateReadout.test.tsx:65` (`time.today` stays).
- **Intended changes:** `ClientDetailPage.test.tsx` "marks a payment saved on the entry itself" (:549) and "translates the note the v18 migration wrote" are rewritten to the new behaviour.

**Tests made obsolete:** the two `ClientDetailPage` assertions above (rewritten, not deleted). The translation-mock entries for the removed keys in `ClientDetailPage.test.tsx:63,80` go.

## 4. Performance review

The only new read is F1's `transactions.list` call: 4 whole-table `toArray()` reads (transactions, clients, projects, categories) per drawer open with a client, at the user's local data size. This was accepted in D1, and it matches `/income`, which runs the same call on every filter change. There are no loops and nothing unbounded.

No issues found.

## Outside voice

`codex_reviews` is enabled, but the `codex` CLI is not installed (`command -v codex` is empty). The native fallback needs TaskOutput, which this session does not declare. Outside voice is **unavailable**; this is missing coverage, not a clean pass.

## NOT in scope

- **The plural sweep of other count strings** (`dueIn`, `overdueDays`, `projectsCount`, …): the ticket names only "1 weeks ago". It is a separate decision (D2).
- **The landing craft list in the brief** (`transition: all`, Apple Silicon, `<title>`, 375w toggle): it belongs to the landing tickets, and the ticket body does not list it.
- **"Two Default badges" and "Expenses total per currency":** already fixed (MUT-78/ADR-072 and `CurrencyAmounts`).
- **A z-index token scale:** YAGNI. MUT-103 owns token sweeps.

## What already exists

Reused, nothing rebuilt:
- `transactions.list` and `useTransactions` (F1);
- `Intl.RelativeTimeFormat` (F7, the `RecurringMarkPaidDrawer` precedent);
- `brand.test.ts`'s CSS-reading approach (F2);
- the `*Keys.test.ts` pattern (F9);
- the `notAfter` seed guard and its test (F8, done).

## Failure modes

| Path | Realistic failure | Test / handling | User sees |
|---|---|---|---|
| F1 client query | Slow, or fails | Falls back to the profile currency; Save is not gated | The profile currency (today's behaviour) |
| F1 late flip | The currency changes after the user typed a symbol | `CURRENCY_MISMATCH` field error | A clear message |
| F2 | A new fixed bar added at 1000 later | `layering.test.ts` fails in CI | n/a |
| F7 | A runtime without Arabic ICU data | Node 22 and Chromium ship full ICU; probe above | The English form at worst |

Critical gaps: 0.

## Worktree parallelization strategy

Sequential implementation, no parallelization opportunity. The fixes are small; one worktree (`feature/mut-92-craft-fixes`) works through them, one commit per fix.

Conflict flag: MUT-169 (unbuilt) shares `ClientPaymentsSection.tsx`, `IncomeDrawer.tsx`, `en.json` and `ar.json`. Land one, then merge main into the other.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a finding above.

- [ ] **T1 (P2, human: ~1.5h / CC: ~15min)** — IncomeDrawer — Currency follows the client's newest income via `useTransactions` (D1)
  - Surfaced by: Scope Challenge, D1 (Smaller arrangement)
  - Files: `src/components/drawers/IncomeDrawer.tsx`, `src/components/__tests__/IncomeDrawer.test.tsx`
  - Verify: `npx vitest run src/components/__tests__/IncomeDrawer.test.tsx`
- [ ] **T2 (P2, human: ~20min / CC: ~3min)** — Payments/Notes — Sequence against MUT-169 (merge main before landing whichever is second)
  - Surfaced by: Scope Challenge finding 1 (`mut-169-edit-payment-from-ledger.md:107`)
  - Files: `src/components/clients/ClientPaymentsSection.tsx`, `src/components/drawers/IncomeDrawer.tsx`
  - Verify: `git merge main` is clean, or conflicts are resolved; then re-run both suites

_No new tasks from Architecture, Code Quality, Test or Performance: the per-fix sections above already carry each fix's work and tests._

## Decision ledger

### D1: F1 data access arrangement (complexity-gate structure selector)
Scope selector; no pre-answer record required. Actual answer: "Smaller arrangement" (AskUserQuestion, 2026-10-14). Accepted scope: see Scope record.

### R1: Plural sweep of the remaining count strings (TODO)
Finding: Final planning, P3, confidence 9/10. In `src/lib/i18n/translations/en.json`, `:108` `"overdue": "{days}d overdue"`, `:710` `"dueIn": "Due in {days} days"`, `:712` `"overdueDays": "Overdue by {days} days"` and `:241` `"projectsCount": "{count} projects"` interpolate counts with no plural forms. Reviewer: Claude.
Plan baseline: "Follow-up (not this ticket) … Offer as a ticket via `/pm-intake`" (original proposal).
Runtime evidence: on main, "Due in 1 days" and "1 projects" render for count 1 (the strings above); Arabic uses a single form for every count.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 plural sweep | proposed as a follow-up, pending | Jira ticket via /pm-intake (MUT, Backlog) | Not tracked | Built in MUT-92 |
| F7 relative dates | approved in plan | unchanged | unchanged | unchanged |
Question D2:
D2 — Track the plural sweep of the other count strings?
Project/branch/task: MUT-92 craft-fix bundle plan on main; F7 fixes only relative dates ("1 weeks ago").
ELI10: The ticket names one plural bug, "1 weeks ago". The same bug exists in about a dozen other strings, such as "Due in 1 days" and "1 projects", and in Arabic every count uses one form. Fixing them all is mechanical but touches many screens and both translation files. We can file it as its own ticket, drop it, or fold it into this one.
Stakes if we pick wrong: folding it in bloats a small craft bundle and its review; dropping it leaves visible grammar errors in both languages on core screens.
Recommendation: A because the project tracks work in Jira MUT, not TODOS.md, and the sweep is its own reviewable unit that reuses `tp()`.
Completeness: A=9/10, B=3/10, C=10/10
Header: Plural sweep
Options:
A) File a MUT ticket
(recommended) Run /pm-intake after this plan to file a Backlog ticket: convert dueIn/overdue/overdueDays/oldestOverdue/projectsCount/clientsCount/crossProfileTxCount/receiptsAttached/horizonMonths and the …Singular/…Plural pairs into tp() CLDR objects (all six AR forms). Nothing added to TODOS.md. MUT-92 scope unchanged. Human ~10min / CC ~3min to file.
B) Skip it
No ticket and no TODO. The grammar errors stay until someone reports them. MUT-92 scope unchanged.
C) Build it in MUT-92
Add the sweep to this ticket: about 12 keys × 2 languages, their call sites to tp(), and key tests. Grows MUT-92 past its ACs by roughly 15 files. Human ~4h / CC ~40min.

State: approved
Actual answer: A) File a MUT ticket (AskUserQuestion D2, 2026-10-14)
Accepted scope: After this plan, run /pm-intake to file a MUT Backlog ticket for the plural sweep (the keys listed in option A, converted to tp() CLDR objects with all six AR forms). Nothing is added to TODOS.md. MUT-92 scope is unchanged.
History: none

Approval readiness: PASS. D1 is a scope selector (answer "Smaller arrangement"). R1/D2 is approved (answer A). The per-fix plan items are the original plan baseline, and no finding reopened them.

## Unresolved decisions

None.

## Completion summary

- **Step 0 (Scope Challenge):** scope accepted as-is. The complexity gate tripped at 17 files; D1 chose the smaller arrangement (15 product files, no new classes or services). 1 finding: the MUT-169 overlap, recorded as a conflict flag.
- **Architecture review:** 0 issues found.
- **Code quality review:** 0 issues found (1 suppressed, confidence 3/10).
- **Test review:** diagram produced. 1 gap: the F1 proof moved into the real-Dexie `IncomeDrawer.test.tsx` under D1. Every other path already had a planned test.
- **Performance review:** 0 issues found.
- **NOT in scope:** written.
- **What already exists:** written.
- **TODOS.md updates:** 1 item proposed (D2). The answer was to file a MUT ticket instead; TODOS.md is unchanged.
- **Failure modes:** 0 critical gaps flagged.
- **Unresolved decisions:** 0 in this review.
- **Outside voice:** codex, unavailable (CLI not installed; the native fallback lacks TaskOutput).
- **Parallelization:** 1 lane, 0 parallel / 1 sequential.
- **Lake Score:** 1/2. D1 was scored 10/10 for both options, so it counts. D2 picked A (9/10) over C (10/10).

## Suppressed findings (appendix)

- **[P3] (confidence: 3/10)** In the planned F7 `formatRelativeDate`, a new `Intl.RelativeTimeFormat` per call. `plural.ts:15` caches `Intl.PluralRules` per language. Impact is microseconds per row; optional to cache.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (`/plan-eng-review` outside voice) | Independent 2nd opinion | 1 | unavailable | CLI not installed; no native fallback (TaskOutput missing) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 1 issue (test proof relocated, resolved via D1), 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

Other plan-eng-review rows on branch `main` in the log (2026-10-13) belong to other plans (MUT-169, MUT-133 and others), not this file.

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable. Missing coverage, not a pass.
- **VERDICT:** Eng review complete with 1 issue, mapped to accepted work (D1). No blocking findings; ready to implement. Not CLEAR in the dashboard sense, because issues_found=1 (resolved, not open work).

NO UNRESOLVED DECISIONS
