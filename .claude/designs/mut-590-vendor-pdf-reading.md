# MUT-590 plan: vendor-made invoice PDFs read right, and no read is lost

Ticket: MUT-590 (Bug, Backlog, epic MUT-252). Relates MUT-540, MUT-514, MUT-504, MUT-589. No blockers.
Copy to `mini-crm/.claude/designs/mut-590-vendor-pdf-reading.md` at build time. ADR-252, TD-307+ (next free numbers on 2026-11-11).

## What the code does today

- `server/ocr/app/decode.py` uses the PDF text layer (`get_text_range`, page by page) when it is visibly drawn and has
  `MIN_PDF_TEXT_CHARS`; otherwise it rasterises for OCR.
- `pipeline.py:119` returns `{engine: "pdf-text", lines: [], pdfText}` after `pdf_text_to_logical` (Arabic per-word repair only).
- API `extract.ts:readReceipt` sees `pdfText` and uses `pdfRows`: one row per text-layer line, in stream order, no
  geometry. `orderedRows` (vertical-overlap row merge, `joinLabelAbove`, comma decimals) is never used for PDFs.
- `reading/reader.ts:153` logs `lines: result.lines.length`, always 0 for a text PDF.

## Part A: the skipped read on 27e28e05 (AC1)

`save()` ends `skipped` with `added=0` in exactly two cases (the log carried `lines` and `added`, so the read reached `save`):
1. `finishRead` found the receipt **deleted or FILED** during the read (`prisma.ts:2696`, F8), or
2. the stored suggestion was already **complete** after a stale re-merge.

Leading hypothesis: **Discard**. The phone's share review deletes the receipt once the Undo snackbar closes
(`shared_receipt_review_screen.dart:149-209`, MUT-257 D8). The read took ~12 s with a cold start, so a Discard a few
seconds in lands before `finishRead`. Basel couldn't pick the profile (MUT-589), so discarding is likely. If so, the
server behaved correctly, and the defect is that the log can't tell "deleted" from "lost".

Steps:
1. **Read-only prod check** (needs Basel's OK; `--account=barmajiyatltd@gmail.com`, `npm run db:run`): the row's
   `readStatus, deletedAt, filingStatus, suggested, version, updatedAt, readAttempts`, and its audit entries around
   08:40 UTC. Write the finding into the design doc and ADR-252. Print no receipt text.
2. Whatever the cause, make it legible: `finish`/`save` return a skip **reason** (`deleted | filed | complete`) and
   `done()` logs it as `code`. Log `engine` and, for `pdf-text`, `chars` (AC5 of the ticket), never text.
3. If the row shows a live To-review receipt with no fields (a real loss): reproduce in `reader.test.ts` against the
   memory store, fix, and add the regression test named in AC1. If it shows Discard: add the test that pins the
   intended behaviour (deleted mid-read → SKIPPED with `code: deleted`, nothing written) and the test for the invariant
   ("still To review after the read ⇒ the read's fields are stored") across stale retries.

## Part B: text-PDF rows with geometry (AC2, AC3)

Reuse the OCR path's row builder instead of a second one (DRY): the sidecar returns the text layer **as positioned
lines**, and the API runs them through `orderedRows`, exactly as OCR boxes.

**Sidecar (`server/ocr/app/decode.py`, `pipeline.py`):**
- New `_text_lines(pdf, count) -> list[dict]`: per page, `textpage.count_rects()` / `get_rect(i)` /
  `get_text_bounded(*rect)` (pdfium's text runs). Each run becomes `{text, conf: 1.0, box: [x0, y0, x1, y1], script}`
  with y flipped to top-down and offset by the pages above, so page 2 sits under page 1.
- Capped at `MAX_TEXT_OBJECTS` runs (the existing 5 000); past the cap, or on any pdfium error, `lines` is empty and
  the plain `pdfText` path still works (never a refusal).
- `pdfText` is still returned (the API's fallback, and a mixed-version rollout stays safe).
- `Decoded` gains `pdf_lines`; the pipeline logs `runs` next to `chars`.

**RTL repair (`server/ocr/app/text.py`):**
- `pdf_text_to_logical` already repairs Arabic per word. Add the Hebrew case: Hebrew final letters (ך ם ן ף ץ) only
  end a word, so a word that **starts** with one is visual. A layer counts as visual Hebrew only when some Hebrew word
  starts with a final letter (impossible in logical text); then each run/line with such a word goes through
  `visual_to_logical` (`get_display`, already in the module). Logical layers are unchanged.
- Whether to reverse per word (Chromium style) or per line is decided on the bench, the same way MUT-441 decided the
  Arabic one; both are a few lines on top of `get_display`.
- Applied to each run's text and to `pdfText`.

**API (`server/src/receipts/`):**
- `ocr-client.ts`: the schema already accepts `lines` with `pdfText`; no contract change beyond documenting that a
  `pdf-text` read may carry positioned lines.
- `extract/extract.ts`: `fromPdf` stays true for `pdfText`; rows = `orderedRows(lines)` when lines are present,
  else `pdfRows(pdfText)` (old sidecar). `source` stays `'pdf-text'`.
- `orderedRows` needs one check: a text-layer run is a whole printed line far more often than an OCR box, so
  `joinLabelAbove`'s label/amount join and `SAME_ROW_OVERLAP` apply as they are. Columns (label column, value column on
  the same baseline) merge by vertical overlap, which is the case `pdfRows` misses.
- `reading/reader.ts`: `SERVER_READER_GENERATION` 3 → 4 (the stamp `receipts:reread --reader-below` keys on).

**Not in scope:** photos, Adobe Scan and other image-in-PDF files (MUT-540); any LLM or third-party OCR (MUT-252).

## Part C: the bench (AC2, AC4)

- Basel supplies ≥10 vendor-made invoice PDFs from his email (he/ar/en, the shubak ₪200 one included) into
  `~/Work/Barmajiyat/Mutaba3a/receipt-bench/`, named `vendor-<date>-<n>.pdf`, `kind: "vendor-pdf"`; truth read by eye
  into `manifest.json`. **Never committed.** (Today's set has none: its PDFs are Adobe Scan output.)
- `server/ocr/bench/run.py`: report the `vendor-pdf` scope next to `photo` and `all`, so AC2 (≥95% of present fields,
  0 wrong-and-confident) is one line of output.
- Gate: `--compare` against a frozen copy of main: 0 fields lost on the existing set (MUT-540 pitfall: freeze main's
  extractor before the run). Run through `heavy` on port 8197, after telling the orchestrator.

## Tests (written first)

Python (`server/ocr/tests/test_units.py`, generated PDFs via pypdfium2 or a checked-in synthetic fixture, no real receipt):
- runs carry boxes in top-down page order; page 2 sits below page 1
- a label and its value drawn as two text objects on one baseline come back as two runs on the same row band
- over the run cap → `lines == []`, `pdfText` still set
- Hebrew visual layer (word starting with ם) repaired; a logical Hebrew layer unchanged; Arabic cases still pass
- an invisible layer still rasterises (MUT-504 unchanged)

TypeScript (`server/src/receipts/extract/__tests__`, `reading/__tests__`):
- text-PDF lines: `סה"כ לתשלום` and `200.00` in separate runs on one row → total 20000, ILS
- label above value in a column → total read (via `joinLabelAbove`)
- registration label and number in adjacent runs → registrationNo
- `pdfText` without lines → today's `pdfRows` path (back-compat)
- reader: deleted mid-read → `skipped` with `code: deleted`; stale edit then still To review → fields stored;
  `pdf-text` read logs `engine` and `chars`, no text
- generation 4 stamped

Commands: `npm --prefix server run typecheck`, `lint`, `openapi:check`, `npm --prefix server test` (all via `heavy`);
`server/ocr` pytest; the bench `--compare`.

## Release

- Sidecar image and API ship in the same apply (as MUT-540). A skewed rollout is safe either way: today's
  `readReceipt` uses `pdfText` and ignores `lines`, so an old API with a new sidecar reads as today; a new API with an
  old sidecar gets no lines and falls back to `pdfRows`.
- After rollout: `receipts:reread -- --reader-below 4`, limited to PDFs with a new `--mime application/pdf` flag
  (the ticket asks for PDF receipts only; images would re-run OCR for no change). Dry run first, per the MUT-514 runbook;
  add the step to `docs/operations/before-release.md`.
- Release-QA: extend `portal-selfservice.receipts.server-reading` (or add `receipts.vendor-pdf`) with a synthetic
  text-PDF invoice upload that ends with total, date and vendor filled.

## Knowledge updates
ADR-252 (text-layer PDFs are read by position through the OCR row builder; the skip reason is logged), TD for any
bench gap, CHANGELOG, TEST_PLAN, before-release.md.

## Open for Basel
1. OK for the read-only prod query on receipt 27e28e05 (Part A step 1)?
2. The ≥10 vendor PDFs from email (shubak first). The bench can't measure AC2 without them.
3. `--mime application/pdf` on the reread command, or reread every generation-3 receipt?

---

# Eng review (plan-eng-review, 2026-11-11)

Target: this file. Reviewer: in-host (Codex not installed, outside voice unavailable).

## Scope Challenge
- Reuse: `orderedRows`/`joinLabelAbove` (rows.ts:128) already pair labels with values by position for OCR boxes, and
  `get_display`/`visual_to_logical` (text.py) already do UAX #9. The plan reuses both; no new row builder.
- Complexity: about 14 files (decode.py, pipeline.py, text.py, test_units.py, bench/run.py, extract.ts, reader.ts,
  ports.ts, prisma.ts, memory.ts, receipts-reread.ts, 2 TS test files, before-release.md), 0 new classes or services.
  The gate trips at 8 or more files, so the structure question is D1.

## Findings
1. [INFORMATIONAL] (9/10) reader.ts:133 `return { status: result.kind === 'skipped' ? 'skipped' : 'none', added: 0 };`
   A deleted read, a filed read and a complete suggestion all log the same `skipped`. That is why 27e28e05 can't be
   diagnosed from logs. To tell deleted from filed, `FinishReadResult.skipped` needs a reason
   (prisma.ts:2696 `if (row.deletedAt || row.filingStatus === 'FILED')`). → D1
2. [INFORMATIONAL] (8/10) rows.ts:166 `pdfRows` stays as a second way to build rows. It's justified only as the
   fallback past the run cap and for a version-skewed rollout. → D4
3. [INFORMATIONAL] (7/10) extract.ts:51: text-layer rows are conf 1, so every rule weight clears the threshold. More
   label/value pairs mean more chances of a confidently wrong field. The bench gate (0 wrong-and-confident on the
   vendor set, 0 lost on the existing set) is the guard; there is no separate change.
4. [INFORMATIONAL] (8/10) The reread after rollout: generation 4 marks every receipt below it, images included. → D3
5. [INFORMATIONAL] (9/10) AC2 can't be measured without Basel's PDFs: receipt-bench/incoming is empty, and the
   manifest has no vendor-made PDFs. This is a dependency, not a decision.
6. [INFORMATIONAL] (6/10) Part A step 1 reads production rows. Medium confidence that it's needed: the leading
   hypothesis (a Discard during the read) fits every logged fact, but only the row proves it. → D2

## Failure modes (new paths)
- pdfium rects throw or exceed the cap → `lines=[]`, `pdfText` path (tested).
- Hebrew detector false positive (a Latin-only layer) → unchanged, because a Hebrew word must start with a final
  letter (tested).
- An old API with a new sidecar → `pdfText` path as today; a new API with an old sidecar → `pdfRows` (tested by the
  back-compat case).

## Test coverage (proposed)
```
CODE PATHS
[+] ocr decode._text_lines   [GAP→test] boxes/page offset · cap → [] · pdfium error → []
[+] ocr text Hebrew repair   [GAP→test] visual repaired · logical unchanged · Arabic still passes (test_units:281)
[+] api readReceipt          [GAP→test] lines → orderedRows · pdfText only → pdfRows (back-compat)
[+] api reader.save/finish   [GAP→test] deleted mid-read → code deleted · filed → code filed · complete → code complete
                             [GAP→test] stale edit, still To review → fields stored
[+] bench                    vendor-pdf scope ≥95%, 0 wrong-and-confident; --compare 0 lost
USER FLOWS
[GAP→E2E] portal upload text-PDF invoice → total/date/vendor filled (release-qa server-reading)
```

## Decision ledger (Basel, 2026-11-11)
- **D1 Skip reason: approved, exact reason.** `FinishReadResult.skipped` carries `reason: 'deleted' | 'filed'`, and
  the reader adds `'complete'`; `done()` logs it as `code`. Applies to prisma.ts and memory.ts. Structure: original
  arrangement (about 14 files).
- **D2 Prod check: approved, at build time.** Read-only, through `db:run` with the barmajiyatltd credentials. No
  receipt text printed. The cause goes into the design doc and ADR-252.
- **D3 Reread: approved, PDFs only.** `receipts:reread -- --reader-below 4 --mime application/pdf`, dry run first.
- **D4 pdfRows: approved, kept as the fallback** for no lines (cap, pdfium error, version skew), each case tested.
- Scope Challenge result: scope accepted as-is.

## Implementation tasks
1. Part A: prod check (D2), then skip reason (D1) plus tests, and log `engine` and `chars`.
2. Sidecar: `_text_lines` with boxes, cap and fallback, plus pytest.
3. Hebrew visual repair in text.py, plus pytest (per word or per line decided on the bench).
4. API: `orderedRows` for PDF lines, `pdfRows` fallback, generation 4, plus vitest.
5. Bench: vendor-pdf scope in run.py; Basel's ≥10 PDFs with truth; `--compare` gate.
6. Reread `--mime` flag (D3); before-release.md step.
7. Release-QA: a text-PDF upload case on `portal-selfservice.receipts.server-reading`.
8. Knowledge files: ADR-252, CHANGELOG, TEST_PLAN, TD as needed.

## Completion summary
Scope Challenge: scope accepted as-is · Architecture: reuse of `orderedRows` and `get_display`, no new boundary
(design-twice n/a) · Code quality: 1 kept second path (D4) · Tests: 9 gaps, all planned · Performance: rect cap 5 000
bounds pdfium work; reread limited to PDFs (D3) · Outside voice: unavailable (Codex not installed).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| Eng review | /eng-ticket MUT-590 | plan before build | 1 | CLEAR | 6 findings, 4 decisions approved |
| Outside voice | default | independent challenge | 0 | unavailable | Codex not installed |

VERDICT: CLEARED for /eng-build once Basel supplies the vendor PDFs (needed for task 5, AC2).

NO UNRESOLVED DECISIONS

---

# Build notes (2026-11-11)

- **Part A finding (D2, read-only prod check):** receipt 27e28e05 was **filed onto an existing expense about 10 s into
  its read**. `finishRead` rightly dropped the read (F8: a filed receipt's fields belong to its expense), so nothing was
  lost; the defect was only that the log said `skipped` with no reason. Not the Discard hypothesis. The skip now logs
  `code: deleted | filed | complete | ungranted`, and a read logs `engine` and, for a text PDF, `chars` (cf123fe4).
- **Hebrew repair:** reordered per line (whole visual lines through `get_display`), decided on the generated cases.
- **Bench (2026-11-12):** Basel's 17 real invoices (14 vendor-made; 3 scans with no text layer), truth checked by Basel in a local review page. Vendor-made: total/date/currency 34/40, 0 confidently wrong (main 32/40); secondary 23/42 (main 16/42); 57/82 overall. `--compare` vs main 9fa835d0: 10 fields gained, 1 lost (the two-column registration row on one invoice). Basel: land now; the 95% bar moves to MUT-591.
- **Release-QA:** `portal-selfservice.receipts.vendor-pdf`, a synthetic invoice (`syn-vendor-invoice-en.pdf`, label and
  amount drawn as separate objects on one line).
