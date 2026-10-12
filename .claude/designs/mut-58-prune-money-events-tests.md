# Test Plan — MUT-58: Prune the money-event read side MUT-8 left without a screen

Epic MUT-2. Follows MUT-8's brief (`mut-8-home-owed-attention-payments.md`, D10 = B) and ADR-036 §3; closes TD-034.
Vitest + jsdom + fake-indexeddb. A deletion with zero behaviour change, so TDD means the guard goes red first and the deletion turns it green.

## 0. Consumer audit (re-run on main `5674515` before deleting)

| Candidate | Non-test references on main | Verdict |
|---|---|---|
| `src/hooks/useMoneyEventQueries.ts`: `useMoneyEvents`, `useDailyAggregates`, `useMonthSummary`, `useMonthKPIs`, `useMonthKPIsBothCurrencies`, `useGuidance`, `useDayEvents`, `useYearSummary`, `useYearSummaryBothCurrencies`, `useInvalidateMoneyEvents`, `moneyEventQueryKeys` | none | delete |
| `invalidateMoneyEventQueries` | `useQueries.ts` (`invalidateTransactionQueries`), `useExpenseQueries.ts` (`invalidateExpenseQueries`), `useRetainerQueries.ts` (`invalidateProjectedIncomeQueries`). `useIncomeQueries.ts` no longer calls it directly: since MUT-5 it reuses `invalidateTransactionQueries` | delete with its three call sites |
| `src/db/moneyEventRepository.ts` (`moneyEventRepo`) | only `useMoneyEventQueries.ts`; no slot in `provider.ts` / `interfaces.ts`, not in the `db` barrel | delete |
| `src/lib/monthDetection.ts` (9 exports) | none; its last importers were the components MUT-8 deleted | delete |
| `src/types/index.ts`: `MoneyDirection`, `MoneyEventSource`, `MoneyEventState`, `MoneyConfidence`, `MoneyEvent`, `DailyAggregate`, `MonthSummary`, `YearSummary`, `GuidanceSeverity`, `GuidanceCategory`, `GuidanceItem`, `MoneyEventFilters` | none outside the type block itself | delete |
| `MoneyEventVersion` (`src/sync/core/ops-types.ts`, imported by `database.ts`) | the `moneyEventVersions` table, `ops-engine.ts`, `conflict-resolver.ts`, the sync barrel | **keep**: sync versioning, not the read side; the table stays (ADR-029) |
| `src/lib/aggregations.ts` + `ForecastKPIs`, `MonthActuals`, `ForecastOptions`, `AmountByCurrency`; `AttentionItem` | `aggregations.ts` has no app importer and never had one (added unwired in `9fb9fd7`); the types are read only by it | **out of scope**: not kept alive by the money-event files. Recorded as TD-071 |

## 1. Deletion guard — `src/__tests__/noDeadMoneyEventModules.test.ts` (new, written first)

| Case | Expect | Red before deletion because |
|---|---|---|
| `hooks/useMoneyEventQueries.ts`, `db/moneyEventRepository.ts`, `lib/monthDetection.ts` (`it.each`) | `existsSync` is false | the files exist |
| no source under `src/` names `useMoneyEventQueries`, `moneyEventRepository`, `invalidateMoneyEventQueries` or `monthDetection` (the guard file itself excluded) | empty list of offending files | the three write-path hooks import the helper |
| `src/types/index.ts` | declares none of the twelve money-event / guidance types listed in §0 | the block exists |
| `moneyEventVersions` is still a Dexie table (ADR-029) | `db.tables` names it | — (green throughout; pins the carve-out) |

## 2. Write paths stop refreshing keys nothing reads — flip the MUT-6 assertions

| File | Case | Before | After |
|---|---|---|---|
| `src/hooks/__tests__/useQueries.test.tsx` | `useCreatePaymentRecord` invalidation | asserts `moneyMonthKPIsBoth`, `moneyGuidance`, `moneyEvents` **are** invalidated | asserts no invalidated root key starts with `money` (red until the call goes) |
| `src/hooks/__tests__/useIncomeQueries.test.tsx` | `useMarkIncomePaid` | "should invalidate the derived money-event views" | same harness, asserts no `money*` root key |

The expense and retainer write paths have no mutation-test harness (TEST_PLAN, MUT-6). §1's source scan covers them.

## 3. Tests deleted with their subjects

- `src/db/__tests__/moneyEvent.test.ts` — the repository's partial-payment normalization.
- `src/hooks/__tests__/invalidateMoneyEventQueries.test.ts` — the nine-key invalidation list.
- `src/lib/__tests__/monthDetection.test.ts` — the month-key helpers.

## 4. Zero behaviour change

- Full `npx vitest run`: the only count change is the deleted files' cases, plus the new guard.
- Full Playwright suite (throwaway config on port 5198; the committed config pins 5173, TD-004): same result as before.
- Browser smoke (`web-mut58`, port 5186, `/app/`): add an income entry, mark it paid, enable Expenses and add an expense; Home, Clients, Income and Expenses render and update; no console errors.

## 5. Gates (Node 22, TD-054)

`npx vitest run`, `npm run typecheck`, `npx tsc -b`, `npm run lint` (0 errors), `npm run build`, `npm run test:bundles`, plus §4's e2e and smoke.
