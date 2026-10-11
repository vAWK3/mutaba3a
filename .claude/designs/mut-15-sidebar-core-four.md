# Design Brief — MUT-15: Simplify the sidebar to Home / Clients / Income / Settings

- **Date:** 2026-10-11
- **Epic:** MUT-2 "Strip to the core: delete dead surface, gate the optional" (last open ticket)
- **Blocked by:** MUT-12 (Done). **Builds on:** MUT-13/14/16 (every optional area already gated: `requireFeature` route guards, the sidebar's "More" section, flag-aware `+ Add` entries; ADR-032 and its addenda).
- **Worktree:** `.claude/worktrees/mut-2-strip-core`, branch `feature/mut-2-strip-core` (recreated from `main` 0c57247).
- **Status:** approved by the owner 2026-10-11, D1–D5 as recommended (no core header; shared `+ Add` list; redirect-on-disable via the route guards; TD-027 fixed here; keyboard support for both menus).

---

## 1. Problem and acceptance criteria

The ticket was written when the sidebar showed eight destinations. MUT-13/14/16 already moved every optional area into a conditional "More" section, so a fresh install shows four links today, but:

- the order is **Home, Income | Clients | Settings** under two headers ("Main", "Workspace"), with Clients, the primary workspace, last of the three core entries;
- the two `+ Add` menus (sidebar **New**, top bar **Add**) gate the same items but list them in **different orders**, and each keeps its own copy of the gating;
- nothing moves a user off a page whose area has just been switched off (the route guards run only on navigation);
- in Arabic the collapse chevron points the wrong way;
- tests cover the "More" entries but not the core order, active state, collapsed mode or keyboard behaviour.

Acceptance criteria (ticket):

1. Fresh install shows exactly four sidebar items: **Home, Clients, Income, Settings**.
2. Enabling an Advanced feature adds its entry to a secondary group without reordering or shifting the core four.
3. Disabling it removes the entry immediately, with no restart.
4. A user on a page whose feature is being disabled is redirected somewhere sensible, not left on a dead screen.
5. `+ Add` offers Income and Client always, Expense/Project only when enabled.
6. Active-state highlighting is correct for every entry, including nested detail routes.
7. Keyboard navigation and collapsed-sidebar mode still work.
8. Settings stays pinned at the bottom and is never gated.
9. Tests cover: default four items, conditional entries, redirect-on-disable, active state, collapsed mode.
10. Guardrails: RTL mirrors correctly (active indicator on the correct edge), i18n keys for all labels, no layout shift when toggles change, lazy loading preserved.

## 2. What the audit found (verified 2026-10-11)

| Fact | Evidence | Consequence |
|---|---|---|
| Core nav is two sections, `main` (Home, Income) and `workspace` (Clients), each with a header | `SidebarNav.tsx:58-74` | Collapse to one header-less core group in ticket order |
| Optional entries already render in a "More" section after the core, only when on, in the order expenses, documents, retainers, insights, planning, projects | `SidebarNav.tsx:78-85`, `:376-377`; `SidebarNav.features.test.tsx` | AC 2/3 already hold; keep the seam and order, add tests that pin "core never moves" |
| Settings is in `.sidebar-footer`, outside the scrolling `.sidebar-nav`, never gated | `SidebarNav.tsx:88-95`, `:381-386`; `index.css:256-265` | AC 8 holds; pin with a test |
| Sidebar **New** menu order: income, expense, client, project. Top bar **Add** menu order: income, expense, project, client. Gating is duplicated (`feature` field vs two `useFeatureEnabled` calls) | `SidebarNav.tsx:100-111`; `TopBar.tsx:85-87`, `:155-183` | One shared list of actions, order and gates for both menus |
| Route guards (`requireFeature`) redirect home, but only run on navigation | `routeGuard.ts`; `router.tsx` (10 gated routes) | An area can be switched off under an open page: a second window of the web build (its settings query refetches on focus, `staleTime` 1 min, `main.tsx:59`) or a restored backup whose settings row has the area off |
| `router.invalidate()` re-runs every active match's `beforeLoad` and follows a thrown redirect with `replace` | Spike against `@tanstack/react-router` 1.144.0, 2026-10-11 (gated route → flag off → `invalidate()` → pathname `/`, history length 1) | Redirect-on-disable can reuse the existing guards; no second route-to-feature table |
| Active state is a prefix match (`/clients` matches `/clients/$clientId`), Home exact | `SidebarNav.tsx:182-190` | Correct for every route (§3.4); needs tests, not code |
| Active rail uses `inset-inline-start` with an RTL radius override; the sidebar border has an RTL override | `index.css:361-373`, `:3219-3222` | AC 10 rail already mirrors |
| Collapse chevron is a left-pointing path with no RTL flip; collapsed toggle is positioned with physical `right` | `SidebarNav.tsx:318`, `index.css:313-316`, `:333-337` | Chevron points the wrong way in Arabic; fix with logical properties and a mirrored icon. Confirm in the browser |
| In collapsed mode section headers are hidden, so the core and "More" groups run together with only a margin between them | `index.css:352-354` | A hairline divider stands in for the hidden header |
| Dead code in `SidebarNav.tsx`: the `/download` external-link branch (no item uses that path) and a commented-out `ChartIcon`; i18n keys `nav.sections.main`, `.workspace`, `.work`, `.money` become unused (the last two already are) | `SidebarNav.tsx:225-261`, `:473-489`; grep for `nav.sections` | Remove with this change |
| `e2e/navigation.spec.ts` still walks Overview → Projects → Transactions → Reports | file, lines 4-35 | Stale since MUT-16; rewrite its first case to the four-item shape |
| ADR-021 §1 fixes the nav as "Home, Income, Expenses, Insights \| Clients, Projects \| Settings" and says Clients/Projects become supporting context | `DECISIONS.md:570` | Overridden explicitly by ADR-034 (§6) |

## 3. Proposed solution

### 3.1 Sidebar structure

```
┌──────────────────────────┐
│ ▣ متابعة            ‹    │  header (unchanged)
│ [ profile switcher ]     │  (unchanged)
│ [ + New ▾ ]              │  shared action list (§3.2)
├──────────────────────────┤
│ ⌂  Home                  │  core group, no header,
│ 👥 Clients               │  a constant: never depends on flags
│ $  Income                │
│                          │
│ MORE                     │  only while ≥ 1 area is on
│ ▭  Expenses              │  order unchanged from MUT-13/14/16
│ ▭  Documents             │
│ …  (enabled ones only)   │
├──────────────────────────┤
│ SYSTEM                   │  footer, pinned, never gated
│ ⚙  Settings              │
└──────────────────────────┘
```

- `navSections` becomes `coreItems: NavItem[]` (Home, Clients, Income) plus the existing `optionalItems`. The core group renders first with no header; "More" renders below it only when at least one area is on.
- Because the core group is a constant rendered above the optional one, and flags read `false` while settings load, toggling or loading can only add or remove rows **below** the core. AC 2 and "no layout shift" hold by construction.
- Collapsed mode: `.sidebar.collapsed .nav-section + .nav-section` gets a 1px top border so the two groups stay distinguishable without their headers.

### 3.2 One `+ Add` action list for both menus

New `src/components/layout/addMenuActions.ts`:

```ts
export type AddMenuAction = 'income' | 'client' | 'expense' | 'project';

/** Core actions first, optional ones after: toggling an area never moves a core entry. */
const ADD_MENU_ACTIONS: readonly { action: AddMenuAction; feature?: FeatureKey }[] = [
  { action: 'income' },
  { action: 'client' },
  { action: 'expense', feature: 'expenses' },
  { action: 'project', feature: 'projects' },
];

export function visibleAddMenuActions(flags: FeatureFlags): AddMenuAction[];
```

- `SidebarNav` and `TopBar`'s `AddMenu` both read `useFeatureFlags()` and render `visibleAddMenuActions(flags)`, each mapping an action to its own label and icon (the sidebar says "Add Income" under **New**, the top bar says "Income" under **Add**; both stay as they are).
- Order becomes **Income, Client, Expense, Project** in both menus. That is the ticket's order and the same rule as the nav: core first, optional appended.
- What each click does is unchanged: the sidebar opens the drawer and goes to the list, the top bar opens the drawer in place.

### 3.3 Redirect when an area is switched off under an open page

New hook in `src/lib/features/routeGuard.ts`, called once from `AppShell`:

```ts
/** Re-run the active route guards when any area goes from on to off. */
export function useLeaveDisabledArea(): void {
  const router = useRouter();
  const flags = useFeatureFlags();
  const loaded = useFeaturesLoaded();
  const previous = useRef<FeatureFlags | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const before = previous.current;
    previous.current = flags;
    if (before && featuresTurnedOff(before, flags).length > 0) void router.invalidate();
  }, [flags, loaded, router]);
}
```

- `featuresTurnedOff(before, after)` is a pure helper in `features.ts`.
- `router.invalidate()` re-runs `beforeLoad` for the open route. If it is gated by an area that is now off, `requireFeature` throws its redirect to **Home** with `replace`, so Back does not return to the dead page. Home is the destination a deep link to a disabled area already gets (ADR-032 §4) and the page that answers "who owes me".
- It fires only on an on→off transition after the first load. Switching an area on, changing currency or any other settings write leaves the router alone. On a core page the re-run finds no gate and nothing visible happens.
- No toast: the user switched the area off themselves (ADR-032 §3 keeps toasts out of this flow).

### 3.4 Active state (no code change, pinned by tests)

| Route | Active entry |
|---|---|
| `/` | Home (exact match; Home is not active on any other route) |
| `/clients`, `/clients/$clientId` | Clients |
| `/income` | Income |
| `/expenses` | Expenses |
| `/documents`, `/documents/new`, `/documents/$documentId`, `/documents/$documentId/edit` | Documents |
| `/retainers`, `/insights`, `/planning` | their own entry |
| `/projects`, `/projects/$projectId` | Projects |
| `/settings`, `/settings/profiles/$profileId`, `/settings/import` | Settings |
| `/transactions`, `/reports`, `/suppliers`, `/expenses/*` legacy | redirect before render |
| `/theme-demo` | none (dev page) |

### 3.5 RTL

- The collapse chevron mirrors in RTL (the existing `.icon-flip` rule, combined with the `rotated` state), so it always points toward the edge the sidebar collapses to.
- The collapsed toggle's `right` becomes `inset-inline-end`.
- Rail, border and menu positions already use logical properties or RTL overrides. All of this is verified in the browser in Arabic, expanded and collapsed.

### 3.6 Cleanup bundled with the change

- Remove the `/download` branch and the commented-out `ChartIcon` from `SidebarNav.tsx`.
- Remove `nav.sections.main | workspace | work | money` from `en.json` and `ar.json`. No typed key lists them (`i18n/types.ts` `nav` has no `sections`). `nav.sections.optional` ("More" / "المزيد") and `nav.sections.system` stay.
- Rewrite `e2e/navigation.spec.ts`'s first case: Home → Clients → Income → Settings, and no Projects/Transactions/Reports link on a fresh profile.

## 4. Decisions for the owner

| # | Decision | Recommendation | Alternative |
|---|---|---|---|
| D1 | Core group header | **None.** One header over the only core group labels nothing; "More" and "System" stay | Keep a "Main" header over Home/Clients/Income |
| D2 | `+ Add` menus | **One shared action list and order (Income, Client, Expense, Project) for both menus; each keeps its own labels and click behaviour** | Only re-order each menu, keeping the gating duplicated |
| D3 | Redirect-on-disable | **Re-run the existing route guards (`router.invalidate()`) on an on→off transition; land on Home** | A second route-prefix → feature table in the sidebar that navigates by itself (two sources of truth) |
| D4 | TD-027 (onboarding shows a ticked "Project" step while projects is off; TECH_DEBT says "decide alongside MUT-15") | **Fix here:** `OnboardingStepIndicator` takes its step list from the overlay and omits `project` while off (2 steps, numbered 1–2). No store or persisted-state change | Leave TD-027 open |
| D5 | Menu keyboard support. The sidebar **New** menu declares `role="menu"` but ignores arrow keys; the top bar menu has no roles and does not return focus on Escape | **Fix here:** both menus focus their first item on open, ArrowUp/Down/Home/End move between items, Escape closes and returns focus to the button, Tab closes. One small shared hook | Keep today's behaviour (Tab through items, Escape closes) and only test it |

## 5. Reuse, impact, cost

- **Reuse:** `useFeatureFlags`, `useFeaturesLoaded`, `requireFeature` (unchanged), `FEATURE_KEYS`, the `optionalItems` seam, `SidebarNav.features.test` fixtures (`installFakeSettings`), `.icon-flip`.
- **New:** `addMenuActions.ts` (+ test), `featuresTurnedOff` (+ test), `useLeaveDisabledArea` (+ router test), and if D5 is approved a `useMenuKeyboard` hook (+ test). Each goes into `COMPONENT_REGISTRY`/`PATTERNS`.
- **Touched:** `SidebarNav.tsx`, `TopBar.tsx`, `AppShell.tsx` (one hook call), `routeGuard.ts`, `features.ts`, `index.css` (RTL chevron, collapsed divider, toggle position), `en.json`/`ar.json` (four keys removed), `e2e/navigation.spec.ts`; D4 adds `OnboardingStepIndicator.tsx` and `OnboardingOverlay.tsx`.
- **No** schema, repository, route or data change. Lazy loading is untouched: the sidebar imports no page module and the hook imports only the router.
- **i18n:** no new strings. **Cost/infra:** none.
- **Out of scope (ticket):** deleting any gated page; the sidebar's visual style, collapse behaviour or profile switcher; the differing click behaviour of the two menus (sidebar navigates to the list, top bar stays in place).

## 6. ADR-034 (to be written on build)

**The sidebar is four fixed core entries; optional areas append below; switching an area off re-runs the route guards.** It overrides **ADR-021 §1** (navigation "Home, Income, Expenses, Insights | Clients, Projects | Settings") and ADR-021's consequence "Clients/Projects become supporting context, not primary navigation". The reason is the 2026-10-05 intake: the product answers three questions per client, so Clients is primary and Projects is an optional tag. The replacement is Home, Clients, Income (core, constant), "More" (optional, below), Settings (footer). The rest of ADR-021 (renames, question-first framing) stays. ADR-021's status becomes "Active; §1 superseded by ADR-034".

## 7. Risks

- **R1 — `router.invalidate()` while a drawer is open on the gated page.** Drawers live in `AppShell`, not in the route, so a redirect leaves an open drawer open over Home. Saving still works because repositories never read flags (ADR-032 addendum). Accepted.
- **R2 — Page tests that mock `@tanstack/react-router` without `useRouter`.** `AppShell` is not rendered by page tests (grep: no `AppShell` test), so the new hook only runs under the real router. `SidebarNav`/`TopBar` tests do not use the hook.
- **R3 — The e2e suite is stale and not in CI (TD-004).** The navigation spec is updated and run locally once; whatever else in `e2e/` fails is reported, not fixed here.

## 8. Build order

1. `featuresTurnedOff` + `useLeaveDisabledArea` + router test (real memory-history router, real `requireFeature`, fake settings repo); wire into `AppShell`. Commit.
2. `addMenuActions.ts` + unit test; `SidebarNav` and `TopBar` consume it; menu order tests. Commit.
3. Sidebar core group, header removal, dead code, i18n keys, collapsed divider, RTL CSS; `SidebarNav` tests (four items in order, core-never-moves with all six on, active-state table, collapsed mode, Settings pinned). Commit.
4. D5 keyboard hook + tests (if approved). Commit.
5. D4 onboarding indicator + test (if approved). Commit.
6. e2e navigation spec; browser check in English and Arabic, expanded and collapsed, all areas off and all on, plus disable-under-open-page.
7. Knowledge files (ADR-034, CHANGELOG, SYSTEM_OVERVIEW, COMPONENT_REGISTRY, PATTERNS, TECH_DEBT, TEST_PLAN); `npm run lint`, `npm run typecheck`, `npx tsc -b`, full suite, `npm run build`.

## Business / product impact

- First launch shows the product's job in three entries, client work in the middle and the money ledger beside it. A user who turns on an area sees it appear under "More" while their core entries stay where their hands already are.
- Both `+ Add` menus read the same way, so "Add client" is always the second choice.
- Closes MUT-2: every optional area is gated and the default surface is the client-accounting core.

## Build notes (2026-10-11)

- **Collapsed rail, found in the browser check.** With no positioning context
  on `.sidebar`, the collapsed-mode chevron (`position: absolute; right`) and
  the expand button (`position: absolute; bottom; left: 50%`) were placed
  against the window: top-right beside the top bar's `+ Add`, and
  bottom-centre behind the download banner. Giving the sidebar a containing
  block made them collide with the brand and cover Settings, so both went
  into normal flow instead (chevron under the brand, expand button under
  Settings). Behaviour unchanged; layout only. Within AC 7.
- **RTL chevron** uses `rotate(180deg)` rather than `scaleX(-1)` so it
  animates like LTR; direction verified for all four direction × state
  combinations.
- **e2e:** the navigation spec passes; the remaining 13 e2e cases fail for
  pre-existing reasons, recorded on TD-004.
- New debt: TD-031 (`RowActionsMenu` listeners), TD-032 (the two menus' click
  behaviour differs). TD-027 resolved.
- Verification: lint 0 errors, typecheck and `tsc -b` clean, 134 files /
  2,207 tests passing (5 skipped), build succeeds.

- **Renumbered at merge (2026-10-11):** MUT-3 reached `main` first and took
  ADR-033 and TD-029/030, so this ticket's ADR is **ADR-034** and its debts
  are **TD-031** (`RowActionsMenu`) and **TD-032** (menu click behaviour).
