# MUT-447 — API: one cross-profile verdict read for Reports — implementation plan

Ticket: MUT-447 (Story, Backlog), epic MUT-446. It blocks MUT-448 (portal Glance) and MUT-449 (phone Glance).
Design doc (APPROVED): `~/.gstack/projects/vAWK3-mutaba3a/basel-main-design-20261026-111558.md`, verdict rules R1–R8.
Base: local main 50c689f6, API 1.75.0-mut436. The next free numbers are ADR-202 and TD-262.

## 1. What the code says (the read that shaped this plan)

- Every summary today is **per organization**: `c.get('auth').organization`, picked by the session's `X-Mutaba3a-Profile` header (`auth/middleware.ts:selectProfile`).
- **Person-level reads already exist.** `GET /v1/entries` (MUT-270) reads across a person's memberships:
  - it carries no profile header;
  - it is listed in `ENTRIES_ORGANIZATION_INDEPENDENT_ROUTES`, which `app.ts:325` merges;
  - its gate class is `'person'` in `billing/gate.ts` `PERSON_LEVEL_GATE`;
  - LOCKED profiles are dropped using `c.get('personEntitlements')`.
  The verdict copies that shape.
- `personal-profile.ts` already has `ownedOrCoOwnedProfilesOf(store, userId)` (R2) and `profileTypeOf`. MUT-435's MCP read tools use the same door (P1).
- `summaries/activity.ts` `summarizeActivity()` is pure and already computes, from POSTED payments and expenses:
  - per-currency received/spent for `from`–`to`;
  - a 12-month `history` ending with `to`'s month;
  - `dataSince`.
  It is reused unchanged: no allocations are passed, so `daysToPaid` is empty.
- Owed comes from `compute.ts` `bucketize()`/`countsOn()` over OPEN receivables, exactly as `GET /v1/summaries/organization` does (ADR-033: one definition).
- FX:
  - `fx-rates.ts` `CachedFxRates.get()` + `crossRates(snapshot, base)`. A failure throws `FX_RATES_UNAVAILABLE`.
  - `summaryRoutes(store)` takes no FX today. `PORTAL_ROUTES` passes `deps.fxRates`, which is `CachedFxRates | null`.
  - Local mode builds a `CachedFxRates` over `PublicFxRateSource` (`src/hosted/local/index.ts:64`).
- Local mode registers its **own** organization-independent set (`createLocalApp.ts:103`: me, profiles, fx only). A person-level route must be added there as well, or signed-out Reports gets 422 PROFILE_REQUIRED.

## 2. Contract

`GET /v1/summaries/verdict?from=YYYY-MM-DD&to=YYYY-MM-DD`

**Request and access:**
- Session or device session only, with no `X-Mutaba3a-Profile`.
- Gate class: `person`.
- `from`/`to` are validated exactly like `/v1/summaries/activity`: the `activityDate` bounds, `END_BEFORE_START`, and `RANGE_TOO_LONG` at 13 months. Both default to this month.
- The **client** decides weeks (`weekStart` en Monday / ar Saturday), as ADR-189 D1 already does. That is why there is no `period`/`at` (it deviates from the ticket text on purpose).

**Response:**

```
{
  from, to, asOf,                                   // asOf = today in the base profile's timezone (R4 profile)
  base: Currency,                                   // R4: oldest personal profile's default; else the oldest included profile's
  rates: { date: IsoDate, source: 'live'|'stale' } | null,   // null = FX unavailable → converted fields null
  profiles: [{
    profileId, name,
    kind: 'BUSINESS' | 'PERSONAL' | 'FIRM',         // X1 (D2): operator firms where the person is OWNER
    shared: boolean,                                // co-owned (more than one owner) — R6
    currencies: [{ currency, received, spent, net }],          // period, per currency (decimal strings)
    converted: { received, spent, net } | null,     // in base, null when any currency lacks a rate
    history: [{ month, currencies: [{ currency, received, spent }] }],  // 12 months ending with to's month
    owed: { currencies: [{ currency, outstanding, overdue }], overdueCount }
  }],
  total: {
    label: 'kept' | 'businessNet',                  // businessNet when no PERSONAL profile is included (R3)
    currencies: [{ currency, net }],                // Σ net across all profiles, per currency (never summed across)
    converted: string | null,                       // ≈ in base
    inCurrencyOnly: Currency | null,                // ADR-189 D3: rates missing → the largest currency in view, unconverted
    sharedInFull: boolean                           // R6: true when any shared profile counts at 100%
  },
  usual: string | null,                             // R8, base currency
  owed: { currencies: [{ currency, outstanding, overdue }], converted: string | null, overdueCount },
  unavailable: [{ profileId, name, code }]          // LOCKED (SUBSCRIPTION_LAPSED) or a profile that failed to read
}
```

**Formulas:**
- **Kept** = Σ over every included profile of (received − spent). Business net − personal spent + personal came in is the same sum. The server returns one number; only the ledger displays a personal profile as "spent".
- **Usual (R8)** is set only when `from`–`to` is exactly one calendar month:
  - It is the median of combined kept, converted at today's rates (R4: one rate set), over the up to 6 months before `from`'s month.
  - A month counts only once it is complete: data began by its 7th day (the ADR-189 D3 stage rule), using combined `dataSince`.
  - Fewer than 3 such months gives null.
  - With an even count, the median is the mean of the two middle values, rounded to the base minor unit.

## 3. Files

| File | Change |
|---|---|
| `server/src/summaries/verdict.ts` (new, pure) | `composeVerdict({ profiles: [{ org, kind, shared, activity, owedReceivables }], rates, base, from, to, today })`: totals, conversion, usual, labels. Plus `convertToBase(currencies, rates, base)` → `{ minor } \| null`: minor ÷ rate, exponent-scaled, bigint, rounded half-up once. Plus `baseProfileOf(orgs)` for R4. No I/O. |
| `server/src/summaries/__tests__/verdict.test.ts` (new) | Unit tests (§5). Written first. |
| `server/src/routes/summaries.ts` | The new route. `summaryRoutes(store, fxRates)`. The route reads profiles (X1 rule), drops LOCKED profiles via `personEntitlements` (as entries does), and per profile in parallel (`Promise.allSettled`) reads POSTED payments + expenses over the history window and OPEN receivables. Then `summarizeActivity` (bucket=month, no allocations) per profile → `composeVerdict`. Exports `SUMMARY_ORGANIZATION_INDEPENDENT_ROUTES`. |
| `server/src/schemas.ts` | `VerdictQuerySchema` (reuses the activity date fields) and `VerdictSchema`. |
| `server/src/routes/portal-routes.ts` | `(deps) => summaryRoutes(deps.store, deps.fxRates)` |
| `server/src/app.ts` | Merge `SUMMARY_ORGANIZATION_INDEPENDENT_ROUTES`. `API_VERSION = '1.76.0-mut447'`. |
| `server/src/billing/gate.ts` | `'GET /v1/summaries/verdict': 'person'` |
| `src/hosted/local/createLocalApp.ts` | Add the set to local `organizationIndependent`. |
| `src/hosted/local/index.ts` | If `isFxRatesRead` warming is required, the verdict path warms FX the same way (verify in build). |
| `server/openapi.json` (generated) | Regenerate; `openapi:check`. |
| `server/src/__tests__/routes-verdict.test.ts` (new) | Route tests (§5). |
| `server/src/__tests__/route-security.test.ts`, gate tests | Register the endpoint (the existing tests fail loudly on an unlisted endpoint). |
| Knowledge files | ADR-202 (narrows ADR-189 D5; records R1–R8 and X1–X5 below), TD-262 (cross-profile in-memory aggregation, the TD-237 pattern), CHANGELOG, SYSTEM_OVERVIEW, TEST_PLAN; the design doc's R8 note already says "computed on the server". |
| `qa/features/…` | Map `server/src/summaries/verdict.ts` + route to the Reports feature MUT-448 adds (or an API feature if the catalog has one), so `release-qa lint` reports no unmapped file. |

## 4. Decisions for review

- **X1 — Which profiles count (R2 vs Basel's own firm).** R2 copied MUT-435 P1 (owned + co-owned). Operator firms have `ownerUserId = null`, so `ownsProfile` is false and **Sader Law Firm, and every Malafat pilot lawyer's firm, drops out of their own verdict.** Options:
  - (a) owned + co-owned + operator firms where the person's membership is OWNER, labelled kind `FIRM`;
  - (b) strict R2;
  - (c) firms only when firm features are on and the person is an explicit OWNER.

  Note: without firm features, every firm member defaults to OWNER (`roleForNewMembership`), so (a) counts a firm's full net for each OWNER member, the same as R6's 100% rule.
- **X2 — Lazy posting.** The organization summary posts due installments before reading Owed (ADR-037 d8); `/v1/entries` never posts. Should the verdict post per profile (SYSTEM actor), so its Owed equals Overview's, or read as is?
- **X3 — FX unavailable.** Never 503 the whole verdict: per-currency figures always come back, and converted fields are null with `rates: null`. (Proposed.)
- **X4 — Query = `from`/`to`, not `period`/`at`.** Week start stays a client rule (ADR-189 D1). (Proposed; deviates from the ticket text.)
- **X5 — `kind` for a personal operator?** Not reachable: personal is always owned. No action.

## 5. Tests (TDD: written first, red, then green)

**Unit — `verdict.test.ts`:**
- kept = Σ nets. A business + personal pair gives business net − personal spent.
- Personal "came in" adds to kept.
- No personal profile → label `businessNet`.
- Two personal profiles → both counted.
- Mixed USD/ILS with rates → converted is the sum at one rate set. Rounding is half-up once, at the end.
- Missing rate → converted null, and `inCurrencyOnly` = the largest currency in view.
- JOD (pegged) converts through USD.
- `base` = the oldest personal profile's currency. No personal → the oldest profile's.
- Usual:
  - null for a week, for a year, and for a partial month;
  - null with 2 complete months; set with 3 or more;
  - median of 6 (even) and of 5 (odd);
  - a month whose data began on the 8th doesn't count.
- Owed:
  - future-dated Owed (`countsOn`) is excluded;
  - `overdueCount` counts receivables with overdue > 0.

**Route — `routes-verdict.test.ts`** (memory store, `createApp`):
- 200 with no profile header.
- A staff member (BOOKKEEPER) on a firm-enabled profile is never included.
- Co-owned → `shared: true`, `sharedInFull: true`.
- Operator firm per the X1 outcome.
- Another person's profile is never included.
- A LOCKED profile goes to `unavailable` while billing is on.
- REVERSED payments and unpaid Owed don't change net.
- Validation: 422 `END_BEFORE_START` / `RANGE_TOO_LONG` / `DATE_INVALID`.
- FX source down → 200 with `rates: null`.
- An API-key principal is refused.
- The local app (`createLocalApp`) answers the route signed out.

**Commands:**
- `npm --prefix server run typecheck && npm --prefix server run lint && npm --prefix server run openapi:check && npm --prefix server test` (through `heavy`).
- CI also runs `test:db`.
- The portal-side local-app test runs under `npm run test:run -- src/hosted/local` (Node 22).

## 6. Scale and cost

Per request, per included profile: 3 list reads (payments in a 12-month window, expenses in the same window, OPEN receivables), run in parallel, plus one membership read and one entitlements read for the person. That is 5 profiles → 15 reads. Volumes per profile per year are hundreds of rows, aggregated in memory (TD-237 precedent → TD-262 records the ceiling and the upgrade trigger: a profile with >10k rows a year, or p95 > 500 ms). There's no extra FX call: the cache is in-process. It replaces N `/v1/summaries/activity` calls from each client.

## 7. Out of scope

Transfers / owner's pay (R5), bank balances, ownership-share splits, client UI (MUT-448/449), Explore data beyond `history` (MUT-451/452 use the existing activity read for clients and categories).

---

# /plan-eng-review — 2026-10-26

Target: this plan (`mut-447-verdict-api-plan.md`), fixed for the whole review.

## Scope record
feature answers: none asked (no cuts proposed); structure: A — Original arrangement (D1, answered 2026-10-26); accepted scope: plan §3 as written, i.e. new `summaries/verdict.ts` + `verdict.test.ts` + `routes-verdict.test.ts`, with 9 wiring edits; pending remedies: X1, X2, X3, X4.

## Scope Challenge findings
1. [P1] (confidence: 9/10) server/src/personal-profile.ts:56 — R2 (`ownedOrCoOwnedProfilesOf`) leaves operator firms out: `ownsProfile` = `profileOwnerOf(organization) === userId || (role === 'OWNER' && canCoOwn(organization))`, and an operator firm has `ownerUserId: null` (ports.ts:35, "null on every operator firm"). Basel's Sader Law Firm and every Malafat pilot firm vanish from their owner's verdict. → X1.
2. [P2] (confidence: 8/10) server/src/routes/summaries.ts:41 — the organization summary calls `postDueItems(...)` before reading Owed, while routes/entries.ts says "reading never lazy-posts". Without a rule, the verdict's Owed can differ from Overview's on a day an installment falls due. → X2.
3. [P2] (confidence: 9/10) server/src/fx-rates.ts:197 — `staleOrRefuse` throws `FX_RATES_UNAVAILABLE`, and the FX route answers 503. If the verdict calls `fxRates.get()` unguarded, Reports goes blank whenever the ECB source is down. → X3.
4. [P3] (confidence: 8/10) The ticket's `period`/`at` query vs routes/summaries.ts:170–176 (`from`/`to`) and binding MUT-175 D1 (weeks are computed by the client via weekStart). → X4.
5. [P2] (confidence: 9/10) src/hosted/local/createLocalApp.ts:103 — local `organizationIndependent` lists only me, profiles and fx. A new person-level route that isn't added there answers 422 PROFILE_REQUIRED when signed out. Already in plan §3 (required wiring, no question).

## Decision ledger

### X1: Which profiles count in the verdict
Finding: 1, P1, 9/10, server/src/personal-profile.ts:56, Claude review
Plan baseline: R2 = owned + co-owned only (`ownedOrCoOwnedProfilesOf`), design doc as approved 2026-10-26
Runtime evidence: an operator firm has `ownerUserId: null` (ports.ts:35); `ownsProfile` is false for it (personal-profile.ts); `roleForNewMembership` gives OWNER on a firm without firm features, BOOKKEEPER with them (firm.ts:11–13)
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| X1 profiles counted | owned + co-owned | owned + co-owned + operator firms where the person's membership is OWNER (kind FIRM; "shared" when it has more than one OWNER member) | owned + co-owned only | owned + co-owned + operator firms only where firm features are on and the person is an explicit OWNER |
| X2 lazy posting | pending | pending | pending | pending |
| X3 FX unavailable | pending | pending | pending | pending |
| X4 query shape | pending | pending | pending | pending |
Question D2:
D2 — Which profiles count in a person's verdict? (your law firm is the test case)
Project/branch/task: MUT-447 verdict endpoint, plan in scratchpad.
ELI10: The design said "profiles you own or co-own". In the code, an operator firm (like Sader Law Firm, and every Malafat pilot firm) has no owner column, so that rule leaves your law income out of your own Reports. We can count firms where you are an OWNER member. On a firm without firm features every member is OWNER by default, so a colleague added to such a firm would also see its full net in their own kept.
Stakes if we pick wrong: B hides a real income stream from exactly the lawyers we're piloting with. A can count a firm's whole net for a non-partner member who was added as OWNER by default.
Recommendation: A because the person's own law practice is real income they expect to see, and it follows the same 100% rule already accepted for co-owned profiles (R6).
Completeness: A=9/10, B=6/10, C=7/10
Net: count the firms people actually earn from vs. keep the stricter agent-era rule.
Header: Profiles
Options:
A) Owned + firms as OWNER (recommended)
✅ Your Sader Law Firm and pilot lawyers' firms appear in their verdict as a FIRM line. ✅ Staff (BOOKKEEPER/SUBMITTER) never see a firm's money in their kept. ❌ On a firm without firm features, any member added by default as OWNER sees its full net. (human ~0.5 day / CC ~15 min)
B) Owned + co-owned only
✅ Exactly the approved R2; the same door as the MCP agent tools (P1). ✅ No firm money ever reaches anyone's personal verdict. ❌ Your law income and every pilot lawyer's firm income are missing from Reports.
C) Firms only with firm features
✅ Counts a firm only where ownership is explicit (firm features on, named OWNER). ✅ No default-OWNER leak to colleagues. ❌ Firms without firm features (most Malafat tenants today) still drop out, possibly including yours.

State: approved
Actual answer: A) Owned + firms as OWNER (D2, 2026-10-26)
Accepted scope: profiles counted = owned + co-owned (ownsProfile) + operator firms where the person's membership role is OWNER. Those firms get kind `FIRM` and `shared: true` when the firm has more than one OWNER member. BOOKKEEPER/SUBMITTER memberships never count. A new helper `verdictProfilesOf(store, userId)` sits next to `ownedOrCoOwnedProfilesOf` in personal-profile.ts. Tests: firm OWNER included, firm BOOKKEEPER excluded, a firm with 2 OWNER members → shared. ADR-202 records that this widens R2 for a person's own Reports only (agent P1 unchanged).
History: none

### X2: Lazy posting before reading Owed
Finding: 2, P2, 8/10, server/src/routes/summaries.ts:41, Claude review
Plan baseline: open question in plan §4 (no proposal)
Runtime evidence: the organization summary runs `postDueItems(posting.store, organization, today, now, posting.actor)` (summaries.ts:41) through `lazyPostingOf` → `unguarded(store)` for a SYSTEM actor (middleware.ts:485–487); store-guard.ts says "a test pins its call sites"; entries.ts:27 says "reading never lazy-posts"
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| X1 profiles | approved: owned + co-owned + firms as OWNER (D2) | same | same |
| X2 lazy posting | unspecified | post due items per included profile (SYSTEM actor, unguarded, through one helper `postDueForProfiles`) before reading Owed; update the pinned call-site test | read only; Owed can trail Overview until the reconcile job posts; documented in the API description |
| X3 FX unavailable | pending | pending | pending |
| X4 query shape | pending | pending | pending |
Question D3:
D3 — Should the verdict post due installments before it reads what you're owed?
Project/branch/task: MUT-447 verdict endpoint, plan in scratchpad.
ELI10: Agreements with installments become "owed" only once something posts them. Overview posts anything due right before it reads, so it's always current. The cross-profile feed (/v1/entries) never posts. If the verdict doesn't post, on the day an installment falls due Reports can say "₪X owed" while Overview says more, until the nightly job catches up.
Stakes if we pick wrong: B shows two different owed numbers on two screens on due days, which is the kind of mismatch that erodes trust in money numbers. A adds a write inside a read and one more use of the guarded-store escape hatch.
Recommendation: A because one owed figure everywhere is the product's rule (ADR-033, one definition), and the hatch is used here for exactly the job it exists for (ADR-037 d8).
Completeness: A=9/10, B=7/10
Net: matching Overview on due days vs. keeping this route read-only.
Header: Lazy posting
Options:
A) Post due items first (recommended)
✅ Reports' owed always equals Overview's, the same posting path ADR-037 d8 already uses. ✅ No new concept: reuses postDueItems with the SYSTEM actor per included profile. ❌ A GET that can write, plus one more pinned call site of unguarded(store) to review and test. (human ~0.5 day / CC ~20 min)
B) Read only
✅ The route never writes, matching the /v1/entries person-level precedent. ✅ No new use of the guarded-store escape hatch. ❌ On due days Reports' owed can trail Overview's until the nightly reconcile job runs.

State: approved
Actual answer: A) Post due items first (D3, 2026-10-26)
Accepted scope: before reading Owed, the route runs `postDueItems` per included profile, with today in that profile's timezone and the SYSTEM actor, on `unguarded(store)`. This goes through one helper (`postDueForProfiles`, summaries.ts) that is added to the pinned call-site test of `unguarded`. Tests: an installment due today shows in the verdict's Owed and equals GET /v1/summaries/organization's outstanding for that profile; the posting is audited as SYSTEM.
History: none

### X3: FX rates unavailable
Finding: 3, P2, 9/10, server/src/fx-rates.ts:197, Claude review
Plan baseline: plan §4 X3 proposed "never 503; converted null, rates null"
Runtime evidence: `staleOrRefuse` throws ApiError FX_RATES_UNAVAILABLE when nothing servable is cached (fx-rates.ts:195–198); the FX route documents 503; in local mode `fxRates` is a CachedFxRates over PublicFxRateSource (local/index.ts:64), and the route deps allow `null` (portal-routes.ts PortalRouteDependencies)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| X1 profiles | approved (D2) | same | same |
| X2 lazy posting | approved: post first (D3) | same | same |
| X3 FX unavailable | unspecified | catch FX_RATES_UNAVAILABLE (and a null fxRates): 200 with per-currency figures, every converted field null, `rates: null`, usual null | let FX_RATES_UNAVAILABLE propagate: the whole verdict answers 503 |
| X4 query shape | pending | pending | pending |
Question D4:
D4 — When exchange rates are down, does Reports still answer?
Project/branch/task: MUT-447 verdict endpoint, plan in scratchpad.
ELI10: The "≈ kept" total needs today's ECB rates to add shekels and dollars. If the rate source is down and nothing fresh is cached (more than 7 days old), we can either still return every number per currency, with the converted total empty, or fail the whole request. Someone with only shekels doesn't even need rates.
Stakes if we pick wrong: B blanks Reports for everyone, single-currency users included, whenever a third-party rate feed hiccups. A means the apps must render a "per currency only" state.
Recommendation: A because per-currency truth is always available and is the product's rule (ADR-004); conversion is a convenience on top.
Completeness: A=9/10, B=5/10
Net: graceful per-currency fallback vs. all-or-nothing.
Header: FX down
Options:
A) Answer without conversion (recommended)
✅ Reports keeps working when the ECB feed is down; single-currency users see no difference. ✅ Matches ADR-004 and the existing "In {currency} only" label (ADR-189 D3). ❌ Portal and phone must render converted=null; one more state to test in MUT-448/449. (human ~1 hr / CC ~10 min)
B) Fail the whole request
✅ Simplest server code: no catch, the existing 503 contract. ✅ Clients never see partial totals. ❌ Reports goes blank for every user, single-currency ones included, while the rate feed is down.

State: approved
Actual answer: A) Answer without conversion (D4, 2026-10-26)
Accepted scope: the route catches FX_RATES_UNAVAILABLE and handles a null `fxRates`. It answers 200 with per-currency figures, every converted field null, `rates: null` and usual null. Where every currency in view is the base currency, the converted figures are the plain sums and need no rates ("single-currency users see no difference"). Tests: FX source down with mixed currencies → converted null and 200; FX down with base-only currencies → converted filled; no fxRates (null deps) → same as down.
History: none

### X4: Query shape
Finding: 4, P3, 8/10, server/src/routes/summaries.ts:170–176, Claude review
Plan baseline: the ticket says `period` (week|month|year) + `at`; plan §2 proposes `from`/`to`
Runtime evidence: /v1/summaries/activity takes `from`/`to`/`bucket` and validates dates with `activityDate` (summaries.ts:246); binding MUT-175 eng D1 says weeks are computed in the portal via `weekStart` (en Monday, ar Saturday)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| X1–X3 | approved (D2–D4) | same | same |
| X4 query | ticket: period + at | `from`/`to`, validated and defaulted exactly like /v1/summaries/activity; the client picks week bounds; "usual" is set only when from–to is one whole calendar month | `period` + `at` (+ a `weekStart` param); the server derives the bounds |
Question D5:
D5 — Does the app send exact dates, or a period name?
Project/branch/task: MUT-447 verdict endpoint, plan in scratchpad.
ELI10: The ticket said the app asks for "month, at October". But a week starts on Monday in English and Saturday in Arabic, and the portal already owns that rule for today's Reports. Sending exact from/to dates keeps one rule in one place, and it matches the existing Reports endpoint the apps already call.
Stakes if we pick wrong: B moves the week rule to the server, so it now lives in two places (portal + server) plus the phone, and they can drift. A asks the phone to compute week bounds too, as it already must for its own lists.
Recommendation: A because it reuses the activity endpoint's validated contract and keeps the binding MUT-175 D1 week rule in the client.
Note: options differ in kind, not coverage, so there's no completeness score.
Net: consistent with the existing Reports API vs. literal to the ticket text.
Header: Query shape
Options:
A) from/to dates (recommended)
✅ Same parameters, validation and errors as /v1/summaries/activity, which both apps already call. ✅ Week start stays a client rule (MUT-175 D1); the server stays locale-free. ❌ Deviates from the ticket text; the ticket gets a comment so MUT-448/449 aren't surprised. (human ~0 / CC ~5 min)
B) period + at
✅ Literal to the ticket; the apps send intent, not dates. ✅ The server can name the period in its response. ❌ The week-start rule moves to the server, and a locale param creeps into a money API.

State: approved
Actual answer: A) from/to dates (D5, 2026-10-26)
Accepted scope: query is `from`/`to`, validated and defaulted exactly like /v1/summaries/activity (shared `activityDate` + END_BEFORE_START + RANGE_TOO_LONG). The client computes week bounds. "Usual" is set only when from–to is one whole calendar month. A comment on MUT-447 records the deviation from the ticket's `period`/`at` (and tells MUT-448/449).
History: none

Scope Challenge result: scope accepted as-is (structure A; X1–X4 approved, none reduce scope).

## Section 1 — Architecture
```
GET /v1/summaries/verdict?from&to   (session/device session, no X-Mutaba3a-Profile)
  │ authenticate(): organizationIndependent ──► gatePersonLevel('person') ──► personEntitlements (gate on)
  ▼
verdictProfilesOf(store, userId)            X1: owned + co-owned + firm OWNER memberships
  │ drop LOCKED (personEntitlements)        ← must happen BEFORE posting (A1)
  ▼
per profile, in parallel (allSettled) ─────────────────────────────┐
  postDueItems(unguarded, org, todayFor(org), now, SYSTEM)   X2     │ failure → unavailable[{code}] + reporter (A3)
  payments POSTED [historyStart(to)..historyEnd(to)]                │
  expenses        [same window]                                     │
  receivables OPEN → countsOn(today) → bucketize                    │
  summarizeActivity(bucket=month, no allocations)                   │
  ◄─────────────────────────────────────────────────────────────────┘
fxRates.get() ── FX_RATES_UNAVAILABLE / null ──► rates:null (X3)
  ▼
composeVerdict(...)  pure: totals, convertToBase, usual (Month only, X4), labels
  ▼
200 VerdictSchema
```
1. [P2] (confidence: 8/10) server/src/routes/entries.ts:73–76 — LOCKED profiles are dropped using `c.get('personEntitlements')`. Under X2 the verdict also *posts*, so the LOCKED filter must run before any posting. Otherwise a lapsed profile gets catch-up writes from a read. Required ordering of the approved X2 behavior; added to tests (no question).
2. [P3] (confidence: 8/10) server/src/routes/summaries.ts:39 — `todayFor(organization, now)` is per profile. Profiles in different timezones can disagree on "today". Owed/overdue use each profile's own today (same as Overview); `asOf` reports the base profile's today. Documentation in the route description; no behavior choice.
3. [P2] (confidence: 7/10) plan §2 `unavailable` — a per-profile read that throws a non-ApiError must also go to the error reporter (the MUT-435 `toolError` pattern), not only into `unavailable`, or failures are silent in Sentry. Required error handling for the approved partial-failure behavior (no question).

Dispositions: 1 accepted as required ordering of X2 (D3); 2 accepted as documentation; 3 accepted as required error handling.

## Section 2 — Code quality
1. [P2] (confidence: 8/10) src/hosted/data/reports.ts:84–92 — `firstCompletable…`/`completeMonths` with `COMPLETE_MONTH_CUTOFF_DAY = 7` defines "complete month" for the portal's stage. The verdict's "usual" needs the same rule on the server. Two definitions can drift (stage 3 shown while usual is null, or the reverse). → X5.
2. [P3] (confidence: 7/10) src/hosted/data/reports.ts:317–340 `chooseUnit`/`convertMoney` vs the proposed server `convertToBase`. The inputs differ (`FxRatesResponse` wire vs `FxRate[]`), and MUT-448 will show the server's converted figures rather than convert itself. Not extracted: incompatible contracts and no shared caller. `convertToBase` lives in server/src/fx-rates.ts next to `crossRates`.
3. [P3] (confidence: 8/10) The `summaryRoutes(store)` → `summaryRoutes(store, fxRates)` signature change touches PORTAL_ROUTES only. Existing route tests (routes-activity.test.ts, organization summary tests) keep regression coverage for the unchanged routes.

### X5: One "complete month" rule for portal stage and server usual
Finding: Section 2 #1, P2, 8/10, src/hosted/data/reports.ts:84–92, Claude review
Plan baseline: plan §2 proposes a server-side reimplementation inside verdict.ts
Runtime evidence: portal callers import pure server modules already (e.g. src/hosted/data/billingView.ts, incomeAffordances.ts import server/src); the rule today lives only in reports.ts (`COMPLETE_MONTH_CUTOFF_DAY = 7`, `completeMonths`)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| X1–X4 | approved (D2–D5) | same | same |
| X5 complete-month rule | portal only; plan adds a server copy | move `COMPLETE_MONTH_CUTOFF_DAY`, `firstCompletableMonth`, `completeMonths` to `server/src/summaries/months.ts` (pure); portal reports.ts re-exports/imports them; verdict uses them; the existing reports tests still pass + one shared-contract test | server copy in verdict.ts; portal unchanged; a comment cross-references the two |
Question D6:
D6 — Should the portal and the server share one "complete month" rule?
Project/branch/task: MUT-447 verdict endpoint, plan in scratchpad.
ELI10: Reports only trusts a month once your records started by its 7th day. The portal uses that rule to decide when insights unlock; the new server "usual" needs the same rule. We can move the ~15-line rule into a small server file the portal already knows how to import, or copy it.
Stakes if we pick wrong: with two copies, a later tweak to one makes Reports say "your usual" on one screen while hiding insights on another for the same months.
Recommendation: A because one definition is the house rule (ADR-033), the portal already imports pure server modules, and the move is small with existing tests guarding it.
Completeness: A=9/10, B=7/10
Net: one moved rule now vs. two copies kept in sync by hand.
Header: Month rule
Options:
A) Share one rule (recommended)
✅ Portal stage and server usual can't disagree about which months count. ✅ The portal already imports pure server modules (billingView.ts), so there's no new build seam. ❌ Touches MUT-175's reports.ts (a move plus imports); its existing tests must stay green. (human ~1 hr / CC ~10 min)
B) Copy on the server
✅ Doesn't touch the shipped portal Reports code in this ticket. ✅ Smallest diff for MUT-447. ❌ Two copies of the rule; drift shows up as mismatched stage and usual.

State: approved
Actual answer: A) Share one rule (D6, 2026-10-26)
Accepted scope: move `COMPLETE_MONTH_CUTOFF_DAY`, the first-completable-month helper and `completeMonths` from src/hosted/data/reports.ts to a new pure `server/src/summaries/months.ts`. reports.ts imports them (keeping its exported names for its callers), and verdict.ts uses them for usual. Existing src/hosted/data/__tests__ reports tests stay green unchanged, and one shared-contract test in server/src/summaries/__tests__/months.test.ts pins the 7th-day rule.
History: none

Dispositions (Section 2): 1 → X5 approved A (D6); 2 not extracted (incompatible contracts, recorded); 3 covered by existing tests.

## Section 3 — Tests
Framework: Vitest for both server (`npm --prefix server test`) and portal (`npm run test:run`), per CLAUDE.md Phase 4; route tests use createApp + MemoryLedgerStore (pattern: server/src/__tests__/routes-activity.test.ts).

```
CODE PATHS                                                         USER FLOWS (API consumers)
[+] routes/summaries.ts GET /v1/summaries/verdict                  [+] Portal/phone Glance load
  ├── auth: session, no profile header ......... [GAP] route test    ├── [GAP] 1 business + 1 personal → 2 lines, kept
  ├── API key principal → refused .............. [GAP] route test    ├── [GAP] 5 profiles (Basel shape) incl. FIRM + shared
  ├── from/to validation (422 ×3) .............. [GAP] route test    ├── [GAP] signed out (createLocalApp) answers
  ├── verdictProfilesOf (X1)                                         └── [GAP] billing gate on: LOCKED → unavailable
  │   ├── owned / co-owned(shared) / firm OWNER  [GAP] route test
  │   └── BOOKKEEPER/SUBMITTER, other person's   [GAP] route test (excluded)
  ├── LOCKED dropped before posting (A1) ....... [GAP] route test
  ├── postDueItems per profile (X2) ............ [GAP] route test: due-today installment in owed == org summary
  ├── per-profile failure → unavailable + report [GAP] route test (store stub throws for one org)
  └── fxRates down / null (X3) ................. [GAP] route test ×2
[+] summaries/verdict.ts composeVerdict (pure)
  ├── kept = Σ net; personal spent/came in ..... [GAP] unit
  ├── label businessNet when no PERSONAL ....... [GAP] unit
  ├── two PERSONAL profiles .................... [GAP] unit
  ├── convertToBase: mixed, missing rate, JOD peg, base-only w/o rates  [GAP] unit (table)
  ├── inCurrencyOnly = largest currency ........ [GAP] unit
  ├── base = oldest PERSONAL else oldest ....... [GAP] unit
  ├── usual: non-month null / <3 months null / odd / even median / 8th-day month skipped [GAP] unit (table)
  └── owed: future Owed excluded, overdueCount   [GAP] unit
[+] summaries/months.ts (moved, X5) ............ [★★★ TESTED] via src/hosted/data/__tests__ reports tests; + [GAP] months.test.ts shared contract
[+] summaries/activity.ts (reused unchanged) ... [★★★ TESTED] routes-activity.test.ts, summaries/__tests__
[+] createLocalApp organizationIndependent ..... [GAP] local app test (src/hosted/local/__tests__)
[+] billing/gate.ts PERSON_LEVEL_GATE entry .... [★★ TESTED] gate.test fails on unlisted endpoint (existing)
[+] unguarded() pinned call sites .............. [★★ TESTED] existing pin test — must be updated for postDueForProfiles

COVERAGE (planned): 0/24 existing for new paths; all 24 have a planned test below  |  QUALITY target ★★★ on pure, ★★ on route wiring
```
Regression rule: existing behavior at risk = the summaryRoutes signature (activity + organization summaries) and reports.ts stage after the X5 move; existing suites (routes-activity.test.ts, reports tests) are the regression contract, carried forward unchanged (approved X5 scope says "stay green unchanged").

Planned tests (value cards):
- server/src/summaries/__tests__/verdict.test.ts (unit, table-driven) — Value: protects=kept/label/base/usual/owed rules R1–R8; fails_when=a formula or rounding changes; why_new=no verdict code exists; seam=none; no_claim=store queries (pure input)
- server/src/summaries/__tests__/months.test.ts (unit) — Value: protects=7th-day complete-month rule shared by portal and server; fails_when=cutoff or window changes on one side; why_new=rule moves modules; seam=none; no_claim=none beyond protects
- server/src/__tests__/routes-verdict.test.ts (integration, memory store) — Value: protects=profile set X1, LOCKED-before-post, posting X2, FX fallback X3, validation X4, partial failure; fails_when=a profile leaks, a lapsed profile is posted to, FX outage 503s; why_new=new route; seam=none; no_claim=Postgres query plans (memory store; test:db covers store methods)
- src/hosted/local/__tests__ (extend existing local app test) — Value: protects=signed-out Reports reaches the route; fails_when=route missing from local organizationIndependent; why_new=new person-level route; seam=none; no_claim=real FX in browser
- update existing unguarded pin test and PERSON_LEVEL_GATE coverage (extend, not new)
Tests made obsolete: none.

Dispositions (Section 3): all gaps become planned tests under approved X1–X5 behavior; no new choices.

## Section 4 — Performance
1. [P3] (confidence: 7/10) per request: 1 membership read + per included profile {listUnpostedDue (X2), payments, expenses, receivables} ≈ 4N+1 reads; Basel N=5 → 21 [estimated]. Parallel per profile; listAll pages of 200. A firm with thousands of rows/year is read in memory (TD-237 precedent → TD-262 with trigger: >10k rows/profile/year or p95 > 500 ms) [estimated, re-measure before gate].
2. [P3] (confidence: 6/10) Medium confidence, verify: every ‹ › step re-reads 12 months per profile. Client TanStack Query caching by (from,to) absorbs repeats; no server cache proposed.
No issues requiring a choice.

## Outside Voice (Claude subagent, native fallback: Codex not installed)
Reviewer: Plan subagent, completed inside the 5-minute window. Findings OV1–OV8 (verified by the parent against the code):
- OV1 High — writability-routes.test.ts:307–308 pins `unguarded()` to auth/middleware.ts only; `lazyPostingOf(c, store)` already returns the unguarded store + SYSTEM actor for any session (middleware.ts:485–487). → X2b
- OV2 High — `completeMonths` (reports.ts:90–97) counts back from today and needs `earlier`; only `firstCountedMonth` (reports.ts:85, not exported) and the cutoff fit "usual". The billingView/incomeAffordances precedent was wrong (they import ../api/client); the real one is src/lib/observability/browserSentry.ts:2–3. → X5b
- OV3 Medium — the activity route adds `earlierData` reads (summaries.ts:184–189); the verdict's `dataSince` is the earliest row inside the window only, so usual can drop months the portal counts as complete. → X6
- OV4 Medium — local/index.ts:72 warms FX before the cross-tab lock only for /v1/fx-rates; the verdict would wait on the network inside the lock (review D2 of MUT-287). Disposition: required implementation of approved X3 in local mode (extend `isFxRatesRead` to the verdict path) — accepted without a question; test added.
- OV5 Medium — local/transport.ts:105 persists only after mutating methods; X2's posting on a GET is lost on stale reload in local mode. → X7
- OV6 Low — combined `dataSince` = earliest across profiles blends business-only months into a usual compared with a month that includes personal spending. → X8
- OV7 Low — the cost estimate excludes posting writes; disposition: TD-262 trigger reads "p95 > 500 ms measured with posting on" (documentation, accepted).
- OV8 Low — defaults for from/to need a timezone; the verdict has no selected profile. → X9

### X2b: How X2's posting reaches the unguarded store
Finding: OV1, High, 9/10, server/src/__tests__/writability-routes.test.ts:307–308, outside voice (verified)
Plan baseline: X2 approved (D3) with "one helper `postDueForProfiles` … added to the pinned call-site test of `unguarded`"
Runtime evidence: test asserts `callSites(/\bunguarded\(/)` equals ['auth/middleware.ts']; lazyPostingOf returns `{ store: unguarded(store), actor }` for a session
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| X2 behavior (post first) | approved D3 | unchanged | unchanged | unchanged | unchanged |
| X2b mechanism | new helper calls unguarded(); unguarded pin edited | call `lazyPostingOf(c, store)` once in the route; pass `{store, actor}` to `postDueItems` per profile; unguarded pin unchanged; the lazyPostingOf call-site list gains routes/summaries.ts verdict (already lists summaries.ts) | as approved | check whether lazyPostingOf's list already covers summaries.ts (≤10 min), then ask again; nothing changes meanwhile | leave as approved for now; revisit in build |
Question D7:
D7 — Use the existing lazyPostingOf door instead of a new unguarded() call?
Project/branch/task: MUT-447 verdict endpoint, plan in scratchpad.
ELI10: A test guarantees only one place in the code may bypass the store's safety guard. The approved plan added a second place. The outside reviewer points out the existing door (lazyPostingOf) already does exactly what we need for any signed-in person, so we can post through it and leave the guarantee untouched. Same behavior, safer path.
Stakes if we pick wrong: B weakens a security invariant that exists so nobody can quietly write around the guard.
Recommendation: A because it keeps the pinned invariant intact with no behavior change.
Note: options differ in kind, not coverage, so there's no completeness score.
Net: same posting, through the door that already exists.
Header: Posting door
Options:
A) Apply this change (recommended)
✅ unguarded() stays callable only from auth/middleware.ts; the pin test is untouched. ✅ Reuses lazyPostingOf, the posting path ADR-037 d8 already documents. ❌ The lazyPostingOf call-site list in the same test must name the verdict route. (human ~15 min / CC ~5 min)
B) Keep this row's current value
✅ Matches what D3 approved word for word. ✅ No further discussion. ❌ Adds a second unguarded() call site and edits a security pin test for no gain.
C) Investigate before choosing
✅ Confirms the lazyPostingOf list's current entries before deciding. ✅ Nothing changes while we look (≤10 min). ❌ Delays a choice the evidence already settles.
D) Defer this proposed change only
✅ Leaves the approved mechanism in place for now. ✅ The build can still revisit. ❌ Likely rework mid-build when the pin test fails review.

State: approved
Actual answer: A) Apply this change (D7, 2026-10-26)
Accepted scope: the route calls lazyPostingOf(c, store) once and passes its {store, actor} to postDueItems for each included, non-LOCKED profile. No postDueForProfiles helper calls unguarded(). The unguarded() pin test is unchanged; the lazyPostingOf call-site pin names routes/summaries.ts (verify the existing entry). This supersedes the mechanism text in X2's accepted scope (behavior unchanged).
History: none

### X5b: Exactly what moves for the shared month rule
Finding: OV2, High, 9/10, src/hosted/data/reports.ts:84–97, outside voice (verified)
Plan baseline: X5 approved (D6): move the cutoff, the first-completable helper and `completeMonths` to server/src/summaries/months.ts
Runtime evidence: `completeMonths(since, earlier, today)` builds an 11-month window back from *today* and short-circuits on `earlier`; `firstCountedMonth` is module-private; portal imports of server pure modules exist in src/lib/observability/browserSentry.ts:2–3 (not billingView)
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| X5 behavior (one rule) | approved D6 | unchanged | unchanged | unchanged | unchanged |
| X5b what moves | cutoff + helper + completeMonths | move only `COMPLETE_MONTH_CUTOFF_DAY` and `firstCountedMonth(since)` (exported) to months.ts; `completeMonths` stays in reports.ts and imports them; the server's usual builds its own window (≤6 months before from) from the same helper; the precedent cited = browserSentry.ts | move all three as approved (completeMonths' today-based window then lives on the server unused) | read every completeMonths caller (≤15 min), then ask | keep the approved text; decide during build |
Question D8:
D8 — Move only the 7th-day rule, not the whole "complete months" list?
Project/branch/task: MUT-447 verdict endpoint, plan in scratchpad.
ELI10: We agreed to share the rule "a month counts once records began by its 7th day". The reviewer found the portal's list function counts back from today and has a portal-only flag, so it doesn't fit "the 6 months before October" on the server. The clean cut is to share just the rule itself (the cutoff and one small function) and let each side build its own list of months from it.
Stakes if we pick wrong: B moves a function the server can't use as-is, so the build either bends it or quietly writes a second window anyway.
Recommendation: A because it shares exactly the part both sides need, and the portal's tests stay unchanged.
Note: options differ in kind, not coverage, so there's no completeness score.
Net: share the rule, not the portal's today-based list.
Header: What moves
Options:
A) Apply this change (recommended)
✅ Shares exactly the 7th-day rule both sides use; nothing unused moves to the server. ✅ reports.ts keeps completeMonths and its tests unchanged. ❌ Two small month-window builders remain (portal: from today; server: before from), both fed by the shared rule. (human ~30 min / CC ~5 min)
B) Keep this row's current value
✅ Matches D6's wording exactly. ✅ No further discussion. ❌ Moves a today-based function the server can't use for "usual" without changing it.
C) Investigate before choosing
✅ Reads every completeMonths caller first (≤15 min). ✅ Nothing changes meanwhile. ❌ The evidence already shows the mismatch.
D) Defer this proposed change only
✅ Leaves D6's text in place. ✅ The build can decide. ❌ Ambiguity lands mid-build.

State: approved
Actual answer: A) Apply this change (D8, 2026-10-26)
Accepted scope: server/src/summaries/months.ts exports COMPLETE_MONTH_CUTOFF_DAY and firstCountedMonth(since). reports.ts imports both, and its completeMonths and their tests stay unchanged. The verdict's usual builds its own window (up to 6 months before from's month) using firstCountedMonth. months.test.ts pins the 7th-day rule. The precedent for portal→server imports is src/lib/observability/browserSentry.ts:2–3. This supersedes X5's 'move completeMonths'.
History: none

### X6: Use earlierData so usual counts the same months as the portal
Finding: OV3, Medium, 8/10, server/src/routes/summaries.ts:184–189 + activity.ts:82, outside voice (verified)
Plan baseline: plan §2 uses combined `dataSince` from `summarizeActivity` only
Runtime evidence: the activity route runs two `limit: 1` probes (payments before `start`, expenses before `start`) to set `earlierData`; the portal treats earlier=true as "every window month counts"; `dataSince` covers only rows inside the read window
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| X6 data start for usual | dataSince inside window only | per profile also run the two limit-1 probes; a profile with earlier data counts every month in the window; §6 read count becomes ≈6N+1 | as is; document that a long quiet stretch can drop months from usual | probe how often profiles have >12-month history (≤15 min) | leave; revisit after MUT-450 |
Question D9:
D9 — Should "usual" know about records older than the 12-month window?
Project/branch/task: MUT-447 verdict endpoint, plan in scratchpad.
ELI10: The server reads 12 months. If someone has used MTB3A for two years but had a quiet patch, the server thinks their data "started" at the first row it sees in the window and skips months the portal already counts as complete. Two tiny extra reads per profile ("is there anything older?") fix that, the same trick the existing Reports endpoint uses.
Stakes if we pick wrong: B can show "no usual yet" or a usual over fewer months than the portal's insights for long-time users, the drift X5 was meant to prevent.
Recommendation: A because it's two indexed limit-1 reads per profile, copying the existing activity route exactly.
Completeness: A=9/10, B=6/10
Net: two cheap reads per profile vs. a known edge-case drift.
Header: Earlier data
Options:
A) Apply this change (recommended)
✅ Usual counts the same months the portal does, also for long-time users. ✅ Copies the activity route's existing earlierData probes; no new pattern. ❌ About 2 extra limit-1 reads per profile (≈6N+1 total). (human ~30 min / CC ~5 min)
B) Keep this row's current value
✅ Fewest reads per request. ✅ No change to the plan. ❌ Long-time users with a quiet stretch can get a shorter or missing usual.
C) Investigate before choosing
✅ Measures how many profiles have older history (≤15 min). ✅ Nothing changes meanwhile. ❌ The fix is cheap enough that the count rarely changes the answer.
D) Defer this proposed change only
✅ Ships without the probes now. ✅ Revisit after real-user validation (MUT-450). ❌ The drift ships in the first version.

State: approved
Actual answer: A) Apply this change (D9, 2026-10-26)
Accepted scope: each profile also runs the activity route's two limit-1 probes (POSTED payments before the window start, expenses before it). A profile with earlier data counts every month in the window; otherwise its months start at firstCountedMonth(dataSince). §6 becomes ≈6N+1 reads. Test: a profile with a row 14 months back and a 3-month quiet stretch still gets usual over the full 6 months.
History: none

### X7: Posting on a GET in local (signed-out) mode
Finding: OV5, Medium, 8/10, src/hosted/local/transport.ts:105, outside voice (verified)
Plan baseline: X2 (D3) posts due items before reading; R7 says local mode runs the same route
Runtime evidence: the local transport persists to IndexedDB only when `MUTATING_METHODS.has(request.method)`; posted rows from a GET live in memory until the next write, and a stale reload discards them (transport.ts:101). /v1/summaries/organization already behaves this way.
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| X7 local persistence | unspecified (same as organization summary) | keep posting in local mode and accept the existing organization-summary behavior: posting recomputes deterministically on every read, so a dropped in-memory post is re-posted next time; document + one local test that a reload then read gives the same owed | — (A is the documentation of current behavior) | check whether local posting is idempotent across reloads (≤15 min) | — |
Question D10:
D10 — In signed-out mode, is it fine that posted installments aren't saved until your next edit?
Project/branch/task: MUT-447 verdict endpoint, plan in scratchpad.
ELI10: Signed out, the app saves to the browser only after you change something. Overview already posts due installments on a read without saving, and they're simply posted again on the next read. The verdict would do the same. Owed always shows correctly; the posted rows just aren't written to disk until something else saves.
Stakes if we pick wrong: if posting were not repeatable, a reload could double or lose an installment, which is why the plan adds a test that a reload then a read gives the same owed.
Recommendation: A because it matches how Overview already works signed out, and the added test proves posting is repeatable.
Completeness: A=9/10, C=8/10
Net: accept and test the existing local behavior vs. a short investigation first.
Header: Local saves
Options:
A) Apply this change (recommended)
✅ Same as Overview's existing signed-out behavior; no new local-mode mechanism. ✅ A local test proves reload-then-read shows the same owed (no double post). ❌ Posted rows stay in memory until the next write is saved. (human ~30 min / CC ~5 min)
B) Investigate before choosing
✅ Confirms posting idempotency across reloads before deciding (≤15 min). ✅ Nothing changes meanwhile. ❌ The planned test proves the same thing during build.

State: approved
Actual answer: A) Apply this change (D10, 2026-10-26)
Accepted scope: local mode posts on the verdict GET exactly like the organization summary, with no new persistence mechanism. Documented in ADR-202. A local-app test checks that reload-then-read of the verdict shows the same owed and the same number of posted receivables (no double post).
History: none

### X8: Which months count for usual when profiles started at different times
Finding: OV6, Low, 7/10, plan §2 "using combined dataSince", outside voice (verified by reading the plan)
Plan baseline: combined data start = earliest across profiles
Runtime evidence: kept for a month sums every included profile; a profile that began recently contributes 0 to earlier months
Comparison grid:
| Choice | Current | A Apply | B Keep |
|---|---|---|---|
| X8 month counting | a month counts when the earliest profile was complete | a month counts for usual only when every included profile was complete in it (its own earlier data or firstCountedMonth ≤ month); fewer than 3 such months → usual null | earliest across profiles |
Question D11:
D11 — Should "usual" wait until all your profiles have a full month?
Project/branch/task: MUT-447 verdict endpoint, plan in scratchpad.
ELI10: Say your business has a year of records and you add your personal profile last month. The old months have no personal spending, so their "kept" looks bigger. Comparing this month (with personal spending) to that usual makes you look worse than you are. Counting a month only when every profile was complete avoids the false comparison, at the cost of "usual" appearing a bit later after you add a profile.
Stakes if we pick wrong: B shows a misleading "below your usual" right after someone adds a personal profile, the moment we most want their trust.
Recommendation: A because a usual that compares like with like is the point of the number.
Completeness: A=9/10, B=6/10
Net: honest comparison vs. a usual that shows up sooner.
Header: Usual months
Options:
A) Apply this change (recommended)
✅ This month is only compared with months that had the same set of profiles recording. ✅ No false "below usual" right after adding a profile. ❌ After adding a profile, usual hides until 3 full months exist for all of them. (human ~30 min / CC ~5 min)
B) Keep this row's current value
✅ Usual appears as soon as the oldest profile has 3 complete months. ✅ Simplest rule. ❌ Mixes months with and without a newer profile's spending into one median.

State: approved
Actual answer: A) Apply this change (D11, 2026-10-26)
Accepted scope: a month counts toward usual only when every included profile was complete in it (that profile has earlier data, or firstCountedMonth(its dataSince) ≤ month). Fewer than 3 such months → usual null. Unit test: a business profile with 12 months plus a personal profile started last month → usual null; once 3 shared months exist → set.
History: none

### X9: Whose "today" sets the default from/to
Finding: OV8, Low, 7/10, server/src/routes/summaries.ts:170–171 (defaults use the selected profile's today), outside voice
Plan baseline: X4 (D5) "defaulted exactly like /v1/summaries/activity", which assumes one selected profile
Runtime evidence: `todayFor(organization, now)` needs an organization; the verdict has none selected
Comparison grid:
| Choice | Current | A Apply | B Keep |
|---|---|---|---|
| X9 default timezone | undefined | defaults (this month) and `asOf` use the base profile's timezone (R4: oldest personal, else oldest included) | require from/to (no defaults; 422 when missing) |
Question D12:
D12 — When the app doesn't send dates, whose calendar decides "this month"?
Project/branch/task: MUT-447 verdict endpoint, plan in scratchpad.
ELI10: Each profile has its own timezone. Around midnight on the 1st, two profiles can disagree on which month it is. The verdict needs one answer when the app omits dates. Using the same profile that picks the base currency (your personal one) keeps one rule.
Stakes if we pick wrong: B makes every client send dates even for the default view; A could pick a different month from a profile in another timezone for a few hours at month change.
Recommendation: A because it reuses the R4 base profile, so currency and calendar come from the same place.
Note: options differ in kind, not coverage, so there's no completeness score.
Net: one sensible default vs. no defaults at all.
Header: Default month
Options:
A) Apply this change (recommended)
✅ One rule: the base profile picks both currency and calendar; asOf matches the defaults. ✅ Clients can call with no dates, like /v1/summaries/activity. ❌ For a few hours at month change, a profile in another timezone can disagree about the month. (human ~10 min / CC ~2 min)
B) Keep this row's current value
✅ Requiring from/to removes the timezone question entirely. ✅ Explicit over clever. ❌ Breaks parity with /v1/summaries/activity, which defaults to this month.

State: approved
Actual answer: A) Apply this change (D12, 2026-10-26)
Accepted scope: default from/to (this month) and asOf use the R4 base profile's timezone (oldest personal, else oldest included). The route description says so. Route test: two profiles in different timezones at month change → the defaults follow the base profile.
History: none

Approval readiness: PASS — structure D1; X1 D2; X2 D3 (mechanism X2b D7); X3 D4; X4 D5; X5 D6 (scope X5b D8); X6 D9; X7 D10; X8 D11; X9 D12. OV4 and OV7 were accepted as required implementation/documentation of approved X3/TD-262 (no new behavior).

## TODOS
None proposed: the follow-ups are already tickets (MUT-448..452, validation gate MUT-450).

## NOT in scope
- Transfers / owner's pay detection (R5): measured by MUT-450 before any rule.
- Bank balances / "can I afford": no data source.
- Ownership-share splits for co-owned or firm profiles: no share data (MUT-373).
- Client UI and its copy: MUT-448 / MUT-449.
- Explore clients/categories data: MUT-451/452 use the existing activity read.
- Server-side caching of verdicts: client query caching suffices at current volume (TD-262 trigger).

## What already exists (reused, not rebuilt)
- `summarizeActivity` (server/src/summaries/activity.ts) for per-profile received/spent/history.
- `bucketize`/`countsOn` (server/src/summaries/compute.ts) for Owed, the same as the organization summary.
- `ownedOrCoOwnedProfilesOf`/`ownsProfile` (personal-profile.ts), extended by `verdictProfilesOf` for X1.
- `lazyPostingOf` + `postDueItems` for X2 (X2b).
- `CachedFxRates` + `crossRates` (fx-rates.ts); `convertToBase` is added next to them.
- The activity route's `activityDate`, range checks and earlierData probes (X4, X6).
- The person-level route pattern: `ENTRIES_ORGANIZATION_INDEPENDENT_ROUTES` + `PERSON_LEVEL_GATE` + `personEntitlements` (routes/entries.ts).
- The 7th-day rule moves from reports.ts to summaries/months.ts (X5/X5b).

## Failure modes
| Path | Realistic failure | Handling | Test | User sees |
|---|---|---|---|---|
| per-profile reads | one profile's query throws | allSettled → `unavailable` + reporter | route test | named "1 profile couldn't load", the rest renders |
| FX | ECB feed down >7 days | X3 → converted null | route test ×2 | per-currency figures, no ≈ total |
| posting | posting throws for one profile | treated as that profile's failure → unavailable | route test | the same named gap |
| billing | profile LOCKED | dropped before posting, listed | route test | "locked" note (MUT-448 copy) |
| local mode | FX fetch inside the cross-tab lock | warm before the lock (OV4) | local test | no hang |
| local mode | reload drops in-memory posts | re-posted on the next read (X7) | local test | the same owed |
Critical gaps (no test + no handling + silent): 0.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity (one primary module, server/src/summaries + its route; the portal months.ts import is a two-line follow-on in the same branch).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P1, human: ~1h / CC: ~10min)** — summaries/months — move the cutoff + firstCountedMonth to server/src/summaries/months.ts; reports.ts imports them
  - Surfaced by: Section 2 #1 / X5b (D8)
  - Files: server/src/summaries/months.ts, server/src/summaries/__tests__/months.test.ts, src/hosted/data/reports.ts
  - Verify: npm --prefix server test -- months; npm run test:run -- src/hosted/data
- [ ] **T2 (P1, human: ~1d / CC: ~45min)** — summaries/verdict — pure composeVerdict + convertToBase + base/usual rules, tests first
  - Surfaced by: plan §2, X3, X6, X8, X9
  - Files: server/src/summaries/verdict.ts, server/src/summaries/__tests__/verdict.test.ts, server/src/fx-rates.ts
  - Verify: npm --prefix server test -- verdict
- [ ] **T3 (P1, human: ~1d / CC: ~45min)** — routes/summaries — GET /v1/summaries/verdict: verdictProfilesOf (X1), LOCKED before posting (A1), lazyPostingOf posting (X2b), earlierData probes (X6), FX fallback (X3), partial failure + reporter (A3), defaults in the base timezone (X9)
  - Surfaced by: Scope findings 1–5, Section 1 #1–3, OV1/OV3/OV8
  - Files: server/src/routes/summaries.ts, server/src/personal-profile.ts, server/src/schemas.ts, server/src/routes/portal-routes.ts, server/src/app.ts, server/src/billing/gate.ts, server/src/__tests__/routes-verdict.test.ts, server/src/__tests__/writability-routes.test.ts (lazyPostingOf list only)
  - Verify: npm --prefix server run typecheck && lint && openapi:check && test (via heavy)
- [ ] **T4 (P1, human: ~2h / CC: ~15min)** — hosted/local — register the route in local organizationIndependent; warm FX before the lock for the verdict path; reload-then-read test
  - Surfaced by: Scope finding 5, OV4, X7 (D10)
  - Files: src/hosted/local/createLocalApp.ts, src/hosted/local/index.ts, src/hosted/local/__tests__/*
  - Verify: npm run test:run -- src/hosted/local (Node 22)
- [ ] **T5 (P2, human: ~1h / CC: ~10min)** — knowledge + QA — ADR-202, TD-262 (trigger includes p95 with posting on, OV7), CHANGELOG/SYSTEM_OVERVIEW/TEST_PLAN, qa/features mapping, MUT-447 comment on from/to (X4)
  - Surfaced by: X4 (D5), OV7, CLAUDE.md Phase 5
  - Files: .claude/*.md, qa/features/portal/*.yaml
  - Verify: release-qa lint

## Unresolved decisions
None.

## Reality rows
- premise-table: summaries per organization (summaries.ts:37 `c.get('auth')`) TRUE; person-level pattern exists (entries.ts:22) TRUE; operator firm ownerUserId null (ports.ts:35) TRUE; portal imports server modules (browserSentry.ts:2) TRUE (the billingView claim was corrected as FALSE); unverified=0
- already-done: `git log -- server/src/routes/summaries.ts` last touched by MUT-175 (1db3a8e3); no verdict route exists (grep "summaries/verdict" → none)
- surface-check: routes/flags named exist: /v1/summaries/activity (summaries.ts:155), PERSON_LEVEL_GATE (gate.ts:31), organizationIndependent (createLocalApp.ts:103, app.ts:325)
- binding-decisions: MUT-175 D1 (client weeks) honored by X4; MUT-435 P1 (agents) unaffected by X1, recorded in ADR-202
- numbers: ≈6N+1 reads/request [estimated: plan §6 + X6]; N=5 for Basel [measured: memory card-expense-import profile list]
- deferred-asks: the ticket asked for period+at → replaced by from/to (X4, comment on the ticket); everything else is covered
- pr-count: 1 PR (default policy)
REALITY: premise-table pass 0 unverified server/src/repositories/ports.ts:35
REALITY: already-done pass no verdict route on main server/src/routes/summaries.ts:155
REALITY: surface-check pass routes and sets verified server/src/billing/gate.ts:31
REALITY: binding-decisions pass MUT-175 D1 honored server/src/routes/summaries.ts:170
REALITY: numbers pass reads estimated and tagged server/src/routes/summaries.ts:181
REALITY: deferred-asks finding period+at replaced by from/to per D5 server/src/routes/summaries.ts:170
REALITY: pr-count pass one PR server/src/routes/summaries.ts:155

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted, 0 unverified premises
- Architecture Review: 3 issues found
- Code Quality Review: 3 issues found
- Test Review: diagram produced, 24 gaps identified (all planned)
- Performance Review: 2 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex not installed → native Claude Plan subagent completed (in-host); outside coverage unavailable; 8 findings, 6 decided (D7–D12), 2 accepted as required work
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 0/7 (every scored answer took the highest-scored option, 9/10; none offered 10/10)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Claude Plan subagent (Codex not installed) | Independent 2nd opinion | 1 | unavailable (in-host fallback completed) | 8 findings: 6 decided D7–D12, 2 accepted as required work |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved into tasks) | 8 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — (server-only ticket) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex · plan-review · unavailable (CLI not installed); the native in-host fallback completed with 8 findings, all resolved.
- **VERDICT:** ENG reviewed, with every decision answered (D1–D12) and T1–T5 mapped; ready to implement once the plan is copied onto the MUT-447 branch.

NO UNRESOLVED DECISIONS
