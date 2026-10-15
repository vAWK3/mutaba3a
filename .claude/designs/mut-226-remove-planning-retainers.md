# MUT-226: Remove Financial Planning and local Retainers (server retainers stay)

**Ticket**: MUT-226 (Story, epic MUT-2) · **Date**: 2026-10-15 · **Status**: Approved 2026-10-15. Basel: "build (remove everything), but drop data it's ok, remove planning table and local retainers tables and clean up db and table and everything, but don't touch server". D1 and D2 were revised from "tables stay" to "tables drop".
**Precedent**: MUT-145 / ADR-067 (document generation removal) · **Rule applied**: ADR-029

## Problem

Planning and local Retainers are two of the six optional areas behind Settings › Advanced features (ADR-032). Neither belongs to the client-accounting core:

- **Planning** is a self-contained cash-projection tool built in one commit, `a7151d3`. It works only from hand-typed assumptions; it never reads income, expenses or retainers, and nothing outside it reads its data. It has one open bug, MUT-219 (CSV confidence shown as 7500%).
- **Local Retainers** is a schedule of *expected* payments. Activating a retainer writes rows into `projectedIncome`, and a drawer matches a received income entry to one period. It never creates income and is never counted in Home, owed totals, Insights, client summaries or the All-businesses lens. Open bug: MUT-222. MUT-180 was fixed but is moot after this.

Basel's decision (2026-10-15): remove Planning entirely, remove Retainers from the local app, and keep the server's Money v1 retainers for now.

## Acceptance criteria

1. No route, sidebar item, Settings › Advanced toggle, drawer, client-page card, demo-modal line or i18n key for Planning or Retainers remains in the local app.
2. `/planning` and `/retainers`, with any search params, redirect to `/`.
3. A stored `features.planning` / `features.retainers` flag or a `featureNotice` entry is ignored. No banner shows a raw key.
4. Dexie v24 drops `plans`, `planAssumptions`, `planScenarios`, `retainerAgreements` and `projectedIncome`.
   - Every other user row is unchanged, apart from the stripped `linkedProjectedIncomeId`.
   - A pre-v24 backup still restores its other tables.
   - The stored `planning`/`retainers` flags and notices are removed from settings.
5. The server and hosted portal are untouched: no `server/` diff and no `src/hosted/` diff.
6. Gate: `npm run lint`, `typecheck`, `test:run` and `build` all pass under Node 22. `release-qa lint` is clean.

## Decisions

- **D1. Dexie v24 drops the five tables (revised: an explicit override of ADR-029, logged in ADR-082 as ADR-053 did).**
  - `this.version(24).stores({ plans: null, planAssumptions: null, planScenarios: null, retainerAgreements: null, projectedIncome: null, transactions: <v17 string without linkedProjectedIncomeId> })`.
  - Versions 1–23 stay as written.
  - `migration-safety.ts` drops the two retainer tables from `ALL_TABLES`.
  - No `src/db/retained/` types are needed.
- **D2. `linkedProjectedIncomeId` is cleaned up everywhere.**
  - It leaves the `Transaction` type and the transactions index.
  - The v24 upgrade deletes the field from every transaction row that has it.
  - Like v20/v22/v23, an upgrade failure is logged, never thrown, and the stores drop regardless.
  - Restoring a pre-v24 backup skips the five tables (existing behaviour of `restoreFromBackup`). A stale `linkedProjectedIncomeId` on a restored transaction is inert, because nothing reads it.
- **D2b. Settings cleanup in the same upgrade.** The v24 upgrade deletes `features.planning` and `features.retainers` from the settings row, and filters `planning`/`retainers` out of `featureNotice`.
- **D3. Feature keys.**
  - `FEATURE_KEYS` and `FeatureKey` shrink to `expenses`, `insights`, `projects` and `conversions`, and both probes go.
  - Existing code already makes stored keys inert: `resolveFeatures` drops unknown keys, and `useFeatureNotice` filters through `FEATURE_KEYS` (ADR-067 §3).
  - The v20 upgrade (`database.ts` ~911) iterates `FEATURE_DATA_PROBES`, so it simply stops considering the two areas. Its historical store declarations stay.
- **D4. Redirects.** `/planning` and `/retainers` become redirect routes to `/`, in the same style as the `/expenses/forecast` legacy route (`router.tsx:249`). The router has no not-found component.
- **D5. Server and portal untouched.**
  - `src/hosted/api/schema.d.ts` (generated from openapi) and `incomeAffordances.ts` (`RETAINER_CHARGE` non-settleable) stay as they are.
  - No API version bump.
- **D6. Demo seed.** The retainer and projected-income seed files, their counts in `demo/constants.ts` and `demo/types.ts`, the `retainerAgreements` entry in the visitor sample (`demoData.ts`, ADR-042), and `DemoSeedModal`'s "retainers" line all go.

## Deletion inventory

**Planning**
- `src/pages/planning/**`: 10 files, ~1.8k lines.
- `src/components/drawers/PlanAssumptionDrawer.{tsx,css}`.
- `src/services/planCalculationService.ts` and its test.
- `src/db/planRepository.ts`.
- `src/hooks/usePlanQueries.ts` and its test.
- Plan types, `types/index.ts` ~914-1030. `CurrencyBreakdown`/`AssumptionFrequency` have no other users.
- Interface and registry slots in `db/interfaces.ts` and `db/provider.ts`.
- The drawer slice in `lib/stores.ts` (~203-219, 546-570) and its mount in `AppShell.tsx`.
- `SidebarNav` entry and `PlanningIcon`.
- `planningRoute`.
- About 87 i18n keys per locale.
- `qa/features/web/planning.yaml`, `qa/specs/web/planning.spec.ts`, and the Planning screen in `brand.spec.ts`.

**Local Retainers**
- `src/pages/retainers/**`.
- `RetainerDrawer`, `RetainerMatchingDrawer` and `ClientRetainersCard`, plus its mount in `ClientDetailPage.tsx`.
- `src/db/retainerRepository.ts` (970 lines) and `useRetainerQueries.ts` (23 hooks).
- Store slices in `lib/stores.ts` (~133-176, 412-508).
- Mounts in `AppShell.tsx`.
- `SidebarNav` entry and `RetainerIcon`.
- `retainersRoute`.
- Retainer and `ProjectedIncome*` types (`types/index.ts` ~690-837, including the unused `ForecastOptions.includeProjectedRetainer`).
- Interface and registry slots.
- The `eslint.config.js:50` allowlist entry.
- `index.css` ~3551-4042, the matching drawer.
- About 120 en / 148 ar keys, plus the orphaned `insights.toggles.includeProjected`.
- Demo seed (D6).
- `qa/features/web/retainers.yaml` and `qa/specs/web/retainers.spec.ts`.
- `qa/support/app.ts` `enableOptionalArea` union.

**Edited tests**
- Router: `router.gates`, `router.gateKeys`, `router.owedLens`.
- Features: `SidebarNav.features`, `features`, `featureDataProbes`, `reconcile`, `routeGuard`, `useFeatures`, `leaveDisabledArea`, `gatingDataSafety`. These use retainers as the example probe; switch them to `projects`/`expenses`.
- Data layer: `provider`, `settingsRepo`, `useAddMenuActions`, `stores`, `ClientDetailPage`, `migration-safety`.
- i18n: `i18nParity`.
- `migration-v20` and `migration-v21` keep their historical schema declarations; only their probe expectations change.

## New guard tests (written first: Red)

1. `src/__tests__/noDeadPlanningRetainerModules.test.ts`
   - No file under `src/` outside `src/hosted/` and `src/db/retained/` imports or names `planRepository`, `usePlanQueries`, `planCalculationService`, `PlanAssumptionDrawer`, `retainerRepository`, `useRetainerQueries`, `RetainerDrawer`, `RetainerMatchingDrawer` or `ClientRetainersCard`.
   - The two page directories do not exist.
   - Modelled on `noDeadDocumentModules.test.ts`.
2. `src/db/__tests__/migration-v24.test.ts`, modelled on `migration-v21.test.ts`:
   - A v23 database seeded with plans, assumptions, scenarios, retainers, projected income, a transaction carrying `linkedProjectedIncomeId`, and settings with `planning`/`retainers` flags and notices opens at v24 without errors.
   - The five stores are gone, on disk and in the schema.
   - Every other user row is unchanged, except that the field is stripped.
   - The settings flags and notices are removed.
   - A fresh install is created at v24 without the five stores.
   - A pre-v24 backup restores every other table and skips the five.
3. Router test: `/planning?plan=x` and `/retainers?status=active` both land on `/`.
4. Features test: settings with `features: { planning: true, retainers: true }` and `featureNotice: ['planning','retainers']` resolve to no extra areas and no banner.

## QA scenarios (release-QA, Phase 5)

| id | Steps | Expect |
|---|---|---|
| `web.navigation.retired-areas` | Open a fresh install, then a bookmarked `/app/planning?plan=p1`, then `/app/retainers?status=active`, then Settings | Each lands on Home, and the sidebar has no Planning or Retainers entry. Settings › Features shows exactly Expenses, Insights, Projects and Currency conversions |

Both scenarios are one spec. `planning.yaml`, `retainers.yaml` and their specs are deleted, and every path they mapped was deleted with them. `release-qa lint` reports no errors and the same 6 unmapped web files as `main`.

**Build note:** the redirect checks went into the existing `router.gateKeys.test.ts` (its `LEGACY_REDIRECTS` table plus a no-component/no-search case) instead of a new file, so the MUT-145 pattern has one home.

## Impact

- About 9-10k lines deleted. The bundle loses two lazy chunks, the matching drawer's ~490 CSS lines and about 210 i18n keys per locale.
- **Plan and local-retainer rows are deleted on upgrade** (D1, owner-approved). They remain only in backups saved before v24. No core record (income, payments, clients, projects, expenses) is touched.
- i18n: deletions only, in both locales, kept in parity.
- Cost and infra: none.

## Knowledge updates on landing

- **New ADR-082** (renumber on merge if the MUT-223 worktree claims it first): Planning and local Retainers are retired; tables stay; server retainers are unaffected. Narrow override of ADR-032. Explicit override of ADR-029 for the five tables, with an override log like ADR-053. Cites ADR-067.
- **CHANGELOG**: one entry.
- **SYSTEM_OVERVIEW, COMPONENT_REGISTRY, PATTERNS, TEST_PLAN**: remove the planning and retainer rows.
- **TECH_DEBT**: TD-074 retainer/plan half is moot. TD-047 (the PlanAssumptionDrawer part) and TD-120/TD-014 are noted as moot.
- **TODOS #10**: drop plans from the list.
- **Jira**: close MUT-219 and MUT-222 as Won't Do, linked to MUT-226.

## Build

- One worktree at `.claude/worktrees/mut-226-remove-planning-retainers`, branch `feat/mut-226-remove-planning-retainers`, tag `pre-mut-226`.
- Commit order:
  1. Guard tests (Red).
  2. Planning removal.
  3. Retainers removal.
  4. Dexie v24, redirects and feature keys.
  5. QA.
  6. Knowledge files.
- Then `/qa-reconcile MUT-226`, and merge to local main (not pushed).
