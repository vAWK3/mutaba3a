# Hosted Mutaba3a — portal architecture, profile source model, writability matrix (design brief)

- **Date:** 2026-10-11 · **Status:** draft for owner review — gates MUT-37, MUT-38, MUT-39, MUT-42, MUT-43, MUT-44, MUT-45
- **Tickets:** MUT-36 (this brief + ADR-033) under epic MUT-34 · **Builds on:** ADR-024, ADR-025, ADR-026, MUT-35 (repository seam), M6 summaries, M8 overview IA (`money-v1-m8-overview-ia.md`, wireframe state 5)
- **Repo side:** Mutaba3a only. `server/` gains a user principal, sessions, an access join and one enforced matrix; the root package gains a third build target (`hosted`) beside `web` and `desktop`. **Malafat unchanged** except a vendored-contract refresh (§4.6).
- **Owner decisions this brief assumes (2026-10-10, epic MUT-34):** a profile has a source, `local` or `hosted`; neither syncs to the other; on a hosted profile income/receivables/payments are read-only and expenses are writable server-side; accounts are operator-issued only, no signup/invite/reset route in any environment; "sign in with Malafat" is not v1.

## 1. Problem and acceptance criteria

Money v1 has one principal: Malafat's organization API key. A firm partner who wants to see the firm's money on Mutaba3a has no door. Four forks block every build story: **what renders the hosted UI**, **how a profile's source is modelled**, **where the read-only boundary is enforced**, and **how a browser session coexists with API keys on the same routes**. This brief decides all four, and shows that none of the choices change anything for local profiles.

MUT-36 acceptance, and where each one is met:

- `.claude/designs/hosted-portal.md` exists in the house format → this file.
- Rendering decision with rejected alternatives and cost → §2.
- Writability matrix a test suite can be written from → §5 (machine-parseable block; MUT-39's drift test reads it).
- ADR extending ADR-025, stating ADR-013 is untouched and hosted profile data is a separate dataset → ADR-033 in `DECISIONS.md`.
- `TECH_DEBT.md` records that the sync op-log has no `profileId` awareness → TD-029.
- Concrete enough for `/eng-ticket` to plan the build stories → §4–§9, and the re-cuts in §10.

## 2. Rendering surface — decision: a hosted-only build target in this repo, served same-origin by the API

**Decision.** The portal is a **third Vite build target** (`--mode hosted` → `dist-hosted/`, entry `hosted.html` → `src/hosted/main.tsx`). It lives in the same repo and **reuses the design system**:

- **Reused as-is** (each checked to import nothing from `db`, `sync`, the stores or the local hooks): CSS variables and tokens, `Button`, `Badge`, `Card`, `EmptyState`, `SegmentedTabs`, `SearchInput`, `Pagination`, `Table.css`, `ThemeProvider`, `LanguageProvider`/`t()`/RTL.
- **Not reused:**
  - `KpiCard` reads `useFxRate` and formats minor-unit numbers.
  - `StatusSegment` is typed to the local `TxStatus` (paid/unpaid).
  - The portal's strip and status filter are built from `Card` and `SegmentedTabs` instead.

It has its own shell, routes and query hooks over a typed HTTP client. It **never imports `src/db`, `src/sync`, `AppShell`, `SidebarNav`, `TopBar` or any drawer**. The Mutaba3a server serves the built assets from the same origin as `/v1`.

**Why not repoint the existing app through the provider (the option MUT-35 prepared for).** The seam is real but the fit isn't:

1. **The domains don't map.** The local `IRepositoryProvider` has 20 slots shaped around `Transaction` (income/expense, paid/unpaid, a 1:1 `PaymentRecord`). The hosted ledger is agreements → installments → posted receivables ← allocations ← payments, with VAT net/gross, credits and reversals. The repository audit (§2.2) found none of these has a local equivalent. A hosted `transactions.list()` would have to invent `Transaction`s from receivables, and a payment allocated across three receivables has no truthful `PaymentRecord` form. Statuses are server-computed (M6: "the client never computes them"), while local statuses are derived in `dates.ts`. Mapping money between models is how wrong figures ship.
2. **Most of the surface would throw.** Of 20 slots, a hosted provider could honestly serve about 3 (clients, projects, expenses). The other 17 (documents, sequences, retainers, projected income, recurring rules, receipts, vendors, FX, settings…) would be stubs. `satisfies IRepositoryProvider` would then certify an object that fails at runtime, which is the opposite of what MUT-35's conformance check is for.
3. **The shell is Dexie-bound before React mounts.** `initDatabase()` runs in `main.tsx:125`, and `initializeSync()` runs in `AppShell`. The shell also mounts sync modals, the migration wizard, the demo seeder, the FX banner and ten local drawers. The hosted build would either open IndexedDB or need about 20 per-mount source gates.
4. **The registry can't swap in production.** `setRepositories()` throws when `import.meta.env.PROD`, and the synced decorators bind Dexie singletons at module load (TD-013's known gap). Per-profile switching between Dexie and HTTP would need a context layer that MUT-35 deliberately cut.

**Why not show in-browser local profiles inside the portal (one switcher, both kinds).** Local profiles at the hosted origin would live in that browser's IndexedDB, outside the sign-in. On a shared machine, signing out would leave them readable by the next person, so the sign-in would protect only half of what the switcher shows. It would also put Dexie, migrations and the op-log into a bundle whose job is to show server figures. The portal shows **hosted profiles only**. Its switcher states where local profiles are instead (§7.2). "A user holds both kinds at once" holds across surfaces: local profiles in the desktop/PWA app, hosted profiles in the portal.

**Why not a separate repository or package.** That would duplicate the design system, the i18n context and RTL CSS for no isolation gain. Isolation is enforced by import rules and bundle tests (§8), which a second repo would not make stronger.

**What MUT-35 still buys.** The local app keeps the compiler-checked seam for TD-013 (SQLite/Tauri) and for testability. In the portal, MUT-44's expense form may reuse the local expense *form component* (presentational) behind portal-owned hooks. The repository registry is not the portal's data path. TD-013's "upgrade when MUT-43 lands" note is re-homed to TD-013 itself (§11).

**Cost.**

| | Hosted build target (chosen) | Repoint existing app |
|---|---|---|
| Runtime cost | $0 extra. Static assets served by the existing Cloud Run instance (min 1, 512 Mi); no bucket, CDN or second service | Same |
| Build | One more `vite build --mode hosted`, run by `server/scripts/deploy.sh` before `docker build` (MUT-45) | Same |
| Code | New: `src/hosted/` (shell, about 7 routes, about 8 query hooks, typed client) and one decimal-amount component | ~17 throwing slots or a hosted model squeezed into `Transaction`; per-mount gating in `AppShell`/`SidebarNav`/`TopBar`; a context layer for per-profile repos; Dexie still initialised |
| Risk | Visual drift between portal and app, contained by shared tokens and components | Wrong money figures from lossy mapping; local-app regressions from gating edits |
| Local-app blast radius | Zero source changes outside new files, the Vite config and the i18n files (§8) | Edits across shell, hooks and registry |

## 3. Profile source model

- **`ProfileSource = 'local' | 'hosted'`** is a property of a profile as a *client* sees it, not a server table.
  - **`local`**: a Dexie `BusinessProfile` on a device. The server never receives it. Nothing in this epic changes its type, table, schema version or sync.
  - **`hosted`**: an `Organization` the signed-in user has a `Membership` in.
- **The server has no `Profile` table.** "Hosted profile" is a projection `Membership × Organization` (+ `Integration` for the writer of record). One organization is one hosted profile, matching MUT-39 ("a hosted profile binds the Organization that Malafat feeds"). A table would add a second id for the same thing.
- **Hosted profile data is a separate dataset from local profile data.** They share no ids or tables. No hosted row is written to Dexie, no op enters the op-log, and the portal opens no IndexedDB. There is nothing to merge, so there is nothing to sync (ADR-013 untouched).
- **Personal vs firm needs nothing new.** A personal hosted profile is an operator-provisioned organization with no Malafat integration and the user as its only member. Its income views are empty (nothing writes them), and its expenses work like any hosted profile's (MUT-42/44).

### 3.1 Server models (MUT-37 builds them)

| Model | Fields | Notes |
|---|---|---|
| `User` | `id uuid`, `email` (unique, stored lower-cased and NFKC-normalised), `displayName`, `passwordHash` (argon2id PHC string), `locale 'en'\|'ar'`, `status ACTIVE\|DISABLED`, `failedSignIns int`, `lockedUntil?`, `passwordChangedAt`, `lastSignInAt?`, `createdAt`, `updatedAt` | Not organization-scoped: one person can belong to several firms. No self-service field exists. |
| `Membership` | `userId`, `organizationId`, `createdAt`; PK `(userId, organizationId)` | Access/no-access only. Roles and per-user permissions are out (MUT-39). |
| `Session` | `id uuid`, `userId`, `tokenDigest` (unique, HMAC-SHA256 hex), `createdAt`, `lastSeenAt`, `idleExpiresAt`, `absoluteExpiresAt`, `revokedAt?`, `revokedReason?`, `userAgent?` (truncated 200) | The token itself is never stored, logged or placed in a URL. Pruned 30 days after expiry by the existing `reconcile` run. |
| `AuditActorType` | gains `USER` (`actorId` = user id) | Published enum change (§4.6). |

Password hashing uses **argon2id via `@node-rs/argon2`** (prebuilt binaries, no compiler in the image), at OWASP's first profile: m = 19 MiB, t = 2, p = 1. Rejected: `crypto.scrypt` at OWASP strength needs 128 MiB per hash, which on a 512 Mi single instance makes concurrent sign-ins a memory risk; bcrypt truncates at 72 bytes.

### 3.2 Operator provisioning (MUT-37)

Admin routes behind the existing `X-Admin-Token`, plus `npm run` wrappers in the style of `provision.ts`:

- `POST /admin/v1/users`: `{ email, displayName, locale }` → `{ user, initialPassword }`. The password is 24 random base64url characters, printed once and delivered over a secure channel like an API-key secret.
- `POST /admin/v1/users/{id}/memberships`: `{ organizationId }` grants access; `DELETE …/memberships/{organizationId}` removes it.
- `POST /admin/v1/users/{id}/password`: operator reset; returns a new one-time password and revokes all the user's sessions.
- `POST /admin/v1/users/{id}/disable`: sets `DISABLED` and revokes all sessions.
- `POST /admin/v1/users/{id}/sessions/revoke`: revokes all sessions.

**No route anywhere** matches `signup|sign-up|register|invite|forgot|reset` outside `/admin/`. A route-inventory test walks the registered Hono routes and the OpenAPI document and fails on a match. The hosted bundle test (§8) asserts the same strings are absent from `dist-hosted`. A signed-in "change my password" route is out of v1 (§12): operator-generated passwords are stronger than chosen ones, and the reset path is the operator script.

## 4. Sessions and principals (MUT-38)

### 4.1 Transport — decision: httpOnly cookie, same-origin

- Cookie `__Host-mut_session`: `Secure; HttpOnly; SameSite=Strict; Path=/`, with no `Domain`. Development over plain HTTP uses `mut_session` without the prefix and without `Secure` (Safari refuses `Secure` on `http://localhost`); this is selected by `NODE_ENV=development` only.
- Token: 32 random bytes, base64url, set only by `POST /v1/sessions`. Stored as `HMAC-SHA256(SESSION_TOKEN_PEPPER, token)`. Comparison uses unique-index lookup, then `hashesMatch` (constant time), the same discipline as API keys.
- **Same origin is a requirement, not a convenience.** `__Host-` and `SameSite=Strict` only work if the page and the API share an origin. It also makes CORS unnecessary: the server keeps having none. MUT-45 therefore serves the portal from the API service (§9). Strict means a link from an email lands on the portal shell without the cookie. That is harmless: the shell is static, and its first `fetch` is same-origin, which sends the cookie.
- **CSRF:** `SameSite=Strict`, plus every non-`GET` session request must carry `Sec-Fetch-Site: same-origin` or an `Origin` equal to the configured portal origin (`PORTAL_ORIGIN`). Otherwise it gets `403 CROSS_SITE_REQUEST`. API-key requests are exempt (no ambient credential).

Rejected:
- Bearer tokens in `localStorage`: readable by any XSS, which makes one injected script a full account takeover.
- A BFF holding Malafat's key: the key carries all 14 scopes for the organization, and a BFF would make the portal's read-only promise depend on the BFF's discipline instead of the server's.
- A Netlify proxy in front of `/v1`: it would put privileged firm data through a non-`me-west1` edge (ADR-024 residency).
- A cross-site cookie (`SameSite=None`) with CORS: third-party cookie blocking makes it fail unpredictably per browser.

### 4.2 Expiry and revocation

- **Idle expiry:** `SESSION_IDLE_MINUTES`, default 120. Each authenticated request slides `idleExpiresAt`, and writes `lastSeenAt` at most once a minute.
- **Absolute expiry:** `SESSION_ABSOLUTE_HOURS`, default 12, with no extension.
- **Sign-out:** `DELETE /v1/sessions/current` sets `revokedAt`, then clears the cookie. A replayed cookie is refused because the record is revoked, not because the browser forgot it.
- **Global sign-out:** rotating `SESSION_TOKEN_PEPPER` (`terraform -replace`) invalidates every session at once. This is the reason the pepper exists, since random 256-bit tokens don't need one for secrecy.
- A disabled user, a lost membership or an operator password reset takes effect on the next request (no session cache). A lost membership answers 404 for that profile.

### 4.3 Sign-in

- `POST /v1/sessions` takes `{ email, password }`. It returns `201 { user, profiles }` (the `GET /v1/me` body) and sets the cookie.
- **Unknown email and wrong password are indistinguishable:** both answer `401 INVALID_CREDENTIALS`, with a body that names neither. An unknown email still runs one argon2 verify against a fixed dummy hash, so timing matches. A route test asserts equal status and body, and median-time parity within tolerance.
- **Throttle and lockout key on the normalised email string, whether or not an account exists.** Keying on the string means a locked unknown address behaves exactly like a locked real one, so lockout cannot enumerate accounts.
  - After 5 failures in 15 minutes, the address is refused for 15 minutes with the same `401 INVALID_CREDENTIALS`.
  - A per-IP window (20 per minute) answers `429 RATE_LIMITED`.
  - Both use the existing `SlidingWindowRateLimiter`, in process, which is valid at one instance (TD-017).
  - For a real account, the lock is also written to `User.lockedUntil`, so it survives a restart.
  - The audit event `user.locked_out` (actor `SYSTEM`) is appended to each organization the user is a member of. Partners see it in their audit, and AC "lockout observable in the audit log" is met.
  - Sign-in success appends `user.signed_in` (actor `USER`) the same way.
- A request carrying **both** an `Authorization` header and a session cookie is refused with `401 UNAUTHENTICATED` (`details.reason: 'ambiguous_credentials'`). Malafat's server never sends cookies, and the portal never sends `Authorization`.

### 4.4 Routes declare their principals in the contract

- **The `security` field of each `createRoute` is the declaration.** Accepted forms are `[{ apiKey: [] }]`, `[{ session: [] }]`, both (`[{ apiKey: [] }, { session: [] }]`, meaning either), or `[]` (public: `POST /v1/sessions`, `/health`, `/ready`, `/openapi.json`).
- **One `authenticate()` middleware replaces `app.use('/v1/*', apiKeyAuth(...))`.**
  - It resolves at most one principal: the API-key path runs the existing nine steps unchanged, then the session path.
  - It looks up the matched route's declared `security` and refuses a principal the route doesn't list.
  - The refusal is `403 PRINCIPAL_NOT_ACCEPTED`, except where §5 maps it to `READ_ONLY_PROFILE`.
- **Because enforcement reads the same object the spec is generated from, contract and behaviour cannot drift.** A test asserts that every `/v1` operation has a non-empty `security` or is on the public allowlist, and that every route calls `requireScope`. That closes today's opt-in gap (a route without `requireScope` is reachable by any key).
- **`AuthContext` becomes a discriminated union:**
  ```
  { kind: 'apiKey', organization, apiKey }
  | { kind: 'session', organization, user, session, profile: HostedProfile }
  ```
  - The 31 handlers that destructure `apiKey` move to an `actorOf(auth)` helper. It returns `{ actorType: 'API_KEY' | 'USER', actorId }` for audit rows and `uploadedBy*`.
  - `Integration.connectedByApiKeyId` stays key-only, because only key routes bind integrations.

### 4.5 Organization selection — ADR-025 §2 amended for sessions only

An API key still implies its organization, and no API-key request accepts an organization id. A session spans memberships, so **organization-scoped session requests carry `X-Mutaba3a-Profile: <organizationId>`**:

- The header is required on every organization-scoped route a session may call. It is checked against `Membership` on every request.
- Missing → `422 VALIDATION_FAILED` (`details.reason: 'profile_required'`).
- Not a member, unknown, or malformed → `404 NOT_FOUND`. This is the same answer as any cross-organization id today, and leaks nothing about other organizations.
- A header, not a path segment, keeps every overlapping `/v1` path identical for both principals, so the Malafat contract and route tests don't fork. Unlike a server-side "active profile", it is also stateless and safe with two tabs open.

### 4.6 Contract changes and the Malafat side

**New error codes:**

| Code | Status |
|---|---|
| `INVALID_CREDENTIALS` | 401 |
| `SESSION_EXPIRED` | 401 |
| `PRINCIPAL_NOT_ACCEPTED` | 403 |
| `READ_ONLY_PROFILE` | 403 |
| `CROSS_SITE_REQUEST` | 403 |

`AuditActorType` gains `USER`. The OpenAPI document gains the `session` security scheme (cookie). The API version takes a minor bump.

**Risk:** Malafat parses `GET /v1/audit` from a vendored contract. If its client validates `actorType` strictly, the first `USER` event would break Malafat's audit view. MUT-38's checklist refreshes Malafat's vendored contract and confirms its parser tolerates the new value **before** any session can write an audit row. Malafat's own code needs no other change.

### 4.7 Config (validated at startup, fail fast — `config.ts`)

| Variable | Rule | Source |
|---|---|---|
| `SESSION_TOKEN_PEPPER` | string, min 32 | Secret Manager, Terraform `random_password` (as `MUTABA3A_ADMIN_TOKEN`) — never a tfvars value |
| `SESSION_IDLE_MINUTES` | int 5–1440, default 120 | env |
| `SESSION_ABSOLUTE_HOURS` | int 1–168, default 12 | env |
| `PORTAL_ORIGIN` | URL, required when `NODE_ENV=production` | Terraform variable (MUT-45) |
| `PORTAL_DIST_DIR` | optional path; when unset the server serves no portal (API-only, as today) | Dockerfile |

## 5. Writability matrix

**One table is the source of truth.** It is mirrored as a `const` in `server/src/auth/writability.ts`. MUT-39's drift test parses the block between the markers below and fails if either side changes alone. Values are `read-write`, `read` and `none`. The local column is not enforced by the server (local profiles never reach it); it is here so the whole truth is in one place, and the drift test checks only that it reads `device` on every row.

<!-- writability-matrix:begin -->
| Domain | Scopes | Routes covered | Malafat API key | User session · hosted profile | Writer of record | Local profile |
|---|---|---|---|---|---|---|
| integration | integration:read, integration:write | /v1/integration*, /v1/api-keys/self/revoke | read-write | none | — | device |
| customers | customers:read, customers:write | /v1/customers*, /v1/import/* | read-write | read | MALAFAT | device |
| projects | projects:read, projects:write | /v1/projects*, /v1/import/* | read-write | read | MALAFAT | device |
| agreements | agreements:read, agreements:write | /v1/agreements*, /v1/installments/*, /v1/retainers* (except charges), /v1/fee-proposals*, /v1/vat-rates, /v1/settings/vat | read-write | read | MALAFAT | device |
| payments | payments:read, payments:write | /v1/receivables*, /v1/payments*, /v1/allocations/*, /v1/retainers/{id}/charges, /v1/operations/* | read-write | read | MALAFAT | device |
| attachments | attachments:read, attachments:write | /v1/attachments* | read-write | read | MALAFAT | device |
| summaries | summaries:read | /v1/summaries/* | read | read | — | device |
| audit | audit:read | /v1/audit | read | none | — | device |
| expenses | expenses:read, expenses:write | /v1/expenses* (MUT-42) | none | read-write | USER | device |
| identity | — | /v1/me, /v1/sessions/current | none | read-write | USER | device |
<!-- writability-matrix:end -->

How the table is enforced. Each layer reads the same `const`:

1. **Effective scopes.** A session's scope set is generated from its column: `read` grants `<domain>:read`, `read-write` grants both, `none` grants nothing. `requireScope` stays the per-route check.
   - When a session lacks a `:write` scope on a row whose writer of record is `MALAFAT`, the refusal is `403 READ_ONLY_PROFILE` with `details: { domain, writerOfRecord }`, not `INSUFFICIENT_SCOPE`. That gives the UI something to explain.
   - `writerOfRecord` is `'MALAFAT'` when the organization has a `CONNECTED` Malafat integration, otherwise `null`. This is the personal-profile case, where the UI says income isn't recorded on hosted profiles yet.
   - The error never names another organization.
2. **Principal declaration (§4.4).** Ledger write routes declare `security: [{ apiKey: [] }]`.
   - A session reaching one is mapped through the matrix to the same `READ_ONLY_PROFILE`.
   - Expense routes declare `[{ session: [] }]`, so Malafat's key cannot reach them with any scope set. That covers MUT-39's AC "Malafat's API key cannot see, read or write hosted-profile expenses", and it holds independently of scopes.
3. **Store guard: below the routes, so no route can opt out.**
   - Handlers today close over one `LedgerStore` singleton. They move to a per-request `c.var.store`. For a session principal, that store is `guardStore(store, matrix, principal)`.
   - The guard is a typed wrapper whose method classification is a **compiler-exhaustive map** over `LedgerStore`:
     ```
     { [R in keyof LedgerStore]: { [M in keyof LedgerStore[R]]: { domain, verb } } }
     ```
   - A new store method therefore cannot compile until it is classified. A `write` call whose domain the session column doesn't grant throws `READ_ONLY_PROFILE`, even if a future route forgot layers 1 and 2.
   - The map is a mechanical, one-time edit (route factories stop taking `store`).

**Lazy posting is a system act.** `GET /v1/summaries/*`, `GET /v1/receivables`, `GET /v1/agreements*` and `GET /v1/retainers/{id}/charges` post due installments and charges before reading (`postDueItems` / `generateCharges`). For an API key, nothing changes: the posting is still audited under the caller's key. For a session, the posting runs against the **unguarded system store, with actor `SYSTEM`**. It is the same deterministic catch-up `npm run reconcile` performs, so a session read must not be refused for it, and must not be recorded as the user writing the ledger. Without it, the portal would show figures behind Malafat's by up to a day.

Tests generated from the table (MUT-39):
- One route test per (row × principal × verb), driven by a `describe.each` over the parsed table. `read` → 200 on a list route; `none` → 403/404; a session write on a `MALAFAT` row → `403 READ_ONLY_PROFILE` naming the domain. This includes the AC's income, receivable and payment cases: agreements and installments, credits, and payments.
- A guard test per classified store method.
- The drift test.
- A test that a session read of each `R*` route writes audit rows with actor `SYSTEM` and none with `USER`.

## 6. Session API the portal consumes (MUT-38/39)

| Method & path | Security | Notes |
|---|---|---|
| `POST /v1/sessions` | public | `{ email, password }` → `201 Me` + cookie; `401 INVALID_CREDENTIALS`; `429 RATE_LIMITED` |
| `DELETE /v1/sessions/current` | session | `204`; revokes server-side, clears cookie. Not organization-scoped (no profile header) |
| `GET /v1/me` | session | `Me = { user: { id, email, displayName, locale }, profiles: HostedProfile[] }`. Not organization-scoped |
| every `read` row of §5 | apiKey + session | unchanged paths; sessions add `X-Mutaba3a-Profile` |

`HostedProfile = { id, name, source: 'hosted', defaultCurrency, timezone, writerOfRecord: 'MALAFAT' | null, access: Record<Domain, 'read' | 'read-write' | 'none'> }`. `id` is the organization id. `access` is the session column of §5, resolved for this organization, so the UI never hard-codes which views are read-only. `source` has one value on the wire; it exists so the client's `ProfileSource` union is explicit, and a test pins that the server never emits `local`.

## 7. The portal (MUT-43, MUT-44)

### 7.1 Shell, routes, state

- **`HostedShell`:** a sidebar with Overview, Clients, Receivables, Payments and Documents (plus Expenses from MUT-44), the profile switcher, the user menu (name, language, sign out), and the page. No `TopBar` "+ Add" menu: the only create action in the portal is MUT-44's expense drawer.
- **Routes** (TanStack Router, code-based like `src/router.tsx`; base `/`):
  - `/sign-in`
  - `/` (redirects to the first profile)
  - `/p/$profileId/` (overview)
  - `…/clients` and `…/clients/$customerId`
  - `…/receivables`
  - `…/payments`
  - `…/documents`
  - `…/expenses` (MUT-44)
- **The active hosted profile is in the URL** (`/p/$profileId`). It is deep-linkable and safe across tabs. The typed client copies it into `X-Mutaba3a-Profile`. Nothing is persisted to `localStorage` except the language.
- **Auth guard:** a root `beforeLoad` resolves `GET /v1/me` through TanStack Query.
  - A 401 redirects to `/sign-in?next=<path>`. `next` is validated as a same-origin relative path.
  - A `$profileId` not in `me.profiles` renders the 404 view.
  - On sign-out or any 401, the query cache is cleared (`queryClient.clear()`), so no figure survives the session.
- **Filters:** one `FiltersModel` per list view, URL-synced with `replaceState` (house rule). Rows are pre-shaped in `useMemo` before they reach the table. Column definitions are stable.
- **Data:** `src/hosted/api/`, a ~100-line `fetch` wrapper typed by `openapi-typescript` output generated from `server/openapi/openapi.yaml` and committed. `npm run hosted:types:check` fails on drift, mirroring the server's `openapi:check`. Requests use `credentials: 'same-origin'`. Errors are parsed into the server's envelope.

### 7.2 Profile switcher

- Each entry shows the profile name, a **"Hosted"** chip, and a one-line source sentence: "Income recorded by Malafat" (`writerOfRecord: 'MALAFAT'`), or "Expenses only" (`null`).
- A fixed footer line: "Your local profiles stay in the Mutaba3a app on your device. They aren't shown here and never leave it." The user doesn't have to guess the source, and the split between the portal and the desktop app is stated rather than implied.

### 7.3 Views and data

| View | Calls | Notes |
|---|---|---|
| Overview | `GET /v1/summaries/organization` + `GET /v1/customers` (names) | M8 IA adapted: strip Owed · Overdue · Proposed per currency; currency segment only when >1 currency non-zero (M8 D13); table of customers with outstanding/overdue/last payment/status; sort overdue → outstanding → quiet → name. Summary rows carry ids only, so names join client-side in the shaping `useMemo` |
| Clients | `GET /v1/customers` + organization summary rows | Paginated by cursor |
| Client detail | `GET /v1/summaries/customers/{id}` + `GET /v1/projects?customerId=` | Tabs: Summary (per-currency + project summaries), Receivables, Payments, Documents (each a filtered list view below) |
| Receivables | `GET /v1/receivables` | Filters: customer, project, currency, status OPEN\|SETTLED, due range. Columns: client, matter, due, gross, paid, outstanding, status (server's `ItemStatus`, rendered as words) |
| Payments | `GET /v1/payments` | Filters: customer, status, received range (the API has no currency filter; the list shows each payment's own currency). Row expands to its allocations |
| Documents | `GET /v1/attachments` + `GET /v1/attachments/{id}/download` | Download only: navigate to the 15-minute signed URL (`Content-Disposition: attachment`). **No preview or inline render** (ADR-028) |

**Money.** Wire amounts are canonical decimal strings with a currency. They are formatted with `Intl.NumberFormat(locale, { style: 'currency', currency }).format(decimalString)`, which formats the string exactly (Intl.NumberFormat v3; Chrome 106+, Safari 15.4+, Firefox 116+). **No `Number()` or `parseFloat` ever touches an amount.** `Numeric` (`parseFloat`) and `CellAmount`/`formatAmount` (minor-unit `number`, `/100`) are therefore not reused. A new `DecimalAmount` component is added and registered. Totals are never summed client-side across currencies; the server returns one block per currency.

### 7.4 Read-only surfaces explain themselves

Income views (Receivables, Payments, Documents, Client-detail tabs) render **no** edit affordances: no row actions, no record-payment button, no drawer. A persistent inline notice in the `IncomeDrawer` locked-notice pattern (reason + next step, `role="note"`) says why:

- `writerOfRecord: 'MALAFAT'`: "Malafat records income and payments for this profile. To change them, use Malafat."
- `null`: "Income isn't recorded on hosted profiles yet. This profile is for expenses."

The notice reads `profile.access`, not a hard-coded list. If the server ever answers `READ_ONLY_PROFILE` (a stale UI), the toast uses the same sentence from `details.writerOfRecord`.

### 7.5 States (M8 wireframe, four per view)

- **Loading:** skeletons in the strip and two table rows.
- **Empty:** `EmptyState`, with copy per view. For example, receivables: "Nothing is owed on this profile right now."
- **Error / unreachable:** a whole-view `role="alert"` card with Retry: "Can't reach Mutaba3a right now. Figures aren't stored on this device, so nothing is shown until the connection is back."
  - **It never shows a stale figure:** the view renders data only when the query is not in error. On a failed refetch, TanStack Query keeps the old `data`, but the view ignores it while `isError`.
  - No `placeholderData`, no persisted cache, and no service worker (`vite-plugin-pwa` is not loaded in `hosted` mode).
  - A test asserts that a successful load followed by a failed refetch shows the card and none of the old figures.
- **Populated.**
- **Session expired:** a 401 mid-session redirects to sign-in with a neutral "You've been signed out" line. It is not an error card.

### 7.6 Sign-in page

- Email, password, submit. That is the whole form.
- **No** "create account", "forgot password", "invite" or "sign in with Malafat" affordance, and no route to any of them.
- A failed attempt shows one sentence for every cause: "That email and password don't match." A 429 shows "Too many attempts. Try again in a few minutes."
- Language switch in the corner. The page is RTL-correct.

### 7.7 i18n

- All strings use `t()` under a new top-level `hosted.*` namespace in `en.json`/`ar.json`. Languages are en and ar, matching the app; Hebrew is out (§12).
- **ICU.** The house i18n (ADR-019) is a home-grown `t(key, vars)` with `{var}` interpolation and no ICU library. MUT-43's "ICU MessageFormat" guardrail is met by plural *semantics* rather than syntax:
  - A `tp(key, count, vars)` helper selects `key.zero|one|two|few|many|other` with `Intl.PluralRules(locale)`. Arabic needs all six CLDR categories.
  - It falls back to `other`.
  - Adding an ICU parser was rejected: it adds bundle weight and conflicts with ADR-019 for one helper's worth of need.
  - `tp` is registered in `PATTERNS.md`.
- **Parity.** A new full-tree parity test runs over the `hosted.*` subtree only. It checks the same key set, the same leaf types, the same `{var}` names per key, and all six plural keys in `ar` wherever `en` has a plural. The existing en/ar drift elsewhere (30 `retainers.*` keys) is recorded as TD-030, not fixed here.
- Dates use `Intl.DateTimeFormat` with the organization's `timezone` for date-only fields (server dates are organization-calendar dates, M6). Amounts follow §7.3.

## 8. Local profiles are unaffected — demonstrated, not asserted

Each claim names the check that fails if it stops being true.

| Claim | Check |
|---|---|
| The local builds (`web` → Netlify, `desktop` → Tauri) contain no portal code | `npm run build:web` and `build:desktop` outputs grepped in a test (`scripts/check-bundles.ts`, run by `npm run test:bundles`) for `X-Mutaba3a-Profile`, `/v1/me`, `mut_session`, `/v1/sessions` → zero matches |
| The portal bundle contains no Dexie, no IndexedDB, no op-log | the same script asserts `dist-hosted` has no `indexedDB` or `Dexie` and no `sync/` module ids; ESLint `no-restricted-imports` zone forbids `src/hosted/**` → `src/db/**`, `src/sync/**`, `src/hooks/**`, `src/components/layout/**`, `src/components/drawers/**`, `src/lib/stores*` |
| No sign-up/reset affordance in the portal | `check-bundles` asserts `dist-hosted` contains none of `sign up`, `create account`, `forgot`, `reset password`, `invite` (case-insensitive, en and ar equivalents) |
| Dexie schema, `BusinessProfile`, profile store and switcher are unchanged | no edits to `src/db/database.ts`, `src/types/index.ts` (profile types), `src/lib/profileStore.ts`, `ProfileSwitcher.tsx`; the existing suite (≈130 files) passes unchanged |
| The op-log is unchanged | no edits under `src/sync/`; TD-029 records that it has no `profileId` concept at all |
| Root files touched outside new code are additive | `vite.config.ts` gains a `hosted` branch (the `web`/`desktop` branches unchanged, asserted by snapshotting their resolved config in a test); `en.json`/`ar.json` gain only `hosted.*`; `package.json` gains `build:hosted`, `hosted:types:check`, `test:bundles` |
| The local app's network behaviour is unchanged | `check-bundles` asserts the `web`/`desktop` bundles contain no new origins compared with a committed allowlist (today: Frankfurter FX, GitHub releases) |

ADR-013 is untouched because nothing in this design writes the op-log, reads it, or gives it a remote peer. ADR-024's guarantee holds because the desktop/PWA bundles are byte-for-byte free of the portal (first row).

## 9. Serving (MUT-45 implements; constraints fixed here)

- **One origin.** The API service serves `PORTAL_DIST_DIR` with `@hono/node-server/serve-static`. `/assets/*` gets immutable caching. The SPA fallback returns `index.html` for any `GET` that isn't `/v1/*`, `/admin/*`, `/health`, `/ready` or `/openapi.json`. API responses keep `Cache-Control: no-store`.
- **Build.** `server/scripts/deploy.sh` runs `npm run build:hosted` at the repo root and copies `dist-hosted/` into the image (Docker context or a pre-copy step; MUT-45 chooses). The server still imports nothing from `src/` (ADR-024): it serves built files.
- **Domain.** Cloud Run domain mapping is unavailable in `me-west1` (ADR-026 §8). MUT-45 chooses an external HTTPS load balancer or a Cloudflare proxy in front of the one service. The portal and API stay one origin whichever is chosen. `PORTAL_ORIGIN` is that origin.
- **CSP** (MUT-45): `default-src 'self'`, `connect-src 'self'`, `img-src 'self' data:`, `frame-ancestors 'none'`, `form-action 'self'`. Downloads are top-level navigations to GCS signed URLs and need no `connect-src` entry.
- **Instance count** stays 1 (TD-017): the sign-in limiter and lockout counters are in process, like the API-key limiter.

## 10. Re-cut of the build stories

These replace the "thin" scope text in Jira once the owner approves the brief.

- **MUT-37 (accounts):** §3.1 models + migration, §3.2 admin routes and scripts, argon2id, the route-inventory "no signup/reset" test. Session and portal work is out.
- **MUT-38 (sessions):** §4 in full: cookie transport, CSRF rule, expiry, sign-in and lockout, the `authenticate()` middleware and `security` declarations, the `AuthContext` union and `actorOf`, `GET /v1/me`, error codes, the `USER` actor, config and Terraform secret, the Malafat vendored-contract check.
  - **Correction to its AC:** there is **no existing log-redaction test**. `logger.ts` redaction is untested, and pino's `*.key` wildcards match one level only (TD-031). MUT-38 *creates* the test, covering the session cookie, the `Set-Cookie` header and `password`, and fixes the depth.
- **MUT-39 (writability):** §5 in full: the `const` matrix, effective scopes, `READ_ONLY_PROFILE` mapping, per-request store and the exhaustive guard, system-actor lazy posting, the profile header and membership check, the `describe.each` matrix tests and the drift test. Also the AC "switching profile never leaks figures": two memberships, the same session, and an assertion at the store query layer that every call carries the header's organization id.
- **MUT-42 (expenses domain):** unchanged in intent. Its routes declare `security: [{ session: [] }]` and the `expenses:*` scopes from the matrix's last rows. Attachments for expense receipts reuse the attachment storage with `uploadedByUserId`; that decision belongs to MUT-42's brief.
- **MUT-43 (portal read views):** §7.1–§7.7 except expenses: build target, shell, sign-in, switcher, the six views, `DecimalAmount`, `tp`, `hosted.*` i18n with the parity test, the four states, `check-bundles`, the import-zone lint. Two parallelisable halves:
  - (a) shell, sign-in and switcher once MUT-38's `/v1/me` contract is in `openapi.yaml`;
  - (b) the views, which can be built against the server's in-memory store in dev before MUT-39 lands.
- **MUT-44 (expense capture):** a portal `ExpenseDrawer` over MUT-42's routes. It may reuse the local expense form's presentational component; it must not import the local expense hooks or `src/db`.
- **MUT-45 (serving):** §9, plus the `SESSION_TOKEN_PEPPER` secret, `PORTAL_ORIGIN`, and the domain/LB choice.

Order is unchanged: 37 → 38 → 39 → {42, 43} → 44, with 45 in parallel after this brief.

## 11. Records updated with this brief

- **ADR-033** (new) in `DECISIONS.md`.
- **ADR-023** keeps Active status for the desktop↔Malafat OAuth connection, with an override note (in ADR-033 and on ADR-023 itself) that its "no account system, no password storage, no session of its own" clause no longer describes the hosted service.
- **TD-018** stays Accepted with corrected wording: users are operator-provisioned like keys, but "Mutaba3a keeps no account system" is no longer true.
- **TD-013:** the "upgrade when MUT-43 lands" note becomes "upgrade when a second implementation is injected (SQLite/Tauri)", because the portal does not inject into the registry.
- **TD-029** (sync op-log has no `profileId`), **TD-030** (en/ar drift; parity covers only `settings.features`), **TD-031** (server log redaction untested and one level deep).
- **COMPONENT_REGISTRY:** correction note that `DataTable` and `CellAmount` are listed but no such files exist (tables are page-local `<table>` with `Table.css`). The portal adds `DecimalAmount` and a small hosted table wrapper, registered when built (MUT-43), not now.

## 12. Out of scope

Any local↔hosted sync or migration of a local profile into a hosted one; showing local profiles in the portal; sign in with Malafat (OAuth) for the web (MUT-28's client is a desktop loopback client); self-serve signup, invite, password reset or signed-in password change; MFA, SSO, refresh tokens, "remember this device"; roles or per-user permissions beyond membership; writing income, receivables, payments, customers, projects or agreements from a session; Reports and CSV export; offline, PWA or any client-side persistence for hosted profiles; Hebrew; the desktop app signing in to the hosted service; horizontal scaling (TD-017).
