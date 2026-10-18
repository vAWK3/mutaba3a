# MUT-285 plan — Design brief + ADR: local mode for the portal

Status: PLAN (eng-ticket, 2026-10-18). This file is the plan for *writing* the brief; the brief itself is the ticket's deliverable.
Epic: MUT-284. Blocks: MUT-286 (core local mode), MUT-288 (offline). Siblings: MUT-287, 289, 290, 291, 292.

## 0. What the code already gives us (findings)

- **One transport funnel.** Every portal call goes through `request(method, path, options)` (`src/hosted/api/client.ts:191`); the `api` object (49 functions, 38 paths) is one-liners over it. Error mapping (`toApiError`), 204 handling and the 401 handler live there. The test harness (`src/hosted/__tests__/harness.tsx:78`) already drives the whole portal against a fake `fetch` keyed by `"METHOD /path"`.
- **The server's rules are behind `LedgerStore`** (`server/src/repositories/ports.ts:1355`). Prisma is imported in one runtime module. **`MemoryLedgerStore`** (`repositories/memory.ts`, 1,879 lines, plain Maps) is a complete second implementation that passes the same contract suite (`repositories/__tests__/store-contract*.ts`).
- **`createApp(deps)`** (`server/src/app.ts:133`) takes an injectable `store` and `now`.
- **Some rules live inside the stores, not pure modules**: receivable SETTLED/version bump after allocation, payment numbering counters, list filters/ordering, group membership filter. A hand-written browser backend would have to re-copy these.
- **Node-only deps on the route path:** `node:crypto` (`randomUUID`, `createHash` in `idempotency.ts`, `preview-token.ts`, `auth/api-key.ts`, `personal-profile.ts`), `Buffer` (`pagination.ts`, `expenses/cursor.ts`), and `hono/context-storage` (AsyncLocalStorage) used by the store guard (`app.ts:147`, `auth/store-guard.ts:277`).
- **Documents** in the portal are Malafat-uploaded attachments (API-key-only upload, `routes/attachments.ts:28`). A local profile is never Malafat-linked, so it can have none.
- **Receipts** are a GCS signed-URL PUT + complete + signed-URL download (`data/expenseQueries.ts:102-136`, `data/download.ts:9`).
- **Lazy posting** (`agreements/posting.ts:30`) is a no-op on owned profiles (agreement/retainer writes are API-key-only and API keys are refused on owned profiles).
- **FX rates** (`GET /v1/fx-rates`) are session-only and fetch Frankfurter server-side; used only for the "≈" line in expense-group detail.
- **The portal has no SW, manifest or IndexedDB by design**, and three guards enforce it: `eslint.config.js:163-191` (+ `scripts/__tests__/hosted-lint.test.ts`), `scripts/bundle-rules.ts:37-60` `HOSTED_RULES` (+ `check-bundles.test.ts:48-50`), and `hosted-portal.md` §7.5/§8/§12 + `vite.config.ts:341-347`.
- **Server serves the portal** with `Cache-Control: no-store` on non-assets and CSP `default-src 'self'; connect-src 'self' https://storage.googleapis.com https://eu.i.posthog.com; img-src 'self' data:; …` (`app.ts:105-111`, pinned by `server/src/__tests__/portal.test.ts:194-205`).
- **Analytics** (MUT-155) needs a user id, so it is already a no-op signed out. **Sentry** (MUT-149) is not wired yet; ADR-091 says "never the local web app".
- **Old app data** (for MUT-291): Dexie v24, full JSON backup `src/db/backup.ts:20-38` is the most complete source; minor-unit integers vs the API's decimal strings.

## 1. The decision the brief proposes (needs owner approval)

The ticket says "pull the rules into one pure shared module that both the server and the local backend run". The code makes a stronger option available:

| | **A. Run the server's own route layer in the browser (recommended)** | B. Extract pure rules + hand-written local router | C. Hand-written local backend, parity by tests only |
|---|---|---|---|
| How | `request()` builds a `Request`; signed out it goes to `localApp.fetch(req)` instead of `fetch(req)`. `localApp = createLocalApp({ store, now })` registers the **same Hono route modules** the server uses, behind a local-principal middleware, over `MemoryLedgerStore` persisted to IndexedDB. | Move pure modules to a shared folder; write ~38 local handlers that call them and a local store. | Re-implement the 49 endpoints in `src/hosted/local`. |
| Parity | **By construction**: same zod schemas, validation, serializers, error codes, store semantics. | Rules shared; store semantics, ordering, serializers and errors re-copied. | Tests only. |
| New code | Browser persistence + local principal + isomorphic shims (~small). | Large: handlers + store + serializers. | Largest. |
| Risk | Bundle size of the server route layer; Node-only deps; tab concurrency (store held in memory). | Drift in the copied store semantics. | Drift everywhere. |
| Ticket AC fit | Exceeds "one owner module per rule": every rule's owner is the server module that already owns it. | Matches literally. | Fails the spirit. |

A is chosen unless the spike (§3) fails its gates; then fall back to B.

## 2. Brief outline (`.claude/designs/mut-285-portal-local-mode.md`)

1. **Problem, acceptance criteria, owner decisions** (epic MUT-284 decisions 1-4, verbatim).
2. **Architecture (Option A).**
   - Transport seam: `request()` → `transport(req)`; `remoteTransport = fetch`, `localTransport = (await import('./local/backend')).fetch`. The local backend is a lazy chunk loaded only in local mode; signed-in users never download it.
   - Server split: `createRoutes(app, deps)` (route registration only, browser-safe) used by `createApp` (server: auth, store guard via contextStorage, CSP, portal static — unchanged) and by `createLocalApp` (browser: local principal, no store guard, **only the portal-facing route modules**; never admin, sessions, account-setup, integration, attachments upload, API-key routes).
   - Local principal: a fixed local user (`id` stable per browser) owning every local profile; `/v1/me` answered by the local app with `owned: true`, writer of record null, `limits` from `MAX_OWNED_PROFILES`.
   - Isomorphic shims: `globalThis.crypto.randomUUID` (Node 20 + browsers), a pure SHA-256 for idempotency fingerprints and preview tokens (e.g. `@noble/hashes`, or move preview tokens out of the route path), base64url helpers without `Buffer`. The server keeps working byte-for-byte (cursor and fingerprint formats unchanged; tests prove it).
   - Browser store: `MemoryLedgerStore` + `IndexedDbPersistence` — load once at boot; after each mutating request, persist the changed state **before** the response resolves (durable "Saved"); BigInt/Date-safe serializer.
   - **Multi-tab**: in-memory stores in two tabs diverge. Writes take `navigator.locks.request('mut-local', …)`; each request first checks a persisted `stateVersion` and reloads if another tab wrote; `BroadcastChannel('mut-local')` invalidates other tabs' TanStack caches. (SharedWorker rejected: no Chrome Android support.)
   - Mode resolver (`src/hosted/local/mode.ts`): first visit → local; sign-in → remote (persisted hint so an offline signed-in launch shows "offline", not local data); sign-out → local; **expired session (401) → a "session expired" screen with Sign in / Continue on this device**, never a silent flip to local data.
3. **Endpoint coverage table** — all 49 calls, each marked: *served by the shared route* / *served by a local-only replacement* / *not available locally (UI hides it)* / *degraded*:
   - Shared route: customers, projects, receivables, payments, income, settle, redate, expenses, expense-categories (seeded with `PERSONAL_PRESET`/`GENERAL_PRESET` by profile type), expense-groups (+ marks, summary), conversions, profiles (create/update/type-change), summaries/organization, summaries/customers.
   - Local-only replacement: `GET /v1/me` (local principal), receipts start/complete/download/delete (local blob storage, below).
   - Not available locally: sessions, me/password, account-setup, malafat-suggestions (UI hides Malafat surfaces), attachments (Documents: empty, same as a hosted owned profile; brief decides hide-vs-empty).
   - Degraded: `GET /v1/fx-rates` → local mode answers 503 `FX_RATES_UNAVAILABLE` and the group "≈" line hides (existing failure path). Keeps MUT-286's "no /v1 request signed out" AC. *Open question for the owner.*
4. **Rule ownership** — table of each rule (status, outstanding, buckets, numbering, date floor/ceiling, presets, group membership, idempotency, If-Match, cursors, cap of 6) → its owning server module (unchanged). Lazy posting: skipped locally (no-op on owned profiles; documented).
5. **Offline (MUT-288).** Load `VitePWA` in hosted mode: scope `/`, precache the app shell, `navigateFallbackDenylist` = `/v1/`, `/admin/`, `/health`, `/ready`, `/openapi.json`, `/.well-known/` (mirrors `PORTAL_EXCLUDED_*`), no runtime caching of `/v1`. Manifest for the portal. Update flow: autoUpdate, reload prompt only when no drawer is dirty.
6. **Receipts and documents.** `LocalReceiptStorage` in a separate IndexedDB object store (Blobs, not base64). `startReceipt` returns an upload target `local-receipt:<id>`; `putToSignedUrl` and `downloadNavigator` gain a local branch (Blob put; download via `<a download>` on an object URL). Same `checkFile` rules (pdf/jpeg/png, 10 MB, 10 per expense). ADR-028 holds: download only, no preview, so no CSP change.
7. **Guards to change, and the new ones that replace them.**
   - ESLint portal block: allow `src/hosted/local/**` to import `server/src/**` (browser-safe allowlist only) and IndexedDB; everything else in the portal still can't.
   - `HOSTED_RULES`: `indexedDB` allowed only in the local chunk(s); `serviceWorker` allowed only in the SW registration chunk; sign-up/reset/invite word rules stay and now also guard the server routes pulled into the bundle.
   - New: a browser-safety test (no `node:` import reachable from `createLocalApp`), a test that the server process can't mount the local principal (`createApp` has no such option), and a test that the local app registers exactly the allowlisted routes.
   - `tsconfig.hosted.json` includes the shared server modules; server typecheck unchanged.
8. **Security and privacy.** The local principal is browser-only; the server's auth is untouched. Signed-out data is "this browser's data" (the MUT-289 marker says so); a shared-computer note. No analytics in local mode (no user id; matches ADR-024). Sentry: off in local mode (ADR-091 "never local") — confirm with owner.
9. **Constraints the brief leaves for MUT-290/291.** Move (290): replay local records through the remote API with Idempotency-Keys derived from local ids (owed + settle calls for part-paid items). Bridge (291): feed the Dexie backup through `localApp` as ordinary POSTs, so validation applies for free; unmappable rows reported.
10. **Cost.** $0 infra. Bundle: local chunk loaded only when signed out; budget set by the spike. Server runtime unchanged.
11. **Test strategy.** Run the store contract suite against `MemoryLedgerStore + IndexedDbPersistence` (fake-indexeddb); a parity suite that drives the same request script through Node `createApp` + memory and through `createLocalApp` and diffs JSON responses; persistence round-trip and two-tab lock tests; the existing portal page tests run once per mode via the harness.
12. **QA scenarios** (CLAUDE.md Phase 5) for the epic: first visit lands in the app in Arabic without an account; add income/payment/expense signed out and see it after reload; works with the network off once installed; marker + upsell visible signed out only; sign in → move offered; old web app → bridge → records arrive; expired session → choice screen.
13. **Rejected options** (B, C, SharedWorker, porting the Dexie/Transaction model, Netlify proxy) with one line each.

## 3. Proving spike (timeboxed, throwaway, findings go into the brief)

In the ticket worktree, not merged:
1. Draft `createRoutes`/`createLocalApp` and build a browser bundle with Vite; record **gzip size of the local chunk** and every Node-only import that breaks the build.
2. In a browser page, run `localApp.fetch` for `GET /v1/me`, `POST /v1/income`, `GET /v1/receivables`, `GET /v1/summaries/organization`.
3. Persistence timing: 10,000 records, persist-after-write p95.

**Gates** (fail → Option B): local chunk ≤ 250 KB gzip; Node-only fixes stay inside ≤ 5 server modules with no behaviour change; persist p95 ≤ 100 ms at 10k records.

## 4. Files this ticket writes

- `.claude/designs/mut-285-portal-local-mode.md` (the brief, incl. QA scenarios section)
- `.claude/DECISIONS.md`: new ADR (next free number at write time; main is at ADR-095, check open branches), override log rows for **ADR-037 §2** (no IndexedDB / no local profiles in the portal; "no service worker") and **MUT-185 decision 1** (local app stays on the netlify origin), and a note on ADR-091 if Sentry stays off locally
- `.claude/designs/hosted-portal.md`: superseded-by notes at §2, §7.5, §8, §12
- `.claude/CHANGELOG.md`, `docs/roadmap/ROADMAP.md` (epic entry), `TECH_DEBT.md` only if the spike leaves debt
- No production code, no QA spec (docs-only ticket; QA scenarios feed MUT-286..292)

## 5. Acceptance criteria → proof

- Brief at `.claude/designs/` with a QA-scenarios section, owner-approved → §2 item 12; approval recorded on the ticket.
- ADR with both override rows → §4.
- Every endpoint covered, each server rule has an owner module → §2 items 3-4 (49/49 rows).

## Business / product impact

- Unblocks the whole one-app epic: free users get the same portal as paying users, and we stop building every feature twice (web app + portal).
- Option A makes "the same figures signed in or out" true by construction, which protects trust in the money numbers, the product's core promise.
- Risk is front-loaded into a one-day spike with hard gates, before any of MUT-286..292 starts.

---

# Eng review (plan-eng-review, 2026-10-18)

Target: `.claude/designs/mut-285-local-mode-plan.md` (this file). Reviewer: Claude (native). Outside voice: Codex not installed; native fallback attempted at the end.

## Scope Challenge

- **What already exists:** one transport funnel `request()` (`src/hosted/api/client.ts:191`); a complete second store `MemoryLedgerStore` (`server/src/repositories/memory.ts:142`) behind `LedgerStore` (`ports.ts:1355`) with a shared contract suite; injectable `store`/`now` in `createApp` (`server/src/app.ts:133`); a portal test harness that already stubs the backend at `fetch` (`src/hosted/__tests__/harness.tsx:78`). The plan reuses all four.
- **Minimum change:** this ticket writes docs only (brief, ADR + override rows, hosted-portal.md notes, CHANGELOG, ROADMAP) plus a throwaway spike. 5 files, 0 new classes, so the complexity selector is skipped.
- **Search check:** Hono runs on Web-standard APIs and is documented to run in a browser and inside a service worker (`hono/service-worker`) [Layer 1]. Safari's 7-day cap on script-writable storage (IndexedDB) applies to sites not visited in 7 days of Safari use; Home Screen apps keep their own counter; `navigator.storage.persist()` exempts from eviction, auto-approved by the browser from engagement [Layer 1, sources in chat].
- **Considered and rejected: host the local backend in the service worker** (one instance shared by all tabs, so no cross-tab locking). Rejected because (1) after a SW update the page and the backend can run different versions; (2) local mode would break wherever SWs are unavailable or not yet controlling the page (first visit before `clients.claim`, some private modes); (3) QA runs block SWs. In-page backend + Web Locks keeps UI and backend on one version.
- **TODOS.md:** nothing blocks this plan; item 14 (MUT-198, last-used profile) applies equally to local mode and is unaffected.
- **Prior learning applied:** `mutaba3a-no-store-links-before-account` (confidence 10/10, from 2026-10-14). MUT-289's "links to the app store pages" contradicts Basel's 9A on MUT-186: signed-out users have no account and the phone apps are sign-in only. Carried forward under that prior approval: MUT-289 shows phone-app availability and the /hosted request, no store links. To be noted on MUT-289.
- **Result:** scope accepted as-is.

## Decision ledger

### R1: Persisted local data has a format version and migrations
Finding: 1, P1, confidence 9/10, `server/src/repositories/memory.ts:138-143` ("In-memory LedgerStore for tests", ~33 private Maps of `ports.ts` record types) vs plan §2 "Browser store: MemoryLedgerStore + IndexedDbPersistence, load once at boot". Reviewer: Claude.
Plan baseline: original proposal; snapshot persistence with no format version or migration path.
Runtime evidence: `memory.ts` changed in recent commits for MUT-267 and MUT-270 (new maps `expGroups`, `groupMarks`, entries). The server absorbs such changes with Prisma migrations; a browser snapshot written by an older app version has no equivalent and would load wrong or crash after the next store change.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 persisted format | unversioned snapshot | versioned snapshot + ordered migrations + shape-fingerprint CI test + newer-format write refusal | append-only request log replayed through current routes at boot | unversioned snapshot (as written) |
| R2 durability | pending | pending | pending | pending |
| R3 FX locally | pending | pending | pending | pending |
Question D1:
D1 — How does saved local data survive future app updates?
Project/branch/task: main, planning MUT-285 (portal local mode brief).
ELI10: Signed-out records will live in the browser in the server's in-memory store format. That format changes almost every time we add a feature (expense groups changed it twice this week). On the server, database migrations upgrade old data; in the browser nothing would, so an update could make someone's saved records unreadable.
Stakes if we pick wrong: a routine release silently corrupts or loses a free user's money records with no backup.
Recommendation: A because it is the same discipline the server already follows, enforced by a test so nobody forgets.
Completeness: A=10/10, B=7/10, C=3/10
Pros / cons:
A) Versioned snapshot + migrations (recommended)
  ✅ Each saved snapshot says which format it is; ordered migrations upgrade it on load, like Prisma migrations do on the server.
  ✅ A CI test fingerprints the persisted record types and fails when they change without a new version and migration.
  ❌ Every store change now also needs a small browser migration; human ~2 days / CC ~1 h to set up.
B) Rebuild by replaying a request log
  ✅ No migrations: boot replays every saved POST/PATCH/DELETE through the current routes, so the API contract is the format.
  ✅ Old data automatically gains new derived fields and rules.
  ❌ A rule tightened later (e.g. the 10-year date floor) can reject old entries on replay, and boot time grows with history.
C) Unversioned snapshot as planned
  ✅ Least code now; nothing extra in the brief.
  ❌ The first store change after launch breaks or corrupts existing local data, with no recovery path.
Net: a little migration discipline per store change versus risking every free user's data on each release.
Header: Local data format
Options:
A) Versioned + migrations (recommended)
Snapshot carries formatVersion; ordered migrations in src/hosted/local run on load; CI shape-fingerprint test fails on an unversioned change; an older tab seeing a newer format refuses to write and asks to reload. Human ~2 days / CC ~1 h. Low risk, small per-change upkeep.
B) Replay a request log
Persist mutating requests and rebuild the store by replaying them through current routes at boot. No migrations, but later rule changes can reject old entries and boot slows as history grows. Human ~3 days / CC ~2 h.
C) Unversioned snapshot
Keep the plan as written. No extra work now; the first store change after launch can break existing local data. Human 0 / CC 0.

State: approved
Actual answer: A) Versioned + migrations (recommended), Basel's answer to D1, 2026-10-18
Accepted scope: the brief specifies a persisted snapshot carrying `formatVersion`; ordered migrations under `src/hosted/local/` run on load; a CI test fingerprints the persisted record types and fails when they change without a new format version and migration; a tab running older code that finds a newer format refuses to write and asks to reload. Built in MUT-286.
History: none

### R2: Local data survives browser storage eviction
Finding: 2, P1, confidence 7/10 (web sources, not code), plan §2 "Browser store: MemoryLedgerStore + IndexedDbPersistence" and epic decision 4 ("no feature catch-up", so the old app's JSON backup `src/utils/backupDownload.ts:9-33` goes away with it). Reviewer: Claude.
Plan baseline: original proposal; IndexedDB only, no persistence request, no export.
Runtime evidence: Safari caps script-writable storage (IndexedDB included) at 7 days without a visit for sites opened in Safari; Home Screen apps keep their own counter; `navigator.storage.persist()` exempts an origin from eviction and is auto-granted from engagement (MDN, WebKit Bugzilla). Unknown: whether `persist()` also lifts the Safari 7-day cap; the spike checks it.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 persisted format | approved: versioned + migrations (D1) | same | same | same |
| R2 durability | IndexedDB only | `persist()` + "Download my records" file + restore from file + marker copy | `persist()` + marker copy warning only | IndexedDB only (as written) |
| R3 FX locally | pending | pending | pending | pending |
Question D2:
D2 — What protects signed-out records from the browser deleting them?
Project/branch/task: main, planning MUT-285 (portal local mode brief).
ELI10: Browsers may delete a site's stored data. Safari does it after 7 days without a visit unless the app is on the Home Screen, and any browser can when disk is low or the user clears site data. Today's free app has a JSON backup; the one-app epic drops it with the web app, so signed-out records would have no copy anywhere.
Stakes if we pick wrong: a free user who skips a week in Safari opens the app to find every record gone, with no way back.
Recommendation: A because a file the user can keep is the only copy that survives eviction, and it reuses the R1 snapshot format.
Completeness: A=10/10, B=6/10, C=3/10
Pros / cons:
A) persist() + download and restore (recommended)
  ✅ Asks the browser to keep the data (`navigator.storage.persist()`), and gives a "Download my records" file plus "Restore from file".
  ✅ The file is the R1 versioned snapshot, so old downloads still restore through the same migrations.
  ❌ Adds two small actions to MUT-286 that the "no catch-up" decision left out; human ~2 days / CC ~1.5 h.
B) persist() and a warning only
  ✅ One call at first save plus marker copy saying records live only in this browser.
  ✅ No new screens or file formats to maintain.
  ❌ If the browser still evicts (Safari cap, cleared site data), the records are gone for good.
C) Nothing extra
  ✅ No work.
  ❌ Same loss as B, without even the warning or the persistence request.
Net: two small actions versus an unrecoverable loss the free tier did not have before.
Header: Storage eviction
Options:
A) persist() + download/restore (recommended)
Request persistent storage on first local save; add "Download my records" (the R1 versioned snapshot as a file) and "Restore from file" in Settings; the marker copy says records live in this browser. Lands in MUT-286. Human ~2 days / CC ~1.5 h.
B) persist() + warning only
Request persistent storage and warn in the marker copy; no download or restore. Human ~2 h / CC ~15 min. Eviction is still unrecoverable.
C) Nothing extra
Keep the plan as written: IndexedDB only. Human 0 / CC 0. Eviction is unrecoverable and unannounced.

State: approved
Actual answer: A) persist() + download/restore (recommended), Basel's answer to D2, 2026-10-18
Accepted scope: the brief specifies `navigator.storage.persist()` requested on the first local save; Settings gains "Download my records" (the R1 versioned snapshot as a file) and "Restore from file" (through the R1 migrations); the MUT-289 marker copy says records live in this browser. Lands in MUT-286 (its AC to be amended on the ticket). The spike checks whether `persist()` lifts Safari's 7-day cap.
History: none

### R3: Expense-group "≈ in your base currency" line when signed out
Finding: 3, P2, confidence 9/10, `server/src/routes/fx-rates.ts:26` `security: [{ session: [] }, { deviceSession: [] }]` (session-only; rates fetched server-side from Frankfurter), used only by `useFxRates` → `ExpenseGroupDetail.tsx:492`; plan §2 item 3 proposes "Degraded" plus MUT-286 AC "Signed-out mode makes no /v1 requests". Reviewer: Claude.
Plan baseline: original proposal; local mode answers 503 `FX_RATES_UNAVAILABLE`, the line hides.
Runtime evidence: the portal already hides the line on an FX failure (`useFxRates` retry false). Basel's intake answer: "signed out portal and signed in portal are the same".
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 persisted format | approved (D1) | same | same |
| R2 durability | approved (D2) | same | same |
| R3 FX locally | line hidden signed out; no /v1 call | add anonymous `GET /v1/public/fx-rates` (rate-limited, no profile, same cache); local mode calls it when online; MUT-286 AC allows exactly this call | line hidden signed out (as written) |
Question D3:
D3 — Should signed-out users see the "≈ in your base currency" total on expense groups?
Project/branch/task: main, planning MUT-285 (portal local mode brief).
ELI10: One small line on the expense-group page converts the group's total into your base currency using today's market rates. Those rates come from our server, and the server only answers signed-in people. Signed out, the line would simply be missing, unless we open a public, read-only rates address that carries no personal data.
Stakes if we pick wrong: either signed-out users see a slightly smaller app than you asked for, or we open a public server route we then have to rate-limit and keep.
Recommendation: A because you asked for signed out and signed in to be the same, and the rates carry no personal data.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Public rates route (recommended)
  ✅ Signed-out users online see the same ≈ line as signed-in users; offline it hides exactly as today.
  ✅ Rates are public market data (ECB plus the JOD peg), so the route exposes nothing about anyone.
  ❌ A new public route to rate-limit and keep; MUT-286's "no /v1 requests" AC gains one named exception; human ~1 day / CC ~30 min.
B) Hide the line signed out
  ✅ No server change; signed-out mode never talks to our server at all.
  ✅ Reuses the failure path the portal already has.
  ❌ Signed-out users never see the converted total, a visible difference from signed in.
Net: one small public read-only route versus a visible gap between the two modes.
Header: FX signed out
Options:
A) Public rates route (recommended)
Add anonymous GET /v1/public/fx-rates (rate-limited, no profile header, same in-process cache); the local backend calls it when online and hides the line offline. MUT-286 AC allows exactly this call. Human ~1 day / CC ~30 min.
B) Hide the line signed out
Local backend answers 503 FX_RATES_UNAVAILABLE and the line hides, as the plan says. No server change; signed-out mode makes no /v1 calls. Human 0 / CC 0.

State: approved
Actual answer: A) Public rates route (recommended), Basel's answer to D3, 2026-10-18
Accepted scope: the brief specifies an anonymous `GET /v1/public/fx-rates` (rate-limited, no profile header, same in-process cache as `/v1/fx-rates`); the local backend calls it when online and the line hides offline; MUT-286's "no /v1 requests signed out" AC gains exactly this one named exception. Server route built in MUT-287 (expense groups signed out), with openapi:check and tests.
History: none

Approval readiness: PASS (R1 ← D1 answer A; R2 ← D2 answer A; R3 ← D3 answer A; MUT-289 no-store-links ← Basel's 9A on MUT-186, prior learning `mutaba3a-no-store-links-before-account`).

## Section 1 — Architecture

- [P1] (confidence: 9/10) `server/src/repositories/memory.ts:138-143` — persisted local data had no format version or migrations. **R1, approved (D1 A).**
- [P1] (confidence: 7/10) plan §2 "Browser store: … IndexedDB" — browser eviction (Safari 7-day cap, cleared site data) would lose signed-out records with no copy. **R2, approved (D2 A).**
- [P2] (confidence: 9/10) `server/src/routes/fx-rates.ts:26` `security: [{ session: [] }, { deviceSession: [] }]` — the ≈ line could not work signed out. **R3, approved (D3 A).**
- [P2] (confidence: 9/10) `memory.ts:138-141` "In-memory LedgerStore for tests. Mirrors every uniqueness constraint…" — Option A promotes a test double to production for local mode. Its two known divergences from Prisma (expense filter `unlinked`+`customerId`, receivable `createdAt`) become visible differences between modes. Clarification of the plan's own parity commitment (§2 item 11), no new behavior: the brief lists both, the parity suite covers them, and the ADR states the memory store is now production code for local mode.
- [P2] (confidence: 8/10) `memory.ts:143-178` holds state in ~33 `private readonly` Maps — persistence cannot snapshot it from outside. Implementation detail of R1: `MemoryLedgerStore` gains `snapshot()`/`restore()`, and R1's shape fingerprint derives from that snapshot type. Ephemeral maps (`sessionsById`, `setupLinks`, `keys`, `events`) are excluded.
- [P2] (confidence: 8/10) plan §2 "createLocalApp (browser: local principal…)" — clarification of §2 item 7 ("server process can't mount the local principal"): `createLocalApp` and the local principal live under `src/hosted/local/`, never `server/src/`, and an ESLint rule stops `server/src/**` importing `src/**`. The server's auth, store guard (`app.ts:147` `contextStorage`) and route-security test stay as they are.

Dispositions: R1/R2/R3 accepted (D1-D3). The three clarifications go into the brief under existing plan commitments.

## Section 2 — Code quality

- [P2] (confidence: 9/10) `server/src/app.ts:133` `createApp` registers routes and cross-cutting middleware together — extracting `createRoutes(app, deps)` must land first as a behavior-preserving server refactor with the full server suite green (`npm --prefix server test`, `openapi:check`), before any browser code. Build-order note for MUT-286; it changes no behavior.
- [P3] (confidence: 7/10) `server/src/idempotency.ts` fingerprints with synchronous `createHash` — Web Crypto's `subtle.digest` is async. The brief prefers a small pure synchronous SHA-256 (e.g. `@noble/hashes`) over making `fingerprint` async, with a test that fingerprints are byte-identical to today's. The spike confirms it.
- No diagrams in touched files are stale (docs-only ticket).

Dispositions: both go into the brief as build-order and spike notes; no new behavior, no question needed.

## Section 3 — Tests

Framework: Vitest (unit + Dexie integration side by side), Playwright for release-QA; server: its own Vitest suite plus `test:db`. MUT-285 itself ships docs only. The diagram below covers the codepaths the brief commits MUT-286..288 to.

```
CODE PATHS (proposed, MUT-286..288)                   USER FLOWS
[+] src/hosted/api/client.ts request()                [+] First visit, signed out
  ├── mode=remote → fetch                [EXISTING ★★★]  ├── [GAP] [→E2E] lands in app, Arabic, no sign-in
  └── mode=local  → localApp.fetch       [GAP]           └── [GAP] [→E2E] add income → reload → still there
[+] src/hosted/local/mode.ts                           [+] Session transitions
  ├── first visit → local                [GAP]           ├── [GAP] [→E2E] sign in → remote data, local hidden
  ├── signed-in hint + offline → offline [GAP]           ├── [GAP] sign out → local data back
  └── 401 expired → choice screen        [GAP]           └── [GAP] [→E2E] expired session → choice screen
[+] createRoutes / createLocalApp                      [+] Two tabs
  ├── server createApp unchanged         [EXISTING ★★★]  └── [GAP] write in tab A visible in tab B, no lost write
  ├── local app registers allowlist only [GAP]
  └── local principal never in server    [GAP]          [+] Durability
[+] persistence (snapshot/restore, R1)                   ├── [GAP] Download my records → Restore → same totals
  ├── load + migrate older formatVersion [GAP]           └── [GAP] newer format in old tab → refuse write
  ├── persist before response resolves   [GAP]
  ├── Web Locks + stateVersion reload    [GAP]          [+] Offline (MUT-288)
  └── shape fingerprint CI test          [GAP]           └── [GAP] [→E2E] installed, network off, save works
[+] LocalReceiptStorage                  [GAP]
[+] GET /v1/public/fx-rates (R3)         [GAP]
[+] store contract suite vs persisted    [GAP]

COVERAGE (proposed code): 2/20 paths covered today (the existing server and remote paths)
GAPS: 18, 6 of them E2E. All are requirements for MUT-286..288; MUT-285 adds no code.
```

Required tests (each passes the value bar; they go into the brief's test strategy):
1. **Store contract suite against `MemoryLedgerStore` + persistence round-trip**: extend `server/src/repositories/__tests__/store-contract*.ts` with a variant that snapshots and restores between operations. Value: protects=persisted state equals live state; fails_when=a Map is left out of snapshot/restore; why_new=no persistence exists; seam=none.
2. **Parity suite** (`src/hosted/local/__tests__/parity.test.ts`): one request script through Node `createApp`+memory and through `createLocalApp`, diffing JSON. Value: protects=same figures signed in/out; fails_when=the local principal or route allowlist changes a response; why_new=no local app exists; seam=none.
3. **Format migrations + shape fingerprint** (R1). Value: protects=old snapshots load after a store change; fails_when=a record type changes without a migration; why_new=new format; seam=none.
4. **Two-tab lock test** (fake Web Locks + two backends on one IndexedDB). Value: protects=no lost write across tabs; fails_when=a write skips the lock or the stale reload; why_new=new concurrency path; seam=none.
5. **Route allowlist + server isolation**: the local app registers exactly the allowlisted routes; `server/src` cannot import `src/**` (lint test). Value: protects=no admin/session routes in the bundle, no local principal in the server; fails_when=a route module is added to the wrong list; why_new=new boundary; seam=none.
6. **Public FX route** (server): rate-limited, no profile, same cache. Value: protects=anonymous read only; fails_when=it accepts a profile or bypasses the limit; why_new=new route; seam=none.
7. **Release-QA specs** for the QA scenarios in brief §12 (portal app), one tagged spec per scenario.
8. **Regression (CRITICAL)**: the existing portal page tests (`src/hosted/pages/__tests__/views.test.tsx`) and `server/src/__tests__/portal.test.ts` stay green unchanged in remote mode. The CSP string changes only if a later decision needs `blob:`; R2's download uses `<a download>`, which needs none.

Tests made obsolete: `scripts/__tests__/check-bundles.test.ts:48-50` (indexedDB, Dexie and serviceWorker flagged anywhere in dist-hosted) and `scripts/__tests__/hosted-lint.test.ts` probes for `dexie`. Rewritten to the narrower rules, not deleted.

Test plan artifact: written to the gstack project dir (path in chat).

Dispositions: tests 1-8 are required proof of the approved plan and R1-R3; no optional depth choices.

## Section 4 — Performance

- [P2] (confidence: 7/10) plan §2 "after each mutating request, persist the changed state before the response resolves" — a whole-snapshot write costs O(total records) per save. Scale: a heavy freelancer has about 2-10k records. The spike gate (p95 ≤ 100 ms at 10k) bounds it; if it fails, persist per-Map dirty sets instead of the whole snapshot. Receipts (up to 10 MB each) live in their own object store and are never in the snapshot.
- [P3] (confidence: 6/10, medium confidence, verify) Summaries load every receivable and payment per request (`routes/summaries.ts:192` `listAll`). In memory at 10k rows this is a few ms. Unknown until the spike measures it.
- [P3] (confidence: 7/10) Bundle: `@hono/zod-openapi` carries OpenAPI metadata strings into the local chunk. The lazy chunk keeps it off the signed-in path; the spike's 250 KB gzip gate bounds it.

Dispositions: covered by the existing spike gates; no new choice.

## Outside voice

Codex CLI not installed (`CODEX_MODE: not_installed`). Native fallback needs TaskOutput, which this session's tools do not include, so it took the unavailable path. Outside voice unavailable: missing coverage, not a clean result.

## NOT in scope
- Building any of MUT-286..292 (this ticket writes the brief and ADR only).
- Hosting the local backend in a service worker (rejected in Scope Challenge).
- Sentry in local mode (stays off per ADR-091; the brief records it).
- Local↔hosted sync (MUT-73).

## What already exists
`request()` funnel (`client.ts:191`), `MemoryLedgerStore` + contract suite, injectable `createApp` deps, `stubApi` harness, `crossRates` (pure) for the public FX route, `checkFile` receipt rules, presets — all reused, none rebuilt.

## Failure modes
| New path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| persistence | tab closed mid-write | persist-before-response + lock | the save never showed "Saved", so they retry |
| app update | store shape changed | R1 migrations + fingerprint test | nothing; data upgraded |
| eviction | Safari 7-day cap | R2 persist() + file | they restore from the file |
| two tabs | concurrent writes | Web Locks + stateVersion | both writes kept |
| session expiry | 401 mid-session | choice screen | Sign in / Continue on this device |
| public FX | rate limit or outage | existing failure path | line hides |
Critical gaps: 0.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity (docs-only ticket; the spike feeds the brief).

## Implementation Tasks
- [ ] **T1 (P1, human: ~1 day / CC: ~45min)** — spike — prove Option A against the gates
  - Surfaced by: plan §3 gates; Section 2 SHA-256 note; Section 4 bundle and persist notes; R2 Safari check
  - Files: throwaway branch only
  - Verify: gzip size, Node-import list, p95 persist time at 10k, `persist()` behaviour in Safari, recorded in the brief
- [ ] **T2 (P1, human: ~1 day / CC: ~45min)** — brief — write `.claude/designs/mut-285-portal-local-mode.md`
  - Surfaced by: plan §2 outline + R1/R2/R3 + Section 1-4 clarifications + QA scenarios
  - Files: `.claude/designs/mut-285-portal-local-mode.md`
  - Verify: 49/49 endpoints covered; every rule has an owner module; owner approval on the ticket
- [ ] **T3 (P1, human: ~2h / CC: ~15min)** — ADR — new ADR + override rows (ADR-037 §2 incl. "no service worker"; MUT-185 decision 1) + ADR-091 local-mode note; hosted-portal.md superseded notes; CHANGELOG; ROADMAP
  - Surfaced by: ticket AC
  - Files: `.claude/DECISIONS.md`, `.claude/designs/hosted-portal.md`, `.claude/CHANGELOG.md`, `docs/roadmap/ROADMAP.md`
  - Verify: both override rows present; ADR number free on main and open branches
- [ ] **T4 (P2, human: ~30min / CC: ~5min)** — tickets — amend MUT-286 AC (R2 download/restore, R3 FX exception), MUT-287 (public FX route), MUT-289 (no store links)
  - Surfaced by: R2, R3, prior learning
  - Files: Jira comments
  - Verify: comments read back

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Architecture Review: 6 issues found
- Code Quality Review: 2 issues found
- Test Review: diagram produced, 18 gaps identified (all requirements for MUT-286..288)
- Performance Review: 3 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback lacked TaskOutput)
- Parallelization: 0 lanes, 0 parallel / 1 sequential
- Lake Score: 3/3

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 39 | unavailable | CLI not installed; native fallback lacked TaskOutput |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 39 | ISSUES OPEN | 29 issues (11 findings + 18 test gaps for MUT-286..288), 0 critical gaps; R1-R3 approved, the rest folded into the brief |
| Design Review | `/plan-design-review` | UI/UX gaps | 9 | not run for this plan | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (CLI not installed; native fallback unavailable). No outside findings.
- **VERDICT:** no review CLEAR for this plan; eng review issues are all dispositioned (3 approved decisions, 8 clarifications/notes), status issues_open by rule because issues were found. Ready to write the brief (MUT-285 T1-T4).

NO UNRESOLVED DECISIONS
