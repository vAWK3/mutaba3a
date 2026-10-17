# MUT-153 — Analytics ADR, event taxonomy and privacy promise

Epic: MUT-152 (opt-in, anonymous PostHog analytics). This task blocks MUT-154, 155, 156 and 157.
Status when planned: Backlog, no blockers. Planned 2026-10-17.

## 1. Problem

The README, SYSTEM_OVERVIEW, INFRA, CI_CD and the privacy policy all say Mutaba3a has no
analytics of any kind. Every PostHog story contradicts that until a decision is recorded
and a single event contract exists. The landing page, the portal and the phone app need one
list of event names and allowed properties to build against.

## 2. Decisions locked at planning (Basel, 2026-10-17)

| # | Decision | Effect on siblings |
|---|----------|--------------------|
| P1 | **Errors go to Sentry only** (epic MUT-146). PostHog carries no `$exception` and no exception autocapture. | Error criteria leave MUT-155/156/157 and the epic. Intake decision D2 is retired. |
| P2 | **Activation events fire from the phone app only.** It is the only surface where a person creates clients, income and payments; the portal is read-only for money. The server sends nothing to PostHog. Opt-in is per device; there is no server-side flag. | MUT-155 shrinks to `portal_opened` plus opt-in events. MUT-156 closes as Won't Do (its errors half is MUT-148). |
| P3 | **The public privacy policy changes with each surface.** MUT-153 writes the approved en + ar wording; MUT-154 and MUT-157 (and MUT-155) each publish their own paragraph with the feature, the same pattern as Sentry's MUT-150. | Each of those stories gains the criterion "privacy policy paragraph published (en + ar), Last updated date bumped". |
| P4 | **The "No tracking" claims in the hero and the privacy band stay.** They describe the free local app, which still sends nothing. The ADR defines tracking as following a person: a persistent identifier, cookies, or linking across sites or devices. Cookieless, aggregate visit counting is not tracking. | None. The README's "will never do" list is narrowed to the local app. |
| P5 | PostHog is on the **EU cloud** (`eu.posthog.com`), the same region as Sentry. Nothing sent carries firm data, so this is consistent with ADR-024's residency rule. | None. |

The intake decisions stand: D1 (landing cookieless, no banner) and D3 (random install ID
replaced on opt-out, no `identify()`, no replay, no autocapture, allow-listed events only, no
amounts, names, emails or free text; a currency code is allowed).

## 3. Scope

**In**
- A new ADR in `.claude/DECISIONS.md`, with an override log.
- `docs/analytics/README.md`, the human contract: rules, opt-in UX rules, per-surface
  emitters, and the approved privacy-policy and store-disclosure wording (en + ar).
- `docs/analytics/events.json`, the machine-readable contract the stories test against.
- `scripts/__tests__/analytics-taxonomy.test.ts`, which enforces the contract's own rules.
- Narrowed wording in README, SYSTEM_OVERVIEW, INFRA, CI_CD; CHANGELOG and TEST_PLAN entries.
- Creating the PostHog project "Mutaba3a" (only after Basel says go at build time), with its
  settings recorded in INFRA.

**Out**
- Any SDK code, environment variables or build config (the stories do these).
- The public privacy policy, landing copy and hero (P3, P4).
- The desktop surfaces (desktop is retired until v2; its Mac/Windows wording stays untouched).
- Any Sentry work.

## 4. Files

| File | Change |
|------|--------|
| `.claude/DECISIONS.md` | New ADR (take the next free number **at merge time**; ADR-089 has collided before, and a stray ADR-151 exists). |
| `docs/analytics/README.md` | New. |
| `docs/analytics/events.json` | New. |
| `scripts/__tests__/analytics-taxonomy.test.ts` | New (already inside Vitest's `scripts/**` include). |
| `README.md` | Lines 15, 24, 221: the local app has no analytics; the website counts visits without cookies; the phone app and hosted account ask first. Lists only what is true today, or worded "asks first", which holds before and after. |
| `.claude/SYSTEM_OVERVIEW.md` | Lines 14 and 324: scope "zero telemetry" to the local web app. |
| `.claude/INFRA.md` | §1's "no telemetry" line is scoped; a new PostHog row (project, region, settings, where each key is set). |
| `.claude/CI_CD.md` | Monitoring table: Analytics → PostHog, opt-in (MUT-152); Error tracking → Sentry (MUT-146). |
| `.claude/CHANGELOG.md`, `.claude/TEST_PLAN.md` | Entries. |

## 5. The ADR

Title: *Opt-in, anonymous product analytics on the landing page, the portal and the phone
app; the local app stays at zero telemetry.*

Contents:
- **Surfaces.** Landing is cookieless with no toggle (D1). The portal and the phone app send
  nothing until a person turns on "Share anonymous usage" (default off; asked once, then a
  Settings toggle). The local web app and desktop send nothing, ever (ADR-024 is
  **reaffirmed, not overridden**). The server sends nothing.
- **Anonymous.** D3, plus: no person profiles (`identify()` is never called), install ID
  stored on the device only, a new ID on every opt-in, IP discarded at ingestion
  (`anonymize_ips`).
- **Definition of tracking** (P4).
- **Errors** go to Sentry (P1).
- **Region and processor**: PostHog EU, project "Mutaba3a" in the Barmajiyat org, separate
  from Malafat's project 125127.
- **Kill switch**: a build or app with no key sends nothing and throws nothing.
- **Override log**: what it replaces — SYSTEM_OVERVIEW "no telemetry, analytics or tracking
  of any kind", CI_CD "Analytics: intentionally none", the README promise, and the privacy
  policy's `noTracking` paragraph (replaced surface by surface, P3). Why: funnel numbers are
  needed for roadmap decisions (epic MUT-152). Date.

## 6. Event contract (`events.json`)

Shape: `{ version, sharedProperties: {...}, events: { <name>: { emitters: [...], properties: {...}, description } } }`.
Property types: `enum` (with `values`), `boolean`, `integer`, `iso4217` (currency code). There is no
free `string` type, so free text cannot be declared.

Shared properties: `surface` ∈ {landing, portal, ios, android}, `app_version`, `locale` ∈ {ar, en, he}.

| Event | Emitters | Properties |
|-------|----------|------------|
| `$pageview` | landing | (PostHog's own; UTM, referrer and GeoIP country come from the SDK) |
| `landing_cta_clicked` | landing | `cta` ∈ {app_store, play_store, open_web_app, hosted_offer, malafat} |
| `app_first_opened` | ios, android | — |
| `portal_opened` | portal | — |
| `analytics_opted_in` | portal, ios, android | `prompt` ∈ {first_run, settings} |
| `analytics_opted_out` | portal, ios, android | — (the last event before the ID is dropped) |
| `client_created` | ios, android | — |
| `income_recorded` | ios, android | `currency` (iso4217), `paid` (boolean) |
| `expense_recorded` | ios, android | `currency` (iso4217) |
| `payment_recorded` | ios, android | `currency` (iso4217) |

Phone events fire on the **local save** (before upload), so offline entries count when they
are made. At build time, confirm each one maps to a real save point in the Flutter app
(`presentation/screens/capture`, `data/repositories/customers_repository.dart`,
`domain/services/outbox_uploader.dart`). If the phone does not create clients, drop
`client_created` and record why.

## 7. Tests (written first)

`scripts/__tests__/analytics-taxonomy.test.ts` checks that:
1. Every event name is snake_case or a PostHog `$` built-in from an allowlist (`$pageview` only).
2. Every event has at least one emitter, and every emitter is one of the four surfaces.
3. No property name matches the banned list (amount, price, total, sum, name, email, phone,
   note, description, title, text, message, client, customer, id). The install ID is not an
   event property.
4. Every property type is one of the four allowed types, and every `enum` has values.
5. `$exception` and anything containing `error` or `exception` is absent (P1).
6. No event lists `server`, `web` or `desktop` as an emitter (P2, ADR-024).
7. Shared properties exist and are typed.

Run: `nvm use 22 && npx vitest run scripts/__tests__/analytics-taxonomy.test.ts`, then the
full gate: `npm run lint && npm run typecheck && npm run test:run && npm run build`.

Release QA: **not applicable.** No user-visible flow changes (docs and contract only). Each
surface story carries its own QA scenarios.

## 8. PostHog project (outward action, needs Basel's go at build time)

Created through the PostHog MCP (`project-create`) in the Barmajiyat org (EU). Settings,
confirmed against PostHog's skills before setting them:
- `anonymize_ips` on
- autocapture off; exception autocapture off; web vitals off; heatmaps off; dead clicks off
- session recording off; console log capture off; surveys off
- cookieless server hash mode on (required for posthog-js `cookieless_mode: 'always'`, D1)
- the test-account filter excludes localhost

INFRA records the project id, region, settings, and where each key is set: Netlify env for
landing, hosted build env for the portal, `--dart-define` for Flutter. The `phc_` key is a
public ingest key, but it still lives in env and is never committed.
IaC note: PostHog config is operator-defined SaaS, the same as Netlify Forms (INFRA §1). It is
recorded in INFRA rather than Terraform; Terraform covers GCP only (ADR-026).

## 9. Ticket changes this plan causes

- MUT-153: the AC "README, landing copy and privacy policy say the same thing" becomes
  "README and internal docs now; approved policy wording in `docs/analytics/README.md`". The
  taxonomy loses `$exception`.
- MUT-154 and MUT-157: + "privacy policy paragraph published (en + ar) with the feature".
- MUT-155: activation and error criteria removed; `portal_opened` + opt-in; no server-side
  flag; + policy paragraph.
- MUT-156: Won't Do (errors → MUT-148; activation → phone).
- MUT-152 (epic): errors out of scope; dashboard = acquisition + activation only; D2 retired.
- MUT-157: crash reporting removed (→ MUT-151).

## 10. Business / product impact

- Gives the stories one contract to build the acquisition and activation funnels against,
  without breaking the "your data stays on your device" promise the free app is sold on.
- Unblocks MUT-154/155/157 (epic MUT-152), and removes a duplicate error pipeline against
  Sentry (MUT-146).
- Low risk: it ships no code. The real risk it guards against is a privacy policy that says
  something untrue, which this plan prevents by publishing each paragraph with its feature.

---

# Eng review (/plan-eng-review, 2026-10-17)

Target: `.claude/designs/mut-153-analytics-adr-taxonomy.md` (sections 1–10 above are the original plan, unchanged).

## Scope record

feature answers: none proposed (no cuts); structure: A "Original arrangement" (D1, answered 2026-10-17); accepted scope: the 10 files in §4 including `docs/analytics/README.md`; pending remedies: R2, R3, R4, R5, R6.
Scope Challenge result: scope accepted as-is.

## Findings

| # | Sev | Conf | Where | Finding | Route |
|---|-----|------|-------|---------|-------|
| F1 | P2 | 9/10 | §6 "Phone events fire on the local save"; §3 "the stories test against" | events.json lives in mini-crm, but 6 of its 9 non-landing events are emitted from the Flutter repo, which can't read mini-crm files. Nothing keeps the phone's event names in step with the contract. Existing precedent: Flutter `test/fixtures/brand/README.md` keeps byte-identical copies plus a sha256 table plus a parity test. | R2 |
| F2 | P2 | 9/10 | §8 "recorded in INFRA rather than Terraform" | CLAUDE.md absolute rule 7 says "Never create infra manually". The PostHog Terraform provider exists (registry PostHog/posthog), but the docs only show dashboards and insights; whether it can manage projects is unverified. The Netlify Forms operator steps in INFRA §1 are the precedent for manual SaaS setup. | R3 |
| F3 | P3 | 8/10 | §6 table rows `app_first_opened` and `analytics_opted_in` | Nothing is sent before opt-in (D3), so `app_first_opened` can only fire after `analytics_opted_in {prompt: first_run}`, at the same moment. The two events say the same thing. | R4 |
| F4 | P2 | 7/10 | §6 "`analytics_opted_out` … the last event before the ID is dropped" | Sending an event in response to someone turning analytics off contradicts "nothing is sent unless you turn it on" (D3, epic MUT-152). | R5 |
| F5 | P3 | 8/10 | §3 README.md "the human contract … per-surface emitters" vs §6 events.json | The event table would live in both files and drift apart. | R6 |
| F6 | P2 | 9/10 | §7 test 3 "No property name matches the banned list (… id)" | Matching substrings bans the plan's own `paid` property (`pa`**`id`**). **Factual correction, no question:** match whole snake_case tokens (`paid` → [paid]; `client_id` → [client, id]). This keeps the intended behavior. | corrected |
| F7 | P3 | 8/10 | §4 README row "worded 'asks first', which holds before and after" | This contradicts locked decision P3 ("never ahead of reality"): "asks first" describes a toggle that doesn't exist yet. **Correction, no question (cites P3):** README now says only that the local app has no analytics, trackers or crash reporting. Each surface story adds its own README line. | corrected |
| F8 | P2 | 6/10 | §6 `$pageview` "GeoIP country come from the SDK" | Medium confidence; verify this is actually an issue. Open PostHog issue #48660 (EU Cloud, 2026-02-21) reports `$ip` is null on every `cookieless_mode: 'always'` event, so GeoIP country is always empty. The "Discard client IP data" setting alone keeps GeoIP. **Factual record, no question for MUT-153:** the ADR lists country as unavailable on the landing page while #48660 is open. MUT-154's planning owns any workaround (for example, a coarse country from Netlify's edge geo). | recorded, carried to MUT-154 |

## Decision ledger

### R2: How the Flutter repo stays in step with events.json
Finding: F1, P2, 9/10, §6, native reviewer
Plan baseline: original proposal: events.json in mini-crm; no sync mechanism named
Runtime evidence: Flutter `test/fixtures/brand/README.md` vendors mini-crm JSON byte-identical with a sha256 table and a parity test (MUT-105, MUT-204)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 sync | none | vendored copy + sha256 + parity test in Flutter (MUT-157 owns it); events.json carries `version` | no mechanism; MUT-157 reads the doc by hand |
| R3..R6 | pending | pending | pending |
Question D2: Flutter repo keeps a byte-identical copy (existing brand-fixture pattern) vs no mechanism
Header: Flutter sync
Options:
A) Vendored copy (recommended)
B) No mechanism
State: approved
Actual answer: A) Vendored copy, D2 answered 2026-10-17
Accepted scope: events.json gets a `version` field; MUT-157 vendors a byte-identical copy into Flutter test/fixtures with a sha256 row and a parity test of the Dart event constants (brand-fixture pattern).
History: none

### R3: Where the PostHog project's configuration lives
Finding: F2, P2, 9/10, §8, native reviewer
Plan baseline: original proposal: created via PostHog MCP `project-create`, settings recorded in INFRA
Runtime evidence: Terraform provider PostHog/posthog exists; project resource support unverified; Netlify Forms precedent (INFRA §1)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 config | MCP + INFRA | MCP + INFRA, plus a TODO to move dashboards/settings to the provider if it supports them | Terraform provider now (new provider, a personal API key secret, a state location) |
Question D3: MCP-created and documented in INFRA vs Terraform now
Header: PH config
Options:
A) MCP + INFRA + TODO (recommended)
B) Terraform now
State: approved
Actual answer: A) MCP + INFRA + TODO, D3 answered 2026-10-17
Accepted scope: Create the project via the PostHog MCP after Basel says go at build time; record id, region and every setting in INFRA.md; add a TODOS.md entry to move settings and dashboards to the PostHog Terraform provider once project support is confirmed.
History: none

### R4: app_first_opened
Finding: F3, P3, 8/10, §6, native reviewer
Plan baseline: original proposal: app_first_opened for ios and android
Runtime evidence: n/a (proposed)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 | keep | drop; the funnel starts at analytics_opted_in {prompt} | keep both |
Question D4: drop app_first_opened vs keep
Header: First open
Options:
A) Drop it (recommended)
B) Keep it
State: approved
Actual answer: B) Keep it, D4 answered 2026-10-17 (against recommendation)
Accepted scope: Keep app_first_opened for ios and android, fired once right after the first opt-in.
History: none

### R5: Event on opt-out
Finding: F4, P2, 7/10, §6, native reviewer
Plan baseline: original proposal: analytics_opted_out sent, then the ID is dropped
Runtime evidence: n/a (proposed)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 | send event | send nothing; drop the ID at once | send one final analytics_opted_out |
Question D5: no event on opt-out vs one final event
Header: Opt-out
Options:
A) Send nothing (recommended)
B) One final event
State: approved
Actual answer: B) One final event, D5 answered 2026-10-17 (against recommendation)
Accepted scope: Keep analytics_opted_out: one final event, then the install ID is deleted. The approved policy and store wording in docs/analytics/README.md must say a last note is sent when analytics is turned off.
History: none

### R6: The event table in docs/analytics/README.md
Finding: F5, P3, 8/10, §3/§6, native reviewer
Plan baseline: original proposal: README restates per-surface emitters
Runtime evidence: n/a (proposed)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R6 | table in both | README links to events.json; no copied table | keep both; the taxonomy test checks every event name appears in README |
Question D6: link-only vs duplicate + cross-check test
Header: README table
Options:
A) Link only (recommended)
B) Duplicate + test
State: approved
Actual answer: A) Link only, D6 answered 2026-10-17
Accepted scope: docs/analytics/README.md links to events.json and has no copied event table; every event in events.json carries a description.
History: none

Approval readiness: PASS — R2 (D2 A), R3 (D3 A), R4 (D4 B), R5 (D5 B), R6 (D6 A); F6, F7 and F8 are corrections or records that cite the plan or P3, not new behavior.

## Amended plan (what /eng-build implements)

Changes to sections 1–10 above, all approved:
1. **events.json** gains a top-level `version` (semver, starting at `1.0.0`) (R2). Every event has a `description`. The README has no copied table (R6).
2. **Event list** (R4, R5): it stays as §6 lists it, including `app_first_opened` (ios, android, fired once right after the first opt-in) and `analytics_opted_out` (portal, ios, android; one final event, then the install ID is deleted).
3. **Policy and store wording** in `docs/analytics/README.md` (en + ar) says: off unless you turn it on; one last note is sent when you turn it off; then the device's random ID is deleted (R5).
4. **README.md** only narrows to "the local app has no analytics, trackers or crash reporting". Each surface story adds its own line when it ships (F7, P3).
5. **ADR** records: country is unavailable on the landing page while PostHog #48660 is open (F8); the vendored-copy rule for Flutter (R2); and MCP-created config documented in INFRA (R3).
6. **TODOS.md** gets one entry: move the PostHog project settings and dashboards to the PostHog Terraform provider once it is confirmed to manage projects (R3).
7. **Test case 3** matches banned names by whole snake_case token, not substring (F6).
8. **Carried to siblings** (eng-ticket step 5): MUT-157 owns the vendored copy and parity test (R2); MUT-154 owns the country workaround decision (F8).

## Test review

Framework: Vitest (`vitest.config.ts` includes `scripts/**/*.{test,spec}.ts`), Node 22 (TD-054).

```
CODE PATHS (proposed)                                   CONTRACT RULES
[+] docs/analytics/events.json                          [+] analytics-taxonomy.test.ts
  ├── version (semver)              [GAP→T] case 8        ├── [GAP→T] snake_case or allowlisted $ name (1)
  ├── sharedProperties              [GAP→T] case 7        ├── [GAP→T] ≥1 emitter, emitter ∈ 4 surfaces (2)
  └── events.<name>                                       ├── [GAP→T] banned tokens, by whole token (3)
      ├── emitters[]                [GAP→T] cases 2, 6    │     edge: `paid` allowed, `client_id` rejected
      ├── properties.<p>.type       [GAP→T] case 4        ├── [GAP→T] type ∈ {enum, boolean, integer, iso4217}; enum has values (4)
      │     edge: enum with [] values → fail               ├── [GAP→T] no $exception / *error* / *exception* (5, P1)
      └── description               [GAP→T] case 9        ├── [GAP→T] no server/web/desktop emitter (6, P2)
                                                          ├── [GAP→T] version is semver (8, R2)
                                                          └── [GAP→T] every event has a non-empty description (9, R6)
USER FLOWS: none. Docs and contract only; release-QA not applicable.
COVERAGE: 0/9 today (all proposed), 9/9 after build | QUALITY target ★★★ (each rule has a passing fixture and a failing fixture)
```

Value cards:
- Case 3. Value: protects=no event property can carry an amount, name, email or ID; fails_when=someone adds `client_name` or `amount_minor`; why_new=no contract exists today; seam=none
- Case 5. Value: protects=errors stay in Sentry (P1); fails_when=someone adds `$exception` to PostHog; why_new=no contract exists; seam=none
- Case 6. Value: protects=ADR-024 local app and P2 (no server events); fails_when=a `web`, `desktop` or `server` emitter is added; why_new=no contract exists; seam=none
- Case 8. Value: protects=the Flutter copy's version check (R2); fails_when=version is removed or malformed; why_new=no contract exists; seam=none

Each case runs on the real events.json, plus one table-driven block of bad fixtures (inline objects) that prove the rule rejects them. The validator is a local function inside the test file, so no production seam is added.
Tests to retire: none.

## Performance review

No issues found. Nothing ships at runtime. Event volume (cost) belongs to the surface stories; PostHog's free tier covers 1M events a month, and anonymous events need no person profiles.

## Outside voice

Unavailable: the Codex CLI isn't installed, and this session has no TaskOutput tool for the native fallback. There is no outside coverage, so this review cannot be counted as clean.

## NOT in scope
- SDK code, environment variables, bundle rules: MUT-154, 155 and 157.
- Public privacy policy and landing copy: published with each surface (P3).
- The landing country workaround for PostHog #48660: MUT-154.
- Moving PostHog config to Terraform: a TODO (R3).
- Sentry anything: MUT-146.

## What already exists
- The Flutter vendored-fixture pattern (`mutaba3a-flutter/mutaba3a/test/fixtures/brand/README.md`), reused for R2.
- Operator-step documentation for SaaS (INFRA §1, Netlify Forms), reused for R3.
- The Vitest `scripts/__tests__/` home for repo-contract tests (for example `check-bundles.test.ts`), reused for the taxonomy test.
- The PostHog org on the EU cloud (`eu.posthog.com`) with Malafat's project 125127; the new project sits beside it.

## Failure modes
| Path | Realistic failure | Covered by | Visible? |
|---|---|---|---|
| events.json edited later | a free-text or amount property is added | test cases 3 and 4 | CI fails |
| Flutter drift | an event is renamed here, the phone keeps the old name | R2 parity test (MUT-157) | Flutter CI fails |
| Project settings | cookieless hash mode left off, so landing events are silently dropped | INFRA row plus an MUT-154 check of ingestion warnings | silent until checked; INFRA lists it as a required setting |
| ADR number | collides with a parallel branch (ADR-089 precedent) | take the number at merge time | merge review |
Critical gaps: 0. The cookieless-mode drop is silent, but it is MUT-154's path and is listed in INFRA as a required setting.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity (one docs module, one test file).

## Implementation Tasks
- [ ] **T1 (P1, human: ~2h / CC: ~10min)** — test — Write analytics-taxonomy.test.ts first (cases 1–9, token matching)
  - Surfaced by: Test review, F6
  - Files: scripts/__tests__/analytics-taxonomy.test.ts
  - Verify: `npx vitest run scripts/__tests__/analytics-taxonomy.test.ts` (red, then green)
- [ ] **T2 (P1, human: ~2h / CC: ~10min)** — contract — Write docs/analytics/events.json with version and descriptions
  - Surfaced by: R2, R4, R5, R6
  - Files: docs/analytics/events.json
  - Verify: T1 green
- [ ] **T3 (P1, human: ~3h / CC: ~15min)** — docs — docs/analytics/README.md (rules, opt-in UX, en+ar policy and store wording including the last-note sentence; links to events.json)
  - Surfaced by: D1, R5, R6
  - Files: docs/analytics/README.md
  - Verify: Basel reviews the Arabic
- [ ] **T4 (P1, human: ~2h / CC: ~10min)** — ADR — New ADR (number taken at merge) with override log, #48660 note, R2/R3 rules
  - Surfaced by: F8, R2, R3
  - Files: .claude/DECISIONS.md
  - Verify: `grep -c "^## ADR-<n>" .claude/DECISIONS.md` = 1
- [ ] **T5 (P2, human: ~1h / CC: ~5min)** — docs — Narrow README, SYSTEM_OVERVIEW, INFRA, CI_CD; add TODOS entry; update CHANGELOG and TEST_PLAN
  - Surfaced by: F7, R3
  - Files: README.md, .claude/SYSTEM_OVERVIEW.md, .claude/INFRA.md, .claude/CI_CD.md, TODOS.md, .claude/CHANGELOG.md, .claude/TEST_PLAN.md
  - Verify: full gate under Node 22
- [ ] **T6 (P2, human: ~30min / CC: ~5min)** — PostHog — After Basel says go, create the "Mutaba3a" project via MCP with the §8 settings; record its id in INFRA
  - Surfaced by: R3
  - Files: .claude/INFRA.md
  - Verify: `project-get` on the new id shows the settings

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Architecture Review: 5 issues found (F1, F2, F3, F4, F8)
- Code Quality Review: 2 issues found (F5, F7)
- Test Review: diagram produced, 1 gap identified (F6) + 9 proposed cases
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item (approved in D3)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; no TaskOutput for native fallback)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 2/3 (D2 picked the higher score, D6 a tie; D3 picked 8/10 over 9/10)

## Pre-landing review (/qa-reconcile + /review, 2026-10-17)

The shipped `events.json` (1.1.0) supersedes §6 above:
- `locale` is {ar, en}: no Hebrew UI exists.
- `currency` (the app's four codes) replaces `iso4217`.
- `semver` is allowed only on `app_version`.
- Country is unavailable (GeoIP is off).
- Portal emits income, expense and payment events.
- `client_created` fires on the server-confirmed create.

**Re-decided with Basel (the original answers came from a false premise or a gap):**

| ID | Finding (reviewer) | Answer |
|----|--------------------|--------|
| P2' | The portal records income and payments (MUT-133) and saves expenses; the plan said it was read-only for money. My statement was wrong: it came from stale memory plus a grep that silently failed on a zsh glob (red-team, verified) | Phone + portal emit activation; the server still sends nothing (MUT-156 stays closed) |
| C1 | Opt-in and ID carried across sign-out on shared devices (red-team) | Reset on sign-out or account switch; nothing sent |
| G1 | The GeoIP transformation was on by default and would add city and coordinates (adversarial, verified via MCP) | Disabled in project 304889; ADR says no location |
| A1 | Malafat org members could read the project (adversarial) | Restrict it. The MCP can't, so it's an operator step for Basel (INFRA §1) |
| T1–T5 | Test holes: single-token rows, integer money names, failure events, loose types, no version pin (testing specialist) | All five applied (113 cases) |

**Auto-fixed** (mechanical, or follows an approved decision): the rest of the docs findings. The list:
- **Rules (`docs/analytics/README.md`):**
  - SDK `$` URL, path, referrer and screen props dropped on portal and phone (security);
  - portal `persistence: 'localStorage'` (security);
  - the guard is required, not just recommended;
  - no SDK init before consent;
  - the opt-out order;
  - `reset(true)` / `$device_id` rotation;
  - SDK auto-events off (`$pageleave`, `$opt_in`, `$screen`, lifecycle, flags, remote config);
  - no `alias`/`group`/super properties;
  - no joining with account data;
  - production-only keys (Netlify production context);
  - the landing SDK starts only in lazy chunks, never `LandingProviders`/`main.tsx`;
  - the `/app` referrer is dropped (red-team, adversarial).
- **Wording (en + ar):**
  - "free apps on Mac, Windows and in the browser, which need no account" replaces the ambiguous "browser apps";
  - the portal is added to the policy intro;
  - `scope.body`'s "one thing our website can send" is replaced (MUT-154);
  - the crash-reporting clause is kept in the `noTracking` replacement;
  - "never send what you enter" is narrowed to amounts, names, notes, contact details, location and typed text;
  - the landing claim becomes "different days can't be linked";
  - the phone note lists the shared properties and says "when you first turn it on";
  - the portal and phone sentences add sign-out reset;
  - Sentry coordination notes for `network` and `sharing`;
  - one Arabic label for the toggle and the turn-on button;
  - "no one but PostHog, which processes them for us";
  - the repo README says the free app instead of "the app on your device";
  - the "Who sends" table no longer names events (D6).
- **Store disclosures:** Apple Identifiers › Device ID and Play Device or other IDs added.
- **Contract:** shared properties apply to every event, `$pageview` included, and the landing's `app_version` is the web build version.

**Open for Basel:** retention period; whether Apple "Other Financial Info" is declared; project access control in the UI.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (auto, plan-review) | Independent 2nd opinion | 1 | unavailable | CLI not installed; no native fallback tool |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (all resolved into the amended plan) | 8 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable; no findings, no clean credit.
- **VERDICT:** no review CLEAR. Eng review ran with 8 findings, all resolved into the amended plan; eng review required (status issues_open because findings were found).
NO UNRESOLVED DECISIONS
