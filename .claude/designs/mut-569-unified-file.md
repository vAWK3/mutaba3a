# MUT-569: export the uniform file (מבנה אחיד 1.31) for the Tax Authority simulator

Status: **Planned 2026-11-22, waiting for Basel's approval of D1–D7.** Epic MUT-566. Blocks MUT-567 (the software registration). Blocked by MUT-568, which is merged to local main and In Review, so the issuing core is in the code. The full eng review runs at the start of `/eng-build`, as it did for MUT-568.

Tracker: Jira · barmajiyat · MUT via `atlassian-barmajiyat` · Backlog is the default · a finished ticket goes to In Review, and only Basel moves it to Done.

## Why

The Instruction 36 Appendix E registration (MUT-567) must declare the uniform-file module, version 1.31, and attach the summary report from the Tax Authority's simulator. Without an export that passes the simulator, MTB3A can't be registered, and without registration it can't get allocation numbers in production. Auditors also ask businesses for this file.

## Sources (read 2026-11-22)

- **Spec:** "הוראות להפקת קבצים במבנה אחיד" 1.31 (10.05.2009, 22 pp). Gov.il › יצרני תוכנות - הפקת קבצים במבנה אחיד; Basel's copy is `~/Downloads/IncomeTax_IncomeTaxSoftwareHousesInfo_horaot1.31_2_05.pdf`. Field tables: §3 (INI) and §4 (BKMVDATA). Document codes: appendix 1. Printed reports: §2.6 and appendix 4. Clarifications: appendix 5.
- **Simulator:** https://www.misim.gov.il/TmbakmmsmlNew/frmCheckFiles.aspx. You pick the character set, then upload INI.TXT and BKMVDATA.TXT as **two separate files**:
  - The files must be **version 1.31 only**.
  - BKMVDATA must be **4 MB or less** and hold **at least 2,000 records**.
  - The simulator returns a result file, which is attached to the registration.
- **MUT-638 comment:** the sandbox app is subscribed to `UniStructFileUploadLinks_Product` and `openapi-file-uploads-product` (uploading the uniform file through the API). This is **not in this ticket**, because registration needs only the simulator. See "Follow-ups".

## Acceptance criteria (from the ticket)

1. Fixture exports that cover every document type, with Hebrew and Arabic text, pass the simulator, and its summary report is saved for the application.
2. The record counts in INI match BKMVDATA.
3. The export of a profile with no documents is valid.
4. Scope also lists "an export for a profile and a date range, from the portal", and encoding, fixed-width fields and record counts per 1.31.

## What goes in the file

| Record | When | From |
|---|---|---|
| A000 (INI header) + one summary line per record type | always | the export |
| A100 opening, Z900 closing | always (a profile with no documents gives exactly these two, AC3) | the export |
| C100 document header | each issued document dated in the range | `IssuedDocument` |
| D110 document line | each line of a 305, 320 or 330 | `IssuedDocumentLine` |
| D120 receipt detail | each 320 and 400 (one payment each) | `IssuedDocument.paymentDetails` |
| B100/B110 journal, M100 inventory | **not produced** (D1) | — |

Documents issued elsewhere (MUT-647, ADR-267) and plain Owed/Received entries are never in the file: they aren't documents MTB3A issued.

### Field mapping (the decisions in the code; widths and positions are from the spec tables)

- **A000:**
  - 1002 is the BKMVDATA total, including A100 and Z900.
  - 1003 is the issuer's VAT id. 1004 is the export's primary id: 15 random digits, the same in 1103 and 1153 (appendix 5, note 2).
  - 1005 is `&OF1.31&`. 1006 is the registration number, from config (D3).
  - 1007 is `MTB3A`, 1008 is `ISSUING_CORE_VERSION`, and 1009/1010 are the software house (config, D3).
  - 1011 = 2 (multi-year software). 1013 = 0 (no bookkeeping module, D1). 1014 is blank.
  - 1015 is the issuer's VAT id when the dealer type is COMPANY.
  - 1018–1022 are the issuer's legal name and address from the issuer snapshot of the latest document, otherwise the current issuer details.
  - 1024/1025 are the range. 1026/1027 are when the export was produced, in Israel time.
  - 1028 = 0 (Hebrew). 1029 = 1 (ISO-8859-8-i). 1030 is `ZIP`. 1032 is `ILS`. 1034 = 0 (no branches).
- **C100:**
  - 1203 is the type code (305/320/330/400) and 1204 the number, as is (D2 plain integers).
  - 1205 is the issue date and 1206 the issue time, both Israel time. 1230 is `documentDate`.
  - 1207–1211 are the customer's name and address, from the customer snapshot (the address is one string and goes in 1208). 1215 is the customer's VAT id.
  - Amounts:

    | Field | Value |
    |---|---|
    | 1219 | subtotal (Σ line nets) |
    | 1220 | **−discount** (spec 2.4 יב, note 5) |
    | 1221 | net |
    | 1222 | VAT |
    | 1223 | gross |
    | 1224 | 0 |

  - 1225 is the customer key: the customer id's first 15 hex characters. A 400 with no customer gets key `0` and the name `לקוח מזדמן`.
  - A credit note's amounts stay positive: its meaning comes from type 330 (appendix 5, note 1).
- **D110:**
  - 1256/1257 are the original's type and number on a 330 (note 6). 1258 is 1 for SERVICE and 2 for GOODS.
  - 1260 is the description, cut to 30 characters (the PDF keeps the full text). 1263 is `יחידה`.
  - 1264 is the quantity. 1267 is the line net before the document discount, so Σ 1267 = C100 1219. 1265 is the unit price without VAT (an inclusive price is converted). 1266 is −(qty × 1265 − 1267), so every row adds up to the agora.
  - 1268 is the rate, e.g. `1800`.
- **D120:** 1306: CASH → 1, BANK → 4 (cheques and cards don't exist in `PaymentMethod` yet). 1311 is `receivedOn` and 1312 the gross amount.
- **Number formats:**
  - A signed amount is `+`/`−` followed by digits with implied decimals: 15 characters for X9(12)v99, 17 for the X9(12)v9999 quantity.
  - Numeric fields are zero-padded on the left. Alphanumeric fields are space-padded on the right; an empty one is all spaces.
  - Dates are `YYYYMMDD` and times `HHMM`.
  - Every record ends in CRLF, and each record's width is checked against the spec's lengths: 466/19 in INI; 95/444/339/222/110 in BKMVDATA.
- **INI summary lines (§3.2):** `code + count(15)` for each record type that appears in BKMVDATA, A100 and Z900 included. *If the simulator says otherwise, it wins (open item O1).*

### Encoding (D2)

ISO-8859-8 (Hebrew, logical order) holds no Arabic letters. Every text field goes through one pure `toIso8859_8` step:

- ASCII and Hebrew letters pass as they are (U+05D0–05EA → 0xE0–0xFA).
- Hebrew points are dropped. ׳ and ״ become `'` and `"`; dashes and curly quotes become their ASCII forms; NBSP becomes a space; bidi marks are dropped.
- **Arabic letters are written in Hebrew letters** by the standard mapping (ب→ב, ح→ח, ع→ע, ق→ק, …, with final forms at word end), and Arabic-Indic digits become ASCII digits.
- Anything left becomes `?`.

An auditor can still read a name like "מחמד עבד אללה". The document itself (its PDF) keeps the original script.

## Where the code goes

| File | Holds |
|---|---|
| `server/src/issuing/uniform-file/layout.ts` | the spec's record layouts as data: field number, position, width, kind. One table per record, checked by a test that sums the widths. |
| `server/src/issuing/uniform-file/format.ts` | pure field formatters (alpha, numeric, signed amount, quantity, date, time) and `toIso8859_8` with the Arabic→Hebrew table |
| `server/src/issuing/uniform-file/records.ts` | pure: documents → C100/D110/D120 rows; A000/A100/Z900; INI summary |
| `server/src/issuing/uniform-file/export.ts` | pure: `buildUniformFile({ issuer, documents, range, producedAt, primaryId, software })` returns `{ ini: Buffer, bkmv: Buffer, counts, folder, report }` |
| `server/src/issuing/uniform-file/report.ts` | the printed outputs (§2.6b documents report: count and ILS total per type; appendix 4 production summary), as a self-contained HTML in the person's language (ar/en; the labels are i18n keys in `issuing/pdf/labels`-style tables) |
| `server/src/issuing/uniform-file/zip.ts` | fflate (already a dependency): `OPENFRMT/<vat 8>.<YY>/<MMDDhhmm>/INI.TXT` + `…/BKMVDATA.zip` (holding `BKMVDATA.TXT`, §2.5d) + `report.html` |
| `repositories/ports.ts` · `prisma.ts` · `memory.ts` | `IssuingRepository.inRange(organizationId, from, to)`: documents with their lines by `documentDate`, ordered by type then number. It uses the existing `(organizationId, docType, number)` unique index plus an org/date filter, as one query with lines included. No migration. |
| `server/src/routes/issuing.ts` | `GET /v1/issuing/uniform-file?from=YYYY-MM-DD&to=YYYY-MM-DD` → `application/zip` (Content-Disposition `OPENFRMT-<vat>-<from>_<to>.zip`). Access is `issuingProfile(c, false)`, as for `/gaps` (the owner, or an accountant under a grant; Malafat, personal profiles and the flag off get 404). Scope `issuing:read`. It writes audit `issuing.uniform_file_exported` {from, to, counts}. A range that's invalid, reversed or after today is refused with 422 `VALIDATION_FAILED`/`PERIOD_RANGE`. |
| `server/src/config.ts` | `UNIFORM_FILE_SOFTWARE_REGISTRATION` (8 digits, default `00000000` until MUT-567), `SOFTWARE_HOUSE_VAT_ID`, `SOFTWARE_HOUSE_NAME` (default `Barmajiyat`). Production refuses the zero default only once `UNIFORM_FILE_REQUIRE_REGISTRATION=true` (set after MUT-567). |
| `app.ts`, OpenAPI | `API_VERSION` → `1.126.0-mut569` (+ the pinned tests); `openapi:generate`; `src/hosted/api/schema.d.ts` regenerated |
| Portal: `src/hosted/pages/invoicing/UniformFileExport.tsx` | You › Invoicing gains a "Uniform file (מבנה אחיד)" card: from/to `DateField`s (default: last tax year), Export button, a download through the same authed-blob helper the PDF download uses, a toast. Its own file, mounted with one line in `InvoicingSetupPage` (MUT-660 is building in parallel nearby). i18n ar/en. Follows DESIGN.md (card, secondary button). |
| `server/src/issuing/uniform-file/__tests__/fixture.test.ts` | the simulator fixture (below) |

Reuse:

- `roundHalfUpDiv` from `vat.ts` (VAT-inclusive unit price → net).
- `issuingProfile` and the `json`/error responses in `routes/issuing.ts`.
- fflate, as `period-pack/receipts-zip.ts` uses it.
- `IsoDate` helpers in `dates.ts`.

`formatMoney` isn't reused: the file wants integer agorot, not display.

## Decisions for Basel

- **D1: no B100/B110/M100. A000 1013 = 0 ("not relevant"); MTB3A declares the document-production module only.** *Rec.* The spec separates the modules:
  - §2.6(a): bookkeeping software prints a trial balance.
  - §2.6(b): software with a document module prints the documents report.
  - 1013 has a "not relevant" value. B100 is a journal of a bookkeeping system (single or double entry), and MTB3A keeps no journal.
  - **Question for the accountant (also MUT-567 Q2):** "Does invoicing software with no journal (MTB3A records income, payments and expenses, but no ledger accounts) have to produce B100/B110 when it registers under Appendix E, or are C100/D110/D120 enough with 1013 = 0?" If the answer is yes, a follow-up writes single-entry B100 rows from Received and Expenses with B110 accounts (customers, income, VAT, expense categories). It's about a 1-day ticket and doesn't change anything here.
- **D2: Arabic is written in Hebrew letters** in the file (above), rather than `?`. *Rec.* **Question for openformat@mh.shaam.gov.il / the accountant:** is transliteration acceptable for an Arabic-language business?
- **D3: registration fields from config.**
  - 1006 (8 digits) stays `00000000` until MUT-567 gives the number. The simulator accepts it for a registration test.
  - 1009 is Barmajiyat's Israeli company number. **Basel: which number should go there?**
  - 1010 is the name as registered, e.g. `ברמג'יאת בע"מ`. **Basel: confirm the exact name.**
- **D4: a 400 covers its payment only (C100 + D120, no D110)**, as in the spec's §4.5 example. A 320 gets D110 lines and a D120. *Rec.*
- **D5: the range is document dates, both ends inclusive, and may end at today at the latest.** No cap: a business's whole history builds in memory (about 1 KB per document). *Rec.* If a profile ever has more than 100k documents, the export becomes a streamed job; TD entry.
- **D6: where it lives:** You › Invoicing, available to the owner and to an accountant with a grant. The phone isn't in v1 (a file download is a desk task). *Rec.*
- **D7: the export is a zip** holding the OPENFRMT folder (INI.TXT + BKMVDATA.zip, per spec) and `report.html`, the printable production summary and documents report the spec requires. *Rec.* For the simulator you upload INI.TXT and the unzipped BKMVDATA.TXT.

## The simulator fixture and how Basel runs it

The simulator wants at least 2,000 records. `fixture.test.ts` builds a business on the memory store and issues, through the real routes, about **850 documents** across the past 12 months:

- 305 with one to four lines, including exempt and VAT-inclusive lines and line and document discounts
- 320 paid in cash or by bank
- 400 against a 305, and 400 with no customer
- 330 against open 305s
- customers and descriptions in Hebrew, Arabic and English

That comes to about 2,500 records and roughly 0.9 MB of BKMVDATA. The test asserts the counts and the INI = BKMVDATA match. When `UNIFORM_FILE_FIXTURE_OUT=<dir>` is set, it writes `INI.TXT`, `BKMVDATA.TXT`, the zip and `report.html` there.

```bash
UNIFORM_FILE_FIXTURE_OUT="$PWD/docs/operations/tax-authority/uniform-file/fixture" npm --prefix server exec vitest run src/issuing/uniform-file/__tests__/fixture.test.ts
```

Basel's steps, written into `docs/operations/tax-authority/uniform-file/README.md`:

1. Open https://www.misim.gov.il/TmbakmmsmlNew/frmCheckFiles.aspx.
2. In **סט תוים**, choose **Windows (ANSI) ISO-8859-8-I**.
3. In **INI.TXT**, choose `docs/operations/tax-authority/uniform-file/fixture/INI.TXT`. In **BKMVDATA.TXT**, choose `…/fixture/BKMVDATA.TXT`.
4. Press the check button and wait for the result.
5. Save the result file the simulator produces as `docs/operations/tax-authority/uniform-file/simulator-report-<YYYY-MM-DD>.<ext>`. That's the file MUT-567 attaches. If the simulator lists errors, send me the screen or the file and I'll fix and regenerate.

## Tests (TDD)

| Test | Proves |
|---|---|
| `layout.test.ts`: each record's field widths add up to the spec length (466, 19, 95, 444, 339, 222, 110), and the positions are contiguous | fixed widths |
| `format.test.ts`: amount `1234.56` → `+00000000123456`; negative; quantity `2.5` → `+0000000000025000`; alpha pad and cut; numeric pad; date and time; `toIso8859_8` for Hebrew, ״, a dash, an NBSP, an Arabic name → Hebrew letters with final forms, Arabic-Indic digits, an emoji → `?`; output is always single-byte | encoding and number rules |
| `records.test.ts`: 305 with a discount and mixed VAT lines → Σ D110 1267 = 1219, 1219 − discount = 1221, 1221 + 1222 = 1223, every D110 row qty × 1265 − 1266 = 1267; 330 carries 1256/1257 of its 305; 320 has D110 + D120; 400 only D120; 400 with no customer gets key `0`; Israel-time 1206 across DST | mapping |
| `export.test.ts`: running record numbers from 1; Z900 1155 = the line count; INI 1002 = Z900 1155; each INI summary count = the lines with that code (**AC2**); the primary id is the same in three places; empty profile → A100 + Z900, valid (**AC3**); CRLF; the folder name | AC2, AC3 |
| route test (memory store): owner gets a zip with the expected entries; accountant with a grant 200; personal profile, flag off or Malafat → 404; bad range 422; other profile's documents never included; audit row written | access and wiring |
| `inRange` port test on memory + `test:db` on Prisma: date bounds inclusive, type/number order, lines included | store |
| `fixture.test.ts`: ≥ 2,000 records, BKMVDATA < 4 MB, every type, Hebrew and Arabic present | **AC1** (the simulator pass itself is Basel's step) |
| portal: `UniformFileExport` test (range defaults, request URL, error toast) | portal |

Commands:

- Server: `npm --prefix server run typecheck`, `lint`, `openapi:check`, `test`, and `test:issuing`, all run through the heavy gate.
- Root, since the portal changes: `lint`, `typecheck`, `test:run`, `build`, on Node 22.

## QA scenarios (release-qa, `qa/features/portal/invoicing.yaml`)

1. **portal.invoicing.uniform-file-export**: the owner opens You › Invoicing, picks a range and taps Export, and a zip named `OPENFRMT-<vat>-<from>_<to>.zip` downloads. It holds `INI.TXT`, `BKMVDATA.zip` and `report.html`, and the report counts match the documents issued in the range. `tier: standard`; paths `src/hosted/pages/invoicing/UniformFileExport.tsx`, `server/src/issuing/uniform-file/**`.
2. **portal.invoicing.uniform-file-empty**: a profile with no documents exports a file with zero documents, and the report says so (A100 + Z900 only).
3. **portal.invoicing.uniform-file-range-invalid**: a "to" date before "from" is refused in place, and nothing downloads.

The specs go in `qa/specs/portal/invoicing.spec.ts`, tagged and run once until they pass.

## Cost and scale

- One query (documents with lines) per export plus string building, with no third-party calls.
- A 10k-document business is about 10 MB in memory, for a moment.
- The zip is small. No storage: the file is built on request and never kept.

## Open items checked by the simulator run

- **O1:** whether the INI summary lists A100/Z900 (spec §3.2 is ambiguous; included).
- **O2:** whether the simulator checks D110 1265 × 1264 − 1266 = 1267 to the agora (made exact).
- **O3:** the 1006 zero registration number.

## Follow-ups (not here)

- **API upload of the uniform file** (`UniStructFileUploadLinks` / `openapi-file-uploads`, MUT-638 comment). This means an upload-link request plus a PUT of the zip, once the Open API is connected. It needs the API spec from the sandbox; Basel can file it when it's wanted.
- **B100/B110 single-entry journal**, if the accountant answers D1 with yes.
- Cheques and credit cards as payment methods (D120 1306 codes 2/3 and the bank and card fields) when `PaymentMethod` grows them.
- Payment requests (MUT-662, code 300) and donation receipts (MUT-656, code 405) add their codes to the mapping when they ship.

## Business and product impact

- The last piece of code before Basel can file the Instruction 36 registration (MUT-567). Registration unlocks production allocation numbers and lets MTB3A issue invoices for other businesses, the v2 invoicing epic MUT-566.
- Every business that issues documents in MTB3A can hand its auditor the file the law requires, from the portal.
- Low risk: it's read-only, with no migration and no third-party calls. Its one real risk, a simulator rejection, is found before filing and fixed in the same ticket.
