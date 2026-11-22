# MUT-660: documents due per client, To issue, "not for invoice", invoice income in the books

Status: **plan, waiting for Basel's approval** (2026-11-22). Jira MUT-660, epic MUT-566. Blocks MUT-661. Relates to MUT-662, MUT-657, MUT-648, MUT-647, MUT-568, MUT-663.
Design: round 2, alternative B (https://claude.ai/artifact/PpXdTXqS8RQucM8pGiQ5Wi#page-r2).
Source: `~/.gstack/projects/vAWK3-mutaba3a/mut-660-plan.md`, written and engineering-reviewed on 2026-11-22. This brief takes that plan with the review's corrections folded in. It re-checks every code reference against main at 61375c4b (MUT-657 and MUT-659 merged), and keeps to this repo.

## 1. Problem and acceptance criteria

What an invoicing profile has to issue depends on the client: a tax invoice before payment, a payment request first, one document on payment, or nothing. Today the app can't tell what's due. Home has no honest count, MUT-661 can't follow the client, and the books can't separate invoice income from all income.

The acceptance criteria are the ticket's. This repo covers all of them except the iOS QA flow, which goes with the phone half (§12):

1. A client's preference can be set and changed on the portal. A client with none follows the profile default, On payment.
2. Tax invoice first: an Owed of 3,400 is due a tax invoice. After it's issued, a payment of 1,000 is due a receipt for 1,000, and a second payment gets its own receipt.
3. Payment request first and On payment: each payment, partial ones included, is due an invoice-receipt for its own amount.
4. No document, and entries marked "not for invoice": nothing is due. Their income counts outside Invoice income but inside All income, in Reports, the monthly summary, the accountant's view and exports.
5. An entry with a tax document can't be marked "not for invoice". The app says a credit note is needed first.
6. Home's count equals the number of documents due. Issuing, attaching or marking an item removes it from the count.
7. The portal list groups documents due by client. "Issue all" issues each of a client's due documents with the right type and amount.
8. Bulk "Not for invoice" and "Back" each work in one action, with one confirmation that gives the count, and both are idempotent. "Older than N months" selects only items older than N months.
9. All income = Invoice income + Not for invoice, per currency.
10. Profiles without invoicing see no change.
11. Release-QA: on the portal, Issue all for a client, bulk not-for-invoice, and the Reports split. iOS: §12.

Decisions already made by Basel (Jira comment 13423):
- **D1:** all open income counts, with no cutoff. To issue gets an "Older than N months" filter.
- **D2:** the only per-entry override is the not-for-invoice mark, plus issuing any document type by hand. There is no per-entry preference.
- **D3:** on the phone, a "To issue · N" strip in Recent.
- **D4:** the phone doesn't set the preference; that waits for MUT-663.

## 2. Open decisions for Basel (new in this brief)

- **N1. Money received with no client: invoice-receipt or receipt?**
  - The ticket says it counts as On payment, so it is due an **invoice-receipt**.
  - MUT-648's offer after saving (`issueOffers.ts`) gives a no-client Received only a **receipt**.
  - Recommendation: follow the ticket. A licensed dealer owes a tax document for the sale, and the server already issues a 320 with no customer. The MUT-648 offer stays as it is; MUT-661 aligns offers with what's due.
- **N2. What Home's count counts.**
  - AC6 says the count equals the documents due.
  - Two kinds of items can't be issued in MTB3A today: payment requests (until MUT-662) and non-₪ items (issuing is ILS only, `compose.ts:134`). The person can still settle both: attach an invoice issued elsewhere (MUT-647) or mark it not for invoice.
  - Recommendation: **count every listed item**, so the count, the list and AC6 agree. Rows that can't be issued show why, and offer Attach and Not for invoice instead of Issue.
  - Alternative (the earlier review's choice): count only what's issuable, and show the rest in the list without counting it.
- **N3. Where the phone half runs.** The Flutter work happens in `mutaba3a-flutter` against this API (§12).
  - Recommendation: open a separate session for it once this merges to local main, and keep the iOS QA flow there.
  - This ticket moves to In Review when the mini-crm half merges, with a note that the phone half is outstanding.

## 3. Data (Prisma migration `20261122230000_mut660_documents_due`, after MUT-659's)

- `enum DocumentsPreference { TAX_INVOICE_FIRST PAYMENT_REQUEST_FIRST ON_PAYMENT NO_DOCUMENT }`
- `Customer.documentsPreference DocumentsPreference?`: null follows the profile default.
- `IssuerDetails.defaultDocumentsPreference DocumentsPreference @default(ON_PAYMENT)`. A profile with no issuer details falls back to ON_PAYMENT.
- `Receivable.notForInvoice Boolean @default(false)`, `Payment.notForInvoice Boolean @default(false)`. A change bumps `version` (If-Match).
- Indexes: `IssuedDocument @@index([organizationId, receivableId])` and `@@index([organizationId, paymentId])`. Neither exists today, and the documents-due query joins on both.
- **Nothing "due" is stored.** What's due is always derived, so it can't drift from the documents, allocations and attached invoices.
- **The migration only adds columns.** It has no backfill and no lock-heavy step. The orchestrator is warned before the merge (it restarts the local API).

## 4. Domain: `server/src/issuing/documents-due.ts` (pure, no I/O)

`documentsDue(input) → DueItem[]`

`DueItem = { kind: 'TAX_INVOICE'|'PAYMENT_REQUEST'|'RECEIPT'|'TAX_INVOICE_RECEIPT', entry: {kind:'receivable'|'payment', id}, customerId|null, amountMinor, currency, date, issuable: boolean, reason?: 'PAYMENT_REQUEST_PENDING'|'CURRENCY_NOT_ILS'|'MIXED_ALLOCATION'|…, appliesToDocumentId? }`

The preference is `customer.documentsPreference ?? issuer.defaultDocumentsPreference ?? ON_PAYMENT`. A payment with no customer counts as ON_PAYMENT (N1).

**An exempt dealer** (`dealerType EXEMPT`) issues only receipts (`compose.ts:137`):
- an Owed is never due;
- every payment that isn't excluded is due a RECEIPT.

**Receivables.** A receivable counts when all of these hold:
- its origin is ADJUSTMENT, INSTALLMENT or RETAINER_CHARGE (ISSUED_DOCUMENT is already settled);
- `deletedAt` is null and `notForInvoice` is false;
- it isn't fully credited or settled by credit;
- its preference is TAX_INVOICE_FIRST or PAYMENT_REQUEST_FIRST.

Such a receivable is due a `TAX_INVOICE` (or a `PAYMENT_REQUEST`) for gross − credited, unless a live ExternalInvoice OWED is attached to it.

**Payments.** A payment counts when:
- `status = 'POSTED'` (Payment has no `deletedAt`);
- its origin isn't ISSUED_DOCUMENT;
- it isn't `notForInvoice`;
- it has no linked IssuedDocument (`paymentId`) and no live ExternalInvoice RECEIVED (`removedAt IS NULL`);
- a payment corrected by another (`replacesPaymentId`) counts only through its replacement.

The allocated receivable decides the rules:
- If any live allocation (`releasedAt` null) targets a receivable that is `notForInvoice`, or whose customer is NO_DOCUMENT, that share isn't due.
- **No double invoicing (review C2):** under TAX_INVOICE_FIRST, a payment allocated to a receivable that has no tax invoice yet **is not due**. The receivable's tax invoice is.
- **Due `RECEIPT`** (with `appliesToDocumentId` set to the tax invoice) when every live allocation targets a tax-invoiced receivable: one with a 305 IssuedDocument or a live ExternalInvoice OWED. `receiptNumber` (MUT-481, a receipt issued elsewhere) also settles a RECEIPT.
- **Unallocated** is its own case, checked explicitly rather than through an empty "every".
  - If the customer has an open 305 under TAX_INVOICE_FIRST, the payment is due a RECEIPT with `appliesToDocumentId` (the existing `applyAllocations(…, true)` path).
  - Otherwise it is due a `TAX_INVOICE_RECEIPT`.
- **Otherwise it is due a `TAX_INVOICE_RECEIPT`.** This covers PAYMENT_REQUEST_FIRST, ON_PAYMENT, and a payment allocated to one receivable with no document.
  - A payment split across several receivables is listed with `issuable:false` and reason `MIXED_ALLOCATION`. It can still be attached or marked.
- A non-ILS item gets `issuable:false` with reason `CURRENCY_NOT_ILS`.
- A PAYMENT_REQUEST gets `issuable:false` with reason `PAYMENT_REQUEST_PENDING` until MUT-662.

One function feeds the count, the list, Issue all and, later, MUT-661's offer.

## 5. Books split: `server/src/income/invoice-class.ts` (pure)

`incomeClass(payment, ctx) → 'INVOICE' | 'NOT_FOR_INVOICE'`, in this order:
1. Money with a linked IssuedDocument or a live ExternalInvoice, or with origin ISSUED_DOCUMENT → INVOICE.
2. The payment's own `notForInvoice` → NOT_FOR_INVOICE.
3. Otherwise each allocated share follows its receivable: `notForInvoice`, or a NO_DOCUMENT customer → NOT_FOR_INVOICE. Mixed allocations split by amount (live rows only). The unallocated remainder follows the payment's own customer.
4. Everything else → INVOICE. Money still due a document counts as invoice income: it's on the books to be invoiced.

`splitIncome(payments, ctx) → per currency {invoiceIncome, notForInvoice, all}`. `all` equals the sum by construction, and a property test checks it.

Income is cash basis (`summaries/activity.ts`, the `received` field), so Owed isn't classified. Changing a client's preference reclassifies past months, and the preference field's help text says so.

The split runs **only when invoicing is on for the profile's owner** (the same check as `issuingProfile`). Every other profile's output stays byte-identical, and a snapshot test guards that (AC10).

Consumers:
- **Reports:** the activity summary (`summaries/activity.ts`) gains optional `invoiceIncome` and `notForInvoice` per currency flow; `received` stays the total.
- **Monthly summary:** `summaries/profile-figures.ts:68` passes empty allocations and receivables today. For invoicing profiles it loads the live allocations and their receivables. `billing/monthly-summary*.ts` adds two lines.
- **Accountant view:** client books read the same summaries. Share links (`routes/share-links.ts:503`, `receivedByCurrency`) add the split.
- **Exports:** `period-pack/columns.ts` and `rows.ts` add an `invoice_status` column on income rows (to_issue | issued | not_for_invoice | no_document), invoicing profiles only.

## 6. Store (`LedgerStore` port, memory and Prisma, with contract tests on both)

- `documentsDue.inputs(orgId)` returns only the columns §4 needs:
  - open receivables with no 305 and no live external invoice (NOT EXISTS);
  - POSTED payments with no linked document and no live external invoice (NOT EXISTS);
  - their live allocations, the customers' preferences, the issuer's default and dealer type, and the 305s per receivable.
  - About six indexed queries, with no N+1.
  - `/count` reuses the same inputs without serializing rows.
  - Before the merge it's measured on a profile with 5k payments.
- `setNotForInvoice(orgId, items[], value, expectedVersions?)` runs as one transaction:
  - It refuses with 409 `HAS_TAX_DOCUMENT` when an item has a live 305 or 320 that credit notes haven't fully cancelled. A RECEIPT doesn't block the mark.
  - With If-Match it checks the version (409 VERSION_CONFLICT).
  - An item already at `value` is a no-op that still counts as success, which makes the action idempotent.
  - It returns `{changed}`.
- **Payment-linked issuing (review C1):** issuing must never post a second Owed.
  - A 305 for an INSTALLMENT or RETAINER_CHARGE Owed takes that receivable over, as ADJUSTMENT does today. `lockFromEntryTx` (`prisma.ts:5246`) and its memory twin widen `ok` to those origins, still `creditedMinor === 0n`.
  - A RECEIPT or 320 for an **allocated** payment links `paymentId` and posts nothing new.
    - A RECEIPT with `appliesToDocumentId` set to the tax invoice.
    - A 320 adopts the single target receivable (origin → ISSUED_DOCUMENT), allowed only when the payment has exactly one live allocation and that receivable has no document.
  - `fromEntryRefusal` (`issuing/ledger-plan.ts:102`) gains these shapes. Anything still refused comes back as `issuable:false` with a reason.
  - Payments keep the CAPTURE rule (income recorded in the app). An INTEGRATION payment (from an API key or a connected app) is listed with `issuable:false` and reason `RECORDED_ELSEWHERE`, so it can still be attached or marked.

## 7. API (OpenAPI regenerated; `API_VERSION` → `1.127.0-mut660`; ADR-270)

Every route goes through `issuingProfile(c, write)`. It answers 404 for personal profiles, Malafat profiles, `via` grants, and when invoicing is off. Writes are owner-only (AccountantGrant has no edit right).

- `GET /v1/documents-due?view=to-issue|not-for-invoice&olderThanMonths=N` returns `{groups:[{customer|null, items[]}], counts:{total, byKind}}`.
  - The not-for-invoice view lists marked entries, so "Back" can work in bulk (AC8).
  - `olderThanMonths` filters on the item's date against the profile's today (`todayFor`).
- `GET /v1/documents-due/count` returns `{total}` for Home.
- `POST /v1/documents-due/issue` takes `{customerId|null, items[≤25]}` and needs an Idempotency-Key.
  - One client per call. It issues in sequence through the existing issuing path, with lines built from the receivable's frozen `vatRateBasisPoints`, `vatTreatment` and `pricesIncludeVat`, and `documentDate` = today.
  - Each item's requestKey is `hash(batchKey, entry)`, so a retry never issues twice.
  - It returns a result per item: `issued{documentId}`, `held{heldKey}` (MUT-572, resumed through the single-issue path and never decided automatically), or `refused{reason}`.
  - Missing setup → 409 `ISSUING_SETUP_INCOMPLETE`.
- `POST /v1/documents-due/not-for-invoice` takes `{items[], value}`, needs an Idempotency-Key, runs in one transaction and returns `{changed}`.
- `PUT /v1/receivables/{id}/not-for-invoice` and `PUT /v1/payments/{id}/not-for-invoice` take `{value}` with If-Match, following `PUT /v1/payments/{id}/receipt-number`.
- `PATCH /v1/customers/{id}` accepts `documentsPreference` (If-Match). It refuses API-key and Malafat callers, and profiles with invoicing off.
- `PUT /v1/issuer/defaults` accepts `defaultDocumentsPreference`. `PUT /v1/issuer` keeps it.
- Responses for receivables, payments and customers expose `notForInvoice` and `documentsPreference`. Both fields are additive.

## 8. Local mode (on this device)

- `CURRENT_STORE_SNAPSHOT_VERSION` goes from 21 to 22, with a migration `addDocumentsFields` (preference null, flags false). Update the fingerprint `EXPECTED`, `everyRecord.ts` and the records-export tests.
- Invoicing is off on a device, so the flags are stored and round-trip, but the split and To issue don't show. Tests cover exactly that.

## 9. Portal (`src/hosted`)

- **Data:** `data/documentsDueQueries.ts`, with `useDocumentsDue`, `useDocumentsDueCount` (staleTime 60 s), `useIssueDue` and `useMarkNotForInvoice`.
  - All four invalidate the issued, receivables, payments, documents-due and summary queries.
  - All four are disabled unless invoicing is on (the existing issuing-setup query).
- **Home (replaces the TODO at `HomeTodo.tsx:82`):** a `ToIssueGroup` in the Waiting lane.
  - It reads "To issue · N" and links to the list. MUT-657 is merged, so this ticket wires it.
  - It is counted in the CalmLine check. Copy says "To issue", not "To invoice".
- **Page:** `/p/$profileId/documents/to-issue` (`pages/views/DocumentsDuePage.tsx`). It becomes a third tab in `issuedTabs.ts` (Issued · To issue · Files), on invoicing profiles only.
  - Segments: **To issue** and **Not for invoice**.
  - Items are grouped by client ("No client" last). Each group has **Issue all**, and each row has **Issue**.
    - Issue opens the existing `IssueDocumentDrawer`, prefilled through `fromEntry`, with the due type and amount.
    - Issue all calls the batch in chunks of 25 and ends with a toast that counts issued, held and refused.
  - Rows that can't be issued show their reason, with **Attach** (`AttachExternalInvoiceDrawer`) and **Not for invoice**.
  - Checkboxes open a bulk bar: "Not for invoice" on To issue, "Back to invoice" on Not for invoice. One InPlaceConfirm gives the count, and an undo toast follows.
  - An "Older than N months" filter offers 3, 6 and 12 months, with a "Select all shown" checkbox (D1).
  - Empty state: "Nothing to issue."
  - It follows DESIGN.md: InPlaceConfirm, Toast, the existing list rows and the Select component. Drawers stay drawers; this ticket adds no create pages.
- **Owed and Paid rows:** "Not for invoice" / "Back to invoice" in the row menu through `incomeAffordances.ts`, using If-Match. The 409 HAS_TAX_DOCUMENT shows "Issue a credit note first" (AC5).
- **Client page:** a `DocumentsPreferenceField` (Select with If-Match) in `ClientBusinessDetails.tsx`, on invoicing profiles only.
  - The "Profile default (On payment)" option is null.
  - Help text: "Changes which documents are due, and how past income is counted."
- **Invoicing setup:** the defaults step (`pages/invoicing/**`) gains the profile default preference beside offer-after-save.
- **Reports:** on invoicing profiles, `ReportsPage.tsx` gets an income card with three lines per currency: Invoice income, Not for invoice and All income.
- **i18n:** keys go in `en.json` and `ar.json` under `hosted.documentsDue.*`, `hosted.client.documents*` and `hosted.reports.invoiceSplit.*`, with formal MSA Arabic and Arabic-first RTL. Amounts render in `<bdi>`.

## 10. Reuse (COMPONENT_REGISTRY)

`IssueDocumentDrawer`, `AttachExternalInvoiceDrawer`, `InPlaceConfirm`, `Toast`, `Select`, `HomeGroup`, `issuedTabs`, `incomeAffordances`, `issuingProfile`, the requestKey/Idempotency middleware, `todayFor`, `formatMoney`. The only new reusable units are `documentsDue`, `incomeClass`/`splitIncome` (server) and `DocumentsPreferenceField` (portal).

## 11. Cost and scale

- **List:** derived per request from about six indexed queries per profile, with no N+1 and no stored state to repair.
- **Count:** the same inputs without rows. Home caches it for 60 s.
- **Issue all:** one round trip per 25 items, issued in sequence on the server and bounded by MUT-572's allocation limits.
- **Books:** the monthly summary loads allocations only for invoicing profiles, so other profiles cost nothing more.
- **Infra:** no new service, secret or Terraform. The ticket adds one additive migration.

## 12. Out of this repo: the phone half (Flutter, `mutaba3a-flutter`)

The Flutter work is still part of MUT-660, but it runs as its own session after this merges (N3):
- `documents_due_repository.dart` and the model `document_due.dart`;
- a "To issue · N" strip in Recent (the to-file pattern) that opens `to_issue_screen.dart`, grouped by client, with Issue (reusing `issue_document_screen.dart` through `IssueFromEntry`) and Not for invoice;
- "Not for invoice" / "Back" in `recent_actions.dart`, with If-Match and the 409 message;
- ARB keys;
- the QA flow `ios.recent.to-issue` on "QA iPhone" (seed `qa-invoicing-state.sh`).

## 13. Tests (TDD, written first). Detail: `mut-660-documents-due-tests.md`

- `documents-due.test.ts`: a table over every preference × Owed/Received, plus AC2's 3,400 → 1,000 → second receipt, exempt dealer, non-ILS, mixed allocation, `receiptNumber`, ExternalInvoice OWED and RECEIVED, not-for-invoice on each side, a deleted or credited receivable, a corrected payment, a payment with no client, and TAX_INVOICE_FIRST before and after the invoice.
- `invoice-class.test.ts`: the class order, mixed splits, and the reconciliation property (AC9).
- Route tests:
  - the gate (personal, Malafat, via, feature off → 404);
  - If-Match 409 and HAS_TAX_DOCUMENT 409;
  - bulk idempotency;
  - batch issuing with one item held, the others issued, and a replay that issues nothing new;
  - accountant read-only;
  - the count equals the list (AC6).
- Store contract tests on both stores. `test:db` runs on a fresh database.
- Summaries: the byte-identical snapshot for non-invoicing profiles, the period-pack column and the monthly mail lines.
- Local: the v21→v22 migration and the fingerprint.
- Portal component tests: DocumentsDuePage, ToIssueGroup, DocumentsPreferenceField, the Reports card and the row menu action. The direction and brand suites keep passing.

## 14. QA scenarios (release-QA, `qa/features/portal/invoicing.yaml` and `reports.yaml`, specs on FakeApi)

| id | Steps as the user says them | Outcome promised |
|---|---|---|
| `portal.invoicing.to-issue-issue-all` | Open Nour Studio's home, see "To issue · 3", open it; in Rami's group choose Issue all and confirm | Rami's tax invoice and invoice-receipt are issued with their amounts, the group is gone, and Home shows "To issue · 1" |
| `portal.invoicing.to-issue-bulk-not-for-invoice` | Open To issue, choose "Older than 6 months", select all shown, choose Not for invoice and confirm "4 items" | The 4 items leave To issue and appear under Not for invoice; Back to invoice on them restores all 4 |
| `portal.invoicing.not-for-invoice-refused` | On Owed, open the menu of an entry with a tax invoice and choose Not for invoice | The app says a credit note is needed first, and nothing changes |
| `portal.invoicing.client-documents-preference` | On client Rami's page set Documents to "Tax invoice first" | His unpaid Owed appears in To issue as a tax invoice due; setting it to "No document" clears it |
| `portal.reports.invoice-split` | Open Reports on an invoicing profile with one payment marked not for invoice | The income card shows Invoice income, Not for invoice and All income in ₪, and All equals the sum; a profile without invoicing shows no card |

`paths` cover `DocumentsDuePage`, `ToIssueGroup`, `documentsDueQueries`, `DocumentsPreferenceField` and the Reports card. Each spec is tagged `@portal.<area>.<id>`, wraps each action in `step()`, and runs until it passes (`release-qa run --attach --only <id>`).

## 15. Impact

- Touches: `server/prisma`, `server/src/{issuing,income,summaries,period-pack,billing,routes,repositories}`, `src/hosted/{data,pages,components}`, i18n, local snapshot, QA catalog.
- Risk: widening issue-from-entry (C1) touches the money path. Contract tests on both stores plus a fresh-DB `test:db` guard it.
- Knowledge files: ADR-270, CHANGELOG, SYSTEM_OVERVIEW (Documents, Home, Reports), COMPONENT_REGISTRY, PATTERNS (derived-due pattern), TEST_PLAN, TECH_DEBT (payment-request rows inert until MUT-662; mixed-allocation rows not issuable).

## Business / product impact
- Invoicing profiles get an honest "what do I still owe the tax office paperwork for" list, and the books say which income is invoice income. These are the two things an Israeli licensed dealer's accountant asks for first.
- Home's To issue box (MUT-657) goes live, and MUT-661 (issue as you record) is unblocked. It is the next step of epic MUT-566.
- Low rollout risk: everything sits behind the invoicing feature, other profiles are byte-identical, and the migration is additive.
