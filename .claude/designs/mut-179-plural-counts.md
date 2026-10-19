# MUT-179 — Counts read right in English and Arabic

**Ticket:** MUT-179 (Task, epic MUT-74 Apple-design pass; relates MUT-92)
**Status:** Brief, awaiting approval (2026-10-19)
**Last open child of MUT-74.** MUT-90 is closed Won't Do and MUT-85 has moved to MUT-1, so MUT-74 closes when this lands.

## Problem

Counted strings drop a number into fixed text, so they don't follow plural rules:

- **English** shows "1 clients", "1 entries" and "receipt(s)".
- **Arabic** uses one noun form for every count. For example:
  - "متأخر 3 يوم" should be "3 أيام" (few).
  - "مستحق خلال 34 يوم" should be "34 يومًا" (many).
  - "مستحق خلال 1 أيام" is the one form; Arabic says "يوم واحد".

The bug is public. The landing page opens in Arabic (ADR-077), and its Clients and client-profile mocks render `oldestOverdue` and `transactions.status.overdue` with 227, 3, 158 and 34 days. Every one of those shows the wrong form today.

## Scope decision for Basel (pick one)

| | A. Full ticket (recommended) | B. Day strings only |
|---|---|---|
| Keys | All 15 in-scope keys below | `transactions.status.overdue`, `transactions.status.dueIn`, `clients.index.oldestOverdue` |
| Surfaces | Landing, Home, Clients, client and project profiles, Expenses, Settings, orphaned-records banner and drawer | Landing, plus every local-app call site of those three keys (converting a key to a plural object means every caller must move to `tp()`) |
| Files | ~11 source files, en and ar catalogs, 1 key test | ~6 source files |
| Rest of the ticket | Done | Won't Do, because `src/pages/**` and `src/components/**` die with MUT-292 |

**Why A:** the local web app is retired at least 90 days *after* the MUT-291 bridge ships, and the bridge isn't built yet. Users will read these strings for months. B saves only about 9 keys in 5 files, and it would leave the hand-rolled `…Singular/…Plural` pairs that PATTERNS forbids.

**Why B:** it is the position the MUT-281 brief takes ("work on pages that die … is throwaway"). The landing fix, the part that survives retirement, is fully inside B.

## Current state (audited on main 5e174786)

- `tp()` / `useTp()` already exist (`src/lib/i18n/plural.ts`, ADR-019). `ClientsPage`, `ProjectsPage`, `ExpensesLedgerPage`, `RecurringAttentionList` and `ImportDataPage` already import it for other keys.
- **Every in-scope key is still a plain string or a `…Singular/…Plural` pair.** None has been converted.
- **The ticket's "delete unused keys" step is already done** (`time.*`, `onboarding.stepOf`, `planning.*` are gone), with one exception. `orphanedRecords.groups.*` **is still used** by `OrphanedRecordsDrawer` (`"Clients ({count})"`, count-neutral), so it stays. This is a correction to the ticket's out-of-scope list.
- **Two extra hand-rolled pairs that the ticket didn't list:** `clients.summary.clientsCountOne` and `projects.summary.projectsCountOne` (a `count === 1 ? …One : …` ternary). They fold into the plural objects for `clientsCount` and `projectsCount`.

## Plan (option A; B is the first three rows)

| Key | Call sites | Change |
|---|---|---|
| `transactions.status.overdue` | `ClientWorkSection`, `HomeAttentionRow`, `RecurringAttentionList`, `ProjectDetailPage` ×2, landing `ClientProfileMock` | plural object; `t(…, {days})` → `tp(…, days)` |
| `transactions.status.dueIn` | `ClientWorkSection`, `HomeAttentionRow`, `RecurringAttentionList`, `ProjectDetailPage` | same |
| `clients.index.oldestOverdue` | `ClientsPage`, landing `ClientsListMock` | same |
| `clients.summary.clientsCount` (+ `…CountOne` deleted) | `ClientsPage` | collapse ternary into `tp` |
| `projects.summary.projectsCount` (+ `…CountOne` deleted) | `ProjectsPage` | same |
| `clients.emptyFilteredCount` | `ClientsPage` | `tp` (`projects.emptyFilteredCount` is already plural; mirror it) |
| `clients.crossProfileTxCount` | `ClientsPage` | `tp` |
| `expenses.receiptsAttached` | `ExpensesLedgerPage` (badge `title`) | `tp`; drop "(s)" |
| `expenses.recurring.occurrence.dueIn`, `overdueDays` | `RecurringOccurrenceCard` | `tp` |
| `settings.exportReceiptsDesc`, `exportReceiptsDone` | `YourDataSection` | `tp` |
| `settings.importBackupDone` ← `…Singular/…Plural` | `YourDataSection` | one plural key, delete the pair |
| `integrity.checkIssues`, `toastIssues` ← pairs | `YourDataSection` | same |
| `integrity.orphanedRecord` ← pair | `OrphanedRecordsBanner` | same |
| `orphanedRecords.assigned`, `partialFailure` ← pairs | `OrphanedRecordsDrawer` | same |

**String conventions**
- The count placeholder becomes `{count}` (`tp` always supplies it), replacing `{days}`. Other variables (`{total}`, `{version}`) stay as they are.
- Arabic gets all six forms. `one` and `two` name the count without a digit ("يوم واحد", "يومان"/"يومين"), like the existing `…Singular` strings and `projects.emptyFilteredCount`. `few` uses the plural ("أيام"), and `many` the accusative singular ("يومًا"). `zero` and `other` keep today's wording.
- English stays terse where it is today (`3d overdue`, `Due in 1d`); `one` and `other` are spelled out wherever a noun is visible ("1 client", "2 clients").
- Counts stay in Latin digits, and the `isolate()` / bidi wrappers stay untouched. Strings only, no layout change (ticket guardrails).

**Not touched:** `src/hosted/**`, which already uses `tp()` (MUT-43); `notMarked` / `snoozeWhat` (their placeholder is month names); count-neutral "X ({count})" labels.

## Reuse, impact and risk

- **Reuse:** `useTp()`, the `i18nParity` checker (it already validates plural objects: en `one+other`, ar six forms, same named vars), and the `*Keys.test.ts` pattern (`recurringAttentionKeys.test.ts`). No new component, pattern or ADR; this follows ADR-019 and PATTERNS' "Plurals go through tp()".
- **Risk:** any caller left on `t()` for a converted key would render `[object Object]` or the bare key. Mitigation: the key test asserts the old `…Singular/…Plural/…One` keys are gone, and a grep gate in the test plan lists every `t('<converted key>'` call. Existing component tests that assert "3d overdue"-style text keep passing in English.
- **Cost / infra / perf:** none. One cached `Intl.PluralRules` per language.
- **i18n:** this is the i18n fix itself, and the Arabic forms are the deliverable. I'll ask Basel to eyeball the Arabic table in review.

## QA scenarios (release-qa, web)

1. **landing › arabic-day-counts** (tier: extended). Open the landing page in Arabic and look at the Clients mock and the client-profile mock. *Outcome:* "3 أيام", "227 يومًا", "158 يومًا" and "34 يومًا"; no "{n} يوم" for counts 3–10 or 11–99.
2. **clients › count-plurals** (tier: extended). Load sample data and open Clients, first in English, then in Arabic. *Outcome:* the summary line reads "N clients" in English and the matching Arabic plural form, and an overdue client's subline uses the day form for its count.
3. **home › attention-day-plurals** (option A and B). On Home in Arabic, Needs attention overdue and due-soon rows read with the correct day form.

Paths: `src/pages/landing/components/mocks/**`, `src/pages/clients/ClientsPage.tsx`, `src/components/home/HomeAttentionRow.tsx`, plus the remaining touched files mapped onto existing features (expenses, settings, data).

## Acceptance (from the ticket, adjusted)

- [ ] Each in-scope key is a CLDR plural object in en and ar, and Arabic has all six forms.
- [ ] Every call site uses `tp(key, count)`, and no `…Singular/…Plural/…CountOne` key remains.
- [ ] `src/lib/i18n/__tests__/pluralCountKeys.test.ts` asserts the forms in both languages and that the retired keys are gone.
- [ ] Rendered checks: count 1 shows "1 project" and "Due in 1d"; Arabic counts 3 and 11 show the few and many forms, on the Clients list, the Home attention row and /expenses.
- [ ] EN and AR are checked in the browser for each touched screen.
