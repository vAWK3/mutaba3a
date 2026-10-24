# MUT-361 — Lapse gate: read-only (with export) and locked accounts on the server and the portal

Status: planned 2026-10-24 (unattended run; every D below is **pending Basel's confirmation**).
Epic MUT-322 (pilot-readiness, ga-gate). Blocked by MUT-358 (merged local main 52a677f8). Reads MUT-418's seams.
Blocks MUT-364 (phone UI for these states). MUT-419 (trial mails) reads the same stage.

Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · Backlog → In Progress → In Review (Basel moves to Done).

## 1. Problem

ADR-160 D3 / ADR-162: a profile resolves to ACTIVE, GRACE, READ_ONLY or LOCKED (`billing/entitlement.ts`), and
`GET /v1/me` reports it per profile, but nothing enforces it. A trial that ended still writes; a lapsed subscriber
still writes; nothing ever locks. The GA promise "14 days free, then read-only with export, then locked from day 30
(Subscribe and Download my records only), nothing deleted; a payer who lapses stays read-only for good" is not real.

## 2. Acceptance criteria (ticket + Basel's comment 12278)

- AC1 Server: a session write on a READ_ONLY or LOCKED profile is refused `SUBSCRIPTION_LAPSED`; on a LOCKED profile
  session reads are refused too, except records export. Identity (`/v1/me*`, sessions, password, terms), `/v1/billing/*`
  and `GET /v1/records-export*` stay open in every state. API-key (Malafat) writes are never billing-gated. Device
  sessions (phone) and receipts uploads are covered by the same rule.
- AC2 Server tests cover each state × reads, writes, export, identity and billing routes, plus Malafat API-key writes.
- AC3 A READ_ONLY (and a LOCKED) person can still download all their records (MUT-325) and nothing is deleted.
- AC4 Portal, en/ar, RTL at 375 px: GRACE banner ("payment didn't go through, update your card"); READ_ONLY banner
  and every Add/Edit/Delete disabled or hidden with the reason; LOCKED full-page "Subscribe or download your records".
  All link to Settings › Billing (Subscribe step where a payment would cover the profile).
- AC5 `SUBSCRIPTION_LAPSED` in the error catalogue and OpenAPI.
- AC6 Release-QA: `qa/features/portal/billing.yaml` (read-only, locked) with passing specs.
- AC7 (comment 12278) Before the gate goes live the operator can list every active person whose profiles resolve to
  READ_ONLY or LOCKED (`npm run billing:uncovered`), and the release checklist requires it to be empty.

## 3. Design

### 3.1 One place: `authenticate()`, at the door (D1 — amends ADR-160 decision 4)

ADR-160 D4 named "store-guard.ts and authenticate()". The store guard sees only repository calls, so it would let
a READ_ONLY session do work that never touches the store's write methods (e.g. presign an upload URL for an existing
receipt row, POST previews that only read), and it refuses mid-route after the idempotency claim. The door refuses
before any work, for every transport (cookie session and phone device session share `finishSessionAuth`), and is
the one place that also decides LOCKED reads. So the whole rule lives in one pure module,
`server/src/billing/gate.ts`, applied once in `finishSessionAuth`. The store guard is not touched.

Rules (`gateDecision`):

| Request | Rule |
|---|---|
| API key | never gated |
| Session, profile-scoped route (X-Mutaba3a-Profile) | the selected profile's entitlement: ACTIVE/GRACE → open; READ_ONLY → safe methods (GET/HEAD/OPTIONS) only; LOCKED → only `GET /v1/records-export` and `GET /v1/records-export/receipts/:receiptId` |
| Session, organization-independent route | per-endpoint class in `PERSON_LEVEL_GATE` (below); a test fails when an organization-independent route is unclassified |

`PERSON_LEVEL_GATE` (every organization-independent endpoint):
- `open` — identity, sessions, billing, fx: `GET /v1/me`, `PATCH /v1/me/malafat-suggestions`, `PATCH /v1/me/trial-prompt`,
  `POST /v1/me/terms-acceptance`, `POST /v1/me/password`, `DELETE /v1/sessions/current`, `DELETE /v1/device-sessions/current`,
  `GET /v1/billing`, `POST /v1/billing/checkout-session`, `POST /v1/billing/portal-session`, `GET /v1/fx-rates`, and
  `DELETE /v1/profiles/:profileId/owners/:userId` (leaving or removing a co-owner adds no record — D6).
- `person` — the person's **standing**: the best state across every profile they belong to (any ACTIVE/GRACE → open;
  else any READ_ONLY → read-only; else all LOCKED → locked; no profiles → open). `GET|POST /v1/inbox`,
  `GET /v1/inbox/count`, `PATCH|DELETE /v1/inbox/:entryId`, `POST /v1/profiles`, `GET /v1/entries` (D4).
- `pathProfile` — the `:profileId` in the path, when the caller is a member (else the route's own 404 answers):
  `PATCH /v1/profiles/:profileId`, `GET /v1/profiles/:profileId/type-change`, `POST /v1/profiles/:profileId/firm-request`.

`GET /v1/entries` reads across profiles: the gate hands the route the LOCKED profile ids it computed
(`c.var.lockedProfileIds`) and the route leaves them out (asking for one by `profileId` answers SUBSCRIPTION_LAPSED).

Facts: one `billing.factsFor` per gated session request (three indexed queries, ADR-162 §5), reusing
`entitlementsFor` (coverage.ts). The Malafat flag comes from `writerOfRecord` already read by `selectProfile`.
Person-level standing loads memberships the way `buildMe` does — extracted into `memberProfilesForBilling(store,
userId)` in coverage.ts so `/v1/me` and the gate read one loader.

Switch (D7): `BILLING_GATE` env (`true` by default in `config.ts`, `false` is the operator's kill switch);
`AppDependencies.billingGate` (createApp default `false`, so the 56 suites that build apps with ungranted users keep
testing what they test; `index.ts` passes the config value; a config test pins the default `true`).

### 3.2 The refusal (D2, D3)

`SUBSCRIPTION_LAPSED`, HTTP **402**, details `{ profileId, state: 'READ_ONLY'|'LOCKED', source, until }`
(`profileId` null on a person-level refusal; `until` = lock date for a trial in read-only, else null). One code, the
state in details: the phone (MUT-364) branches on `details.state`. The ticket's `since` became `until`, the date the
person can act on ("locks on …"); `since` is derivable for a trial (`until − 16 days`) and unknown for Stripe.
Message strings in English; clients localise by code.

### 3.3 Stage and dates for MUT-419

`trialTimelineOf(trialStartedAt)` → `{ startedAt, endsAt, lockAt }` exported from `billing/entitlement.ts`
(`routes/billing.ts trialView` now calls it). The stage is `resolveEntitlement` (TRIAL/ACTIVE → trial,
TRIAL/READ_ONLY → read-only, TRIAL/LOCKED → locked). MUT-419's day-11 / day-14 / day-27 mails read these two.

### 3.4 Operator list (AC7)

`GET /admin/v1/billing/uncovered` → `{ profiles: [{ organizationId, name, state, source, until, people: [{ userId, email }] }] }`:
every profile that resolves READ_ONLY or LOCKED and has at least one ACTIVE member. One `factsFor` for all profiles.
CLI `npm run billing:uncovered` prints them and a count by source. `before-release.md`: run it against production
before the release that carries MUT-361; it must print nothing (else `billing:grant` each, or ship with
`BILLING_GATE=false` and grant first).

### 3.5 Portal

Pure view model in `src/hosted/data/trialPrompt.ts` (the MUT-418 seam): `TrialNotice` gains
`{ kind: 'grace' }`, `{ kind: 'read-only'; source; locksAt: string|null }`, `{ kind: 'locked' }`, and
`lapseNoticeOf(profile)` returns one of them for the open profile (null billing = signed-out mode → null).
`billingGateOf(profile)` → `'open'|'read-only'|'locked'` and `personStandingOf(me)` mirror the server's rules.

- `useWriteGate()` (session/me.tsx): `{ writable }` for the open profile. Every write affordance reads it:
  `incomeAffordancesFor`, `redateAffordancesFor`, `canAddClient` take the gate (one change covers income, settle,
  re-date, client/matter add); Expenses Record, Conversions Add, Groups New/Add/Edit/leave-out/row overrides are
  hidden when not writable; New profile (switcher, manage drawer) follows `personStandingOf`; profile edit and
  firm request follow that profile's gate.
- Drawers: the portal `Drawer` gets `writes?: boolean`. On a profile that isn't writable a `writes` drawer still opens
  (details are a read), its body sits in `<fieldset disabled>`, its footer (Save/Delete) is dropped and a note says
  why. ExpenseDrawer, ConversionDrawer, IncomeCaptureDrawer, RecordPaymentDrawer, RedateDrawer, GroupDrawer,
  AddToGroupDrawer pass `writes`.
- `LapseBanner` in `ProfileLayout`, above every page of the profile: GRACE (warning tone, "Update your card" → Billing);
  READ_ONLY ("This profile is read-only …", Subscribe where `coveredProfileIds` has the profile and a price exists,
  otherwise Billing; a paid lapse says it never locks; a trial says the lock date; a profile another person pays for
  says to ask its owner) + Download my records.
- LOCKED: `ProfileLayout` renders `LockedScreen` instead of the page outlet; the shell keeps the profile switcher and
  account menu but drops the section nav. Subscribe (`openBilling('subscribe')`, which `/?billing=true&step=subscribe`
  also reaches) and Download my records (`openYourData()`, MUT-325's drawer, export open server-side).
- A stale page: the query client's MutationCache/QueryCache `onError` refetches `/v1/me` on `SUBSCRIPTION_LAPSED`,
  so the gate, banner or locked screen take over; each drawer's error mapper shows the read-only message (R6).
- i18n en/ar under `hosted.billing.gate.*`; RTL via logical properties; 375 px checked in QA.

## 4. Decisions (all pending Basel's confirmation)

- D1 Enforce at the door (`authenticate()` → `billing/gate.ts`), not in store-guard.ts (ADR-160 D4 amended, override
  log in ADR-181): the store guard misses non-store side effects and refuses mid-route.
- D2 HTTP 402 Payment Required for `SUBSCRIPTION_LAPSED` (not 403, so it can't be mistaken for READ_ONLY_PROFILE).
- D3 One code, `details.state` READ_ONLY|LOCKED; `until` instead of the ticket's `since`.
- D4 Person-level routes (inbox, entries feed, New profile) follow the person's best standing; the entries feed drops
  LOCKED profiles.
- D5 In READ_ONLY every non-safe method is a write (no exceptions; every POST preview route is API-key-only anyway).
- D6 Leaving a co-owned profile or removing a co-owner stays open in every state.
- D7 `BILLING_GATE` env, default on, as the operator's kill switch; createApp defaults off for tests.
- D8 Read-only drawers open for viewing with fields disabled; Add buttons are hidden, not disabled (fewer dead controls).
- D9 LOCKED keeps the profile switcher and account menu, so a person with another covered profile can move to it.
- D10 GRACE gets a banner on every page of the profile, like READ_ONLY (the ticket names it).
- D11 (review R1) Released phones map 402 to a retryable `serverError`: their outbox keeps a refused capture and
  retries it, so it lands once the person subscribes (nothing lost). The API release that carries the gate goes out
  with or after the phone build carrying MUT-364, with the minimum build raised; until then `BILLING_GATE=false`.
  Operator step in before-release.md.
- D12 (review R5) `/v1/me` publishes the person's standing (`billingStanding: 'open'|'read-only'|'locked'|null`),
  computed by `gate.ts`, so the portal and the phone never re-derive it; the per-profile gate is `billing.state`.

## 4b. Eng review amendments (2026-10-24, folded in; all pending Basel)

- R1 (P1) 402 on released phones → D11 (release sequencing, kill switch until MUT-364 ships).
- R2 (P2) Locked screen: Subscribe only when `coveredProfileIds` has the profile (a co-owner's payment doesn't cover a
  shared profile, TD-193); otherwise "ask the profile's owner" + Download my records.
- R3 (P2) No blanket `<fieldset disabled>` over a drawer body: it would disable receipt Download (a read). Each write
  drawer wraps only its form fields in `ReadOnlyFields`; `ReceiptUploader` gets `readOnly` (Download stays, Upload and
  Delete go); the `Drawer` drops the footer and shows the note.
- R4 (P3) URL-opened create drawers (`?newExpense`, `?newConversion`, `?newGroup`, `?newProfile`) don't open when the
  gate (or standing, for New profile) says no; the list checks the gate where it reads the key.
- R5 (P3) → D12 (`billingStanding` on /v1/me).
- R6 (P3) Every portal error mapper (`expenseApiErrors`, `conversionApiErrors`, `incomeApiErrors`, `profileApiErrors`,
  group drawers) maps `SUBSCRIPTION_LAPSED` to the read-only message; the query client refetches `/v1/me`.
- R7 (P3) The membership loader shared by `/v1/me` and the gate reads organizations and integrations in parallel
  (one tick, batched by Prisma), and standing is computed once per request.
- R8 (P3) An unmatched route (null endpoint) is never gated, so its 404 answers; pinned by a test.
- R9 (P3) D5's preview example removed.

## 5. Tests (TDD)

Server (`npm --prefix server test`):
- `billing/__tests__/gate.test.ts` (pure): state × method × route class; standing rules; LOCKED allowlist; API key.
- `__tests__/billing-gate-routes.test.ts` (app, memory store, `billingGate: true`, clock fixed): one person per state
  (trial day 3 ACTIVE, past_due GRACE, trial day 20 READ_ONLY, trial day 31 LOCKED, paid-then-canceled READ_ONLY,
  pre-billing grant, Malafat-connected firm member) × GET list, POST expense, POST income, POST receipts upload,
  GET records-export (+ receipt), GET /v1/me, PATCH /v1/me/trial-prompt, GET /v1/billing, DELETE /v1/sessions/current,
  POST /v1/inbox, GET /v1/entries, POST /v1/profiles; device-session bearer; Malafat API-key write on the firm.
  Records export of a LOCKED profile returns every record; nothing deleted (row counts unchanged).
- Every organization-independent endpoint is classified (test walks the app's set).
- `admin-billing` uncovered listing; `users-cli` verb; config default.
- openapi:check regenerates with the new code.

Portal (`npm run test:run`): `trialPrompt.test.ts` (lapseNoticeOf, billingGateOf, personStandingOf);
`incomeAffordances` with the gate; `LapseBanner`/`LockedScreen` render tests en/ar; Drawer `writes` read-only;
Expenses list hides Record when read-only; query client refetches me on SUBSCRIPTION_LAPSED.

## 6. QA scenarios (release-QA)

Portal (stubbed API, `qa/features/portal/billing.yaml`, `qa/specs/portal/billing.spec.ts`):
1. `billing.read-only` — "My trial ended: I open my profile, see the read-only banner with Subscribe and the lock
   date, there's no Record button on Expenses, opening an expense shows it with nothing to save." Expect: banner,
   no Add, disabled drawer; Subscribe opens Billing's Subscribe step.
2. `billing.locked` — "Day 31: I open the portal and only see Subscribe and Download my records." Expect: locked
   screen, no section nav; Download opens Your data; Subscribe opens Billing's Subscribe step. Arabic + 375 px.
3. `billing.grace` — "My card failed: a banner asks me to update it, and I can still add an expense." Expect banner
   + Record present.
4. `billing.lapsed-paid` — "My subscription ended: read-only, and it says it never locks." Expect copy.

Live API (`qa/features/portal-live/billing.yaml`, `qa/specs/portal-live/billing.spec.ts`, billing-live setup):
5. `portal-live.billing.lapse-gate` — a fresh signup moved to trial day 20 (`setTrialStartedDaysAgo`) sees the
   read-only banner; a direct POST is refused 402 SUBSCRIPTION_LAPSED; moved to day 31 sees the locked screen and
   downloads the records file.

## 7. Files

Server: `billing/gate.ts` (new), `billing/coverage.ts` (loader), `billing/entitlement.ts` (trialTimelineOf),
`auth/middleware.ts`, `app.ts` (dep + description + API 1.60.0-mut361), `config.ts`, `index.ts`, `errors.ts`,
`routes/entries.ts`, `routes/me.ts` (loader), `routes/billing.ts` (trialView), `routes/admin-billing.ts`,
`scripts/users.ts`, `package.json` (script), openapi.yaml, tests.
Portal: `data/trialPrompt.ts`, `data/incomeAffordances.ts`, `session/me.tsx`, `session/AuthGate.tsx`,
`shell/HostedShell.tsx`, `components/Drawer.tsx`, `components/LapseBanner.tsx` + `LockedScreen.tsx` (new), the write
drawers and list views above, `queryClient.ts`, `hosted.css`, i18n en/ar, `api/schema.d.ts`.
Docs: ADR-181, TD as needed, CHANGELOG, SYSTEM_OVERVIEW, COMPONENT_REGISTRY, PATTERNS, TEST_PLAN,
`docs/operations/before-release.md`, `pilot-runbook.md` note.

## 8. Business / product impact

- Makes the trial real: after 14 days a non-payer can't keep using the product for free, and from day 30 only
  Subscribe or leave with their records — the GA "sell without the operator" gate (MUT-322).
- Unblocks MUT-364 (phone screens on the same codes) and MUT-419 (mails on the same stage).
- Risk is a wrong lockout of a pilot user: covered by the pre-billing grants, `billing:uncovered` before release and
  the `BILLING_GATE=false` kill switch; nothing is ever deleted.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | n/a |
| Outside Review | native Claude subagent (Codex not installed) | Independent 2nd opinion | 1 | completed (native fallback) | 9 findings, all folded in (R1..R9) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 9 issues, 0 critical gaps; all resolved in the plan (pending Basel) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | not run | n/a |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | n/a |

- **OUTSIDE COVERAGE:** Codex CLI not installed; a native Claude subagent reviewed the plan against the code (not an external model).
- **VERDICT:** ENG reviewed; findings folded into the plan as R1..R9 and D11..D12, pending Basel's confirmation (unattended run).

NO UNRESOLVED DECISIONS
