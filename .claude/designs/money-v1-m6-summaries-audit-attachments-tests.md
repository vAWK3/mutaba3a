# Money v1 — Milestone 6 test plan

Companion to `money-v1-m6-summaries-audit-attachments.md`. Written before implementation.

## Unit (pure)

| File | Cases |
|---|---|
| `src/summaries/__tests__/compute.test.ts` | day buckets (overdue / due today / not yet due) in the organization timezone; `outstanding = overdue + dueToday + notYetDue`; unallocated from POSTED payments only; customer status table (SETTLED / OVERDUE / OUTSTANDING / UP_TO_DATE); fixed project status incl. `PENDING` and never `PAID_IN_FULL` with a pending installment; retainer status incl. CANCELLED / SETTLED; `lastPaymentOn` ignores reversed payments; currencies separated |
| `src/attachments/__tests__/rules.test.ts` | mime allow-list, 10 MB limit, exactly one target, storage key never contains the filename, download disposition escapes the filename |

## Storage contract (`store-contract-m6.ts`, memory + Postgres)

- `audit.list` filters by entityType / entityId / action, keyset paginates, organization-scoped.
- `attachments.create / get / list / complete / softDelete`; a deleted attachment leaves lists; per-entity listing; organization isolation.

## Routes (`routes-m6.test.ts`)

- Summaries: a firm with two customers, two currencies, a retainer and a fixed agreement, one payment with unallocated funds, one credit: organization summary totals and per-customer rows; `?currency=` narrows; customer and project summaries; statuses; scope `summaries:read` required.
- Audit: lists the organization's events by entity, paginates, 403 without `audit:read`, other organization sees nothing.
- Attachments: create upload (201, PENDING_UPLOAD, signed URL from the storage port), complete (READY) after the memory storage receives the object; `UPLOAD_INCOMPLETE` before; `UPLOAD_MISMATCH` on a different size; list by payment / project / customer; download URL; delete → 204, gone from the list, object removed; mime / size / target validation; 503 when no storage is configured; audit `attachment.uploaded` / `attachment.deleted`.
- Contract: new paths; version `1.5.0-m6`.

## Malafat

- Client methods + contract test for the nine new calls; `summaries-service` (overview view joins customers to clients; client card; tiles), `attachments-service` (upload proxy: create → PUT → complete; download; delete); routes with specs and role matrix (multipart body validation: file present, size, mime, exactly one target); i18n parity for the new blocks and status enums.
