# Test Plan — MUT-16: Gate insights, planning and projects

Companion to `mut-16-gate-insights-planning-projects.md`. Vitest + jsdom; settings injected through the repository seam or `vi.mock('.../lib/features/useFeatures')` as the existing page tests do.

## 1. Routes — extend `src/__tests__/router.gates.test.ts`; new `src/lib/features/__tests__/legacyRedirectsCore.test.ts`

| Case | Expect |
|---|---|
| `/insights`, `/planning`, `/projects`, `/projects/$projectId` | carry a `beforeLoad` (gated) |
| `/reports` `beforeLoad` with all flags off | throws redirect `to: '/insights'` (unconditional); the insights gate then bounces home — proven by calling `requireFeature('insights')()` with flags off |
| `/transactions` `beforeLoad({ search: { q: 'x' } })` | redirect `to: '/income'` carrying `search` |

## 2. Sidebar — extend `src/components/layout/__tests__/SidebarNav.features.test.tsx`

| Case | Expect |
|---|---|
| all off | no `nav.insights`, `nav.planning`, `nav.projects`; main shows Home and Income; workspace shows Clients; `+ Add` has no Project |
| projects on | Projects in "More"; `+ Add` offers Project |
| insights + planning on | both in "More" in order after any earlier entries |

## 3. Client profile — extend `src/pages/clients/__tests__/ClientDetailPage.test.tsx`

| Case | Expect |
|---|---|
| projects off | no Projects tab button; no "+ Project" button; the Transactions tab still shows `tx.projectName` as text (AC 4) |
| projects on | Projects tab button present; clicking it renders the projects table with links |

## 4. Drawers — extend `src/components/__tests__/IncomeDrawer.test.tsx`; new `ExpenseDrawer.projectField.test.tsx` only if `ExpenseDrawer` has no test to extend

| Case | Expect |
|---|---|
| projects off, create | no project field rendered |
| projects on, create | project field rendered |
| projects off, edit an entry that has `projectId` | save keeps `projectId` (payload includes it unchanged) |

## 5. Onboarding — `src/components/onboarding/__tests__/OnboardingOverlay.projects.test.tsx`

| Case | Expect |
|---|---|
| projects off, store at `project` step | effect completes the step; `currentStep` becomes `income`; `completedSteps` includes `project` with no `createdProjectId` |
| projects on, store at `project` step | nothing happens |

## 6. Gates

`npm run lint`, `npx tsc --noEmit -p tsconfig.app.json`, `npx vitest run` (target 0 failing files), `npm run build`.
