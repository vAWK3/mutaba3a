# MUT-396 — Local-disk receipt storage for the dev server

Epic MUT-252. Dev and QA only: production storage (GCS, CMEK, MUT-381) is
untouched. Unblocks MUT-258 and MUT-260, whose QA needs to attach, list and
open stored receipts against `localhost:8787`.

Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned
→ In Progress (/eng-build) → In Review.

## Today

- `AttachmentStorage` (`server/src/attachments/storage.ts`) has
  `signUpload`, `signDownload`, `head`, `remove` and `read`. It is implemented
  by `GcsAttachmentStorage` (production) and `MemoryAttachmentStorage` (tests).
- `index.ts:123` passes storage only when `ATTACHMENTS_BUCKET` is set.
  Otherwise every receipt, attachment and records-export route answers 503
  `ATTACHMENTS_NOT_CONFIGURED`. That includes `routes/receipts.ts:65`,
  `expenses.ts:67`, `attachments.ts:24` and `records-export.ts:82`.
- The phone's upload (`receipt_repository.dart`) PUTs the bytes to the signed
  URL with the headers the start response returns (`Content-Type`,
  `x-goog-content-length-range`). Then it calls `/complete`, and
  `verifyUploadedObject` calls `head`.
- Precedent for a dev-only surface: `devOutbox` (`app.ts:392`) is mounted only
  when its dependency is non-null, and config refuses the memory mailer in
  production. It is not in OpenAPI.

## Design (revised after eng review, 2026-10-24)

### 1. `server/src/attachments/local-storage.ts`

`LocalAttachmentStorage implements AttachmentStorage`. Constructor options:
`dir`, `secret` and `now`.

**Signed URLs:**
- Each URL carries a token:
  `base64url(JSON payload) + '.' + base64url(HMAC-SHA256(secret, payload))`.
- Payload fields: `k` (key), `a` (`put` | `get`), `e` (expiry in ms), plus
  `m` and `n` (max bytes) for put, and `f` (filename) and `m` for get.
- The URL is built from the **incoming request's own origin** (`getContext()`
  from Hono's `contextStorage()`, already installed at `app.ts:224`):
  `${origin}/dev/attachments/${token}`.
  - Every caller gets a same-origin URL: the phone gets `localhost:8787`, and
    the portal gets the vite or API origin.
  - So `PORTAL_CSP`'s `connect-src 'self'` passes, and no CORS layer or
    base-URL setting is needed.
  - No request context (a background job) is a programming error: it throws.
- Expiry is judged on the **injected clock**: the route passes
  `c.get('now')()`, exactly as signing does. Route tests freeze `now`
  (`routes-receipts.test.ts:26`); `Date.now()` would expire every token
  signed there.
- `signUpload` returns the same headers GCS returns, so the phone and portal
  upload code is unchanged.

**Storage on disk:**
- Bytes go to `<dir>/<key>`, keeping the key's `/` segments.
- Key resolution refuses absolute paths, `..` segments and anything resolving
  outside `dir`.
- **No sidecar.** `head` returns `{sizeBytes, contentType: null}`;
  `verifyUploadedObject` skips the type check on null (`verify.ts`). The type
  is already enforced at PUT time (the signed `m`), and the GET answers with
  the token's `m`. This avoids a second non-atomic write and any key
  collision with a `.meta.json` name.
- `remove` ignores ENOENT. `read` uses `createReadStream` and
  `Readable.toWeb`, streamed, never buffered.

**`acceptUpload(token, request, now)`:**
- A token that is wrong, expired or for another action gets 403. These are
  `ApiError`s, mapped by the app's error handler, never a raw throw that
  surfaces as a 500.
- `Content-Type` must equal `m`, else 403.
- `Content-Length > n` gets 413 **before** streaming. While streaming, bytes
  are counted and passing `n` gets 413.
- Bytes go to a **unique temp file inside `dir`** (`<dir>/.tmp/<uuid>`, so
  the rename never crosses filesystems), then an atomic rename into place.
- Any failure, a 413 or a client abort deletes the temp file.
  Concurrent PUTs to one key are safe: the last rename wins with a complete
  file, and a retry through the re-sign route is idempotent.

### 2. `server/src/routes/dev-attachments.ts`

Mounted only when `deps.localAttachments` is set, next to `devOutbox`, and
`/dev/` is added to `PORTAL_EXCLUDED_PREFIXES`. Not in OpenAPI.

- `PUT /dev/attachments/:token`: answers 200 with an empty body, as GCS does.
- `GET /dev/attachments/:token`: streams the bytes with `Content-Type` (from
  the token) and `Content-Disposition`. A missing file gets 404.
  - It overrides the global `Content-Security-Policy` with `sandbox` (a
    download, not a page).
  - No `HEAD` or `Range` support. A PDF viewer that needs Range gets the whole
    file, which is fine for receipts of 10 MB or less.
- `GET /dev/attachments`: answers 200 `{driver: "local"}`, for the Flutter QA
  env check.
- The global request log line includes the token in the path. This is
  dev-only and short-lived, and the code comment says so.

### 3. Vite (hosted mode)

`vite.config.ts` gets a `/dev` proxy next to `/v1`. The portal served by vite
then reaches the same-origin signed URL. The current portal Playwright specs
stub `/v1` and are unaffected. MUT-260 decides whether its gallery spec runs
against a live API (the `portal-live` pattern) and uses this.

### 4. Config (`server/src/config.ts`)

- New settings: `ATTACHMENTS_DRIVER: z.enum(['gcs', 'local']).optional()`, and
  `ATTACHMENTS_DIR`, default `.data/attachments`. The default resolves against
  the server package directory (`import.meta.url`), not `process.cwd()`.
- Refusals, as `ConfigError`s:
  - `local` in `production` (ticket) and in `staging` (also deployed);
  - `local` together with `ATTACHMENTS_BUCKET`;
  - `gcs` without a bucket.
- The HMAC secret is
  `HMAC-SHA256(SESSION_TOKEN_PEPPER, "mut-396-local-attachments-v1")`: no new
  secret, and stable across `tsx watch` restarts.

### 5. Wiring and docs

- `index.ts`: with the local driver, the same `LocalAttachmentStorage` goes in
  as `attachments` and as `localAttachments`. The warning names both options.
- `server/.env.example` gets the block. The **root** `.gitignore` gains
  `server/.data/`: there is no `server/.gitignore`.
- `CHANGELOG.md` and `TEST_PLAN.md`. No API version bump; `openapi:check`
  stays green.
- Basel's local `server/.env` gets `ATTACHMENTS_DRIVER=local` and
  `RECEIPTS_LIBRARY=true` (MUT-258 phone QA uses `/v1/receipts`; it is off by
  default, `config.ts:96`). Restart `:8787` only when no Flutter QA run is in
  progress.

### 6. Flutter side (after MUT-124 merges)

- `qa/qa.config.mjs`: a `check` step,
  `curl -sf http://localhost:8787/dev/attachments`, with an actionable message.
- `privacy_receipt_cleanup_test.dart` drops `_StoredReceipts` and uses the
  real `ReceiptRepository`. It also asserts through the API that the receipt
  is READY and that its download returns the same bytes as the photo (AC1,
  phone side).
- `privacy.yaml`: the stand-in comment goes, and the `expect` gains "the
  stored receipt downloads with the same bytes".

### Rejected alternative

fake-gcs-server with `STORAGE_EMULATOR_HOST` would exercise the real
`GcsAttachmentStorage` with no new server code. Rejected because:
- the ticket specifies a local-disk driver;
- it adds a Docker dependency to every local and QA run on a disk-constrained
  machine;
- its V4 signed-URL support would still need verifying.

## Tests (TDD; `npm --prefix server test`)

`local-storage.test.ts`, with an injected clock and a temp dir:
- round trip: sign → accept → head (size) → read gives the same bytes;
- expired on the injected clock → 403, while the same token at `now − 1 s` is
  accepted;
- a tampered payload or signature → 403;
- a get-token used for PUT → 403;
- a traversal or absolute key throws;
- a Content-Type mismatch → 403;
- `Content-Length` over `n` → 413 before any write;
- a body streaming over `n` → 413 with no temp file left;
- an aborted body stream leaves no temp file;
- two concurrent PUTs to one key give one complete file;
- `remove` of a missing key is a no-op, and `head` then returns null.

`routes-dev-attachments.test.ts`, through `createApp` with a frozen `now` and
`receiptsLibrary: true`:
- MUT-44 path: start → PUT to the returned URL → complete → download → GET
  gives the same bytes;
- library path: `POST /v1/receipts/uploads` → PUT → complete →
  `/download` → same bytes;
- the signed URL's origin equals the request's origin;
- not mounted without `localAttachments` (404);
- `/dev/attachments` isn't swallowed by the portal fallback when `portal` is
  configured.

`config.test.ts` rows: local in production is refused; local in staging is
refused; local plus a bucket is refused; gcs without a bucket is refused; the
dir default resolves under `server/`.

## Risks

- **Global middleware.** The `*` middleware (`app.ts:225`) does run on
  `/dev/*`: request id, `no-store`, CSP (overridden on GET), and the log line
  with the path. Auth and the minimum-build gate are on `/v1/*` only.
- **The `.data/` folder grows during QA.** Removed receipts are deleted.
  Nothing sweeps it otherwise, but it's dev-only, so a comment in
  `.env.example` covers it.
- **Coordination.** Other mini-crm sessions are active (mini-crm-46,
  MUT-175). Merge under the mini-crm-main lock. No migration and no ADR
  number needed.

## Business / product impact

- Every receipt feature in MUT-252 (phone list, scan & review, portal gallery)
  can be proven end to end in local QA instead of stubbed. Without this,
  MUT-258 and MUT-260 can't pass their release-QA gate.
- Dev-only: no production surface, so no risk to live data.

## Decision ledger

Remedies were auto-decided per Basel's standing instruction (2026-10-24):
check in only at decisions that change scope, cost or the outcome. None did.

| ID | Finding | Source | Disposition |
| --- | --- | --- | --- |
| R1 | Token expiry judged on `Date.now()` would fail every frozen-clock route test (Critical, 9/10, routes-receipts.test.ts:26) | outside #1 | accepted: injected clock |
| R2 | Fixed base URL + CORS is blocked by `PORTAL_CSP` connect-src in a live portal; vite proxies only /v1 (High, 9/10, app.ts:192, vite.config.ts:618) | outside #2 | accepted: request-origin URLs + /dev vite proxy; CORS layer and base-URL setting dropped |
| R3 | Sidecar redundant, non-atomic, key-collision risk (Medium, 8/10, verify.ts) | outside #3 | accepted: no sidecar |
| R4 | Abort, unique temp file inside dir, early Content-Length 413, ApiError not raw throw (Medium, 8/10) | outside #4 | accepted |
| R5 | Global `*` middleware runs on /dev (CSP, log line with token) (Medium, 9/10, app.ts:225) | outside #5 | accepted: CSP sandbox on GET; logging noted as dev-only |
| R6 | fake-gcs-server alternative not considered | outside #6 | rejected, reason recorded (ticket specifies local disk; Docker on a disk-tight machine) |
| R7 | No server/.gitignore; dir must resolve against package dir | outside #7 | accepted |
| R8 | Flutter flow didn't prove "same bytes" | outside #8 | accepted: READY + byte assertion |
| R9 | RECEIPTS_LIBRARY off by default | outside #9 | accepted: test passes the flag; local .env gets the line |
| R10 | No HEAD/Range | outside #10 | noted |
| R11 | /dev must be excluded from the portal fallback | native | accepted |
| R12 | Staging refusal is stricter than the ticket | native | accepted (deployed env) |
| R13 | Flutter part waits on MUT-124 | native | accepted: mini-crm half merges first; ticket goes to In Review only after the flow passes |

Approval readiness: PASS (R1–R5 and R7–R13 auto-accepted under the standing
instruction; R6 rejected with its reason; R10 noted).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Claude Plan subagent (Codex not installed) | Independent 2nd opinion | 1 | unavailable (native fallback completed) | 10 findings, all dispositioned |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved into plan) | 3 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — (no UI) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** Codex not installed. A native Claude Plan subagent completed within the 5-minute bound with 10 findings, including 1 Critical and 1 High, both folded in.
- **VERDICT:** Eng review complete, findings folded in; ready for /eng-build.

NO UNRESOLVED DECISIONS
