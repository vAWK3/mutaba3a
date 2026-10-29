# MUT-504 plan: fix what real Hebrew receipts showed

2026-10-29. Ticket: MUT-504 (Story, epic MUT-252). Builds on MUT-441 (ADR-220). Blocks MUT-505. No blockers.

## Diagnosis (16 real scans in `~/Work/Barmajiyat/Mutaba3a/receipt-bench/`, evidence kept there)

| Miss | Root cause, found by running each engine alone |
|---|---|
| Till receipts read empty (מחסני מזון ×3, MAX, פז) | **Merge, not OCR.** RapidOCR reads the digits right (`61.83` ×4, `11/12/2025`, `547.80`, at 0.99). On a Hebrew page `merge.py` keeps Tesseract's line whenever Tesseract saw the line at all, and drops RapidOCR's digits. Tesseract garbles bold and large digits, and loses the bold `לתשלום` label. |
| Fields under the threshold even when read | A row's confidence is the **lowest of its segments**, so one junk box on the line (0.2) sinks a date read at 0.99. |
| Kvish 6 date = card expiry 2029 | An unlabelled date on a cleaner row (0.91) outscores the labelled `תאריך הפקת החשבונית` (0.64). Date ranges (`20/05/26-19/07/26`, the billing period) are read as dates too. |
| Kvish 6 total = 63.60 or 11.45 | OCR reads `מע"מ` as `מצ"מ`, so the VAT and pre-VAT lines look like totals. The bold `סה"כ כולל מע"מ` line is lost. Subtotal + VAT (63.60 + 11.45 = 75.05) would give it, but `סה"כ סכומים ב-18%` isn't known as a subtotal. |
| Kvish 6 vendor = a 60-character run of mixed text | Two columns merged into one row; the vendor rule truncates long rows instead of refusing them. |
| Adobe text layer garbled (a, b) | Both scans' text is **invisible text (render mode 3) over a full-page image**: Adobe's own OCR. Its Hebrew comes out as Latin junk. A real digital PDF (`syn-039`) has visible text (mode 0). |
| `17-פבר-26` not read | Hebrew month abbreviations and a two-digit year after a month name aren't parsed. |

A prototype of the merge fix alone (scratch, not in the repo) fixed one Kvish total; the till receipts also need the segment-level confidence (E1) and the repeated-amount rule (E3).

## Changes

### Sidecar (`server/ocr/app/`)
- **S1 `decode.py`:** when most of a page's text objects are invisible (`FPDFTextObj_GetTextRenderMode == 3`), the text layer is another reader's OCR. Ignore it and rasterise, as for an image PDF. Visible text layers are unchanged.
- **S2 `engines.py` + `merge.py`:** `TesseractReader.read` keeps each line's words (`Segment.words`, optional). On a **Hebrew page**, for each Tesseract line that overlaps RapidOCR **number-only** segments that are more confident than Tesseract's own digit words, keep Tesseract's letter words as one segment (their mean confidence) and RapidOCR's number segments beside it, on the same row. Otherwise nothing changes. Arabic and Latin pages keep today's merge.
  - Build note: the splice runs only when RapidOCR is sure of its digits (mean ≥ 0.85, `SURE_DIGITS`) and Tesseract is not; a sure Tesseract line is kept as before.

### Extractor (`server/src/receipts/extract/`)
- **E1 segment confidence (`rows.ts`, `types.ts`, readers):**
  - `Row` keeps its parts (`{ text, conf }[]`).
  - A field's confidence is the confidence of the part that carries its value. For a labelled rule it is the lower of the value's part and the label's part.
  - `row.conf` stays as the fallback, and is the only value for PDF text rows (1).
  - New helper: `confOf(row, needle)`.
- **E2 dates (`dates.ts`, `keywords.ts`):**
  - A date range (`d–d`) is a period, never the receipt's date.
  - A row with validity wording is skipped: `תוקף`, `בתוקף עד`, `valid`, `exp`, `صالح`, `انتهاء`.
  - A labelled date that passes the threshold wins over any unlabelled one.
  - When no labelled date passes and the unlabelled dates disagree (two or more distinct days), the date is left **empty** (bills and statements list many dates).
  - Hebrew month abbreviations (`ינו`, `פבר`, …, with an optional geresh) are read, and so is a 2-digit year after a month name (`17-פבר-26`).
- **E3 money (`total.ts`, `keywords.ts`, `normalize.ts`):**
  - `foldForMatch` maps the OCR misread `מצ"מ` to `מע"מ`. It applies to that token only; `בע"מ` is untouched.
  - SUBTOTAL gains `סה"כ סכומים` and `סכומים ב`. TOTAL gains `סכום עסקה`, `סכום חיוב` and `סה"כ לחיוב`.
  - New last-resort rule, used only when no labelled total and no arithmetic gave one: **the largest decimal amount printed on at least 3 rows** is the total (rule 0.7). A till receipt repeats it on the to-pay line, the card line and the card slip.
- **E4 vendor (`fields.ts`):** a top row longer than `VENDOR_MAX_LENGTH` is not a name. It is refused, not truncated.

### Bench (`server/ocr/bench/run.py`)
- `--real-detail` writes a per-receipt, per-field comparison into the real folder (`real-detail.json`), never into `out/`, for iterating locally. Aggregates stay as today.

## Tests (written first)
- **Vitest, `extract.test.ts`:** a new `REAL_PATTERNS` block of synthetic rows that reproduce each pattern, with no real receipt text:
  - a junk box on a date row;
  - a Kvish-style bill (labelled issue date and card-validity date, a billing range, `מצ"מ`, subtotal + VAT with no total line);
  - a till receipt whose to-pay label is lost and whose total is printed three times;
  - two disagreeing unlabelled dates;
  - `17-פבר-26`;
  - a 70-character first row.
- Each test checks the right value **or** absence; none fills a wrong value.
- **Pytest `test_units.py`:**
  - S2 merge with hand-built Hebrew segments: RapidOCR digits replace Tesseract's garbled ones, letters are kept, and Arabic and Latin pages are unchanged.
  - S1 with a minimal hand-written PDF that uses `3 Tr` invisible text over an image, which must be rasterised, and the same with `0 Tr`, which keeps its text layer.
- **Commands:**
  - `npm --prefix server test -- src/receipts/extract`
  - `server/ocr/.venv/bin/python -m pytest server/ocr/tests -q`
  - The full server checks: typecheck, lint, `openapi:check` (no contract change expected) and test.
- **Bench**, through `heavy`, on port 8197:
  - synthetic: no regression, wrong-and-confident 0 (AC3);
  - real: wrong-and-confident 0 (AC1), Hebrew amount and date at least 6/10 (AC2);
  - warm p95 under 5 s (AC5).

## Expected effect (from the diagnosis; the bench decides)
- Hebrew amounts: from 2/10 to about 7–8/10 (p01, p11, p13 and a by arithmetic, p03/p04/p05/p09 by E1+E3). p07 (a hand-held photo) and p14 are uncertain.
- Hebrew dates: from 2/11 to about 6–7/11.
- The wrong values from today (expiry date, pre-VAT total, garbled vendor, Adobe text) become right or empty.
- **Risk:** AC2's 6/10 is close for dates. If the bench lands at 5, I report it and don't loosen any rule to hit the number.

## Scope and constraints
- No API contract or schema change, no migration, no UI, no i18n.
- Reading stays dark (the `SERVER_OCR` switch), so nothing changes in production until MUT-487 and the pilot.
- No LLM or third-party OCR (MUT-252). No real receipt text in the repo (MUT-441 privacy rule).
- Release-QA: the existing `portal-selfservice.receipts.server-reading` flow covers this path; no new user-visible flow.
- Cost: S2 adds no OCR pass; S1 OCRs scans that used to take the text-layer shortcut, about 1 s each.
- Knowledge files:
  - ADR-228: an invisible text layer is another reader's OCR, so read the image; on Hebrew pages, digits come from RapidOCR.
  - CHANGELOG, TEST_PLAN.
  - TD-293: real-bench truth is one person's eye-read, 16 receipts.

## Build
- Fresh worktree `feature/mut-504-real-receipt-fixes`, one per ticket.
- Order: E1 → E2 → E3 → E4 (each red, then green) → S2 → S1 → bench.
- Then `/qa-reconcile MUT-504`.

Business / product impact
- Turning reading on for anyone in Israel is only safe after this: today it fills wrong dates and totals on the most common Hebrew documents (fuel, supermarket, Kvish 6).
- It is the step before MUT-487 and the pilot in the MUT-252 epic, and MUT-505 (statements) builds on its date and text-layer rules.
- It costs no extra infrastructure and nothing changes in production, since reading stays dark until the pilot grant.

## Build notes (2026-10-29)
The first bench after the plan's changes left Hebrew amounts at 3/10 and two wrong values. Each further fix below was measured on the real set, written test-first, and is needed for AC1 or AC2. None widens scope.
- **B1:** two complete amounts side by side are never joined (`61.8361.83`).
- **B2:** the Hebrew splice works word by word, not line by line. The line-level version dropped a synthetic Hebrew date whose line RapidOCR read only in part.
- **B3:** the vote counts each value once. A total printed four times out-voted the arithmetic for its own difference with the VAT, which was wrong and confident.
- **B4:** a new rule, "sum of two": the largest amount that two printed amounts add up to, when it is printed twice or one of the two is the labelled subtotal. The repeated-largest rule counts readings, not rows.
- **B5:** the VAT on a row OCR joined with the total is the smaller amount.
- **B6:** total-labelled rows with three different amounts mean a statement, with no single total. This is a stopgap until MUT-505.
- **B7:** a document that prints a billing period takes only a labelled date.
- **B8:** total rules run strictest first, and the first sure one wins.
- **B9:** `חייב במע"מ` is a subtotal label.

Result: Hebrew amounts 7/10, dates 6/11, AC1 fields 0 wrong.
