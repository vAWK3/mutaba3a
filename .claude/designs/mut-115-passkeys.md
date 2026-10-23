# MUT-115 — Sign in with a passkey on the portal and the iOS app

Jira: MUT-115 (Story, epic MUT-34). Blocked by MUT-112 — resolved for passkeys (Basel, 2026-10-23): `mtb3a.com` is live at stage `live`; the apex AASA item moves here. Blocks MUT-370. Relates MUT-64, MUT-113, MUT-237, MUT-366/367 (ADR-159).
Repos: mini-crm (`server/`, `src/hosted/`, `vite.config.ts`, Terraform) and the Flutter app (`/Users/basel/Work/Barmajiyat/Mutaba3a/mutaba3a-flutter/mutaba3a`, iOS only; its brief `.claude/designs/mut-115-passkeys.md` points here).
Status: plan, eng-reviewed 2026-10-23 (decisions D1–D12 below). **§11 wins over §1–§10 where they differ.**

## 1. Acceptance criteria (ticket) → where each is proved

| # | Criterion | Proof |
|---|---|---|
| A1 | A passkey created on the portal signs in on the iOS app, and the other way round | Server test: a credential created with origin `https://app.<rp>` asserts with origin `https://<rp>` (iOS) and vice versa. Manual QA `ios.passkey.cross-device` on a real iPhone against production (iCloud Keychain can't be automated). |
| A2 | Removing a passkey stops it working on the next attempt | Server test + `portal.passkey.remove` |
| A3 | Failed assertions follow the existing sign-in throttle and lockout | Server tests: 5 failed assertions lock the account's email key; password and passkey failures share one counter; a locked account's valid assertion is refused |
| A4 | A password change keeps passkeys, revokes sessions exactly as today | Server test (clock advanced between sign-in and change, MUT-237 lesson) |
| A5 | ADR-037 "no signup/invite/reset route" test still passes | `no-self-registration.test.ts`, re-pinned deliberately with the three new public operations |
| A6 | ADR-037 amendment records passkeys as a sign-in method | `.claude/DECISIONS.md` |

## 2. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | **RP ID = `mtb3a.com` (the apex).** Expected origins: `https://app.mtb3a.com` (portal, = `PORTAL_ORIGIN`) and `https://mtb3a.com` (iOS native assertions carry `https://<rpId>` as the origin). | Basel, 2026-10-23 |
| D2 | RP ID comes from `config/hosts.json` `domain` → Terraform `domain.tf` `front_door_env` sets `WEBAUTHN_RP_ID` at stages `live`/`redirect`. Optional `WEBAUTHN_ORIGINS` overrides the derived list for local dev (`localhost`). Config fails fast if any origin's host isn't the RP ID or a subdomain of it. Unset → every passkey route answers 404 and the portal hides passkey UI. | proposed |
| D3 | Libraries: `@simplewebauthn/server` (server) and `@simplewebauthn/browser` (portal), pinned exact. Attestation `none`, `residentKey: required` (discoverable, so sign-in needs no email), `userVerification: required`, ES256 + RS256. | proposed |
| D4 | **Adding a passkey needs a recent sign-in**: the session's `credentialsVerifiedAt` within 10 minutes, else the request carries `currentPassword` (verified with the same throttle as `POST /v1/me/password`, 403 `CURRENT_PASSWORD_WRONG`). Without it → 403 `RECENT_SIGN_IN_REQUIRED`. Why: passkeys survive a password change (A4), so a hijacked session must not be able to plant one. Right after sign-in (MUT-370's card) there is no extra prompt. | **needs Basel** |
| D5 | Challenges live in a DB table (`webauthn_challenges`), single-use, 5-minute TTL, consumed with one conditional UPDATE. Not in memory (Cloud Run may run more than one instance, TD-017) and not stateless (an assertion could be replayed inside its TTL). | proposed |
| D6 | A passkey sign-in session is bound like a password one: `verifiedPasswordHash = user.passwordHash`. So an operator `--lock` (which nulls the hash) or a racing password change wins, and an account without a password hash (locked, or never set up) can't sign in with a passkey. `credentialsVerifiedAt = now`, so a later password change revokes it (A4). | proposed |
| D7 | Removing a passkey doesn't revoke sessions it already opened (sessions don't record their credential). Recorded as debt. | **needs Basel** |
| D8 | iOS native layer: our own `MethodChannel('mutaba3a/passkeys')` over `ASAuthorizationPlatformPublicKeyCredentialProvider`, not the `passkeys` pub package: no third-party code in the auth path; it follows the app's two existing channels; Android is out of scope. | **needs Basel** |
| D9 | Portal sign-in also offers passkey **autofill** (conditional mediation: `autocomplete="username webauthn"`), plus an explicit "Sign in with a passkey" button. iOS gets the button only. | **needs Basel** |
| D10 | Paths avoid every word in `no-self-registration`'s regex (`/sign-?up|register|invite|forgot|reset/i`): `creation-options`, not `registration-options`. | proposed |
| D11 | Portal UI is a **drawer** opened from the account menu (no settings page exists; drawer-first rule), not the "settings page" the ticket names. | proposed |
| D12 | At most 10 passkeys per person (409 `PASSKEY_LIMIT`). | proposed |

## 3. Server

### 3.1 Data (migration `YYYYMMDDHHMMSS_mut115_passkeys`)

- `passkeys`: `id uuid`, `userId` → users (cascade), `credentialId` (base64url, unique), `publicKey Bytes`, `signCount Int`, `transports String[]`, `deviceType` (`singleDevice|multiDevice`), `backedUp Bool`, `aaguid VarChar(36)`, `name VarChar(64)`, `createdAt`, `lastUsedAt?`; `@@index([userId])`.
- `webauthn_challenges`: `id uuid`, `challenge` (base64url), `purpose` (`creation|authentication`), `userId?` (set for creation), `expiresAt`, `consumedAt?`; `@@index([expiresAt])`. Pruned by the existing timer in `server/src/index.ts:109-117`.
- User handle = the user's UUID (not PII); an assertion must carry the same handle as the stored credential's user.
- Ports and both stores: `PasskeyRepository` and `WebauthnChallengeRepository` in `server/src/repositories/ports.ts`, implemented in `memory.ts` and `prisma.ts`, added to `LedgerStore`. `challenges.consume(id, purpose, userId?, now)` is atomic (`UPDATE … WHERE consumedAt IS NULL AND expiresAt > now RETURNING`).

### 3.2 Routes

| Route | Auth | Notes |
|---|---|---|
| `GET /v1/passkeys` | session, deviceSession | id, name, createdAt, lastUsedAt, deviceType, backedUp |
| `POST /v1/passkeys/creation-options` | session, deviceSession | D4 gate; `excludeCredentials` = own passkeys; stores a creation challenge bound to the user |
| `POST /v1/passkeys` `{challengeId, name, response, currentPassword?}` | session, deviceSession | verifies, D4 gate again (the option call isn't trusted), D12 cap; audit `user.passkey_added` |
| `PATCH /v1/passkeys/{id}` `{name}` | session, deviceSession | own passkeys only, else 404 |
| `DELETE /v1/passkeys/{id}` | session, deviceSession | hard delete; audit `user.passkey_removed` |
| `POST /v1/passkey-challenges` | public | request options with an empty `allowCredentials`; per-IP limit `passkey-challenge:<ip>` |
| `POST /v1/sessions/passkey` `{challengeId, response}` | public | `isSamePortalOrigin` first (CSRF unchanged); sets the `__Host-` cookie; 201 Me |
| `POST /v1/device-sessions/passkey` `{challengeId, response}` | public | 201 `{...me, token}` (`mds_`) |

- New files: `server/src/routes/passkeys.ts` (the five authed routes) and `server/src/auth/webauthn.ts` (config, option builders, a thin wrapper around simplewebauthn). The two sign-in routes join `routes/sessions.ts` and `routes/device-sessions.ts` beside their password twins and share their `sign-in:<ip>` limiter. Mounted in `app.ts`. Organization-independent routes are added to the `*_ORGANIZATION_INDEPENDENT_ROUTES` sets.
- Schemas in `server/src/schemas.ts`; `server/openapi/openapi.yaml` regenerated; `API_VERSION` → next free minor `-mut115`, plus the milestone tests that pin it; `npm run hosted:types`.

### 3.3 Sign-in core (`server/src/auth/sign-in.ts`)

Refactor first, behaviour unchanged (existing tests stay green):
- extract `recordSignInFailure(c, deps, key, user, kind)` (throttle, `recordFailedSignIn`, `user.locked_out` audit);
- extract `issueSession(c, deps, user, kind, lifetime, verifiedPasswordHash)` (token, digest, `sessions.create`, `StateConflict` → 401, `recordSignIn`, audit);
- `auditToMembers` metadata gains `method: 'password' | 'passkey'`.

`signInWithPasskey(c, deps, {challengeId, response}, kind, lifetime)` in a new `server/src/auth/passkey-sign-in.ts`:
1. Consume the authentication challenge. Missing, used or expired → 401 `INVALID_CREDENTIALS`.
2. Find the passkey by `response.id`. Unknown → 401 (only the IP limiter applies: there's no email key to count against).
3. Load the user. `key = normalizeEmail(user.email)`; locked = `throttle.isLocked(key)` or `lockedUntil > now`.
4. `verifyAuthenticationResponse` (expected challenge, origins, RP ID, UV required, the user handle matches).
5. If the check fails, the account is locked, `status !== 'ACTIVE'`, `passwordHash === null`, or the counter went backwards (both non-zero and new ≤ stored) → `recordSignInFailure` unless already locked → 401. A backwards counter also audits `user.passkey_counter_regressed`.
6. Success: `throttle.clear(key)`, update `signCount`/`lastUsedAt`, `issueSession(..., user.passwordHash)` (D6), audit `user.signed_in {sessionKind, method:'passkey', passkeyId}`.

`POST /v1/me/password` is unchanged. It never touches `passkeys` (A4).

### 3.4 Config and infrastructure

- `server/src/config.ts`: `WEBAUTHN_RP_ID` (optional) and `WEBAUTHN_ORIGINS` (optional comma list), with the D2 cross-check. Wired through `SessionSettings`/deps in `index.ts`.
- `server/infrastructure/terraform/domain.tf`: `WEBAUTHN_RP_ID = <domain>` at live/redirect; `tests/domain.tftest.hcl` covers it. `scripts/hosts.ts`: the plan prints the env row; the phone line drops "needs the apex AASA first".
- **Apex AASA (from MUT-112):** `netlifyRedirects()` in `vite.config.ts` adds, at live/redirect, a 200 proxy rewrite: `https://<apex>/.well-known/apple-app-site-association → https://<portal>/.well-known/apple-app-site-association 200!`. One source of truth (the server's `APPLE_TEAM_ID`/`APPLE_BUNDLE_ID`); hosts come from `config/hosts.json`, so `no-hardcoded-hosts` stays green. iOS reads only `webcredentials` for the apex, because the entitlement lists no `applinks:` for it.
- `server/.env.example`, `.claude/INFRA.md`, `server/DEPLOYMENT.md` §5a. `docs/operations/before-release.md`: a phone-release item to check the apex AASA (200, `application/json`, no redirect) and Apple's CDN copy (`app-site-association.cdn-apple.com/a/v1/mtb3a.com`).

## 4. Portal (`src/hosted/`)

- `src/hosted/passkeys/webauthn.ts`: `passkeySupport()` returns true only when `window.PublicKeyCredential` exists and `location.hostname` is the build's RP ID or a subdomain of it. The RP ID is a Vite `define` from `config/hosts.json`, so the legacy run.app host hides passkeys. It also wraps `startAuthentication`/`startRegistration` and maps `NotAllowedError`/`AbortError` to "cancelled", which shows no error.
- `src/hosted/api/client.ts`: `listPasskeys`, `passkeyCreationOptions`, `addPasskey`, `renamePasskey`, `removePasskey`, `passkeyChallenge`, `signInWithPasskey`.
- `SignInPage.tsx`: a "Sign in with a passkey" button and autofill (D9). The email field uses `autoComplete="username webauthn"`; conditional mediation starts on mount and is aborted when the button or the form submits. The success path is extracted into one `onSignedIn(me)` handler shared with the password mutation. Errors: 401 → "That passkey didn't work. Try again, or use your password." 429 → the existing rate-limit copy.
- `src/hosted/components/PasskeysDrawer.tsx`, opened from `UserMenu.tsx` beside Change password. Overlay key `passkeys` goes into `SHELL_OVERLAY_KEYS` (`src/hosted/data/filters.ts`), rendered in `AccountDrawers.tsx`. The drawer: the list (name, added, last used), Add (a name field defaulting to "Passkey"; a password field appears on 403 `RECENT_SIGN_IN_REQUIRED`), inline rename, and Remove with a confirm. It reuses the `ChangePasswordDrawer` patterns and the registry's Drawer chrome.
- i18n `hosted.auth.passkey.*` and `hosted.account.passkeys.*` in `en.json`/`ar.json`. RTL checked at 375 px. The copy must pass `scripts/bundle-rules.ts` `HOSTED_RULES` (no "create account" etc.).

## 5. iOS app (Flutter repo)

- `ios/Flutter/AssociatedDomains.xcconfig`: `MUTABA3A_PASSKEY_RP_ID = mtb3a.com`. `ios/Runner/Runner.entitlements` adds `webcredentials:$(MUTABA3A_PASSKEY_RP_ID)$(MUTABA3A_LINK_MODE)`. `test/platform/associated_domains_config_test.dart` requires it and states it is iOS-only (Android parity checks exclude it).
- `ios/Runner/PasskeyChannel.swift`, registered in `AppDelegate.didInitializeImplicitFlutterEngine` like `WidgetReloadChannel`. Methods: `isSupported`, `create(optionsJson)`, `assert(optionsJson)`. It returns WebAuthn JSON (base64url `RegistrationResponseJSON`/`AuthenticationResponseJSON`). Errors: `cancelled` or `failed(<code>)`. The presentation anchor is the key window of the active scene (the app uses the scene lifecycle).
- Dart:
  - `lib/core/passkeys/passkey_platform.dart`: an abstract `PasskeyPlatform` with a channel implementation and a provider, so tests and QA can swap it.
  - `lib/data/repositories/passkey_repository.dart`: list, add, rename and remove through `ApiClient`.
  - `AuthService.signInWithPasskey()`: `POST /passkey-challenges`, then the native assertion, then `POST /device-sessions/passkey`. It shares a new `_adoptSession(DeviceSession)` with `signIn` (token write, cached Me).
  - `AuthNotifier.signInWithPasskey()`.
- `ApiError`: map 403 `RECENT_SIGN_IN_REQUIRED` and 409 `PASSKEY_LIMIT`.
- UI:
  - `SignInScreen` gets the button when `isSupported`.
  - `settings_screen.dart` gets a "Passkeys" row next to Change password.
  - A new `PasskeysScreen` at `/account/settings/passkeys` offers list, add (with a password sheet on `RECENT_SIGN_IN_REQUIRED`), rename and remove.
  - ARB keys in en and ar.
- Release order: server and web first; then confirm the apex AASA on Apple's CDN; then the phone. If the server is older, a tap on the button gets a 404, which shows the generic error and doesn't crash.

## 6. Tests first (TDD)

Server (`npm --prefix server test`, plus `test:db` for the Prisma stores):
- `server/src/__tests__/helpers/soft-authenticator.ts`: a real ES256 authenticator on `node:crypto` (creates attestation `none` and assertions for any origin). No mocking of simplewebauthn.
- `passkey-routes.test.ts`:
  - auth required;
  - adding with a recent sign-in → 201;
  - a stale session without a password → 403 `RECENT_SIGN_IN_REQUIRED`;
  - a wrong password → 403 that counts toward the lockout;
  - the 11th passkey → 409;
  - another person's id → 404 on PATCH/DELETE;
  - a creation challenge used by another user → refused;
  - a replayed or expired challenge, the wrong origin, the wrong RP ID, or no UV → refused.
- `passkey-sign-in.test.ts`:
  - the cookie route sets `__Host-mut_session` and refuses cross-site requests (403);
  - the device route returns an `mds_` token;
  - the cross-origin pair (A1);
  - removed → 401 (A2);
  - five bad assertions → locked; mixed password and passkey failures share the counter; a locked account's valid assertion → 401 (A3);
  - operator `--lock`, DISABLED, and a null hash → 401;
  - a backwards counter → 401;
  - an unknown credential → 401, and the IP limiter → 429;
  - a password change keeps the passkeys, revokes passkey-issued sessions other than the caller's, and a passkey sign-in works afterwards (A4, clock advanced).
- `sign-in.test.ts` (existing) stays green across the refactor.
- `no-self-registration.test.ts`: the allowlist adds `POST /v1/passkey-challenges`, `POST /v1/sessions/passkey` and `POST /v1/device-sessions/passkey` (A5).
- Others: config tests, a Prisma race on `consume` (two concurrent consumes, one wins), `openapi:check`, the milestone version pins, the tftest, the vite `netlifyRedirects` test, and `no-hardcoded-hosts`.

Portal (Vitest): `passkeySupport` host matching; `PasskeysDrawer` (list, add with a recent sign-in, the password prompt on 403, rename, remove); the `SignInPage` button hidden or shown, and cancellation showing nothing.

Flutter (`make test`): `AuthService.signInWithPasskey` with `FakeApiClient` and a fake `PasskeyPlatform`; `PasskeyRepository`; the channel error mapping; `SignInScreen` and the settings row hidden when unsupported; `PasskeysScreen`; the associated-domains guard; the router's forbidden-word test.

## 7. QA scenarios (release-qa)

Portal (`qa/features/portal/passkeys.yaml`, `qa/specs/portal/passkeys.spec.ts`). These use Chromium's CDP virtual authenticator (`WebAuthn.addVirtualAuthenticator`) against a local server with `WEBAUTHN_RP_ID=localhost`:
- `portal.passkey.add`: open Passkeys from the account menu → Add → name it → it is listed.
- `portal.passkey.sign-in`: sign out → Sign in with a passkey → Home.
- `portal.passkey.remove`: remove it → a passkey sign-in is refused.
- `portal.passkey.password-change-keeps`: change the password → the passkey still signs in.

iOS (`qa/features/ios/passkeys.yaml`, `integration_test/qa/passkeys_*_test.dart`). A Dart soft authenticator replaces `PasskeyPlatform` against the local server:
- `ios.passkey.sign-in`: sign out → Sign in with a passkey → Home.
- `ios.passkey.manage`: Settings → Passkeys → add, rename, remove.
- `ios.passkey.cross-device` (`manual: true`): on a real iPhone, a passkey made on `app.mtb3a.com` in Safari signs in to the app, and the other way round (A1).

The Swift channel itself is covered only by the manual flow. That limit is recorded as debt.

## 8. Cost, scale, risk

- Per attempt: one challenge row and one passkey lookup (unique index). Pruning keeps the table small. No third-party spend. The Netlify rewrite is fetched only by Apple's CDN.
- Abuse: unauthenticated challenge creation writes a row, so it gets a per-IP limit and pruning.
- Risk: passkeys are bound to `mtb3a.com` for life (D1, decided). Splitting the Cloudflare account later doesn't change the domain.

## 9. Knowledge updates

- ADR-037 amendment (MUT-115), plus a new ADR (D1–D9). ADR-170 is claimed on MUT-401's unmerged branch, so take the next free number at merge.
- TD entries:
  - no mail on a new passkey until MUT-359;
  - no operator passkey removal (an operator `--lock` covers a compromised account);
  - D7 sessions not linked to their passkey;
  - the Swift channel is manual-QA only;
  - Android passkeys.
- CHANGELOG, SYSTEM_OVERVIEW, COMPONENT_REGISTRY (`PasskeysDrawer`, `webauthn.ts`, `PasskeyPlatform`), PATTERNS (the soft-authenticator test helper), TEST_PLAN, INFRA.
- Jira: a comment on MUT-112 saying the apex AASA moved here.

## 10. Out of scope

Passkey-only accounts, Android passkeys, the MUT-370 suggestion card, signup and invite, operator passkey tools, iOS QuickType passkey autofill (now MUT-416), and attestation or AAGUID allow-lists. Also out: the passkey-added email (MUT-414, after MUT-359) and the passkey review after a password change or recovery (MUT-415).

## 11. Review amendments (approved 2026-10-23; these win over §1–§10)

1. **D4 step-up (A1/D5):** approved as drafted. A creation-options or add call is allowed when the session's `credentialsVerifiedAt` is ≤ 10 minutes old; otherwise it needs `currentPassword`, else 403 `RECENT_SIGN_IN_REQUIRED` (a wrong password → 403 `CURRENT_PASSWORD_WRONG`, counted toward lockout).
2. **D7 reversed (A2/D6): removing a passkey signs out the sessions it opened.**
   - Add nullable `sessions.passkeyId` (same migration). `issueSession` sets it on a passkey sign-in.
   - `DELETE /v1/passkeys/{id}` revokes those sessions (reason `passkey_removed`) and deletes the passkey in one transaction, keeping the caller's own session.
   - Tests: memory and Prisma (`test:db`).
3. **D8 reversed (SC1/D4): no Swift channel and no `PasskeyPlatform`.**
   - Port Malafat's `WebAuthnService` (Flutter history `406dd3c0`: `lib/features/auth/data/services/webauthn_service.dart` and its test) onto the `passkeys` pub package, pinned exact. It keeps its injectable `PasskeyAuthenticator` and its result taxonomy (Success / NotAvailable / Cancelled / Error).
   - Drop its `'Malafat'`/`'malafat.app'` fallbacks: the RP must come from the server.
   - `ios/Runner/PasskeyChannel.swift` and the `AppDelegate` registration are removed from scope. The entitlement and the guard-test changes stay.
4. **D9 approved (D1): portal autofill is in scope.**
   - The email field uses `autoComplete="username webauthn"`. Conditional mediation starts on mount when `PublicKeyCredential.isConditionalMediationAvailable()` is true.
   - Starting the button flow or submitting the password form aborts it (SimpleWebAuthn's abort service).
   - It re-arms 30 s before the 5-minute challenge TTL. QA adds `portal.passkey.autofill`.
5. **Rename kept (D2):** `PATCH /v1/passkeys/{id}`, with inline rename in the portal drawer and on the phone screen. Tests cover own / another person's (404) / an invalid name (422).
6. **Smaller server arrangement (D3):**
   - `signInWithPasskey` goes in `server/src/auth/sign-in.ts`; there is no `auth/passkey-sign-in.ts`.
   - One `PasskeyRepository` port carries the challenge methods (`createChallenge`, `consumeChallenge`, `pruneChallenges`), in `memory.ts` and `prisma.ts`.
7. **Shared current-password check (D7):** extract `verifyCurrentPassword(c, deps, user, auditActor)` into `sign-in.ts`, built on `recordSignInFailure`. `POST /v1/me/password` and the passkey step-up both call it. The refactor commit lands first, with the existing suites green.
8. **Regression contract (R1/D8):**
   - Preserved: the single 401 `INVALID_CREDENTIALS`; exactly one argon2 verify per attempt (a dummy hash for an unknown email); lockout keyed on the normalised email; the `verifiedPasswordHash` binding; change-password's 403 and its kept session.
   - **Lockout audit actors stay as they are** (sign-in SYSTEM, change-password USER).
   - The only intended change is `metadata.method`.
   - `auth/__tests__/sign-in.test.ts`, `__tests__/routes-sessions.test.ts`, `routes-device-sessions.test.ts` and `front-door-sign-in.test.ts` pass **unmodified** after the refactor commit. One new characterization test pins the actors and `method`.
9. **iOS QA (Q1/D9):**
   - A dev-only `pointycastle` (pinned) backs a Dart soft `PasskeyAuthenticator`, injected through the `WebAuthnService` provider in QA.
   - `ios.passkey.sign-in` and `ios.passkey.manage` run automated against the local server: `WEBAUTHN_RP_ID=localhost`, with `WEBAUTHN_ORIGINS` including the portal dev origin and `https://localhost`.
   - `ios.passkey.cross-device` stays `manual: true`.
10. **SC2:** `signCount BigInt` (uint32 counter).
11. **Required proof added:**
    - `POST /v1/sessions/passkey` is tested through a real Hono request with `FRONT_DOOR_TOKEN` set (extend `front-door-sign-in.test.ts`; the d4f4231e lesson).
    - An authentication challenge presented for a creation, or the reverse → refused.
    - Portal: a passkey sign-in runs the same `onSignedIn` path (mode remote, locale adopted, `safeNext`).
12. **Error codes:** `RECENT_SIGN_IN_REQUIRED` (403) and `PASSKEY_LIMIT` (409) are registered in `server/src/errors.ts`, mapped in `src/hosted/api/client.ts`, and mapped in Flutter's `lib/core/errors.dart` and `api_client.dart` `_mapError`.
13. **Device check before the phone release:** confirm on a real iPhone that the `passkeys` sheet presents under the app's scene lifecycle (`FlutterImplicitEngineDelegate`). The manual `ios.passkey.cross-device` run covers it.
14. **Follow-ups filed:** MUT-414 (passkey-added email, blocked by MUT-359), MUT-415 (passkey review after a password change or recovery), MUT-416 (iOS QuickType passkey autofill).

## 12. Design decisions (design review, 2026-10-23; these win over §4–§5)

### DR1 Portal sign-in order (D3, 1A)

```
┌──────────── /sign-in (one column, existing hp- card) ────────────┐
│ brand mark · title "Sign in"                                      │
│ [banner slot: hp-banner, role=alert]                              │
│ Email   [ you@firm.com           ]  ← autoComplete="username webauthn": passkeys offered here
│ Password[ ••••••••        Show ]                                  │
│ [■■■■■■■■■■■ Sign in (primary, full width) ■■■■■■■■■■■]          │
│ ─────────────── or ───────────────                                │
│ [□□□□□□□ Sign in with a passkey (secondary, full width) □□□□□□□]  │
│ help lines (existing: request, terms, continue on this device)    │
└───────────────────────────────────────────────────────────────────┘
```

The password form stays the primary path. The passkey button and the "or" divider render only when `passkeySupport()` is true.

### DR2 Portal Passkeys drawer (D4, 2A)

```
┌ Passkeys ──────────────────────────────────── ✕ ┐
│ Sign in with Face ID, Touch ID or your device's  │  ← one context line, ink2
│ screen lock. Your password still works.          │
│ [banner slot]                                    │
│ ┌──────────────────────────────────────────────┐ │
│ │ iPhone                         Rename  Remove│ │  ← name bold; Remove in error ink
│ │ Added 12 Oct · Last used today               │ │
│ ├──────────────────────────────────────────────┤ │
│ │ Chrome on Mac                  Rename  Remove│ │
│ │ Added 3 Oct · Never used                     │ │
│ └──────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────┤
│                         [ Add a passkey ] (primary)│  ← drawer footer, as ChangePasswordDrawer
└──────────────────────────────────────────────────┘
```

Entry point: an account-menu item "Passkeys", directly after "Change password". At 375 px the Rename and Remove buttons wrap under the meta line.

### DR3 iPhone Passkeys screen (D5, 3A)

- The Settings row "Passkeys" sits directly under "Change password".
- The screen, top to bottom:
  - a caption line with the same words as the portal's;
  - a grouped list: title = name, subtitle (caption) = "Added <date> · Last used <relative>";
  - the banner slot;
  - a bottom `FilledButton` "Add a passkey" (52pt).
- Tapping a row opens a menu sheet (picker/menu kind) with **Rename**, which opens a form sheet (`FormSheetFrame`, name field, Save), and **Remove** in the error role.
- No trailing buttons and no swipe actions.

### DR4–DR7 Interaction states (D6 4A, D7 5A, D8 6A, D9 7A)

| Feature | Loading / busy | Empty | Error | Success | Partial / limit |
|---|---|---|---|---|---|
| Passkey sign-in (portal + iOS) | Button disabled with spinner while the OS sheet is open (`aria-busy`; iOS: the busy-button loader) | n/a | Cancel or no passkey on this device: **nothing shown**. 401: banner "That passkey didn't work. Try again, or sign in with your password." 429: the existing rate-limit banner. Network: the existing "unreachable" banner | Same as password sign-in (portal `onSignedIn`; iOS → Home) | Unsupported device or legacy host: the button and "or" divider are not rendered |
| Passkey list (drawer / screen) | Existing skeleton rows (`QueryView`); iOS bloom loader after `loaderDelay` | Heading "No passkeys yet", line "A passkey lets you sign in with Face ID, Touch ID or your device's screen lock instead of typing your password.", primary "Add a passkey" | The existing load-error + retry pattern | n/a | n/a |
| Add a passkey | Add/Continue busy while the OS sheet is open | n/a | Cancel: nothing. Server rejects: banner "Couldn't add the passkey. Try again." `RECENT_SIGN_IN_REQUIRED` → step-up (DR6). Wrong password → the existing "current password is wrong" banner (counts toward lockout) | Toast / SnackBar "Passkey added"; the new row appears | 10 passkeys: Add disabled, hint "You can have up to 10 passkeys. Remove one to add another." |
| Rename | Save busy | n/a | 422: field error "Use 1–64 characters." Other: "Couldn't save the name. Try again." | Toast / SnackBar "Name saved" | n/a |
| Remove | Remove busy in the confirm state | n/a | "Couldn't remove the passkey. Try again." | Toast / SnackBar "Passkey removed. Devices signed in with it are signed out." | n/a |

- **DR6 Step-up, only when needed:** tapping Add tries first.
  - On 403 `RECENT_SIGN_IN_REQUIRED`, the portal drawer shows, above its footer, "For your security, enter your password to add a passkey." with the existing password field (show/hide, `autoComplete="current-password"`). Add becomes "Continue".
  - iOS shows a form sheet with the same field and "Continue".
- **DR7 Remove confirmation:**
  - Portal: Remove turns that row into a confirm state, "Remove “<name>”? You won't be able to sign in with it, and devices signed in with it will be signed out.", with Cancel and Remove (error ink). Focus moves to Cancel; Escape cancels. No `window.confirm`.
  - iOS: the DESIGN.md Confirm dialog with the same sentence, Back first, Remove in the error role.

### DR8 Naming (D10, 8A)

- There is no name step. `POST /v1/passkeys` takes no `name`.
- The server names the passkey from its AAGUID, using a vendored provider list (`server/src/auth/passkey-providers.json`, from the public community AAGUID list, MIT). An update script `npm --prefix server run passkey-providers:update` records the source and date in the file header; a test pins that it parses and has no duplicates.
- Unknown AAGUIDs (including all zeros) fall back to a device label from the User-Agent: "<Browser> on <OS>" on the web, "iPhone" from the app.
- A duplicate label for the same person gets " 2", " 3".
- Rename (D2) edits it afterwards. The name is stored as entered and shown with `dir="auto"`.
- Amends §3.2: the add body is `{challengeId, response, currentPassword?}`.

### Journey storyboard (add, then sign in elsewhere)

| Step | User does | User feels | Plan specifies |
|---|---|---|---|
| 1 | Opens Passkeys (account menu / Settings) | curious, unsure what a passkey is | DR2/DR3 context line; DR4 empty-state pitch |
| 2 | Taps Add a passkey | slight wariness ("will this lock me out?") | "Your password still works" in the context line |
| 3 | (past 10 min) is asked for the password | mild friction, reassured by "For your security" | DR6 |
| 4 | Face ID / Touch ID in the OS sheet | familiar, quick | OS sheet; cancel is silent (DR4) |
| 5 | Sees "Passkey added" and an "iCloud Keychain" row | accomplished, it's labelled sensibly | DR4 success, DR8 |
| 6 | Next day, on the phone, taps Sign in with a passkey | "that was it?" | DR1 / iOS button, the cross-device promise |
| 7 | Loses the phone; removes its passkey | anxious, then in control | DR7 confirm names the sign-out; DR4 removal toast |

### DR9 Passkey icon (D11, 9A)

- The official FIDO passkey symbol sits at the start of "Sign in with a passkey" on both platforms. It's drawn in `currentColor`, `aria-hidden`, and not mirrored in RTL.
- Portal: `PasskeyIcon` in `src/hosted/components/Icons.tsx`. iOS: an SVG asset.
- Record the icon's usage terms in `docs/brand/README.md`'s asset map.

### DR10 Component map (D12, 10A)

- **Portal:**
  - `Drawer` + `drawer-footer-right`; `Button` (primary "Add a passkey", secondary "Cancel"); Rename and Remove are text buttons, Remove in `--rose-ink`.
  - `hp-banner hp-banner-error` + `AlertIcon`; the step-up field uses `form-group` / `hp-password`.
  - `QueryView` for loading and error; `useToast` for outcomes.
  - The sign-in button is `btn btn-secondary btn-md hp-block` with `PasskeyIcon`.
  - New: `hp-divider` (the "or" rule), and a row list style only if `ProfilesManageDrawer`'s can't be reused (checked at build).
- **iOS:**
  - A grouped list (`ListTile` on `surface`, `outline` dividers); `MText.body` for names, `MText.caption` for meta.
  - `FilledButton` 52pt; the banner slot.
  - `showFormSheet` + `FormSheetFrame` (rename, step-up); a picker/menu `showModalBottomSheet` (row actions).
  - The DESIGN.md Confirm dialog; SnackBar for outcomes.
- New pieces go into COMPONENT_REGISTRY.

### DR11 Accessibility and 375 px / RTL (D13, 11A)

- **Focus:** after add → the new row. After remove → the next row, else Add. Cancelling the confirm → that row's Remove. The step-up field takes focus when it appears. The drawer keeps its focus trap and Escape-to-close; Escape inside the confirm cancels it first.
- **Labels:** "Rename <name>" / "Remove <name>" (aria-label / `Semantics`). A row reads "<name>, added <date>, last used <relative>". On iOS a row is one button that opens its actions.
- **Live regions:** toasts and the banner slot announce, as today.
- **Targets:** ≥ 44 px on the web, ≥ 48pt on iOS.
- **375 px:** the drawer is full width (TD-070); row actions wrap under the meta line; the sign-in buttons stay full width.
- **RTL:** names use `dir="auto"`; dates use `Intl` (web) / the ar locale (iOS); the icon is not mirrored.
- **Text size:** no clamp on iOS (the Settings rule); rows grow.
- **Tests:** Playwright axe plus role and label queries; Flutter semantics tests.

### DR12 Wording (D14, 12A)

- Arabic: **مفتاح المرور** (plural **مفاتيح المرور**) everywhere, matching Apple's system sheet and Malafat. Sign-in reads "تسجيل الدخول بمفتاح المرور".
- English: "passkey", lowercase mid-sentence; "Passkeys" as the drawer and screen title.
- The context line says a passkey replaces typing the password, so the word isn't mistaken for "كلمة المرور".
- All strings must pass `scripts/bundle-rules.ts` `HOSTED_RULES`.

---

# Eng review: /plan-eng-review, 2026-10-23

Target: `.claude/designs/mut-115-passkeys.md` (this file), sections 1–10 above as originally drafted.

## Scope record

feature answers: D1 = A, include portal passkey autofill now (Basel, 2026-10-23; recommendation was defer); D2 = A, keep rename (`PATCH /v1/passkeys/{id}`); structure: D3 = B, smaller arrangement (signInWithPasskey in `server/src/auth/sign-in.ts`, one `PasskeyRepository` port carrying the challenge methods, no `auth/passkey-sign-in.ts`); accepted scope: sections 1–10 with D9 resolved to include autofill, rename kept, and the smaller server arrangement; pending remedies: SC1.

## Decision ledger

### SC1: iOS native passkey layer

Finding: SC1, P1, confidence 9/10, plan §2 D8 + §5 ("our own MethodChannel"), reviewer: Claude (scope challenge).
Plan baseline: D8 proposed our own `MethodChannel('mutaba3a/passkeys')` over `ASAuthorizationPlatformPublicKeyCredentialProvider` (`ios/Runner/PasskeyChannel.swift`), with an abstract Dart `PasskeyPlatform`. Never approved.
Runtime evidence: the Flutter repo shares history with Malafat's app. At `406dd3c0`, `pubspec.yaml:80` has `passkeys: ^2.18.0`, and `lib/features/auth/data/services/webauthn_service.dart` wraps `PasskeyAuthenticator` with an injectable authenticator and a four-case result taxonomy (Success / NotAvailable / Cancelled / Error), plus `test/unit/features/auth/data/webauthn_service_test.dart`. It shipped through MAL-78/598/599 device fixes against `@simplewebauthn/server` ^11 (Malafat `apps/web/package.json:53-54`). Malafat's live app still uses it (`dev/flutter/malafat_app/pubspec.yaml:80`). The current Mutaba3a main has no passkey code.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| SC1 iOS native layer | own Swift channel (proposed, unapproved) | port Malafat's `WebAuthnService` on the `passkeys` package (pinned exact); no Swift code; the CocoaPods dependency is added | own Swift `MethodChannel` over AuthenticationServices; base64url encoding handled in Swift |
| D1 autofill | approved include (portal only) | unchanged | unchanged |
| D2 rename | approved keep | unchanged | unchanged |
| D3 structure | approved smaller (server) | unchanged | unchanged |
| D4 add-passkey step-up | pending | pending | pending |
| D7 session revocation on removal | pending | pending | pending |

Question D4:
D4 — For the iPhone app, should we reuse Malafat's proven passkey code (the `passkeys` package) or write our own Swift bridge?
Project/branch/task: MUT-115 passkeys, Flutter repo main, scope challenge.
ELI10: The phone needs native code that asks iOS to make or use a passkey. Malafat's app (whose history this repo shares) already did this with the `passkeys` Flutter package, wrapped in a tested service that went through three rounds of real-device bug fixes. The draft plan instead wrote our own Swift bridge, to avoid a third-party package in the sign-in path.
Stakes if we pick wrong: a hand-written bridge repeats bugs Malafat already paid for (encoding, cancel handling, presentation anchors); the package adds a dependency we don't control.
Recommendation: A because it reuses code this team already debugged on devices against the same server library, and the injectable authenticator keeps it testable.
Completeness: A=9/10, B=8/10
Pros / cons:
A) Port Malafat's service (recommended)
  ✅ Proven against @simplewebauthn on real iPhones; the failure taxonomy and its tests come with it
  ✅ No Swift to write or maintain, and Android support is ready whenever that epic comes
  ❌ A third-party pod in the auth path; upgrades need a pinned version and a device retest
B) Own Swift channel
  ✅ No third-party code in sign-in; it matches the app's two existing MethodChannels
  ❌ New native code (~200 lines) with only manual QA, and the base64/base64url pitfall to re-learn
Net: reuse debugged code plus one dependency, against owning a new native bridge.
Header: iOS layer
Options:
A) Port Malafat's service (recommended)
Port `WebAuthnService` from Malafat (history `406dd3c0`) onto `passkeys` (pinned exact), with its failure taxonomy and tests; no Swift channel (human: ~1 day / CC: ~20 min).
B) Own Swift channel
Write `ios/Runner/PasskeyChannel.swift` over AuthenticationServices and an abstract Dart `PasskeyPlatform`; base64url encoding in Swift (human: ~2 days / CC: ~40 min).

State: approved
Actual answer: A) Port Malafat's service (Basel, D4, 2026-10-23)
Accepted scope: Port `WebAuthnService` from Malafat (history `406dd3c0`) onto the `passkeys` package (pinned exact), with its failure taxonomy and tests; no Swift channel and no `PasskeyPlatform` abstraction; plan §5 and D8 are amended to match.
History: none

### SC2: signature counter type (factual correction, no question)

Finding: SC2, P2, confidence 9/10, plan §3.1 "`signCount Int`", reviewer: Claude.
Correction: the WebAuthn signature counter is a uint32 (up to 4,294,967,295). A Postgres `Int` tops out at 2,147,483,647. Malafat stores it as `BIGINT` (`apps/web/prisma/migrations/20260416_add_webauthn_passkey/migration.sql`, `"counter" BIGINT`). The model becomes `signCount BigInt`. No behaviour changes.

### Scope Challenge result

scope accepted as-is (feature questions kept or added scope; the smaller arrangement preserves scope).

### A1: step-up before adding a passkey

Finding: A1, P1, confidence 9/10, plan §2 D4, reviewer: Claude (Section 1). Evidence: passkeys survive a password change by ticket rule A4, and `verifiedSincePasswordChange` (`server/src/auth/middleware.ts:311-318`) revokes sessions only. A credential planted from a hijacked session would outlive the victim's password change.
Plan baseline: D4 proposed "credentialsVerifiedAt within 10 minutes, else currentPassword". Marked "needs Basel", never approved.
Runtime evidence: sessions carry `credentialsVerifiedAt` (`server/prisma/schema.prisma` model Session; stamped at sign-in, `server/src/repositories/prisma.ts:411`). `POST /v1/me/password` already verifies a current password under the shared throttle (`server/src/routes/sessions.ts:202-212`).
Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| A1 step-up to add a passkey | pending (D4 proposal) | recent sign-in ≤ 10 min, else `currentPassword` (403 `RECENT_SIGN_IN_REQUIRED`) | always require `currentPassword` | no step-up |
| A2 revoke sessions on passkey removal | pending | pending | pending | pending |
| SC1 iOS layer | approved port Malafat | unchanged | unchanged | unchanged |
| D1/D2/D3 | approved | unchanged | unchanged | unchanged |

Question D5:
D5 — What must someone prove before adding a passkey?
Project/branch/task: MUT-115 passkeys, mini-crm main, Section 1 (security).
ELI10: A passkey keeps working even after a password change (the ticket requires that). So if someone grabbed a signed-in browser and added their own passkey, changing the password wouldn't lock them out. Asking for a recent sign-in, or the password, before adding one closes that gap.
Stakes if we pick wrong: no check leaves a permanent back door after any session theft; always asking for the password adds friction right after sign-in, where MUT-370's "Add a passkey" card appears.
Recommendation: A because it blocks the stolen-session back door and adds no prompt in the common case: right after sign-in, which is exactly when MUT-370's card shows.
Completeness: A=10/10, B=9/10, C=4/10
Pros / cons:
A) Recent sign-in, else password (recommended)
  ✅ Blocks planting a passkey from an old or stolen session; no prompt within 10 minutes of signing in
  ✅ Reuses the change-password verification and its lockout counting, so there's one throttle
  ❌ Two paths to test (recent and stale) and one more error code for portal and phone
B) Always ask for the password
  ✅ The simplest rule, and the strongest proof of the person at the keyboard
  ❌ Friction right after sign-in; MUT-370's card would always ask for a password first
C) No step-up
  ✅ Least code, and adding a passkey is a single tap
  ❌ A stolen session can plant a passkey that survives password changes: a lasting back door
Net: a 10-minute window buys security with no prompt in the common case.
Header: Step-up
Options:
A) Recent sign-in, else password (recommended)
Allow if the session's credentialsVerifiedAt ≤ 10 min old; else require currentPassword (shared throttle; 403 RECENT_SIGN_IN_REQUIRED / CURRENT_PASSWORD_WRONG). Checked on both creation-options and add (human: ~4h / CC: ~15 min).
B) Always ask for the password
Every add requires currentPassword, verified under the shared throttle (human: ~3h / CC: ~10 min).
C) No step-up
Any valid session may add a passkey; record the risk as debt (human: 0 / CC: 0).

State: approved
Actual answer: A) Recent sign-in, else password (Basel, D5, 2026-10-23)
Accepted scope: Allow if the session's credentialsVerifiedAt ≤ 10 min old; else require currentPassword (shared throttle; 403 RECENT_SIGN_IN_REQUIRED / CURRENT_PASSWORD_WRONG). Checked on both creation-options and add.
History: none

### A2: sessions opened by a removed passkey

Finding: A2, P1, confidence 8/10, plan §2 D7, reviewer: Claude (Section 1). Evidence: `model Session` has no credential reference (fields: id, userId, tokenDigest, kind, createdAt, credentialsVerifiedAt, lastSeenAt, idleExpiresAt, absoluteExpiresAt, revokedAt, revokedReason, userAgent: `server/prisma/schema.prisma:437-458`). Removing a passkey therefore can't find the sessions it opened. A device session lives up to 180 days (`DEFAULT_DEVICE_ABSOLUTE_DAYS`, `server/src/auth/sessions.ts:38`).
Plan baseline: D7 proposed "don't revoke; record debt". Marked "needs Basel", never approved.
Runtime evidence: `store.sessions.revoke(id, reason, now)` and `revokeAllForUser` exist (`server/src/repositories/ports.ts:1476`). The password-change transaction already revokes many sessions with a reason (`server/src/repositories/prisma.ts:391`).
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| A2 revoke on removal | pending (D7 proposal: don't) | add nullable `sessions.passkeyId`; a passkey sign-in sets it; `DELETE /v1/passkeys/{id}` revokes those sessions (reason `passkey_removed`) and deletes the passkey in one transaction, except the caller's own session | sessions stay valid until they expire; record debt |
| A1 step-up | approved A (recent ≤ 10 min, else password) | unchanged | unchanged |
| SC1 / D1 / D2 / D3 | approved | unchanged | unchanged |

Question D6:
D6 — When someone removes a passkey, should the devices it signed in get signed out too?
Project/branch/task: MUT-115 passkeys, mini-crm main, Section 1 (security).
ELI10: Removing a passkey stops it signing in again (the ticket asks for that). But a phone already signed in with that passkey keeps its session for up to 180 days. If you remove a passkey because a device was lost or shared, you'd expect that device to be signed out as well.
Stakes if we pick wrong: without it, a lost phone stays signed in after its passkey is removed, until the person changes their password; with it, we add one column and a transaction.
Recommendation: A because "remove" then does what people expect for a lost device, at the cost of one nullable column and one transaction.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Sign those devices out (recommended)
  ✅ Removing a lost device's passkey also ends that device's session, which is what people expect
  ✅ Uses the existing revoke path with a clear audit reason, `passkey_removed`
  ❌ One more column and migration step, and a transaction to test (including keeping the caller's own session)
B) Leave sessions running
  ✅ No schema change on sessions; the ticket's literal wording is met
  ❌ A lost device stays signed in for up to 180 days unless the password is changed
Net: one nullable column turns "remove" into a real lost-device remedy.
Header: Revoke
Options:
A) Sign those devices out (recommended)
Add nullable sessions.passkeyId set by passkey sign-in; DELETE /v1/passkeys/{id} revokes its sessions (reason passkey_removed) and deletes the passkey in one transaction, keeping the caller's own session (human: ~4h / CC: ~15 min).
B) Leave sessions running
Sessions opened by a removed passkey run to expiry; record as debt (human: 0 / CC: 0).

State: approved
Actual answer: A) Sign those devices out (Basel, D6, 2026-10-23)
Accepted scope: Add nullable sessions.passkeyId set by passkey sign-in; DELETE /v1/passkeys/{id} revokes its sessions (reason passkey_removed) and deletes the passkey in one transaction, keeping the caller's own session.
History: none

### CQ1: one current-password check for change-password and the passkey step-up

Finding: CQ1, P2, confidence 9/10, reviewer: Claude (Section 2). `POST /v1/me/password` re-implements the failure path inline (`server/src/routes/sessions.ts:202-212`, with its own `lockedOutAudit` at `:233-243`), separately from `signIn`'s failure branch (`server/src/auth/sign-in.ts:73-81`). A1 (approved) needs the same "verify currentPassword under the shared throttle, 403 `CURRENT_PASSWORD_WRONG`" for the passkey step-up, which would be a third copy.
Plan baseline: §3.3 extracts `recordSignInFailure` and `issueSession` from `signIn` only; the change-password copy stays inline.
Runtime evidence: callers. (1) Existing: `routes/sessions.ts:202-212` (change password: lock check against throttle + `user.lockedUntil`, verify, `recordFailure` + `recordFailedSignIn`, `lockedOutAudit`). (2) Proposed: `routes/passkeys.ts` step-up (A1). The failure-recording part is shared with `sign-in.ts:73-81`.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| CQ1 current-password check | inline in change-password; the plan would add a copy | extract `verifyCurrentPassword(c, deps, user)` into `auth/sign-in.ts` on top of `recordSignInFailure`; change-password and the passkey step-up both call it; `lockedOutAudit` folds into the shared audit | leave change-password as is; the passkey step-up calls change-password's logic by copying it |
| A1 / A2 / SC1 / D1–D3 | approved | unchanged | unchanged |

Question D7:
D7 — Should the "check the current password" logic become one shared function, used by change-password and the new passkey step-up?
Project/branch/task: MUT-115 passkeys, mini-crm main, Section 2 (code quality).
ELI10: Change-password already checks your current password and counts wrong guesses toward the sign-in lockout. The passkey step-up we just approved needs the exact same check. We can share one function or paste a second copy. Two copies of lockout code tend to drift, and drift in lockout code is a security bug.
Stakes if we pick wrong: copies drift (one counts failures, the other forgets), so a wrong-password brute force could go uncounted on one path.
Recommendation: A because one lockout path for every password check is the reliability gain sign-in.ts was created for, and implementation lines net out about even.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Extract one shared check (recommended)
  ✅ One place counts wrong passwords toward lockout for sign-in, change-password and step-up
  ✅ Change-password's existing tests keep guarding the behaviour through the refactor
  ❌ Touches change-password (MUT-237, recently hardened), so its suite must stay green before any new code
B) Copy it into the passkey route
  ✅ Leaves the MUT-237 route untouched, so there's no regression risk there
  ❌ A second copy of the lockout logic that must be kept identical by hand
Net: a small refactor of a hardened route buys one lockout path everywhere.
Header: Shared check
Options:
A) Extract one shared check (recommended)
verifyCurrentPassword in auth/sign-in.ts (built on recordSignInFailure); change-password and passkey step-up call it; refactor first with MUT-237 tests green, then add step-up. Est. impl lines: −25 / +30 / net +5; avoids a ~20-line copy (human: ~3h / CC: ~10 min).
B) Copy it into the passkey route
Duplicate the change-password verification inside routes/passkeys.ts; no change to routes/sessions.ts (human: ~1h / CC: ~5 min).

State: approved
Actual answer: A) Extract one shared check (Basel, D7, 2026-10-23)
Accepted scope: verifyCurrentPassword in auth/sign-in.ts (built on recordSignInFailure); change-password and passkey step-up call it; refactor first with MUT-237 tests green, then add step-up.
History: none

### R1: regression contract for the sign-in and change-password refactor

Finding: R1, P1 (CRITICAL, regression rule), confidence 9/10, reviewer: Claude (Section 3). The D3 and D7 refactors move existing, hardened behaviour: `signIn` (`server/src/auth/sign-in.ts:59-109`) and change-password (`server/src/routes/sessions.ts:176-229`). The two lockout audits differ today: `signIn` writes `user.locked_out` with actor SYSTEM (`sign-in.ts:118`, `actorType: action === 'user.signed_in' ? 'USER' : 'SYSTEM'`), while change-password's `lockedOutAudit` writes actor USER (`routes/sessions.ts:236`, `actorType: 'USER'`). A naive fold would silently change one of them.
Plan baseline: no regression contract recorded; D7 approved "refactor first with MUT-237 tests green".
Runtime evidence: existing suites `server/src/auth/__tests__/sign-in.test.ts`, `server/src/__tests__/routes-sessions.test.ts`, `routes-device-sessions.test.ts`, `front-door-sign-in.test.ts`.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1 behaviour to preserve | unrecorded | all of: one 401 `INVALID_CREDENTIALS` for every sign-in refusal; exactly one argon2 verify per attempt (dummy hash for an unknown email); lockout keyed on the normalised email; `verifiedPasswordHash` session binding; change-password's 403 `CURRENT_PASSWORD_WRONG`, kept session and lockout counting; **each lockout audit keeps its current actor** (sign-in SYSTEM, change-password USER) | the same, except both lockout audits become actor SYSTEM |
| R1 intentional change | none | `user.signed_in` / `user.locked_out` metadata gains `method: 'password' \| 'passkey'` | the same, plus the actor change |
| R1 acceptance | none | the four existing suites pass unmodified after the refactor commit, before any passkey code; one new characterization test pins both audit actors and the `method` field | the existing suites pass, except the change-password audit-actor assertion, which is updated deliberately |
| D3 / D7 / A1 / A2 / SC1 | approved | unchanged | unchanged |

Question D8:
D8 — What must the sign-in refactor keep exactly as it is today?
Project/branch/task: MUT-115 passkeys, mini-crm main, Section 3 (regression contract).
ELI10: To add passkeys we're reshaping the password sign-in and change-password code (D3, D7). That code is hardened, and it caused a production sign-in outage just this week. This decides what must provably not change. One subtle thing: today a lockout from sign-in is logged as done by the "system", but a lockout from change-password is logged as done by the "user". Merging the code would quietly change one of them unless we pin it.
Stakes if we pick wrong: an unpinned refactor can change audit records or lockout behaviour with every test still green.
Recommendation: A because the refactor should be invisible: existing suites unmodified as the gate, one characterization test for the audit actors, and the only intended change being the new `method` field.
Completeness: A=10/10, B=8/10
Pros / cons:
A) Preserve all, pin audit actors (recommended)
  ✅ The refactor is provably invisible: four existing suites pass unmodified before any passkey code lands
  ✅ The audit log keeps its meaning for operators reading past and future lockouts
  ❌ The shared helper takes an actor parameter instead of one hardcoded value
B) Preserve all, unify actor to SYSTEM
  ✅ One consistent actor for every lockout, which is simpler to read in the audit log
  ❌ Changes what past change-password lockouts mean, and needs a deliberate test edit plus an ADR line
Net: an invisible refactor against a small, deliberate audit-semantics change.
Header: Regression
Options:
A) Preserve all, pin audit actors (recommended)
Keep every listed behaviour; sign-in lockout audit stays SYSTEM, change-password stays USER; existing four suites pass unmodified after the refactor commit; add one characterization test (audit actors + method metadata) (human: ~2h / CC: ~10 min).
B) Preserve all, unify actor to SYSTEM
Same contract, but both lockout audits become actor SYSTEM; the change-password audit assertion is updated deliberately and noted in the ADR (human: ~2h / CC: ~10 min).

State: approved
Actual answer: A) Preserve all, pin audit actors (Basel, D8, 2026-10-23)
Accepted scope: Keep every listed behaviour; sign-in lockout audit stays SYSTEM, change-password stays USER; existing four suites pass unmodified after the refactor commit; add one characterization test (audit actors + method metadata).
History: none

### Q1: how the iOS passkey QA flows run

Finding: Q1, P2, confidence 8/10, reviewer: Claude (Section 3). The Flutter repo's CLAUDE.md requires a passing automated flow per feature (`manual: true` only when it genuinely can't be automated). A real iOS passkey ceremony needs an associated domain over HTTPS, and the QA simulator talks to `http://localhost:8787` (`qa/qa.config.mjs` dartDefines), so no real passkey can be made in QA. SC1 (approved) uses the `passkeys` package. Malafat's tests already inject a fake `PasskeyAuthenticator` (`406dd3c0:test/unit/features/auth/data/webauthn_service_test.dart`: `class _MockAuthenticator extends Mock implements PasskeyAuthenticator {}`). The Flutter repo has no ECDSA library today (`pubspec.lock`: only `crypto`, which hashes).
Plan baseline: §7 proposed a Dart soft authenticator for `ios.passkey.sign-in` / `ios.passkey.manage`, plus `ios.passkey.cross-device` as `manual: true`. The dependency it needs was never named.
Runtime evidence: as above. The server already must accept the RP's own origin for iOS (`https://<rpId>`); local dev uses `WEBAUTHN_ORIGINS` (plan §3.4).
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| Q1 iOS QA depth | soft authenticator proposed, dependency unnamed | dev-only `pointycastle` (pinned) backs a Dart soft `PasskeyAuthenticator`, injected through the WebAuthnService provider in QA; `ios.passkey.sign-in` and `ios.passkey.manage` run automated against the local server (`WEBAUTHN_RP_ID=localhost`, `WEBAUTHN_ORIGINS` includes `https://localhost`); `ios.passkey.cross-device` stays `manual: true` | all three iOS passkey features `manual: true` (a real device against production); unit and widget tests with mocks only |
| SC1 / A1 / A2 / D1–D3 / D7 / D8 | approved | unchanged | unchanged |

Question D9:
D9 — Should the iPhone passkey QA flows run automatically with a fake authenticator, or be manual device checks?
Project/branch/task: MUT-115 passkeys, Flutter repo main, Section 3 (test depth).
ELI10: The QA simulator talks to a local server, and iOS will only make real passkeys for a real HTTPS domain. So automated QA has to use a pretend authenticator written in Dart that signs like a real one. That needs one test-only crypto package. The alternative is manual checks on a real iPhone.
Stakes if we pick wrong: manual-only means the phone's passkey sign-in has no recorded flow, so a regression ships unseen; automated needs one dev-only dependency.
Recommendation: A because the repo rule allows `manual: true` only when automation is genuinely impossible, and here it isn't; the real-device cross-check stays manual.
Completeness: A=9/10, B=6/10
Pros / cons:
A) Automate with a soft authenticator (recommended)
  ✅ Sign-in, add, rename and remove run on every release-QA, with video, against the real server code
  ✅ Exercises the same app code path as production; only the iOS sheet is replaced
  ❌ One dev-only dependency (pointycastle) and a small Dart authenticator to maintain
B) Manual device checks only
  ✅ No new dependency; the checks use the real iOS passkey sheet
  ❌ No automated flow, so regressions are caught only when someone remembers the device run
Net: a test-only dependency buys recorded, repeatable phone passkey QA.
Header: iOS QA
Options:
A) Automate with a soft authenticator (recommended)
Dev-only pointycastle (pinned) backs a Dart soft PasskeyAuthenticator injected in QA; ios.passkey.sign-in + ios.passkey.manage automated vs local server; ios.passkey.cross-device stays manual (human: ~1 day / CC: ~25 min).
B) Manual device checks only
All iOS passkey features manual: true on a real device vs production; mocks in unit/widget tests only (human: ~1h per release / CC: 0).

State: approved
Actual answer: A) Automate with a soft authenticator (Basel, D9, 2026-10-23)
Accepted scope: Dev-only pointycastle (pinned) backs a Dart soft PasskeyAuthenticator injected in QA; ios.passkey.sign-in + ios.passkey.manage automated vs local server; ios.passkey.cross-device stays manual.
History: none

### TODO dispositions

- D10 (passkey-added email): Basel answered "file a ticket to do it once resend is up" → **MUT-414**, blocked by MUT-359 and MUT-115.
- D11 (passkey review after password change or recovery): A, file a ticket → **MUT-415**, blocked by MUT-115, relates MUT-366.
- D12 (iOS QuickType passkey autofill): A, file a ticket → **MUT-416**, blocked by MUT-115.
- Not proposed: operator passkey tools (an operator `--lock` already nulls the hash, which D6 binding makes refuse passkeys); Android passkeys (its own epic).

Approval readiness: PASS — SC1 (D4 A), A1 (D5 A), A2 (D6 A), CQ1 (D7 A), R1 (D8 A), Q1 (D9 A); scope D1 A, D2 A, D3 B; TODOs D10 (ticket), D11 A, D12 A. Items in §11 points 10–13 are necessary implementation or proof of these approved contracts (SC2 is a factual correction).

## Review body

### NOT in scope
- Passkey-only accounts: ADR-159 decision 9 requires a password.
- Android passkeys: their own epic; the `passkeys` package leaves the door open.
- The MUT-370 suggestion card: blocked by this ticket; it builds on its routes.
- Passkey-added email: MUT-414, waits for the MUT-359 mailer.
- Passkey review after a reset or change: MUT-415, pairs with MUT-366 recovery.
- iOS QuickType autofill: MUT-416, needs a package capability check.
- Operator passkey tools: an operator `--lock` covers a compromised account through the D6 hash binding.
- Attestation or AAGUID allow-lists: not needed for consumer passkeys; attestation `none`.

### What already exists
- `server/src/auth/sign-in.ts` is the one credential core. Passkey sign-in joins it (D3), and change-password's check moves into it (D7).
- Session binding (`verifiedPasswordHash`, `credentialsVerifiedAt`, `server/src/repositories/prisma.ts:384-426`) and the stale-session revoke (`middleware.ts:311-318`) are reused as-is for A4 and the operator lock.
- `SignInThrottle` and the `sign-in:<ip>` limiter (`sessions.ts:154-194`, `app.ts:197-199`) are shared, unchanged.
- `isSamePortalOrigin` (`sessions.ts:141-148`) guards the cookie passkey route the same way as `POST /v1/sessions`.
- `netlifyRedirects()` (`vite.config.ts:285-294`) gains one rewrite line for the apex AASA. `wellKnownRoutes` (`server/src/routes/well-known.ts`) already serves `webcredentials` on the portal host.
- Malafat prior art is reused as a pattern, not as shared code (separate deployments):
  - server: `@simplewebauthn/server` with the same credential columns (`apps/web/prisma/migrations/20260416_add_webauthn_passkey`);
  - Flutter: `WebAuthnService` on `passkeys`, ported (SC1).
- Portal drawer chrome, `useAccountDrawers` and `SHELL_OVERLAY_KEYS` (`src/hosted/shell/AccountDrawers.tsx`, `src/hosted/data/filters.ts:268-282`) host the Passkeys drawer.

### Diagram: passkey sign-in (portal cookie and phone device paths)

```
browser/app ──POST /v1/passkey-challenges──▶ server: per-IP limit → insert challenge(purpose=authentication, 5 min)
     │◀──────────── {challengeId, publicKey options (allowCredentials: [])} ─────────────┘
     │  WebAuthn get()  (portal: button or autofill;  iOS: passkeys pkg → ASAuthorization)
     ▼
POST /v1/sessions/passkey        (portal: isSamePortalOrigin first, __Host- cookie)
POST /v1/device-sessions/passkey (phone: mds_ bearer token)
     │
     ▼ signInWithPasskey (sign-in.ts)
 consume challenge ──used/expired/wrong purpose──▶ 401 INVALID_CREDENTIALS
     │ ok
 find passkey by credentialId ──none──▶ 401 (IP limiter only)
     │
 user + lock check (throttle key = normalised email)
     │
 verifyAuthenticationResponse(origins=[portal, https://rpId], rpId, UV required)
     │ fail / locked / !ACTIVE / passwordHash null / counter regressed
     ├────────▶ recordSignInFailure (unless already locked) → 401
     │ ok
 issueSession(verifiedPasswordHash = user.passwordHash, passkeyId) → audit signed_in{method:passkey}
```

### Failure modes
| Path | Realistic production failure | Handling / test | User sees |
|---|---|---|---|
| Apex AASA rewrite | Cloud Run down, or Apple's CDN stale, when the phone release goes out → iOS refuses the RP | before-release check of the CDN copy; manual cross-device run | iOS sheet error → "That passkey didn't work" + password fallback |
| Challenge store | Challenge expired (page left open) | autofill re-arm; button fetches a fresh one; 401 test | autofill keeps working; button retry works |
| Front-door CSRF | Detached `req.header` (d4f4231e class) breaks the cookie route | real-Hono test with `FRONT_DOOR_TOKEN` | covered by test, not silent |
| Shared lockout | Passkey failures skip the throttle | A3 tests (mixed counter) | lockout message as today |
| Remove passkey | Transaction partly applied | single transaction + `test:db` | error toast; nothing removed |
| `passkeys` pod under scene lifecycle | Sheet fails to present | §11.13 device check before the phone release | Cancelled/Error taxonomy → message, no crash |
| Legacy run.app portal | RP mismatch → SecurityError | host gate hides passkey UI; unit test | password form only |

Critical gaps (no test, no handling, silent): **0**.

### Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| S1 refactor sign-in core (D3, D7, R1) | server/src/auth, server/src/routes | — |
| S2 passkey server (schema, repos, routes, config, Terraform, `_redirects`) | server/, vite.config.ts, server/infrastructure | S1 |
| S3 portal (client, SignInPage, drawer, i18n, QA) | src/hosted, qa/ | S2 API contract (openapi + `hosted:types`) |
| S4 Flutter (WebAuthnService port, screens, entitlement, QA) | Flutter repo lib/, ios/, integration_test/, qa/ | S2 API contract |

Lane A: S1 → S2 (shared server modules, sequential). Lane B: S3 (mini-crm src/hosted). Lane C: S4 (the Flutter repo, its own worktree). Execution order: A first. After S2 merges, launch B and C in parallel; they share no files (different repos, or server vs portal trees). Conflict flags: S3 regenerates `src/hosted/api/schema.d.ts` from S2's `openapi.yaml`, so start S3 only once S2's contract is frozen. One worktree per repo (the MUT-74 practice).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~4h / CC: ~15min)** — server/auth: refactor `sign-in.ts` (`recordSignInFailure`, `issueSession`, `verifyCurrentPassword`), change-password calls it
  - Surfaced by: Code Quality CQ1/D7; Test R1/D8
  - Files: server/src/auth/sign-in.ts, server/src/routes/sessions.ts, server/src/auth/__tests__/sign-in.test.ts (new characterization test only)
  - Verify: the four existing suites pass unmodified; `npm --prefix server test`
- [ ] **T2 (P1, human: ~1 day / CC: ~30min)** — server/data: Prisma `passkeys`, `webauthn_challenges`, `sessions.passkeyId`, `signCount BigInt`; `PasskeyRepository` (memory + Prisma) incl. atomic `consumeChallenge`
  - Surfaced by: Scope D3, SC2; Architecture A2/D6
  - Files: server/prisma/schema.prisma, server/prisma/migrations/*_mut115_passkeys, server/src/repositories/{ports,memory,prisma}.ts
  - Verify: `npm --prefix server test`; `test:db` race test on consume
- [ ] **T3 (P1, human: ~1.5 days / CC: ~40min)** — server/routes: `signInWithPasskey`, the 3 public and 5 authed routes, step-up (A1), revoke-on-remove (A2), 10-cap, error codes, config, OpenAPI, `API_VERSION`
  - Surfaced by: Architecture A1/D5, A2/D6; Code Quality error codes; Test gaps (front-door, purpose mismatch, rename)
  - Files: server/src/auth/{sign-in,webauthn}.ts, server/src/routes/{passkeys,sessions,device-sessions}.ts, server/src/{app,config,index,errors,schemas}.ts, server/openapi/openapi.yaml, server/src/__tests__/*
  - Verify: `npm --prefix server run typecheck && npm --prefix server run lint && npm --prefix server run openapi:check && npm --prefix server test`
- [ ] **T4 (P1, human: ~3h / CC: ~10min)** — infra: `WEBAUTHN_RP_ID` in domain.tf + tftest; apex AASA rewrite in `netlifyRedirects`; hosts plan text; before-release item
  - Surfaced by: Architecture (distribution, release order)
  - Files: server/infrastructure/terraform/domain.tf, …/tests/domain.tftest.hcl, vite.config.ts (+ its test), scripts/hosts.ts, docs/operations/before-release.md
  - Verify: `terraform test`; `npm run test:run -- vite`; `no-hardcoded-hosts` green
- [ ] **T5 (P1, human: ~1.5 days / CC: ~40min)** — portal: client methods, SignInPage button + autofill (re-arm), PasskeysDrawer (add/step-up/rename/remove), host gate, i18n
  - Surfaced by: Scope D1, D2; Performance (autofill TTL)
  - Files: src/hosted/passkeys/webauthn.ts, src/hosted/api/client.ts, src/hosted/pages/auth/SignInPage.tsx, src/hosted/components/PasskeysDrawer.tsx, src/hosted/shell/{UserMenu,AccountDrawers}.tsx, src/hosted/data/filters.ts, src/hosted/i18n/{en,ar}.json
  - Verify: `npm run lint && npm run typecheck && npm run test:run && npm run build`
- [ ] **T6 (P1, human: ~1 day / CC: ~30min)** — portal QA: passkeys.yaml + spec with CDP virtual authenticator (add, sign-in, autofill, remove, password-change-keeps)
  - Surfaced by: Test review (Critical Paths)
  - Files: qa/features/portal/passkeys.yaml, qa/specs/portal/passkeys.spec.ts
  - Verify: `release-qa run --attach --only portal.passkey.*`; `release-qa lint`
- [ ] **T7 (P1, human: ~1.5 days / CC: ~40min)** — Flutter: port `WebAuthnService` onto `passkeys` (pinned), AuthService/AuthNotifier passkey sign-in, PasskeysScreen + settings row, error codes, entitlement + guard test, l10n
  - Surfaced by: Scope SC1/D4; Code Quality (drop Malafat RP fallbacks, error codes)
  - Files (Flutter repo): pubspec.yaml, lib/…/webauthn_service.dart, lib/domain/services/auth_service.dart, lib/presentation/providers/auth_providers.dart, lib/presentation/screens/{auth/sign_in_screen,settings/settings_screen,settings/passkeys_screen}.dart, lib/presentation/routes/app_router.dart, lib/core/{errors,api/api_client}.dart, ios/Flutter/AssociatedDomains.xcconfig, ios/Runner/Runner.entitlements, test/platform/associated_domains_config_test.dart, lib/presentation/l10n/app_{en,ar}.arb
  - Verify: `make analyze && make test`
- [ ] **T8 (P1, human: ~1 day / CC: ~25min)** — Flutter QA: dev-only pointycastle soft authenticator; `ios.passkey.sign-in`, `ios.passkey.manage` automated; `ios.passkey.cross-device` manual
  - Surfaced by: Test Q1/D9
  - Files (Flutter repo): pubspec.yaml (dev), integration_test/qa/passkeys_*_test.dart, integration_test/qa/support.dart, qa/features/ios/passkeys.yaml
  - Verify: `release-qa release --only ios.passkey.sign-in` (and `.manage`); `release-qa lint`
- [ ] **T9 (P2, human: ~2h / CC: ~10min)** — knowledge: ADR-037 amendment + new ADR (next free ≥ ADR-172; MUT-401 took 170/171), TDs, CHANGELOG, SYSTEM_OVERVIEW, COMPONENT_REGISTRY, PATTERNS, TEST_PLAN, INFRA; Jira comment on MUT-112
  - Surfaced by: plan §9; ticket criterion A6
  - Files: .claude/*.md
  - Verify: review the diff
- [ ] **T10 (P2, human: ~1h / CC: n/a, operator)** — release check: real-iPhone cross-device run and scene-lifecycle sheet check before the phone release
  - Surfaced by: Failure modes (AASA CDN, pod under scene lifecycle)
  - Files: none
  - Verify: manual `ios.passkey.cross-device` against production

### Reality rows
| premise | claim | file:line receipt | verdict |
|---|---|---|---|
| P1 | Sign-in core is shared by cookie and device sign-in | server/src/auth/sign-in.ts:9-19, 59-109 | true |
| P2 | A password change revokes sessions via passwordChangedAt > credentialsVerifiedAt | server/src/auth/middleware.ts:311-318 | true |
| P3 | Operator lock nulls the password hash | server/src/repositories/prisma.ts:458 | true |
| P4 | The apex serves no AASA today; the SPA fallback would answer it | public/.well-known/ (oauth-client.json only); netlify.toml:38-40 | true |
| P5 | The no-self-registration regex bans `register` | server/src/__tests__/no-self-registration.test.ts:13 | true |
| P6 | `_redirects` is generated from hosts.json | vite.config.ts:285-302 | true |
| P7 | iOS native assertions carry origin `https://<rpId>` | Apple Developer Forums thread 719003 (forum, not Apple docs) | unverified |
| P8 | Lockout audit actors differ | sign-in.ts:118 (SYSTEM) vs routes/sessions.ts:236 (USER) | true |
| P9 | Malafat used `passkeys` ^2.18.0 + WebAuthnService | Flutter history 406dd3c0:pubspec.yaml:80 | true |
| P10 | iOS target 17.0 | Flutter ios/Podfile:2 (subagent read) | true |
unverified=1

REALITY: premise-table finding 10 premises, unverified=1 (iOS origin, forum source; verified at build by the manual cross-device run) .claude/designs/mut-115-passkeys.md:617
REALITY: already-done pass git log origin/main --since=2026-10-12 has no passkey implementation (only ADR-159 docs b0d96f6b) server/src/auth/sign-in.ts:59
REALITY: surface-check pass existing routes POST /v1/sessions, /v1/device-sessions, /v1/me/password and scripts domain:plan / hosted:types / openapi:check verified; new paths avoid the no-self-registration regex server/src/routes/sessions.ts:64
REALITY: binding-decisions pass consistent with ADR-159 decision 9 (password required, passkey suggested), ADR-037 no-signup, desktop retired; no overruled default reintroduced .claude/DECISIONS.md:4321
REALITY: numbers finding 5-failure/15-min lockout [measured: sessions.ts:56-61]; 10-min step-up, 5-min TTL, 10-passkey cap, ~50 files [estimated] server/src/auth/sessions.ts:56
REALITY: deferred-asks finding the ticket's "portal settings page" becomes a drawer (drawer-first rule, D11); every other ask is covered; follow-ups MUT-414/415/416 are new, not ticket asks src/hosted/data/filters.ts:268
REALITY: pr-count pass no ship-policy; local merges only (CLAUDE.md forbids push/PR): two branches, one per repo, server+portal then Flutter CLAUDE.md:517

### Unresolved decisions
None.

### Completion summary
- Step 0: Scope Challenge — scope accepted as-is (D1 added autofill, D2 kept rename, D3 smaller arrangement)
- Reality rows: 7/7 applicable rows emitted, 1 unverified premise
- Architecture Review: 5 issues found
- Code Quality Review: 4 issues found
- Test Review: diagram produced, 9 gaps identified
- Performance Review: 3 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 3 items proposed to user (all filed as Jira tickets: MUT-414, MUT-415, MUT-416)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (not installed; native Plan fallback gave no complete report within five minutes)
- Parallelization: 3 lanes, 2 parallel / 1 sequential
- Lake Score: 4/6 = answers picking a 10/10 option (D5, D6, D7, D8) / answers scored for Completeness (D4–D9)

---

# Design review: /plan-design-review, 2026-10-23

Target: this file, §4, §5, §7 and §11 (the UI parts). Decisions DR1–DR12 are in §12 above. Mockups: none; the gstack designer has no OpenAI key (`$D setup`). Outside design voice: skipped (D2 B).

## Design review: NOT in scope
- iOS QuickType passkey autofill: MUT-416.
- The passkey review after a password change or recovery: MUT-415.
- The passkey-added email: MUT-414.
- The MUT-370 suggestion card's design: its own ticket; it reuses DR4's empty-state words.
- A portal DESIGN.md: MUT-417 (D15).
- Migrating existing `window.confirm` deletes to DR7's in-row confirm: listed under MUT-417.

## Design review: What already exists
- Portal:
  - `ChangePasswordDrawer`: drawer footer, banner slot, password field with show/hide;
  - `ProfilesManageDrawer`: a list inside a drawer;
  - `SignInPage`: the `hp-` card and fields;
  - `QueryView`, `useToast`, `Icons.tsx`.
- iOS: `DESIGN.md` (grouped list, row with a secondary action, form sheet, picker/menu sheet, Confirm dialog, banner slot, SnackBar, bloom loader); the `settings_screen.dart` Change password row; the `change_password_screen.dart` field and error patterns.
- Wording: Malafat's Arabic passkey strings (Flutter history `406dd3c0`, `lib/core/i18n/l10n/app_ar.arb`).

## Design review: Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **DT1 (P1, human: ~4h / CC: ~15min)** — portal sign-in — "or" divider + secondary passkey button with PasskeyIcon, the DR4 states
  - Surfaced by: Pass 1 DR1; Pass 2 DR4; Pass 4 DR9
  - Files: src/hosted/pages/auth/SignInPage.tsx, src/hosted/components/Icons.tsx, hosted CSS (`hp-divider`), src/hosted/i18n/{en,ar}.json
  - Verify: Vitest (button hidden/shown, cancel silent, 401 banner); `portal.passkey.sign-in`
- [ ] **DT2 (P1, human: ~1 day / CC: ~30min)** — portal Passkeys drawer — DR2 layout, DR4 states, DR6 step-up in place, DR7 in-row confirm, DR11 focus and labels
  - Surfaced by: Pass 1 DR2; Pass 2 DR4/DR6/DR7; Pass 6 DR11
  - Files: src/hosted/components/PasskeysDrawer.tsx, src/hosted/shell/{UserMenu,AccountDrawers}.tsx, src/hosted/data/filters.ts, src/hosted/i18n/{en,ar}.json
  - Verify: Vitest + axe; `portal.passkey.add` / `.remove`
- [ ] **DT3 (P1, human: ~3h / CC: ~10min)** — server naming — AAGUID provider list + update script + UA fallback + de-duplication; add body drops `name`
  - Surfaced by: Pass 3 DR8
  - Files: server/src/auth/passkey-providers.json, server/src/scripts/passkey-providers-update.ts, server/src/routes/passkeys.ts, server/src/schemas.ts
  - Verify: `npm --prefix server test` (list parses, no duplicates; fallback; " 2" suffix)
- [ ] **DT4 (P1, human: ~1 day / CC: ~30min)** — iOS Passkeys screen + sign-in button — DR3 layout, DR4 states, DR6 form sheet, DR7 Confirm dialog, DR9 icon, DR11 semantics
  - Surfaced by: Pass 1 DR3; Pass 2; Pass 4; Pass 6
  - Files (Flutter repo): lib/presentation/screens/settings/passkeys_screen.dart, settings_screen.dart, auth/sign_in_screen.dart, assets/ (passkey icon), lib/presentation/l10n/app_{en,ar}.arb
  - Verify: `make test` (semantics tests); `ios.passkey.manage`
- [ ] **DT5 (P2, human: ~1h / CC: ~5min)** — wording — مفتاح المرور / مفاتيح المرور everywhere; HOSTED_RULES pass; brand-kit note for the FIDO icon
  - Surfaced by: Pass 7 DR12; Pass 4 DR9
  - Files: src/hosted/i18n/ar.json, Flutter app_ar.arb, docs/brand/README.md
  - Verify: `npm run build` (bundle rules), `scripts/check-i18n-keys.ts`, `make gen-l10n`

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | Flutter DESIGN.md present; mini-crm none   |
  |                      | (brand kit used); UI: 5 surfaces           |
  | Step 0               | 3/10, all 7 dimensions                      |
  | Pass 1  (Info Arch)  | 3/10 → 9/10 after fixes                    |
  | Pass 2  (States)     | 2/10 → 9/10 after fixes                    |
  | Pass 3  (Journey)    | 4/10 → 9/10 after fixes                    |
  | Pass 4  (AI Slop)    | 7/10 → 9/10 after fixes                    |
  | Pass 5  (Design Sys) | 4/10 → 9/10 after fixes                    |
  | Pass 6  (Responsive) | 3/10 → 9/10 after fixes                    |
  | Pass 7  (Decisions)  | 1 resolved, 0 deferred                     |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (6 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 1 item proposed (filed as MUT-417)          |
  | Approved Mockups     | 0 generated (no designer key), 0 approved   |
  | Decisions made       | 12 added to plan (DR1–DR12)                 |
  | Decisions deferred   | 0                                           |
  | Overall design score | 2/10 → 9/10                                 |
  +====================================================================+
```

Not 10, because no visual mockup was produced or approved. The first rendered build should get `/design-review` for visual QA.

Unresolved Decisions: none.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (`codex-plan-review`); design voices | Independent 2nd opinion | 54 plan / design: skipped | unavailable (eng), skipped (design) | eng: codex not installed, native fallback timed out; design: skipped by choice (D2) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 57 | issues_open (PLAN) | 21 issues, 0 critical gaps (all mapped to T1–T10, 0 unresolved) |
| Design Review | `/plan-design-review` | UI/UX gaps | 12 | clean (FULL) | score: 2/10 → 9/10, 12 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, eng plan-review phase: unavailable (not installed; native Plan fallback gave no complete report within five minutes). Design phase: skipped by user choice (D2). No outside findings in either phase.
- **VERDICT:** DESIGN CLEARED (9/10, 0 unresolved). Eng review complete with mapped work (issues_open, 0 unresolved); eng review required: satisfied by decisions D1–D12, not CLEAR.

NO UNRESOLVED DECISIONS
