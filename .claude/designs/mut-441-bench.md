# MUT-441 benchmark: server receipt reading (AC1, AC6)

2026-10-28. Plan task 8 of `.claude/designs/mut-441-server-ocr.md`. Aggregate numbers only; no receipt text.

## Verdict

- **AC1 passes on the synthetic set** for photos in all three languages (amount and date both 85% or more per language). The small samples leave wide intervals, and the Hebrew bar stays provisional until real receipts are scored.
- **AC6 warm p95 is about 1.2–1.35 s locally** after tuning, against the 5 s bar. Cloud Run's vCPUs are slower than this Mac's cores, so the real figure has to be measured after MUT-487 (see below). Cold start is reported separately.
- **Wrong-and-confident: 0** across all kinds. The last one, a vendor name with reversed letters from an Arabic PDF's text layer, is fixed in the sidecar (see below).
- **Real receipts:** `~/Work/Barmajiyat/Mutaba3a/receipt-bench/` doesn't exist yet, so none have been read or scored and no draft manifest was written.

## Method

- **Runner:** `server/ocr/bench/run.py` (no Docker).
  1. It starts the sidecar the way `run_local.sh` does: uvicorn on 127.0.0.1:8090 with the production `ProcessWorker`.
  2. It times process start to `/healthz` 200, then the first read ("cold").
  3. It sends every fixture one at a time and times each round trip. Photos and screenshots get the hint `photo`, the way a gallery pick or a portal upload arrives; PDFs get no hint.
  4. It pipes each response through the API's own extractor (`server/src/scripts/receipt-bench-extract.ts` → `extractReceipt`, `MIN_FIELD_CONFIDENCE` 0.6).
- **Scoring:**
  - Amount (`totalMinor`), date and currency must match exactly. Vendor name is a loose match: after folding, one name contains the other or they are at least 80% similar.
  - **Wrong-and-confident** counts any filled field that is wrong, across all nine fields. The extractor only fills a field at or above 0.6, so every filled field is a confident one. An empty field doesn't count.
  - A receipt in a currency the API doesn't take (SAR) must leave the currency empty, so it is scored as "should be absent".
- **Inputs:**
  - The 50 synthetic MUT-253 fixtures, read from the Flutter repo by path. Scope groups follow the spike: ar+en counts as Arabic and he+en as Hebrew.
  - "Photos" is AC1's and the spike's scope: ar 14, he 12, en 6.
  - "All kinds" adds screenshots, text-layer PDFs and image PDFs.
- **Machine:** a shared Apple-silicon Mac with 11 cores, Tesseract 5.5.3, Python 3.12, onnxruntime 1.31.1. Other sessions were running, so the 1-minute load average is recorded with each timing. Timings are indicative only.
- `bench/profile.py` splits a read into its stages in one process.
- `--rescore` re-runs only the extractor over a saved run, which is how extractor changes were measured.

## Accuracy

Photos, amount / date (Wilson 95% interval in brackets). Spike baseline from `docs/spikes/mut-253-ocr-engine.md`, "+arith" scoring:

| Lang | Spike: Android (PaddleOCR + Tesseract) | Server before (baseline) | **Server after** |
|---|---|---|---|
| ar (n=14) | 85.7 / 78.6 | 43 / 86 | **86 [60–96] / 86 [60–96]** |
| he (n=12) | 92 → 100 / 100 | 92 / 92 | **92 [65–99] / 92 [65–99]** |
| en (n=6) | 100 / 100 | 100 / 100 | **100 [61–100] / 100 [61–100]** |

The spike's extractor was a deliberately simple Dart baseline, so the columns compare the pipelines, not like for like. The spike's Android Arabic date (78.6%) missed the bar; the server's 86% passes it.

| Final run, photos | Amount | Date | Currency | Vendor | Wrong & confident |
|---|---|---|---|---|---|
| ar | 12/14 | 12/14 | 9/12 | 14/14 | 0 |
| he | 11/12 | 11/12 | 9/12 | 11/12 | 0 |
| en | 6/6 | 6/6 | 6/6 | 6/6 | 0 |

| Final run, all kinds | Amount | Date | Currency | Vendor | Wrong & confident |
|---|---|---|---|---|---|
| ar (n=22) | 19/22 (86%) | 17/22 (77%) | 13/18 | 22/22 | 0 |
| he (n=18) | 17/18 (94%) | 16/18 (89%) | 14/18 | 17/18 | 0 |
| en (n=10) | 10/10 | 10/10 | 10/10 | 10/10 | 0 |

**Before the extractor fixes:** Arabic photo amounts were 6/14, with 4 wrong-and-confident fields on photos (3 totals, 1 VAT) and 9 across all kinds. The misses clustered in four places, and each one is fixed with a test written first:

1. **The Arabic comma as the decimal point.** PP-OCR prints the ٫ mark as `،` between digits. It is now read as a decimal point; a listing comma, followed by a space, is left alone.
2. **A lost decimal point.** OCR read "15.01" as `15001` and "108.84" as `108084`, and the extractor filled those as whole units with confidence. Now a bare integer is never money on a receipt that prints any decimal amount, so those receipts stay empty.
3. **A subtotal whose label OCR misread.** When `المجموع الفرعي` is misread, the subtotal looks like a second total. A total-labelled amount that a larger one equals plus another printed amount (the VAT, a charge) is now treated as the subtotal.
4. **Dinars with a mangled currency.** OCR misreads the dinar's word or sign ("دينان", "(د.)"). A receipt that names no currency at all, not even one the API doesn't take, and prints three or more amounts, every one with three decimals, is now read as **JOD** (rule 0.8). JOD is the only three-decimal currency the API takes. A single three-decimal amount, as in the old "not guessed" test, still isn't enough. **This is a product rule Basel should confirm** (see open questions).

**Still missing (left empty, never wrong):**
- **Arabic:** one Arabic-Indic receipt has a lost decimal point, so its total stays empty. Two photos where RapidOCR dropped the day digit of a written-month date ("يوليو 2025") have no date.
- **Hebrew:** one total and one date stay empty.
- **Currency:** misses are mostly `₪` misread by RapidOCR ("(c)", "(0)"). Currency isn't part of AC1.

## Speed (AC6)

Where the time went at the baseline (profile, load ≈ 6, mean ms): preprocess 15, RapidOCR detection 600–700, RapidOCR recognition 650–820, Tesseract script pick (full-page `ara+heb+eng`) 800–900, Tesseract second pass 560–760 for Arabic and Hebrew. All of it ran one stage after another.

The earlier Docker figure ("English slowest at about 13 s, every line read by both engines") didn't reproduce natively. English was the fastest language here, because a Latin page skipped the second Tesseract pass. The Docker numbers were most likely emulation and load.

Each variant ran on all 50 receipts. Warm OCR reads n=44 (the 6 text-layer PDFs are excluded).

| Variant | Load (1-min, mean) | p50 ms | p95 ms | Accuracy vs baseline |
|---|---|---|---|---|
| Baseline: serial, `OCR_THREADS=2` | 14.4 | 3652 | 5606 | — |
| Serial, 4 threads | 11.5 | 2715 | 6363 | same |
| (b′) Tesseract beside RapidOCR, 3+1 threads | 11.8 | 1453 | 2118 | same |
| + (a′) script pick at half size, then one full `<script>+eng` / `eng` pass | 10.4 | 960 | 1211 | same |
| + (c) never upscale | 8.8 / 7.1 | 655–721 | 876–971 | **Arabic dates 12/14 → 6/14**, wrong-and-confident 0 → 2: rejected |
| `tessdata_best` instead of fast (chosen config) | 6.0 | 1518 | 2112 | Hebrew amount and date 92 → 83, 1 wrong phone: rejected, fast stays |
| **Chosen, final run 1** | 5.9 | 963 | 1350 | — |
| **Chosen, final run 2** | 5.3 | 947 | 1194 | — |
| **Chosen + PDF text fix, final run 3** | 5.6 | 887 | 1111 | — |

How this maps to the brief's three options:
- **(a)** Running Tesseract only on Hebrew or low-confidence lines doesn't fit this pipeline. Tesseract reads whole pages, not RapidOCR's lines, and on Arabic pages it is what recovers the date digits that RapidOCR drops. Making Tesseract's own passes cheaper (a′) got the gain without losing those dates.
- **(b)** Thread count alone didn't help much under load. Running the two engines concurrently (b′) did.
- **(c)** Skipping the upscale was rejected, as the table shows.

**Chosen** (Settings defaults, each with an env override and unit tests; a golden test checks the tuned reader against the MUT-253 rule):

| Setting | Default | Env |
|---|---|---|
| RapidOCR ONNX threads | 3 (Tesseract takes the 4th of 4 vCPU) | `OCR_THREADS` |
| Tesseract beside RapidOCR | on | `OCR_PARALLEL` |
| Script-pick scale | 0.5 | `OCR_SCRIPT_PICK_SCALE` |
| Upscale below short side | 1000 px (unchanged) | `OCR_UPSCALE_BELOW` |
| Tesseract models | fast (unchanged) | `OCR_TESSDATA` |

**Cold start (local):** process start to ready in 1.5 s, then a first read of 1.0–1.2 s. It is fast here because the models are on local disk and Python is warm in the page cache. On Cloud Run, image pull, gen2 sandbox start and model load add to it; the plan's estimate is 12–18 s with the startup CPU boost. Measure it there.

## Cost per 1,000 reads (AC6, list-price estimate)

The service is billed per request (`cpu_idle = true`): 4 vCPU and 4 GiB for each request's duration, rounded up to 100 ms.

```
cost / 1,000 reads = 1,000 × t × (4 × P_vCPU-s + 4 × P_GiB-s) + 1,000 × P_request
```

Assumed list prices (Cloud Run request-based billing, USD): Tier 1 regions P_vCPU-s = $0.000024 and P_GiB-s = $0.0000025; Tier 2 regions $0.0000336 and $0.0000035; P_request = $0.40 per million. Check which tier me-west1 is on the Cloud Run pricing page before quoting. The monthly free tier is ignored.

| t, warm seconds per read | Tier 1 | Tier 2 |
|---|---|---|
| 1.0 (local p50 after tuning) | $0.11 | $0.15 |
| 1.5 (local p95 after tuning, rounded up) | $0.16 | $0.22 |
| 3.0 (if Cloud Run's vCPUs are about 2× slower) | $0.32 | $0.45 |
| 5.0 (the AC6 ceiling) | $0.53 | $0.74 |

A cold start adds roughly its duration × 4 vCPU at the same prices, about $0.002 to $0.003 each at 15 s, and is paid only after idle spells. Cloud Tasks is free at this volume. The API's own instance waits on the read too; it is small (1 vCPU) and already billed per request.

## Still to measure on real Cloud Run (after MUT-487)

1. Warm p50 and p95 on `receipt-ocr` itself, 4 vCPU and 4 GiB, from the API's job route timings (the sidecar logs `rapidMs`, `tessMs` and `totalMs` per read). These decide AC6, and the cost row to quote.
2. Cold start: the first read after the service has scaled to zero, with `startup_cpu_boost`.
3. Whether 3+1 threads is still right on Cloud Run's vCPUs: try `OCR_THREADS=4` with `OCR_PARALLEL=1` (they would oversubscribe slightly).
4. The real receipts: drop them in `~/Work/Barmajiyat/Mutaba3a/receipt-bench/` and run `bench/run.py`. It writes `manifest.draft.json` there for correction; once renamed to `manifest.json`, the next run scores them as aggregates only. The Hebrew bar is provisional until then.

## The Arabic text-layer PDF fix

Chromium's Arabic PDF text layer keeps the words in logical order but writes some words' letters in visual order (`ةيلديص الشفاء` for `صيدلية الشفاء`). The other words in the same line are logical, so a whole-line reorder would break the correct ones.

`app/text.py pdf_text_to_logical` treats a layer as visual only on hard evidence: an Arabic word that starts with ة or ى, letters that only ever end a word. Then each word that looks reversed goes through the same `visual_to_logical` reorder RapidOCR's lines get. A word looks reversed when it starts with one of those letters, or ends in a reversed article `لا` and is at least 5 letters long, so a real word like `أهلا` stays.

A logical layer is unchanged. Tests are in `tests/test_units.py`. Result: vendor names on Arabic text-layer PDFs are now 22/22 across all kinds, with wrong-and-confident at 0.

## Open questions (resolved)

- **JOD inference (fix 4): resolved, kept as built.** Basel confirmed the rule on 2026-10-28; the coordinator relayed his decision. A receipt that names no currency at all, with three or more amounts that all have three decimals, is read as JOD (rule 0.8). On this set it fills five Arabic photos whose dinar word or sign OCR mangled, at confidence 0.65–0.76; without it, Arabic amounts would be 7/14 (50%). A receipt that names any currency, supported or not, is never guessed.
- **The reversed vendor name from an Arabic text-layer PDF: resolved, fixed** (section above).
