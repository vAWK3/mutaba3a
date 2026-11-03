> Copied from `~/.gstack/projects/vAWK3-mutaba3a/mut-540-plan.md` at build time; real receipt figures are replaced by
> their acceptance criteria (AC2–AC4 on Jira MUT-540), as the bench's contents never enter the repo.

# MUT-540 plan: server reading of sideways photos, small PDF images and clean-image misses

Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · Backlog (not started) → In Progress at build → In Review after qa-reconcile.
Epic MUT-252. Builds on local main ≥ 6d0c4946 (MUT-514: reader generation 2, `extract/buyer.ts`, bench `--compare`, ADR-241).
Siblings: MUT-539 (phone Scan crops, Flutter, planned in parallel; separate), MUT-541 (learning, out), MUT-490 (QR, out).
No blocker. No API, schema or UI change.

## What planning found (changes the ticket's picture)

Measured locally (no production data fetched; real text stayed in `receipt-bench/.mut540/`):

1. **Paz Afek is already in the bench**: `scan-2026-10-29-p07.pdf` has the same 640×3080 embedded JPEG and the same total. AC2 can be proven without a fetch.
2. **Paz Afek's miss is the extractor, not image size.** OCR reads `<AC2 total, comma>` at 0.96 on its own line, under the card-slip label `סכום ע'סקה`. Upscaling to 1000, 1400 and 1800 px wide changed nothing (amount still missed). Three extractor gaps stack:
   - E1 `<AC2 total, comma>`: a comma before exactly two digits is not read as a decimal (`AMOUNT` takes `,` only as thousands).
   - E2 `ע'סקה`: OCR puts a geresh inside the word, so `CARD_SLIP` (`סכום עסקה`) never matches.
   - E3 the amount is on the row under its label. Even clean `סכום עסקה` / `<AC2 total>` on two rows reads no total today (checked with synthetic rows). `readRegistration` already reads "label row or the next" (fields.ts), the precedent.
3. **Beit Jala and Abu Shukri are OCR misses.** Fed clean synthetic text, the extractor reads `المجموع الكلي: <AC3 total> NIS` as <AC3 total> ILS and Abu Shukri's 25/10/2026. Tracing them needs the real images (D1).
4. **Tall PDF receipts are worked on below their native width.** `fit_size` caps the long side at 2,500 px: a 960×3200 image rasterises at 1054×3508 and is shrunk to 751×2500 (78% of native). A raster under 1,000 px wide is left as is, because its upscale is blocked by the same cap. 27 of the 48 real PDFs are tall like this, and many miss amount or date. This is the ticket's pattern 2 in general, but p07 shows it is not the cause there, so the bench decides whether it ships (D3).
5. **Orientation.** No OSD or angle-classifier model ships. Tesseract OSD (`--psm 0` on the prepared page) gave the right turn on 12/12 synthetic cases (ar/he/en × 0/90/180/270), about 0.4–0.7 s under load 48. RapidOCR alone cannot tell 90 from 270 (it turns tall crops itself). A "confident characters" score (sum of the lengths of lines at conf ≥ 0.8) separates the right turn clearly (198–237 vs ≤ 118). Real upright receipts often average 0.5–0.7 confidence, so a mean-confidence trigger would fire on 30/48. A trigger of "< 80 confident characters, or most boxes taller than wide" fires on about 3/48.

## Tasks

**T1 — Orientation (sidecar).** New `server/ocr/app/orientation.py`:
- `confident_chars(segments)`: the score above.
- `looks_sideways(segments)`: most boxes taller than wide.
- `needs_turn(segments)`: score < `MIN_CONFIDENT_CHARS` (80) or `looks_sideways`.
- `propose_turn(gray, tess)`: Tesseract OSD on the prepared page, scaled to a 1,600 px long side. Returns 0/90/180/270, or None on an OSD error.
- `turn(gray, deg)`: lossless `np.rot90`.

In `pipeline.Reader.read`, each OCR'd page (photo or PDF raster):
1. Read it as now.
2. If `needs_turn`, ask OSD. A proposal other than 0 re-reads that turn once with both engines.
3. Keep the turned reading only if its score ≥ 1.25× the first. Otherwise keep the first, so a wrong turn never makes a read worse.

At most one OSD call and one re-read per page (2 pages max). Logs: `turned` (count) and `orientMs`, never text. Settings: `orientation: bool = True` (`OCR_ORIENTATION=0` turns it off) and `MIN_CONFIDENT_CHARS` / `TURN_GAIN` in config.py.

Model: `osd.traineddata` from `tessdata_fast` 4.1.0 (Apache-2.0, the same source as ara/heb/eng), pinned by sha256 in `fetch_models.py`, checked by `check_licenses.py` (AC7 test), and baked into the image the same way.

Tests:
- Unit, with a fake reader: no trigger on a good read; the trigger fires on a low score and on tall boxes; the turn is kept only on gain; an OSD error keeps the first read; at most one re-read.
- Engine-backed golden: `syn-025-en-photo` and `syn-009-he-photo`, turned 90 and 270 in the test (PIL, no EXIF), read their total and date. Upright reads are unchanged (no OSD call: asserted through the log stats).

**T2 — PDF images at native resolution (sidecar), bench-gated (D3).**
- `decode._rasterise`: when a page is one image covering ≥ 90% of it, take that image's own pixels (pdfium `get_bitmap`), so nothing is resampled twice. Otherwise render as now.
- `preprocess.fit_size`: bound the working image by area (`MAX_WORK_PIXELS` = 2,500² = 6.25 MP, today's square bound), not by its long side. Hard caps are kept: the long side stays under 2 × `MAX_WORK_SIDE`, and a small short side is still upscaled at most 2×. A 960×3200 receipt is then read at native width or a little above, not shrunk to 751.
- Tests: a synthetic 640×3080 one-image PDF is worked on at a width ≥ 640, and a 4,000×4,000 page is still bounded; the existing size tests are kept.

**T3 — Extractor (E1–E3), synthetic tests first.**
- E1, `amounts.ts`: a comma before exactly two digits, not part of a thousands group (`<AC2 total, comma>`, never `1,234`), reads as a decimal point.
- E2, `normalize.foldForMatch`: drop a geresh between two Hebrew letters, except after ג ז צ ת (ג'ינס, צ'יפס). This happens after the MUT-514 before-VAT fold, and for keyword matching only.
- E3, `rows.ts`: a total, card-slip, subtotal or VAT label row with no money, directly followed (gap ≤ 1.5 row heights) by a row holding only money, becomes one row (label, then amount). The geometry comes from the row drafts. This applies to OCR rows only.
- Tests: extract.test.ts rows `MUT-540: …` for each, plus negative rows: `1,234` stays thousands; a label followed by an item row is not joined; a label followed by a far-away amount is not joined.

**T4 — Bench: the production receipts (D1).** Add the 6 production receipts not on disk (Maxi, Beit Jala, Abu Shukri, and the 3 Paz from comment 13107) to `receipt-bench/`, with truth read by eye. Never committed. Trace Beit Jala and Abu Shukri to OCR or the extractor and fix them (the fix is unknown until traced: a sub-plan at that point, inside this ticket's scope).

**T5 — Reader generation 3.** `SERVER_READER_GENERATION = 3`, so `receipts:reread -- --reader-below 3` re-reads the pilot's receipts after release (before-release.md step). The sidecar's engine name stays `rapid-tess`.

**T6 — Gate and docs.**
- Bench on :8197 through heavy: a main baseline, then the branch, with `--compare`.
- Gate: no field lost on main's reads, wrong-and-confident not up, synthetic 0 wrong, warm p95 < 5 s.
- Run the two-subagent pre-landing review.
- Docs: ADR-244, CHANGELOG, TEST_PLAN, TD (anything left: e.g. upside-down pages that still score ≥ 80 aren't turned), SYSTEM_OVERVIEW (receipt reading line), before-release.md (reread --reader-below 3).

## ACs → proof
| AC | Proof |
|---|---|
| Maxi sideways reads total, date, reg. no. | T1 + the bench row (needs D1); synthetic: golden turned fixtures |
| Paz Afek <AC2 total> | T3 E1–E3; bench p07 (on disk) |
| Beit Jala <AC3 total> ILS | T4 trace + fix (needs D1); synthetic row already passes in the extractor |
| Abu Shukri date 2026-10-25, total <AC4 total> or empty, never wrong | T4 (needs D1) |
| Real bench ≥ main, wrong-and-confident not up; synthetic 0 wrong, p95 < 5 s | T6 `--compare` |
| Unit tests per pattern, synthetic only | T1, T2, T3 tests |

## Quality bar
- DRY: one score function serves the trigger and the keep test, and E3 reuses the keyword sets. `fields.ts` already uses the next-row precedent.
- Cost: no new service and no new API call. Good reads pay nothing; a poor page pays about 0.4 s for OSD plus at most one re-read. Sideways or upside-down uploads are rare. The work-size change adds pixels only for tall receipts, and the bench checks warm p95.
- Risk: E1 and E3 widen what counts as money and labels. That's why there are negative tests and the per-field `--compare` gate. T2 is dropped if it loses any field.
- Privacy: OSD output and real text are never logged (the log is counts only, as now). The bench stays outside the repo.

## Decisions for Basel
- D1: fetch the 6 production receipts from the mtb3a-production bucket (account barmajiyatltd@gmail.com) into receipt-bench, or Basel drops them there, or skip them (those ACs are then proven synthetically and checked under MUT-514's T9/D12).
- D2: orientation by Tesseract OSD, triggered on poor reads and kept only on a 1.25× gain (recommended), vs. the ticket's "re-read at 90/180/270 and keep the best" (up to 3 extra full reads), vs. OSD on every page.
- D3: the T2 work-size change ships only if the bench gate shows gains with no field lost (recommended), vs. ship it anyway for the tall receipts, vs. leave it out (p07 doesn't need it).
- D4: reader generation 3 and a re-read after release (recommended), vs. keeping generation 2.

Business / product impact
- Every Paz/card-slip receipt (the pilot's most common kind) and every sideways phone photo now reads its total. Today they read empty, which makes Basel type them in by hand.
- It is the last server-side accuracy fix before MUT-514's D12 check (~15 production reads by eye) that decides granting reading to anyone beyond the pilot.
- The cost is low: no new service, nothing extra on good reads, and the per-field gate stops any regression from shipping.

---
# Eng review (plan-eng-review, 2026-11-03), target: this plan file

## Scope record
feature answers: D1 = "Keep, bench-gated (recommended)" (T2 stays; ships only if the real bench gains with no field lost vs main, else dropped and recorded in the ADR); structure: A "Original arrangement" (D2: orientation.py as its own module); accepted scope: T1–T6 as written above, T2 bench-gated; pending remedies: R1, R2, R3.

## Scope Challenge findings
1. [INFORMATIONAL] (confidence: 9/10) MUT-540 description "Add the 7 production receipts to receipt-bench" vs. the brief's rule "Production receipts are not on disk; don't fetch them without Basel's say-so". Only p07 (Paz Afek) is on disk (same 640×3080 image, same total, probe 2026-11-03). Without the other 6, AC1, AC3 and AC4 are proven only synthetically. → R1.
2. [INFORMATIONAL] (confidence: 7/10) server/ocr/check_licenses.py:54 lists only `tessdata_fast 4.1.0 ara, heb, eng`, and Dockerfile:37 deletes the system traineddata, so OSD has no model in the image today. OSD runs on Tesseract's legacy engine. Both tessdata and tessdata_fast 4.1.0 serve an osd.traineddata (HTTP 200, probed). Build task: pin whichever one `--psm 0` actually runs with (the brew copy, sha256 9cf5d576…, worked locally), and add its licence row. A factual build note, no decision needed.
3. [INFORMATIONAL] (confidence: 8/10) The ticket's orientation line, "re-read at 90°, 180° and 270° and keep the turn with the most confident lines", vs. the probe: RapidOCR turns tall crops itself (Global.use_cls False, engines.py:43), so a probe with it alone can't tell 90 from 270. The probe also found OSD right on 12/12 synthetic cases. → R2.
4. [INFORMATIONAL] (confidence: 8/10) server/src/receipts/reading/reader.ts:62 `export const SERVER_READER_GENERATION = 2;`. Without a bump, `receipts:reread --reader-below` can't pick the pilot receipts that MUT-540 would now read better. → R3.

REALITY: premise-table pass 9 claims (p07=Paz Afek, <AC2 total, comma> read at 0.96, extractor clean-row misses, Beit Jala/Abu Shukri extract clean, 751 px shrink, OSD 12/12, trigger 3/48, osd 200 both repos, generation 2), unverified=0 [probes in this session; preprocess.py:fit_size, reader.ts:62]
REALITY: already-done pass no MUT-540 commits on main (git log server/ocr/app server/src/receipts/extract: last a8b428ac MUT-514)
REALITY: surface-check finding `--psm 0` needs a legacy-engine model; image ships none (Dockerfile:37) → finding 2
REALITY: binding-decisions pass MUT-514 D8 per-field gate and D12 prod check honoured; MUT-252 no-LLM/no-third-party honoured (OSD is local Tesseract)
REALITY: numbers pass [measured: receipt-bench reads.json + probes] trigger 3/48, 27/48 tall PDFs; timings [estimated] under load 48, [re-measure before gate]
REALITY: deferred-asks finding the ticket asks for 7 production receipts; 6 not on disk → R1
REALITY: pr-count pass one local branch, no PR (CLAUDE.md: no push)

## Decision ledger

### R1: production receipts for the bench
Finding: Scope Challenge 1, INFORMATIONAL, 9/10, MUT-540 description / brief rule, reviewer: plan-eng-review (Claude)
Plan baseline: original proposal T4: add the 6 production receipts not on disk, truth by eye, never committed; source undecided.
Runtime evidence: receipt-bench has 48 files; p07 is the Paz Afek receipt; the other 6 exist only in the mtb3a-production bucket (account barmajiyatltd@gmail.com).
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 source of the 6 prod receipts | none on disk | Claude fetches them read-only from the mtb3a-production bucket into receipt-bench (gcloud --account=barmajiyatltd@gmail.com), never committed | Basel drops the 6 files into receipt-bench himself; build waits for them at T4 | not fetched: AC1/AC3/AC4 proven on synthetic rows only, real check left to MUT-514 T9/D12 |
| R2 orientation approach | pending | pending | pending | pending |
| R3 reader generation | pending | pending | pending | pending |
Question D3:
D3 — How do the 6 production receipts get into the bench?
Project/branch/task: mini-crm main, planning MUT-540 (server receipt reading).
ELI10: The ticket's ACs name 4 real production receipts (the sideways Maxi photo, Beit Jala, Abu Shukri, Paz Afek), and the bench should hold all 7 read so far. Only Paz Afek is already on disk (it's bench p07). The other 6 sit only in the production bucket. Without them I can prove the fixes only on made-up text, and the Beit Jala and Abu Shukri misses can't even be traced, because the extractor reads their clean text fine, so the loss happens in OCR.
Stakes if we pick wrong: Without the real files, 3 of the 6 ACs stay unproven until after release, and the clean-image misses go unfixed.
Recommendation: A because it's read-only, fast, and keeps the files in the same never-committed bench folder as the other 48.
Completeness: A=10/10, B=10/10, C=6/10
Pros / cons:
A) I fetch them read-only (recommended)
  ✅ Read-only gcloud copy of 6 objects into receipt-bench, nothing written to production
  ✅ Every AC proven on the real receipts before landing, as the ticket asks
  ❌ Uses the production account's read access on your behalf (human: ~20 min / CC: ~5 min)
B) You drop them in yourself
  ✅ Nobody but you touches the production bucket
  ✅ Same full proof once the files are there
  ❌ The build waits on you at T4 for the files (human: ~15 min of your time)
C) Don't fetch; synthetic only
  ✅ No production data moves at all
  ❌ AC1/AC3/AC4 unproven before release; Beit Jala and Abu Shukri can't be traced or fixed
Net: real proof now (by me or by you) vs. no production data touched.
Header: Prod receipts
Options:
A) I fetch them read-only (recommended)
Read-only copy of the 6 receipts from the mtb3a-production bucket (barmajiyatltd@gmail.com) into receipt-bench; truth read by eye; never committed, logged or pasted.
B) You drop them in yourself
Basel copies the 6 files into receipt-bench; the build does T1–T3 meanwhile and waits for them at T4.
C) Don't fetch; synthetic only
No production files; AC1/AC3/AC4 proven on synthetic rows; real check under MUT-514 T9/D12 after release.

State: approved
Actual answer: A) I fetch them read-only (recommended), Basel, D3, 2026-11-03
Accepted scope: Claude copies the 6 production receipts (Maxi, Beit Jala, Abu Shukri, 3 Paz from comment 13107) read-only from the mtb3a-production bucket with gcloud --account=barmajiyatltd@gmail.com into ~/Work/Barmajiyat/Mutaba3a/receipt-bench; truth read by eye into manifest.json; never committed, logged or pasted. Nothing written to production.
History: none

### R2: orientation approach
Finding: Scope Challenge 3, INFORMATIONAL, 8/10, engines.py:43 `"Global.use_cls": False` + probe, reviewer: plan-eng-review (Claude)
Plan baseline: original proposal T1: Tesseract OSD on poor reads (< 80 confident chars or mostly tall boxes), one re-read at OSD's turn, kept only on a 1.25x score gain; ticket text: re-read at 90/180/270, keep the best.
Runtime evidence: OSD right on 12/12 synthetic (ar/he/en x 4 turns), 0.4-0.7 s under load 48; RapidOCR-only probe cannot tell 90 from 270; trigger fires on ~3/48 real upright reads; full read 1.6 s p50 warm (MUT-514 bench, load 15).
Comparison grid:
| Choice | Current (main) | A | B | C |
|---|---|---|---|---|
| R1 prod receipts | approved A (D3) | A (unchanged) | A (unchanged) | A (unchanged) |
| R2 how a turn is chosen | EXIF only (decode.py) | poor read -> OSD proposes -> 1 re-read, kept on >= 1.25x score | poor read -> full re-read at 90, 180, 270, keep the best (up to 3 extra reads) | OSD on every page before reading; turn when OSD says so |
| R2 extra cost on a good read | 0 | 0 | 0 | ~0.4 s each read |
| R2 extra cost on a poor page | 0 | ~0.4 s + at most 1 read | up to 3 reads (~5 s warm) | 0.4 s + maybe 1 read, no keep test |
| R2 new model file | none | osd.traineddata (Apache-2.0) | none | osd.traineddata |
| R3 reader generation | 2 | pending | pending | pending |
Question D4:
D4 — How does the reader pick the right turn for a sideways photo?
Project/branch/task: mini-crm main, planning MUT-540 (server receipt reading).
ELI10: The sideways Maxi photo has no EXIF turn, so OCR reads it on its side and gets 2 lines. To fix it, the reader must notice a bad read and try it the right way up. Tesseract ships a small orientation model (OSD) that guesses the turn in about half a second, and it was right on all 12 test turns. The ticket's alternative re-reads the receipt three more times and keeps the best, which costs about 5 s more per bad page.
Stakes if we pick wrong: Too eager, and good receipts get slower or turned wrongly; too timid, and sideways photos still read empty.
Recommendation: A because it adds nothing to good reads, one guess plus at most one re-read to bad ones, and a turn is kept only when it reads clearly better.
Completeness: A=9/10, B=9/10, C=7/10
Pros / cons:
A) OSD on poor reads, kept on gain (recommended)
  ✅ Zero extra time on the 45 of 48 real receipts that read fine today
  ✅ A wrong OSD guess can't make a read worse: the turn is kept only on a 1.25x confident-text gain
  ❌ Adds a 10 MB model file, pinned and licence-checked (human: ~1 day / CC: ~1 h)
B) Try all three turns, keep best
  ✅ No new model; exactly the ticket's wording
  ✅ Finds upside-down pages OSD might miss
  ❌ Up to 3 extra full reads (~5 s warm) per poor page, pushing p95 toward the 5 s bar
C) OSD on every page
  ✅ Simplest rule: always ask OSD, turn when it says so
  ❌ +0.4 s on every read, and OSD's low confidence (1.1-2.6) could turn a good receipt wrongly
Net: a cheap guess checked by results vs. brute force vs. trusting the guess everywhere.
Header: Orientation
Options:
A) OSD on poor reads, kept on gain (recommended)
Trigger: < 80 confident characters or mostly tall boxes. Tesseract OSD proposes the turn; one re-read; kept only on a >= 1.25x score. OSD error keeps the first read. osd.traineddata pinned + licence row.
B) Try all three turns, keep best
Trigger as A; re-read at 90, 180 and 270 with both engines and keep the highest score. No new model.
C) OSD on every page
OSD before every read; turn whenever it proposes one; no keep test.

State: approved
Actual answer: A) OSD on poor reads, kept on gain (recommended), Basel, D4, 2026-11-03
Accepted scope: T1 as planned: trigger < 80 confident characters or mostly tall boxes; Tesseract OSD proposes; at most one OSD call + one re-read per page; turn kept only on >= 1.25x confident-character score; OSD error keeps the first read; osd.traineddata pinned (sha256) in fetch_models.py with a licence row; OCR_ORIENTATION=0 turns it off; counts-only logs.
History: none

### R3: reader generation
Finding: Scope Challenge 4, INFORMATIONAL, 8/10, server/src/receipts/reading/reader.ts:62 `export const SERVER_READER_GENERATION = 2;`, reviewer: plan-eng-review (Claude)
Plan baseline: original proposal T5: generation 3 + before-release step `receipts:reread -- --reader-below 3`.
Runtime evidence: receipts-reread.ts picks only TO_REVIEW, unapproved receipts with a server reader version below the bound (prisma.ts:2380); MUT-514 bumped 1 -> 2 for the same reason (ADR-241).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 prod receipts | approved A (D3) | A | A |
| R2 orientation | approved A (D4) | A | A |
| R3 generation | 2 | 3; before-release.md: after roll-out, `receipts:reread -- --reader-below 3` dry run then --apply | stays 2; no re-read of earlier reads |
Question D5:
D5 — Stamp MUT-540's reader as generation 3 so earlier reads can be re-read?
Project/branch/task: mini-crm main, planning MUT-540 (server receipt reading).
ELI10: Every server reading is stamped with a reader generation. MUT-514 made generation 2 and added a command that re-reads any To-review receipt read by an older generation. If MUT-540 also becomes generation 3, the pilot's receipts read before it (the sideways Maxi photo, the Paz slips) can be re-read after release with one command. Your own edits and approved receipts are never touched.
Stakes if we pick wrong: Without the bump, receipts already waiting in To review keep their worse readings until someone fixes them by hand.
Recommendation: A because it's a one-line constant and the re-read command already exists and is reviewed.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Generation 3 + re-read step (recommended)
  ✅ One constant; existing receipts:reread fixes waiting To-review reads after roll-out
  ✅ The reading stamp tells which reader produced each suggestion, for the D12 production check
  ❌ One more before-release step to run (dry run first) (human: ~10 min / CC: ~2 min)
B) Keep generation 2
  ✅ No release step; nothing re-read
  ❌ Waiting To-review receipts keep their old misses; reads from 2 different readers share one stamp
Net: one constant and one release step vs. stale readings and a muddled stamp.
Header: Generation
Options:
A) Generation 3 + re-read step (recommended)
SERVER_READER_GENERATION = 3; before-release.md gets the `receipts:reread -- --reader-below 3` step (dry run first, after full roll-out); ADR-244 notes it.
B) Keep generation 2
No bump, no re-read step; earlier reads stay as they are.

State: approved
Actual answer: A) Generation 3 + re-read step (recommended), Basel, D5, 2026-11-03
Accepted scope: SERVER_READER_GENERATION = 3 (reader.ts:62); before-release.md step: after full roll-out, `npm --prefix server run receipts:reread -- --reader-below 3` dry run, then --apply; ADR-244 records it; tests that pin the stamp updated.
History: none

## Section 1: Architecture review
1. [CRITICAL] (confidence: 9/10) server/src/receipts/extract/total.ts:255-256 — `// A card slip alone can be one of two in a split payment: it is the total only when the receipt agrees with it.` / `if (!hasKeyword(row.folded, TOTAL) && confirmed === null && rowsPrinting(parts, minor) < MIN_REPEAT_ROWS) continue;`. Probe (synthetic rows, this session): `סכום עסקה <AC2 total>` on one clean row reads no total, and the same amount on two slip rows reads <AC2 total>. Paz Afek (p07) prints its slip once and OCR garbles its own סה"כ lines, so E1–E3 alone leave AC2 unmet. → R4.
2. [INFORMATIONAL] (confidence: 8/10) server/ocr/app/engines.py:85 — `os.environ["TESSDATA_PREFIX"] = str(settings.tessdata_dir)`: OSD looks for osd.traineddata in the variant folder, so fetch_models.py must place it in every variant it fetches (fast and best), and TesseractReader's model check must list it while orientation is on. Build note; no decision.
3. [INFORMATIONAL] (confidence: 8/10) pytesseract `image_to_osd` raises TesseractError on sparse pages ("Too few characters", seen on unprepared photos in the probe). Plan T1 already keeps the first read on any OSD error; the unit test must raise that error class. Build note.
Design-twice: shape A (chosen, D2): orientation.py, called after a page's first read, judges that read and proposes one turn. Shape B: orientation decided before reading, in decode/prepare (OSD on every page). B can't use read quality and costs OSD on every page (rejected with D4 C). A hides trigger, OSD, turn and the keep rule behind one call, `Reader._read_page` → `orientation.better_turn(...)`. Red flags: none. One owner (orientation.py) for the turn policy, and pipeline.py keeps reading.
Failure modes: the OSD model is missing in the image → TesseractReader start-up check fails boot (loud, caught by the image build and the AC7 test); OSD is wrong on a poor page → the 1.25× keep test discards it (silent but harmless; counted in the `turned` log stat).

### R4: a card-slip total printed once
Finding: Section 1 #1, CRITICAL, 9/10, server/src/receipts/extract/total.ts:255-256, reviewer: plan-eng-review (Claude)
Plan baseline: original plan T3 E1-E3 only (comma decimal, geresh fold, label/next-row join); MUT-514 OV-7 rule: a card slip alone is the total only when confirmed or printed on >= 2 rows.
Runtime evidence: synthetic probe this session: one slip row -> no total; two slip rows -> <AC2 total>. p07's OCR has <AC2 total, comma> once (conf 0.96) and garbled סה"כ rows.
Comparison grid:
| Choice | Current (main) | A | B |
|---|---|---|---|
| R1/R2/R3 | approved A (D3/D4/D5) | unchanged | unchanged |
| D1 T2 | bench-gated (D1) | unchanged | unchanged |
| R4 lone card slip | never the total unless confirmed or on >= 2 rows | the total when it is the receipt's only card-slip row, no cash/tendered/change row exists, and no other total-labelled amount is printed; bench-gated (dropped if wrong-and-confident rises) | unchanged; AC2 amended: Paz Afek's total may stay empty (Basel's call), E1-E3 still ship |
Question D6:
D6 — May a card-slip amount printed only once be the receipt's total?
Project/branch/task: mini-crm main, planning MUT-540 (server receipt reading).
ELI10: Paz Afek's paper says 'סכום עסקה <AC2 total>' once, on the card slip at the bottom; its own total lines at the top come out of OCR as noise. MUT-514 added a rule that a slip printed once is never trusted as the total, because a split payment (two cards, or card plus cash) prints a slip for only part of the bill. So even after fixing the comma and the label, the reader would still leave Paz Afek's total empty. The narrow change: trust a lone slip only when nothing on the receipt hints at a split, meaning no second slip, no cash, tendered or change line, and no other printed total.
Stakes if we pick wrong: Too loose, and a split payment's partial amount fills as the total; too strict, and every Paz/card-slip receipt whose top is unreadable stays empty.
Recommendation: A because a split payment usually leaves a trace the rule checks for (a second slip, cash or change), and the bench gate drops the rule if wrong-and-confident rises.
Completeness: A=9/10, B=6/10
Pros / cons:
A) Lone slip counts when no split sign (recommended)
  ✅ Paz Afek and similar card-slip receipts read their total (AC2 met)
  ✅ Kept only if the real bench's wrong-and-confident count does not rise (MUT-514 D8 gate)
  ❌ A split payment that prints no cash or second-slip line would fill a partial total (human: ~4 h / CC: ~20 min)
B) Keep MUT-514's rule
  ✅ No new way to be confidently wrong on split payments
  ❌ AC2 unmet: Paz Afek's total stays empty, and you type it in by hand
Net: one narrowly guarded rule that meets AC2 vs. keeping the stricter guard and amending the AC.
Header: Lone slip
Options:
A) Lone slip counts when no split sign (recommended)
A card-slip amount is the total when it is the only card-slip row, no cash/tendered/change row exists and no other total-labelled amount is printed; synthetic tests for each guard; bench-gated.
B) Keep MUT-514's rule
No change to total.ts; AC2 amended so Paz Afek's total may stay empty; E1-E3 still ship.

State: approved
Actual answer: A) Lone slip counts when no split sign (recommended), Basel, D6, 2026-11-03
Accepted scope: T3 gains E4 in total.ts labelledTotal: a card-slip amount printed once is the total when it is the receipt's only card-slip row, no cash/tendered/change row exists (kinds.isPayment / CASH / TENDERED / CHANGE), and no other total-labelled amount is printed; synthetic tests for the accept case and each guard (second slip, cash row, change row, another labelled total); bench-gated (dropped if real wrong-and-confident rises).
History: none

Section 1 dispositions: #1 accepted (R4, D6 A); #2 accepted as a T1 build note; #3 accepted as a T1 test row.

## Section 2: Code quality review
1. [INFORMATIONAL] (confidence: 8/10) server/src/receipts/extract/amounts.ts:16 `const AMOUNT = /(?<![\d.,])(\d{1,3}(?:,\d{3})+(?:\.\d{1,3})?|\d+\.\d{1,3}|\d{1,6})(?!\d|[.,]\d)/g;`: E1 belongs in `normalizeText` (normalize.ts:36, beside `ARABIC_COMMA_DECIMAL`), so every consumer (dates' NOT_MONEY, VAT rates, `decimalPlacesIn`) sees one representation. That's one owner, not two (red flag 6). Pattern: `(?<![\d,.])(\d{1,6}),(\d{2})(?![\d,])`, applied after the Arabic comma rule. Build note: same behaviour, better place.
2. [INFORMATIONAL] (confidence: 7/10) E3's "a row holding only money" needs one definition: after `NOT_MONEY` and currency marks (₪, ש"ח, NIS, ILS, $, €, JD, د.أ) are removed, no letters remain and `moneyIn(..., false)` is non-empty. Keep it in rows.ts next to the join; the currency marks come from currency.ts's existing patterns, never a second list (red flag 8). Build note.
3. [INFORMATIONAL] (confidence: 7/10) E2's exception letters (ג ז צ ת) are a policy. Put them in one named constant in normalize.ts with a comment saying why (loanword sounds ג'ינס, צ'יפס, ז'קט, ת'). Build note.
No new decisions. Dispositions: #1–#3 accepted as build notes inside the approved T3 scope (no behaviour beyond D-answers).

## Section 3: Test review
Framework: server Vitest (`npm --prefix server test`, extract tests under src/receipts/extract/__tests__), sidecar pytest (`server/ocr/.venv/bin/python -m pytest server/ocr/tests`, engine-backed tests skip without models).

```
CODE PATHS                                                         
[+] server/ocr/app/orientation.py (new)                            
  ├── confident_chars(segments)            [GAP→T1 unit] empty, all <0.8, mixed
  ├── looks_sideways(segments)             [GAP→T1 unit] tall majority, wide majority, empty
  ├── needs_turn(segments)                 [GAP→T1 unit] score<80 / tall / neither
  ├── propose_turn(gray, tess)             [GAP→T1 unit] 0/90/180/270; TesseractError → None
  └── better_turn(first, reread)           [GAP→T1 unit] kept at ≥1.25x, dropped below, tie dropped
[+] server/ocr/app/pipeline.py Reader.read                         
  ├── good page → no OSD call               [GAP→T1 unit, fake reader] call count 0
  ├── poor page → OSD → re-read once        [GAP→T1 unit] at most 1 OSD + 1 re-read per page
  ├── OCR_ORIENTATION=0                     [GAP→T1 unit] never calls OSD
  └── real engines, turned photos           [GAP→T1 golden] syn-025/syn-009 at 90 and 270
[+] server/ocr/app/decode.py _rasterise (T2, gated)                
  ├── one image ≥90% of page → native px    [GAP→T2 unit] synthetic 640×3080 one-image PDF
  └── otherwise → render as now             [★★ TESTED] test_golden syn-043-ar-pdf-image
[+] server/ocr/app/preprocess.py fit_size (T2, gated)               
  ├── tall 960×3200 → ≥ native width        [GAP→T2 unit]
  ├── area bound 6.25 MP, long side ≤ 5000  [GAP→T2 unit] 4000×4000 still bounded
  └── existing size rules                   [★★★ TESTED] test_units:207,214 (kept)
[+] server/src/receipts/extract                                     
  ├── E1 normalizeText <AC2 total, comma> → <AC2 total>      [GAP→T3] + 1,234 stays thousands, 1,234,56 untouched
  ├── E2 foldForMatch ע'סקה → עסקה          [GAP→T3] + ג'ינס/צ'יפס kept, לפנ' מע"מ still MUT-514 fold
  ├── E3 orderedRows label/next-row join    [GAP→T3] + item row not joined, far amount not joined, label with own amount not joined
  ├── E4 lone card slip (D6)                [GAP→T3] accept; refused with 2nd slip / cash / change / other total
  └── generation 3 stamp                    [★★ TESTED] reader tests pin `server-ocr-…-<n>`: update to 3
[+] Real/synthetic bench (T6)                [→EVAL-like gate] run.py --compare main: 0 fields lost, w&c not up, syn 0 wrong, p95 <5 s

COVERAGE (planned): 26/26 paths have a planned or existing test | existing ★★/★★★: 3
GAPS: 23, all assigned to T1–T3 tests
```
Regression rule: E1/E3/E4 widen what counts as money, labels and totals. The approved regression contract is MUT-514 D8 (bench `--compare` per-field gate, this ticket's AC5), carried forward, plus the existing extract.test.ts suite, kept green unchanged. No new question needed.
Tests to retire: none.
Value cards (Critical Paths):
- Turned photo reads: Value: protects=a 90/270 photo with no EXIF reads total+date; fails_when=trigger/OSD/turn broken; why_new=no orientation code exists; seam=none; no_claim=Maxi real photo (bench T4 proves that)
- Paz slip: Value: protects=label row + amount row with <AC2 total, comma> reads <AC2 total>; fails_when=E1/E2/E3/E4 regress; why_new=extract.test.ts has no slip-on-next-row case; seam=none; no_claim=OCR quality on p07 (bench proves)
- Lone slip guards: Value: protects=split payment never fills a partial total; fails_when=E4 guard dropped; why_new=E4 is new; seam=none; no_claim=split receipts without any trace
Dispositions: all gaps accepted into T1–T3 (proof of approved behaviour; no optional depth asked).

## Section 4: Performance review
1. [INFORMATIONAL] (confidence: 8/10) Load at planning time was 48 on 11 cores. The probe's 8–70 s reads against the MUT-514 bench's 1.6 s p50 show timing is load-bound. So the p95 gate compares a main baseline and the branch run back to back in the same heavy slot (the plan already queues both) and reports the 1-minute load, as run.py prints. Build note.
2. [INFORMATIONAL] (confidence: 7/10) T2's area bound keeps the working image ≤ 6.25 MP (today's square maximum), so Tesseract's per-pixel cost on tall receipts rises by at most (6.25 MP / 1.9 MP) ≈ 3.3× on the tallest. That's [estimated]; the bench's tessMs p95 decides, inside D1's gate.
3. Orientation cost is bounded per page (D4): 0 on good reads, ≤ 1 OSD (~0.4 s) + 1 read on poor ones, ≤ 2 pages. No queries, no caches, no network. No issues beyond #1–#2.
Dispositions: #1, #2 accepted as gate notes.

## Outside voice (Claude Plan subagent, native fallback: Codex CLI not installed)
Completed within the 5-minute bound; 15 findings. Verified by the parent: #1 (rapidocr/config.yaml:10 `max_side_len: 2000`, main.py:322 `resize_image_within_bounds(ori_img, self.min_side_len, self.max_side_len)`), #2 (test_units.py:211 `assert max(big.shape) == 2_500`), #4 (rapidocr/utils/process_img.py:102-103 `if dst_img_height * 1.0 / dst_img_width >= 1.5: dst_img = np.rot90(dst_img)`).
Number map (finding #15, factual correction): the plan's own "D1–D4" are R1 (prod receipts), R2 (orientation), D1-answer (T2), R3 (generation); the asked questions are D1 T2 scope, D2 structure, D3 = R1, D4 = R2, D5 = R3, D6 = R4. Builders cite R-ids.
Build notes accepted without a question (necessary implementation of approved behaviour or factual): #9 deploy order (before-release.md: sidecar image first, then the API that stamps generation 3); #11 recorded in ADR-244 (tuned on the same small set; MUT-514 D12's production check is the real proof); #12 page offset uses the turned page's height; #13 scores computed on the merged output, plus a turned syn-001 Arabic golden; #14 E2 exception letters also cover ח ד ט ר (Arabic-name transliteration), and ע stays folded (p07); fold remains match-only.
Reopened or new choices: O1 (#1, #2, #3, #6-T2), O2 (#5, #6-E4; reopens R4), O3 (#4), O4 (#10), O5 (#7, #8).

### O1: T2 reshaped
Finding: Outside #1 Critical, #2 High, #3 High, #6 High; reviewer: Claude Plan subagent; verified by parent
Plan baseline: D1 answer "Keep, bench-gated": T2 = native embedded image via get_bitmap + area-bounded fit_size for all pages.
Runtime evidence: RapidOCR caps its own input at a 2000 px long side; fit_size runs on photos too; get_bitmap skips MAX_PIXELS, masks and /Rotate.
Comparison grid:
| Choice | Current approved | A | B | C | D |
|---|---|---|---|---|---|
| O1 T2 shape | get_bitmap + area bound on every page | flat (PDF) pages only; keep page.render at 300 dpi (no get_bitmap); area bound 6.25 MP for flat pages; RapidOCR Global.max_side_len raised to the work image's long side for flat pages; switch OCR_MAX_WORK_PIXELS (0 = main's sizing) for ablation; still bench-gated | as approved | measure first: one bench pass with max_side_len raised only, then decide | defer T2 to a follow-up ticket |
| D1 gate | bench-gated | bench-gated | bench-gated | n/a until measured | n/a |
Question D7:
D7 — Reshape T2 so it can actually help, and touch only PDF pages?
Project/branch/task: mini-crm main, planning MUT-540 (server receipt reading).
ELI10: The second reviewer found that RapidOCR quietly shrinks every image to 2,000 px on its long side, so making tall PDF receipts bigger before reading changes nothing for it. That's probably why my upscale test on Paz Afek did nothing. It also found that T2 as written would change every phone photo, and that pulling the raw image out of the PDF skips a safety size limit. The reshaped T2 touches PDF pages only, keeps the safe 300-dpi render, lifts RapidOCR's own cap for those pages, and gets an off switch so the bench can test it alone.
Stakes if we pick wrong: As approved, T2 costs time and risk for no gain on RapidOCR and changes photos nobody asked to change.
Recommendation: A because it's the only version that can change what RapidOCR sees, while photos and the size limit stay exactly as on main.
Completeness: A=10/10, B=4/10, C=8/10, D=6/10
Pros / cons:
A) Apply the reshaped T2 (recommended)
  ✅ PDF pages only: phone photos and test_units.py:211 stay exactly as on main
  ✅ Raises RapidOCR's 2000 px cap for those pages, the change that can matter, with an off switch for ablation
  ❌ Larger RapidOCR detection input on tall PDFs: more time, measured by the bench (human: ~1 day / CC: ~1 h)
B) Keep T2 as approved
  ✅ No re-plan; the bench gate still drops it if it loses a field
  ❌ Can't help RapidOCR, changes every photo's size, and breaks an existing test
C) Measure first, then decide
  ✅ One cheap bench pass (cap raised only) before any T2 code
  ❌ Another decision round after the measurement; build pauses for it
D) Defer T2 to its own ticket
  ✅ MUT-540 stays on the ACs' causes: orientation and extractor fixes
  ❌ The ticket's PDF-image scope line moves out; tall receipts keep today's shrink
Net: a T2 that can work and touches only PDFs vs. the approved shape that likely can't.
Header: T2 reshape
Options:
A) Apply the reshaped T2 (recommended)
Flat pages only; page.render at 300 dpi (no get_bitmap); 6.25 MP area bound for flat pages; RapidOCR max_side_len raised to match for them; OCR_MAX_WORK_PIXELS switch (0 = main); bench-gated.
B) Keep T2 as approved
get_bitmap + area bound on every page, bench-gated.
C) Measure first, then decide
One bench pass with RapidOCR's cap raised for flat pages only, no other T2 code; T2 decided after.
D) Defer T2 to its own ticket
No sizing change in MUT-540; a follow-up ticket carries the reshaped T2.

State: approved
Actual answer: A) Apply the reshaped T2 (recommended), Basel, D7, 2026-11-03
Accepted scope: T2 = flat (PDF raster) pages only; page.render at 300 dpi kept (no get_bitmap; MAX_PIXELS bound unchanged); fit_size for flat pages bounded by area (6.25 MP), photos unchanged (test_units.py:211 stays); RapidOCR max_side_len raised to the work image's long side for flat pages only; OCR_MAX_WORK_PIXELS (0 = main's sizing) for ablation; bench-gated per D1.
History: D1 answered "Keep, bench-gated (recommended)" for the original T2 shape.

### O2: E4 risk the gate can't see (reopens R4)
Finding: Outside #5 High, #6 High (E4 part); reviewer: Claude Plan subagent; parent check: the bench manifest holds no split-payment receipt known to the parent (unverified, private folder not inspected for this).
Plan baseline: R4 approved D6 A: lone slip is the total when no second slip, cash/tendered/change row or other labelled total; bench-gated.
Runtime evidence: RULE_LABELLED 0.8 x slip box conf 0.96 = 0.77 >= MIN_FIELD_CONFIDENCE 0.6, so an E4 total is shown as a confident field; p07's OCR has no readable price-per-litre or VAT-at-rate line to confirm it (probe lines this session).
Comparison grid:
| Choice | Current approved (D6 A) | A | B | C | D |
|---|---|---|---|---|---|
| O2 lone-slip rule | absence guards, bench-gated | D6 A kept + synthetic split-payment rows (card+cash, two cards, card+voucher) in extract.test.ts + OCR-independent switch for ablation (bench run with E4 off) + residual risk in TD and checked under MUT-514 D12 | E4 only with positive confirmation (litres x price per litre, or VAT at the known rate, equal the slip amount within rounding); AC2 may stay empty for p07 | drop E4, keep MUT-514's rule; AC2 amended (empty, never wrong) | keep D6 A unchanged |
Question D8:
D8 — The lone-slip rule (D6): add split-payment tests and an off switch, or require proof?
Project/branch/task: mini-crm main, planning MUT-540 (server receipt reading).
ELI10: You approved trusting a card-slip amount printed once when nothing hints at a split payment. The second reviewer's point: the receipts that need this rule are the ones whose top OCR already garbled, so 'no cash line found' is weak evidence there. And the bench has no split-payment receipts, so its wrong-answer count can't catch the failure. If it happens, the partial amount shows as a confident total. Paz Afek has no readable price-per-litre or VAT line, so a 'proof' version would leave its total empty.
Stakes if we pick wrong: Looser: a rare split payment fills a wrong, confident total. Stricter: Paz Afek-style slips stay empty and AC2 is not met.
Recommendation: A because it keeps what you approved, adds the tests the bench can't supply, and the off switch lets the bench measure the rule alone.
Completeness: A=9/10, B=8/10, C=7/10, D=6/10
Pros / cons:
A) Keep D6 + split tests + switch (recommended)
  ✅ AC2 met: Paz Afek reads <AC2 total>, as you approved in D6
  ✅ Synthetic card+cash, two-card and card+voucher rows prove the guards; the bench checks E4 on and off
  ❌ A split payment whose other half OCR fully lost still fills a partial total; listed in TD, watched in D12 (human: ~4 h / CC: ~25 min)
B) Require positive proof
  ✅ Never trusts absence: only litres x price or VAT-at-rate arithmetic confirms the slip
  ❌ Paz Afek stays empty (AC2 amended), and most garbled slips stay empty too
C) Drop E4 (MUT-514 rule)
  ✅ Zero new risk; MUT-514's guard unchanged
  ❌ AC2 unmet and amended; E1-E3 alone fix only slips printed twice
D) Keep D6 as approved
  ✅ No extra tests or switch to write
  ❌ The split-payment risk stays untested, and the bench can't separate E4 from T1-T3
Net: your D6 rule with the proof it lacked, vs. trading AC2 for zero split-payment risk.
Header: Lone slip 2
Options:
A) Keep D6 + split tests + switch (recommended)
D6 A unchanged; extract.test.ts rows for card+cash, two cards and card+voucher (refused); a switch to run the bench with E4 off; residual risk in TECH_DEBT and under MUT-514 D12.
B) Require positive proof
E4 only when litres x price per litre or VAT at the known rate equals the slip amount within rounding; AC2 amended if p07 can't confirm.
C) Drop E4 (MUT-514 rule)
No E4; total.ts:256 unchanged; AC2 amended (Paz Afek's total may stay empty, never wrong).
D) Keep D6 as approved
E4 with absence guards and the bench gate only.

State: approved
Actual answer: A) Keep D6 + split tests + switch (recommended), Basel, D8, 2026-11-03
Accepted scope: E4 as D6 A; extract.test.ts rows card+cash, two cards, card+voucher (all refused) plus the accept row; a bench-only switch to run with E4 off (ablation in T6; not a production setting); residual risk (a split payment whose other half OCR lost) in TECH_DEBT and under MUT-514 D12.
History: R4 answered D6 A.

### O3: the turn keep rule with tall boxes
Finding: Outside #4 High; reviewer: Claude Plan subagent; verified: rapidocr/utils/process_img.py:102-103 turns crops with h/w >= 1.5; rows.ts:48-61 groups by vertical overlap.
Plan baseline: D4 A: turned read kept only when its score >= 1.25x the first.
Runtime evidence: probe this session: syn-025 turned 270 scored 208 on the first read (RapidOCR read the tall crops), equal to upright 198-208, so a 1.25x test would keep the sideways read and its tall boxes.
Comparison grid:
| Choice | Current approved (D4 A) | A | B |
|---|---|---|---|
| O3 keep rule | keep turned when score >= 1.25x first | if the first read looks sideways (most boxes tall) and the turned read doesn't, keep the turn unless it scores < 0.8x the first; otherwise keep only when turned > 1.25x first and at least 20 more confident characters (strict: ties and 0-vs-0 keep the first) | as approved |
| D4 trigger, OSD, one re-read | approved | unchanged | unchanged |
Question D9:
D9 — Keep an upright re-read when the first read had tall, sideways boxes?
Project/branch/task: mini-crm main, planning MUT-540 (server receipt reading).
ELI10: RapidOCR turns tall text crops by itself, so a sideways photo turned one way can read almost as well as upright, but every box comes out tall. Our row builder then glues many printed lines into one row and the fields come out wrong. With the approved rule (keep the turn only if it reads 25% better), that sideways read would win. The fix: when the first read is sideways-shaped and the turned one isn't, prefer the turn unless it reads clearly worse, and make the 25% rule strict so a tie never flips a page.
Stakes if we pick wrong: Sideways photos in one of the two directions still come out as glued rows and wrong or empty fields.
Recommendation: A because box shape is the one signal RapidOCR's self-turning can't fake, and the strict tie rule stops pointless flips.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Shape-aware keep rule (recommended)
  ✅ Both sideways directions (90 and 270) come out upright with normal rows
  ✅ Strict > and a 20-character minimum gain: a tie or an empty-vs-empty page never flips
  ❌ Two more thresholds (0.8x, 20 chars) to tune on a small set; recorded in ADR-244 (human: ~2 h / CC: ~10 min)
B) Keep the approved 1.25x rule
  ✅ One threshold only
  ❌ A 270-degree photo can keep its tall-box read; rows glue together and fields come out wrong
Net: a box-shape check that fixes one sideways direction vs. a simpler rule that misses it.
Header: Keep rule
Options:
A) Shape-aware keep rule (recommended)
Sideways-shaped first read and upright-shaped turn: keep the turn unless < 0.8x the first. Otherwise keep only on > 1.25x and >= 20 more confident characters. Unit rows for each case.
B) Keep the approved 1.25x rule
Turned read kept only when its score >= 1.25x the first.

State: approved
Actual answer: A) Shape-aware keep rule (recommended), Basel, D9, 2026-11-03
Accepted scope: orientation keep rule: first read looks sideways (most boxes tall) and the turned read doesn't -> keep the turn unless its score < 0.8x the first; otherwise keep only when turned > 1.25x first and >= 20 more confident characters (ties and 0-vs-0 keep the first). Unit rows for each case; thresholds in config.py and ADR-244.
History: D4 answered A.

### O4: orientation inside the 30 s deadline
Finding: Outside #10 Medium; reviewer: Claude Plan subagent; verified: worker.py:113 `self._conn.send(("read", body, content_type, hint))` sends no deadline to the child; on expiry the child is killed and the answer is `timeout` (worker.py:115-119).
Plan baseline: D4 A: at most one OSD + one re-read per page (2 pages max), no deadline check.
Runtime evidence: worst case 2 x (read + OSD + re-read) with larger T2 images; a timeout loses the first read too.
Comparison grid:
| Choice | Current approved | A | B |
|---|---|---|---|
| O4 deadline guard | none | the worker passes the request's deadline to the child; Reader skips OSD and the re-read when the time left is under 2x the page's first read time, keeping the first read; skips counted in the log stats; unit test with a fake clock | none (bounded work only) |
Question D10:
D10 — Skip the orientation retry when the read is running out of time?
Project/branch/task: mini-crm main, planning MUT-540 (server receipt reading).
ELI10: Each receipt read has a hard 30-second limit. Past it, the reader process is killed and the receipt gets no reading at all. The orientation retry adds work to slow pages, and on a busy server two slow pages could push a read past the limit, losing even the first, partial reading. The guard checks the clock before retrying and keeps the first reading when time is short.
Stakes if we pick wrong: Without it, a rare slow two-page PDF can end with nothing read where today it reads something.
Recommendation: A because it can only turn a timeout into the first reading, never the reverse, and costs one clock check per page.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Deadline-aware retry (recommended)
  ✅ A retry can never cost the receipt its first reading
  ✅ Skips are counted in the logs, so the D12 production check sees how often it happens
  ❌ The worker's message to the reader process grows a deadline field (human: ~3 h / CC: ~15 min)
B) No guard
  ✅ No change to the worker protocol
  ❌ A slow two-page read can time out and lose a reading it would have had on main
Net: one clock check that makes the retry strictly safe vs. leaving a rare timeout path.
Header: Deadline
Options:
A) Deadline-aware retry (recommended)
Worker passes the deadline to the child; skip OSD + re-read when time left < 2x the page's first read; keep the first read; counted in log stats; fake-clock unit test.
B) No guard
Bounded work only (1 OSD + 1 re-read per page, 2 pages); no deadline check.

State: approved
Actual answer: A) Deadline-aware retry (recommended), Basel, D10, 2026-11-03
Accepted scope: worker.py sends the request deadline with the read; Reader skips OSD + re-read when time left < 2x that page's first read time and keeps the first read; `orientSkipped` counted in log stats; fake-clock unit test.
History: none

### O5: where the comma-decimal rule (E1) applies
Finding: Outside #7 Medium; reviewer: Claude Plan subagent; parent check: total.ts:183-197 builds `all` and `labelled` from moneyIn over every row; Section 2 #1 had moved E1 into normalizeText (all rows, PDF text layers too).
Plan baseline: T3 E1 as approved in the scope record: "a comma before exactly two digits, not part of a thousands group, reads as a decimal point" (all rows); Section 2 build note placed it in normalizeText.
Runtime evidence: Paz fuel receipts print quantities and unit prices (litres, price per litre); read with a comma they would become amounts that feed `confirmation` sums, `votedTotal` and `isSubtotal`.
Comparison grid:
| Choice | Current approved | A | B |
|---|---|---|---|
| O5 E1 reach | every row (normalizeText) | only rows with a total, card-slip, subtotal or VAT label, and money-only rows (E3's join candidates); other rows keep the comma as today; negative rows for "35,12 ליטר" and "7,31 ₪/ל" | every row, plus negative tests only |
| E3 join | approved | unchanged (O6 separate) | unchanged |
Question D11:
D11 — Read "<AC2 total, comma>" as <AC2 total> only on total-type and amount-only lines?
Project/branch/task: mini-crm main, planning MUT-540 (server receipt reading).
ELI10: OCR often reads a decimal point as a comma, so the fix reads '<AC2 total, comma>' as <AC2 total>. Applied to every line, though, a Paz receipt's '35,12 litres' and '7,31 per litre' would also become money. The total rules add and compare the amounts they see, so stray numbers can confirm a wrong total or knock out a right one. Limiting the rule to total, slip, subtotal and VAT lines, plus lines that hold only an amount, covers Paz Afek without touching quantities.
Stakes if we pick wrong: Everywhere: fuel and weight lines feed the total arithmetic and can flip totals main reads right.
Recommendation: A because it fixes the case we saw and keeps quantity lines out of the arithmetic MUT-514 tuned.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Labelled and amount-only lines (recommended)
  ✅ Paz Afek's <AC2 total, comma> (an amount-only line under its label) reads as <AC2 total>
  ✅ Litres, weights and unit prices stay out of the total arithmetic, as on main
  ❌ A comma-decimal item price on an ordinary line stays unread, as today (human: ~2 h / CC: ~10 min)
B) Every line, with negative tests
  ✅ One rule in one place (normalizeText)
  ❌ Quantities become amounts on every Paz receipt; the bench may or may not catch the flips
Net: a targeted rule that can't disturb quantity lines vs. a global one that can.
Header: Comma rule
Options:
A) Labelled and amount-only lines (recommended)
E1 applies on total / card-slip / subtotal / VAT rows and money-only rows only; elsewhere the comma stays; negative rows for litres and price-per-litre lines.
B) Every line, with negative tests
E1 in normalizeText for all rows and PDF text; negative tests added.

State: approved
Actual answer: A) Labelled and amount-only lines (recommended), Basel, D11, 2026-11-03
Accepted scope: E1 applies only on rows with a TOTAL / CARD_SLIP / SUBTOTAL / VAT keyword and on money-only rows (E3's candidates); elsewhere the comma stays as on main; negative rows for a litres line and a price-per-litre line. Supersedes Section 2 #1's placement in normalizeText.
History: none

### O6: the label/next-row join takes one amount
Finding: Outside #8 Medium; reviewer: Claude Plan subagent; parent check: amounts.ts NOT_MONEY strips `18%`, so a VAT table row `18% 217.58 39.16 <AC2 total>` becomes money-only.
Plan baseline: T3 E3: label row with no money + directly following money-only row (gap <= 1.5 row heights) -> one row.
Runtime evidence: a VAT-table header (מע"מ | לפני מע"מ | סה"כ) followed by its numbers row would join into one row labelled TOTAL+SUBTOTAL+VAT holding three amounts.
Comparison grid:
| Choice | Current approved | A | B |
|---|---|---|---|
| O6 join condition | next row money-only | next row money-only and holds exactly one amount (after NOT_MONEY); a negative row for the VAT-table case | as approved |
| O5 E1 reach | approved A (D11) | unchanged | unchanged |
Question D12:
D12 — Join a label with the line below only when that line holds exactly one amount?
Project/branch/task: mini-crm main, planning MUT-540 (server receipt reading).
ELI10: The fix for Paz Afek glues a label line ('סכום עסקה') to the amount on the line below it. A VAT table has a header line of labels (VAT, before VAT, total) and a line of three numbers under it, so the same rule would glue them into one confusing line with every label and three amounts. Requiring exactly one amount on the lower line keeps the Paz case and skips tables.
Stakes if we pick wrong: VAT tables get scrambled into one row, which can fill a wrong total or VAT.
Recommendation: A because a single amount is exactly the label-then-value layout we're fixing, and tables are left as main reads them.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Exactly one amount (recommended)
  ✅ Paz Afek's label + <AC2 total, comma> still joins
  ✅ VAT tables and multi-column rows stay as main reads them
  ❌ A label above two amounts (e.g. amount and its currency twin) won't join (human: ~1 h / CC: ~5 min)
B) Any money-only line
  ✅ Joins more layouts
  ❌ VAT tables join into one row with three labels and three amounts
Net: a one-amount guard that keeps tables intact vs. a looser join that scrambles them.
Header: Join guard
Options:
A) Exactly one amount (recommended)
E3 joins only when the next row is money-only and holds exactly one amount; negative row for the VAT-table header + numbers.
B) Any money-only line
E3 as approved: any money-only next row joins.

State: approved
Actual answer: A) Exactly one amount (recommended), Basel, D12, 2026-11-03
Accepted scope: E3 joins only when the next row is money-only and holds exactly one amount (after NOT_MONEY); negative row for a VAT-table header + its numbers row.
History: none

Cross-model tension: the parent and the outside voice agree on the plan's direction (orientation by OSD on poor reads, extractor fixes for p07). The outside voice disagreed on T2's mechanism (now O1), E4's evidence (O2, D6 kept with tests and a switch, Basel), the keep rule (O3), the deadline (O4) and E1/E3 reach (O5/O6). All are resolved by Basel's answers; no disagreement remains open.

TODOS.md updates: none proposed. Residual risks are TECH_DEBT rows inside T6: the lone-slip split-payment case (D8), upside-down pages scoring >= 80 that aren't turned, and thresholds tuned on a small set (#11).

Approval readiness: PASS — R1 (D3 A), R2 (D4 A), R3 (D5 A), R4 (D6 A, refined by O2 D8 A), O1 (D7 A), O3 (D9 A), O4 (D10 A), O5 (D11 A), O6 (D12 A); scope D1 A, structure D2 A. Every accepted remedy cites its own answer.

## Final plan (approved), for /eng-build
Branch from local main (now 34ee9650, at or after 6d0c4946), one worktree, disk gate >= 20 GB first.

**T0 — Production receipts (R1/D3).** Read-only `gcloud storage cp` (account barmajiyatltd@gmail.com) of the 6 receipts into receipt-bench; truth by eye in manifest.json (with backup); never committed, logged or pasted.
**T1 — Orientation (R2/D4, O3/D9, O4/D10).**
- New `server/ocr/app/orientation.py`, with scores taken from the merged output:
  - `confident_chars`
  - `looks_sideways`
  - `needs_turn` (< 80 chars or tall)
  - `propose_turn` (OSD `--psm 0`; TesseractError → None)
  - `keep_turn`: a sideways first read beside an upright turn keeps the turn unless it scores < 0.8×; otherwise keep only when it scores > 1.25× and has ≥ 20 more characters.
- `pipeline.py`: per page, at most one OSD call and one re-read, skipped when the time left is under 2× that page's first read. The page offset uses the turned height.
- Logs (counts only): `turned`, `orientMs`, `orientSkipped`.
- `worker.py` passes the deadline to the child.
- `config.py`: MIN_CONFIDENT_CHARS, TURN_GAIN, SIDEWAYS_KEEP, MIN_TURN_GAIN_CHARS and `OCR_ORIENTATION`.
- `fetch_models.py` + `check_licenses.py` + LICENSES.md: osd.traineddata in every variant folder (pin the file `--psm 0` runs with), sha256, Apache-2.0 row. The TesseractReader start-up check lists it.
- Tests:
  - test_units: fake-reader rows for every branch.
  - test_golden: syn-025, syn-009 and syn-001 turned 90 and 270 read their total and date; an upright read makes no OSD call.
**T2 — PDF pages (D1 + O1/D7).**
- Flat pages only. `page.render` stays at 300 dpi (no get_bitmap).
- The flat-page `fit_size` is bounded by area at 6.25 MP, and RapidOCR's `max_side_len` is raised for those pages.
- `OCR_MAX_WORK_PIXELS` (0 = main's sizing).
- Tests:
  - a tall flat page keeps its native width;
  - a 4000×4000 flat page is still bounded;
  - photos are unchanged (test_units.py:211 stays).
- Bench-gated.
**T3 — Extractor (E1 D11, E2 + #14, E3 D12, E4 D6/D8).**
- E1: a comma before 2 digits is a decimal, only on total, slip, subtotal and VAT rows and on money-only rows.
- E2: the geresh fold, except after ג ז צ ת ח ד ט ר.
- E3: a label row joins the next row when that row is money-only with exactly one amount (gap ≤ 1.5 row heights).
- E4: a lone slip guarded by its absence rules, plus a bench-only off switch.
- Rows in extract.test.ts, "MUT-540: …":
  - accept: the Paz slip;
  - negatives: 1,234; litres; price per litre; ג'ינס; item row; far amount; label with its own amount; VAT-table header; card+cash; two cards; card+voucher; change row; another labelled total.
**T4 — Trace Beit Jala and Abu Shukri.** On the fetched images, find whether OCR or the extractor drops each field; fix inside this ticket. Any new rule gets synthetic rows and stays under the gate.
**T5 — Generation 3 (R3/D5).** Set reader.ts:62 to 3 and update the stamp tests. before-release.md: sidecar image first, then the API (#9); after full roll-out, `receipts:reread -- --reader-below 3`, a dry run before `--apply`.
**T6 — Gate and docs.**
- Heavy on :8197 (check it's free with lsof first):
  - a main baseline, then the branch, back to back, with `--compare`;
  - ablations: T2 off (`OCR_MAX_WORK_PIXELS=0`), E4 off, `OCR_ORIENTATION=0`.
- Gate:
  - no field lost;
  - wrong-and-confident not up;
  - synthetic 0 wrong;
  - warm p95 < 5 s, reported with the load.
- Run the two-subagent pre-landing review.
- Docs: ADR-244, CHANGELOG, TEST_PLAN, TECH_DEBT (the 3 residual risks), SYSTEM_OVERVIEW and before-release.md.

## NOT in scope
- MUT-539 (phone Scan crops edges): Flutter, planned in its own session.
- MUT-541 (learning from approvals), MUT-490 (QR): their own tickets.
- An upside-down page that still scores ≥ 80 confident characters is not turned. It's recorded in TECH_DEBT; no evidence any such page exists yet.
- Bench split-payment receipts: none on disk. Synthetic rows (D8) stand in; real ones come through MUT-541's approvals export.

## What already exists
- `fields.ts:39` `readRegistration` already reads "label row or the next": the precedent for E3.
- MUT-514's bench `--compare` per-field gate (D8) and `receipts:reread --reader-below` are reused as they are.
- `normalize.ts:13` `ARABIC_COMMA_DECIMAL` is the existing comma rule. E1 reuses its shape but runs only on labelled and money-only rows (D11).
- `TesseractReader`'s TESSDATA_PREFIX handling (engines.py:85) is reused for OSD; no second Tesseract wrapper.

## Diagram (page read with orientation)
```
page ─▶ prepare ─▶ read (rapid ∥ tess) ─▶ merge ─▶ first
                                             │
                 needs_turn(first)? ──no────▶ keep first
                     │yes
     time left ≥ 2×first read? ──no──▶ keep first (orientSkipped++)
                     │yes
           OSD propose_turn ──None/0──▶ keep first
                     │90/180/270
            rot90 ─▶ read ─▶ merge ─▶ turned
                     │
            keep_turn(first, turned)? ──yes──▶ turned (turned++)
                                      └─no──▶ first
```

## Failure modes
- OSD model missing in the image: start-up check fails loudly; the AC7 licence test and the image build catch it. Not silent.
- OSD wrong on a poor page: keep_turn discards it. Silent but harmless; counted.
- Time short: the retry is skipped and the first read kept. Counted (`orientSkipped`).
- E4 on a split payment with a lost second half: confident partial total. Covered by synthetic guards; residual in TECH_DEBT; watched in MUT-514 D12. Not silent to the reviewer, since the person sees the amount on review.
- T2 slows tall PDFs: the bench's tessMs/rapidMs p95 and the ablation run catch it; `OCR_MAX_WORK_PIXELS=0` reverts.
Critical gaps: 0.

## Worktree parallelization strategy
| Step | Modules touched | Depends on |
|------|----------------|------------|
| T1 orientation | server/ocr/app, server/ocr (models, licences) | — |
| T2 PDF pages | server/ocr/app (decode, preprocess, engines) | — (shares server/ocr/app with T1) |
| T3 extractor | server/src/receipts/extract | — |
| T4 trace | depends on what it finds | T0, T1–T3 |
| T5 generation | server/src/receipts/reading, docs | — |
| T6 gate | bench, docs | T1–T5 |
Sequential implementation in one worktree: T1 and T2 share server/ocr/app, every step meets in one bench gate, and the build is one branch. No parallel lanes.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T0 (P1, human: ~30min / CC: ~5min)** — bench — fetch the 6 production receipts read-only, truth by eye
  - Surfaced by: R1 / D3
  - Files: ~/Work/Barmajiyat/Mutaba3a/receipt-bench (outside repo)
  - Verify: manifest has 54 rows; nothing under the repo changed
- [ ] **T1 (P1, human: ~2d / CC: ~2h)** — ocr — orientation module, OSD model, deadline guard, keep rule
  - Surfaced by: R2/D4, O3/D9, O4/D10, Section 1 #2–#3, outside #12–#13
  - Files: server/ocr/app/{orientation,pipeline,worker,config,engines}.py, server/ocr/{fetch_models,check_licenses}.py, server/ocr/LICENSES.md, server/ocr/tests/{test_units,test_golden}.py
  - Verify: `server/ocr/.venv/bin/python -m pytest server/ocr/tests` (through heavy)
- [ ] **T2 (P2, human: ~1d / CC: ~1h)** — ocr — flat-page area bound + RapidOCR cap + switch
  - Surfaced by: D1, O1/D7
  - Files: server/ocr/app/{preprocess,engines,pipeline,config}.py, server/ocr/tests/test_units.py
  - Verify: pytest, then the bench with and without OCR_MAX_WORK_PIXELS
- [ ] **T3 (P1, human: ~1d / CC: ~1h)** — server — extractor E1–E4 with synthetic rows
  - Surfaced by: planning finding 2, R4/D6, O2/D8, O5/D11, O6/D12, outside #14
  - Files: server/src/receipts/extract/{rows,normalize,amounts,total,keywords}.ts, __tests__/extract.test.ts
  - Verify: `npm --prefix server test -- src/receipts/extract` (heavy, --maxWorkers=3)
- [ ] **T4 (P1, human: ~1d / CC: ~1h)** — ocr/server — trace and fix Beit Jala and Abu Shukri
  - Surfaced by: planning finding 3
  - Files: TBD by trace
  - Verify: the bench rows for those two
- [ ] **T5 (P2, human: ~30min / CC: ~5min)** — server — generation 3 + release order
  - Surfaced by: R3/D5, outside #9
  - Files: server/src/receipts/reading/reader.ts, its tests, docs/operations/before-release.md
  - Verify: server tests
- [ ] **T6 (P1, human: ~1d / CC: ~1h)** — gate/docs — bench + ablations, review, ADR-244 and knowledge files
  - Surfaced by: Section 4 #1, O2/D8, outside #6, #11
  - Files: .claude/{DECISIONS,CHANGELOG,TEST_PLAN,TECH_DEBT,SYSTEM_OVERVIEW}.md, .claude/designs/mut-540-*.md
  - Verify: `run.py --label mut540 --real-detail --port 8197 --compare <main>` exits 0; server typecheck/lint/openapi:check/test
(JSONL task artifact not persisted: `gstack-tasks prior` lists another ticket's open list (MUT-402, run 20261023T103409Z-48225) on the shared branch name `main`, and adding a list would retire it.)

## Unresolved decisions
None.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (T2 kept, bench-gated; structure A)
- Reality rows: 7/7 applicable rows emitted, 0 unverified premises
- Architecture Review: 3 issues found (1 critical, resolved by D6/D8)
- Code Quality Review: 3 issues found
- Test Review: diagram produced, 23 gaps identified (all assigned to T1–T3)
- Performance Review: 2 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Claude Plan subagent (native fallback; Codex CLI not installed), completed, 15 findings, 6 choices asked (D7–D12)
- Parallelization: 0 lanes, 0 parallel / 6 sequential
- Lake Score: 7/11

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native fallback via `/plan-eng-review` (Codex not installed) | Independent 2nd opinion | 1 | unavailable (outside); native completed | 15 findings, 6 decisions (D7–D12) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved) | 31 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — (no UI) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review, unavailable (CLI not installed); a native Claude Plan subagent completed within the 5-minute bound with 15 findings. It gives no outside credit.
- **VERDICT:** Eng review complete with every finding resolved by Basel's answers (D1–D12). Status is issues_open because findings were found and mapped to tasks, not because anything is undecided. Ready to implement with /eng-build.

NO UNRESOLVED DECISIONS

---
# Build outcome (2026-11-03, branch claude/mut-540-reading-misses)

- **Shipped:** T1 orientation (D4/D9/D10, plus re-preparing the turned page), T3 E1–E4 (D6/D8/D11/D12), T5 generation 3 (D5); T4's trace found three sidecar causes, fixed: the perspective warp tilting a receipt cut by the frame and torn on a slant (Maxi), PP-OCR's Arabic model dropping a line's amount (Beit Jala), Hebrew-page dates inside RapidOCR boxes with invented letters (Abu Shukri).
- **Dropped:** T2 (D1/D7 gate): 31 fields lost against main, wrong-and-confident up.
- **Pre-landing review** (specialist + adversarial subagents): 7 + 12 findings, every reproducible break fixed with a test (ADR-244, CHANGELOG).
- **Bench gate:** 0 fields lost against main; real total 34 (main 32), date 34 (32), registration no. 13 (11), wrong-and-confident 7 (7); synthetic as main, warm p95 1.14 s. Ablations: E4 off loses Paz Afek's total; orientation off loses the Maxi date.
- **ACs:** AC1 Maxi date and registration no. read, its total not (the photo cuts the total column's decimals; the slip amount isn't in the OCR at all); AC2 Paz Afek reads its slip total; AC3 Beit Jala reads its total in ILS; AC4 Abu Shukri reads its date, its total empty (allowed), never wrong; AC5 gate met; AC6 synthetic unit tests per pattern.
