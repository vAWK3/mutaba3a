# MUT-268 — Engineering plan (eng-ticket, 2026-10-18)

Companion to `mut-268-expense-groups-portal-plan.md` (the 23 approved design decisions 1A–23A, state table 8A, action→request table, Apple-design craft spec, tasks T1–T6) and the wireframe `mut-268-expense-groups-wireframe.html`. This file adds where the code goes, the engineering calls the design left open, the tests, and the release-QA mapping. It changes no design decision.

Tracker: Jira · barmajiyat · MUT via `mcp__atlassian-barmajiyat__*` · Backlog/Planned = not started · this skill may set In Progress (21) · qa-reconcile sets In Review (3) · Done is Basel's.

## Neighbourhood
- Epic MUT-266. Blocker **MUT-267 is merged to local main 48ef135b** (Jira In Review, ADR-094, API 1.33.0-mut267): gate passes. `src/hosted/api/schema.d.ts` on main already carries every group route, `?groupId`/`groupMembership` and `/v1/fx-rates`.
- Siblings: MUT-269 (Flutter, separate repo) and MUT-273 (per-day FX, out of scope). MUT-179 (`tp()` plurals) is not built, so counts follow a colon or a number-first phrase, as MUT-183 did.
- API notes carried in: TD-163 (a 422 GROUP_LIMIT is replayed by idempotency, so the create drawer mints a fresh key per submit attempt); open groups stop collecting at `windowEnd` (R6); `includedCount` is gone (R7).

## Where the code goes (all under `src/hosted/**` unless named)
| Layer | File | New/touch | What |
|---|---|---|---|
| API | `api/client.ts` | touch | `request()` gains `PUT`; types `ExpenseGroup`, `ExpenseGroupDetail`, `ExpenseGroupSummary`, `FxRatesResponse`; ops `expenseGroups(query)`, `expenseGroup`, `createExpenseGroup(body, key)`, `updateExpenseGroup(id, body, version)`, `deleteExpenseGroup`, `setExpenseGroupMark(groupId, expenseId, mode)` (PUT), `clearExpenseGroupMark` (DELETE), `expenseGroupSummary`, `fxRates(base)` |
| Pure logic | `data/expenseGroups.ts` | new | every rule below E3–E8, no React; one test file |
| Queries | `data/expenseGroupQueries.ts` | new | hooks + the one invalidation set (E2) |
| Queries | `data/expenseQueries.ts` | touch | expense create/update/delete also invalidate `expense-groups` (a date edit moves membership) |
| URL | `data/filters.ts` | touch | `parseGroupsPage` (`newGroup`), `parseGroupDetail` (`currency`, `category`, `editGroup`, `addToGroup`) |
| Routes | `router.tsx` | touch | `/p/$profileId/expenses/groups` and `/p/$profileId/expenses/groups/$groupId`, both through `omitShellOverlay` + `useReplaceSearch` |
| Shared UI | `components/SectionTabs.tsx` | new (17A) | `<nav>` of router `Link`s, `aria-current="page"` |
| Toast | `components/Toast.tsx` | touch | `ToastOptions.action?: { label, onAction }` for Undo / Retry (E6) — extends, no second toast system |
| Views | `pages/views/ExpensesList.tsx` | touch | SectionTabs under the heading |
| Views | `pages/views/ExpenseGroupsList.tsx` | new | list, states, `?newGroup` drawer |
| Views | `pages/views/ExpenseGroupDetail.tsx` | new | headline, ≈ line, currency tab, sections, members, Left out, `?editGroup`/`?addToGroup` |
| Group UI | `components/groups/GroupDrawer.tsx` | new | create/edit/delete (9A, 10A, 14A) |
| Group UI | `components/groups/AddToGroupDrawer.tsx` | new | picker (12A) |
| Group UI | `components/groups/DayBars.tsx`, `CategoryBars.tsx` | new (18A) | hand-built charts, spring morph |
| Group UI | `components/groups/GroupMembers.tsx` | new | day-grouped member table + Left out; HostedTable has no group-header rows, so this renders its own `<table className="table">` on `Table.css` like HostedTable does |
| Group UI | `components/groups/InGroupsLine.tsx` | new (11A) | used by ExpenseDrawer in edit mode |
| Drawer | `components/ExpenseDrawer.tsx` | touch | renders `InGroupsLine` |
| Styles | `hosted.css` | touch | `hp-groups-*`, `hp-daybars-*`, `hp-catbars-*` on `--m-*` tokens + spacing scale (ADR-089 guard) |
| i18n | `i18n/en.json`, `i18n/ar.json` | touch | `hosted.groups.*`, `hosted.sectionTabs.*` |
| QA | `qa/support/portalApi.ts` | touch | FakeApi learns groups, marks, summary, `?groupId`, `?expenseId`, `fx-rates` |
| QA | `qa/features/portal/expense-groups.yaml`, `qa/specs/portal/expense-groups.spec.ts` | new | see QA scenarios |

No server change. No new dependency (`motion` is already used by the drawer and row-exit kit).

## Engineering decisions (mine; none changes a design decision)
- **E1 One query-key root.** Every group read lives under `profileKey(pid, 'expense-groups', …)`: list `[…, 'list', {expenseId?}]`, detail `[…, id]`, summary `[…, id, 'summary']`, members `[…, id, 'members']`, left out `[…, id, 'excluded']`, picker pool `[…, id, 'pool', from, to]`. `invalidateGroups(pid)` hits the root once, which is exactly 8A's refetch set ("summary, members, left out, group list and the in-groups query"). Expense writes call it too.
- **E2 Members load all pages, then sort oldest first (4A, Pass 7).** `useGroupMembers` is a `useQuery` whose `queryFn` follows `nextCursor` (limit 200, the server max) until null — bounded by the 366-day window — and returns rows sorted `(occurredOn asc, id asc)`. Not `useInfiniteQuery`: nothing pages on screen. Day subtotals come from `summary.byDay`, never from summing rows.
- **E3 In-window test is client-side** from `occurredOn` and `[startOn, windowEnd]` (the API returns `windowEnd`, so the R6 one-year rule is not re-derived). `actionFor(row, group)` returns `{ verb: 'leaveOut' | 'remove', request: PUT excluded | DELETE, undo: DELETE | PUT included }` per the Pass 7 table.
- **E4 Undo when the prior mark is unknowable.** Member rows carry no mark (the ledger shape has none). In-window members may be unmarked or kept; Undo of their Leave out sends DELETE, which restores membership but drops a keep mark that only matters if the date later moves out. Every other row's prior mark is certain (out-of-window member = kept, Left out row = excluded, picker row = none). Logged as TD-166 rather than an API change.
- **E5 Optimistic marks.** A page-local `pendingMarks: Map<expenseId, 'excluded' | 'included' | 'cleared'>` overlays members, Left out and the summary (pure `applyMarks(summary, rows, marks, group)` adjusts currency total/count, the day bucket and the category bucket from the row's own amount/date/category). Entries clear when the refetch after the request settles, so the server reconciles silently (craft 1). Decimal arithmetic in integer minor units: `parseAmountToMinor` (`src/lib/utils.ts`) in, `minorToDecimal` out (moved from `components/incomeForm.ts` to `format/currencies.ts`, incomeForm re-imports it), never floats. Failure → the mark is dropped (the row retraces) plus an error toast with Retry.
- **E6 Toast actions.** `ToastOptions.action` renders a `.press` button inside the existing polite region; the 6 s timer and "next show replaces" rule already match "stays until the next action or 6 s". Undo restores via E3/E4's `undo` request.
- **E7 Sequential saves with partial results (12A, 13A).** One `runSequential(items, save)` helper returns `{ done: id[], failed: id[] }`; the picker and Leave out all both use it; Retry reruns only `failed`. Bulk exits stagger 50 ms for the first 8 rows (craft 2).
- **E8 Derived figures, all in `data/expenseGroups.ts`:** `groupStatus(group, today)` (upcoming / ongoing / past), `dayCount`, `reachedYear` (open and today > windowEnd), `needsEndDate` (open, today ≥ startOn + 11 months, not yet reachedYear), `defaultCurrency(summary, profileDefault)` (5A), `perDay(block, group, today)` (7A, null before day 1), `toBars(block, mode, allCurrencyDays)` with daily ≤ 31 days else ISO-week buckets (19A; 375 px switches above 21 days via a `matchMedia('(max-width: 759px)')` hook), `otherCurrencyDays` (20A dot), `categoryRows(block, names)` (Uncategorized last, 23A), `pickerWindow(group, side)` (30 days before start / after windowEnd, closed groups only), `maxEndOn(startOn)` (start + 365), `convertTotal(summary, rates)` (≈ line; JOD-derived rates labelled per the response's `derived` flag; null when rates missing).
- **E9 ≈ line.** `useFxRates(profile.defaultCurrency)` (staleTime 1 h, `retry: false` on 503). Hidden while loading or on any error; `source: 'stale'` shows "rate from <rateDate>". Only rendered with ≥ 2 currencies or when the single currency differs from the profile default; otherwise it would repeat the headline.
- **E10 Charts move with `motion`'s `animate()` on `UI_SPRING`,** scaleY/scaleX from the current presentation value (interruptible); no entrance animation; reduced motion = 150 ms opacity dip. `usePrefersReducedMotion` moves from `src/hooks/` to `src/lib/motion/` (the portal may not import a `hooks/` path, lint rule hosted-portal.md §8); `src/hooks/usePrefersReducedMotion.ts` re-exports it so no app import changes.
- **E11 Create.** Idempotency key via the existing `useAttemptKey`, plus TD-163's rule: a 422 (any reason, GROUP_LIMIT included) calls `attempt.succeeded()` to end the attempt, so a resubmit of the same body after deleting a group gets a fresh key instead of the cached refusal. Network errors and timeouts keep the key (the MUT-133 replay protection). 422 reasons map to fields: NAME_REQUIRED → name, END_BEFORE_START / GROUP_RANGE_TOO_LONG → end, DATE_INVALID (+bound) → the date sent, GROUP_LIMIT → form-level message. Edit: If-Match; 409 → refetch + "This group changed elsewhere" notice, as ExpenseDrawer.
- **E12 Delete confirm is inline in the drawer** (wireframe §2), not `window.confirm`, so it can say "Its <n> expenses stay in Expenses".

## Tests (Vitest, written first; `npm run test:run` under Node 22)
- `data/__tests__/expenseGroups.test.ts` — status at boundaries (start day, end day, open); dayCount; reachedYear/needsEndDate around startOn+365 and +11 months; defaultCurrency ties (profile default, then alphabetical) and `?currency=` override; perDay (hidden before day 1, elapsed days cap at end, excludes before/after buckets, 3-decimal JOD); toBars daily vs weekly at 31/32 days, week starts by locale, before/after sparse bars kept apart, sum of bars = currency total; categoryRows order + Uncategorized last; actionFor every row of the Pass 7 table; pickerWindow before/after, none after for open groups; maxEndOn; convertTotal (sum, missing rate → null, derived flag); applyMarks (leave out / bring back / remove / add adjusts total, count, day and category; never goes negative; idempotent re-apply).
- `data/__tests__/runSequential.test.ts` (or inside the file above) — order, partial failure, retry of failed only.
- `components/__tests__/SectionTabs.test.tsx` — links, `aria-current`.
- `components/__tests__/Toast.test.tsx` — extended: action button fires and the toast closes.
- `components/groups/__tests__/DayBars.test.tsx` — group label, one button per bar with its aria-label, roving tabindex, ←/→ mirrored when `dir=rtl`, Home/End, Enter calls onJump, dot for other-currency days, gap labels.
- `components/groups/__tests__/CategoryBars.test.tsx` — rows are buttons, pressed state, Uncategorized last.
- `components/groups/__tests__/GroupDrawer.test.tsx` — defaults (today, Still going unticked, end required), end cap hint, 422 mapping, fresh key after GROUP_LIMIT, edit If-Match, delete confirm copy.
- `components/groups/__tests__/AddToGroupDrawer.test.tsx` — pool excludes members, sequential PUT included, "Added 2 of 3 · Retry 1".
- `pages/__tests__/ExpenseGroups.test.tsx` — list states (loading, empty, error, rows with "+N", nudges), detail states (each 8A row: empty past/ongoing, upcoming, all left out, 404 deleted, FX hidden/stale), leave out → Left out + Undo, category filter + leave out all, Arabic default renders `dir=rtl`.
- `components/__tests__/ExpenseDrawer.test.tsx` — extended: In groups line omitted while loading/error, links, Add to group… menu lists only groups without it, Remove.
- Gates: `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`, `npm run hosted:types:check` (no drift), all with `export PATH=/Users/basel/.nvm/versions/node/v22.23.1/bin:$PATH`.

## QA scenarios → `qa/features/portal/expense-groups.yaml` (tier secondary)
| id | User does | Promise (expect) | Ticket AC |
|---|---|---|---|
| `create` | Expenses › Groups, New group "Jordan trip" 3–7 Oct, Create | lands on the group; every expense dated 3–7 Oct listed oldest first; headline per currency with counts; POST carries Idempotency-Key | 1 |
| `leave-out-undo` | Leave out one, Undo, Leave out again, open Left out, Bring back | totals, its bar and category drop at once; row under Left out; Undo/Bring back restore; PUT excluded / DELETE sent | 2 |
| `add-from-outside` | Add from outside these dates, tick the 12 Sep flight, Add | it appears as Kept "before the trip", counts in its currency, its own bar past the gap | 3 |
| `currencies-converted` | open a JOD+USD group, switch the currency tab | headline never sums currencies; tab changes chart/categories only; ≈ line names the profile currency and the rate date; FX 503 hides it | 4 |
| `category-prune` | click Rent, Leave out all 2 Rent, Undo | list filters by category; both leave; one Undo restores both | (13A) |
| `states` | empty profile, upcoming group, deleted group, list error + Retry | "Group a trip's spending", "<name> starts <date>", "This group was deleted", unreachable card | 5 |
| `in-groups-line` | open an expense from the ledger, Add to group…, Remove | line lists its groups; menu offers only others; PUT included / DELETE | (11A) |
| `edit-delete` | Edit, change end, Save; Delete with confirm | If-Match sent; delete returns to Groups with a toast; expenses untouched | (9A) |
| `arabic-375` | open the group in Arabic at 375 px | `dir=rtl`, Arabic copy, no horizontal page scroll, chart time runs right-to-left, Category under title | 6 |
`paths` cover every new file above plus the touched ExpenseDrawer/ExpensesList/Toast/router lines' files. Specs run on a preview build via the gitignored throwaway config (memory: qa-run-on-preview-builds), then `release-qa lint` clean (AC 7).

## Order of work (each step green before the next; checkpoint commit per step)
1. Worktree `.claude/worktrees/mut-268-expense-groups-portal`, branch `feature/mut-268-expense-groups-portal` from local main; copy both MUT-268 plan files + wireframe if not on main (they are on main) and this file; commit.
2. Design brief `.claude/designs/mut-268-expense-groups-portal.md` (CLAUDE.md Phase 1 format, pointing at the plan) + `-tests.md`.
3. Pure logic + client + queries (tests first) — T6 base.
4. SectionTabs, Toast action, routes, list + GroupDrawer — T2.
5. Detail: headline, ≈, tab, DayBars, CategoryBars, members, Left out, optimistic marks — T3.
6. Picker + category leave-out-all — T4.
7. ExpenseDrawer In groups line — T5.
8. FakeApi + QA yaml + specs; run on a preview build; `release-qa lint`.
9. Knowledge: CHANGELOG, SYSTEM_OVERVIEW, COMPONENT_REGISTRY (SectionTabs, DayBars, CategoryBars, Toast action), PATTERNS (optimistic marks over computed membership, sequential saves with partial result), DECISIONS (ADR-095 portal groups: client-side membership verbs + converted line rules), TECH_DEBT (TD-166 E4), TEST_PLAN, ROADMAP if it lists the epic.
10. Gates under Node 22; `/qa-reconcile MUT-268`. No push.

## Eng review corrections (plan-eng-review lens, Claude subagent, 2026-10-18) — folded in, binding for the build
Verdict PASS WITH CORRECTIONS; no product decision needed. Each item amends the E-decision named.
- **R1 (P1, E5) Marks never double-count.** Each pending mark carries `settledAt` (set when its request resolves). Its summary/detail delta applies only while `summary.dataUpdatedAt < settledAt`; its row overlay only while the members/excluded query's `dataUpdatedAt < settledAt`. `onMutate` cancels in-flight group queries. Mark mutations share `mutationKey ['expense-group-mark', groupId]` and invalidate in `onSettled` only when `isMutating({ mutationKey }) === 1`. Test: summary lands before members; totals drop exactly once.
- **R2 (P2, E2/E7) Fewer requests, cancellable loop.** `runSequential` invalidates once at the end; `api.expenses` takes a `signal` and the member loop threads the queryFn's signal. E2 wording fixed: members are bounded by the window *plus* keep marks (any date), still small.
- **R3 (P2, E3/E6) Per-expense request chain.** Mark requests for the same `expenseId` run through a promise queue, so a Leave out and its Undo/Retry/Bring back reach the server in order (API is last-write-wins). Tested.
- **R4 (P2, 13A/23A) Category in the URL.** `?category=<uuid>|none` (`none` = Uncategorized, like the ledger's `linked=none`); the member filter is category ∩ selected currency, so "Leave out all <n>" equals the bar's count.
- **R5 (P2, E6) Toast action for both tones** (Undo in the polite region, Retry in the alert); timer pauses while hovered/focused. Focus moves to the next row after Leave out and back to the restored row on Undo (PATTERNS row-exit focus rule). Undo closures hold ids + `api` + invalidate only, so they still work after navigating away.
- **R6 (P2) Query-layer tests.** `data/__tests__/expenseGroupQueries.test.tsx`: loop to null at limit 200 then sorted `(occurredOn, id)`; mark and expense create/update/delete invalidate the `expense-groups` root; FX key `profileKey(pid, 'fx-rates', base)` sits outside it.
- **R7 (P2) QA determinism.** Specs fix the browser clock (`page.clock.setFixedTime`) and seed dates relative to it; FakeApi learns `from`/`to`/`cursor`, membership `[startOn, windowEnd]` + marks, `position` buckets from one helper, and serves members in two pages.
- **R8 (P3, E12) Delete without a 404 flash.** Navigate to the list first, then `removeQueries` for that group and invalidate the list.
- **R9 (P3) Routing details.** SectionTabs' Expenses link uses `activeOptions={{ exact: true }}`; the detail route renders with `key={groupId}`.
- **R10 (P3) Menus.** The 21A header "⋯" menu and the 11A "Add to group…" menu reuse `src/hosted/shell/usePopover.ts` + `hp-popover` (UserMenu's primitive), with the craft spec's scale-from-trigger origin.
- **R11 (P3, E8) `convertTotal` arithmetic.** `rate` = units of the currency per 1 base, so X→base divides: `parseAmountToMinor` → scale to base exponent → divide by rate → round half away from zero → `minorToDecimal`; no `Number()`/unary + on amounts (lint). Tests JOD→USD (derived) and EUR→ILS.
- **R12 (P3, E10) Motion kit gaps.** Members keep day headers and rows in one `<tbody>` (rowExit's followers are siblings). New `src/lib/motion/rowEnter.ts` (`playRowEnter(row, { reducedMotion })`: from the inline end on `UI_SPRING`, fade under reduced motion) with a unit test, for Undo's retrace. The 375 hook shares the moved media-query subscription with `usePrefersReducedMotion`.
- **Product note (no decision needed):** E4/TD-166 — Undo of Leave out on an in-window *kept* expense sends DELETE, not "restore the exact prior mark"; impossible without an API field. State it in the PR/Jira.

## Risks
- **Request count on bulk leave-out** (13A): up to ~30 sequential PUTs for a year-long group. Accepted in design; E7 shows progress and partial results.
- **Optimistic summary drift**: `applyMarks` only adjusts what the row knows; the summary refetch is the truth and replaces it. Tested for idempotence so a late refetch never double-subtracts.
- **Chart a11y in RTL** — covered by DayBars unit tests and the arabic-375 QA feature.

## NOT in scope
Batch override endpoint, per-day FX (MUT-273), a "Category removed" bucket, cross-trip comparison, phone (MUT-269), local web, create-drawer preview count, any server change.

## Business / product impact
- A freelancer back from a trip sees what it cost — per currency, per day, per category — and can prune rent or subscriptions out of it, in the portal where expenses already live.
- Second of three MUT-266 tickets; ships with MUT-267's API in the next api-v*/web-v* release and sets the UI rules MUT-269 (phone) copies.
- No server cost added: one list call, one summary, member pages bounded to a year, and a cached FX read.
