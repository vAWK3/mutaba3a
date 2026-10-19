# MUT-179 — Test plan

TDD order: write the key test and the component assertions first and watch them fail (Red), then convert the catalogs and call sites (Green).

## Unit: catalog shape

`src/lib/i18n/__tests__/pluralCountKeys.test.ts`, following `recurringAttentionKeys.test.ts`:

- **T1.** For each in-scope key, en is `{one, other}` and ar has `zero|one|two|few|many|other`, every form non-empty.
- **T2.** Named variables other than `count` match across forms and languages (`{total}` in `checkIssues`, `{version}` in `importBackupDone`). `src/test/i18nParity.ts` already enforces this repo-wide.
- **T3.** The retired keys are absent in both languages:
  - `…Singular` / `…Plural` for `importBackupDone`, `assigned`, `partialFailure`, `orphanedRecord`, `checkIssues` and `toastIssues`
  - `clientsCountOne` and `projectsCountOne`
- **T4.** `orphanedRecords.groups.*` still exists. It's a guard so nobody deletes it as "unused".

## Unit: form selection through `tp`

Using `createPluralTranslator` with the real catalogs:

- **T5.** For `transactions.status.overdue`, en 1 gives "1d overdue". In ar: 3 gives the `few` form (contains "أيام"), 11 the `many` form (contains "يومًا"), 1 the `one` form (no digit), and 2 the `two` form.
- **T6.** `projects.summary.projectsCount`: en 1 gives "1 project", en 2 "2 projects".
- **T7.** `transactions.status.dueIn`: en 1 gives "Due in 1d".

## Component (existing suites, extended)

- **T8.** `HomeAttentionRow`: Arabic, an overdue row with 3 days renders the few form. An English due-in row with 1 day renders "Due in 1d".
- **T9.** `ClientsPage`: the summary with 1 client reads "1 client". The oldest-overdue subline in Arabic for 11 days renders the many form.
- **T10.** `RecurringOccurrenceCard` / ExpensesLedger receipt badge: English 1 gives "1 receipt attached".
- **T11.** `YourDataSection` / `OrphanedRecordsBanner`: count 1 and count 5 each pick the right form (this replaces the old ternary tests).

## Grep gate (run before Green is declared)

`grep -rnE "t\('(transactions\.status\.(overdue|dueIn)|clients\.index\.oldestOverdue|…)'" src` must return no `t(` callers for converted keys outside tests.

## Release-QA

The scenarios in the brief become `qa/features/web/{landing,clients,home}.yaml`, with matching tagged specs. Each must pass once via `release-qa run --attach --only <id>`, and `release-qa lint` must be clean.

## Gate

Run under Node 22: `npm run lint`, `npm run typecheck`, `npm run test:run` and `npm run build`.
