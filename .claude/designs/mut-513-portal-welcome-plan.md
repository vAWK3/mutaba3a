# MUT-513 — Portal first visit: a welcome screen (plan)

Status: PLANNED, not built. Epic MUT-284. Relates MUT-289 (marker, after this), MUT-407 (phone welcome, Done), MUT-368 (signup, Done).
Base: local main d6340d00.

## 1. What changes, in one paragraph

Today `probeRemote()` (`src/hosted/api/client.ts:351`) saves `mut-mode=local` the moment the server answers 401, and the
next request boots the local backend, so a first visitor lands in an empty local overview. After this ticket a 401 with
no hint saves **nothing**: this page is marked **undecided** (in memory), no local backend boots, and `/` shows the
welcome. Only a door saves a mode: Try → `local`, a successful sign-in → `remote` (as today). Because nothing is saved,
leaving /sign-in or /signup without signing in and coming back to `/` shows the welcome again (AC6), and so does a reload.

## 2. Mode model (`src/hosted/session/mode.ts`)

- `UnhintedMode = PortalMode | 'probe' | 'undecided'`. `undecided` = "the server said nobody is signed in and this
  browser hasn't chosen". Never stored. `isLocalMode()` stays false for it.
- New `markUndecided()` (sets `unhinted = 'undecided'`, notifies listeners) and `useMode()` already re-renders on it.
- The stored hint still wins over everything, so Try in another tab (storage event) flips this tab to local at once.
- Blocked storage: `setMode` already falls back to the in-memory value, so Try works for this page; the next load
  shows the welcome again (AC8, acceptable: nothing could be remembered).

## 3. Transport (`src/hosted/api/client.ts`)

- `probeRemote()` on 401: `markUndecided()` instead of `setMode('local')`; 200 still saves `remote`; a network failure
  still saves nothing.
- `goesRemote()` with mode `undecided`: neither remote nor local. `send()` answers with a synthesized
  `ApiError(401, 'UNAUTHENTICATED')` without any network call and without importing `@mut/local-backend`.
  `ALWAYS_REMOTE` routes (sessions, signups, self-service, recovery, passkeys) are unaffected, so the sign-in and
  signup pages work as now.
- Result: one `/v1/me` probe per page load, nothing else (the ticket's "no network call beyond the mode check").

## 4. Where the welcome renders

- **`/` (first visit):** `AuthGate` (`src/hosted/session/AuthGate.tsx`) — before its `me` branches, when
  `useMode() === 'undecided'`: on `/` render `<WelcomePage />`; on any other authed path (`/p/…`, `/reports`, `/capture`,
  `/connect/approve`, `/operator…`) render the existing `<RedirectToSignIn />` (a deep link is an account context; the
  sign-in page still offers "Continue on this device"). The `me` query is disabled while undecided
  (`enabled: mode !== 'undecided'`), so the cached 401 doesn't refetch on Back.
- **Probe in flight:** `CheckingSession` as today (no welcome flash for signed-in people, AC2).
- **Deep links outside AuthGate** (/sign-in, /signup, /recover, /setup, /carry-over*, /welcome itself) never pass
  through it — AC4 holds by construction; `/connect/approve` is covered by the redirect rule above.
- **`/welcome` route (reopen, AC9):** new signed-out route under `rootRoute` in `src/hosted/router.tsx`, same component.
  With a `remote` hint it redirects to `/` (a signed-in person has no use for it). Not added to `AuthGate`.
  The entry: a `RowButton` "What is MTB3A?" in the local branch of `src/hosted/pages/you/YouAccount.tsx:28` (next to
  Sign in / Your data) → navigate `/welcome`. The Try door reads "Continue on this device" when the hint is already
  `local`.

## 5. The screen (`src/hosted/pages/auth/WelcomePage.tsx`, new)

Built on `AuthLayout` (language switch + wordmark already there, Arabic default via HostedLanguageProvider), one card:
- Illustration: port the phone's `assets/illustrations/source/onboarding.svg` (MUT-407, 160×160, arch + nuqta) as an
  inline React SVG `src/hosted/components/illustrations/OnboardingScene.tsx`, colours from DESIGN.md tokens (no hex),
  `aria-hidden`. Mirrors in RTL only if the art is directional (it isn't).
- `h1` + one line: who owes you, what came in, what went out, per currency.
- Door 1 (primary): **Sign in** → `/sign-in`; **Create an account** (secondary, beside it) → `/signup` (always shown;
  /signup shows its own "closed" state, so no `/v1/self-service` call here). Under them: what an account adds — your
  records on your phone and on any browser, kept safe on our servers.
- Door 2 (secondary card section): **Try it on this device**, with the honest explainer as a short list: this browser
  only, no account, nothing sent to us · clearing site data erases them · back up from Your data › Download · they don't
  move into an account later. No phone-sync promise (AC7).
- Try = `setMode('local'); queryClient.clear(); navigate('/', { replace: true })` — the exact body of
  `SignInPage.continueOnThisDevice` (`SignInPage.tsx:150`). Extract it to `src/hosted/session/continueOnThisDevice.ts`
  (`useContinueOnThisDevice()`) and use it from both pages (DRY).
- Layout fits 375 px (single column, buttons `hp-block`); motion: a CSS entrance (opacity + 8 px rise, spring-like
  ease from DESIGN.md) disabled under `prefers-reduced-motion: reduce`. DESIGN.md components only (Button, hp-card).
- Copy: new `hosted.welcome.*` keys in the portal ar + en dictionaries (ar first). Wording kept consistent with MUT-289's
  planned marker copy ("this device only").

## 6. Counting the doors (AC11) — DECISION NEEDED (D1)

MUT-155's consent belongs to a **signed-in** person (`portalAnalytics.ts:7-10`, `trackPortal` returns unless
`choice === 'on' && owner`). A first visitor is never signed in, so `portal_welcome_choice` through that flow can never
send. Options:
- **A (recommended):** add `portal_welcome_choice` to the contract + `PortalEvent` anyway, fired on click; it is a no-op
  for every visitor today. Say so in the ticket and track the real funnel by a follow-up (anonymous, consented,
  signed-out counting is a privacy decision of its own). Cheap, honest, no new consent surface.
- **B:** drop AC11 from this ticket; follow-up only.
- **C:** ask for consent on the welcome itself. Adds a third choice to a one-screen welcome; not recommended.

## 7. Offline first visit (AC8) — DECISION NEEDED (D2)

Today an offline unhinted load shows `BootUnreachable` (retry). The AC says the welcome "still works" offline.
- **A (recommended):** probe network failure → still save nothing, but render the welcome (not BootUnreachable) on `/`.
  Try saves `local` because the person chose it (same as the sign-in page's Continue today); Sign in fails on its own
  page with its own offline message. Risk: a signed-in person offline who taps Try lands in an empty local app — the
  explainer and the Sign in door make that a conscious choice.
- **B:** keep BootUnreachable offline; the welcome appears once the server answers 401.

## 8. Tests (TDD, written first)

Unit / component (Vitest, `--maxWorkers=3`, via heavy-gate):
- `session/__tests__/mode.test.ts`: `markUndecided` → `currentMode() === 'undecided'`, `isLocalMode()` false, a stored
  hint overrides it, listeners fire.
- `api/__tests__/client-mode.test.ts`: no hint + 401 → undecided, nothing stored, `@mut/local-backend` never imported,
  later requests get ApiError 401 with zero fetches; 200 → `remote` stored; network error → nothing stored;
  ALWAYS_REMOTE still goes out while undecided.
- `pages/auth/__tests__/WelcomePage.test.tsx`: Arabic + `dir=rtl` by default, English on switch; both doors' hrefs;
  Try stores `local` and navigates to `/`; explainer's four facts present, no phone/sync wording; "Continue on this
  device" when the hint is local; analytics call per door (per D1).
- `session/__tests__/local-mode.test.tsx` / AuthGate tests: undecided on `/` → welcome, not the shell; undecided on
  `/p/x` and `/connect/approve` → sign-in redirect; `remote` 200 → straight to the portal (AC2); saved `local` → shell
  (AC3); Back from /sign-in without signing in → welcome (AC6).
- `pages/you/__tests__`: local YouAccount shows "What is MTB3A?" → `/welcome`; signed in it doesn't.
- `router` test: `/welcome` with a remote hint redirects to `/`.
- Update tests that assume 401 → `local`: `client-mode.test.ts`, `mode.test.ts`, `local-mode.test.tsx`,
  `errorReporting.test.ts` (check).

Release-QA (`qa/features/portal/welcome.yaml`, `qa/specs/portal/welcome.spec.ts`, tags `@portal.welcome.<id>`; fresh
context with **no** `mut-mode`, so the openers' default `remote` must be skipped for these specs):
`first-visit` (core), `try-local`, `sign-in-door` (go and come back → welcome), `never-again` (after Try, reload →
overview), `deep-link-skips` (/sign-in, /signup, /connect/approve), `reopen` (You › What is MTB3A?).
Update `@portal.local.first-visit` (`qa/specs/portal/local-mode.spec.ts:90`): a first visit now passes the welcome
via Try. `release-qa run --attach --only welcome` until it passes; `release-qa lint` clean.

Gate (Node 22, through `~/Work/tools/heavy-gate/heavy`, one at a time): `npm run lint`, `npm run typecheck`,
`npm run test:run -- --maxWorkers=3`, `npm run build`, `npm run test:bundles` (the welcome must not pull the local chunk
or posthog into the entry graph). No server changes.

## 9. Knowledge files

ADR-230: "An unhinted 401 is undecided, not local" — amends ADR-100's probe rule (and ADR-097 §2.6 as amended);
records D1/D2. CHANGELOG, SYSTEM_OVERVIEW (portal modes: undecided + welcome), COMPONENT_REGISTRY (WelcomePage,
OnboardingScene, useContinueOnThisDevice), TEST_PLAN, TECH_DEBT if D1=A (event that cannot send yet).

## 10. Scalability / cost

Zero new requests (one fewer for first visitors: no local-backend boot and no IndexedDB created until Try). Bundle: one
small page + inline SVG in the hosted entry; local chunk stays lazy. No server, schema or infra change.

## 11. Out of scope

MUT-289 marker/upsell; tour or coach marks; sample data; moving records into an account (MUT-290 won't do); the phone.

## QA scenarios

1. First visit to app.mtb3a.com, not signed in → the welcome in Arabic, not the overview.
2. Tap "Try it on this device" → the local overview; reload → the overview again, no welcome.
3. Tap "Sign in", go Back → the welcome again, still not in local mode.
4. Open /sign-in, /signup or /connect/approve directly → that page, never the welcome.
5. In local mode, You › "What is MTB3A?" → the welcome; "Continue on this device" returns to the overview.

---

# Eng review (/plan-eng-review, 2026-10-30)

Target: `.claude/designs/mut-513-portal-welcome-plan.md` (the plan above, sections 1–11 as first written).

## Scope record
feature answers: none cut; structure: B (D1, "Smaller arrangement", 2026-10-30); accepted scope: the plan's features with the
illustration inline in `WelcomePage.tsx` (no `OnboardingScene.tsx`) and `session/continueOnThisDevice.ts` shared by
SignInPage and WelcomePage; pending remedies: R1 (AC11 counting), R2 (offline first visit), R3 (401 regression contract).

## Decision ledger

### R1: How the welcome's door clicks are counted (AC11)
Finding: 1, CRITICAL, confidence 9/10, src/hosted/analytics/portalAnalytics.ts:227-229, reviewer: Claude (Architecture)
Plan baseline: plan §6 proposes option A (add `portal_welcome_choice`, accept it never sends); not approved.
Runtime evidence: `trackPortal` starts `const { owner, choice } = usePortalUsage.getState(); if (choice !== 'on' || !owner) return;` and the consent is a signed-in person's (portalAnalytics.ts:7-10). A first visitor has no owner, so the event cannot send. Adding it also bumps docs/analytics/events.json and its pinned sha (scripts/__tests__/analytics-taxonomy.test.ts; prior learning analytics-contract-pins-server-currencies).
History, D2 grid (superseded):
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 counting | AC11 asks for portal_welcome_choice via MUT-155 | event added to contract + code, sends nothing today; TD + follow-up ticket for signed-out counting | AC11 dropped from MUT-513; follow-up ticket only | consent asked on the welcome itself, then event sends |
| R2 offline | pending | pending | pending | pending |
| R3 401 contract | pending | pending | pending | pending |
Comparison grid (rebuilt after D2's answer):
| Choice | Current | A | B |
|---|---|---|---|
| R1 counting | AC11 asks for portal_welcome_choice via MUT-155 | cookieless count of the click (landing's mode, choice property only), consented detail only after sign-in opt-in | dormant event (D2 option A) |
| R2 offline | pending | pending | pending |
| R3 401 contract | pending | pending | pending |
Question D3: Basel asked to keep the count and add details only after consent. Confirm: count the welcome click cookieless like the landing? (Recommendation: A)
Header: Door counting
Options:
A) Cookieless click count (recommended)
portal_welcome_choice {choice} sent cookieless (posthogConfig landing mode: no storage, no person, no ID), lazy posthog chunk on click only; detail stays behind MUT-155 consent after sign-in. ADR (README rule 4 exception), events.json bump + pinned sha, privacy page line for the portal welcome, explainer says records are never sent. Human ~1d / CC ~40min.
B) Dormant event only
D2 option A: event in the contract, sends nothing until signed-out counting exists. Human ~3h / CC ~10min.
State: approved
Actual answer: A) Cookieless click count (D3, 2026-10-30)
Accepted scope: `portal_welcome_choice {choice: sign_in|signup|local}` sent on each door click with the landing's cookieless options (no storage, `person_profiles: 'never'`, no ID kept), posthog-js lazy-loaded only on the click and never awaited before navigating; nothing else counted before sign-in; consented detail stays MUT-155. ADR (exception to docs/analytics/README.md rule 4 for the signed-out welcome), events.json version bump + PINNED_VERSIONS sha row + taxonomy test, privacy page line naming the portal welcome (en/ar), the local explainer says records are never sent (the click count is not a record). Tests: the click sends the event with only `choice` under cookieless options; nothing sent before a click; navigation does not wait for PostHog; a failed PostHog load still navigates.
History: D2 (2026-10-30) offered A dormant / B drop AC11 (recommended) / C consent on welcome. Basel answered in free text: "why can't we simply take what we can (so keep it), but only add the other details or something of event after consent?" Reopened as D3 with that as option A; evidence: landing counts cookieless without consent (src/lib/analytics/posthogConfig.ts:46 `landing: { cookieless_mode: 'always', ...}`, docs/analytics/README.md:11, :101, :202).

### R2: Offline first visit (AC8)
Finding: 2, INFORMATIONAL, confidence 8/10, src/hosted/api/client.ts:359-362 + AuthGate.tsx (BootUnreachable branch), reviewer: Claude (Architecture)
Plan baseline: plan §7 proposes A (welcome on a failed probe); not approved.
Runtime evidence: probe `.catch((error) => { unhintedProbe = null; throw error; })` saves nothing; AuthGate then renders `<BootUnreachable onRetry=... />` (AuthGate.tsx, last line of AuthGate). AC8: "When the hint can't be stored (blocked storage) or the browser is offline, the welcome still works. An offline first visit saves nothing."
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 offline unhinted `/` | BootUnreachable + retry | welcome shown; nothing saved by the probe; Try saves `local` (person's choice); Sign in fails on its own page | BootUnreachable kept; welcome once the server answers 401 |
| R1 counting | approved A (D3) | approved A (D3) | approved A (D3) |
| R3 401 contract | pending | pending | pending |
Question D4: Offline on a first visit, show the welcome or keep the "can't reach" screen? (Recommendation: A)
Header: Offline visit
Options:
A) Welcome offline (recommended)
A failed probe on `/` with no hint shows the welcome; the probe saves nothing; Try is the person's own choice and saves local; a signed-in person offline can still pick Sign in. Meets AC8. Human ~2h / CC ~10min.
B) Keep can't-reach screen
Offline unhinted keeps BootUnreachable with Retry; the welcome appears once the server answers. Safer for signed-in people offline, but AC8 must be reworded. Human ~15min / CC ~2min.
D4 record (superseded): approved; answer A) Welcome offline (D4, 2026-10-30); scope: with no hint, a probe that fails (network/timeout, not 200/401) on `/` renders the welcome instead of BootUnreachable; the probe saves nothing; Try saves `local`; Sign in/Create an account go to their pages, which show their own offline errors. Other authed paths keep BootUnreachable. Tests: offline unhinted `/` → welcome, nothing stored; Try then stores local; offline on /p/x → BootUnreachable.
History: approved A (D4) superseded pending D7; reopened by outside voice O3: the portal has no service worker (no `serviceWorker` in src/hosted), so a "truly offline" first visit can't load the page; the real case is page loaded + API unreachable (outage), which mode.ts:12-14 guards against ("a network failure saves nothing, so an offline first visit never strands a signed-in person in an empty local app"); Try then imports `@mut/local-backend` (client.ts:328), which fails offline after `local` is saved; me.ts:27 `retry: false`.
Reopened grid:
| Choice | Current (D4 A) | A | B |
|---|---|---|---|
| Probe outcome shown welcome | any failure | network failure only (`code === 'NETWORK'`/timeout); 5xx keeps BootUnreachable | same as A |
| Retry | none | welcome shows "Can't reach MTB3A · Retry" line that re-runs the probe | same |
| Try after a failed probe | saves `local` | keeps `local` in memory for this page only; the next load asks the server again | saves `local` (D4 as approved) |
| Try when the local chunk can't load | LocalUnavailable after saving | nothing saved; LocalUnavailable with Retry | LocalUnavailable after saving |
Question D7: In an outage, should Try on the welcome remember "this device" for good, or only for this visit? (Recommendation: A)
Header: Outage Try
Options:
A) This visit only (recommended)
Welcome on network failure only, with Retry; Try after a failed check works for this page but saves nothing, so a signed-in person is never stranded. Human ~3h / CC ~15min.
B) Save as approved
Keep D4: Try always saves local, plus the Retry line and network-only narrowing. Simpler, but an account holder caught in an outage who taps Try stays in local mode afterwards. Human ~2h / CC ~10min.
State: approved
Actual answer: A) This visit only (D7, 2026-10-30)
Accepted scope: the welcome shows on `/` with no hint when the probe answers 401 (undecided) or fails with a network error/timeout; a 5xx keeps BootUnreachable. After a network failure the welcome carries a "Can't reach MTB3A · Retry" line that re-runs the probe (200 → portal, 401 → plain welcome). Try after a 401 saves `local`; Try after a network failure sets `local` in memory only (setUnhintedMode), so the next load asks again. If the local chunk can't load, nothing is saved and LocalUnavailable shows with Retry. Tests: one row each in client-mode/AuthGate tests (401, network, 5xx, Retry → 200, Retry → 401, Try-after-network leaves storage empty, chunk-load failure saves nothing).


### R3: Regression contract for the first-visit probe
Finding: 3, CRITICAL, confidence 9/10, src/hosted/api/client.ts:356-357 `if (response.status === 200) setMode('remote'); else if (response.status === 401) setMode('local');`, reviewer: Claude (Test review, IRON RULE)
Plan baseline: plan §3 changes 401 → undecided; ADR-100 and shipped QA `@portal.local.first-visit` (qa/specs/portal/local-mode.spec.ts:90) assert 401 → local.
Runtime evidence: shipped since api-v0.3.14 (memory: MUT-286 shipped); existing tests client-mode.test.ts, mode.test.ts, local-mode.test.tsx cover the 401 → local path.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| Preserved | 200 → remote saved; network fail → nothing saved; saved hint wins; one probe per load; cross-tab follow | all kept, each asserted | all kept, asserted only where existing tests already do |
| Intentional change | 401 → local saved | 401 → undecided (memory only), no local backend import, no IndexedDB opened, later requests 401 with zero fetches | same |
| Old QA | @portal.local.first-visit asserts local overview | rewritten: first visit → welcome → Try → overview, still one /v1 request | same |
| R1, R2 | approved | unchanged | unchanged |
Question D5: How to pin the probe's regression contract? (Recommendation: A)
Header: Probe contract
Options:
A) Assert every rule (recommended)
One table-driven test in client-mode.test.ts: 200/401/network/hint-present/storage-blocked rows, each asserting what is stored, whether @mut/local-backend is imported, and the fetch count; plus the QA spec rewrite. Human ~3h / CC ~15min.
B) Update existing only
Flip the existing 401 assertions to undecided and rewrite the QA spec; no new rows for the kept rules. Human ~1h / CC ~5min.
State: approved
Actual answer: A) Assert every rule (D5, 2026-10-30)
Accepted scope: one table-driven test in src/hosted/api/__tests__/client-mode.test.ts with rows 200 / 401 / network failure / hint present / storage blocked, each asserting the stored hint, whether `@mut/local-backend` was imported, and the fetch count; plus cross-tab follow and one probe per load; `@portal.local.first-visit` rewritten to pass the welcome via Try while still asserting one /v1 request.
History: none

## Outside voice (native fallback, Claude Plan subagent, 2026-10-30)
Codex not installed (CODEX_MODE: not_installed) → native Plan subagent, completed inside the 5-minute timer. 9 findings; checked against code by the parent reviewer (guard.ts:37-54 portal surface keeps only `$browser,$os,$os_version,$device_type`; errorReporting.ts:47 `if (currentMode() === 'local' || held.length >= EARLY_QUEUE_LIMIT) return;`; restoredHome.ts:16 `fetchQuery({ ...meQuery, staleTime: 0 })`).

Dispositions without a new question (required to keep an approved or shipped contract, or by Basel's direct instruction):
- O1 (Critical): R1 adds requests on a door click (posthog chunk + capture), so the ticket guardrail "no network call beyond the existing mode check" is amended to "…before a door is chosen". Plan §3/§10 corrected; Jira comment + ADR record it. Consequence of D3, accepted.
- O4 (High): carry-over Open regresses (MUT-291): `/carry-over/receive` has no hint; after a successful save ReceivePage must `setMode('local')` before `restoredHome()`. Test: receive → save → Open lands on the restored profile, not the welcome. Required (keeps shipped behavior).
- O5 (High): Basel's ruling (2026-10-30, "IF ANYTHING IS REQUIRED ILLUSTRATION OR FLOWS OR ANIMATION OR MOTION WRITE THE PROMPT TO CLAUDE DESIGN, DON'T IMPROVISE"): §5's ported SVG and hand-picked CSS entrance are withdrawn. Step 0 = the Claude Design prompt below; the screen's art, layout of the doors and motion are built from its output. D1's "inline SVG" becomes "the art Claude Design returns, as one asset used only by WelcomePage" (no separate component unless the design ships one). Mode/transport/tests may start before the design arrives; WelcomePage tests assert roles and copy, not structure.
- O6 (Medium): errorReporting.ts:47 and :94-103 treat `undecided` like `local` (signed out: hold nothing, drop held). Test: undecided errors never reach Sentry after a same-page sign-in. Required (ADR-097 §10).
- O7 (Medium): the probe returns three outcomes (`remote` | `undecided` | `failed`); the request that triggered it and any waiting on it get the synthetic 401, never `sendLocal`. Covered by R3's rows.
- O8 (Medium): local-mode.spec.ts:106-108 You-rows assertion gains the new row; every no-hint `signedOutServer(page, null)` spec is updated to pass the welcome.
- O9 (Low): lost hint with records still on the device shows the welcome; Try finds them. Recorded in the ADR.

### R4: How the cookieless click is sent (mechanism for approved R1)
Finding: O2, HIGH, confidence 9/10, src/hosted/analytics/portalAnalytics.ts:55-62 (`loading ??=` one default posthog instance, opted out) + src/lib/analytics/guard.ts:51 (`portal: ['$browser', '$os', '$os_version', '$device_type']`), reviewer: outside voice, verified
Plan baseline: R1 approved A (D3): cookieless click count, consented detail only after sign-in.
Runtime evidence: one default instance initialised opted-out with localStorage persistence; posthog ignores a second init of the same instance; the portal guard strips the cookieless fields PostHog needs, so a portal-surface cookieless event is dropped.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 mechanism | unspecified | separate named posthog instance `welcome` with the landing's cookieless options; new guard surface `portal-welcome` keeping only the cookieless routing fields + `choice` (no referrer/utm) | no SDK: one `fetch` POST to PostHog's capture endpoint with `$cookieless_mode`, built through the same guard surface |
| R1 | approved A | unchanged | unchanged |
| Test | — | click → sign in → opt in within one page: MUT-155 instance still opted out by default, welcome instance never reused | same page test; plus payload snapshot of the POST |
Question D6: How should the cookieless welcome click be sent so it can't disturb the signed-in consent setup? (Recommendation: A)
Header: Click send
Options:
A) Named SDK instance (recommended)
A second posthog-js instance named `welcome` with the landing's cookieless options and a new `portal-welcome` guard surface; MUT-155's instance untouched. Reuses the shipped cookieless path PostHog maintains. Human ~4h / CC ~20min.
B) Direct capture POST
No SDK on the welcome: one fetch to PostHog's capture API with cookieless markers we set ourselves. Smaller download, but we own PostHog's cookieless wire format and must track its changes. Human ~5h / CC ~25min.
State: approved
Actual answer: A) Named SDK instance (D6, 2026-10-30)
Accepted scope: posthog-js second instance named `welcome`, landing cookieless options, initialised lazily on the first door click and never awaited before navigation; new guard surface `portal-welcome` (cookieless routing fields + `choice` only, no referrer/utm/url path beyond `/`); events.json lists `portal_welcome_choice` for it; MUT-155's default instance untouched. Tests: guard surface payload; click → sign in → opt in in one page leaves the consent instance opted out by default and separate.
History: none

Approval readiness: PASS — D1 (structure B), R1 ← D3 A, R2 ← D7 A (supersedes D4), R3 ← D5 A, R4 ← D6 A; O1/O4/O5/O6/O7/O8/O9 accepted as required work (O5 by Basel's direct instruction, 2026-10-30).

---

# Final plan (supersedes §3–§10 above where they differ)

## Binding decisions
- An unhinted 401 is **undecided** (memory only); only a door saves a mode. (§2–§3, R3)
- Welcome on `/` for undecided and for a network failure (not 5xx), with Retry after a failure; Try after a failure is this-visit-only. (R2/D7)
- Other authed paths when undecided → sign-in with `next` (same as /connect/approve's SignInFirst today).
- Door clicks counted cookieless via a separate posthog instance `welcome` and a `portal-welcome` guard surface; nothing else before sign-in; consented detail stays MUT-155. Ticket guardrail amended to "no network call before a door is chosen". (R1/D3, R4/D6, O1)
- Illustration, door layout and motion come from Claude Design, not code. (O5)
- `continueOnThisDevice` shared by SignInPage and WelcomePage. (D1)

## Step 0 — Claude Design prompt (paste into claude.ai/design, the Brand v2 project)

> Design the **first-visit welcome** for MTB3A's web portal (app.mtb3a.com), desktop (1280) and phone width (375), Arabic RTL first, plus the English LTR version, light and dark. Use the existing MTB3A Brand v2 system in this project (Thmanyah both scripts, AAA inks, the mark and wordmark, the nuqta motif) and keep it consistent with the iPhone welcome (MUT-407, onboarding illustration: arch, path, nuqta, sparkles).
> One screen shown before the app, the first time someone opens the portal and isn't signed in. Contents, in this order of importance:
> 1. Language switch (العربية / English) and the MTB3A wordmark at the top.
> 2. A welcome illustration (new or adapted from the MUT-407 onboarding scene), plus a static frame for reduced motion.
> 3. Headline and one line: what MTB3A does — who owes you, what came in, what went out, per currency.
> 4. Door 1, account (primary): **Sign in** and **Create an account**, with one line: your records on your phone and on any browser, kept safe on our servers.
> 5. Door 2, this device (secondary): **Try it on this device**, with an honest four-point explainer: stays in this browser only, no account and nothing sent to us; clearing site data erases it; back up from Your data › Download; it doesn't move into an account later. No phone-sync promise.
> 6. A variant with a quiet "Can't reach MTB3A right now · Retry" line (server unreachable).
> 7. A variant reopened from inside the app, where door 2 reads **Continue on this device**.
> Motion: the entrance of the illustration and the cards (spring timing per Apple's principles: quick response, no bounce on text), what moves under prefers-reduced-motion (nothing but an opacity fade), and the press feedback on the doors. Deliver: the screens, the illustration as SVG (and the animated version's frames/timing spec), the motion spec (durations, curves, delays), and the exact copy in Arabic and English. Fits a 375 px phone with no horizontal scroll; text and buttons meet WCAG AA.

Import the result with the claude_design MCP. The build uses the delivered SVG/motion spec verbatim; questions about it go back to Claude Design, not into code guesses. MUT-517 (phone) reuses the same source.

## Files (after review)
| Area | File | Change |
|---|---|---|
| mode | src/hosted/session/mode.ts | `UnhintedMode` adds `undecided`; `markUndecided()` |
| transport | src/hosted/api/client.ts | probe returns `remote`/`undecided`/`failed`; undecided → synthetic ApiError 401, no fetch, no local import |
| gate | src/hosted/session/AuthGate.tsx | undecided or network-failed on `/` → WelcomePage; other paths → RedirectToSignIn; `me` disabled while undecided |
| page | src/hosted/pages/auth/WelcomePage.tsx (new) | on AuthLayout; art + layout + motion from Claude Design; Retry line; reopen variant |
| helper | src/hosted/session/continueOnThisDevice.ts (new) | `useContinueOnThisDevice({ persist })`; SignInPage.tsx:150 uses it |
| route | src/hosted/router.tsx | `/welcome` under rootRoute; remote hint → `/` |
| entry | src/hosted/pages/you/YouAccount.tsx | local row "What is MTB3A?" → `/welcome` |
| carry-over | src/hosted/pages/carry-over/ReceivePage.tsx | `setMode('local')` after a successful save (O4) |
| errors | src/hosted/observability/errorReporting.ts | undecided treated as signed out (O6) |
| analytics | src/hosted/analytics/welcomeCount.ts (new, lazy), src/lib/analytics/guard.ts, posthogConfig.ts, docs/analytics/events.json (+ PINNED_VERSIONS), docs/analytics/README.md rule 4 note | R1/R4 |
| privacy | privacy page en/ar | one line naming the portal welcome's cookieless count |
| copy | src/hosted/i18n/ar.json, en.json | `hosted.welcome.*` |
| QA | qa/features/portal/welcome.yaml, qa/specs/portal/welcome.spec.ts; local-mode.spec.ts (first-visit, You rows :106-108), other no-hint specs | O8 |
| knowledge | DECISIONS (ADR-230), CHANGELOG, SYSTEM_OVERVIEW, COMPONENT_REGISTRY, TEST_PLAN, TECH_DEBT | |

## Flow
```
 load /  ──hint? ──yes──► AuthGate as today (local or remote)
            │no
            ▼
       probe /v1/me
   ┌────────┼──────────────┬───────────┐
  200      401         network/timeout  5xx
 save      undecided    (save nothing)   BootUnreachable
 remote    (memory)          │
   │          │              ▼
 portal    WelcomePage ◄── WelcomePage + "Can't reach · Retry" ──Retry──► probe again
              │
   ┌──────────┼────────────────────┐
 Sign in   Create account       Try / Continue
 /sign-in  /signup              after 401: save local
 (Back → welcome:               after failure: local in memory only
  still undecided)              chunk fails: nothing saved, LocalUnavailable
   success: save remote         → / (local overview)
 each door: welcome instance capture {choice} (cookieless, not awaited)
```

## Test review
```
CODE PATHS                                         USER FLOWS
[+] client.ts probe (table, D5)                    [+] First visit
  ├─ 200 → remote saved          [GAP→new row]       ├─ [GAP][→E2E] 401 → welcome (welcome.spec first-visit)
  ├─ 401 → undecided, no import  [GAP→new row]       ├─ [GAP][→E2E] signed in → straight to portal
  ├─ network → nothing saved     [★★ existing, ext]  └─ [GAP][→E2E] deep links skip (sign-in, signup, connect)
  ├─ 5xx → BootUnreachable       [GAP→new row]     [+] Doors
  ├─ hint present → no probe     [★★ existing]       ├─ [GAP][→E2E] Try → overview, reload stays local
  └─ storage blocked             [GAP→new row]       ├─ [GAP][→E2E] Sign in → Back → welcome
[+] AuthGate                                         └─ [GAP] Try after network failure: storage empty
  ├─ undecided on / → welcome    [GAP]             [+] Reopen
  ├─ undecided on /p/x → sign-in [GAP]               └─ [GAP][→E2E] You › What is MTB3A? → welcome
  └─ network on / → welcome+Retry[GAP]             [+] Regressions (CRITICAL)
[+] WelcomePage (roles/copy, not layout)             ├─ [GAP] carry-over Open → restored profile (O4)
  ├─ ar/rtl default, en switch   [GAP]               ├─ [GAP] undecided errors never reach Sentry (O6)
  ├─ explainer facts, no sync    [GAP]               └─ [★★ → rewrite] local.first-visit via welcome
  └─ reopen label                [GAP]
[+] welcome count
  ├─ guard surface payload       [GAP]
  ├─ no send before click; nav not awaited [GAP]
  └─ click→sign in→opt in same page keeps MUT-155 opted-out [GAP]
COVERAGE today: 2/27 paths (7%); all gaps have a planned test below.
```
Value cards (all `seam=none` unless noted):
- probe table — protects=which backend each request uses; fails_when=401 saves local again or a failure saves anything; why_new=existing tests assert the old 401 rule only; no_claim=real server (fetch mocked).
- AuthGate undecided — protects=welcome only on `/`, deep links to sign-in; fails_when=welcome replaces /connect/approve or overview shows first; why_new=no undecided state today; no_claim=router integration only.
- carry-over Open — protects=MUT-291 records open after receive; fails_when=receive leaves no hint; why_new=receive relied on the 401→local side effect; no_claim=none beyond protects.
- Sentry hold — protects=ADR-097 §10 no signed-out errors sent; fails_when=undecided not treated as signed out; why_new=hold checks `=== 'local'` only; no_claim=Sentry transport (mocked).
- welcome count — protects=only {choice}, cookieless, separate instance; fails_when=guard lets more through or reuses the consent instance; why_new=new surface; seam=lazy loader injected (production uses it); no_claim=PostHog ingestion.
- E2E welcome.spec (first-visit core, try-local, sign-in-door, never-again, deep-link-skips, reopen) — protects=the ticket's ACs end to end on a preview build; no_claim=production PostHog.
Tests to retire: none (local-mode.spec first-visit and the You-rows assertion are rewritten, not removed).

## Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| probe 401 | IndexedDB opened before a choice | probe table "no import" row | nothing (test catches) |
| outage | account holder taps Try | Try-after-network row | local app this visit; account back on reload |
| local chunk fails | Try offline | chunk-failure row | LocalUnavailable + Retry, nothing saved |
| welcome count | PostHog blocked by an ad blocker | not-awaited row | nothing; navigation proceeds |
| carry-over | Open after receive | O4 test | restored profile |
| cross-tab | other tab chooses Try | existing onModeChangedElsewhere | this tab follows to the overview |
No critical gaps: every path has a test and a visible outcome.

## Performance
No new API requests; first visitors skip the local-backend boot and IndexedDB until they choose. One lazy posthog chunk only on a door click. Welcome art size depends on Claude Design's SVG; budget it under the hosted entry bundle check (`npm run test:bundles`). No issues found.

## What already exists
mode hint + probe (mode.ts, client.ts), AuthLayout (language switch + wordmark), SignInPage's Continue on this device, YouAccount local rows, landing cookieless config (posthogConfig.ts:46) and guard, SessionBridge cross-tab follow, /signup closed state (no self-service call needed on the welcome).

## NOT in scope
MUT-289 marker/upsell; tour/coach marks; demo data; moving records into an account (MUT-290 won't do); phone welcome (filed as MUT-517); counting anything else signed out.

## Worktree parallelization strategy
| Step | Modules | Depends on |
|---|---|---|
| A. mode/transport/AuthGate/carry-over/errors + tests | src/hosted/session, api, observability, pages/carry-over | — |
| B. welcome count | src/hosted/analytics, src/lib/analytics, docs/analytics | — |
| C. Claude Design prompt → assets | (claude.ai/design) | — |
| D. WelcomePage, route, You row, copy, QA specs | pages/auth, router, pages/you, i18n, qa | A, B, C |
Sequential implementation in one worktree (one primary module, shared session code); C runs in Claude Design meanwhile.

## Implementation Tasks
- [ ] **T0 (P1, human ~1h / CC ~5min)** — design — Send the Step 0 prompt to Claude Design; import the result. Surfaced by: O5. Verify: SVG + motion spec + copy in hand.
- [ ] **T1 (P1, human ~4h / CC ~20min)** — transport — undecided mode, tri-state probe, synthetic 401, network-failure welcome, this-visit Try. Surfaced by: R2/R3, O7. Files: mode.ts, client.ts, AuthGate.tsx. Verify: client-mode table + AuthGate tests.
- [ ] **T2 (P1, human ~1h / CC ~5min)** — carry-over — ReceivePage saves local on success. Surfaced by: O4. Verify: carryOverPages.test.tsx.
- [ ] **T3 (P1, human ~1h / CC ~5min)** — errors — undecided = signed out in errorReporting. Surfaced by: O6. Verify: errorReporting.test.ts.
- [ ] **T4 (P1, human ~4h / CC ~20min)** — analytics — welcome instance, guard surface, events.json + pin, README note, privacy line. Surfaced by: R1/R4. Verify: analytics-taxonomy + new count tests.
- [ ] **T5 (P1, human ~1d / CC ~45min)** — UI — WelcomePage from the design, continueOnThisDevice, /welcome route, You row, copy ar/en. Surfaced by: plan §4–§5, D1. Verify: WelcomePage/You tests.
- [ ] **T6 (P1, human ~4h / CC ~20min)** — QA — welcome.yaml + spec, rewrite local-mode first-visit and You rows, other no-hint specs. Surfaced by: O8. Verify: `release-qa run --attach --only welcome`, `release-qa lint`.
- [ ] **T7 (P2, human ~1h / CC ~10min)** — knowledge — ADR-230 (undecided; rule-4 exception; outage rule; lost-hint note O9), CHANGELOG, SYSTEM_OVERVIEW, registry, TEST_PLAN. Verify: review.
Gate (Node 22, via heavy-gate, one at a time): lint, typecheck, test:run --maxWorkers=3, build, test:bundles.

Unresolved decisions that may bite you later: none.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, D1)
- Reality rows: 7/7 tier-1 rows considered (premise checks cited inline; no linked-issue asks left out except the guardrail amendment, O1), 0 unverified premises
- Architecture Review: 3 issues (R1 counting, R2 offline, carry-over regression via outside voice)
- Code Quality Review: 2 issues (probe tri-state O7, Sentry hold O6)
- Test Review: diagram produced, 25 gaps identified, all planned
- Performance Review: 0 issues
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (phone filed as MUT-517 instead)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0
- Outside voice: codex not installed; native Claude Plan subagent completed (9 findings, all dispositioned)
- Parallelization: 1 lane sequential (+ Claude Design in parallel)
- Lake Score: 4/4 (D3, D4, D5, D7 picked the 10/10 or highest option; D6 9/10 highest)

REALITY: premise-table pass claims checked against code with receipts src/hosted/api/client.ts:356
REALITY: already-done pass no MUT-513 commits on main src/hosted/session/mode.ts:1
REALITY: surface-check pass test:bundles and test:run exist package.json:19
REALITY: binding-decisions pass ADR-100 probe rule amended by ADR-230, recorded src/hosted/session/mode.ts:12
REALITY: numbers pass no measured numbers claimed; effort estimates labelled estimates .claude/designs/mut-513-portal-welcome-plan.md:1
REALITY: deferred-asks finding guardrail amended for door counting (O1) src/hosted/analytics/portalAnalytics.ts:227
REALITY: pr-count pass one branch, one merge src/hosted/router.tsx:121

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Claude Plan subagent (codex not installed) | Independent 2nd opinion | 1 | unavailable (native fallback completed) | 9 findings, all dispositioned |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved into tasks) | 5 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex not installed; native Claude Plan subagent completed within the 5-minute timer, 9 findings (O1–O9), no external-provider coverage.
- **VERDICT:** Eng review run, all decisions answered; status issues_open means mapped work (T0–T7), not open questions. Design review recommended once Claude Design returns the screen.

NO UNRESOLVED DECISIONS
