# Test Plan — MUT-14: Collapse expenses to one ledger

Companion to `mut-14-collapse-expenses.md`. Vitest + jsdom + fake-indexeddb.

## 1. The 18 failing ledger tests (MUT-20) — `src/pages/expenses/__tests__/ExpensesLedgerPage.test.tsx`

Add `vi.mock('../../../hooks/useActiveProfile')` returning `{ activeProfile: { id: 'profile-1', name: 'Test' }, activeProfileId: 'profile-1', isAllProfiles: false, profiles: [...] }` and `useProfileFilter: () => 'profile-1'`. All 18 existing cases must pass unchanged. Add one case: with no active profile the page shows `expenses.noProfileSelected` (pins the branch the old setup fell into).

## 2. Receipts export — `src/lib/__tests__/zipExport.test.ts`

| Case | Expect |
|---|---|
| receipts in two profiles × two months | one ZIP with `<profile>/<YYYY-MM>/<fileName>` entries, count equals receipts |
| duplicate file names in one month | both kept (suffix) |
| no receipts | throws / returns `null` (the Settings button is disabled at 0, so this is the API contract only) |

Settings row: `src/pages/settings/__tests__/DataTools.receipts.test.tsx` — shows `Export receipts (N)`, disabled at 0, calls the exporter.

## 3. Gating — extend `src/__tests__/router.gates.test.ts` and `src/components/layout/__tests__/SidebarNav.features.test.tsx`

| Case | Expect |
|---|---|
| `/expenses` | has a `beforeLoad` (gated) |
| each legacy path (`/expenses/profiles`, `/expenses/profile/$profileId`, `…/receipts`, `/expenses/overview`, `/expenses/forecast`, `/expenses/vendors`, `/expenses/close/profile/$profileId`, `/suppliers`) | exists, has a `beforeLoad`, has no `component` |
| sidebar, expenses off | no `nav.expenses` anywhere; no `nav.suppliers`; `+ Add` menu has no Expense item |
| sidebar, expenses on | `nav.expenses` inside the "More" section, before Documents; `+ Add` offers Expense |

## 4. Legacy redirect behaviour — `src/lib/features/__tests__/legacyRedirects.test.ts`

Calls each legacy route's `beforeLoad` and asserts a thrown redirect to `/expenses` (no flag read needed).

## 5. Pruning verification — `src/__tests__/noDeadExpenseModules.test.ts`

Asserts that the deleted modules do not exist (`fs.existsSync` false for the page files, `forecastCalculations.ts`, `matchingAlgorithm.ts`, `ClosedMonthWarning.tsx`, `RecurringRuleDrawer.tsx`) and that `src/components/ui/index.ts` no longer exports `ClosedMonthWarning`. Cheap guard against a revert of one deletion commit resurrecting dead code.

## 6. i18n — extend `src/lib/features/__tests__/i18nParity.test.ts`

| Case | Expect |
|---|---|
| `expenses` subtree | en and ar have identical key sets |
| removed groups | neither locale has `suppliers`, `monthClose` or `receipts` top-level keys |

## 7. Data safety — `src/lib/features/__tests__/expensesGatingDataSafety.test.ts`

Seed receipts, vendors, expenses, recurring rules; flip `expenses` off → on → off; assert all counts unchanged and `db.verno === 20`.

## 8. Gates

`npm run lint`, `npx tsc --noEmit -p tsconfig.app.json`, `npx vitest run` (target: **0 failing files**), `npm run build`.
