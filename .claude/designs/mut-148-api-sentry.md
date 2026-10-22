# MUT-148: The API server reports unhandled errors to Sentry

Epic MUT-146 · blocked by MUT-147 (merged to local main 60c05f6a, contract 1.1.0) · ADR-091 (+ amendment 5: org `barmajiyat-ltd`)
Status: **plan, awaiting Basel's approval**. No code written.

## Problem

`app.onError` (`server/src/app-shell.ts:42`) logs to pino and nothing else. A failing request is found only when a user complains. Unhandled rejections, a crash in post-roll, and shutdown all leave no trace outside Cloud Logging.

## Acceptance criteria (ticket, plus the ticket comment's)

| # | Criterion | Where it's proven |
|---|---|---|
| A1 | Starts only when `SENTRY_DSN` is set; unset = no SDK at all; config stays fail-fast | `config.test.ts`, `reporter.test.ts` |
| A2 | Reports unknown errors and `ApiError` ≥ 500; never < 500 | `app-shell.sentry.test.ts` |
| A3 | Each event has `request_id`, `release` (pkg version + git SHA), `environment` | same + `reporter.test.ts` |
| A4 | Scrubbing follows the contract; a request with body, cookie, Authorization and API key yields an event with none of them | `sentry-scrub.test.ts` (fixtures + the AC4 case) |
| A5 | Unhandled rejections, and crashes in post-roll and the scripts, are reported | `reporter.test.ts`, `run-script.test.ts` |
| A6 | Shutdown flushes pending events before exit | `shutdown.test.ts` |
| A7 | Dockerfile and deploy.sh pass the release and DSN through; a deliberate error shows up in Sentry | tftest + manual smoke (D5) |
| C1 | Privacy policy: the server's sentence, en + ar (ADR-090 P3) | `qa/specs/web/legal.spec.ts` |
| C2 | DSN read from the Sentry module's state with `terraform_remote_state`; no Sentry token at deploy | `sentry_dsn.tftest.hcl` |
| C3 | Server embeds the rule lists; a test asserts they equal `sentry-rules.json` and runs `sentry-fixtures.json` | `sentry-rules-parity.test.ts` |
| C4 | Add `docs/observability/**` to server-ci `paths` | **moot**: server-ci is `workflow_dispatch` only today. `contracts-ci.yml` already runs on contract changes; add the server parity test to it instead |

## Design

```
server/src/observability/
  sentry-rules.ts       embedded copy of the contract lists (pure data, no imports)
  sentry-scrub.ts       scrubEvent(event, surface) → event | null   (pure, no node:*; the portal/landing can import it in MUT-149/150)
  reporter.ts           ErrorReporter interface + NOOP_REPORTER
  sentry-node.ts        createSentryReporter(opts) — the only file that imports the SDK
  run-script.ts         runScript(name, reporter, fn): report + flush + exitCode=1 on throw
  shutdown.ts           createShutdown({ server, store, reporter, exit, logger })
```

- **Injection, not a global.** `ApiShellDependencies` gains `reporter?: ErrorReporter` (default `NOOP_REPORTER`). `app-shell.ts` is also bundled into the portal's in-browser local mode, so it must never import the SDK. Only `index.ts` and the scripts import `sentry-node.ts`.
- **onError.** Where it already calls `logger.error`, it also calls `reporter.captureException(err, { requestId, route: c.req.routePath, method })`. That is exactly the ≥500 branch and the unknown-error branch; the 4xx `ApiError` and the HTTPException-400 branch stay silent. `route` is the template (`/v1/profiles/:id`), never the raw path.
- **SDK.** `@sentry/node-core` (Sentry's Node SDK without OpenTelemetry), exact version, ≥ 14 days old at install. `defaultIntegrations: false`, then only: inbound filters, function-to-string, linked errors, dedupe, context lines, `onUncaughtException`, `onUnhandledRejection({ mode: 'strict' })`. No http/console/Prisma integrations, so there are no outbound-URL breadcrumbs (Stripe, FX) and no console breadcrumbs. `strict` keeps today's Node 22 behaviour: an unhandled rejection still crashes the process, after the event is flushed.
- **Options from the contract.** `sendDefaultPii: false`, every sample rate from `rules.sdk`, `includeLocalVariables: false`, `beforeSend: scrubEvent(e, 'api')`, `beforeBreadcrumb` drops console, `maxValueLength` stays the SDK default.
- **Release** = `mutaba3a-api@<server package.json version>+<SERVICE_VERSION>` (e.g. `mutaba3a-api@0.4.1+5119667b`). The version is read from `package.json` at boot (the runtime image already copies it). **Environment** = `SENTRY_ENVIRONMENT`, default `NODE_ENV`.
- **Tags** only from `allowedTags`: `surface=api`, `request_id`, `route`, `release`, `environment`. No user context in this ticket.
- **Config.** `SENTRY_DSN` optional, and when set it must be an `https://…@….ingest.de.sentry.io/…` URL (refuses a US DSN at boot, the same rule as the Sentry module's postcondition). `SENTRY_ENVIRONMENT` optional enum.
- **Prisma.** `errorFormat: 'minimal'` in `PrismaLedgerStore.connect` and in the scripts' own `PrismaClient`s (contract `serverPrismaErrorFormat`), so a validation error never prints query input.
- **Shutdown.** Extracted from `index.ts` into `createShutdown`: close server → disconnect store → `await reporter.flush(2000)` → exit. Cloud Run allows 10 s after SIGTERM.
- **Scripts.** `post-roll.ts` and `pre-roll.ts` wrap their body in `runScript`. They run on the operator's machine through the proxy; deploy.sh reads the DSN with `gcloud secrets versions access latest --secret=mutaba3a-api-sentry-dsn` and passes `SENTRY_DSN` to those two steps only. Tag `script=post-roll|pre-roll` (needs adding to `allowedTags`; see D3).

### Infra

- `server/infrastructure/terraform`: `var.sentry_enabled` (default **false**, like `stripe_enabled`). When true:
  - `data "terraform_remote_state" "sentry"` (gcs, prefix `mutaba3a-sentry/production`) → `dsn["api"]`;
  - `google_secret_manager_secret` + version `mutaba3a-api-sentry-dsn`, accessor for the API service account;
  - Cloud Run env `SENTRY_DSN` from that secret, `SENTRY_ENVIRONMENT = production`.
  - False = no env, no secret, no remote-state read, so releases keep working before §1.5 is applied.
- `deploy.sh`: a release guard like Stripe's: refuse a release whose tfvars lacks `sentry_enabled = true` once the secret exists (so a stale tfvars can't silently switch reporting off). `SKIP_SENTRY_GUARD=1` skips it.
- Dockerfile: no change needed (SERVICE_VERSION and package.json already reach the image). AC A7's "Dockerfile passes the release" is met that way; noted in the build notes.
- `docs/operations/before-release.md`: the steps Basel runs (set `sentry_enabled = true` after §1.5, apply, run the smoke).

## Decisions for Basel

- **D1 SDK.** (a) `@sentry/node-core` 10.x, no OpenTelemetry: smaller image, no auto-instrumentation, faster cold start. **(recommended)** (b) `@sentry/node` 11.x: the default package, which loads OpenTelemetry even with tracing off; 11.0 is one month old.
- **D2 DSN storage.** (a) Secret Manager → env, as the observability README and your ticket comment say. **(recommended, matches the docs)** (b) Plain env var: a DSN isn't a secret, and it's in Terraform state anyway.
- **D3 Which scripts report.** (a) post-roll and pre-roll only (the two deploy.sh runs unattended), plus a `script` tag added to `allowedTags` (contract 1.2.0). **(recommended)** (b) also every `users.ts` operator command; you're watching those, and they'd need the DSN in your shell.
- **D4 Smoke test (no staging exists).** (a) `npm run sentry:smoke` from deploy.sh's toolbox: sends one deliberate event with the production DSN and release, through the same scrubber. **(recommended: no new route)** (b) an admin-token-guarded `POST /admin/v1/sentry-test` that throws, proving the real onError path in Cloud Run; it's a new public route in the OpenAPI spec.
- **D5 Privacy wording.** The README's MUT-148/149 sentence also names the portal, which isn't live yet (P3). Publish a server-only variant now and let MUT-149 extend it:
  - `noTracking.body`: remove "crash reporting" from the list, add EN "Our servers send error reports when something breaks on our side, as described under "Error reports". The free apps on Mac, Windows, and in the browser never send them." AR «ترسل خوادمنا تقارير أعطال عند حدوث خلل من جهتنا، كما هو موضّح في قسم «تقارير الأعطال». أما تطبيقاتنا المجانية على Mac وWindows والمتصفح فلا ترسلها أبدًا.»
  - new `errorReports` section: the README's opening paragraph + EN "Our servers send a report when a request fails on our side." AR «ترسل خوادمنا تقريرًا عندما يفشل طلب بسبب خلل من جهتنا.»
  - `sharing.body`: the README's Sentry sentence, as written. Bump "Last updated".

## Tests (TDD: written first, red, then green)

- `config.test.ts`: DSN unset ok; EU DSN ok; `sentry.io` (US) DSN refused; malformed refused.
- `reporter.test.ts`: no DSN → SDK factory never called; DSN → init options equal the contract (`sdk`, integrations list, strict rejection mode); release/environment strings; tags only from `allowedTags`.
- `app-shell.sentry.test.ts` (fake reporter): unknown error → 1 capture with requestId + route template; `ApiError` 500 and 503 → captured; 400/401/404/409/422 and HTTPException 400 → none; the response envelope is unchanged.
- `sentry-scrub.test.ts`: every `api` fixture → exact `expected`; AC4 case (JSON body, `Cookie`, `Authorization: Bearer`, `x-api-key: mut_live_…`) → none of the four values anywhere in `JSON.stringify(event)`; `AbortError` → `null`; frames/release/environment unchanged.
- `sentry-rules-parity.test.ts`: every embedded list deep-equals `docs/observability/sentry-rules.json` at the same `version`. Added to `contracts-ci.yml`.
- `shutdown.test.ts`: order close → disconnect → flush → exit; a flush that times out still exits.
- `run-script.test.ts`: a throwing body → captured with `script` tag, flushed, `exitCode = 1`; success → nothing captured.
- `sentry_dsn.tftest.hcl` (mocked providers): disabled → no `SENTRY_DSN` env and no secret; enabled → env from the secret, accessor IAM present.
- Release-QA: `qa/features/web/legal.yaml` gains `privacy-error-reports` (EN + AR: the section exists, names servers only, not the portal or the phone); one tagged spec in `qa/specs/web/legal.spec.ts`. Server internals have no user-visible flow; the smoke (D4) is the manual proof, recorded in the before-release steps.

Commands: `npm --prefix server run typecheck|lint|openapi:check`, `npm --prefix server test`, repo-root `npm run lint|typecheck|test:run|build` (Node 22), `terraform -chdir=server/infrastructure/terraform test`, `release-qa run --attach --only privacy-error-reports`, `release-qa lint`.

## Impact and cost

- **Runtime.** One SDK import at boot; `beforeSend` runs only on a real 5xx (8 KB cap, ~20 ms worst case). Nothing on the request hot path.
- **Quota.** The api key's daily cap is 60. A crash loop loses only the api's own day.
- **Image.** node-core adds a few MB; OTel would add more (D1).
- **i18n/RTL.** Only the privacy strings (en + ar); amounts in them: none.
- **Infra.** One secret, one remote-state read, all behind `sentry_enabled = false` by default.
- **Reuse.** `sentry-scrub.ts` is the first full-event scrubber; MUT-149/150 import it from `server/src` the way the portal already imports `repositories/memory.js`, so there's no second JS copy. That keeps it free of `node:*` imports.

## Out of scope

User context on events, performance tracing, portal/landing/phone (MUT-149..151), alert changes (MUT-147 owns them).

## Business / product impact

- Hosted failures surface in Sentry within a minute, with the request ID that finds the log line, before a pilot user has to report them.
- First surface of MUT-146; it unblocks nothing hard, but it is a pilot-readiness item under MUT-322 (MUT-148 blocks it).
- Low risk: everything is off until `sentry_enabled = true`, and the event can carry no firm data by construction.

---

# Eng review (plan-eng-review, 2026-10-22)

Target: this plan. Probes: Hono `c.req.routePath` inside `onError` returns the template (`routePath=/v1/profiles/:id path=/v1/profiles/abc`, Hono in server/node_modules); `contracts-ci.yml` installs only the root package and runs root `scripts/__tests__`; the Sentry module's `dsn` output is `sensitive = true`; `deploy.sh:83` refuses any `git status --porcelain` output, untracked files included.

## Findings

1. [P1] (confidence 9/10) Plan D4(a), "npm run sentry:smoke … sends one deliberate event with the production DSN": run from the operator's laptop, it proves the DSN and scrubber but **not** that Cloud Run received `SENTRY_DSN` (AC A7's real risk: the env never mounted). → decision D4.
2. [P2] (9/10) Plan "sentry-rules-parity.test.ts … Added to contracts-ci.yml": contracts-ci runs `npm ci` at the root only (`contracts-ci.yml:33-38`), so a server-workspace test can't run there. **Fix applied (placement only, same contract):** the parity + fixture test is `scripts/__tests__/sentry-server-scrub.test.ts`, importing the pure `server/src/observability/sentry-scrub.ts` and `sentry-rules.ts` (the portal already imports pure server modules the same way), and it joins the contracts-ci list.
3. [P2] (8/10) Plan D3(a), "a `script` tag added to `allowedTags` (contract 1.2.0)": a contract bump also means re-pinning and copying both files into the Flutter repo (README "Changing the contract" step 4). The stack frames (`post-roll.ts`) already name the script. → decision D3: recommend no new tag, no contract bump.
4. [P2] (8/10) `app-shell.ts` is bundled into the portal's in-browser local mode (`src/hosted/local/*` import `server/src/app.js`). ADR-091 says the local app never reports. **Required proof added:** a root test asserts the hosted build output contains no `@sentry/` string and that `app-shell.ts`'s import graph never reaches `sentry-node.ts`.
5. [P2] (8/10) Plan "release guard like Stripe's": with `sentry_enabled` back to false, Terraform would **destroy** the DSN secret. **Fix applied:** reuse `scripts/lib/release-guard.sh` (the Stripe guard), no new guard code path.
6. [P3] (7/10) `errorFormat: 'minimal'` changes Prisma's error text in pino logs too. Intended (D4 of MUT-147); the build runs the full server suite and notes it in CHANGELOG.
7. [P3] (6/10, medium confidence, verify at build) `onUnhandledRejectionIntegration({ mode: 'strict' })` and `onUncaughtExceptionIntegration` exit the process themselves after flushing; the SIGTERM shutdown path must not double-exit. Covered by `shutdown.test.ts` + a reporter-options assertion.

Complexity: about 22 files touched or added, 6 new modules → structure question (D1 below).

## Decision ledger

- **D1 Structure.** Original: 6 modules (`sentry-rules`, `sentry-scrub`, `reporter`, `sentry-node`, `run-script`, `shutdown`). Smaller: 4 modules: `runScript` goes into `reporter.ts` (it only needs the interface), and `createShutdown` into `sentry-node.ts`'s neighbour `lifecycle.ts`… → **Recommended: smaller (4 files: sentry-rules, sentry-scrub, reporter [+runScript], sentry-node [+flushOnShutdown helper])**, same behaviour and tests. State: pending.
- **D2 SDK.** (a) `@sentry/node-core` 10.x, no OpenTelemetry **(recommended)**; (b) `@sentry/node` 11.x. State: pending.
- **D3 Scripts.** post-roll + pre-roll report; no new tag, no contract bump; DSN from Secret Manager via gcloud in deploy.sh **(recommended)**; vs also users.ts commands. State: pending (default if unanswered: recommended).
- **D4 Smoke.** (a) laptop CLI event; (b) admin-token route that throws inside Cloud Run; (c) **(recommended)** `/health` gains `errorReporting: "on"|"off"` (no DSN, no detail) checked by `smoke.ts` after each roll, plus the laptop CLI event for the scrubber path. State: pending.
- **D5 Privacy wording.** Server-only sentence now, MUT-149 extends **(recommended)**; vs README text as is. State: pending.
- DSN storage: Secret Manager, as already recorded in the observability README and the ticket comment (prior approval). No question.

## Answers (Basel, 2026-10-22)

- D1 Structure → **4 files**: `sentry-rules.ts`, `sentry-scrub.ts`, `reporter.ts` (interface, `NOOP_REPORTER`, `runScript`), `sentry-node.ts` (SDK init, `flushOnShutdown`). Approved.
- D2 SDK → **`@sentry/node-core` 10.x**, exact pin, at least 14 days old at install. Approved.
- D3 Scripts → not asked; **recommended default recorded**: post-roll + pre-roll report; no new tag, no contract bump; deploy.sh fetches the DSN with `gcloud secrets versions access` for those two steps only. Basel can override at /eng-build.
- D4 Smoke → **/health flag + laptop event**: `/health` adds `errorReporting: "on" | "off"` (OpenAPI change → API minor bump `-mut148`, `openapi:check`), `smoke.ts` asserts `"on"` once `sentry_enabled` (deploy.sh passes the expectation), plus `npm run sentry:smoke` (operator, one event through the real scrubber). Approved.
- D5 Privacy → **server-only wording now**, en + ar as drafted above; MUT-149 extends it. Approved.

## Build notes (eng-build, 2026-10-22)

- **SDK entry.** `@sentry/node-core/light` 10.76.2 (published 2026-10-08). node-core's OpenTelemetry peers are optional and not installed; `light` runs without them. A probe confirmed init, capture and an injected transport.
- **`server_name`.** Not in the plan: the SDK sends the host name by default, which on the operator's laptop (pre-roll, post-roll) is a person's name. Fixed to `mutaba3a-api`, with a test.
- **D1 placement.** `shutdownAndFlush` lives in `reporter.ts` beside `runScript`, not in `sentry-node.ts`: it needs only the interface. Still 4 files.
- **Script reporter.** `createScriptReporter(env)` reads `SENTRY_DSN`, `SENTRY_ENVIRONMENT` and `SERVICE_VERSION` and gives the DSN the server config's EU check (`SENTRY_EU_DSN`, now exported).
- **Unparseable body.** The shell answers the validator's 400 as 422 VALIDATION_FAILED, which isn't reported (test corrected).
- **API version.** 1.47.0-mut148, because main took 1.46.0 (MUT-255) and MUT-388 claims 1.45.0.
- **First release with `sentry_enabled = true`.** The DSN secret appears in step 4, so pre-roll (step 3) warns and runs unreported; post-roll gets the DSN.
- **TD-199.** "Not configured" 503s are reported (the AC's literal rule); a bot can spend the 60/day cap.
- **Hosted bundle.** The import-graph test guards it permanently. At the gate, `npm run build:hosted` was also grepped once: 0 files with `@sentry` or `ingest.de.sentry`. There is no `check-bundles` rule yet (TD-084, MUT-149/150).
- **Gate (2026-10-22, Node 22, merged tree).**
  - Root: lint 0 errors (2 existing warnings); typecheck clean; test:run 414 files, 5775 passed, 4 skipped; build OK.
  - Server: typecheck, lint and openapi:check clean; test 141 files, 2881 passed, 40 skipped (Postgres-only).
  - Terraform: GCP 40/40, Sentry 15/15.
  - Release-QA: `web.legal.privacy-error-reports`, `privacy-linked-language` and `links` pass; lint shows no errors.
  - `deploy-bootstrap.test.ts` timed out once under a full parallel run earlier, passed on its own, and didn't recur at the gate.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| Eng review | /eng-ticket MUT-148 | planning gate | 1 | DONE | 7 (2 fixed in plan, 1 required proof added, 4 resolved by D1–D5) |
| Outside voice | default-on | second opinion | 0 | SKIPPED | not run this session (missing coverage) |

VERDICT: plan approved for /eng-build with D1–D5 as above.

**UNRESOLVED DECISIONS:**
- D3 was not asked; the recommended default stands unless Basel overrides it.
