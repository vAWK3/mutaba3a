# MUT-424 — Portal: regroup 7 sections into Owed, Paid, Spent and Clients

Epic MUT-423 · blocks MUT-426 · design: `.claude/designs/portal-shell-concepts.html` (round 4, variation 3) · status: **built** (2026-10-25, branch `feature/mut-424-four-destinations`, ADR-192)

**Build notes (where the build differs from the plan, and why):**
- **Reports stays in the interim sidebar**, as its own link beside the four destinations and outside the "Sections" nav. MUT-175 merged after this plan with Reports as a sidebar item "until MUT-426's corner icon"; dropping it now would make Reports unreachable until MUT-426 (AC 2). It lights no destination (`NO_DESTINATION` has `reports` and `you` from the start, since both routes now exist).
- **The chevron is the › glyph, not a `flip` class** (test 3): the portal's rule (hosted.css, MUT-175 review, verified on video) is that the browser bidi-mirrors ‹ ›, and a CSS flip points them backwards.
- **`DeeperLinks` reuses the You page's row styling** (`RowNavLink` in `YouRows`, `.hp-you-box`), so `.hp-deeper` only sets the spacing above the list.
- **The destination links pass `activeOptions={{ exact: true }}`:** TanStack sets `aria-current` on any active link, and Owed's `/p/:id` is active on every page of the profile.

## Goal

The portal stops presenting seven peer sections. It presents four destinations: **Owed, Paid, Spent, Clients**. Everything else sits one level below the destination it belongs to, with a way back. Nothing reachable today becomes unreachable, and nothing that links into the portal breaks.

## Decisions

**E1 — Every URL stays as it is.** The four destinations are routes that already exist. "One level in" is a matter of navigation and wayfinding, not of URL nesting.

| Destination | Its page (URL unchanged) | One level in (URL unchanged) |
|---|---|---|
| Owed | `/p/:id` (today's Overview) | `/receivables` (every open entry) |
| Paid | `/payments` | `/conversions` |
| Spent | `/expenses` | `/expenses/groups`, `/expenses/groups/:groupId` (already one level in, MUT-268) |
| Clients | `/clients` | `/clients/:customerId` (already has a Documents tab), `/documents` (all documents, including those with no client) |

Why we keep the URLs instead of moving to `/owed`, `/paid` and `/spent` with redirects:
- The phone app's universal links claim exactly `/p/*/expenses` and `/p/*/payments`. That's the association file (MUT-111) and `app_link_listener.dart` `_portalEntriesProfileId` (MUT-113) in the Flutter repo. Renaming would need a coordinated phone release, and installed phones would break.
- Server mail and Stripe links land on `/p/:id` and `/?billing=…`: `FirstProfileRedirect`, plus `billing.ts` and `checkout.ts` return URLs. They already land on Owed.
- `ProfileSwitcher` keeps the section by path segment (`SECTION_SEGMENT`). It keeps working with no change.
- PostHog's URL-based page views stay comparable before and after.
- Bookmarks, and about 100 QA path references, keep working.

The ticket's AC "every old URL lands on the right page" holds by construction: no old URL changes, so no redirects are needed. **Ticket wording to update:** the "redirect" line in Scope (in) no longer applies. A comment on MUT-424 will say why.

**E2 — One map decides which destination is lit.** `destinationOf(pathname)` lives in a new `src/hosted/shell/destinations.ts`. It is a pure function from a path under `/p/:id` to `'owed' | 'paid' | 'spent' | 'clients'`:
- `''` and `receivables` → owed
- `payments` and `conversions` → paid
- `expenses/**` → spent
- `clients/**` and `documents` → clients

`DESTINATIONS` (key, path, i18n key) lives beside it, with an exported `NO_DESTINATION` set for pages that deliberately light no tab (empty in MUT-424; `reports` from MUT-175 and `you` from MUT-425 join it, per review R2/R3). Today's interim sidebar uses it, and MUT-426's pill reuses it unchanged. We don't do this through TanStack `activeOptions`, because `/receivables` has to light Owed without being nested under it.

**E3 — Page titles follow the tab word; content names stay.**
- The four destination pages' `h1` becomes the destination word. New keys `hosted.destinations.{owed,paid,spent,clients}`.
  - Overview → **Owed**
  - Payments → **Paid**
  - Expenses (and its Groups tab, which shares the header) → **Spent**
  - Clients stays **Clients**
- Pages one level in keep their names: Receivables, Conversions, Documents, a group's name. They gain a back link to their destination.
- Table accessible names keep the existing content keys (`hosted.payments.title` → table "Payments", and so on), so those labels don't change.
  - Exception: Overview's table is the page's own list, so its label follows the h1 (Owed).
- The Spent page's section tabs stay "Expenses · Groups" (`hosted.groups.tabExpenses`): those words name lists, not the destination.

**E4 — "One level in" is a quiet link list at the bottom of the destination page.**
- A new `DeeperLinks` component (`src/hosted/components/DeeperLinks.tsx`): a `<nav aria-label>` holding one or more rows, each a label, a one-line description and a chevron.
- They are real links (deep-linkable, Back works), like `SectionTabs`. There are no counts and no new figures, since figures are out of scope.
  - Owed → **Receivables** · "Every open entry, with filters"
  - Paid → **Currency conversions**
  - Clients → **Documents** · "Every invoice and receipt, including ones with no client" (D2)
  - Spent already has Expenses · Groups section tabs, so no row is added.
- The chevron flips in RTL.

**E5 — The back link is a `PageHeader` option.** `PageHeader` gains `back?: { to: string; label: string }`. It renders the existing `.hp-back` link pattern that `ClientDetailPage` and `ExpenseGroupDetail` use today. Receivables, Conversions and Documents pass `{ to: destination path, label: destination word }`. ClientDetailPage's hand-written back link moves onto it, so the pattern lives in one place. ExpenseGroupDetail keeps its breadcrumb, which is a different pattern (review, Code quality 1).

**E6 — Interim sidebar.**
- `HostedShell`'s `SECTIONS` (7) becomes `DESTINATIONS` (4).
- `aria-current="page"` comes from `destinationOf(useLocation().pathname)`, not from `Link activeOptions`.
- The nav's accessible name stays "Sections", so the shell QA locator holds.
- MUT-426 replaces this sidebar with the pill.

**E7 — Words.**
- en: Owed · Paid · Spent · Clients.
- ar: المستحق · المدفوع · المصروف · العملاء.
  - المستحق and المدفوع already exist in the portal's ar.json. **المصروف needs Basel's ok.** The alternative is المصاريف, today's "Expenses".
- The seven old `hosted.shell.nav.*` keys are removed (unused), with en/ar parity kept.

**E8 — Signed-out (local) mode** uses the same routes and components, so it needs no branch. The local-mode QA proves it.

## Files

| File | Change |
|---|---|
| `src/hosted/shell/destinations.ts` (new) | `DESTINATIONS`, `destinationOf(pathname)`; pure, no React |
| `src/hosted/shell/__tests__/destinations.test.ts` (new) | Every current route → its destination; unknown → `null`; trailing slash and nested paths |
| `src/hosted/shell/__tests__/destinations.routes.test.ts` (new) | Walks the real route tree (R3) |
| `src/hosted/shell/HostedShell.tsx` | Render 4 destinations; `aria-current` from `destinationOf` |
| `src/hosted/components/DeeperLinks.tsx` (new) + test | E4 |
| `src/hosted/pages/views/shared.tsx` | `PageHeader` `back` prop (E5) |
| `OverviewPage.tsx` | h1 Owed; `DeeperLinks` → Receivables; table label follows the h1 |
| `PaymentsList.tsx` (PaymentsPage) | h1 Paid; `DeeperLinks` → Conversions |
| `ExpensesList.tsx`, `ExpenseGroupsList.tsx` | h1 Spent |
| `ClientsPage.tsx` | `DeeperLinks` → Documents |
| `ReceivablesList.tsx` (page), `ConversionsList.tsx` (page), `DocumentsList.tsx` (page) | `PageHeader back` → Owed / Paid / Clients |
| `ClientDetailPage.tsx` | Hand-written back link → `PageHeader back` (no visual change) |
| `src/hosted/i18n/{en,ar}.json` | `hosted.destinations.*`, `hosted.deeper.*`; drop the 7 `hosted.shell.nav.*` |
| `src/hosted/hosted.css` | `.hp-deeper` list (logical properties; the chevron flips under `[dir=rtl]`) |
| Unit tests naming sections | `pages/__tests__/views.test.tsx`, `ExpensesList`, `ExpenseGroups`, `ConversionsList`, `FirmOnBanner`, `TrialWelcome`, `crashScreens`, `session/__tests__/local-mode`: update headings and nav names |

No server, API, OpenAPI or Flutter change. No new query, so there are zero extra reads per session.

## Tests (TDD: written first)

1. **`destinationOf`** (unit): `/p/x` and `/p/x/` → owed; `/p/x/receivables?status=OPEN` → owed; `/p/x/payments` and `/p/x/conversions` → paid; `/p/x/expenses`, `/p/x/expenses/groups` and `/p/x/expenses/groups/g1` → spent; `/p/x/clients`, `/p/x/clients/c1` and `/p/x/documents` → clients; `/sign-in` and `/p/x/unknown` → null.
1b. **Every real route is mapped** (review R3): `src/hosted/shell/__tests__/destinations.routes.test.ts` builds `createPortalRouter` and checks that each `/p/$profileId` route maps to a destination or is in `NO_DESTINATION`. A failure names the path.
2. **HostedShell** (component): exactly 4 links in "Sections", in order; on `/receivables` Owed has `aria-current="page"` and nothing else does; on `/documents`, Clients does. Arabic labels in `ar`.
3. **DeeperLinks**: renders a `nav` with the given accessible name and one link per row to the given path; the chevron carries the `flip` class.
4. **PageHeader back**: renders a link with the label to `to`; absent when `back` is not set.
5. **Pages**:
   - Overview h1 "Owed" with a Receivables link.
   - Payments h1 "Paid" with a Conversions link.
   - Expenses and Groups h1 "Spent".
   - Clients page with a Documents link.
   - Receivables, Conversions and Documents each show a back link to their destination.
6. **Release-QA (web, Playwright):**
   - `qa/features/portal/shell.yaml` `navigate`: retitle it to the four destinations. Its `paths` add `src/hosted/shell/destinations.ts` and `src/hosted/components/DeeperLinks.tsx`.
   - A new feature `shell.one-level-in`: "From Owed, Paid and Clients, Receivables, Conversions and Documents are one link away, and each has a link back."
   - `qa/specs/portal/shell.spec.ts`: `SECTIONS` → `['Owed','Paid','Spent','Clients']`. Add a new tagged test `@portal.shell.one-level-in`: Owed → Receivables → back; Paid → Conversions → back; Clients → Documents → back; checking `aria-current` on the right destination at each stop; then once in عربي.
   - Mechanical updates where specs name the old nav links or headings: `local-mode`, `terms`, `setup`, `session`, `profiles`, `error-reports`, `usage-analytics`, `ledger`, `income`, `expenses`, `expense-groups`. Headings change Overview→Owed, Payments→Paid and Expenses→Spent. Nav clicks on Receivables, Documents or Conversions become destination + `DeeperLinks`, or a direct `api.open(path)` where the test isn't about navigation.
   - Run `release-qa run --attach --only navigate,one-level-in`, then the full portal app, then `release-qa lint` (no errors, no new unmapped files).

**Gate (Node 22):** `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`, `npm run test:bundles`.

## Knowledge updates

- **A new ADR** (next free number at build time; ADR-181 is taken by MUT-361's unmerged lapse-gate branch) "The portal is four destinations; URLs unchanged" (E1/E2/E3). It supersedes the sidebar list in `hosted-portal.md` §7.1.
- `hosted-portal.md` §7.1 (shell + routes, with the destination map) and §7.3 (Overview row renamed Owed).
- `COMPONENT_REGISTRY` (`DeeperLinks`, `PageHeader back`, `destinations.ts`), `CHANGELOG`, `SYSTEM_OVERVIEW` (portal navigation), `TEST_PLAN`.

## Acceptance criteria → proof

| AC (MUT-424) | Proof |
|---|---|
| Four destinations with stable URLs; old URLs land right | E1 table; test 1; QA `navigate` visits each |
| Nothing becomes unreachable; each thing at most one level below a destination | Tests 2 and 5; QA `one-level-in`; client detail and groups unchanged |
| Owed shows per-currency figure, late amount, clients behind it | Overview body unchanged (M8); existing `shell.navigate` currency steps |
| Same signed in and out | E8; `local-mode.spec` updated and passing |
| Release-QA updated, passing, lint clean | Test 6 |

## Out of scope

- The pill and island (MUT-426).
- The You page (MUT-425).
- Search, and new figures or counts.
- Phone and server.

## Risks

- **QA churn** (about 40 heading and nav references across 11 specs) is mechanical, but it's where a miss shows up. Run the full portal app, not just the changed features.
- **Arabic copy** for Spent: E7 needs sign-off.
- **Overview's table label changes** to "Owed", so `shell.spec` and `terms.spec` locators need it.

## Business / product impact

- The portal reads as four plain answers instead of a seven-item dashboard. That is the step that makes the minimal shell (MUT-426) possible.
- It unblocks MUT-426. Keeping URLs means no phone release, no broken universal links or bookmarks, and analytics stay comparable.
- Low risk: copy, navigation and two small components. No data or API change.

---

# Eng review (plan-eng-review, 2026-10-24)

Target: `.claude/designs/mut-424-four-destinations-plan.md` (this file). Report file: this file.

## Scope Challenge

**Reality rows**
- REALITY: premise-table pass — 6 premises, 0 unverified. AASA and phone parse `/p/*/expenses|payments` (flutter `app_link_listener.dart:38-51`); FirstProfileRedirect lands `/p/:id` with the shell overlay (`AuthGate.tsx:77-84`); the switcher keeps segment 3 (`ProfileSwitcher.tsx:38`); the router has no basepath (`router.tsx:227-231`); the Documents tab is already on client detail (`ClientDetailPage.tsx:73`); Spent already has section tabs (`ExpenseGroupsList.tsx:36-37`).
- REALITY: already-done pass — no commit since 2026-10-24 touches `src/hosted/shell`, `pages/views`, `router.tsx` or `i18n`; `destinationOf` and `DeeperLinks` don't exist (`git log --all -S`).
- REALITY: surface-check pass — the routes named in E1 all exist (`router.tsx:96-220`); there are no new CLI or HTTP surfaces.
- REALITY: binding-decisions finding — the MUT-175 eng review (2026-10-24) adds `/reports` as a sidebar section (`mut-175-reports-plan.md:73`, AC 1 at `:105`). That collides with four destinations. See R2.
- REALITY: numbers pass — the "~100 QA references" figure is `[measured: grep of qa/specs/portal, 97 heading-name hits]`; "~40 to change" is `[estimated]`.
- REALITY: deferred-asks finding — MUT-424 Scope (in) asks for redirects of old URLs. E1 makes them unnecessary, so the ticket text needs a comment (task T7).
- REALITY: pr-count pass — one PR (local merge), matching the default one-PR-per-wave.

**Complexity:** about 18 source files plus about 12 QA specs; 2 new modules (`destinations.ts`, `DeeperLinks`). The gate tripped.

**Scope record:** feature answers: none proposed for cut. Structure: **A (original arrangement)**, D1, answered 2026-10-24 ("A) Bottom links + back"). Accepted scope: the plan as written, E1–E8. Pending remedies: R2, R3.

**Scope Challenge result:** scope accepted as-is.

**Factual correction (no behaviour change):** E5 says ExpenseGroupDetail has a hand-written back link. It doesn't. It has a breadcrumb `nav.hp-crumb` (`ExpenseGroupDetail.tsx:99-106`), which is a different pattern. Only `ClientDetailPage.tsx:66` moves onto `PageHeader back`, and the group breadcrumb stays.

## Decision ledger

### R1: Structure of "one level in"
- **Finding:** complexity gate (Scope Challenge).
- **Plan baseline:** original arrangement (`DeeperLinks` + `PageHeader back`).
- **Runtime evidence:** `SectionTabs` exists (`SectionTabs.tsx`) and is used only by Spent.
- **Question D1:** original vs smaller (`SectionTabs` everywhere). Recommended B.
- **State:** approved.
- **Actual answer:** A) Bottom links + back (D1, 2026-10-24).
- **Accepted scope:** the plan's E4/E5 as written, with the E5 factual correction above.
- **History:** none.

### R2: Where MUT-175's Reports lives among four destinations
- **Finding:** [P1] (confidence 9/10), Architecture.
  - `mut-175-reports-plan.md:73` says "`SECTIONS` gets `{ path: '/reports', key: 'reports' }` after Overview".
  - AC 1 at `:105` says "A Reports section is in the portal nav for every profile".
  - Both plans were reviewed on 2026-10-24, and neither knows about the other. Whichever lands second breaks the other's nav contract.
- **Plan baseline:** MUT-424 has no Reports row.
- **Runtime evidence:** `/reports` doesn't exist yet (`router.tsx` has no reportsRoute).
- **Comparison grid:**

| Choice | Current | A | B | C |
|---|---|---|---|---|
| R2 Reports placement | undecided | one level in under Owed (a `DeeperLinks` row) | one level in under Paid (a `DeeperLinks` row) | a fifth destination |
| R3 route-coverage test | pending | pending | pending | pending |

- **Question D2:** (sent as below)
- **Header:** Reports
- **Options:**
  - **A) Under Owed (recommended):** Reports is a second `DeeperLinks` row on Owed, beside Receivables. `destinationOf('reports')` → owed. MUT-175's AC 1 and its HostedShell line change to this.
  - **B) Under Paid:** Reports is a `DeeperLinks` row on Paid, beside Currency conversions. `destinationOf('reports')` → paid. MUT-175's AC 1 changes.
  - **C) Fifth destination:** Owed · Paid · Spent · Clients · Reports. `DESTINATIONS` has 5 entries; MUT-426's pill holds five words, tight on a phone beside the island.
- **State:** approved.
- **Actual answer:** none of the three. Basel, D2, 2026-10-24: "we don't have global search or anything, so reports should be that icon (a dedicated icon to open that reports page when it comes)".
- **Accepted scope:**
  - Reports is **not a destination**. It opens from a dedicated icon in the shell corner, where the wireframe's search circle sat (the epic's D3 search stays out).
  - In MUT-424, `destinationOf` returns `null` for `reports` on purpose (no tab lit), and this is documented in `destinations.ts`.
  - MUT-426 owns the icon. MUT-175's AC 1 and its `HostedShell` `SECTIONS` line change to "opens from the Reports icon".
  - Comments go on MUT-175 and MUT-426 (task T8).
- **History:** options A/B/C (Under Owed / Under Paid / Fifth destination) were offered, recommending A; none was chosen.

### R3: Does the `destinationOf` test enumerate the real routes?
- **Finding:** [P2] (confidence 8/10), Test.
  - Test 1 in the plan lists today's paths by hand.
  - Failure mode: a route added later (MUT-425's `/you`, MUT-175's `/reports`, any future page) without a `destinationOf` entry silently lights no tab. That's a silent wayfinding bug no test sees.
- **Plan baseline:** a hand-listed table test.
- **Runtime evidence:** `createPortalRouter` is exported (`router.tsx:75`), and the test harness already builds it (`src/hosted/__tests__/harness.tsx`), so its route tree can be walked with no production seam.
- **Comparison grid:**

| Choice | Current | A | B |
|---|---|---|---|
| R3 route coverage | hand-listed paths | add one test that walks `createPortalRouter().flatRoutes` under `/p/$profileId`; each must map to a destination or be on an explicit `NO_DESTINATION` list (`reports`, later `you`) | keep the hand-listed table only |

- **Question D3:** (sent as below)
- **Header:** Route test
- **Options:**
  - **A) Walk the router (recommended):** One extra test walks every `/p/$profileId` route. An unmapped one fails with its path. `NO_DESTINATION` names the deliberate exceptions.
  - **B) Hand list only:** Keep test 1 as planned. A future route can ship with no tab lit.
- **State:** approved.
- **Actual answer:** A) Walk the router (D3, 2026-10-24).
- **Accepted scope:**
  - Add `src/hosted/shell/__tests__/destinations.routes.test.ts`. It builds `createPortalRouter` (as `harness.tsx` does) and, for every route path under `/p/$profileId`, asserts that `destinationOf` returns a destination, or that the path's first segment is in an exported `NO_DESTINATION` set.
  - `NO_DESTINATION` starts empty in MUT-424. `reports` (MUT-175) and `you` (MUT-425) are added by those tickets.
  - The failure message names the path.
- **History:** none.

## Review sections

### 1. Architecture

1. [P1] (9/10) `mut-175-reports-plan.md:73` collides with four destinations. **Disposition:** accepted, R2 (D2): Reports opens from its own corner icon (MUT-426); `destinationOf('reports')` is `null`.
2. [P2] (9/10) E1 keeps URLs. Verified against the AASA paths and the phone parser (`app_link_listener.dart:38-51`), mail and Stripe return URLs (`AuthGate.tsx:77-84`, `billing.ts:191`), and the switcher (`ProfileSwitcher.tsx:38`). **Disposition:** confirmation, no change.

Production failure per new path: a route added without a mapping lights no tab, silently. It's covered by R3's route-walking test.

```
pathname (router-relative, no basepath: router.tsx:227)
   │
   ▼
destinationOf ── '' | receivables ──────────────▶ owed
              ── payments | conversions ────────▶ paid
              ── expenses/** ───────────────────▶ spent
              ── clients/** | documents ────────▶ clients
              ── NO_DESTINATION (reports, you) ─▶ null (their own control is lit)
              ── anything else ─────────────────▶ null + R3 test fails at build time
   │
   ▼
HostedShell (interim sidebar, then MUT-426 pill): aria-current on the match
```

### 2. Code quality

1. [P3] (10/10) E5 claimed ExpenseGroupDetail has a back link. It has a breadcrumb (`ExpenseGroupDetail.tsx:99-106`). **Disposition:** factual correction; only ClientDetailPage moves onto `PageHeader back`.
2. `PageHeader back` meets the shared-code rubric:
   - Callers: `ClientDetailPage.tsx:66` (existing) plus Receivables, Conversions and Documents pages (proposed, E5).
   - Removes the hand-written header markup at one site (about 6 lines removed, about 8 added in `shared.tsx`).
   - **Disposition:** accepted under R1.
3. `DeeperLinks` placement: it renders **outside** `QueryView` on Owed, Paid and Clients, so the way in still shows when the page's own list is loading, empty or failed. This is a required detail of approved E4, not a new choice.

### 3. Tests

Framework: Vitest + Testing Library (unit, jsdom); Playwright via release-qa (web). Command: `npm run test:run`; QA `release-qa run --attach --only <ids>`.

```
CODE PATHS                                              USER FLOWS
[+] shell/destinations.ts                               [+] Move between destinations
  ├── destinationOf: each segment ─ [GAP→test 1 ★★★]     ├── [GAP→QA navigate] four tabs, each h1, aria-current
  ├── unknown / NO_DESTINATION ──── [GAP→test 1]         └── [GAP→QA navigate] عربي, RTL
  └── every real route mapped ───── [GAP→R3 test ★★★]   [+] Go one level in and back
[+] shell/HostedShell.tsx                                 ├── [GAP→QA one-level-in] Owed→Receivables→back
  └── 4 links, lit by destinationOf [GAP→test 2 ★★★]     ├── [GAP→QA] Paid→Conversions→back
[+] components/DeeperLinks.tsx      [GAP→test 3 ★★]      ├── [GAP→QA] Clients→Documents→back
[+] views/shared.tsx PageHeader back [GAP→test 4 ★★]     └── [GAP→QA] /receivables deep link lights Owed
[+] pages: titles + rows + back     [GAP→test 5 ★★]    [+] Signed out (local mode)
[~] ProfileSwitcher keep-section    [★★ TESTED: shell.spec switch-profile]  └── [GAP→local-mode.spec updated]
[~] ClientDetailPage back link      [★★ TESTED: shell.spec client-detail]

COVERAGE: planned tests close every gap; 2 existing paths stay covered by existing QA.
```

**Value cards:**
- **R3 test:** protects = every `/p/:id` page lights a tab or is a named exception; fails_when = a route is added without a mapping; why_new = test 1 only lists today's paths; seam = none (uses the harness's `createPortalRouter`); no_claim = visual lighting (jsdom).
- **QA one-level-in:** protects = Receivables, Conversions and Documents reachable in one click with a way back; fails_when = a row or back link is dropped or misrouted; why_new = no spec covers the regroup; seam = none; no_claim = phone layout (MUT-426).

**Regression contract (CRITICAL):**
- Preserved: every URL, the switcher's section-keeping, the Overview body (strip, currency tabs, sort), client-detail tabs, and Expenses · Groups.
- Intended differences: nav labels (7 → 4); h1s Overview→Owed, Payments→Paid, Expenses→Spent; Overview's table name → Owed; the new rows and back links.
- Assertions: the existing shell, local-mode, ledger, income and expenses specs keep passing with only those names changed.

**Tests made obsolete:** none. The hand-listed nav loop in `shell.spec.ts:79-84` is rewritten, not retired.

### 4. Performance

No issues. There are no new queries, no new reads per session, no new bundle dependency, and `destinationOf` is O(1) per render.

## Outside voice

Codex is not installed. The native Plan-agent fallback didn't return a complete report within the five-minute limit, so it was stopped and gets no credit. **Outside coverage: unavailable** (logged).

## TODOS.md

No TODOs proposed. The two follow-ups are ticket comments (T7, T8), not deferred work.

## NOT in scope

- **Moving to `/owed`, `/paid` and `/spent` URLs.** It would break the phone's universal links and needs a phone release for no user-visible gain (E1).
- **Reports' icon and the You page.** These are MUT-426 / MUT-175 and MUT-425. MUT-424 only reserves `NO_DESTINATION` for them.
- **New figures or counts on the rows.** The ticket says no new figures or endpoints.
- **Search.** The epic's D3. The corner slot now belongs to Reports (R2).

## What already exists

- `SectionTabs` keeps doing Spent's Expenses · Groups unchanged. The D1 answer chose bottom rows elsewhere instead of extending it.
- `PageHeader`: we extend it with `back`; it isn't rebuilt.
- `.hp-back` styling: reused.
- Client detail's Documents tab: reused, as the ticket's "documents inside the client".
- `DocumentsList`'s client filter: reused for the all-documents page.
- `ProfileSwitcher`'s section-keeping, `FirstProfileRedirect` and the mail and Stripe landing URLs all keep working untouched, thanks to E1.

## Failure modes

| New path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| `destinationOf` | a new page isn't mapped | R3 route test (build fails) | n/a (caught before ship) |
| `DeeperLinks` on Owed, Paid, Clients | the list query fails | row sits outside `QueryView` | the way in stays visible beside the error card |
| `PageHeader back` | wrong destination path | test 4 + QA `one-level-in` | n/a (caught) |
| Interim sidebar | `aria-current` on two items | test 2 | n/a (caught) |

**Critical gaps:** 0.

## Worktree parallelization

Sequential implementation, no parallelization opportunity: one module (`src/hosted`), and the QA updates depend on the final names.

## Implementation Tasks

Synthesized from this review's findings and the approved plan. CC effort assumes features ~30x, tests ~50x.

- [ ] **T1 (P1, human ~2h / CC ~10min)** — shell — Add `destinations.ts` (`DESTINATIONS`, `destinationOf`, `NO_DESTINATION`) with `destinations.test.ts` and `destinations.routes.test.ts`
  - Surfaced by: E2, R3 (D3).
  - Files: `src/hosted/shell/destinations.ts`, `src/hosted/shell/__tests__/`.
  - Verify: `npm run test:run -- destinations`.
- [ ] **T2 (P1, human ~1h / CC ~5min)** — shell — The interim sidebar renders 4 destinations, lit by `destinationOf`
  - Surfaced by: E6.
  - Files: `HostedShell.tsx`.
  - Verify: test 2.
- [ ] **T3 (P1, human ~2h / CC ~10min)** — components — Add `DeeperLinks` and the `PageHeader back` prop; move ClientDetailPage's back link onto it
  - Surfaced by: R1 (D1), Code quality 1.
  - Files: `components/DeeperLinks.tsx`, `pages/views/shared.tsx`, `ClientDetailPage.tsx`, `hosted.css`.
  - Verify: tests 3 and 4.
- [ ] **T4 (P1, human ~3h / CC ~15min)** — pages — Destination h1s, rows (outside `QueryView`), back links, en/ar keys
  - Surfaced by: E3, E4, E7.
  - Files: Overview, Payments, Expenses, ExpenseGroupsList, Clients, Receivables, Conversions and Documents pages; `i18n/{en,ar}.json`.
  - Verify: test 5.
- [ ] **T5 (P1, human ~2h / CC ~10min)** — tests — Update the unit tests that name the old sections or headings
  - Surfaced by: the regression contract.
  - Files: the eight `__tests__` files listed in Files.
  - Verify: `npm run test:run`.
- [ ] **T6 (P1, human ~4h / CC ~20min)** — qa — `shell.yaml` `navigate` + new `one-level-in`; rewrite `shell.spec`; mechanical spec updates; run them
  - Surfaced by: Test 6, the regression contract.
  - Files: `qa/features/portal/shell.yaml`, `qa/specs/portal/*.spec.ts`.
  - Verify: `release-qa run --attach --only navigate,one-level-in`, then the full portal app, then `release-qa lint`.
- [ ] **T7 (P2, human ~5min / CC ~1min)** — tracker — Comment on MUT-424: no redirects are needed because URLs are unchanged (E1)
  - Surfaced by: the deferred-asks reality row.
  - Verify: the comment is on the ticket.
- [ ] **T8 (P2, human ~10min / CC ~2min)** — tracker — Comment on MUT-175 and MUT-426: Reports opens from a corner icon, isn't a destination, and joins `NO_DESTINATION`
  - Surfaced by: R2 (D2).
  - Verify: the comments are on both tickets.
- [ ] **T9 (P2, human ~1h / CC ~5min)** — knowledge — the new ADR (next free number), `hosted-portal.md` §7.1/§7.3, COMPONENT_REGISTRY, CHANGELOG, SYSTEM_OVERVIEW, TEST_PLAN
  - Surfaced by: Knowledge updates.
  - Verify: the docs read back.

## Unresolved decisions

None in this review. One copy sign-off sits outside engineering: E7's Arabic المصروف for Spent (Basel).

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is.
- Reality rows: 7/7 tier-1 rows emitted; 0 unverified premises.
- Architecture Review: 1 issue found (Reports collision, resolved by D2).
- Code Quality Review: 1 issue found (factual correction on E5).
- Test Review: diagram produced, 1 gap identified (route coverage, resolved by D3).
- Performance Review: 0 issues found.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: 0 items proposed.
- Failure modes: 0 critical gaps flagged.
- Unresolved decisions: 0 in this review.
- Outside voice: codex, unavailable (not installed; native fallback timed out at 5 minutes).
- Parallelization: 1 lane, 0 parallel / 1 sequential.
- Lake Score: 1/1 (D3 picked the 10/10 option; D1 and D2 differ in kind).

Approval readiness: PASS — R1 (D1 answer A), R2 (D2 answer, Basel's own wording), R3 (D3 answer A).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 1 | unavailable | codex not installed; native fallback timed out |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved) | 3 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable. No outside findings.
- **VERDICT:** Eng review run with every finding resolved by owner answers (D1–D3). Status is issues_open because the findings became mapped work (T1–T9), not because anything is open. Ready to implement.

NO UNRESOLVED DECISIONS
