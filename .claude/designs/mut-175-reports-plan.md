# MUT-175 — Portal Reports: plan (eng-ticket, 2026-10-24)

> Status: **planned, not built.** Shaped with Basel on 2026-10-24 in the /eng-ticket session; the ticket had no acceptance criteria.
> Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned (this plan) → In Progress (/eng-build) → In Review (/qa-reconcile).
> Parent: MUT-34. **Blocks MUT-322 (GA gate)**, which needs it before MUT-292 retires the web app's Insights page. Not blocked by anything.

## 1. What Basel decided (2026-10-24)

| # | Decision |
|---|---|
| B1 | **A "very important screen."** Interactive, with charts and motion that make people want to look at it. It is a portal section of its own: **Reports** (التقارير). |
| B2 | **Received is the headline** (money actually in). **Owed is second.** The word "billed" is never used. |
| B3 | **It gets smarter with more data.** The stage comes from the data: **stage 1** has no complete earlier month, **stage 2** has one, **stage 3** has two or more ("month 3+"). |
| B4 | **v1 insights:** category movers (stage 2+); averages and best month (stage 3); client concentration and days to get paid (stage 3). **Not chosen:** pace against last month, ▲/▼ chips against last month, and the dotted last-month line. These are out of scope (§9). |
| B5 | **Currencies:** one converted total (≈, in the base currency, at today's ECB rate, with its date), and a hover or tap that shows the exact amount in each currency. This is the expense-groups pattern that already exists (ADR-087, `convertTotal`). |
| B6 | **Scope (amended 2026-10-24, §13):** Reports shows **one profile**, the current one, matching the MUT-423 shell. One **"All profiles" switch** turns on a combined view of every profile in the switcher (personal, business, shared firm), with a disclaimer. It is all or nothing, with no chips. |
| B7 | **Periods:** Week, Month, Year. Year turns on at stage 3. ‹ › step back and forward in time. |
| B8 | **Teaser cards:** one dashed card says what unlocks next and when, and it goes away once the data is there. |
| B9 | **Everyone, both modes:** every profile type, signed in or out (MUT-284 decision 4). |

## 2. Neighbourhood

- **MUT-322** (GA gate) lists MUT-175 as "portal reports, needed before MUT-292 retires the web app". **MUT-292** deletes `src/pages/insights` (Summary, Clients, Projects, Expenses and Unpaid tabs, with CSV).
- **MUT-313** (VAT summary) and **MUT-314** (accountant pack: CSV and XLSX with a receipts zip) are firm-books work under MUT-298. They stay there: **no VAT and no export in MUT-175.** The web Insights CSV is not carried over. That gap is recorded in §9 for Basel to see.
- **MUT-129** (batch reads in summaries) is related: §4.2 adds one batched allocation read.
- **MUT-305** (firm roles) is not built. Once it lands, a member without a scope (a submitter) gets 403 on payments. §4.4 handles this already.
- **MUT-307** (approval) is not built. Expenses still pending approval have to stay out of "Spent". The plan reads expenses through the same filter as `/v1/summaries/expenses`, so MUT-307 changes one place.
- **The portal already has:** `/v1/summaries/expenses` (by category and by client per currency; the client is wired up but **no screen calls it**), `/v1/summaries/organization` (Owed buckets, which Overview already caches), `/v1/fx-rates` plus `useFxRates`/`convertTotal`, the animated, keyboard-navigable `DayBars`/`CategoryBars`/`useSpringScale`, the `motion` dependency, and `/v1/expenses/streak`.

## 3. Product shape (what the user sees)

The route is `/p/$profileId/reports`. Its search parameters are one filters object: `period=week|month|year`, `at=YYYY-MM-DD` (any day inside the period shown), `scope=all|profile`, and `skip=<profileId,…>` (the chips). It follows the CLAUDE.md single-FiltersModel rule.

1. **Hero row.** Received ≈ total (the large figure), Owed now (smaller, secondary, read from the cached organization summary), Spent ≈, and Kept ≈ (Received − Spent). The numbers count up and morph between periods. Hovering, focusing or tapping the ≈ figure opens the exact amount per currency, with the rate line ("1 USD = 3.71 ILS · ECB, 24 Oct").
2. **Insights.** Up to three sentences, ranked by size. A teaser card (B8) follows when something is still locked.
3. **The chart.** Received and spent bars. Week shows 7 days; Month shows days; Year shows 12 months (stage 3 only). The bars grow when the page loads and move when the period changes. Arrow keys move between bars, which announce their values. In Arabic the chart is mirrored.
4. **Where it went.** `CategoryBars` over the period's spending. At stage 2+ the biggest mover is marked on its row.
5. **Who paid.** Received per client. At stage 3 each row also shows the average days to get paid.

Empty period: "Nothing logged this week" with the two capture actions the portal already has (income, expense). The page never says "0%" or "no data" with a blank chart.

## 4. Engineering plan

### 4.1 Where things are computed (eng D1)

- **Per profile, on the server:** a new `GET /v1/summaries/activity?from&to&bucket=day|week|month`. It goes in `PORTAL_ROUTES`, so the **local mode backend runs the same code** in the browser (ADR-097). One implementation covers both modes, and the existing `portal-routes-coverage` test enforces it.
- **Across profiles, and converting, in the portal:** one query per profile (`useQueries`, each cached per profile and range), then a sum, then conversion with `useFxRates`. Conversion stays client-side because ADR-094 and ADR-087 keep the server per-currency, which ADR-004 requires. A server-side cross-profile endpoint was rejected: it would add a person-scoped auth shape (every route today is profile-scoped), and local mode would need it built twice.
- **Insights in the portal:** a pure module turns the activity responses into ranked insight objects. They are deterministic rules with **no LLM** (same privacy line as MUT-252).

### 4.2 Server

| File | Change |
|---|---|
| `server/src/summaries/activity.ts` (new) | Pure `summarizeActivity({ payments, expenses, allocations, receivablesById, from, to, bucket })`. Per currency: `received` total and per-bucket series (POSTED payments by `receivedOn`; REVERSED never counted), `spent` total and series plus `byCategory` (**reuses `summarizeExpenses`**), `receivedByCustomer`, and `daysToPaid` (overall and per customer: mean of `receivedOn − postingDate`, clamped at ≥ 0, one sample per paid Owed entry, with `n`). The bucket boundaries are pure functions over ISO dates. Week starts on the **organization's week start** (see eng D4). |
| `server/src/routes/summaries.ts` | The new route. `SESSION_ONLY`, scopes `payments:read` + `expenses:read`. It lists POSTED payments with `receivedAfter/Before` (index `[organizationId, receivedOn…]` exists) and expenses with `{from,to}` (index exists) through `listAll`, then one batched allocation read. It adds `dataSince` (the earliest money date: first payment, first expense or first Owed entry) for the stage. 422 `END_BEFORE_START`; range cap **13 months** (`RANGE_TOO_LONG`). |
| `server/src/repositories/ports.ts` + Prisma + `MemoryLedgerStore` | `payments.listAllocationsFor(orgId, paymentIds)` (one `IN` query, MUT-129's direction). `money.earliestDate(orgId)`: three `findFirst … orderBy asc` calls on indexed columns, min taken. Both stores, plus the local snapshot parity test. |
| `server/src/schemas.ts` | `ActivitySummaryQuerySchema` and `ActivitySummarySchema` (OpenAPI). Then `npm --prefix server run openapi:check` and regenerate `src/hosted/api/schema.d.ts`; API version bump `1.x.0-mut175`. |

Cost: one request reads the period's payments and expenses once. A year has about 2–5k rows for a heavy user, which is the same in-memory `listAll` shape `/v1/summaries/organization` already uses. A SQL `GROUP BY` is the scaling step, logged as **TD-221** and not done now.

### 4.3 Portal

| File | Change |
|---|---|
| `src/hosted/data/fx.ts` (new) | **Extracted** from `expenseGroups.ts`: `convertAmounts(amounts, rates) → ConvertedTotal`. `convertTotal` becomes a one-line wrapper, so groups keep working unchanged (DRY; `expenseGroups` tests stay green). |
| `src/hosted/data/reportQueries.ts` (new) | `useActivity(profileId, range, bucket)`, `useReportActivity(profiles, range, bucket)` (fan-out, skips profiles that answer 403 and names them), and the previous-period and 3-month reads. |
| `src/hosted/data/reports.ts` (new, pure) | Period math (`periodOf`, `step`, `bucketFor`), `stageOf(dataSince, today)`, `combine(blocks[], rates)`, and the series alignment across profiles. |
| `src/hosted/data/reportInsights.ts` (new, pure) | `buildInsights(input) → Insight[]` with `{id, icon, messageKey, values, weight}`, at most 3, ranked by weight. Named thresholds: `MOVER_MIN_SHARE` and `MOVER_MIN_PCT`, `CONCENTRATION_SHARE = 0.35`, `MIN_DAYS_SAMPLES = 3`. `nextUnlock(stage)` drives the teaser. |
| `src/hosted/pages/views/ReportsPage.tsx` (new) | Composition only; rows arrive already shaped (CLAUDE.md perf rule). |
| `src/hosted/components/reports/` (new) | `HeroFigures` (count-up with `motion`, reduced-motion → instant), `ConvertedFigure` (button + popover; Esc closes; tap on touch; the groups' ≈ line can adopt it later), `InsightList` + `TeaserCard`, `ScopeChips`, `PeriodControl` (segmented + ‹ ›). |
| `src/hosted/components/groups/DayBars.tsx` | **Extended, not copied** (≥70% overlap rule): an optional second series (received and spent) and month buckets. Moved to `components/charts/` with a re-export at the old path. `CategoryBars` is reused as is for both "Where it went" and "Who paid". |
| `src/hosted/router.tsx`, `data/filters.ts` | `reportsRoute` + `parseReports` (period, at, scope, skip validated; bad values fall back to the defaults). **Lazy route chunk** (`lazyRouteComponent`) so the charts stay out of the entry bundle (`npm run test:bundles`). |
| `src/hosted/shell/HostedShell.tsx` | `SECTIONS` gets `{ path: '/reports', key: 'reports' }` after Overview. |
| `src/hosted/i18n/{en,ar}.json` | `hosted.reports.*` and `hosted.shell.nav.reports`. Insight sentences use ICU plurals; Arabic plurals are checked. Every amount stays a `<bdi>` (MUT-109, ADR-101). |
| `src/hosted/analytics` | One opt-in event, `report_viewed {period, scope, stage}`, added to the MUT-153 taxonomy. Signed-out mode sends nothing (ADR-024). See eng D6. |

### 4.4 Edge cases

- **A profile without the scopes** (a submitter after MUT-305, or a Malafat API-only member): that profile's 403 is caught. Its chip shows "not included: you can't see its payments", and the rest of the report still renders.
- **Mixed currencies with a missing rate:** `convertAmounts` returns null. The hero then shows each currency side by side, without the ≈ (the same fallback groups use).
- **Rates unavailable signed out and offline:** the same per-currency fallback applies.
- **Malafat-fed firm profiles:** read-only. Received comes from Malafat payments, and its unallocated captures count as received but carry no days-to-paid sample.
- **The period crosses `dataSince`:** days before the first record are drawn as a quiet "before you started" gap, not as zeros.
- **Timezones:** "today" and the period edges come from the organization's timezone, as the server does today (ADR-038/085). In All profiles, the profiles can have different timezones, so each profile's own range is asked for and the rows are aligned by date label.
- **Firm approvals (MUT-307):** pending expenses are excluded through the shared expense read.

## 5. Tests (TDD: written first)

- **Server unit** `summaries/__tests__/activity.test.ts`: bucket edges (day, week, month, year), the week start, REVERSED excluded, JOD exponent 3, the days-to-paid mean, clamp and `n`, per-customer splits, and empty ranges.
- **Server routes** `routes/__tests__/summaries-activity.test.ts`: scopes, `END_BEFORE_START`, `RANGE_TOO_LONG`, `dataSince`, and organization timezone edges. `test:db` covers `listAllocationsFor` and `earliestDate` on Prisma. `portal-routes-coverage` stays green.
- **Local parity:** `src/hosted/local` parity test for the new route (same answer over `MemoryLedgerStore`).
- **Portal unit:** `reports.test.ts` (stages at the 0, 1 and 2 complete-month boundaries; period stepping across year ends; combine across profiles); `reportInsights.test.ts` (every insight's threshold just above and just below, the ranking, the cap of 3, `nextUnlock`); `fx.test.ts` (the extracted conversion, so groups keep their behaviour).
- **Components:** `ReportsPage` (stage 1, 2 and 3 fixtures, a 403 profile, a missing rate, reduced motion, Arabic RTL), `ConvertedFigure` (keyboard, Esc, tap), and the extended `DayBars` (two series, arrow keys, announcements).
- **Release-QA** (CLAUDE.md Phase 5): `qa/features/portal/reports.yaml` + `qa/specs/portal/reports.spec.ts`, tags `@portal.reports.*`:
  `first-month` (basics + teaser) · `third-month` (best month, average, concentration, days to paid) · `category-mover` · `all-vs-one-profile` (chips leave one out; totals change) · `converted-breakdown` (the popover shows the exact per-currency amounts) · `period-step` (week/month/year, ‹ ›) · `arabic` (RTL, Arabic copy) · `signed-out` (local mode).
  Seeded through the API in the QA fixtures (back-dated payments and expenses within the MUT-227 date floor).
- **Gate:** Node 22: `npm run lint`, `typecheck`, `test:run`, `build`, `test:bundles`, and the four server commands, then `release-qa lint`.

## 6. Knowledge files

The next free ADR number at build time (ADR-181 is MUT-361's; MUT-424 takes the next; check `.claude/DECISIONS.md`) (reports: per-profile server activity plus client-side combine and convert at today's rate; deterministic staged insights). DECISIONS gets B1–B9. TD-221 (in-memory aggregation). COMPONENT_REGISTRY (the `charts/` move, `ConvertedFigure`, the reports components). PATTERNS (staged insights). CHANGELOG, SYSTEM_OVERVIEW, TEST_PLAN, and the brief `.claude/designs/mut-175-reports.md` + `-tests.md` (CLAUDE.md Phase 1/2: Basel approves the brief before code).

## 7. Acceptance criteria to write onto the ticket

1. Reports is reachable from the portal shell for every profile, signed in and out, in English and Arabic (RTL). If MUT-175 lands before MUT-426 it is a nav item, and MUT-426 moves it to the shell's corner icon (MUT-424 D2). The route stays `/p/$profileId/reports`.
2. Received is the headline figure and Owed is secondary; nothing says "billed".
3. Totals are one ≈ figure in the base currency at today's ECB rate with its date. Hover, focus or tap shows the exact amount per currency. A missing rate falls back to per-currency figures.
4. Week, Month and Year (Year from stage 3), with ‹ › to step through time. Reports opens on the current profile. With 2+ profiles, an "All profiles" switch (off by default) shows every profile combined, with the line "All {n} profiles combined · other currencies at today's rate" and "Of which {profile}: ≈ {amount}". The state is in the URL.
5. The stage follows the data, and a month counts only if records start by its 7th day (DR14). Stage 1 shows the basics and one teaser. Stage 2 adds a factual recap of the first complete month (DR15). Stage 3 adds category movers (two latest complete months), the month trend, the 3-month average, the best month, client concentration and days to get paid. Insights sit under "Lately" and don't change with the period shown (DR16).
6. Charts animate and are keyboard-navigable with spoken values; reduced motion turns movement off.
7. A profile the person can't read is named and left out; the rest still renders.
8. Release-QA scenarios pass, `release-qa lint` is clean, and the gate is green.

## 8. Eng review decisions (filled by /plan-eng-review)

See §10.

## 9. Out of scope / noted for Basel

- Pace against last month, ▲/▼ chips and the last-month line (not chosen in B4).
- **CSV export of reports.** Web Insights has it and MUT-292 deletes it. MUT-314's pack covers firms only. **Decide before MUT-292:** accept the loss for freelancers, or add a CSV story.
- A converted total at historical rates (B5 uses today's rate, labelled as such).
- VAT (MUT-313) and the accountant pack (MUT-314).
- Forecasts (ADR-036 removed them by Basel's choice).

## 10. Eng review (/plan-eng-review, 2026-10-24)

Target: this file (`.claude/designs/mut-175-reports-plan.md`), user-named. The report is this file.

### Scope record

feature answers: none proposed (Basel's B1–B9 are binding, and nothing was cut); structure: B, Smaller arrangement (D1, Basel 2026-10-24); accepted scope: B1–B9 unchanged, with this arrangement:
- The server buckets `day | month` only; the portal derives weeks with the existing `weekStart` (`src/hosted/data/expenseGroups.ts:35,62`: Saturday in Arabic, Monday in English).
- One activity response per profile carries the period's buckets **plus a 12-month monthly history ending with the period's last month**. The stage, the category movers, the averages and the best month all come from that history. There is no `earliestDate` store method and no separate previous-period or 3-month request.
- One new store method: `payments.listAllocationsFor(orgId, paymentIds)`.
- `convertTotal` is reused by widening its argument to `{ currencies: readonly { currency; total }[] }`; there is no `fx.ts`.
- `DayBars` is extended in place (no move to `components/charts/`).
- No lazy route.
- Components: `HeroFigures` (with the ≈ popover), `InsightList` (with the teaser), `ReportControls` (period and scope chips).

pending remedies: none at the time of the scope answer.

Scope Challenge result: **scope accepted as-is** (the arrangement is smaller; the features are unchanged).

### Reality rows

| premise | claim | receipt | verdict |
|---|---|---|---|
| P1 | The portal never calls `/v1/summaries/expenses` | only `src/hosted/api/client.ts:468`; `queries.ts:40` calls organizationSummary only | true |
| P2 | Routes in `summaryRoutes` run in local mode | `server/src/routes/portal-routes.ts` `(deps) => summaryRoutes(deps.store)` | true |
| P3 | Allocations can only be read one payment at a time | `ports.ts:1164` `listAllocations(organizationId, paymentId)` | true |
| P4 | Payments and expenses have date indexes | prisma `Payment @@index([organizationId, receivedOn…])`, `Expense @@index([organizationId, occurredOn…])` | true |
| P5 | The organization has a week-start setting (plan §4.2) | none in `server/src` or `src/hosted`; the only convention is `expenseGroups.ts:35` | **false**, fixed by D1 |
| P6 | The new route needs scopes `payments:read` + `expenses:read` (plan §4.2) | `summaries.ts:27,84,129` use `summaries:read`; `expenses.ts:368` route uses `expenses:read` | **false**, see S1 |
| P7 | A future-dated Owed is excluded from the summaries | MUT-392 `9163a46f` "summaries add no rows for it" | true |
| P8 | `motion` is already in the portal's entry graph | `src/hosted/components/groups/useSpringScale.ts` imports it; routes are all static (`router.tsx`) | true |
| P9 | A receivable records when it was settled | `ports.ts` ReceivableRecord has `paidMinor`, `status`, `postingDate`, and no settledAt | **false**: the settle date must come from its allocations' payments (feeds D2) |

unverified=0.

REALITY: premise-table finding 3 false premises (P5, P6, P9), all corrected here `.claude/designs/mut-175-reports-plan.md:§10`
REALITY: already-done pass no MUT-175 commits on main (`git log --since=2026-10-13 --grep=MUT-175` empty) `server/src/routes/summaries.ts:1`
REALITY: surface-check finding `GET /v1/summaries/activity` is new; scope names corrected (S1) `server/src/routes/summaries.ts:27`
REALITY: binding-decisions pass B1–B9 (Basel, 2026-10-24) kept; ADR-004 per-currency storage kept, conversion client-only (ADR-087) `src/hosted/data/expenseGroups.ts:250`
REALITY: numbers finding file counts ~30 → ~24 are estimates [estimated]; no performance numbers claimed `.claude/designs/mut-175-reports-plan.md:§4`
REALITY: deferred-asks pass the ticket has no ACs; MUT-322 asks for "portal reports before MUT-292"; the gap is the CSV export (§9, to decide before MUT-292) `.claude/designs/mut-175-reports-plan.md:§9`
REALITY: pr-count pass one branch/PR (`feature/mut-175-reports`) `.claude/designs/mut-175-reports-plan.md:§4`

### Scope Challenge findings

- **S1** [P2] (confidence 9/10) `server/src/routes/summaries.ts:27`: the plan named `payments:read` + `expenses:read`. The summaries family uses `requireScope('summaries:read')`, and the expense summary uses `expenses:read`. **Factual correction:** the activity route requires `summaries:read` **and** `expenses:read`, with SESSION_ONLY security like `/v1/summaries/expenses`. Who can call it is the same as the two summaries it combines, so no behaviour changes for anyone.
- **S2** [P2] (confidence 9/10) `src/hosted/data/expenseGroups.ts:35`: the week start is resolved by D1 (the existing convention).

Dispositions: S1 corrected (no choice involved); S2 resolved by D1.

### Section 1: Architecture

Data flow (accepted arrangement):

```
ReportsPage (filters from URL: period, at, scope, skip)
  │
  ├─ useReportActivity(profiles in view) ──► per profile: GET /v1/summaries/activity?from&to&bucket
  │        │                                   (remote: Cloud Run │ signed out: in-page local backend)
  │        │                                   server: listAll POSTED payments [receivedOn window]
  │        │                                           listAll expenses [occurredOn window]
  │        │                                           listAllocationsFor(paymentIds) → getByIds(receivables)
  │        │                                           summarizeActivity() → { buckets, history[12], byCategory,
  │        │                                                                    receivedByCustomer, daysToPaid }
  │        ├─ 403 for a profile → that chip says "not included", the rest still renders
  │        └─ combine(blocks) ──► useFxRates(base) ──► convertTotal ≈  (missing rate → per-currency, see D3)
  ├─ useOrganizationSummary(profile) ── Owed now (already cached by Overview)
  ├─ stageOf(history) ──► buildInsights(history, current, prev) ──► ≤3 insights + teaser
  └─ HeroFigures · InsightList · DayBars(2 series) · CategoryBars ×2
```

- **A1** [P2] (confidence 8/10) plan §4.2 "daysToPaid … mean of `receivedOn − postingDate` … one sample per paid Owed entry". There is no settle date on a receivable (P9), and a mean is pulled around by one very late client. The definition is an open choice: **D2**.
- **A2** [P2] (confidence 7/10) plan §4.3 `combine(blocks[], rates)` + B5: insights compare amounts across months. With several currencies they have to be compared in one unit, and conversion can be unavailable (offline signed out, or a currency without a rate). What insights do then is an open choice: **D3**.
- **A3** [P3] (confidence 7/10) plan §4.4 timezones: a profile's "today" comes from its organization's timezone, so in All profiles the current partial day can differ by a few hours between profiles. Periods are calendar-date ranges, so the buckets still line up by date. **Factual note, no change:** the current partial period is labelled "so far", and its edge is each profile's own today.
- **A4** [P3] (confidence 8/10) stage in All profiles: the stage comes from the combined history of the profiles in view, so a mature personal profile next to a new business profile shows stage 3 in All and stage 1 when the business profile is viewed alone. This is the direct reading of B3 and B6, so no choice is needed; it is recorded so tests pin it.

Production failure per new path: a slow or failing activity request for one of six profiles. How the page behaves is pending as **D4** (Section 2).

## Decision ledger

### R2: How "days to get paid" is defined
Finding: A1, P2, confidence 8/10, plan §4.2 daysToPaid / `ports.ts` ReceivableRecord (no settle date), reviewer: Claude (eng review)
Plan baseline: original proposal: "mean of `receivedOn − postingDate`, clamped ≥ 0, one sample per paid Owed entry, with `n`" (not approved)
Runtime evidence: ReceivableRecord has `postingDate`, `paidMinor`, `status` and no settle date; AllocationRecord links `paymentId` to `receivableId`; payments carry `receivedOn`. A settle date is only derivable as the latest `receivedOn` among a receivable's allocating payments.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R2 sample | "paid Owed entry" (unclear on partials) | each Owed entry **fully settled** whose last allocating payment falls in the history window | same as A | each allocation (partials count) |
| R2 days | receivedOn − postingDate | last payment's receivedOn − postingDate, ≥ 0 | same as A | allocation's payment receivedOn − postingDate, ≥ 0 |
| R2 statistic | mean | **median** | mean | amount-weighted mean per currency |
| R2 minimum sample | unspecified | 3 entries (per client and overall), else hidden | 3 entries | 3 allocations |
| Other choices (D3–D6) | pending | pending | pending | pending |
Question D2:
D2 — How should "days to get paid" be worked out?
Project/branch/task: mini-crm on main, planning MUT-175 (portal Reports), Section 1 Architecture.
ELI10: Basel picked "days to get paid" as a month-3 insight. The database doesn't store when an Owed entry became fully paid, so we work it out from the payments applied to it. Then we have to choose what one "sample" is and how to average. A mean lets one client who paid 200 days late make everyone look slow; a median shows the typical case. Counting part-payments separately makes a client who pays in instalments look faster than they are.
Stakes if we pick wrong: the insight tells a user "clients pay you in 45 days" when the typical client pays in 12, and they stop trusting the Reports page.
Recommendation: A because the median over fully paid entries answers "how long until I'm fully paid, typically" and one outlier can't swing it.
Completeness: A=9/10, B=7/10, C=6/10
Pros / cons:
A) Median per fully settled Owed entry (recommended)
  ✅ One very late client cannot swing the figure the way it swings a mean
  ✅ "Fully paid" is the question a freelancer asks; part-payments don't flatter it
  ❌ The median needs the full sample in memory (fine at this size) and moves in steps when samples are few
B) Mean per fully settled Owed entry
  ✅ Simplest to explain ("average days") and to compute
  ✅ Same sample as A, so only the statistic differs
  ❌ One 200-day outlier among 5 entries roughly doubles it, so the insight misleads
C) Amount-weighted mean over every allocation
  ✅ Big invoices count more, which matches cash impact
  ✅ Part-payments are counted, so instalment payers show up sooner
  ❌ Mixed currencies need conversion before weighting, and instalments make slow payers look fast
Net: A trades a slightly less familiar word ("typically") for a figure one outlier can't distort.
Header: Days to paid
Options:
A) Median, fully settled (recommended)
Each Owed entry fully settled with its last payment inside the 12-month history counts once: days = that payment's received date − the entry's date, never below 0. Median per client and overall; hidden below 3 entries. Human ~3h / CC ~20min; low risk; pure function, unit-tested.
B) Mean, fully settled
Same sample and minimum of 3 as A, but the mean. Human ~3h / CC ~20min; one outlier can swing it.
C) Weighted over allocations
Every allocation counts, weighted by amount per currency: days = its payment's received date − the entry's date. Hidden below 3 allocations. Human ~5h / CC ~30min; needs conversion and flatters instalment payers.

State: approved
Actual answer: A) Median, fully settled (Basel, D2, 2026-10-24)
Accepted scope: `summarizeActivity` computes `daysToPaid` overall and per client. The sample is each Owed entry with status SETTLED whose latest allocating POSTED payment has `receivedOn` inside the 12-month history window. Days = that `receivedOn` − the entry's `postingDate`, clamped at ≥ 0. The statistic is the median, with `n`, and it is null below 3 samples. The route reads the window's payments → `listAllocationsFor` → `receivables.getByIds`. Unit tests cover partial-then-full settlement, an outlier, n=2 → null, a reversed payment excluded, and the clamp.
History: none

### R3: What insights do when amounts can't be converted
Finding: A2, P2, confidence 7/10, plan §4.3 `combine(blocks[], rates)` + B5, reviewer: Claude (eng review)
Plan baseline: original proposal: the hero falls back to per-currency figures when a rate is missing (§4.4); insights' behaviour then is unspecified
Runtime evidence: `convertTotal` returns null when any currency lacks a rate (`expenseGroups.ts:250-262`); signed-out offline gets no rates (MUT-287 caches `mut-local-fx` for 1h only); JOD is derived from the USD peg (prior learning frankfurter-no-jod)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 insights with all rates | unspecified | computed on ≈ base amounts at today's rate | same as A |
| R3 insights with a missing rate | unspecified | computed in the **largest currency in view** only, with a line "In ILS only: today's rates aren't available" | **hidden** when more than one currency is in view, with one line "Insights come back when today's rates load"; a single-currency view never needs rates |
| R2 days to paid | approved (D2 A) | unchanged; it is days, not money, so conversion doesn't affect it | unchanged |
| Other choices (D4–D6) | pending | pending | pending |
Question D3:
D3 — What should insights do when today's exchange rates aren't available?
Project/branch/task: mini-crm on main, planning MUT-175 (portal Reports), Section 1 Architecture.
ELI10: Insights like "Food is up ₪300" compare money across months. With two currencies they need one unit, so they use today's converted amounts. Sometimes there are no rates: signed out and offline, or a currency the rate feed lacks. The hero already falls back to showing each currency on its own, but the insights need a rule too. They can keep working in the user's biggest currency only and say so, or they can step aside until rates come back.
Stakes if we pick wrong: either an insight quietly ignores the user's USD money, or a user with two currencies loses all insights whenever they are offline signed out.
Recommendation: A because most users have one main currency, and a labelled single-currency insight is honest and still useful offline.
Completeness: A=9/10, B=7/10
Pros / cons:
A) Largest currency only, labelled (recommended)
  ✅ A two-currency user still gets insights for their main currency when rates are missing
  ✅ The label says plainly what was left out, so nothing is silently dropped
  ❌ One more branch to test, and the label copy is needed in English and Arabic
B) Hide insights until rates load
  ✅ Simplest rule: insights are always over everything in view, or not shown
  ✅ No partial-truth sentences to word carefully
  ❌ A user with two currencies gets no insights at all whenever they are offline signed out
Net: A keeps insights useful in the common case at the cost of one labelled branch.
Header: No FX insights
Options:
A) Largest currency, labelled (recommended)
With all rates, insights use the ≈ base amounts. With a rate missing, they use only the largest currency in view and show "In {currency} only: today's rates aren't available" (en + ar). A single-currency view never needs rates. Human ~2h / CC ~15min; low risk.
B) Hide until rates load
With all rates, same as A. With a rate missing (and more than one currency in view), insights are hidden behind one line: "Insights come back when today's rates load". Human ~1h / CC ~10min; loses insights offline for multi-currency users.

State: approved
Actual answer: A) Largest currency, labelled (Basel, D3, 2026-10-24)
Accepted scope: `buildInsights` takes amounts in one unit. With every rate present, that is the ≈ base amounts (`convertTotal`). With a rate missing and more than one currency in view, it is the largest currency in view only, and `InsightList` shows "In {currency} only: today's rates aren't available" (en + ar, `hosted.reports.insights.singleCurrency`). A single-currency view never asks for rates. Unit test: a missing rate with ILS + USD → ILS-only insights plus the label; a component test checks the label.
History: none

### Section 2: Code quality

- **C1** [P2] (confidence 8/10) plan §4.3 `useReportActivity` "skips profiles that answer 403": a 403 is handled, but a **failed or slow** request for one profile (network, 5xx, local backend stopped) is not. Open choice: **D4**.
- **C2** [P3] (confidence 9/10) plan §4.3 i18n: "Insight sentences use ICU plurals". The portal has no ICU parser. Plurals go through `tp(key, count)` over `Intl.PluralRules` (`src/lib/i18n/plural.ts:6-17`, ADR-019), with Arabic forms zero/one/two/few/many/other. **Factual correction:** the insight copy uses `tp`, and the Arabic keys carry all six forms.
- **C3** [P3] (confidence 8/10) shared code: `convertTotal(summary: ExpenseGroupSummary, …)` reads only `summary.currencies[].currency/total` (`expenseGroups.ts:250-262`). Widening the parameter to that structural type is **reuse, not extraction**: one existing caller (`ExpenseGroupDetail.tsx:494`) and one new caller (ReportsPage), net about +1 line, no new module. Settled by D1.
- **C4** [P2] (confidence 8/10) `DayBars` gains a second series and month bars in place (D1). The props are already group-shaped (`gapLabel`, `hasOther`), so the extension must keep the expense-group chart identical. That regression contract is decided in Section 3 (**D5**).

Dispositions: C1 → D4 pending; C2 corrected; C3 settled by D1; C4 → D5 (Section 3).

### R4: What the page does when one profile's report fails to load
Finding: C1, P2, confidence 8/10, plan §4.3 `useReportActivity` + §4.4, reviewer: Claude (eng review)
Plan baseline: original proposal: a 403 profile is named and left out, and the rest renders (§4.4, AC7). Other failures are unspecified.
Runtime evidence: the portal's lists use `QueryView` with a page-level error and Retry (`src/hosted/components/QueryView.tsx`); TanStack `useQueries` gives each profile its own status, so per-profile handling is possible without new infrastructure
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 one profile fails (network/5xx) in All profiles | unspecified | its chip shows "Couldn't load · Retry"; totals, chart and insights cover the loaded profiles, with a line "Partial: {profile} isn't included" | the whole report shows the QueryView error card with Retry |
| R4 one profile is slow | unspecified | the others render; the slow one's chip shows a spinner, and the totals animate again when it arrives | the whole page waits on the slowest |
| R4 One-profile view fails | unspecified | the QueryView error card with Retry | same |
| 403 handling (§4.4) | proposed | unchanged ("not included: you can't see its payments") | unchanged |
| D2, D3 | approved | unchanged | unchanged |
Question D4:
D4 — When one profile's report fails to load in "All profiles", what should the page do?
Project/branch/task: mini-crm on main, planning MUT-175 (portal Reports), Section 2 Code quality.
ELI10: "All profiles" loads one report per profile, up to about six at once. If one of them fails (a network blip, a server error) or is slow, the page can either show what it has and say clearly what is missing, or refuse to show anything until everything loads. Showing partial totals without saying so would be the worst case, because the numbers would silently be too low.
Stakes if we pick wrong: either users see totals that are quietly too low, or one flaky profile blanks the whole screen and the page feels broken.
Recommendation: A because each profile already loads independently, and a named "partial" line keeps the numbers honest while the rest of the page stays usable.
Completeness: A=9/10, B=7/10
Pros / cons:
A) Show the rest, name what's missing (recommended)
  ✅ One slow or failing profile never blanks the screen; the others render as soon as they arrive
  ✅ The "Partial: … isn't included" line and the chip's Retry make the gap visible and fixable
  ❌ More states to test (loading, failed and retried per chip), and totals animate twice when a late profile lands
B) All-or-nothing error card
  ✅ Reuses QueryView exactly, so there is one error pattern across the portal
  ✅ The totals are never partial, so there is nothing to explain
  ❌ One flaky profile hides five good ones, and the slowest profile sets the load time
Net: A costs a few more tested states and keeps the page useful and honest when one profile misbehaves.
Header: Partial load
Options:
A) Show the rest, name the gap (recommended)
In All profiles each profile loads on its own. A failed one's chip shows "Couldn't load · Retry", and the page adds "Partial: {profile} isn't included". Totals, chart and insights cover the loaded profiles. A slow one shows a spinner chip, and the totals animate again when it lands. One-profile view keeps the QueryView error card. Human ~3h / CC ~20min.
B) All-or-nothing error card
Any failed profile shows the page-level QueryView error card with Retry; the page renders only when every profile has loaded. Human ~1h / CC ~5min; one flaky profile blanks the page.

State: approved
Actual answer: A) Show the rest, name the gap (Basel, D4, 2026-10-24)
Accepted scope: in All profiles, `useReportActivity` keeps each profile's query status separate. A failed profile's chip shows "Couldn't load · Retry" (retries only that query), and the page shows "Partial: {profile} isn't included" (en + ar). Totals, chart and insights cover the loaded profiles. A slow profile's chip shows a spinner, and the hero animates again when it lands. The One-profile view uses the QueryView error card. A 403 is unchanged ("not included"). Component tests: a failed profile → partial line, chip Retry refetches only that profile; a late profile → totals update.
History: none

### Section 3: Tests

Framework: Vitest (unit, component, Dexie/memory integration) + Playwright release-QA (CLAUDE.md Phase 4/5); server Vitest + `test:db` on Postgres.

```
CODE PATHS (planned)                                        USER FLOWS
[+] server/src/summaries/activity.ts summarizeActivity()    [+] Open Reports (first month)
  ├── [GAP→unit] day / month buckets, edges, empty range       ├── [GAP→E2E] basics + teaser  @portal.reports.first-month
  ├── [GAP→unit] REVERSED excluded; JOD exponent 3             ├── [GAP→E2E] month 3: best month, average, concentration,
  ├── [GAP→unit] 12-month history, current month partial       │              days to paid  @portal.reports.third-month
  ├── [GAP→unit] daysToPaid median (D2): partial→full,         ├── [GAP→E2E] category mover  @portal.reports.category-mover
  │               outlier, n=2→null, clamp, reversed           ├── [GAP→E2E] All vs one profile + chips  @…all-vs-one-profile
  └── [GAP→unit] byCategory reuses summarizeExpenses           ├── [GAP→E2E] ≈ popover shows exact per currency  @…converted-breakdown
[+] routes/summaries.ts GET /v1/summaries/activity            ├── [GAP→E2E] week / month / year + ‹ ›  @…period-step
  ├── [GAP→route] summaries:read + expenses:read, SESSION_ONLY ├── [GAP→E2E] Arabic RTL  @portal.reports.arabic
  ├── [GAP→route] END_BEFORE_START 422                          └── [GAP→E2E] signed out (local mode)  @portal.reports.signed-out
  ├── [GAP→route] org-timezone today edge                     [+] Error states
  └── [★★ TESTED] portal-routes-coverage (existing, extends)   ├── [GAP→component] one profile fails → partial line (D4)
[+] repositories listAllocationsFor (prisma + memory)          ├── [GAP→component] one profile 403 → "not included"
  └── [GAP→contract] store-contract-m4.ts: IN list, foreign ids ├── [GAP→component] missing rate → per-currency hero + D3 label
[+] src/hosted/data/reports.ts                                 └── [GAP→component] empty period → capture actions
  ├── [GAP→unit] periodOf / step across year end, weekStart ar/en
  ├── [GAP→unit] stageOf from history (A4: combined profiles)
  └── [GAP→unit] combine across profiles, date alignment
[+] src/hosted/data/reportInsights.ts buildInsights()
  ├── [GAP→unit] each insight: just above / just below threshold
  ├── [GAP→unit] ranking + cap 3, nextUnlock per stage
  └── [GAP→unit] single-currency fallback (D3)
[+] DayBars (extended in place)
  ├── [★★ TESTED] tab stop, arrows, RTL — DayBars.test.tsx:31,41,56
  └── [GAP→component] two series, month bars; single series unchanged → D5
[+] convertTotal (widened type)
  └── [★★★ TESTED] expenseGroups.test.ts:285-299 (JOD peg, missing rate → null)

COVERAGE: 3/30 paths tested today (all planned code is new) | GAPS: 27 (8 E2E)
QUALITY: ★★★:1 ★★:2
```

Value cards (critical paths):
- Value: protects=Reports totals match the profiles' payments and expenses; fails_when=REVERSED payments or other-currency rows leak into Received; why_new=no activity summary exists; seam=none; no_claim=Postgres query plans (memory store in unit tests; test:db covers Prisma)
- Value: protects=days to paid = median over fully settled Owed (D2); fails_when=partial payments counted or the mean is used; why_new=new metric; seam=none; no_claim=none beyond protects
- Value: protects=a failed profile is named, never silently dropped (D4); fails_when=totals render without the partial line; why_new=new fan-out; seam=none; no_claim=real network timeouts (mocked query error)

Findings:
- **T1** [P1] (confidence 9/10) `src/hosted/components/groups/__tests__/DayBars.test.tsx:31-56`: only 3 tests pin `DayBars` (tab stop, arrows, RTL). Nothing pins each bar's spoken text, the other-currency dot, the gap labels, the selected bar or reduced motion. Extending `DayBars` in place (D1) puts the expense-group chart at risk. **Regression contract: D5.**
- **T2** [P2] (confidence 8/10) `server/src/repositories/__tests__/store-contract-m4.ts`: `listAllocationsFor` must join the shared store contract so Prisma and memory agree (an IN list, ids from another organization ignored, an empty list → []). This is required proof of the accepted D1 arrangement, so no question is needed.
- **T3** [P2] (confidence 8/10) the local-mode parity test (`src/hosted/local`) must cover the new route: required proof of P2/ADR-097, so no question is needed.

Dispositions: T1 → D5 pending; T2, T3 added as required proof of D1.

### R5: Regression contract for the expense-group chart when DayBars is extended
Finding: T1, P1, confidence 9/10, `DayBars.test.tsx:31-56`, reviewer: Claude (eng review)
Plan baseline: D1 approved "DayBars extended in place"; regression coverage unspecified
Runtime evidence: 3 DayBars tests (tab stop, arrows, RTL); expense-group QA specs exist (`qa/features/portal/expense-groups.yaml`: create, leave-out-undo, add-from-outside, currencies-converted, category-prune)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 characterization tests before changing DayBars | none | added first: single series renders one bar per day with the same `describe` text, the other-currency dot, the gap labels, the selected state, and no transition under reduced motion | none |
| R5 expense-group release-QA | exists | run before and after the change (`--only` expense-groups) | run once at the gate |
| R5 intended differences | unspecified | none for single-series callers; `series`, `bucket` and the second colour are opt-in props | same |
| D1–D4 | approved | unchanged | unchanged |
Question D5:
D5 — How do we prove the expense-group chart is unchanged when DayBars learns a second series?
Project/branch/task: mini-crm on main, planning MUT-175 (portal Reports), Section 3 Tests.
ELI10: D1 extends the existing day-by-day bar chart in place so Reports can show received and spent side by side. That chart already ships in expense groups, and only 3 tests guard it (keyboard focus, arrow keys, right-to-left). What each bar announces to screen readers, the dot for other-currency days, the gap labels and the reduced-motion behaviour are unguarded. We can pin those first, then extend, or rely on what exists.
Stakes if we pick wrong: a trip's chart silently loses its spoken amounts or its reduced-motion behaviour, and nobody notices until a user complains.
Recommendation: A because pinning the current behaviour before the change is the only way to know the extension changed nothing for groups.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Pin current behaviour first (recommended)
  ✅ The tests are written against today's chart, so they would catch any drift the extension causes
  ✅ Groups' release-QA runs before and after, so the real flows are compared, not just units
  ❌ About 6 more component tests and one extra QA run before the Reports work starts
B) Existing tests plus the gate
  ✅ No extra work before the Reports code starts
  ✅ The gate still runs the expense-group specs once
  ❌ The spoken text, the other-currency dot and reduced motion stay unguarded, so drift can pass the gate
Net: A spends about 15 minutes of CC time (about 2 hours by hand) up front to make the in-place extension provably safe.
Header: Chart guard
Options:
A) Pin current behaviour first (recommended)
Before touching DayBars: add tests pinning one bar per day, each bar's `describe` text, the other-currency dot, the gap labels, the selected bar and reduced motion (no transition). Run `@portal.expense-groups.*` release-QA before and after. New props (second series, month bucket) are opt-in, with no change for single-series callers. Human ~2h / CC ~15min.
B) Existing tests plus the gate
Keep the 3 existing DayBars tests; the expense-group QA specs run once at the final gate. New props are opt-in as in A. No extra time; the unguarded behaviour stays unguarded.

State: approved
Actual answer: A) Pin current behaviour first (Basel, D5, 2026-10-24)
Accepted scope: first commit of the build, before any `DayBars` change: characterization tests in `DayBars.test.tsx` pinning one bar per day, each bar's `describe` text (accessible name + tooltip), the other-currency dot (`hasOther`), the gap labels, the selected bar and reduced motion (no transition). `release-qa run --only` the `@portal.expense-groups.*` specs before and after the change, both green. Intended differences: none for single-series callers. The second series, the month bucket and the second colour are opt-in props.
History: none

Test Plan artifact: `~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261024-160911.md`.

### Section 4: Performance

- **F1** [P3] (confidence 7/10) request fan-out: All profiles = one activity request per profile in view. That is at most 6 owned profiles plus memberships [estimated: cap of 6 owned, MUT-181]. Each request is cached per (profile, period, bucket) under the portal's `STALE_MS = 30_000` (`src/hosted/queryClient.ts:9`). Stepping ‹ › issues new keys; stepping back to a period already seen is served from cache. No change.
- **F2** [P3] (confidence 7/10) per-request reads: the window is at most ~13 months (Year = 12 months; Month/Week reads the 12-month history ending with the period, structurally capped). The rows are POSTED payments plus expenses through `listAll` in pages of 200, then one `IN` read of allocations and one `getByIds` of receivables. The scale is unknown [no production row counts measured]. It is the same in-memory shape as `/v1/summaries/organization`. A SQL `GROUP BY` is the step if a profile's year passes ~10k rows (TD-221, already in §4.2).
- **F3** [P3] (confidence 8/10) the old N+1 risk is gone: allocations are read once per request with `listAllocationsFor` (D1), not once per payment (`ports.ts:1164`).
- No caching or memory issues beyond these. The local mode backend reads the in-page `MemoryLedgerStore`, so there is no network cost signed out.

Dispositions: F1–F3 noted, no choices needed.

### R6: Measure Reports use with one opt-in analytics event
Finding: Final planning (instrumentation), P3, confidence 8/10, `src/lib/analytics/posthogConfig.ts:49` (portal `capture_pageview: false`), `docs/analytics/events.json` v2.1.0 (13 events, none for Reports), reviewer: Claude (eng review)
Plan baseline: original proposal: "One opt-in event, `report_viewed {period, scope, stage}`, added to the MUT-153 taxonomy" (not approved)
Runtime evidence: the portal sends no page views (`capture_pageview: false`), so without an event Reports use is unmeasurable. The taxonomy is contract-pinned: `scripts/__tests__/analytics-taxonomy.test.ts:20-23,216` pins each version's sha256 (prior learning analytics-contract-pins-server-currencies). Signed out never sends (ADR-024; `HostedShell.tsx` syncs usage only when `!local`).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R6 event | none | `report_viewed {period: week\|month\|year, scope: all\|profile, stage: 1\|2\|3}`, once per page open and once per period/scope change (debounced 1 s), opted-in signed-in only | none |
| R6 taxonomy | v2.1.0 | v2.2.0 + `PINNED_VERSIONS` row + `events.json` entry in the same commit | unchanged |
| D1–D5 | approved | unchanged | unchanged |
Question D6:
D6 — Should Reports send one opt-in analytics event so we can see it being used?
Project/branch/task: mini-crm on main, planning MUT-175 (portal Reports), final planning decisions.
ELI10: You called Reports a very important screen. Right now the portal doesn't record page views at all, so after launch we couldn't tell whether anyone opens Reports, which period they look at, or whether month-3 users come back. One small event (only for people who opted in, never signed out, no amounts or names) would answer that. It means bumping the analytics contract file, which a test pins.
Stakes if we pick wrong: either we ship the most important screen blind, or we add tracking nobody reads.
Recommendation: A because this is the screen meant to bring people back weekly, and opted-in, property-light usage is the only way to know whether it does.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add `report_viewed` (recommended)
  ✅ Shows whether people open Reports and which period and stage they're in, without any amounts or names
  ✅ Follows the MUT-152 taxonomy and opt-in rules; signed out never sends
  ❌ A contract bump (v2.2.0 + pinned hash) and one more event to keep in the privacy text's scope
B) No event
  ✅ No taxonomy change and nothing new to explain in the privacy promise
  ✅ Fewer moving parts in the build
  ❌ No way to tell after launch whether the "very important screen" is being used
Net: A adds one small, opt-in event and a contract bump to make the screen's success measurable.
Header: Reports event
Options:
A) Add report_viewed (recommended)
Opted-in, signed-in only: `report_viewed {period, scope, stage}` on open and on a period or scope change (debounced 1 s). No amounts, names or profile ids. Taxonomy v2.2.0 with the pinned sha256 row and the `events.json` entry in the same commit, and a unit test that signed out sends nothing. Human ~2h / CC ~15min.
B) No event
Ship without instrumentation; Reports use stays unmeasured. No taxonomy change.

State: approved
Actual answer: A) Add report_viewed (Basel, D6, 2026-10-24)
Accepted scope: `report_viewed {period: week|month|year, scope: all|profile, stage: 1|2|3}` is sent through the portal's opt-in analytics, signed in only. It fires on page open and on a period or scope change, debounced 1 s. It carries no amounts, names or profile ids. `docs/analytics/events.json` goes to v2.2.0 with the event entry, and `PINNED_VERSIONS` gets the new sha256 row in the same commit. Tests: the taxonomy contract test passes, and a unit test proves signed out sends nothing.
History: none

Approval readiness: PASS. Checked R2 (D2 A), R3 (D3 A), R4 (D4 A), R5 (D5 A) and R6 (D6 A), plus the scope record (D1 B), all Basel 2026-10-24. Factual corrections S1, C2 and C3 need no approval. T2 and T3 are required proof of D1.

### Outside voice

Unavailable: the Codex CLI isn't installed, and the native Plan fallback did not finish within the five-minute limit (stopped, no partial credit). Logged `codex-plan-review` status unavailable. No cross-model check took place.

### TODOS.md

No new TODOs. The one deferral (SQL aggregation for `/v1/summaries/activity`) is already tracked as TD-221 in `.claude/TECH_DEBT.md` by §6. The CSV gap (§9) is a product decision for Basel before MUT-292 and goes on the ticket, not into TODOS.md.

### NOT in scope

- Pace against last month, ▲/▼ chips and the last-month line: not chosen (B4).
- CSV export of reports: Basel decides before MUT-292 (§9).
- Historical-rate conversion: B5 uses today's rate, labelled as such.
- VAT summary (MUT-313) and the accountant pack (MUT-314): firm-books tickets.
- A SQL `GROUP BY` for the activity route: TD-221, done only when row counts call for it.
- A lazy route chunk and a `components/charts/` folder: dropped by D1.

### What already exists (reused, not rebuilt)

- `summarizeExpenses` (`server/src/expenses/summary.ts:24`) → byCategory in the activity summary.
- `listAll` (`server/src/routes/summaries.ts:195`) → paging payments and expenses.
- `receivables.getByIds` (`ports.ts`) → receivables for days to paid.
- `/v1/summaries/organization` via `useOrganizationSummary` (`src/hosted/data/queries.ts:40`) → Owed now, already cached by Overview.
- `useFxRates` + `convertTotal` (`expenseGroupQueries.ts:85`, `expenseGroups.ts:250`) → the ≈ figure (type widened, C3).
- `weekStart` (`expenseGroups.ts:62`) → week buckets in the portal (D1).
- `DayBars` (extended in place, D1/D5) and `CategoryBars` (as is) → the chart, "Where it went" and "Who paid".
- `useSpringScale` and `motion` → the motion.
- `tp` plurals (`src/lib/i18n/plural.ts`) → the insight copy (C2).
- `QueryView` → the One-profile error card (D4).
- `PORTAL_ROUTES` → the local mode backend runs the route as is.

### Failure modes

| Path | Realistic failure | Handling | Test | User sees |
|---|---|---|---|---|
| activity route | a profile's request 5xx or network error | D4 per-chip Retry and partial line | component | clear |
| activity route | a forbidden profile (403) | "not included" chip | component | clear |
| FX rates | rates unavailable or a currency without a rate | per-currency hero, D3 single-currency insights with a label | unit + component | clear |
| days to paid | fewer than 3 settled entries | the metric is null and its insight hidden | unit | n/a (nothing claimed) |
| local backend | backend stopped (ADR-100 §9) | the existing `ReloadToContinue` replaces every route | existing | clear |
| DayBars extension | the group chart drifts | D5 characterization tests and groups QA before and after | component + E2E | n/a (caught pre-merge) |

Critical gaps: 0.

### Worktree parallelization

| Step | Modules touched | Depends on |
|---|---|---|
| S1 DayBars characterization (D5) | src/hosted/components/groups | — |
| S2 activity route + store method | server/src (summaries, routes, repositories, schemas) | — |
| S3 portal data (reports, insights, queries) | src/hosted/data | S2 (API types) |
| S4 UI + route + nav + i18n + analytics | src/hosted (pages, components, shell, i18n, analytics), docs/analytics | S1, S3 |
| S5 release-QA + knowledge files | qa/, .claude/ | S4 |

Lane A: S1 → (waits) S4. Lane B: S2 → S3 → S4 → S5. Launch A and B together; S4 starts when both finish. Conflict flags: none (disjoint modules until S4). In practice this is one ticket, one worktree, one branch (project rule: one worktree per repo per epic), so the lanes are an ordering, not separate sessions.

## 11. Design review (/plan-design-review, 2026-10-24)

Target: this file. No DESIGN.md exists; Brand v2 is the design system (`src/styles/brand/mutaba3a.tokens.json` → `mutaba3a-theme.css` → `theme.css`). The gstack designer has no OpenAI key, so no mockup images were made, and the in-session interactive mockup is the visual reference. Outside voice: one Claude design subagent (Codex not installed). Its findings are tagged [OV] below. Step 0 rating: **5/10**. Focus: all 7 passes (D1). Design decisions are numbered DR-n and cite Basel's answer (D-number of this review).

### Pass 1: Information architecture (5/10 → 10/10)

Page structure (accepted, desktop; at 375px each row keeps this order):

```
[ Week | Month | Year ]                                   [‹] [›]      ← DR1 one control row
[All profiles][Personal][Studio Lina]  (scrolls sideways; only with 2+ readable profiles)
Received ≈ ₪16,600                                         ← DR4 fluid hero, whole units
October 2026 · so far   (caption; ≈ opens the per-currency breakdown)
Spent ₪4,300        Kept ₪12,300                           ← headline size, 2 columns at 375
Owed to you now ≈ ₪7,400 ›                                 ← DR2 its own line, static on steps
── Insights (only when ≥1 exists; teaser last inside) ──   ← DR3
── Day by day chart ──
── Where it went ──        ── Who paid ──   (side by side ≥ 900px, stacked below)
── Teaser (only when there are zero insights) ──           ← DR3
```

- **DR1** (D3, 1A): one control row: the Week | Month | Year segmented control at the inline-start, ‹ › at the inline-end. The period name ("October 2026 · so far") is the hero caption at label size. ~~The profile chips are one sideways-scrolling row~~. **Superseded by DS2/DS4 (§13):** no chips; the "All profiles" switch sits at the end of this row, shown only with 2+ readable profiles.
- **DR2** (D4, 2A): the hero row holds the period figures only (Received, Spent, Kept). "Owed to you now ≈ {amount} ›" is its own line under the hero. It links to Owed to you and never animates on period steps. In All profiles it sums each included profile's `/v1/summaries/organization` outstanding (one cached query per profile), converted like the hero.
- **DR3** (D5, 3A): with zero insights the order is Hero, Owed line, Chart, Where it went, Who paid, Teaser. With one or more: Hero, Owed line, Insights (the teaser as the block's last line), Chart, Where it went, Who paid.
- **DR4** (D6, 4A): hero Received is `clamp(1.75rem, 8vw, 2.5rem)` Plex Mono, whole units, one line (tested with a 7-digit JOD amount). Spent and Kept are `--text-headline` (20px), two columns at 375px and inline on desktop. The exact minor units appear only in the ≈ popover.

The one gap left after Pass 1 (how insights relate to the period shown) was closed by DR16 in Pass 3, so Pass 1 is now 10/10.

### Pass 2: Interaction states (4/10 → 10/10)

- **DR5** (D7, 5A): activity queries use `placeholderData: keepPreviousData`. While a new period or scope is fetching, content sits at opacity 0.6 (150ms) with `aria-busy` on the region, then figures and bars morph to the new values. The skeleton (hero block, 168px chart, 3 bar rows) shows on first load only.
- **DR6** (D8, 6A): **first run** (`dataSince` null for every profile in view) is one block: the headline "Your reports start with your first payment or expense", one sentence and the two capture actions, with no controls, chart, insights or teaser. An **empty period with older data** shows "Nothing logged this {period}" plus "Go to {period}" (the latest period with data, from the history).
- **DR7** (D9, 7A): "Where it went" keeps its heading with the muted line "No spending this {period}" and never renders an empty bar list. "Who paid" is hidden when Received is 0. Zero days keep `hp-daybar-zero`.
- **DR8** (D10, 8A): the empty-state actions open the existing income and expense drawers for the profile in the URL. An action is hidden when that profile can't perform it (`/v1/me` writability). If neither is possible, the empty line shows alone.
- **DR9** (D11, 9A): with 2+ currencies, the hero and the Owed line stay skeleton until rates settle or 1.5s pass. Single-currency views never wait. The fallback (D3) is per-currency figures, stacked one per line at 375px (headline size) and side by side on desktop. Rates arriving after the fallback swap in without a count-up.
- **DR10** (D12, 10A): in All profiles, when no profile has loaded and at least one failed, show the QueryView error card; its Retry refetches every failed profile. D4's partial line applies only when 1+ profile loaded.
- **DR11** (D13, 11A). **Superseded by DS2 (§13): there are no chips.** A failed or forbidden profile is named in the combined line with its own Retry. The chip states below are kept only as history:
  - Included: `--m-lavender` background, `--m-lavender-ink` text, `aria-pressed=true`.
  - Left out: `--surface-2` background, `--muted` text, `aria-pressed=false`.
  - Loading: a 12px spinner at the same width.
  - Failed: rose-ink label plus its own 44px Retry button (the chip itself still toggles).
  - Forbidden: muted, `aria-disabled`, an info icon carrying the reason.
  - D4's partial line sits under the hero as `.hp-banner-info`.
- **DR12** (D14, 12A): `HostedShell` hides Reports for a profile whose role can't read payments. The rule lands with MUT-305's role in `/v1/me`; until then everyone sees it. A 403 in One-profile view or on a deep link shows a plain explainer, "You can't see this profile's payments. Ask an owner." (en/ar), not the error card.
- **DR13** (D15, 13A):
  - Future buckets: no fill, 40% opacity, not focusable, no tooltip.
  - Today: a 2px `--m-line` dot under the axis.
  - Before `dataSince`: the `.hp-daybars-gap` label "before you started".
  - Real zero days: `hp-daybar-zero`.

```
  FEATURE          | LOADING                      | EMPTY                               | ERROR                                  | SUCCESS               | PARTIAL
  -----------------|------------------------------|-------------------------------------|----------------------------------------|-----------------------|-----------------------------
  Page (first load)| layout-shaped skeleton (DR5) | first run (DR6)                     | One-profile: QueryView; 403: explainer (DR12) | full page      | —
  Period/scope step| previous data dimmed 0.6, morph (DR5) | "Nothing logged…" + Go to (DR6) | QueryView / DR10                   | morph to new values   | —
  All profiles     | chip spinner (DR11)          | first run if no data anywhere       | all failed → QueryView (DR10)          | chips included        | partial line + chip Retry (D4, DR11)
  Hero ≈           | skeleton ≤1.5s for rates (DR9)| part of first run / empty period   | rates missing → per-currency (D3, DR9) | ≈ + caption           | —
  Owed line        | with hero (DR9)              | "Owed to you now ₪0" (no link)      | hidden with its profile's failure      | ≈ amount ›            | sums loaded profiles only
  Chart            | skeleton 168px               | zero days hp-daybar-zero            | with page                              | bars                  | future faint, pre-start gap (DR13)
  Where it went    | skeleton rows                | "No spending this {period}" (DR7)   | with page                              | CategoryBars          | —
  Who paid         | skeleton rows                | hidden when Received 0 (DR7)        | with page                              | bars + days to paid   | —
  Insights         | with page                    | teaser last on page (DR3)           | single-currency label (D3)             | ≤3 sentences          | —
```

### Pass 3: User journey and emotional arc (5/10 → 10/10)

- **DR14** (D16, 14A): movers compare the **two latest complete months**, named by month ("September vs August"). A month counts as complete, for staging and for comparisons, only if `dataSince` falls on or before its 7th day. Pinned by unit tests at the 7th/8th boundary.
- **DR15** (D17, Basel "First-month recap"): **amends B4.** Stage 2's new insight is a factual **recap of the first complete month**: received, spent, the top category and the top client of that month, with no comparison. **Category movers move to stage 3**, alongside averages, best month, concentration and days to paid. (Plain reason: in month 2 only one finished month exists, so any comparison would involve the current partial month, which is either pace, excluded in B4, or misleading.)
- **DR16** (D18): insights always describe the latest complete months and do **not** change while stepping or switching Week/Month/Year. They sit under a small heading "Lately" (مؤخرًا).
- **DR17** (D19): when the chosen scope has a lower stage than All profiles, the teaser reads "{profile} started in {month}; insights unlock in {month}" (en/ar). **Extended by DS5 (§13):** with the switch off, the teaser adds a button "See insights across all profiles" that turns the switch on.
- **DR18** (D20): an insight whose fact is unchanged, and that was shown on 3 earlier visits, ranks below fresh ones. A changed fact (a new best month, a new top mover) always ranks first. The counts live in `localStorage` per profile set, wrapped in try/catch: no storage means no rotation.
- **DR19** (D21): insight copy is factual and never evaluative, and insight numbers use normal ink with no red or green. A negative Kept renders "−₪500" in normal ink with the caption "Spent more than came in" (en/ar).

Storyboard (accepted behaviour):

```
  STEP | USER DOES                          | USER FEELS                    | PLAN SPECIFIES
  -----|------------------------------------|-------------------------------|------------------------------------------
  0    | Opens Reports with no records      | curious, unsure where to start| first-run block + 2 capture actions (DR6)
  1    | Month 1, opens Reports             | "this is mine" (5-sec)        | hero counts up, bars grow, teaser last (DR3, DR4)
  2    | Taps ≈ on Received                 | trust: "where's this from?"   | exact per-currency + ECB date popover (B5)
  3    | Steps ‹ to last week               | in control, fast              | dimmed previous → morph (DR5)
  4    | Month 2 opens Reports              | rewarded: something new       | first-full-month recap under "Lately" (DR15, DR16)
  5    | Switches to one young profile      | puzzled → reassured           | teaser explains when it unlocks (DR17)
  6    | Month 3+, weekly visits            | learning about the business   | movers, average, best month, concentration, days to paid; repeats rotate (DR18)
  7    | A slow month                       | calm, not judged              | neutral copy, no red, "Spent more than came in" (DR19)
```

Time horizons: 5-second (hero count-up, one anchor figure), 5-minute (stepping, ≈ breakdown, the lists), 5-year (insights stay true, rotate, never scold).

### Pass 4: AI slop risk (7/10 → 9/10)

Classifier: **OPERATE** (app UI). Hard rejections: none. Litmus checks:

| # | Check | Answer |
|---|---|---|
| 1 | Brand in the first screen | YES (the portal shell) |
| 2 | One visual anchor | YES (DR4) |
| 3 | Scannable by headlines | YES after DR16's "Lately" |
| 4 | One job per section | YES after DR2 |
| 5 | Cards necessary | none used |
| 6 | Motion helps hierarchy | YES after DR21 |
| 7 | Premium without shadows | YES |

- **DR20** (D22): insights are a plain list under "Lately": one sentence each, with the key figure in `--font-mono`, separated by hairlines. No icons, no circles, no colour. (This replaces the pastel icon circles in the session mockup, which matched slop pattern #3.)
- **DR21** (D23), motion:
  - First load: Received, Spent and Kept count up from 0 over 600ms ease-out. Bars grow with a 12ms stagger, ≤ 300ms in total.
  - Period or scope change: morph over 400ms with `--m-ease-spring`.
  - A late profile (D4) morphs without recounting.
  - Zero delta or a hidden tab: no animation.
  - `prefers-reduced-motion`: instant (`useSpringScale`'s rule).
  - Animated digits are `aria-hidden`; the final value is in an sr-only span. No `aria-live` on numbers.

Remaining gap (keeps it at 9): one authored moment is specified, but its feel is unverified until a visual QA (`/design-review` after build), since there is no mockup image.

### Pass 5: Design system alignment (5/10 → 10/10)

No DESIGN.md (gap noted; `/design-consultation` is not needed because Brand v2 tokens cover this screen).

- **DR22** (D24): Received = `--m-mint-ink` (matches the Paid badge); Spent = `--m-primary` (matches expense groups). Both are checked at ≥ 3:1 against the canvas in light and dark. An inline legend sits above the chart (8px swatches, "Received" / "Spent"), and each bar's accessible name carries the words.
- **DR23** (D25):
  - `CategoryBars` gains an optional `meta` (end-aligned, `--muted`, label size: "typically 14 days", "biggest change") and an optional `onSelect`. With no `onSelect`, rows render as non-interactive `div`s.
  - Amounts are ≈ base currency (B5), with D3's "In {currency} only" label when conversion fails.
  - D5's characterization tests extend to `CategoryBars`.
- **DR24** (D26): the teaser has a 1.5px dashed `--m-line` border, `--radius-lg` and `--space-4` padding. It shows a muted lock icon (`aria-hidden`) and one sentence naming the unlock month. No button, no dismiss. It fades out over 150ms once unlocked (instant with reduced motion).
- **Restated (no new decision):**
  - The ≈ breakdown reuses `.hp-popover` (B5). Rows show currency, exact amount and the rate line, with the footer "ECB · {date} · today's rate". It closes on Esc or an outside tap and returns focus to its trigger, a ≥ 44px button.
  - Reports deliberately **inverts** the expense-groups emphasis: ≈ is the headline here and per-currency sits in the popover; groups do the reverse. This is B5's choice, so nobody should "align" one screen to the other.

### Pass 6: Responsive and accessibility (4/10 → 9/10)

| Viewport | Layout |
|---|---|
| ≥ 900px | control row; hero row inline (Received, Spent, Kept); Owed line; insights; chart 168px; Where it went and Who paid side by side |
| 480–899px | same order; the two lists stacked; chart side-by-side pairs |
| < 480px (375 design target) | control row (segmented + ‹ ›) on one line; chips scroll sideways; hero Received fluid (DR4); Spent and Kept two columns; Month chart overlaid (DR25); lists stacked |

- **DR25** (D27): below 480px, Month draws one bar per day: received at full width, spent as an inner bar at 50% width with a 2px top edge so it still shows when taller. Axis labels sit on days 1, 8, 15, 22 and 29. One focusable button per day holds both values. Week and Year keep side-by-side pairs at every width.
- **DR26** (D28): tap, click or Enter selects a bar (`DayBars`' `selected`). A line under the chart shows "{day} · Received {amount} · Spent {amount}" (en/ar), announced once with `aria-live="polite"` on selection. The default selection is today, or the last day with data. Nothing navigates away.
- **DR27** (D29): before stage 3, Year renders with `aria-disabled` and a muted look. Hover, focus or tap shows "Unlocks in {month}" (en/ar) via `aria-description`. `?period=year` before stage 3 falls back to Month in `parseReports`.
- **Restated (CLAUDE.md RTL from day one, B7):** ‹ › are previous and next in **reading order** and mirror under `dir="rtl"`. Their aria-labels are "Previous {period}" / "{period} السابق", per language. Next is disabled past the current period; previous is disabled before `dataSince`'s period. One test per language. Charts mirror (time flows right to left in Arabic), as `DayBars` already does (`DayBars.test.tsx:56`). Every amount is a plain `<bdi>` (ADR-101).
- **Restated (accessibility non-negotiables):**
  - The page is a `main` region with headings h1 Reports, then h2 for Lately, Day by day, Where it went and Who paid.
  - The segmented control is a radiogroup with arrow keys; chips are `aria-pressed` toggles.
  - Touch targets are ≥ 44px (chips, ‹ ›, the ≈ trigger, Retry).
  - Text meets 7:1 per Brand v2 (AAA inks).
  - Charts are named groups with a single tab stop and arrow-key movement (the existing `DayBars` contract).

Remaining gap (keeps it at 9): a tablet-specific check in landscape at 768–899px is only covered by the 480–899 rule. Visual QA after build confirms it.

### Pass 7: Unresolved design decisions (3 resolved, 0 deferred)

- **DR28** (D30): the third hero figure is **Kept / المتبقي**. A negative value has the caption "Spent more than came in" / "أنفقت أكثر مما دخل". **Before /eng-build:** the full en + ar copy table goes into the brief `.claude/designs/mut-175-reports.md` for Basel's sign-off. It covers every label, insight sentence, teaser, empty state, chip state and explainer, with all six Arabic `tp` forms. B2 holds: "billed" never appears.
- **DR29** (D31): ranking. Changed facts come first (DR18), then by kind: mover > concentration > days to paid > best month > 3-month average. Size breaks ties within a kind. Cap 3. Stage 2's first-month recap is the only stage-2 insight.
- **DR30** (D32): "Who paid" has one row per (profile, client). When more than one profile is in view, the profile name is a muted second line. Concentration uses the same rows. Clients are never merged by name.

| DECISION NEEDED | IF DEFERRED, WHAT HAPPENS |
|---|---|
| Arabic copy table sign-off (DR28) | not deferred: a pre-build gate in the brief |

### NOT in scope (design)

- Mockup images: the gstack designer has no OpenAI key (`~/.claude/skills/gstack/design/dist/design setup`). Visual QA happens after build with `/design-review`.
- Pace against last month (B4, and DR15's reason).
- Dismissible teasers (DR24 chose no dismiss).
- Rows that open filtered lists (DR23 chose plain rows).
- A DESIGN.md: Brand v2 tokens are the system here.

### What already exists (design reuse)

Brand v2 tokens (`--m-*`, motion `--m-ease-spring`, `--m-dur-*`); `DayBars` (keyboard, RTL, gap labels, `hp-daybar-zero`); `CategoryBars`; `useSpringScale` + `motion`; `.hp-popover`; `.hp-banner-info`; `.hp-nav` sideways scroller; `QueryView`; the existing income and expense drawers; `<bdi>` amounts (ADR-101); the expense-groups ≈ line (inverted on purpose, Pass 5).

### TODOS.md (design)

None proposed. The copy-table sign-off is a pre-build task (below), not deferred debt.

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | no DESIGN.md (Brand v2 tokens); UI scope: new page |
  | Step 0               | 5/10; focus: all 7 passes (D1)              |
  | Pass 1  (Info Arch)  | 5/10 → 10/10 after fixes                    |
  | Pass 2  (States)     | 4/10 → 10/10 after fixes                    |
  | Pass 3  (Journey)    | 5/10 → 10/10 after fixes                    |
  | Pass 4  (AI Slop)    | 7/10 → 9/10 after fixes                     |
  | Pass 5  (Design Sys) | 5/10 → 10/10 after fixes                    |
  | Pass 6  (Responsive) | 4/10 → 9/10 after fixes                     |
  | Pass 7  (Decisions)  | 3 resolved, 0 deferred                      |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (5 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 0 generated (designer has no API key)       |
  | Decisions made       | 30 added to plan (DR1–DR30)                 |
  | Decisions deferred   | 0                                           |
  | Overall design score | 4/10 → 9/10                                 |
  +====================================================================+
```

All passes are 8+. The plan is design-complete. Run `/design-review` after implementation for visual QA (it also closes Pass 4's and Pass 6's remaining "unverified until rendered" gaps).

Outside voice: one Claude design subagent (single-model; Codex not installed). Its findings H1–H4, S1–S9, J1–J5 and P1–P12 were all raised in the passes above and decided individually.

Unresolved decisions: none.

## Design Implementation Tasks
Synthesized from this design review's findings.

- [ ] **DT1 (P1, human: ~3h / CC: ~20min)** — copy — Write the en + ar copy table into the brief and get Basel's sign-off before code
  - Surfaced by: Pass 7, DR28
  - Files: .claude/designs/mut-175-reports.md, src/hosted/i18n/{en,ar}.json
  - Verify: Basel approves; i18n key-parity test green
- [ ] **DT2 (P1, human: ~1d / CC: ~40min)** — ReportsPage layout — Control row, chips rule, fluid hero, Owed line, stage-dependent order, Lately list
  - Surfaced by: Pass 1, Pass 3, Pass 4 (DR1–DR4, DR16, DR20)
  - Files: src/hosted/pages/views/ReportsPage.tsx, src/hosted/components/reports/*, src/hosted/hosted.css
  - Verify: component tests (stage 1/2/3 order, single-profile hides chips, 7-digit JOD on one line at 375)
- [ ] **DT3 (P1, human: ~1d / CC: ~45min)** — states — keepPreviousData dim/morph, first run, empty sections, FX hold, all-failed, chip states, no-access explainer, future/pre-start days
  - Surfaced by: Pass 2 (DR5–DR13)
  - Files: src/hosted/data/reportQueries.ts, src/hosted/pages/views/ReportsPage.tsx, src/hosted/components/reports/*, src/hosted/shell/HostedShell.tsx, src/hosted/components/groups/DayBars.tsx
  - Verify: component tests per state-table row; release-QA `first-month`, `signed-out`
- [ ] **DT4 (P1, human: ~4h / CC: ~25min)** — insights — Complete-month rule (7th day), stage-2 recap, stage-3 movers, scope-drop teaser, rotation, neutral copy, ranking
  - Surfaced by: Pass 3, Pass 7 (DR14–DR19, DR29)
  - Files: src/hosted/data/reports.ts, src/hosted/data/reportInsights.ts
  - Verify: unit tests at the 7th/8th boundary, rotation after 3 views, ranking order, negative Kept caption
- [ ] **DT5 (P1, human: ~5h / CC: ~30min)** — charts and lists — Colours + legend, overlaid phone bars, tap value line, Year lock, CategoryBars meta/plain rows, per-(profile, client) rows
  - Surfaced by: Pass 5, Pass 6, Pass 7 (DR22, DR23, DR25–DR27, DR30)
  - Files: src/hosted/components/groups/{DayBars,CategoryBars}.tsx, src/hosted/data/filters.ts, src/hosted/hosted.css
  - Verify: D5 characterization tests still green; new tests for overlay < 480px, value line, Year fallback
- [ ] **DT6 (P2, human: ~3h / CC: ~20min)** — motion — Count-up 600ms, bar wave ≤ 300ms, 400ms spring morph, reduced motion, sr-only final values
  - Surfaced by: Pass 4 (DR21)
  - Files: src/hosted/components/reports/HeroFigures.tsx, src/hosted/components/groups/useSpringScale.ts
  - Verify: tests with reduced motion on (instant), hidden tab, zero delta; screen reader reads final value only
- [ ] **DT7 (P2, human: ~2h / CC: ~15min)** — RTL and a11y — Reading-order arrows with bounds, landmarks and headings, radiogroup, 44px targets
  - Surfaced by: Pass 6 (restated rules)
  - Files: src/hosted/components/reports/ReportControls.tsx
  - Verify: tests per language; axe in release-QA `arabic`

## 12. Open conflicts with the shell redesign (found 2026-10-24, after both reviews)

Another session planned the portal shell redesign the same day: epic MUT-423, with MUT-424's plan at `03c978f7`, `.claude/designs/mut-424-four-destinations-plan.md`. Two of its decisions collide with this plan. **Basel decides; nothing below is applied yet.**

- **X1: All profiles. RESOLVED by Basel, 2026-10-24.** The shell stays one-profile, and Reports adds an opt-in "All profiles" switch that combines everything, with a disclaimer. This is Reports' one exception to MUT-423 D6, so note it on MUT-423. The design pass is §13. Original options, kept as history:
  - (a) Reports is the one exception to MUT-423 D6 (keep B6).
  - (b) Drop All profiles from Reports. One profile at a time removes the fan-out, the chips, D4, DR10, DR11, DR17 and DR30, and simplifies T4/T5.
- **X2: Entry point. RESOLVED by Basel, 2026-10-24: the proposal below is accepted, and AC 1 is reworded (§7).** MUT-424 D2: "Reports is not a destination", it opens from a corner icon that MUT-426 owns, and "MUT-175's AC 1 must change". This plan's §4.3 and DR12 add a `SECTIONS` nav item. Proposed reconciliation: the route stays `/p/$profileId/reports`. If MUT-175 lands before MUT-426, it ships as a nav item that MUT-426 then moves to the corner icon; otherwise it ships straight into the icon. AC 1 becomes "Reports is reachable from the portal shell for every profile …". DR12's "hide" rule applies to whichever entry point exists.
- **Fixed (factual):** ADR-181 is MUT-361's; this plan takes the next free number at build (§6, T8).

## 13. Design pass: the "All profiles" switch (2026-10-24)

Basel asked for this pass as its own review after resolving X1. It covered only the dimensions the switch touches: hierarchy, states, journey, controls and copy. Its decisions are DS1–DS5, all Basel's answers.

- **DS1** (T1): switch on means **one combined report**. Hero, Owed line, insights, chart and both lists cover all profiles combined. Under the hero: "Of which {current profile}: ≈ {amount}". Who paid keeps DR30's per-(profile, client) rows with the profile label.
- **DS2** (T2): **one switch, all or nothing.** DR11's chips are removed. A profile that fails or is forbidden is named in the combined line with its own Retry (D4 and DR10 still apply while on).
- **DS3** (T3): a disclaimer line under the hero caption while on: "All {n} profiles combined · other currencies at today's rate" (en/ar). "{n} profiles" is a button that lists the names. With a failure it merges with D4's line: "2 of 3 profiles · Studio Lina couldn't load · Retry".
- **DS4** (T4): a labelled switch "All profiles" (`role="switch"`, 44px) at the inline-end of the control row, before ‹ ›. It shows only with 2+ readable profiles. The state is in the URL (`?scope=all`). Opening Reports from the shell always starts **off**. Toggling morphs per DR5/DR21.
- **DS5** (T5): with the switch off, when the combined stage is higher than this profile's, the teaser adds "See insights across all profiles", which turns the switch on. With the switch on, the stage and insights use the combined history (A4).

Engineering consequences (no new behaviour, recorded for /eng-build):
- With the switch off, Reports needs **one** activity request (this profile) plus its organization summary. The fan-out (D1/D4) runs only when the switch is on.
- DS5 needs the other profiles' histories to compare stages. Prefetch them in the background **only while this profile's stage is below 3 and the person has 2+ profiles**. These are the same queries the switch uses, so toggling on is also instant.
- `parseReports`: `scope` is `profile` (default) or `all`, and `skip` is removed.
- Release-QA: `all-vs-one-profile` becomes `all-profiles-switch` (off by default, on shows the combined line and the share line, a deep link with `?scope=all` reopens combined), and adds `teaser-suggests-switch`.

Scores for this pass: hierarchy 9→10, states 9→10, journey 9→10 (DS5 removes the "wait months" dead end). The design review overall stays 9/10 (Passes 4 and 6 still await visual QA after build).

## Business / product impact

- The paying audience gets a reason to open the portal every week: what came in, where it went, and who's slow to pay. Without it, MUT-292 can't retire the web app, because Insights is the last web-only answer.
- It sits on the MUT-322 GA gate and unblocks MUT-292 (one app, MUT-284).
- The staged design gives a month-1 user something worth seeing on day one and a reason to keep logging, which feeds retention in the paid pilot.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~2h / CC: ~15min)** — DayBars — Pin the current single-series behaviour before any change
  - Surfaced by: Section 3, T1 / D5
  - Files: src/hosted/components/groups/__tests__/DayBars.test.tsx
  - Verify: `npx vitest run src/hosted/components/groups` green; `release-qa run --attach --only` expense-groups specs green (before)
- [ ] **T2 (P1, human: ~1d / CC: ~45min)** — server — `GET /v1/summaries/activity` (day or month buckets + 12-month history + daysToPaid median) with `summaries:read` + `expenses:read`, SESSION_ONLY
  - Surfaced by: D1, D2, S1
  - Files: server/src/summaries/activity.ts, server/src/routes/summaries.ts, server/src/schemas.ts, src/hosted/api/schema.d.ts
  - Verify: `npm --prefix server test`, `npm --prefix server run openapi:check`, `npm --prefix server run typecheck`
- [ ] **T3 (P1, human: ~3h / CC: ~20min)** — repositories — `payments.listAllocationsFor` on Prisma and memory, in the store contract
  - Surfaced by: D1, T2
  - Files: server/src/repositories/{ports,prisma,memory}.ts, server/src/repositories/__tests__/store-contract-m4.ts
  - Verify: `npm --prefix server test`, `test:db` in CI
- [ ] **T4 (P1, human: ~1d / CC: ~40min)** — portal data — reports.ts (periods, weekStart, stage from history, combine), reportInsights.ts (thresholds, rank, cap, teaser, D3 fallback), reportQueries.ts (per-profile queries, D4 statuses)
  - Surfaced by: D1, D3, D4, A4
  - Files: src/hosted/data/reports.ts, src/hosted/data/reportInsights.ts, src/hosted/data/reportQueries.ts, src/hosted/data/expenseGroups.ts (convertTotal type)
  - Verify: `npx vitest run src/hosted/data`
- [ ] **T5 (P1, human: ~2d / CC: ~1h)** — portal UI — ReportsPage, HeroFigures (≈ popover), InsightList, ReportControls, DayBars second series and month bars, route + `parseReports`, nav item, en/ar copy with `tp`
  - Surfaced by: D1, D4, D5, C2
  - Files: src/hosted/pages/views/ReportsPage.tsx, src/hosted/components/reports/*, src/hosted/components/groups/DayBars.tsx, src/hosted/router.tsx, src/hosted/data/filters.ts, src/hosted/shell/HostedShell.tsx, src/hosted/i18n/{en,ar}.json
  - Verify: component tests; groups QA specs green (after)
- [ ] **T6 (P2, human: ~2h / CC: ~15min)** — analytics — `report_viewed` + taxonomy v2.2.0 + pinned sha256
  - Surfaced by: D6
  - Files: src/hosted/analytics/*, docs/analytics/events.json, scripts/__tests__/analytics-taxonomy.test.ts
  - Verify: `npx vitest run scripts/__tests__/analytics-taxonomy.test.ts`
- [ ] **T7 (P1, human: ~1d / CC: ~45min)** — release-QA + local parity — `qa/features/portal/reports.yaml` + `qa/specs/portal/reports.spec.ts` (8 scenarios), local parity for the new route
  - Surfaced by: Section 3 diagram, T3
  - Files: qa/features/portal/reports.yaml, qa/specs/portal/reports.spec.ts, src/hosted/local/__tests__/*
  - Verify: `release-qa run --attach --only <id>` per scenario; `release-qa lint`
- [ ] **T8 (P2, human: ~2h / CC: ~15min)** — knowledge — the next free ADR, DECISIONS B1–B9 + D1–D6, TD-221, COMPONENT_REGISTRY, PATTERNS, CHANGELOG, SYSTEM_OVERVIEW, TEST_PLAN, the brief + tests brief
  - Surfaced by: §6
  - Files: .claude/*.md, .claude/designs/mut-175-reports.md, .claude/designs/mut-175-reports-tests.md
  - Verify: full gate under Node 22

_No new tasks from Performance._

### Unresolved decisions

None in this review.

### Completion summary

- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, D1)
- Reality rows: 7/7 applicable rows emitted, 0 unverified premises (3 false premises corrected)
- Architecture Review: 4 issues found (A1→D2, A2→D3, A3 and A4 notes)
- Code Quality Review: 4 issues found (C1→D4, C2 corrected, C3 settled, C4→D5)
- Test Review: diagram produced, 27 gaps identified (all planned new code; T1→D5, T2 and T3 required proof)
- Performance Review: 3 issues found (notes, no change)
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (TD-221 already planned)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback timed out)
- Parallelization: 2 lanes, 2 parallel / 3 sequential steps (one worktree in practice)
- Lake Score: 4/4 = answers picking a 10/10-leaning option (D2, D3, D4, D5 recommended; D1 and D6 kind-notes)

### Suppressed findings

None.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (native fallback) | Independent 2nd opinion | 1 | unavailable | none (no reviewer completed) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved into D1–D6) | 14 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 2 | clean | score: 4/10 → 9/10, 30 decisions + 5 (All-profiles switch pass, §13) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** eng plan-review: codex unavailable (CLI not installed; native Plan fallback timed out at 5 minutes, no credit). Design phase: codex unavailable; one in-host Claude design subagent completed with findings, all decided in the passes. No external-model coverage.
- **VERDICT:** Design review 9/10 with all of its own decisions made. Eng review complete with every finding mapped to D1–D6 and tasks, but not CLEAR in the dashboard sense (issues_open): eng review required. DR15 (stage-2 recap, movers at stage 3) amends B4; the eng tasks T4/T7 follow DT4. X1 is resolved: the shell stays one-profile and Reports adds an opt-in "All profiles" switch, designed in its own pass (§13, DS1–DS5). X2 is accepted: a nav item until MUT-426 moves it to the corner icon, with AC 1 reworded (§12).

NO UNRESOLVED DECISIONS
