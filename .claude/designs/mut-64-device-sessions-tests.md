# MUT-64 — Test plan

Written before implementation ("Auth change: tests come first"). Each case
names the file it lives in and the acceptance criterion or design decision it
proves. Unit tests go red first, then green; route/integration tests follow
the same TDD order per file.

## 1. `server/src/auth/__tests__/sessions.test.ts` (extend)

| Case | Asserts |
|---|---|
| `generateDeviceSessionToken()` shape | starts with `mds_`, total length matches the documented format, two calls never collide (birthday-bound sanity, not cryptographic proof) |
| `isDeviceSessionToken()` table | `mds_...` → true; `mut_live_...` → false; `mut_test_...` → false; empty string → false; `mds` with no trailing underscore → false |
| `sessionDigest` reused identically | same `(pepper, token)` pair produces the same digest regardless of whether `token` came from `generateSessionToken()` or `generateDeviceSessionToken()` — proves no kind-specific hashing was accidentally introduced |

## 2. `server/src/auth/__tests__/sign-in.test.ts` (new — covers the extracted `signIn()`)

| Case | Asserts |
|---|---|
| Success | correct email/password → returns `{ user, token, session }`; `session.kind` matches what was passed in; throttle is cleared for that key afterward |
| Wrong password | throws `INVALID_CREDENTIALS`; a failure is recorded; throttle failure count increments |
| Unknown email | throws the *same* `INVALID_CREDENTIALS` (message-identical to wrong-password case); exactly one argon2 verify still runs (dummy hash) — timing-shape parity, the core anti-enumeration property |
| Disabled user | correct password but `status !== 'ACTIVE'` → `INVALID_CREDENTIALS`, not a different code (matches today's behavior) |
| Lockout | 5 failures within the window → 6th attempt (even with the correct password) is refused without a 6th argon2 verify running (throttle short-circuits before `passwordHasher.verify`) |
| `sessionKind` threading | calling with `'device'` vs `'cookie'` produces a session row whose `kind` matches, and an audit row whose `metadata.sessionKind` matches |
| Lifetime threading | calling with device-length `idleMs`/`absoluteMs` produces a session whose `idleExpiresAt`/`absoluteExpiresAt` reflect those values, not the cookie defaults |

## 3. `server/src/__tests__/routes-sessions.test.ts` (regression gate, no new cases)

Run unmodified after the `signIn()` refactor. **Every existing case must still
pass with identical assertions** — this is the proof the extraction didn't
change cookie sign-in behavior. No new cases added here; this file is the
regression fence for task 5 (the `signIn()` extraction).

## 4. `server/src/__tests__/routes-device-sessions.test.ts` (new)

| Case | Asserts |
|---|---|
| Sign-in success | `201`, body has `token` (matches `mds_` shape) + `user` + `profiles`; no `Set-Cookie` header on the response |
| Wrong password | `401 INVALID_CREDENTIALS` |
| Unknown email | `401 INVALID_CREDENTIALS`, identical body to wrong-password case |
| Lockout | 5 failures → 6th gives `401` even with the right password; matches the portal's lockout window |
| No `Origin` header at all | sign-in still succeeds — **proves the CSRF exemption is real, not an untested assumption** (AC-adjacent: native apps send no Origin) |
| IP rate limit | hammering the route past `ipPerMinute` → `429 RATE_LIMITED` with `Retry-After`, same as the portal route |
| Sign-out | `DELETE /v1/device-sessions/current` with a valid token → `204`; the same token on any subsequent request → `403`/`401` `SESSION_EXPIRED` |
| Sign-out without a valid token | `401 UNAUTHENTICATED` (no credential) or `PRINCIPAL_NOT_ACCEPTED` if an API key is presented instead |
| Validation | missing `email`/`password` → `422` |

## 5. `server/src/auth/__tests__/middleware.test.ts` (new)

| Case | Asserts | AC |
|---|---|---|
| Device bearer on a `deviceSession`-accepting route | succeeds, `auth.kind === 'session'`, scopes equal `sessionScopes()` | "gets exactly the portal session's access" |
| Device bearer on an `apiKey`-only route | `403 PRINCIPAL_NOT_ACCEPTED` | parity with a cookie session's existing refusal |
| Unknown/garbage `mds_...` token (right shape, no matching digest) | `403`/`401` `SESSION_EXPIRED` | — |
| Expired device session (`now` past `absoluteExpiresAt`) | `SESSION_EXPIRED` | device lifetime enforcement |
| Revoked device session | `SESSION_EXPIRED` | revocation works |
| Device bearer **and** a cookie together | `401 UNAUTHENTICATED` `ambiguous_credentials` | AC: "bearer token and a session cookie... refused as ambiguous" — explicitly with a *device* bearer, not only an API key, since the first draft only implied this would work |
| A device-session token string run through `parseApiKey()` | returns `null` (fails the API-key regex) | AC: "each prefix is rejected by the other's verifier" |
| An API key string run through `isDeviceSessionToken()` | returns `false` | same AC, other direction |
| Missing `X-Mutaba3a-Profile` on an org-scoped route with a device bearer | `422 VALIDATION_FAILED PROFILE_REQUIRED` — same as cookie sessions today | parity |
| `X-Mutaba3a-Profile` naming a non-member org, with a device bearer | `404 NOT_FOUND` | parity, no information leak about other orgs |

## 6. `server/src/__tests__/route-security.test.ts` (extend)

Add a `deviceToken` alongside the existing `sessionCookie` in `beforeAll` (sign
in via `POST /v1/device-sessions`). Then:

| Case | Asserts |
|---|---|
| `operations.filter(op => accepts(op, 'deviceSession'))` | sorts to **exactly** `SESSION_OPERATIONS` (the same list cookie sessions accept) — proves full parity across the real route table, not just the two example routes from the AC |
| Device bearer let through every operation that declares it | mirrors "a session is let through on every operation that declares it," using `Authorization: Bearer <deviceToken>` instead of the cookie — zero `401`/`403` on any `deviceSession`-accepting op |
| Device bearer refused on every session-only-excluded op | mirrors "an API key is refused on every session-only operation" — actually the inverse check: confirm an API key is still refused on every `deviceSession`-only-or-session-only op with the *same* shape as before (no regression from adding the third scheme name) |
| A device bearer on every key-only operation | `403` — `READ_ONLY_PROFILE` where the matrix says Malafat writes that domain, `PRINCIPAL_NOT_ACCEPTED` elsewhere — identical shape to the existing cookie-session assertion, proving the refusal logic really is principal-based, not cookie-specific |

## 7. `server/src/repositories/__tests__/store-contract-sessions.ts` (extend)

Runs against both `MemoryLedgerStore` and the Prisma-backed store (per this
file's existing shared-contract pattern):

| Case | Asserts |
|---|---|
| `create` with `kind: 'device'` | `findByDigest` round-trips the same `kind` |
| `create` with `kind: 'cookie'` | same, for the existing path (regression) |
| `revokeAllForUser` with one cookie + one device session for the same user | both come back revoked (`revokedAt` set) after one call, count is `2` — proves AC #5 at the repository layer |
| `revokeAllForUser` for a different user | neither of the above two sessions is touched |

## 8. Admin flow tests (extend wherever `admin-users.ts` is covered — likely `server/src/__tests__/routes-users.test.ts`)

For each of the three admin actions, in its own test:

| Action | Setup | Asserts |
|---|---|---|
| `POST /admin/v1/users/{id}/password` | user has one live cookie session + one live device session | both are rejected (`SESSION_EXPIRED`) on their next use; the response still returns the new `initialPassword` as today |
| `POST /admin/v1/users/{id}/disable` | same | both rejected afterward; re-`enable` does **not** restore them (revocation is one-way, matching today's cookie-only behavior) |
| `POST /admin/v1/users/{id}/sessions/revoke` | same | returns `{ revoked: 2 }` (not `1`) — the count now reflects both kinds; both rejected afterward |

## 9. `server/src/__tests__/no-self-registration.test.ts` (run, no new cases expected)

Run as-is after the new routes exist. Confirms `device-sessions` doesn't trip
the `sign-?up|register|invite|forgot|reset` regex in either the router or the
published OpenAPI doc. A failure here would mean the route naming needs to
change, not the test.

## 10. `server/src/__tests__/no-self-registration.test.ts` sibling check: OpenAPI contract

| Case | Asserts |
|---|---|
| `npm run openapi:check` | exits 0 — the committed `openapi.yaml` matches what `createApp()` actually serves after all the route/scheme changes |
| `npm run hosted:types` (root) regenerates `src/hosted/api/schema.d.ts` with no manual edits needed | the portal's existing TS program still compiles against the new types (no breaking change to existing fields, only additions) |

## Coverage map back to the ticket's acceptance criteria

| AC | Covered by |
|---|---|
| Sign in with email+password, same throttle/lockout | §4 (routes-device-sessions), §2 (signIn unit) |
| Device token can CRUD expenses, API key cannot | §6 (route-security parity assertion covers all 13 files including expenses); a focused expense-specific case is also worth adding directly in whatever file already covers expense CRUD (`routes-expenses.test.ts`), swapping the cookie for a device bearer in one existing success-path test, per "every behavior tested, no test without a regression it would catch" — not a new file, one parametrized case |
| Bearer + cookie refused as ambiguous | §5 |
| Sign-out revokes, next request rejected | §4 |
| `revokeAllForUser` + password change revoke device sessions | §7 (repo layer), §8 (route layer) |
| Prefixes never cross-verify | §5, §1 |
| `no-self-registration` test still passes | §9 |
| ADR-037 amendment | not a test — a documentation deliverable (task 10 in the build plan) |
