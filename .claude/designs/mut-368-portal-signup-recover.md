# MUT-368: Portal "Create an account", "Forgot your password?" and the under-review screen

Epic MUT-322 (pilot-ready). Built on MUT-359 (mailer), MUT-366 (signup and recovery routes) and MUT-367 (domain screen and review queue).
Design: `mut-331-self-service-signup.md` §3, §4, §7a, §9, §11; ADR-159, ADR-175, ADR-178.
Status: planned 2026-10-24 in an unattended run (Basel pre-authorized the plan). Every D below is **pending Basel's confirmation**.

## 1. Problem and acceptance criteria

The server can mail signup and recovery links and hold webmail signups for review, but the portal has no page for any of it. `HOSTED_RULES` even bans the words.

From the ticket:
- **AC1.** A new person goes from /signup to Home in both languages, using only the mail's link, and accepts the terms on /setup.
- **AC2.** Every refused or limited state keeps the typed email and says what to do next. No screen ever reveals whether an address has an account.
- **AC3.** A webmail signup ends on the under-review screen. After the operator approves, sign-in lands on Home.
- **AC4.** `test:bundles` passes with the revised rules, and "invite" is still caught. "subscribe" was already retired by MUT-362 (ADR-170); see D3.
- **AC5.** Release-QA: every listed spec passes, and `release-qa lint` is clean.

## 2. What exists and is reused

| Need | Reuse |
|---|---|
| Signed-out page frame (language switch, wordmark, card) | The `SetupLayout` markup in `SetupPage`, duplicated in `SignInPage`. It is extracted as `AuthLayout` and used by every signed-out page. |
| Setup link check, redeem, refusals | `SetupPage`, `setupLink.ts`. SIGNUP gets its own variant, not a new page. |
| Currency and timezone for a new personal profile | `HOSTED_CURRENCIES`, `browserTimezone`/`timezoneOptions`, and `ProfileCreateDrawer`'s timezone row. That row is extracted as `TimezoneChoice` and used by both. |
| Support address | `SUPPORT_EMAIL` (`src/hosted/terms.ts`), as `TermsUpdatePage` uses it |
| Landing request form link | `__HOSTED_OFFER_URL__` (sign-in's "Request one") |
| Build-time public values | The ADR-076 `typeof` guard shape, for `__TURNSTILE_SITE_KEY__` |
| QA against a live API | `qa/support/billing-live.mjs` (test Postgres, a migrated QA DB, the API and vite on fixed ports, a state file) |

## 3. The solution

### 3.1 Server (small, additive; API 1.58.0-mut368)

1. **`GET /v1/self-service`** (public, always 200): `{signup: boolean, recovery: boolean}`.
   - `signup` is `SELF_SIGNUP_ENABLED`.
   - `recovery` is true when the server can really mail a link: `MAILER` isn't noop, and a Turnstile secret is configured.
   - Sign-in, /signup, /recover and dead setup links read it to decide which doors to show (D1, review P1-1). Production has mail off today, so an unconditional "Forgot your password?" would be a dead door that always answers "The check didn't pass".
   - It creates nothing and reveals nothing about accounts. It joins the public-operations pin in `no-self-registration.test.ts`.
2. **The setup-link check names the purpose of a dead link.**
   - The refusal variant gains optional `purpose` for `expired`, `used` and `superseded`; `invalid` has no row to name.
   - Only the token's holder learns it. It tells the page which "Send a new link" to offer: /signup for SIGNUP, /recover for SETUP and RESET (D2).
   - A redeem-time 410 uses the purpose the form already holds.
3. (dropped after eng review P2-9: QA isolates the per-IP buckets with a per-spec `X-Forwarded-For` instead of a new env var.)
4. **`PORTAL_CSP`** gains `script-src 'self' https://challenges.cloudflare.com` and `frame-src https://challenges.cloudflare.com`. Nothing else changes; `default-src 'self'` still covers the rest.

### 3.2 Portal

```
router: /signup → SignupPage   /recover → RecoverPage   (public, like /sign-in and /setup)
session/selfService.ts  useSelfService(): GET /v1/self-service once per page (staleTime ∞); a failure = both doors hidden

pages/auth/
  AuthLayout.tsx        language switch + wordmark + <main>; used by sign-in, setup, signup, recover, under-review
  EmailLinkForm.tsx     email + Turnstile + submit, the shared half of signup and recover
  CheckEmailNotice.tsx  "Check your email" + "Send again" after a 60 s cooldown (back to the form, email kept)
  UnderReviewNotice.tsx "We're reviewing your account…", support address, Sign out
  SignupPage.tsx        self-service.signup false → closed | GET failed → unreachable + Retry | form → sent; POST 404 → closed
  RecoverPage.tsx       form → the same "If that address has an account…" for every 202
  selfService.ts        pure: selfServiceFailure(error) → closed | notAccepted(reason) | checkFailed | rateLimited(min) | invalidEmail | unreachable
  SignInPage.tsx        + "Forgot your password?" when recovery is live (else the old "ask the person…" line) · "Create an account" when signup
                        is open, else "Request one" · 403 ACCOUNT_UNDER_REVIEW → UnderReviewNotice
  SetupPage.tsx         SIGNUP variant: "Finish creating your account", optional name, currency (ILS default), timezone (browser);
                        redeem {email,status}: PENDING_REVIEW → UnderReviewNotice, else sign in → firstRunPath(me);
                        a dead link with a purpose offers "Send a new link"
components/turnstile/
  loadTurnstile.ts      one <script src=…/api.js?render=explicit&onload=…> per page; a promise, retried after a failure
  useTurnstile.ts       loaded only by the two forms, on mount (the form is the page; focus/pointerdown also trigger), render {sitekey, action, language, theme:auto},
                        callbacks → token/status; re-render on language change; reset() after every submit; remove on unmount
  TurnstileWidget.tsx   the container (reserved height, no layout shift) + a polite status line + "Try again"
components/TimezoneChoice.tsx   extracted from ProfileCreateDrawer: "<zone> (from your browser) · Change" → select
session/firstRun.ts     firstRunPath(me): the personal profile's Home. This is MUT-418's seam for "Your trial has started".
api/client.ts           signupStatus(), signup(), recoverAccount(); ALWAYS_REMOTE += signups|account-recovery (signed-out local mode must not swallow them)
```

**Copy (en, with ar alongside in `ar.json`):**
- Signup: "Create your account". The page asks for the email, and the terms line reads "You'll accept the terms when you set your password." The button is Continue. If you already have an account, there is a Sign in link.
- Sent: "Check your email". The page says "We sent a link to {email}. Open it within 24 hours to finish. If this address already has an account, the email says how to sign in." This wording is account-neutral, per ADR-037 §4.
- Refusals stay inline, and the email stays typed:
  - disposable: "This address is from a throwaway email service. Use one you'll keep."
  - no-mail: "This address can't receive email. Check it for typos, or use another one."
  - check failed: "The check didn't pass. Try again."
  - rate-limited: "Please wait a minute before asking again." (plural minutes)
  - unreachable: the existing copy.
- Closed: "Accounts are by request for now". The page says "Ask for one and we'll set it up with you." and links to "Request an account" (the landing `/hosted`).
- Recover: "Reset your password". The page asks for the email of your account. The sent screen reads "If {email} has an account, we've sent it a link to choose a new password. Open it soon: it works for a short time."
- Setup SIGNUP: "Finish creating your account". The page asks for your name (optional), password, currency and timezone; the button is "Create account".
- Under review: "We're reviewing your account". The page says "We'll email you within 2 working days." and "Questions? Write to {support}." The button is Sign out (D7).
- Refused links (setup): the bodies no longer say "ask the person who set up your account" when the purpose is known. They say "Send a new link" instead.

**Turnstile site key:** `__TURNSTILE_SITE_KEY__` comes from `MUTABA3A_TURNSTILE_SITE_KEY` in `deploy.env`. Unset, it is Cloudflare's always-pass test key `1x00000000000000000000AA`, so dev, tests, QA and `test:bundles` need nothing. `deploy.sh` refuses to build when Terraform's `mailer = "resend"` (recovery is live; signup needs resend too, per `main.tf`) and the key is missing or a test key (D6). The key is public, not a secret.

**Bundle rules:** these bans are removed on purpose: `sign up` (the route `/signup` is in the bundle), `create account`, `forgot`, `reset password`, and the Arabic `إنشاء حساب`, `نسيت` and `إعادة تعيين`. `invite` and `دعوة` stay. `https://challenges.cloudflare.com` joins the hosted origin allowlist with a reason.

### 3.3 Error states (pure mapping, unit-tested)

| Server says | Page shows |
|---|---|
| `GET/POST /v1/signups` 404 | the closed screen (signup page) or no "Create an account" (sign-in) |
| 400 `EMAIL_NOT_ACCEPTED` `disposable` / `no-mail` | field error under email; email kept; widget reset |
| 403 `CHECK_FAILED` | banner "The check didn't pass"; widget reset |
| 422 naming `email` | the field's "Enter an email address" error |
| 422 naming `turnstileToken` | never sent: submit waits for the token ("Checking…"), and the widget's own failure shows "Try again" plus the support address |
| setup redeem 422 naming `password` / `timezone` / other | the password rule / the timezone field / "Couldn't reach MTB3A" (never the password rule for a non-password field; review P1-2) |
| 429 | banner with minutes, or hours above 60 minutes (the 5-a-day budget answers up to 24 h) |
| 0 / 5xx / other 403 | "Couldn't reach MTB3A" |
| 202 | sent screen |
| sign-in 403 `ACCOUNT_UNDER_REVIEW` | `UnderReviewNotice` in place of the form |
| redeem 200 `status: PENDING_REVIEW` | `UnderReviewNotice`, no sign-in attempt |

## 4. Decisions (all pending Basel's confirmation)

- **D1.** The doors come from a new public `GET /v1/self-service` → `{signup, recovery}`, not a build flag: the server's own configuration is the one truth. An outage hides both doors.
- **D2.** The setup-link check names the purpose of an expired, used or superseded link, so the dead-link screen offers the right "Send a new link". A redeem-time 410 uses the form's own purpose.
- **D3.** "subscribe" stays allowed: MUT-362 retired that ban (ADR-170). The ticket's "subscribe stays banned" predates it. "invite" and دعوة stay banned.
- **D4.** "sign up" is unbanned too, because the `/signup` route is in the bundle. The ticket listed only create account, forgot and reset.
- **D5.** The Turnstile script loads only on /signup and /recover, when the form mounts, because the form is the page. Sign-in, Home and every other page never contact Cloudflare.
- **D6.** Production fails closed on the site key: `deploy.sh` refuses a missing or test site key once `mailer = "resend"`. Before that, nothing is offered: `recovery` and `signup` are both false.
- **D7.** The under-review screen's support address is `SUPPORT_EMAIL` (today on Malafat's domain; TD-210 moves it).
- **D8.** "Send again" returns to the form with the email kept, after a 60 s cooldown, and needs a fresh Turnstile pass: a token is single-use. The rate-limited state is reached by asking again for the same address from a fresh page within a minute, so `signup.rate-limited` is reworded to match.
- **D9.** The new account's currency defaults to ILS, like ProfileCreateDrawer. The timezone is the browser's, with "Change". The name is optional and left out of the body when blank; the server uses the address's local part.
- **D10.** (Withdrawn: there is no new per-IP env var. QA gives each spec its own `X-Forwarded-For`.)
- **D11.** QA runs in a new `portal-selfservice` app, cloned from `portal-live`'s pattern, so the shared `portal` app keeps no Docker dependency (review P1-3).
  - `qa/support/selfservice-live.mjs` creates a per-launch DB on `mutaba3a-test-pg` and runs the migrations.
  - It builds `dist-hosted` and serves it from the API on 127.0.0.1:8791, as production does, so the real `PORTAL_CSP` applies (review P1-4).
  - The API runs with `MAILER=memory`, `SELF_SIGNUP_ENABLED=true`, the fixture domain checker, Turnstile's pass test secret and short floors.
  - `ready` is `/v1/self-service`.
  - Turnstile's script is answered by `qa/support/turnstile.ts`, a page-routed stand-in that mimics the always-pass and always-fail test keys. It mounts an iframe from `challenges.cloudflare.com`, also routed, so `frame-src` is exercised too. Cloudflare is never contacted in QA (run rule 5).
  - **Ticket deviation:** the features live in `qa/features/portal-selfservice/{signup,recover}.yaml` (ids `portal-selfservice.signup.*`), not `qa/features/portal/`.
  - The `portal` app's `watch` leaves out the self-service-only files, which the new app maps.
- **D12.** `signup.expired-link` ages its link in the QA DB (`expiresAt` moved into the past). It doesn't wait 24 h or add a clock route to the product.
- **D13.** After a SIGNUP redeem and sign-in, the page goes to `firstRunPath(me)`, the personal profile's Home. MUT-418 adds its trial step there.
- **D14.** "Forgot your password?" shows whenever recovery is live, rather than always. While mail is off in production, sign-in keeps today's "ask the person who set up your account" line. This is a deviation from the ticket's "always shows" (review P1-1).
- **D15.** Pressing Continue before the check finishes waits for the token ("Checking…") and then sends. A widget that can't load (blocked) shows "Try again" and the support address. The page never sends without a token (review P1-6).
- **D16.** Sign out on the under-review screen ends any session already on this browser (`useSignOut`) before showing an empty sign-in page. With no session it just clears the page (review P2-8).
- **D17.** `signup.check-refused` covers both refusals: the widget's own failure (no request sent), and the server's 403 `CHECK_FAILED`, stubbed on one request (review P1-5).

## 5. Tests (TDD; Vitest unless noted)

- `selfService.test.ts`: every row of §3.3, for both routes.
- `loadTurnstile.test.ts` and `useTurnstile.test.tsx`:
  - the load is lazy, happens once, and is retried after a script error;
  - render gets the action, language and sitekey;
  - token, expired and error map to statuses;
  - reset; a language change re-renders; unmount removes the widget.
- `SignupPage.test.tsx`:
  - the closed screen (GET 404, POST 404);
  - the sent screen and its cooldown (fake timers);
  - disposable and no-mail keep the email;
  - check failed resets the widget;
  - 429; the locale is sent; the terms line links `/terms`; Arabic is RTL.
- `RecoverPage.test.tsx`: the same answer for every 202; refusals.
- `SignInPage.test.tsx` (new):
  - "Forgot your password?" always shows;
  - "Create an account" only on 200;
  - 403 under review → the notice; Sign out empties the form.
- `SetupPage.test.tsx`:
  - SIGNUP copy;
  - the redeem body carries `defaultCurrency`, `timezone` and the optional `displayName`;
  - PENDING_REVIEW → the notice with no sign-in;
  - a sign-in 403 → the notice;
  - a dead SIGNUP link offers /signup and a dead RESET link offers /recover;
  - firstRun.
- `firstRun.test.ts`, `TimezoneChoice` (through ProfileCreateDrawer's existing tests).
- Bundle rules: `check-bundles.test.ts`. The removed rules no longer fire, and invite and دعوة still do.
- `vite-config.test.ts`: the site key default and its shape check.
- Server:
  - `routes-self-service.test.ts`: `GET /v1/self-service` for each combination of signup on/off and mail on/off;
  - `account-setup` check purpose on refusals;
  - `portal.test.ts`: the CSP;
  - `no-self-registration.test.ts`: the pin;
  - `release-guard.test.ts`: the site-key guard;
  - the OpenAPI version bump.

Commands: `npm run lint && npm run typecheck && npm run test:run && npm run build && npm run test:bundles` (Node 22), plus `npm --prefix server run typecheck|lint|openapi:check|test`. Then `npm run hosted:types:check` and `release-qa lint`.

## 6. QA scenarios (`qa/features/portal-selfservice/signup.yaml`, `recover.yaml`; live self-service API, D11)

| id | Steps | Promised outcome |
|---|---|---|
| `signup.create` (core) | Open /signup with no language chosen. Type a new address on `business.example`, pass the check, press Continue. Open the mail's link from the dev outbox, type a password, tick the terms, press Create account. Again in English. | The page is Arabic and RTL, then shows "Check your email". The mail is in the page's language. /setup says "Finish creating your account" with the address read-only. You land signed in on your personal profile's Home. |
| `signup.existing-email` | Sign up with an address that already has an account | The same "Check your email" screen. The outbox holds "you already have an account", with no setup link. |
| `signup.expired-link` | Ask for a link, age it past 24 h, open it | "This link has expired", with "Send a new link" leading to /signup, and no password form |
| `signup.check-refused` | Sign up while the check fails (the always-fail key's behaviour), then again when the server refuses the token | The widget says the check didn't pass, offers Try again, and nothing is sent. The server's refusal reads "The check didn't pass. Try again." The email stays typed both times. |
| `signup.disposable` | Sign up with `@mailinator.com` | "…throwaway email service…" under the field, the email kept, and no mail |
| `signup.no-mail-domain` | Sign up with `@nomail.example` | "This address can't receive email…", the email kept, and no mail |
| `signup.rate-limited` | Ask for a link, then ask again for the same address from a fresh page within a minute | "Please wait a minute before asking again", with the email kept |
| `signup.closed` | Open /signup and sign-in while the server says signup is closed (`/v1/self-service` stubbed `signup:false`) | "Accounts are by request for now", linking the landing request form. Sign-in shows no "Create an account". |
| `signup.business-instant` | Sign up on `business.example`, finish /setup | Signed in straight away on Home |
| `signup.review-webmail` (core) | Sign up with `@gmail.com` and finish /setup. The operator approves through `/admin/v1/signup-reviews`, then sign in. In English and Arabic. | After /setup: "We're reviewing your account. We'll email you within 2 working days." Sign-in shows the same screen. The approval mail arrives, and sign-in then lands on Home. |
| `signup.review-declined` | The same, but the operator declines | The decline mail names the support address, and sign-in is refused like any unknown account |
| `signup.375` | `signup.create`'s pages at 375 px in Arabic | Nothing is clipped or overflows on /signup, the sent screen, /setup or under-review |
| `recover.reset` (core) | On sign-in press "Forgot your password?", type your email, pass the check, open the mail's link and set a new password | You are signed in with the new password, another browser signed in before is signed out, and a "password changed" mail arrives |
| `recover.unknown` | Recover an address with no account | The same confirmation screen, and no mail in the outbox |
| `recover.pending-account` | Recover an operator-created account that never set a password | A setup mail arrives, and its link sets the first password and signs in |

## 7. Impact, i18n, cost, infra

- **i18n:** every string is in en and ar, Arabic by default (ADR-077). Email and amounts are `<bdi dir="ltr">`. RTL is checked at 375 px.
- **Cost:** none. Turnstile is free, and the script loads only on the two forms.
- **Infra:**
  - `MUTABA3A_TURNSTILE_SITE_KEY` goes in `deploy.env` (public).
  - The Cloudflare widget's hostnames are `app.mtb3a.com` and the legacy run.app host.
  - The secret is MUT-366's `mutaba3a-api-turnstile-secret`.
- **Security:**
  - The CSP gains exactly the Turnstile origin for scripts and frames.
  - No new session path: setup still signs in through `POST /v1/sessions`.
  - Nothing reveals an account.
- **Not in scope:** the landing CTA and privacy copy (MUT-369), the phone (MUT-371), the passkey card (MUT-370), and the trial step (MUT-418).

## 8. Engineering review (2026-10-24, unattended)

**Scope challenge.** The plan touches about 35 files: 8 new portal modules, about 6 server files, QA, docs and knowledge files. The complexity gate tripped. Recommended and taken: keep the original arrangement, because every module maps to a ticket requirement. There are no scope cuts; the structure is recorded as pending Basel.

The outside voice was a native Claude subagent; Codex isn't installed. It found 11 issues (7 P1, 4 P2), all accepted and folded in above:
- **P1-1:** recovery would be a dead door while production mail is off. Fixed by D1/D14, `GET /v1/self-service`.
- **P1-2:** the redeem's 422s were misread as the password rule. Fixed in §3.3 and D9: a blank name is omitted, and the field is read from the details.
- **P1-3:** the shared `portal` QA app was fragile. Fixed by D11: a separate `portal-selfservice` app with a per-launch DB, ready on the API.
- **P1-4:** the CSP was never exercised. Fixed by D11: the API serves the built portal, and the stand-in mounts a challenges.cloudflare.com frame.
- **P1-5:** check-refused couldn't reach the server's 403. Fixed by D17.
- **P1-6:** submitting before the token existed was undefined. Fixed by D15.
- **P1-7:** signin.spec's link count, the old help line and the 410 purpose. The spec and yaml are updated, the help line follows D14, and the 410 uses the form's purpose.
- **P2-8:** Sign out with an existing session. Fixed by D16.
- **P2-9:** the shared IP buckets in QA. Fixed with a per-spec `X-Forwarded-For`; D10 is withdrawn.
- **P2-10:** status errors and the day limit. A failed GET shows unreachable with Retry, and hours appear above 60 minutes.
- **P2-11:** Turnstile load and language. The script loads on mount (D5). The action strings are exactly `signup` and `recover`, and the language is `ar`/`en`, which Cloudflare documents as two-letter codes.

Own findings:
- **A1 (P2, conf 7).** Sign-in reads `/v1/self-service` on every visit. It is cheap (no DB), unlimited and public; the result is cached for the page's life.
- **A2 (P2, conf 6).** The "Send again" cooldown lives in component state, so a reload resets it. The server's 1/min budget is the real guard (D8).
- **T1 (P1, conf 8).** SignInPage has no unit test of its own. A new `SignInPage.test.tsx` covers the doors and the 403.

Failure modes:
- A mail provider outage still answers 202. The person can press "Send again" after 60 s.
- A Turnstile script blocked by an extension shows "Try again" and the support address.
- A switch flipped while the page is open: the POST answers 404 and the page shows the closed screen.
- Critical gaps: 0.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Claude subagent (Codex not installed) | Independent 2nd opinion | 1 | done (native fallback) | 11 findings, all accepted |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all mapped into the plan) | 3 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** native Claude subagent, plan phase, completed, 11 findings. Codex is not installed, so there is no external-model coverage.
- **VERDICT:** ENG reviewed; every finding is mapped into the plan. The decisions are pending Basel (unattended run), so the build proceeds on the recommended options.

**UNRESOLVED DECISIONS:**
- D1–D17 (except D10) take the recommended option and are pending Basel's confirmation; none blocks the build.
