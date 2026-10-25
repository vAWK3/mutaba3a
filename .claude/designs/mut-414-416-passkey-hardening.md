# MUT-414 / MUT-415 / MUT-416 — passkey hardening after MUT-115

Plan, 2026-10-25. Epic MUT-34. Blockers MUT-115 (merged both repos), MUT-359 (Done), MUT-366 (Done).
Branches: mini-crm `feature/mut-414-416-passkey-hardening`, flutter `feature/mut-415-416-passkeys`.

## MUT-414 — "A passkey was added" email (server)

The seam exists: `PasskeyEvents.added` in `server/src/routes/passkeys.ts`, called after the add commits.

- `email/ports.ts`: template `passkey-added`, vars `{ passkeyName: string; signInLink: string }`.
  In `RECIPIENT_CAP_EXEMPT` (adding needs a recent sign-in or the password, like the password notice; a stranger's
  signup requests must not cap away the takeover alert). Not a recovery template.
- `email/templates/copy.ts`: en/ar copy. Names the passkey; says "was just added"; outro "Not you? Change your password
  and remove this passkey (You › Account › Passkeys)."
- `email/passkey-notice.ts`: `passkeyAddedEvents(mailer, logger, settings)` → a `PasskeyEvents` that sends with
  idempotency key `passkey-added:<passkeyId>`, catches everything (a mail failure never fails the add), logs non-`sent`
  at debug like `sendPasswordNotice`.
- `PasskeyEvents.added` event gains `requestUrl` (for `signInLinkOf`).
- `app.ts`: `deps.passkeyEvents ?? passkeyAddedEvents(mailer, logger, sessions)`.
- Tests: notice unit (sent / suppressed / failed transport / throws → never rejects), route test (add sends exactly one
  mail in the account's locale via the memory mailer; suppressed address: add still 201, nothing sent; failing
  transport: add still 201), templates test picks up the new id (no amount/date vars).

**D1 — no timestamp in the mail.** ADR-159 §5 keeps dates out of mail (one logged exception). The mail is sent the
moment the passkey is added and says "just added"; the mail's own time is the time. Deviation from the ticket's
"names the passkey and the time", noted on the ticket.

## MUT-415 — review passkeys after a password change or recovery

No API change: `GET /v1/passkeys`, `DELETE /v1/passkeys/{id}` (removal signs out that passkey's sessions, MUT-115 D6).

**Portal**
- `ChangePasswordDrawer`: on success, if `passkeySupport()`, read the list (`api.listPasskeys`, seeds `PASSKEYS_KEY`).
  One or more → replace the drawer with `?passkeys=true&review=password`; none, or the read fails → close + toast as
  today (no extra step).
- `SetupPage`: after a non-SIGNUP redeem signs in, the same check → `/` with `?passkeys=true&review=recovery`.
- `ProfileDrawerSearch` / `parseProfileDrawer` carry `review: 'password' | 'recovery'`.
- `PasskeysDrawer` takes `review`: intro becomes "Your password is changed / set. These passkeys still sign in to your
  account. Remove any you don't recognise."; the footer shows Done instead of Add. List, rename, in-row remove unchanged.
- en/ar strings; RTL at 375 px.
- QA: `qa/specs/portal-selfservice/passkeys.spec.ts` gains "after a password change, the passkeys are listed and one is
  removed in place" (virtual authenticator).

**Phone**
- `ChangePasswordScreen`: on `Ok`, read `passkeyRepository.list()`. One or more → `pushReplacement` to Settings ›
  Passkeys with `?review=1`; none or failure → pop as today. Snackbar "Password changed" stays.
- `PasskeysScreen(review: true)`: the review intro above the list, "Done" in the app bar; rows keep tap → Remove.
- Recovery redeem happens in the portal (the app opens /recover in the in-app browser), so the phone has no redeem
  step: AC 3 is the portal's.
- QA: `ios.passkey.review-after-password` (`integration_test/qa/passkey_review_test.dart`).

## MUT-416 — passkey in the QuickType bar (iOS)

**Finding (scope item 1):** `passkeys` 2.23.1 / `passkeys_darwin` 0.4.5 support it: `AuthenticateRequestType.mediation =
MediationType.Conditional` runs `ASAuthorizationController.performAutoFillAssistedRequests()`, and
`cancelCurrentAuthenticatorOperation()` cancels it. `authenticate()` already cancels any in-flight operation first, so
the button's modal request ends the conditional one. The email field already has `AutofillHints.username`
(textContentType `.username`), which iOS needs to offer passkeys.

- `WebAuthnService.authenticate(publicKey, {bool conditional = false})` → `mediation: Conditional` when set;
  `cancel()` → `cancelCurrentAuthenticatorOperation()` (never throws).
- `AuthService.signInWithPasskey(webAuthn, {bool conditional = false})` and the notifier pass it through.
- `SignInScreen`: once `passkeySupportProvider` is true, start one conditional sign-in. A generation counter drops the
  results of a superseded request. Cancel it on password submit, on the passkey button (and ignore its cancelled
  result), and on dispose. Re-arm after a password refusal or a dismissed button sheet, and when the email field gains
  focus with a request older than 4 minutes (challenge TTL 5 min). Never re-arm in a loop on an immediate failure.
  A conditional result is handled like the button's: signed in → router moves on; refused → the passkey error line.
- Password `AutofillGroup` untouched (saved passwords still offered).
- Cost: one `POST /v1/passkey-challenges` per sign-in screen visit (plus re-arms), under the sign-in IP limiter.
- QA: `SoftPasskeyAuthenticator` holds a conditional request until the flow "picks" it (stands in for the QuickType
  tap); new flow `ios.passkey.quicktype`: open sign-in, a conditional request is waiting, tap email, pick → Capture;
  and password sign-in with the request pending still works. The real QuickType bar needs a real iPhone: manual pass.

## Tests / commands
- mini-crm: `npm --prefix server test`, typecheck, lint, `openapi:check`; portal vitest for the drawers; release-qa web.
- flutter: unit/widget tests for service, screens; `flutter analyze`; flows on "Mutaba3a QA" via `release-qa --wait`.
