# Test plan — MUT-268 Portal expense groups

TDD: each file below is written before the code it covers. Command: `export PATH=/Users/basel/.nvm/versions/node/v22.23.1/bin:$PATH; npm run test:run -- <path>`.

| AC | Unit / component test | QA feature |
|---|---|---|
| 1 create + list | `GroupDrawer.test.tsx` (defaults, POST body, key), `ExpenseGroups.test.tsx` (lands on detail, members oldest first) | `create` |
| 2 exclude | `expenseGroups.test.ts` (`actionFor`, `applyMarks`), `expenseGroupQueries.test.tsx` (R1 no double count, R3 order), `ExpenseGroups.test.tsx` (Left out, Undo) | `leave-out-undo`, `category-prune` |
| 3 add from outside | `expenseGroups.test.ts` (`pickerWindow`), `AddToGroupDrawer.test.tsx` (pool, sequential, partial) | `add-from-outside`, `in-groups-line` |
| 4 currencies / ≈ | `expenseGroups.test.ts` (`convertTotal`, `defaultCurrency`, `perDay`, `toBars`), `ExpenseGroups.test.tsx` (FX hidden/stale) | `currencies-converted` |
| 5 states | `ExpenseGroups.test.tsx` (list: loading/empty/error/nudges; detail: empty past/ongoing, upcoming, all left out, 404, FX) | `states` |
| 6 Arabic/RTL/375 | `DayBars.test.tsx` (RTL arrows), `ExpenseGroups.test.tsx` (dir=rtl default) | `arabic-375` |
| 7 release-QA | — | all, `release-qa lint` |

Supporting: `SectionTabs.test.tsx`, `Toast.test.tsx` (action, both tones, pause), `CategoryBars.test.tsx`, `rowEnter.test.ts`, `filters.test.ts` (`parseGroupsPage`, `parseGroupDetail`, `category=none`), `ExpenseDrawer.test.tsx` (In groups line), `expenseQueries` invalidation.

Edge cases pinned: open group past a year (reachedYear copy), single-currency group (no tab, no redundant ≈), group > 31 days (weekly), 375 px > 21 days (weekly), JOD 3 decimals, Uncategorized last, a day with spend only in another currency (dot), a 201st group (GROUP_LIMIT then fresh key), 409 on edit, delete without 404 flash.
