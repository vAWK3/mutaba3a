# MUT-775: a known vendor's registration no. fills the vendor and its last category

> Built under Basel's 2026-11-27 go-ahead; defaults chosen conservatively. Server only. Not yet reviewed by Basel.

## Problem
When the server reads a receipt whose registration no. (ח.פ., עוסק מורשה, رقم المشتغل) belongs to a vendor saved on the
profile (MUT-254), the person still picks the vendor and the category by hand.

## Acceptance criteria (ticket)
1. A receipt from a vendor already on the profile opens its review with the vendor and its last category filled in, on the portal and the phone.
2. No match: the vendor and category stay as the reader left them.
3. Matching stays inside the profile; another profile's vendor never fills in.
4. Tests on the server; a release-QA flow on the portal.

## What already exists
- **Vendor name:** the reader's `withVendor` (MUT-254, `receipts/reading/reader.ts`) already looks the read registration
  no. up on the receipt's current profile (`vendors.findByRegistration(receipt.organizationId, …)`) and fills
  `suggested.vendorName = { value: canonicalName, source: 'vendor', confidence: 1 }`, only when the stored suggestion
  has no vendor name (`fillAbsent`, MUT-441 AC3). Confidence 1 is above every client's "unsure" line, so it shows as
  confident. Tests exist (`routes-receipt-reading.test.ts`, incl. a receipt moved to another profile mid-read).
- **Vendor defaults:** `GET /v1/receipts/{id}` returns `vendorDefaults` (MUT-303, ADR-239): the matched vendor's id,
  currency and VAT, worked out on every read of the receipt, never written into `suggested` (ADR-239 §3, R1).

## Decision (built)
- **D1. The category travels in `vendorDefaults`, not in `suggested`.** `ReceiptVendorDefaults` gains
  `categoryId: uuid | null`. ADR-239 §3 keeps vendor values out of what the reader read; a category id in `suggested`
  would also outlive a move to another profile (MUT-503) and point at the old profile's category, which AC3 forbids.
  Worked out per GET, it always names a category of the profile the receipt is on now, and the vendor's latest choice.
- **D2. Only a registration-no. match gives the category.** A match by exact name (MUT-303's fallback) still gives the
  currency and VAT, but `categoryId` is null: the ticket scopes the fill to the registration no., the identifier that
  does not collide. Conservative; widening it later is additive.
- **D3. Only a live category of the same profile.** `categoryId` is the vendor's `lastCategoryId` only when that
  category exists on the receipt's profile and is not archived; else null. (The automatic "Other" never becomes a
  vendor's last category, ADR-183 §4.)
- **D4. Never overwrite a correction.** The name: unchanged rule, the reader fills only an absent `vendorName`. The
  category: `vendorDefaults` is a default (ADR-239 §4): a client fills it only into an empty, untouched category.
- **D5. No migration, additive API.** API 1.150.0-mut775.

## Not built here (needs a client change: stopped at the server)
- **Portal:** `ReceiptReview.tsx` fills the currency and VAT from `vendorDefaults` (`vendorDefaultFills`,
  `useLateVendorDefaults`) but never the category. It needs `vendorDefaults.categoryId` → the category field when no
  category is chosen and the person hasn't touched it (at mount and late), with the "from receipt" hint.
- **Phone (mutaba3a-flutter):** the same in its receipt review.
- **Release-QA:** the portal flow (AC4) needs the portal fill above; no feature yaml/spec until then (a spec now would
  assert a fill the portal doesn't do).

## API contract
`ReceiptVendorDefaults = { vendorId: uuid, currency: Currency | null, vat: VendorVat | null, categoryId: uuid | null }`.
No new error states.

## Reuse / impact
`vendors/receipt-defaults.ts` (the matched vendor, now also how it matched), `schemas.ts`, `openapi.yaml`,
`src/hosted/api/schema.d.ts` (regenerated). No store change, no i18n, no cost, no infra.

## QA scenarios (for the client tickets)
1. Approve a receipt filed under Travel with registration no. X; upload another receipt from X; its review opens with
   the vendor's name and Travel filled in.
2. A receipt whose registration no. names no vendor opens with vendor and category as read (category empty).
3. The same registration no. saved as a vendor on another profile fills nothing here.

## Build decisions (portal half, 2026-11-28)

1. **`vendorDefaultFills` gains the category** (`VendorDefaults.categoryId`, `locked.category`): it fills only an empty category the person hasn't touched (D4), at mount and when `vendorDefaults` lands late (`useLateVendorDefaults`, `changed('categoryId')`). The typeahead pick in `HostedExpenseFields` does not fill a category (the ticket scopes it to the receipt's registration-no. match).
2. **The hint** "Last used for this vendor" / «آخر فئة لهذا المورّد» shows under the category while it still holds the vendor's value; a change removes it.
3. **motion-autofill** in CSS from the spec's table: a 3 px `--m-peach-strong` underline under the category select draws from inline-start (160 ms spring, fading in over 80 ms), holds 1.2 s, fades (240 ms linear), via a registered `--hp-autofill-ink` colour and `background-size`; the RTL twin anchors it right. Reduced motion: shown at once, then the same fade. Keyed on the filled category so a late fill replays it.
4. **QA**: `portal.receipts.vendor-category` (the FakeApi's read-name match stands in for the registration no.).
