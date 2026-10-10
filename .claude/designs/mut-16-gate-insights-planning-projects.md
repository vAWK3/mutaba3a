# Design Brief — MUT-16: Gate insights, planning and projects behind the Advanced toggle

- **Date:** 2026-10-10
- **Epic:** MUT-2 "Strip to the core: delete dead surface, gate the optional"
- **Blocked by:** MUT-12 (built, 8fab72a). **Builds on:** MUT-13 (`requireFeature`, the sidebar "More" section, ADR-030 addendum), MUT-14 (D9: recorded data stays visible; create entry points follow the switch).
- **Related:** MUT-15 (sidebar simplification and the `+ Add` menu — the final grouping stays its call).
- **Note on suppliers:** the ticket lists four areas; `suppliers` folded into `expenses` in MUT-12 (ADR-030 §5) and the `/suppliers` view was deleted in MUT-14, so this ticket gates **three**: insights, planning, projects.
- **Worktree:** `.claude/worktrees/mut-2-strip-core`, branch `feature/mut-2-strip-core`.
- **Status:** planned 2026-10-10; outside voice recorded in §9; building under the owner's standing instruction (MUT-12 → 13 → 14 → 16).

---

## 1. Problem and acceptance criteria

Insights (`/insights`), planning (`/planning`) and projects (`/projects`, `/projects/$projectId`) sit in the default sidebar without serving the core job. They stay as optional areas (intake 2026-10-05); this ticket gates them with the pattern MUT-13 fixed, and resolves the three places where "projects off" collides with core flows (brief MUT-12 §12).

Acceptance criteria (ticket, with the suppliers item already satisfied by MUT-12/14):

1. All toggles off → none of the three appears in the sidebar; each route redirects to home.
2. A toggle on → the area is reachable and behaves as today.
3. `/reports` and `/transactions` redirect correctly whether or not the target area is enabled.
4. Project data on existing transactions is untouched and still displays on the client profile work list when Projects is off.
5. An install with existing projects or plans gets the relevant toggle auto-enabled on upgrade (MUT-12's v20 probes: `projects`, `plans`; insights never — it owns no data).
6. Deep-linking to a gated route while disabled redirects cleanly with no flash (MUT-13's `beforeLoad` + `defaultPendingComponent`).
7. `npx tsc -b` passes; lint no new errors; full suite green.
8. Tests: off-state redirects, on-state access, legacy redirects, project display with Projects off.

## 2. What the audit found (verified 2026-10-10)

| Fact | Evidence | Consequence |
|---|---|---|
| No surviving code deep-links into insights or planning | `grep` for `to: '/insights'`, `/planning` outside their pages and the router: none | Route guards + sidebar entries are the whole job for those two |
| The only deep link into projects is the client profile's **Projects tab** (`ClientDetailPage.tsx:384` `<Link to="/projects/$projectId">`), plus two **+ Project** buttons (`:339`, `:355`) | With projects off the links would bounce home | Hide the Projects tab and its buttons while off; project **names** on the work list are plain text already (`:315`, `:462`, `:591`) — AC 4 holds by construction, pinned by a test |
| `+ Add → Project` exists twice: sidebar `newMenuItems` (`SidebarNav.tsx:110`) and the top bar (`TopBar.tsx:174`) | Creating a project into a hidden area | Both follow the switch (MUT-14's `feature` field on the sidebar item; the top bar gets the same `expensesEnabled`-style guard) |
| The income and expense drawers carry an optional **project** field (`IncomeDrawer.tsx:425`, `ExpenseDrawer.tsx:566`) | A grouping tag for an area the user turned off | Field hidden while off; an existing `projectId` on an edited entry is **kept** (the field is just not shown), so toggling never strips data |
| Onboarding is `client → project → income` (`onboardingStore.ts:24`); `isOnboardingComplete` requires the project step (`:90`) | A fresh install (projects off) would ask a new user to create a project they cannot see afterwards | While projects is off, the overlay auto-completes the project step (no entity) so onboarding is `client → income` |
| `/reports` → `/insights` and `/transactions` → `/income` are unconditional `beforeLoad` redirects (`router.tsx:64`, `:102`) | `/reports` then meets the insights gate | Already correct: a redirect chain, no flash; pinned by a test that calls both with the flags off |
| Home shows no insights/planning/projects links (`components/home`, `pages/overview`: none) | — | Nothing to gate on Home; D9 (recorded data visible) needs no new decision |

## 3. Where it lives

| Concern | Change |
|---|---|
| Routes | `beforeLoad: requireFeature('insights')` on `/insights`; `requireFeature('planning')` on `/planning`; `requireFeature('projects')` on `/projects` and `/projects/$projectId` (`src/router.tsx`). Components stay lazy |
| Sidebar | Insights and Planning leave `main`, Projects leaves `workspace`; all three join `optionalItems` with their `feature` keys (after expenses, documents, retainers). `newMenuItems` project entry gets `feature: 'projects'` |
| Top bar | `TopBar.tsx` New project button guarded by `useFeatureEnabled('projects')` (same shape as the expense guard from MUT-14) |
| Client profile | `ClientDetailPage.tsx`: Projects tab button, the tab body and both **+ Project** buttons render only while projects is on; if the active tab was `projects` when the switch turns off, fall back to `summary` |
| Drawers | `IncomeDrawer.tsx` and `ExpenseDrawer.tsx`: the project form group renders only while projects is on; form state untouched |
| Onboarding | `OnboardingOverlay.tsx`: `useEffect` — projects off and `currentStep === 'project'` → `completeStep('project')`; the project card shows as done |
| i18n | nothing new (`nav.insights`, `nav.planning`, `nav.projects`, `nav.newMenu.project` exist) |

## 4. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Three areas, three keys; no `suppliers` work | ADR-030 §5, MUT-14 |
| D2 | The sidebar's "More" section receives the entries in the order expenses, documents, retainers, insights, planning, projects; main becomes Home + Income, workspace becomes Clients | Smallest change that makes AC 1 true; MUT-15 reshapes the whole nav (it may collapse main/workspace into the four-item core) |
| D3 | Drawer project fields hide, never clear | Ticket: `Transaction.projectId` untouched; hiding is enough and reversible |
| D4 | Onboarding skips the project step while projects is off, by auto-completing it | The store's completion rule stays (`client`, `project`, `income`); no persisted-state migration; a user who turns projects on later simply has a completed step |
| D5 | Projects tab on the client profile hides while off; work-list project names stay | AC 4 verbatim; the tab's only actions are links into the gated area and project creation |
| D6 | Legacy redirects stay unconditional | AC 3; `/reports` → `/insights` → gate → home is one chain with no render |

## 5. Reuse, impact, cost

- **Reuse:** `requireFeature`, `useFeatureEnabled`, `useFeatureFlags`, the `optionalItems` seam, `router.gates.test` / `SidebarNav.features.test` patterns, MUT-14's top-bar guard.
- **Impact:** no schema, repository or i18n changes. Nine source files: `router.tsx`, `SidebarNav.tsx`, `TopBar.tsx`, `ClientDetailPage.tsx`, `IncomeDrawer.tsx`, `ExpenseDrawer.tsx`, `OnboardingOverlay.tsx` (+ tests).
- **Out of scope (ticket):** deleting any area; redesigning insights or planning; removing `Transaction.projectId` or `Project`; the `+ Add` menu's final shape (MUT-15).

## 6. Risks

- **R1 — ProjectTypeahead inside drawers reads projects even while hidden?** No: the `Controller` is not rendered, so no query runs.
- **R2 — Tests that mock `@tanstack/react-router` for pages now rendering flag-aware components** (`ClientDetailPage.test` already mocks `useFeatures`; `IncomeDrawer.test`, `OnboardingOverlay` tests may need the same mock). Handled per file.
- **R3 — A user mid-onboarding on the project step when the switch flips off**: the effect completes the step on next render; nothing is lost.

## 7. Build order

1. Router guards + `router.gates.test` (+4 gated) + legacy-redirect test (`/reports`, `/transactions` with flags off). Commit.
2. Sidebar + top bar: entries move, `+ Add → Project` follows the switch; `SidebarNav.features.test` (+1). Commit.
3. Client profile: Projects tab/buttons gated; test (tab hidden, work-list names visible, tab visible when on). Commit.
4. Drawers: project field gated; `IncomeDrawer` test (field hidden/shown; edit keeps `projectId`). Commit.
5. Onboarding skip + test. Commit.
6. Knowledge files; `npm run lint`, `tsc --noEmit`, full suite, `npm run build`.

## Business / product impact
- Completes the "gate the optional" half of MUT-2 for every area the intake named: a fresh install's sidebar is Home, Income, Clients, Settings (plus "More" only when something is on) — MUT-15's target shape, reached early.
- The three project collisions (onboarding, add menus, drawer field) are resolved here rather than discovered by a new user.
- No data path changes; every gate is a flag read plus a redirect.

## 8. Engineering review (condensed, 2026-10-10)

- **Scope:** 7 source files, 0 new modules; arrangement accepted.
- **A1 [P2] (8/10)** `onboardingStore.ts:90` — completion requires the project step; gating without D4 would strand new users on a step whose drawer creates an invisible entity. Resolved: D4.
- **A2 [P2] (8/10)** `ClientDetailPage.tsx:384` — the Projects tab links into a gated area. Resolved: D5.
- **A3 [P3] (7/10)** `TopBar.tsx:174` and `SidebarNav.tsx:110` — two create entry points; MUT-14 gated the expense ones, projects follow the same pattern. Resolved.
- **C1 [P3]** `IncomeDrawer` keeps `projectId` in form state while the field is hidden; a create with a prefilled `defaultProjectId` from a (gated) project page cannot happen while off. No change.
- **Tests:** existing `ProjectsPage.test`, `ProjectDetailPage.test`, `InsightsPage.test` prove on-state behaviour; new tests cover off-state and the collisions.

## 9. Outside voice

Recorded when the native fallback review completes (Codex not installed).
