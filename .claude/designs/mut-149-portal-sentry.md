# MUT-149 — Hosted portal reports front-end crashes to Sentry

Status: PLAN (eng-ticket, 2026-10-23). Not built. Moves to `.claude/designs/mut-149-portal-sentry.md` at /eng-build
(an untracked file in the main checkout blocks `deploy.sh`).

Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · Backlog = default board status · finished → In Review (landed + pushed → Done)

## 1. Context

- Epic MUT-146. Blocker MUT-147 is In Review: merged (contract 1.1.0, `60c05f6a`) and applied (§1.5 steps 1–7, 2026-10-22). **Gate passes.**
- Sibling MUT-148 (API) merged `b857e063`, In Review. It built the shared seam: `server/src/observability/sentry-rules.ts` + `sentry-scrub.ts` (browser-safe, no `node:*`). ADR-091 am.6: MUT-149/150 reuse it, never a second scrubber.
- Sibling MUT-150 (landing) Backlog; reuses whatever this ticket builds on the web side.
- MUT-151 (phone) In Progress. MUT-329 (release + "Sentry receives a test event from the portal") waits on this.
- **Conflict to resolve — MUT-394** (Backlog) says projects are hand-made and the Terraform Sentry module should retire. Main says otherwise: Terraform adopted `mutaba3a-web`/`mutaba3a-flutter` (01481097, ADR-091 am.7) and attempt 2 applied OK. This plan does not depend on either: the portal DSN reaches the build through `deploy.env`, not Terraform state (D3).
- MUT-382 (privacy policy truthfulness, Backlog) says "re-add the Sentry wording when 148/149/151 ship". This ticket adds only the portal sentence; MUT-382 still owns the rest.

Ticket ACs (Jira) + planning-comment ACs (2026-10-17):
- AC1 Sentry only in the `hosted` build; `web`/`desktop` bundles have no Sentry code; `check-bundles.ts` enforces it.
- AC2 ErrorBoundary crashes, uncaught errors, unhandled rejections reported; handled API failures not.
- AC3 User context = internal user and org IDs only, never email.
- AC4 Source maps uploaded per release, not served publicly.
- AC5 `PORTAL_CSP` `connect-src` adds the EU ingest host and nothing else.
- AC6 Arabic/RTL reports the same as English.
- AC7 (comment) Privacy policy en + ar names the portal as a sender.
- AC8 (comment) Imports `sentry-rules`, never `sentry-fixtures.json`; check-bundles fails on the fixture marker and on `sntrys_`/`sntryu_`.
- AC9 (comment) Upload token is plain `SENTRY_AUTH_TOKEN`, never `VITE_`.
- AC10 (comment) Allowed origins = Terraform `portal_origins` (already wired from `config/hosts.json`; nothing to do unless an origin is new).

## 2. Design

### D1 — Load and gate (ADR-097 §10: no telemetry signed out)
- `src/hosted/observability/portalSentry.ts` — the only file importing `@sentry/browser`. Exports `startPortalSentry({ dsn, release, environment })`, `setReporterUser(id | null)`, `reportBoundaryError(error, componentStack)`.
- `src/hosted/observability/errorReporting.ts` — tiny, always bundled, no SDK import. Holds the gate, and loads the SDK chunk with `import('./portalSentry')` **only when `__SENTRY_DSN__ !== ''` and the mode is `remote`**. With an empty DSN the define makes the branch dead and Rollup drops the chunk entirely (dev, CI, QA without a DSN).
- Mode is read from `mode.ts` (`readModeHint()` + subscribe). Local mode (first visit, signed out, sign-in page, `/setup`) never loads the chunk. Switching to remote (sign-in) loads it; switching to local (sign-out, `endSession.ts`) calls `Sentry.close()` and clears the user.
- Boot order: `main.tsx` calls `startErrorReporting()` before `createRoot`. (R1/D2) The gate installs `window` `error`/`unhandledrejection` listeners and accepts boundary reports at once, holds at most 10 in memory, and replays them into the SDK when the chunk loads; it discards them if the mode is or becomes local. The SDK's own GlobalHandlers take over after init (gate listeners removed then, so nothing is sent twice).
- (F6 correction) The gate reads a boolean define `__SENTRY_ENABLED__`; only `portalSentry.ts` reads `__SENTRY_DSN__`, so the DSN string never lands in the entry chunk.

### D2 — SDK
- **`@sentry/browser` 11.8.0**, not `@sentry/react`. `@sentry/react`'s extras (its ErrorBoundary, router tracing) aren't used: we keep our own boundary, and tracing is 0. Replace the unused `@sentry/react` in root `dependencies` (added in c7469bb3, imported nowhere) with `@sentry/browser`.
- `Sentry.init` from `sentry-rules.json` `sdk` options: `sendDefaultPii:false`, `sampleRate:1`, traces/replay/profiles 0, no console breadcrumbs. `defaultIntegrations` trimmed to: GlobalHandlers (onerror + onunhandledrejection), Breadcrumbs (navigation + fetch only, URLs path-only via the scrubber), LinkedErrors, Dedupe, HttpContext. No Replay, no Feedback, no BrowserTracing.
- (R3/D4) The init options come from a new shared, pure `src/lib/observability/browserSentry.ts` `browserSentryOptions(surface, { dsn, release, environment, dropEvent })`: contract sdk options, `beforeSend = dropEvent(event, hint) ? null : scrubEvent(event, surface)`, `beforeBreadcrumb` through the scrubber's text rules. The portal passes its `dropHandled`; MUT-150 reuses the builder for the landing.
- Tags: `surface=portal`, `locale` read lazily in `beforeSend` from `document.documentElement.lang` (fixes AC6: at init the html says `en`), `route` = router match `routeId` (template, never the concrete path), `app_build`. All already in `allowedTags`.

### D3 — DSN, release, environment (build-time defines, existing convention)
- `MUTABA3A_SENTRY_DSN` → `__SENTRY_DSN__` via a `sentryDsn()` helper in `vite.config.ts`, mirroring `posthogKey()`: "" when unset; **throws unless** it matches `^https://[0-9a-f]{32}@o\d+\.ingest\.de\.sentry\.io/\d+$` (EU only, same as the Terraform postcondition). Hosted branch only, so the web/desktop config snapshot is unchanged.
- `MUTABA3A_SENTRY_RELEASE` → `__SENTRY_RELEASE__`, set by `deploy.sh` to `mutaba3a-portal@<server version>+<SHORT_SHA>` (the portal ships inside the server image, so it versions with the API, matching am.6's API format).
- Environment = deploy.sh `ENVIRONMENT`.
- Source of the DSN: git-ignored `deploy.env` (`MUTABA3A_SENTRY_DSN=…`), exported by the Makefile next to `MUTABA3A_POSTHOG_KEY`. The DSN is public (it ships in the bundle), so deploy.env's "no secrets" rule holds. `deploy.env.example` gets the line. Value comes from `terraform output -json dsn` today, or by hand if MUT-394 retires the module — either way the build doesn't care.
- `README.md` DSN table: `VITE_SENTRY_DSN` → `MUTABA3A_SENTRY_DSN` (the repo uses no `VITE_*` envs).
- Fix `src/vite-env.d.ts`: `__BUILD_MODE__` type gains `'hosted'`; declare the two new defines.

### D4 — What counts as a crash (AC2)
Reported:
- Render errors: a new `PortalErrorBoundary` around `RouterProvider` (inside `HostedLanguageProvider`/`ThemeProvider` so its fallback is translated), **and** `createRouter({ defaultOnCatch, defaultErrorComponent })` (R2/D3: the route crash screen is the same translated fallback, not TanStack's English default) — TanStack Router catches route render/loader errors itself, so they never reach a React boundary above it or `window.onerror`. Both call `reportBoundaryError`.
- `window` `error` and `unhandledrejection` (SDK GlobalHandlers).
- Chunk-load failures (contract keeps them).

Dropped in `dropHandled` (before scrubbing):
- (Section 2 correction, AC2) **every** `ApiError` seen by the global handlers (window error/unhandledrejection), whatever its status or code: the UI owns API failures, and MUT-148 already reports server-side 5xx. No status list to keep in sync.
- An `ApiError` that reaches a boundary or the router's `onCatch` *is* reported (that is a crash), with the `request_id` tag so it links to the server event.
- `ignoredErrors` from the contract (fetch failures, AbortError, ResizeObserver) — the scrubber already does this.
- No QueryCache/MutationCache `onError` hook: handled errors stay out by construction.

`PortalErrorBoundary`: **extend** `src/components/ui/ErrorBoundary.tsx` (registry rule: no new boundary). Its fallback is hardcoded English; pass a `fallback` built from `src/hosted/i18n` keys (`errors.crash.title/body/reload`, en + ar). `onError` → `reportBoundaryError`.

### D5 — User context (AC3)
- `setReporterUser(me.user.id)` from `HostedShell.tsx`'s existing `useEffect` next to `syncPortalUsage(userId)`; cleared in `endSession.ts` beside `endPortalUsage()`.
- **Org id: decided (R4/D5) — user id only.** AC3 amended on Jira; org is looked up from the user id or `request_id`. The options were: The contract allows only `user: { id }` and the seven tags; an org/profile tag is stripped by `scrubEvent`. Options:
  - **(A, recommended) user id only**; amend AC3. Org is recoverable from the user id or from `request_id` → server logs. No contract change.
  - (B) Contract 1.2.0 adds an `org_id` tag (rules + fixtures + new PINNED_VERSIONS row + the Flutter copy + server parity test). Real cost across 3 repos for a lookup we can already do.

### D6 — Source maps (AC4)
- Hosted build sets `build.sourcemap: 'hidden'` **only when** `SENTRY_AUTH_TOKEN` is set (no `//# sourceMappingURL` comment either way).
- `@sentry/vite-plugin` (devDependency, hosted plugins only) uploads with `release.name = __SENTRY_RELEASE__`, `sourcemaps.filesToDeleteAfterUpload: ['dist-hosted/**/*.map']`, `telemetry: false`, org `barmajiyat-ltd`, project `mutaba3a-web`, `url: https://de.sentry.io`.
- Three layers so a map is never public:
  1. the plugin deletes maps after upload;
  2. `check-bundles` fails on any `*.map` in `dist-hosted`;
  3. `serveStatic` in `server/src/app.ts` answers 404 for `*.map` (one line + a test), in case 1 and 2 are ever bypassed.
- `deploy.sh`: when `MUTABA3A_SENTRY_DSN` is set and `SENTRY_AUTH_TOKEN` is not, **fail step 1** (a DSN without maps sends unreadable stacks, failing AC "readable stack traces"). Neither set → portal ships without Sentry (fine). Token set, DSN unset → warn, skip the plugin.
- Token source (R5/D6): an exported `SENTRY_AUTH_TOKEN` wins; else the Makefile reads Keychain service `release-kit`, account `barmajiyat/SENTRY_AUTH_TOKEN`, and passes it only to the server deploy (never echoed, never in deploy.env). §1.5 step 3 gets the one-time `security add-generic-password` line.

### D7 — CSP (AC5)
- `PORTAL_CSP` `connect-src` gains exactly `https://o<org-id>.ingest.de.sentry.io` (the org's ingest host, not a `*.` wildcard).
- The origin is one constant, `SENTRY_INGEST_ORIGIN`, in a new `server/src/observability/sentry-ingest.ts` (one org for every environment, so it isn't env-specific config). `server/src/app.ts` builds the CSP from it, and `vite.config.ts` `sentryDsn()` rejects a DSN whose host differs, so CSP and DSN can't drift. Not `config/hosts.json`: the server image copies `server/` only and never reads it at runtime.
- `scripts/bundle-origins.json` `hosted` allows the same host.
- Tests: `server/src/__tests__/portal.test.ts` pinned CSP strings (:103–105, :194–204). API_VERSION minor bump `-mut149`.
- Alternative considered: a `/v1/errors` tunnel on our server (no CSP change, survives ad-blockers). Rejected for v1: more server code and Cloud Run cost for a pilot-size crash volume.

### D8 — Bundle guards (AC1, AC8) + TD-084
In `scripts/bundle-rules.ts` / `check-bundles.ts`:
- `SENTRY_MARKERS` = SDK-specific strings (`__SENTRY__`, `sentry.javascript`, `ingest.de.sentry.io`). **Not** bare `sentry.io`: posthog-js already contains it (allowlisted).
- `checkSentry()`: fail on any marker in `dist-web` or `dist-desktop`; in `dist-hosted`, markers must appear only in the lazy chunk, never the entry graph (reuse `posthogInEntryGraph`'s walker, generalised).
- All three dists: fail on `MUT147-SENTRY-FIXTURE-DO-NOT-BUNDLE` and `/sntry[su]_[A-Za-z0-9]/`.
- `dist-hosted`: fail on any `*.map`.
- **TD-084 (required here, README:40/:281):** `check-bundles --dist dist-hosted --rules hosted` mode, run by `deploy.sh` step 1 right after `build:hosted`. Today the server release path never runs bundle checks. TD-084 → resolved.
- Existing `sentry-local-boundary.test.ts` (no `@sentry/` reachable from `createLocalApp.ts`) keeps holding: the SDK is imported from `errorReporting.ts`, not the local app.

### D9 — Import boundary
- `eslint.config.js:221` forbids `src/hosted/**` → `server/src`; the portal never imports the server files directly. (R3/D4) A new lint block for `src/lib/observability/**` allows exactly `server/src/observability/sentry-rules` and `sentry-scrub` and forbids the rest of `server/src` (including `observability/sentry-node`), with rows in `scripts/__tests__/hosted-lint.test.ts`.
- Rejected: moving the seam to `src/lib/observability/`. The server imports it and its Docker build copies `server/` only.

### D10 — Privacy policy (AC7)
- `src/lib/i18n/translations/{en,ar}/landing.json`: `errorReports` sentence, `network.body` addition and `noTracking.body` sender list per README:334–347, **merged on top of the current text** (keep MUT-151's phone sentences and PostHog sentences). Bump `updated`.
- README's own wording block is stale (pre-MUT-151); update it to the shipped text.
- Unit: `PrivacyPolicyPage.test.tsx`. QA: `web.legal.privacy-error-reports` expect + spec flip (`not.toContainText(/hosted portal sends/)` → `toContainText`).

### D11 — Knowledge files
ADR-091 amendment 11 (portal: lazy chunk, remote-only gate, `deploy.env` DSN, `MUTABA3A_*` not `VITE_*`, CSP host in hosts.json, `.map` 404). TD-084 resolved. INFRA.md:58 updated (portal live after release). DEPLOYMENT §1.5 step 6 (portal DSN → deploy.env), before-release.md item ("set MUTABA3A_SENTRY_DSN + SENTRY_AUTH_TOKEN, then release server"). COMPONENT_REGISTRY: ErrorBoundary gains portal usage. CHANGELOG, TEST_PLAN.

## 3. Files

| Layer | File | Change |
|---|---|---|
| deps | `package.json` | `@sentry/react` → `@sentry/browser` 11.8.0; devDep `@sentry/vite-plugin` |
| build | `vite.config.ts` | `sentryDsn()`, `sentryRelease()`, hosted `sourcemap: 'hidden'` + plugin when token set |
| build | `src/vite-env.d.ts` | `'hosted'` in `__BUILD_MODE__`; 2 defines |
| config | `server/src/observability/sentry-ingest.ts` (new) | `SENTRY_INGEST_ORIGIN` (org ingest host, from Basel's DSN) |
| portal | `src/hosted/observability/errorReporting.ts` (new) | gate + lazy load + mode subscription |
| shared | `src/lib/observability/browserSentry.ts` (new, R3) | pure init-options builder for portal + landing |
| portal | `src/hosted/observability/portalSentry.ts` (new) | SDK init via browserSentryOptions, `dropHandled`, user, tags |
| portal | `src/hosted/main.tsx` | `startErrorReporting()` before render |
| portal | `src/hosted/HostedApp.tsx` | `ErrorBoundary` with i18n fallback around RouterProvider |
| portal | `src/hosted/router.tsx` | `defaultOnCatch` |
| portal | `src/hosted/shell/HostedShell.tsx`, `session/endSession.ts` | set/clear user |
| portal | `src/hosted/i18n/{en,ar}.json` | crash fallback keys |
| server | `server/src/app.ts` | CSP host; `.map` → 404; API_VERSION `-mut149` |
| server | `server/scripts/deploy.sh` | release string, DSN/token check, bundle check after `build:hosted` |
| ops | `Makefile`, `deploy.env.example` | export DSN (+ Keychain token if chosen) |
| guards | `scripts/bundle-rules.ts`, `scripts/check-bundles.ts`, `scripts/bundle-origins.json` | D8 |
| lint | `eslint.config.js`, `scripts/__tests__/hosted-lint.test.ts` | D9 |
| legal | `src/lib/i18n/translations/{en,ar}/landing.json` | D10 |
| docs | `docs/observability/README.md`, `server/DEPLOYMENT.md`, `docs/operations/before-release.md`, `.claude/*` | D3, D11 |

## 4. Tests (TDD, written first)

Unit (Vitest, `npm run test:run`):
- `errorReporting.test.ts`: empty DSN → never imports the chunk; local mode → never imports; remote → imports once; remote→local → `close()` + user cleared; local→remote → loads.
- `portalSentry.test.ts` (SDK transport mocked; assert on the envelope after `beforeSend`):
  - `ApiError` NETWORK / 4xx / 5xx dropped; plain `Error` kept; `ApiError` passed through `reportBoundaryError` kept with `request_id` tag;
  - user has only `id` (no email even if passed);
  - `locale` tag = `ar` when `<html lang="ar">` at send time though init saw `en` (AC6);
  - `route` is the route id template, not `/profiles/<uuid>/…`;
  - a `/setup#token=…` breadcrumb comes out path-only (contract fixture `portal-setup-token-in-url-fragment` re-run through the live wiring).
- `vite-config.test.ts`: `sentryDsn()` accepts EU DSN; rejects US/`sentry.io`/garbage/host ≠ `SENTRY_INGEST_ORIGIN`; "" when unset. Web/desktop snapshot unchanged.
- `check-bundles.test.ts`: marker in dist-web → fail; marker in hosted entry graph → fail; in lazy chunk → pass; fixture marker / `sntrys_x` / `.map` → fail.
- `hosted-lint.test.ts`: D9 rows.
- `HostedApp`/router test: a route component that throws renders the Arabic fallback and calls the reporter once (not twice: boundary + `onCatch` dedupe).
- `PrivacyPolicyPage.test.tsx`: portal sentence en + ar.
Server (`npm --prefix server test`): CSP string pins; `GET /assets/x.js.map` → 404 even if the file exists.
Existing that must stay green: `sentry-server-scrub.test.ts`, `sentry-rules.test.ts` (no pin change), `sentry-local-boundary.test.ts`.

## 5. QA scenarios (release-QA, `qa/features/portal/error-reports.yaml`, specs in `qa/specs/portal/error-reports.spec.ts`)
QA builds get a dummy EU-shaped DSN (`QA_SENTRY_DSN` in `qa/qa.config.mjs`, like `QA_POSTHOG_KEY`); `qa/support/sentry.ts` answers `**/*.ingest.de.sentry.io/**` locally and records envelopes.
1. `crash-reported` — signed in (English): an uncaught page error → one envelope, user id only, no email, path-only URLs.
2. `crash-reported-ar` — same in Arabic; `locale=ar`.
3. `handled-api-error-not-reported` — saving income gets a 422 → the form shows the error, no envelope.
4. `signed-out-silent` — local mode, same uncaught error → no request to the ingest host at all.
5. `crash-screen` — a route crash shows the translated "Something went wrong" screen with Reload.
Plus `web.legal.privacy-error-reports` updated (portal named). Tier: `extended` (not `core`).

## 6. Scale and cost
- Bundle: hosted entry +~1 KB (gate); SDK chunk ~25 KB gz, fetched only by signed-in users. Web/desktop: zero.
- Requests: zero per session unless something crashes. Free Developer plan quota shared org-wide (TD-200: no per-key cap on free plan); spike alert at 10/h covers a crash loop. `Dedupe` integration stops a render loop from sending one event per frame.
- Build: hosted build +maps + upload ~10–20 s on server releases only.

## 7. Out of scope
Performance tracing, Replay, user feedback widget, a tunnel, the landing (MUT-150), a contract bump (unless D5 = B), retiring the Terraform module (MUT-394).

## 8. Open decisions (for Basel)
- Q1 (D5) org id: A user id only (recommended) / B contract 1.2.0.
- Q2 (D6) upload token: Keychain via Makefile (recommended) / operator shell only.
- Q3 MUT-394 vs main: is Terraform adoption (am.7) still the plan? Doesn't block this ticket, but MUT-394's premise looks stale.

---

# Eng review (plan-eng-review, 2026-10-23) — target: this file (MUT-149 plan)

## Scope record
feature answers: none (no cuts proposed); structure: A "Original arrangement" (D1, Basel 2026-10-23); accepted scope: plan §2–§5 as written, 3 new modules (errorReporting.ts, portalSentry.ts, sentry-ingest.ts) + ~22 edits; pending remedies: R1 (F2), R2 (F4), R3 (F10), R4 (D5 org id), R5 (D6 token source).
Scope Challenge result: scope accepted as-is.

## Scope Challenge findings
- F1 [P1] (9/10) server/src/app.ts:441-447 — `serveStatic({ root: distDir, ... })` serves any file in the dist, so an emitted `.map` would be public. Already covered by plan D6 layer 3 (`.map` → 404). No remedy needed.
- F2 [P2] (8/10) plan D1 "Errors thrown before the chunk resolves are lost; accepted" — a boot render crash fires right after `createRoot` in src/hosted/main.tsx, before the lazy chunk can arrive, so the white-screen-at-boot class (the one users notice most) is never reported.
- F4 [P2] (7/10) plan D4 adds `defaultOnCatch` only — src/hosted/router.tsx `createRouter({ routeTree, history, context, defaultPreload:false })` has no `defaultErrorComponent`, so a route crash shows TanStack's default English "Something went wrong!" screen, not the translated fallback.
- F6 [P3] (6/10) correction, no behavior change — plan D1 gates on `__SENTRY_DSN__ !== ''` in the always-loaded gate, which can leave the DSN string (`ingest.de.sentry.io`) in the entry chunk and trip the plan's own "markers only in the lazy chunk" rule (D8). Correction: add a boolean define `__SENTRY_ENABLED__` for the gate; only portalSentry.ts reads `__SENTRY_DSN__`.
- F10 [P2] (7/10) Jira MUT-149/150 comments: "Build the shared web scrubber once, under src/lib/observability/; MUT-150 reuses it" — the scrubber now exists in server/src/observability (MUT-148), but the browser init options (contract sdk options + beforeSend/beforeBreadcrumb scrub wiring) would sit in src/hosted/, which the landing (dist-web) can't reuse.

## Decision ledger

### R1: errors before the SDK chunk loads
Finding: F2, P2, 8/10, plan D1 / src/hosted/main.tsx, reviewer Claude
Plan baseline: original proposal: errors before the chunk resolves are lost; no pre-init queue.
Runtime evidence: no existing handlers (no window error/unhandledrejection listeners in src/hosted or src/lib); behaviour of the proposed code unknown.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 early errors | lost | gate installs window listeners + boundary hook synchronously, keeps up to 10 errors in memory, replays them into the SDK when the chunk loads; dropped if the mode turns local first | lost (as planned) |
| R2..R5 | pending | pending | pending |
Question D2:
D2 — Catch crashes that happen before Sentry has loaded?
Project/branch/task: main, planning MUT-149 (portal → Sentry).
ELI10: The plan loads Sentry as a separate download after the page starts, so signed-out visitors never get it. But the crash users notice most, a blank screen right at start-up, happens in the first moments, before that download finishes, and the plan simply loses it. Option A adds a tiny listener at start-up that holds up to 10 errors in memory and hands them to Sentry once it arrives.
Stakes if we pick wrong: a start-up crash for every signed-in user would never show up in Sentry, which is the main thing this ticket is for.
Recommendation: A because it closes the one gap where the lazy load costs us real reports, for ~30 lines.
Completeness: A=9/10, B=6/10
Header: Early crashes
Options:
A) Hold early errors (recommended)
The always-loaded gate adds window error/unhandledrejection listeners and accepts boundary reports immediately; keeps at most 10 in memory; replays them into Sentry when the chunk loads; discards them if the mode is or becomes local (ADR-097 §10). Plus unit tests for queue cap, replay order and local discard. human: ~half a day / CC: ~15 min.
B) Accept the loss
Keep the plan: errors before the chunk resolves are dropped. Simpler gate, but boot crashes go unseen.
State: approved
Actual answer: A "Hold early errors" (D2, Basel 2026-10-23)
Accepted scope: gate installs window error/unhandledrejection listeners and accepts boundary reports synchronously; in-memory queue capped at 10; replayed into the SDK on chunk load; discarded if mode is/becomes local; unit tests for cap, replay order, local discard.
History: none

### R2: what a route crash shows
Finding: F4, P2, 7/10, src/hosted/router.tsx createRouter (no defaultErrorComponent), reviewer Claude
Plan baseline: original proposal: `defaultOnCatch` reports route crashes; screen not specified (TanStack default).
Runtime evidence: createRouter({ routeTree, history, context, defaultPreload:false }) sets no errorComponent; the root route sets only notFoundComponent. TanStack's default ErrorComponent is English-only. Approved: R1 A.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 route crash screen | TanStack default (English, error text) | `defaultErrorComponent` renders the same translated fallback as the top boundary (title, body, Reload) in en/ar | unchanged TanStack default |
| R1 early errors | approved A | approved A | approved A |
| R3..R5 | pending | pending | pending |
Question D3:
D3 — Show our own translated crash screen when a page crashes?
Project/branch/task: main, planning MUT-149 (portal → Sentry).
ELI10: Most portal crashes happen inside a page, and the router catches those itself. Today it then shows its built-in screen: English only, with the raw error message, even for Arabic users. The plan reports these crashes but never says what the person sees. Option A shows the same translated "Something went wrong / Reload" screen the plan already adds for crashes outside a page.
Stakes if we pick wrong: an Arabic user who hits a crash gets an English developer message, which is also an RTL/AC6 miss.
Recommendation: A because it reuses the fallback the plan already builds, a few lines more.
Completeness: A=9/10, B=5/10
Header: Crash screen
Options:
A) Translated fallback (recommended)
Set `defaultErrorComponent` in createRouter to the same i18n fallback as PortalErrorBoundary (en + ar, Reload button); covered by the router crash unit test and QA scenario `crash-screen`. human: ~1 hour / CC: ~5 min.
B) Keep router default
Report the crash but leave TanStack's built-in English error screen.
State: approved
Actual answer: A "Translated fallback" (D3, Basel 2026-10-23)
Accepted scope: createRouter gets `defaultErrorComponent` = the same i18n fallback as PortalErrorBoundary (en + ar, Reload); router crash unit test + QA `crash-screen` cover it.
History: none

### R3: where the browser Sentry setup lives
Finding: F10, P2, 7/10, Jira MUT-149/150 comments 11937/11938 ("Build the shared web scrubber once, under src/lib/observability/; MUT-150 reuses it"), reviewer Claude
Plan baseline: original proposal: all browser Sentry setup in src/hosted/observability/portalSentry.ts.
Runtime evidence: scrubEvent(event, surface) already shared in server/src/observability/sentry-scrub.ts:174 (MUT-148); src/lib/observability/ does not exist; eslint.config.js:221 forbids src/hosted → server/src. Proposed caller 2 (landing, MUT-150) is an assumption, not code. Approved: R1 A, R2 A.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 init-options location | src/hosted only | `src/lib/observability/browserSentry.ts`: pure `browserSentryOptions(surface, { dsn, release, environment, dropEvent })` = contract sdk options + beforeSend/beforeBreadcrumb through scrubEvent; portalSentry.ts calls it with portal's dropHandled; lint exception is for src/lib/observability → the two server files | everything in src/hosted/observability/portalSentry.ts; MUT-150 extracts later |
| R1, R2 | approved A | approved A | approved A |
| R4, R5 | pending | pending | pending |
Question D4:
D4 — Put the browser Sentry setup where the landing page can reuse it?
Project/branch/task: main, planning MUT-149 (portal → Sentry).
ELI10: Both the portal (this ticket) and the landing page (MUT-150) need the same Sentry setup: the privacy settings from our rules file and the scrubber that strips personal data before anything is sent. Your Jira note asked to build it once in a shared folder. The portal-only bits (which API errors to ignore, the signed-in gate) stay in the portal either way. A puts the shared part in src/lib/observability now; B keeps it in the portal and lets MUT-150 move it.
Stakes if we pick wrong: with B, MUT-150 either moves code under a live portal or copies it, and two copies of privacy wiring can drift.
Recommendation: A because the second caller is the next ticket in the same epic and your note already asked for it; the shared piece is one small pure function.
Completeness: A=9/10, B=7/10
Header: Shared setup
Options:
A) Shared in src/lib (recommended)
New src/lib/observability/browserSentry.ts, a pure options builder taking the surface, tested once (contract options, scrub on send and breadcrumb). Portal passes its own drop rule. The lint exception goes on src/lib/observability. human: ~2 hours / CC: ~10 min.
B) Portal-only for now
Keep all setup in src/hosted/observability/portalSentry.ts; MUT-150 extracts it when the landing needs it. One file less now.
State: approved
Actual answer: A "Shared in src/lib" (D4, Basel 2026-10-23)
Accepted scope: new src/lib/observability/browserSentry.ts, pure `browserSentryOptions(surface, { dsn, release, environment, dropEvent })` (contract sdk options + beforeSend/beforeBreadcrumb through scrubEvent), unit-tested once; portalSentry.ts passes the portal's dropHandled; the server-import lint exception is scoped to src/lib/observability → sentry-rules/sentry-scrub only.
History: none

## Section 1 — Architecture findings
- F11 [P2] (8/10) plan D1 `import('./portalSentry')` — if the chunk fails to load (flaky network, a stale tab after a deploy rotated hashes), the rejected import would itself be an unhandled rejection the R1 queue catches, a loop. Carried as necessary implementation of R1 (approved D2): the gate catches the import rejection, drops the queue, sends nothing, and does not retry until the next mode change; unit test "chunk load fails → no throw, no retry, queue cleared".
- F12 [P2] (6/10) server/infrastructure/sentry/main.tf:21 `portal_origins` derives the live origin from config/hosts.json (production: domain mtb3a.com, portalSubdomain app, stage live). The Sentry stack's last apply and the domain going live were both 2026-10-22; whether `allowed_domains` on mutaba3a-web already includes https://app.mtb3a.com is unverified. If not, Sentry rejects every portal event (403) silently. Carried as proof of AC10 (ticket comment): before-release.md item "terraform -chdir=server/infrastructure/sentry plan shows no allowed_domains change, else apply" and DEPLOYMENT §1.5 note.
- F13 [P3] (7/10) ad-blockers commonly block `*.ingest.sentry.io`, so some users' crashes never arrive. Plan D7 already weighed a tunnel and chose not to; noted in ADR-091 am.11 as a known gap, no change.
- R4 (plan D5 org id) and R5 (plan D6 token source) were left open by the plan; asked below.

### R4: user context on reports
Finding: plan D5 vs ticket AC3 "User context is limited to internal user and org IDs", P2, 9/10, docs/observability/sentry-rules.json allowedUserKeys ["id"] and allowedTags (no org), reviewer Claude
Plan baseline: original proposal: open; recommended A (user id only).
Runtime evidence: scrubEvent (server/src/observability/sentry-scrub.ts:174) drops any tag outside allowedTags (surface, request_id, route, locale, release, environment, app_build) and any user key but id; the contract is sha-pinned (scripts/__tests__/sentry-rules.test.ts) and mirrored in Flutter. Approved: R1–R3 A.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 org on events | none | none; reports carry user.id only; AC3 amended on Jira ("user id; org is looked up from user id or request_id") | contract 1.2.0 adds an `org_id` tag: rules + fixtures + PINNED_VERSIONS row + server parity test + Flutter copy; portal tags the active profile id |
| R1–R3 | approved A | approved A | approved A |
| R5 | pending | pending | pending |
Question D5:
D5 — Tag crash reports with the firm (org) id, or only the user id?
Project/branch/task: main, planning MUT-149 (portal → Sentry).
ELI10: The ticket says reports may carry the internal user id and org id. But our Sentry rules file, which strips personal data from every report on all four surfaces, only lets the user id through; an org id would be removed. Adding it means changing that shared rules file in two repos, re-pinning it and updating the phone's copy. Without it, you can still find the firm by looking up the user id, or by the request id that links to the server's own report.
Stakes if we pick wrong: A means one extra lookup when triaging; B means a three-repo contract change for a field we can already derive.
Recommendation: A because the org is one lookup away and the contract stays untouched across server, portal and phone.
Completeness: A=8/10, B=9/10
Header: Org id
Options:
A) User id only (recommended)
Reports carry user.id and no org. I comment on MUT-149 to amend AC3, and ADR-091 am.11 records why. No contract change. human: ~0 / CC: ~2 min.
B) Contract 1.2.0 org tag
Add `org_id` to allowedTags in sentry-rules.json and fixtures, new sha pin, server parity test, Flutter copy updated; portal sets it from the active profile. human: ~1 day / CC: ~45 min across mini-crm + Flutter.
State: approved
Actual answer: A "User id only" (D5, Basel 2026-10-23)
Accepted scope: reports carry user.id only, no org; Jira comment amends AC3; ADR-091 am.11 records why; no contract change.
History: none

### R5: where the source-map upload token comes from
Finding: plan D6 "Token source", P3, 8/10, server/DEPLOYMENT.md §1.5 step 3 ("SENTRY_AUTH_TOKEN … for MUT-149..151 builds", operator shell); ~/Work/tools/release-kit/PLAN.md §3.2 (Keychain service `release-kit`, accounts `<org>/<NAME>`), reviewer Claude
Plan baseline: original proposal: open; recommended Keychain.
Runtime evidence: no mini-crm Makefile/script reads the Keychain today (grep find-generic-password: none). Approved: R1 A, R2 A, R3 A, R4 A; plan D6 "DSN set, token missing → deploy.sh fails step 1" is in the approved scope (D1).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 token source | operator exports SENTRY_AUTH_TOKEN by hand | env wins; else Makefile reads Keychain service `release-kit` account `barmajiyat/SENTRY_AUTH_TOKEN` (`security find-generic-password -s release-kit -a … -w`), exports it only to the deploy recipe; DEPLOYMENT §1.5 step 3 says store it there | operator exports it in the shell for every `make release server` (§1.5 step 3 as written) |
| R1–R4 | approved A | approved A | approved A |
Question D6:
D6 — Read the Sentry upload token from the Keychain, or type it each release?
Project/branch/task: main, planning MUT-149 (portal → Sentry).
ELI10: Readable stack traces need a secret upload token at build time. The plan makes the server release fail if the portal has a Sentry address but no token, so a forgotten token stops the release instead of shipping unreadable reports. Option A lets the Makefile fetch the token from the macOS Keychain, where your release-kit already keeps Barmajiyat secrets; an exported variable still wins. Option B keeps today's runbook: export it by hand before every server release.
Stakes if we pick wrong: with B, every server release where you forget the export fails at step 1 and you rerun it.
Recommendation: A because it follows the release-kit Keychain rule and removes a manual step from every release.
Completeness: A=9/10, B=8/10
Header: Upload token
Options:
A) Keychain fallback (recommended)
Makefile: env SENTRY_AUTH_TOKEN wins, else Keychain `release-kit` / `barmajiyat/SENTRY_AUTH_TOKEN`, passed only to the server deploy; never echoed, never in deploy.env. Runbook step 3 updated with the one-time `security add-generic-password` line. human: ~1 hour / CC: ~10 min.
B) Export by hand
Keep §1.5 step 3: the operator exports SENTRY_AUTH_TOKEN in the shell before `make release server`. No Makefile change.
State: approved
Actual answer: A "Keychain fallback" (D6, Basel 2026-10-23)
Accepted scope: Makefile: env SENTRY_AUTH_TOKEN wins, else Keychain service `release-kit` account `barmajiyat/SENTRY_AUTH_TOKEN`, passed only to the server deploy, never echoed, never in deploy.env; DEPLOYMENT §1.5 step 3 gains the one-time `security add-generic-password` line.
History: none

Section 1 dispositions: F11 carried under R1 (approved D2); F12 carried under AC10 (before-release item); F13 noted, no change; R4 approved A (D5); R5 approved A (D6).

## Section 2 — Code quality findings
- F14 [P2] (8/10) plan D4 "Dropped in dropHandled" listed specific ApiError statuses (401/403/404/409/422/429, NETWORK, ≥500) — a hand list that misses 400/402/410 and drifts as codes are added (src/hosted/api/client.ts:84-85 `ApiErrorCode`). Factual correction applied (AC2 already says handled API failures are not reported): every `ApiError` from the global handlers is dropped; one reaching a boundary or `onCatch` is reported. No behavior beyond AC2.
- F15 [P3] (7/10) `route` tag needs the router's current match inside `beforeSend`, but portalSentry.ts is loaded lazily and has no router. Carried: `startErrorReporting({ currentRouteId: () => router.state.matches.at(-1)?.routeId })` passed from src/hosted/main.tsx; unit-tested with a stub.
- F16 [P3] (7/10) src/components/ui/ErrorBoundary.tsx:51 hardcodes English fallback copy. The plan passes `fallback`, which the component already supports (:5, :46). No change to the shared component; COMPONENT_REGISTRY gets the portal usage line.
Dispositions: F14 correction applied; F15, F16 carried as implementation detail; no new choices.

## Section 3 — Test review
Framework: Vitest (`npm run test:run`, CLAUDE.md Phase 4), server Vitest (`npm --prefix server test`), Playwright release-QA (`qa/`).

```
CODE PATHS                                                     USER FLOWS
[+] src/hosted/observability/errorReporting.ts (gate)          [+] Signed-in crash (en)
  ├── __SENTRY_ENABLED__ false → no-op        [GAP→unit]         └── [GAP][→E2E] QA crash-reported
  ├── mode local → never import, queue off    [GAP→unit]       [+] Signed-in crash (ar)
  ├── mode remote → import once               [GAP→unit]         └── [GAP][→E2E] QA crash-reported-ar (locale=ar)
  ├── early error → queue (cap 10) → replay   [GAP→unit] R1    [+] Handled API error
  ├── remote→local → close + clear + drop q   [GAP→unit]         └── [GAP][→E2E] QA handled-api-error-not-reported
  └── import() rejects → swallow, no retry    [GAP→unit] F11   [+] Signed out (local mode)
[+] src/lib/observability/browserSentry.ts                       └── [GAP][→E2E] QA signed-out-silent (zero ingest requests)
  ├── contract sdk options applied            [GAP→unit] R3    [+] Route crash screen
  ├── beforeSend: dropEvent true → null       [GAP→unit]         └── [GAP][→E2E] QA crash-screen (translated, Reload)
  ├── beforeSend: scrubEvent (setup#token)    [GAP→unit] reuse fixture
  └── beforeBreadcrumb scrubbed               [GAP→unit]
[+] src/hosted/observability/portalSentry.ts
  ├── dropHandled: ApiError via global → drop [GAP→unit] F14
  ├── ApiError via boundary → kept+request_id [GAP→unit]
  ├── user {id} only, never email             [GAP→unit] AC3
  ├── locale read at send time                [GAP→unit] AC6
  └── route = routeId template                [GAP→unit] F15
[+] router defaultErrorComponent + onCatch    [GAP→unit] R2 (reported once, ar fallback)
[+] vite.config.ts sentryDsn()/release        [GAP→unit] EU-only, host == SENTRY_INGEST_ORIGIN, "" off
[+] check-bundles: Sentry markers / fixture / sntry / .map   [GAP→unit]
[+] server app.ts CSP host + .map 404          [GAP→server test] (CRITICAL regression: existing CSP pins)
[+] eslint src/lib/observability exception     [GAP→unit hosted-lint]
[+] deploy.sh DSN-without-token → fail         [GAP→manual: `make release server` dry run]  (no shell test harness)
[+] Makefile Keychain fallback                 [GAP→manual: make -n, token never echoed] R5
[+] privacy en/ar                              [★★ TESTED PrivacyPolicyPage.test.tsx] extend; QA web.legal.privacy-error-reports flip

COVERAGE (planned): 0/27 today (all new); planned 25/27 automated, 2 manual (shell)
```

Regression contract (carried from approved D1 scope, not new policy):
- CRITICAL: PORTAL_CSP keeps every existing source (self, storage.googleapis.com, eu.i.posthog.com); only the ingest origin is added — server/src/__tests__/portal.test.ts pins updated, not loosened.
- CRITICAL: privacy text keeps MUT-151 phone sentences and PostHog sentences — PrivacyPolicyPage.test.tsx asserts them still present.
- Web/desktop vite config snapshot unchanged (scripts/__tests__/vite-config.test.ts:45).
- sentry-local-boundary.test.ts stays green (local mode chunk never reaches @sentry/).
- `.map` 404 does not change caching or fallthrough for other /assets files.

Tests made obsolete: none. Test value cards: see the Test Plan artifact.
Dispositions: no new policy choices; all gaps are proof of approved scope (D1–D6).

## Section 4 — Performance
- Bundle [estimated]: gate ~1–2 KB in the hosted entry; SDK chunk ~25–30 KB gzip (@sentry/browser 11.8.0 with trimmed integrations), fetched only in remote mode. Web/desktop 0 bytes (enforced by D8 check). Re-measure at build: `ls -l dist-hosted/assets` before/after.
- Requests: 0 per session without a crash. Early-error queue bounded at 10 (R1). Dedupe integration stops render loops from sending per-frame events. Spike alert 10/h (MUT-147).
- Build: hosted sourcemaps + upload only when the token is present (server releases); CI unchanged.
No issues found.

## Outside voice
Outside voice unavailable: Codex not installed; the native Plan fallback produced no complete report within five minutes (stopped, cancellation confirmed). No outside coverage, no cross-model check.

## TODOS.md
No TODOs proposed (F13 ad-blocker loss is recorded in ADR-091 am.11, not deferred work).

## Approval readiness
Approval readiness: PASS — R1 (D2 A), R2 (D3 A), R3 (D4 A), R4 (D5 A), R5 (D6 A); structure D1 A; corrections F6, F14 change no approved behavior; F11/F12/F15/F16 are carried implementation/proof of approved scope; regression contract carried from D1 scope.

## NOT in scope
- Tunnel endpoint for ad-blocked reports: pilot-scale volume does not justify server code (F13).
- Org id on events: decided out (D5).
- Performance tracing, Replay, feedback widget: contract sets all sampling to 0.
- Landing reporting (MUT-150) beyond the shared options builder it will reuse.
- Retiring the Sentry Terraform module (MUT-394); this plan works either way.

## What already exists
- `server/src/observability/sentry-scrub.ts` `scrubEvent` + `sentry-rules.ts` (MUT-148): reused unchanged, imported via the new shared builder (R3).
- `src/components/ui/ErrorBoundary.tsx` (`fallback`, `onError`): reused with a portal fallback, not rebuilt.
- `posthogKey()` define pattern in vite.config.ts, `checkPosthog()` lazy-entry walker in check-bundles.ts, `MUTABA3A_POSTHOG_KEY` Makefile export, `qa/support/posthog.ts` stub: each copied for Sentry.
- `mode.ts` `readModeHint()` + subscription; `HostedShell` `syncPortalUsage` effect; `endSession` `endPortalUsage`: hook points reused.
- Terraform `portal_origins` from config/hosts.json: covers allowed origins (AC10), verified at release (F12).

## Diagram — reporting flow
```
main.tsx ──startErrorReporting(currentRouteId)──▶ errorReporting.ts (entry, ~1 KB)
                                                   │ __SENTRY_ENABLED__? no → no-op
                                                   │ mode (mode.ts, subscribed)
            window error / unhandledrejection ────▶│  local  → listeners off, queue dropped, SDK closed
            ErrorBoundary.onError / router onCatch ▶│  remote → queue (≤10) + import('./portalSentry')
                                                   ▼            │ rejects → swallow, clear queue (F11)
                                     portalSentry.ts (lazy chunk)│ resolves
                                       init(browserSentryOptions('portal', {dsn, release, env, dropHandled}))
                                       replay queue → captureException; setUser({id})
                                                   ▼
                     beforeSend: dropHandled(ApiError via global → null) → scrubEvent(event,'portal')
                                                   ▼
                     https://o<org>.ingest.de.sentry.io  (CSP connect-src, allowed_domains)
```

## Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| chunk load | network flake / stale hashes | F11 unit | nothing (silent, intended) |
| ingest | ad-blocker or allowed_domains missing app.mtb3a.com → 403 | F12 release check; F13 accepted | nothing; reports lost (known) |
| init | malformed DSN | build fails (sentryDsn() throws) | n/a |
| maps | upload skipped | deploy.sh fails if DSN without token; check-bundles no .map | n/a |
| scrub | new field leaks PII | scrubEvent + fixtures; browserSentry tests | n/a |
| render crash | route throws | R2 fallback + onCatch test | translated crash screen |
No critical gaps (every silent path is either intended or has a test/release check).

## Worktree parallelization
| Step | Modules touched | Depends on |
|---|---|---|
| A guards | scripts/, eslint.config.js | — |
| B server | server/src, server/scripts, Makefile, docs | — |
| C portal | src/lib/observability, src/hosted, vite.config.ts, package.json | A (lint rule) |
| D legal+QA | src/lib/i18n/translations, qa/ | C (QA needs the gate) |
Sequential implementation recommended anyway: one worktree per ticket (memory rule), and C/D share vite.config + package.json. 4 steps, 0 parallel lanes.

## Implementation Tasks
- [ ] **T1 (P1, human: ~1d / CC: ~30min)** — portal — gate with early-error queue, mode subscription, chunk-load swallow
  - Surfaced by: R1/D2, F11, F6
  - Files: src/hosted/observability/errorReporting.ts, src/hosted/main.tsx, src/vite-env.d.ts
  - Verify: `npm run test:run -- errorReporting`
- [ ] **T2 (P1, human: ~4h / CC: ~15min)** — shared — browserSentryOptions + lint exception
  - Surfaced by: R3/D4
  - Files: src/lib/observability/browserSentry.ts, eslint.config.js, scripts/__tests__/hosted-lint.test.ts
  - Verify: `npm run test:run -- browserSentry hosted-lint && npm run lint`
- [ ] **T3 (P1, human: ~4h / CC: ~15min)** — portal — portalSentry: dropHandled (all ApiError via global), user id only, lazy locale, route id
  - Surfaced by: F14, F15, R4/D5
  - Files: src/hosted/observability/portalSentry.ts
  - Verify: `npm run test:run -- portalSentry`
- [ ] **T4 (P2, human: ~2h / CC: ~10min)** — portal — boundary + router defaultErrorComponent/onCatch, en/ar fallback
  - Surfaced by: R2/D3, F16
  - Files: src/hosted/HostedApp.tsx, src/hosted/router.tsx, src/hosted/i18n/{en,ar}.json
  - Verify: router crash unit test
- [ ] **T5 (P1, human: ~4h / CC: ~15min)** — build/server — DSN/release defines, hidden maps + plugin, CSP ingest origin, .map 404, API_VERSION -mut149
  - Surfaced by: plan D3/D6/D7, F1
  - Files: vite.config.ts, package.json, server/src/observability/sentry-ingest.ts, server/src/app.ts
  - Verify: `npm run test:run -- vite-config && npm --prefix server test`
- [ ] **T6 (P1, human: ~4h / CC: ~15min)** — guards — check-bundles Sentry/fixture/sntry/.map rules + per-dist mode in deploy.sh (TD-084)
  - Surfaced by: plan D8
  - Files: scripts/bundle-rules.ts, scripts/check-bundles.ts, scripts/bundle-origins.json, server/scripts/deploy.sh
  - Verify: `npm run test:run -- check-bundles && npm run test:bundles`
- [ ] **T7 (P2, human: ~2h / CC: ~10min)** — ops — Makefile Keychain fallback + DSN export, deploy.env.example, release string, DSN-without-token failure
  - Surfaced by: R5/D6, plan D6
  - Files: Makefile, deploy.env.example, server/scripts/deploy.sh
  - Verify: `make -n release-server` shows no token; manual dry run
- [ ] **T8 (P2, human: ~3h / CC: ~15min)** — legal+QA — privacy en/ar + QA error-reports specs + legal spec flip
  - Surfaced by: plan D10, §5
  - Files: src/lib/i18n/translations/{en,ar}/landing.json, qa/features/portal/error-reports.yaml, qa/specs/portal/error-reports.spec.ts, qa/support/sentry.ts, qa/qa.config.mjs, qa/features/web/legal.yaml, qa/specs/web/legal.spec.ts
  - Verify: `release-qa run --attach --only <ids>`; `release-qa lint`
- [ ] **T9 (P2, human: ~2h / CC: ~10min)** — docs — ADR-091 am.11, TD-084 resolved, INFRA, DEPLOYMENT §1.5 (token, DSN, allowed_domains plan), before-release item, README DSN table, Jira AC3 comment
  - Surfaced by: R4, R5, F12, plan D11
  - Files: .claude/*.md, docs/observability/README.md, server/DEPLOYMENT.md, docs/operations/before-release.md

## Unresolved decisions
None.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 tier-1 rows emitted, 1 unverified premise (F12 allowed_domains live state)
- Architecture Review: 3 issues found (F11, F12, F13) + 2 plan-open choices resolved (D5, D6)
- Code Quality Review: 3 issues found (F14, F15, F16)
- Test Review: diagram produced, 2 gaps identified (shell paths manual-only)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (not installed; native fallback timed out)
- Parallelization: 0 lanes, 0 parallel / 4 sequential
- Lake Score: 0/5 (no scored option was 10/10; chosen options scored 9, 9, 9, 8, 9, all the recommended ones)

REALITY: premise-table finding 1 unverified (allowed_domains live) server/infrastructure/sentry/main.tf:21
REALITY: already-done pass no portal Sentry on any branch; latest Sentry work is MUT-148 commit 4441355f (local-mode boundary test), nothing in src/hosted/main.tsx:1
REALITY: surface-check pass defaultOnCatch exists node_modules/@tanstack/react-router/dist/esm/router.d.ts:66; @sentry/vite-plugin 11.8.0 on npm
REALITY: binding-decisions pass ADR-097 §10 honored (remote-only gate) .claude/DECISIONS.md:3894
REALITY: numbers finding bundle sizes [estimated], re-measure at build vite.config.ts:406
REALITY: deferred-asks pass AC3 org id narrowed by D5 (Jira amendment, T9); all other ACs mapped; contract docs/observability/sentry-rules.json:1
REALITY: pr-count pass one branch, one merge, default policy (no ship-policy.json); merge pattern as MUT-148 commit b857e063

# Design review (plan-design-review, 2026-10-23) — target: the crash screen in this plan

Scope: D1 A (all 7 passes, text-only, no mockups); D2 B (no outside design voices; outside coverage skipped).
System audit: no DESIGN.md (brand kit docs/brand/README.md). UI scope = the crash screen: top boundary fallback + router defaultErrorComponent (eng R2/D3, F16).
Existing patterns: `ReloadToContinue` / `BootUnreachable` (src/hosted/pages/auth/BootScreens.tsx: Wordmark + `hp-card hp-boot-card` role=alert, h2, p, Button) and inline `Unreachable` (src/hosted/components/QueryView.tsx:53: `hp-card hp-unreachable` role=alert, AlertIcon, h2, p, secondary sm Button).
Step 0: 3/10 — the plan says only "translated fallback, Reload".

Initial pass ratings: P1 IA 3 · P2 states 4 · P3 journey/copy 2 · P4 slop 7 · P5 design system 4 · P6 a11y/responsive 2.

## Design decisions
- **Issue 1 → 1A (D3, Basel 2026-10-23): placement.** A crash inside a page (any child route) renders the inline crash card in the shell's content area; top bar and navigation stay usable, and navigating away clears it (TanStack resets the route boundary on location change). A crash of the frame itself (the root/shell route's `errorComponent`, or the top `PortalErrorBoundary` outside the router) renders the full-page card with the wordmark. Router wiring: root route `errorComponent` = full-page; `defaultErrorComponent` = inline.
```
 Page crash (1A)                         Frame crash (1A)
 +-------------------------------+       +-------------------------------+
 | Top bar / nav (still works)   |       |           MTB3A wordmark      |
 +-------------------------------+       |  +-------------------------+  |
 | [!] <title>                   |       |  | <title>                 |  |
 |     <body>                    |       |  | <body>                  |  |
 |     [ Reload ]                |       |  | [ Reload ]              |  |
 +-------------------------------+       |  +-------------------------+  |
                                         +-------------------------------+
```
- **Issue 2 → 2A (D4, Basel 2026-10-23): actions.** One primary "Reload page" button (`window.location.reload()`) on both placements; no second action. State table:
```
  SURFACE            | LOADING | EMPTY | ERROR (the crash)                 | SUCCESS            | PARTIAL
  -------------------|---------|-------|-----------------------------------|--------------------|-------------------------------
  Page crash card    | n/a     | n/a   | inline card, title/body, Reload   | reload → page back | nav still usable; leaving the route clears the card
  Frame crash card   | n/a     | n/a   | full page, wordmark, card, Reload | reload → app back  | none (frame is gone)
  Repeat crash       | n/a     | n/a   | same card again (no loop guard)   | n/a                | page crash: nav is the way out
```
- **Issue 3 → 3A (D5, Basel 2026-10-23): copy.** New keys `hosted.crash.{title,body,reload}` in src/hosted/i18n/{en,ar}.json, same on both placements; the raw error message is never rendered; no claim that a report was sent.
  - en: title "This page stopped working" · body "Reload to keep working. Anything you hadn't saved on this page may need entering again." · button "Reload"
  - ar: title «توقفت هذه الصفحة عن العمل» · body «أعد تحميل الصفحة لتتابع العمل. قد تحتاج إلى إدخال ما لم تحفظه في هذه الصفحة مرة أخرى.» · button «إعادة التحميل»
  Journey:
```
  STEP | USER DOES                    | USER FEELS        | PLAN SPECIFIES
  -----|------------------------------|-------------------|------------------------------------------------
  1    | Clicks; page breaks          | surprise, worry   | card replaces only the page; nav stays (1A)
  2    | Reads title                  | "what happened?"  | plain title, no jargon or stack text (3A)
  3    | Reads body                   | "what do I lose?" | honest: unsaved input may need re-entering (3A)
  4    | Presses Reload               | hope              | one button (2A)
  5    | Page back / or uses the nav  | relief / detour   | nav is the way around a repeat crash (1A)
```
- **Issue 4 → 4A (D6, Basel 2026-10-23): components.** No new visual component.
  - Full page: `ReloadToContinue` (src/hosted/pages/auth/BootScreens.tsx) gains a `'CRASH'` stop in `STOP_KEYS` → `hosted.crash` (title/body), and its button label comes from the stop (`hosted.crash.reload` for CRASH; `hosted.local.reload` unchanged for the two local stops).
  - Inline: a small `CrashCard` next to `Unreachable` in src/hosted/components/QueryView.tsx, same `hp-card hp-unreachable` markup + `AlertIcon`, `role="alert"`, primary `Button` "Reload" (`window.location.reload()`); no new CSS.
  - `ErrorBoundary` (src/components/ui/ErrorBoundary.tsx) unchanged; it receives the full-page card as `fallback`. Router: root route `errorComponent` → `ReloadToContinue stop="CRASH"`; `defaultErrorComponent` → `CrashCard`.
  - COMPONENT_REGISTRY: note the CRASH stop and CrashCard.
- **Issue 5 → 5A (D7, Basel 2026-10-23): focus.** Both cards' `h2` get `tabIndex={-1}` and are focused once on mount (also applies to the existing local-mode stops, which share ReloadToContinue); `role="alert"` stays. Layout, dark mode, RTL and touch sizing are inherited from the reused cards (`md` button 40px, hosted.css coarse-pointer rules). Test: after a forced route crash, `document.activeElement` is the card title, and Tab reaches Reload.
- **Issue 6 → 6A (D8, Basel 2026-10-23): last resort.** An outermost boundary in src/hosted/main.tsx, above every provider, renders a static screen: Arabic first, then English (ADR-077), the `hosted.crash` title + body and a plain Reload button, styled with the boot-splash CSS only. Its text is read straight from the JSON dictionaries (static import of src/hosted/i18n/{ar,en}.json, no provider), so nothing is hardcoded twice. It reports through the gate's early-error queue (R1).

Pass ratings after decisions: P1 3→8 (settled placement; one shared title on both placements by 3A) · P2 4→9 · P3 2→9 · P4 7→9 (no hard rejections; app UI, card is the interaction) · P5 4→9 (reuses ReloadToContinue + Unreachable layout) · P6 2→9 (focus 5A; inherited RTL/dark/touch). Pass 7: 1 resolved (Issue 6), 0 deferred.
Litmus (OPERATE): brand in first screen YES (wordmark on full-page card; page card sits in branded shell) · one anchor YES (card title) · scannable by headline YES · one job YES · card necessary YES (alert) · motion n/a · premium without shadows YES. Hard rejections: none.

### Design: NOT in scope
- AI mockups: skipped (D1), the screen reuses shipped cards.
- "We've been told" reassurance: rejected (3A), not always true.
- Second action (Go to overview): rejected (2A), the nav covers it.
- Repeat-crash loop guard: not needed on pages (nav); full-page repeat stays Reload-only.

### Design: what already exists
- `ReloadToContinue`, `BootUnreachable` (src/hosted/pages/auth/BootScreens.tsx), `Unreachable` (src/hosted/components/QueryView.tsx:53), `Button` sizes (src/components/ui/Button.css: md 40px), boot-splash CSS, hosted.css coarse-pointer rules; BootScreens.test.tsx to extend.

### Design: TODOS
None proposed.

### Design: implementation tasks (added to eng T4)
- [ ] **DT1 (P2, human: ~2h / CC: ~10min)** — portal — CRASH stop in ReloadToContinue + CrashCard inline card, hosted.crash keys en/ar
  - Surfaced by: Issues 3, 4
  - Files: src/hosted/pages/auth/BootScreens.tsx, src/hosted/components/QueryView.tsx, src/hosted/i18n/{en,ar}.json
  - Verify: BootScreens.test.tsx + QueryView tests render en/ar copy, never the raw error
- [ ] **DT2 (P2, human: ~1h / CC: ~10min)** — portal — router wiring: root errorComponent full-page, defaultErrorComponent inline
  - Surfaced by: Issue 1
  - Files: src/hosted/router.tsx
  - Verify: route crash test shows inline card with nav present; root crash shows full page
- [ ] **DT3 (P2, human: ~1h / CC: ~5min)** — portal — focus title on mount
  - Surfaced by: Issue 5
  - Files: BootScreens.tsx, QueryView.tsx
  - Verify: activeElement is the title; Tab reaches Reload
- [ ] **DT4 (P2, human: ~1h / CC: ~10min)** — portal — outermost static bilingual boundary
  - Surfaced by: Issue 6
  - Files: src/hosted/main.tsx
  - Verify: a provider that throws renders ar+en static screen and queues one report
- QA: scenario `crash-screen` (§5) asserts the inline card, nav still present, focus on title, in ar and en.

## Design Review Completion Summary
```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | no DESIGN.md (brand kit); UI = crash screen |
  | Step 0               | 3/10; all 7 passes, text-only (D1)          |
  | Pass 1  (Info Arch)  | 3/10 → 8/10 after fixes                     |
  | Pass 2  (States)     | 4/10 → 9/10 after fixes                     |
  | Pass 3  (Journey)    | 2/10 → 9/10 after fixes                     |
  | Pass 4  (AI Slop)    | 7/10 → 9/10 after fixes                     |
  | Pass 5  (Design Sys) | 4/10 → 9/10 after fixes                     |
  | Pass 6  (Responsive) | 2/10 → 9/10 after fixes                     |
  | Pass 7  (Decisions)  | 1 resolved, 0 deferred                      |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (4 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 0 generated, 0 approved                     |
  | Decisions made       | 6 added to plan                             |
  | Decisions deferred   | 0                                           |
  | Overall design score | 2/10 → 8/10                                 |
  +====================================================================+
```
Unresolved design decisions: none. Outside design voices: skipped (D2).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review`; design voices | Independent 2nd opinion | 1 + 0 | unavailable (eng); skipped (design, D2) | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (mapped to T1–T9) | 8 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 2/10 → 8/10, 6 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** eng plan-review: codex unavailable (not installed; native fallback timed out). Design: outside voices skipped by choice (D2).
- **VERDICT:** DESIGN CLEARED. Eng Review is issues_open (all findings mapped to tasks, 0 unresolved). eng review required

NO UNRESOLVED DECISIONS
