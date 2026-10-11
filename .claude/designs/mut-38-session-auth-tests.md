# MUT-38 — session auth beside API keys (test plan)

Companion to `hosted-portal.md` §4 and §6 (approved 2026-10-11), ADR-037 decisions 3–6 and 9, and the "Re-cut after MUT-36" section on MUT-38. Written before implementation. Paths are under `server/`.

## Boundary with MUT-39

**MUT-38 builds:**
- The `sessions` table and the `USER` audit actor.
- Sign-in, sign-out and `/v1/me`.
- Lockout and throttling.
- The `authenticate()` middleware, which resolves exactly one principal and enforces each route's declared OpenAPI `security`.
- The `X-Mutaba3a-Profile` selector with a membership check.
- Session effective scopes, taken from a `WRITABILITY_MATRIX` const in `src/auth/writability.ts`.
- Opening the 20 portal GET routes (the `read` rows of brief §5) to sessions.
- System-actor lazy posting for session reads.
- Session revocation on operator reset and disable.
- The log-redaction fix (TD-039).
- The `SESSION_TOKEN_PEPPER` Terraform secret, so `main` stays deployable.

**MUT-39 builds:**
- `READ_ONLY_PROFILE` on session writes (until then they get `PRINCIPAL_NOT_ACCEPTED`).
- The per-request store and its compiler-exhaustive guard.
- The brief↔const drift test and the matrix-generated route tests.

## Decisions taken while planning

- **Cookie:** `__Host-mut_session` (`Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=` absolute lifetime). When `NODE_ENV=development` it is `mut_session` without `Secure`.
- **Token and digest:**
  - The token is 32 random bytes in base64url (43 characters).
  - The digest is `HMAC-SHA256(SESSION_TOKEN_PEPPER, token)` in hex.
  - Lookup is by unique digest, then `hashesMatch`.
- **Expiry:**
  - Idle `SESSION_IDLE_MINUTES` (default 120), absolute `SESSION_ABSOLUTE_HOURS` (default 12).
  - Activity slides the idle deadline, capped at the absolute one.
  - `lastSeenAt` is written at most once a minute.
- **Session invalidation:** a session is also void if `user.status ≠ ACTIVE` or if `user.passwordChangedAt > session.createdAt`. This is belt-and-braces on top of the explicit revoke on reset and disable.
- **Sign-in throttling:**

  | Rule | Value |
  |---|---|
  | Per normalised email (whether or not the account exists) | 5 failures in 15 minutes lock that email for 15 minutes |
  | Response while locked | the same `401 INVALID_CREDENTIALS` |
  | Per IP | 20 attempts a minute, then `429 RATE_LIMITED` |
  | Client IP | the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` from the right (default 1) |

- **Every sign-in attempt runs exactly one argon2 verify:**
  - An unknown email is verified against a dummy hash made with the same parameters.
  - A locked or disabled user also gets a verify, whose result is ignored.
- **Same-origin rule** for `POST /v1/sessions` and every non-GET session request: `Sec-Fetch-Site: same-origin` is accepted. Otherwise `Origin` must equal `PORTAL_ORIGIN` when it is set, or the request's own origin. Any other value of `Sec-Fetch-Site`, or no `Origin`, gives `403 CROSS_SITE_REQUEST`.
- **Principal resolution:**
  - A route's endpoint pattern (`hono/route` `matchedRoutes`) is looked up in an index built from the OpenAPI registry.
  - `security: []` means public.
  - A path that isn't declared needs some valid principal, then falls through to 404.
  - Both credentials on one request give `401 UNAUTHENTICATED` with `details.reason: 'ambiguous_credentials'`.
- **Organization-independent session routes:** `GET /v1/me` and `DELETE /v1/sessions/current`. Every other session route needs `X-Mutaba3a-Profile`:
  - missing → `422 VALIDATION_FAILED` with `details.reason: 'PROFILE_REQUIRED'`;
  - malformed, unknown or non-member → `404 NOT_FOUND`.
- **Rate limiting:** sessions use the same per-minute budget as keys, keyed `session:<id>`.
- **Audit:**
  - `user.signed_in` (actor `USER`) on each member organization.
  - `user.locked_out` (actor `SYSTEM`) on each member organization, written once per lock.
- **New error codes:** `INVALID_CREDENTIALS` 401, `SESSION_EXPIRED` 401, `PRINCIPAL_NOT_ACCEPTED` 403, `CROSS_SITE_REQUEST` 403.
- **Contract:**
  - New security scheme `session` (cookie).
  - `AuditEvent.actorType` gains `USER`.
  - `VALIDATION_REASONS` gains `PROFILE_REQUIRED`.
  - API version `1.9.0-mut38`.
- **Operator:** `POST /admin/v1/users/{id}/sessions/revoke`, and `npm run revoke:sessions -- --email`.

## Unit (pure): `src/auth/__tests__/sessions.test.ts`

**Tokens and digests:**
- `generateSessionToken` returns 43 base64url characters, unique over 1,000 calls.
- `sessionDigest` is deterministic for one pepper, differs for another pepper, is 64 hex characters, and never equals the token.

**Cookie names:** `sessionCookieName(true)` is `__Host-mut_session`; `false` gives `mut_session`.

**`clientIp`:**
- With one hop: the last `X-Forwarded-For` entry.
- With two hops: the second from the right.
- Whitespace is trimmed.
- No header, or fewer entries than hops: `'unknown'`.

**`isSameOriginRequest`:**
- `Sec-Fetch-Site` `same-origin` → true.
- `Sec-Fetch-Site` `cross-site`, `same-site` or `none` → false.
- `Origin` equal to the configured portal origin → true. A different `Origin` → false.
- No portal origin configured: `Origin` equal to the request origin → true.
- No headers → false.

**`SignInThrottle`:**
- Four failures don't lock. The fifth locks and returns the lock-until time.
- Still locked at 14:59, unlocked at 15:00.
- Failures older than the window don't count.
- `clear` resets.
- Keys are independent.

## Config: `src/__tests__/config.test.ts` (+)

- `SESSION_TOKEN_PEPPER` is required with at least 32 characters; a missing or short value is a `ConfigError` naming it.
- Idle defaults to 120 (bounds 5–1440); absolute defaults to 12 (bounds 1–168).
- `PORTAL_ORIGIN` is an optional URL.
- `TRUSTED_PROXY_HOPS` defaults to 1 (bounds 0–5).

## Storage contract: `store-contract-sessions.ts` (memory + Postgres)

**Sessions:**
- `sessions.create` round-trips through `findByDigest`.
- A duplicate digest raises `UniqueViolation`; an unknown user raises `ForeignKeyViolation`.
- `touch` moves `lastSeenAt` and `idleExpiresAt`.
- `revoke`: the first revocation wins (its time and reason stay). An unknown id returns `null`.
- `revokeAllForUser` revokes only that user's active sessions and returns the count. Already-revoked ones keep their original reason.

**Users:**
- `users.recordFailedSignIn` increments `failedSignIns` and sets `lockedUntil` when given one.
- `users.recordSignIn` sets `lastSignInAt` and clears `failedSignIns` and `lockedUntil`.

**Audit:** `audit.append` accepts actor `USER`.

## Routes: `src/__tests__/routes-sessions.test.ts`

**Sign in:**
- Returns 201 with the `Me` body.
- `Set-Cookie` is `__Host-mut_session=<43 chars>; Max-Age=43200; Path=/; HttpOnly; Secure; SameSite=Strict`.
- The token is not in the body. The stored digest differs from the token.
- `lastSignInAt` is set, and `user.signed_in` (actor `USER`) is appended to each member organization.
- The email is case- and space-insensitive.

**Indistinguishable failures:**
- Unknown email, wrong password, disabled user and locked user all give status 401, code `INVALID_CREDENTIALS`, and the same message.
- The hasher's `verify` runs exactly once in each case.
- The dummy hash carries the configured m/t/p.

**Lockout:**
- Five wrong passwords, then the right one, gives 401.
- Exactly one `user.locked_out` (actor `SYSTEM`) is written, and `lockedUntil` is set.
- After 15 minutes, the right password gives 201 and clears the counters.
- An unknown email locks the same way and stays indistinguishable.

**Per-IP limit:** the 21st attempt in a minute from one IP gives 429 with `Retry-After`. A different IP is unaffected.

**Cross-site:**
- Sign-in with a foreign `Origin`, with `Sec-Fetch-Site: cross-site`, or with no `Origin` gives 403 `CROSS_SITE_REQUEST`.
- The same holds for sign-out.

**`/v1/me`:**
- Returns the user and one profile per membership: `{ id, name, source: 'hosted', defaultCurrency, timezone, writerOfRecord, access }`.
- `writerOfRecord` is `MALAFAT` only when the organization has a CONNECTED Malafat integration, otherwise `null`.
- `access` equals the matrix session column.

**Failures and expiry:**
- No credential gives 401 `UNAUTHENTICATED`. An unknown cookie gives 401 `SESSION_EXPIRED`.
- Idle: no request for 120 minutes gives 401. Requests every 100 minutes keep the session alive until the 12-hour absolute limit, then 401.

**Sign-out:** returns 204, and `Set-Cookie` clears the cookie. Replaying the old cookie gives 401 `SESSION_EXPIRED`, because the record is revoked.

**Operator actions:**
- A password reset revokes all of that user's sessions; the next request gives 401.
- Disable revokes sessions and refuses sign-in. Enable allows sign-in again.
- `POST /admin/v1/users/{id}/sessions/revoke` returns the count, and the sessions die.

**Both credentials:** 401 with `ambiguous_credentials`.

**Organization scoping:**
- A session calling `GET /v1/customers` without the header gives 422 `PROFILE_REQUIRED`.
- With its own organization: 200, and only that organization's rows.
- Another organization's id, a malformed id, or a removed membership gives 404.

**Lazy posting:** a session `GET /v1/summaries/organization` posts a due installment. The resulting `installment.posted` audit row has actor `SYSTEM`, and no `USER` row exists.

**Session rate limit:** with a limiter of 3 a minute, the fourth session request gives 429.

**Secrets:** the log stream never contains the session token, the digest or the password.

## Route security: `src/__tests__/route-security.test.ts`

These checks are generated from the published OpenAPI document.

**Declarations:**
- Every `/v1` operation declares `security`, or is the public `POST /v1/sessions`.
- Every `/v1` operation except the identity routes (`GET /v1/me`, `DELETE /v1/sessions/current`) has a `requireScope` middleware, detected by its marker.

**Per-route behaviour:**
- Every key-only operation, called with a valid session (and profile header), gives 403 `PRINCIPAL_NOT_ACCEPTED`.
- Every session-only operation, called with a valid API key, gives 403 `PRINCIPAL_NOT_ACCEPTED`.

**Snapshot:** the set of operations accepting sessions is exactly the 20 portal GET routes plus the two identity routes.

## Logger: `src/__tests__/logger.test.ts`

- `createLogger(level, destination)` redacts each of these keys at depths 0–3: `authorization`, `cookie`, `set-cookie`, `password`, `token`, `secret`, `apiKey`, `key`, `x-admin-token`, `sessionToken`.
- `req.headers.cookie` and `res.headers["set-cookie"]` are redacted.
- Non-secret siblings survive.

## CLI: `src/scripts/__tests__/users-cli.test.ts` (+)

`revoke-sessions --email` prints the revoked count.

## Contract and gates

- `openapi.yaml` is regenerated: the `session` scheme, three routes, the error codes, `USER`, and `PROFILE_REQUIRED`. `API_VERSION` is `1.9.0-mut38`, and the version pins move.
- Server gates: lint, typecheck, `npm test`, `npm run test:db` (isolated database), `openapi:check`, and `terraform validate` if the CLI is available.
- Root gates are unaffected.
