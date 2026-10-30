# Firm books — design brief (MUT-299, epic MUT-298)

Status: **approved by Basel, 2026-10-19**, as written, including DR1–DR14 (MUT-299 AC 5).
Plan and reviews: `.claude/designs/mut-299-firm-books-plan.md` (eng decisions D1–D15, design defaults DR1–DR14). Intake: `.claude/designs/firm-books-intake-drafts.md` (intake decisions ID1–ID9). ADR: **ADR-099** in `.claude/DECISIONS.md`. Tests: `.claude/designs/firm-books-tests.md`. Wireframe: `.claude/designs/mut-299-firm-books-wireframe.html`.

Naming in this brief:
- **ID1–ID9:** the intake decisions (the plan file and the intake drafts call them D1–D9; they're renamed here so they can't be confused with the eng decisions).
- **D1–D15:** the eng-review decisions, all approved by Basel.
- **DR1–DR14:** the design defaults, **approved with this brief** (Basel, 2026-10-19).
- **B1–B12:** the plan's own proposals; approving the brief approves them as amended here.

---

## 1. Problem, audience, outcome

**Problem.** Small firms keep receipts in WhatsApp and email, re-type them for their accountant, and can't see what they owe. These are law and accounting offices and agencies, not solo freelancers. Mutaba3a's hosted ledger already tracks what clients owe and pay. Its expense side is single-entry, though: an expense is money that already left, with no vendor bill, no VAT, no roles and no month close.

**Outcome.** A firm can:
- collect every receipt in one place
- have most receipts read on the device
- let staff submit expenses while an owner or bookkeeper approves them
- track what it owes vendors and staff
- close each month
- hand its accountant one honest pack

**Not a general ledger** (ID9). Records stay append-only with reversals; journal lines may be derived later.

### Acceptance criteria of this brief (MUT-299, as reworded by D12 and D14)

1. Every cross-cutting rule is locked (§3–§11). v1 (MUT-300, MUT-301) has full API contracts. v2–v5 children have route names, data shapes and error codes (§12).
2. ADR-099 logs every override (§20).
3. The firm role matrix is written between drift-test markers (§4.2).
4. The email-provider **requirement and criteria** are recorded (§10.3). MUT-306 picks the vendor.
5. Basel approves this brief, including DR1–DR14. **Done 2026-10-19.**

---

## 2. What exists (reuse, not rebuild)

| Need | Existing piece | Where |
|---|---|---|
| Who may do what | `WRITABILITY_MATRIX`, `sessionScopesFor`, `sessionAccessFor`, drift test | `server/src/auth/writability.ts:40-57,104-111`, `server/src/__tests__/writability-drift.test.ts` |
| Data-layer guard | `STORE_ACCESS`, `principalStoreGuard` | `server/src/auth/store-guard.ts:37,243-251` |
| Profile list | `buildMe`, `hostedProfileFor` | `server/src/routes/sessions.ts:234-253` (moves to `routes/me.ts` with MUT-286), `server/src/serializers.ts:68-90` |
| Payables template | Receivable / Payment / PaymentAllocation / ReceivableCredit / PaymentCounter, `allocate.ts` | `server/prisma/schema.prisma`, `server/src/payments/allocate.ts:11` |
| VAT math | `computeVat`, `roundHalfUpDiv` | `server/src/vat.ts:39,45-59` |
| One-time links | AccountSetupToken (SETUP / RESET) | `server/src/routes/admin-users.ts:93-98`, `routes/account-setup.ts`, ADR-088 |
| Org row lock | `lockOrganization` (FOR NO KEY UPDATE) | `server/src/repositories/prisma.ts:1534` |
| Expense filter | `expenseWhere` / `matchesExpense` | `prisma.ts:1634-1645`, `memory.ts:1808` |
| Date floor | `assertNotTooOld` (stateless, ADR-086) | `server/src/agreements/compose.ts:158-170` |
| Audit | `store.audit.append`, actor USER/ADMIN/SYSTEM | `server/src/repositories/ports.ts:109-118` |
| Portal UI | `Drawer`, `SectionTabs`, `HostedTable`, `QueryView`, `ReadOnlyNotice`, `.hp-banner-*`, `.hp-pill-*`, `RecordPaymentDrawer`, `ReceiptUploader`, `ExpenseDrawer`, `Select` (ui/Input) | `src/hosted/components/*`, `src/hosted/hosted.css` |
| Local mode | MemoryLedgerStore snapshot + migrations + fingerprint | `feature/mut-284-local-mode` (ADR-097), not on main yet |

---

## 3. The firm model (B1, B2, D4)

### 3.1 What a firm is

**A firm is an organization with `firmEnabledAt` set** (ID3: explicit and operator-enabled). Firm features never key off `ProfileType`.

There are two ways an organization becomes a firm, and the operator sets the flag **in place** for both (amended by the MUT-300 eng review D4, 2026-10-19):
1. **An operator-provisioned organization** (`ownerUserId` null; it may be Malafat-fed, ID1).
2. **An owned Business profile** whose owner asks for firm features. It **stays owned**: `ownerUserId` and `profileType` are untouched, it still counts toward the cap of 6, and its owner's membership becomes OWNER. Every owned-keyed capability keeps working (income capture, settle, redate, rename, the API-key/bind/grant refusals).
   - The built-in personal profile never gets firm features (CHECK `organizations_firm_not_personal_check`). An owned profile typed PERSONAL is refused too (409 `NOT_BUSINESS`). The request row isn't offered on either.

~~B1 conversion~~ (ownership moved to an OWNER role, `profileType` cleared) is **superseded by D4**: it would have removed income capture, settle and redate from the first pilot owner, since all three key on `owned`. MUT-182's invariant "an owned profile is standalone, never shared" therefore still holds for v1–v2. **Sharing an owned firm profile with staff is a v3 decision**, taken after the pilot (MUT-305/306 Jira notes).

### 3.2 Columns (MUT-300)

`Organization`:
- `firmEnabledAt DateTime?` — set means the organization is a firm.
- `firmRequestedAt DateTime?` and `firmRequestedByUserId Uuid?` — the request is kept until it's decided (enabled or declined). CHECK `organizations_firm_request_pair_check`: both or neither.
- `closedThroughMonth String? @db.VarChar(7)` — added by MUT-312.

`Membership.role MembershipRole @default(OWNER)` — added by MUT-300 (not MUT-305), because enabling writes roles. Inert until the flag is on (O10).

### 3.3 Enabling (D4)

- On an operator firm, enabling requires the operator to name **at least one owner**, each already a member. On an owned profile the owner is the OWNER and named owners are ignored.
- Every other existing member becomes **BOOKKEEPER**: today's expense rights, no member management. A member added later by the operator is BOOKKEEPER too (MUT-300 D3).
- Disabling clears the flag and leaves the role values in place; they have no effect while the flag is off.
- The operator can **decline** a pending request (MUT-300 D6); the owner sees the offer again and may ask again.
- The request doesn't bump the profile's `version` (O3), so an open edit form keeps its If-Match.
- Every enable, disable, decline and request writes an `ADMIN` or `USER` audit event, in the write's transaction. The same state twice writes nothing.

---

## 4. Roles (D1, D4, D6, O7)

### 4.1 Derivation (D1)

- `Membership.role`: `OWNER | BOOKKEEPER | SUBMITTER`. Column default `OWNER`, which has no effect while the firm flag is off.
- Role is an input to the **one** permissions derivation: `sessionScopesFor(writer, firm ? role : null)`. The store guard factory receives the same role. `/v1/me` `access` is computed by the same function.
- The route check, the data-layer guard and the portal's access map therefore can't disagree.
- The scope vocabulary gains **action scopes**: `expenses:approve`, `close:write`, `members:write` (O7).
- The submitter rule "edit own unapproved rows" is a **repository-level** check in both the Prisma and memory stores (O7), because the store guard sees methods, not rows.
- **Last-owner rule:** the last OWNER can never be removed or demoted. Refusal: 409 `CONFLICT`, `details.reason: LAST_OWNER`.

### 4.2 The firm role matrix (D6) — source of truth, drift-tested

When the firm flag is off, this table does not apply (the MUT-39 matrix alone decides). When it is on, the session column of the MUT-39 matrix is narrowed by role as below. The new domains `vendors`, `receipts`, `bills` and `close` are added to the MUT-39 matrix by their tickets.

<!-- firm-role-matrix:begin -->
| Domain | OWNER | BOOKKEEPER | SUBMITTER |
|---|---|---|---|
| customers | as session | as session | read |
| projects | as session | as session | read |
| agreements | as session | as session | none |
| payments | as session | as session | none |
| attachments | as session | as session | none |
| summaries | read | read | none |
| audit | none | none | none |
| expenses | read-write + approve | read-write + approve | own |
| capture | as session | as session | none |
| identity | read-write | read-write | read-write |
| conversions | as session | as session | none |
| vendors | read-write | read-write | read |
| receipts | read-write | read-write | own |
| bills | read-write | read-write | none |
| close | read-write | read-write | none |
| members | read-write | read | none |
<!-- firm-role-matrix:end -->

What the cells mean:
- **as session:** the MUT-39 session column for that profile, unchanged (read on a Malafat-fed firm's MALAFAT rows, read-write otherwise).
- **own:** create, plus read, edit and delete of rows the person created (`createdByUserId`) while they aren't APPROVED. Reads list only the person's own rows.
- **approve:** grants `expenses:approve`.
- **close read-write:** grants `close:write` (close and reopen). **Reopen is OWNER-only**, enforced as an action check inside `close:write`.
- **members read-write:** grants `members:write` (invite, change role, remove).

**A submitter sees no money summaries:** no Overview figures and no group totals for others' expenses (D6). Their own expense list carries its own count only.

Role refusal: 403 `ROLE_NOT_PERMITTED`, `details: { domain | action, role }`. This is a new code, so the UI can say "Your role can't …" instead of "read-only profile".

---

## 5. Approval (ID7, B4, Section 2 of the eng review, O6, DR9)

### 5.1 Columns and the creation rule

- `Expense.approval`: `APPROVED | PENDING | REJECTED`, default `APPROVED`.
- Also `decidedByUserId`, `decidedAt` and `rejectionReason`.
- The firm setting is `Organization.requireApproval Boolean @default(false)`; only the owner sets it.
- **One function, `initialApprovalFor(role, firm)`, sets the state on all four creation paths:**
  - `POST /v1/expenses`
  - inbox file-as-expense
  - receipt approve (MUT-255)
  - bill-payment posting
- The result: PENDING when the firm requires approval **and** the actor is a SUBMITTER; APPROVED otherwise.
- **Bill-payment-posted expenses are always APPROVED.** Only bookkeepers and owners pay bills.

### 5.2 Totals

`expenseWhere` / `matchesExpense` gain an `approval` option, and **every money total passes `APPROVED`**:
- `GET /v1/summaries/expenses`
- group `totalsByCurrency` and its excluded totals
- the group summary

Lists default to all states. Row counts stay unfiltered: the category count (`prisma.ts:1562`) and the raw SQL at `:1580`. The entries feed shows the state and never hides it.

### 5.3 Decisions

- Approve or reject: `POST /v1/expenses/{id}/decision` `{ decision: APPROVED | REJECTED, reason? }`. `reason` is required for REJECTED. The route needs `expenses:approve` and an If-Match header.
- A decision on a row dated in a closed month is refused: 409 `PERIOD_CLOSED` (O6).
- **DR9 (approved): resubmit.** A submitter may edit a REJECTED expense; saving puts it back to PENDING and clears the reason. The submitter may also delete it.
- Turning `requireApproval` off leaves existing PENDING rows pending until someone decides them. Nothing is approved silently.

---

## 6. Receipts, vendors and reading (ID4, B8, D8, DR6)

### 6.1 The `ReceiptSuggestion` contract (shared by phone and portal)

```ts
type SuggestionSource = 'qr' | 'pdf-text' | 'ocr' | 'vendor';
interface SuggestedField<T> { value: T; source: SuggestionSource; confidence: number /* 0..1 */ }
interface ReceiptSuggestion {
  readerVersion: string;            // e.g. "portal-1.0", "phone-1.0"
  date?: SuggestedField<string>;    // YYYY-MM-DD
  totalMinor?: SuggestedField<string>; currency?: SuggestedField<Currency>;
  vatMinor?: SuggestedField<string>; vatRateBasisPoints?: SuggestedField<number>;
  vendorName?: SuggestedField<string>; registrationNo?: SuggestedField<string>;
  phone?: SuggestedField<string>; email?: SuggestedField<string>;
}
```

MUT-255 stores it as the receipt's suggested fields, next to the approved fields. A field under the reader's confidence threshold is **omitted, never sent wrong** (MUT-256's rule).

### 6.2 Where reading happens (ID4: always on the user's device)

| Reader | Where | Ticket | Notes |
|---|---|---|---|
| PDF text layer | portal (pdf.js, lazy chunk), phone | MUT-301, MUT-256 | no OCR when a text layer exists |
| ZATCA QR | portal, phone | MUT-301, MUT-256 | TLV tags 1–5: seller, VAT no., timestamp, total, VAT |
| JoFotara QR | portal, phone | MUT-301 (gated) | **Unconfirmed layout.** Secondary sources only (2026-10-19): returned by the national system after clearance as `EINV_QR`, holding six items including the seller's tax number (guide v1.5 p.106, not seen). MUT-301 decodes it only after checking the official ISTD guide or the sandbox; until then JoFotara receipts use PDF text or OCR. |
| Photo OCR | phone (MUT-256), portal WASM worker (MUT-304) | | engine from MUT-253; the portal uses the same engine as WASM or its named fallback |
| Vendor learning | server match by registration no. → name, last category, **currency and VAT rate** | MUT-254, MUT-303 | the user's edit becomes the new default |

The extraction rules are written in Dart on the phone and **ported** to TypeScript for the portal. Both are tested against **one shared JSON fixture set** (`fixtures/receipts/*.json` plus the source files from MUT-253), and the golden tests run on both sides.

### 6.3 One receipt, one record (D8)

`ExpenseReceipt` gets an optional `billId`, plus a CHECK that at most one of `expenseId` and `billId` is set. Filing it a second time gets 409 `CONFLICT`, `details.reason: RECEIPT_ALREADY_FILED`. Deleting the record frees the receipt.

### 6.4 How a read field is shown (DR6, approved)

- A one-line caption sits under the field: "From the QR code" · "Read from the PDF" · "Read from the photo; check it".
- The caption disappears once the field is edited.
- A low-confidence field stays empty with the hint "Check the receipt".
- No confidence percentages, no icon chips.

---

## 7. VAT on expenses and bills (B9, D9, DR14)

- `Expense` and `Bill` mirror the receivable columns: `vatTreatment`, `vatRateBasisPoints`, `netMinor`, `vatMinor`, `grossMinor`. They're all nullable; null means "No VAT recorded", never a guessed split.
  - **Amended by MUT-302 (ADR-231, 2026-10-30):** an expense has no `grossMinor`; its gross is `amountMinor`, and the server splits net and VAT out of it (`VAT_INCLUSIVE`). The largest-remainder split helper below is built with MUT-308, its only caller (D10).
- Rounding uses `computeVat` / `roundHalfUpDiv`. `amountMinor` stays the gross (the total paid).
- **VAT summary basis: invoice (D9).** Input VAT is VAT on bills, dated by the bill's issue date, plus VAT on APPROVED expenses that **don't** carry a `billPaymentId`.
- Posted expenses show their VAT share but are left out of the summary.
- **Split across payments (D9):** a bill's VAT is split across its payments by largest remainder, so the shares add up exactly to the bill's VAT. The last payment absorbs the remainder.
- **DR14 (approved):** on firm profiles the ExpenseDrawer shows a collapsed "VAT" row reading "No VAT recorded". Expanding it shows the treatment (Select) and rate, with net and VAT computed read-only. Non-firm profiles see no new required field.

---

## 8. Payables (ID9, B5, D7, D9, R7–R9)

### 8.1 Model (MUT-308)

```
Bill(id, organizationId, kind VENDOR|STAFF, vendorId? | memberUserId?, currency,
     netMinor?, vatMinor?, grossMinor, vatTreatment?, vatRateBasisPoints?,
     issueDate, dueDate, status OPEN|SETTLED, paidMinor, categoryId?, title?,
     createdByUserId, version, createdAt, deletedAt?)
BillPayment(id, organizationId, number, currency, amountMinor, allocatedMinor, paidOn,
     method CASH|BANK, status POSTED|REVERSED, reversedAt?, reversalReason?,
     replacesPaymentId?, requestId?, createdByUserId, version, createdAt)
BillAllocation(id, organizationId, billPaymentId, billId, amountMinor, createdAt)
BillPaymentCounter(organizationId, year, next)            -- mirrors PaymentCounter
Expense.billPaymentId?                                   -- set only on posted expenses
```

- Index `Bill (organizationId, status, dueDate)`.
- Allocation reuses `allocate.ts`'s oldest-due-first strategy.
- Payments are reversed, never edited.

### 8.2 The posting rule (B5)

- **A VENDOR bill's payment posts a linked expense**: same date, the allocated amount, the bill's category and vendor, and the payment's VAT share from D9's split.
- The bill itself never counts as spend.
- **A STAFF bill (MUT-311) posts nothing.** The out-of-pocket expense already counted when it was approved.
- **Posted expenses are read-only (D7).** PATCH or DELETE through `/v1/expenses` returns 409 `CONFLICT`, `details: { reason: POSTED_BY_BILL, billId }`. To change one, reverse the payment and record it again.
- **Reversal** soft-deletes the posted expense in the same transaction. If the payment's date is in a closed month, the reversal is refused with `PERIOD_CLOSED` until the month is reopened (D2).

### 8.3 Aging

The payables summary is per currency, never summed across currencies. Buckets: due (not yet), 1–30, 31–60, 60+ days overdue. The Overview shows **We owe** beside **Owed to us** (DR3).

### 8.4 Staff reimbursements (MUT-311)

- "Paid by" on an expense is either the firm or a member.
- When a member paid out of pocket and the expense is APPROVED, a STAFF bill is created for that member.
- "Mark reimbursed" records a bill payment; one payment may allocate across several staff bills.
- A PENDING expense isn't owed until it's approved.

---

## 9. Month close (ID9 lock, D2, D5, O2, O6, DR4, DR10)

### 9.1 Model

`Organization.closedThroughMonth` (`YYYY-MM`) is a single watermark:
- **Close** advances it to the chosen month. Only the next month can be closed, so the watermark never skips a month.
- **Reopen** lowers it. Reopen is owner-only, needs a reason, and is audited.

### 9.2 What a closed month refuses

Any create, edit, delete or decision on a row dated in or before `closedThroughMonth` is refused. The rows:
- expenses (`occurredOn`; a PATCH checks **both the old and the new date**)
- approval decisions (O6)
- bills (`issueDate`)
- bill payments and reversals (`paidOn`)
- receipt approve (the resulting expense date)
- inbox filing as an expense

**Income, payments, receivables and conversions are not locked** (D11 wording covers them).

Refusal: 409 `PERIOD_CLOSED`, `details: { month: "2027-09", closedThrough: "2027-09" }`. **There is no correction-by-reversal path for expenses (D2):** fixing one means reopening the month.

### 9.3 Where the check runs (O2, D5)

- `assertOpenPeriod(org, ...dates)` lives **behind the repository port**, inside the write transaction (Prisma).
- In firm organizations every write the lock checks takes `SELECT … FROM organizations … FOR SHARE` and reads `closedThroughMonth` under that lock.
- Close and reopen UPDATE the organization row, so they wait for in-flight writes.
- The memory store needs no lock (single-threaded), but runs the same check.
- The stateless `assertNotTooOld` call sites stay as they are.
- Firm expense create, update and soft-delete become transactional in MUT-312.

### 9.4 Closing with pending rows (DR10, approved)

Close is **blocked** while that month has PENDING expenses: 409 `CONFLICT`, `details: { reason: PENDING_EXPENSES, count, ids[≤50] }`. The Close tab lists them with Review links.

### 9.5 Refusal UX (DR4, approved)

- The drawer stays open with an inline `.hp-banner-error`: "September 2027 is closed. Ask an owner to reopen it."
- An owner's banner also links to "Reopen September".
- The phone outbox shows the same sentence and keeps the entry editable.

---

## 10. Members and invites (D3, D4, D10, D14, DR12)

### 10.1 Invite (MUT-306)

- `POST /v1/members/invitations` `{ email, role }` needs `members:write`, an Idempotency-Key, and is rate-limited per firm and per owner.
- It creates an **INVITE** token (a new `SetupLinkPurpose` value) bound to the email, and **mails the link to that address only (D10)**.
- The owner always gets the same 202 `{ status: "sent", expiresAt }`, whether or not the email has an account (D3).
- No User row is created at invite time; a new person's User is created on **redemption**.
- Redemption:
  - **new email:** set a password through the link, then a pending membership.
  - **existing account:** sign in as that email, then Accept or Decline.
  - The membership is **pending until accepted**. SETUP and RESET are **never** minted on an existing account through an invite.
- An expired or used invite returns 410 `SETUP_LINK_UNUSABLE` with `details.state`.
- Invites expire after 7 days (MUT-306 confirms) and can be resent or revoked.

### 10.2 Members

- List members and pending invites, change a role, remove a member.
- Removing a member ends their sessions for that firm and keeps their records, still attributed to them.
- Last-owner rule as in §4.1.

### 10.3 Email provider (D14)

The requirement:
- an outbound provider behind a `Mailer` port, with a no-op adapter when unconfigured
- needed in v3
- **EU region**

Selection criteria: EU data region; DKIM/SPF on our sending domain; bounce and complaint webhooks; price at 1k and 10k emails a month, including setup work (domain verification, leaving any sandbox).

Candidates: Amazon SES, Postmark, Resend. **MUT-306's planning picks one**, with setup cost.

> **Superseded (2026-10-20, ADR-159, MUT-331):** Basel picked **Resend** (Barmajiyat's account, Mutaba3a's own domain, `eu-west-1` sending) for signup and recovery. MUT-306 uses that `Mailer`; it no longer picks a provider. MUT-331's story S1 blocks MUT-306.

### 10.4 Accept step (DR12, approved)

- **Portal:** after sign-in, a full-page "Join {firm}?" step comes before the app (Accept / Decline).
- **Phone:** the same step as a sheet.
- Pending invitations also show in the profile switcher as "Invited".

---

## 11. Data model summary and migration order

| Ticket | Adds | Memory store / local snapshot |
|---|---|---|
| MUT-300 | Organization `firmEnabledAt`, `firmRequestedAt`, `firmRequestedByUserId`; Membership `role` (moved here from MUT-305, plan C1) | mirror; snapshot format 1 → 2 migration and the orgs/members fingerprints (done at the merge with main, 2026-10-20) |
| MUT-301 | none server-side (portal reading; suggestions go to MUT-255's columns) | n/a |
| MUT-302 | Expense VAT columns; Bill VAT columns arrive with MUT-308 | mirror + migration |
| MUT-303 | Vendor `lastCurrency`, `lastVatTreatment`, `lastVatRateBasisPoints` | mirror + migration |
| MUT-305 | role enforcement (the column landed in MUT-300); scopes `expenses:approve`, `close:write`, `members:write` | mirror + **new Membership fingerprint** (missing today) |
| MUT-306 | `SetupLinkPurpose.INVITE`, `Invitation` (email, role, organizationId, invitedByUserId, tokenDigest, expiresAt, status) and a pending state on Membership | sessions, links and invites are never persisted locally (ADR-097) |
| MUT-307 | Expense `approval`, `decidedByUserId`, `decidedAt`, `rejectionReason`; Organization `requireApproval` | mirror + migration |
| MUT-308 | Bill, BillPayment, BillAllocation, BillPaymentCounter; Expense `billPaymentId`; ExpenseReceipt `billId` + CHECK | mirror + migration |
| MUT-311 | Expense `paidByUserId?`; Bill `kind`, `memberUserId` | mirror + migration |
| MUT-312 | Organization `closedThroughMonth` | mirror + migration |

**Local mode (B11):**
- Local organizations never get `firmEnabledAt`, and role stays the inert OWNER. Firm features are never shown signed out.
- Whichever of MUT-284 or the firm ticket lands second carries the snapshot migration.

---

## 12. API contracts

### 12.1 v1 — full contracts

**MUT-300 · firm flag and request** (as built, API `1.41.0-mut300`; amended by the MUT-300 eng review D3–D6 and plan C2/C5/C6)

| Method & path | Principal | Request | Success | Errors |
|---|---|---|---|---|
| `POST /v1/profiles/{profileId}/firm-request` | session, owner of an owned BUSINESS profile | `Idempotency-Key`; no body | 202 `{ firmRequest: { requestedAt } }`; a repeat returns the first request | 404 `NOT_FOUND`; 403 `READ_ONLY_PROFILE` `reason: NOT_OWNER` (a profile the caller only belongs to); 409 `CONFLICT` `reason: PERSONAL_PROFILE` (built-in personal), `NOT_BUSINESS` (owned, typed PERSONAL) or `ALREADY_FIRM`; 403 for an API key |
| `GET /admin/v1/firm-requests` | admin | `?limit&cursor` | 200 `{ data: [{ organizationId, name, requestedAt, requestedByUserId, requestedByEmail, owned }], nextCursor }`, oldest request first | 401 `ADMIN_UNAUTHORIZED`; 422 bad cursor |
| `PATCH /admin/v1/organizations/{organizationId}` | admin | `{ firmEnabled: true, ownerUserIds?: uuid[] }` or `{ firmEnabled: false }`; no If-Match (admin routes are idempotent by construction, C5) | 200 `{ organization }` with `firm: { enabledAt, requestedAt, requestedByUserId }`; the same state again is a no-op 200 | 404; 409 `CONFLICT` `reason: PERSONAL_PROFILE`, `NOT_BUSINESS` or `NOT_A_MEMBER` (`userIds`); 422 `VALIDATION_FAILED` (operator firm with no owner named) |
| `DELETE /admin/v1/organizations/{organizationId}/firm-request` | admin | none | 200 `{ organization }` | 404 (unknown, or nothing pending) |

- No convert route (D4).
- Audit actions: `firm.requested` (USER), `firm.enabled` (`{ ownerUserIds }`), `firm.disabled`, `firm.request_declined` (ADMIN).
- `GET /v1/me` per profile gains `firm: boolean`, `role: OWNER | BOOKKEEPER | SUBMITTER | null` (null while not a firm) and `firmRequestedAt` (owner only, C6), additive. `access` doesn't read the role until MUT-305 (D1). `Organization` and `Membership` admin views gain `firm` and `role`; the organization detail lists `members` with roles.
- CLI `scripts/users.ts`: `firm-requests`, `firm-enable --organization-id <id> [--owner <email>[,…]]`, `firm-disable`, `firm-decline` (npm `firm:*`).

**MUT-301 · portal PDF text + QR prefill** (no server routes)

- **Entry points:** on upload, and on opening a To-review receipt.
- **Pipeline:** the file is read client-side by a lazy chunk:
  1. PDF: `pdfjs-dist` text layer, then the ZATCA QR from embedded images.
  2. Image: QR decode.
  3. Parse with the TS extraction rules.
- **Output:** a `ReceiptSuggestion` (`readerVersion: "portal-1.0"`), sent with MUT-255's suggested fields on approve.
- **Budgets:** chunk ≤ 350 KB gzip, loaded only on receipt screens [estimated, measure in MUT-301]; p95 ≤ 1.5 s for a 2-page PDF on a mid-range laptop.
- **Failure:** any reader error yields an empty suggestion plus the caption "Couldn't read this receipt". It never blocks manual entry.
- **No network:** a no-network test asserts zero requests during reading.

### 12.2 v2–v5 — names, shapes, error codes (each child's eng-ticket writes the full contract against this brief)

| Ticket | Routes (names) | Shapes | New or reused error codes |
|---|---|---|---|
| MUT-302 VAT on expenses | existing `POST/PATCH /v1/expenses` gain `vat` | `vat: { treatment, rateBasisPoints } \| null` → server returns net/vat/gross | `VALIDATION_FAILED` |
| MUT-303 vendor learning | existing vendor typeahead returns defaults | `vendor.defaults: { categoryId?, currency?, vat? }` | none |
| MUT-304 portal photo OCR | none (portal worker) | `ReceiptSuggestion` `readerVersion: "portal-ocr-1.0"` | none |
| MUT-305 roles | `/v1/me` role and access; role checks everywhere | §4.2 matrix | `ROLE_NOT_PERMITTED` (new, 403), `CONFLICT` `LAST_OWNER` |
| MUT-306 invites and members | `POST /v1/members/invitations`, `POST /v1/members/invitations/{id}/resend\|revoke`, `GET /v1/members`, `PATCH /v1/members/{userId}` (role), `DELETE /v1/members/{userId}`, `POST /v1/invitations/redeem`, `POST /v1/invitations/{id}/accept\|decline` | §10 | `SETUP_LINK_UNUSABLE` (reused), `RATE_LIMITED`, `CONFLICT` `LAST_OWNER` |
| MUT-307 approval | `POST /v1/expenses/{id}/decision`, `PATCH /v1/profiles/{id}` `requireApproval` | §5 | `PERIOD_CLOSED`, `ROLE_NOT_PERMITTED` |
| MUT-308 bills API | `/v1/bills`, `/v1/bills/{id}`, `/v1/bill-payments`, `/v1/bill-payments/{id}/reverse`, `/v1/summaries/payables` | §8.1 | `CONFLICT` `POSTED_BY_BILL`, `RECEIPT_ALREADY_FILED`, `PERIOD_CLOSED`, `VALIDATION_FAILED` (over-allocation) |
| MUT-309 portal bills | uses MUT-308 | DR1, DR3 | none |
| MUT-310 phone bills | uses MUT-308 | outbox entries for bill payments | `PERIOD_CLOSED` surfaced in the outbox |
| MUT-311 staff reimbursements | `POST /v1/expenses` `paidByUserId`; `/v1/bills?kind=STAFF` | §8.4 | none new |
| MUT-312 month close | `POST /v1/close` `{ month }`, `POST /v1/close/reopen` `{ month, reason }`, `GET /v1/close` | §9 | `PERIOD_CLOSED` (new, 409), `CONFLICT` `PENDING_EXPENSES` |
| MUT-313 VAT summary | `GET /v1/summaries/vat?from&to` | per currency: `{ outputVatMinor, inputVatMinor, netMinor, unrecordedCount }` | none |
| MUT-314 accountant pack | client-built from existing reads | DR13 | none |

The new error codes, `ROLE_NOT_PERMITTED` and `PERIOD_CLOSED`, go into `ERROR_CODES` and the OpenAPI spec in the ticket that first raises them. Malafat's error mapping is informed, per the `errors.ts` contract note.

---

## 13. Security

- **Role escalation:** a role change needs `members:write`. Only an OWNER can grant OWNER. The last-owner rule holds, and every change is audited.
- **Invites:** the link goes only to the invitee's inbox (D10). The response is the same whether or not the email has an account (D3). A token is single-use, bound to the email, and expires. Rate limits apply per firm and per owner. No setup or reset link is ever minted on an existing account.
- **Cross-org isolation:** every new table carries `organizationId` and is scoped by the existing profile selection. A submitter reads only rows they created (repository check).
- **Period lock:** enforced in the transaction, so the API, phone outbox and import all hit the same check (§9.3).
- **Audit:** a new action family covers `firm.*`, `member.*`, `invitation.*`, `expense.decided`, `bill.*`, `bill_payment.*` and `period.closed` / `period.reopened`, with the acting user recorded.
- **Malafat API keys** get `none` on vendors, receipts, bills, close and members (ID1).

---

## 14. i18n, RTL and copy rules

- The UI is in Arabic (default) and English, using the portal dictionaries `ar.json` / `en.json` and the phone ARB files. Hebrew is a reading language only.
- Layout uses logical properties. Figures use `--m-font-num` with tabular numerals and isolated direction.
- **Compliance copy guard (B10, as amended by O10):** a test over the firm keys in `ar.json` and `en.json` rejects these phrases: "compliant", "certified", "tax return", "VAT return", "filing", "ZATCA approved", and their Arabic equivalents (متوافق، معتمد، إقرار ضريبي، تقديم الإقرار). It works at phrase level, so "approved" stays allowed for D7's approval states.
- The pack and summary wording follows D11 (§9, DR13): "Expenses and bills closed through {month}", and "May still change: recorded by Malafat or by your team after the close" on the client-money sheets. The word "final" is never used.

---

## 15. Design rules (DR1–DR14, approved with this brief on 2026-10-19)

These are summarised here. The full text, the state table and the storyboard are in the plan file's design review, and the wireframe shows them.

| DR | Rule | Ticket |
|---|---|---|
| DR1 | Expenses tabs: Expenses · To review (count) · Bills · Groups. A new nav item **Firm** (owners and bookkeepers): Members · Month close · Accountant pack. The firm request lives in the profile's Manage drawer. | 300, 309, 312, 314 |
| DR2 | A submitter's nav is Expenses only (Expenses (mine) · To review (mine)); the profile opens on Expenses. | 305 |
| DR3 | Overview: collections first; **We owe** beside Owed to us; "Needs attention" rows (to review, waiting for approval, bills overdue or due, month not closed). Rows, not cards. | 309, 307, 312 |
| DR4 | A closed-month refusal is inline, names the month, and gives owners a reopen link. Never toast-only. | 312 |
| DR5 | No onboarding checklist. One dismissible "Firm features are on" banner, then empty states carry the next action. | 300 |
| DR6 | A source caption under each read field; low-confidence fields stay empty with a hint. | 301, 304 |
| DR7 | Status pills from the brand pairs: butter = waiting, rose = rejected or overdue, peach = due soon, mint = paid, lavender = closed; approved has no pill. Reuse `.hp-pill-*`, `.hp-banner-*`, `ReadOnlyNotice`. Register `StatusPill`, `MemberRow`, `SourceCaption`, `ClosedMonthNotice`. | all UI |
| DR8 | Approval queue: rows; at 375 px they stack with full-width 44 px buttons; focus moves to the next row's Approve; a live region announces the count; reject needs a reason. Plus the a11y rules for every firm surface. | 307 |
| DR9 | A rejected expense can be edited and resubmitted (back to waiting), or deleted. | 307 |
| DR10 | Close is blocked while the month has waiting rows; the Close tab lists them. | 312 |
| DR11 | No bulk approve in v3; revisit after the pilot. | 307 |
| DR12 | The invitee accepts on a full-page "Join {firm}?" step (portal) or a sheet (phone); pending invites show in the profile switcher. | 306 |
| DR13 | Accountant pack: a month picker (closed months first) and one "Download pack (.zip)" with CSV + XLSX + receipts. | 314 |
| DR14 | ExpenseDrawer VAT row is collapsed by default ("No VAT recorded") on firm profiles only. | 302 |

---

## 16. QA scenarios (release-QA; `portal` app unless noted)

| id | Area | Steps (as the user says them) | Promised outcome | Ticket |
|---|---|---|---|---|
| profiles.firm-request | profiles | Open Manage profiles, open my Business profile, ask to use it for a firm | The pane reads "Requested"; it survives a reload; a Personal profile never offers it | 300 |
| shell.firm-enabled-banner | shell | Sign in after the operator enabled firm features | One "Firm features are on" note; dismissing it keeps it gone; Arabic reads right to left | 300 |
| receipts.pdf-prefill | expenses | Upload a text PDF receipt, open it | Date, amount and currency are filled with "Read from the PDF" captions | 301 |
| receipts.zatca-qr | expenses | Upload a ZATCA receipt image | Seller, VAT no., date, total and VAT are filled "From the QR code" | 301 |
| receipts.unreadable | expenses | Upload a receipt the reader can't read | Fields are empty, with "Couldn't read this receipt"; can still save by hand | 301 |
| expenses.vat | expenses | Add an expense with 15% VAT | Net and VAT shown; totals unchanged in gross | 302 |
| members.invite | firm | Invite a teammate as submitter | "Invitation sent", whatever the email | 306 |
| members.accept (portal + flutter) | session | Open the invite email, sign in, accept | Lands in the firm with the role; the switcher shows the firm | 306 |
| members.last-owner | firm | Try to demote the only owner | Refused, with the reason shown | 305 |
| roles.submitter-nav | shell | Sign in as a submitter | Only Expenses is shown; no client money anywhere | 305 |
| approval.flow | expenses | Submit as a submitter, approve as bookkeeper | Pending is hidden from totals and shown in the queue; after approval it counts | 307 |
| approval.reject-resubmit | expenses | Reject with a reason, then edit and resubmit | The reason is shown; the row goes back to waiting | 307 |
| bills.from-receipt | expenses | Turn a receipt into a bill, pay half, then the rest | Partial, then settled; the posted expense reads "From bill" and can't be edited | 308/309 |
| bills.we-owe | overview | Open the Overview with open bills | We owe per currency beside Owed to us | 309 |
| close.refuse-and-reopen | firm | Close September, edit a September expense, reopen with a reason | The refusal names September; after reopening the edit saves | 312 |
| close.blocked-pending | firm | Try to close a month with waiting expenses | Close is refused and the waiting rows are listed | 312 |
| vat.summary | firm | Open the VAT summary for a month with a paid bill | The bill's VAT counts once | 313 |
| pack.download | firm | Download September's pack | A zip with CSV + XLSX + receipts; client-money sheets say "may still change" | 314 |

Each becomes a feature in `qa/features/portal/<area>.yaml` (or `qa/features/flutter/…`) with a passing tagged spec, in the ticket that builds it.

---

## 17. Cost

- **Email (v3):** cents to tens of dollars a month at firm volume, plus a one-time domain setup. MUT-306 measures and picks (D14).
- **OCR models in the browser (MUT-304):** download size set by MUT-253's engine, cached with immutable `/assets/*` headers (the portal already serves `/assets/*` immutable). Only users of the receipts screen pay the download.
- **Receipt storage:** the existing attachments bucket; 10 MB per file cap (MUT-255).
- **No paid AI or OCR services** (ID4).

---

## 18. Rejected options

- **A double-entry general ledger:** too heavy for small firms; their accountant keeps the books (ID9).
- **Lifting MUT-182's "owned profiles are never shared" rule** instead of converting: it would leave two kinds of shared organization (B1). (MUT-300 D4 then dropped conversion too: v1–v2 neither convert nor share an owned profile; v3 decides sharing after the pilot.)
- **A separate role middleware:** two sources of truth (D1).
- **Negative adjusting expenses for closed months:** deferred to TODOS.md #16 (D2).
- **A copyable invite link:** lets owners claim accounts in others' names (D10).
- **A cloud or LLM receipt reader:** ruled out (ID4).
- **Counting a bill's VAT on both the bill and its posted expenses:** double count (D9).
- **"Final" on packs:** untrue for client money (D11).

---

## 19. Build order and the pilot gate (D13)

```
MUT-299 (this brief) ─┬─ v1: MUT-300 firm flag ─┬─ MUT-301 portal PDF/QR (needs MUT-255, 260)
                      │                         └─ MUT-252 children 253..260
                      ├─ v2: MUT-302 VAT ─ MUT-303 vendor learning (needs 254); MUT-304 (needs 253, 256, 301)
                      ├── ▶ PILOT GATE: one named firm uses v1–v2 for 2 weeks; feedback may reorder or cut v3–v5
                      ├─ v3: MUT-305 roles ─┬─ MUT-306 invites   ─┐
                      │                     └─ MUT-307 approval  ─┤
                      ├─ v4: MUT-308 bills (needs 302, 305, 254) ─ 309, 310, 311 (311 also needs 307)
                      └─ v5: MUT-312 close (needs 305, 308) ─ 313 (needs 302, 308) ─ 314 (needs 312, 313)
MUT-315 research (independent)
```

The eng-tickets for MUT-305..315 start only after the pilot feedback (D13).

---

## 20. Records updated with this brief

- `.claude/DECISIONS.md`: **ADR-099** plus override-log rows.
- `.claude/CHANGELOG.md`, `.claude/SYSTEM_OVERVIEW.md` (planned firm capability), `.claude/TEST_PLAN.md` (pointer to `firm-books-tests.md`).
- `TODOS.md` #16 (adjusting entries).
- Jira:
  - **MUT-299:** AC 1 and AC 4 reworded.
  - **Child comments:** one comment per affected child carries its decisions (§21).
  - **New link:** MUT-254 blocks MUT-308.

## 21. What each child inherits

| Ticket | From this brief |
|---|---|
| MUT-255 | `ReceiptSuggestion` storage (§6.1); `billId` + one-record CHECK (D8) |
| MUT-298 | Pilot gate (D13); brief and ADR links |
| MUT-300 | §3, §12.1; owners named at enable (D4); DR5 |
| MUT-301 | §6.2, §12.1; DR6; JoFotara gated on the official guide |
| MUT-302 | §7; VAT split for posted expenses (D9); DR14 |
| MUT-303 | §6.2 vendor learning with currency and VAT |
| MUT-304 | §6.1–6.2 (shared fixtures, TS port); DR6 |
| MUT-305 | §4 (D1, D6, O7, last owner); DR2, DR8 |
| MUT-306 | §10 (D3, D10, D14); DR12 |
| MUT-307 | §5 (initialApprovalFor, totals option, decision route, O6); DR8, DR9, DR11 |
| MUT-308 | §8 (B5, D7, D8, D9); bills index; needs MUT-254 |
| MUT-309 | DR1, DR3; posted expenses read-only (D7) |
| MUT-310 | `PERIOD_CLOSED` in the outbox (DR4) |
| MUT-311 | §8.4 STAFF bills post nothing |
| MUT-312 | §9 (D2, D5, O2, O6); DR4, DR10 |
| MUT-313 | Invoice basis and split (D9); D11 wording |
| MUT-314 | D11 wording; DR13 |
