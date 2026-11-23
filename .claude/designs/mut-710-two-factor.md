# MUT-710 — Two-step sign-in and 12-month authentication logs (SHAAM security appendix §17, §19)

Ticket: MUT-710 (epic MUT-566, blocks MUT-638 signing). Basel, 2026-11-22: build first, then sign. Second factor: an
authenticator app (TOTP) or an emailed code, the person's choice; no SMS; passkeys stay a sign-in method and are not
relied on as a second factor.

Scope built here: items 1 (two-step sign-in) and 2 (authentication logs, 12 months, encrypted at rest). Items 3–8 are
planned in a MUT-710 comment, not built.

ADR: **ADR-274** (number reserved above the in-flight ADR-269…271 of MUT-657/660/662/701/709; renumber at merge if
needed). API: **1.135.0-mut710** (renumbered at merge). Migration: `20261124120000_mut710_two_factor` (sorts after
MUT-660 `20261122230000`, MUT-662 `20261123000100`, MUT-709 `20261123000000`, MUT-702 `20261123100000`).

## 1. Problem and acceptance criteria

The appendix (22-07-2025) §17 requires customers to sign in with something they know plus a one-time code; §19
requires authentication and identification logs kept encrypted for 12 months. Today: password, emailed sign-in code,
passkeys, Sign in with Malafat; no second factor; audit rows only per organization (a person with no profile leaves no
trace), no defined retention, Cloud Logging default 30 days.

- AC1 A person can turn on two-step sign-in with an authenticator app (QR + secret, a verify step) or an emailed code,
  and gets 10 one-time recovery codes.
- AC2 With it on, every sign-in (password, passkey, emailed code, Malafat; portal cookie and phone device session) asks
  for the second step before a session exists. A recovery code works once in place of the code.
- AC3 With it on, a password reset (setup link, purpose RESET) asks for the second step before the new password is set.
- AC4 `POST /v1/issuing/tax-authority/connect`, `POST /v1/issued-documents`, `POST /v1/issuing/allocation-decisions`
  and `PUT /v1/issuer` refuse with
  `403 TWO_FACTOR_SETUP_REQUIRED` (pointing to setup) unless the person has two-step sign-in on **and** this session
  passed it. Optional for everyone else.
- AC5 TOTP secrets are sealed at rest (AES-256-GCM). Emailed codes are stored as HMAC digests, live 10 minutes, 5 tries,
  resend rate-limited.
- AC6 Every two-step event goes to the audit log (per profile, as sign-in does) **and** to the authentication log.
- AC7 Authentication events (sign-in success/failure/lockout, every two-step event, password change/reset, Tax
  Authority connect, token issue and refresh) are written to a Cloud Logging bucket kept 365 days, encrypted at rest;
  a Terraform test asserts the bucket, its retention and the sink filter.
- AC8 The phone and portal screens follow the wireframes Basel approved on 2026-11-22 (`mut-710-wireframes.html`).

## 2. Decisions (→ ADR-274)

D1 **Where the second step sits.** After the first credential verifies and before `issueSession`. One function,
`beginOrIssue(c, deps, user, audit, lifetime)` in `auth/sign-in.ts`, replaces the direct `issueSession` call in the
three sign-in wrappers and in `malafat-sign-in.ts` `signedIn()`. If the person has no two-step sign-in it issues the
session as today; otherwise it creates a challenge and throws `403 TWO_FACTOR_REQUIRED` with
`details: { challengeToken, method: 'totp'|'email', expiresAt, emailHint? }`. Error-envelope 403, like
`ACCOUNT_UNDER_REVIEW`: an old phone build shows the server's message ("Update MTB3A to finish signing in") instead of
crashing; only people who turned it on are affected. The phone's minimum build is raised once its half ships.

D2 **Finishing.** `POST /v1/sessions/two-factor` (cookie) and `POST /v1/device-sessions/two-factor` (device), body
`{ challengeToken, code } | { challengeToken, recoveryCode }`, answer exactly what the first route would have (201 Me
+ cookie, or 201 `{ token, me }`). The challenge remembers the session kind, method and passkeyId of the first step, so
the session and its `user.signed_in` audit are the same as today plus `twoFactor: 'totp'|'email'|'recovery_code'`. The
cookie route is same-origin checked, like `/v1/sessions`. `POST /v1/two-factor/email-code` `{ challengeToken }` mails a
fresh code (email method only).

D3 **Challenge rules.** Token: 32 random bytes, stored as HMAC digest (`sessionDigest(pepper, 'two-factor:'+token)`);
10 minutes; single use; bound to the person and the session kind. Every counter is a conditional UPDATE, never
read-then-write (review 2): `attempts < 5 AND consumedAt IS NULL → attempts + 1`, consume `consumedAt IS NULL`,
`lastUsedStep < $step`, a recovery code `usedAt IS NULL`. 5 wrong codes kill the challenge. **Lockout (review 1):** with
two-step on, the first step no longer clears the email key's throttle (`throttle.clear` moves to finish), so "password,
4 wrong codes, password again" keeps counting; and the person's row carries a database lockout that survives instances
and restarts (`two_factor.failures`, `failuresSince`, `lockedUntil`: 5 wrong second steps in 15 minutes lock the second
step for 15 minutes, 429 with Retry-After, `user.locked_out { method: 'two_factor' }` audited). An attacker without the
password can't trigger it. The person's state is rechecked at finish: status, closure, and `passwordChangedAt` equal to
the value stored on the challenge (a password change in between voids it), then the existing `FOR SHARE` recheck in
`sessions.create`.

D4 **TOTP.** RFC 6238: HMAC-SHA1, 6 digits, 30 s, ±1 step; 20-byte secret, base32. Written on `node:crypto` (≈40 lines,
RFC test vectors), no dependency. Replay: `lastUsedStep` stored by a conditional update; a step ≤ last used is refused.
The secret is sealed with the existing `TokenBox` (MUT-571, AES-256-GCM, HKDF) under its own context
`mutaba3a/two-factor-totp/v1` and its own key **`TWO_FACTOR_SEAL_KEY`, required on production and staging with no
fallback** (review 7; outside them it derives from the session pepper, as the Tax Authority box does). Recovery-code
digests use a second HKDF key from the same secret (context `mutaba3a/two-factor-recovery/v1`) over `userId:code`, so
rotating the session pepper (the documented "sign everyone out") doesn't void recovery codes. The enrolment answers
`{ secret, otpauthUri, qrSvg }`; the QR is drawn on the server with `uqr` (MIT, zero dependencies) so both clients just
show it (one dependency instead of a QR library in each client). Issuer label `MTB3A`, account = the person's email.

D5 **Emailed code.** 6 digits, 10 minutes, 5 tries, digest `HMAC(pepper, 'two-factor-code:'+challengeId+':'+code)`,
kept on the challenge row. Mailed when the challenge is created and on resend; resend at most once per 30 s and 5 times
per challenge; plus a per-person limiter (10 mails/hour). New template `two-factor-code` (ar/en), never in the
recipient cap exemption list.

D6 **First step with two-step on.** Password, passkey and Malafat are first steps. Linking a Malafat identity to an
account that has two-step on is refused for now (`TWO_FACTOR_LINK_UNAVAILABLE`, review 8): `/v1/auth/malafat/link` and
`/consent` write the link before any session exists, so a password alone could attach an identity. An already-linked
person's Malafat sign-in (`/exchange`) goes through the challenge like any other first step. Linking after the second
step is a follow-up (TD). An emailed sign-in code is a first
step only when the second step is the authenticator app: an emailed code then an emailed code is one factor twice, so
with the email method `POST /v1/sessions/code` answers `TWO_FACTOR_USE_PASSWORD` after the code matched (no account
oracle: it is only said to the person who proved the mailbox).

D7 **Passkeys.** A passkey sign-in is still asked for the second step (Basel's comment: not relied on). Passkeys as a
sign-in method and the operator's passkey step-up are unchanged.

D8 **Enrolment.** `GET /v1/me/two-factor` (state); `POST /v1/me/two-factor/enrolment` `{ method, currentPassword? }`
starts. Proof required (review 5): the current password when the person has their own (`ownPassword`), otherwise an
emailed code (the email method's own test code, or one mailed for the app method); with two-step already on, the
current second step as well. `POST /v1/me/two-factor/enrolment/confirm` `{ enrolmentToken, code }` turns it on and
answers the 10 recovery codes once; it takes the person's row lock so two parallel enrolments can't leave two sets of
codes. Turning it on stamps this session `twoFactorAt` and signs out the person's other sessions (reason
`two_factor_enabled`), which were opened with one step. Switching method is a new enrolment. **A notice is mailed** on
turning on, off, switching and new recovery codes (template `two-factor-changed`, ar/en), so a takeover by enrolment is
seen by the mailbox owner. A password-change rotation **copies `twoFactorAt`** to the new session (review 6:
`prisma.ts` builds the rotated row field by field).
`POST /v1/me/two-factor/recovery-codes` regenerates (password + second step). `DELETE /v1/me/two-factor` turns it off
(password + second step), refused with `TWO_FACTOR_REQUIRED_FOR_ISSUING` while the person owns a profile that has a
Tax Authority connection or an issuer set up.

D9 **Recovery codes.** 10 codes, `xxxx-xxxx` from a 32-letter alphabet without look-alikes (40 bits each), stored as
pepper HMAC digests, single use, `user.two_factor_recovery_code_used` audited with codes left. Lost everything: the
operator resets it after checking identity (`npm run users -- two-factor-reset --email …` → `DELETE
/admin/v1/users/{id}/two-factor`, ADMIN audit, the person's sessions signed out, a notice mailed).

D10 **The gate (AC4).** A route middleware `requireTwoFactor()` in `auth/two-factor.ts`, placed **before**
`idempotent(...)` (review 3: `idempotency.ts` stores and replays any 4xx, so a refusal inside the handler would replay
forever under the same key). On: `POST /v1/issuing/tax-authority/connect`, `POST /v1/issued-documents`,
`POST /v1/issuing/allocation-decisions` (uses the stored Tax Authority token) and `PUT /v1/issuer` (sets the details
sent to the Tax Authority, so the prompt meets the person at the start of setup). `DELETE /v1/issuing/tax-authority`
stays open on purpose: cutting the connection must always work. Passes when `identity.session.twoFactorAt` is set and
the person's two-step sign-in is on. `issuing:write` is session-only (`SESSION_ONLY_SCOPES`), so no agent or API key
path exists; a delegated Malafat token never reaches issuing (`issuingProfile` 404s it). Shipped dark: enforced only with `TWO_FACTOR_ISSUING_GATE_ENABLED=true` (Terraform `two_factor_issuing_gate_enabled`, default false), turned on once the screens are live and the people who issue have turned it on. Refusal:
`403 TWO_FACTOR_SETUP_REQUIRED { enrolled: boolean }` ("enrolled" = on but this session predates it: sign in again).

D11 **Password and setup links.** Every person link (recovery RESET, SETUP, operator links, `--lock` included) asks for
the second step when the person has it on, whatever its purpose (review 4: after a `--lock` nulls the hash, the next
operator link is SETUP). `POST /v1/account-setup/check` reports `twoFactor: { method } | null`;
`POST /v1/account-setup/two-factor` `{ token }` creates a challenge bound to that link's id (and mails the email code
on this explicit call, never from `/check`, which runs on every page load); `POST /v1/account-setup` then needs
`{ challengeToken, code | recoveryCode }`, consumed in the same transaction as the link's `redeem`. With the email
method a reset rests on the mailbox alone (link + code both mailed); stated in the ADR, and the enrolment screen marks
the authenticator app Recommended. Runbook: a suspected takeover is `rotate --lock` **plus** `two-factor-reset` (the
attacker may have enrolled their own factor).

D12 **Authentication log (AC7).** One helper, `authLog(logger, event)` in `observability/auth-log.ts`, writes a
structured line `{ event: 'auth_event', kind, userId, emailKey?, method?, sessionKind?, ip, userAgent, requestId,
outcome }` (no codes, tokens or passwords; an unknown email is an HMAC `emailKey`, never the address). Called beside
every existing sign-in audit, every two-step event, password change/reset, and in the Tax Authority service: connect,
connect failure, disconnect, token issue (callback) and refresh / refresh failure (`accessTokenFor`). Terraform
`server/infrastructure/terraform/auth_log.tf`: a log bucket `auth-events` in the API's region, `retention_days = 365`,
and a project sink into it with a pinned filter (review 9): `logName="projects/<project>/logs/run.googleapis.com%2Fstdout"
AND resource.type="cloud_run_revision" AND resource.labels.service_name="<api service>" AND jsonPayload.event="auth_event"`.
A same-project bucket destination needs no IAM grant. Encrypted at rest by Google's default AES-256 (as Cloud SQL
is); CMEK is an option, not needed. `locked = var.auth_log_bucket_locked` (default false) and `prevent_destroy`:
locking is irreversible (no shorter retention, no delete, it stays behind on a project move), so it's an operator step
after the first month's check. Test: `terraform/tests/auth_log.tftest.hcl` (`command = plan`, mock provider) asserts
retention 365, location, the sink's destination and every filter clause; a mock can't check filter syntax, so
`docs/operations/before-release.md` adds `gcloud logging read '<filter>' --limit=1` after the first deploy. The
privacy policy states the 12-month retention (passed to the MUT-700 session).

D13 **Audit rows.** Two-step events also go to `audit_events` through the existing `auditToMembers` pattern:
`user.two_factor_enabled|disabled|recovery_code_used|recovery_codes_regenerated|reset_by_operator`, each wrong second
step `user.two_factor_failed`, its lockout `user.locked_out { method: 'two_factor' }`, and a passed second step as
`twoFactor` on the existing `user.signed_in` row; Tax Authority `tax_authority.token_refreshed|token_refresh_failed`.
Creating a challenge is logged to the bucket only (one per sign-in attempt would double the audit rows and say nothing
the sign-in row doesn't). The log bucket is the complete 12-month record (it covers people with no profile and unknown
emails); audit rows keep their current lifetime (they live and die with the profile). No pruning of `audit_events` is
added: deleting from the append-only business audit isn't needed for §19.

D14 **One way to mint a session.** `issueSession` stops being exported; `beginOrIssue` (sign-in wrappers, Malafat
`/exchange`) and `finishTwoFactor` are the only callers, so a future sign-in route can't skip the second step.

## 3. Data (migration `20261124120000_mut710_two_factor`, additive)

- `two_factor` (1:1 user): `userId` PK FK cascade, `method` enum `TwoFactorMethod (totp, email)`, `totpSecretSealed`
  text null, `lastUsedStep` bigint null, `failures` int, `failuresSince` null, `lockedUntil` null, `enabledAt`,
  `updatedAt`.
- `two_factor_recovery_codes`: `id`, `userId` FK cascade, `codeDigest` varchar(64) unique, `createdAt`, `usedAt` null;
  index `(userId)`.
- `two_factor_challenges`: `id`, `userId` FK cascade, `tokenDigest` varchar(64) unique, `purpose` enum
  `TwoFactorPurpose (sign_in, enrol, reset, manage)`, `method`, `sessionKind` null, `firstStep` jsonb (method,
  passkeyId), `passwordChangedAt` null, `linkId` null (reset), `pendingSecretSealed` text null (enrolment), `codeDigest` null,
  `codeSentAt` null, `codesSent` int, `attempts` int, `expiresAt`, `consumedAt` null, `createdAt`; index `(expiresAt)`,
  `(userId)`. Pruned by the hourly `mailPruneTimer` 24 h after expiry (as `sign_in_codes`).
- `sessions.twoFactorAt` timestamp null.

Purge: all three tables in `prisma-purge-tables.ts` (`delete`) and `OUTSIDE_PROFILES`; store-guard classifies the new
sub-store (`sessionOnly` reads/writes for the person, `operator` for reset).

## 4. Code map

Server:
- `auth/totp.ts` (pure), `auth/two-factor.ts` (policy, recovery codes, digests, gate), `auth/sign-in.ts` (`beginOrIssue`,
  `finishTwoFactor`), `routes/two-factor.ts` (enrolment, manage, finish, resend), `routes/sessions.ts`,
  `routes/device-sessions.ts`, `routes/malafat-sign-in.ts`, `routes/account-setup.ts`, `routes/tax-authority.ts`,
  `routes/issuing.ts`, `routes/admin-users.ts` (operator reset), `scripts/users.ts`, `israel/tax-authority/service.ts`
  (refresh audit + log), `observability/auth-log.ts`, `repositories/{ports,memory,prisma}.ts`, `auth/store-guard.ts`,
  `repositories/prisma-purge-tables.ts`, `email/{ports.ts,templates/copy.ts}`, `schemas.ts` (Me `user.twoFactor`
  additive: `{ enabled, method, recoveryCodesLeft, requiredForIssuing }`), `config.ts`, `index.ts`, `app.ts`
  (API_VERSION, route mount), OpenAPI snapshot.
- Terraform: `auth_log.tf`, `variables.tf`, `tests/auth_log.tftest.hcl`.

Portal (after wireframe approval): `pages/auth/SignInPage.tsx` + new `TwoFactorStep.tsx`, `pages/auth/SetupPage.tsx`,
`pages/auth/malafat/MalafatReturnPage.tsx`, `pages/you/YouAccount.tsx` row, `components/TwoFactorDrawer.tsx` (panes:
choose → app/email → recovery codes → done; manage), `shell/AccountDrawers.tsx` (`?twoFactor=`), the issue drawer and
the Tax Authority connect card (TWO_FACTOR_SETUP_REQUIRED banner + "Set up"), i18n ar/en.

Phone (own worktree, after approval): `domain/services/auth_service.dart` (finish + resend), the sign-in screen's
second step beside `email_code_step.dart`, Malafat repository, settings › two-step screen, the issuing prompt, error
codes in `core/errors.dart`.

## 5. QA scenarios (release-qa)

portal: `portal.auth.two-factor-enrol-app` (turn on with the app: scan, code, recovery codes shown) ·
`portal.auth.two-factor-sign-in` (sign in, code step, in) · `portal.auth.two-factor-recovery-code` (sign in with a
recovery code; it then counts one fewer) · `portal.auth.two-factor-email` (email method: code mailed, entered) ·
`portal.issuing.two-factor-required` (issue without it → prompt → set up → issue works) · `portal.auth.two-factor-reset`
(reset password asks for the code) · phone: `ios.auth.two-factor-sign-in`, `ios.issuing.two-factor-required`.
The API's dev outbox (`/dev/outbox`) supplies emailed codes; a fixed TOTP secret in the QA seed supplies app codes.

## 6. Cost and risk

No new service. Cloud Logging: auth lines are a few KB/day, inside the free 50 GiB ingestion; retention past 30 days
is $0.01/GiB-month → cents a year. One `two_factor` read per sign-in (by primary key). Risk: a person locked out of
issuing until they enrol (intended, §17); a lost phone (recovery codes, operator reset); old phone builds can't finish
a two-step sign-in (message + minimum build).

## Business / product impact
- Narabnd can sign the SHAAM security appendix truthfully on §17 and §19, which blocks MUT-638 and all allocation-number
  issuing (epic MUT-566, v2).
- Every customer gets an opt-in second factor; issuing customers are protected against a leaked password reaching
  their Tax Authority connection.
- Cost is negligible; the risk is support load from lost factors, covered by recovery codes and an audited operator reset.
