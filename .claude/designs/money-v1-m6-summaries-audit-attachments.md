# Money v1 — Milestone 6: summaries, audit listing, attachments (design brief)

- **Date:** 2026-10-08 · **Status:** decided by the engineering owner under the "complete the epic" instruction; implemented the same day (Mutaba3a `server/`, API `1.5.0-m6`; Malafat side in §6)
- **Tickets:** MAL-939 (epic), MAL-150 (UX brief, wireframes §2, §3, §3c, §7) · **Plan:** `money-v1-api-contract.md` §M6 · **Builds on:** M3–M5 receivables, payments, credits, versions
- **Repo side:** Mutaba3a `server/` (summaries module, audit list, attachments table + storage port + GCS adapter, Terraform bucket + IAM) and Malafat `crm-platform/apps/web` (overview banner + client list, client Money card, tiles, Documents and History sections). Malafat schema unchanged (ADR-150).

## 1. Problem and acceptance criteria

Everything that is owed, paid, credited and versioned now exists in Mutaba3a, but every Malafat surface still shows per-item figures and counts because Malafat computes no sum (ADR-150, M3 decision 1). The overview has no banner, the client list has no balances, the client and matter pages have no tiles, and no document or history can be attached to a payment. M6 closes the epic:

1. **Summaries** — `GET /v1/summaries/organization[?currency=]`, `GET /v1/summaries/customers/{id}`, `GET /v1/summaries/projects/{id}`: outstanding split into overdue / due today / not yet due, unallocated payments, last payment date, and a **status computed by Mutaba3a** for every customer and project, per currency. Malafat renders these verbatim.
2. **Audit listing** — `GET /v1/audit?entityType=&entityId=&action=&cursor=&limit=` (scope `audit:read`): the organization's financial history filtered by entity, keyset-paginated, for the History block on payment detail and later screens.
3. **Attachments** — `POST /v1/attachments/uploads`, `POST /v1/attachments/{id}/complete`, `GET /v1/attachments?customerId=|projectId=|paymentId=`, `GET /v1/attachments/{id}/download`, `DELETE /v1/attachments/{id}`: invoices, receipts and other PDFs / JPEGs / PNGs up to 10 MB, stored in a private GCS bucket, reached only through short-lived signed URLs, linked to a customer, project or payment.

Acceptance:

- Per-currency totals satisfy `outstanding = overdue + dueToday + notYetDue` and equal the sum of the open receivables' outstanding; `unallocated` equals the sum of POSTED payments' unallocated funds; statuses follow the vocabulary in §3 and never read `PAID_IN_FULL` while an installment is pending.
- Audit listing is organization-scoped, filterable, keyset-paginated like every other list.
- An upload needs `attachments:write`; a download URL expires; the object key is never derived from user input; completing an upload verifies that the object exists with the declared size and type (otherwise `422 UPLOAD_INCOMPLETE` / `UPLOAD_MISMATCH`); a deleted attachment disappears from lists and its object is removed; nothing is reachable without a signed URL. When no bucket is configured every attachments route answers `503 ATTACHMENTS_NOT_CONFIGURED`.
- Every M1–M5 test stays green; `openapi:check` green; API version `1.5.0-m6`.

## 2. API

| Method & path | Scope | Notes |
|---|---|---|
| `GET /v1/summaries/organization?currency=` | `summaries:read` | `{ asOf, currencies: [{ currency, outstanding, overdue, dueToday, notYetDue, unallocated, counts: { customers, overdueCustomers, unallocatedPayments }, customers: [{ customerId, outstanding, overdue, dueToday, notYetDue, unallocated, lastPaymentOn, status }] }] }`; `currency` narrows to one block |
| `GET /v1/summaries/customers/{id}` | `summaries:read` | `{ customerId, asOf, lastPaymentOn, currencies: [{ currency, outstanding, overdue, dueToday, notYetDue, unallocated, status, projects: [ProjectSummary] }] }` |
| `GET /v1/summaries/projects/{id}` | `summaries:read` | `ProjectSummary = { projectId, currency, kind: FIXED \| RETAINER \| NONE, agreed (fixed gross \| null), monthly (retainer current gross \| null), posted, paid, credited, outstanding, overdue, dueToday, notYetDue, pending: { count, amount }, status }` |
| `GET /v1/audit?entityType=&entityId=&action=&cursor=&limit=` | `audit:read` | `{ items: AuditEvent[], nextCursor }`, oldest first (keyset on createdAt, id) |
| `POST /v1/attachments/uploads` | `attachments:write` | `{ kind: INVOICE \| RECEIPT \| OTHER, filename, mimeType (application/pdf, image/jpeg, image/png), sizeBytes (≤ 10 MB), customerId? \| projectId? \| paymentId? (exactly one), invoiceNumber?, invoiceDate? }` → `201 { attachment, upload: { url, method: PUT, headers, expiresAt } }`; the attachment is `PENDING_UPLOAD` |
| `POST /v1/attachments/{id}/complete` | `attachments:write` | verifies the object (size, content type) → `READY`; `422 UPLOAD_INCOMPLETE` when the object is missing, `UPLOAD_MISMATCH` when size or type differ |
| `GET /v1/attachments?customerId=\|projectId=\|paymentId=&cursor=&limit=` | `attachments:read` | READY attachments of the entity; a payment's list also includes the customer's invoices? — no: exactly the entity asked for |
| `GET /v1/attachments/{id}/download` | `attachments:read` | `{ url, expiresAt, filename, mimeType }`, 15-minute signed URL with `response-content-disposition: attachment; filename=` |
| `DELETE /v1/attachments/{id}` | `attachments:write` | soft delete + object removal; idempotent (204) |

New reasons / codes: 422 `UPLOAD_INCOMPLETE`, `UPLOAD_MISMATCH`, `ATTACHMENT_TARGET_REQUIRED`, `ATTACHMENT_TARGET_AMBIGUOUS`, `MIME_TYPE_UNSUPPORTED`, `FILE_TOO_LARGE`, `ATTACHMENT_NOT_READY`; 503 `ATTACHMENTS_NOT_CONFIGURED` (top-level error code).

## 3. Status vocabulary (computed here, never by the client)

- **Customer (per currency):** `SETTLED` (nothing outstanding), `OVERDUE` (any overdue), `OUTSTANDING` (something due today, nothing overdue), `UP_TO_DATE` (only not-yet-due).
- **Fixed-fee project:** `PENDING` (nothing posted yet, installments pending), `OUTSTANDING`, `PARTIALLY_PAID`, `OVERDUE`, `PAID_IN_FULL` (nothing outstanding **and** no pending installment).
- **Retainer project:** `UP_TO_DATE`, `OUTSTANDING`, `OVERDUE`, `CANCELLED` (cancelled, balance remains), `SETTLED` (cancelled, nothing outstanding).
- **Project without agreements:** `NONE`.
- Day buckets: `overdue` = due before today, `dueToday` = due today, `notYetDue` = due after today (organization timezone).

## 4. Data model and storage

- `attachments` (new): `id, organizationId, kind, filename, mimeType, sizeBytes, status (PENDING_UPLOAD \| READY), storageKey, customerId?, projectId?, paymentId?, invoiceNumber?, invoiceDate?, uploadedByKeyId, requestId?, createdAt, completedAt?, deletedAt?`. Storage key `org/{organizationId}/{attachmentId}` — never the filename.
- `AttachmentStorage` port: `signUpload(key, { mimeType, sizeBytes, ttlSeconds })`, `signDownload(key, { filename, mimeType, ttlSeconds })`, `head(key)`, `remove(key)`. `GcsAttachmentStorage` (`@google-cloud/storage`, V4 signed URLs through the service account's IAM signBlob — no key file) and `MemoryAttachmentStorage` for tests (objects are "uploaded" through a test hook).
- Config: `ATTACHMENTS_BUCKET` (optional; absent = routes 503), `ATTACHMENTS_URL_TTL_SECONDS` (default 900). Terraform: `google_storage_bucket` (regional, uniform access, no public access, 30-day abort of incomplete multipart uploads), `roles/storage.objectAdmin` on the bucket and `roles/iam.serviceAccountTokenCreator` on the service account for itself, the env var on Cloud Run. **Operator step:** `terraform apply` creates the bucket; nothing else to do.
- Audit: `AuditRepository.list(organizationId, filter, page)`; index `(organizationId, entityType, entityId, createdAt)`.

## 5. Decisions (owner's, recorded for review)

1. **Summaries are computed on read from receivables and payments**, not materialized. Volumes are per firm and bounded; correctness beats caching; nothing can drift.
2. **Day buckets are exact** (overdue / due today / not yet due) so `outstanding` always decomposes; the wireframe's "due now" is "due today".
3. **Attachments are reached through signed URLs only**, uploaded by Malafat's server (which proxies the browser's file to the signed URL), so the bucket needs no CORS and never sees a browser origin.
4. **No malware scan in v1.** The contract said "scanned before READY"; no scanner exists in this stack. `complete` verifies size and content type and the UI offers download, never inline rendering. A scanner (Cloud Storage → event → scan → status) is a listed follow-up, not a blocker for a Partner uploading their own invoices.
5. **Soft delete.** A mistaken upload is deleted (object removed, row kept with `deletedAt`) — audit `attachment.deleted`.
6. **Audit list is oldest-first with the shared keyset cursor**, like every list; the client shows it newest-first.
7. **Scopes:** `summaries:read`, `audit:read`, `attachments:read` / `attachments:write` — already in `MALAFAT_REQUIRED_SCOPES`, so the pilot key needs no reissue.

## 6. Malafat side (same brief)

- **Overview** (wireframe §2): banner from the organization summary with currency tabs (outstanding incl. not yet due, overdue + customer count, unallocated + payment count), the client table (client, active matters, outstanding, overdue, last payment, status) built by joining the summary's customers to the firm's linked clients; "N clients have no financial tracking yet · Show them" reveals the existing sync table. Mutaba3a unreachable → an unavailable banner with Retry (no cached figures: Malafat stores none).
- **Client financial page:** tiles (outstanding, overdue, unallocated) from the customer summary; the matters table gains Paid / Remaining / status from the project summaries; Documents section (list, upload, download, delete).
- **Matter financial page:** tiles from the project summary (agreed, paid, remaining, overdue; pending count/amount); Documents section.
- **Client page Money card** (§3c): outstanding, overdue, last payment, Record payment / View finances; "Set up financial tracking" when not linked.
- **Payment detail:** Documents (receipts) and History (audit for the payment).
- Routes: `POST /api/admin/money/attachments` (multipart → upload → PUT → complete), `GET /api/admin/money/attachments/{id}/download` (302 to the signed URL), `DELETE /api/admin/money/attachments/{id}`; summaries and audit are read by server components through the service.

## 7. Out of scope

Malware scanning (follow-up); invoice numbering and tax documents; CSV / PDF exports; a cross-client ledger page; Flutter.
