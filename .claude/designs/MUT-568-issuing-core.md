# MUT-568 — Issuing core: issued documents as an immutable, sequentially numbered record

Status: **Planned — D1–D7 accepted by Basel 2026-11-22**; eng review runs at the start of /eng-build · 2026-11-22 · Epic MUT-566 · Server only (no UI)

## Problem

Registered invoicing software must keep every issued document forever: no edits, no deletes, gap-free automatic numbering per document type, corrections only by a new document (credit note). Ledger rows are editable (ADR-083, ADR-075), so issued documents are a separate, append-only record that *posts* to the ledger.

This reverses ADR-067 (MUT-145, "document generation is retired") for issuing — Basel, 2026-11-06. A new **ADR-260** supersedes ADR-067 for issuing only; filed receipts and `/documents` attachments are unaffected.

## Acceptance criteria (from the ticket)

1. An issued document cannot be edited or deleted through any route or store (contract test).
2. Concurrent issues never produce a duplicate or skipped number (test).
3. A credit note issues against an original and reverses its ledger entry.
4. Each copy reads "מקור" once and "העתק" on every other copy.
5. The gap report lists missing numbers (none in normal use).

## What the Tax Authority API tells us about the record (read 2026-11-22)

From `EilatInvoiceApprovalApi v1` (the Eilat sibling of the general Invoices approval API; general spec to be pulled from the sandbox, MUT-638). The document must carry, so MUT-572 can send it unchanged:

| API field | Our field |
|---|---|
| `Invoice_Type` (305 …) | `docType` code |
| `Invoice_Reference_Number` (≤20) | `number` |
| `Vat_Number` / `Union_Vat_Number` | issuer snapshot `vatId` |
| `Customer_VAT_Number`, `Customer_Name` (≤25) | customer snapshot `taxId`, `name` |
| `Invoice_Date`, `Invoice_Issuance_Date` | `documentDate`, `issuedAt` (date part) |
| `Accounting_Software_Number` | registration number (config; MUT-567) |
| `Amount_Before_Discount`, `Discount`, `Payment_Amount`, `Vat_Amount`, `Payment_Amount_Including_VAT` | `subtotalMinor`, `discountMinor`, `netMinor`, `vatMinor`, `grossMinor` |
| `Action` 3 = reverse charge | `vatTreatment = REVERSE_CHARGE` (later, with MUT-572) |
| item `Category` (goods/service), `Description` (≤30), `Quantity`, `Price_Per_Unit`, `Discount`, `Total_Amount`, `VAT_Rate`, `VAT_Amount` | `IssuedDocumentLine` |

So the core stores per-line discount, goods/service kind, per-line VAT rate and amount, a document discount, and both dates — even though the first UI may only use some of them.

## Design

### Module

`server/src/issuing/` — the **issuing core**, versioned on its own (`ISSUING_CORE_VERSION = '1.0.0'` in `issuing/version.ts`, stamped on every document; bumped only when a rule in this folder changes). Its tests live in `server/src/issuing/__tests__/` and run as their own Vitest project (`npm --prefix server run test:issuing`), so a registration "version" maps to a folder and a suite.

| File | Holds |
|---|---|
| `issuing/types.ts` | `DocType` (`TAX_INVOICE 305`, `TAX_INVOICE_RECEIPT 320`, `RECEIPT 400`, `CREDIT_NOTE 330`), codes table |
| `issuing/compose.ts` | pure: validate input, compute lines → totals (reuses `vat.ts` `computeVat`/`roundHalfUpDiv`, `money.ts`), issuer/customer snapshots |
| `issuing/rules.ts` | pure rules: VAT-exempt dealer can't issue 305/320; credit note ≤ original's remaining; date not before the last issued document of the type (D6); ILS only (D4) |
| `issuing/numbering.ts` | display format (plain integer, D2) |
| `issuing/copies.ts` | "מקור"/"העתק" from copy index |
| `issuing/version.ts` | `ISSUING_CORE_VERSION` |

### Data (Prisma migration)

```prisma
enum IssuedDocType { TAX_INVOICE TAX_INVOICE_RECEIPT RECEIPT CREDIT_NOTE }
enum DealerType    { LICENSED EXEMPT COMPANY NONPROFIT }

model IssuerDetails {          // 1:1 Organization; editable (If-Match); snapshotted on issue
  organizationId String @id @db.Uuid
  legalName  String; vatId String @db.VarChar(9); dealerType DealerType
  address String?; city String?; phone String?; email String?; website String?
  logoAttachmentId String? @db.Uuid   // the business's logo, printed by MUT-640's PDF
  ink String @default("BLACK") @db.VarChar(5) // BLACK | BLUE: the only two print colours (Basel, 2026-11-22)
  documentStyle String @default("PROFESSIONAL") @db.VarChar(32) // a key in issuing/styles.ts (PROFESSIONAL | MODERN | MINIMAL today); a string, not an enum, so a new style needs no migration
  version Int @default(1)
}

model IssuedDocumentCounter {  // ADR-217 counter pattern, per type, never per year
  organizationId String @db.Uuid; docType IssuedDocType
  next Int                     // seeded from the starting number (D3)
  @@id([organizationId, docType])
}

model IssuedDocument {         // INSERT only (trigger below)
  id String @id @default(uuid()) @db.Uuid
  organizationId String @db.Uuid; docType IssuedDocType; number Int
  documentDate String @db.VarChar(10); issuedAt DateTime
  currency String @db.VarChar(3)
  subtotalMinor BigInt; discountMinor BigInt; netMinor BigInt; vatMinor BigInt; grossMinor BigInt
  vatRateBasisPoints Int
  issuer   Json   // IssuerDetails snapshot
  customerId String? @db.Uuid; customer Json   // name, taxId, address, email snapshot
  language String @db.VarChar(2)                // he | ar | en (PDF language, chosen at issue)
  style String @db.VarChar(32); ink String @db.VarChar(5) // snapshotted at issue: every later copy prints exactly like the original, even if the business changes its style
  notes String?
  originalId String? @db.Uuid                  // credit note → original
  paymentDetails Json?                          // 320/400: method, reference, date
  allocationNumber String? @db.VarChar(9)       // MUT-572 fills before insert
  receivableId String? @db.Uuid; paymentId String? @db.Uuid; creditId String? @db.Uuid
  coreVersion String @db.VarChar(16)
  createdByUserId String @db.Uuid
  @@unique([organizationId, docType, number])
  @@index([organizationId, customerId, documentDate])
}

model IssuedDocumentLine {     // INSERT only
  documentId String @db.Uuid; index Int
  description String; kind String @db.VarChar(7) // GOODS | SERVICE
  quantityMilli BigInt; unitPriceMinor BigInt; discountMinor BigInt
  netMinor BigInt; vatRateBasisPoints Int; vatMinor BigInt
  @@id([documentId, index])
}

model IssuedDocumentCopy {     // append-only; one row per produced copy (PDF render/send)
  documentId String @db.Uuid; copyIndex Int     // 0 = מקור, ≥1 = העתק
  producedAt DateTime; producedByUserId String @db.Uuid; channel String // DOWNLOAD | EMAIL | SHARE
  @@id([documentId, copyIndex])
}
```

- **Immutability at the database**, not only in code: the migration adds a `BEFORE UPDATE OR DELETE` trigger on `IssuedDocument`, `IssuedDocumentLine`, `IssuedDocumentCopy` that raises. The store has no update/delete methods for them. Org deletion/close-account (MUT-333) must skip or anonymize-by-policy these rows — **flag for MUT-333** (legal retention 7 years).
- `Customer` gains nullable `taxId VarChar(9)` and `address` (needed for 572's `Customer_VAT_Number`); snapshotted, so later customer edits never change a document.
- Copies are a separate table so the document row is never touched; the copy index is taken under the same row lock pattern (`SELECT … FOR UPDATE` on the document).

### Issue transaction (one `$transaction`, like `fileAsIncome`, ADR-222)

1. Lock + increment `IssuedDocumentCounter` (upsert row lock ⇒ serialised, rollback-safe ⇒ gap-free).
2. Rules that need the DB: last `documentDate` of the type (D6), credit-note remaining on the original (`SELECT … FOR UPDATE` on the original).
3. *(MUT-572 hook: allocation number is requested before the transaction and passed in; 568 leaves `allocationNumber` null.)*
4. Insert document + lines.
5. Post to the ledger (D5) and store the ledger ids on the document.
6. Audit `issued_document.issued` (session-only entity type → hidden from Malafat's feed).

### Ledger posting (D5)

| Doc | Ledger effect |
|---|---|
| 305 tax invoice | `Receivable` (new origin `ISSUED_DOCUMENT`, real VAT split, `number` = CHG counter as today), `title` "חשבונית מס 1042" |
| 320 invoice-receipt | `Receivable` + `Payment` (origin new `ISSUED_DOCUMENT`) fully allocated → shows as Received, statement stays right |
| 400 receipt | `Payment`; optionally allocated to an open 305's receivable (`appliesToDocumentId`) |
| 330 credit note | `ReceivableCredit` (reasonCode `CREDIT_NOTE`) on the original's receivable (ADR-206 path) |

Ledger rows created by a document are **locked from edit/delete** (409 `DOCUMENT_LOCKED` via `details.reason` on the existing conflict code): their money is owned by the document. Payments against a 305 stay normal ledger actions.

### API (session only, owner of a non-personal profile, feature `invoicing`)

| Route | |
|---|---|
| `GET/PUT /v1/issuer` | issuer details (If-Match on PUT) |
| `GET/PUT /v1/issuing/settings` | starting numbers per type; PUT refused once a type has a document |
| `POST /v1/issued-documents/preview` | compose + rules, no write (the UI's live totals and the "טיוטה" PDF in MUT-570) |
| `POST /v1/issued-documents` | issue; `idempotent(store,'issued_document.issue')` |
| `GET /v1/issued-documents` (`type`, `customerId`, paging) · `GET /v1/issued-documents/{id}` | |
| `POST /v1/issued-documents/{id}/copies` | records a copy, returns `{copyIndex, label: 'ORIGINAL'|'COPY'}` (MUT-570's PDF calls it) |
| `GET /v1/issuing/gaps` | per type: start, last, missing numbers |

Wiring: `PORTAL_ROUTES`, scopes `issuing:read`/`issuing:write` in `auth/scopes.ts`, a `WRITABILITY_MATRIX` row (session-only, writer = owner), accountants: reads allowed under a grant (added to `ALLOWED_GETS`), writes refused; `features.ts` gains `invoicing`; `hasFeature` check → 404 switched-off like `accountant_access`; lapse gate applies automatically (profile-scoped POST). Not available in the signed-out portal (local mode refuses with `NOT_FOUND`). `API_VERSION` → `1.115.0-mut568` (+ the two pinned tests). `openapi:generate`.

## Decisions for Basel

- **D1 Gating** — feature flag `invoicing` (per account, operator-granted) + non-personal profile. *Rec.* Not tied to `firmEnabledAt`.
- **D2 Number format** — plain integers per type (1042), no year prefix; the type label carries the meaning. *Rec.* (Israeli practice; matches `Invoice_Reference_Number`.)
- **D3 Starting number** — settable per type before the first document of that type, then fixed. *Rec.*
- **D4 Currency** — ILS only in v1. Foreign-currency invoices need the Bank of Israel representative rate snapshot and ILS VAT; follow-up ticket. *Rec.*
- **D5 Ledger posting** — as tabled above (320 = Owed + Received allocated). *Rec.*
- **D6 Date rule** — a document's date may not be earlier than the last issued document of the same type, and not in the future. *Rec.; confirm with the accountant.*
- **D7 Drafts** — no stored drafts in 568: the preview endpoint is stateless and the "טיוטה" watermark is MUT-570's PDF. Stored drafts later if the UI needs them. *Rec.*

## Tests (TDD; `issuing/__tests__` + route + `test:db`)

- compose: line math (qty × price − discount, per-line VAT, rounding half-up), document discount spread, 0-VAT lines, exempt dealer refused for 305/320.
- rules: credit note > remaining refused; date before last refused; future date refused.
- AC1: route matrix has no PATCH/DELETE under `/v1/issued-documents`; store port has no update/delete; **test:db**: raw `UPDATE`/`DELETE` on each table throws (trigger).
- AC2: **test:db** 25 concurrent issues → numbers 1..25, no dupes, no gaps; a failing issue mid-batch (forced rollback) leaves no gap.
- AC3: credit note → `ReceivableCredit`, receivable `creditedMinor` updated, statement balance drops.
- AC4: first copy ORIGINAL, next three COPY; concurrent copy requests get distinct indexes.
- AC5: gaps empty in normal use; with a seeded hole (test-only direct insert) the hole is listed.
- Ledger lock: PATCH/DELETE on a document-owned receivable/payment → 409 `DOCUMENT_LOCKED`.
- Gating: personal profile 404, flag off 404, accountant write 403, lapsed 402, Malafat audit feed never shows `issued_document.*`.
- Idempotent replay returns the same document, no second number.

## Cost / scale

One transaction per issue, ~6 statements; counters per (org, type) mean no global hot row. Documents are small JSON snapshots; index on (org, customer, date) serves the lists. No third-party calls in 568.

## Out of scope

Screens, PDF, allocation numbers (MUT-572), unified-file export (MUT-569), foreign currency (D4 follow-up), stored drafts (D7), delivery notes/quotes/proformas.

## Flags raised

- **MUT-333 close account** must not delete issued documents (retention) — note on MUT-333.
- **Allocation needs the registration number**: `Accounting_Software_Number` is required by the API ⇒ real numbers wait for MUT-567. Note on MUT-572/MUT-639.
- Web guard `noDeadDocumentModules.test.ts` (ADR-067) — new code lives in `server/src/issuing/`, outside the retired paths; check the guard doesn't match.

## Eng review and Basel's decisions (2026-11-22) — these override the sections above

**Decisions (Basel):**
- **R-D1 Close account → keep 7 years.** The account purge skips the issuing tables: issued documents, lines, copies, counters and the issuer details stay; everything else is deleted. The issuing tables therefore hold **no foreign keys** to `Organization`, `Customer`, `Receivable`, `Payment` or `User` (plain uuid columns + indexes); the customer and issuer are JSON snapshots. Deletion after 7 years and owner copies: **MUT-644**.
- **R-D2 Credit notes v1:** only against a 305, up to what's still owed on it (`ReceivableCredit` refuses more); otherwise 422 `ORIGINAL_PAID`. Paid invoices and 320s: **MUT-643**.
- **R-D3 Customer VAT number/address** move to **MUT-642**; 568 snapshots the customer's name only.

**Review fixes folded in:**
1. **Trigger:** `BEFORE UPDATE OR DELETE` per row plus a statement-level `BEFORE TRUNCATE`, on all issuing tables; bypass only when `current_setting('mutaba3a.issuing_bypass', true) = 'on'` (set with `SET LOCAL` by the MUT-644 sweep only). Purge catalog test updated: issuing tables are listed as *retained*, not purged; user columns (`createdByUserId`, `producedByUserId`) are kept (no FK).
2. **Idempotent by design:** `requestKey` on `IssuedDocument`, `@@unique([organizationId, requestKey])`; inside the transaction an existing key returns the existing document. The `idempotent()` middleware stays on top. Copies get `idempotent(store,'issued_document.copy')`.
3. **Counter:** one raw `INSERT … ON CONFLICT (organizationId, docType) DO UPDATE SET next = next + 1 RETURNING next` as the transaction's first statement; default READ COMMITTED; the D6 "not before the last date" read happens after that lock.
4. **Gate on the owner:** `hasFeature(store, organization.ownerUserId, 'invoicing')`; accountants read under a grant (`issuing` in `ACCOUNTANT_DOMAINS`, matrix seed). Profiles connected to Malafat are refused in v1 (no delegated security on issuing routes). Scopes go in `SESSION_ONLY_SCOPES`; `Domain` gains `issuing`; writability row also in `hosted-portal.md`.
5. **New origin `ISSUED_DOCUMENT`** on `ReceivableOrigin` and `PaymentOrigin` (own migration, rollback hazard + DEPLOYMENT row) and every touchpoint: ports, schemas, serializers (`'integration'` labelling, `FEED_PAYMENT_ORIGIN`), share-link visitor, period-pack labels, payments origin filter, statements (falls to adjustment wording for v1), memory filters, the Income feed (**issued tax invoices appear in Income**), regenerated portal types. `createAdjustmentTx` generalised to `createReceivableTx(origin, originId)`.
6. **Ledger lock:** the person-side edit/delete/settle/credit/reverse/correct routes already refuse rows that aren't ADJUSTMENT/CAPTURE (404); tests assert 404, and the store refuses document-owned rows in `undoCapture`/`softDeleteAdjustment`/`credit` as defence in depth.
7. **Credit reason:** `reasonCode 'OTHER'`, reason "חשבונית זיכוי <n>", linked by `IssuedDocument.creditId` (the published enum is unchanged).
8. **Customer required** for 305/320/330; only a 400 may have none.
9. **VAT source:** the statutory table in `issuing/vat-rate.ts` is deliberate: the issuing core is the registered version and a business can't edit the national rate (ADR-260).
10. **Memory store** implements every new port method; issuing maps stay out of `snapshot()` (like `featureGrants`); local profiles have no grants, so they 404 without special code.
11. **Style/ink/language** columns on `IssuedDocument` with defaults now (immutable rows can't be backfilled); `IssuerDetails` keeps `documentStyle`/`ink`/`logoAttachmentId` columns but no editing UI until MUT-570/640.
12. Records export and restore leave issued documents out (the unified file is MUT-569).
13. Gaps: from the starting number to `next − 1`.

**Build order:** (1) compose ✔ · (2) enum migration · (3) issuing tables + triggers + purge catalog · (4) origin touchpoints + `createReceivableTx` · (5) store issue transaction, Prisma + memory, with test:db concurrency/rollback/trigger tests · (6) credit note + copies · (7) routes, gating, scopes, matrix, audit, idempotency, API 1.115.0-mut568, OpenAPI · (8) gaps + ADR-260 + knowledge files.

**Build note (2026-11-22):** document-owned Owed rows stay out of the entries feed in 568: the feed's income rows carry no origin, so the portal and phone would offer edit/delete that 404. Received rows from 320/400 do appear, as `origin: 'issued_document'` (the phone already treats an unknown origin as not editable). MUT-570 adds document rows to the feed with their own UI.
