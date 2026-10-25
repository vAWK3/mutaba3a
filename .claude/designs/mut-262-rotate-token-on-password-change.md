# MUT-262 — Changing your password issues this device a new token (TD-158)

Status: planned (2026-10-25), not built. Epic MUT-34. Relates MUT-237 (portal change), MUT-238 (iPhone change). Blocks MUT-322 (pilot readiness).

## 1. Problem

`POST /v1/me/password` (MUT-237) revokes every other session and keeps the caller's own, re-stamping its
`credentialsVerifiedAt`. If the caller's token is the one that leaked (a copied Keychain item, a portal cookie lifted
from a shared machine), the copy survives the change: up to 30 idle / 180 absolute days on a device session.

## 2. Acceptance criteria (from the ticket)

| # | Criterion | Where it is proved |
|---|---|---|
| AC1 | After a change, the caller's old token gets 401 everywhere; the new one works | store contract + route tests (§6.1, §6.2), portal-selfservice flow (§7) |
| AC2 | The new session keeps the old `absoluteExpiresAt` | store contract |
| AC3 | Portal: still signed in after the change; the old cookie value is refused | route test + portal-selfservice flow |
| AC4 | Phone: still signed in; a widget one-tap and a share-sheet save right after it upload with the new token | Flutter tests + iOS release-QA flow (§5). **Ticket is out of date:** neither path uses the token any more (§5.5); the real readers are Siri capture and the FX widget, which read the Keychain fresh |
| AC5 | Create + revoke in one transaction; on failure the old token works and the password is unchanged | store contract (Prisma + memory) |
| AC6 | Auth tests advance the clock between sign-in and the change | every new test (§6) |
| AC7 | Server and phone released together, as for MUT-227 | **Replaced (eng review R1):** device rotation is opt-in, so server and phone ship in any order; noted on the ticket |
| AC8 | TD-158 resolved in TECH_DEBT.md | knowledge updates |

## 3. Decisions

**D1 — Device rotation is opt-in per request; cookie rotation is unconditional.**
The request gains an optional `rotateToken: true` (`ChangePasswordRequest`). A **cookie** session always rotates (the
portal ships with the API). A **device** session rotates only when the body asks for it, and then answers
`200 { token }`; without it the answer stays `204` and the session is kept as today.
*Why:* MUT-238 builds are in users' hands and expect 204. Unconditional rotation would sign every one of them out
right after they change their password (they would ignore the new token). The schema is non-strict, so a new phone
build sending `rotateToken` to an older server just gets the old 204, and handles it. That removes the lock-step
release AC7 asked for: server and phone can ship in either order. The leftover gap (old builds never rotate) closes
when the iOS/Android minimum build (MUT-293) passes the rotating build; filed as a TD, not done here.
*Alternative rejected:* always rotate + raise the minimum build at release — forces every phone user to update for a
Low-priority fix.

**D2 — Rotate by creating a new session row and revoking the old one** (as the ticket proposes), not by swapping the
digest on the same row.
*Why:* the middleware's stale-session path (`verifiedSincePasswordChange`, middleware.ts:328) re-reads by the
**old** digest and, finding nothing usable, revokes `session.id`. With an in-place swap that id is the *rotated*
session: one concurrent request with the old token would sign the person out. With a new row, the old row is
already revoked and `revoke` keeps the first reason, so the stray request is a harmless 401.
The new row copies `kind`, `userAgent`, `passkeyId` (removing that passkey still revokes it, MUT-115 A2) and
`absoluteExpiresAt`; `createdAt = credentialsVerifiedAt = lastSeenAt = at`; `idleExpiresAt = min(at + idle, absolute)`.
The old row is revoked with reason `password_rotated`.

**D3 — The portal ignores a 401 for a cookie it no longer holds (eng review R2).**
A request the portal sent with the old cookie that lands after the commit gets 401, and `SessionBridge` would end the
session ("expired") right after a successful change. `src/hosted/api/client.ts` keeps a credential generation and the
in-flight change: each request records the generation when sent; `changePassword` bumps it on success; a 401 waits for
any in-flight change to settle and reaches the unauthorised handler only if its request's generation is still current.
The drawer invalidates every query after a successful change. The phone already follows this rule (MUT-208).
*Alternatives rejected:* a 5 s window with a `/v1/me` re-probe (misses slow requests); a server-side grace period for
the old token (reopens the hole TD-158 closes).

**D4 — The cookie's Max-Age is the time left to `absoluteExpiresAt`**, not a fresh `absoluteHours`, so the browser
never holds a cookie the server will refuse anyway.

## 4. Server (mini-crm/server)

1. `repositories/ports.ts` — `ChangePasswordInput` gains `rotation?: { tokenDigest: string; idleMs: number }`.
   `changePassword` returns `{ user: UserRecord; session: SessionRecord } | null` (the kept or the new session).
   Docstring: with `rotation`, the kept session is replaced, not re-stamped.
2. `repositories/prisma.ts` `users.changePassword` — inside the existing transaction, after the hash/kept check:
   read the kept row's `kind/userAgent/passkeyId/absoluteExpiresAt`; revoke every other session (unchanged);
   with `rotation`: revoke the kept row (`password_rotated`) and `tx.session.create` the new one; without it: the
   existing re-stamp. A digest collision (P2002) aborts the whole transaction → AC5 by construction.
3. `repositories/memory.ts` — the same semantics; build the new record and check digest uniqueness **before**
   mutating anything, so a failure leaves the store untouched (AC5 for the memory store).
4. `routes/sessions.ts` `POST /v1/me/password` —
   - rotate when `session.kind === 'cookie'` or `rotateToken === true`;
   - token: `generateSessionToken()` for cookie, `generateDeviceSessionToken()` for device; digest with
     `sessionDigest(settings.pepper, token)`; idle from `settings.idleMinutes` / `deviceIdleDays` (reuse the
     `deviceLifetime()` shape from device-sessions.ts — move it to `auth/sessions.ts` as `sessionLifetime(kind, settings)`
     so both routes share it, instead of copying);
   - cookie: `setCookie(..., { maxAge: secondsUntil(absoluteExpiresAt) })`, 204;
   - device + rotated: `200 { token }`; device not rotated: 204;
   - OpenAPI: add the 200 response (`PasswordChangedTokenSchema = { token }`), document `rotateToken`, rewrite the
     description ("this session stays signed in under a new token").
   - `schemas.ts`: `rotateToken: z.literal(true).optional()` with an `.openapi({ description })`.
5. `app.ts` `API_VERSION` → next minor with `-mut262` (1.71.0-mut262 if nothing lands first; restack at merge).
6. Audit: the existing `user.password_changed` row gains `metadata: { tokenRotated: boolean }`. No new action.
7. `npm run openapi:check` regenerates; portal `src/hosted/api/schema.d.ts` regenerated with `openapi-typescript`.

No migration: `sessions` already has every column, and `revokedReason` is free text.

## 5. Phone (mutaba3a-flutter, `…/mutaba3a-flutter/mutaba3a`)

What exists (MUT-238, merged `b825bb6e`): `PasswordRepository.change` posts and treats any 2xx as Ok without
reading the body (`lib/data/repositories/password_repository.dart:17-30`). The token lives only in the Keychain
(`device_session_token`, access group `group.com.barmajiyat.mutaba3a`); the ApiClient interceptor reads it on every
request, so writing a new value is enough for every later request. The cached `Me` is tagged with
`sha256(token)` (`auth_service.dart:40-42`) and is dropped when the fingerprint stops matching.

1. **Ask for rotation, return the answer (eng review R3).** `PasswordRepository.change` sends `rotateToken: true` and
   returns `Result<String?, ApiError>`: the new token on `200 { token }`, null on `204` (an older server). A new
   `AuthService.changePassword(current, next)` runs the call and, given a token, `adoptRotatedToken` — both inside
   `ApiClient.rotating(...)` (point 3), so the guard holds until the Keychain has the new token. The change screen
   calls the service through a provider instead of the repository.
2. **`AuthService.adoptRotatedToken(token)`** writes the token, then re-writes the cached `Me` under the new
   fingerprint, so an offline cold start still finds it (`auth_providers.dart:268-276`). No `AuthNotifier` state
   change: same person. This is the same "adopt a session" step the MUT-115 iPhone plan names `_adoptSession`
   (`.claude/designs/MUT-115-passkeys.md:26`); whichever ticket lands first creates it, the other reuses it.
3. **Close the sign-out race.** A request the phone sent with the old token can come back `401 SESSION_EXPIRED`
   *before* the new token is written. `_refusesStoredSession` (`api_client.dart:186-196`) would then match the
   still-stored old token, sign out and run `forgetSession`, which deletes the token unconditionally and wipes local
   data (MUT-377) — possibly deleting the new token a moment after it was written. Fix: `ApiClient` gets a
   `rotating(Future<T> Function() call)` wrapper holding a completer; `_refusesStoredSession` awaits any pending
   rotation before it reads the stored token. Once the new token is stored, the old-token 401 no longer matches and
   is ignored (the MUT-208 rule already in place). If the change fails, the completer still completes and the check
   runs as today.
4. **A lost answer.** If the change commits but the answer never arrives (timeout/5xx), the phone still holds the
   revoked token; its next request signs it out to sign-in with the expiry reason. Server records come back on sign-in;
   queued outbox rows survive. Accepted, not engineered around (any server-side grace re-opens TD-158). The change
   screen's "unknown outcome" message gains one sentence, in every app locale: "If you're asked to sign in, use
   your new password."
5. **iOS extensions — no Swift change.** The share extension never reads the token (it queues into the App Group and
   opens the app), and the widget one-tap save was removed by MUT-264. The two token readers are the Siri/App
   Intents capture and the FX widget; both read the Keychain fresh on every run (`CaptureUploader.swift:166-198`,
   `FxWidget.swift:94`) and never delete it. One that read the old token mid-rotation gets 401: a capture stays
   pending for the app to send, the widget falls back to its cache.
6. **Android:** the same Dart code; no extensions.

Phone tests (written first):
- `test/data/repositories/password_repository_test.dart`: sends `rotateToken: true`; 200 `{token}` → `Ok(token)`;
  204 → `Ok(null)`; errors unchanged.
- `test/domain/services/auth_service_test.dart`: `changePassword` adopts on 200 (token stored, `cachedMe()` still
  returns the person under it), leaves the token on 204, adopts nothing on an error.
- `test/core/api_client_test.dart` (refused-session group): an old-token `SESSION_EXPIRED` that arrives during a
  rotation does not sign out once the new token is stored; after a failed rotation a real `SESSION_EXPIRED` still
  signs out.
- `test/presentation/screens/change_password_screen_test.dart`: success unchanged; the unknown-outcome copy.

Phone release-QA (`qa/features/ios/settings.yaml` `ios.settings.change-password`,
`integration_test/qa/settings_change_password_test.dart`):
- expectation becomes "This device stays signed in under a new token": the old bearer gets 401, the stored token
  gets 200, the app is still `AuthAuthenticated`, and the cached `Me` survives a relaunch;
- teardown restores the password with the **stored** token (today it uses the captured old bearer and expects 204;
  both break under rotation).

## 6. Tests (written first)

### 6.1 Store contract — `repositories/__tests__/store-contract-change-password.ts` (runs on memory + Prisma)
- rotation: the old session is revoked with `password_rotated`; the returned session is live, has the new digest,
  the same `userId/kind/userAgent/passkeyId/absoluteExpiresAt`, `credentialsVerifiedAt = at`.
- rotation never extends the absolute deadline, and clamps idle to it (a session 2 h from its absolute end).
- rotation with a digest that already exists → `UniqueViolation`; password hash, `passwordChangedAt`, every session
  (kept and others) unchanged (AC5).
- without `rotation`: today's behaviour unchanged (existing cases stay green, unedited: the regression contract).
- the existing "a second change that verified the same old password loses to the first" case gains a rotation-on row:
  the second finds its kept session revoked by the first's rotation and writes nothing.
- clock advanced between session creation and the change in every case (AC6).

### 6.2 Routes — `__tests__/routes-sessions.test.ts`
- cookie: 204 + a new `Set-Cookie`; `GET /v1/me` with the new cookie 200; with the old cookie 401 (AC1, AC3).
- cookie Max-Age = seconds left to `absoluteExpiresAt` (D4).
- device + `rotateToken: true`: 200 `{ token }` (`mds_` shape); old bearer 401 on `/v1/me` and a profile route; new
  bearer 200 (AC1).
- device without `rotateToken`: 204, same bearer still works (D1, old builds).
- cookie with `rotateToken: true`: still 204 + `Set-Cookie` (the flag changes nothing for a cookie).
- a request with the old token that was mid-flight (stale path) after the rotation: 401, and the **new** session is
  still live (D2's reason).
- passkey-opened session rotates, then removing that passkey revokes the new session.
- a failed change (wrong current password, `StateConflict`) rotates nothing.
- OpenAPI contract tests: version string bumped in the milestone contract tests.

### 6.3 Portal — `src/hosted/api/__tests__/client.test.ts` + `ChangePasswordDrawer.test.tsx`
- a 401 on a request sent before the change answered is ignored (no `endSession`).
- a 401 that lands while the change is in flight: ignored once the change succeeds; ends the session if it failed.
- a 401 on a request sent after the change ends the session as today.
- the drawer invalidates every query after a successful change.

Commands: `npm --prefix server test`, `npm --prefix server run test:db` (Prisma contract), `npm run test:run`,
plus lint/typecheck/openapi:check/build (CLAUDE.md Phase 4, Node 22).

## 7. Release-QA

- `qa/features/portal-selfservice/account.yaml` (new; live API): `rotate-on-change` — sign in, change the password,
  still signed in and the next page loads; the old cookie value replayed with `page.request` gets 401. Spec in
  `qa/specs/portal-selfservice/account.spec.ts`, tag `@portal-selfservice.account.rotate-on-change`.
- `qa/features/portal/account.yaml` `change-password`: unchanged steps; its FakeApi answers 204 + Set-Cookie.
- Phone: see §5.

## 8. Release order

Any order (D1). Server first is natural: portal rotation is live with it; phones rotate once the new build ships.

## 9. Out of scope

Rotation on other events; lifetime changes; making old phone builds rotate (TD, closes with MUT-293's floor).

---

# Eng review (/plan-eng-review, 2026-10-25)

Target: `.claude/designs/mut-262-rotate-token-on-password-change.md` (this file, the plan above).

Scope record: feature answers: no cuts proposed; structure: A (Original arrangement, D1 answer 2026-10-25); accepted scope: the plan as written, with the shared `sessionLifetime(kind, settings)` helper in `server/src/auth/sessions.ts` used by the cookie sign-in routes, the device sign-in routes and the password route; pending remedies: R1, R2, R3.

## Decision ledger

### R1: device rotation is opt-in per request, or every device session rotates
Finding: 1, P1, confidence 9, `mutaba3a-flutter/mutaba3a/lib/data/repositories/password_repository.dart:17-30` (shipped MUT-238 builds treat any 2xx as Ok and never read the body), reviewer: Claude (plan-eng-review).
Plan baseline: plan §3 D1 proposes opt-in (`rotateToken: true`); the ticket's AC7 assumes every device session rotates and server + phone release together. Neither is approved.
Runtime evidence: `server/src/schemas.ts:1143-1145` `ChangePasswordRequestSchema` is a plain `z.object` (no `.strict()`), so an unknown `rotateToken` is stripped by today's server; the phone sends `X-App-Platform`/`X-App-Build` (`lib/core/api/api_client.dart:105-109`); MUT-293's floor exists (`server/src/auth/minimum-build.ts`).
Comparison grid:
| Choice | Current | A opt-in | B always, lock-step | C always + raise floor |
|---|---|---|---|---|
| R1 device rotation | never rotates | only when body has `rotateToken: true` | every device change | every device change |
| Old phone builds after a change | stay signed in | stay signed in, token not rotated (TD left) | signed out on next request, local data wiped, sign in again | blocked by "update required" before they can change |
| Release order | n/a | any order | server and phone together (AC7) | phone first, then server + floor raise |
| AC7 | as ticket | replaced (noted on ticket) | kept | kept, stronger |
| R2, R3 | pending | pending | pending | pending |
Question D2:
D2 — Should a phone session rotate only when the app asks for it?
Project/branch/task: planning MUT-262 on main; server in mini-crm, phone in mutaba3a-flutter.
ELI10: Phones already in people's hands (MUT-238 builds) see any success as success and never read the answer. If the server always hands back a new token and kills the old one, those phones throw the new token away, get refused on their next request, sign out and wipe their local copy of the records. With opt-in, only new builds that know to store the new token ask for one; old builds keep today's behaviour until the minimum-build floor retires them.
Stakes if we pick wrong: every person on an older phone build who changes their password gets signed out and has their on-phone records wiped right after, which reads as a bug.
Recommendation: A because it closes the hole for every portal session and every new phone build without breaking old builds, and frees the release order.
Completeness: A=8/10, B=9/10, C=10/10
Net: a small leftover gap on old builds, against signing those people out or forcing them to update.
Header: Phone opt-in
Options:
A) Opt-in per request (recommended)
New builds send `rotateToken: true` and get `200 { token }`; without it the answer stays 204 and the session is kept. Cookie sessions always rotate. ✅ No old build is signed out or wiped ✅ Server and phone ship in any order. ❌ Old builds keep the gap until MUT-293's floor passes the rotating build (TD filed). human ~same / CC ~+10 min.
B) Always rotate, release together
Every device change rotates; server and phone release the same day as the ticket says. ✅ The gap closes for everyone at once ✅ No opt-in field in the contract. ❌ Anyone still on an old build is signed out and wiped after a change; the release has to be coordinated. human ~same / CC ~same.
C) Always rotate, raise the floor
Every device change rotates, and the release raises the iOS/Android minimum build to the rotating build. ✅ No gap and no surprise sign-outs ✅ No opt-in field. ❌ Every phone user must update before using the app again, for a Low-priority fix. human ~+0.5 day / CC ~+15 min.

State: approved
Actual answer: A) Opt-in per request (D2 answer, 2026-10-25)
Accepted scope: plan §3 D1 as written: `rotateToken: z.literal(true).optional()` on `ChangePasswordRequest`; cookie sessions always rotate; a device session rotates and answers `200 { token }` only with `rotateToken: true`, else 204 and kept; old builds' remaining gap filed as a TD that closes when MUT-293's minimum build passes the rotating build; AC7 replaced by "any release order", noted on the ticket. R2, R3 still pending.
History: none

### R2: how the portal keeps a stale-cookie 401 from ending the session after a change
Finding: 2, P2, confidence 8, `src/hosted/session/SessionBridge.tsx:62-65` (`setUnauthorisedHandler(() => { if (queryClient.getQueryData(ME_KEY) === undefined) return; endSession(...) })`) and `src/hosted/api/client.ts:392` (`if (error.status === 401 && !isSignIn && wentRemote) unauthorisedHandler?.(error)`), reviewer: Claude (plan-eng-review).
Plan baseline: plan §3 D3 proposes a time window (from send until 5 s after the answer) in which a 401 re-asks `GET /v1/me` once. Not approved.
Runtime evidence: a request sent with the old cookie that the server handles after the commit gets 401 `SESSION_EXPIRED` (middleware.ts:328-335 with plan D2's revoked old row). A slow request can come back more than 5 s after the change answered, so a fixed window can miss it. The phone already ignores a 401 for a token it no longer holds (`api_client.dart:186-196`, MUT-208).
Comparison grid:
| Choice | Current | A credential generation | B 5 s window + re-probe | C nothing |
|---|---|---|---|---|
| R2 stale 401 after a change | ends the session | ignored when the request was sent before the change answered; a 401 arriving while the change is in flight waits for it to settle, then is judged | re-probes `/v1/me` inside the window; outside it ends the session | ends the session (person signs in again with the new password) |
| Extra requests | 0 | 0 | 1 per 401 in the window | 0 |
| After a successful change | toast | toast + invalidate queries (stale errors refetch) | toast | toast |
| Same rule as the phone | n/a | yes (MUT-208 shape) | no | no |
| R1 | A approved | A | A | A |
| R3 | pending | pending | pending | pending |
Question D3:
D3 — How should the portal tell a stale-cookie 401 from a real sign-out right after a change?
Project/branch/task: planning MUT-262 on main; portal is src/hosted in mini-crm.
ELI10: When the password changes, the browser's old cookie stops working at once. Any request the page had already sent with the old cookie can come back "signed out" a moment later, and today the portal treats that as a real sign-out and shows the sign-in page, right after a successful change. We can recognise those late answers: they belong to requests sent before the change finished. The phone already uses this rule.
Stakes if we pick wrong: a person who just changed their password is bounced to sign-in for no reason; rare, but it looks broken at the worst moment.
Recommendation: A because it is exact (no timer to tune), costs no requests, and matches the phone's rule.
Completeness: A=10/10, B=8/10, C=5/10
Net: a small counter in the API client, against a timer that can miss slow requests or doing nothing.
Header: Portal 401
Options:
A) Credential generation (recommended)
The API client counts credential changes. Each request remembers the count when sent; a 401 on a request sent before the change answered is ignored, and one that lands while the change is in flight waits for it, then is judged. After success, all queries are invalidated. ✅ Exact for slow requests too ✅ Same rule as the phone (MUT-208), no extra request. ❌ A little state in client.ts that only password changes use. human ~3h / CC ~20 min.
B) 5-second window, re-probe
Plan D3 as written: inside a window from send to 5 s after the answer, a 401 re-asks /v1/me once and only ends the session if that is 401 too. ✅ Simple to read ✅ The re-probe double-checks against the server. ❌ A request slower than the window still signs the person out, and 5 s is a number with no basis. human ~2h / CC ~15 min.
C) Do nothing
Keep today's handler; a late 401 signs the person out and they sign in with the new password. ✅ No portal code change ✅ Nothing new to test. ❌ A just-changed password can land the person on sign-in for no visible reason. human 0 / CC 0.

State: approved
Actual answer: A) Credential generation (D3 answer, 2026-10-25)
Accepted scope: replaces plan §3 D3's window. `src/hosted/api/client.ts` keeps a credential generation and an in-flight change promise; each request records the generation when sent; `changePassword` sets the in-flight promise and bumps the generation when it succeeds; a 401 is held until any in-flight change settles, then passed to the unauthorised handler only if the request's generation is still current. After a successful change the drawer invalidates every query. Tests: a 401 on a pre-change request is ignored; a 401 landing while the change is in flight is ignored once it succeeds and ends the session if it failed; a 401 on a post-change request ends the session as today.
History: none

### R3: where the phone swaps in the new token
Finding: 3, P2, confidence 7, plan §5.1 ("`PasswordRepository.change` ... `200 { token }` → `AuthService.adoptRotatedToken(token)`") against `lib/data/repositories/password_repository.dart:17-30` (a data-layer class holding only `_apiClient`) and `lib/domain/services/auth_service.dart:92-107` (sign-in's token write lives in the domain service), reviewer: Claude (plan-eng-review).
Plan baseline: plan §5.1-5.3: the repository adopts the token; `ApiClient.rotating(...)` wraps the call. Not approved.
Runtime evidence: the race guard only works if the rotation stays "in flight" until the Keychain holds the new token (`_refusesStoredSession` reads the Keychain, `api_client.dart:193`). A repository that adopts the token needs an `AuthService` dependency the data layer doesn't have today.
Comparison grid:
| Choice | Current | A AuthService orchestrates | B repository adopts |
|---|---|---|---|
| R3 who swaps the token | nothing swaps | `AuthService.changePassword(current, next)` runs `apiClient.rotating(() async { token = await repo.change(...); if (token != null) await adoptRotatedToken(token); })` | `PasswordRepository.change` calls an injected `AuthService.adoptRotatedToken`; the screen wraps it in `rotating` |
| Repository return type | `Result<void, ApiError>` | `Result<String?, ApiError>` (new token or null) | `Result<void, ApiError>` |
| Layering | data → api only | data → api only; domain owns the session | data → domain (new dependency) |
| Screen change | calls repository | calls the service (through its provider) | wraps the call in `rotating` |
| R1, R2 | A, A approved | A, A | A, A |
Question D4:
D4 — Where should the phone swap in the new token after a change?
Project/branch/task: planning MUT-262 on main; phone is mutaba3a-flutter.
ELI10: After the change, the phone has to store the new token and re-label its saved copy of "who you are", and the guard that stops a late "signed out" answer from wiping the phone has to stay up until that store is done. Signing in already does this kind of work in AuthService. The plan put it in the password repository instead, which would make a low-level class reach up into the session service.
Stakes if we pick wrong: the guard can drop too early and a late answer can still sign the person out and wipe the phone, or the code ends up with a dependency that points the wrong way.
Recommendation: A because the service that owns sign-in also owns this swap, and the guard naturally covers the whole step.
Completeness: A=9/10, B=7/10
Net: one new service method and a repository that returns the token, against a backwards dependency.
Header: Phone swap
Options:
A) AuthService orchestrates (recommended)
`AuthService.changePassword` wraps the repository call and the token adoption in `ApiClient.rotating`; the repository just returns the new token or null; the screen calls the service. ✅ The guard covers the Keychain write, not just the request ✅ Session handling stays in one service, next to sign-in. ❌ The screen and its test switch from the repository to the service. human ~3h / CC ~25 min.
B) Repository adopts
Plan §5.1 as written: the repository gets an AuthService and adopts the token itself; the screen wraps the call in `rotating`. ✅ Smallest change to the screen ✅ Keeps the existing repository test shape. ❌ The data layer starts depending on the domain service, and the guard's scope depends on the screen remembering to wrap. human ~2.5h / CC ~20 min.

State: approved
Actual answer: A) AuthService orchestrates (D4 answer, 2026-10-25)
Accepted scope: replaces plan §5.1's adoption site. `PasswordRepository.change` sends `rotateToken: true` and returns `Result<String?, ApiError>` (the new token on 200, null on 204). New `AuthService.changePassword(current, next)` runs the call and `adoptRotatedToken` inside `ApiClient.rotating(...)`, so the guard holds until the Keychain has the new token; the change screen calls it through a provider. Tests: the service adopts on 200, leaves the token on 204, adopts nothing on an error; the guard ignores an old-token `SESSION_EXPIRED` that lands before the write; the screen test fakes the service.
History: none

Approval readiness: PASS. Checked R1 (D2 answer: A), R2 (D3 answer: A), R3 (D4 answer: A); structure from D1 (A). No remedy is accepted without its own answer; no deferrals.

## Review findings

Scope Challenge: scope accepted as-is (D1 kept the original arrangement; no cuts).
1. [P1] (confidence: 9/10) `mutaba3a-flutter/.../password_repository.dart:17-30` — shipped MUT-238 builds treat any 2xx as Ok; unconditional rotation signs them out and wipes them. Disposition: accepted, R1/D2 A (opt-in).

Reality rows:
- REALITY: premise-table pass 12 premises, unverified=0 (receipts: sessions.ts:269/293, prisma.ts:403-412, middleware.ts:328-335, ports.ts revoke "first revocation wins", schemas.ts:1143-1145, password_repository.dart:17-30, api_client.dart:186-196, auth_service.dart:160-161, ShareExtension has 0 token refs, CaptureUploader.swift:200-202, SessionBridge.tsx:62-65, schema.prisma:522-545)
- REALITY: already-done pass no rotation work on main or the phone repo since TD-158 was filed (`git log --grep rotat|TD-158|MUT-262`: only fe7f46d7 "TD-158 is ticketed")
- REALITY: surface-check pass setCookie maxAge (sessions.ts:114), `npm run hosted:types` (package.json:32), `openapi:check` (server/package.json:29) all exist
- REALITY: binding-decisions pass MUT-115 D6 (passkey removal revokes its sessions) kept by copying passkeyId; MUT-115 D5 step-up reads credentialsVerifiedAt, which the new row sets to the change
- REALITY: numbers pass file count 16 [estimated]; API version 1.71.0-mut262 [re-measure before merge: app.ts:235 is 1.70.0-mut370 today]
- REALITY: deferred-asks finding AC7 (lock-step release) replaced by R1; AC4's share-sheet and widget one-tap no longer use the token (MUT-264), replaced by Siri capture + FX widget; both to be noted on the ticket
- REALITY: pr-count pass two changes, one per repo (mini-crm branch, mutaba3a-flutter branch), shippable in either order (R1)
- REALITY: transaction-semantics pass rotation runs inside the existing changePassword transaction under the users row lock (prisma.ts:392-393); a P2002 rolls back the whole transaction
- REALITY: contract-assumptions pass phone sends X-App-Build (api_client.dart:105-109); old server strips unknown body fields (schemas.ts:1143)
- REALITY: dependency-fallback pass server ships alone (portal rotates, phones unchanged); phone ships alone (gets 204, adopts nothing)

### 1. Architecture
- [P2] (confidence: 8/10) `src/hosted/session/SessionBridge.tsx:62-65` — a stale-cookie 401 after the change ends the session; the plan's 5 s window misses slow requests. Disposition: accepted, R2/D3 A.
- [P2] (confidence: 7/10) plan §5.1 vs `auth_service.dart:92-107` — the repository adopting the token inverts layering, and the guard must cover the Keychain write. Disposition: accepted, R3/D4 A.

```
POST /v1/me/password (session principal)
  verifyCurrentPassword ──wrong──> 403 CURRENT_PASSWORD_WRONG (lockout counts)
  hash new password (outside tx)
  rotate? = kind==cookie || rotateToken===true
  tx: lock users row ─ hash moved / kept revoked ──> StateConflict ──> 403
      update password, revoke others ('password_changed')
      rotate? ── yes ──> revoke kept ('password_rotated'); insert new row
             │          (kind, userAgent, passkeyId, absoluteExpiresAt copied;
             │           created=verified=lastSeen=at; idle=min(at+idle, absolute))
             │          P2002 ──> rollback, 500, old token still works
             └─ no ──> re-stamp kept credentialsVerifiedAt (today)
      audit user.password_changed {tokenRotated}
  mail notice (after commit)
  cookie ──> 204 + Set-Cookie(maxAge = seconds to absolute)
  device+rotate ──> 200 {token};  device ──> 204

late request with OLD token after commit
  findByDigest(old) -> row revoked -> 401 SESSION_EXPIRED   (new row untouched)
    portal: generation stale -> ignored        phone: stored token differs -> ignored
```

### 2. Code quality
- [P3] (confidence: 8/10) `server/src/repositories/ports.ts:1345` — `changePassword` returns `UserRecord | null` today; the plan widens it to `{ user, session } | null`. One caller (`routes/sessions.ts:293`), and `store-guard.ts:77` classifies by name only, so no ripple. Disposition: accepted as part of the approved behaviour (no question needed).
- No other issues: `sessionLifetime(kind, settings)` replaces the three inline formulas (sessions.ts:112, :155; device-sessions.ts:43-46) per D1.

### 3. Tests
```
CODE PATHS                                              USER FLOWS
[+] server POST /v1/me/password                         [+] Portal change password
  ├── [★★★ TESTED] wrong current / StateConflict          ├── [GAP] [→E2E] stays signed in, old cookie 401 (portal-selfservice)
  ├── [GAP] cookie rotates, Set-Cookie, maxAge            ├── [★★ TESTED] drawer toast (account.spec.ts:22, FakeApi 204+Set-Cookie)
  ├── [GAP] device+rotateToken 200 {token}                └── [GAP] stale 401 ignored (client.test.ts)
  ├── [★★★ TESTED] device w/o flag 204 kept (existing)  [+] iPhone change password
  └── [GAP] cookie+flag still 204                         ├── [GAP] [→E2E] old bearer 401, stored 200, Me cached (ios flow)
[+] store changePassword (memory + Prisma)                ├── [GAP] old-token 401 before write: no wipe (api_client_test)
  ├── [GAP] rotation row copy + old revoked               └── [★★ TESTED] offline / wrong password (existing flows)
  ├── [GAP] absolute kept, idle clamped
  ├── [GAP] P2002 rolls back everything (AC5)
  ├── [GAP] racing second change, rotation on (extend)
  └── [★★★ TESTED] rotation off: 10 existing cases
[+] middleware stale path
  └── [GAP] old-token in flight -> 401, new row live
[+] phone AuthService.changePassword / adoptRotatedToken
  └── [GAP] 200 adopt+Me re-tag / 204 none / error none
COVERAGE: 5/19 paths tested today | all 14 gaps have planned tests (§6, §5, §7)
QUALITY: ★★★:3 ★★:2 | GAPS: 14 (2 E2E)
```
Regression contract (from R1/R2/R3 answers): the 10 existing change-password contract cases stay green unedited; a portal 401 outside a change ends the session as today; the phone's MUT-208 rule stays. Tests made obsolete: `settings_change_password_test.dart:149` (old bearer 200) and its teardown at :80-89. Test plan artifact: `~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261025-043731.md`.

### 4. Performance
No issues found. One extra INSERT and UPDATE per password change, inside a transaction that already locks the users row; `sessions.tokenDigest` is unique-indexed. Scale: password changes per person are rare (unknown absolute rate, well under 1/s).

### Outside voice
Outside voice unavailable: Codex CLI not installed, and the native Plan fallback gave no complete report within five minutes (stopped). Fix: install Codex (`npm i -g @openai/codex` then `codex login`). No outside coverage for this review.

## NOT in scope
- Rotating tokens on events other than a password change (ticket scope-out).
- Changing the 30-day idle / 180-day absolute lifetimes (ticket scope-out).
- Making old phone builds rotate: closes when MUT-293's minimum build passes the rotating build (TD, per R1).
- Recovering from a lost change answer on the phone (§5.4): any server-side grace re-opens TD-158.
- MUT-415's passkey review after a password change: its own ticket.

## What already exists
- `generateSessionToken` / `generateDeviceSessionToken` / `sessionDigest` (`server/src/auth/sessions.ts`): reused for the new token.
- The changePassword transaction, row lock and race rules (`prisma.ts:391-415`, MUT-237/238 review): extended, not rebuilt.
- `revoke` keeps the first reason (`ports.ts` SessionRepository): makes the middleware's stale-path revoke harmless.
- Phone MUT-208 rule (`api_client.dart:186-196`) and the token-fingerprinted Me cache (`auth_service.dart:40-42`): reused; the portal copies the MUT-208 rule (R2).
- Sign-in's adopt steps (`auth_service.dart:92-107`) and the MUT-115 plan's proposed `_adoptSession`: whichever lands first creates the helper.

## Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| server rotation | digest collision / DB error mid-tx | rollback test (AC5) | 500 "unreachable" banner; old session and password unchanged |
| portal late 401 | request sent with old cookie returns after commit | R2 generation tests | nothing (ignored) |
| phone late 401 | old-token SESSION_EXPIRED before the Keychain write | R3 guard test | nothing (ignored) |
| phone lost answer | timeout/5xx after commit | accepted (§5.4), copy tweak | sign-in screen with expiry reason; "use your new password" hint |
| Siri capture mid-rotation | intent read the old token | existing pending path | "saved, sign in" (capture kept, sent later) |
Critical gaps (no test, no handling, silent): 0.

## Worktree parallelization strategy
| Step | Modules touched | Depends on |
|---|---|---|
| Server rotation + contract | server/src/repositories, server/src/auth, server/src/routes, server/openapi | — |
| Portal generation guard | src/hosted/api, src/hosted/components, qa/ | server contract (types regen) |
| Phone swap + guard | mutaba3a-flutter lib/, test/, integration_test/, qa/ | server contract (for the live QA flow only) |

Lane A: server → portal (same repo, sequential). Lane B: phone (other repo; unit work in parallel with A, its live QA flow after A merges). Execution: launch A and B; B's QA run waits for A's server on the dev API. Conflict flags: none across lanes (separate repos).

## Implementation Tasks
- [ ] **T1 (P1, human: ~4h / CC: ~30min)** — server — rotate the caller's session in changePassword (memory + Prisma), copy kind/userAgent/passkeyId/absolute, revoke old as `password_rotated`
  - Surfaced by: Scope Challenge 1 / plan §4.1-4.3
  - Files: server/src/repositories/{ports,prisma,memory}.ts, server/src/repositories/__tests__/store-contract-change-password.ts
  - Verify: `npm --prefix server test` and `npm --prefix server run test:db`
- [ ] **T2 (P1, human: ~3h / CC: ~25min)** — server — route: `rotateToken` opt-in, cookie Set-Cookie with remaining Max-Age, device 200 {token}, `sessionLifetime` helper, OpenAPI + API_VERSION
  - Surfaced by: R1/D2
  - Files: server/src/routes/sessions.ts, server/src/routes/device-sessions.ts, server/src/auth/sessions.ts, server/src/schemas.ts, server/src/app.ts, server/src/__tests__/routes-sessions.test.ts
  - Verify: `npm --prefix server run openapi:check`, `npm --prefix server test`
- [ ] **T3 (P2, human: ~3h / CC: ~20min)** — portal — credential generation in client.ts, invalidate queries after a change, regen schema.d.ts
  - Surfaced by: Architecture — SessionBridge.tsx:62-65 (R2/D3)
  - Files: src/hosted/api/client.ts, src/hosted/components/ChangePasswordDrawer.tsx, src/hosted/api/schema.d.ts, tests
  - Verify: `npm run test:run`
- [ ] **T4 (P2, human: ~2h / CC: ~20min)** — QA — portal-selfservice `account.rotate-on-change` feature + spec; FakeApi answers 204 + Set-Cookie
  - Surfaced by: Test review — portal E2E gap
  - Files: qa/features/portal-selfservice/account.yaml, qa/specs/portal-selfservice/account.spec.ts
  - Verify: `release-qa run --attach --only rotate-on-change`; `release-qa lint`
- [ ] **T5 (P2, human: ~4h / CC: ~30min)** — phone — `AuthService.changePassword` + `adoptRotatedToken` inside `ApiClient.rotating`, repository returns the token, screen via provider, unknown-outcome copy (en/ar)
  - Surfaced by: R3/D4, plan §5.3-5.4
  - Files: lib/data/repositories/password_repository.dart, lib/domain/services/auth_service.dart, lib/core/api/api_client.dart, lib/presentation/screens/settings/change_password_screen.dart, lib/presentation/l10n/app_{en,ar}.arb, tests
  - Verify: `flutter test`
- [ ] **T6 (P2, human: ~2h / CC: ~20min)** — phone QA — invert the old-bearer assertion, teardown with the stored token, relaunch keeps cached Me
  - Surfaced by: Test review — Tests to Retire
  - Files: integration_test/qa/settings_change_password_test.dart, qa/features/ios/settings.yaml
  - Verify: `release-qa run --only ios.settings.change-password` (Mutaba3a QA simulator, wait your turn)
- [ ] **T7 (P2, human: ~1h / CC: ~10min)** — docs — ADR-037 amendment (rotation on change, opt-in), TD-158 resolved, new TD for old builds, MUT-238 brief's share-extension claim corrected, CHANGELOG/SYSTEM_OVERVIEW/TEST_PLAN, ticket comment (AC4/AC7)
  - Surfaced by: Reality rows — deferred-asks
  - Files: .claude/DECISIONS.md, .claude/TECH_DEBT.md, .claude/CHANGELOG.md, mutaba3a-flutter .claude/designs/mut-238-change-password.md
  - Verify: read-through

## Unresolved decisions
None.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 11/11 applicable rows emitted, 0 unverified premises
- Architecture Review: 2 issues found
- Code Quality Review: 1 issue found
- Test Review: diagram produced, 14 gaps identified (all with planned tests)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (old-build gap is a TD under R1)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback timed out)
- Parallelization: 2 lanes, 2 parallel / 1 sequential
- Lake Score: 3/4 answers picked a 10/10-scored option where scored (D1 9/10 top, D2 chose 8/10 by recommendation, D3 10/10, D4 9/10 top) — 4/4 picked the top-recommended option

## Suppressed findings
- (confidence 4/10) a JSON body carrying a bearer token could be logged by a proxy; device sign-in already returns one (device-sessions.ts:77) and app.ts:252 sets no-store, so no new exposure.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 1 | unavailable | CLI not installed; native fallback timed out |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 69 | ISSUES OPEN | 17 issues (2 arch, 1 quality, 14 test gaps), 0 critical gaps (all 3 remedies approved: R1 D2, R2 D3, R3 D4) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (not installed); native Plan fallback stopped at the five-minute limit with no report. No outside findings.
- **VERDICT:** no review CLEAR; findings are mapped to approved work (T1–T7). Eng review issues are resolved decisions, not open questions; ready to implement.

NO UNRESOLVED DECISIONS
