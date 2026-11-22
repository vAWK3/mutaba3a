# MUT-660 test plan: documents due, not for invoice, invoice income split

TDD: each block is written red before its code. Commands run through `~/Work/tools/heavy-gate/heavy --light -l "MUT-660 …"` under Node 22, with `--maxWorkers=3`.

## Server: pure domain

### `server/src/issuing/__tests__/documents-due.test.ts` (table-driven)

| Case | Expect |
|---|---|
| TAX_INVOICE_FIRST, Owed 3,400, no doc | 1 × TAX_INVOICE 3,400 |
| …the same, after the 305 is issued, payment 1,000 allocated | 1 × RECEIPT 1,000, appliesToDocumentId = the 305 |
| …a second payment of 500 | 2 receipts (1,000 and 500) |
| TAX_INVOICE_FIRST, payment allocated before any invoice | the payment isn't due; the Owed's 305 is |
| TAX_INVOICE_FIRST, unallocated payment, customer has an open 305 | RECEIPT with appliesToDocumentId |
| PAYMENT_REQUEST_FIRST, Owed | PAYMENT_REQUEST, issuable:false, PAYMENT_REQUEST_PENDING |
| PAYMENT_REQUEST_FIRST, partial payment 700 | TAX_INVOICE_RECEIPT 700 |
| ON_PAYMENT (default, null preference), Owed | nothing |
| ON_PAYMENT, two partial payments | 2 × TAX_INVOICE_RECEIPT, one per amount |
| NO_DOCUMENT, Owed and payment | nothing |
| payment with no customer | TAX_INVOICE_RECEIPT (N1) |
| EXEMPT dealer, Owed / payment | nothing / RECEIPT |
| non-ILS payment | issuable:false CURRENCY_NOT_ILS |
| payment split across 2 receivables | issuable:false MIXED_ALLOCATION |
| receivable.notForInvoice / payment.notForInvoice / allocated to a notForInvoice receivable | nothing |
| live ExternalInvoice OWED then a payment | RECEIPT; the Owed isn't due |
| ExternalInvoice RECEIVED, removed (removedAt set) | due again |
| receiptNumber set, RECEIPT expected | settled; a TAX_INVOICE_RECEIPT expectation isn't settled by it |
| deleted receivable, fully credited receivable, REVERSED payment, replaced payment | nothing |
| INSTALLMENT and RETAINER_CHARGE Owed under TAX_INVOICE_FIRST | TAX_INVOICE |
| origin ISSUED_DOCUMENT receivable or payment | nothing |
| INTEGRATION payment | issuable:false RECORDED_ELSEWHERE |
| `olderThanMonths` filter | keeps only items dated before today − N months (month-end edge cases) |

### `server/src/income/__tests__/invoice-class.test.ts`

- The class order: linked document beats the flag, the payment's own flag, the receivable's flag, then NO_DOCUMENT.
- A mixed allocation splits by amount; released allocations are ignored; the unallocated remainder follows the payment.
- Property (seeded random): for every currency, all = invoiceIncome + notForInvoice (AC9).

## Server: store and routes

- **Store contract (memory and Prisma):**
  - `documentsDue.inputs` matches across both stores on a shared fixture;
  - `setNotForInvoice` refuses with HAS_TAX_DOCUMENT on a live 305 or 320; it allows the mark after a full credit note, and with a RECEIPT;
  - a version conflict is caught; a value it already has is a no-op.
- **Issue-from-entry (C1), on both stores:**
  - a 305 adopts an INSTALLMENT Owed, and no second receivable appears;
  - a RECEIPT for an allocated payment links `paymentId` and posts nothing;
  - a 320 adopts the single target receivable;
  - a 320 on a payment split across two receivables is refused.
- **`routes/__tests__/documents-due.test.ts`:**
  - personal, Malafat, via and feature-off profiles → 404;
  - accountant GET → 200, POST → 403;
  - count = list total (AC6);
  - issuing, attaching and marking each drop the count by 1;
  - Issue all for a client issues the right types and amounts (AC7);
  - batch: one item held (fake allocator), the others issued, a replay with the same key issues nothing new, and more than 25 items → 400;
  - bulk not-for-invoice: one confirmation's worth, `changed` correct, a replay returns the same result, and Back works (AC8);
  - `PUT …/not-for-invoice`: If-Match 409, HAS_TAX_DOCUMENT 409 (AC5);
  - customer PATCH `documentsPreference` with If-Match; refused for an API key, Malafat, or invoicing off;
  - `PUT /v1/issuer/defaults` round-trips the default (AC1).
- **OpenAPI:** `openapi:check` is clean after regenerating.

## Server: books

- **Activity summary:** invoicing on → the split per currency; invoicing off → JSON byte-identical to a snapshot (AC10).
- **Profile figures and monthly mail:** two lines on invoicing profiles; a non-invoicing mail is unchanged (snapshot).
- **Period pack:** the `invoice_status` column with every value; the column is absent for non-invoicing profiles.
- **Share links:** the received summary carries the split for invoicing profiles.

## Local mode

- Snapshot v21 → v22 migration adds the defaults; fingerprint `EXPECTED` is updated; `everyRecord` covers the new fields; a records export and restore round-trips the flags.
- Locally there's no To issue and no split (invoicing is off).

## Portal (vitest + RTL)

- `DocumentsDuePage`:
  - groups by client, with No client last;
  - Issue opens the drawer prefilled with type and amount;
  - Issue all chunks by 25, and its toast counts issued, held and refused;
  - an item that can't be issued shows its reason and offers Attach / Not for invoice;
  - the bulk bar's confirmation gives the count, and undo works;
  - the Not for invoice segment's Back;
  - the Older than filter;
  - the empty state.
- `ToIssueGroup` on Home: hidden at 0; the CalmLine shows when everything is clear; the link goes to the page.
- `issuedTabs`: To issue appears only on invoicing profiles.
- `DocumentsPreferenceField`: options; null = profile default; If-Match conflict message.
- `incomeAffordances`: the Not for invoice / Back menu item only on invoicing profiles; a 409 HAS_TAX_DOCUMENT shows the credit-note message.
- Reports income card: three lines per currency; absent without invoicing.
- The direction (RTL), brand and i18n key-parity suites stay green.

## Release-QA

Five specs (design §14) on FakeApi, each run once to a pass with `release-qa run --attach --only <id>`; `release-qa lint` reports no errors and no unmapped files.

## Final verification (before merge)

- Root: `lint`, `typecheck`, `test:run`, `build`.
- Server: `typecheck`, `lint`, `openapi:check`, `test`, plus `test:db` on a fresh database.
