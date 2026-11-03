# MUT-514 plan: no confidently wrong fields (bill-to, totals, VAT, dates)

Ticket: MUT-514 (Bug, Backlog, Medium, epic MUT-252). No blockers: it relates to MUT-504 (merged 2d4dc3e7) and MUT-540.
Extractor unchanged since MUT-504, so the ticket's bench numbers still hold (amount 26/46, date 29/47, 18 wrong-and-confident
on the new 32 scans). Production adds 3 Paz receipts (comment 13107). Copy this file to
`.claude/designs/mut-514-confident-wrong.md` on the build branch.

## What is actually wrong (traced through the OCR lines, not guessed)

| # | Scan | Field | Got → want | Real cause (from the OCR lines) |
|---|---|---|---|---|
| V1 | prod Paz ×3 | VAT | 149.47 → 26.90 | OCR reads thermal "לפני" as **"לפנ'"** and glues the amount on (`סה"כ לפנ' מע"מ149.47`); SUBTOTAL never matches, so the row is a VAT row and `firstAmount` takes it. The real VAT row is next, also misread (26.98, 38.51). |
| V2 | p30 | VAT | 334.75 → 60.25 | `Total to VAT` (the pre-VAT amount) is not a SUBTOTAL keyword. |
| V3 | p32 | VAT | 123.60 → 18.85 | `NIS123.60 (VAT)` is the total printed on a VAT-labelled row. |
| V4 | p01 | VAT | 49.87 → 40.87 | One OCR digit. The total − subtotal gives the right figure. |
| T1 | p33 | total | 4050 → 1239 | The total row's amount is misread (`1050`→`4050`; 1239 is "יתרה"/balance, = 1050 × 1.18). The labelled total is unconfirmed while 1239 is confirmed by 1050 + 18%. |
| T2 | p07 | total | 40 → 70 | Cash 100 / change −30 block; the 40 comes from a pairwise rule. To be pinned down with a unit replica. |
| T3 | p11 | total | 41 → 312 | A tip/split line (41.00 printed 3×) beats the 312.00 card total. |
| B1 | p02, p22, p23, p33, p36 | phone | 0547979595 → vendor's | **The buyer's** (Basel's) mobile in a bill-to block: `טל' לקוח`, `לכבוד …`, `السيد/ة …`, `באסל סאדר … Mobile`. |
| B2 | p24, p33 | reg. no. | 205437932 → vendor's | The buyer's ע.מ. (`לכבוד … ע.מ.: 205437932`; p24 has a bare `ח.פ: 205437932` while the vendor's label is garbled). |
| D1 | p17 | date | 2020-07-29 → 2026-07-29 | OCR year misread. |
| D2 | p06 | date | 2026-03-01 → 2026-03-11 | `!1-03-2026`: "1" read as "!", the "!" dropped. |
| D3 | p31 | date | 2026-08-13 → 2026-09-13 | One OCR digit (09 → 08) on a clean labelled line. |
| O1 | p02 | vendor | an address → the shop | `זבוטינסקי 22 רמת גן` (street + number + city) read as the name. |
| O2 | p21 | phone | Authorized Dealer # → none | "Authorized Dealer" is the English for עוסק מורשה: a registration label. |
| O3 | p35 | phone | 05-7313020 → 03-5614277 | Both are the vendor's own numbers (region lines). Truth question, not an extractor bug (D-Q3). |

Accepted under TD-294 (stay): Kvish 6 sister-company ח.פ (a, p11) and the Jordan government header (p10).

## Fixes, by file

All in `server/src/receipts/extract/` unless named; the extractor stays pure (no I/O, nothing logged).

1. **`keywords.ts`**
   - SUBTOTAL: OCR-tolerant "before VAT" (`לפנ' מע"מ`, `לפנ׳ מע"מ`, `לפנ’ מע"מ`, and the same for `ללא`), `total to vat`, `amount before vat`, `net amount`, `المبلغ قبل الضريبة`.
   - New `TIP` (`תשר`, `טיפ`, `service charge`, `tip`, `gratuity`, `بقشيش`, `خدمة`) and `INSTALLMENT` (`תשלומים`, `תשלום ראשון`, `installment`, `قسط`).
   - New `CUSTOMER` (`לכבוד`, `לקוח`, `שם לקוח`, `מספר לקוח`, `עבור`, `ת.ז`, `bill to`, `billed to`, `customer`, `sold to`, `to:`, `السيد`, `السيدة`, `السيد/ة`, `السادة`, `العميل`, `الزبون`, `رقم الهوية`).
   - REGISTRATION: `authorized dealer`, `dealer no`.
   - New `STREET` (`רח'`, `רחוב`, `שד'`, `شارع`, `street`, `st.`, `road`, `rd.`) for the address check.
2. **`total.ts`**
   - VAT plausibility (AC3): a VAT reading is dropped when it is ≥ the total or > total × `MAX_VAT_SHARE` (0.2). This catches V1 on its own (149.47 > 35.27), V2 and V3.
   - VAT from the arithmetic: when a confident total and a labelled subtotal exist and `total − subtotal` is a plausible VAT (≤ 0.2 × total, and equal to the printed rate within rounding when a rate is printed), that is the VAT (`RULE_VAT_DERIVED`, about 0.9). A read VAT that disagrees with it is dropped. This fixes V1's misread second row and V4.
   - `firstAmount` for VAT: skip rows that fail the plausibility check and go on to the next VAT row (V1 falls through to `מע"מ להוצ רכב`).
   - Totals: rows with TIP, INSTALLMENT, CASH or CHANGE never give a candidate, and their amounts don't vote in `votedTotal` or `sumOfTwo` (T2, T3).
   - A labelled total that the arithmetic doesn't confirm loses to a different printed amount that the guided arithmetic does confirm (subtotal + VAT, or subtotal × printed rate). With no confirmed alternative it stays as it is today (T1).
3. **`fields.ts`**: a bill-to block.
   - `customerRows(rows)`: a row carrying a CUSTOMER keyword, plus the rows under it until the next vendor-field label, a money row, a table header or `CUSTOMER_BLOCK_ROWS` (5).
   - Every phone-shaped and registration-shaped number on those rows goes into a `buyer` set. `readPhone`, `readRegistration` and `readVendor` skip customer rows and never return a number in `buyer`, wherever on the receipt it appears again (p02 prints the same mobile on `טלפון:` and on `טל' לקוח`).
   - `readVendor` also skips an address row: a STREET keyword, or `<words> <1–4 digits> <words>` with no company form (O1).
4. **`dates.ts`**
   - When `receivedOn` is given, a date outside [receivedOn − `MAX_RECEIPT_AGE_DAYS` (730), receivedOn + 1] is left out (D1). The window is a constant.
   - A date whose first digit touches a glyph OCR uses for 1 (`!`, `|`, `l`, `I`) is left out (D2).
5. **`extract.ts`**: `extractReceipt(input, { readerVersion, receivedOn?, buyerIds? })`. Both new options are optional, so existing callers and tests don't change. `buyerIds` is seeded into the `buyer` set (D-Q1).
6. **`server/src/receipts/reading/reader.ts`**: pass the receipt's `receivedOn` (and `buyerIds` if D-Q1 = B). Bump `readerVersion` from `server-ocr-rapid-tess-1` to `-2`, so later accuracy numbers (MUT-541) can tell the versions apart.
7. **Bench**: `src/scripts/receipt-bench-extract.ts` takes `receivedOn` (and `buyerIds`) per read. `ocr/bench/run.py` passes the scan date from the manifest (a new `receivedOn` field, filled in for all 48 + the 3 production Paz scans). The 3 production Paz receipts join `receipt-bench/` as `prod-2026-10-*`, with truth read by eye and never committed.

## Decisions for Basel

- **D-Q1, the buyer's own numbers.** Labels alone leave p22 and p24 wrong: the buyer block there has no label OCR kept. Recommendation: **B**.
  - **A:** labels and the bill-to block only. This misses AC1's secondary bar by about 2 (p22 phone, p24 reg).
  - **B (recommended):** also learn the buyer's numbers per organization. A phone or registration no. that the reader has suggested on receipts from **3 or more different vendors** (by registration no. or name) in the same organization is the buyer's, and goes into `buyerIds`. The reader asks the store for it once per read, bounded to the organization's last 200 read receipts (one indexed query on `expense_receipts (organizationId, createdAt)`, reading only the `suggested` phone and registrationNo). Basel's 0547979595 and 205437932 qualify on the bench at once. In production this starts empty and fills as he scans. It overlaps MUT-541's vendor memory but needs no approvals.
- **D-Q2, p31 (one OCR digit on a clean, labelled Arabic date).** The extractor can't tell 08 from 09. Recommendation: **A**.
  - **A (recommended):** accept it as an OCR limit, as TD-294 does, and amend AC1 to "0, except OCR digit misreads the receipt's own arithmetic can't check (listed)".
  - **B:** never fill an Arabic date under line confidence 0.9. That would cost several Arabic dates read right today.
- **D-Q3, p35.** Both numbers are the vendor's own. Recommendation: correct `manifest.json` to accept either; this also starts on TD-293 (Basel's check of the manifest).
- **D-Q4, the 6 To-review receipts already read wrong in production.** Merges only fill absent fields, so they keep the wrong VAT. Recommendation: **A**.
  - **A (recommended):** a one-off operator CLI, `npm --prefix server run receipts:reread -- --reader-below 2 [--apply]`. It re-extracts unapproved To-review receipts read by an older reader and replaces `suggested` (never `approved`). It is dry-run by default and audited, like the other operator CLIs.
  - **B:** leave them; Basel fixes the 6 by hand.

## Tests (TDD: write first, red, then green)

`server/src/receipts/extract/__tests__/extract.test.ts`, a new `describe('MUT-514: no confidently wrong fields')`. These are synthetic rows built with `receipt()`, with no real receipt text (AC5). One case per row of the table above:
- `לפנ' מע"מ` with the amount glued on is the subtotal, and VAT is total − subtotal even when the VAT row is misread (V1, V4).
- `Total to VAT` is the subtotal (V2). The total on a `(VAT)` row is not the VAT (V3). VAT > 20% of the total is never filled.
- A tip line, an installment line, and cash 100 / change 30 / total 70 each give 70, never the tip, part or difference (T2, T3).
- A misread labelled total loses to a balance the arithmetic confirms (T1).
- `לכבוד … ע.מ.: X`, `טל' לקוח: Y`, `السيد/ة … ` followed by a bare mobile, and a number repeated outside the block: never the vendor's (B1, B2). `buyerIds` given: never filled.
- With `receivedOn` 2026-10-29, a date of 2020-07-29 is left out and a date of 2025-12-01 is kept. `!1-03-2026` is left out (D1, D2).
- A street-and-number line is never the vendor (O1). `Authorized Dealer #: <number>` is not a phone (O2).
- The existing extract and merge tests stay green (regression). If D-Q4 = A: a CLI test over the in-memory store (replaces old-reader suggestions, keeps `approved`, skips filed and approved ones, dry-run writes nothing).
- If D-Q1 = B: the store method gets a test against the Postgres `test:db` suite, plus an in-memory fake.

Commands (Node 22; heavy jobs through `heavy`):
```
heavy -l "MUT-514 extract tests" -- npx vitest run src/receipts --maxWorkers=3          # in server/
heavy -l "MUT-514 bench" -- server/ocr/.venv/bin/python server/ocr/bench/run.py --label mut514 --port 8197
npm --prefix server run typecheck && npm --prefix server run lint && npm --prefix server run openapi:check && npm --prefix server test
```
Check in with the orchestrator before the bench (port 8090 is Malafat's emulator, so use 8197).

## Acceptance criteria → proof

- **AC1:** a bench run (48 + 3 production Paz scans) shows 0 wrong-and-confident amounts, dates and currencies (except D-Q2's listed misread), and at most the 3 TD-294 wrong-and-confident secondary fields.
- **AC2:** the B1/B2 unit cases, plus 0 bill-to fields on the bench.
- **AC3:** the T2/T3/V1–V3 unit cases. `MAX_VAT_SHARE` is enforced in `readMoney`.
- **AC4:** the bench's amount stays ≥ 26/46 and date ≥ 29/47. The synthetic set keeps wrong-and-confident at 0 and warm p95 under 5 s (the change is extractor-only, so p95 doesn't move).
- **AC5:** the new describe block.
- Pre-landing review: two subagents, one specialist and one adversarial (MUT-504's lesson). Probe discounts, cash tendered, split card slips, tips, a credit note, and an invoice addressed to a firm.

## Quality bar

- **DRY:** new keyword sets live in `keywords.ts`, and the bill-to block is one function used by the three field readers. No new module unless `fields.ts` passes about 200 lines, in which case `buyer.ts`.
- **Cost:** pure CPU per read. D-Q1 = B adds one bounded query per read (indexed, at most 200 rows, two JSON fields). There's no new service and no new spend.
- **Scalability:** the buyer set is computed per read, not stored, so there's no migration. If reads grow, cache it per organization for 10 minutes in the reader.
- **Constraints:**
  - No LLM and no third-party service (MUT-252, ADR-220).
  - Fill-absent merges are untouched.
  - No receipt text in logs (`OcrReadError`).
  - No API, OpenAPI, schema or UI change. If D-Q4 = A, only a new script in `package.json`.
  - Money stays in minor units with its currency.
- **Release-QA:** server-only. Re-record `portal-selfservice.receipts.server-reading` (MUT-504 left it unrecorded) and confirm `paths` cover `src/receipts/extract/**`; `release-qa lint` must be clean.
- **Knowledge files:**
  - an ADR for the buyer rule and VAT-from-arithmetic;
  - TD-294 kept, TD-293 updated after D-Q3;
  - CHANGELOG and TEST_PLAN updated;
  - `before-release.md` gets the re-read step if D-Q4 = A, and its stale "MUT-441 off" item is corrected (reading is live for the pilot).

## Out of scope

- Cropped scans (MUT-539).
- Sideways photos, small PDF images and the clean-image *misses* (MUT-540).
- Vendor memory and accuracy telemetry (MUT-541).
- QR reading (MUT-490).
- Statements (MUT-505).

## Business / product impact

- Every Israeli fuel and till receipt shows its VAT correctly, instead of offering the pre-VAT amount as VAT, and Basel's own phone and ID stop appearing as the vendor's. Those are the two errors a pilot user sees on almost every receipt, and they erode trust in "Reading…".
- It is the precondition for widening the `receipt_reading` grant beyond Basel (MUT-252), and for MUT-302's VAT reports being worth anything on read receipts.
- Low risk: extractor-only, pure, bench-gated, no schema change. It can be rolled back with the API (`make rollback-server`).

---

# Eng review (plan-eng-review, 2026-11-02)

Target: this plan file (`~/.gstack/projects/vAWK3-mutaba3a/mut-514-plan.md`), as written above. The original plan text above this line is unchanged.

## Scope record
feature answers: D1 = Include buyer memory in MUT-514; D2 = Include the re-read command; structure: D3 = B, the smaller arrangement (reuse `expenseReceipts.list`, pure `extract/buyer.ts`); accepted scope: the plan above with D-Q1 = B and D-Q4 = A, the buyer set derived in `extract/buyer.ts` from `expenseReceipts.list(orgId, {}, {limit: 200})` instead of a new store query; pending remedies: none after D4–D7 (see the ledger). D3 is reopened by D6 for one additive column only.
Scope Challenge result: scope accepted as-is (the smaller arrangement keeps the scope).

## Scope Challenge findings
1. [CRITICAL] (confidence: 9/10) server/src/repositories/ports.ts:3231 `suggested: ReceiptSuggestion | null`: OCR lines are never stored, so the plan's CLI cannot "re-extract" receipts; a re-read must run OCR again. (R1)
2. [CRITICAL] (confidence: 8/10) plan "VAT from the arithmetic": total − subtotal also includes service charges, tips and deposits, so an unguarded derivation creates new wrong-and-confident VATs under 20%. (R2)
3. [CRITICAL] (confidence: 8/10) plan D-Q1 B "3 or more different vendors (by registration no. or name)": a chain's head-office number (Paz 511836959, printed by every station under different station names) matches the rule, so the correct registration number would be emptied on every Paz receipt. (R3)
4. [INFORMATIONAL] (confidence: 8/10) the bench must compute `buyerIds` only from receipts earlier in scan order; using all 51 overstates AC1. (R4: required proof of D1, accepted with D1, no question)
5. [INFORMATIONAL] (confidence: 7/10) ticket AC1 "wrong-and-confident is 0 for … date": p31's 09→08 is one OCR digit on a clean labelled line, and no extractor rule can see it. (R5)
6. [INFORMATIONAL] (confidence: 7/10) receipt-bench manifest.json, p35: both phones are the vendor's own. (R6)
7. [INFORMATIONAL] (confidence: 9/10) plan "one indexed query on expense_receipts (organizationId, createdAt)": no such index exists (schema.prisma:50,52). This is moot after D3: `list` is org-scoped and organizations have hundreds of rows, not thousands.

## Decision ledger

### R1: How the re-read command re-reads
Finding: 1, CRITICAL, 9/10, server/src/repositories/ports.ts:3231, native reviewer
Plan baseline: D2 approved "re-extract unapproved To-review receipts read by an older readerVersion, replace `suggested`" (D2 answer)
Runtime evidence: suggestions hold fields only; `markBacklogPending` (prisma.ts:2361) re-queues receipts with `readStatus NONE` and an incomplete suggestion; `backlog()` (reader.ts:212) enqueues them
State: approved
Actual answer: D4 = A "Re-queue (Recommended)"
Accepted scope: new store method resetForReread(scope, readerBelow) in ports/prisma/memory: a guarded UPDATE setting suggested=null and readStatus=NONE where filingStatus=TO_REVIEW, approved IS NULL and readerVersion is older; then the existing markBacklogPending + enqueue path re-reads. Dry run lists ids; --apply writes and audits. The CLI never calls OCR itself.

### R2: Guard on VAT derived from total − subtotal
Finding: 2, CRITICAL, 8/10, plan Fixes §2, native reviewer
Plan baseline: derive the VAT when it is ≤ 0.2 × total (original proposal)
Runtime evidence: none yet (proposed code)
State: approved
Actual answer: D5 = A "Rate must match (Recommended)"
Accepted scope: derive VAT = total − subtotal only when it equals subtotal × (the printed rate, or a known rate for the currency: ILS 17%/18%, JOD and PS 16%, SAR 15%, AED 5%, GBP 20%) within 1 minor unit; a read VAT that disagrees is dropped. Constants in total.ts.

### R3: What makes a number the buyer's
Finding: 3, CRITICAL, 8/10, plan D-Q1, native reviewer
Plan baseline: D1 approved the buyer memory; its rule was "3+ different vendors by registration no. or name" (original proposal)
Runtime evidence: bench Paz receipts share 511836959 under different station names (receipt-bench reads.json)
State: approved
Actual answer: D6 = A "Labelled blocks (Recommended)"
Accepted scope: the extractor also returns the phone and ID numbers it found in labelled customer blocks; the reader saves them in a new nullable `buyerIdentifiers String[]` on expense_receipts (additive migration, never in the API); the buyer set is the union over the organization's last 200 receipts via expenseReceipts.list; buyer.ts stays pure. Reopens D3 only for the column: no new query. Merging the migration needs the orchestrator warning (:8787 restart).

### R4: Bench buyer set without look-ahead
Finding: 4, INFORMATIONAL, 8/10, native reviewer
State: approved
Actual answer: required proof of D1 (no separate question)
Accepted scope: run.py and the bench script compute `buyerIds` per receipt from the receipts before it in scan order

### R5: p31 under AC1
Finding: 5, INFORMATIONAL, 7/10, ticket AC1, native reviewer
Plan baseline: D-Q2 A (accept as an OCR limit, amend AC1)
State: approved
Actual answer: D7 = C "Measure, then pick (Recommended)" (first D7 answer asked for an explanation, then re-asked)
Accepted scope: the build runs the bench with and without a 0.9 OCR-confidence floor on Arabic-script dates; it keeps the floor only if it empties no date that is correct today (real + synthetic), otherwise it amends AC1 to "0, except OCR digit misreads no rule on the receipt can check (listed: p31)" under TD-294; the result is recorded on the ticket.

### R6: p35 truth
Finding: 6, INFORMATIONAL, 7/10, manifest.json, native reviewer
Plan baseline: D-Q3 (accept either vendor phone)
State: approved
Actual answer: factual correction (no question): the OCR line "טל אזור המרכז: 05-7313020" is the vendor's own regional phone
Accepted scope: manifest.json p35 accepts either vendor phone (05-7313020 or 03-5614277); noted under TD-293.

### R7: Regression contract for the total and VAT rule changes
Finding: Section 3 IRON RULE, CRITICAL, 9/10, server/src/receipts/extract/total.ts:137 (votedTotal) and :101 (labelledTotal), native reviewer
Plan baseline: AC4 aggregate floor (amount ≥ 26/46, date ≥ 29/47)
Runtime evidence: main re-scored on 2026-11-02, 265/265 fields equal to real-detail.json
State: approved
Actual answer: D8 = A "Per-field contract (Recommended)"
Accepted scope: a build gate that diffs every field between main and the branch over the real 48 + the 3 production Paz receipts + the synthetic fixtures. Every hit on main stays a hit, and every other change is listed (receipt, field, before, after, why) in the build notes, plus an extract.test.ts row where it encodes a rule. The bench script gains `--compare <main-out>`.

## Review sections

### 1. Architecture: no new choices
The data flow, design-twice and red flags are as presented in the session. Two pieces are required implementation of D3 and D6:
- `customerRows` lives only in `buyer.ts`, and both learning and skipping call it.
- Identifier normalization lives only in `buyer.ts`.

Production failure: the migration runs before the API rolls out. The column is additive and nullable, so an older API ignores it. A `list` failure gives `store_failed` and a retry, the same as a `finishRead` outage.

### 2. Code quality: no issues found
The glyph guard covers `!`, `l` and `I` touching a day digit, and never `|`. That is required proof of the plan's date fix.

### 3. Test review

```
CODE PATHS (server/src/receipts/extract, reader)                 USER FLOWS
[+] keywords.ts SUBTOTAL/TIP/INSTALLMENT/CUSTOMER/STREET           [+] Pilot scans a Paz receipt → To review
  └── [GAP] variants לפנ'/לפנ׳/לפנ’, "total to vat"                  ├── [GAP] VAT shows 26.90, not 149.47 (prod replica)
[+] total.ts readMoney                                              └── [GAP] reread CLI then corrects old suggestion
  ├── VAT plausibility ≤0.2·total ........ [GAP] V1 V2 V3          [+] Invoice addressed to the firm
  ├── derived VAT, rate must match ........ [GAP] V1 V4 + service-charge bill stays empty   ├── [GAP] vendor phone ≠ buyer mobile
  ├── firstAmount skips implausible VAT row [GAP]                    └── [GAP] buyer ID learned on receipt 1, caught on receipt 2
  ├── TIP/INSTALLMENT/CASH never candidates [GAP] T2 T3
  ├── confirmed alternative beats unconfirmed labelled total [GAP] T1
  └── existing clusters .................. [★★★ TESTED] extract.test.ts:150+ (regression via R7 diff)
[+] buyer.ts customerRows / normalize / union
  ├── label row + block until money/table/5 rows [GAP]
  ├── number repeated outside block excluded      [GAP]
  └── buyerIds seeded: never filled               [GAP]
[+] fields.ts readVendor address row (O1), Authorized Dealer (O2) [GAP]
[+] dates.ts receivedOn window (2020 out, 2025-12 in), glyph guard (!1-03 out, |11/03 kept) [GAP]
[+] extract.ts options optional → existing callers unchanged ..... [★★ TESTED] merge.test.ts
[+] reader.ts passes receivedOn + buyerIds; saves buyerIdentifiers; readerVersion -2 [GAP] reader test (memory store)
[+] store resetForReread guarded UPDATE (approved null, TO_REVIEW, older reader) [GAP] memory + test:db [→E2E none]
[+] scripts receipts:reread dry-run/apply/audit                    [GAP]
[+] bench --compare per-field diff + no look-ahead buyerIds (R4/R7) [GAP] (tooling; proven by running it)

COVERAGE (proposed): 0/19 new paths tested today | existing clusters ★★★ via R7 diff
```

Proposed tests. Each is a row in an existing table where one fits; no new framework.
- `extract.test.ts`, describe "MUT-514: no confidently wrong fields": V1–V4, T1–T3, B1/B2, D1/D2, O1/O2 rows, plus a service-charge bill whose VAT stays empty (R2). Value: protects=no confidently wrong VAT/total/date/buyer field; fails_when=a rule is removed or loosened; why_new=no row covers these OCR shapes; seam=none; no_claim=real OCR variance (synthetic rows).
- `buyer.test.ts`: customerRows boundaries, normalize (spaces, dashes, 8-digit pad), union across receipts, a chain number outside any block never learned (R3). Value: protects=chains keep their reg. no.; fails_when=learning keys off frequency; why_new=new module; seam=none; no_claim=per-profile learning in prod.
- reader test (memory store): buyerIdentifiers saved, buyerIds passed, receivedOn passed, readerVersion -2. Value: protects=reader wiring; fails_when=an option is dropped; why_new=reader tests don't pass options; seam=none; no_claim=Cloud Tasks.
- `resetForReread`: memory-store test plus a `test:db` row. It resets only TO_REVIEW receipts with approved null and an older reader, and never filed or approved ones. Value: protects=approved data is never touched; fails_when=the guard is dropped; why_new=new write; seam=none; no_claim=prod row counts.
- CLI test: a dry run writes nothing; --apply audits and enqueues. Value: protects=dry-run default; fails_when=apply becomes the default; why_new=new script; seam=none; no_claim=live DB.
- The R7 gate (bench `--compare`): every main hit stays a hit. Tests made obsolete: none.

### 4. Performance: no issues found
`list(org, {}, {limit: 200})` runs once per background read. Measured scale: the largest of Basel's profiles has about 60 receipts, so this is at most 200 rows of JSON, under about 1 MB. Reads run at most 3 at a time (the `receipt-reads` queue). It is not on a user request path, and no cache is needed.

## Outside Voice (native fallback, 2026-11-02)
Codex is not installed; an independent Claude subagent challenged the plan and the code. 11 findings: 1 Critical, 4 High,
3 Medium, 3 Low. Checked against the code before any question: 1 (`total.ts:162` `guidedTotal`, `:277` `vatConfirmed`),
2 (`dates.ts:128`) and 8 (`fields.ts:97`) hold.

### R8: VAT and total must not confirm each other
Finding: OV-1, CRITICAL. Once C1/SUBTOTAL finds the Paz "before VAT" row, `guidedTotal` = subtotal + a misread VAT row
(176.45 for 176.37) is filled, and `vatConfirmed` then marks that same VAT confirmed (0.92). Both wrong and confident.
Includes OV-6 (agorot rounding, עיגול): the T1 alternative must itself be labelled.
State: approved. Actual answer: D9 = "Independent check only (Recommended)".
Accepted scope: a VAT is filled only when confirmed by something independent of it: the printed rate matches
(`vat ≈ rate × subtotal` within 1 minor unit, R2's currency table) or it equals a printed, labelled total minus a labelled
subtotal. `guidedTotal`'s subtotal + VAT path fills a total only under the same rate check, else it stays empty.
`vatConfirmed` may not use a total whose rule is `RULE_SUBTOTAL_PLUS_VAT`. T1's confirmed alternative must be a labelled
amount (`יתרה`, `לתשלום`, a TOTAL row), and a labelled total within rounding (≤ 50 agorot / 0.5 unit) of subtotal × rate
counts as confirmed, so rounding never flips it. Evaluation order fixed in `readMoney`: parts → plausibility on raw
amounts (`vat < total candidate` is checked against every labelled total candidate, not the final total) → total → VAT.

### R9: buyer memory guard
Finding: OV-3 (High) + OV-8 (Medium). One misfired block (`העתק לקוח`, `Customer copy`, `מספר לקוח` near the header)
learns a vendor's own ח.פ/phone and hides it on every receipt from that vendor forever; the block end rule contradicted B1.
State: approved. Actual answer: D10 = "Guard + tighter labels (Recommended)".
Accepted scope: `buyer.ts` never learns, and the reader never applies, a number that any receipt in the organization's
last 200 shows as the vendor's outside a customer block (the extractor returns `vendorIdentifiers` alongside
`buyerIdentifiers`; the union subtracts them). `העתק לקוח`, `customer copy`, `מספר לקוח`, `מס' לקוח` are not block
labels. The block ends at a money row, a table header, a TOTAL/DATE label or 5 rows, never at the buyer's own phone label.
`readVendor` returns null on an address row instead of moving on, like the >60-character rule.

### R10: re-read command
Finding: OV-4, High. `resetForReread` would null the whole `suggested`, including fields only the phone sent (QR,
on-device), for 6 receipts on one account.
State: approved. Actual answer: D11 = "Drop it, fix 6 by hand (Recommended)" (supersedes D2/D4; R1 withdrawn).
Accepted scope: no store method, CLI, audit or before-release step. The 6 already-read pilot receipts are corrected by
hand at review. `readerVersion` still moves to `-2` so later numbers can tell versions apart.

### R11: untuned check for AC1
Finding: OV-5, High. Every rule is tuned on the 48 + 3 receipts AC1 is scored on.
State: approved. Actual answer: D12 = "Next 15 prod reads (Recommended)".
Accepted scope: after the API release, the next ~15 production reads are scored by eye (fields only, in the session, no
receipt text committed) before `receipt_reading` is granted to anyone else; 0 wrong-and-confident amount/date/currency
there too, else a follow-up ticket. Recorded on MUT-514 as its last AC check.

### Corrections folded in (required proof, no question)
- OV-2: the receivedOn window and the glyph guard mark candidates excluded but keep them in the "dates differ → none"
  test (`readDate`), so a bill with older dates still reads as a bill. A test row covers it.
- OV-7: INSTALLMENT matches only a count above 1 or a labelled part (`תשלום ראשון`, `תשלום נוסף`, `X מתוך Y`), never
  `מס' תשלומים: 1`; CASH's `paid`/`שולם` keep their current meaning and are not added to the never-total set; a row that
  carries both a card-slip label and an excluded word stays a candidate. T2 is traced to its exact rule from the reads
  before its fix is written (build note).
- OV-9: R2's rate table: ILS 17/18 (Israel) and 16 (Palestinian receipts, same currency, printed rate only); "PS" is not a
  currency and is removed. A 16% ILS VAT is derived only when the receipt prints 16%.
- OV-10: D6 adds one additive nullable column and migration; the plan body's "no schema change / no migration" lines
  read as superseded by D6. The merge needs the orchestrator's :8787 warning.
- OV-11: `buyerIdentifiers` stores digits only, is never in the API or logs, is deleted with the receipt, and the buyer
  set is applied only on the expense-receipt reading path (never on MUT-506 issued invoices, where the organization is the
  vendor). Privacy policy wording unchanged: the numbers are already on the stored receipt image.

### R10 amended (2026-11-03): the re-read command is back
Basel, in session "PM intake picture/amount accuracy": "Keep the fixed command" — supersedes D11 ("Drop it, fix 6 by
hand"). The fixed design avoids R1's and OV-4's traps:
- `resetForReread` is one guarded UPDATE (READY, live, To review, unapproved, not PENDING, at the read version). It
  drops only the fields the server read (`ocr`, `pdf-text`), keeps QR and vendor-list fields, and restarts the read
  state (PENDING now, readAttempts 0, readFirstClaimedAt null, no lease), so the 30-minute give-up clock of the first
  read can't FAIL it 'exhausted'. The 5-minute sweep reads it: no dispatcher in the CLI.
- `npm --prefix server run receipts:reread -- --reader-below 2 [--apply]`: dry run by default (ids, field names and
  sources, no values); `--apply` audits `expense_receipt.reread_requested` (ADMIN). Only uploaders who still hold
  `receipt_reading`. Candidates are receipts whose `readerVersion` is still `server-ocr-*-N`, N < below: merge.ts
  hands the version to whichever writer added a field last, so one a client filled after the read is not picked.
- `SERVER_READER_GENERATION` is one constant for the stamp and the CLI. before-release.md: run it only after the -2
  API is fully rolled out.

Approval readiness: PASS (R1 withdrawn by D11; R2 D5; R3 D6 + D10; R4 required proof of D1; R5 D7; R6 factual; R7 D8;
R8 D9; R9 D10; R10 D11; R11 D12).

## TODOS.md updates
No TODOs proposed: every deferral already has a ticket (MUT-539, MUT-540, MUT-541, MUT-490, MUT-505).

## NOT in scope
- Re-reading receipts already read in production: 6 receipts, fixed by hand (D11).
- Cropped scans (MUT-539); sideways photos, small PDF images, clean-image misses (MUT-540).
- Vendor memory scoring and accuracy telemetry from approvals (MUT-541): the buyer set here learns from reads, not approvals.
- QR reading (MUT-490); multi-month statements (MUT-505); issued invoices (MUT-506).

## What already exists
- Keyword lists and whole-word matching (`keywords.ts`), the `VAT_MISREAD` fold (`normalize.ts:42`): extended, not rebuilt.
- `readMoney`'s first-sure ladder (`total.ts:265`) and the binding/disagree rule (ADR-229): kept; R8 tightens two rungs.
- `expenseReceipts.list` for the organization's recent receipts (D3): reused, no new query.
- The bench (`server/ocr/bench/run.py`, `receipt-bench-extract.ts`): extended with `receivedOn`, prior-only buyer ids (R4)
  and `--compare` (R7).
- `extract.test.ts` fixture builder `receipt()` and its table rows: new rows only.

## Diagram
```
OCR rows ─▶ normalize/fold (לפנ' → לפני) ─▶ partsOf: subtotal, VAT rows, cash, change, tip/instalment flags
                                              │
                    ┌─────────────────────────┴──────────────┐
                    ▼                                         ▼
     labelled total candidates                     VAT candidates (≤ 0.2 × any labelled total)
                    │                                         │
                    ▼                                         ▼
   readMoney ladder: labelled → guided (rate-checked) → voted/sumOfTwo/repeated (no tip/instalment/cash/change amounts)
                    │
                    ▼
     VAT kept only if rate matches or = labelled total − labelled subtotal (never via a guided total)
OCR rows ─▶ customerRows (buyer.ts) ─▶ buyer set = block numbers ∪ org's learned (minus seen-as-vendor) ─▶ phone/reg/vendor skip
OCR rows ─▶ readDate: candidates (window/glyph flags kept for the disagreement test) ─▶ date or none
```

## Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| VAT derivation | rate table missing a market's rate → VAT empty | R2/R8 rows, OV-9 | empty VAT field (safe) |
| guided total | subtotal + misread VAT filled as total | R8 test row (Paz without total) | empty total (safe) |
| buyer set | vendor's number learned as buyer's | R9 guard + buyer.test chain/copy rows | empty vendor phone/reg (safe) |
| buyer set load | `list` fails during a read | existing `store_failed` retry (R1 §1) | "Reading…" then retry |
| date window | `receivedOn` missing on an old record | option optional: no window applied | as today |
| migration | runs before API rollout | additive nullable column | nothing |
Critical gaps (no test, no handling, silent): 0.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity (one module, `server/src/receipts/extract`, plus the reader
and one column).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.
- [ ] **T1 (P1, human: ~3h / CC: ~20min)** — extract — Keywords and fold: SUBTOTAL variants, TIP, narrowed INSTALLMENT,
  CUSTOMER (minus copy labels), STREET, `authorized dealer`; `לפנ'` fold
  - Surfaced by: plan Fixes §1, OV-7, R9. Files: `keywords.ts`, `normalize.ts`. Verify: extract tests V1/V2/T3/O2 rows.
- [ ] **T2 (P1, human: ~4h / CC: ~30min)** — extract — VAT plausibility and independent confirmation; guided total rate
  check; labelled T1 alternative with rounding tolerance
  - Surfaced by: R2, R8 (OV-1, OV-6). Files: `total.ts`, `confidence.ts`. Verify: V1–V4, T1, Paz-without-total,
    service-charge rows.
- [ ] **T3 (P1, human: ~2h / CC: ~15min)** — extract — tip/instalment/cash/change never total candidates or votes; trace T2
  - Surfaced by: plan §2, OV-7. Files: `total.ts`. Verify: T2/T3 rows; card slip with `מס' תשלומים: 1` keeps its total.
- [ ] **T4 (P1, human: ~4h / CC: ~30min)** — extract — `buyer.ts` customer block, normalisation, union minus vendor-seen;
  `fields.ts` skips; `readVendor` returns null on an address
  - Surfaced by: R3, R9, OV-8. Files: `buyer.ts` (new), `fields.ts`. Verify: `buyer.test.ts`, B1/B2/O1 rows.
- [ ] **T5 (P1, human: ~2h / CC: ~15min)** — extract — `receivedOn` window and glyph guard kept in the disagreement test
  - Surfaced by: plan §4, OV-2. Files: `dates.ts`, `extract.ts`. Verify: D1/D2 rows + bill-with-old-dates row.
- [ ] **T6 (P1, human: ~3h / CC: ~25min)** — server — `buyerIdentifiers`/`vendorIdentifiers` column + migration; reader
  passes `receivedOn`, buyer ids, saves identifiers, `readerVersion -2`
  - Surfaced by: R3/D6, R9, OV-10, OV-11. Files: `schema.prisma`, migration, `ports.ts`, prisma/memory stores,
    `reading/reader.ts`. Verify: reader memory-store test, `test:db`.
- [ ] **T7 (P1, human: ~2h / CC: ~15min)** — bench — `receivedOn` in manifest, prior-only buyer ids, `--compare`, Paz
  prod scans; real table in `summary.md`
  - Surfaced by: R4, R7. Files: `run.py`, `receipt-bench-extract.ts`. Verify: bench run vs main, every main hit kept.
- [ ] **T8 (P2, human: ~1h / CC: ~10min)** — docs — ADR (VAT confirmation, buyer rule, date window), TD-293/294,
  CHANGELOG, TEST_PLAN; manifest p35 (R6)
  - Surfaced by: R5, R6, plan Quality bar. Verify: review.
- [ ] **T9 (P2, after release)** — ops — score the next ~15 production reads before granting reading to anyone else
  - Surfaced by: R11. Verify: result comment on MUT-514.
JSONL artifact not written: this branch's prior eng-review list belongs to MUT-402 (2026-10-23), not this ticket.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted, 0 unverified premises
- Architecture Review: 0 issues found
- Code Quality Review: 0 issues found
- Test Review: diagram produced, 19 gaps identified
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Claude subagent (native fallback; Codex not installed), completed, 11 findings, 4 decisions (D9–D12)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 12/12 = answers picking the complete option / answers scored

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Claude subagent (Codex not installed) | Independent 2nd opinion | 1 | completed (native fallback) | 11 findings, 4 decisions |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 19 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** plan-review phase, native Claude subagent fallback, completed; no external provider coverage.
- **VERDICT:** ENG reviewed with all decisions answered (D1–D12); "issues open" are the 19 test gaps mapped to T1–T9. Ready to implement with `/eng-build MUT-514`.

NO UNRESOLVED DECISIONS
