# MUT-150: the landing pages report errors to Sentry, and the privacy policy says so

Epic MUT-146 · blocked by MUT-147 (merged and applied) · precedent: MUT-149 (`.claude/designs/mut-149-portal-sentry.md`)
Basel, 2026-10-24: build it as specced; add `/terms`; upload source maps; Basel sets the Netlify env vars.

## 1. Context

`dist-web` serves both the marketing pages and the local-first app at `/app` (ADR-024: the app sends no telemetry).
- The marketing pages are `/`, `/download`, `/privacy` and `/terms` (with `/terms/<version>`).
- `src/main.tsx` routes them outside the router, through `marketingPath()`, into lazy chunks wrapped in `LandingProviders`.
- PostHog already follows the "landing only, lazy, never precached" pattern: `landingAnalytics.ts` (MUT-154, ADR-090), `POSTHOG_PRECACHE_IGNORES`, and `checkPosthog` in check-bundles.

What already exists and gets reused:
- **Contract:** `browserSentryOptions('landing', …)` (`src/lib/observability/browserSentry.ts`) and `scrubEvent`. The contract already has a `landing` surface: `sentry-rules.ts` lists landing fields, and the fixtures cover landing.
- **Terraform:** project `mutaba3a-landing`, whose DSN `allowed_domains` come from `config/hosts.json` (new and legacy landing origins).
- **check-bundles:** `SENTRY_MARKER`, `sentryInEntryGraph`, `sentrySecrets`, and the source-map check.
- **QA:** `qa/support/sentry.ts` (`crashReports` spy) and `QA_SENTRY_DSN`.
- **Privacy text:** the en and ar wording for this ticket is already written in `docs/observability/README.md` § "Landing page (MUT-150)".

## 2. Design

### D1: Load and gate (AC1)
- Add `src/pages/landing/observability/landingErrorReporting.ts`, a small gate with no SDK in it.
- `main.tsx` calls `startLandingErrorReporting()` **only inside the marketing branch**, before the landing page renders. App routes, including `/app` reached from "Open the web app" (a full navigation), never call it. The gate is one `if` that the desktop build tree-shakes away through `__BUILD_MODE__ === "web"`.
- **Before the SDK arrives**, the gate listens for `error` and `unhandledrejection` events and holds up to 10. It ignores "Script error." events that carry no error object.
- **Loading the SDK:** after `load` + idle, it dynamically imports `landingSentry.ts`, using the same `whenIdle` timing as PostHog so first paint carries no Sentry. It then hands over the held errors, and from that point the SDK's own handlers take over.
- **Reporting React crashes:** the marketing branch wraps its `Suspense` in `<ErrorBoundary onError={reportLandingCrash}>`. The existing `ErrorBoundary` already takes `onError`, so the fallback UI doesn't change.
- If the chunk fails to load (ad blocker, stale tab after a deploy), it reports nothing and never throws.
- I'm not extracting a queue shared with the portal gate. The portal's gate is tied to sign-in mode, user and stop, and the landing needs about 25 lines of hold/replay. Factoring them together would mean changing the portal's tested code for little gain.

### D2: The SDK chunk
- Add `src/pages/landing/observability/landingSentry.ts`, the only landing file that imports `@sentry/browser` (already a dependency).
- It calls `Sentry.init({...browserSentryOptions('landing', {dsn, release, environment, tags}), integrations})`. The integrations match the portal's: global handlers, breadcrumbs (fetch + history only; no DOM, console or xhr), linked errors, dedupe, http context.
- **No user context, ever** (AC2), plus no tracing, no replay, no feedback, and nothing stored in cookies or localStorage. The SDK's `dataCollection` comes from the contract.
- Tags: `locale` (`<html lang>`) and `route`, a template: `/`, `/download`, `/privacy`, `/terms` or `/terms/:version`, never a query string. `app_build` is the app version.
- The ESLint import boundary from MUT-149 gets this file added to the allowed `@sentry/browser` importers.

### D3: DSN, release, environment (web build only)
- Generalize `vite.config.ts` `hostedSentry()` into `buildSentry(surface, env, mapsGlob)`, which the portal and the web build both call. This is the DRY step. The portal keeps its env names, project and behavior, and its tests stay green.
- Web build env:
  - `MUTABA3A_LANDING_SENTRY_DSN`, validated by the same EU ingest-host check (`sentryDsn`, which gets a name parameter for the error message).
  - Release: `mutaba3a-landing@<pkg.version>+<COMMIT_REF:7>`. Netlify sets `COMMIT_REF`. Without it, the release is `mutaba3a-landing@<pkg.version>`.
  - Environment: Netlify `CONTEXT` (`production`), or `development`.
- The defines are `__LANDING_SENTRY_ENABLED__` (in the gate) and the `__LANDING_SENTRY_{DSN,RELEASE,ENVIRONMENT}__` values, which only `landingSentry.ts` reads. That keeps the DSN host out of the entry chunk.
- **The desktop build is always `false` or `""`.**
- **Naming change:** the README tells Basel to set `VITE_SENTRY_DSN`. I'll change it to `MUTABA3A_LANDING_SENTRY_DSN`, which matches the repo's convention (`MUTABA3A_POSTHOG_KEY`, `MUTABA3A_SENTRY_DSN`) and keeps away from Vite's `VITE_` auto-exposure.

### D4: Source maps (AC5)
- When the DSN and `SENTRY_AUTH_TOKEN` are both set, the web build uses `sourcemap: "hidden"`. `sentryVitePlugin` uploads the maps to project `mutaba3a-landing` (EU API), then deletes `dist-web/**/*.map`. A failed upload fails the build.
- A Netlify **production** build that has a DSN but no token fails, so a release never quietly ships without readable stacks. Deploy previews and branch builds get no DSN (it's set in the Production context only), so the feature compiles out and nothing is uploaded.
- The whole `dist-web` map set is uploaded, app chunks included, because landing stacks pass through the shared `index`/`vendor-react` chunks. Maps contain code, not data, and are deleted before publish.

### D5: CSP (AC3): nothing to change
- The landing serves **no CSP**: there's no `_headers` and no `[[headers]]` in `netlify.toml`, and a live `curl -I https://mtb3a.com` shows none. Nothing blocks the ingest host.
- Adding a landing CSP is new scope that could break PostHog, fonts or Netlify Forms, so it's out of scope here and goes to a follow-up if wanted.
- The ticket's AC is recorded as "N/A: no CSP on Netlify", and that's noted on the ticket.

### D6: Bundle guards (AC1, extends MUT-149's checks)
- **`checkSentry`, per dist:**
  - `dist-desktop`: still fails on any `SENTRY_MARKER`.
  - `dist-web`: the SDK is allowed **only** in the lazy landing Sentry chunk (named `vendor-sentry` through manualChunks, plus `landingSentry-*`). It may never be statically reachable from `index.html` (`sentryInEntryGraph`), and never precached (a new `sentryPrecached`, the twin of `posthogPrecached`).
- **The PWA's `globIgnores`** gain `SENTRY_PRECACHE_IGNORES`, so the service worker installed for local-app users never stores Sentry.
- **TD-084 (partial):** `netlify.toml` `command` becomes `npm run build:web && tsx scripts/check-bundles.ts --dist dist-web`, so Netlify runs the guard for the landing too. This depends on check-bundles' per-dist mode from MUT-149.

### D7: Privacy policy (AC4)
- Update `landing.json` en and ar:
  - `errorReports` and `network.body` get the README's MUT-150 sentences.
  - `noTracking.body` adds the website to its list, and keeps saying **the free web app never sends reports**.
  - `updated` is bumped.
- `PrivacyPolicyPage.test.tsx` asserts the new sentences in both languages.
- I'll check whether the terms manifest or the privacy version must bump, using MUT-324's frozen versions rules (that applies only to terms, but I'll verify).

### D8: Docs and knowledge files
- ADR-091 amendment 12 (the next free number; checked at merge).
- README: the env names and § "Landing page", marked published.
- INFRA "Error reporting": landing turned on.
- `server/DEPLOYMENT.md` §1.5: the Netlify steps.
- `docs/operations/before-release.md`: Basel's Netlify env vars, and a landing smoke after `make release web`.
- CHANGELOG, COMPONENT_REGISTRY, PATTERNS (the "landing-only lazy chunk" pattern now has two users), TEST_PLAN, TECH_DEBT (TD-084 note).

## 3. Files

| New | Purpose |
|---|---|
| `src/pages/landing/observability/landingErrorReporting.ts` (+ test) | gate, early queue, idle load, boundary report |
| `src/pages/landing/observability/landingSentry.ts` (+ test) | the SDK chunk; init through `browserSentryOptions('landing')` |
| `qa/features/web/error-reports.yaml`, `qa/specs/web/error-reports.spec.ts` | release-QA |

| Touched | Change |
|---|---|
| `src/main.tsx` | the gate starts in the marketing branch; `ErrorBoundary onError` around landing `Suspense` |
| `vite.config.ts` | `buildSentry()` shared by hosted + web; web defines, plugin, `vendor-sentry` chunk, precache ignores |
| `scripts/bundle-rules.ts`, `scripts/check-bundles.ts` (+ tests) | dist-web Sentry allowed lazy-only, never precached |
| `scripts/__tests__/vite-config.test.ts` | web DSN, release, environment, the production-without-token failure, desktop always off |
| `eslint.config.js` | `@sentry/browser` import allowed in `landingSentry.ts` |
| `netlify.toml` | build command runs check-bundles on dist-web |
| `src/lib/i18n/translations/{en,ar}/landing.json`, `PrivacyPolicyPage.test.tsx` | privacy text |
| `qa/qa.config.mjs` | web dev server gets `MUTABA3A_LANDING_SENTRY_DSN: QA_SENTRY_DSN` |
| `qa/features/web/legal.yaml`, `qa/specs/web/legal.spec.ts` | `privacy-error-reports` asserts the website sentence |
| docs and knowledge files | D8 |

## 4. Tests (TDD, written first)

- **Gate** (`landingErrorReporting.test.ts`):
  - Not started and nothing loaded when disabled.
  - Holds up to 10 errors before the chunk loads, then replays them in order.
  - Ignores error events with no error object.
  - A boundary crash before the chunk arrives is held and then sent once.
  - A failed chunk load clears the queue and throws nothing.
  - Starting twice does nothing.
  - The loader runs only after load + idle (fake timers).
- **Chunk** (`landingSentry.test.ts`): with a recording transport, an event carries `surface=landing`, a route template, no `user`, no query string in the URL, scrubbed values (a landing fixture case), and no console breadcrumbs.
- **vite-config:**
  - A web build without a DSN → disabled, no plugin.
  - A DSN off the EU ingest host → the build throws.
  - Release from `COMMIT_REF`; environment from `CONTEXT`.
  - `CONTEXT=production`, a DSN and no token → throws.
  - A desktop build is always disabled, even when the DSN env is set.
  - The portal's existing cases are unchanged.
- **check-bundles:**
  - dist-web with the SDK in a lazy chunk passes.
  - The SDK statically reachable from the entry → fail.
  - The SDK precached → fail.
  - dist-desktop with the SDK → fail.
  - A `.map` in dist-web → fail.
- **Privacy:** en and ar sentences present; `updated` bumped.
- **Gates (Node 22):** `npm run lint`, `typecheck`, `test:run`, `build`, `test:bundles` with `MUTABA3A_LANDING_SENTRY_DSN=$QA_SENTRY_DSN`, and `release-qa lint`.

## 5. QA scenarios (`qa/features/web/error-reports.yaml`, app `web`)

| id | tier | steps | expect |
|---|---|---|---|
| `landing-crash-reported` | full | Open the home page in English; something on the page throws an error nobody catches | Exactly one report: surface landing, route `/`, locale en, no user, no query string |
| `landing-crash-reported-ar` | full | Open /privacy in Arabic; an uncaught error | One report tagged locale ar, route `/privacy` |
| `app-routes-silent` | **core** | Open the home page, then /download; tap the link back to the web app (`<a href="/app">`, a full page load; eng F1); use the app (add an income); open /app directly in a fresh tab and throw an error | **Zero requests to any Sentry host** after leaving the landing, and none ever on a direct /app visit |
| `download-and-terms-covered` | full | Open /download and /terms/<version>; an uncaught error on each | One report each, routes `/download` and `/terms/:version` |

Plus the existing `web.legal.privacy-error-reports`, extended with the website sentence (en + ar).
Paths cover the two new files, `main.tsx`'s marketing branch and `landing.json`.

## 6. Scale and cost

- **Quota:** the free plan's ~5k errors/month are shared across 4 projects, with no per-key caps (TD-200). Spike protection, the 10/h spike alert and the inbound browser filters already apply to `mutaba3a-landing`.
- **Page cost:** the landing ships one lazy chunk of about 25 kB gzip (the portal's measured size), loaded at idle. First paint is unchanged.

## 7. Out of scope

- A CSP for the landing (D5).
- Netlify's own form-handler errors.
- Reports from the local app (ADR-024 stands; it would need an opt-in ticket).
- Capping the landing DSN's volume (TD-200).

## 8. Operator steps (Basel, after merge, before `make release web`)

1. `terraform -chdir=server/infrastructure/sentry output -json dsns` (admin token): copy the `landing` DSN.
2. Netlify › Site configuration › Environment variables, **Production context only**:
   - `MUTABA3A_LANDING_SENTRY_DSN` = that DSN;
   - `SENTRY_AUTH_TOKEN` = the `sntrys_` upload token (the same one as Keychain `barmajiyat/SENTRY_AUTH_TOKEN`), marked **Contains secret values**.
3. `make release web`. On the live `/`, run `setTimeout(() => { throw new Error('MUT-150 smoke') })` in the console. The issue appears in `mutaba3a-landing` with a readable stack. Then open `/app` and check the network tab shows nothing to `sentry.io`.
4. Record the date in INFRA's "Error reporting" row → MUT-150 Done.

---

# Eng review (plan-eng-review, 2026-10-24): target is this file (the MUT-150 plan)

## Scope Challenge

**What already exists, and how the plan uses it:**
- `browserSentryOptions` (src/lib/observability/browserSentry.ts:13 `BrowserSurface = 'portal' | 'landing'`): reused.
- `scrubEvent` and `SENTRY_RULES`: landing ignore list at sentry-rules.ts:178; `allowedUserKeys: ['id']` at :142. The landing never sets a user.
- The `ErrorBoundary` `onError` prop (ErrorBoundary.tsx:6): reused.
- `landingAnalytics.ts`'s `whenIdle`: the same idea. It is not exported, so the plan copies about 10 lines; extracting it is in the rubric below.
- check-bundles `--dist` (check-bundles.ts:53): exists.
- `crashReports` QA spy (qa/support/sentry.ts): reused.

**Minimum change:** the AC needs the gate, the chunk, the web defines and plugin, the bundle guards, the privacy text and QA.
- D6's Netlify `check-bundles` step goes beyond the AC. It is kept because AC1 ("zero requests on app routes") is otherwise only proven locally.

**Complexity:** about 15 changed files (estimated, from §3) and 2 new modules (gate, chunk). This trips the 8-file / 2-class gate.

**Search:** Aside is not probed. This uses Layer 1 knowledge, labelled as such:
- Netlify sets `CONTEXT` and `COMMIT_REF` at build time [Layer 1].
- `@sentry/vite-plugin` `filesToDeleteAfterUpload` with `sourcemap: "hidden"` is the documented pattern, and MUT-149 already does it [Layer 1].

**TODOS.md:** nothing blocks this ticket (grep for sentry/landing: no open item).

**Distribution:** the artifact is the Netlify web deploy (`make release web` → push → Netlify build). No new channel.

### Premise table

| premise | claim | receipt | verdict |
|---|---|---|---|
| P1 | The landing serves no CSP | `curl -sI https://mtb3a.com/`: `server: Netlify`, no CSP header; netlify.toml has no `[[headers]]`; public/ has no `_headers` | TRUE |
| P2 | "Open the web app" from the **home page** is a full navigation | LandingPage has no `/app` link; the only one is DownloadPage.tsx:179 `<a href="/app" …>`; WEB_APP_URL (download-config.ts:32) is unused in tsx | **FALSE as written**: the link lives on /download, but it is a plain anchor, so a full navigation. Fixed below (F1) |
| P3 | The contract has a landing surface | sentry-rules.ts:178 `landing: [` | TRUE |
| P4 | check-bundles has a per-dist mode | check-bundles.ts:53 `const distFlag = process.argv.indexOf('--dist')` | TRUE |
| P5 | The SW precaches every js not ignored | vite.config.ts `globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"]`, `globIgnores: [..., ...POSTHOG_PRECACHE_IGNORES]` | TRUE |
| P6 | The current check fails dist-web on any Sentry marker | check-bundles.ts:194 `if (dir !== 'dist-hosted' && sentryLeaks(text))` | TRUE (D6 changes it) |
| P7 | The landing ~25 kB chunk size | the portal's measurement, not re-measured | unverified [re-measure at build] |
| P8 | Netlify installs devDependencies (`tsx`) | not probed | unverified [verify on a deploy preview] |

unverified=2

### Reality rows
- REALITY: premise-table finding (P2 false, corrected as F1; 2 unverified) src/pages/download/DownloadPage.tsx:179
- REALITY: already-done pass (no MUT-150 commit on origin/main; last touch of main.tsx/vite.config/check-bundles was MUT-149/368) scripts/check-bundles.ts:53
- REALITY: surface-check finding (`tsx` on Netlify unverified, P8; `--dist dist-web` is valid, DISTS includes it) scripts/check-bundles.ts:56
- REALITY: binding-decisions pass (MUT-149 D2 cap-10 early queue and D4 shared browserSentryOptions followed; MUT-165 "landing chunk motion-free for LCP" respected by idle load) src/lib/observability/browserSentry.ts:13
- REALITY: numbers finding (25 kB estimated, 5k quota from INFRA, 10-event cap reused) .claude/INFRA.md:47
- REALITY: deferred-asks pass (all 5 MUT-150 ACs covered; the CSP AC is N/A per P1 and gets noted on the ticket) netlify.toml:1
- REALITY: pr-count pass (one branch, one merge to local main; no PR flow in this repo) netlify.toml:1

### Findings
1. **F1 [P2] (confidence 9/10)**, plan §5 `app-routes-silent` and D1. The QA step "Open the home page; tap Open the web app" can't work: there is no such link on `/` (P2). The real path is `/download` → `<a href="/app">` (DownloadPage.tsx:179), a full navigation. **Factual correction, no behavior change:** the scenario becomes "Open /download; tap Back to the web app…". Applied.
2. **F2 [P2] (confidence 8/10)**, plan D1, "App routes … never call it". Today that holds only because every way out of the landing is a full page load. A future client-side navigation (history.pushState into /app) would carry a live SDK into the local app and break ADR-024 with nothing to catch it. Remedy candidate: R1.
3. **F3 [P2] (confidence 7/10)**, plan §6 and TD-200. The landing is the one anonymous, crawlable, public surface on a shared 5k/month quota with no key caps. A crash loop on one visitor's page (an error thrown on every scroll or timer tick) only gets deduped when the errors are identical. Spike protection acts at the org level after the fact. Remedy candidate: R2.
4. **F4 [P3] (confidence 7/10)**, ErrorBoundary.tsx:51-58. The default fallback is English-only app copy ("Your data is safe") shown on the Arabic-default landing. It is outside MUT-150's AC (the landing crashed the same way before this ticket) and is offered as a TODO at the end.

## Decision ledger

### S1: structure (complexity gate)
Finding: complexity gate. About 15 files and 2 new modules (estimated, plan §3).
Plan baseline: the original arrangement in §3.
Runtime evidence: the smaller arrangement was examined:
- Folding the gate into the chunk breaks the boot-error queue: the gate must sit in the entry and the SDK must not. MUT-149 D2 is binding.
- Reusing the portal's `errorReporting.ts` gate drags its sign-in mode coupling (`currentMode`, `subscribeMode`) into the landing.

No smaller arrangement keeps the commitments.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| S1 arrangement | §3, 2 new modules | §3 unchanged | pause, investigate one gate shared with the portal |
| R1 path guard | pending | pending | pending |
| R2 per-page cap | pending | pending | pending |

Question D1: Confirm the original file arrangement (no smaller one keeps the boot-error queue)?
Header: Structure
Options:
A) Original arrangement (recommended)
The gate goes in main.tsx's marketing branch and the SDK in its own lazy chunk; about 15 files.
B) Pause to investigate a shared gate
Spend about 15 min (CC) checking whether one gate could serve the portal and the landing; leaves the arrangement undecided.
State: approved
Actual answer: A) Original arrangement (Basel, 2026-10-24, D1)
Accepted scope: the §3 arrangement unchanged: the gate in the main.tsx marketing branch plus the lazy landingSentry chunk
History: none

### R1: send-time guard that the page is still a marketing page
Finding: F2, P2, confidence 8, plan D1.
Plan baseline: the original proposal has no guard: app routes never start the gate.
Runtime evidence: every current exit from the landing is a full navigation (DownloadPage.tsx:179). No pushState call exists in src/pages/landing or src/pages/download (grep, no hits).
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1 | no guard | `dropEvent` drops any event when `marketingPath(location.pathname)` isn't a marketing page, and the gate's queue drops too; one unit test (pushState to /app, then throw: nothing sent) | no guard |
| S1, R2 | pending | pending | pending |

Question D2: Add a send-time check that drops a report unless the page is still a marketing page?
Header: Path guard
Options:
A) Add the guard (recommended)
About 5 lines and one test (CC ~5 min). If a future change navigates client-side into /app, nothing is sent, keeping ADR-024's no-telemetry promise.
B) No guard
Rely on every exit being a full page load today. Fewer lines, but a later refactor could leak with nothing catching it.
State: approved
Actual answer: A) Add the guard (Basel, 2026-10-24, D2)
Accepted scope: the landing dropEvent and the gate queue drop any event while marketingPath(location.pathname) is not /, /download, /privacy or /terms(/…); a unit test pushes /app in-page, throws, and asserts nothing is sent
History: none

### R2: per-page-load cap on landing reports
Finding: F3, P2, confidence 7, plan §6.
Plan baseline: the original proposal has no client cap; it relies on Sentry dedupe, spike protection and inbound filters.
Runtime evidence: the quota is 5k/month across 4 projects, with no key caps (INFRA "Cost guards", TD-200).
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R2 | no cap | `beforeSend` counter: at most 5 events per page load, then drop; one unit test | no cap |
| S1, R1 | pending | pending | pending |

Question D3: Cap landing reports at 5 per page load?
Header: Report cap
Options:
A) Cap at 5 per page load (recommended)
A crash loop on one visitor's tab can't drain the shared monthly quota and blind the API and portal. About 6 lines and a test (CC ~5 min).
B) No cap
Depend on dedupe and spike protection only. Simpler, but one bad tab can spend the quota every surface shares.
State: approved
Actual answer: A) Cap at 5 per page load (Basel, 2026-10-24, D3)
Accepted scope: a per-page-load counter in the landing's send path; events after the 5th are dropped (replayed early errors count); a unit test sends 7 and asserts 5 leave
History: none

Scope Challenge result: scope accepted as-is (S1=A; R1 and R2 add guarantees and remove nothing).

### R3: one Sentry build helper (shared-code)
Finding: Q1, P2, confidence 8, vite.config.ts:159 `function hostedSentry(env: NodeJS.ProcessEnv)`.
Callers: hostedConfig (:498, existing) and the web config (proposed, D3).
Estimated lines: impl removed ~0, added ~15 net helper params vs ~30 copied → saves ~25 [estimated].
Question D4. Options: A) One shared helper / B) Copy for the landing.
State: approved
Actual answer: A) One shared helper (Basel, 2026-10-24, D4)
Accepted scope: `hostedSentry` becomes `buildSentry(surface, env, mapsGlob)`. Portal env names, project `mutaba3a-web`, release prefix and behavior are unchanged. **Regression contract (CRITICAL):** every existing portal case in scripts/__tests__/vite-config.test.ts passes unmodified.

### R4: shared after-load-idle helper (shared-code)
Finding: Q2, P3, confidence 8, landingAnalytics.ts `function whenIdle(run: () => void)` and the `useLandingAnalytics` load listener.
Callers: useLandingAnalytics (existing) and the landing Sentry gate (proposed).
Question D5. Options: A) Share the helper / B) Copy into the Sentry gate.
State: approved
Actual answer: A) Share the helper (Basel, 2026-10-24, D5)
Accepted scope: move `whenIdle` and the after-load wait to `src/pages/landing/afterLoadIdle.ts`; landingAnalytics and the gate call it. **Regression contract:** landingAnalytics.test.ts passes unmodified.

### Factual corrections (no behavior change, applied)
- **C1 (Section 4, P1, confidence 9):** vite.config.ts says "Desktop never imports posthog-js; naming it there would emit the chunk anyway", and `...(isTauri ? {} : { [POSTHOG_CHUNK]: ["posthog-js"] })`. The `vendor-sentry` manualChunks entry must be web-only the same way, or dist-desktop gets a Sentry chunk and fails the approved "desktop never carries Sentry" check.
- **C2 (Section 1, P2, confidence 8):** a failed source-map upload fails the Netlify production build (the MUT-149 precedent, binding). A Sentry outage would then block every web release. The runbook gets the escape: remove `MUTABA3A_LANDING_SENTRY_DSN` from Netlify's Production context, redeploy (reporting compiles out), then restore it.

## Section 1: Architecture
- [P2] (confidence 8) plan D1: F2, so R1 is approved.
- [P2] (confidence 8) plan D4: C2, the outage escape documented (correction).
- Diagram:

```
 page load (dist-web index)
   │
   ├─ marketingPath ∈ {/,/download,/privacy,/terms*}? ──no──► app router (no gate, no SDK; ADR-024)
   │        yes
   ▼
 startLandingErrorReporting()          (entry; no SDK, no DSN; tree-shaken from desktop)
   ├─ window error / unhandledrejection ─► hold (≤10, R1 path guard, drop "Script error.")
   ├─ <ErrorBoundary onError> crash ──────► hold / report
   └─ afterLoadIdle (R4) ─► import('landingSentry')  ─fail─► clear queue, silent
                               │ ok
                               ▼
                 Sentry.init(browserSentryOptions('landing'))
                 beforeSend: path guard (R1) → cap 5/page (R2) → scrubEvent → EU ingest
                 replay held errors → SDK handlers own window errors from now on
```

- Production failures:
  - (a) Chunk 404 after a deploy (stale tab): caught, silent, nothing sent. Acceptable; tested.
  - (b) Sentry unreachable: the SDK drops the event; the page is unaffected.
  - (c) Upload fails at build: the Netlify build fails loudly (C2 escape).

Dispositions: F2 → R1 approved (D2); C2 applied.

## Section 2: Code quality
- [P2] (confidence 8) vite.config.ts:159: R3 approved (D4).
- [P3] (confidence 8) landingAnalytics.ts whenIdle: R4 approved (D5).
- Error handling: chunk-load failure, double start and missing DSN are all covered in plan §4.

Dispositions: R3, R4 approved.

## Section 3: Tests
Framework: Vitest (CLAUDE.md `npm run test:run`) + Playwright release-QA.

```
CODE PATHS                                              USER FLOWS
[+] landingErrorReporting.ts                            [+] Landing crash reported
  ├── start (disabled / twice / enabled) [GAP→unit]       ├── [GAP] [→E2E] / uncaught error, en
  ├── hold ≤10, drop no-error events     [GAP→unit]       ├── [GAP] [→E2E] /privacy, ar
  ├── R1 path guard (pushState /app)     [GAP→unit]       └── [GAP] [→E2E] /download, /terms/:version
  ├── boundary report pre/post SDK       [GAP→unit]     [+] App stays silent (core)
  └── chunk load fail → silent           [GAP→unit]       ├── [GAP] [→E2E] /download → /app link → use app: 0 Sentry requests
[+] landingSentry.ts                                      └── [GAP] [→E2E] direct /app + throw: 0 requests
  ├── event shape (surface, route tmpl, no user, no query) [GAP→unit]
  └── R2 cap: 7 sent → 5 leave             [GAP→unit]   [+] Privacy page
[+] afterLoadIdle.ts (moved)  [★★ TESTED via landingAnalytics.test.ts]  └── [★★ TESTED→extend] privacy-error-reports en+ar
[+] vite.config buildSentry
  ├── portal cases            [★★★ TESTED] vite-config.test.ts (regression contract R3)
  └── web: no DSN / bad host / release / CONTEXT=production w/o token / desktop off [GAP→unit]
[+] check-bundles dist-web lazy-only / precache / desktop / .map  [GAP→unit, extend check-bundles.test.ts]
COVERAGE: 3/18 paths tested today | all gaps assigned in plan §4 + R1/R2 tests
```

Value cards (critical):
- Value: protects=app routes send 0 Sentry requests; fails_when=the gate starts outside marketing paths or a chunk is precached; why_new=no test covers dist-web Sentry; seam=none; no_claim=real Sentry ingest (spy answers QA requests)
- Value: protects=R2 cap 5/page; fails_when=the counter is removed or reset per event; why_new=new behavior; seam=none; no_claim=the server-side quota itself

Tests to retire: none.

## Section 4: Performance
- [P1] (confidence 9): C1, the web-only manualChunks entry (applied).
- The entry grows by the gate, about 1 kB [estimated]. The SDK chunk loads at idle and never during first paint; not precached.

No other issues.

Approval readiness: PASS. Checked S1 (D1), R1 (D2), R2 (D3), R3 (D4), R4 (D5). C1 and C2 are corrections of the approved contract.

## Outside voice

Codex is not installed, so this was the native fallback: a Plan subagent that finished inside its 5-minute timer. That makes it in-host coverage, not outside coverage.

| # | Sev | Finding (evidence verified by the parent) | Disposition |
|---|---|---|---|
| O1 | High | dist-web is checked against `allowlist.local`, which lacks the ingest host and `docs.sentry.io` (check-bundles.ts:68 `local: [...reviewed.local, ...HOSTS.allOrigins]`; bundle-origins.json `docs.sentry.io` only under hosted) | **C3 correction:** a chunk-scoped origin allowance. The ingest host and `docs.sentry.io` are allowed only in files matching `assets/(vendor-sentry\|landingSentry)-*.js`, never in the rest of dist-web, with a check-bundles test for both directions. The bundle-origins.json `$comment` is updated |
| O2 | Med | C1 still emits `vendor-sentry` in web builds without a DSN | **C1 amended:** the manualChunks entry exists only when `buildMode === "web"` and the landing DSN is set. A web build with no DSN carries no Sentry file at all |
| O3 | Med | production-only paths are first run by the real release | **C4:** §8 gets step 0, a local dry run before the first release: `CONTEXT=production MUTABA3A_LANDING_SENTRY_DSN=… SENTRY_AUTH_TOKEN=… npm run build:web && npx tsx scripts/check-bundles.ts --dist dist-web` |
| O4 | Med | the plugin's debug-ID injection touches app chunks (plugin 11.8.0) | **R5 approved (D6, A):** accepted. ADR-091's amendment records that dist-web app chunks carry an inert `_sentryDebugIds` line, with no SDK and no requests, and that production app chunks differ from QA builds |
| O5 | Med | the gate would start during render (main.tsx:76-80 is inside `App()`); the portal starts before render (errorReporting.ts:104) | **C5 correction:** start at module level in main.tsx before `createRoot`, guarded by `__BUILD_MODE__ === "web"` and `landingRoute(location.pathname) !== null` |
| O6 | Low/Med | the page list would be repeated three times | **R6 approved (D7, A):** `landingRoute(pathname)` in marketingPath.ts, used by main.tsx, the gate, R1 and the route tag. main.tsx behavior is unchanged and covered by its existing landing-routing tests |
| O7 | Low | the privacy copy overstates load-failure reports | **R7 approved (D8, A):** EN "Our website sends a report when one of its pages crashes or hits an error. These reports include no account at all, and the free web app you open from the website never sends one." The AR matches; the README draft is updated |
| O8 | Low | no test that a post-handover error is sent once | **Added to §4 tests:** after the SDK starts, one window error leads to exactly one envelope |
| O9 | Low | the ESLint change is more than one allow-list line (eslint.config.js:62,140,189,205,209) | **Applied to the D2 task:** every override block naming `SENTRY_SDK_PATH` admits `landingSentry.ts`; the `server/src` import rule covers it; the :62 message names both files |
| O10 | Low | P8 is already settled; D7 privacy bump; README:17 lacks `/terms` | P8 → TRUE (vite is a devDependency, package.json:92, and Netlify runs it). Privacy has no manifest: `legalTermsManifest` (vite.config.ts:330) covers terms only, so the bump is just `updated`. README:17 gains `/terms` |

### R5: debug IDs in app chunks
State: approved
Actual answer: A) Accept, record in the ADR (Basel, 2026-10-24, D6)
Accepted scope: keep the source-map upload. ADR-091's amendment states that the dist-web app chunks carry the plugin's inert debug-ID line in production builds. check-bundles still proves no SDK, no ingest host and no precached Sentry chunk outside the lazy landing chunks.

### R6: landingRoute()
State: approved
Actual answer: A) One landingRoute() helper (Basel, 2026-10-24, D7)
Accepted scope: `landingRoute(pathname): '/'|'/download'|'/privacy'|'/terms'|'/terms/:version'|null` in src/pages/landing/marketingPath.ts with unit tests. main.tsx, the gate, R1 and the route tag call it. The `/hosted` redirect is kept as it is.

### R7: privacy wording
State: approved
Actual answer: A) Reword to 'crashes or hits an error' (Basel, 2026-10-24, D8)
Accepted scope: the en and ar `errorReports` sentences say "crashes or hits an error"; the README draft is updated to match.

### R8: translated landing crash screen (TODO → built now)
Finding: F4, P3, confidence 7, ErrorBoundary.tsx:51-58 (English app copy).
State: approved
Actual answer: C) Build it in MUT-150 (Basel, 2026-10-24, D9)
Accepted scope:
- The landing's `<ErrorBoundary onError fallback={<LandingCrashScreen/>}>` renders inside LandingProviders.
- Copy: `landing.crash.{title,body,reload}` in en and ar, with no "your data" line.
- The Reload button reloads the page.
- A unit test covers both languages.
- A QA feature `web.error-reports.landing-crash-screen` checks that a forced render crash shows the Arabic screen and sends one report.

Approval readiness: PASS. Re-checked S1 (D1), R1 (D2), R2 (D3), R3 (D4), R4 (D5), R5 (D6), R6 (D7), R7 (D8), R8 (D9). C1–C5 are corrections of the approved contract.

## NOT in scope
- A CSP for the landing (P1: none exists today). It needs its own ticket if wanted.
- Reports from the local app (ADR-024).
- Paid-plan key caps (TD-200); R2 is the client-side stopgap.
- Limiting debug-ID injection to landing chunks (D6 chose to accept it).

## What already exists
- Reused as is: `browserSentryOptions`/`scrubEvent` (MUT-149 D4), `crashReports` QA spy, `ErrorBoundary` `onError`, check-bundles `--dist`.
- Extracted and shared: `buildSentry` (R3), `afterLoadIdle` (R4), `landingRoute` (R6).
- Newly built: the gate, the chunk, the crash screen, the chunk-scoped origin allowance.

## Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| Lazy chunk import | stale tab after a deploy, 404 | unit (load fail → silent) | nothing; the page still works |
| Upload at build | Sentry down or token revoked | build throws (R3) + C2 escape | the release fails loudly, old deploy stays |
| Path guard | future in-page navigation to /app | R1 unit test | nothing is sent |
| Crash loop | repeated errors | R2 unit test | nothing; at most 5 reports |
| Render crash | landing component throws | R8 unit + QA | translated crash screen, one report |

Critical gaps: 0.

## Worktree parallelization
Sequential implementation, no parallelization opportunity: one module, a shared vite.config.ts and main.tsx.

## Implementation Tasks
- [ ] **T1 (P1, human ~2h / CC ~15min)**: build: `buildSentry` shared helper; web defines; plugin; `vendor-sentry` named only for web with a DSN; precache ignores.
  - Source: R3, C1, D3/D4.
  - Files: vite.config.ts, scripts/__tests__/vite-config.test.ts.
  - Verify: portal cases unmodified and green, plus the new web cases.
- [ ] **T2 (P1, human ~2h / CC ~15min)**: bundles: dist-web Sentry lazy-only, never precached, chunk-scoped origins.
  - Source: D6, O1.
  - Files: scripts/bundle-rules.ts, scripts/check-bundles.ts, scripts/bundle-origins.json, tests.
  - Verify: `MUTABA3A_LANDING_SENTRY_DSN=<qa dsn> npm run test:bundles`.
- [ ] **T3 (P1, human ~1h / CC ~10min)**: `landingRoute()` and `afterLoadIdle` extraction.
  - Source: R6, R4.
  - Files: src/pages/landing/marketingPath.ts, afterLoadIdle.ts, landingAnalytics.ts, tests.
  - Verify: landingAnalytics.test.ts unmodified and green.
- [ ] **T4 (P1, human ~4h / CC ~25min)**: the gate and the chunk, with R1 guard, R2 cap and the handover-once test.
  - Source: D1, D2, R1, R2, O5, O8, O9.
  - Files: src/pages/landing/observability/*, src/main.tsx, eslint.config.js.
  - Verify: unit tests, lint.
- [ ] **T5 (P2, human ~2h / CC ~15min)**: translated landing crash screen.
  - Source: R8.
  - Files: src/pages/landing/observability/LandingCrashScreen.tsx, the `landing.json` crash keys (en+ar), tests.
  - Verify: unit test in both languages.
- [ ] **T6 (P2, human ~1h / CC ~10min)**: privacy copy, R7 wording, `updated` bumped.
  - Source: D7, R7.
  - Files: landing.json en+ar, PrivacyPolicyPage.test.tsx.
- [ ] **T7 (P1, human ~3h / CC ~20min)**: release-QA, a web dev DSN, `qa/features/web/error-reports.yaml` with 5 features, and the spec.
  - Source: §5, F1, R8.
  - Verify: `release-qa run --attach --only <id>` for each feature; `release-qa lint` clean.
- [ ] **T8 (P2, human ~1h / CC ~10min)**: Netlify command, docs, ADR-091 amendment (incl. R5) and knowledge files; §8 gets C2 and C4.
  - Source: D6, D8, C2, C4, O10.
- [ ] **T9 (P1)**: gates on Node 22: lint, typecheck, test:run, build, test:bundles, release-qa lint.

## Unresolved decisions
None.

## Completion summary
- Step 0, Scope Challenge: scope accepted as-is.
- Reality rows: 7/7 emitted; 2 unverified premises at review time, 1 later settled (P8).
- Architecture review: 2 issues (F2, C2).
- Code quality review: 2 issues (R3, R4).
- Test review: diagram produced, 15 gaps identified, all assigned.
- Performance review: 1 issue (C1).
- NOT in scope: written. What already exists: written.
- TODOS.md updates: 1 item proposed; Basel chose to build it now (R8).
- Failure modes: 0 critical gaps flagged.
- Unresolved decisions: 0.
- Outside voice: provider codex not installed; native Plan subagent fallback completed (in-host); 10 findings, all dispositioned.
- Parallelization: 1 lane, sequential.
- Lake Score: 4/4 (every scored answer picked the 10/10 option).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (not installed) → native Plan subagent | Independent 2nd opinion | 1 | unavailable (in-host completed) | 10 findings, all dispositioned |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved into tasks) | 5 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex was not installed, so the outside review is unavailable. A native Claude Plan subagent ran in-host and completed within its timer: 10 findings (1 High, 5 Medium, 4 Low), all dispositioned (C1 amended, C3–C5, R5–R8, tests added).
- **VERDICT:** ENG reviewed, with every finding mapped to approved tasks T1–T9. Status is issues_open by rule (resolved findings count). Ready to implement.

NO UNRESOLVED DECISIONS
