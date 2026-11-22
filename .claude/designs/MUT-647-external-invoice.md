# MUT-647 — Attach an invoice issued elsewhere to an income entry

Epic MUT-566. Design: round 3, attach A+B (Claude Design batch 3: `invoicing-empty-attach`, `invoicing-reading`).
ADR-267. API `1.125.0-mut647`. Server and portal here; the phone half waits for MUT-573.

## Acceptance criteria

1. An attached invoice shows on its entry with its number and date, and its file opens.
2. The reader prefills the fields; the person can correct them.
3. Issuing a MTB3A invoice from an entry that already has an external invoice is refused with a clear message.

## Design (round 3, A+B)

- **A, from the entry:** Attach → choose the file → reading → confirm (number, date, total) → attach.
- **B, drop:** a file dropped on an Owed or Received row opens the same drawer, already reading. (Phone: share a file, later.)
- Lists show a document icon and "Issued elsewhere". An amount that differs from the entry's is said, never blocking.
- MTB3A never numbers it, and it never goes in the uniform file.

## Server

- Table `external_invoices`: organizationId, entryKind (OWED | RECEIVED), entryId, attachmentId, number (≤ 64), documentDate, createdByUserId, createdAt, removedAt. One live row per entry (a partial unique index); a race answers `exists`.
- The file is the entry's INVOICE attachment (invoiceNumber, invoiceDate, the entry's customer, paymentId for a Received). The issuing store writes it with the link in one transaction, because session writes to the attachments domain are refused (they're Malafat's). The route writes the bytes to storage first (`AttachmentStorage.write`; the bucket has no CORS for a browser PUT) and deletes them if it loses the race.
- Routes, behind the issuing gate (the owner's `invoicing` feature; owner writes, accountants read):
  - `POST /v1/issuing/external-invoices/read`: raw body (PDF/JPEG/PNG by magic bytes, ≤ 10 MB) → `{ read, number, documentDate, amount }`. Reader errors answer `read: false`; nothing is stored.
  - `POST /v1/issuing/external-invoices?entryKind&entryId&number&documentDate&filename`: raw body → 201. 404 unknown entry; 409 `ISSUED_HERE` (an Owed MTB3A issued); 409 `EXTERNAL_INVOICE_EXISTS`; 503 `ATTACHMENTS_NOT_CONFIGURED`.
  - `GET /v1/issuing/external-invoices?entryKind&entryIds` (≤ 100 ids), `GET …/{id}/file` (signed inline URL), `DELETE …/{id}` (soft-deletes the link and the attachment).
- The issue gate: `fromEntry` with a live external invoice → 409 `EXTERNAL_INVOICE_ATTACHED` with the number.
- The number reader (`issuing/external-reading.ts`): Hebrew חשבונית מס / מספר / מס', Arabic فاتورة ضريبية رقم, English invoice no / # / number. The date and total come from the receipts reader (ADR-199), with no upload-day window.

## Portal

- `useExternalInvoiceColumn(kind, rows, amountOf, eligible)`: the Document column, the row drop, and the drawer. Shown where `GET /v1/issuing/setup` answers, signed in, on a business profile. One list request per page of rows.
- `AttachExternalInvoiceDrawer`: drop zone (empty-attach art) → reading (reading art, still) → confirm. Or, attached: number, date, Open the file, Remove, and the note that MTB3A issues nothing for the entry meanwhile.
- `HostedTable.onRowFileDrop` / `canDropFile`. The row tints while a file is over it. Every droppable row also has Attach in its cell, for the keyboard.
- The issue drawer maps `EXTERNAL_INVOICE_ATTACHED` to a sentence with the number (for MUT-648's issue-from-entry).

## Left out

- The phone: share a file to an entry, and the badge on Recent (after MUT-573).
- The reading loop's motion: the still is used (the loop is MUT-649's).
- Signed out: nothing is attached (the local storage refuses).

## Tests

- Server: `routes-external-invoices.test.ts` (7), the store contract (memory + Prisma), the route security and accountant matrices, writability.
- Portal: `AttachExternalInvoiceDrawer.test.tsx` (4).
- QA: `portal.invoicing.attach-external`. Steps: attach from Owed; the reader prefills and the number is corrected; a mismatch is said; the badge opens and so does the file; the no-issue note; drop on a Received; remove; Arabic.

## QA scenarios

1. Open Owed and choose Attach on an entry → choose the PDF → the number, date and total are filled → correct them → Attach → the entry shows "Issued elsewhere".
2. Open the badge → "Invoice 3382" and its date → Open the file.
3. A total that differs from the entry's → a note, and Attach still works.
4. Drop a PDF on a Received row on Paid → the same drawer, reading → Attach.
5. Remove → the row offers Attach again.
