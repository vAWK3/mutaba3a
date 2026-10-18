# MUT-285 — The portal's local mode: one app, signed out on this device, hosted when signed in

**Status:** DRAFT for owner approval (MUT-285 AC 1). Epic MUT-284. ADR-097.
**Plan and eng review:** `.claude/designs/mut-285-local-mode-plan.md`. Owner decisions D1–D3 come from that review; epic decisions 1–4 come from the MUT-284 intake.
**Spike:** run 2026-10-18 on throwaway code (§14). It proved the approach, and none of that code ships.

---

## 1. Problem and acceptance criteria

We maintain two apps: the free local web app (Dexie, `mutaba3a.netlify.app/app`) and the hosted portal (`src/hosted`, served by the API on Cloud Run). Every feature gets built twice, and the free app can't reach the phone. MUT-284 replaces both with one portal: signed out, records are saved in this browser; signed in, they are the person's hosted account. The screens are the same either way.

MUT-285 delivers the design, not code:
- [ ] This brief, with a QA-scenarios section (§12), approved by the owner.
- [ ] ADR-097 in DECISIONS.md, with override rows for ADR-037 §2 and MUT-185 decision 1.
- [ ] Every endpoint the portal uses is covered (§3, 49 of 49), and every server-side rule has an owner module (§4).

**Owner decisions this brief carries (do not re-open):**

| # | Decision | Source |
|---|---|---|
| E1 | Local mode is a second backend behind the portal's typed API client, storing API-shaped records. The old Dexie/Transaction model is not ported. | MUT-284 |
| E2 | The app lives at the portal's origin. `mutaba3a.netlify.app` becomes a handoff bridge (MUT-291). The landing page stays on Netlify. | MUT-284 |
| E3 | On sign-in, the app offers a one-time move of the device's records into the account (MUT-290). No ongoing sync (MUT-73 stands). | MUT-284 |
| E4 | No feature catch-up. Signed out and signed in are the same portal. The one difference, no phone sync, is accented as the hosted + phone upsell (MUT-289). | MUT-284 |
| D1 | The persisted local data carries a format version, with ordered migrations and a CI shape-fingerprint test. | eng review |
| D2 | `navigator.storage.persist()`, plus "Download my records" and "Restore from file". | eng review |
| D3 | An anonymous `GET /v1/public/fx-rates`, so the expense-group ≈ line works signed out when online. | eng review |
| P1 | No App Store or Play links before an account exists; show phone-app availability and the /hosted request instead. | MUT-186 9A |

## 2. Architecture

### 2.1 The idea: the server's own routes, run in the browser

The server already has everything local mode needs:
- Every route reaches data through the `LedgerStore` interface (`server/src/repositories/ports.ts:1355`).
- `MemoryLedgerStore` (`repositories/memory.ts`) is a complete second implementation, held to the Postgres behaviour by the shared contract suite (`repositories/__tests__/store-contract*.ts`).
- Hono runs on Web-standard `Request`/`Response`.

So the local backend is the **same route modules** over `MemoryLedgerStore`, saved to IndexedDB, and answering `app.fetch(request)` inside the page. The figures are the same signed in or out by construction: the same zod schemas, validation, serializers, error codes and store semantics, not a copy kept in step by tests.

```
                 src/hosted (portal UI, unchanged views and hooks)
                                    │  api.*  (49 functions)
                                    ▼
                 request(method, path, opts)   src/hosted/api/client.ts:191
                 builds one Request ─────────────┐
                                                 │ transport(req)
                      mode = remote ◄────────────┴───────────► mode = local
                           │                                       │
                    fetch(req) same-origin                 localBackend.fetch(req)
                           │                               (lazy chunk, src/hosted/local)
                           ▼                                       ▼
        Cloud Run: createApp(deps)                createLocalApp(deps)
          ├─ createApiShell  ◄──── shared ────────►  ├─ createApiShell
          ├─ authenticate (cookie session)           ├─ authenticate (device session of the
          ├─ PORTAL_ROUTES ◄────── shared ────────►  │   local person, Bearer mds_…)
          ├─ admin, sessions, integration, …         ├─ PORTAL_ROUTES
          └─ PrismaLedgerStore (Postgres)            ├─ meRoutes, fxRateRoutes(public source)
                                                     └─ MemoryLedgerStore + IndexedDbPersistence
                                                            ├─ 'mut-local' DB: snapshot (D1)
                                                            └─ receipts object store (Blobs)
```

### 2.2 Authentication: no new auth code (spike finding)

The plan proposed a "local principal" middleware. The spike found a better option. On first boot, the local backend creates **an ordinary person and a device session in its own store**:
- `users.create` with a placeholder email `local@device.invalid`, the app's locale, and a personal profile in the browser's IANA timezone;
- `sessions.create` with kind `device`, effectively unbounded expiry, and a constant local pepper.

It then sends `Authorization: Bearer mds_…` on every request. That header is not on the browser's forbidden-header list, unlike `Cookie`. The server's own `authenticate()` runs unchanged: the device-session principal, `X-Mutaba3a-Profile` selection, `requireScope` and the writability matrix (layers 1–2). The person owns every local profile, so writability is the owned-profile row (read-write).

Consequences:
- **There is no local principal for the server to mount by mistake**, because no new auth code exists. The server keeps its auth exactly as is.
- **Layer 3, the per-request store guard, is inactive locally.** It reads Hono context storage (AsyncLocalStorage), which browsers lack, so `tryGetContext()` is undefined and calls pass through (`auth/store-guard.ts:309`). That is safe here: the only principal is the owner of every local profile. The ADR records it.
- The local pepper and token protect nothing. Anyone who can run script on the origin can read IndexedDB directly. The marker copy says records live in this browser (§10).

### 2.3 Server changes (MUT-286, refactor first)

Each of these is behaviour-preserving and lands before any browser code, with the full server suite and `openapi:check` green:

1. **`createApiShell(deps)`** (new, `server/src/app-shell.ts`): the `OpenAPIHono` with `defaultHook`, `onError`, `notFound` and the requestId/now middleware, lifted from `app.ts:136-183`. `createApp` calls it and keeps its own CSP/no-store headers, logger, contextStorage and static serving. `createApp` can't run in a browser because it imports `@hono/node-server/serve-static` and argon2.
2. **`meRoutes(store)`** (new, `server/src/routes/me.ts`): `GET /v1/me` and `buildMe` moved out of `routes/sessions.ts`, which imports `@node-rs/argon2` (native) through `auth/users.ts`. `sessionRoutes` keeps sign-in, sign-out, password and Malafat suggestions.
3. **`PORTAL_ROUTES`** (new, `server/src/routes/portal-routes.ts`): one list of the route factories the portal uses: customers, projects, receivables, payments, summaries, attachments, expenses, expense-categories, income, expense-groups, conversions, fx-rates, profiles and me. `createApp` registers them from this list; `createLocalApp` registers exactly this list. A test checks that every path `src/hosted/api/client.ts` calls is served by a factory in the list, so a new portal call can't silently miss local mode.
4. **`snapshot()` / `restore()`** on `MemoryLedgerStore`. Its state is ~33 `private readonly` Maps (`memory.ts:143-178`). Excluded as ephemeral: `idem`, `userIdem`, `sessionsById`, `setupLinks`, `events`, `keys`. The store's docblock changes from "for tests" to "for tests and the portal's local mode".
5. **`GET /v1/public/fx-rates`** (D3, built in MUT-287), in `routes/fx-rates.ts`:
   - It returns the cached ECB snapshot `{ date, rates }` that `CachedFxRates` already holds.
   - Security `[]`, rate-limited per IP (`SlidingWindowRateLimiter`), no profile header.
   - The local backend wraps it in a `FxRateSource`, so its own `GET /v1/fx-rates` runs the same `crossRates`.

### 2.4 Platform substitutes: build-time only

The portal-facing routes touch Node in exactly two places: `node:crypto` (`randomUUID`, `randomBytes`, `createHash('sha256')`, `createHmac('sha256')`, `timingSafeEqual`) and `Buffer` (`from(…, 'utf8'|'base64url')`, `toString('hex'|'base64url'|'utf8')`, used by the cursors and preview tokens).

- The hosted build aliases `node:crypto` and `node:async_hooks` to `src/hosted/local/platform/` for the local chunk only, and installs a `Buffer` shim before the backend loads.
- **No server module changes**, and the server keeps real `node:crypto`.
- A server-suite test (`server/src/__tests__/platform-shim.test.ts`) runs both implementations on the same inputs and requires byte-identical output: SHA-256, HMAC, base64url round-trips and the cursor formats. The spike's version passed 10,000 random cases.

### 2.5 Persistence (D1, D2)

- **One IndexedDB database `mut-local`, store `state`, key `snapshot`.** Receipts go in a separate store `blobs` (§6), never in the snapshot.
  - The snapshot is `{ formatVersion, stateVersion, savedAt, maps }`.
  - IndexedDB's structured clone keeps `Date` and `bigint` as they are, so there is no serializer.
- **Durable before "Saved".** Every mutating request runs as follows, and only then does its response resolve:
  1. take the lock;
  2. reload if stale;
  3. run the request;
  4. write the snapshot in one transaction and wait for `complete`;
  5. bump `stateVersion`.

  A tab closed mid-write aborts the transaction. That save never showed "Saved", so nothing the person saw is lost. Spike numbers: §14.
- **Two tabs.**
  - Writes run under `navigator.locks.request('mut-local', { mode: 'exclusive' })`.
  - Before any request, a tab reads `stateVersion` (one small read). If another tab wrote, it reloads the snapshot before going on.
  - After a write, `BroadcastChannel('mut-local')` tells other tabs to invalidate their TanStack caches.
  - A service-worker-hosted backend was rejected (plan review): after an update, a tab's UI and backend could run different versions.
- **Format version and migrations (D1).**
  - `src/hosted/local/migrations/` holds ordered `(from → to)` functions over the snapshot, run on load.
  - `LOCAL_FORMAT_VERSION` is a constant beside them.
  - A CI test fingerprints the snapshot's record types; the fingerprint is generated from `ports.ts` record shapes. It fails when the fingerprint changes without a new version and migration.
  - A tab whose code is older than the stored `formatVersion` refuses every write with a "Reload to continue" screen. It never writes an old shape over a new one.
- **Eviction (D2).**
  - Call `navigator.storage.persist()` after the first local save. It is silent: browsers decide it from engagement.
  - Settings › Your data gets **Download my records** (the snapshot plus receipt blobs, as one versioned file) and **Restore from file**. Restore runs the same migrations and replaces local data after a confirm that names the record count.
  - Safari's 7-day cap is unverified (§14), and the file is the backstop whatever the browser does.

### 2.6 Modes and transitions

```
             first visit / no hint
  ┌──────────────────────────────────────────┐
  ▼                                          │
LOCAL ──sign in (POST /v1/sessions 201)──► REMOTE ──sign out──► LOCAL
  ▲                                          │
  │                                401 on a request
  │                                          ▼
  └──"Continue on this device"────── SESSION EXPIRED ──"Sign in"──► /sign-in
                                     (choice screen; never a silent switch)

REMOTE + offline (hint says signed in, fetch fails) ──► OFFLINE state, not local data
```

- The mode hint is a localStorage key `mut-mode` (`local`|`remote`), wrapped in try/catch with `local` as the fallback.
  - It is set on a successful sign-in and on sign-out.
  - It is a per-viewer convenience, which hosted-portal.md §8 allows.
- The 401 handler (`client.ts:125-134`, `SessionBridge`) shows the expired-session choice instead of redirecting straight to `/sign-in`.
- `/sign-in` and `/setup` always talk to the server; they are never routed locally.
- The `/p/$profileId` routes and every view are unchanged.
  - `AuthGate` asks the transport for `/v1/me`; in local mode that answer comes from the local person.
  - What changes by mode: the account drawers (password, sign out) are hidden locally; the Sign in entry, marker and upsell are shown (MUT-289).

### 2.7 Loading

The local backend is a dynamic `import()` chunk. Signed-in users never download it, and the remote path stays as it is today. The chunk measured 135.7 KB gzip, including zod, `@hono/zod-openapi` and Hono; the portal already ships zod for its forms, so part of that dedupes.

## 3. Endpoint coverage (49 of 49)

Every call in `src/hosted/api/client.ts` is listed. "Shared route" means the same server route module answers in both modes.

| # | Call | Local mode |
|---|---|---|
| 1 | GET /v1/me | Shared route, after the `meRoutes` split (§2.3.2), answering for the local person |
| 2 | POST /v1/sessions | Remote only. A successful sign-in switches the mode to remote. |
| 3 | DELETE /v1/sessions/current | Remote only; sign-out switches to local. Hidden in local mode. |
| 4 | POST /v1/me/password | Remote only; the account drawers are hidden locally |
| 5 | POST /v1/account-setup/check | Remote only (`/setup` is a public server page) |
| 6 | POST /v1/account-setup | Remote only |
| 7 | PATCH /v1/me/malafat-suggestions | Not served locally; Malafat surfaces are hidden on local profiles. A stray call answers 404. |
| 8 | GET /v1/summaries/organization | Shared route |
| 9 | GET /v1/summaries/customers/{id} | Shared route |
| 10 | GET /v1/customers | Shared route |
| 11 | GET /v1/customers/{id} | Shared route |
| 12 | GET /v1/projects | Shared route |
| 13 | GET /v1/receivables | Shared route (lazy posting runs and is a no-op on owned profiles) |
| 14 | GET /v1/receivables/{id} | Shared route |
| 15 | GET /v1/payments | Shared route |
| 16 | GET /v1/payments/{id} | Shared route |
| 17 | GET /v1/attachments | Shared route over `LocalAttachmentStorage`; always empty, because only Malafat uploads documents (API-key route) |
| 18 | GET /v1/attachments/{id}/download | Shared route; unreachable in practice (no rows) |
| 19 | GET /v1/expenses | Shared route |
| 20 | GET /v1/expenses/{id} | Shared route |
| 21 | POST /v1/expenses | Shared route |
| 22 | PATCH /v1/expenses/{id} | Shared route |
| 23 | DELETE /v1/expenses/{id} | Shared route (receipt blobs removed through `LocalAttachmentStorage.remove`) |
| 24 | GET /v1/expense-categories | Shared route (lazy preset seeding by profile type) |
| 25 | POST /v1/expenses/{id}/receipts | Shared route; `signUpload` returns a `local-blob:<key>` target (§6) |
| 25b | PUT to the signed URL | `putToSignedUrl` local branch: writes the Blob to `blobs` under that key |
| 26 | POST …/receipts/{rid}/complete | Shared route; `head(key)` reads the stored Blob's size and type |
| 27 | DELETE …/receipts/{rid} | Shared route |
| 28 | GET …/receipts/{rid}/download | Shared route; `signDownload` returns `local-blob:<key>`, and `downloadNavigator` downloads it (§6) |
| 29 | POST /v1/income | Shared route |
| 30 | POST /v1/receivables/{id}/settle | Shared route |
| 31 | PATCH /v1/income/{id} | Shared route |
| 32 | PATCH /v1/payments/{id} | Shared route |
| 33 | POST /v1/profiles | Shared route (cap of 6, `PROFILE_LIMIT`) |
| 34 | PATCH /v1/profiles/{id} | Shared route (a type change replaces categories, as on the server) |
| 35 | GET /v1/profiles/{id}/type-change | Shared route |
| 36–40 | conversions: list, get, create, update, delete | Shared routes |
| 41–48 | expense groups: list, get, create, update, delete, summary, mark PUT, mark DELETE | Shared routes |
| 49 | GET /v1/fx-rates | Shared route, fed by a `FxRateSource` that reads `GET /v1/public/fx-rates` over the network (D3). Offline it answers 503 `FX_RATES_UNAVAILABLE` and the ≈ line hides. |
| – | GET /v1/summaries/expenses (defined, unused) | Shared route, free |
| – | posthog-js (not /v1) | Never loads signed out: consent needs a user id (`portalAnalytics.ts:169-192`), so the local mode sends no telemetry (ADR-024, ADR-090) |

## 4. Rule ownership

Every rule keeps the server module that owns it today; local mode runs that module. Nothing is copied.

| Rule | Owner (unchanged) |
|---|---|
| Today in the profile timezone | `dates.ts` `todayIn`; `agreements/compose.ts` `todayFor` |
| Receivable status (VOID/PENDING/PAID/OVERDUE/PARTIALLY_PAID/DUE) | `agreements/status.ts` `itemStatus`; `serializers.ts` `receivableStatus` |
| Outstanding = gross − paid − credited | `serializers.ts:330`, `summaries/compute.ts:28`, `payments/allocate.ts:57` (three equal copies, pre-existing) |
| Owed default due date (end of month + 15) | `income/compose.ts:88`, `dates.ts` `dueDateFor` |
| Owed VAT out of scope, net = gross | `income/compose.ts:106` |
| Settle rules (outstanding > 0, amount ≤ outstanding, CASH default) | `routes/receivables.ts:152-227` |
| Allocation applies; receivable SETTLED + version bump | `MemoryLedgerStore.payments.create` + `settle()` (`memory.ts:1228-1245, 1799`) |
| Payment numbers `PAY-{year}-{seq}` | `payments/numbering.ts` + the store counter (`memory.ts:1236`) |
| Allocation state | `payments/allocation-state.ts` |
| Income status on the wire | `serializers.ts:556-591` |
| Re-date rules | `income/compose.ts:139-149`, `routes/income.ts:154-194`, `routes/payments.ts:315-338` |
| Summary buckets, customer status, last payment | `summaries/compute.ts`; `routes/summaries.ts` |
| Expense summary | `expenses/summary.ts` `summarizeExpenses` |
| Group window, membership, series, day buckets, caps | `expenses/groups.ts`, `expenses/summary.ts`, store `inGroupFilter` |
| Category presets and lazy seeding | `expenses/presets.ts`, `routes/expense-categories.ts:55-67`, store `seed` |
| Category name uniqueness | `expenses/names.ts` |
| Expense amount, date floor, links, patch | `expenses/compose.ts` |
| Conversion rules | `conversions/compose.ts` |
| Money parse/format, exponents, max | `money.ts` |
| Date floor/ceiling (MUT-227), not-future | `agreements/compose.ts:152-168`, `income/compose.ts:119-128` |
| Request schemas, enums, lengths | `schemas.ts` |
| Profile cap 6, default-personal retype refusal | `routes/profiles.ts:27, 63, 90` |
| Type change replaces categories | store `organizations` type change (`memory.ts:249`) |
| Writability layers 1–2 | `auth/writability.ts`, `auth/middleware.ts` `requireScope` |
| Idempotency (fingerprint, replay, mismatch) | `idempotency.ts`, `repositories/idempotency-claim.ts` |
| If-Match / version conflicts | `if-match.ts`, `routes/shared.ts:83` |
| Cursors and `anchor` | `pagination.ts`, `expenses/cursor.ts`, `conversions/cursor.ts`, `routes/shared.ts:55` |
| Receipt file rules (pdf/jpeg/png, 10 MB, 10 per expense) | `attachments/rules.ts` `checkFile`, `expenses/compose.ts:15` |
| FX cross rates, JOD peg | `fx-rates.ts` `crossRates` |
| Lazy posting | `agreements/posting.ts` (a no-op on owned profiles; runs unchanged) |

**Known memory/Prisma differences** become differences between modes, so both are fixed in the store, not documented away:
- With both `unlinked` and `customerId` set, the expense filter ANDs them in memory, while Prisma lets `customerId` win (`prisma.ts:1634`). The portal never sends both. MUT-286 aligns memory with Prisma and adds a contract case.
- Receivable `createdAt` comes from `input.postedAt` in memory and from `at` in Prisma (`memory.ts:1364`). These are equal for Owed. MUT-286 aligns memory with Prisma.

## 5. Offline and install (MUT-288)

- Load `vite-plugin-pwa` in hosted mode:
  - scope and start URL `/`;
  - precache the app shell and the local chunk;
  - `navigateFallback: '/index.html'`;
  - `navigateFallbackDenylist`: `/v1/`, `/admin/`, `/health`, `/ready`, `/openapi.json`, `/.well-known/` (mirrors `PORTAL_EXCLUDED_*`, `app.ts:92-99`);
  - no `runtimeCaching` for `/v1`.
- A portal manifest goes in `hosted.html`.
- `registerType: 'autoUpdate'`, with a reload prompt only when no drawer is dirty.
- The server already serves non-asset files with `Cache-Control: no-store`, which suits SW update checks. The CSP's `default-src 'self'` already allows a same-origin SW and manifest, so no CSP change.
- QA runs block service workers by default; MUT-288's spec opts in.

## 6. Receipts and documents

- **`LocalAttachmentStorage`** (`src/hosted/local/attachments.ts`) implements the server's `AttachmentStorage` interface (`attachments/storage.ts:21`; routes import only the type):
  - `signUpload` and `signDownload` return `{ url: 'local-blob:<key>' }`;
  - `head` reads the stored Blob's size and type;
  - `remove` deletes it.
  - Blobs live in the `blobs` object store, not base64.
- **The portal's two off-API flows get a local branch:** `putToSignedUrl` (`data/expenseQueries.ts:102-118`) and `downloadNavigator.open` (`data/download.ts:9`). A download builds an object URL and clicks an `<a download>`. **ADR-028 holds:** download only, no preview, so no `blob:` in `img-src` and no CSP change.
- **Documents** are uploads by Malafat through API-key-only routes (`routes/attachments.ts:28`). A local profile is never Malafat-linked, so its Documents list is the existing empty state, the same as a hosted owned profile today.

## 7. FX signed out (D3)

`GET /v1/public/fx-rates` (§2.3.5) returns the server's cached ECB snapshot. The local backend's `fxRateRoutes` gets a `CachedFxRates` whose `FxRateSource.latest()` fetches it, so `crossRates`, the JOD peg, rounding and staleness all run unchanged.
- Offline or rate-limited, the route answers 503 and the ≈ line hides, through the existing path (ADR-095 §5).
- MUT-286's "signed-out mode makes no /v1 requests" AC carries exactly this one named exception.

## 8. Durability UI (D2)

- Settings › Your data (local mode only) gets **Download my records** and **Restore from file** (§2.5).
- The MUT-289 marker copy says records live in this browser and links to Download.
- None of this appears signed in: hosted data lives on the server.

## 9. Guards: what changes, and what replaces it

| Guard today | Becomes |
|---|---|
| ESLint portal block bans `dexie` and `(db\|sync\|hooks)/` (`eslint.config.js:163-191`) | Unchanged for the portal. New block for `src/hosted/local/**`: may import `server/src/**` only through an allowlist (route factories, `MemoryLedgerStore`, the auth middleware, shell, schemas), plus IndexedDB. `server/src/**` may never import `src/**`. |
| `HOSTED_RULES`: `indexedDB`, `Dexie`, `serviceWorker` banned anywhere in `dist-hosted` (`scripts/bundle-rules.ts:37-60`) | `indexedDB` allowed only in the local chunk; `serviceWorker` only in the SW registration and `sw.js`; `Dexie` still banned everywhere; sign-up/reset/invite word bans stay and now also cover the server modules pulled into the bundle |
| `check-bundles.test.ts:48-50`, `hosted-lint.test.ts` probes | Rewritten to the narrower rules, not deleted |
| `hosted-portal.md` §7.5, §8, §12 statements | Superseded-by notes pointing to ADR-097 (done with this ticket) |
| — | New: `PORTAL_ROUTES` coverage test (§2.3.3); platform-shim parity test (§2.4); persistence round-trip in the store contract suite; D1 fingerprint test |

## 10. Security and privacy

- **No new server attack surface**, except `GET /v1/public/fx-rates`: anonymous, read-only public market data, rate-limited per IP.
- **The local backend is reachable only from the page's own script**; there is no network listener.
- **Signed-out data is this browser's data.**
  - Anyone with the device or the browser profile can read it. That is the same as today's free app, and the marker says so.
  - Signing out of an account never shows that account's data locally, and the local store never holds hosted rows (E1, E3).
- **No telemetry signed out:** analytics needs a user id; Sentry stays off in local mode (ADR-091 "never the local web app" carried over).
- **The local person's placeholder email and device token** never leave the browser; nothing sends them anywhere.

## 11. Constraints for the later tickets

- **MUT-289 (upsell):**
  - the marker "Saved on this device only — not on your phone" on every signed-out screen;
  - the upsell links to `/hosted` (request form) and Sign in;
  - no App Store or Play links (P1);
  - no network call until clicked;
  - clicks counted only through the MUT-155 consent flow.
- **MUT-290 (move on sign-in):**
  - replays the local records through the remote API in dependency order: profiles, customers, projects, income (Owed), settles, Received, expenses, categories, receipts, groups and marks, conversions;
  - uses Idempotency-Keys derived from local ids, so an interrupted move resumes without duplicates;
  - clears the local snapshot only after the server has confirmed every record;
  - offers a target profile choice within the cap.
- **MUT-291 (bridge):**
  - maps the Dexie backup (`src/db/backup.ts:20-38`) to API requests and feeds them through `createLocalApp` as ordinary POSTs, so every rule validates;
  - lists records that can't be mapped (vendors without expenses, recurring rules, retained documents, unattached receipts) and doesn't drop them silently;
  - JOD rows imported by CSV may be off by 10× (TD-112), so the bridge flags them;
  - hands off by `postMessage` to a portal window, with a file download as fallback.
- **MUT-292 (retire):**
  - waits at least 90 days after the bridge ships;
  - Netlify keeps serving the landing page and the bridge.

## 12. QA scenarios (release-QA, `portal` app unless noted)

| id | Steps (as the user says them) | Promise |
|---|---|---|
| `local.first-visit` | Open the app for the first time | The app opens in Arabic with no sign-in, on an empty Personal profile |
| `local.income-persists` | Add money owed, record part of it paid, reload | Both are there; the owed amount shows what is left |
| `local.expense-receipt` | Add an expense, attach a PDF receipt, download it | The receipt downloads with its name; reload keeps it |
| `local.same-figures` | Enter the same records signed out and on a hosted account | Overview totals and statuses match exactly |
| `local.two-tabs` | Open two tabs, add an expense in each | Both expenses are in both tabs after a refresh |
| `local.download-restore` | Download my records, clear site data, restore the file | Every record and total is back |
| `local.offline` | Install, go offline, open, add income | It saves; reload offline still shows it (MUT-288) |
| `local.marker-upsell` | Use the app signed out, then sign in | The marker and upsell show signed out only; no store links (MUT-289) |
| `local.session-expired` | Let a session expire while signed in, then act | A choice: Sign in, or Continue on this device; never a silent switch |
| `local.fx-line` | Signed out and online, open an expense group in two currencies | The ≈ line shows; offline it hides (D3) |
| `local.move-on-sign-in` | With local records, sign in and accept the move | The account shows the records once; the device's copy is cleared (MUT-290) |
| `web.bridge` (web app) | Open the old web app with existing data | The records arrive in the portal with matching counts (MUT-291) |

## 13. Test strategy (MUT-286..288)

1. **Store contract suite** gains a persisted variant: snapshot → restore between operations, run against `MemoryLedgerStore`.
2. **Parity suite** (`src/hosted/local/__tests__/parity.test.ts`): one request script through Node `createApp` + memory and through `createLocalApp`, with JSON responses diffed (ids and timestamps normalised).
3. **Migrations + fingerprint** (D1), and the newer-format write refusal.
4. **Two-tab lock test:** two backends on one fake IndexedDB with a fake Web Locks; no lost write.
5. **Coverage and isolation:** `PORTAL_ROUTES` covers every client path; `server/src` imports nothing from `src/`; the local app registers exactly `PORTAL_ROUTES` + `meRoutes`.
6. **Platform-shim parity** (§2.4) in the server suite.
7. **Public FX route:** anonymous, rate-limited, no profile header accepted.
8. **Regression:** existing portal view tests and `server/src/__tests__/portal.test.ts` stay green in remote mode; the CSP string is unchanged.
9. **Release-QA specs** for §12, one tagged spec each.

## 14. Spike results (2026-10-18, throwaway code)

The server's portal route modules, the auth middleware and `MemoryLedgerStore`, composed as in §2.1 with a seeded device session, were run in Node and in headless Chromium.

| Gate (plan §3) | Result |
|---|---|
| Local chunk ≤ 250 KB gzip | **135.7 KB** (557.8 KB min) — pass |
| Node-only fixes in ≤ 5 server modules, no behaviour change | **0 server modules changed**: build-time aliases for `node:crypto` and `node:async_hooks` plus a `Buffer` shim, byte-identical in 10,000 random checks — pass |
| Persist p95 ≤ 100 ms at ~10k records | **23.6 ms p95** (16.9 p50, 34.4 max) — pass |

The run used 300 clients, 4,500 owed entries, 2,000 settles and 3,000 expenses (snapshot 6.6 MB JSON-equivalent). Other measurements:
- boot restore 40 ms;
- organization summary 11.7 ms p50 / 19.4 ms p95;
- about 0.9 ms per request.

**The first run failed the gate:** 134.5 ms p95, 21.9 MB. It had kept 9,825 idempotency replay records, each with its stored response body. Excluding them (§2.3.4) is what makes persistence cheap. A retry within a page lifetime still replays from memory. After a reload, the drawer and its attempt key are gone, so no retry with the same key can arrive.

The smoke script passed through the real routes: `/v1/me`, a customer, Owed income, receivables (status DUE), a partial settle, 12 seeded personal categories, an expense, the organization summary (outstanding 1000.00), a 422 for an over-precise amount, and a new BUSINESS profile.

**Not verified:**
- Safari: WebKit isn't installed here. Neither whether `persist()` lifts Safari's 7-day cap, nor general WebKit behaviour of the bundle. MUT-286 runs its QA specs on WebKit before landing. The D2 file backstop covers eviction whatever the answer.
- Headless Chromium denied `persist()` without engagement, as expected.
- Web Locks are available.

## 15. Cost

- $0 infrastructure.
- One new public route on the existing Cloud Run instance, rate-limited, reading an in-process cache with no extra Frankfurter calls.
- Signed-in users download nothing new.
- Signed-out users download about 136 KB gzip once, then the service worker caches it.

## 16. Rejected options

- **Hand-written local backend** (plan option C), or **extracted pure rules + local router** (option B, the fallback): parity would rest on tests, and store semantics (allocation, numbering, ordering, filters) would be copied. Option A passed its gates.
- **A local-principal middleware:** replaced by a real device session (§2.2), with no new auth code.
- **Backend in the service worker:** UI/backend version skew after updates; local mode would break where SWs are unavailable.
- **Porting the Dexie/Transaction model:** E1; the lossy model mapping is ADR-037 §2's reason, still valid.
- **Netlify origin with a proxied API, or local data at the netlify origin:** E2; MUT-185 rejected the proxy.
- **Request-log replay instead of migrations** (D1 option B): later rule changes could reject old entries.
- **Hide the ≈ line signed out** (D3 option B): a visible gap between modes.

## 17. i18n and RTL

New strings go only in the portal dictionaries (`src/hosted/i18n`): marker, upsell, session-expired choice, Download/Restore, reload-to-continue, offline.
- Arabic is the default (ADR-077), and every new surface follows the portal's RTL rules.
- The local person's locale follows the language the app shows; a language change updates the local person through the existing `/v1/me` path where one exists.

## 18. Records updated with this ticket

- ADR-097 (new); the Superseded Decisions table, with rows for ADR-037 §2 and MUT-185 decision 1; the ADR index row.
- `hosted-portal.md`: superseded-by notes at §2, §7.5, §8 and §12.
- CHANGELOG, ROADMAP.
- MUT-286/287/289 Jira comments (posted 2026-10-18).
