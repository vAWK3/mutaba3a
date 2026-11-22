# MUT-570 — Portal: issue an invoice, invoice-receipt, receipt or credit note

Status: **In Progress 2026-11-22** (overnight run, Basel's standing approval; top priority per the orchestrator) · Epic MUT-566 · Builds on MUT-568 (core), MUT-640 (PDF), MUT-642 (client number), MUT-646 (setup) · Wireframes: round 2, direction B portal (P1–P6) and entry points (E2, E5/E6) · Assets: Claude Design batch 2 (`~/Downloads/invoicing-batch2-MUT-570-573`: doc-issued / doc-sent moments, 5 document icons).

## Acceptance criteria (ticket)

1. A tax invoice issued in the portal gets the next number, a PDF and an Owed entry.
2. An invoice-receipt creates a Received entry.
3. A credit note from an issued invoice reverses it.
4. The PDF renders correctly in Hebrew, Arabic and English (fixtures; MUT-640 owns the engine and its gate).
5. Personal profiles see no issuing.

Comments (Basel, 2026-11-22): the issuer-details screen and the style picker are MUT-646 (done). **Styles come from the server's list**, so new ones appear without a portal release.

## Scope as built

- **Server (small):** `GET /v1/issuing/styles` → `[{ key, … }]` from `DOCUMENT_STYLES`; the portal's style picker (MUT-646) reads it instead of a hard-coded list.
- **Documents page:** tabs "Issued · Files" when issuing answers (`/p/:id/documents/issued`, `/p/:id/documents`). The Issued tab lists `GET /v1/issued-documents` (number, type, client, amount, date, paid status from its Owed), and has one primary action, "Issue a document". Gated on setup: until `canIssue`, the button explains what's missing and links to the setup (AC1 of MUT-646).
- **Issue drawer (P1, P2, P4):**
  - Client card: recent clients first (from issued documents), search by name or number, "+ Add client" (MUT-642's create with number).
  - Type: tax invoice, invoice-receipt, receipt, credit note. An exempt dealer gets receipts only.
  - Lines: description, quantity, price; per-line options inline (goods/service, discount, own VAT setting, VAT-exempt). One "prices include VAT" switch per document, defaulting to the profile's setting.
  - Live totals from `POST /v1/issued-documents/preview`.
  - Date (today), due date (the profile's payment terms), language (the profile's default), notes.
  - Details | Preview switch: the draft PDF (`POST /v1/issued-documents/preview/pdf`, watermarked טיוטה).
  - The issue button states the type, with one line: issued documents are final and corrected by a credit note.
  - Idempotency-Key per attempt.
- **Issued (P6, E5/E6):** the "document issued" moment (batch 2), then the document page `/p/:id/documents/issued/:documentId` with:
  - the PDF: view, plus download as a produced copy (`POST …/pdf`, the first is the original);
  - remaining amount;
  - record a payment and issue a receipt (P3: the amount defaults to the remainder);
  - issue a credit note (prefilled from the invoice's lines);
  - issue a similar document (duplicate as a new draft).
- **Client page (E2):** "Issue a document for this client" opens the drawer with the client prefilled. The client's Documents tab lists the client's issued documents.
- **Copy:** en + ar, formal MSA. Hebrew is the document language only.

## Out (stated, not silently dropped)

- **Send by email:** waits for MUT-641 (signed PDFs are the legal original when sent).
- **Allocation-number states (P5):** MUT-572/574.
- **"Documents" as its own top-level nav item** (the wireframe's shell): a shell change, flagged to Basel as a follow-up.

## QA (portal app, FakeApi)

- `portal.invoicing.issue-invoice`: drawer → client → lines → preview → issue → document page with number 1 and an Owed (AC1).
- `portal.invoicing.issue-receipt`: an invoice-receipt with payment (AC2); a receipt paying an open invoice (P3).
- `portal.invoicing.credit-note`: from the document page; the invoice's remaining amount drops (AC3).
- `portal.invoicing.gate`: setup incomplete → the button says what's missing; a personal profile has no Issued tab (AC5).
