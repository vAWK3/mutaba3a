# MUT-197 — Spam protection for the `/hosted` request form: Cloudflare Turnstile behind a verifying Netlify Function

Status: **Planned, eng-reviewed (2026-10-14), NOT built.** Revised after the outside voice (see the end of this file: C1, H1–H3, M1–M5 are folded into §2/§3 below). Basel's own ticket text: "Build this ticket only if spam actually shows up." One decision (D1, the delivery channel) is a vendor choice with privacy-policy and cost consequences, so the build waits for Basel on both counts. Branch `feature/mut-185-go-hosted` (epic worktree).
Ticket: MUT-197 (Task) · epic MUT-185 · follows MUT-186 (merged a7d5068). Siblings MUT-187, MUT-188, MUT-172: all merged. Related: INFRA.md §1 operator steps (Forms spam tab, usage alert).
Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · Backlog = planning allowed · finished → In Review after /qa-reconcile.

## 1. Problem and acceptance criteria

The form posts to Netlify Forms at `/__forms.html`: anonymous, no CAPTCHA, no rate limit. A scripted flood can exhaust the 100-a-month allowance, bury real requests, and email Basel attacker-written text. Netlify Forms can verify reCAPTCHA only (a Google script on a page that promises no tracking); it cannot verify Turnstile, and a function on the form's POST path stops Netlify's own form handling. So Turnstile means replacing Netlify Forms with a function that verifies and delivers.

| # | AC (ticket) | Proved by |
|---|---|---|
| A1 | A request without a valid Turnstile token is refused by the function, never delivered | `hosted-request.test.ts`: missing token → 400, siteverify never called, deliver never called; invalid token (siteverify `success:false`) → 403, deliver never called |
| A2 | A request with a valid token is delivered with every field `hostedRequest.ts` defines today, `request-id` included | same test: valid token → deliver called once with `name, email, phone, profession, devices, message, language, request-id`; `encodeHostedRequest`'s field list is the single source (the function imports it) |
| A3 | The public Netlify Forms endpoint is no longer the delivery path: retire `__forms.html` and its twin plugin | `vite-config.test.ts`: no `mutaba3a:netlify-forms` plugin, no `__forms.html` in the bundle, `PWA_WORKBOX.globIgnores` no longer lists it; `hostedRequest.ts` loses `NETLIFY_FORMS_*`; `HostedRequestForm` posts to the function |
| A4 | Privacy policy updated in EN and AR | `landing.privacyPolicy.hostedRequest.body` names Cloudflare (Turnstile) and the delivery processor; `PrivacyPolicyPage.test.tsx`, `hostedOfferKeys.test.ts` |
| A5 | Tests cover token missing, invalid and valid; QA covers the widget in EN and AR | function unit tests (A1/A2); `HostedRequestForm.test.tsx` (send disabled until a token, token sent, error on 403); QA `@web.landing.hosted` extended with Turnstile's always-pass test site key |

## 2. Where it goes

| File | Change |
|---|---|
| `netlify/functions/hosted-request.ts` (new) | Netlify Functions v2 handler (`export default async (req: Request) => Response`). Declares its route with `export const config = { path: '/api/hosted-request' }` (no `netlify.toml` redirect, M3). Accepts `POST` `application/x-www-form-urlencoded` only, read with `await req.formData()`: the page keeps sending exactly what `encodeHostedRequest` emits today plus Turnstile's own `cf-turnstile-response` field (M2), so the field list stays the single source; a zod shape check (zod is a root dependency) runs before `validateHostedRequest`, which would otherwise `.trim()` a non-string; rejects a filled honeypot (silently 200, nothing delivered, like Netlify did); runs `validateHostedRequest` (imported from `src/pages/landing/hostedRequest.ts`, which already imports nothing from React or the DOM); then `verifyTurnstile({ secret: TURNSTILE_SECRET, token, remoteip })` → `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`; on `success` calls `deliver(values)` (D1). Responses: 400 (bad JSON, validation, no token), 403 (token refused), 502 (siteverify or delivery unreachable), 200 `{ ok: true }`. The handler takes `fetch` and `env` through a factory (`createHandler({ fetch, env })`) so tests inject both, and receives Netlify's `context` as the second argument for `context.ip` (`remoteip`, L1); the file's default export is `createHandler(globalThis)`. Time budget inside Netlify's 10 s synchronous limit: `siteverify` 3 s, delivery 5 s, both with `AbortController`. |
| `netlify/functions/lib/turnstile.ts` (new) | `verifyTurnstile(fetchImpl, secret, token, remoteip?) → { ok, errorCodes }`. Pure; 5 s timeout via `AbortController` (the pattern in `hostedRequest.ts`). |
| `netlify/functions/lib/deliver.ts` (new) | D1's channel behind one `deliver(values, env, fetchImpl)` function, so the channel can change without touching the handler. |
| `netlify.toml` | `[functions] directory = "netlify/functions"`, `node_bundler = "esbuild"`. No redirect: the function declares its own path (M3). `navigateFallbackDenylist` already covers `/api/` (L4). |
| `src/pages/landing/hostedRequest.ts` | Replace `NETLIFY_FORMS_PATH`/`NETLIFY_FORMS_FILE` with `HOSTED_REQUEST_ENDPOINT = '/api/hosted-request'`; `submitHostedRequest(values, token, fetchImpl)` posts the same urlencoded body as today plus `cf-turnstile-response` (M2) and maps 403 → `'refused'` (a new result beside `'ok' | 'error'`), so the form can say "the check didn't pass, try again" rather than "try again later". `encodeHostedRequest` stays (it is the field contract A2 relies on); `HONEYPOT_FIELD` stays. |
| `src/pages/landing/components/HostedRequestForm.tsx` | A `<div class="cf-turnstile">` container rendered explicitly: the widget script `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` is loaded once on mount (a tiny `useTurnstile(siteKey, language)` hook: injects the script, calls `turnstile.render(el, { sitekey, language, theme: 'auto', callback, 'expired-callback', 'error-callback' })`, re-renders on language change, removes on unmount). Send stays disabled until a token exists; an expired token re-disables it. Site key from `__TURNSTILE_SITE_KEY__` (D4: the test key outside Netlify production, a real key required there). If the script fails to load (ad blocker), `error-callback` shows `form.checkUnavailable` and Send stays disabled. |
| `vite.config.ts` | Remove `netlifyForms()`, `NETLIFY_FORMS_FILE` from `PWA_WORKBOX.globIgnores`, and the `hostedRequest` imports it needed; add `__TURNSTILE_SITE_KEY__` per D4 (`turnstileSiteKey(env)`: test key by default, a real key required when `CONTEXT === 'production'`; desktop `""`). |
| `src/vite-env.d.ts` | `declare const __TURNSTILE_SITE_KEY__: string;` |
| `scripts/bundle-origins.json` | `local`: add `https://challenges.cloudflare.com` (a script origin: reviewed, it is the first third-party script on the landing). |
| `src/pages/landing/__tests__/hostedRequestImports.test.ts` (new) | pins that `hostedRequest.ts` imports nothing from React or the DOM (three consumers now: page, Vite config, function; M3). |
| `src/lib/i18n/translations/{en,ar}.json` | `landing.hostedOffer.form.{check, checkFailed, unavailable}`; `landing.privacyPolicy.hostedRequest.body` rewritten (A4): what Cloudflare receives for the check (IP, browser details, no form contents; only once you use the form), what the delivery processor receives (D1), and that requests are no longer stored by Netlify; `scope.body`, `network.body`, `sharing.body` and `noTracking.body` lose their Netlify/Akismet sentences and gain Cloudflare (M1; `PrivacyPolicyPage.test.tsx:51-67` and `hostedOfferKeys.test.ts:33` pin the old wording and change with it); `landing.privacyPolicy.updated` bumped. |
| `.env.example`, `.claude/INFRA.md` | `TURNSTILE_SITE_KEY` (build-time, web; test key by default, real key required in Netlify production), and in Netlify's UI: `TURNSTILE_SECRET` and D1's credential, both marked secret with Functions scope; the site key must **not** be marked secret (it is inlined into `dist-web`; L2). INFRA §1: the Forms operator steps become "retired on <date>"; new steps: create the Turnstile widget (managed mode; hostnames `mutaba3a.netlify.app`, `*--mutaba3a.netlify.app` deploy previews, `localhost`, and the custom domain later), set the env vars, set D1's credential and its sending domain (H1), delete the old `hosted-request` form after the retention window (form detection may stay on until the first deploy without the twin; turning it off is cleanup, L4). **The trigger for building (M5):** the Spam tab shows 5+ entries in a week, or spam consumes half the month's allowance. |
| Tests | `netlify/functions/__tests__/hosted-request.test.ts` (node env; A1, A2, honeypot, bad JSON, siteverify timeout → 502, delivery failure → 502); `turnstile.test.ts`; `deliver.test.ts`; `hostedRequest.test.ts` updated (endpoint, token, `'refused'`); `HostedRequestForm.test.tsx` (widget container present, Send disabled until the token callback fires, token sent, 403 → refused copy, expired → disabled again); `vite-config.test.ts` (plugin gone, define present); `vite.config` snapshot updated deliberately; `PrivacyPolicyPage.test.tsx`. `vitest.config.ts` `include` gains `netlify/**/__tests__/**` and the function tests carry `// @vitest-environment node` (H2: today's include is `src/**` and `scripts/**`, so they would never run). `qa/specs/web/landing.spec.ts` `@web.landing.hosted`: hermetic (M4): `page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*')` serves a fake `window.turnstile` whose `render` calls back with `qa-token` and whose `reset` is counted; the function is stubbed by `page.route('**/api/hosted-request')` as `__forms.html` is today; the retry path asserts a `reset` happened and a second token was sent (C1). No real Cloudflare traffic in QA. |
| Knowledge | ADR (new): "the request form is delivered by a verifying Netlify Function, not Netlify Forms" with D1; CHANGELOG; COMPONENT_REGISTRY (`HostedRequestForm`, `hostedRequest.ts`, the function); PATTERNS (Netlify Function with injected fetch/env); TEST_PLAN; TECH_DEBT (TD-131 unchanged). |

Nothing in `server/` changes **unless D1 picks the server**.

## 3. Decisions

- **D1 — Delivery channel (OPEN, Basel's call).** The function must hand the request to something Basel reads. Options:
  - **(a) An email API from the function** (Resend or Postmark; EU-region sending; free tiers cover this volume). The function sends one email per request to Basel's address with the same fields Netlify Forms emailed, and a `Reply-To` of the visitor. *Pros:* Basel's workflow stays email-first (the "2 working days" promise depends on seeing requests arrive); nothing in `server/`; one secret in Netlify. *Cons:* a new processor to name in the privacy policy and a DPA to accept; a third vendor account. **Recommended**, because the promise is a reply within two working days and email is the only channel Basel watches. **Prerequisites and trade-offs (outside voice H1):** a verified sending domain is needed before any mail goes out, and `mutaba3a.app` has no DNS yet (MUT-112), so a sending subdomain is a prerequisite of (a), not an afterthought; Resend offers an EU region (opt-in), Postmark is US-hosted. Email-only delivery **stores nothing**: a delivery failure answers 502, the visitor sees the retry state, and nothing is kept anywhere; Akismet filtering, the Spam tab and the retention UI all go away. Accepting that is part of choosing (a).
  - **(b) The Mutaba3a server as the inbox.** A new `POST /ingest/hosted-requests` outside `/v1` (bearer `HOSTED_REQUEST_INGEST_TOKEN`, the `/admin/*` pattern), a `hosted_requests` table (Prisma migration), `GET /admin/v1/hosted-requests` + an `npm run` wrapper, and a `warn`-level log line that Basel turns into a Cloud Monitoring email alert by hand. *Pros:* no new vendor; Google Cloud is already in the policy; retention can be automated. *Cons:* server migration, OpenAPI bump, admin route, a log-based alert that is an operator step, and Basel reads requests through a CLI instead of his inbox.
  - **(c) Keep Netlify Forms and have the function forward to it:** rejected; the public `/__forms.html` endpoint stays reachable, which is the problem (A3).
- **D2 — Turnstile in explicit render mode, keyed to the page language**, so the widget reads Arabic on the Arabic page (the ticket's "rendered in the page language"). Managed mode: Cloudflare decides when to show an interactive challenge. **The script loads on the visitor's first interaction with the form** (focus or pointerdown), never on page load (outside voice M1, supersedes the review's in-view idea): readers, crawlers and bounces never contact Cloudflare, which keeps the privacy policy's "only when you use the form" nearly true and shrinks the copy change. `turnstile.render` runs from the script's `onload` callback (L3). **After every submit outcome (success, error, refused, client timeout) the hook calls `turnstile.reset()` and Send goes back to disabled until a fresh token arrives; the success panel unmounts the form, so the token state is cleared on remount** (C1: tokens are single-use and live 300 s; a reused token answers `timeout-or-duplicate`).
- **D3 — The form's path, not the widget, is the gate.** The token is verified server-side in the function; the page only collects it. Anyone posting straight to `/api/hosted-request` without a valid token gets 403, which is the whole point.
- **D4 — Misconfiguration fails closed, without breaking local builds (H3).** `TURNSTILE_SITE_KEY` defaults to Turnstile's always-pass test key (`1x00000000000000000000AA`) everywhere except a Netlify **production** build (`process.env.CONTEXT === 'production'`), where a missing or test key fails the build. So `npm run dev`, `build:web`, `test:bundles` and QA need no env var, and production can never ship the test key or a dead form. In the function, a missing `TURNSTILE_SECRET` answers 500 before any delivery. `vite-config.test.ts` covers both branches.
- **D5 — Retire, don't disable.** `__forms.html`, the `netlifyForms()` plugin and the workbox ignore are removed, not flagged off; the old form is deleted in Netlify's UI after the 12-month retention window (INFRA).
- **D6 — Privacy copy names the processors** (Cloudflare for the check; D1's processor for delivery) and says what each receives. The "no tracking" paragraph stays true: Turnstile is a bot check, not analytics, and the policy says so in one sentence.

## 4. Tests (written first)

See the Tests row in §2. Gate (Node 22): `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`, `npm run test:bundles` (new origin), `release-qa lint`, Playwright `@web.landing.hosted*`. If D1 = (b): the server gate (`npm --prefix server run typecheck|lint|openapi:check|test`) too.

## 4b. QA scenarios (release-qa, `qa/features/web/landing.yaml` → `hosted`, `hosted-375`, plus a new `hosted-check`)

| Flow | Steps, as the user would say them | Promised outcome |
|---|---|---|
| Ask for an account with the bot check | Open `/hosted`, fill the form, wait for the check to pass, press Send; same in Arabic | Send is disabled until the check passes; the check reads in the page language; a sent request shows the success state; a refused check shows "the check didn't pass, try again" and keeps the answers |

## 5. Reuse analysis

| Need | Reused | New |
|---|---|---|
| Field contract and validation | `hostedRequest.ts` (`HOSTED_REQUEST_FIELDS`, `validateHostedRequest`, `encodeHostedRequest`) | — |
| Timeout pattern | `AbortController` + `setTimeout` (`hostedRequest.ts`, `useLatestRelease.ts`) | — |
| Build-time value with a typeof guard | ADR-076 shape | `__TURNSTILE_SITE_KEY__` |
| Form states | `HostedRequestForm` `idle → sending → success \| error` | `refused` |
| Bundle gate | `bundle-origins.json` | one origin |

## 6. Scope check

Covers A1–A5. Accepted regressions versus Netlify Forms (H1): no stored copy of a request on Netlify, no Akismet content filter, no Spam tab, no retention UI; Turnstile stops scripts, not humans or solver farms, so attacker-written text can still arrive (M5). Out: rate limiting beyond Turnstile (Netlify's rate-limit rules are a paid feature; (b) would add the server's limiter), a custom domain (MUT-112), any change to the request fields.

## 7. What Basel must decide or do before the build

1. **Is spam showing up?** The ticket says build only then. Today's operator steps (INFRA §1) stand.
2. **D1:** email API (which vendor; recommended Resend or Postmark, EU) or the server inbox.
3. Create the Turnstile widget in Cloudflare, set `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` in Netlify, and the delivery credential.

Business / product impact
- Keeps the funnel's only inbox usable under abuse: a flood today could exhaust the 100-a-month Forms allowance and bury real requests, which are the leads this epic exists to collect.
- Epic MUT-185: the last child; conditional by Basel's own decision.
- Cost: one third-party script on the landing (Cloudflare), one more processor in the privacy policy, and under (a) a free-tier email account; the retired Forms twin removes Netlify from the processor list.

---

# Eng review (/plan-eng-review, 2026-10-14, non-interactive by Basel's instruction; plan only, no build)

Target: this plan. Reviewer: Claude (native) + an in-host Plan subagent as the outside voice (Codex not installed). D1 is deliberately left open for Basel; everything else below was decided on the recommended option and is listed under "Unresolved decisions".

## Scope Challenge

**A. Assess.** Already solving each sub-problem: `hostedRequest.ts` (fields, validation, encoding, timeout pattern), `HostedRequestForm` states, the ADR-076 define shape, the bundle gate, the landing QA harness with its `page.route` stub. Complexity: ~16 files, 3 new modules (`netlify/functions/hosted-request.ts`, `lib/turnstile.ts`, `lib/deliver.ts`), 1 new tsconfig. Search check: Netlify Functions v2 (`Request`/`Response` handlers, esbuild bundling, `netlify.toml [functions]`) and Turnstile (explicit render, `siteverify`, 300 s token life, the always-pass test key pair) are in-distribution; no Aside search run. TODOS.md: nothing overlaps. Distribution: functions deploy with the Netlify site build; no CI change; env vars set in Netlify's UI (`TURNSTILE_SECRET`, D1's credential) and at build (`TURNSTILE_SITE_KEY`).

**B. Complexity gate** (16 files, 3 new modules): structure question, **auto-decided → Original arrangement** (handler + two small libs is the smallest shape that keeps the verifier and the delivery channel testable with injected `fetch`; folding them into one file would couple D1's vendor call to the handler test).

**C. Findings**

| # | Sev | Conf | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S1 | P1 | 9/10 | plan §2 tests / `package.json:16` | `npm run typecheck` is `tsc -p tsconfig.app.json && tsc -p tsconfig.hosted.json`; `tsconfig.app.json` includes `src` only and `tsconfig.node.json` only `vite.config.ts`. A `netlify/functions` directory would never be type-checked, and `eslint .` would lint it with the React app's rules. | **accepted (R1)**: add `tsconfig.netlify.json` (`include: ["netlify"]`, `lib: ["ES2022", "DOM"]` for `Request`/`Response`, `types: ["node"]`, `skipLibCheck`) to the typecheck script, and an ESLint block for `netlify/**` without the React/hooks plugins |
| S2 | P2 | 9/10 | plan §2 tests | There is no `HostedRequestForm.test.tsx`; the form's states are tested through `HostedOfferPage.test.tsx` (renders under `LandingProviders`). | **accepted (factual)**: extend `HostedOfferPage.test.tsx` instead of creating a parallel file; the Turnstile script loader is stubbed by defining `window.turnstile` in the test |
| S3 | P2 | 8/10 | plan §2 `HostedRequestForm` | The widget script is loaded on mount of the form section; the page's LCP measurements (MUT-102 D2, TD-079) are sensitive to third-party scripts on first paint. | **accepted (R2)**: load the script lazily, on the form's first focus or when the form section enters the viewport (`useInView` exists), never on page load |

Result: **scope accepted as-is** (D1 open). MODE = FULL_REVIEW.

## Decision ledger

### R1: type-check and lint coverage for `netlify/`
Factual correction, one necessary addition: `tsconfig.netlify.json` + typecheck entry + an ESLint block. No question. State: approved.

### R2: when the Cloudflare script loads
Finding: S3, P2, 8/10, Claude. Plan baseline: on mount.
Comparison grid:

| Choice | Current | A) On mount | B) Lazily, on form focus or in-view |
|---|---|---|---|
| R2 load | — | ~40 KB third-party script on every `/hosted` load | loaded only when the visitor reaches the form |
| Fail-closed, token flow, tests | fixed | same | same |

Question D1-r: Load Turnstile on page load or on first approach to the form?
Header: Script timing
Options:
A) On mount ✅ simplest ✅ token ready before the visitor finishes typing ❌ a third-party script on first paint of a marketing page that is measured for LCP.
B) Lazily (recommended) ✅ `/hosted` first paint unchanged for readers who never submit ✅ the widget still has seconds to render while the visitor types ❌ a `useInView` wiring and one more test case.
Completeness: A=10/10, B=10/10.
State: approved. Actual answer: B (auto). Accepted scope: `useTurnstile` starts loading when the form section is in view or focused.

### D1 (delivery channel): **pending, Basel's call** (vendor, privacy policy, cost). Not auto-decided.

Approval readiness: PASS for R1/R2/S2; **D1 pending by design**, so the build cannot start until Basel answers.

## 1. Architecture review
- **[P1] (9/10)** netlify/ outside every TS program → R1.
- Boundaries: the function is a new deployable unit on Netlify beside the static site; it imports one pure module from `src/` (`hostedRequest.ts`, no React/DOM); nothing of the app is reachable from it. The server is untouched unless D1 = (b).
- Data flow: browser → `POST /api/hosted-request` (JSON + token) → function → `siteverify` (Cloudflare) → `deliver` (D1) → 200/403/502. Secrets live only in Netlify's function env; the site key is public by design.
- Security: the function is the only path to delivery; the honeypot stays as a cheap first filter; Turnstile tokens are single-use and bound to the site key. No rate limiter in the function (stateless); Turnstile's challenge is the throttle. If D1 = (b), the server's `SlidingWindowRateLimiter` adds a second layer behind the ingest token.
- One production failure per path: Cloudflare `siteverify` down → 502, the form shows the retry state (same as today's Netlify outage behaviour); D1's vendor down → 502, nothing lost on the visitor's side, but the request is lost unless the function retries; **the plan should queue nothing** (no store on Netlify's free tier) and instead let the visitor retry, which the form already supports.
- Distribution: functions build with the site; `netlify.toml [functions]`; the redirect to `/api/hosted-request` keeps the page free of the `/.netlify/` path.

## 2. Code quality review
- **[P2] (9/10)** no `HostedRequestForm.test.tsx` → S2.
- Shared code: `validateHostedRequest`/`encodeHostedRequest` reused by the function (two callers: page and function; the contract already exists; no extraction needed). `verifyTurnstile` and `deliver` are the two seams.
- Error handling: every non-200 maps to a form state; the `refused` state is new and needs copy in both languages (in §2).
- Debt: the `__forms.html` machinery is removed, not kept behind a flag (D5), so no dead code remains.

## 3. Test review
Framework: Vitest (node env for the function), Playwright QA.

```
CODE PATHS                                                        USER FLOWS
[+] netlify/functions/hosted-request.ts                           [+] Ask with the bot check
  ├── [GAP→new] non-POST / bad JSON → 400                           ├── [GAP→new][→E2E] Send disabled until the token — HostedOfferPage.test + QA
  ├── [GAP→new] honeypot filled → 200, no delivery                  ├── [GAP→new] token sent with the fields — hostedRequest.test
  ├── [GAP→new] validation fails → 400                              ├── [GAP→new] 403 → "check didn't pass" copy, answers kept — HostedOfferPage.test
  ├── [GAP→new] no token → 400, siteverify not called               ├── [GAP→new] expired token → disabled again — HostedOfferPage.test
  ├── [GAP→new] siteverify false → 403, no delivery                 ├── [GAP→new][→E2E] AR widget language — QA hosted
  ├── [GAP→new] siteverify timeout → 502                            └── [★★★ TESTED] success / error / retry states — HostedOfferPage.test (exists)
  ├── [GAP→new] delivery fails → 502
  └── [GAP→new] valid → deliver once with every field + request-id [+] Build
[+] lib/turnstile.ts                                                ├── [GAP→new] no netlify-forms plugin, no __forms.html, workbox ignore gone — vite-config
  └── [GAP→new] request shape (secret, response, remoteip), result   ├── [GAP→new] __TURNSTILE_SITE_KEY__ define, desktop "" — vite-config
[+] HostedRequestForm (useTurnstile)                                 └── [GAP→new] challenges.cloudflare.com allowlisted — test:bundles
  ├── [GAP→new] no site key → no widget, Send disabled, note
  ├── [GAP→new] script loaded lazily (R2)
  └── [GAP→new] language change re-renders the widget
COVERAGE (before build): 1/20 | after the planned tests: 20/20 | GAPS: 19 (2 E2E)
```
Regression rule: the existing success/error/retry cases in `HostedOfferPage.test.tsx` and the honesty test stay untouched; `@web.landing.hosted` keeps its states and gains the token. Tests made obsolete: the `__forms.html` twin tests in `vite-config.test.ts` (retire with the plugin, D5).

## 4. Performance review
- Script weight: Turnstile's loader is ~40 KB; R2 keeps it off first paint. The function's cold start (esbuild bundle, no heavy deps) is well under a second; the form's 15 s timeout covers it.
No other issues.

## NOT in scope
- Rate limiting beyond Turnstile; a queue for failed deliveries; the custom domain; any field change; automating the 12-month retention (unless D1 = (b), where it becomes a cron later).

## What already exists
- `hostedRequest.ts` contract and timeout pattern; `HostedRequestForm` states; `HostedOfferPage.test.tsx` state cases; `useInView`; ADR-076 define shape; `bundle-origins.json`; `qa/specs/web/landing.spec.ts` `@web.landing.hosted` with its route stub; INFRA §1 operator steps to retire.

## Failure modes
| Path | Failure | Handling | User sees |
|---|---|---|---|
| Cloudflare script blocked (ad blocker) | widget never renders | `error-callback` → "the check couldn't load" note; Send stays disabled | a clear note, no silent failure (**must be in the plan's copy keys**: added as `form.checkUnavailable`) |
| `siteverify` down | 502 | retry state | retry |
| delivery vendor down | 502 | retry state | retry; nothing delivered, nothing lost client-side |
| secret missing in Netlify | 500 | fail closed | retry state; operator alert is a Netlify function log |
Critical gaps: 0 (the ad-blocker case is handled once the copy key exists).

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity.

## Implementation Tasks (not started)
- [ ] **T0 (P0)** — Basel — answer D1 and confirm spam is showing up; create the Turnstile widget; set `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET` and D1's credential in Netlify
- [ ] **T1 (P1, human: ~3h / CC: ~20min)** — netlify/functions — handler, `turnstile.ts`, `deliver.ts`, `tsconfig.netlify.json`, ESLint block, unit tests — Verify: `npx vitest run netlify`
- [ ] **T2 (P1, human: ~3h / CC: ~20min)** — form — `useTurnstile` (lazy, language-aware), token flow, `refused`/`checkUnavailable`/`unavailable` copy EN/AR, `__TURNSTILE_SITE_KEY__` define, fail-closed — Verify: `npx vitest run src/pages/landing scripts/__tests__/vite-config.test.ts`
- [ ] **T3 (P1, human: ~1h / CC: ~10min)** — retire Netlify Forms — plugin, workbox ignore, constants, twin tests; `netlify.toml` functions + redirect; `bundle-origins.json` — Verify: `npm run test:bundles`
- [ ] **T4 (P1, human: ~1h / CC: ~10min)** — privacy + INFRA + ADR + knowledge files — Verify: `PrivacyPolicyPage.test.tsx`, `hostedOfferKeys.test.ts`
- [ ] **T5 (P2, human: ~1h / CC: ~10min)** — QA — `@web.landing.hosted` with the always-pass site key; `hosted-check` feature — Verify: Playwright on a built preview

## Unresolved decisions that may bite you later
- **D1 (delivery channel)**: pending, Basel's call. Recommended (a) email API (Resend or Postmark, EU).
- R2 (lazy script load) and the original arrangement: auto-decided; overturn if wrong.
- Whether to build at all now: Basel's own condition (spam showing up).

## Suppressed findings (appendix)
- (4/10) Netlify's free tier has function invocation limits (125k/month); irrelevant at this volume.
- (3/10) The `/api/*` redirect could someday collide with a real API path on the same origin; today nothing is served under `/api` on Netlify.

## Outside voice (native fallback, Claude Plan subagent; Codex not installed)

Provider: codex not installed → native in-host fallback. Outside coverage: **unavailable**. Findings and dispositions (all folded into §2/§3 above):

| # | Sev | Finding | Disposition |
|---|---|---|---|
| C1 | Critical | Every retry reuses a consumed single-use token; no `turnstile.reset()`; Netlify's 10 s limit can kill the function mid-flight → stale-token retry. | **accepted**: reset after every outcome, Send disabled until a fresh token, cleared on remount; 3 s + 5 s budgets |
| H1 | High | D1(a) needs a verified sending domain and `mutaba3a.app` has no DNS; email-only delivery stores nothing and drops Akismet/Spam tab/retention. | **accepted**: prerequisite and accepted regressions recorded in D1 and §6; D1 stays Basel's |
| H2 | High | `vitest.config.ts` includes `src/**` and `scripts/**` only; the function tests would never run; need `@vitest-environment node`. | **accepted** |
| H3 | High | "Fail closed" contradicted itself; a throwing build breaks `npm run dev`/`test:bundles` without env; a non-throwing one ships a silent dead form. | **accepted (D4 rewritten)**: test key by default, real key required when `CONTEXT === 'production'` |
| M1 | Medium | Loading Cloudflare on mount contradicts four privacy paragraphs; load on first form interaction instead. | **accepted (D2)**, supersedes R2's in-view idea |
| M2 | Medium | JSON body weakens "field list is the single source"; keep urlencoded + `cf-turnstile-response`; shape-check before `validateHostedRequest`. | **accepted** |
| M3 | Medium | Use `export const config = { path }`, drop the redirect; pin `hostedRequest.ts`'s no-DOM guarantee. | **accepted** |
| M4 | Medium | QA should stub the Cloudflare script with a fake `window.turnstile`; no site key in QA. | **accepted** |
| M5 | Medium | Strategic: real cost for a hypothetical; define "spam showing up" numerically. | **accepted**: trigger recorded in INFRA row; build still gated on Basel |
| L1–L4 | Low | `context.ip`; widget hostnames incl. deploy previews; secrets scanning scopes; `onload` render; what does not break when the twin goes. | **accepted** |

Cross-model tension: none; the subagent's C1/H2/H3 were misses of the native pass and are now in the plan.

### R2 (revised): script timing → first form interaction (M1), approved (auto). The in-view option is withdrawn.

Approval readiness (re-run): PASS for R1, R2 (revised), S2, C1–M5 as plan amendments; **D1 pending by design**.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (D1 open)
- Architecture Review: 1 issue found
- Code Quality Review: 1 issue found
- Test Review: diagram produced, 19 gaps identified (all planned; not built)
- Performance Review: 1 issue found (script timing)
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 2 in this review (D1 channel; whether to build now)
- Outside voice: codex not installed → native Claude subagent (in-host), completed with 13 findings; outside coverage unavailable
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 1/1 (R2 → B 10/10)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native fallback (codex not installed), `/plan-eng-review` | Independent 2nd opinion | 3 | unavailable (in-host completed, issues_found) | 13 findings, all folded in |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 3 | ISSUES OPEN | 22 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** provider codex, phase plan-review, unavailable (not installed); native in-host fallback completed with 13 findings (C1, H1–H3, M1–M5, L1–L4).
- **CROSS-MODEL:** same harness, model identity unknown. New from the subagent: C1, H1, H2, H3, M1–M5, L1–L4; overlap with the native pass: none.
- **VERDICT:** Eng review ISSUES OPEN (plan revised; build gated on D1 and on spam appearing) — eng review required

**UNRESOLVED DECISIONS:**
- D1: delivery channel, email API (needs a verified sending domain first) or the Mutaba3a server inbox — Basel's call
- Build gate: Basel's own condition, "only if spam actually shows up" (trigger: 5+ Spam-tab entries in a week or half the allowance)
