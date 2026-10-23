# MUT-366: signup and recovery routes that mail setup links

Status: **planned 2026-10-23 (unattended run).** D1–D18 are recommended defaults, **pending Basel's confirmation**.
Ticket: MUT-366 · epic MUT-322 (`ga-gate`) · parent design `.claude/designs/mut-331-self-service-signup.md` §3–§7 (ADR-159).
Blocked by MUT-359 (mailer): merged to local main eab9f735. New decision record: **ADR-175**. API **1.55.0-mut366**.

## 1. Problem and acceptance criteria

Accounts are operator-issued only (ADR-037 §1, ADR-088). ADR-159 opens signup and password recovery for GA. Both end on
the existing `/setup` page and redeem. This story is the server half: two public routes that mail links, a SIGNUP link
purpose that creates the account when redeemed, Turnstile, limits, response floors and the signup switch.

| # | AC (ticket) | Proved by |
|---|---|---|
| A1 | New, existing and suppressed addresses get the same status, body and floor-bounded timing; only the outbox differs | `routes-self-service.test.ts` "same answer" cases: three addresses, equal status/body, each elapsed ≥ floor; outbox differs |
| A2 | A SIGNUP link + 12+ char password + current terms creates exactly one user and one personal profile; second use 410 `used`; two links for one email raced → one account | route test (create, 410 used) + store contract (`redeemSignup` race, both stores) + Prisma contract under test:db |
| A3 | Recovery for an active account changes nothing until used; redeeming revokes every session and clears the lockout | route test: sign-in still works after the request; redeem → old session 401, lock cleared |
| A4 | Missing/failed Turnstile sends nothing; per-address and per-IP limits answer 429 | route tests with the always-fail verifier and a tiny limiter |
| A5 | Switch off: `/v1/signups` 404, recovery still works | route test with `selfSignupEnabled: false` (the default) |
| A6 | Server gate: typecheck, lint, openapi:check, tests, test:db for the migration | §8 |

## 2. Reuse

| Need | Reused |
|---|---|
| Token, digest, fragment URL | `generateSetupToken`, `sessionDigest`, `setupUrl`, `setupLinkOrigin` (ADR-088) |
| Issuing a RESET/SETUP link for an existing person | `store.accountSetup.issue` unchanged (row lock, supersede, audit) |
| Redeem of RESET/SETUP | `POST /v1/account-setup` unchanged; SIGNUP is a new branch beside it |
| Terms at redeem | `termsAcceptanceOf`, `staleTerms`, the store's `insertTermsAcceptance` |
| Personal profile | `personalProfileFor` |
| Same-origin, client IP | `isSamePortalOrigin`, `requestClientIp` (front door aware) |
| Limits | `SlidingWindowRateLimiter`, widened with an optional window length (default stays 60 s) |
| Mail | `mailer.send` with the existing `finish-signup`, `account-exists`, `reset-password`, `finish-setup` templates; `store.email.isSuppressed` |
| Links in mail | `setupUrl(setupLinkOrigin(...))`, `signInLinkOf` |
| Pruning cadence | the in-process hourly timer MUT-359 uses for the mail log |

## 3. Shape

### 3.1 Data (migration `20261023180000_mut366_signup_links`)
- `SetupLinkPurpose` gains `SIGNUP`.
- `account_setup_tokens`: `userId` nullable; new `email TEXT NULL` (normalised), `locale VARCHAR(5) NULL`, `mailed BOOLEAN NOT NULL DEFAULT false`; index on `(email)`; CHECK `(purpose = 'SIGNUP') = ("userId" IS NULL)` and `("userId" IS NULL) = (email IS NOT NULL)` and `(email IS NULL) = (locale IS NULL)`. (INVITE, MUT-306, widens the CHECK.)
- `users.emailVerifiedAt TIMESTAMP NULL`: set by a SIGNUP redeem and by redeeming any **mailed** link (recovery). Operator links are handed over by the operator and don't verify the address.

### 3.2 Store port (both stores, one contract)
- `AccountSetupTokenRecord` becomes a union on `purpose`: `SETUP|RESET` → `{ userId, email: null, locale: null }`; `SIGNUP` → `{ userId: null, email, locale }`; plus `mailed`.
- `IssueSetupLinkInput.mailed?: boolean` (recovery sets it).
- `issueSignup({ email, locale, tokenDigest, at, expiresAt })`: under a transaction-scoped advisory lock on the email, cancels the email's open SIGNUP links and inserts this one (D12).
- `redeemSignup({ tokenDigest, passwordHash, at, displayName, personal, status, trialStartsAt, terms, auditFor })`: same advisory lock; claims the link only if unused, uncancelled, unexpired and **no user holds the email**; creates the user (`emailVerifiedAt = at`, `trialStartedAt = trialStartsAt`), the personal profile and its membership, records the terms, writes `auditFor({ userId, personalOrganizationId })`. Null when the claim loses (incl. a UniqueViolation on `users.email` from a racing operator create), with nothing written.
- `redeem` (existing): also stamps `emailVerifiedAt` when the link was `mailed`.
- `pruneSignupLinks(expiredBefore)`: deletes unredeemed SIGNUP links whose `expiresAt < expiredBefore`; returns the count.
- Store guard: the new methods are `operator` (public routes run unguarded, like `redeem`).

### 3.3 Pure rules (`server/src/auth/self-service.ts`)
- `SELF_SERVICE_POLICY`: signup link 24 h; recovery RESET 1 h; recovery SETUP 24 h (D4); IP 10/h; address 1/60 s and 5/24 h; floors 3000/1500 ms; prune 7 days after expiry.
- `signupLinkState(link, holder, now)`: `used` when a user holds the email (any status), else used/superseded/expired/valid like `setupLinkState`.
- `recoveryPurposeOf(user)`: `null` (no mail) for DISABLED; `SETUP` for a never-signed-in account with no password; else `RESET` (D5).
- `signupAccountOutcome(link, at)`: `{ status: 'ACTIVE', trialStartsAt: at }`. **MUT-367 seam:** it reads the token's domain classification and returns `PENDING_REVIEW` with `trialStartsAt: null` for webmail/unverified.
- `answerNoEarlierThan(startedMs, floorMs, clock)`: waits out the floor on a monotonic clock (D8).

### 3.4 Turnstile (`server/src/auth/turnstile.ts`)
- Port `TurnstileVerifier { verify(token, { ip, action }): Promise<boolean> }`.
- `createTurnstileVerifier({ secret, fetch, timeoutMs: 5000 })`: Cloudflare's **published test secrets** (`1x…AA` pass, `2x…AA` fail, `3x…AA` spent) are answered locally with no network call (D7); any other secret POSTs `siteverify` (secret, response, remoteip, idempotency_key), 5 s `AbortSignal.timeout`, and fails closed on any error, non-200, `success: false`, or a reported `action` other than the expected one.
- Config: `TURNSTILE_SECRET` optional. Production refuses to start without it when `MAILER ≠ noop` or `SELF_SIGNUP_ENABLED`, and refuses a test secret. Outside production, unset = the always-pass test secret.

### 3.5 Routes (`server/src/routes/self-service.ts`)
`POST /v1/signups { email, locale = 'ar', turnstileToken }` and `POST /v1/account-recovery { email, locale?, turnstileToken }`, both `security: []`, 202 `{ status: 'sent' }`.
Order: (signups only) switch → 404 · same-origin → 403 `CROSS_SITE_REQUEST` · IP limit → 429 · body validation → 422 · Turnstile → 403 `CHECK_FAILED` · address limits → 429 · *(MUT-367: disposable/no-mail refusal and domain classification go here)* · branch · mail · floor · 202.
- Signups branch: suppressed → nothing · user exists (ACTIVE) → `account-exists` (signIn + `<portal>/recover`), nothing issued · user DISABLED → nothing (D16) · else `issueSignup` + `finish-signup` (validHours 24).
- Recovery branch: unknown/suppressed/DISABLED → nothing · else `accountSetup.issue({ purpose, mailed: true, lock: false, audit: user.setup_link_issued (SYSTEM, via recovery) })` + `reset-password`/`finish-setup`.
- The mail is sent before the floor (Cloud Run throttles CPU after the response); a mailer outcome or a throw never changes the answer (logged).
- Idempotency keys: `signup:<linkId>`, `account-exists:<userId>:<requestId>`, `recovery:<linkId>`.

### 3.6 Redeem's SIGNUP branch (`routes/account-setup.ts`)
- `check`: a valid SIGNUP link answers `{ state, email, locale, purpose: 'SIGNUP', expiresAt, termsVersion }` from the token.
- `redeem`: body gains optional `displayName`, `defaultCurrency`, `timezone`; for SIGNUP the latter two are required (422) (D3); displayName defaults to the email's local part. Hash, then `redeemSignup` with `signupAccountOutcome`; audits `user.signed_up` (USER) and `organization.created` (personal) and `user.terms_accepted` on the personal profile. No session (ADR-088 §5); no password notice (D11). Lost claim → 410 with the link's state now (`used` once someone holds the email).

### 3.7 Wiring
`AppDependencies.selfService?: { signupEnabled, turnstile, ipLimiter, addressMinuteLimiter, addressDayLimiter, floors }` with test-friendly defaults; `index.ts` builds them from config and prunes the limiters and the SIGNUP links (hourly). `CHECK_FAILED: 403` joins `ERROR_CODES`. Config gains `TURNSTILE_SECRET`, `SIGNUP_RESPONSE_FLOOR_MS`, `RECOVERY_RESPONSE_FLOOR_MS`. Terraform: an empty `mutaba3a-api-turnstile-secret` secret + grant, mounted with `mailer = "resend"` or `self_signup_enabled`; new `self_signup_enabled` variable (default false, needs `mailer = "resend"`) → `SELF_SIGNUP_ENABLED`.

### 3.8 Tests re-pinned deliberately
`no-self-registration.test.ts`: the public-operations list adds `POST /v1/signups` and `POST /v1/account-recovery`; the path check names `/v1/signups` as the one reviewed exception; a new test proves 404 while the switch is off.

## 4. Decisions (D1–D18, pending Basel's confirmation)

- **D1** The trial starts inside the SIGNUP redeem's transaction, writing the same `users.trialStartedAt` that `billing.setTrialStart` writes, so an account never exists without its trial. `billing.setTrialStart` stays the call MUT-367's approval makes for a PENDING_REVIEW account.
- **D2** A SIGNUP token carries the normalised `email` and the signup page's `locale`; no user row until redeem (ADR-159).
- **D3** A SIGNUP redeem requires `defaultCurrency` and `timezone` (the page sends the browser's); `displayName` is optional and defaults to the email's local part.
- **D4** Recovery: RESET links last 1 h (ticket); a SETUP link for a pending operator-created account lasts 24 h.
- **D5** A password-less account that never signed in gets SETUP (`finish-setup`); one that did (an operator `--lock`) gets RESET.
- **D6** One per-IP budget (10/h) and one per-address budget (1/60 s, 5/24 h) shared by both routes; the address budget counts only after Turnstile passes, so a bot without a token can't spend a person's budget.
- **D7** Turnstile test secrets are answered locally (no network) in dev/CI/QA; production refuses a test secret and needs `TURNSTILE_SECRET` once mail or signup is on. The widget's `action` (`signup` / `recover`) is checked when Cloudflare reports one.
- **D8** The floor runs on a monotonic clock and applies only to the 202; refusals that depend only on the input, the IP or the switch answer at once.
- **D9** Pruning is an in-process hourly timer (as MUT-359's mail log, TD-017), not a Scheduler job.
- **D10** The switch keeps `/v1/signups` in the contract; off, it answers 404 `NOT_FOUND`.
- **D11** No "password set" mail after a SIGNUP redeem: the redeem created the account; there's nothing to warn about.
- **D12** A new SIGNUP link cancels the email's open ones (ADR-088 §2); issue and redeem serialize on a transaction-scoped advisory lock on the email.
- **D13** `account-exists` links to `<portal>/` and `<portal>/recover` (MUT-368 builds `/recover`).
- **D14** Mail language: the request's `locale`, else the account's.
- **D15** A suppressed address is checked before anything is issued, so no token is written.
- **D16** Signup for a DISABLED account's address sends nothing (it would only point at recovery, which a disabled account can't use).
- **D17** A malformed email is 422 `VALIDATION_FAILED` (the API's validation code; the brief said 400), reusing the mailer's plain-address rule (≤ 254).
- **D18** `users.emailVerifiedAt` is set by a SIGNUP redeem and by redeeming a mailed recovery link; operator links don't set it.

## 5. Error states
404 `NOT_FOUND` (switch off) · 403 `CROSS_SITE_REQUEST` · 403 `CHECK_FAILED` (new) · 422 `VALIDATION_FAILED` · 429 `RATE_LIMITED` (`retryAfterSeconds`, `Retry-After`) · redeem: 409 `TERMS_VERSION_STALE`, 410 `SETUP_LINK_UNUSABLE`, 422 (SIGNUP without currency/timezone).

## 6. Impact, cost, i18n, infra
- Security: no new session path; tokens in the fragment, digested; accounts never revealed (same 202, floors, address limits regardless of existence). Auth change, tests first.
- Cost: Turnstile is free; mail rides the existing caps. One advisory lock + one insert per signup.
- i18n: mail in en/ar from MUT-359's templates; no portal copy here.
- Infra: Terraform secret + variable (operator-applied). Operator steps in `docs/operations/before-release.md`.
- Not in scope: domain check and review queue (MUT-367), portal pages and `HOSTED_RULES` (MUT-368), phone (MUT-371).

## 7. QA scenarios
Server-only, like MUT-359: nothing a person sees changes until MUT-368 adds `/signup`, `/recover` and the SIGNUP copy
on `/setup`. The scenarios below are proved here by route tests (the memory mailer is the outbox); MUT-368 turns
MUT-331 §11's `signup.*` and `recover.*` into recorded portal specs that read `GET /admin/v1/dev-outbox`.
Release-QA's catalog maps client files only (`qa.config.mjs`), so this story adds no feature yaml; `release-qa lint` stays clean.

| Scenario | Steps | Outcome |
|---|---|---|
| signup.create (API) | POST /v1/signups (new address) → outbox → check → redeem with currency/timezone → POST /v1/sessions | One account, personal profile, trial started, signed in |
| signup.existing-email (API) | POST /v1/signups (existing) | 202; outbox has `account-exists`; no token |
| recover.reset (API) | POST /v1/account-recovery (active) → redeem the mailed link | Old password works until redeem; then sessions revoked; password-changed mail |
| recover.unknown (API) | POST /v1/account-recovery (unknown) | Same 202; empty outbox |
| recover.pending-account (API) | recovery for an operator-created account that never set a password | `finish-setup` mail; its link sets the first password |
| signup.closed (API) | switch off | 404 |

## 8. Gates
Node 22. Server: `npm --prefix server run typecheck|lint|openapi:check`, `npm --prefix server test`, `test:db` on an isolated DB for the migration and both store contracts; Terraform `terraform test` (mocked). Root: lint, typecheck, test:run, build (no client change expected). `release-qa lint`.

## 9. Seams for the next tickets
- **MUT-367:** classification is stored on the SIGNUP token (new columns in its migration) at the marked step in `POST /v1/signups`; `signupAccountOutcome` turns it into `PENDING_REVIEW` with no trial; approval calls `billing.setTrialStart`. `UserStatus` gains `PENDING_REVIEW`; `setupLinkState`/`recoveryPurposeOf` must treat it (recovery allowed per ADR-159 §7a).
- **MUT-368:** `check` answers `purpose: 'SIGNUP'` with `email` and `locale`; SIGNUP redeem needs `defaultCurrency` + `timezone` (+ optional `displayName`); Turnstile actions `signup` / `recover`, test site key `1x00000000000000000000AA` outside production; `account-exists` links to `/recover`; 429 carries `retryAfterSeconds`.

Business / product impact
- Strangers can create an account and anyone can recover a password without Basel: the GA promise of MUT-322.
- Unblocks MUT-367 (review queue) and MUT-368 (portal pages); recovery helps pilot users as soon as mail is live.
- Off by default (switch + noop mailer): merging changes nothing in production until the end-of-run keys.
