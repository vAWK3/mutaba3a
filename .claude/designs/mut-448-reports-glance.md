# MUT-448 — Portal Reports Glance: the ledger across your profiles (plan)

Ticket: MUT-448 (Story, Backlog), epic MUT-446. Blocked by MUT-447: **resolved** (merged local main 5168b7ab, In Review, API 1.76.0-mut447, ADR-204). Blocks MUT-451 (portal Explore). Relates to MUT-449 (phone Glance, same stage).
Design doc (APPROVED): `basel-main-design-20261026-111558.md`. Screens: `reports-rethink-screens-20261026.html` (desktop `D()` + `ledger()`, phone `G2()`).
Status: planned, not built. The brief is copied into `.claude/designs/mut-448-reports-glance.md` at build time, so the shared main checkout stays clean now.

## What ships

An account-level page at **`/reports`**. It shows the G2 ledger:
- a ≈ kept hero (or "business net"), compared with your usual on Month only;
- one row per profile (net, or spent + came in for personal);
- the owed row;
- the FX footnote.

Week / Month / Year with ‹ ›. Desktop ≥1000px pins the ledger on the start side, with an Explore placeholder beside it. Under 1000px it is one column. A row opens `/p/:id/reports` with the period carried over.

The portal shows the server's figures as they come. It does no conversion, summing or median of its own, so the money rules stay in one place (ADR-204).

## Decisions (approved after eng review; D-numbers are Basel's answers, see the ledger)

| # | Decision |
|---|---|
| P1 | **Route `/reports`**, a child of `authedRoute` (like `/you`), outside `/p/:id`. Search: `period`, `at`, `back`. `/p/:id/reports` is unchanged and becomes the drill-down. |
| P2 (D8) | **Shell profile:** `back`'s profile if it is not locked and passes `canReadReports`; else the first `me.profiles` entry that is both; else the first that is not locked; else null (S11, as `/you`). One pure picker (`glanceShellProfile`). The corner icon links to `/reports?back=<current path>`; pressing it again returns to `back` (MUT-426 D7). `backOf` is exported from `youRoutes.ts` and reused. |
| P3 | The corner icon is lit on `/reports` **and** `/p/:id/reports`. `NO_DESTINATION` keeps `reports`. |
| P4 (D3→D9, D4) | **Data:** `api.verdict(query?)` (no `profileId`). `useVerdict(range \| 'current')`: the key is `['verdict', from, to]`, or `['verdict', 'current']` for the parameterless default view; `refetchOnMount: 'always'`, `staleTime` 10 s; the last answer stays on screen dimmed while `isFetching && !isPending`. **No** write-path invalidation edits. |
| P5 (D7) | **All locked:** if every reportable `me.profiles` entry has `billingGateOf === 'locked'`, render `LockedScreen` for the shell profile, with the query `enabled: false`. A 402 SUBSCRIPTION_LAPSED that still arrives also shows `LockedScreen`. Every other error shows the QueryView retry. |
| P6 | Pure shaping in `data/verdict.ts`: `glanceOf(verdict, { period, readable })` returns `{ hero, usualDelta, rows[], owed, footnote }`. Rows keep the API's order. `parseAmountToMinor` turns decimals into minor units. |
| P7 | Row figures: the row's `converted` figure, ≈ when the profile holds a non-base currency. With `converted` null, per-currency amounts are stacked, never summed. Business/FIRM rows show net (+ "shared"); personal rows show spent (+ "came in" when ≠ 0). |
| P8 | States (exact copy in the copy table): negative kept (`−` in `<bdi>`, rose, `keptNegative`); a profile with no entries ("Nothing this {period}", still tappable); a business with no expenses ("earned"); unavailable (a non-link row, plus "Leaves out {names}" when `total.partial`); rates null ("In {inCurrencyOnly} only", no ECB date); `omittedCurrencies` (a footnote line); one profile; no personal profile (`businessNet`). |
| P9 (DD1) | Usual (finished months only): ▲/▼/about when `usual` and `total.converted` are set and the period does not contain `asOf`; otherwise hidden. |
| P10 (D1, D6) | **≈ popover:** `BreakdownButton` is generalised **in place** in `HeroFigures.tsx` to take `lines`, and exported. HeroFigures keeps its rate lines. Glance passes `total.currencies` + "ECB reference rate, {rates.date}"; no `/v1/fx-rates` request. Its 6 characterization tests come first. |
| P11 | The hero reuses `CountUp`. One display number per screen, tabular numerals, −0.03em tracking. |
| P12 (D10) | Period: `ReportControls` with `allProfiles={null}` and `yearLockedUntil={null}`; ‹ stops at `moneyDateFloor(today) − 366 d`. **Known limitation:** a new account can step back into empty months (MUT-450 observes it). |
| P13 (D4) | **Today:** the default Month view (no `at`) asks with no from/to. `asOf` is "today" for ‹ ›, W/Y, `hasPrevious`/`hasNext`, the row links' `?at=`, `report_viewed`'s period and the "so far" caption. The shell timezone's today is used only before the first answer arrives. No TD. |
| P14 | Row link: `/p/:id/reports?period=&at=` only when the row's profile is in `me.profiles` and `canReadReports`. |
| P15 (D8 → DD7) | **Superseded by DD7: one centred 560px column at every width + hint; no Explore card.** Was: Desktop ≥1000px: a two-column `.hp-glance` grid, with the ledger aside sticky at the inline start and the Explore card (only when the shell profile is readable) linking to its `/p/:id/reports`. 600–999px: one column, card below. <600px: one column, no card. |
| P16 (C1) | `report_viewed` gains `layer`: Glance sends `{ period, layer: 'glance' }`, and the per-profile page adds `layer: 'profile'`. `docs/analytics/events.json` goes to 2.3.0, with a new `PINNED_VERSIONS` row. |
| P17 (D5, C6) | `pageMotionOf`: `/reports` → `/p/:id/reports…` is forward, and the reverse is back (under reduced motion these play as the reduced fade). The corner-icon press itself stays a cut. |
| P18 (C5) | Glance's search writes go through `useReplaceSearch`, keeping `back` and the shell overlay keys. |
| P19 (C2) | Release order: the API with MUT-447 (1.76.0) goes live before the web with MUT-448, recorded in `docs/operations/before-release.md`. |
| P20 | New **ADR-205**: Glance at account-level `/reports` + `back`, the shell-profile picker, server figures shown verbatim, freshness by refetch-on-visit. Check that ADR-205 is still free at merge. |

## Files

**Add**
- `src/hosted/pages/views/GlancePage.tsx`: the page, plus in-file `Ledger`, `OwedRow`, `Footnote`, `ExploreCard` and the skeleton (D1).
- `src/hosted/data/verdict.ts`: P6–P9 + `glanceShellProfile` (P2), pure.
- `src/hosted/data/verdictQueries.ts`: P4.
- Tests: `data/__tests__/verdict.test.ts`, `data/__tests__/verdictQueries.test.tsx`, `pages/__tests__/Glance.test.tsx`; additions to `components/reports/__tests__/reportsComponents.test.tsx` (D6), `shell/__tests__/HostedShell.test.tsx`, `shell/__tests__/pageMotion.test.ts`, `shell/__tests__/destinations.routes.test.ts`, `analytics/__tests__/reportViewed.test.ts`.
- `qa/features/portal/reports-glance.yaml`, `qa/specs/portal/reports-glance.spec.ts`.

**Touch**
- `src/hosted/router.tsx` (the `/reports` route, `validateSearch: parseGlance`), `src/hosted/data/filters.ts` (`GlanceSearch`, `parseGlance`).
- `src/hosted/shell/HostedShell.tsx` (the icon target + lit state), `shell/youRoutes.ts` (export `backOf`), `shell/pageMotion.ts` (P17).
- `src/hosted/api/client.ts` (`verdict`).
- `src/hosted/components/reports/HeroFigures.tsx` (generalise and export `BreakdownButton`).
- `src/hosted/analytics/reportViewed.ts`, `pages/views/ReportsPage.tsx` (`layer`).
- `docs/analytics/events.json`, `scripts/__tests__/analytics-taxonomy.test.ts` (2.3.0).
- `src/hosted/hosted.css` (`.hp-glance*`, logical properties), `src/hosted/i18n/{en,ar}.json` (`hosted.reports.glance.*`).
- `qa/support/portalApi.ts` (`verdictBody(...)`: a canned Verdict typed against `schema.d.ts`), `reports-glance.yaml` paths that also map `server/src/summaries/verdict.ts` + `months.ts`.
- `docs/operations/before-release.md` (P19).
- Knowledge: CHANGELOG, DECISIONS (ADR-205), COMPONENT_REGISTRY (Reports: GlancePage, `BreakdownButton` export, verdict data), SYSTEM_OVERVIEW (Reports is account-level), TEST_PLAN. No TD; PATTERNS unchanged.

## Copy table first (AC gate)

The en + ar table goes in `.claude/designs/mut-448-reports-glance.md` before any UI code, and **Basel approves it**. Keys: title, kept / businessNet, ≈, vsUsual above/below/about, net / spent / cameIn / earned / shared, nothingThisPeriod, lockedBilling / couldntLoad, leavesOut, owed + overdueN (ICU plural, all 6 Arabic forms), footnote shared-in-full / ECB date / in-X-only / omitted, explore card + link, popover heading, skeleton label. Arabic "kept" draft: «تبقّى لك» (OQ5). Months use the existing `getLocale('ar')` formatters.

## Tests (TDD; build order)

1. **First commit (D6):** 6 BreakdownButton characterization cases in `reportsComponents.test.tsx`, green on today's code, before any refactor.
2. **`verdict.test.ts`** (pure):
   - 1 business + 1 personal → 2 rows + kept + owed (AC1).
   - 5 profiles → 5 rows in API order, and the hero = `total.converted` (AC2).
   - Negative kept.
   - A zero profile → empty.
   - Spent 0 → earned.
   - Personal came-in on/off.
   - Shared tag.
   - `unavailable` → non-link + leavesOut.
   - Rates null → inCurrencyOnly.
   - A converted-null row with 2 currencies → stacked.
   - usual: ▲/▼/about; hidden on Week, when null, or when converted is null.
   - `businessNet`.
   - Not readable → not a link.
   - `omittedCurrencies`.
   - `glanceShellProfile`, every branch (D8).
   - Stepping and the `at` for links from `asOf` (D4).
3. **`verdictQueries.test.tsx`:**
   - No `X-Mutaba3a-Profile` header.
   - The default view sends no params and uses the `['verdict','current']` key; an explicit range uses its own key.
   - `refetchOnMount 'always'` + `staleTime` 10 s.
   - Dimmed while `isFetching && !isPending`.
   - Disabled when all profiles are locked.
4. **`Glance.test.tsx`:**
   - Skeleton → ledger.
   - ‹ › and W/M/Y write `period`/`at` and keep `back` and `?billing=` (C5).
   - Row links carry `period`/`at` (from `asOf` on the default view).
   - Year is open.
   - `<bdi>` on every amount.
   - `ar` RTL and the step labels.
   - Reduced motion → `CountUp` paints once.
   - All locked from `me` → LockedScreen with no request.
   - A late 402 → LockedScreen.
   - Another error → retry.
   - `report_viewed` sends `layer: 'glance'`.
   - axe.
5. **Shell / motion / analytics:**
   - The icon targets `/reports?back=` and is lit on both routes.
   - The `/reports` shell shows the picked profile's pill.
   - The route walk.
   - pageMotion rows for `/reports` ↔ `/p/:id/reports`.
   - `reportViewed` sends `layer: 'profile'`.
   - Taxonomy 2.3.0 is pinned.
6. **Existing, unchanged and green:** `Reports.test.tsx`, `reports.test.ts`.
7. **Release-QA** (`reports-glance.yaml`, one tagged spec each): `two-profiles`, `five-profiles`, `arabic`, `local-mode` (the real in-browser server), `negative-month`, `row-drilldown`, `desktop-layout` (single centred column, DD7), `first-run` (DD4), `owed-zero` (DD3). Run `release-qa run --attach --only <id>`, then `release-qa lint`.

**Commands (Node 22, through heavy-gate):** `npm run lint`, `npm run typecheck`, `npm run test:run -- src/hosted scripts` while iterating, then the full `test:run` + `build`. No server change.

## Scale / cost

- One verdict GET per visit and per period step (focus refetch only when the answer is older than 10 s, D9). The server reads ≈6N+1 per call (TD-264, MUT-447). The portal adds no fan-out.
- There is no new dependency, and the bundle grows only by the page plus the small `verdict.ts`. The route is code-split like the other pages if the router lazy-loads; it doesn't today, so this is not a new concern.

## Out of scope

The Explore tabs (MUT-451), "Lately", the phone (MUT-449), any server change, client-side conversion, and the R5 owner-pay rule (still being measured by MUT-450).

## Risks

Resolved in the eng review (D7–D10, C1–C6). What remains: AC2 "the same kept as the API" is proven against a canned verdict in QA. Real parity rests on MUT-447's server tests, the local-mode spec and MUT-450's hand check. The screens mock a desktop header bar; the build keeps the MUT-426 floating shell, as the design doc says.

---

# Eng review (plan-eng-review, 2026-10-26)

Target: this file (`mut-448-glance-plan.md`), fixed. The plan above is the original proposal; amendments below are approved changes only.

## Scope record

feature answers: none (no cuts proposed); structure: B Smaller arrangement (D1, Basel 2026-10-26); accepted scope: 3 new units — `pages/views/GlancePage.tsx` (ledger, owed row, footnote and Explore card as in-file components), `data/verdict.ts`, `data/verdictQueries.ts`; `BreakdownButton` generalised (takes `lines`) and exported in place in `components/reports/HeroFigures.tsx` (no `GlanceLedger.tsx`, no `ApproxFigure.tsx`); every feature, contract and test in the plan unchanged; pending remedies: F2, F3, F4.

Scope Challenge result: scope accepted as-is (smaller arrangement, same scope).

## Corrections (no behaviour change, no question)

- **C1 (F1) [P2] (confidence 9/10) analytics contract.** P16 adds `layer` to `report_viewed`, but `docs/analytics/events.json:106-113` lists only `period`/`scope`/`stage`, and `scripts/__tests__/analytics-taxonomy.test.ts:20-26,219-221` pins every version's sha256 and requires the newest to be the file's. Required proof for P16: add `layer` (`enum: glance | profile`) and make `scope`/`stage` optional-for-glance in the description, bump `events.json` 2.2.0 → 2.3.0, add the `'2.3.0'` PINNED_VERSIONS row (MUT-175 D6 precedent: 2.2.0). Prior learning applied: analytics-contract-pins-server-currencies (confidence 10/10, from 2026-10-18). Files: `docs/analytics/events.json`, `scripts/__tests__/analytics-taxonomy.test.ts`.

## Decision ledger

### R1: What /reports shows when every held profile is LOCKED (F2)
Finding: F2, [P1], confidence 9/10, `server/src/billing/gate.ts:73` (`'GET /v1/summaries/verdict': 'person'`) + `:101-104` (`if (standing === 'locked') return true;`), reviewer: Claude (Scope Challenge).
Plan baseline: P8/GlancePage error states route every failure to the generic `QueryView` retry card; no 402 state.
Runtime evidence: person standing = best state across profiles (`personStanding`, gate.ts:92); locked standing refuses every method → 402 SUBSCRIPTION_LAPSED. Profile pages already show `LockedScreen` (`components/LapseGate.tsx:126`) via ProfileLayout. Lapse gate is off in prod until `billing:uncovered` is empty (MUT-361), so this ships dormant but reachable.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 all-locked /reports | generic retry card (retry can never succeed) | `LockedScreen` for the shell profile inside the shell; Glance.test case for 402 | keep the generic retry card; no code |
Question D2:
D2 — MUT-448: what /reports shows when all your profiles are locked
Project/branch/task: planning MUT-448 portal Reports Glance on mini-crm main.
ELI10: The verdict is a person-level read. When every profile you hold is locked by billing, the server refuses it with 402 (gate.ts:101-104). The plan sends every error to the generic "couldn't load, retry" card, and retrying can never work. Every profile page already shows the LockedScreen with the way to pay; Reports would be the one page that shows a dead end.
Stakes if we pick wrong: a lapsed customer opens Reports and sees a broken page with a useless Retry instead of the subscribe path, on the exact screen where they see their money.
Recommendation: A because it reuses the existing LockedScreen (billing CTA included) for one extra branch and one test.
Completeness: A=9/10, B=4/10
Pros / cons:
A) Show LockedScreen (recommended)
  ✅ The person gets the same subscribe path every locked profile page already gives them
  ✅ Reuses components/LapseGate.tsx LockedScreen as is; one 402 branch + one Glance.test case (human ~1 hr / CC ~5 min)
  ❌ One more state on the page to keep in sync if LockedScreen's props change later
B) Keep the generic error card
  ✅ No extra code in this ticket; the lapse gate is still off in prod today
  ❌ Retry can never succeed, so the person is stuck with no explanation once the gate turns on
Net: one reused component versus a dead-end screen for paying customers who lapse.
Header: Locked
Options:
A) Show LockedScreen (Recommended)
On 402 SUBSCRIPTION_LAPSED from GET /v1/summaries/verdict, GlancePage renders LockedScreen for the shell profile inside HostedShell (no Retry). One Glance.test case for the 402 branch. Other errors keep the QueryView retry card.
B) Keep generic error card
Every verdict error, 402 included, shows the QueryView retry card as planned. No extra code or test.

State: approved
Actual answer: A) Show LockedScreen (Basel, D2, 2026-10-26)
Accepted scope: On 402 SUBSCRIPTION_LAPSED from GET /v1/summaries/verdict, GlancePage renders `LockedScreen` (components/LapseGate.tsx) for the shell profile inside HostedShell, with no Retry. One Glance.test case for the 402 branch. Every other verdict error keeps the QueryView retry card.
History: none

### R2: How the verdict cache learns about saves (F3)
Finding: F3, [P2], confidence 8/10, plan P5 vs `src/hosted/data/expenseQueries.ts:85-87`, `incomeQueries.ts:14`, `customerQueries.ts:25`, `projectQueries.ts:19` (all invalidate `profileKey(profileId, 'summary', …)`), reviewer: Claude (Scope Challenge).
Plan baseline: P5 — `['verdict']` prefix invalidated in all four write paths (4 more touched files), `staleTime` 30 s.
Runtime evidence: the verdict key is not under `profileKey`, so today's invalidations miss it. Glance itself has no write drawer (no in-page save), so a stale verdict is only ever seen when returning to `/reports` after a save elsewhere, or after a save in another tab.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 freshness | P5: invalidate in 4 write paths, staleTime 30 s | P5 as planned + a test per write path | `staleTime: 0` + `refetchOnMount: 'always'` + `refetchOnWindowFocus` default (on) for the verdict query only; dimmed placeholder while refetching; no write-path edits; one verdictQueries test |
Question D3:
D3 — MUT-448: keep the verdict fresh by invalidating on saves, or refetching on visit
Project/branch/task: planning MUT-448 portal Reports Glance on mini-crm main.
ELI10: The kept number must change after you record income or an expense anywhere. The plan wires a "forget the verdict" call into four save paths, because the verdict's cache key doesn't belong to any one profile. Glance has no save button of its own, so the only time it can be stale is when you come back to it. Refetching every time the page opens (or the tab regains focus) gives the same freshness without touching the four save paths.
Stakes if we pick wrong: either a forgotten fifth save path (a future one) silently leaves Reports stale for 30 seconds, or one extra GET per Reports visit.
Recommendation: B because it can't miss a future save path, needs no edits in shipped write code, and costs one cheap GET per visit, which the cached placeholder hides.
Completeness: A=8/10, B=9/10
Pros / cons:
A) Invalidate on saves
  ✅ Zero extra requests when nothing changed and the cache is under 30 s old
  ✅ Matches how the per-profile summaries are kept fresh today
  ❌ Four more touched files, and every future write path must remember the verdict key (human ~2 hrs / CC ~15 min)
B) Refetch on every visit (recommended)
  ✅ Always fresh on arrival and on tab focus, including saves made in another tab or on the phone
  ✅ No edits to income/expense/customer/project write code; one test pins the query options (human ~30 min / CC ~5 min)
  ❌ One GET per visit even when nothing changed (server reads ≈6N+1, TD-264); the last verdict shows dimmed meanwhile
Net: one GET per visit buys freshness that can't be forgotten by a later save path.
Header: Freshness
Options:
A) Invalidate on saves
Keep P5: export VERDICT_PREFIX and invalidate it in incomeQueries, expenseQueries, customerQueries and projectQueries; staleTime 30 s; a test per write path.
B) Refetch on visit (Recommended)
Verdict query only: staleTime 0, refetchOnMount 'always', refetchOnWindowFocus on; dimmed placeholder (last verdict) while it refetches; no write-path edits; one verdictQueries test pins the options and the placeholder.

State: approved
Actual answer: B) Refetch on visit (Basel, D3, 2026-10-26)
Accepted scope: Replaces P5. Verdict query only: staleTime 0, refetchOnMount 'always', refetchOnWindowFocus on; the last verdict shows dimmed as the placeholder while it refetches; no edits to income/expense/customer/project query files; one verdictQueries test pins these options and the placeholder.
History: none

### R3: Whose "today" picks the default period (F5, plan P13)
Finding: F5, [P3], confidence 8/10, plan P13 vs `src/hosted/api/schema.d.ts` HostedProfile (has `timezone`, no `createdAt`) and the verdict contract (`from`/`to` "default to this month in the base profile's timezone", `asOf` = today there; openapi.yaml:14405-14420), reviewer: Claude (Scope Challenge).
Plan baseline: P13 — the default range comes from `todayInZone(shellProfile.timezone)`; TD-265 records the midnight mismatch.
Runtime evidence: the client cannot recompute the server's base profile (R4: oldest personal, else oldest included) because HostedProfile carries no `createdAt`. The server already defaults from/to and returns `from`, `to`, `asOf`.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 default-view "today" | shell profile's timezone (TD-265) | default Month view (no `at` in the URL) requests the verdict with no from/to; the response's `asOf` is "today" for ‹ ›, W/Y switches and the "so far" caption; until the first answer arrives, the shell timezone's today is only used to label the skeleton; TD-265 dropped; one verdictQueries test (no params on the default view) + one verdict.test (stepping from asOf) | P13 as planned + TD-265 |
Question D4:
D4 — MUT-448: let the server pick "this month" on first open
Project/branch/task: planning MUT-448 portal Reports Glance on mini-crm main.
ELI10: Reports opens on this month. The plan works out "today" in the timezone of the profile you came from, but the server counts kept in the base profile's timezone (your oldest personal profile). The portal can't work that profile out because profiles carry no creation date. Asking the server with no dates makes it pick this month itself and send back its own "today" (asOf); stepping then counts from that.
Stakes if we pick wrong: around midnight, for someone whose profiles sit in different timezones, Reports opens on the wrong month or week and the hero says "so far" for a period that already ended.
Recommendation: A because the default view then matches the server by construction, and it removes a debt item instead of recording one.
Completeness: A=9/10, B=7/10
Pros / cons:
A) Server picks the default month (recommended)
  ✅ The opening view always matches the server's month; TD-265 is never written
  ✅ The same first request the page makes anyway, just without from/to; ‹ › then step from asOf (human ~1 hr / CC ~10 min)
  ❌ A Week or Year link with no `at` still needs a client "today" for its bounds (uses asOf once known, the shell timezone before)
B) Keep P13
  ✅ Simplest: every request carries explicit from/to from the start
  ❌ A known wrong-month edge stays and needs TD-265 and a future fix
Net: one parameterless first request removes a timezone edge the client can't otherwise solve.
Header: Today
Options:
A) Server picks month (Recommended)
Default Month view (no `at`) requests GET /v1/summaries/verdict with no from/to; asOf from the response is "today" for stepping, W/Y and the caption; shell-timezone today only before the first answer; TD-265 dropped; tests for the parameterless default and stepping from asOf.
B) Keep P13 as planned
Default range from todayInZone(shellProfile.timezone); explicit from/to on every request; TD-265 records the midnight mismatch.

State: approved
Actual answer: A) Server picks month (Basel, D4, 2026-10-26)
Accepted scope: Replaces P13. The default Month view (no `at`) requests GET /v1/summaries/verdict with no from/to. The response's `asOf` is "today" for ‹ ›, the W/Y switches and the "so far" caption. The shell timezone's today is used only before the first answer arrives. TD-265 is not written. Tests: verdictQueries (the default view sends no params) and verdict.test (stepping from asOf).
History: none

### R4: Page motion between /reports and a profile's report (F4)
Finding: F4, [P3], confidence 9/10, `src/hosted/shell/pageMotion.ts:57` (`if (!inProfile(prev) || !inProfile(next)) return 'none';`), reviewer: Claude (Scope Challenge).
Plan baseline: no motion rule for `/reports`; a row tap and Back cut with no transition.
Runtime evidence: every other one-level-in move in the shell slides forward/back (MUT-426 D6); the design doc's apple-design rule asks for spatial consistency (row → deeper → Back returns to it).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 motion | none (instant cut) | `/reports` → `/p/:id/reports…` = forward, reverse = back, in `pageMotionOf`; reduced motion unchanged (already none); 2 rows in pageMotion's table test | keep none; MUT-451 revisits when Explore owns the drill-down |
Question D5:
D5 — MUT-448: slide when a ledger row opens a profile's report
Project/branch/task: planning MUT-448 portal Reports Glance on mini-crm main.
ELI10: Inside a profile, going one level deeper slides the page forward and Back slides it back (MUT-426). The motion rule ignores pages outside a profile (pageMotion.ts:57), so tapping a ledger row just cuts to the profile's report. Two lines teach the rule that /reports sits one level above a profile's report.
Stakes if we pick wrong: the drill-down feels like a jump to an unrelated page, against the design's "Back returns you to the same row" rule; nothing breaks.
Recommendation: A because it is two lines plus two test rows and matches every other drill-down in the shell.
Completeness: A=9/10, B=7/10
Pros / cons:
A) Slide forward and back (recommended)
  ✅ Row → profile report slides forward, Back slides back, like every other level change in the shell
  ✅ Two lines in pageMotionOf plus two rows in its existing table test; reduced motion already maps to none (human ~30 min / CC ~5 min)
  ❌ MUT-451 changes the row target to Explore, so the rule may be revised there
B) Leave it instant
  ✅ No change to shared shell motion code in this ticket
  ❌ The one cross-level move in the portal with no motion until MUT-451
Net: two lines now for a consistent drill-down, or wait for Explore.
Header: Motion
Options:
A) Slide forward/back (Recommended)
In pageMotionOf: /reports → /p/:id/reports… is 'forward', the reverse is 'back'; two rows in the existing pageMotion table test; reduced motion unchanged.
B) Leave it instant
No pageMotion change; MUT-451 revisits motion when Explore becomes the row target.

State: approved
Actual answer: A) Slide forward/back (Basel, D5, 2026-10-26)
Accepted scope: In `pageMotionOf` (shell/pageMotion.ts), `/reports` → `/p/:id/reports…` is 'forward' and the reverse is 'back'. Two rows go in the existing pageMotion table test. Reduced motion is unchanged.
History: none

## Corrections (continued)

- **C2 [P2] (confidence 9/10) release order.** Glance calls `GET /v1/summaries/verdict` (API 1.76.0-mut447, merged 5168b7ab, not deployed: prod is api-v0.8.0). A web release with MUT-448 before an API release with MUT-447 makes `/reports` fail for everyone. The obligation goes in `docs/operations/before-release.md`: the API with MUT-447 goes live before the web with MUT-448. Also say it in the ADR-205 consequences. No code.

### R5: Regression contract for generalising BreakdownButton (Section 3, IRON RULE)
Finding: T1, [P2], confidence 9/10, `src/hosted/components/reports/HeroFigures.tsx:~170-205` (BreakdownButton: `onMouseEnter`, `onFocus` (focus-visible only, not after Esc), `onClick` (click-after-hover keeps it open, a second click closes), `onKeyDown` Escape, `onMouseLeave` (closes unless opened by click), `onBlur` (focus leaving closes)), reviewer: Claude (Test review).
Plan baseline: D1 (approved) generalises BreakdownButton in place to take `lines`. Existing guard: only `Reports.test.tsx:231-245` (tap opens, the panel shows the ECB line, Escape closes).
Runtime evidence: four of the six behaviours (hover open, mouse-leave close, click-after-hover, blur close, focus-visible-only open, no reopen after Esc) have no test, and they were MUT-175 review fixes ("it no longer stays open, or reopens, after Tab").
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 regression proof | 1 integration test (tap/Esc) | characterization first: 6 cases in `reportsComponents.test.tsx` written and green against today's BreakdownButton before the refactor, unchanged after; HeroFigures' output unchanged; no intended behaviour difference | rely on Reports.test.tsx:231 only |
Question D6:
D6 — MUT-448: pin the ≈ popover's behaviour before reshaping it
Project/branch/task: planning MUT-448 portal Reports Glance on mini-crm main.
ELI10: Today's Reports popover has six small behaviours that review fixes added: hover opens it, leaving closes it, a click after hover keeps it open, Esc closes it without reopening, keyboard focus opens it, and tabbing away closes it. Only "tap opens, Esc closes" has a test. Glance reuses the popover by changing what it takes, so the other five could break without any test noticing.
Stakes if we pick wrong: shipped Reports quietly regains the "popover stuck open after Tab" bug that MUT-175 review fixed, and Glance inherits it.
Recommendation: A because six characterization tests written before the refactor are the cheapest proof that nothing changed (the MUT-175 D5 pattern).
Completeness: A=10/10, B=5/10
Pros / cons:
A) Characterize first (recommended)
  ✅ All six behaviours are pinned against today's code, so the refactor must keep them green
  ✅ Glance gets the same popover rules for free; the tests live in the existing reportsComponents.test.tsx (human ~2 hrs / CC ~15 min)
  ❌ Six more component tests to maintain alongside the popover
B) Existing test only
  ✅ No new tests in this ticket
  ❌ Hover, blur and click-after-hover regressions would pass CI
Net: six small tests now versus re-opening a fixed popover bug.
Header: Regression
Options:
A) Characterize first (Recommended)
Before generalising BreakdownButton: 6 cases in reportsComponents.test.tsx (hover opens; mouse-leave closes unless click-opened; click after hover stays open, second click closes; Esc closes and focus doesn't reopen it; keyboard focus-visible opens, mouse focus doesn't; blur out of the panel closes), green on today's code and unchanged after. No intended behaviour change.
B) Existing test only
Keep Reports.test.tsx:231-245 as the only guard; no new popover tests.

State: approved
Actual answer: A) Characterize first (Basel, D6, 2026-10-26)
Accepted scope: Before BreakdownButton is generalised, 6 cases go in reportsComponents.test.tsx: (1) hover opens; (2) mouse-leave closes unless it was opened by a click; (3) a click after hover keeps it open, and a second click closes it; (4) Esc closes, and focus doesn't reopen it; (5) keyboard focus-visible opens, mouse focus doesn't; (6) blur out of the panel closes. They pass on today's code and stay unchanged after the refactor. No behaviour is meant to change. This is the first commit of the build.
History: none

## Outside voice (Claude Plan subagent, native fallback; Codex not installed) — findings OV1–OV8, verified by the parent

Corrections (no new behaviour; necessary implementation or proof of approved decisions):
- **C3 (OV3) [P2]** The plan body's Files/Tests/Knowledge lists still name rejected items (GlanceLedger.tsx, ApproxFigure.tsx, the four write-path invalidations, staleTime 30 s, P13/TD-265). The Required-outputs rewrite replaces them in place, so `/eng-build` builds the approved design.
- **C4 (OV5) [P2]** Necessary implementation of D4: the parameterless default view gets its own key `['verdict', 'current']`. Once `asOf` is known, the row links' `?at=`, `hasPrevious`/`hasNext` and `report_viewed`'s period all derive from `asOf`. Tests: the row link and the step buttons use `asOf`, and stepping back to the current month reuses the right data.
- **C5 (OV6) [P2]** Existing contract (filters.ts `pickShellOverlay`, MUT-183 R1): Glance's search writes go through `useReplaceSearch` and keep `back` plus the shell overlay keys. Glance.test adds "stepping keeps `back` and `?billing=`".
- **C6 (OV7) [P3]** Factual correction to D5: under reduced motion, forward/back play the reduced fade (`hosted.css:1168-1169`), not none. D5's test rows assert the motion type only. The corner-icon press itself (any page ↔ `/reports`) stays a cut: outside D5's approved scope, and not proposed.

### R6: Decide "everything locked" from /v1/me, not the 402 (OV1, reopens R1/D2)
Finding: OV1, [P1], confidence 9/10, `src/hosted/queryClient.ts:32-35` (a lapse refusal re-reads `/v1/me`), `session/AuthGate.tsx:167` (`billingGateOf(me, profile) === 'locked'`), reviewer: outside voice (Claude subagent), verified.
Plan baseline: R1/D2 approved — branch on the 402 from the verdict.
Runtime evidence: the portal decides "locked" from `me` everywhere else. Branching on the 402 fires a doomed request on every visit and focus (D3), flickers skeleton → error → LockedScreen, and the 402 isn't in the verdict's OpenAPI responses.
Comparison grid:
| Choice | Current (D2) | A | B | C | D |
|---|---|---|---|---|---|
| R6 locked detection | on the verdict's 402 | from `me`: every reportable profile `billingGateOf === 'locked'` → LockedScreen, verdict query `enabled: false`; a 402 that still arrives (a race) shows LockedScreen too; tests for both | keep D2 | investigate | defer |
Question D7: see the AskUserQuestion text (saved verbatim below after sending).
State: approved
Actual answer: A) Apply (Basel, D7, 2026-10-26)
Accepted scope: If every reportable `me.profiles` entry has `billingGateOf === 'locked'`, GlancePage renders LockedScreen for the shell profile and the verdict query is `enabled: false`. A 402 SUBSCRIPTION_LAPSED that still arrives also shows LockedScreen. Glance tests cover both. Replaces D2's 402-only branch (D2 now superseded).
History: D2 answer A (LockedScreen on 402), reopened by OV1 (new evidence: the existing me-based lapse path).

### R7: Which profile the /reports shell carries (OV2, refines P2)
Finding: OV2, [P1], confidence 9/10, `shell/HostedShell.tsx:38` (`const sections = profile !== null && billingGateOf(me, profile) !== 'locked'`) + `:55`, `data/reports.ts:120` (`canReadReports`), reviewer: outside voice, verified.
Plan baseline: P2 — `back`'s profile if it is in `me.profiles`, else `profiles[0]`.
Runtime evidence: a locked shell profile hides the icon and the pill, so /reports renders with no chrome. P15's card links to a profile the person may not be able to read.
Comparison grid:
| Choice | Current (P2) | A | B | C | D |
|---|---|---|---|---|---|
| R7 shell profile | back's profile else profiles[0] | back's profile if not locked and `canReadReports`, else the first profile that is both, else the first not locked, else null; the Explore card only when the shell profile is readable; unit tests per branch | keep P2 | investigate | defer |
State: approved
Actual answer: A) Apply (Basel, D8, 2026-10-26)
Accepted scope: Shell profile = `back`'s profile if it is not locked and passes `canReadReports`; else the first `me.profiles` entry that is both; else the first that is not locked; else null. The Explore card shows only when the shell profile is readable. One pure picker with a unit test per branch. Refines P2.
History: none

### R8: Cost of refetching on tab focus (OV4, reopens R2/D3)
Finding: OV4, [P2], confidence 8/10, `server/src/summaries/verdict.ts:11` ("the route reads and posts"), TD-264 (≈6N+1 reads), reviewer: outside voice, verified.
Plan baseline: R2/D3 approved — staleTime 0, refetchOnMount 'always', refetchOnWindowFocus on, "dimmed placeholder".
Runtime evidence: each GET posts due installments for every profile, then reads. On remount the cached data is real data (`isPlaceholderData` false), so the dimming must come from `isFetching && !isPending`.
Comparison grid:
| Choice | Current (D3) | A | B | C | D |
|---|---|---|---|---|---|
| R8 focus refetch | staleTime 0 + focus refetch | refetchOnMount 'always' kept; staleTime 10 s so a focus within 10 s of the last answer doesn't refetch; dim on `isFetching && !isPending`; the test pins both | keep D3 as is (dim condition corrected anyway) | investigate | defer |
State: approved
Actual answer: A) Apply 10 s (Basel, D9, 2026-10-26)
Accepted scope: Verdict query: `refetchOnMount: 'always'`, `staleTime` 10 s (so a focus refetch happens only when the answer is older than 10 s), dimming on `isFetching && !isPending`. One verdictQueries test pins these. Replaces D3's staleTime 0.
History: D3 answer B, reopened by OV4 (new evidence: the GET posts and reads ≈6N+1).

### R9: How far back an empty account can step (OV8)
Finding: OV8, [P3], confidence 8/10, plan P12 (`hasPrevious(..., earlier=true, floor)`), Verdict schema (no `dataSince`), reviewer: outside voice.
Plan baseline: P12 — step back to `moneyDateFloor(today) − 366 d`.
Runtime evidence: a new account can step through about a year of "Nothing this month" ledgers.
Comparison grid:
| Choice | Current (P12) | A | B | C | D |
|---|---|---|---|---|---|
| R9 back-step floor | floor − 366 d | keep P12 and record it as a known limitation in the brief (MUT-450 observes it) | stop ‹ after 2 consecutive all-empty periods | investigate | defer |
State: approved
Actual answer: A) Keep P12 + note (Basel, D10, 2026-10-26)
Accepted scope: ‹ stops at `moneyDateFloor(today) − 366 d` as planned. The brief records "a new account can step back into empty months" as a known limitation for MUT-450 to observe.
History: none

Superseded: R1/D2 by R6/D7, and R2/D3 by R8/D9. Both originals stay above as History.

Approval readiness: PASS. Checked D1 (scope record), R1–R9 (D2–D10, actual answers above; R1 and R2 are superseded by R6 and R8), and C1–C6 (corrections or required proof of approved behaviour, no new choice).

## Reality rows

- REALITY: premise-table pass — MUT-447 merged 5168b7ab (git log); verdict route `server/openapi/openapi.yaml:14401`; local mode allowlists it (`src/hosted/local/index.ts:222`); no `useProfile()` in shell components (`src/hosted/session/me.tsx:53`, grep); unverified=0.
- REALITY: already-done pass no MUT-448 work on base cea1527d; `git log --all --grep=MUT-448` empty; last src/hosted change is 5168b7ab (src/hosted/data/reports.ts:31 import) — — no MUT-448 commits or branches (`git log --all --grep=MUT-448` empty); src/hosted unchanged since 2026-10-26 except the MUT-447 import.
- REALITY: surface-check pass — `release-qa run --attach`, `--only`, `lint` exist (`release-qa --help` lines 27, 38); `GET /v1/summaries/verdict` is in schema.d.ts:7704.
- REALITY: binding-decisions pass src/hosted/shell/destinations.ts:33 (NO_DESTINATION reports, MUT-424 D2), src/hosted/shell/youRoutes.ts:18 (SECTION_SEGMENTS, MUT-426 D8), docs/analytics/events.json:2 (2.2.0, MUT-175 D6) — — honours MUT-424 D2 (Reports is not a destination), MUT-426 D7/D8 (`back` param, `reports` in SECTION_SEGMENTS), MUT-175 D6 (taxonomy bump, now 2.3.0), and MUT-447 D5/D12 (from/to, base timezone; D4 uses the server default).
- REALITY: numbers pass ≈6N+1 reads [measured: .claude/DECISIONS.md:5470 ADR-204 consequences]; 10 s staleTime [estimated: mut-448-glance-plan.md:371 R8/D9]; bound [measured: server/openapi/openapi.yaml:5571].
- REALITY: deferred-asks pass MUT-448 AC list (Jira MUT-448 description) mapped in mut-448-glance-plan.md:69 (Tests section); scope-outs are the ticket's own —  — every ticket AC is mapped (AC1/AC2 verdict.test + QA, AC3 P8 + copy table, AC4 desktop/narrow specs, AC5 CountUp + reduced transparency CSS, AC6 arabic spec, AC7 reports-glance.yaml, AC8 commands). Explore/Lately are out of scope per the ticket.
- REALITY: pr-count pass .gstack/ship-policy.json absent (default one PR per wave) at commit cea1527d — — one branch, one merge (no ship-policy file; the default is one per wave).

## NOT in scope

- Explore tabs and "Lately" (MUT-451): ticket scope-out.
- Phone Glance (MUT-449): its own ticket, same stage.
- Server changes, including a `dataSince` on the verdict (D10 keeps the limitation).
- Motion on the corner-icon press itself (C6): not proposed. MUT-451 can revisit.
- R5 owner-pay rule: measured first by MUT-450.

## What already exists (reused, not rebuilt)

`ReportControls`, `CountUp`, `BreakdownButton` (generalised in place, D1/D6), `periodRange`/`stepPeriod`/`hasPrevious`/`hasNext`, `moneyDateFloor`, `canReadReports`, `billingGateOf`, `LockedScreen`, `backOf`/`BACK_PATH`, `useReplaceSearch` + `pickShellOverlay`, `useReportViewed`, `formatWhole`/`formatPeriod`, `parseAmountToMinor`, the local in-browser server (verdict already allowlisted), and `portalApi.ts`'s stub server. No shared-code extraction beyond D1's in-place generalisation (two callers: HeroFigures and Glance).

## Diagram

```
 corner icon (HostedShell) ──► /reports?back=<page>&period&at
                                   │
              parseGlance ─────────┤ (back validated by BACK_PATH)
                                   ▼
        glanceShellProfile(me, back) ──► HostedShell(profile) ── pill / icon / You island
                                   │
        all reportable locked? ──yes──► LockedScreen (query disabled)          [D7]
                                   │no
              at? ──no──► useVerdict('current') ─► GET /v1/summaries/verdict   [D4]
                 └─yes──► useVerdict(periodRange(period, at)) ─► GET …?from&to
                                   │ 402 → LockedScreen │ error → QueryView retry
                                   ▼
                     glanceOf(verdict, {period, readable})  (pure, verdict.ts)
                                   ▼
        hero(≈ kept / businessNet, usual on Month) · rows · owed · footnote · Explore card
                                   │ row link (readable only)
                                   ▼
                     /p/:id/reports?period&at   (pageMotion forward/back, D5)
```

## Failure modes

| Path | Realistic failure | Handling | Test | User sees |
|---|---|---|---|---|
| verdict GET | 5xx / network | QueryView retry, last verdict kept dimmed | Glance.test | clear error + retry |
| verdict GET | all profiles lapse mid-visit (402) | LockedScreen | Glance.test | subscribe path |
| verdict GET | one profile fails or is locked | `unavailable` row + "Leaves out" | verdict.test | named gap |
| FX down | `rates: null` | "In X only", no date | verdict.test | honest per-currency |
| web before API deploy | 404 on verdict | before-release.md order (C2) | none (process) | retry card: process-guarded, not silent |
| `back` tampered | open redirect | BACK_PATH rejects it → picker fallback | verdict.test (picker) | normal page |
| local mode | route missing from allowlist | already allowlisted (MUT-447) | QA local-mode | ledger |

Critical gaps: 0.

## Worktree parallelization strategy

Sequential implementation, no parallelization opportunity: one module (`src/hosted`), and the popover characterization must land before the refactor and the page.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P2, human: ~2h / CC: ~15min)** — reports/HeroFigures — characterize BreakdownButton (6 cases) before generalising it
  - Surfaced by: Test review — R5/D6
  - Files: src/hosted/components/reports/__tests__/reportsComponents.test.tsx, src/hosted/components/reports/HeroFigures.tsx
  - Verify: `npm run test:run -- src/hosted/components/reports src/hosted/pages/__tests__/Reports.test.tsx`
- [ ] **T2 (P1, human: ~1h / CC: ~10min)** — GlancePage — all-locked from `me` → LockedScreen, query disabled; a late 402 → LockedScreen
  - Surfaced by: Architecture F2 + outside voice OV1 — R6/D7
  - Files: src/hosted/pages/views/GlancePage.tsx, src/hosted/data/verdictQueries.ts
  - Verify: Glance.test locked cases
- [ ] **T3 (P1, human: ~1h / CC: ~10min)** — verdict.ts — `glanceShellProfile` skips locked and unreadable profiles; Explore card only when readable
  - Surfaced by: outside voice OV2 — R7/D8
  - Files: src/hosted/data/verdict.ts, src/hosted/router.tsx
  - Verify: verdict.test picker branches
- [ ] **T4 (P2, human: ~1h / CC: ~10min)** — verdictQueries — `['verdict','current']` default key, refetchOnMount always, staleTime 10 s, dim on isFetching && !isPending; `asOf`-derived links and steps
  - Surfaced by: R2/D3 → R8/D9, R3/D4, C4
  - Files: src/hosted/data/verdictQueries.ts, src/hosted/data/verdict.ts
  - Verify: verdictQueries.test, verdict.test (asOf stepping)
- [ ] **T5 (P2, human: ~30min / CC: ~5min)** — analytics — `layer` property + taxonomy 2.3.0 pinned
  - Surfaced by: Code quality C1
  - Files: src/hosted/analytics/reportViewed.ts, src/hosted/pages/views/ReportsPage.tsx, docs/analytics/events.json, scripts/__tests__/analytics-taxonomy.test.ts
  - Verify: `npm run test:run -- scripts src/hosted/analytics`
- [ ] **T6 (P3, human: ~30min / CC: ~5min)** — pageMotion — `/reports` ↔ `/p/:id/reports` forward/back
  - Surfaced by: Code quality F4 — R4/D5, C6
  - Files: src/hosted/shell/pageMotion.ts, src/hosted/shell/__tests__/pageMotion.test.ts
  - Verify: pageMotion.test
- [ ] **T7 (P2, human: ~15min / CC: ~2min)** — release — API-before-web order in before-release.md and ADR-205
  - Surfaced by: Architecture C2
  - Files: docs/operations/before-release.md, .claude/DECISIONS.md
  - Verify: read-through
- [ ] **T8 (P2, human: ~15min / CC: ~2min)** — Glance search — writes keep `back` + overlay keys
  - Surfaced by: outside voice OV6 — C5
  - Files: src/hosted/router.tsx, src/hosted/data/filters.ts
  - Verify: Glance.test stepping keeps `back`/`?billing=`
_No new tasks from Performance review._

## Unresolved decisions

None.

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, D1)
- Reality rows: 7/7 applicable rows emitted, 0 unverified premises
- Architecture Review: 2 issues found (F2 all-locked 402, C2 release order)
- Code Quality Review: 2 issues found (C1 analytics contract, F4 motion)
- Test Review: diagram produced, 1 gap identified (T1 popover regression contract)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Codex not installed; native Claude Plan subagent completed in 3 min, 8 findings (OV1, OV2, OV4, OV8 → D7–D10; OV3, OV5, OV6, OV7 → corrections C3–C6)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 1/5 (D2–D6 were scored; only D6 picked a 10/10 option; D7–D10 differ in kind and were not scored)

## Suppressed findings

None below confidence 5.

# Design review (plan-design-review, 2026-10-26)

Target: this plan. Visual reference: the approved `reports-rethink-screens-20261026.html` (G2 + desktop). No new mockups: the gstack designer has no OpenAI key on this machine. Outside voice: a native Claude design subagent (Codex not installed), 10 findings, all folded into the questions below.

## Design decisions (Basel's answers; they override the matching P-rows above)

| # | Decision |
|---|---|
| DD1 (D3) | **Usual only on finished months.** When the period contains `asOf`, the usual line is hidden; finished months show ▲/▼/about. Amends P9. verdict.test: "Month at current → usual hidden". |
| DD2 (D4) | **Reading order:** h1 "Reports" (PageHeader) → period controls → hero label → hero figure → ONE sub-line (usual on finished months, else the "so far"/period caption) → "Leaves out {names}" note when partial → rows → owed → footnote. "In {currency} only" replaces the figure and never adds a line. |
| DD3 (D5) | **Owed row is a plain summary, not a link.** ≈ converted (same popover rule as DD8) or the single currency; "· N overdue" with a `--m-butter` dot only when overdueCount > 0; owed 0 → a muted "Nothing owed to you" row that stays. |
| DD4 (D6) | **First run:** when every profile's 12-month history, the period and owed are all zero, Glance shows today's FirstRun block (exported from ReportsPage so both pages share it) for the shell profile, honouring its write gate. Glance.test + a QA step. |
| DD5 (D7) | **Skeleton:** hero bar (`.hp-report-skeleton-hero`), then min(profiles, 5) row bars at 44px (a new row modifier), then an owed bar; aria-busy + the existing loading label. |
| DD6 (D8) | **Refresh failure with data shown:** the ledger stays (undimmed), and a muted "Couldn't refresh · Retry" line sits under the controls (aria-live polite). The QueryView error card shows only when nothing is shown yet. |
| DD7 (D9) | **One centred column at every width until MUT-451** (max-inline-size 560px), with a one-line hint under the ledger: "Open a profile for its charts". **Replaces P15 and drops the Explore card** (eng D8's card rule is moot; the picker stays). MUT-451 introduces the two-column grid. The ticket's desktop line changes: note it on MUT-448. |
| DD8 (D11) | **≈ only when converted.** Converted total → "≈ kept" + the `.hp-report-approx` button and panel; single currency → plain "Kept" / «تبقّى لك», no button. Panel max-inline-size `min(320px, 100vw − 32px)`. The same rule applies to the owed row and the rows. |
| DD9 (D10) | **Row anatomy:** name (+ "shared" pill) · kind label · primary figure at the inline end (`--m-font-num`, tabular; business = signed net with − in `--m-rose-ink`; personal = unsigned spent) · optional muted end-aligned second line (`--text-label`: "came in ₪X", or the extra unconverted currencies, each in its own `<bdi>`) · chevron centred on the row; min-height 44px. |
| DD10 (D12) | **Tokens:** hero `--m-font-num` / `--text-figure-fluid`, tabular, −0.03em; labels `--text-label` + `--muted`; ▲ `--m-mint-ink`, ▼/negative `--m-rose-ink`, overdue dot `--m-butter`; ledger = one grouped list on `--surface`, `--m-radius-lg`, 1px `--m-line` hairlines, no shadow and no glass; rows 44px, padding-block `--space-2`, `.press`; "shared" = a `--m-radius-pill` pill on `--m-lavender` / `--m-lavender-ink`; column 560px. |
| DD11 (D13) | **A11y/RTL:** a `<ul>`/`<li>` ledger; a readable row is one whole-row `<a>` whose accessible name reads like a sentence ("Nal Software, net +₪9,040", "…, shared"); the chevron is the glyph › (bidi-mirrored, aria-hidden); tab order controls → hero button → rows → actions; ▲/▼ carry words; CountUp morphs from the shown value and paints once under reduced motion. Glance.test asserts names, roles and `dir`. |

QA catalogue changes: `desktop-layout` now asserts the single centred column + hint at ≥1000px. Add `first-run` (DD4) and `owed-zero` (DD3) steps to `reports-glance.yaml`.

## Hierarchy (DD2, DD7)

```
 [floating chrome: Reports icon (lit) · pill · You island]
 ┌──────────── max 560px, centred ────────────┐
 │ Reports                                (h1)│
 │ [W | M | Y]                     ‹   ›      │
 │ ≈ kept / Kept / Business net        (label)│
 │ ₪3,840                       (one figure)  │
 │ ▲ ₪600 above your usual  |  October so far │  ← one sub-line
 │ Leaves out Sader Law (locked)  (if partial)│
 │ ┌────────────────────────────────────────┐ │
 │ │ Nal Software  net        +₪9,040     › │ │
 │ │ elMokhtbr [shared] net   +₪1,850     › │ │
 │ │ Barmajiyat    net        −₪3,100     › │ │
 │ │ Personal      spent       ₪6,350     › │ │
 │ │               came in ₪500             │ │
 │ └────────────────────────────────────────┘ │
 │ Still owed to you  ● 2 overdue    ₪11,500 │
 │ Includes shared businesses in full · ECB …│
 │ Open a profile for its charts              │
 └────────────────────────────────────────────┘
```

## Interaction states

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Page | ledger skeleton (DD5) | FirstRun block (DD4) | no data: QueryView card; data shown: "Couldn't refresh · Retry" (DD6); all locked: LockedScreen (D7) | ledger | "Leaves out {names}" under the hero |
| Hero | skeleton bar; refetch dims (isFetching) | — | — | ≈ only when converted (DD8) | rates null → "In X only" replaces the figure |
| Row | — | "Nothing this {period}", still a link | unavailable → non-link row, "Locked: billing" / "Couldn't load" | DD9 anatomy | converted null → stacked currencies on the second line |
| Owed | owed bar | "Nothing owed to you" (muted) | — | total + overdue dot | mixed currencies → ≈ + popover |
| Usual | — | hidden (in-progress month, Week, Year, null) | — | ▲/▼/about with words | hidden when partial |

## Journey storyboard

| Step | User does | User feels | Plan specifies |
|---|---|---|---|
| 1 | Taps the Reports icon | curious: "how am I doing?" | skeleton in the final shape (DD5) |
| 2 | Reads the hero | answered in 5 s | one figure, honest ≈ (DD8), no false alarm (DD1) |
| 3 | Scans the rows | "which part pays?" | signed nets, kind labels, shared pill (DD9) |
| 4 | Taps a row | wants detail | slides forward to the profile's report (D5) |
| 5 | Steps back a month | compares | usual ▲/▼ on finished months (DD1) |
| 6 | Comes back next week | habit | refetch on visit (D9), quiet retry on blips (DD6) |
| 0 | First visit, no data | unsure | FirstRun with actions (DD4) |

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | no DESIGN.md (brand v2 docs + --m-* tokens); UI scope: /reports page |
  | Step 0               | 6/10; all 7 passes                          |
  | Pass 1  (Info Arch)  | 6/10 → 9/10 after fixes                     |
  | Pass 2  (States)     | 5/10 → 9/10 after fixes                     |
  | Pass 3  (Journey)    | 7/10 → 9/10 after fixes                     |
  | Pass 4  (AI Slop)    | 6/10 → 9/10 after fixes                     |
  | Pass 5  (Design Sys) | 4/10 → 8/10 after fixes                     |
  | Pass 6  (Responsive) | 6/10 → 9/10 after fixes                     |
  | Pass 7  (Decisions)  | 0 open, 0 deferred                          |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (3 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 0 generated (designer has no API key); approved HTML screens used |
  | Decisions made       | 11 added to plan                            |
  | Decisions deferred   | 0                                           |
  | Overall design score | 4/10 → 8/10                                 |
  +====================================================================+
```

NOT in scope (design): the two-column desktop grid and Explore content (MUT-451); new mockups (the designer is unavailable; the approved HTML screens stand); a DESIGN.md (brand v2 docs cover it).
What already exists: ReportControls, CountUp, the BreakdownButton/.hp-report-approx popover, the .hp-report-skeleton* classes, FirstRun, LockedScreen, the YouRows › chevron pattern, .press, PageHeader, the `--m-*` tokens.

### Design Implementation Tasks

- [ ] **DT1 (P1, human: ~30m / CC: ~5m)** — verdict.ts — hide usual when the period contains asOf (DD1). Verify: verdict.test.
- [ ] **DT2 (P2, human: ~2h / CC: ~15m)** — GlancePage — DD2 order, DD7 single column + hint, DD9 row anatomy, DD10 tokens in hosted.css. Verify: Glance.test + QA `desktop-layout`.
- [ ] **DT3 (P2, human: ~1h / CC: ~10m)** — GlancePage — owed row (DD3), FirstRun reuse (DD4), skeleton (DD5), stale-error notice (DD6). Verify: Glance.test + QA `first-run`/`owed-zero`.
- [ ] **DT4 (P2, human: ~45m / CC: ~5m)** — hero — ≈ only when converted + panel cap (DD8). Verify: Glance.test.
- [ ] **DT5 (P2, human: ~45m / CC: ~5m)** — a11y/RTL — DD11. Verify: Glance.test (names/roles/dir) + QA `arabic`.
- [ ] **DT6 (P2, human: ~10m / CC: ~2m)** — Jira — comment on MUT-448 that DD7 replaces the ticket's desktop Explore-area line until MUT-451.

### Unresolved Decisions (design)

None.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Claude subagents (Codex not installed) | Independent 2nd opinion | 2 | unavailable (native fallback completed: eng + design) | eng 8 findings → D7–D10 + C3–C6; design 10 findings → DD1–DD11 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (all decided, 0 unresolved) | 5 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 4/10 → 8/10, 11 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** Codex unavailable in both phases (CLI not installed). The native Claude Plan subagents completed for the eng plan review (8 findings) and the design phase (10 findings). This is not external coverage.
- **VERDICT:** DESIGN CLEARED. Eng review is ISSUES OPEN by status: every finding is decided and mapped to tasks, but the review isn't logged clean, so the eng review is still required by the dashboard rule.

NO UNRESOLVED DECISIONS

## Copy table (APPROVED by Basel, 2026-10-26, as drafted)

Keys live under `hosted.reports.glance.*`; "reuse" rows are existing keys.

| Key | English | Arabic |
|---|---|---|
| (reuse) `hosted.reports.title` | Reports | التقارير |
| `label.kept` | Kept | تبقّى لك |
| `label.keptApprox` | ≈ Kept | ≈ تبقّى لك |
| `label.businessNet` | Business net | صافي الأعمال |
| `label.businessNetApprox` | ≈ Business net | ≈ صافي الأعمال |
| `usual.above` | {amount} above your usual | أعلى من معدّلك بـ{amount} |
| `usual.below` | {amount} below your usual | أقل من معدّلك بـ{amount} |
| `usual.about` | About your usual | قريب من معدّلك |
| (reuse) `hero.soFar` | {period} · so far | {period} · حتى الآن |
| (reuse) `hero.keptNegative` | Spent more than came in | أنفقت أكثر مما دخل |
| `inOnly` | In {currency} only | بـ{currency} فقط |
| `leavesOut` | Leaves out {names} | لا يشمل {names} |
| `row.net` | net | صافي |
| `row.spent` | spent | مصروف |
| `row.incomeOnly` | income only | دخل فقط |
| `row.cameIn` | came in {amount} | دخل {amount} |
| `row.shared` | shared | مشترك |
| `row.nothing` | Nothing recorded | لا شيء مسجّل |
| `row.locked` | Locked · billing | مقفل · الاشتراك |
| `row.failed` | Couldn't load | تعذّر التحميل |
| `row.linkName` | {name}, {kind} {amount} | {name}، {kind} {amount} |
| `row.linkNameShared` | {name}, shared, {kind} {amount} | {name}، مشترك، {kind} {amount} |
| `owed.label` | Still owed to you | ما زال مستحقًا لك |
| `owed.none` | Nothing owed to you | لا شيء مستحق لك |
| `owed.overdue` (plural) | one: 1 overdue · other: {count} overdue | one: دفعة متأخرة · two: دفعتان متأخرتان · few: {count} دفعات متأخرة · many/other: {count} دفعة متأخرة |
| `footnote.shared` | Includes shared businesses in full | يشمل الأعمال المشتركة كاملة |
| (reuse) `hero.rateFooter` | ECB · {date} · today's rate | البنك المركزي الأوروبي · {date} · سعر اليوم |
| `footnote.omitted` | Leaves out records in {currencies} | لا يشمل السجلات بـ{currencies} |
| `hint` | Open a profile for its charts | افتح ملفًا لترى رسومه |
| `refreshFailed` | Couldn't refresh | تعذّر التحديث |
| (reuse) `combined.retry` | Retry | إعادة المحاولة |
| (reuse) `hero.breakdownTitle` | Exact amounts | المبالغ الدقيقة |
| (reuse) `loading` | Loading reports | جارٍ تحميل التقارير |
| (reuse) `firstRun.*` | Your reports start with your first payment or expense … | تبدأ تقاريرك مع أول دفعة أو مصروف … |

Notes: ▲/▼ are prepended in the UI, not in the strings (screen readers get the words). Amounts are `<bdi>`, with − (U+2212) for negatives. Copy choices to confirm: (1) Arabic "kept": Glance uses «تبقّى لك» (screens, OQ5); the per-profile page keeps «المتبقي». (2) A business with no expenses reads "income only" / «دخل فقط», not "earned" / «ربح», because ربح means profit, the reading R3-5 warns about.
