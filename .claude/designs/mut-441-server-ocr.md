# MUT-441: our server reads receipts (self-hosted OCR)

Status: draft plan, 2026-10-28. Not eng-reviewed yet. Epic MUT-252.

## What changed since the ticket was written

On 2026-10-28 Basel made **the server the reader**, not a fallback. ADR-199 had the device read first and the server fill only what the device left empty. Now the server reads every uploaded receipt that has no suggestion yet, for the phone and the portal. The phone reader (MUT-256) and browser OCR (MUT-304) drop behind it.

The phone gets a **Scan** button (a new Flutter ticket, filed after this plan). It auto-captures the receipt, straightens and crops it, cleans it on the device, and uploads it. It does no OCR on the phone.

Unchanged: self-hosted in our GCP project; no LLM; no third-party OCR API; raw OCR text never stored or logged; ships dark.

Today nobody writes a `ReceiptSuggestion` in production. The schema (`server/src/schemas.ts:2855`), the store column (`ExpenseReceipt.suggested`), the PATCH route and the portal and phone readers already exist and are waiting for one.

## Acceptance criteria (ticket ACs adjusted for "server is the reader")

| # | Criterion | Change |
|---|---|---|
| AC1 | On the benchmark set, the server fills amount ≥ 85% and date ≥ 85% **per language** (ar, he, en), including Arabic-Indic dates | was "for the fields the device missed"; now all receipts. The Hebrew bar is provisional if Basel's real set is small |
| AC2 | A field with no confident match stays empty; the threshold is tested | same |
| AC3 | A value already in the suggestion (a future device reader, or one set through PATCH) is never changed; the server fills only absent fields | same rule, new reason |
| AC4 | The OCR service makes no outbound network call; a test proves it | same |
| AC5 | No receipt text in logs or Sentry, in the API or the OCR service; tested | same |
| AC6 | p95 ≤ 5 s per receipt on the chosen size (warm), and the cost per 1,000 reads is reported | same; cold start reported separately |
| AC7 | Every model and package in the image is listed with its licence and checked: commercial use allowed, no AGPL, no OpenRAIL revenue caps | same |
| AC8 | The portal review page shows "Reading…" while the server reads, then fills the fields the person hasn't touched | new: the ticket's "how the portal picks it up" made testable |
| AC9 | The privacy policy (ar, en) says receipts are read on our own servers. Basel approves the wording | same |

## Design

```
phone / portal ──upload──▶ API: complete
                              │  readStatus = PENDING, enqueue Cloud Task
                              ▼
                 Cloud Tasks ──▶ API /jobs/v1/receipts/{id}/read  (job token)
                              │  claim (lease), stream the original from GCS
                              ▼
                 receipt-ocr (Cloud Run, Python, IAM-only, no roles)
                              │  preprocess → detect → read lines (Paddle + Tesseract)
                              ◀─ lines [{text, conf, box, script}]   (in memory only)
                 API: extract fields (TS) → vendor lookup → merge into suggested (fill absent only)
                              │  readStatus = DONE | FAILED
 portal polls while PENDING ◀─┘  phone list shows the suggestion when it lands
 Scheduler sweep every 5 min: re-enqueue PENDING with an expired lease (the backstop)
```

### 1. OCR service: `server/ocr/` (new, Python 3.12)

- **What it does:** a FastAPI app with one route, `POST /v1/read`. Input is the file bytes plus a `hint` (`scanned` or `photo`) and a content type. It returns text lines with confidence, box and script. It has **no** DB, bucket or secret access. Its own service account holds no roles, it runs as non-root with a read-only filesystem, and every model is baked into the image.
- **Engines:**
  - RapidOCR (PP-OCRv5, ONNX Runtime CPU) for detection, Arabic and Latin.
  - Tesseract 5 with `heb`, `ara` and `eng` for Hebrew, and as the second reader on each line; the more confident line wins.
  - `tessdata_fast` vs `_best` is decided by the benchmark: the MUT-253 spike found `fast` *better* on receipts.
- **PDFs:** a text-layer PDF is read with pypdfium2 (no OCR). An image PDF has its first 2 pages rasterised at 300 dpi, then OCR'd.
- **QR:** a ZATCA or other QR code is decoded with zxing-cpp (`source: 'qr'`). This is optional (D5).
- **Preprocessing** (OpenCV):
  - `photo`: find the page and correct the perspective (the spike's biggest single win), deskew, CLAHE, about 2× upscale when small.
  - `scanned`: skip the perspective step and only normalise. Already-binarised input is not binarised again.
- **Logging:** counts and timings only, never text. No Sentry SDK in the sidecar.
- **Tests:** pytest. Run under `docker run --network none` in CI, which proves AC4. A log-capture test proves AC5 for the sidecar.

### 2. API side

- **Migration** on `expense_receipts`: `readStatus` (`NONE | PENDING | DONE | FAILED | SKIPPED`), `readAttempts int`, `readLeaseUntil timestamptz`. Plus a partial index on `(readStatus, readLeaseUntil) WHERE readStatus = 'PENDING'`.
- **Trigger:** `completeLibraryReceipt` (`expenses/receipts-compose.ts`) sets PENDING and enqueues a Cloud Task when the flag is on and the receipt has no suggestion. A receipt captured offline is read once its upload completes, so it needs no special path.
- **Read job:** `POST /jobs/v1/receipts/{id}/read` (`jobAuth`, like the Scheduler jobs).
  - It claims with `UPDATE … WHERE readStatus='PENDING' AND (readLeaseUntil IS NULL OR < now()) RETURNING`.
  - It streams the original (`attachments/storage.ts read`) to the OCR service with an ID token (`google-auth-library`, a new pattern recorded in PATTERNS.md).
  - It extracts, merges and saves with optimistic `version`.
  - A deleted or FILED receipt becomes SKIPPED. After 3 attempts, or 30 minutes since the first, the receipt becomes FAILED. The person types the fields, as today.
- **Extractor:** `server/src/receipts/extract/` (TS, pure functions), ported from `extract_baseline.dart` plus the spike's lessons:
  - Arabic-Indic and Persian digits become 0–9; RTL lines are put in logical order; dates in `d/m/y`, `y-m-d` and Hebrew and Arabic month names.
  - Totals by keyword (סה"כ, المجموع, Total) with the arithmetic cross-check (`subtotal + VAT`, `cash − change`) as a confidence boost.
  - Currency from symbol or code; VAT amount and rate; Israeli registration no. (ח.פ / ע.מ, 9 digits with check digit); phone; email; vendor name from the top lines.
  - Each field gets a confidence, and anything under the threshold is omitted.
- **Vendor fill:** if the registration no. matches a saved vendor (MUT-254), the vendor's name fills `vendorName` (`source: 'vendor'`). This needs no extra reads beyond one indexed lookup.
- **Merge rule:** fill only absent fields. The `readerVersion` becomes `server-ocr-<engine>-<n>` when the server supplied any field. If every field was already present, the receipt is SKIPPED.
- **Wire:** receipt responses gain `reading: 'pending' | 'done' | 'failed' | null` (additive, so the OpenAPI and `hosted:types` are regenerated).
- **Flags:** a deploy-level kill switch `SERVER_OCR` (env plus Terraform `server_ocr_enabled`, default false, like `RECEIPTS_LIBRARY`). Plus a per-user `FEATURES` entry `receipt_reading`, granted in the operator console (ADR-216) for piloting. A receipt reads only when both are on for its uploader (D3).

### 3. Infra (`server/infrastructure/terraform/`)

- **Cloud Run service `receipt-ocr`:**
  - 4 vCPU / 4 GiB, concurrency 1, min 0 / max 3 instances.
  - Ingress all, but only the API's service account holds `run.invoker`. This is the MUT-56 plan's pattern, because the API has no VPC egress.
  - Its own service account, with no roles.
- **Cloud Tasks queue `receipt-reads`:** 2 dispatches per second, 3 attempts, OIDC to the API job route. A Scheduler sweep every 5 minutes is the backstop.
- **Release:** `deploy.sh` builds a second image (`receipt-ocr:<tag>`), and the `tftest.hcl` covers the new resources.
- **Project:** every resource uses `project_id`, so MUT-487's move carries it. The first production apply should come **after** the MUT-487 cutover, to avoid creating it in `malafat-production` only to move it (D6).

### 4. Portal pickup

- `useReceipt` polls (`refetchInterval` 3 s) while `reading === 'pending'`, and stops after 2 minutes.
- `ReceiptReview.tsx` shows a quiet "Reading the receipt…" row (i18n, ar and en). When the suggestion lands, it fills only fields the person hasn't touched (`reset` with `keepDirtyValues`).
- If the read failed, nothing is shown; the person types the fields, as today.
- The phone list already reads `suggested`; the phone's "Reading…" state belongs to the Scan ticket.

### 5. What the server expects from the phone's Scan (for the Flutter ticket)

JPEG, **grayscale enhanced, not hard black and white**: thresholding drops thin Arabic and Hebrew strokes. It should be cropped to the receipt and perspective-corrected, with the long side ≥ 1600 px, quality 85, and ≤ 2 MB. Upload with `capture: 'scanned'`. A photo picked from the gallery, a share or a portal upload is `photo`, and the server does the full preprocessing.

Recommended engines are the platform document scanners: iOS VisionKit `VNDocumentCameraViewController` and Android ML Kit Document Scanner. Both run on the device, include auto-capture, crop and perspective correction, and are no LLM. Flutter: `google_mlkit_document_scanner` / `cunning_document_scanner`.

## Benchmark (AC1, AC6)

- `server/ocr/bench/run.py` runs against a local container. It scores amount, date, currency and vendor per language and prints p50/p95.
- Its inputs:
  - the 50 MUT-253 fixtures from the Flutter repo (`test/fixtures/receipts/` + `manifest.json`, by path);
  - Basel's real receipts in `~/Work/Barmajiyat/Mutaba3a/receipt-bench/`, outside every repo, with a `manifest.json` filled in by hand (amount, date, currency per file). **This is the point where Basel drops them.**
- Results are written to `.claude/designs/mut-441-bench.md`: aggregate numbers only, no receipt content.

## Tests (TDD order)

1. **Extractor unit tests**, table-driven from the fixture manifest's truth fields plus hand cases: Arabic-Indic dates, RTL totals, the arithmetic cross-check, under-threshold fields omitted (AC2), the registration check digit.
2. **Merge unit tests:** present fields are never changed (AC3), and an all-present suggestion leads to SKIPPED.
3. **Read-job route tests** with a fake OCR client:
   - claim and lease, retry then FAILED, deleted or FILED becomes SKIPPED;
   - the version conflict is retried;
   - a log-capture check that no line text appears (AC5);
   - the flag on and off.
4. **`complete` tests:** PENDING plus an enqueue only when the flag is on and there's no suggestion.
5. **Python tests:** a golden read of 5 fixtures; `--network none` (AC4); no text in the logs (AC5).
6. **Portal tests:** polls while pending; untouched fields fill and touched ones stay (AC8).
7. **Release-QA:** `portal/receipts` feature `server-reading`: upload a photo, see "Reading…", then the amount and date filled. It runs against the local API with the OCR container on a local port (`OCR_URL`).
8. **Terraform `tftest.hcl`:** the invoker binding is limited to the API service account; the OCR service account has no roles; the flag defaults off.

Commands: `npm --prefix server test`, `pytest server/ocr`, `terraform test`, `npm run test:run`. All are queued through `heavy`.

## Cost

- **Per read:** ~4 s at 4 vCPU / 4 GiB is about 16 vCPU-s plus 16 GiB-s, roughly **$0.45–0.65 per 1,000 reads** in me-west1. Cloud Tasks is free at this volume. With min 0 instances, nothing is paid when idle; a cold start (models loading, roughly 5–10 s) is paid only after idle periods.
- **Sizing:** pilot volume (the cap is 20 uploads per profile per day) stays within a few dollars a month.
- **Image size:** about 1.2 GB (models plus OpenCV plus Tesseract). Artifact Registry storage is cents.

## Docs to update when built

- **ADR-220:** the server is the reader. Amend ADR-199 with an override log, and decide that MUT-256 and MUT-304 become optional speed-ups.
- **PATTERNS:** Cloud Tasks job dispatch and service-to-service ID tokens. MUT-56 reuses both.
- **SYSTEM_OVERVIEW, INFRA, TEST_PLAN, CHANGELOG.**
- **Privacy copy:** `src/lib/i18n/translations/{en,ar}/landing.json` `landing.privacyPolicy.*`.
- **`docs/operations/before-release.md`:** enable the Cloud Tasks API and flip the flag.

## Decisions (Basel, 2026-10-28)

- **D1:** Cloud Tasks at upload, with a 5-minute sweep backstop. **Basel chose this.**
- **D2:** extraction in TS in the API. Default taken; Basel can revisit.
- **D3:** a kill switch plus a per-user `receipt_reading` grant. **Basel chose this.**
- **D4:** Scan uploads clean grayscale. **Basel chose this.**
- **D5:** QR in v1. Default taken.
- **D6:** first production apply after the MUT-487 cutover. **Basel chose this.**
- **D7:** MUT-256 and MUT-304 are decided after this ships. Default taken.

### Options as presented

- **D1, trigger:** Cloud Tasks at upload (seconds) with a 5-minute sweep backstop (recommended), or the sweep only (simpler, but 1–5 minutes before fields fill).
- **D2, extraction location:** in the API, in TS (recommended: one set of rules, tested with the API, reusable if the portal ever reads PDFs on the device), or inside the Python service (raw text would then never leave the sidecar, but the rules are split from the rest of the stack).
- **D3, pilot gating:** the env kill switch plus a per-user `receipt_reading` grant (recommended), or the env switch only (all users at once when on).
- **D4, Scan output:** enhanced grayscale (recommended for OCR accuracy), or true black and white as you described. B/W can be a display choice while the upload stays grayscale.
- **D5, QR codes** (ZATCA and Israeli e-invoice QR) in v1: yes (cheap, exact values) or later.
- **D6, deploy order:** first production apply after the MUT-487 cutover (recommended), or now in `malafat-production`.
- **D7:** close MUT-304 (browser OCR) as won't do and park MUT-256 (phone reader) once this ships.

## Out of scope

Any LLM; line items; reading on the phone; the inbox attachment (MUT-116 has no endpoint); the malware scan (MUT-56; the OCR service is sandboxed with no roles, so it doesn't wait on it).

## Business / product impact

- Receipts come back already filled (amount, date, currency, vendor) on the portal and the phone, in Arabic, Hebrew and English. This is the "smart" half of receipt scanning, and it turns snap-and-forget into an expense in seconds.
- It is the last missing piece of epic MUT-252 (library, upload, gallery and vendors are built). One server reader replaces two device engines that couldn't hit the bar (Android Arabic dates, browser).
- Risk is contained: the service is dark behind a flag, sandboxed with no data access, cost is cents per thousand, and there is no new data recipient (the original is already on our server).

---

# Eng review (plan-eng-review, 2026-10-28)

Target: this plan (MUT-441). The plan's D1–D7 are Basel's product decisions; the review questions below are numbered R-D1 onward.

## Scope record

- **Feature answers:**
  - R-D1: QR reading **deferred** to a follow-up. The plan's D5 changes from "QR in v1" to "QR later".
  - Basel, 2026-10-28.
- **Structure:**
  - R-D2: the **smaller arrangement**. One job route, `POST /jobs/v1/receipts/read`: with `{receiptId}` it reads that receipt (Cloud Tasks); with no body it sweeps PENDING receipts whose lease has expired (Scheduler, every 5 min).
  - Basel, 2026-10-28.
- **Accepted scope:** the plan minus QR, with the one route.
- **Pending remedies:** F1, F4, F9, plus the corrections batch (F2, F3, F5–F8, F10).
- **Scope Challenge result:** scope reduced per recommendation (QR deferred).

## Findings (Sections 1–4)

1. **F1** [CRITICAL] (confidence 9/10). Plan §1, "Input is the file bytes …".
   - **Problem:** the plan puts no bound on decoding. `rules.ts:8-11` caps the upload at 10 MB, but a 10 MB PNG can decode to over 1 gigapixel, and a PDF can have hundreds of pages. Either could take down the sidecar or make it hang.
   - **Remedy:**
     - a pixel cap of 40 MP, checked from the header before decoding (Pillow `MAX_IMAGE_PIXELS`, and the PNG and JPEG header read first);
     - a PDF page cap of 2, and a cap on the rasterised size;
     - a 30 s per-request deadline, and concurrency 1;
     - a too-big or undecodable file goes to a terminal `FAILED` (`reason: unreadable`), with no retries;
     - tests with a bomb PNG and a 300-page PDF.
2. **F2** [CRITICAL] (confidence 9/10). `server/src/routes/admin.ts:60`: `const given = Buffer.from(c.req.header('x-job-token') ?? '', 'utf8');`
   - **Problem:** job routes accept only `X-Job-Token`, but the plan says Cloud Tasks reaches the route over "OIDC". That would answer 401 on every task.
   - **Remedy:** the API sets `X-Job-Token` on the HTTP task it creates and reuses `jobAuth`. The token never leaves our project; Scheduler jobs already carry it the same way.
3. **F3** [INFORMATIONAL] (confidence 8/10). Local dev, tests and QA have no Cloud Tasks.
   - **Remedy:** a `ReadDispatcher` port (`enqueue(receiptId)`) with two adapters:
     - `CloudTasksDispatcher`, which adds the `@google-cloud/tasks` dependency;
     - `InlineDispatcher` for dev, tests and the release-QA local API, which runs the read after the response on the same process.
   - The OCR client gets ID tokens through `google-auth-library` in production; locally it calls `OCR_URL` without auth.
   - Both adapters are injected like `store`.
4. **F4** [CRITICAL] (confidence 7/10). §3, "min 0 / max 3".
   - **Problem:** loading the models takes about 5–10 s. At pilot volume nearly every read hits a cold instance, so the person waits about 15–20 s. That breaks the "seconds" promise of D1.
5. **F5** [INFORMATIONAL] (confidence 8/10). `schema.prisma` ExpenseReceipt: `uploadedByUserId String? … onDelete: SetNull`.
   - **Problem:** under the per-user grant (D3), a receipt whose uploader is null (deleted user) can never read.
   - **Remedy:** a null uploader means not read (`SKIPPED`), and a test says so.
6. **F6** [INFORMATIONAL] (confidence 8/10). `server/scripts/lib/rollback.sh` (MUT-347) reuses API and portal images by commit.
   - **Problem:** the OCR image isn't part of that.
   - **Remedy:** tag `receipt-ocr` with the same sha and have rollback pin it too. The OCR route is versioned (`/v1/read`) so either side can roll alone.
7. **F7** [INFORMATIONAL] (confidence 7/10). `.github/workflows/server-ci.yml` has no Python job.
   - **Remedy:** add a `receipt-ocr` job: build the image, run pytest inside it with `--network none` (proves AC4), and run the licence check (AC7).
8. **F8** [INFORMATIONAL] (confidence 8/10). `server/src/receipts/edit-rates.ts` compares `suggested` with `approved`.
   - **Problem:** a read that lands after approval would skew the edit rate.
   - **Remedy:** the plan's FILED → SKIPPED rule covers it. Add the test row "the person approves while reading is pending; the late read writes nothing".
9. **F9** [INFORMATIONAL] (confidence 7/10). Receipts already To-review when the flag turns on stay `readStatus NONE` and are never read.
10. **F10** [INFORMATIONAL] (confidence 8/10). Performance.
    - **Problem:** the queue dispatches 2/s, but the sidecar handles 3 concurrent reads, so a burst would turn into a wave of 429s and retries.
    - **Remedy:** set the queue's `max_concurrent_dispatches = 3` to match the sidecar's max instances × concurrency. The job route's OCR call gets a 35 s timeout (under Cloud Tasks' dispatch deadline, set to 60 s). There are no N+1 queries: one claim UPDATE, one vendor lookup by `(organizationId, registrationNo)` (indexed per MUT-254), and one versioned update.

## Decision ledger

### R3: F1 decode bounds (question D3)
State: approved
Actual answer: A) Add the bounds (Basel, 2026-10-28)
Accepted scope: 40 MP pixel cap checked from the header before decoding; a 2-page PDF cap and a cap on the rasterised size; a 30 s per-request deadline; concurrency 1; a too-big or undecodable file goes to a terminal FAILED `unreadable` with no retries; tests with a bomb PNG and a 300-page PDF.

### R4: F4 cold start (question D4)
State: approved
Actual answer: B) Sleep + CPU boost (Basel, 2026-10-28)
Accepted scope: min 0 instances plus `startup_cpu_boost = true`; the first read after a quiet spell is about 12–18 s and later reads about 5 s. AC6 reports warm p95 and cold start separately. The upgrade trigger is pilot complaints or growing volume, which means setting min_instances = 1 (about $50–70 a month).

### R5: F9 existing To-review receipts (question D5)
State: approved
Actual answer: A) Queue them once (Basel, 2026-10-28)
Accepted scope: an operator action, run when a user is granted `receipt_reading`, marks that uploader's TO_REVIEW, READY receipts that have no suggestion as PENDING, and the sweep reads them. It is idempotent and tested.

### R6: corrections F2, F3, F5, F6, F7, F8, F10 (question D6)
State: approved
Actual answer: A) Apply all seven (Basel, 2026-10-28)
Accepted scope: every remedy exactly as written in F2, F3, F5, F6, F7, F8 and F10 above, each with the test or check named there.

## Outside voice (native fallback: Codex isn't installed; an independent Claude agent reviewed the plan and the code)

It made 10 findings. I verified #1 at `schemas.ts:3083-3086` (`.strict()`), #2 at `routes/receipts.ts:295` (`...(body.suggested ? { suggested: body.suggested } : {})`) and #4 at `admin.ts:60` (one `x-job-token` for every `/jobs` route, including `/jobs/v1/accounts/purge`). The other findings cite lines the agent read but I did not check myself.

### R7: client merge rule (outside voice #2; question D7)
State: approved
Actual answer: A) Fill-absent both ways (Basel, 2026-10-28)
Accepted scope: approve, file and `PATCH …/suggestion` add only the fields the stored suggestion lacks; they never replace one the server read. Test: the server reads, then the phone approves with its own `suggested`, and the server's fields survive.

### R8: task auth (outside voice #4; question D8). It reopens F2.
State: approved
Actual answer: A) Google-signed OIDC (Basel, 2026-10-28)
Accepted scope: `/jobs/v1/receipts/read` checks a Google OIDC token: the audience is the API URL, and the email must be the queue's or the Scheduler's dedicated service account (`verifyIdToken`). That route does not accept `X-Job-Token`, and no secret sits in task headers. Locally, the InlineDispatcher calls the read function directly, not the route.
History: F2's remedy (`X-Job-Token` on tasks), approved in R6 (D6), is superseded for this route, because the shared token in task headers would open `/jobs/v1/accounts/purge`.

### R9: production egress lock (outside voice #8; question D9)
State: approved
Actual answer: A) Lock egress (Basel, 2026-10-28)
Accepted scope: `receipt-ocr` uses Direct VPC egress `ALL_TRAFFIC` into a dedicated subnet with no Cloud NAT and a deny-all egress firewall rule. A tftest asserts all three.

### R10: corrections #1, #3, #5, #6, #7, #9, #10 (question D10)
State: approved
Actual answer: A) Apply all seven (Basel, 2026-10-28)
Accepted scope:
- **#1:** an optional `capture: 'scanned'|'photo'` on `CreateLibraryReceiptUploadRequestSchema`, plus a `captureHint` column (default `photo`), plus the OpenAPI and `hosted:types` bump.
- **#3:** the OCR client and the extractor rethrow every error as `OcrReadError(code)`, with a fixed message and no `cause`. Tests with a malformed and a truncated sidecar body assert that neither the logger nor `report()` sees any text.
- **#5:** PENDING is set inside the `complete` UPDATE, and the enqueue is best-effort (log a code, never fail the request). The sweep includes `readLeaseUntil IS NULL`. Test: an enqueue failure still gets read by the sweep.
- **#6:** a `readRequestedAt` column backs the 30-minute give-up rule.
- **#7:** the no-body sweep only re-enqueues, with the task name `<receiptId>-<readAttempts>` so duplicates are dropped. It never reads inline.
- **#9:** the portal refill skips while `isSubmitting`, fills only fields that are empty and not dirty, and shows the "from receipt" hints only on fields it filled. Tests cover typed-then-cleared and approve-in-flight.
- **#10:** the lease is 90 s, longer than the 60 s dispatch deadline. Every terminal state (DONE, FAILED, SKIPPED, unreadable) answers 2xx. Test: a retry arriving during a live lease is a no-op.

## Consolidated amendments to the plan body (these override it)

- **A1:** QR is out of v1 (R-D1). There is one job route, `POST /jobs/v1/receipts/read`, with `{receiptId}` or with no body for the sweep (R-D2).
- **A2:** the migration adds `readStatus`, `readAttempts`, `readLeaseUntil`, `readRequestedAt` and `captureHint` (R10 #1, #6).
- **A3:** decode bounds (R3). Cold start is min 0 plus startup CPU boost (R4). A backlog command runs at grant time (R5).
- **A4:** the job route uses OIDC, not `X-Job-Token` (R8). The `ReadDispatcher` port has Cloud Tasks and inline adapters (F3). A null uploader is SKIPPED (F5). Rollback pins the OCR image (F6). CI gets a Python job (F7). A late read after filing writes nothing (F8). The queue sends at most 3 at once (F10).
- **A5:** clients fill only absent fields too (R7). The OCR service's egress is locked (R9). The error-scrubbing, enqueue-atomicity, sweep, portal-refill and lease fixes apply as in R10.

## Test review

```
CODE PATHS                                                   USER FLOWS
[+] complete (receipts-compose.ts)                           [+] Phone Scan → upload → fields fill
  ├── flag off / no grant / null uploader → NONE|SKIPPED [GAP→unit]   ├── [GAP][→E2E] release-QA portal/receipts server-reading
  ├── PENDING in same UPDATE + enqueue ok          [GAP→unit]  [+] Portal review while reading
  └── enqueue throws → still PENDING, sweep reads  [GAP→unit]    ├── [GAP] "Reading…" then fills untouched fields
[+] /jobs/v1/receipts/read                                       ├── [GAP] typed-then-cleared field not overwritten
  ├── OIDC wrong aud/email → 401                   [GAP→unit]    ├── [GAP] approve while pending → late read writes nothing
  ├── claim: live lease → no-op 2xx                [GAP→unit]    └── [GAP] read FAILED → nothing shown, typing works
  ├── deleted / FILED / all fields present → SKIPPED [GAP→unit] [+] Error states
  ├── OCR timeout/5xx → attempt++, retry; ≥3 or 30 min → FAILED  ├── [GAP] bomb PNG / 300-page PDF → FAILED unreadable
  ├── malformed/truncated body → OcrReadError, no text logged     └── [GAP] sidecar down → sweep re-enqueues later
  └── sweep: re-enqueue PENDING expired/NULL lease, named tasks
[+] extract/* (pure)      table-driven from the fixture manifest + hand cases [GAP→unit]
[+] merge (fill-absent, server and clients)                      [GAP→unit]
[+] receipt-ocr (pytest)  golden 5 fixtures; --network none; no text in logs; decode caps [GAP→pytest]
[+] terraform tftest      invoker SA only; OCR SA no roles; egress locked; flag default off [GAP→tftest]
COVERAGE: 0/26 paths tested today (all new code). Every path above has a named planned test.
```

There are no regression risks to existing behaviour beyond R7 (approve, file and PATCH semantics). That one is covered by the new test plus the existing `receipts` route tests, which must stay green. No tests are retired.

## NOT in scope

QR reading (deferred, R-D1); any LLM; line items; reading on the phone (MUT-256 is parked per D7); the inbox attachment (MUT-116 has no endpoint); the MUT-56 malware scan (the sidecar is sandboxed and egress-locked, so it doesn't depend on it); the phone Scan button (its own Flutter ticket); min-instance warmth (R4's upgrade trigger).

## What already exists (reused)

`ReceiptSuggestionSchema` (`schemas.ts:2855`); `ExpenseReceipt.suggested`; `PATCH /v1/receipts/{id}/suggestion`; `attachments/storage.ts read`; `features.ts` plus the operator console grants (ADR-216); vendor lookup by registration no. (MUT-254); the Scheduler job pattern (`main.tf:886`); `rollback.sh` (MUT-347); the MUT-253 fixtures and the spike's preprocessing.

## Failure modes

| Path | Realistic failure | Handled by |
|---|---|---|
| Upload → enqueue | Cloud Tasks API error | PENDING is set in the same UPDATE; the 5-minute sweep re-enqueues (R10 #5) |
| Read job → sidecar | Cold start plus a 2-page PDF takes longer than 35 s | Retry; the 90 s lease prevents a double read; FAILED after 3 tries or 30 min (R10 #10) |
| Sidecar parse | Decompression bomb | Caps, then terminal `unreadable` (R3) |
| Sidecar compromise | Exfiltration | Egress locked, SA has no roles, read-only FS (R9) |
| Error path | Receipt text inside an exception | `OcrReadError` with a fixed message (R10 #3) |
| Client approve | A stale `suggested` erases the server's read | Fill-absent merge (R7) |

## Worktree parallelization

Three lanes that touch no shared files:
- **A:** `server/ocr/**`, Dockerfile and CI job;
- **B:** API: migration, extractor, route, dispatcher;
- **C:** Terraform plus `deploy.sh`/`rollback.sh`.

The portal (D) follows B, because it needs the `reading` wire field. Per the memory rule (one worktree per repo per epic), these run sequentially in one worktree.

## Implementation Tasks

1. Migration and wire (`reading`, `capture`), OpenAPI and `hosted:types`.
2. Extractor plus merge, TDD from the fixture manifest.
3. `ReadDispatcher`, the OCR client (`OcrReadError`), and the job route with OIDC, claim/lease, sweep and terminal 2xx.
4. `complete` and approve/file/PATCH fill-absent changes; the grant-time backlog command.
5. The `receipt-ocr` sidecar with decode caps, pytest, the CI job and the licence list.
6. Terraform: service, queue, VPC egress lock, service accounts and tftest; `deploy.sh` and `rollback.sh`.
7. Portal: poll, "Reading…", safe refill; i18n ar and en.
8. Benchmark (ask Basel for the receipts here); AC1 and AC6 numbers.
9. Privacy copy, which Basel approves; release-QA feature and spec; docs (ADR-220, PATTERNS, INFRA, TEST_PLAN, CHANGELOG, before-release.md).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| Eng Review | `/plan-eng-review` | Architecture and tests (required) | 1 | CLEAR (all decisions resolved) | 10 own + 10 outside voice; 4 CRITICAL own (F1, F2, F4) and 5 CRITICAL outside (#1–#5); all resolved through R-D1, R-D2 and R3–R10 |
| Outside Voice | native Claude fallback | Independent second opinion | 1 | issues_found → resolved | 10 findings; 3 verified by me, all accepted |
| CEO Review | `/plan-ceo-review` | Scope and strategy | 0 | not run | — |
| Design Review | `/plan-design-review` | UI/UX | 0 | not run | — |

- **VERDICT:** ENG CLEARED, ready to build after the amendments A1–A5.
- **OUTSIDE COVERAGE / CROSS-MODEL:** the native Claude subagent only (Codex is not installed); no cross-model check.
- **Scope Challenge:** scope reduced per recommendation (QR deferred).

NO UNRESOLVED DECISIONS
