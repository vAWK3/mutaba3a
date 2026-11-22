# MUT-566 — Invoicing: the full flows (portal and phone)

Status: **Decided 2026-11-22 (Basel): I1-a, V1-a, P2-a, X1-a; S1-a and P1-a by default** · 2026-11-22 · Epic MUT-566 · Covers MUT-570 (portal), MUT-573 (phone), MUT-642 (customers), MUT-640 (PDF), and changes to MUT-568.

Basel, 2026-11-22: direction **B (one sheet that grows / a drawer of cards)** is the base. Copy is **formal and professional** (Modern Standard Arabic, formal Hebrew). Before any screen, think through the whole scope: where issuing starts, how a customer is chosen, issuing from income already recorded, invoices that already exist, VAT included or not, and how a business is set up and onboarded. Every open choice below has three alternatives and a recommendation.

---

## 1. Principles

1. **Set up once, then issue in seconds.** Nothing is issued until the business details the law requires are complete; after that, an invoice takes a customer, a line and one tap.
2. **One ledger, no double entry.** An amount recorded in Mutaba3a and the invoice for it are the same money. Issuing from an existing income entry links to it; it never creates a second Owed or Received.
3. **The document is the record.** Issued documents never change; a credit note corrects a tax invoice (ADR-260).
4. **Minimal.** One primary action per screen. Advanced fields (discount, goods/service, due date, notes, language) sit folded until needed.
5. **Formal copy.** Examples: «اختر العميل» / «בחירת לקוח» / "Choose a customer"; «هل ترغب في إصدار فاتورة ضريبية لهذا المبلغ؟» / «להפיק חשבונית מס עבור סכום זה?» / "Issue a tax invoice for this amount?"

---

## 2. Setting up a business for invoicing (once per profile)

**Where:** Settings › Profile › **Invoicing** (portal and phone). Shown only on business profiles whose owner has the `invoicing` feature. Also offered the first time someone tries to issue.

**The checklist** (each item opens a card in the same sheet; a progress line shows "3 of 5 complete"):

| # | Item | Required to issue | Notes |
|---|---|---|---|
| 1 | **Business details:** legal name, dealer type (עוסק מורשה / עוסק פטור / חברה / עמותה), VAT or company number (ח.פ./ע.מ.), address, phone, email | Yes | Number check-digit validated; a company number is looked up in the Registrar's open data to prefill name and address (MUT-642) |
| 2 | **Logo** | No | Photo or file; cropped to the letterhead |
| 3 | **Document defaults:** style (Professional / Modern / Minimal), ink (black / blue), language, **prices include VAT or not**, payment terms (e.g. net 30), bank details printed on invoices, footer note | Style, ink, language: defaulted; the rest optional | A live preview of the letterhead updates as fields change |
| 4 | **Numbering:** "Do you already issue documents in another system?" Yes → starting number per type; No → start at 1 | Answer required | Locked per type after its first document (D3) |
| 5 | **Tax Authority connection** (MUT-571) | Only for tax invoices to businesses at or above ₪5,000 before VAT | Explained in one line; can be done later; an invoice that needs it is blocked with a direct link |

**Gating alternatives (S1):**
- **S1-a (recommended): hard gate on items 1 and 4, soft on the rest.** The issue button reads «أكمل إعداد الفوترة» / «השלמת הגדרות הפקה» until 1 and 4 are done.
- S1-b: everything optional with defaults; missing details print as blanks. Fast, but produces invalid documents.
- S1-c: a mandatory full-screen onboarding wizard before the first invoice. Thorough, but blocks a quick first try.

**Onboarding the person** (first visit to Invoicing): a three-card intro, formal: what Mutaba3a issues (tax invoice, invoice-receipt, receipt, credit note), that issued documents are final and corrected by credit note, and that allocation numbers are requested automatically once connected. Then the checklist. Help links per card. Accountants with a grant see the settings read-only.

---

## 3. Customers ready for invoicing (MUT-642)

A business customer needs: **name**, **VAT/company number** (required for an allocation number), **address** (printed), **email** (for sending). A private individual needs a name only.

**Adding a customer, fastest first:**
1. **Type the number** → validated → Registrar lookup fills name, address and status (companies and nonprofits). Sole dealers: name typed (no public lookup).
2. **Scan a document:** certificate of incorporation, תעודת עוסק מורשה/פטור, or an invoice from them → the server reader fills the fields → the person confirms.
3. **From a vendor already known** (an expense they sent us) → prefilled.
4. **Phone contacts** (phone only): name, email and phone from the contact card.

**Choosing a customer quickly (in the issue sheet):** the top three are the **most recently invoiced**; then search by name or number; the last item is «إضافة عميل جديد» / «הוספת לקוח חדש». A customer missing what the document needs shows an inline completion card ("Add the VAT number to request an allocation number") without leaving the sheet.

---

## 4. Where issuing starts (entry points)

| # | Entry point | Surface | What is prefilled |
|---|---|---|---|
| E1 | **Documents** list › «إصدار مستند» | Portal (/documents) · Phone (a Documents screen reached from Recent or Settings, see P1) | Nothing |
| E2 | **A customer's page** › «إصدار فاتورة لهذا العميل» | Portal (/clients/$id) · Phone (customer details) | Customer |
| E3 | **After saving income** (Owed or Received) on Capture or the portal: a prompt | Both | Customer, amount, date, the entry to link (see I1) |
| E4 | **An Owed or Received entry already saved** › «إصدار فاتورة» | Recent row / entry details | Customer, amount, date, the linked entry |
| E5 | **An open tax invoice** › «تسجيل دفعة وإصدار إيصال» | Document page | Customer, the invoice it pays, amount outstanding |
| E6 | **An issued tax invoice** › «إصدار إشعار دائن» / «إصدار نسخة مكررة»/«שכפול» | Document page | Customer, original, lines (credit note); everything but the number (duplicate) |
| E7 | Shortcuts later: iOS quick action / widget «فاتورة جديدة» | Phone | Nothing |

**E3, the prompt after saving income (P2 alternatives):**
- **P2-a (recommended): ask once per save, in the save confirmation.** After Save, the confirmation (MUT-626 moment) carries one secondary action: «إصدار فاتورة» / «להפקת חשבונית». No extra step for people who don't invoice; the profile setting "Offer to issue after saving" can turn it off.
- P2-b: a toggle on Capture before saving, «إصدار فاتورة عند الحفظ», remembered per profile. One step fewer for heavy users; one more control for everyone.
- P2-c: a modal question after every save on invoicing profiles. Never missed, but interrupts every save.

**Which document E3/E4 suggest:** Owed → tax invoice (305). Received with no open invoice for that customer → invoice-receipt (320). Received while that customer has an open tax invoice → receipt (400) applied to it (the person can change the type).

---

## 5. Issuing from income already recorded (changes MUT-568)

Today MUT-568 issues a document and **posts new** ledger rows. For E3/E4 that would double the money. **I1 alternatives:**
- **I1-a (recommended): the document links to the existing entry.** `issue` accepts `fromReceivableId` (305) or `fromPaymentId` (320/400); the store locks the entry, checks the amounts match (or that the document is for less, see below), sets its origin to `ISSUED_DOCUMENT`/`originId` to the document, and posts nothing new. The entry then becomes read-only like any document-owned row. Amount differences: the document's total must equal the entry's amount; to invoice a different amount, the person edits the entry first (before issuing).
- I1-b: issuing replaces the entry: the captured row is voided and the document posts its own. Simpler code; the entry's history and links (receipts, notes, group) are lost or must be copied.
- I1-c: issue without touching the ledger, and keep a soft link (document ↔ entry) only. No double posting, but the entry stays editable, so the document and the books can disagree.

---

## 6. Invoices that already exist (issued outside Mutaba3a)

A business moving to Mutaba3a has invoices from its previous tool, or issues some elsewhere. They are **not our documents** (no number from us, not in the uniform file as ours). **X1 alternatives:**
- **X1-a (recommended): attach to the income entry.** On any Owed/Received: «إرفاق فاتورة صادرة» → upload the PDF or photo → the reader fills its number, date, amount and customer → the entry stores it as an **external invoice** (file + number + date; the existing `receiptNumber` label idea of ADR-223, widened). Amount mismatch is shown, not blocked. Shows in lists with a document icon and "issued elsewhere".
- X1-b: an "External documents" register beside issued documents, each linked to zero or more entries. Handles one invoice covering several amounts, but adds a second document list to understand.
- X1-c: bulk import: drop many PDFs, the reader creates Owed/Received entries from them (with the file attached). Best for migration day; heavier to build; can follow X1-a.

Matching many-to-one (one invoice for several amounts) is out of v1 in X1-a; X1-b covers it if needed.

---

## 7. VAT included or not (changes MUT-568 compose)

Basel: options for VAT included / not included, per item or per invoice.

- **V1-a (recommended): a per-invoice switch, overridable per line.** The invoice has «الأسعار تشمل ضريبة القيمة المضافة» / «המחירים כוללים מע״מ» (default from settings). Each line may override it from its folded options. Math: an inclusive line's net = gross ÷ 1.18 (half-up per line); VAT is then computed on the document's total net as now, and the gross shown for an all-inclusive invoice is kept equal to the sum the person typed by assigning the rounding agora to the VAT (so the customer pays exactly the typed total).
- V1-b: per invoice only. Simplest to understand; a mixed invoice needs two invoices.
- V1-c: per line only (each line has its own switch, no invoice default). Flexible; more taps on every line.

Also per line: **VAT-exempt line** (e.g. a reimbursed government fee) as a folded option, rate 0 on that line (allowed by the allocation API's per-line `VAT_Rate`). Recommendation: include it with V1-a.

---

## 8. The issue sheet (direction B), step by step

One sheet (phone) / one drawer of cards (portal, 480px). Answered cards fold to a single line and reopen on tap. The totals card is always last.

1. **Customer** — recents, search, add (§3). Inline completion if a field the document needs is missing.
2. **Document type** — four options, the suggested one preselected (§4); credit note only from an invoice (E6).
3. **Lines** — description, quantity × price; folded options per line: goods/service, discount, VAT included/exempt. "Add line". A line from a previous invoice can be reused («إضافة من بنود سابقة»).
4. **Payment** (320/400 only) — method, reference, date; for a receipt, which open invoice it pays.
5. **Details** (folded) — date (today), due date (from payment terms), language (default), notes.
6. **Totals and issue** — subtotal, discount, VAT, total; «معاينة» opens the PDF with the «טיוטה» watermark; «إصدار» / «הפקה» with one plain line: «لا يمكن تعديل المستند بعد إصداره؛ يُصحَّح بإشعار دائن.»

**States:** loading customers; empty customers; a field missing (inline); validation per line; offline (issuing needs a connection; the draft stays on the device); issuing (progress line on the sheet's edge); allocation number: requesting / received / held (four choices, finished in the portal on the phone) / not connected (blocked above the threshold with a link to connect); success.

**Success:** the save-confirmation moment re-cut for issuing (MUT-626 assets), then the document number, allocation number if any, and three actions: **Share PDF** (primary), Send by email, Done. The Recent/Income list shows the entry with its document number.

**Drafts:** the sheet's content is kept on the device until issued or discarded (no server drafts, D7).

---

## 9. After issuing

- **Document page:** the PDF, the linked entry, copies produced (original / copy count), actions: share, email, record payment & issue receipt (E5), credit note (E6), duplicate.
- **Lists:** Documents (filter by type, customer, period); a customer's page lists their documents and outstanding balance.
- **Sending:** email from the business's name with the PDF attached (and a link later); WhatsApp/any app via the share sheet. Each send records a copy («העתק» after the first).

---

## 10. Phone placement of "Documents" (P1)

The Capture hub has no tab bar (up: Recent, down: Settings, side: FX).
- **P1-a (recommended):** Documents is a filter/segment in **Recent** («المستندات») and issuing starts from E3/E4/E2; plus «إصدار مستند» in the Capture overflow. No new gesture.
- P1-b: a fourth direction or a dedicated Documents screen in Settings › Invoicing.
- P1-c: a "New document" button permanently on Capture next to Save, for invoicing profiles only.

---

## 11. What this changes in the tickets

- **MUT-568 (in progress):** add I1 (issue from an existing entry) and V1 (VAT-inclusive lines, exempt lines) to the core before it merges; small, and both are core math/posting rules.
- **MUT-570 / MUT-573:** rescoped to the flows above (entry points E1–E6, the B sheet, states, success, document page).
- **New:** Invoicing settings & onboarding (§2, portal + phone); External invoices on income entries (§6, X1); "Offer to issue after saving" (E3, P2); Reuse lines from previous invoices (later).
- **MUT-642:** the customer additions in §3.

## 12. Assets for Claude Design

The issued-document save moment (MUT-626 re-cut); empty states: first document, first customer (with scan hint); onboarding intro (3 illustrations, formal); allocation-pending loop; offline glyph; document-type icons (4); style thumbnails (3 × 2 inks); "issued elsewhere" badge icon. Light/dark, RTL, reduce-motion variants.
