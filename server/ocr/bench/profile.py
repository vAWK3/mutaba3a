"""MUT-441 benchmark: where a read's time goes, stage by stage, in this process (no HTTP, no worker process).

    server/ocr/.venv/bin/python server/ocr/bench/profile.py [--threads N] [--only id,id]

Prints per fixture: decode, prepare, RapidOCR detection and recognition (RapidOCR's own elapse), each Tesseract pass
with its language, and the image size. Timings only; no text.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path

OCR_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(OCR_DIR))

from bench.run import CONTENT_TYPES, DEFAULT_FIXTURES, LANG_GROUP, hint_for  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)
    ap.add_argument("--threads", type=int, default=None)
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    if args.threads:
        os.environ["OCR_THREADS"] = str(args.threads)

    import cv2

    from app.config import load_settings
    from app.decode import decode
    from app.pipeline import Reader, dominant_script, _TESS_LANG
    from app.preprocess import prepare

    reader = Reader(load_settings())
    reader.warm_up()
    manifest = json.loads((args.fixtures / "manifest.json").read_text(encoding="utf-8"))["fixtures"]
    wanted = set(filter(None, args.only.split(",")))
    rows = []
    for f in manifest:
        if wanted and f["id"] not in wanted:
            continue
        path = args.fixtures / f["file"]
        item = {"path": path}
        t = time.perf_counter()
        decoded = decode(path.read_bytes(), CONTENT_TYPES[path.suffix])
        dec = (time.perf_counter() - t) * 1000
        if decoded.pdf_text is not None:
            continue
        page = decoded.pages[0]
        t = time.perf_counter()
        gray = prepare(page, hint_for(item) or "photo", flat=decoded.flat)
        prep = (time.perf_counter() - t) * 1000
        res = reader.rapid._engine(cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR))
        det, _cls, rec = (res.elapse_list + [None, None, None])[:3]
        t = time.perf_counter()
        first = reader.tess.read(gray, "ara+heb+eng")
        t1 = (time.perf_counter() - t) * 1000
        script = dominant_script(first)
        t2 = 0.0
        if script in _TESS_LANG:
            t = time.perf_counter()
            reader.tess.read(gray, _TESS_LANG[script])
            t2 = (time.perf_counter() - t) * 1000
        n_boxes = 0 if res.boxes is None else len(res.boxes)
        row = {
            "id": f["id"], "lang": LANG_GROUP[f["lang"]], "size": f"{gray.shape[1]}x{gray.shape[0]}", "in": f"{page.shape[1]}x{page.shape[0]}",
            "decode": dec, "prepare": prep, "det": (det or 0) * 1000, "rec": (rec or 0) * 1000, "boxes": n_boxes,
            "tess1": t1, "tess2": t2, "script": script, "load1": os.getloadavg()[0],
        }
        rows.append(row)
        print(json.dumps({k: (round(v) if isinstance(v, float) else v) for k, v in row.items()}))
    for lang in ("ar", "he", "en"):
        sel = [r for r in rows if r["lang"] == lang]
        if sel:
            means = {k: round(statistics.mean(r[k] for r in sel)) for k in ("prepare", "det", "rec", "tess1", "tess2")}
            print(lang, len(sel), means)
    return 0


if __name__ == "__main__":
    sys.exit(main())
