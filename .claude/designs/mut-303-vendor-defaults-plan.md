# MUT-303: a known vendor prefills currency and VAT rate (plan, revised after review)

**Ticket:** MUT-303, a Story in Backlog with label `firm-v2`, under epic MUT-298 (Firm books).
**Blockers:** MUT-299 Done, MUT-254 Done, MUT-302 In Review (live in api-v0.14.0 and phone 0.1.17).
**Inherits:** the firm-books brief §6.2 and §12, ADR-099, and MUT-302's VAT contract (ADR-231).
**Repos:** mini-crm (server, portal, local mode, QA) and mutaba3a-flutter (the phone). Planned, not built.

---

## 1. What the ticket asks

| AC | Proven by |
|---|---|
| AC1 After two approved receipts from the same registration no., the third prefills currency and VAT rate | Server: `GET /v1/receipts/{id}` returns `vendorDefaults` for a receipt whose read registration no. or name names a saved vendor. Portal and phone review tests. QA `portal.receipts.vendor-defaults` |
| AC2 A value changed on approve becomes the vendor's new default | A route test: approve with EUR + 16 %, then the vendor reads EUR + 16 % |
| AC3 Profile isolation: one profile's vendor never prefills another's | A route test with two profiles and the same registration no. (vendors are per organization; the test pins it) |
| AC4 Release-QA on web and phone | `portal.expenses.vendor-defaults`, `portal.receipts.vendor-defaults`, `ios.capture.vendor-defaults` |

Out of scope (ticket): a vendor management page and vendor merge.

## 2. What exists (reuse)

- **The learned category:** `Vendor.lastCategoryId` and `vendors.touch(org, vendorId, { categoryId }, at)` (prisma.ts:2220, memory.ts:2631), called by `touchExpenseVendor` (compose.ts:201).
  - The callers are POST /v1/expenses (:196), PATCH when the vendor or category is sent (:239), receipt approve (receipts.ts:306), inbox filing and the MCP write tool. These are the only write paths.
  - The lock order is categories, then vendors, so it can't deadlock with a profile type change.
- **Using it at a pick:** the typeahead's `VendorSuggestion.lastCategoryId` (schemas.ts:3429), applied in the portal's `HostedExpenseFields` `onPick` (:72) and the phone's `vendor_picker_sheet.dart` and `receipt_review_sheet.dart:504` (empty fields only).
- **Matching a read receipt to a vendor:** `vendors.findByRegistration` (ports.ts:2898), already used by the reader's `withVendor`.

## 3. Design (revised)

```
expense write (create / PATCH / approve / filing / MCP)
   └─ touchExpenseVendor(expense, change) ──▶ vendors.touch(org, vendorId, change, at)
        change = { categoryId, currency?, vat?: {treatment, rate} | 'clear-if' }

prefill A, a picked vendor (typeahead; create and review only)
   GET /v1/vendors?q=  ──▶ VendorSuggestion { …, lastCategoryId, lastCurrency, lastVat }

prefill B, a receipt under review (any reader, or none)
   GET /v1/receipts/{id} ──▶ { …, vendorDefaults: { vendorId, currency, vat } | null }
        computed at read time from suggested.registrationNo (then exact name); never stored in `suggested`
```

**The fill rule, the same everywhere (R4–R6):** a vendor default fills a field only when that field is **empty and was neither read nor edited**. Currency fills only while the amount is empty. VAT fills only on a firm profile. A vendor-filled field is marked `vendor`, so a late receipt reading may replace it. A read or typed value is never replaced. Prefill runs on **create and review only**; the edit drawer and the phone's edit sheet never prefill (R4).

### 3.1 Data (Prisma migration `…_mut303_vendor_defaults`)
```prisma
model Vendor {
  ...
  /// MUT-303: the currency of the last new expense saved with this vendor.
  lastCurrency           String?       @db.VarChar(3)
  /// MUT-303: the VAT of the last expense with this vendor that carried VAT (both set or both null).
  lastVatTreatment       VatTreatment?
  lastVatRateBasisPoints Int?
}
```
- CHECK `vendors_last_vat_both_or_none`. Local snapshot (next free number) gets `addVendorDefaults` (nulls). Records-export columns. No index.
- **Seeding (D5):** the migration runs one `UPDATE … FROM (DISTINCT ON vendorId, latest live expense)` that sets `lastCurrency`, limited to `SUPPORTED_CURRENCIES`. There is no operator step and no VAT seed; MUT-302 data is days old.

### 3.2 `vendors.touch`
- **Currency (D2):** set from the expense on create, approve, filing and MCP. On PATCH, only when the currency actually changed (R8). Fixing a typo on an old expense doesn't reset the default.
- **VAT (D1):** set when the expense carries VAT, on create, or on PATCH when `vat` changed. A save without VAT leaves the default.
  - Clearing happens only when PATCH sends `vat: null` on an expense that had VAT, and only if the vendor's stored default still equals the VAT removed (a `WHERE` in the same `updateMany`, R7).
  - Removing VAT from an old expense therefore never wipes a newer default.
- `touchExpenseVendor(store, expense, change)` takes the change from the route, which knows `body` and `existing`.

### 3.3 API (`1.96.0-mut303`, or the next free minor; additive)
- **D3: flat fields beside `lastCategoryId`:** `VendorSuggestion.lastCurrency: Currency | null`, `lastVat: { treatment, rateBasisPoints } | null`. This overrides brief §12's `vendor.defaults`.
- `ExpenseReceipt` (library item and review read) gains `vendorDefaults: { vendorId, currency, vat } | null`.
  - It is resolved at GET time by the read registration no. (`findByRegistration`), else by an exact name key.
  - It is null when nothing matches. VAT is null unless the profile is a firm (R10).
  - One indexed lookup per receipt opened; the library list leaves it out.
- **D4 (dropped):** `ReceiptSuggestion.vatTreatment` isn't added. Defaults never go into `suggested`, so the reader's merge, the completeness check and the read-once cost are untouched (R1–R3).

### 3.4 Portal
- `HostedExpenseFields` gets a `prefillDefaults` prop: on in the create drawer and Receipt Review, off in the edit drawer (R4).
- `onPick` and the review's `vendorDefaults` both go through one pure `applyVendorDefaults(values, readFields, touched, defaults, { firm })` in `src/hosted/lib/vendorDefaults.ts`. It returns the fields it filled, so they can carry a "From this vendor's last expense" hint, and a late reading may still replace them.
- i18n ar + en: `hosted.expenses.hints.fromVendor`.

### 3.5 Phone
- `vendors_repository.dart` and `receipts_library_repository.dart` parse `lastCurrency`, `lastVat` and `vendorDefaults`, with a tolerant treatment parse (MUT-302).
- One pure `applyVendorDefaults` in `lib/domain/services/vendor_defaults.dart`, used by:
  - the receipt review sheet (pick and `vendorDefaults`, with a `ReviewMark.vendor` that `lateFill` may replace);
  - capture's Details vendor pick, where currency fills only while the amount is empty (R6), and VAT only on a firm.
- The edit sheet (`expense_form_sheet.dart`) doesn't prefill. No drift change.

## 4. Tests (written first)
- **Server:**
  - touch: currency on create, and only on a changed currency on PATCH; VAT kept on a no-VAT save; the guarded clear; concurrency of two writes.
  - The CHECK, in `test:db`.
  - Isolation (AC3).
  - The typeahead fields.
  - `vendorDefaults`: matched by registration, matched by name, none, non-firm without VAT, after a MUT-503 move it uses the current profile.
  - The migration seed over existing rows (supported currencies only).
  - OpenAPI.
- **Local mode:** the migration step, fingerprint and parity.
- **Portal:** `applyVendorDefaults` as a table. Rows cover empty versus read versus edited; currency with and without a typed amount; firm versus non-firm; a late reading replacing a vendor fill. Plus the drawer: the edit drawer never prefills.
- **Phone:** the same table in Dart, parse with unknown treatments, the review sheet, and the capture pick.

## 5. Release-QA
| Feature | Steps | Expect |
|---|---|---|
| `portal.expenses.vendor-defaults` | On a firm, save an expense from X in EUR at 16 %; open Add expense, pick X before typing an amount | Currency EUR and VAT 16 %, with the hint |
| `portal.receipts.vendor-defaults` | Review a receipt read with X's registration no. but no currency or VAT | Currency and VAT come from X; a receipt that read ILS keeps ILS |
| `ios.capture.vendor-defaults` | On QA Fixture (firm), capture, pick X in Details before the amount | Currency and VAT fill from X |

## 6. Build order and release
1. mini-crm, on `feature/mut-303-vendor-defaults`: server, local mode, portal, QA.
2. Flutter, on its own branch after the API lands.
3. api-v* before a phone build that reads `vendorDefaults`. The fields are additive and the phone tolerates them missing, so it is safe either way.

## 7. Decisions (Basel, 2026-11-02: all accepted as written)
- **D1:** a save without VAT keeps the vendor's VAT default; only an explicit removal clears it, and only if it still matches.
- **D2:** currency is learned from new expenses and from a changed currency, not from every edit.
- **D3:** flat `lastCurrency` and `lastVat` beside `lastCategoryId` (overrides brief §12).
- **D5:** seed `lastCurrency` in the migration; no VAT seed.
- **D6 (new):** receipt review gets `vendorDefaults` at read time, never written into the reader's suggestion.

---

# Eng review (2026-11-02)

The outside voice ran as an independent Plan agent, since Codex isn't installed. It recommended "revise before building". Every finding was folded in, and none needs a new choice beyond §7:

| # | Sev | Finding (verified) | Disposition |
|---|---|---|---|
| R1 | P0 | Vendor currency written into `suggested` re-scales a total read without a currency (`amounts.ts:29` defaults to 2 digits), and `MONEY_GROUP` (merge.ts:13) then locks out later readings | Path B replaced by GET-time `vendorDefaults` (D6) |
| R2 | P1 | `withVendor` skips when a name was already read or reading is off, so AC1 rarely holds in production | Gone with R1: lookup at GET time works with no reader |
| R3 | P1 | `vatTreatment` would be dropped by `fillAbsent`, or would make every receipt incomplete (OCR cost) | D4 dropped |
| R4 | P1 | The edit drawer shares `onPick`; after `reset()` nothing is dirty, so a pick would overwrite saved VAT and a disabled currency | `prefillDefaults` on create and review only |
| R5 | P1 | "Untouched" is not "not read": a pick would overwrite a read currency or VAT, and block a late reading | The fill rule: empty, unread and unedited only; a `vendor` mark a late reading replaces |
| R6 | P1 | A vendor currency after a typed amount re-reads or truncates it | Currency fills only while the amount is empty |
| R7 | P1 | touch only sees the saved row, so D1 can't tell "cleared" from "never had" | The route passes the change; a guarded clear |
| R8 | P2 | Every portal edit sends `vendor`, so the default would follow old edits | Currency and VAT are learned on PATCH only when changed |
| R9 | P2 | The backfill takes VAT from the wrong row, has unsupported currencies, and the operator step races clears | Currency-only seed in the migration, supported currencies; no VAT seed |
| R10 | P2 | Path B would put VAT on non-firm suggestions | `vendorDefaults.vat` null off-firm |
| R11 | P2 | Phones on 0.1.17 would show vendor values as "read from receipt" | Gone with R1 |

Verified clean: the write paths, the lock order and isolation.

## Business / product impact
- A firm's repeat vendors (rent, telecom, the accountant) come back in the right currency and VAT. That is two fewer fields per expense on the loop the pilot will judge.
- It works with server reading switched off, because the match comes from the registration no. or name.
- It closes the last v2 item that builds on MUT-302 before the pilot gate (D13).
- Low risk: three nullable vendor columns, prefill only, and what was read or typed always wins.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| Eng review | /eng-ticket MUT-303 | plan before build | 1 | DONE | 11 (1 P0, 6 P1, 4 P2), all folded in |
| Outside voice | default-on | independent challenge | 1 (native Plan agent) | DONE | Recommendation: revise; revised |
| Design review | not run | prefill only; reuses the MUT-254/302 hint pattern | 0 | — | — |

- **VERDICT:** APPROVED. Ready for /eng-build.
- **MODE:** scope accepted as-is; the design changed (path B → GET-time `vendorDefaults`).
- **OUTSIDE COVERAGE / CROSS-MODEL:** a native Plan agent of the same model family. Codex isn't installed.
- **Decisions:** D1, D2, D3, D5 and D6 were approved by Basel on 2026-11-02. D4 was dropped.

**UNRESOLVED DECISIONS:**
NO UNRESOLVED DECISIONS
