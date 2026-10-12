# MUT-64 — Native app sign-in: a revocable device session for hosted accounts

**Epic**: MUT-63 (Mutaba3a Capture). **Blocks**: MUT-67 (app shell).
**Extends**: ADR-037 (Hosted Users and Sessions). **Status**: approved (2026-10-12).

## Problem

Hosted sign-in only works from the portal's own origin: `POST /v1/sessions` sets
an `HttpOnly`/`SameSite=Strict` cookie and refuses non-same-origin requests;
`Authorization: Bearer` means *API key* only, and keys can't touch expenses
(`apiKey: 'none'` in the writability matrix). A native iOS app can't hold a
portal cookie, so it can't sign in at all today.

## Proposed solution

A **device session**: the same human principal as a portal session, carried as
a bearer token instead of a cookie. It reuses the existing `sessions` table,
password hasher, sign-in throttle, and writability matrix almost unchanged —
this is a second *transport* for the same session principal, not a new auth
system. See the "Why not Firebase/a new auth system" note at the end — the
owner confirmed staying on the existing custom auth (2026-10-12).

### Token shape and dispatch

```
mds_<43-char base64url secret>      (device session — new)
mut_<live|test>_<prefix>_<secret>   (API key — unchanged)
```

`mds_` is visually and structurally distinct from `mut_` so `authenticate()`
routes a bearer token by its prefix — no "try as key, fall back to session"
guessing (closes AC: "each prefix is rejected by the other's verifier").
`generateDeviceSessionToken()` (new, in `auth/sessions.ts`) mirrors
`generateSessionToken()`: 32 random bytes, base64url, prefixed `mds_`.
`isDeviceSessionToken(token)` is a `token.startsWith('mds_')` check.

The token is hashed with the **same** `sessionDigest(pepper, token)` HMAC and
the **same** `SESSION_TOKEN_PEPPER` as cookie sessions, so pepper rotation
signs out every device too, consistent with ADR-037 decision 3.

### Storage: one `sessions` table, not two

`SessionRecord` gains a `kind: 'cookie' | 'device'` column. Reusing the table
(rather than a parallel `deviceSessions` table) means `revokeAllForUser` —
already called from `/admin/v1/users/{id}/password`,
`/admin/v1/users/{id}/disable`, and `/admin/v1/users/{id}/sessions/revoke` —
revokes device sessions too, with **zero changes to `admin-users.ts`**. This
directly satisfies AC: "revokeAllForUser and a password change revoke every
device session for that user."

Cookie and device sessions get different lifetimes, since the ticket's own
proposal is "a long idle window... absolute expiry with re-auth" (capture
happens days apart). Proposed concrete values — flagging for override:

| | idle | absolute |
|---|---|---|
| cookie (existing) | 120 min | 12 h |
| device (new) | **30 days** | **180 days** |

Rationale: 30-day idle comfortably outlasts "logged an expense last week,
again this week"; a 6-month absolute cap still forces periodic re-auth
without nagging an app used sporadically. `SessionSettings` gains
`deviceIdleDays`/`deviceAbsoluteDays`; `authenticateDeviceSessionToken`
computes expiry from these instead of the cookie pair.

### Principal and writability: unchanged, reused exactly

`Principal` stays `'apiKey' | 'session'` — no third literal. A device-session
token produces a `SessionAuth` (`kind: 'session'`) exactly like a cookie
session: same `selectProfile`/`X-Mutaba3a-Profile` header requirement, same
`sessionScopes()`, same `profileWriterOf`, same `principalStoreGuard('session',
...)`. `writability.ts` and `store-guard.ts` need **no changes** — both were
confirmed principal-agnostic (they key off the `'session'` string, not off how
the session was authenticated). This is what makes "exactly the portal
session's access (including expenses), never an API key's" true for free.

### CSRF: naturally exempt

`isSameOriginRequest`/`SAFE_METHODS` same-origin enforcement lives only inside
`authenticate()`'s cookie branch. The bearer branch (API key today, device
session now) never runs that check — a native app has no comparable
`Origin`/`Sec-Fetch-Site` signal to check against. No change needed here;
confirmed by reading the current `authenticate()` structure.

### Scope of reach: broad, matching the ADR's own wording (owner decision 2026-10-12)

The ADR text says a device session "gets exactly the portal session's access
(including expenses)" — not "access to expenses and `GET /v1/me` only". Since
`Principal` is unified, this is true at **runtime** automatically, for every
route that already accepts `{ session: [] }` (13 route files, ~22 security
declarations: customers, projects, payments, receivables, agreements,
attachments, summaries, retainers, vat, fee-proposals, plus sessions/
expenses/expense-categories). To avoid a documented-vs-actual mismatch, the
OpenAPI `security` array for **every** such route adds `{ deviceSession: [] }`
as an alternative to `{ session: [] }`, not just the explicitly-named
`GET /v1/me` and expense routes. This is a mechanical, low-risk change (same
one-line pattern repeated) and keeps the committed OpenAPI contract accurate
for Malafat's vendored parser and anyone reading the spec.

A new `deviceSession` security scheme is registered alongside `apiKey` and
`session` in `app.ts`:

```ts
app.openAPIRegistry.registerComponent('securitySchemes', 'deviceSession', {
  type: 'http',
  scheme: 'bearer',
  description:
    'Native-app device session (MUT-64): Authorization: Bearer mds_<secret>. ' +
    'Same session principal and writability as the portal cookie session. ' +
    'Organization-scoped calls add X-Mutaba3a-Profile: <organizationId>.',
});
```

## New routes

### A shared sign-in core, not a copy (revised after self-review)

The first draft of this plan had the new route "mirror" `routes/sessions.ts` —
i.e. copy-paste the credential-verification flow and adjust it. That flow is
the single highest-risk piece of logic in this ticket (password verify,
dummy-hash timing to avoid account enumeration, throttle/lockout, audit) and
the project's own stated preference is "shared code: require common behavior,
not just similar-looking code" — this *is* common behavior, byte-for-byte,
not a coincidence. So it's extracted once instead of duplicated:

`server/src/auth/sign-in.ts` (new):

```ts
export interface SignInResult { user: UserRecord; token: string; session: SessionRecord }
export interface SignInDeps { store: LedgerStore; passwordHasher: PasswordHasher; throttle: SignInThrottle; }

export async function signIn(
  c: Context<AppEnv>,
  deps: SignInDeps,
  credentials: { email: string; password: string },
  sessionKind: SessionKind,
  lifetime: { idleMs: number; absoluteMs: number },
): Promise<SignInResult> // throws INVALID_CREDENTIALS, same as today
```

Encapsulates: `normalizeEmail`, the dummy-hash timing guard, throttle/lockout
check, `recordFailedSignIn`/`recordSignIn`, token generation (the caller
passes which generator — `generateSessionToken` or
`generateDeviceSessionToken` — since that's the one real difference),
`store.sessions.create(..., kind: sessionKind)`, and
`auditToMembers(c, user, action, { sessionKind })` (see audit metadata note
below). Both route files call this and then do their own
transport-specific finish: `routes/sessions.ts` sets the cookie;
`routes/device-sessions.ts` returns the token in the body. Rate-limiting
(`ipLimiter.check`) and the CSRF/`isSameOriginRequest` gate stay in each
route file, since one applies to both routes and the other to neither —
they're not shared behavior, so they don't move into the shared function.

`routes/sessions.ts` is refactored to call `signIn()` too (not left as the
"original" with the new route copying it) — existing
`sessions.test.ts`/`routes-sessions.test.ts` must still pass unchanged after
this refactor, which is the proof the extraction preserved behavior exactly.

### Routes

`server/src/routes/device-sessions.ts` (new file):

- **`POST /v1/device-sessions`** — public (`security: []`). Body
  `{ email, password }` (reuse `SignInRequestSchema`). Calls `signIn()` with
  `sessionKind: 'device'` and the device idle/absolute durations — **no**
  `isSameOriginRequest` CSRF gate (native apps don't send that signal; this
  route never calls it, by construction, not by omission). Returns the raw
  token in the JSON body instead of `Set-Cookie`: `{ token, user, profiles }`
  (`DeviceSessionSchema = MeSchema.extend({ token: z.string() })`). Error
  codes: `INVALID_CREDENTIALS` (401), `RATE_LIMITED` (429), `422` validation —
  no `CROSS_SITE_REQUEST`.
- **`DELETE /v1/device-sessions/current`** — `security: [{ deviceSession: [] }]`.
  Added to `ORGANIZATION_INDEPENDENT_ROUTES` (acts on the person, not an
  organization) alongside `GET /v1/me` and `DELETE /v1/sessions/current`.
  Revokes `c.get('identity').session.id` with reason `'signed_out'`, returns
  `204`. No cookie to clear.

### Audit metadata: distinguish the channel (self-review finding)

`AuditEventInput` already has an optional `metadata?: Record<string, unknown>`
field that today's `auditToMembers` never uses. Both sign-in routes now stamp
`metadata: { sessionKind }` on the `user.signed_in`/`user.locked_out` audit
rows — free (existing field, no schema change), and the only way an operator
investigating a suspected-compromised device token can tell "this sign-in was
the portal" from "this sign-in was the app" in the audit log. `auditToMembers`
moves alongside `signIn()` in `auth/sign-in.ts` (or stays a small per-route
wrapper that forwards `sessionKind` into `metadata` — exact placement is an
implementation detail) and gains the one parameter.

Both route names avoid the `no-self-registration.test.ts` forbidden regex
(`sign-?up|register|invite|forgot|reset`) — confirmed, "device-sessions" is
clean.

Wired into `app.ts` next to the existing `sessionRoutes(...)` registration:
`app.route('/', deviceSessionRoutes({ store, passwordHasher, settings: sessions, throttle: ..., ipLimiter: ... }))`.
Reuses the same `passwordHasher`/`SignInThrottle`/`ipLimiter` instances
already constructed for `sessionRoutes` — one throttle counter per email
either way, which is correct (a locked-out account should be locked out from
both surfaces).

## Middleware changes (`server/src/auth/middleware.ts`)

1. **`buildRouteAccessIndex`**: add
   `if ('deviceSession' in requirement) principals.add('session')` — a device
   session is the `'session'` `Principal` for every downstream check; only the
   OpenAPI scheme name is new, not the enforcement vocabulary.
2. **`authenticate()`**, the `if (bearer)` branch: dispatch on token shape
   before assuming API key:
   ```ts
   if (bearer) {
     if (isDeviceSessionToken(bearer)) {
       const identity = await authenticateDeviceSessionToken(c, bearer, options);
       return finishSessionAuth(c, identity, access, options); // shared tail, see below
     }
     const auth = await authenticateApiKey(c, bearer, options);
     if (access && !access.principals.has('apiKey')) throw principalNotAccepted();
     c.set('auth', auth);
     c.set('storeGuard', principalStoreGuard('apiKey', null));
     return next();
   }
   if (cookie) {
     const identity = await authenticateSession(c, cookie, options);
     return finishSessionAuth(c, identity, access, options);
   }
   ```
   `finishSessionAuth` is a **new shared helper** extracted from the cookie
   branch's existing tail (the `if (access && !access.principals.has('session'))`
   / CSRF / `organizationIndependent` / `selectProfile` / `c.set(...)` logic),
   parameterized so the CSRF check only runs when the identity came from a
   cookie (pass a flag or keep the CSRF check inline in the cookie branch and
   have `finishSessionAuth` start just after it — exact split decided during
   implementation, not architecturally significant either way). This avoids
   duplicating ~15 lines for the new bearer-device path.
3. **New function `authenticateDeviceSessionToken`**: parallels
   `authenticateSession` (digest lookup, revoked/expired/user-status checks,
   rate limit, touch) but reads `bearer` instead of a cookie and uses
   `settings.deviceIdleDays`/`deviceAbsoluteDays` for the touch/expiry math
   instead of `idleMinutes`/`absoluteHours`. The two functions share enough
   logic (expiry check, user validity check, touch) that factoring a common
   `validateSession(session, now, settings) -> SessionIdentity | throws`
   helper is worth doing here rather than copy-pasting — both call it with
   their own digest lookup and their own idle-window parameters.
4. `SessionSettings` interface gains `deviceIdleDays: number;
   deviceAbsoluteDays: number;` — set in `defaultSessionSettings()`
   (config.ts) to the proposed 30/180 values (env-overridable like the
   existing cookie settings, per CLAUDE.md's "never hardcode env-specific
   values").

## Data layer

- **`server/src/repositories/ports.ts`**: `SessionRecord` and
  `CreateSessionInput` gain `kind: 'cookie' | 'device'`. Export the
  `SessionKind` type from `auth/sessions.ts` (not `ports.ts`, to keep the
  auth-domain type next to where it's produced) and import it into `ports.ts`.
- **`server/src/repositories/memory.ts`**: `sessions.create`'s record literal
  adds `kind: input.kind`.
- **`server/src/routes/sessions.ts`**: its existing `store.sessions.create({...})`
  call must add `kind: 'cookie'` once `kind` is on `CreateSessionInput` —
  named explicitly here since it's an edit to *existing* behavior, not just
  new code, and easy to miss in a diff that's mostly additions. (TypeScript
  would refuse to compile without it, but naming it keeps the file list
  honest.) This call site mostly goes away once the `signIn()` extraction
  above lands — `kind: 'cookie'` becomes an argument to `signIn()` instead.
- **`server/src/repositories/prisma.ts`**: same field threaded through;
  **new Prisma migration** `prisma/migrations/<ts>_mut64_device_sessions/`
  adding `kind` to the `sessions` table
  (`ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'cookie'`,
  then drop the default per the project's usual tightening-migration pattern,
  matching `20261011042708_mut38_sessions_user_actor`'s shape). Add
  `@@index([userId, kind])` only if a query needs it — none currently does, so
  skip it (YAGNI; `revokeAllForUser` already scans by `userId` alone).
- **`server/src/repositories/__tests__/store-contract-sessions.ts`**: extend
  to assert `kind` round-trips through `create`/`findByDigest`, and that
  `revokeAllForUser` revokes both a `'cookie'` and a `'device'` session for
  the same user in one call (proves AC #5 at the repository layer, beneath
  the route layer).

## OpenAPI / schema.d.ts

- `app.ts`: register the `deviceSession` security scheme (above).
- Thirteen route files get `{ deviceSession: [] }` added to their existing
  `{ session: [] }` requirement(s) — see "Scope of reach" above for the exact
  list. Where a file already factors a shared constant (`expenses.ts`'s and
  `expense-categories.ts`'s `SESSION_ONLY`), it's a one-line edit; where
  `security: [...]` is inlined per route (`summaries.ts` ×3, `customers.ts`
  ×2, etc.), each inline array gets the one addition.
- `npm run openapi:generate` (regenerates `server/openapi/openapi.yaml`) and
  root `npm run hosted:types` (regenerates `src/hosted/api/schema.d.ts`) both
  run as part of the build — both are AC items, not optional follow-ups.
- `npm run openapi:check` (CI gate) must pass, proving the committed YAML
  matches what the app actually serves.
- **Verify Malafat's vendored contract tolerates the new scheme.** ADR-037
  decision 9 set the precedent: when the audit actor enum changed, "Malafat's
  vendored contract is refreshed, and its parser confirmed tolerant, before
  any session can write an audit row." A new `deviceSession` security scheme
  is a pure addition (no existing scheme changes shape) and Malafat only ever
  uses `apiKey`, so this is very likely a non-event — but confirm by the same
  process (refresh the vendored envelope, check the parser doesn't choke on
  an unrecognized scheme name) rather than assuming.

## Tests (written first — "Auth change: tests come first")

- **`server/src/auth/__tests__/sessions.test.ts`** (extend): token shape
  (`mds_` prefix, length), `isDeviceSessionToken()` true/false table,
  `sessionDigest` reused identically for both token kinds.
- **`server/src/auth/__tests__/middleware.test.ts`** (new — none exists
  today; writability/route-security assertions currently live at the
  top-level `__tests__`, this is unit-level for the dispatch logic itself):
  - a well-formed `mds_...` bearer with no matching session digest →
    `SESSION_EXPIRED` (reuse the existing code for "presented but invalid",
    consistent with the cookie path rather than inventing a new code — the
    AC's "gets UNAUTHENTICATED" is read as "a 401-class rejection", matching
    existing convention; flagged below as a decision to confirm).
  - a device-session bearer + a cookie together → `UNAUTHENTICATED`
    `ambiguous_credentials` (same branch as today, just confirming a device
    token hits it too, not only an API key).
  - a device-session token string fails `parseApiKey()` and an API key string
    fails `isDeviceSessionToken()` — the literal "each prefix is rejected by
    the other's verifier" AC, as a direct unit test.
- **`server/src/__tests__/routes-device-sessions.test.ts`** (new, mirrors
  `routes-sessions.test.ts`): sign-in success returns a token + profiles;
  wrong password / unknown email both give identical `INVALID_CREDENTIALS`
  timing-matched; lockout after 5 failures; sign-out revokes (next request
  with the same token is refused); **no** `CROSS_SITE_REQUEST` is ever thrown
  from this route even without an `Origin` header (proving the CSRF exemption
  is intentional, not accidentally-passing).
- **`server/src/__tests__/route-security.test.ts`** (extend — this file's
  generated-from-the-published-doc design makes this almost free):
  - sign in once more in `beforeAll` via `POST /v1/device-sessions` to get a
    `deviceToken` alongside the existing `sessionCookie`.
  - `SESSION_OPERATIONS`'s list is unchanged in content (it already
    enumerates every session-accepting operation); add a parallel assertion
    that `operations.filter(op => accepts(op, 'deviceSession'))` sorts to the
    **same** list — proving every route that accepts the cookie also accepts
    the device token, nothing more, nothing less.
  - mirror "a session is let through on every operation that declares it"
    using `{ authorization: 'Bearer ' + deviceToken, 'x-mutaba3a-profile': orgId }`
    instead of the cookie header — proves full parity end to end against the
    real route table, not just the two ACs' example routes.
  - mirror "an API key is refused on every session-only operation" with the
    device token swapped in for the cookie, confirming `PRINCIPAL_NOT_ACCEPTED`
    shape is identical.
- **Admin flow tests** (extend wherever `admin-users.ts` is covered today):
  create a device session for a user, then exercise
  `/admin/v1/users/{id}/password`, `/disable`, and `/sessions/revoke` in turn,
  asserting the device session's token is rejected (`SESSION_EXPIRED`)
  afterward each time — proves AC #5 end-to-end through the real admin routes,
  not just the repository contract test.
- **`server/src/__tests__/no-self-registration.test.ts`**: no code change
  expected; run it to confirm the new route names don't trip the forbidden
  regex (they shouldn't — pre-verified by inspection above).

## Reuse analysis (CLAUDE.md component-registry rule)

Nothing new is invented where an existing piece does the job:

| Need | Reused from |
|---|---|
| Password verify, dummy-hash timing | `auth/users.ts` `PasswordHasher`, unchanged |
| Throttle/lockout | `auth/sessions.ts` `SignInThrottle`, same instance |
| Token hashing | `auth/sessions.ts` `sessionDigest`, same pepper |
| Revocation, admin "sign out everywhere" | `sessions` repository + existing admin routes, **unmodified** |
| Writability / scopes | `auth/writability.ts` `sessionScopes()`/`matrixRow`, **unmodified** |
| Store guard | `auth/store-guard.ts` `principalStoreGuard('session', ...)`, **unmodified** |
| `/v1/me` payload shape | `routes/sessions.ts` `buildMe()`, reused verbatim |

The only genuinely new code is: the token generator/prefix check, the two new
routes, the `kind` column + its threading through the two store
implementations, the middleware dispatch fork, and the `deviceSession`
OpenAPI scheme + its addition to 13 security arrays.

## Impact analysis

- **Blast radius**: 13 route files get a one-line-per-declaration addition
  (mechanical, reviewed easily by diff); 2 new route files; `middleware.ts`
  gets a real but contained refactor (shared tail extraction); `sessions.ts`
  (auth) gets 2 new small functions; `ports.ts`/`memory.ts`/`prisma.ts` get a
  one-field addition each; one new Prisma migration.
- **No change** to: `writability.ts`, `store-guard.ts`, `scopes.ts`,
  `users.ts`, the cookie-session route/flow itself, the portal frontend,
  Terraform/infra, `max_instances = 1` constraint (still holds — throttle
  state stays in-process either way).
- **Flutter app**: confirmed greenfield — nothing in
  `mutaba3a-flutter/mutaba3a/lib` today talks to this hosted server at all
  (its existing "session"/pairing code is an unrelated LAN desktop-pairing
  protocol). This ticket only builds the server side; the app's sign-in
  screen and `Authorization: Bearer mds_...` client code is MUT-67's concern
  (the app shell this ticket blocks).
- **i18n/RTL**: none — backend-only, no new user-facing strings beyond
  existing error codes the client already has to handle.
- **Cost**: zero new infra; one more DB column; sign-in throughput unchanged
  (same argon2 cost, same rate limiter).

## Review notes (self-administered adversarial pass, 2026-10-12)

`/plan-eng-review`'s gstack wrapper pulled in a tool-upgrade prompt and
telemetry/brain-sync machinery unrelated to this ticket, so this plan was
instead pressure-tested directly against the project's own stated engineering
preferences (shared code over copy-paste, every behavior tested, explicit
over clever). Findings folded back in above:

- **Duplicated sign-in logic** → extracted `auth/sign-in.ts`'s `signIn()`,
  used by both routes; the existing cookie route is refactored to call it
  too, not left as the thing the new route copies.
- **A required edit to existing code was implicit, not named** → the cookie
  route's `sessions.create()` call needs `kind: 'cookie'`; now called out
  explicitly (and resolved automatically by the `signIn()` extraction).
- **Audit couldn't distinguish sign-in channel** → `metadata: { sessionKind }`
  added to both routes' audit rows, using an existing unused field.
- **Checked and found no issue (no plan change needed)**: token-in-response-body
  logging risk (same already-accepted pattern as `initialPassword`/API-key
  `secret` responses); replay/theft blast radius of a long-lived token (fully
  covered by existing revocation ACs — sign-out, admin revoke-all, password
  change); whether `writability.ts`/`store-guard.ts` need changes (confirmed
  principal-agnostic, no); whether the Prisma migration pattern is safe
  (matches existing `kind`-style additive-then-tighten precedent).
- **Flagged for the implementer to verify, not blocking**: Malafat's vendored
  OpenAPI parser tolerating the new `deviceSession` scheme (see OpenAPI
  section above).

## Decisions (confirmed 2026-10-12 — proceed with proposed defaults)

1. **Device session lifetime**: 30-day idle / 180-day absolute, as proposed.
2. **Expired/revoked device token's error code**: `SESSION_EXPIRED`, matching
   the existing cookie-session convention, as proposed.

## Business / product impact

This unblocks MUT-67 (the native app shell) and is the foundation of the
whole MUT-63 epic ("log income and expenses from your iPhone in seconds") —
without it, the capture app literally cannot authenticate a hosted user at
all. It reuses ~90% of the already-shipped ADR-037 auth investment rather
than opening a second auth system, so the incremental cost is low and the
risk surface (password handling, lockout, revocation) is proven code, not new
code. Shipping this is what lets product start the native-capture push the
epic exists for.

## Why not Firebase / a new auth system (recorded per owner's question, 2026-10-12)

Considered and rejected: ADR-037's accounts are deliberately operator-issued
only (no self-service signup/reset — enforced by a route-inventory test);
introducing Firebase either breaks that invariant or creates a second
"who is a user" store that has to stay in sync with the existing one. ADR-024
already pins firm financial data to `me-west1`; ADR-037's own alternatives
section rejected OAuth/SSO and cross-site-cookie approaches partly on
residency/reliability grounds — Firebase's global identity infrastructure
raises the same category of concern. The user base (operator-provisioned firm
partners) is small and doesn't need social login or self-service flows, so
Firebase's actual value proposition doesn't apply here. The owner confirmed
proceeding with the custom extension rather than opening a Firebase spike.
