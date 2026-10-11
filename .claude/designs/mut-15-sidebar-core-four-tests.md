# Test Plan — MUT-15: Simplify the sidebar to Home / Clients / Income / Settings

Companion to `mut-15-sidebar-core-four.md`. Vitest + jsdom. Settings come in through the repository seam (`installFakeSettings` in `SidebarNav.features.test.tsx`), so flags flow through the real `useFeatureFlags` → TanStack Query path. Baseline before the change (2026-10-11, worktree at `main` 0c57247): **130 files, 2,149 passed, 5 skipped, 0 failed.**

## 1. `featuresTurnedOff` — extend `src/lib/features/__tests__/features.test.ts`

| Case | Expect |
|---|---|
| identical maps | `[]` |
| one key true → false | `[that key]` |
| false → true only | `[]` |
| several off at once | the keys in `FEATURE_KEYS` order |
| mixed (one on, one off) | only the one that went off |

## 2. `useLeaveDisabledArea` — new `src/lib/features/__tests__/leaveDisabledArea.test.tsx`

Real router (`createMemoryHistory`), a route tree of `/` + `/expenses` (`beforeLoad: requireFeature('expenses')`) + `/income` (ungated), a root component that calls the hook, fake settings repo, real QueryClient.

| Case | Expect |
|---|---|
| on `/expenses` with expenses on; switch expenses off + invalidate `['settings']` | pathname becomes `/`; history has one entry (replace, Back cannot return) |
| on `/income`; switch expenses off | stays on `/income` |
| on `/expenses`; switch *another* area off (invoices) | stays on `/expenses` (guard re-runs, still admits) |
| on `/expenses`; switch an area **on** or change a non-feature setting (`defaultCurrency`) | `router.invalidate` not called (spy) |
| first load (flags resolve from loading `false` to stored values) | `router.invalidate` not called |

## 3. Add-menu action list — new `src/components/layout/__tests__/addMenuActions.test.ts`

| Case | Expect |
|---|---|
| all areas off | `['income', 'client']` |
| expenses on | `['income', 'client', 'expense']` |
| projects on | `['income', 'client', 'project']` |
| all on | `['income', 'client', 'expense', 'project']` |
| any combination of the six flags (exhaustive, 64 maps) | the first two are always `income`, `client`: core never moves |

## 4. Sidebar — extend `src/components/layout/__tests__/SidebarNav.features.test.tsx`

`useLocation` mock becomes configurable per test (`mockPathname`).

| Case | Expect |
|---|---|
| fresh install (all off) | exactly four `a.nav-item` links in order **Home, Clients, Income, Settings**; no "More" header; no "Main"/"Workspace" header |
| all six areas on | links 1–3 still Home, Clients, Income; "More" holds Expenses, Documents, Retainers, Insights, Planning, Projects in that order; Settings last |
| switch an area on, then off (invalidate `['settings']`, no remount) | entry appears in "More", then disappears; the core three are the same DOM nodes throughout (node identity, so no remount or reorder) |
| Settings | rendered inside `.sidebar-footer`, present with every flag combination tested above |
| active state, parametrised over §3.4 of the brief (`/`, `/clients`, `/clients/c1`, `/income`, `/expenses`, `/documents/d1/edit`, `/projects/p1`, `/settings/profiles/p1`) | exactly one link has `aria-current="page"` and class `active`, and it is the expected entry; on `/clients` Home is **not** active |
| collapsed (`localStorage.sidebarCollapsed = '1'`) | four links, no visible labels, each link's `title` is its label key; no section headers; toggle reads `nav.expand` |
| collapse toggle click | labels appear/disappear; `localStorage` flips |
| `+ New` menu, all off | items in order Add Income, Add Client |
| `+ New` menu, expenses + projects on | Add Income, Add Client, Add Expense, Add Project |
| `+ New` keyboard (D5) | opening focuses the first item; ArrowDown/ArrowUp wrap; Home/End jump; Escape closes and focuses the button; Tab closes |

## 5. Top bar — new `src/components/layout/__tests__/TopBar.addMenu.test.tsx`

| Case | Expect |
|---|---|
| all off | Add menu items Income, Client |
| expenses + projects on | Income, Client, Expense, Project |
| keyboard (D5) | same contract as the sidebar menu |
| `hideAddMenu` | no Add button |

## 6. Onboarding (D4) — extend `src/components/onboarding/__tests__/` (overlay projects test)

| Case | Expect |
|---|---|
| projects off | indicator renders two steps numbered 1, 2 (client, income); no ticked step before the client step completes |
| projects on | three steps, as today |
| projects off, client step done | step 1 ticked, step 2 current |

## 7. Unchanged structural tests that must stay green

`router.gates.test.ts`, `router.gateKeys.test.ts`, `legacyRedirects*.test.ts`, `routeGuard.test.ts`, `i18nParity.test.ts` (the four removed keys go from both locales).

## 8. E2E — `e2e/navigation.spec.ts` (run locally once; e2e is not in CI, TD-004)

| Case | Expect |
|---|---|
| fresh profile | sidebar links Home → Clients → Income → Settings navigate to `/`, `/clients`, `/income`, `/settings`; no Projects, Transactions or Reports link |

## 9. Manual browser check (dev server)

English and Arabic × expanded and collapsed × all off and all on: core order, "More" below, Settings at the bottom, active rail on the inline-start edge, chevron pointing toward the collapsing edge, collapsed divider. Then: open `/expenses` in one tab, switch Expenses off in a second tab, wait past the settings query's one-minute `staleTime`, focus the first tab → the Expenses entry disappears and the tab lands on Home. Also: on `/expenses`, switch Expenses off in Settings and press Back → Home, not the ledger (the guard redirects again).
