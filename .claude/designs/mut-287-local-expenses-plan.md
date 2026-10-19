# MUT-287 — Signed out: expenses, groups, conversions, receipts and documents on this device

**Epic:** MUT-284 (one app). **Blocked by:** MUT-286, merged to local main 5e174786 (In Review). Gate clear.
**Authoritative design:** `.claude/designs/mut-285-portal-local-mode.md` §2.3.5, §6, §7, §12; ADR-097, ADR-100.
**Status:** built 2026-10-19 on `feature/mut-287-local-expenses` (eng review D1–D4 applied; see ADR-100 decision 11).

## 0. What already exists (from MUT-286 / MUT-318)

- `PORTAL_ROUTES` already registers expenses, expense-categories, expense-groups, conversions, attachments and fx-rates in the local app. Every expense, group and conversion **route** already runs signed out.
- Four things stop them working:
  1. `createLocalApp` passes `attachments.storage: null` and `fxRates: null`. Receipt routes answer 503 `ATTACHMENTS_NOT_CONFIGURED`. **`GET /v1/attachments` calls `storage()` too (`server/src/routes/attachments.ts:101`), so Documents shows an error signed out today, not the empty state.**
  2. `HostedShell.tsx:35` `HOSTED_ONLY_SECTIONS` hides Expenses and Conversions signed out.
  3. The two off-API flows assume a real URL. `putToSignedUrl` (`data/expenseQueries.ts:110`) does a bare `fetch` PUT. `downloadNavigator.open` (`data/download.ts`) navigates with `location.assign`.
  4. There is no `GET /v1/public/fx-rates` (D3).
- IndexedDB `mut-local` is at `DB_VERSION = 1` and has only the `state` store. There is no `blobs` store yet.
- ~~MUT-286 hasn't shipped~~ **Corrected in eng review (R1):** MUT-286 (`5e174786`) is in `origin/main` and tag `api-v0.3.14`, so devices may already hold a v1 `mut-local` DB. Receipts therefore go in a **separate** database `mut-local-blobs`; `mut-local` is never upgraded by this ticket.

## 1. Changes by layer

### 1a. Server: `GET /v1/public/fx-rates` (D3)

- `server/src/routes/fx-rates.ts`: a new `publicFxRateRoutes({ rates, ipLimiter, trustedProxyHops })`. **It is not in `PORTAL_ROUTES`:** the portal client never calls it, and the local app must not serve it.
  - `security: []`, so the route-access index marks it public. `authenticate()` and `requireMinimumBuild` already skip public routes.
  - No profile header.
  - Per-IP `SlidingWindowRateLimiter`, keyed `public-fx:${clientIp(...)}`. It sets `Retry-After` and returns 429 `RATE_LIMITED`, the same pattern as `account-setup.ts:49`.
  - It reads the same `CachedFxRates` instance as `/v1/fx-rates`, so it makes no extra Frankfurter calls.
  - Response `PublicFxRatesResponseSchema` (`schemas.ts`): `{ rateDate, perEur: { USD, ILS }, fetchedAt, source }`. That is the raw ECB snapshot. `crossRates` runs on the caller's side, so the JOD peg and rounding live in one place.
  - With `rates` null, or nothing servable, it returns 503 `FX_RATES_UNAVAILABLE`.
- `server/src/app.ts`: register it after the auth middleware, with `deps.publicFxIpLimiter ?? new SlidingWindowRateLimiter(PUBLIC_FX_POLICY.ipPerMinute)`.
  - `PUBLIC_FX_POLICY = { ipPerMinute: 30 }` sits beside `SIGN_IN_POLICY`. A tab asks at most about once an hour (see 1c).
- `API_VERSION` → `1.37.0-mut287`. Run `npm --prefix server run openapi:generate` and commit the spec.
- This is additive only, so no Flutter contract change.

### 1b. Local backend: receipts in IndexedDB

- **`src/hosted/local/blobStore.ts`** (new, per R1): `IndexedDbBlobStore` over database `mut-local-blobs` v1, store `blobs`. Methods: `put(key, blob)`, `get(key)`, `delete(keys)`, `keys()`, `all()`. `persistence.ts` (`mut-local`, `DB_VERSION = 1`) is unchanged.
  - **Restore ordering (R1):** add the file's blobs, save the snapshot, then delete blobs no live receipt references. A crash at any point leaves a consistent snapshot whose receipts still have their blobs.
- **`src/hosted/local/attachments.ts`** (new): `LocalAttachmentStorage implements AttachmentStorage`. It uses `import type` only. `storage.ts` imports `@google-cloud/storage` at runtime, and that must never reach the chunk.
  - `signUpload` returns `{ url: 'local-blob:<key>', headers: { 'Content-Type': mime }, expiresAt }`.
  - `signDownload` returns `{ url: 'local-blob:<key>' }`.
  - `head(key)` reads the Blob's `size` and `type` from IndexedDB, or `null`. The route's existing size/type check (`UPLOAD_MISMATCH`) then runs unchanged.
  - `remove(key)` **stages** the key and doesn't delete. `flushRemovals()` deletes the staged keys and is called by `transport.ts` only after the snapshot save completes. If the save fails, the receipt stays on disk with its blob intact. `discardRemovals()` runs on a failed or non-2xx request.
- **`src/hosted/local/transport.ts`**: after a 2xx mutating request persists, call `attachments.flushRemovals()` **inside the same `withLock` callback, right after `persistence.save`** (eng review, Architecture). Otherwise call `discardRemovals()`. The boot sweep and the Restore sweep also run under the lock.
- **`src/hosted/local/index.ts`**
  - Build `LocalAttachmentStorage` over the same `IndexedDbPersistence` and pass it to `createLocalApp`.
  - **Boot sweep:** delete blobs whose key belongs to no live (non-deleted) receipt in the restored snapshot. This covers a crash between save and flush, and a PUT whose start request was never saved.
  - Extend `LocalBackend` with:
    - `putBlob(url, file)`: refuses a URL that isn't `local-blob:`. A `QuotaExceededError` becomes a thrown `LocalSaveFailedError`-style error, and the drawer shows its existing `uploadFailed` toast.
    - `readBlob(url)`: returns `Blob | null`.
- **`src/hosted/local/createLocalApp.ts`**: accept `attachments: AttachmentStorage` and `fxRates: CachedFxRates` options. Update the doc comment, which currently says "MUT-287 wires both".
- **`src/hosted/session/localBackendContract.ts`**:
  - `LOCAL_BLOB_SCHEME = 'local-blob:'` and `isLocalBlobUrl(url)`, shared by the portal and the chunk;
  - `putBlob` and `readBlob` on `LocalBackend`.
- **`eslint.config.js`** `LOCAL_SERVER_ALLOWLIST`: add `fx-rates` and `attachments/storage`. The latter is type-only, so confirm the bundle doesn't pull in GCS (see 1f).

### 1c. Local backend: FX (D3)

- **`src/hosted/local/fxSource.ts`** (new): `PublicFxRateSource implements FxRateSource`.
  - The fetch is `fetch('/v1/public/fx-rates', { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000) })`.
  - It parses with the server's `PublicFxRatesResponseSchema` and maps to `EcbSnapshot`.
  - It uses the global `fetch` directly, never `api/client.ts`. Local mode routes every `/v1` call to the in-page backend, which would loop.
- `index.ts` builds `new CachedFxRates({ source, ttlMs: 60 min, now })`, so the server's `isUnservable` 7-day guard and backoff run unchanged.
  - Offline, the source throws, `CachedFxRates` refuses with 503, and the ≈ line hides through the existing failure path (`useFxRates` has `retry: false`; ADR-095 §5).
- **Known nuance (document it, don't fix it):** a `stale` answer from the server becomes `live` locally, because `FxRateSource.latest()` returns only the snapshot. The ≈ label shows `rateDate`, which stays honest.

### 1d. Portal: off-API flows and nav

- `data/expenseQueries.ts` `putToSignedUrl`: if `isLocalBlobUrl(url)`, run `(await localBackend()).putBlob(url, file)`. Otherwise do the existing `fetch`.
- `data/download.ts` `downloadNavigator.open(url, filename)`: if `isLocalBlobUrl`, `readBlob` → `URL.createObjectURL` → a temporary `<a download={filename}>` click → `revokeObjectURL` on the next tick.
  - A null blob throws, and the caller's existing `downloadFailed` toast shows.
  - ADR-028 holds: download only, no preview, no CSP change.
  - The callers `ReceiptUploader.tsx:57` and `DocumentsList.tsx:61` pass the `filename` that the download response already carries.
- `shell/HostedShell.tsx`: delete `HOSTED_ONLY_SECTIONS` and its filter, so both modes show the same nav (epic decision 4).

### 1e. Records file (D2; format per eng review R2)

- Download produces **`mutaba3a-records-<date>.zip`**: `records.json` (the MUT-286 records file, unchanged) plus one `receipts/<key>` entry per stored blob, written as binary.
- jszip (already a root dependency, `src/lib/zipExport.ts`) is loaded by **dynamic import only on Download or Restore**, so the `mut-local` chunk does not grow. `test:bundles` checks it stays out of the entry and `mut-local` chunks.
- Restore sniffs the first bytes: `PK` → zip, otherwise the MUT-286 `.json` (still accepted). A zip whose receipt entry is missing restores the records and logs the gap (that receipt's download then shows the existing `downloadFailed` toast).
- Restore ordering follows R1: add blobs, save snapshot, sweep.
- `countRecords` is unchanged. Receipts belong to expenses and aren't counted separately in the confirm. The file picker's `accept` becomes `.zip,.json`.
- No `LOCAL_FORMAT_VERSION` bump: the snapshot's shape does not change.

### 1f. Guards

- `scripts/bundle-rules.ts` / `test:bundles`:
  - the `mut-local` chunk contains no `@google-cloud/storage`;
  - it stays ≤ 250 KB gzip (today 112.7 KB);
  - `indexedDB` is still only in that chunk.
- The no-network invariant gets **exactly one** named exception: `GET /v1/public/fx-rates`, without credentials, sent only while the ≈ line is wanted.

## 2. Tests (TDD: written first)

| AC | Test | File |
|---|---|---|
| AC1 expenses | create, edit and delete an expense; categories seed; list/summary through `api.*` in local mode | `src/hosted/local/__tests__/expenses-local.test.ts` (new, real chunk + fake-indexeddb, like `no-network.test.ts`) |
| AC1 groups | create a group, summary, mark/unmark, delete | same file |
| AC1 conversions | create, update, delete, list | same file |
| AC1 nav | signed out, the nav shows Expenses and Conversions (flip of `local-mode.test.tsx:140`) | `src/hosted/session/__tests__/local-mode.test.tsx` |
| AC2 receipts | start → `putBlob` → complete → READY; a reload (new backend, same IDB) still downloads the same bytes; a size mismatch gives 422 `UPLOAD_MISMATCH`; deleting the expense removes the blob only after the save; a failed save keeps the blob; the boot sweep removes orphans | `src/hosted/local/__tests__/receipts.test.ts` (new); `attachments.test.ts` (unit) |
| AC2 file | export → restore round-trip keeps receipt bytes; an old file with no `blobs` restores | `recordsFile.test.ts` |
| AC2 portal | `putToSignedUrl` / `downloadNavigator` local branches (anchor download with the filename; null blob throws) | `src/hosted/data/__tests__/download.test.ts`, `expenseQueries` test |
| AC3 documents | signed out, `GET /v1/attachments` returns 200 with an empty page, and Documents renders its empty state | `expenses-local.test.ts` + `DocumentsList` test |
| AC4 network | the existing no-network session, extended with expenses, receipts, groups and conversions: zero fetches. A group in 2 currencies: exactly one fetch, to `/v1/public/fx-rates`, with `credentials: 'omit'` | `no-network.test.ts` |
| D3 server | public route: 200 without a session or profile header; 429 + `Retry-After` past the limit; 503 when rates are null; same cache instance (one source call for both routes); public in the route-access index | `server/src/__tests__/fx-rates-public.test.ts` |
| D3 local | `PublicFxRateSource` parses and maps, fails on non-2xx, a bad body or a redirect; offline → 503 → ≈ hidden | `src/hosted/local/__tests__/fxSource.test.ts` |
| parity | add expense, receipt, group and conversion steps to the Node-vs-local parity script | `parity.test.ts` |
| R1 | a seeded v1 `mut-local` (with records) opened by the new build keeps its data and creates `mut-local-blobs`; Restore that fails after the blob write leaves the old records and their receipts downloadable | `src/hosted/local/__tests__/blobStore.test.ts` (new), `recordsFile`/Restore test |
| R2 | zip round-trip keeps receipt bytes; a MUT-286 `.json` still restores; a zip missing a receipt entry restores the records; jszip is absent from the entry and `mut-local` chunks | `recordsFile.test.ts`, `check-bundles.test.ts` |
| R3 | every key of `LocalSnapshotMaps` has a fingerprint case built from a real record (TD-171 resolved) | `format-fingerprint.test.ts` |
| contract | the local app does not serve `/v1/public/fx-rates` (404) | `createLocalApp.test.ts` |

Gate (Node 22): `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`, `npm run test:bundles`, plus the server's `typecheck`, `lint`, `openapi:check` and `test`.

## 3. Release-QA (portal)

`qa/features/portal/local-mode.yaml` + `qa/specs/portal/local-mode.spec.ts`:
- **first-visit:** the expectation flips to "the nav has Expenses and Conversions".
- **download-restore:** the download is now `mutaba3a-records-<date>.zip` (R2).
- **`expense-receipt`** (core): add an expense signed out, attach a PDF, reload, download. The file saves with its name, and no request reaches the server.
- **`fx-line`** (secondary): signed out, a group with expenses in ILS and USD. The ≈ line shows with the fixture's rate date. With `/v1/public/fx-rates` aborted (offline), the line hides. The spec routes that path to a fixture and asserts it is the only server request after the first-visit check.
- **`conversion`** (secondary): add a conversion signed out, reload, edit it.
- **`documents-empty`** (secondary): Documents signed out shows the empty state, not an error.
- `paths` cover `local/attachments.ts`, `local/fxSource.ts`, `data/download.ts`, `data/expenseQueries.ts` and `shell/HostedShell.tsx`. Run via the gitignored preview config (see memory: QA on preview builds; `MUTABA3A_POSTHOG_KEY` dummy). `release-qa lint` must be clean.

## 4. Knowledge files

- ADR-100 gets new decisions, numbered from the next free one at build time:
  - `local-blob:` URLs and the off-API branches;
  - removal deferred until after the save, plus the boot sweep;
  - the records file carries base64 blobs;
  - the public FX route's shape and limit, and the one no-network exception.
- CHANGELOG, SYSTEM_OVERVIEW (delete "Expenses and Conversions arrive locally with MUT-287"), TEST_PLAN, COMPONENT_REGISTRY (none new).
- TECH_DEBT: zip instead of base64 if records files grow large; `stale`→`live` FX label; TD-171 status.

## 5. Decisions for Basel

1. **Records file with receipts.** Decided in eng review R2 (D3): `.zip` with `jszip` loaded lazily.
2. **TD-171 fingerprint.** Decided in eng review R3 (D4): every map in `LocalSnapshotMaps` gets a case, plus an every-key assertion; TD-171 resolved.
3. **Format version bump.** Not needed: the snapshot shape is unchanged and receipts live in a separate database (R1).

## 6. Out of scope (neighbors)

- MUT-319: the expense drawer opens in USD, not the profile currency. It affects signed-out users once Expenses shows, but it's its own bug.
- MUT-289 marker/upsell, MUT-290 move-on-sign-in, MUT-288 offline/PWA.
- **MUT-290 constraint:** it will replay receipts through the remote API and needs `readBlob(key)`. Keep that on `LocalBackend`.

---

# Eng review (plan-eng-review, 2026-10-19)

Target: `.claude/designs/mut-287-local-expenses-plan.md` (this file). Source of truth for the design: `.claude/designs/mut-285-portal-local-mode.md`. The design doc the gstack helper found (`basel-main-design-20260524`, recording-flow redesign) is unrelated and was not used.

## Scope record

feature answers: none proposed (every item maps to an AC or binding D2/D3); structure: A Original arrangement (D1, 2026-10-19); accepted scope: plan §1–§4 as written, pending remedies applied only as approved; pending remedies: R1, R2, R3, R4.

## Decision ledger

### R1: How receipts' storage arrives on devices that already hold a v1 `mut-local` database
Finding: 1, P1, confidence 9/10, `.claude/designs/mut-287-local-expenses-plan.md:15` (premise "MUT-286 hasn't shipped") + `src/hosted/local/persistence.ts:44` (`indexedDB.open(this.dbName, DB_VERSION)` with no `onblocked`/`onversionchange`), reviewer: Claude (plan-eng-review)
Plan baseline: original proposal, plan §1b: `DB_VERSION = 2`, `blobs` store added in `onupgradeneeded`, one transaction across `state` + `blobs` for Restore; no blocked handling; premise "no device holds a v1 DB".
Runtime evidence: `git merge-base --is-ancestor 5e174786 origin/main` → in origin/main; `git tag --contains 5e174786` → `api-v0.3.14`. Whether that tag is deployed is unknown. No `onblocked`/`onversionchange` anywhere in `src/hosted/local/*.ts` (grep, empty).
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 where blobs live / upgrade path | v2 bump of `mut-local`, no blocked handling (plan) | new DB `mut-local-blobs` v1; `mut-local` untouched | v2 bump of `mut-local` + `onblocked` "close other tabs" screen + `onversionchange` close-and-reload | v2 bump, no handling (as written) |
| R1 Restore atomicity | one tx across stores | add file blobs, then save snapshot, then sweep unreferenced (crash-safe by ordering) | one tx across stores | one tx across stores |
| R1 old tab open during rollout | new tab hangs | nothing blocks (old tabs never open the new DB) | new tab shows "close other tabs", recovers on close | new tab hangs on boot |
| R1 upgrade test | none | v1 `mut-local` with data + new code: snapshot intact, blobs DB created | v1 DB with data upgrades to v2, snapshot intact; blocked path renders screen | v1→v2 keeps data |
| R2 records-file format | pending | pending | pending | pending |
| R3 TD-171 fingerprint | pending | pending | pending | pending |
| R4 ticket AC4 wording | pending | pending | pending | pending |
Question D2:
D2 — How should receipt storage reach devices that already have local data?
Project/branch/task: planning MUT-287 on main; MUT-286's local mode is already in tag api-v0.3.14.
ELI10: The plan assumed nobody had local-mode data yet, so it changes the shape of the on-device database. That's wrong: local mode is in a release tag. Changing a browser database's shape needs every open tab of the app to let go of it first. An old tab left open from yesterday never lets go, so the fresh tab would sit on a spinner forever.
Stakes if we pick wrong: a person with two tabs open after the update sees the app never load, and may clear site data to fix it, losing every record.
Recommendation: A because a separate receipts database never touches the shipped one, so nothing can block, and ordering (add, switch, sweep) keeps Restore crash-safe without a cross-store transaction.
Completeness: A=9/10, B=9/10, C=5/10
Pros / cons:
A) Separate receipts database (recommended)
  ✅ The shipped `mut-local` database is never upgraded, so no old tab can block a new one during rollout
  ✅ Receipt blobs stay physically apart from the snapshot, matching the brief's "never in the snapshot" rule
  ❌ Restore can't be one transaction; it relies on add-then-switch-then-sweep ordering, which needs its own crash test
B) Upgrade with a blocked screen
  ✅ One database and one transaction for Restore, the simplest Restore code
  ✅ Adds `onversionchange` handling that later upgrades (MUT-288) also need
  ❌ Anyone with an old tab open sees a "close other tabs" screen once after the update
C) Upgrade as written
  ✅ Smallest change to the plan text (human ~0 / CC ~0 extra)
  ✅ Restore stays one transaction
  ❌ An old open tab hangs the new tab on boot with no message; risks data loss through a site-data wipe
Net: A trades a one-transaction Restore for zero rollout friction; B keeps one DB but shows a one-time screen; C ships a hang.
<gstack-qid:plan-eng-review-r1-idb-upgrade>
Header: IDB upgrade
Options:
A) Separate receipts database (recommended)
New IndexedDB database `mut-local-blobs` (v1, one `blobs` store); `mut-local` stays at v1. Restore: write the file's blobs (additive), save the snapshot, then delete blobs no live receipt references; boot sweep does the same. Tests: open a seeded v1 `mut-local` with the new code (data intact, blobs DB created); crash between blob write and snapshot save leaves the old records and their receipts working. Human ~half day / CC ~20 min.
B) Upgrade with a blocked screen
Bump `mut-local` to v2 adding `blobs`; `onblocked` shows a "Close the app's other tabs to continue" screen (reuses the LOCAL_UNAVAILABLE screen pattern) and resumes when unblocked; `db.onversionchange` closes the connection and asks for a reload. One transaction across `state` + `blobs` for Restore. Tests: seeded v1 DB upgrades with data intact; blocked path renders the screen. Human ~half day / CC ~25 min.
C) Upgrade as written
Bump `mut-local` to v2 with no blocked or versionchange handling; one-transaction Restore; test only that v1 data survives the upgrade. An old tab open during rollout leaves the new tab loading forever. Human ~0 / CC ~0 extra.

State: approved
Actual answer: A) Separate receipts database (Basel, D2, 2026-10-19)
Accepted scope: New IndexedDB database `mut-local-blobs` (v1, one `blobs` store); `mut-local` stays at v1 and is never upgraded by this ticket. Restore: write the file's blobs additively, save the snapshot, then delete blobs no live receipt references; the boot sweep does the same. Tests: a seeded v1 `mut-local` opened by the new code keeps its data and gains the blobs DB; a crash between blob write and snapshot save leaves the old records and their receipts working.
History: none

### R2: Records file format once it carries receipts
Finding: 2, P2, confidence 7/10, `.claude/designs/mut-287-local-expenses-plan.md` §1e (base64 `blobs` inside the JSON) + `src/hosted/local/index.ts:71` (`decodeRecordsFile(await file.text())`) + `src/hosted/components/YourDataDrawer.tsx:30` (`.json` filename), reviewer: Claude (plan-eng-review)
Plan baseline: original proposal §1e: one JSON file with an optional `blobs: { key, type, base64 }[]`; decision 1 recommended A (base64).
Runtime evidence: export builds one string (`encodeRecordsFile` returns `string`, `index.ts:91`); restore reads the whole file as one string. V8 caps strings near 2^29 chars (~512 MB) [estimated, platform limit]. Base64 inflates 4/3, so ~380 MB of receipts fails both ways [estimated]. jszip is a root dependency already used by `src/lib/zipExport.ts`; not referenced by bundle rules.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R2 file container | JSON + base64 (plan) | `.zip`: `records.json` + `receipts/<key>` files, jszip loaded by dynamic import only on Download/Restore | JSON + base64, export assembled from Blob parts | JSON + base64 as one string both ways |
| R2 size ceiling | ~380 MB receipts | none from strings (memory only) | export none; restore ~380 MB | ~380 MB both ways |
| R2 old `.json` files (MUT-286) restore | yes | yes (sniff zip magic `PK`, else JSON) | yes | yes |
| R2 `mut-local` chunk size | +base64 helpers | unchanged; jszip in its own lazy chunk (~30 KB gz, estimated) | +base64 helpers | +base64 helpers |
| R2 download filename | `.json` | `.zip` (QA download-restore expectation updated) | `.json` | `.json` |
| R1 blobs DB | approved A (D2) | approved A | approved A | approved A |
| R3 TD-171 fingerprint | pending | pending | pending | pending |
Question D3:
D3 — What file should "Download my records" produce once it includes receipts?
Project/branch/task: planning MUT-287 on main; Your data › Download/Restore came with MUT-286.
ELI10: Today the backup is one JSON text file. The plan puts each receipt inside it as text (base64), which makes files a third bigger. Browsers can't hold one piece of text much over about 500 MB, so someone with a few hundred photo receipts could no longer back up or restore. A zip file holds the receipts as real files and has no such ceiling.
Stakes if we pick wrong: the heaviest users, the ones with the most to lose, find their backup button fails exactly when they need it.
Recommendation: A because it removes the ceiling with a library the repo already ships, loaded only when someone presses Download or Restore.
Completeness: A=10/10, B=8/10, C=6/10
Pros / cons:
A) Zip with receipts as files (recommended)
  ✅ No text-size ceiling: receipts stay binary, so a large backup restores like a small one
  ✅ jszip is already a dependency (src/lib/zipExport.ts) and loads lazily, so the local chunk doesn't grow
  ❌ Two formats to read on Restore (old .json and new .zip), plus a filename change in the QA scenario
B) JSON, export built from parts
  ✅ Download never builds one giant string, so export works at any size
  ✅ One file format, no new library in the portal
  ❌ Restore still reads the file as one string and fails above roughly 380 MB of receipts
C) JSON as planned
  ✅ Simplest code: one encode, one decode (human ~0 / CC ~0 extra)
  ✅ One format and the familiar .json name
  ❌ Both Download and Restore fail above roughly 380 MB of receipts, with a browser error rather than a message
Net: A buys an unbounded backup for one lazy chunk and a format sniff; B fixes only half; C keeps a ceiling.
<gstack-qid:plan-eng-review-r2-records-format>
Header: Records file
Options:
A) Zip with receipts as files (recommended)
Download produces `mutaba3a-records-<date>.zip` holding `records.json` (today's format, unchanged) and `receipts/<key>` files; jszip is loaded by dynamic import only on Download or Restore. Restore sniffs the first bytes: `PK` → zip, else the MUT-286 JSON. Tests: zip round-trip keeps receipt bytes; an old .json restores; a zip with a missing receipt file restores the records and logs the gap. Human ~1 day / CC ~30 min.
B) JSON, export built from parts
Keep one JSON file with base64 `blobs`, but assemble the download from Blob parts so export never builds one string; Restore still reads `file.text()`. Record the ~380 MB restore ceiling as tech debt. Human ~half day / CC ~15 min.
C) JSON as planned
One JSON string with base64 `blobs` both ways, per plan §1e. Ceiling ~380 MB of receipts on both Download and Restore. Human ~0 / CC ~0 extra.

State: approved
Actual answer: A) Zip with receipts as files (Basel, D3, 2026-10-19)
Accepted scope: Download produces `mutaba3a-records-<date>.zip` holding `records.json` (today's format, unchanged) and `receipts/<key>` files; jszip is loaded by dynamic import only on Download or Restore. Restore sniffs the first bytes: `PK` → zip, else the MUT-286 JSON. Tests: zip round-trip keeps receipt bytes; an old .json restores; a zip with a missing receipt file restores the records and logs the gap.
History: none

### R3: Fingerprint coverage for the records this ticket starts persisting (TD-171)
Finding: Test review gap, P2, confidence 8/10, `src/hosted/local/__tests__/format-fingerprint.test.ts:99-112` (cases for Organization, CustomerRecord, ReceivableRecord only) + `.claude/TECH_DEBT.md:179` (TD-171 "covers 3 of 27 record types"), reviewer: Claude (plan-eng-review)
Plan baseline: original proposal, plan §5 decision 2: recommend extending the fingerprint to the expense, receipt, category, group, group-override and conversion maps in this ticket; otherwise it stays TD-171.
Runtime evidence: three fingerprint cases exist (lines 99, 105, 112). Expenses, groups and conversions are reachable signed out only after this ticket (HostedShell.tsx:35), so their records start persisting on devices with MUT-287.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R3 fingerprint scope | 3 maps | + expense, receipt, category, group, group-override, conversion maps (the ones MUT-287 starts persisting) | every map in `LocalSnapshotMaps` + an "every key has a case" assertion (closes TD-171) | unchanged; TD-171 stays open |
| R3 TD-171 status | Open | Open, narrowed to the remaining maps | Resolved | Open |
| R1 blobs DB | approved A (D2) | approved A | approved A | approved A |
| R2 records file | approved A (D3) | approved A | approved A | approved A |
Question D4:
D4 — Should MUT-287 extend the local-data shape check to the records it starts saving on devices?
Project/branch/task: planning MUT-287 on main; TD-171 says the shape check covers 3 of 27 record types.
ELI10: Local mode saves a copy of the records in the browser. A test takes a "fingerprint" of each record's shape, so if someone later adds or renames a field, CI fails until they write a migration for data already on devices. Today it watches only clients, organizations and receivables. This ticket starts saving expenses, receipts, groups and conversions on devices, which nothing watches.
Stakes if we pick wrong: a later server change to an expense field restores old device data with the field silently missing, and nobody finds out until a user's figures look wrong.
Recommendation: B because one table-driven test closes TD-171 for every map, and the "every key has a case" check stops the next new map from slipping past.
Completeness: A=8/10, B=10/10, C=4/10
Pros / cons:
A) Cover this ticket's maps
  ✅ Protects exactly the records MUT-287 starts saving on devices, with about six new cases
  ✅ Keeps the diff focused on this ticket's scope
  ❌ Leaves projects, payments, allocations and the rest unwatched, so TD-171 stays open
B) Cover every map (recommended)
  ✅ Closes TD-171: every persisted record shape fails CI when it changes without a migration
  ✅ The "every key has a case" assertion means a future map can't be added uncovered
  ❌ Touches maps beyond this ticket (human ~3h / CC ~20 min), a slightly wider diff
C) Leave as is
  ✅ No extra work in this ticket (human ~0 / CC ~0)
  ✅ TD-171 stays visible in the debt list for later
  ❌ Expense, receipt, group and conversion shapes go to devices unwatched from day one
Net: B costs about twenty CC minutes and turns a known hole into a closed one; A patches only this ticket's part.
<gstack-qid:plan-eng-review-r3-fingerprint>
Header: Fingerprint
Options:
A) Cover this ticket's maps
Add fingerprint cases for the expense, receipt, expense-category, expense-group, group-override and conversion maps, each built from a real `MemoryLedgerStore` record; TD-171 stays open, narrowed to the rest. Human ~1.5h / CC ~10 min.
B) Cover every map (recommended)
Table-driven fingerprint over every key of `LocalSnapshotMaps`, each built from a real `MemoryLedgerStore` record, plus an assertion that every key has a case; TD-171 resolved. Human ~3h / CC ~20 min.
C) Leave as is
No fingerprint change; TD-171 stays open as written. Human ~0 / CC ~0.

State: approved
Actual answer: B) Cover every map (Basel, D4, 2026-10-19)
Accepted scope: Table-driven fingerprint over every key of `LocalSnapshotMaps`, each built from a real `MemoryLedgerStore` record, plus an assertion that every key has a case; TD-171 resolved.
History: none

### R4: Ticket AC4 wording vs the D3 exception (factual, no remedy)
Finding: 3, P3, confidence 8/10, Jira MUT-287 AC4 "Signed-out mode still makes no /v1 requests" vs `.claude/designs/mut-285-portal-local-mode.md:272` ("MUT-286's 'no /v1 requests' AC carries exactly this one named exception"), reviewer: Claude (plan-eng-review)
Plan baseline: plan §1f already names the one exception.
Runtime evidence: n/a (ticket text).
State: approved (factual correction; no behavior choice)
Actual answer: none needed; the ticket comment is offered at /eng-ticket handoff
Accepted scope: none (no code change)
History: none

Approval readiness: PASS — R1 (D2 answer A), R2 (D3 answer A), R3 (D4 answer B); R4 factual, no remedy. Scope: D1 Original arrangement.

## Review body

### Scope Challenge
Scope accepted as-is (D1: Original arrangement). Findings: (1) P1 false premise, MUT-286 is shipped in tag api-v0.3.14 → R1; (2) P2 records-file string ceiling → R2; (3) P3 AC4 wording → R4.
Reality: `PLAN_REALITY: phase=eng rows=7/7 missing=none unverified=2 verdict=complete`.

### Section 1 — Architecture
- [P3] (confidence: 8/10) src/hosted/local/transport.ts:93 — `return lock.withLock(async ({ stale, onDiskVersion }) => {`: deferred removals and sweeps must run inside this callback. Disposition: accepted as a plan clarification (§1b), no new behavior.

### Section 2 — Code quality
No issues found. `LocalAttachmentStorage` vs `MemoryAttachmentStorage`: same interface, different behavior; no extraction.

### Section 3 — Tests
```
CODE PATHS                                              USER FLOWS
[+] server publicFxRateRoutes                           [+] Signed-out expense + receipt
  ├── [GAP→planned] 200 anon, no profile header           ├── [GAP→planned][→E2E] attach, reload, download (QA expense-receipt)
  ├── [GAP→planned] 429 + Retry-After                      ├── [GAP→planned] quota → uploadFailed toast
  └── [GAP→planned] 503 rates null / unservable            └── [GAP→planned] blob missing → downloadFailed toast
[+] local/attachments.ts LocalAttachmentStorage         [+] Signed-out groups
  ├── [GAP→planned] signUpload/head/signDownload           ├── [GAP→planned][→E2E] ≈ line online (QA fx-line)
  ├── [GAP→planned] remove staged → flush after save       └── [GAP→planned] offline → line hidden
  └── [GAP→planned] failed save → blob kept               [+] Documents signed out
[+] local/blobStore.ts (R1)                                └── [GAP→planned][→E2E] empty state, not 503
  ├── [GAP→planned] v1 mut-local untouched, blobs DB made [+] Your data
  └── [GAP→planned] boot sweep removes orphans             ├── [GAP→planned] zip round-trip (R2)
[+] local/fxSource.ts                                      ├── [★★★ TESTED→extend] old .json restore — recordsFile.test.ts
  └── [GAP→planned] parse / non-2xx / redirect / offline   └── [GAP→planned] crash mid-restore keeps old data (R1)
[+] portal download.ts / expenseQueries.ts local branch [+] Nav
  └── [GAP→planned] local-blob → anchor download / putBlob └── [★★ TESTED→invert] local-mode.test.tsx:140
[+] no-network invariant
  └── [★★★ TESTED→extend] no-network.test.ts + one named FX fetch
[+] fingerprint (R3) [★ partial→planned] every map
COVERAGE (existing): 3/27 paths with a test that stays valid; all new paths planned in §2.
```
Test-plan artifact: `~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261019-164232.md`.
Regression (CRITICAL, carried): MUT-286 `.json` records files must keep restoring (R2 approved test); MUT-286 local data must survive the first boot of the new build (R1 approved test).

### Section 4 — Performance
No issues found. Snapshot save cost unchanged (receipts in their own DB); boot sweep O(receipts); FX ≤ 1 fetch per tab per hour; zip export bounded by memory, not strings.

### Outside voice
Unavailable: Codex not installed; the native Plan fallback produced no complete report within five minutes (stopped, no credit). Fix: install and `codex login`, or rerun.

### NOT in scope
- MUT-319 (expense drawer opens in USD): its own bug; more visible once Expenses shows signed out.
- MUT-288 offline/PWA, MUT-289 marker/upsell, MUT-290 move-on-sign-in, MUT-291 bridge: later epic children.
- `stale`→`live` FX label nuance: documented, not fixed (rate date stays honest).

### What already exists
- Every expense, group, conversion and attachment route already runs in the browser via `PORTAL_ROUTES` (`server/src/routes/portal-routes.ts`); MUT-287 wires storage and FX, it doesn't rebuild routes.
- `AttachmentStorage` (`server/src/attachments/storage.ts:21`) and `FxRateSource`/`CachedFxRates` (`server/src/fx-rates.ts:87,142`) are the seams reused as-is.
- Per-IP limiter pattern: `server/src/routes/account-setup.ts:49`. Zip: jszip via `src/lib/zipExport.ts`.

### Diagram — receipt flow signed out
```
ReceiptUploader ─ api.startReceipt ─► local app (lock) ─ expenses route ─ LocalAttachmentStorage.signUpload
      │                                   └─ save snapshot (receipt PENDING) ─► { url: local-blob:<key> }
      ├─ putToSignedUrl(local-blob:) ─► LocalBackend.putBlob ─► mut-local-blobs.put(key, File)
      ├─ api.completeReceipt ─► route ─ head(key) {size,type} ─ size/type check ─ READY ─ save
      └─ download: api.receiptDownload ─► { url: local-blob:<key>, filename } ─► downloadNavigator
                    └─ LocalBackend.readBlob ─► object URL ─► <a download=filename> ─► revoke
Delete expense: route ─ remove(key) staged ─ save ok ─► flushRemovals (inside lock) ; save fails ─► discard
Restore (R1+R2): sniff PK→zip | json ─► add blobs ─► save snapshot ─► sweep unreferenced (under lock)
```

### Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| public FX | Frankfurter down, nothing cached | 503 test + offline QA | ≈ line hidden |
| putBlob | quota exceeded | planned test | "upload failed" toast |
| download | blob missing (crash/restore gap) | planned test | "download failed" toast |
| first boot after update | v1 data present | R1 test | nothing (data intact) |
| Restore | tab killed mid-restore | R1 ordering test | old data still there |
| old tab open during rollout | — | R1 (no upgrade) | nothing |
Critical gaps: 0.

### Worktree parallelization strategy
| Step | Modules touched | Depends on |
|---|---|---|
| Public FX route | server/src/routes, server/src/app, openapi | — |
| Local blobs + receipts | src/hosted/local, src/hosted/session | — |
| Portal branches + nav | src/hosted/data, src/hosted/components, src/hosted/shell | Local blobs (contract) |
| Records zip + fingerprint | src/hosted/local | Local blobs |
| Local FX source | src/hosted/local | Public FX route (schema) |
| QA + knowledge | qa/, .claude/ | all |
Lane A: Public FX route → Local FX source. Lane B: Local blobs → Portal branches → Records zip + fingerprint. Both lanes touch src/hosted/local, so per the one-worktree-per-epic rule build sequentially in one worktree: B first, then A, then QA.

## Implementation Tasks
- [ ] **T1 (P1, human: ~4h / CC: ~20min)** — local — `mut-local-blobs` blob store, add-then-switch-then-sweep Restore, boot sweep
  - Surfaced by: Scope Challenge — R1 (D2)
  - Files: src/hosted/local/blobStore.ts, index.ts, transport.ts
  - Verify: blobStore.test.ts incl. seeded v1 DB and crash-ordering cases
- [ ] **T2 (P2, human: ~1d / CC: ~30min)** — local — zip records file, lazy jszip, `.json` still restores
  - Surfaced by: Scope Challenge — R2 (D3)
  - Files: src/hosted/local/recordsFile.ts, index.ts, src/hosted/components/YourDataDrawer.tsx, scripts/bundle-rules.ts
  - Verify: recordsFile.test.ts, npm run test:bundles
- [ ] **T3 (P2, human: ~3h / CC: ~20min)** — tests — fingerprint every `LocalSnapshotMaps` key; resolve TD-171
  - Surfaced by: Test review — R3 (D4)
  - Files: src/hosted/local/__tests__/format-fingerprint.test.ts, .claude/TECH_DEBT.md
  - Verify: npm run test:run -- format-fingerprint
- [ ] **T4 (P2, human: ~15min / CC: ~2min)** — local — flush removals and sweeps inside `withLock`
  - Surfaced by: Architecture — transport.ts:93
  - Files: src/hosted/local/transport.ts
  - Verify: receipts.test.ts failed-save case

### Unresolved decisions
None.

### Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted (`PLAN_REALITY` complete), 2 unverified premises
- Architecture Review: 1 issue found
- Code Quality Review: 0 issues found
- Test Review: diagram produced, 1 gap identified (fingerprint coverage, R3)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (not installed; native fallback timed out)
- Parallelization: 2 lanes, 0 parallel / 2 sequential
- Lake Score: 3/3 (R1 9/10 highest offered, R2 10/10, R3 10/10)

### Suppressed findings (appendix)
- (4/10) `local-blob:` URLs might fail `z.string().url()` response schemas — probed with server zod 4.6.5: both forms pass. Dropped.
- (3/10) iOS Safari ignoring `download` on blob URLs — supported since iOS 13; QA covers on web only.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (native fallback) via `/plan-eng-review` | Independent 2nd opinion | 1 | unavailable | codex not installed; fallback timed out |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved) | 2 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (not installed); native Plan fallback stopped at the 5-minute limit with no complete report. No outside findings.
- **VERDICT:** no review CLEAR (Eng Review issues_open: every finding resolved by D2–D4 or accepted as a clarification; status records mapped work, not failure) — eng review required

NO UNRESOLVED DECISIONS
