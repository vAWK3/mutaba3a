# MUT-618: "Email me a sign-in code" (server, portal, iOS, Android)

Epic MUT-322 (pilot-ready). Related: MUT-115 (passkeys), MUT-370 (passkey suggestion), MUT-368 (/recover: mail + Turnstile), MUT-459 (operator step-up), MUT-619 (passkey at setup, sibling; owns `SetupPage.tsx`).
Decisions: ADR-037 §4 (never reveal an account), ADR-159 d9 (every account keeps a password), ADR-256 (this brief, D1–D9).
Status: planned 2026-11-14. Basel decided the placement, the password rule and 6 digits / 10 min / single use; D1 (phone bot check) is the planner's call, recorded below as asked.

## 1. Problem and acceptance criteria

People set their password on the portal, often on a computer and often as a browser-generated string saved there, then have to type it on the phone. Android has no passkeys. An emailed one-time code gets them in without the password.

- **AC1.** Portal, iOS and Android: type the email, tap "Email me a sign-in code", get a 6-digit code within a minute, enter it, signed in.
- **AC2.** Unknown, disabled and real addresses get the same answer and the same timing; only a real account that can sign in gets mail.
- **AC3.** A code works once, expires after 10 minutes, a resend cancels the older code, the fifth wrong try kills the code.
- **AC4.** Throttles per address and per IP. An account under review gets the password sign-in's under-review notice.
- **AC5.** A code session can't change the password, close the account or pass the operator step-up without the usual proof.
- **AC6.** iOS offers the mailed code in the QuickType bar; the portal field takes the code from browser autofill.
- **AC7.** Release-QA: `portal.signin.email-code`, `ios.signin.email-code` and the Android flow pass in en and ar.

## 2. Decisions

- **D1. Phone bot protection: rate limits alone (no App Attest / Play Integrity).** Why:
  1. Mail only ever goes to a real account that can sign in (D4). A spray of made-up addresses costs no mail and no sender reputation, which is what Turnstile protects on /signup.
  2. Pointing it at real people is capped per address (1 a minute, 5 a day, the /recover budget, D5) and by the mailer's 500/day global cap; the recovery reserve keeps "forgot password" working even if the cap fills.
  3. Guessing is bounded by the code, not the bot check: 5 wrong tries per code, the password sign-in's 5-in-15-minutes lockout on the same email key, at most 5 codes a day: about 25 guesses a day against 10^6, so 1 in 40,000 per account per day.
  4. App Attest does not run on the Simulator (QA would need a bypass flag, which is itself the hole), Play Integrity needs a Google Cloud project, a service account and a per-request token round trip, and both need server-side attestation verification code. That is a large build for little gain while the password sign-in on the same API has no bot check either.
  5. Turnstile on the portal stays (the ticket asks for it, and it stops browser-driven abuse cheaply), but it is not the control: the phone route proves the budgets are.
  Revisit if the `sign_in_code.requested` log shows a spread of IPs hitting the app route.
- **D2. Routes.**
  - `POST /v1/sign-in-codes` `{email, locale, turnstileToken}` → 202 `{status:"sent"}`. Portal: same origin + Turnstile (action `sign-in-code`), as /recover.
  - `POST /v1/device-sign-in-codes` `{email, locale}` → 202. Phone: no origin check, no Turnstile (D1).
  - `POST /v1/sessions/code` `{email, code}` → 201 Me + cookie. `POST /v1/device-sessions/code` → 201 Me + token.
  - `GET /v1/self-service` gains `signInCode` (= the server mails, like `recovery`), so neither client shows a door that can only fail.
- **D3. Storage: a code row for every address asked for, real or not.** Table `sign_in_codes` (id, email, userId nullable, codeDigest, createdAt, expiresAt, attempts, usedAt, cancelledAt). An unknown address gets a row with a random code nobody is sent. That keeps every verify answer (wrong / expired / too many tries) identical for real and made-up addresses, so the code step can say which it is without revealing anything. The digest is HMAC(pepper, email + code); the plain code is never stored. A new code cancels the live one for that email. Rows are deleted a day after they expire.
- **D4. Who gets mail:** status ACTIVE or PENDING_REVIEW, a password set (ADR-159 d9; a session binds to it), not closed past its deadline, address not suppressed. Everyone else gets the row and no mail.
- **D5. Budgets.** Ask: 10/h per IP and 1/min + 5/day per address (the self-service limiters, under `sign-in-code:` keys, so asking for a code never spends /recover's budget). Answer no earlier than 1.5 s (the recovery floor), the mail raced to the floor as /recover does. Verify: the sign-in IP limiter and the shared email-key throttle (a wrong code counts as a failed sign-in, MUT-115 A3).
- **D6. Verify answers.** 401 `SIGN_IN_CODE_WRONG` `{triesLeft}`, 401 `SIGN_IN_CODE_EXPIRED` (none live: expired, used, replaced, killed or never sent), 401 `SIGN_IN_CODE_TOO_MANY_TRIES` (the fifth wrong try; the code is dead), 429 `RATE_LIMITED` while the email key is locked or the IP is over budget, 403 `ACCOUNT_UNDER_REVIEW` for the right code on an account under review (no session), 401 `INVALID_CREDENTIALS` for the right code on an account that can't sign in any more. A locked key does not spend a try.
- **D7. Session.** Through `issueSession` with audit `method: 'email-code'`. No `passkeyId`, so `stepUpAt` stays null (MUT-459). Change password and close account already demand the current password (`verifyCurrentPassword`), which a code session doesn't have. Tests pin all three.
- **D8. Mail.** Template `sign-in-code` `{code, validMinutes}`, en + ar. The code in the subject ("123456 is your MTB3A sign-in code", which also lets iOS Mail's one-time-code detection find it) and in a large, left-to-right, spaced block in the body (new optional `code` slot in the mail layout). Outro: "If you didn't ask for this, ignore it; your password hasn't changed." Not in the recovery reserve, not cap-exempt.
- **D9. Clients.** "Email me a sign-in code" sits beside "Forgot password?" (Basel). It uses the typed email; an empty or malformed one gets the field's own error and focus. The code step replaces the form: one field (`autocomplete="one-time-code"` / `AutofillHints.oneTimeCode`, digits only, 6), Sign in, "Resend code" after 60 s, "Use my password instead". Success runs the same path as a password sign-in (the MUT-370 suggestion then follows its own rules). PostHog: `sign_in_code_requested`, `sign_in_code_signed_in`, `sign_in_code_failed {reason}` (release only). Sentry on unexpected failures only.

## 3. Files

**Server** (`server/`)
- `prisma/schema.prisma` + migration `20261114120000_mut618_sign_in_codes`: `SignInCode`.
- `src/repositories/ports.ts` (`SignInCodeRepository`, `LedgerStore.signInCodes`), `memory.ts`, `prisma.ts`, `auth/store-guard.ts` (operator-only; routes use the raw store, like sign-in).
- `src/auth/sign-in-code.ts`: policy constants, `generateSignInCode`, `signInCodeDigest`, `signInCodeRecipient(user)`.
- `src/auth/sign-in.ts`: `SignInMethod` += `'email-code'`; `signInWithCode()` / `verifySignInCode()` through the same review, closure, throttle and lockout checks.
- `src/routes/self-service.ts`: the two ask routes + `signInCode` door. `routes/sessions.ts`, `routes/device-sessions.ts`: the two verify routes.
- `src/email/ports.ts`, `templates/copy.ts`, `templates/layout.ts`: the template and the code slot.
- `src/errors.ts`: the three codes. `src/schemas.ts`: request schemas, door field. `src/index.ts`: hourly prune. OpenAPI regenerated.
- `auth/turnstile.ts`: action `sign-in-code`.

**Portal** (`src/hosted/`)
- `pages/auth/SignInCodeStep.tsx` (new), `pages/auth/signInCode.ts` (pure failure mapping, new), `pages/auth/SignInPage.tsx` (link + step), `api/client.ts` (+ ALWAYS_REMOTE), `session/selfServiceDoors.ts`, `components/turnstile/useTurnstile.ts` (action), i18n en/ar, analytics events.

**Phone** (Flutter)
- `lib/domain/services/auth_service.dart` (`requestSignInCode`, `signInWithCode`), `lib/core/api/api_client.dart` (map the codes), `lib/presentation/screens/auth/email_code_step.dart` (new), `sign_in_screen.dart` (link beside Forgot, step in place of the form), `self_service_repository.dart` (door), l10n en/ar, analytics.

## 4. Tests (TDD)

Server: `auth/__tests__/sign-in-code.test.ts` (digest, generator range and uniformity bounds, recipient rules), `__tests__/routes-sign-in-code.test.ts`:
- same 202 and floor for unknown / disabled / no-password / real; mail only for real (AC2);
- right code → cookie / token session, audit `email-code`; second use → EXPIRED; after 10 min → EXPIRED; resend → old code EXPIRED, new works; 5th wrong → TOO_MANY_TRIES and the right code then EXPIRED (AC3);
- per-address 1/min and 5/day, per-IP 10/h, IP limiter and email lockout on verify; locked key spends no try (AC4);
- PENDING_REVIEW right code → 403, wrong code → 401 WRONG; unknown address wrong code → identical body to a real one (AC2/AC4);
- code session: `stepUpAt` null → operator write 403 RECENT_SIGN_IN_REQUIRED; change password / close account without the right current password → 403 (AC5);
- portal route: cross-site 403, Turnstile fail 403 CHECK_FAILED; app route: no Turnstile needed;
- mail copy: en/ar, code present, no link; the memory + Prisma repositories behave alike (`test:db`).

Portal: `signInCode.test.ts` (failure mapping), `SignInCodeStep.test.tsx` (autocomplete attribute, resend countdown, wrong/expired/too-many/rate-limited/offline banners, under-review, success path), `SignInPage.test.tsx` (link beside Forgot, empty email focuses the field).
Phone: auth service tests (request/verify, error mapping), widget tests for the step (oneTimeCode hint, resend timer, errors, RTL at 375 px, back to password).

## 5. QA scenarios

- **portal.signin.email-code** (en, ar): type email → "Email me a sign-in code" → code step → read the code from the dev outbox → type it → Home. Wrong code shows "That code isn't right"; "Use my password instead" returns to the form with the email kept.
- **ios.signin.email-code** (en, ar): the same on the iOS Simulator against the local API.
- **Android:** release-qa has no Android app (QA-STANDARD: Android out for now). Covered by the shared Dart widget and service tests, which run platform-independent; an Android emulator run is a follow-up when Android QA is set up.

## 6. Cost and risk

One small table, one row per ask, deleted daily. Mail only to real accounts, inside existing caps. No new vendor. Risk: a stranger asking for codes for someone's address replaces their live code (an annoyance, capped at 5 a day; the password still works).
