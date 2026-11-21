# MUT-630 + MUT-631 plan: no wrong vendor contact details or names

Tickets: MUT-630 (Bug, High) and MUT-631 (Bug, High), both in Backlog under epic MUT-252, filed 2026-11-21 from the production check by eye (MUT-514 T9/D12). No blockers. Related: MUT-514 (bill-to rules, ADR-241), MUT-591 (vendor-made PDFs, Backlog), MUT-541 (learning from approvals, Backlog).

One plan, because both touch the same three functions (`customerRows`, `readPhone`/`readEmail`, `readVendor`) and the same rule: **an empty vendor field beats a wrong one**. A wrong one is copied onto the vendor record when the receipt is filed (`compose.ts:186`, "fill what the vendor lacks").

## Root causes (traced on the real reads, 2026-11-21, local sidecar + the current extractor)

| # | Receipt | Wrong field | Cause in code |
|---|---|---|---|
| R1 | `8285ca9d` Partner (pdf-text) | email = the buyer's own | `readEmail(rows)` ignores the buyer entirely (`fields.ts:127`). Also the bill-to block ends one row early: `מספר לקוח: 1.…` reads as a decimal amount, so `endsBlock` (`buyer.ts:31`) stops before the email row. And `CUSTOMER_BLOCK_ROWS = 5` would have cut it anyway (name, street, city, country, customer no., then the email at +6). |
| R2 | `8285ca9d` | phone = the billed line `055-…` | `readPhone` takes the first unlabelled phone anywhere (`RULE_PHONE_BARE`). Here it's row 9, a line item under the item table's header (`תיאור … סה"כ`). |
| R3 | `5e132120` Arabic clothes scan | vendor = `بنطلون رجالي` (an item) | `readVendor` scans the top 4 rows. Row 0 is the item table's header (`السعر الكمية خصم المجموع`), because the scan cut off the shop's header (MUT-539), so row 1 is an item. |
| R4 | `a9c80dc0`, `68422cb9` Paz | vendor garbled: `נפט בעמ MAN אלדור`, `בן dina קומפנ' בע"מ` | OCR put a Latin token between Hebrew words. `looksLikeName` accepts it. |

Already in place: `withVendor` (`reader.ts:130`) swaps in a saved vendor's name when the registration number matches. The Paz receipts stayed garbled only because no vendor with 511836959 is saved on that profile; the card-import vendors have no registration numbers. Once Basel files one Paz receipt under a vendor, the reader number goes onto it (`compose.ts:192`) and every later Paz read is right. So MUT-631's "known vendor first" acceptance criterion is already met by existing code, and the plan adds a test for it rather than new code.

Checked on 2026-11-21: the Partner vendor on both profiles has no phone or email stored, so nothing needs cleaning up.

## Fixes

All in `server/src/receipts/extract/`. The extractor stays pure, with no receipt text in logs.

1. **`buyer.ts`: the bill-to block holds its contact rows.**
   - `endsBlock`: a row carrying a customer-number or account label (the existing `NOT_CUSTOMER` number labels: `מספר לקוח`, `מס' לקוח`, plus `מס' חשבון`, `account no`, `رقم العميل`, `رقم الحساب` added to keywords) never counts as money.
   - A row whose only content is an email or a phone number continues the block past `CUSTOMER_BLOCK_ROWS` (contact lines don't use up the cap). The cap still bounds anything else.
   - `identifiersOn` also collects emails. `normalizeIdentifier` keeps an email as a lower-cased trimmed string and leaves the digits path unchanged.
   - `ReadIdentifiers.buyer` and `.vendor` may now hold emails. The `readIdentifiers` column is `Json?` (`schema.prisma:1464`), so there is no migration.
2. **`fields.ts`: contact details only from where the vendor prints them.**
   - `readEmail(rows, buyer)`: never from a bill-to row, never an email in `buyer`.
   - `readPhone`: an **unlabelled** phone is taken only from the header area, the rows above the first item-table header or money row (the same `endsBlock` signals, exported as `startsBody(row)`). A labelled phone (`טל'`, `phone`, `هاتف`) is still read anywhere (footers print `טלפון:` with a label), unless it's the buyer's.
   - `readVendor`: stops at the first item-table header or money row (R3). It still scans at most `VENDOR_ROWS`.
   - `looksLikeName`: a row that is mostly Hebrew or Arabic with a Latin run **between** two RTL words is garbled OCR, so not a name (R4). A Latin run at either end (`סופר-פארם Super-Pharm`, `Partner פרטנר`) is still fine. One helper, `hasEmbeddedLatin(row)`, in `normalize.ts`, next to `RTL_LETTER` and `LATIN_LETTER`.
3. **`extract.ts`:** pass `buyer` to `readEmail`. `vendorIdentifiersOf` also returns the vendor email, so a misfired block can't hide a vendor's email on later receipts (the R9 guard, kept symmetric). Bump the reader version (`serverReaderVersion`, to `-5`), so `receipts:reread --reader-below 5` can redo the To-review receipts after release.

No change to `reader.ts`, the store, the API or the UI.

## Decisions taken in the plan (empty beats wrong; Basel can veto)

- **P1:** an email in a bill-to block is learned like buyer phone and ID numbers, and never offered on any later receipt. A vendor-read email (on any receipt) is never learned, as with numbers today.
- **P2:** unlabelled phones only from the header area. A vendor that prints its phone unlabelled in a footer loses that suggestion (empty, not wrong).
- **P3:** a garbled name is dropped, not repaired. Rebuilding word order from OCR fragments would be a guess.

## Tests (TDD: red first)

- `__tests__/buyer.test.ts`:
  - The block survives a `מספר לקוח: 1.…` row and holds a following email row.
  - The cap still ends a long block.
  - `normalizeIdentifier` on emails (case, spaces).
  - `learnedBuyerIds` drops an email some read took as the vendor's.
- `__tests__/extract.test.ts`, a new describe "MUT-630/631" with synthetic rows only:
  - A PDF-text Partner-shaped bill gives no email, no phone, total 59.90.
  - The billed-line phone under a table header isn't the vendor's phone.
  - A labelled footer phone is still read.
  - A table header as row 0 gives no vendor.
  - `נפט בעמ MAN אלדור` gives no vendor.
  - `Partner פרטנר` still gives a vendor.
  - A buyer email passed in gives no email.
- `reader` test (memory store): a saved vendor with the read registration number gives its name with `source: 'vendor'`. This pins the existing behaviour.
- **Bench:** add `8285ca9d`, `5e132120`, `a9c80dc0`, `68422cb9` with truth read by eye to `receipt-bench`, never committed (Basel's OK per TD-293). Then `run.py --compare` against main: 0 fields lost, and confidently wrong vendor, phone and email go down. The phone and email truth from MUT-591 item 5 is needed first; add those two fields for these receipts.
- Commands, through heavy:
  - `heavy --light -l "MUT-630 tests" -- npx vitest run src/receipts --maxWorkers=3`
  - the bench on port 8197
  - before landing: `npm --prefix server run typecheck && lint && openapi:check && test`

## Acceptance criteria → proof

- **MUT-630 AC1** (`8285ca9d` gives no email or phone, total stays): bench row and unit row.
- **MUT-630 AC2/AC3** (block email, billed-line phone, learned email): `buyer.test.ts` and extract rows.
- **MUT-630 AC4** (`--compare` loses 0): bench gate.
- **MUT-630 AC5** (no text in logs): no new log lines.
- **MUT-631 AC1** (three receipts give the right name or none): bench rows.
- **MUT-631 AC2** (known vendor by registration number): the reader test pins `withVendor`.
- **MUT-631 AC3** (unit rows): extract rows.
- **MUT-631 AC4** (vendor hits don't drop): bench `--compare`.

## Release and after

- Server only. It ships in the next `api-v*`. The orchestrator handles the merge; no migration.
- After rollout: `receipts:reread -- --reader-below 5` (dry run first) re-reads the To-review receipts, then a quick look at the next reads.
- Docs:
  - CHANGELOG, TEST_PLAN;
  - ADR-241 gets an addendum, since it is the bill-to decision record;
  - TD-293 notes the bench additions.

## Out of scope

- Vendor-made PDF issuer names and the two-column registration row (MUT-591).
- Learning from approvals (MUT-541).
- Missed totals (MUT-632).
- Unsupported currencies (MUT-633).

## Business / product impact

- Your own email and phone line stop appearing as a vendor's on every monthly bill, and junk vendor names stop being suggested. Either one gets copied onto the vendor record when a receipt is filed.
- This is the last bar from the production check before receipt reading can be switched on for anyone beyond the pilot (MUT-252).
- Low risk: extractor-only, empty-beats-wrong, gated by `--compare`, no schema or API change, and it rolls back with the API.

---

## Review revisions (independent review, 2026-11-21; these replace the matching parts above)

I checked the key claims in code: `fields.ts:169` `continue`; `reader.ts:75` `SERVER_READER_GENERATION = 4`; `PHONE` includes `נייד` and `mobile`; `CUSTOMER` includes `العميل`.

1. **A garbled name ends the vendor search (not `continue`).** `readVendor` checks `hasEmbeddedLatin(row)` itself and returns `null`, like the address rule. Otherwise row 1 or 2 (a branch name, a slogan) wins. Test: a garbled row 0 with a plausible row 1 gives no vendor.
2. **Emails are never unlearned by a vendor read.** Emails stay out of `vendorIdentifiers` (`extract.ts` `vendorIdentifiersOf`). An e-receipt that prints the buyer's email without a label would otherwise remove the learned email. A vendor email hidden this way is empty, not wrong.
3. **One rule for phones, labelled or not: never from the item body.** A phone on a row with a decimal amount, or between the item-table header and the total row, is never the vendor's. This catches "מנוי נייד 055-… 59.90" even though `נייד` is a phone label. Header and footer phones (labelled or not) stay as today, so P2 is dropped. The existing footer-phone tests and the `--compare` gate stay as they are: 0 fields lost.
4. **One primitive.** `startsBody(row)` = a money row (customer-number rows exempt) or an item-table header. `endsBlock(row)` = `startsBody(row) || TOTAL || DATE_LABEL`. No second copy. The header area for `readVendor` ends at `startsBody`, not at a date label (header dates often share a row with the phone).
5. **Contact-row extension is bounded and never learned.** At most 2 contiguous contact rows after the cap (email, phone, or a labelled `דוא"ל:`/`טל:` row). They exclude on this receipt only and are never added to `ownIdentifiers`. Emails learned into `ownIdentifiers` come only from rows inside the normal block.
6. **Customer-number labels get their own set.** `CUSTOMER_NUMBER` (`מספר לקוח`, `מס' לקוח`, `מס' חשבון`, `account no`, `رقم العميل`, `رقم الحساب`) is used only by `startsBody` (its rows are never money) and `readPhone` (those rows are never the vendor's phone, and their numbers join this receipt's buyer identifiers). It is not added to `NOT_CUSTOMER`, so `العميل` blocks still work.
7. **`hasEmbeddedLatin` is narrow.** A row counts as garbled only when a Latin run sits between two RTL words **and** that run is lowercase or at most 3 letters (`MAN`, `dina`, `Aya`). "Super-Pharm בע"מ" and "שופרסל Deal רמת גן" stay names. Use non-global regexes or `countMatches`, so no `lastIndex` state carries between calls.
8. **Reader version:** bump `SERVER_READER_GENERATION` to 5 in `reader.ts:75` and its comment. Update the hard-coded `-4` in `reader-buyer-memory.test.ts:61`, `routes-receipt-reading.test.ts:158` and `receipts-reread.test.ts:112-118`.
9. **`EMAIL` lives in `buyer.ts`** next to `PHONE_NUMBER`, and `fields.ts` imports it. This avoids a circular import that would throw at load.
10. **`normalizeIdentifier`** routes by `includes('@')` before stripping digits. Update the comment at `ports.ts:3863` ("digits only"). The plan notes that a rollback turns stored emails into digit fragments: harmless, since they never match a phone.
11. **Existing vendor records** (proposed, needs Basel's OK): filing a receipt copies the reader's phone and email onto the vendor when it has none, and never overwrites. So the buyer's contact may sit on other vendors besides Partner, which was checked clean. `receipts:reread` gains a dry-run report: vendors on reading-granted profiles whose phone or email equals a learned buyer identifier, and To-review receipts whose stored email or phone is one. Nothing is cleared without `--apply` and Basel's OK.

The R9 guard stays as it is for numbers. AC4 of both tickets stays "0 fields lost".

## Approval
Basel approved the plan on 2026-11-21, **including item 11** (the dry-run report of vendors and To-review receipts carrying the buyer's phone or email; clearing still needs `--apply` and his OK). Decisions P1 and P3 stand. P2 is replaced by revision 3.

---

## Build notes (2026-11-21, during /eng-build)

Found on the real rows (Partner PDF `8285ca9d`, local sidecar on :8197, current extractor):

1. **The cap, not the customer number, cut the first bill-to block.** `מספר לקוח: 1.…` does not read as money on this receipt (the eight-digit run is not an amount), so the block ran label + 5 rows and the email was row +6. The contact-row extension (revision 5) is what catches it. The customer-number exemption in `startsBody` is still built and tested (a shorter customer number such as `1.261` does read as money).
2. **Contact rows past the cap exclude by value on this receipt.** The bill prints the same email again, outside any block (a second address panel whose block a date label ends early). Excluding only the row would let that copy through, so the contact rows' identifiers join this receipt's `buyer.identifiers` (never `ownIdentifiers`, never learned), and `readEmail`/`readPhone` skip them anywhere on the receipt.
3. **Customer-number numbers are not added to the buyer identifiers.** `readPhone` skips a customer-number row outright; adding its numbers receipt-wide could hide a vendor's registration printed on the same joined row. Narrower than revision 6's "join this receipt's buyer identifiers", same effect on the phone.
4. **Item 11 is report-only:** `receipts:reread --buyer-contacts` lists vendors (on profiles a `receipt_reading` holder belongs to) and To-review receipts (latest 200) whose phone or email is a learned buyer identifier, by id and field name. `--apply` with it is refused. To-review receipts are cleared by the existing `--reader-below 5 --apply` re-read; a listed vendor's detail is changed only with Basel's OK. Run the report after that re-read, since emails are learned only by generation-5 reads.
5. `organizationBuyerIds` (reader.ts) is the one place the learned identifiers are computed; the read job and the report share it.

Bench (rescore over the saved reads, main's extractor vs the branch's, 78 real receipts incl. `prod-8285ca9d.pdf`): 0 fields lost; confidently wrong vendor 8 → 5, phone 10 → 7, email 6 → 3. All four production receipts now give no vendor, phone or email, totals unchanged.
