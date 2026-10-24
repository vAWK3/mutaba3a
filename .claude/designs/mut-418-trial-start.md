# MUT-418 — Portal first run: "Your 14-day free trial has started", a card recommended and skippable

Status: planned 2026-10-24 (unattended run; every D below is **pending Basel's confirmation**).
Epic MUT-322 (pilot-readiness, ga-gate). Blocked by MUT-368 (merged local main 305cbe56). Scope includes Basel's
comment 12451: consumers everywhere, and the four sandbox list prices.

Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · Backlog → In Progress → In Review (Basel moves to Done).

## 1. Problem

Basel's sellable portal is "sign up → onboarding → 14-day free trial → card details optional but recommended".
MUT-362 already lets a person subscribe during the trial without losing it (ADR-170 R-D2: Checkout sets `trial_end`
when the trial end is ≥ 48 h away), but nothing asks: MUT-368's first run lands on Home, and the Billing drawer only
appears when the person opens it. A new account sees no card prompt until the trial runs out.

Separately, `billing-countries.json` ships `consumerCountries: []`, so today a person can only buy "as a business".
Basel decided (2026-10-23) that anyone may subscribe as an individual, in every country.

## 2. Acceptance criteria (ticket + comment 12451)

- AC1 A new signup lands on the trial step once, in both languages; "Not now" goes to Home and the step does not return.
- AC2 "Add a card now" goes through MUT-362's flow, comes back ACTIVE-in-trial, and the first charge date is the trial end.
- AC3 The Home banner shows the days left until a card exists, and is gone afterwards. Dismiss hides it for 3 days;
  it can't be dismissed in the last 3 days.
- AC4 No price pair → no card action, and the copy stays honest.
- AC5 Release-QA: `billing.trial-start` (core) and `billing.trial-banner` features with passing recorded specs.
- AC6 en/ar, RTL at 375 px; PostHog `trial_card_prompt_shown|_accepted|_skipped` through the portal's wrapper.
- AC7 (12451) Consumers everywhere: `"consumerCountries": "*"` is valid and validated at boot; planCheckout, the drawer
  copy and the existing billing specs follow. The IL/JO business path stays for "For a business".
- AC8 (12451) Sandbox prices ₪49 / ₪490 / $16 / $160 under the four `freelancer_list_*` keys, VAT-exclusive, on the
  `tier: freelancer` product (lookup-key transfer from MUT-362's ₪39/$10 prices). Live steps in the runbook.

## 3. Design

### 3.1 Where the "once" lives: on the server (D1)

The step must show once per person, not once per browser, and it must also reach webmail signups the operator
approves later (MUT-367): their first sign-in is on /sign-in, never through `SetupPage`. So the fact is server-side,
the MUT-191 `malafatSuggestions` pattern (a JSON preference on `users`, a PATCH under `/v1/me`, no audit row):

- Migration `20261024120000_mut418_trial_prompt`: `users.trialPrompt Json?` (NULL = nothing recorded).
- Stored shape `{ welcomedAt: ISO|null, welcomeAnswer: 'accepted'|'skipped'|null, bannerSnoozedUntil: ISO|null }`,
  read through a tolerant resolver (`server/src/billing/trial-prompt.ts`, pure: `resolveTrialPrompt`, `applyTrialPromptChange`).
- `GET /v1/me` → `user.trialPrompt` (always present; all-null for a person with nothing recorded, and in local mode).
- `PATCH /v1/me/trial-prompt` body `{ action: 'welcome-accepted' | 'welcome-skipped' | 'banner-snoozed' }` → 200 the
  resolved prompt. The first welcome answer wins (idempotent, two devices never undo each other);
  `banner-snoozed` sets `bannerSnoozedUntil = now + 3 days` (server clock, `BANNER_SNOOZE_DAYS`). Row-locked like
  the Malafat change (`SELECT … FOR UPDATE`). No Idempotency-Key (idempotent by construction), no audit row.
- Store port `users.updateTrialPrompt(id, change, at)` in ports.ts, memory.ts, prisma.ts, plus the store contract test.
- Records-file export carries `trialPrompt: null` like other per-browser preferences? No: the export's user row lists
  explicit fields; add `trialPrompt` alongside `malafatSuggestions` so local ↔ hosted parity tests stay exact.

The answer is stored (D2), so Basel can count accepted vs skipped from the database even though the portal's
PostHog events only flow for people who opted in (ADR-090).

### 3.2 When the step is due (pure, `src/hosted/data/trialPrompt.ts`)

`trialWelcomeDue(me, now)`: the person's **personal** profile (always their own, so its entitlement is their own
trial) has `billing = { source: 'TRIAL', state: 'ACTIVE' }`, `until − now ≥ 48 h` (D3: otherwise the step's
"You won't be charged until …" would be false, since Checkout charges at once inside 48 h), `user.status = ACTIVE`,
and `user.trialPrompt.welcomedAt = null`. TRIAL ACTIVE already means no covering subscription (the resolver puts
STRIPE before TRIAL), i.e. "no card and no subscription".

`trialBannerOf(me, now)` → `null | { daysLeft, endsAt, dismissible }`: same TRIAL ACTIVE test on the personal
profile; `daysLeft = ceil((until − now)/day)`; `dismissible = daysLeft > 3`; hidden while
`bannerSnoozedUntil > now && dismissible`. **MUT-361 seam:** this returns a union MUT-361 extends with its
read-only / locked notices (`kind: 'trial'` now).

### 3.3 The step: a third step of the Billing drawer (D4, drawer-first)

`?billing=true&step=welcome` — a step of MUT-362's `BillingDrawer` (same frame, same `billingQuery`), not a page.
`ProfileDrawerSearch.step` widens to `'subscribe' | 'welcome'`. Body (`TrialWelcomeBody` in `BillingDrawer.tsx`,
copy in `hosted.billing.welcome.*`):

- chip "Free trial"; headline (h3, focused) "Your 14-day free trial has started"; "It ends on {date}." (the
  person's language and calendar via `formatInstant`, as the drawer already does);
- sellable (`billingViewOf(...).openSoon === false`): primary **"Add a card now (recommended)"**, note "You won't be
  charged until {date}. Cancel any time before then."; secondary **"Not now"**;
- not sellable (no Stripe or no price pair): the honest line "Subscriptions open soon. We'll let you know before
  your trial ends." (existing `openSoon`) and one button **"Continue"** (D5); no card action.
- Our own Arabic explanation still comes before any Stripe page: Add a card goes to MUT-362's Subscribe step
  (country, buyer, interval, heads-up, first-charge line), which goes to Checkout with `trial_end` (R-D2).

Actions: Add a card → `PATCH welcome-accepted` (fire-and-forget, optimistic `ME_KEY` update), `trial_card_prompt_accepted`,
then **replace** to `step=subscribe` (Back from Subscribe returns to the status view, never to the welcome).
Not now / Continue / the drawer's close (✕, Escape, scrim) → `PATCH welcome-skipped`, `trial_card_prompt_skipped`,
close (replace). `trial_card_prompt_shown` once per mount. Events carry `prompt: 'first_run'`.

### 3.4 Who opens it

- **Seam (MUT-368):** `firstRunPath(me, now)` now returns `{ to, search }`; when `trialWelcomeDue` it is the personal
  Home with `{ billing: true, step: 'welcome' }`. `SetupPage.signIn` navigates to it. One history entry, no flash.
- **Every other first sign-in** (operator-approved webmail signup, another device before answering):
  `TrialWelcomeOpener` in `HostedShell` (hosted mode only): when `trialWelcomeDue(me)` and no shell overlay is open,
  it replaces the URL with the welcome step, once per page load (D6). The server answer then stops it for good.

### 3.5 The Home banner (`TrialBanner`, on OverviewPage, under the header)

"{N} days left in your free trial · Add a card" (ICU plural; ar has its own forms). "Add a card" opens
`?billing=true&step=subscribe` only when the catalog is sellable (it reads `billingQuery`, shared with the drawer,
30 s stale; D7). Dismiss (✕, labelled "Hide for 3 days") → `PATCH banner-snoozed` + `trial_card_prompt_skipped`
`{prompt:'banner'}`; no ✕ when `dismissible` is false. `trial_card_prompt_shown {prompt:'banner'}` once per
mount; accepting sends `_accepted {prompt:'banner'}`. Hidden once the person has a subscription (TRIAL → STRIPE).
Shown on the Overview of whichever profile is open (D8): the trial is the person's, not the profile's.

### 3.6 Consumers everywhere (comment 12451, D9–D11)

- `billing-countries.json`: `"consumerCountries": "*"`. `parseBillingCountries` accepts `"*"` or an array of codes
  (anything else fails boot). Internal type `consumer: '*' | readonly string[]`; one helper `isConsumerCountry`.
- `checkoutRefusalOf`: a person anywhere passes. `consumerCountryCheck` (the D9 operator flag) → never flagged
  under `"*"`.
- `paramsOf` (D10): the "Business tax number" custom field is shown **only to a business** in IL/JO, and is required
  there; a business elsewhere still gets Stripe's tax ID, required where Stripe supports the type
  (`if_supported`). A person gets `tax_id_collection: { enabled: true, required: 'never' }` and no custom field.
  (Today the custom field is optional for "consumer" countries regardless of buyer; under "*" that would make a
  business's number optional everywhere, which loses the business path.)
- `GET /v1/billing` `countries` gains `consumerEverywhere: boolean` (additive, D11); `consumer` stays the list
  (empty under "*"). Portal `checkoutRouteOf` uses both, so the "We can't sell to individuals in X" path remains
  reachable only if the file goes back to a list.
- Drawer copy: `personNote` "No tax number needed, in any country"; `businessNote` "Your invoices carry its tax number".

### 3.7 Sandbox prices (AC8, D12)

`qa/support/billing-live.mjs` `PRICES` → 4900 / 49000 ILS, 1600 / 16000 USD. `ensureCatalog` compares each key's
active price (amount, currency, interval, tax_behavior exclusive, product) and, when it differs, creates the new
price with `transfer_lookup_key: true` (Stripe moves the key; the old price stays for subscriptions on it).
Run once now so the sandbox holds the new amounts. The server's 10-minute price cache picks it up on restart.
Live mode is never touched: the live step goes into `docs/operations/before-release.md` (operator, at the end of
the run, with Basel's live key).

### 3.8 Analytics (AC6)

`docs/analytics/events.json` gains `trial_card_prompt_shown|_accepted|_skipped` (emitters `portal`, property
`prompt: enum[first_run, banner]`). `trackPortal`'s `PortalEvent` widens. Opt-in rule unchanged (ADR-090): at the
very first sign-in nobody has opted in yet, so the stored answer (D2) is the funnel's source of truth.

## 4. Decisions (all pending Basel's confirmation)

- D1 The "seen once" fact and the banner snooze are stored on the server (`users.trialPrompt`), not per browser,
  so approved webmail signups get the step and a second device doesn't repeat it.
- D2 The welcome answer (accepted / skipped) is stored, giving a consent-free funnel count.
- D3 The step auto-opens only while ≥ 48 h of trial remain (Checkout's `trial_end` minimum); later, the banner alone.
- D4 The step is `?billing=true&step=welcome` inside the Billing drawer: drawer-first, deep-linkable, no new route.
- D5 With no sellable price the step says the trial started, says subscriptions open soon, and offers "Continue" only.
- D6 A shell opener covers first sign-ins that don't pass through /setup (approved accounts, other devices).
- D7 The banner's "Add a card" appears only when the catalog is sellable (one cached `/v1/billing` read).
- D8 The banner shows on the Overview of any profile the person opens, keyed to their own (personal) trial.
- D9 `"consumerCountries": "*"` is the "all countries" spelling; arrays still work.
- D10 The business tax-number field is for "For a business" only, and required there; a person never sees it.
- D11 `GET /v1/billing` adds `countries.consumerEverywhere` (additive) instead of changing `consumer`'s type.
- D12 Sandbox prices move by lookup-key transfer; MUT-362's ₪39/$10 prices stay in the sandbox, inactive keys.
- D13 Closing the welcome drawer any way other than "Add a card" counts as "Not now".
- D14 (eng review) `/` keeps the shell's drawer keys through its redirect, so `/?billing=true&step=subscribe` works
  as a link from mails (MUT-419) and the lapse gate (MUT-361).
- D15 (eng review) The portal's local snapshot format goes 4 → 5 for `trialPrompt` (MUT-366 precedent).
- D16 (eng review) No consent shortcut for the first-run events; the stored answer is the funnel's source.

## 5. Files

Server: `prisma/schema.prisma` + migration; `src/billing/trial-prompt.ts` (+ test); `src/billing/checkout.ts`,
`billing-countries.json`; `src/repositories/{ports,memory,prisma}.ts` + `__tests__/store-contract-*.ts`;
`src/routes/me.ts`, `src/routes/sessions.ts` (PATCH beside malafat-suggestions), `src/routes/billing.ts`;
`src/schemas.ts`; `src/records-file/export.ts`; `openapi/openapi.yaml`; `src/app.ts` version **1.59.0-mut418**.
Portal: `src/hosted/data/trialPrompt.ts` (+ test), `session/firstRun.ts` (+ test), `pages/auth/SetupPage.tsx`,
`components/BillingDrawer.tsx`, `components/TrialBanner.tsx` (+ test), `shell/{AccountDrawers,HostedShell}.tsx`,
`shell/TrialWelcomeOpener.tsx`, `data/{filters,billingView,billingQueries}.ts`, `api/client.ts` + `schema.d.ts`,
`analytics/portalAnalytics.ts`, `pages/views/OverviewPage.tsx`, `i18n/{en,ar}.json`, `hosted.css`,
local backend (`session/localBackendContract.ts` / local `me`) for `trialPrompt`. Docs: `docs/analytics/events.json`.
QA: `qa/support/billing-live.mjs` (prices, signup on: memory mailer, fixture domains, Turnstile test secret),
`qa/support/livePortal.ts` (signup helper, trial-carrying pay), `qa/features/portal-live/billing.yaml`,
`qa/specs/portal-live/billing.spec.ts`, `qa/specs/portal-selfservice/signup.spec.ts` (Home now behind the step).

## 6. Tests (TDD)

- `trial-prompt.test.ts`: resolve (null, malformed, partial), first answer wins, snooze = now + 3 d, re-snooze moves it.
- store contract: `updateTrialPrompt` on memory + Prisma (test:db).
- route tests: `GET /v1/me` carries `trialPrompt`; PATCH 200 / 401 / 422 / cross-site 403; OpenAPI check.
- `checkout.test.ts`: `"*"` parses; junk fails; person in JO/AE/IL passes; business IL gets required custom field;
  business AE gets `if_supported`; person never gets the custom field; `trial_end` unchanged; D9 flag under `"*"`.
- billing route test: `countries.consumerEverywhere`.
- portal: `trialPrompt.test.ts` (due/not due: < 48 h, welcomed, not TRIAL, pending review; banner days, snooze,
  last-3-days), `firstRun.test.ts`, `BillingDrawer` welcome step (sellable / open soon / accepted / skipped / close),
  `TrialBanner.test.tsx`, `billingView` `checkoutRouteOf` with `consumerEverywhere`, analytics contract test.

## 7. QA scenarios (release-QA, app `portal-live`, area `billing`)

- `trial-start` (core): a new person signs up (business.example, memory outbox), finishes /setup in English, lands on
  "Your 14-day free trial has started" with the end date; presses Add a card now; Subscribe step as **For yourself**
  in Israel, Monthly (₪49.00); Stripe's Checkout shows the trial ("14 days free"-style line) → paid through the API
  on that customer with `trial_end` = the trial end (TD-201); back, "You're subscribed", the subscription is
  `trialing` and its first charge (`trial_end`) equals the trial end; reload → no step, no banner.
- `trial-banner`: a new person in Arabic at 375 px finishes /setup, sees the step in Arabic, presses "ليس الآن" → Home
  with the banner ("14 يومًا متبقية…"), no sideways overflow; hides it → gone after reload; the trial moved to its
  last 3 days (QA DB) → banner back without ✕; a card added → banner gone.
- `consumer-everywhere` (replaces `business-only`): Jordan + For yourself → $16.00 a month, Continue enabled.
- Existing `subscribe` / `subscribe-usd` / `rtl-375` amounts move to ₪49 / $160 a year.
- `portal-selfservice.signup.*`: the step now sits between /setup and Home (no Stripe there → the open-soon variant).

## 8. Seams for the next tickets

- MUT-361 (lapse gate): `trialBannerOf` → a notice union to extend with read-only / locked; the gate's locked
  screen opens `?billing=true&step=subscribe` (already deep-linkable).
- MUT-419 (trial emails): the "Add a card" link is `<portal>/?billing=true&step=subscribe`… (verify `/` keeps the
  search through HomeRedirect, or link the personal profile); the trial dates come from `trialView` in
  routes/billing.ts; skip the day-11 mail for anyone whose `trialPrompt.welcomeAnswer = 'accepted'` and who has a
  subscription (entitlement STRIPE).

Business / product impact
- Closes the gap in Basel's funnel: every new trial is asked, once, to add a card without losing a day of trial;
  consumers everywhere removes the business-only wall that blocked most freelancers from paying at all.
- GA gate for epic MUT-322; MUT-361 and MUT-419 build directly on it.
- Converting trials before they lapse is the revenue lever of the pilot; the step is skippable, so no sign-up is lost.

## 9. Eng review (plan-eng-review, 2026-10-24, unattended: recommended options taken, pending Basel)

Scope Challenge: ~30 files touched, 3 new portal units (`trialPrompt.ts`, `TrialBanner`, `TrialWelcomeOpener`) and one
server module (`trial-prompt.ts`). Smaller arrangement considered: folding the opener into `firstRunPath` only. Rejected:
it misses approved webmail signups (MUT-367), who never pass `SetupPage`. **Scope accepted as-is** (structure: original).

Reality rows:
- premise-table pass: TRIAL ACTIVE ⇒ no covering subscription (`entitlement.ts` rule 3 before 4); 48 h minimum
  (`checkout.ts` TRIAL_CARRY_MIN_MS); price cache 10 min (`checkout-gateway.ts:49`); MUT-362 sandbox prices are
  ₪39/$10 (`billing-live.mjs` PRICES); `HomeRedirect` drops the query (`AuthGate.tsx:79`). unverified=0.
- already-done pass: `git log main` on checkout.ts / BillingDrawer.tsx / firstRun.ts shows only MUT-362/368/402 work.
- surface-check pass: Stripe Prices `transfer_lookup_key`, Checkout `subscription_data.trial_end` (already used).
- binding-decisions pass: ADR-090 opt-in analytics kept; ADR-160 card-free trial kept; ADR-170 R-D2 reused.
- numbers pass: ₪49/₪490/$16/$160 from Basel's run decision; 3-day snooze and last-3-days from the ticket.
- deferred-asks pass: reminder emails (MUT-419), lapse gate (MUT-361), phone (MUT-364) are the ticket's own out-of-scope.
- pr-count pass: one branch, one merge.

### Findings

1. [P2] (confidence: 9/10) `src/hosted/session/AuthGate.tsx:79` `return <Navigate to={\`/p/${profiles[0].id}${to}\`} replace />;`
   drops the query, so a `/?billing=true&step=subscribe` link (MUT-419 mails, MUT-361's gate) loses the drawer.
   **D14 (accepted):** `FirstProfileRedirect` carries the shell overlay keys (`pickShellOverlay`) through.
2. [P2] (confidence: 8/10) `src/hosted/local/migrations/index.ts:10` `LOCAL_FORMAT_VERSION = CURRENT_STORE_SNAPSHOT_VERSION`:
   a new `UserRecord.trialPrompt` changes the local store snapshot; the format-fingerprint test will demand a step.
   **D15 (accepted):** local format 4 → 5 migration setting `trialPrompt: null` (MUT-366's 3 → 4 precedent).
3. [P3] (confidence: 8/10) `server/src/records-file/export.ts:30` builds a full `UserRecord` for the records file:
   it must set `trialPrompt: null` (a hosted preference never travels into local mode), not copy it.
4. [P2] (confidence: 7/10) Optimistic `ME_KEY` update vs an in-flight `/v1/me` refetch could re-show the step in the
   same page load; the opener's once-per-page-load ref (D6) plus `cancelQueries(ME_KEY)` before the optimistic write closes it.
5. [P3] (confidence: 7/10) QA: `billing-live.mjs` signups share one loopback IP; the 10/h per-IP budget breaks reruns.
   Signup goes straight to the API with `TRUSTED_PROXY_HOPS=1` and a per-test `X-Forwarded-For` (MUT-368's approach).
6. [P3] (confidence: 7/10) PostHog events at the very first sign-in are almost never sent (nobody has opted in yet,
   ADR-090). Covered by D2 (answer stored server-side). **D16 (accepted):** no consent shortcut; documented in events.json.

Architecture: the PATCH lives beside `PATCH /v1/me/malafat-suggestions` in `routes/sessions.ts` (org-independent list),
same CSRF/session guards; enum body; no audit, no Idempotency-Key (idempotent by construction). Failure mode: PATCH
fails → the step can come back on the next load (fails toward asking once more, never toward charging). No critical gaps.
Code quality: one `isConsumerCountry` helper server-side, mirrored once in `billingView.ts`. No issues beyond the above.
Tests: §6 covers every branch; add the format-5 migration test and the HomeRedirect overlay test. Performance:
`/v1/me` reads a column already loaded; banner adds one cached `/v1/billing` per 30 s for trial users only. No issues.
Outside voice: unavailable (no codex CLI on this machine); not run.

Failure modes: 0 critical gaps flagged.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (unavailable) | Independent 2nd opinion | 0 | unavailable | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (all mapped to D14–D16 and plan work) | 6 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex not installed; outside voice skipped.
- **VERDICT:** ENG reviewed; findings folded into the plan. Decisions D1–D16 pending Basel's confirmation (unattended run).

NO UNRESOLVED DECISIONS
