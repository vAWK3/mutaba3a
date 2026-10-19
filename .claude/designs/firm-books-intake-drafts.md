# Firm books — intake drafts (2026-10-19)

Tracker: Jira · barmajiyat · project MUT · via `mcp__atlassian-barmajiyat__*` · new tickets land in Backlog.
**Created 2026-10-19:** epic MUT-298; F0=MUT-299, F1=300, F2=301, F3=302, F4=303, F5=304, F6=305, F7=306, F8=307, F9=308, F10=309, F11=310, F12=311, F13=312, F14=313, F15=314, F16=315. Labels `firm-v1`…`firm-v5` carry the version; the epic carries `firm-books`.

## Decisions taken in intake (2026-10-19)

| # | Decision | Chosen |
|---|---|---|
| D1 | Who it's for | **Any hosted firm**, Malafat-fed or not. Expenses stay session-written (writability `expenses` row: apiKey none). Malafat's API key stays out of expenses, vendors, bills. |
| D2 | Override of minimize-to-core decision 3 | **Firm profiles only.** Expenses, vendors, bills become core on firm profiles; personal and freelancer profiles keep expenses optional. |
| D3 | Firm marker | **Explicit firm switch, operator-enabled per organization.** The owner requests it from the portal; an operator turns it on. Self-service switch is a later version. |
| D4 | Portal reading | **PDF text layer + ZATCA/JoFotara QR + photo OCR in the browser**, all on the device (no server, no LLM). MUT-253 must pick an engine that also runs as WASM, or name the browser fallback. Overrides MUT-252 decision 5. |
| D5 | Compliance | **Read e-invoice data, never issue.** No ZATCA/JoFotara/Israeli compliance claim in copy. Plus a research spike on issuing, no build. |
| D6 | Joining a firm | **Owner invites by email with a role.** The server has no email provider today: the invite always yields a copyable setup link; email delivery comes when a provider is chosen (decided in the brief). |
| D7 | Approval | **Per-firm setting**, off by default. When on, a submitter's expense is Pending and out of every total until approved or rejected. |
| D8 | Accountant pack | **Generic CSV + XLSX + receipts zip.** No account-code mapping, no package-specific import (out of scope). |
| D9 | General ledger | **No double-entry GL.** Records stay append-only with reversals; journal lines may be derived later. |

Moved from my earlier sketch: staff reimbursements go to **v4**, modelled as a bill owed to a teammate, so they share the payables model instead of a one-off.

---

## EPIC

**DRAFT — MUT Epic**
**Summary:** Firm books: receipts, vendors, bills and a monthly close for small firms
**Labels:** firm-books
**Description:**

*Problem.* Small firms (law and accounting offices, agencies; not solo freelancers) keep receipts in WhatsApp chats and email, re-type them for their accountant, and have no view of what they owe vendors. Mutaba3a's hosted ledger already tracks what clients owe and pay (receivables, payments, allocations, credits). The expense side is single-entry: an expense is money that already left, with no vendor bill, no VAT, no team roles, and no month close.

*Outcome.* A firm collects every receipt in one place, has most of them read on the device, lets staff submit while an owner or bookkeeper approves, tracks what it owes vendors and staff, closes each month, and hands its accountant one clean pack.

*Versions (Nov 2026 – Apr 2027):*
- **v1 Capture (Nov):** firm switch, receipts library and share intake (MUT-254/255/259/260), portal PDF + QR prefill. MUT-253 spike runs in parallel.
- **v2 Read (Dec):** phone reader (MUT-256/257/258), portal photo OCR, VAT on expenses, vendor learning extended to currency + VAT.
- **v3 Team (Jan–Feb):** roles (owner, bookkeeper, submitter), invites, optional approval.
- **v4 Payables (Mar):** bills, bill payments with allocation, payables aging, staff reimbursements, phone view.
- **v5 Close (Apr):** month lock, VAT summary, accountant pack, e-invoice issuing research.

*Decisions:* D1–D9 above (design brief + ADR is the first child).

*Out of scope:* double-entry general ledger and trial balance; issuing tax invoices; any compliance claim; cloud or LLM extraction; Malafat API-key access to expenses/vendors/bills; firm features in signed-out local mode (MUT-284) or desktop; account-code mapping and package-specific exports; bank feeds; self-service firm switch.

*Success signals:* firms enabled; share of approved receipts needing no amount/date edit (MUT-252's 70% target); receipts per firm per month; months closed; accountant packs exported. Measured through the opt-in PostHog events (MUT-152) only.

*Relates:* MUT-252 (receipt scanning), MUT-266 (expense groups), MUT-278 (Gulf currencies), MUT-34 (hosted), MUT-189 (Malafat upsell).

---

## Brief

### F0 — Task · labels firm-v1
**Summary:** Design brief + ADR: firm profiles (roles, reading on the portal, payables, close)
**Problem:** Nine decisions (D1–D9) override or extend three standing ones: minimize-to-core decision 3, MUT-252 decision 5 (no portal reading) and its out-of-scope "VAT breakdown" and "e-invoice" lines. They need one ADR before anything API-shaping is built.
**Scope (in):** `.claude/designs/firm-books.md` brief with QA scenarios per version; ADR logging the overrides; the firm data model (organization firm flag, membership role, approval state, bill, bill payment, bill allocation, period lock); writability-matrix changes per role; email-provider choice for invites (or "copy link only" for v3); i18n (ar/he/en, RTL); cost of the email provider and OCR model delivery to the browser.
**Acceptance criteria:**
- [ ] Brief covers every story in this epic with API contracts and error states
- [ ] ADR logs the override of minimize-to-core decision 3 (firm profiles only) and MUT-252 decision 5
- [ ] Writability matrix rows for each role are written down and match the brief's table (MUT-39 drift-test style)
- [ ] Email-provider decision recorded, with cost
- [ ] Basel approves the brief
**Blocks:** every other child.

---

## v1 Capture (Nov)

Existing tickets labelled `firm-v1` (edit only, no re-parenting): **MUT-254, MUT-255, MUT-259, MUT-260**. **MUT-253** spike is labelled `firm-v1` too and gets an amendment comment (below).

### F1 — Story · firm-v1
**Summary:** Firm switch: an operator turns firm features on; the owner requests it from the portal
**Problem:** Firm features must not reach personal or freelancer profiles, and for now an operator decides who gets them.
**Scope (in):** `firmEnabledAt` (or equivalent) on the organization, exposed on `GET /v1/me` per profile; admin route to turn it on/off (audited); a portal "Request firm features" action on an owned Business profile that records the request where operators see it (admin listing); portal and phone read the flag to show firm surfaces.
**Scope (out):** self-service switch; pricing; Malafat API exposure.
**Acceptance criteria:**
- [ ] An operator can turn firm features on and off for an organization; each change writes an audit event
- [ ] The owner of a Business profile can request firm features once; a repeat request is idempotent; the portal shows "Requested" until decided
- [ ] Personal profiles and profiles the user doesn't own never show the request
- [ ] `GET /v1/me` reports the flag per profile; OpenAPI and `openapi:check` updated
- [ ] ar/en strings, RTL verified; Release-QA feature + passing spec
**Blocked by:** F0.

### F2 — Story · firm-v1
**Summary:** Portal: read a receipt's PDF text and QR code on the device to prefill the review
**Problem:** Most firm receipts arrive as digital PDFs or Gulf/Jordan e-invoice printouts with a QR. Both can be read exactly, in the browser, with no OCR and no server.
**Scope (in):** on upload or review in the portal, read a PDF's text layer (pdf.js, lazy chunk) and decode a ZATCA QR (TLV: seller name, VAT number, timestamp, total, VAT) and a JoFotara QR (fields confirmed in the brief) from PDFs and images; feed MUT-255's suggested fields (date, amount, currency, vendor name, registration/VAT no., VAT amount once v2 adds it); per-field source shown ("from QR", "from PDF text").
**Scope (out):** photo OCR (F5); issuing or validating e-invoices; sending anything to the server before the user approves.
**Acceptance criteria:**
- [ ] A text-layer PDF prefills amount, date and currency when present; fields it can't find stay empty, never guessed
- [ ] A ZATCA QR prefills seller, VAT no., date, total and VAT exactly; a malformed QR is ignored without an error
- [ ] Reading runs fully in the browser (a no-network test proves it); the reader chunk loads only on the receipts screens
- [ ] p95 reading time under 1.5 s for a 2-page PDF on a mid-range laptop
- [ ] No copy says "compliant", "certified" or similar (D5)
- [ ] Fixture set (PDFs + QR images, ar/he/en) committed; Release-QA spec passes
**Blocked by:** F0, MUT-255, MUT-260. **Relates:** MUT-278.

---

## v2 Read (Dec)

Existing tickets labelled `firm-v2`: **MUT-256, MUT-257, MUT-258**.

### F3 — Story · firm-v2
**Summary:** VAT on expenses: net, VAT and gross with a rate, on every hosted surface
**Problem:** Firms reclaim the VAT they pay; today an expense has one amount and no VAT. Receivables already carry `vatTreatment`, `vatRateBasisPoints`, net/VAT/gross.
**Scope (in):** expense fields mirroring receivables (treatment, rate in basis points, net/VAT/gross minor units, gross = amount); server validation and rounding reused from `server/src/vat.ts`; portal ExpenseDrawer and phone capture show VAT on firm profiles (hidden or optional elsewhere, D2); existing expenses read as "no VAT recorded", never a guessed split; receipt suggestions (F2, MUT-256) carry VAT when read.
**Scope (out):** VAT returns; reverse-charge rules beyond the existing `VatTreatment` values.
**Acceptance criteria:**
- [ ] Creating an expense with a rate stores net/VAT/gross that add up exactly, rounded the same way receivables are
- [ ] Old expenses keep working and show "No VAT recorded"
- [ ] Non-firm profiles see no new required field
- [ ] Summaries keep per-currency gross totals unchanged for existing data
- [ ] Server, portal and phone tests; OpenAPI bump; Release-QA specs (web + phone flow)
**Blocked by:** F0, F1.

### F4 — Story · firm-v2
**Summary:** Vendor learning: a known vendor also prefills currency and VAT rate
**Problem:** MUT-254/256 prefill only the vendor name and last category. A firm's vendors bill in the same currency and VAT rate almost every time.
**Scope (in):** store each vendor's last currency and VAT treatment/rate on approve; prefill them in portal review, phone review and the vendor typeahead; the user's edit always wins and becomes the new default.
**Scope (out):** vendor management page, vendor merge (stay as MUT-254's tech debt).
**Acceptance criteria:**
- [ ] After two approved receipts from the same registration no., the third prefills currency and VAT rate
- [ ] A changed value on approve becomes the vendor's new default
- [ ] Profile isolation: one profile's vendor never prefills another's
- [ ] Release-QA specs on web and phone
**Blocked by:** F3, MUT-254.

### F5 — Story · firm-v2
**Summary:** Portal: read receipt photos in the browser with the on-device OCR engine
**Problem:** D4: firms upload photos from the desktop too. Reading must stay on the user's device.
**Scope (in):** run MUT-253's chosen engine (or its named browser fallback) as WASM in a Web Worker, lazy-loaded with its models; reuse the same extraction rules as the phone (shared spec + shared fixtures; the brief picks port vs. shared rules); per-field confidence; low-confidence fields stay empty.
**Scope (out):** server OCR; LLMs; batch scanning.
**Acceptance criteria:**
- [ ] Amount and date hit rates on the MUT-253 fixtures within 5 points of the phone reader
- [ ] Fully offline after the model is cached (no-network test); model download size and caching documented
- [ ] The receipts page stays interactive while reading (worker); p95 ≤ 4 s per photo on a mid-range laptop
- [ ] Release-QA spec passes
**Blocked by:** MUT-253, MUT-256, F2.

---

## v3 Team (Jan–Feb)

### F6 — Story · firm-v3
**Summary:** Firm roles: owner, bookkeeper and submitter, enforced on every write
**Problem:** `Membership` is access/no-access; every member can edit and delete everything.
**Scope (in):** role on membership (existing members become owner); a role column per domain in the writability rules (submitter: add expenses/receipts and edit their own until approved; bookkeeper: everything on expenses, vendors, bills, close; owner: plus members and firm settings); enforced on server routes and the store guard; `GET /v1/me` publishes the role's access; portal and phone hide what the role can't do.
**Scope (out):** custom roles; per-project permissions; roles on Malafat-owned domains (customers, agreements, payments stay as today).
**Acceptance criteria:**
- [ ] Every expenses/vendors/receipts/bills route refuses a role without access with the existing READ_ONLY-style error
- [ ] A drift test keeps the role table in the brief and the code identical
- [ ] Existing single-member profiles behave exactly as before
- [ ] Audit events record the acting member
- [ ] Server tests incl. `test:db`; portal + phone Release-QA specs
**Blocked by:** F0, F1.

### F7 — Story · firm-v3
**Summary:** Owner invites a teammate by email with a role, changes roles, removes members
**Problem:** Users are operator-provisioned only; a firm can't add its own staff.
**Scope (in):** owner-only invite (email + role) creating a pending user and a setup link through the existing account-setup flow (MUT-235); the link is always copyable; email delivery through the provider chosen in F0 when configured; list members, change role, remove member (their records stay, attributed); invite expiry and revoke.
**Scope (out):** public signup; SSO; inviting into non-firm profiles.
**Acceptance criteria:**
- [ ] An owner invites a person and gets a copyable setup link; redeeming it lands them in the firm with that role
- [ ] An invite expires (brief sets the window) and can be revoked; a used or expired link fails clearly
- [ ] Removing a member ends their sessions for that firm and keeps their records
- [ ] The no-self-registration test is updated deliberately, not bypassed
- [ ] Rate limits on invites; audit events; Release-QA spec
**Blocked by:** F6.

### F8 — Story · firm-v3
**Summary:** Approval: a firm can require a bookkeeper to approve submitted expenses
**Problem:** D7: some firms want staff spend checked before it counts.
**Scope (in):** per-firm "Require approval" setting (owner); a submitter's expense becomes Pending, excluded from every summary and group total until approved; approve/reject (with reason) by bookkeeper or owner; submitter sees status; an "Awaiting approval" queue on the portal; phone shows status on Recent.
**Scope (out):** multi-step approval; spending limits.
**Acceptance criteria:**
- [ ] With the setting off, nothing changes for anyone
- [ ] With it on, a submitter's expense is excluded from totals until approved; rejection keeps it visible to the submitter with the reason
- [ ] Turning the setting off leaves existing Pending items Pending until decided (no silent approval)
- [ ] Summary queries prove the exclusion (tests on memory store and Postgres)
- [ ] Release-QA specs (web + phone)
**Blocked by:** F6.

---

## v4 Payables (Mar)

### F9 — Story · firm-v4
**Summary:** Hosted API: vendor bills, bill payments and allocation (what the firm owes)
**Problem:** The firm can't record a bill due later, pay it in parts, or see what it owes.
**Scope (in):** `Bill` (vendor, currency, net/VAT/gross, issue + due date, status open/settled, optional receipt link), `BillPayment` (numbered, posted/reversed, never edited), `BillAllocation` — mirroring receivables/payments/allocations; oldest-due-first auto-allocation reused from `payments/allocate.ts`; payables summary (per currency, aging buckets due / 1–30 / 31–60 / 60+); an expense created from a paid bill is not double-counted (brief defines the rule); session-only, `bills` writability row with role columns; idempotency keys on writes.
**Scope (out):** credit notes from vendors (later); bank reconciliation.
**Acceptance criteria:**
- [ ] A bill paid in two parts reads partial then settled; a reversed payment reopens it
- [ ] Aging totals match per currency; nothing is summed across currencies
- [ ] Totals never count the same money as both a bill payment and an expense
- [ ] OpenAPI bump, `openapi:check`, `test:db`
**Blocked by:** F0, F3, F6.

### F10 — Story · firm-v4
**Summary:** Portal: Bills — add a bill from a receipt, pay it, see payables aging and "We owe"
**Scope (in):** Bills tab in Expenses (SectionTabs, drawer-first); create from a To-review receipt or by hand; record a full or partial payment; aging view; "We owe" next to "Owed to us" on the Overview for firm profiles; ar/en, RTL.
**Acceptance criteria:**
- [ ] A receipt can become a bill in one drawer; the receipt links to it
- [ ] Partial payment shows remaining; overdue bills are marked
- [ ] Overview shows "We owe" per currency on firm profiles only
- [ ] Release-QA specs pass
**Blocked by:** F9.

### F11 — Story · firm-v4
**Summary:** Phone: see bills due and record a bill payment
**Scope (in):** bills due this week on the phone; record a payment against a bill; offline outbox like other captures.
**Acceptance criteria:**
- [ ] Bills due and overdue listed per profile; a payment recorded on the phone settles the bill on the server
- [ ] Works offline then sends; iOS + Android; Release-QA flow passes
**Blocked by:** F9.

### F12 — Story · firm-v4
**Summary:** Staff reimbursements: an expense paid out of pocket is owed to the teammate
**Scope (in):** "Paid by" on an expense (firm / a member); out-of-pocket expenses create a bill owed to that member; mark reimbursed records a bill payment; "Owed to staff" list per member.
**Acceptance criteria:**
- [ ] A submitter's out-of-pocket expense shows under Owed to staff until reimbursed
- [ ] Reimbursing in one payment settles several expenses (allocation)
- [ ] Respects approval: Pending expenses aren't owed until approved
- [ ] Release-QA specs (web + phone)
**Blocked by:** F8, F9.

---

## v5 Close (Apr)

### F13 — Story · firm-v5
**Summary:** Month close: lock a month, correct by reversal, reopen with a reason
**Scope (in):** bookkeeper/owner closes a month per firm; writes dated in a closed month (expenses, bills, bill payments, receipts approve) are refused with a clear error; corrections are new or reversing entries dated in an open month; owner reopens with a reason (audited); closed months marked in lists.
**Scope (out):** closing Malafat-written receivables (Malafat owns them).
**Acceptance criteria:**
- [ ] Any write dated inside a closed month is refused on every route and the store guard
- [ ] Reopen requires a reason and writes an audit event
- [ ] The phone outbox surfaces a refused write instead of dropping it
- [ ] Release-QA specs
**Blocked by:** F6, F9.

### F14 — Story · firm-v5
**Summary:** VAT summary per period: VAT charged minus VAT paid, for your accountant
**Scope (in):** per currency and period: VAT on receivables (output) minus VAT on approved expenses and bills (input); drill-down to rows; "No VAT recorded" rows counted separately; labelled as a summary for the accountant, not a return.
**Acceptance criteria:**
- [ ] Totals match row sums per currency; Pending and reversed items excluded
- [ ] Copy never says "return", "filing" or "compliant"
- [ ] Release-QA spec
**Blocked by:** F3, F9.

### F15 — Story · firm-v5
**Summary:** Accountant pack: export a period as CSV + XLSX with a zip of receipts
**Scope (in):** per period: expenses, bills, bill payments, receivables, payments, VAT summary as CSV and XLSX; receipts zip with files named to match row ids; generated in the browser from API data (no new server file storage); closed-month packs marked final.
**Scope (out):** account-code mapping; package-specific formats.
**Acceptance criteria:**
- [ ] Every row in the files has its receipt in the zip when one exists, and vice versa
- [ ] Amounts are in major units with currency columns; Arabic/Hebrew text survives Excel (UTF-8 BOM for CSV)
- [ ] A 1,000-row month exports in under 10 s
- [ ] Release-QA spec
**Blocked by:** F13, F14.

### F16 — Task · firm-v5
**Summary:** Research: what issuing e-invoices would take (ZATCA phase 2, JoFotara, Israel allocation numbers)
**Scope (in):** obligations, certification, APIs, costs and timelines per country; whether Mutaba3a could or should issue; recommendation. No build.
**Acceptance criteria:**
- [ ] A written comparison per country with sources and dates checked
- [ ] Go / no-go recommendation for a later version, with cost
**Blocked by:** none.

---

## Edits to existing tickets (on approval)

- **Labels:** `firm-v1` on MUT-253, 254, 255, 259, 260; `firm-v2` on MUT-256, 257, 258. No re-parenting (they stay under MUT-252).
- **Comment on MUT-252:** firm profiles override decision 5 and the "VAT breakdown" / "e-invoice" out-of-scope lines (epic link, ADR in F0). Personal profiles unchanged.
- **Comment on MUT-253:** the engine must also run in the browser as WASM, or the spike names a browser fallback; add QR (ZATCA/JoFotara) fixtures.
- **Comment on MUT-260:** portal reading arrives in F2 (PDF + QR) and F5 (photo); MUT-260 itself stays manual review.
- **Links:** new epic relates MUT-252, MUT-266, MUT-278. Blocks links as listed per child.
