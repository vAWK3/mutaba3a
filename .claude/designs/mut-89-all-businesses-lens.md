# MUT-89: "All businesses" lens for Home and Clients

- **Ticket:** MUT-89 (epic MUT-74), decision S2 of `.claude/designs/landing-apple-redesign.md`
- **Status:** Approved by Basel on 2026-10-12. O1–O7 were answered as recommended (D9–D15), and the eng review D1–D8 is folded in below.
- **Reserved ids:** ADR-051, TD-068 (lane 3, see the parallel-lanes reservation)
- **Builds on:** MUT-83 / ADR-049 (`partitionOwedNow` takes entries, not a business, §7), MUT-8 / ADR-036 (Home), MUT-82 / ADR-055 (Home's two sections share one receivables query), MUT-84 / ADR-050 (the Clients list sits beside `/clients/:id`)

## 1. Problem

The pitch is "who owes me, across my businesses", but the app shows one business at a time. An "All Profiles" mode existed and was switched off in commit `70b5093` ("added vendors page", April 2026) by hard-coding `isAllProfiles = false` and `showAllProfilesOption = false` in `src/hooks/useActiveProfile.ts`. No ADR records that.

## 2. Acceptance criteria (from the ticket)

1. "All businesses" appears in the switcher only when two or more businesses exist.
2. Home and Clients aggregate correctly across businesses, per currency, with business tags.
3. Every other area receives a concrete business id; no screen silently shows all-business data it wasn't designed for.
4. The Income drawer requires a business when opened from All businesses.
5. An ADR overrides the unrecorded strict mode and records the scope limit.
6. Tests cover aggregation, tags on shared clients, fallback on other routes, and the drawer requirement.

## 3. What the code does today

- **`profileStore`** persists one `activeProfileId` (type `string | 'all'`). `useActiveProfile` maps `'all'` to the default business and never returns it.
- **Repositories** treat a falsy `profileId` as "every record": `scopeToProfile(record, undefined) === true`. That includes records with no `profileId` (the "unassigned" records the orphan banner handles, which "show in no profile's lists"), and records of archived businesses.
- **Home** (`OverviewPage`) passes `useProfileFilter()` to `useReceivables` (Owed now and Needs attention share it, ADR-055 §1), `useRecentPayments`, `useClients` and `useTransactions` (the new-user check).
- **Clients** (`ClientsPage`) reads `useClientOwedIndex(profileId, search)` → `clientSummaryRepo.listOwedIndex`. Shared clients already carry "cross-profile badges" (`getCrossProfileClientStats`, a second full scan).
- **Drawers:** `IncomeDrawer` already shows a required business field up front when it can't work the business out (`profileInFastPath`). `useProfileAwareAction` (the top bar's Add menu, and the sidebar's New → Income and Expense) already shows `ProfileQuickPicker` when `isAllProfiles`.
- **Components that exist:** `ProfileBadge` / `ProfileBadgeWithName` (`src/components/ui/ProfileBadge.tsx`); the old `AllProfilesAvatar` is in git at `70b5093^`.

So most of the plumbing exists. What's missing: a lens state that is scoped to two screens, a repository scope that means "the switcher's businesses" rather than "everything", tags, and the switcher option.

## 4. Decisions for the owner

All seven were answered as recommended by Basel on 2026-10-12 (eng review questions D9–D15).

| # | Question | Recommended (chosen) | Alternative |
|---|---|---|---|
| O1 | **Does All businesses stick?** | **Sticky.** All businesses stays chosen for Home and Clients. Every other screen works in the *working business* (the last business you picked). Coming back to Home shows All again. Picking a business anywhere turns All off. | One-shot: leaving Home/Clients switches to the working business, and Home then shows that business. |
| O2 | **What does the switcher show off Home and Clients?** | The working business, and the All option is **not listed** there. | Listed; picking it navigates to Home. |
| O3 | **What does "All" include?** | **The businesses in the switcher**: each live business by id. Unassigned records (no business) and archived businesses' records stay out, as they are out of every business's lists today. | Every record (`profileId` undefined), which brings back unassigned records the orphan banner owns. |
| O4 | **The "No client" and "Archived clients" rows on Clients, in All** | **One muted row per business** that has some ("No client · Studio · 2 entries"), each tagged. A click makes that business the working business and opens `/income` filtered, so Income shows exactly what the row counted. The rows still add up to the strip. | Two aggregate rows with tags; a click opens Income in the working business, which may show fewer entries than the row said. |
| O5 | **Tag style** | `ProfileBadgeWithName` (colour dot + name, truncated), small. A shared client shows one tag per business it has entries in; a client with no entries shows its own business. Tags show only in All. | Initial-only `ProfileBadge`: compact, but two businesses can share an initial. |
| O6 | **The client profile page (TD-065)** | **Defer.** In All, a Clients row now equals the profile page (both count every business), which closes TD-065's gap for anyone using the lens. TD-065 stays open for the single-business view. | Tag every entry and payment on the profile page now. |
| O7 | **Other create drawers in All** (Client, Project, Expense) | Unchanged in this ticket. The Add menus already ask through `ProfileQuickPicker`. The Client and Project drawers show a visible, editable business select prefilled with the working business. Making the sidebar's New → Client/Project ask is MUT-57's job. | Make Client and Project drawers start empty and required in All. |

## 5. Design

### 5.1 State: a lens, a working business, and the screen

`src/lib/profileStore.ts` (persisted, `version: 1` with `migrate`):

```ts
interface ProfileState {
  activeProfileId: string;   // the working business: always a concrete id ('' until resolved)
  allBusinesses: boolean;    // the lens is chosen (O1)
  onOwedScreen: boolean;     // the route is Home or Clients; NOT persisted (partialize)
  setActiveProfile(id: string): void;   // pick a business: also turns allBusinesses off
  setWorkingProfile(id: string): void;  // change the working business, keep the lens (O4 click)
  setAllBusinesses(on: boolean): void;
  setOnOwedScreen(on: boolean): void;
  reset(): void;
}
```

- Migration: a stored legacy `'all'` becomes `{ activeProfileId: '', allBusinesses: true }`.
- `setActiveProfile(id)` keeps its signature, so the in-flight MUT-81 design's `useProfileStore.getState().setActiveProfile(id)` still works.
- The working-business auto-correct effect in `useActiveProfile` calls `setWorkingProfile`, not `setActiveProfile`. A background repair (a deleted or archived working business, or an empty stored id) never turns All off, and the legacy `'all'` migration survives its first load (eng review D5).

**The screen flag comes from the route, in one place** (eng review D1: smaller arrangement).
- The `/` and `/clients` routes in `src/router.tsx` carry `staticData: { owedLens: true }`. This is TanStack Router's built-in route tagging; a `StaticDataRouteOption` module augmentation gives it a type.
- `/clients` is the layout route, so `/clients/:id` inherits the tag. That is right: on a wide window the list sits beside the profile (ADR-050), and the profile already counts every business (ADR-049 §3).
- `useOwedScreenSync()` (in `useActiveProfile.ts`), called in `AppShell.tsx` next to `useLeaveDisabledArea()`, reads `useMatches()` and writes `onOwedScreen` to the store in a `useLayoutEffect`, so the chrome never paints a stale lens. There is no pathname list and no basepath stripping. **Only the chrome reads this flag** (switcher, top bar, drawers); Home's and Clients' data never waits for it (eng review D3).
- Hooks and drawers read the store, never the router. So `useActiveProfile` stays router-free and every existing test that renders it without a router keeps working.

**`useActiveProfile()` keeps its shape. Two fields become real again:**
- `activeProfileId` / `activeProfile`: always the working business. **Never `'all'`.** Every page that calls `useProfileFilter()` (Income, Expenses, Projects, Insights, Planning) therefore keeps receiving a concrete id with no change to that page. This is AC3 by construction.
- `isAllProfiles` = `allBusinesses && onOwedScreen && profiles.length >= 2`.
- `showAllProfilesOption` = `onOwedScreen && profiles.length >= 2` (AC1, O2).
- `setAllBusinesses(on)` switches the lens; `setActiveProfile(id)` takes business ids only. The `'all'` sentinel leaves `ActiveProfileId`, and the dead `!== 'all'` checks at `IncomeDrawer.tsx:166` and `useProfileAwareAction.ts:75` go. `'all'` survives only inside the persist migration (eng review D6).

**New `useOwedLens()`**, in `src/hooks/useActiveProfile.ts` beside `useProfileFilter`, so the tests that mock that module can mock both. Only Home and Clients call it:
- It returns `{ scope, isAll, profilesById }`, with `isAll = allBusinesses && profiles.length >= 2`. It ignores `onOwedScreen`: only the owed screens call it, so their first frame already reads the right scope (eng review D3).
- `scope` is `string[]` of the switcher's businesses in All, else the working id.
- It returns `undefined` until profiles have loaded, and the queries are `enabled` only once `scope !== undefined`. So the lens never reads before it knows its businesses.
- With zero businesses (before Welcome creates one), the scope is `''` and the lens is off: today's behaviour (eng review D4).

### 5.2 Repository: scope is "these businesses", not "everything" (O3)

- `src/db/baseQuery.ts`: `export type ProfileScope = string | readonly string[]`. `scopeToProfile(record, scope?)` matches membership for an array. A record with no `profileId` never matches an array. A string or `undefined` behaves exactly as now.
- **Widen `profileId?: string` to `profileId?: ProfileScope` on the reads the owed screens use, and only those:**
  - `transactionRepo.list` (Owed now, Needs attention, the new-user check);
  - `clientRepo.list` (the new-user check);
  - `paymentRecordRepo.listRecent`;
  - `clientSummaryRepo.listOwedIndex`.

  Every other caller passes a string as before, and the totals and expense reads are untouched.
- **Tags come from the same read, with no second query:**
  - `listOwedIndex` adds `profileIds: string[]` to each client row: the businesses of the client's entries in scope, sorted by business name, or the client's own business when it has no entries.
  - In All, it also returns the muted rows per business (O4). It runs `partitionOwedNow` on each business's entries; the total is still `summarizeOwedByCurrency` over all of them, so the parts add up.
  - `RecentPaymentRow` gains `profileId?`, taken from its entry.
  - Needs attention rows already carry `tx.profileId`.
- **Cost:** no new table scans. In All, Clients skips `getCrossProfileClientStats` (`enabled: … && !isAll`), which is one full scan fewer.

### 5.3 Screens

- **Switcher** (`ProfileSwitcher.tsx`): "All businesses" sits at the top with the restored `AllProfilesAvatar` and a thin divider, shown when `showAllProfilesOption`. The selected state and the button label follow `isAllProfiles`.
- **Top bar** `ActiveProfileIndicator`: reads "All businesses" while the lens is on.
- **Home** (`OverviewPage`, `HomeNeedsAttention`, `HomeRecentPayments`):
  - `profileId` props become `scope` from `useOwedLens()`.
  - The new-user check waits for the scope and for both queries to stop being pending: `isDeciding = scope === undefined || clientsPending || entriesPending`. A disabled query is never "loading" in TanStack Query 5 (eng review D2, D4).
  - Owed now and Needs attention still share one `useReceivables({ profileId: scope })` (ADR-055 §1 holds: same filters, same query).
  - Each row shows its business tag in All.
  - The Owed now strip stays per currency (`OwedNowSummary`) and is never summed across currencies.
- **Clients** (`ClientsPage`):
  - `useClientOwedIndex(scope, search)`.
  - In All, tags replace the cross-profile badges, and the muted rows split per business (O4).
  - Search, sort, the ADR-035 order and the walk (ADR-050) are unchanged; per-business muted rows are skipped by the walk like the others.
- **Income drawer** (AC4): no logic change is needed.
  - In All on an owed screen, `isAllProfiles` makes `initialProfileId` `''`. The required business field then shows up front (`profileInFastPath`), and save is blocked until a business is picked.
  - A `defaultProfileId` (from the Add menu's picker) still prefills it.
  - Tests pin this down.
- **Every other page** (Income, Expenses, Projects, Insights, Planning): its queries wait for a resolved business id and never read with a blank one (eng review D8). This is built as **one gate in `AppShell`**: the routed page mounts only once businesses have loaded (owner's choice during the build), with one `AppShell` gate test.
- **i18n:** change `profileSwitcher.allProfiles` to "All businesses" / "كل الأعمال", and add keys for the per-business muted rows and the indicator. Tags use `<bdi>` for mixed-direction names.

### 5.4 Files

**New:** none (eng review D1). New tests only.

**Touched:**
- Routing: `src/router.tsx` (`staticData` on `/` and `/clients`, plus the `StaticDataRouteOption` augmentation)
- State: `src/lib/profileStore.ts`, `src/hooks/useActiveProfile.ts` (with `useOwedLens`)
- Repository: `src/db/baseQuery.ts`, `src/db/repository.ts` (four reads), `src/db/interfaces.ts`, `src/types/index.ts` (`ClientSummary.profileIds?`, `RecentPaymentRow.profileId?`, the per-business buckets in `ClientOwedIndex`)
- Query hooks: `src/hooks/useQueries.ts`, `src/hooks/useIncomeQueries.ts` (filter types and `enabled`)
- Shell: `src/components/layout/AppShell.tsx`, `ProfileSwitcher.tsx` (+ css), `TopBar.tsx`
- Dead-sentinel cleanup (D6): `src/components/drawers/IncomeDrawer.tsx`, `src/hooks/useProfileAwareAction.ts`, plus the same dead `=== 'all'` check at `src/pages/planning/PlanningPage.tsx:39`
- Loading gate (D8): one `BusinessesGate` in `src/components/layout/AppShell.tsx`, which covers every page; `PlanningPage.tsx` only loses its dead `'all'` check (D6)
- Route sync (D1): `useOwedScreenSync` lives beside `useOwedLens` in `src/hooks/useActiveProfile.ts` (the `useLeaveDisabledArea` precedent: a hook next to its concern, called from AppShell); still no new source file
- Home: `src/pages/overview/OverviewPage.tsx`, `src/components/home/HomeNeedsAttention.tsx`, `HomeAttentionRow.tsx`, `HomeRecentPayments.tsx`
- Clients: `src/pages/clients/ClientsPage.tsx`, `src/components/clients/clientIndexRows.ts`
- Strings: `src/lib/i18n/translations/{en,ar}.json`

**Knowledge:**
- ADR-051;
- TD-068 only if something is left at the end (the loading-time `''` gap is now in scope, D8);
- CHANGELOG, SYSTEM_OVERVIEW, COMPONENT_REGISTRY, PATTERNS ("a lens scoped to routes": a store flag synced once in AppShell), TEST_PLAN.

## 6. Tests (written first; Node 22: `npx vitest run <files>`)

**Unit:**
- The route tag, tested through AppShell's sync on a memory router: `/`, `/clients` and `/clients/x` set `onOwedScreen`; `/income`, `/settings` and `/expenses` clear it.
- `profileStore`: `setActiveProfile` turns the lens off; `setWorkingProfile` keeps it; the legacy `'all'` migration; `onOwedScreen` is not persisted.
- `scopeToProfile`: string, array, an unassigned record against an array, `undefined`.
- `useActiveProfile`:
  - `isAllProfiles` only with lens + owed screen + 2 or more businesses;
  - `activeProfileId` is never `'all'`;
  - one business ignores the lens;
  - `showAllProfilesOption` only on an owed screen with 2 or more businesses.
- `useOwedLens`: the ids of every live business in All, the working id otherwise, `undefined` while loading.

**Repository** (fake-indexeddb):
- `listOwedIndex` over two businesses:
  - per-currency totals equal `summarizeOwedByCurrency` over both;
  - a shared client's row counts both businesses and carries both tags;
  - a no-entry client carries its own business;
  - unassigned and archived-business records are excluded;
  - the per-business muted rows plus the client rows add up to the strip;
  - a single business is unchanged (regression).
- `listRecent` with a scope carries `profileId`.

**Component:**
- `ProfileSwitcher`:
  - the option shows with 2 businesses on `/` and is absent with 1 or on `/income`;
  - picking it turns the lens on;
  - picking a business turns it off.
- `OverviewPage` / `HomeNeedsAttention` / `HomeRecentPayments` in All:
  - aggregated per currency with tags;
  - no tags in one business;
  - Needs attention and Owed now still read one query (the ADR-055 test keeps passing).
- `ClientsPage` in All:
  - tags, two on a shared client;
  - no cross-profile badges;
  - a per-business muted row sets the working business and navigates.
- `IncomeDrawer` with lens + owed screen:
  - the business field is up front, empty and required, and save is blocked;
  - with `defaultProfileId` it is prefilled;
  - lens on but off an owed screen, it is prefilled with the working business.
- `TopBar` indicator reads "All businesses".

**Integration** (memory router + real stores):
- Lens on at `/`, navigate to `/income`: the page's query gets the working id, and the switcher shows the working business with no All option.
- Navigate back to `/`: the lens is back (O1).

**Gate:** `vitest run`, `typecheck` (+ `tsc -b`), `lint` (0 errors), `test:bundles`. Then a browser check on the preview: two businesses with sample data, both screens, the switcher, Income fallback, the drawer, Arabic RTL.

## 7. Risks and edge cases

- **The ADR-055 same-frame guarantee** depends on Home's two sections passing identical filters. Both take `scope` from one `useOwedLens()` call in `OverviewPage`, passed down as a prop. The `scope` array is memoised, so the query keys stay identical.
- **The working business is deleted or archived while the lens is on:** the existing auto-correct effect moves to the default business, and the lens is unaffected.
- **The lens is on and a business is archived, leaving one:** `isAllProfiles` is false (fewer than 2), so the switcher shows the working business. The lens returns if a second business comes back.
- **Pre-existing, fixed here too (eng review D8):** while profiles load, `useProfileFilter()` returns `''`, which every repository read treats as "every record", so single-business pages could briefly read all businesses. MUT-89 gates Income, Expenses, Projects, Insights and Planning on a resolved business id, the same way the lens gates Home and Clients.
- **MUT-81** landed first. Its "Show" switched business with `setActiveProfile`, which turns All off; the premise that no message fires in All was false (only Home's two sections claim rows). Reconciled at landing: Show uses `setWorkingProfile` (ADR-051 §9).
- **MUT-57** (both Add menus ask for the business in All mode) becomes testable once this lands. Its sidebar Client/Project path stays as is here (O7).

## 8. Out of scope

- The hosted portal's switcher (HP1 doesn't carry S2).
- Expenses, documents, retainers, insights, planning, projects (they stay per business).
- Converted totals across currencies.
- Per-business breakdown of the Owed now strip.
- Business tags on the client profile page (O6).

---

# Eng review (plan-eng-review, 2026-10-12)

Target: `.claude/designs/mut-89-all-businesses-lens.md` (this file), branch `feature/mut-89-all-businesses` from main `eeacd57`.

## Scope record

- Feature answers: no feature cuts proposed (the owner decisions O1–O7 are asked separately, after the review).
- Structure: B, "Smaller arrangement" (D1, answered 2026-10-12).
- Accepted scope: the plan's features unchanged, with no new source files:
  - route `staticData` tags `/` and `/clients` (`src/router.tsx`);
  - AppShell syncs `onOwedScreen` from `useMatches`;
  - `useOwedLens` lives in `src/hooks/useActiveProfile.ts`.
- Pending remedies: F1, F2, F3.
- Scope Challenge result: scope accepted as-is (a smaller arrangement that keeps the scope is not a reduction).

## Scope Challenge findings

1. **F1** [P1] (confidence: 9/10) `src/pages/overview/OverviewPage.tsx:38` — `const isDeciding = clientsLoading || entriesLoading;`. TanStack Query 5.90 computes `const isLoading = isPending && isFetching;` (`node_modules/@tanstack/query-core/build/modern/queryObserver.js:310`), so a query disabled until the lens scope resolves reports `isLoading: false`. Home would then decide "new user" while profiles load: the Add income empty state, or onboarding for anyone who never skipped it, flashes on every load. That regresses `c806c00` ("decide new-user only once the data has answered").
2. **F2** [P2] (confidence: 8/10) Plan §5.1: the route flag is written by an AppShell effect after the first render. If Home's data read that flag, the landing page would first query the working business, then query All once the effect ran: two reads and a flash of the wrong totals.
3. **F3** [P2] (confidence: 8/10) `src/components/modals/WelcomeModal.tsx:42` creates the first business, so an install can have zero businesses (before Welcome, or after deleting them all). Plan §5.1 says `useOwedLens` returns `undefined` until profiles load. With zero businesses it would stay `undefined`, and Home and Clients would wait forever.

## Decision ledger

### F1: When Home decides "new user" while the lens loads
Finding: F1, P1, confidence 9/10, `src/pages/overview/OverviewPage.tsx:38`, reviewer plan-eng-review (Claude)
Plan baseline: §5.1 "the queries are `enabled` only once `scope` is set"; Home's new-user rule unchanged (original proposal, not approved)
Runtime evidence: `queryObserver.js:310` `isLoading = isPending && isFetching`; a disabled query is pending but not fetching, so `isLoading` is false. Unverified in the browser (no code yet).
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| F1 new-user decision | `clientsLoading \|\| entriesLoading` (isLoading) | `!scope \|\| clientsPending \|\| entriesPending` (isPending), plus a test with profiles still loading | unchanged; no `enabled` gating, so the lens reads with a falsy scope while loading |
| F1 lens read while profiles load | reads every record (`''`) | no read until scope resolves | reads every record (`''`), including unassigned ones |
| D1 structure | approved B (smaller) | unchanged | unchanged |
| F2 route-flag lag | pending | pending | pending |
| F3 zero businesses | pending | pending | pending |

Question D2:
D2 — How should Home decide "new user" while All businesses loads?
Project/branch/task: MUT-89 on feature/mut-89-all-businesses, the "All businesses" view for Home and Clients.
ELI10: Home shows a welcome empty state when you have no clients and no entries. It waits for its data before deciding, by checking "is it still loading?". The plan pauses Home's reads until it knows which businesses to show. A paused read in this query library says "not loading", so Home would wrongly think you are new and flash the welcome screen on every app start.
Stakes if we pick wrong: Every returning user sees the empty "Add income" screen (or onboarding) flash before their numbers on each launch; an old bug fix (c806c00) comes back.
Recommendation: A because it keeps the paused read (no all-business leak) and fixes the decision at its source, with a test that pins it.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Wait on scope and pending (recommended)
  ✅ No welcome-screen flash: Home treats "businesses not loaded yet" as still deciding, with a test proving it
  ✅ Keeps the lens from ever reading with an empty scope, which today means every record including unassigned ones
  ❌ Touches the new-user rule that c806c00 tuned, so that file's existing tests need a careful re-run
B) Don't pause the reads
  ✅ Smallest change: Home's new-user rule stays byte-for-byte as it is today
  ✅ Behaves exactly like the current single-business Home during startup
  ❌ While businesses load, Home reads every record, unassigned ones included, which AC3 says must not happen
Net: one extra condition buys a startup with no flash and no all-records read.
Header: New-user check
Options:
A) Wait on scope and pending (recommended)
Home decides only once the lens scope exists and both queries have data: `isDeciding = !scope || clientsPending || entriesPending` (TanStack isPending). Add an OverviewPage test with profiles still loading that asserts neither the empty state nor onboarding renders. Effort: human ~30min / CC ~5min. Risk: low. Maintenance: none beyond the test.
B) Don't pause the reads
Leave OverviewPage.tsx:38 as is and drop the plan's `enabled` gating, so the lens queries with an empty scope (every record) until businesses load. Effort: none. Risk: brief all-records read, unassigned records included, and a double fetch. Maintenance: none.

State: approved
Actual answer: A) "Wait on scope and pending (recommended)" (D2, 2026-10-12)
Accepted scope:
- `OverviewPage` decides with `isDeciding = !scope || clientsPending || entriesPending` (TanStack `isPending`).
- The lens queries stay disabled until the scope resolves.
- A new `OverviewPage` test runs with businesses still loading and asserts that neither the empty state nor onboarding renders.
History: D4 (2026-10-12) refined "no scope" to `scope === undefined`, because `''` is a resolved scope when there are no businesses. The rule is otherwise unchanged.

### F2: What Home's data reads before the route flag is set
Finding: F2, P2, confidence 8/10, plan §5.1 (route flag written by AppShell after the first render), reviewer plan-eng-review (Claude)
Plan baseline: §5.1 `isAllProfiles = allBusinesses && onOwedScreen && profiles.length >= 2`; `useOwedLens` derives `isAll` from the same inputs (original proposal, not approved)
Runtime evidence: React runs effects child-first and after commit, so Home (a child of AppShell) renders, and starts its query, with `onOwedScreen` still false on first load. Proposed code: no runtime probe.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| F2 what `useOwedLens` reads | proposal: lens + route flag + count | lens + count only (it is only called on owed screens) | lens + route flag + count (as proposed) |
| F2 flag write timing (chrome only) | proposal: effect | layout effect, so the switcher and top bar never paint a stale state | effect |
| F1 new-user decision | approved A (D2) | unchanged | unchanged |
| D1 structure | approved B (D1) | unchanged | unchanged |
| F3 zero businesses | pending | pending | pending |

Question D3:
D3 — Should Home's data wait for the route flag?
Project/branch/task: MUT-89 on feature/mut-89-all-businesses, the "All businesses" view for Home and Clients.
ELI10: The app learns "you're on Home or Clients" from a flag that the app frame sets just after the page first draws. If Home's numbers depended on that flag, Home, the first screen you see, would draw one business's numbers and then redraw all businesses a moment later, reading the database twice. Home and Clients already know they are the owed screens, so their data doesn't need the flag. Only the switcher, top bar and drawers need it.
Stakes if we pick wrong: Every launch with All businesses on shows the wrong totals for a split second, then jumps; twice the reads on the landing page.
Recommendation: A because the owed screens are the only callers of useOwedLens, so the flag adds nothing to them but a lag.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Data ignores the flag (recommended)
  ✅ Home and Clients render the right businesses on their very first frame, with one read, not two
  ✅ The switcher and top bar update before paint (layout effect), so the chrome never shows a stale label
  ❌ Two derivations of "is All on" (data vs chrome) that must agree, pinned by one test each
B) One flag for everything
  ✅ One rule for "is All on" everywhere, simplest to explain in the ADR
  ✅ No second derivation to keep in step with the first
  ❌ The landing page double-reads and flashes the working business's totals on each launch
Net: a second, simpler derivation buys a correct first frame on the screen people open most.
Header: Route flag
Options:
A) Data ignores the flag (recommended)
`useOwedLens` derives `isAll = allBusinesses && profiles.length >= 2` and never reads `onOwedScreen` (only Home and Clients call it). `onOwedScreen` feeds only `isAllProfiles` / `showAllProfilesOption` (switcher, top bar, drawers) and is written in a `useLayoutEffect` in AppShell. Test: with the lens persisted, Home's first render queries the All scope (one receivables query key). Effort: human ~20min / CC ~3min. Risk: low.
B) One flag for everything
Keep the proposal: `useOwedLens` also requires `onOwedScreen`, written in an effect. Effort: none. Risk: first-load double read and a visible jump on Home and Clients. Maintenance: none.

State: approved
Actual answer: A) "Data ignores the flag (recommended)" (D3, 2026-10-12)
Accepted scope:
- `useOwedLens` derives `isAll = allBusinesses && profiles.length >= 2` and never reads `onOwedScreen`.
- `onOwedScreen` feeds only `isAllProfiles` and `showAllProfilesOption` (switcher, top bar, drawers). AppShell writes it in a `useLayoutEffect`.
- Test: with the lens persisted, Home's first render queries the All scope, with one receivables query key.
History: none

### F3: The lens scope when there are no businesses
Finding: F3, P2, confidence 8/10, `src/components/modals/WelcomeModal.tsx:42` (first business created by Welcome) against plan §5.1 ("returns `undefined` until profiles have loaded"), reviewer plan-eng-review (Claude)
Plan baseline: §5.1 `useOwedLens` scope is `undefined` until profiles load, the switcher's ids in All, else the working id (original proposal, not approved)
Runtime evidence: `useActiveProfile.ts` resolves the working id to `''` when no profile exists (`defaultProfile?.id ?? profiles[0]?.id ?? ''`); today Home then reads every record. Under the proposal plus D2, a zero-business install never gets a scope: Home spins forever.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| F3 scope with zero businesses, once loaded | `''` (every record) | `''` (every record, today's behaviour), lens off; "unresolved" tested as `scope === undefined` | `[]` (no records): Home shows the new-user state |
| F1 new-user decision | approved A (D2) | unchanged | unchanged |
| F2 data ignores the route flag | approved A (D3) | unchanged | unchanged |
| D1 structure | approved B (D1) | unchanged | unchanged |

Question D4:
D4 — What should Home and Clients read when no business exists yet?
Project/branch/task: MUT-89 on feature/mut-89-all-businesses, the "All businesses" view for Home and Clients.
ELI10: A brand-new install has no business until the Welcome step creates one, and someone could in theory end up with none. The new code waits to know "which businesses?" before reading. With zero businesses that answer never comes, so Home would show a spinner forever. We need a rule for "loaded, and there are none".
Stakes if we pick wrong: A fresh install, or a user with no business, is stuck on an endless spinner on Home and Clients.
Recommendation: A because it keeps exactly today's behaviour for that state and adds one test, with no new product rule to explain.
Completeness: A=10/10, B=8/10
Pros / cons:
A) Fall back to today (recommended)
  ✅ Zero businesses behaves exactly as it does now, so nothing a pre-Welcome user sees changes
  ✅ One condition in useOwedLens plus a test that Home renders, not spins, with no businesses
  ❌ Keeps the old "empty scope reads every record" rule alive for this one edge state
B) Read nothing
  ✅ Fully drops the "empty scope means everything" rule from the lens code path
  ✅ A no-business install always shows the clean new-user state
  ❌ Someone with records but no business (all businesses deleted) would see an empty Home that hides money owed
Net: keep today's edge behaviour rather than invent a new one that can hide debts.
Header: No businesses
Options:
A) Fall back to today (recommended)
Once businesses have loaded and there are none, `useOwedLens` returns scope `''` (every record, as today) with the lens off. "Not resolved yet" is `scope === undefined`, never falsiness, in both `enabled` and D2's `isDeciding`. Test: Home with zero businesses settles to its normal or new-user state, never an endless spinner. Effort: human ~20min / CC ~3min. Risk: low.
B) Read nothing
Once businesses have loaded and there are none, `useOwedLens` returns scope `[]`, which matches no record; Home shows the new-user state. Test: same as A with an empty result. Effort: human ~20min / CC ~3min. Risk: hides unassigned records' debts on Home in that state.

State: approved
Actual answer: A) "Fall back to today (recommended)" (D4, 2026-10-12)
Accepted scope:
- Once businesses have loaded and there are none, `useOwedLens` returns scope `''` with the lens off.
- "Not resolved yet" is `scope === undefined`, never falsiness, in both `enabled` and `isDeciding`.
- Test: Home with zero businesses settles to its normal or new-user state, never an endless spinner.
History: none

## Section 1: Architecture findings

1. **A1** [P2] (confidence: 9/10) `src/hooks/useActiveProfile.ts:66-71`. The auto-correct effect, `if (!isLoading && storedId !== effectiveProfileId && effectiveProfileId) { setActiveProfile(effectiveProfileId); }`, calls `setActiveProfile`, which in plan §5.1 "also turns allBusinesses off". Plan §7 says this effect leaves "the lens unaffected", which is a contradiction.
   - Deleting or archiving the working business while All is on would switch All off.
   - The legacy `'all'` migration (`activeProfileId: ''`, `allBusinesses: true`) is undone on its first load: `''` triggers the effect.

### A1: What the working-business auto-correct does to the lens
Finding: A1, P2, confidence 9/10, `src/hooks/useActiveProfile.ts:66-71`, reviewer plan-eng-review (Claude)
Plan baseline: §5.1 store `setActiveProfile(id)` turns the lens off; §7 claims the auto-correct leaves the lens unaffected; the migration maps legacy `'all'` to `allBusinesses: true` (original proposal, not approved)
Runtime evidence: the effect quoted above calls `setActiveProfile` whenever the stored id is empty or invalid once profiles load (read in code; no runtime probe of the proposed store).
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| A1 auto-correct action | `setActiveProfile` (no lens exists today) | `setWorkingProfile`: the lens is kept | `setActiveProfile`: the lens turns off |
| A1 legacy `'all'` migration | maps to `allBusinesses: true` | kept: `allBusinesses: true` survives the first load | simplified to `allBusinesses: false` (it could not survive anyway) |
| A1 plan §7 wording | contradicts §5.1 | true as written | rewritten: "replacing the working business turns All off" |
| D1–D4 | approved | unchanged | unchanged |

Question D5:
D5 — When the app has to replace your working business, should All businesses stay on?
Project/branch/task: MUT-89 on feature/mut-89-all-businesses, the "All businesses" view for Home and Clients.
ELI10: The app quietly fixes your selected business if it disappears (deleted, archived, or never set). In the plan, "select a business" also switches All businesses off. So if you are looking at All and you archive the business you last worked in, All switches itself off for no reason you can see. The fix is for that background repair to change only the working business and leave All alone.
Stakes if we pick wrong: Archiving or deleting a business while viewing All silently drops you back to one business; users upgrading from the old "All Profiles" setting lose it on first launch.
Recommendation: A because a background repair should never change a view the user chose, and it makes the plan's own §7 claim true.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Keep All on (recommended)
  ✅ Archiving or deleting a business never switches off a view the user picked, so nothing changes under them
  ✅ Makes plan §7 true and lets the legacy "all" setting survive, both pinned by tests
  ❌ The store has two setters (pick vs repair) whose difference must be kept clear in code and the ADR
B) Let it turn All off
  ✅ One setter for every business change, the simplest store API
  ✅ The legacy migration shrinks to a no-op, which removes a branch
  ❌ All businesses switches itself off whenever the working business is replaced, with no explanation on screen
Net: one extra setter keeps a background repair from overriding the user's choice.
Header: Auto-correct
Options:
A) Keep All on (recommended)
The auto-correct effect calls `setWorkingProfile(id)`, which keeps `allBusinesses`. Tests: lens on + the working business archived leaves All on with the default as working business; legacy `'all'` loads with All on. Plan §7 stands as written. Effort: human ~20min / CC ~3min. Risk: low.
B) Let it turn All off
Keep `setActiveProfile` in the auto-correct. Migration maps legacy `'all'` to `allBusinesses: false`. Rewrite §7: replacing the working business turns All off. Test: that behaviour. Effort: human ~15min / CC ~3min. Risk: surprising for users.

State: approved
Actual answer: A) "Keep All on (recommended)" (D5, 2026-10-12)
Accepted scope:
- The auto-correct effect in `useActiveProfile` calls `setWorkingProfile(id)`, which keeps `allBusinesses`.
- Test: with the lens on, archiving the working business leaves All on, with the default business as the working one.
- Test: a legacy `'all'` loads with All on.
- Plan §7 stands as written.
History: none

## Section 2: Code quality findings

1. **Q1** [P3] (confidence: 7/10) Plan §5.1: "`setActiveProfile('all')` turns the lens on (`ActiveProfileId` stays a type alias for the switcher)". The store's `setActiveProfile(id)` turns the lens off.
   - **The problem:** one name means "pick a business" in the store but "pick a business, or turn All on" in the wrapper.
   - **Dead sentinel:** after this ticket `activeProfileId` is never `'all'`. Yet `IncomeDrawer.tsx:166` (`if (!isAllProfiles && activeProfileId && activeProfileId !== 'all') return activeProfileId;`), `useProfileAwareAction.ts:75` and the type at `src/lib/profileStore.ts:13` (`export type ActiveProfileId = string | 'all';`) would keep testing for it.

### Q1: How All businesses is switched on in code
Finding: Q1, P3, confidence 7/10, plan §5.1 with `src/lib/profileStore.ts:13`, `src/components/drawers/IncomeDrawer.tsx:166`, `src/hooks/useProfileAwareAction.ts:75`, reviewer plan-eng-review (Claude)
Plan baseline: §5.1 the wrapper's `setActiveProfile('all')` turns the lens on; the `'all'` sentinel and its checks stay (original proposal, not approved)
Runtime evidence: the three quoted lines exist today. After D5, `activeProfileId` never holds `'all'`, so the two checks are dead.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| Q1 how the switcher turns All on | proposal: `setActiveProfile('all')` | `setAllBusinesses(true)` on the wrapper; `setActiveProfile` takes business ids only | `setActiveProfile('all')`, as proposed |
| Q1 `'all'` sentinel | type member plus 2 checks | removed from `ActiveProfileId` and both checks; it survives only inside the persist migration | kept |
| Q1 extra files touched | none | `IncomeDrawer.tsx`, `useProfileAwareAction.ts` (one condition each) | none |
| D1–D5 | approved | unchanged | unchanged |

Question D6:
D6 — Should "turn on All businesses" get its own explicit call?
Project/branch/task: MUT-89 on feature/mut-89-all-businesses, the "All businesses" view for Home and Clients.
ELI10: The plan reuses "select business" with a magic value "all" to mean "turn on All businesses", while the store's own "select business" turns All off. Same name, opposite effects. There are also two old checks for "all" that can never be true any more. Giving All its own clearly named switch, and deleting the dead checks, makes the code say what it does.
Stakes if we pick wrong: A later change calls the wrong "select business" and silently flips All on or off; dead checks mislead the next reader.
Recommendation: A because explicit names beat a magic value, and it deletes dead code for one line in each of two files.
Completeness: A=9/10, B=7/10
Pros / cons:
A) Explicit setAllBusinesses (recommended)
  ✅ "Select business" always means one thing, and All has its own switch the ADR can name
  ✅ Deletes the dead "all" checks in IncomeDrawer and useProfileAwareAction, so no reader is misled
  ❌ Touches two more files than planned (one condition each), with their existing tests re-run
B) Keep the "all" value
  ✅ Fewer files touched; the switcher's call site looks like the old code before strict mode
  ✅ Matches how All Profiles worked before April, so git history reads naturally
  ❌ One name with two opposite meanings, plus checks for a value that can never occur
Net: two one-line deletions buy a store API that can't be called the wrong way.
Header: All switch
Options:
A) Explicit setAllBusinesses (recommended)
`useActiveProfile` exposes `setAllBusinesses(on)`; its `setActiveProfile(id)` takes business ids only. Drop `'all'` from `ActiveProfileId`, and the dead `!== 'all'` checks at `IncomeDrawer.tsx:166` and `useProfileAwareAction.ts:75`; `'all'` stays only inside the persist migration. Effort: human ~20min / CC ~3min. Risk: low.
B) Keep the "all" value
As proposed: the wrapper's `setActiveProfile('all')` turns All on; the sentinel type and both checks stay. Effort: none. Risk: naming confusion; dead checks remain.

State: approved
Actual answer: A) "Explicit setAllBusinesses (recommended)" (D6, 2026-10-12)
Accepted scope:
- `useActiveProfile` exposes `setAllBusinesses(on)`. Its `setActiveProfile(id)` takes business ids only.
- `'all'` is dropped from `ActiveProfileId`, along with the dead `!== 'all'` checks at `IncomeDrawer.tsx:166` and `useProfileAwareAction.ts:75`.
- `'all'` survives only inside the persist migration.
History: none

## Section 3: Test review

Framework: Vitest + Testing Library + fake-indexeddb (`npx vitest run`, Node 22, TD-054). The release QA kit `qa/` replaced Playwright e2e (MUT-97).

```
CODE PATHS                                                   USER FLOWS
[+] profileStore (persist v1)                                 [+] Turn on All businesses (2+ businesses)
  ├── setActiveProfile → lens off          [GAP] new            ├── [GAP] switcher lists All only on / and /clients
  ├── setWorkingProfile → lens kept (D5)   [GAP] new            ├── [GAP] Home: owed per currency across businesses, tagged
  ├── setAllBusinesses (D6)                [GAP] new            └── [GAP] Clients: shared client shows two tags
  ├── migrate legacy 'all' → lens on       [GAP] new          [+] Leave the owed screens (AC3)
  └── onOwedScreen not persisted           [GAP] new            ├── [GAP] [→integration] /income gets the working id, no All option
[+] useActiveProfile                                            └── [GAP] [→integration] back on /, All is back (O1)
  ├── activeProfileId never 'all'          [★★ useActiveProfile.test:124, rewrite]
  ├── isAllProfiles = lens ∧ owed ∧ ≥2     [GAP] new          [+] Add income from All (AC4)
  ├── showAllProfilesOption = owed ∧ ≥2    [★ :114 asserts the opposite, rewrite]
  ├── auto-correct keeps lens (D5)         [GAP] new            ├── [★★ IncomeDrawer.test:492] asks up front when unknown
  └── 1 business ignores lens              [★★ :265 keep]       ├── [GAP] lens on + owed screen → asks, save blocked
[+] useOwedLens                                                 ├── [GAP] defaultProfileId (Add menu picker) → prefilled
  ├── undefined until loaded (D2)          [GAP] new            └── [GAP] lens on, off owed screen → working business prefilled
  ├── zero businesses → '' (D4)            [GAP] new
  └── ignores route flag (D3)              [GAP] new          [+] Edge states
[+] AppShell route sync (staticData)                            ├── [★★ OverviewPage.test:294] no flash while loading (update for D2)
  ├── / and /clients/x set the flag        [GAP] [→integration] ├── [GAP] zero businesses: Home settles (D4)
  └── /income /settings clear it           [GAP] [→integration] └── [GAP] working business archived while All on (D5)
[+] scopeToProfile(record, string[])        [★★ baseQuery.test:16, add array rows]
  └── unassigned record never matches an array  [GAP]
[+] clientSummaryRepo.listOwedIndex(scope[])
  ├── per-currency total = Home over the same entries  [★★★ clientOwedIndex.test:104 single business; GAP for an array]
  ├── shared client: both businesses, two profileIds   [GAP]
  ├── no-entry client: its own business               [GAP]
  ├── unassigned + archived-business records out (O3) [GAP]
  └── per-business muted rows add up (O4)             [GAP]
[+] paymentRecordRepo.listRecent(scope[]) → profileId [★★ paymentRecords.test, add array + profileId]
[+] OverviewPage / HomeNeedsAttention / HomeRecentPayments in All
  ├── one receivables query in All (ADR-055)  [★★★ OverviewPage.test:197 + commit-order test; GAP in All]
  └── tags shown only in All                 [GAP]
[+] ClientsPage in All: tags, no cross-profile badges, muted-row click sets working business  [GAP]
[+] TopBar indicator "All businesses"                          [GAP]

COVERAGE: 7/33 paths tested today (21%) | after the plan: 33/33
QUALITY today: ★★★:2 ★★:5 ★:1 | GAPS: 26 (3 integration, 0 eval)
```

No LLM or prompt changes, so no eval scope.

**Regression risks (critical):**
- `OverviewPage.test.tsx:61` and `HomeNeedsAttention.test.tsx:67` mock only `useProfileFilter`. Once Home reads `useOwedLens`, those mocks stop applying silently. *Prior learning applied: vimock-barrel-interception (confidence 10/10, from 2026-10-10).*
- Three tests assert strict mode and must change on purpose: `useActiveProfile.test.tsx:114`, `:124` and `:173`.

**Tests made obsolete:** `useActiveProfile.test.tsx:173` "should ignore setting to all mode" (D6 removes the `'all'` argument). `:114` is rewritten to assert the option on owed screens only.

### R1: Regression contract for the single-business screens
Finding: Test review regression risk, CRITICAL, confidence 9/10, `src/pages/overview/__tests__/OverviewPage.test.tsx:61`, `src/components/home/__tests__/HomeNeedsAttention.test.tsx:67`, `src/hooks/__tests__/useActiveProfile.test.tsx:114,124,173`, reviewer plan-eng-review (Claude)
Plan baseline: §6 lists new tests; no regression contract stated (original proposal, not approved)
Runtime evidence: the two Home suites mock `useProfileFilter` through `importOriginal` spread, so an internal `useOwedLens` call would use the real hook. The three `useActiveProfile` tests assert the April strict mode.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1 single-business Home + Clients | covered by existing suites | every existing case kept green; the Home mocks move to `useOwedLens` with the same business | same as A |
| R1 ADR-055 one-query rule | tested in single business | also asserted with the lens on (array scope) | single business only |
| R1 AC3 concrete id off owed screens | untested | integration test: lens on, `/income` receives the working id | integration test: same as A |
| R1 intentional test changes | — | `:114` rewritten (option on owed screens only), `:124` rewritten (legacy `'all'` → lens on, working = default), `:173` deleted (D6) | same as A |
| D1–D6 | approved | unchanged | unchanged |

Question D7:
D7 — What must stay proven while the single-business screens change underneath?
Project/branch/task: MUT-89 on feature/mut-89-all-businesses, the "All businesses" view for Home and Clients.
ELI10: Home and Clients are rewired to the new lens hook. Two of Home's test files fake the old hook, so after the change they would quietly test something else. Three old tests assert "All is always off", which this ticket overturns on purpose. We need to agree what stays proven: one-business Home and Clients behave exactly as now, Home's "one query feeds both sections" rule still holds, and other pages never see All.
Stakes if we pick wrong: A regression in the one-business view (most users) ships green because the tests were silently testing the wrong hook.
Recommendation: A because it also proves Home's same-frame payment rule in the new All mode, the riskiest place for it to break, for one extra test.
Completeness: A=10/10, B=8/10
Pros / cons:
A) Full contract (recommended)
  ✅ Every existing single-business case stays green, with the Home mocks moved to the hook Home really calls
  ✅ Home's one-query, same-frame rule (ADR-055) is also asserted with All on, where the scope is a list
  ❌ One more test to keep, plus rewriting three strict-mode tests whose names readers know
B) Contract without the All-mode ADR-055 check
  ✅ Same protection for single-business screens and for other pages never seeing All
  ✅ One fewer test; the ADR-055 rule stays proven where it was first written
  ❌ If a list scope ever splits Home into two queries, payments in All mode lag a frame and nothing catches it
Net: one extra assertion covers the newest path through Home's most delicate rule.
Header: Regression
Options:
A) Full contract (recommended)
Keep every existing OverviewPage, HomeNeedsAttention, ClientsPage, clientOwedIndex and IncomeDrawer case green, with the Home mocks moved from `useProfileFilter` to `useOwedLens` (same business). Add: the ADR-055 one-query assertion with All on; an integration test that `/income` receives the working id while All is on. Intentional changes: rewrite `useActiveProfile.test:114` and `:124`, delete `:173`. Effort: human ~2h / CC ~10min. Risk: low.
B) Contract without the All-mode ADR-055 check
Same as A, minus the ADR-055 one-query assertion with All on (it stays proven in single business only). Effort: human ~1.5h / CC ~8min. Risk: an All-mode frame lag after a payment would go uncaught.

State: approved
Actual answer: A) "Full contract (recommended)" (D7, 2026-10-12)
Accepted scope:
- **Kept green:** every existing case in OverviewPage, HomeNeedsAttention, ClientsPage, clientOwedIndex and IncomeDrawer. The Home mocks move from `useProfileFilter` to `useOwedLens`, with the same business.
- **Added:** the ADR-055 one-query assertion with All on.
- **Added:** an integration test that `/income` receives the working id while All is on.
- **Intentional changes:** `useActiveProfile.test:114` and `:124` are rewritten, and `:173` is deleted.
History: none

Dispositions (Section 3): R1 accepted (D7). Test Plan artifact: `~/.gstack/projects/vAWK3-mutaba3a/basel-feature-mut-89-all-businesses-eng-review-test-plan-20261012-125645.md`.

## Section 4: Performance review

No issues found.
- `listOwedIndex` over an array scope makes the same single pass over `transactions`, `clients`, `projects` and `paymentRecords` as today (`src/db/repository.ts:706-712`).
- The per-business muted rows add one O(n) grouping, with no query in a loop.
- `listRecent` keeps one filter scan plus one `anyOf` (`repository.ts:1617-1627`).
- All mode skips `getCrossProfileClientStats`, so each Clients visit makes one full transactions scan fewer.
- Array query keys are hashed by structure (TanStack Query), so there is no refetch from array identity.
- Scale: a local IndexedDB with hundreds to low thousands of rows; no benchmark was claimed.

## Outside voice

Codex is not installed (`CODEX_MODE: not_installed`); to fix it, install the Codex CLI and run `codex login`. The native fallback needs a TaskOutput tool, which this session doesn't have. Outside voice unavailable, recorded as `outside_status: unavailable`. No cross-model check.

## TODOS.md candidates

### T1: Single-business pages read every record while businesses load
Finding: TODO candidate, P3, confidence 8/10, `src/db/baseQuery.ts:18` (`if (!profileId) return true;`) with `src/hooks/useActiveProfile.ts` (`return defaultProfile?.id ?? profiles[0]?.id ?? '';` while loading), reviewer plan-eng-review (Claude)
Plan baseline: §7 "record it as TD-068, not in scope" (original proposal, not approved)
Runtime evidence: while the business queries load, `useProfileFilter()` returns `''`. Income, Expenses, Projects and Insights then query with a falsy business, which `scopeToProfile` treats as every record, until the id arrives. Not reproduced in the browser.
Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| T1 disposition | unrecorded | add to TODOS.md (+ TD-068 when knowledge files are updated) | skip | build now in MUT-89 |
| T1 code change in MUT-89 | none | none | none | gate every `useProfileFilter` page's queries on a resolved id |
| D1–D7 | approved | unchanged | unchanged | unchanged |

Question D8:
D8 — Should the "every record while loading" gap on other pages be tracked?
Project/branch/task: MUT-89 on feature/mut-89-all-businesses, the "All businesses" view for Home and Clients.
ELI10: While the app is still loading your businesses, Income, Expenses, Projects and Insights ask the database with a blank business, and blank means "everything". For a moment they can show other businesses' records, or unassigned ones. This ticket fixes it only for Home and Clients, because the new lens hook waits. The rest is older and touches every page.
Stakes if we pick wrong: Skip it and the brief cross-business flash on other pages stays invisible to the backlog; build it now and this ticket grows across five pages.
Recommendation: A because it is real but older than this ticket, and fixing it touches every page, so it deserves its own small change with its own tests.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add to TODOS.md (recommended)
  ✅ The gap is written down with its cause (baseQuery.ts:18) and the fix pattern MUT-89 proves on Home
  ✅ Keeps MUT-89's diff to the screens its ticket names, so review stays focused
  ❌ Other pages keep the brief all-records read until someone picks it up
B) Skip
  ✅ No backlog entry for a flash nobody has reported
  ✅ Zero cost now
  ❌ The cause is forgotten and someone rediscovers it the hard way
C) Build it now
  ✅ Closes the gap app-wide in one go, using the exact pattern this ticket adds
  ✅ No follow-up needed
  ❌ Grows MUT-89 by five pages and their tests, beyond what its acceptance criteria ask (human ~1d / CC ~30min)
Net: write it down now, fix it in its own change.
Header: Loading gap
Options:
A) Add to TODOS.md (recommended)
Add a TODOS.md item (What/Why/Context/Effort S/Priority P3/Depends on MUT-89's useOwedLens pattern) and mirror it as TD-068 in .claude/TECH_DEBT.md during the knowledge update. No code change in MUT-89.
B) Skip
Record nothing. No code change.
C) Build it now
Gate every `useProfileFilter` page's queries (Income, Expenses, Projects, Insights, Planning) on a resolved business id inside MUT-89, with a loading test per page. Effort: human ~1d / CC ~30min.

State: approved
Actual answer: C) "Build it now" (D8, 2026-10-12)
Accepted scope:
- Inside MUT-89, every single-business page gates its queries on a resolved business id: Income, Expenses, Projects, Insights and Planning, through `useProfileFilter` or Planning's direct store read.
- None of them reads with a blank business while businesses load.
- Each page gets a loading test: no records and no empty-state flash before the id resolves.
- No TODOS.md item. TD-068 is not needed for this gap.
History: build-time mechanism (Basel, 2026-10-12, during /eng-build): one gate in `AppShell` instead of five per-page gates. The routed page mounts only once businesses have loaded, as the sample-preparing hold already does. One `AppShell` gate test replaces the five per-page loading tests. The behaviour is unchanged, and it covers every page, including future ones.

## Owner decisions

O1–O7 were answered as recommended (D9 to D15, 2026-10-12): sticky lens; All listed only on Home and Clients; All = the switcher's businesses; one muted row per business; dot + name tags; TD-065 deferred; the Client and Project drawers unchanged.

Approval readiness: PASS. Checked:
- the scope record (D1);
- F1 (D2), F2 (D3), F3 (D4), A1 (D5), Q1 (D6), R1 (D7) and T1 (D8);
- the owner decisions O1–O7 (D9–D15).

Each accepted remedy cites its own answer.

## NOT in scope

- **The hosted portal's switcher:** decision HP1 doesn't carry S2, and hosted income is read-only.
- **Expenses, documents, retainers, insights, planning and projects stay per business:** S2 limits the lens to the owed screens (they still get the loading gate, D8).
- **Converted totals across currencies:** ADR-035 and the currency rules say never sum across currencies.
- **A per-business breakdown of the Owed now strip:** the brief doesn't ask for it, and the tags carry the business context.
- **Business tags on the client profile page:** O6, TD-065 stays open for the single-business view.
- **Forcing a business choice in the Client and Project drawers:** O7, MUT-57 owns the sidebar New menu.
- **Reconciling MUT-81's "Show" with the lens:** MUT-81 is being designed in another session. A note goes on that ticket.

## What already exists

- `partitionOwedNow` (`src/db/aggregations.ts:164`) takes entries rather than a business (ADR-049 §7). It is reused per business for the muted rows.
- `clientSummaryRepo.listOwedIndex`, `transactionRepo.list`, `paymentRecordRepo.listRecent` and `clientRepo.list` already take a business filter through `scopeToProfile`. Only the filter type widens.
- `IncomeDrawer` already asks for the business up front when it can't work one out (`profileInFastPath`, `IncomeDrawer.tsx:171`; test `IncomeDrawer.test.tsx:492`). It is reused with no logic change.
- `useProfileAwareAction` and `ProfileQuickPicker` already ask for a business in All mode in the Add menus. They are reused.
- `ProfileBadgeWithName` (`src/components/ui/ProfileBadge.tsx:55`) is reused for the tags (O5).
- `AllProfilesAvatar` is restored from `70b5093^`.
- TanStack Router `staticData` (built-in) tags the owed routes, so no pathname helper is written (D1).

## Diagrams

```
            persisted                        not persisted
   ┌──────────────────────────┐     ┌───────────────────────────┐
   │ profileStore             │     │ onOwedScreen              │
   │  activeProfileId (work)  │     │  ← AppShell useLayoutEffect│
   │  allBusinesses (lens)    │     │    useMatches().some(      │
   └──────┬────────────┬──────┘     │     m.staticData.owedLens) │
          │            │            └────────────┬──────────────┘
          │            │                         │ (chrome only, D3)
          ▼            ▼                         ▼
   useProfileFilter  useOwedLens            useActiveProfile
   (always concrete) isAll = lens ∧ ≥2      isAllProfiles = lens ∧ owed ∧ ≥2
   undefined until   scope: string[] | id   showAllProfilesOption = owed ∧ ≥2
   resolved (D8)     | '' (no businesses)        │
          │          | undefined (loading)       ├─► ProfileSwitcher (All option, label)
          ▼            │                         ├─► TopBar indicator
   Income, Expenses,   ▼                         └─► IncomeDrawer / Add menus ask business
   Projects, Insights, Home (OverviewPage → one useReceivables for Owed now
   Planning            + Needs attention, ADR-055), HomeRecentPayments,
                       Clients (listOwedIndex → rows + profileIds + muted rows)

 switcher pick business ─► setActiveProfile(id): work = id, lens off
 switcher pick All      ─► setAllBusinesses(true)          (D6)
 auto-correct repair    ─► setWorkingProfile(id): lens kept (D5)
 muted row click (All)  ─► setWorkingProfile(row business) + navigate /income?client=…
```

Inline diagram to add: a short state comment in `src/lib/profileStore.ts` naming the three setters and which one touches the lens.

## Failure modes

| New path | Realistic failure | Test / handling | User sees |
|---|---|---|---|
| Lens queries gated until the scope resolves | The new-user check uses `isLoading`, so the empty state flashes | D2 test (OverviewPage, businesses loading) | Nothing (spinner) |
| Zero businesses | The scope never resolves | D4 test | Normal Home |
| Route flag sync | The flag stays stale after navigating (sync removed or broken) | Integration test `/` → `/income` → `/` (D7) | The switcher would show All on Income: caught by the test |
| Working business archived while All is on | The lens is turned off by the auto-correct | D5 test | All stays on |
| Array scope in `listOwedIndex` | An unassigned or archived-business record leaks in | O3 repository test | Correct totals |
| Per-business muted row click | The working business doesn't switch before navigating | ClientsPage test (O4) | Income would show the wrong business: caught |
| `/income` and the other pages while loading | A blank business reads every record | D8 loading test per page | Spinner, not foreign records |
| Persisted legacy `'all'` | The migrate step throws or the lens resets | Store migration test | All restored |

Critical gaps (no test + no handling + silent): 0.

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| S1 Store + lens hooks + route tag | `src/lib/`, `src/hooks/`, `src/router.tsx`, `src/components/layout/AppShell` | — |
| S2 Repository scope + tags | `src/db/`, `src/types/` | — |
| S3 Home + Clients screens | `src/pages/overview`, `src/pages/clients`, `src/components/home`, `src/components/clients` | S1, S2 |
| S4 Switcher, top bar, drawer cleanup | `src/components/layout`, `src/components/drawers`, `src/hooks/useProfileAwareAction` | S1 |
| S5 Loading gate on other pages | `src/pages/{income,expenses,projects,insights,planning}` | S1 |
| S6 Knowledge files + ADR-051 | `.claude/` | S3, S4, S5 |

Sequential implementation, no parallelization opportunity worth a second worktree. S1 and S2 are independent but small, and S3 to S5 all wait on S1's hooks. One worktree (this one), built in the order S1 → S2 → S3 → S4 → S5 → S6.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~30min / CC: ~5min)**: Home: decide "new user" on a resolved scope and pending queries.
  - Surfaced by: Scope Challenge F1 (D2), refined by D4.
  - Files: `src/pages/overview/OverviewPage.tsx`, `src/pages/overview/__tests__/OverviewPage.test.tsx`
  - Verify: `npx vitest run src/pages/overview`
- [ ] **T2 (P2, human: ~20min / CC: ~3min)**: lens hooks: `useOwedLens` ignores the route flag, and AppShell writes the flag in a layout effect.
  - Surfaced by: Scope Challenge F2 (D3).
  - Files: `src/hooks/useActiveProfile.ts`, `src/components/layout/AppShell.tsx`, `src/router.tsx`
  - Verify: `npx vitest run src/hooks src/components/layout`
- [ ] **T3 (P2, human: ~20min / CC: ~3min)**: `useOwedLens`: zero businesses give scope `''`; "unresolved" is `=== undefined`.
  - Surfaced by: Scope Challenge F3 (D4).
  - Files: `src/hooks/useActiveProfile.ts`, `src/hooks/__tests__/useActiveProfile.test.tsx`
  - Verify: `npx vitest run src/hooks/__tests__/useActiveProfile.test.tsx`
- [ ] **T4 (P2, human: ~20min / CC: ~3min)**: store: the auto-correct effect uses `setWorkingProfile`, and the legacy `'all'` migration survives.
  - Surfaced by: Architecture A1 (D5).
  - Files: `src/lib/profileStore.ts`, `src/hooks/useActiveProfile.ts`, their tests
  - Verify: `npx vitest run src/hooks src/lib`
- [ ] **T5 (P3, human: ~20min / CC: ~3min)**: store API: add `setAllBusinesses`, and drop the `'all'` sentinel and its dead checks.
  - Surfaced by: Code quality Q1 (D6).
  - Files: `src/lib/profileStore.ts`, `src/hooks/useActiveProfile.ts`, `src/components/drawers/IncomeDrawer.tsx`, `src/hooks/useProfileAwareAction.ts`, `src/pages/planning/PlanningPage.tsx`
  - Verify: `npm run typecheck && npx vitest run src/components/__tests__/IncomeDrawer.test.tsx src/hooks`
- [ ] **T6 (P1, human: ~2h / CC: ~10min)**: tests: the regression contract.
  - Surfaced by: Test review R1 (D7).
  - Scope: move the Home mocks to `useOwedLens`, add the ADR-055 one-query check in All, add the `/income` working-id integration test, rewrite `useActiveProfile.test:114`/`:124`, and delete `:173`.
  - Files: `src/pages/overview/__tests__/OverviewPage.test.tsx`, `src/components/home/__tests__/HomeNeedsAttention.test.tsx`, `src/hooks/__tests__/useActiveProfile.test.tsx`, a new integration test
  - Verify: `npx vitest run`
- [ ] **T7 (P2, human: ~1d / CC: ~30min)**: loading gate on Income, Expenses, Projects, Insights and Planning, with a loading test each.
  - Surfaced by: TODO T1 (D8).
  - Files: the five pages and their tests
  - Verify: `npx vitest run src/pages`

## Unresolved decisions

None in this review. O1–O7 were answered (D9–D15).

## Completion summary

- Step 0: Scope Challenge: scope accepted as-is (smaller arrangement, D1; TODO T1 added scope via D8)
- Architecture Review: 1 issue found (A1)
- Code Quality Review: 1 issue found (Q1)
- Test Review: diagram produced, 26 gaps identified (all mapped to the approved test plan)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to the user (built now, D8)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Codex unavailable (not installed); native fallback unavailable (no TaskOutput tool)
- Parallelization: 1 lane, 0 parallel / 6 sequential steps
- Lake Score: 5/6 (D2, D3, D4, D5 and D7 picked a 10/10 option; D6 picked its best-scored option at 9/10; D1 and D8 were not scored)

## Suppressed findings

None. No finding was scored below 5.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (`/plan-eng-review` outside voice) | Independent 2nd opinion | 1 | unavailable | Codex not installed; no native fallback (no TaskOutput) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 28 issues (1 architecture, 1 code quality, 26 test gaps mapped to tasks), 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (CLI not installed). The native fallback was unavailable (no TaskOutput tool). No outside findings.
- **VERDICT:** no review CLEAR yet. Every eng finding is accepted and mapped to Implementation Tasks T1–T7, so building can proceed against this plan. eng review required

NO UNRESOLVED DECISIONS
