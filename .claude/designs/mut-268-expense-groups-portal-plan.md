# MUT-268 — Portal: create a trip group, prune its expenses, see daily and category spend

Epic MUT-266. Blocked by MUT-267 (API; plan at mut-267-plan.md, eng-reviewed 2026-10-18). Hosted portal only (`src/hosted/**`).

## Requirements (from the ticket, as filed)
- A "Groups" view in the portal's Expenses area.
- Create / edit in a drawer (name, start, optional end), drawer-first.
- Group detail: KPI row per currency (+ converted total when available); day-by-day bar chart and list; by-category breakdown; member list with an exclude toggle; an "Excluded" section with reset; "Add expense from outside the range".
- From an expense's own drawer, an "In groups" line linking to its groups.
- Empty, loading and error states. Arabic default, RTL charts and lists, works at 375 width. Release-QA feature + passing portal spec.

## Carried decisions
- Converted total: client-side at today's ECB rate via `GET /v1/fx-rates`, labelled with rate and date (MUT-267 D1; per-day rates are MUT-273).
- Range cap 366 days, open-ended groups allowed, any keep/leave-out mark (MUT-267 D2, D3).
- One profile per group.

## Existing portal patterns to reuse
- `PageHeader`, `FilterBar`, `HostedTable`, `QueryView` (+ `Empty`, `NoMatch`), `ShowMore`, `SavedNotice`, `Drawer`, `DecimalAmount`, `formatDay`, `hp-strip` + `Stat`, `SegmentedTabs` for currency, `hp-asof` caption (OverviewPage).
- URL-driven drawers (`?newExpense=1`, `?expense=<id>`), section nav in `HostedShell` SECTIONS.

## Design gaps (pending review)
Recorded by /plan-design-review; nothing below is approved until its decision is answered.

Wireframe: `.claude/designs/mut-268-expense-groups-wireframe.html` (Brand v2 tokens; Dark and RTL toggles).

## Approved design decisions
- **1A Navigation and routes (D3):** Groups is a tab inside Expenses (tab strip "Expenses · Groups" under the Expenses heading; sidebar stays at 7, Expenses stays lit). Routes `/p/:id/expenses/groups` and `/p/:id/expenses/groups/:groupId`; drawers by URL `?newGroup=1`, `?editGroup=1`, `?addToGroup=1`; detail keeps `?currency=` in the URL.
- **2A Headline (D4):** detail opens with a headline row of every currency's total and count, then "≈ <profile default currency> total at today's ECB rate (<rateDate>)". The currency tab (hidden when the group has one currency) scopes only the day chart, the per-day figure and the categories.
- **3A List rows (D5):** each row shows name, status chip (Ongoing / Upcoming / Past), dates, day count, and up to two currency totals then "+N". **API:** `GET /v1/expense-groups` items gain `currencies: [{ currency, total, count }]` and `memberCount`, computed server-side (no per-row summary calls).
- **4A Member order (D6):** members grouped by day, oldest day first; kept out-of-range days sit in date position, labelled "before the trip" / "after the trip". **API implication:** the ledger is newest-first only, so the member list must be loadable oldest-first (see API changes).
- **5A Default currency tab (D7):** the currency with the most members (ties: profile default, then alphabetical); `?currency=` overrides and persists.

Pass 1 Information architecture: 4/10 → 9/10 (hierarchy, nav, routes, list rows, order and default tab decided; remaining point: the IA diagram below must be kept in sync with Pass 3's add-to-group entry point).

```
Expenses (sidebar, lit)
├─ [Expenses] tab ─ ledger (unchanged) ─ row → ExpenseDrawer ─ "In groups" line → group
└─ [Groups] tab  /expenses/groups
   ├─ list: name · status · dates · days · totals (+N)        [New group] → ?newGroup
   └─ detail /expenses/groups/:groupId
      1 headline: JOD 412.500 (17) · USD 230.00 (5) · ≈ USD 1,240 at today's rate
      2 [JOD|USD|ILS] tab → per-day figure · day chart · categories
      3 members by day, oldest first  [Leave out] / [Remove keep]
      4 Left out (n)  [Bring back]
      [Edit] → ?editGroup   [Add from outside these dates] → ?addToGroup
```
- **6A Chart reconciles with the headline (D8):** every member gets a bar. **API:** MUT-267 `byDay` adds a sparse bucket for *every* member dated outside the series (kept pre-trip days and future-dated members of an open group), each with `position: 'before' | 'after'`; the UI draws them past a gap marker ("before the trip" / "upcoming"). Bars always sum to the headline per currency.
- **7A Per day (D9):** in-range spend in the selected currency ÷ elapsed in-range days (start → min(today, end)); hidden before day 1; tooltip "Excludes expenses kept from outside the dates".
- **8A State table (D10):**

  | Surface | Loading | Empty | Error | Success | Partial |
  |---|---|---|---|---|---|
  | Groups list | 3 skeleton rows | "Group a trip's spending" + New group | QueryView card + Retry | new group appears, toast | totals missing → rows without money |
  | Detail | skeleton headline, chart, rows | past/ongoing with 0 members: "Nothing dated in these days yet" + Add from outside; upcoming: "<name> starts <date>" + Add from outside; all left out: "Everything here is left out" + Left out open | QueryView card + Retry; 404 "This group was deleted" + back to Groups | — | FX loading hides ≈; FX 503 hides ≈; FX stale shows "rate from <date>" |
  | Left out section | with members | hidden when 0 | inline retry | Bring back toast | — |
  | Add-from-outside picker | skeleton list | "Nothing in the 30 days before" | inline retry | "Added N" toast | "Added 2 of 3 · Retry 1" |
  | "In groups" line (ExpenseDrawer) | omitted | omitted | omitted | — | — |
  | Create / edit / delete | button busy | — | inline field errors (422), 409 reload notice | create opens the group; save toast; delete → list + toast | — |

  After any change (create, edit, delete, leave out, keep, bring back, add): refetch summary, members, left out, group list and the "in groups" query.
- **9A Edit and delete (D11):** `?editGroup=1` opens the create form prefilled with the hint "Changing dates re-checks which expenses belong; kept and left-out choices stay." "Delete group" at the bottom → confirm "Delete <name>? Its <n> expenses stay in Expenses." → Groups list + toast. 409 stale → reload notice as in ExpenseDrawer.
- **10A Year cap guidance (D12):** date pickers cap the end at start + 365 days with an inline hint naming the last allowed day; open groups older than 11 months show "Still going? Add an end date" on the list. MUT-267 D2 unchanged. *Amended by the MUT-267 eng re-review (R6):* open groups stop collecting a year after their start; past that point the list and detail say "This group reached a year — new expenses no longer join".

Pass 2 Interaction states: 3/10 → 9/10 (every surface has a state row; remaining point: Arabic copy for each state is written during the build).
- **11A Add from the expense (D13):** ExpenseDrawer's "In groups" line gains "Add to group…" (menu of the profile's groups not containing the expense → PUT included) and a per-group "Remove" (verb per the action table in Pass 7).
- **12A Picker (D14):** pool = 30 days before the start, plus 30 days after the end for a closed group (segmented control), minus current members, via the existing ledger `from/to` filter; multi-select; sequential PUT included; partial result "Added 2 of 3 · Retry 1". No batch API.
- **13A Bulk by category (D15):** category rows are buttons that filter the member list (`?category=`); the filtered view offers "Leave out all <n> <category>" with one Undo toast; sequential PUT excluded; partial "Left out 4 of 5 · Retry". (Note: a year-long group can make this ~30 sequential requests; acceptable for v1, revisit a batch endpoint if it feels slow.)
- **14A Create drawer (D16):** Start defaults to today; End required unless "Still going" is ticked (unticked by default); auto-join hint; after Create → the group page + toast.

Journey storyboard (accepted requirements):

| Step | User does | User feels | Plan specifies |
|---|---|---|---|
| 1 | Opens Expenses › Groups | "Where did my trips go?" | list with status, dates, totals (3A) |
| 2 | New group: "Jordan trip", 3–7 Oct | quick, no thinking | 14A defaults, auto-join hint |
| 3 | Lands on the group | relief: it's already filled | headline totals + ≈ converted (2A), chart (6A) |
| 4 | Sees rent in there | mild annoyance | category filter + leave out all (13A), Undo |
| 5 | Remembers the flight from September | "can I add it?" | picker 30 days before (12A) or from the expense (11A) |
| 6 | Reads per day / categories | understanding | 7A per day, categories scoped by tab (5A) |
| 7 | Months later, compares trips | reflective | list totals (3A) |

Pass 3 User journey: 4/10 → 9/10 (main add path, bulk prune and create defaults decided; remaining point: the 5-year reflective view across many trips is out of scope).
- **15A Bar style (D17):** in-range bars `--m-primary`; out-of-range bars `--m-lavender` (value labels `--m-lavender-ink`), set apart by a "⋯" gap with a micro-label "before the trip" / "upcoming"; zero days a 2px line in `--m-line`. No hatching.
- **16A Plain sections (D18):** day chart and categories are headed sections in a 3fr/2fr grid (gap `--space-6`, hairline `--m-line` between on desktop), no bordered panels; only the member table keeps HostedTable's frame.

Pass 4 AI slop: 7/10 → 9/10. Classifier OPERATE. Hard rejections: none. Litmus: brand ✅, anchor ✅ (headline), scannable ✅, one job ✅, cards ✅ after 16A, motion ✅ (bar height ease only, reduced-motion respected), no decorative shadows ✅. Remaining point: Arabic numerals/figures style in charts verified in build.
- **17A SectionTabs (D19):** new `src/hosted/components/SectionTabs.tsx`: a `<nav>` of router Links, `aria-current="page"`, 2px underline `--m-primary-hover`, label `--text-label` weight 500; registered in COMPONENT_REGISTRY with a test.
- **18A Hand-built charts (D20):** `src/hosted/components/groups/DayBars.tsx` and `CategoryBars.tsx`, CSS in `hosted.css` with `--m-*` tokens and the spacing scale (ADR-089 literal guard applies); no new dependency; both registered.

Pass 5 Design system: 6/10 → 9/10 (new components named, tokenized and registered; no DESIGN.md: the Brand v2 kit `docs/brand/README.md` + `src/styles/brand/mutaba3a-theme.css` remain the reference, /design-consultation not needed).
- **19A Long groups (D21):** series ≤ 31 days → daily bars; longer → ISO-week bars summed client-side from `byDay` (week start per locale); at 375px daily bars keep a 6px minimum width, else switch to weekly above 21 days.
- **20A Chart accessibility (D22):** `role="group"` with an aria-label; bars are buttons (roving tabindex, ←/→ mirrored in RTL, Home/End), each labelled "<weekday day month>, <amount>, <n> expenses"; Enter scrolls the member list to that day and focuses its header; days with spend only in another currency show a dot and "+ <currency> spent"; focus ring `--m-focus`.
- **21A Phone layout (D23):** below 760px the headline currencies wrap one per line with ≈ below, the currency tab sits under them, chart then categories stack, the member table drops the Category column (shown under the title), Leave out keeps a 44px target, Edit and Add move into a header "⋯" menu; no horizontal page scroll.

Pass 6 Responsive & accessibility: 4/10 → 9/10 (long ranges, chart keyboard/SR, phone layout specified; remaining point: Arabic screen-reader wording verified in build).
- **22A Left out (D24):** "Left out" lists only excluded expenses dated inside the group range; Bring back = DELETE. **API:** `groupMembership=excluded` and `excludedCount` return only in-range excluded expenses.
- **23A No category (D25):** one "Uncategorized" (ar "بدون تصنيف") bucket, always last, `--muted` fill, clickable filter like other rows.

Pass 7 corrections (follow from approved behaviour, no question):
- Action → request table (in-range computed client-side from `occurredOn` and the group range):

  | UI action | Expense state | Request |
  |---|---|---|
  | Leave out | in range, no mark | PUT excluded |
  | Leave out / Remove | kept (included), out of range | DELETE |
  | Leave out | kept (included), in range | PUT excluded |
  | Bring back | excluded, in range (22A: only these are listed) | DELETE |
  | Add (picker, expense drawer) | not a member | PUT included |
  | Undo | any | restore the exact prior mark (PUT prior mode, or DELETE if none) |
- Counts: the headline shows a count per currency (2A), so list "23 expenses" and per-currency counts no longer conflict.
- Member loading: the detail page loads every member page (bounded by the 366-day cap) and orders oldest-first client-side; day-header subtotals come from `summary.byDay`, not from summing loaded rows. Bar jump (20A) therefore always finds its day.

Pass 7: 2 resolved by decision (22A, 23A), 3 settled as corrections, 0 deferred.

## API changes for MUT-267 (fed back to mut-267-plan.md)
1. **3A** `GET /v1/expense-groups` items gain `currencies: [{ currency, total, count }]` and `memberCount`.
2. **6A** summary `byDay`: a sparse bucket for every member dated outside the series, with `position: 'before' | 'after'` (replaces plan D8's "included only" sparse rule and its `inRange` flag).
3. **22A** `groupMembership=excluded` and `excludedCount`: in-range excluded expenses only.
No other API change: picker pool, member exclusion from the pool, per-day figure, weekly bars and other-currency markers are all derived client-side; one save per pick (12A) and per bulk leave-out (13A); converted line uses `GET /v1/fx-rates?base=<profile default>`.

## NOT in scope
- Batch override endpoint (12A chose one save per pick; revisit if 13A feels slow).
- Per-day FX conversion (MUT-273).
- A "Category removed" bucket (23A).
- Cross-trip comparison view beyond list totals.
- Phone (MUT-269) and local web.
- Create-drawer preview count of expenses already in the dates (nice-to-have; needs a count call).

## What already exists
- Reused: `PageHeader`, `HostedTable`, `QueryView`/`Empty`, `ShowMore` (paging loop), `Drawer`, `ExpenseDrawer` (gains the In groups line), `DecimalAmount`, `formatDay`, `hp-strip`/`Stat` styles, `SegmentedTabs` (currency only), `Toast.tsx`, URL-drawer pattern, `hp-asof` caption style.
- New (registered): `SectionTabs`, `DayBars`, `CategoryBars`.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.
- [ ] **T1 (P1, human: ~2h / CC: ~10min)** — MUT-267 API — list totals, sparse buckets for every out-of-series member, in-range-only excluded
  - Surfaced by: 3A, 6A, 22A
  - Files: server/src/routes/expense-groups.ts, server/src/expenses/summary.ts, server/src/repositories/*
  - Verify: npm --prefix server test; openapi:check
- [ ] **T2 (P1, human: ~1d / CC: ~30min)** — portal — Groups tab, list, routes and drawers (create/edit/delete)
  - Surfaced by: 1A, 3A, 9A, 10A, 14A, 17A
  - Files: src/hosted/router.tsx, src/hosted/pages/views/ExpenseGroups*.tsx, src/hosted/components/SectionTabs.tsx, src/hosted/components/groups/*
  - Verify: npm run test:run; release-QA portal spec
- [ ] **T3 (P1, human: ~1.5d / CC: ~45min)** — portal — group detail: headline, ≈ converted, currency tab, DayBars, CategoryBars, members, left out
  - Surfaced by: 2A, 4A, 5A, 6A, 7A, 15A, 16A, 19A, 20A, 21A, 22A, 23A
  - Files: src/hosted/pages/views/ExpenseGroupDetail.tsx, src/hosted/components/groups/DayBars.tsx, CategoryBars.tsx, src/hosted/hosted.css
  - Verify: unit tests for per-day, weekly bucketing, action table; axe; release-QA at 375 + RTL
- [ ] **T4 (P1, human: ~4h / CC: ~15min)** — portal — add-from-outside picker, category filter + leave out all, Undo, partial results
  - Surfaced by: 12A, 13A, action table
  - Files: src/hosted/components/groups/AddToGroupDrawer.tsx, ExpenseGroupDetail.tsx
  - Verify: unit tests for sequential saves and partial failure; release-QA
- [ ] **T5 (P1, human: ~2h / CC: ~10min)** — portal — ExpenseDrawer "In groups" line with Add to group… and Remove
  - Surfaced by: 11A, 8A (omitted while loading/error)
  - Files: src/hosted/components/ExpenseDrawer.tsx
  - Verify: unit + release-QA
- [ ] **T6 (P2, human: ~2h / CC: ~10min)** — portal — state table and refetch set
  - Surfaced by: 8A
  - Files: the views above, src/hosted/data/expenseGroupQueries.ts
  - Verify: unit tests per state; QA scenarios

## Unresolved Decisions
None.

## Completion summary
```
+====================================================================+
|         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
+====================================================================+
| System Audit         | no DESIGN.md (Brand v2 kit used); UI scope: portal Groups + ExpenseDrawer line |
| Step 0               | 3/10, all 7 dimensions (D1)                 |
| Pass 1  (Info Arch)  | 4/10 → 9/10 after fixes                     |
| Pass 2  (States)     | 3/10 → 9/10 after fixes                     |
| Pass 3  (Journey)    | 4/10 → 9/10 after fixes                     |
| Pass 4  (AI Slop)    | 7/10 → 9/10 after fixes                     |
| Pass 5  (Design Sys) | 6/10 → 9/10 after fixes                     |
| Pass 6  (Responsive) | 4/10 → 9/10 after fixes                     |
| Pass 7  (Decisions)  | 2 resolved, 0 deferred (+3 corrections)     |
+--------------------------------------------------------------------+
| NOT in scope         | written (6 items)                           |
| What already exists  | written                                     |
| TODOS.md updates     | 0 items proposed                            |
| Approved Mockups     | 0 generated (HTML wireframe instead, per Basel's preference) |
| Decisions made       | 23 added to plan                            |
| Decisions deferred   | 0                                           |
| Overall design score | 3/10 → 9/10                                 |
+====================================================================+
```
Outside voice: Claude subagent (in-host), 21 findings, all folded into Passes 1–7; Codex unavailable (not installed).

## Apple-design pass (craft spec, 2026-10-18)
Refines the approved decisions; changes none of them and needs no API change. Reuses the MUT-74 motion kit: `UI_SPRING` (response 0.3, damping 1.0), `REDUCED_MOTION_FADE_SECONDS`, `captureRowExit` (MUT-82), `DrawerFrame`, `--press-scale`/`--duration-press`, `row-flash`.

1. **Leave out / Remove / Bring back are optimistic (Response).** Pointer-down shows the press (`--press-scale`, `--duration-press`); release commits. In the same frame: the row leaves via `captureRowExit` (slides toward the inline end, followers glide up on `UI_SPRING`), it appears at the top of "Left out", and the headline, per-day figure, the day's bar and its category bar update from local data (amount, date, category, currency are all on the row). The summary refetch then reconciles silently. No counting-up numbers.
2. **Undo retraces the path (Spatial consistency, Agency).** Undo brings the row back from the inline end into its slot on the same spring; the toast stays until the next action or 6 s. A failed request does the same retrace plus an error toast "Couldn't leave out. Try again" (Retry). Bulk "Leave out all" exits rows together with `--stagger-step` (50 ms), at most 8 staggered, the rest at once, with one Undo.
3. **Charts morph from where they are (Interruptibility).** Bar heights are `transform: scaleY()` with `transform-origin: bottom`, animated with `UI_SPRING` from the presentation value, so rapid leave-outs or tab switches retarget mid-flight without jumps. Category bars use `scaleX()` from the inline start. No entrance animation on first load; content never waits on motion. (The wireframe's CSS `transition: height` is a sketch; build uses the spring.)
4. **Bar → day jump (Wayfinding).** The bar highlights on pointer-down; on release the list scrolls to that day (`scrollIntoView({ behavior: 'smooth', block: 'start' })`, instant under reduced motion), the day header gets the existing `row-flash`, and focus moves to it (`tabindex="-1"`). The bar stays outlined while its day is in view. A second click mid-scroll simply retargets.
5. **Hover and focus show the value immediately.** A tooltip above the bar ("Sun 5 Oct · JOD 96.000 · 2 expenses"), no delay, also on keyboard focus, flipping inward at the chart edges (mirrored in RTL). Touch: the tap selects and jumps, no hover state.
6. **Popovers grow from their trigger (Spatial consistency).** The "Add to group…" menu and the header "⋯" menu scale 0.96 → 1 with opacity on `UI_SPRING`, `transform-origin` at the trigger (logical start/end so RTL mirrors). Drawers keep `DrawerFrame` (enter from the inline end, exit the same way, drag to dismiss with velocity). Create → group page: the drawer exits on its path; the page itself does not animate in.
7. **Numerals don't jitter (Craft).** Every amount (headline, per day, members, day subtotals, chart labels, list totals) uses the mono face with `font-variant-numeric: tabular-nums` (as `.hp-amount`) and `isolateAmount()` from `src/lib/utils.ts` for RTL; digits follow `DecimalAmount`. Headline currencies at `--text-headline`, weight 500, `letter-spacing: -0.01em`, `line-height: 1.1`; chart axis labels `--text-micro` with `letter-spacing: 0.01em`.
8. **Reduced motion is a gentler equivalent, not nothing.** Row exits and returns cross-fade (`captureRowExit` already does); bars and category widths swap values with a 150 ms opacity dip; scrolling is instant; popovers fade only. The `theme.css` tokens already zero the press and toggle durations.
9. **RTL.** Flex rows mirror the chart (time runs right to left); row exit and Undo use the logical inline end; arrow keys mirror (20A); gap labels sit on the logical before/after sides; tooltips and popover origins use logical properties.

Not adopted: a sticky translucent group header while scrolling the members (adds chrome; the crumb and headline already answer "where am I"); sound or haptics (web portal, no meaningful moment beyond the toast).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | Claude subagent via `/plan-design-review` (codex unavailable) | Independent 2nd opinion | 1 | unavailable (codex); in-host subagent completed | 21 findings, all folded into passes |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 36 | issues_open (MUT-267 plan, all mapped to tasks) | 3 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 9 | clean | score: 3/10 → 9/10, 23 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** design phase — codex not installed (unavailable); Claude subagent (in-host) completed with 21 findings; in-host does not count as outside coverage.
- **VERDICT:** DESIGN CLEARED for MUT-268 (all passes 9/10, 0 unresolved). Eng review required: the MUT-267 eng review predates the three API changes from this review (3A, 6A, 22A) and must absorb them.

NO UNRESOLVED DECISIONS
