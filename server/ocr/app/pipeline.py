"""One receipt in, text lines out: decode → prepare → read with both engines → keep the better reading per line.

Tesseract runs the MUT-253 spike's script-picked strategy: one `ara+heb+eng` pass, on the page scaled by
`script_pick_scale`, picks the page's script, and a full-size pass reads with `<script>+eng` (`eng` for a Latin page).
RapidOCR reads every page, while Tesseract runs beside it (`parallel`). The MUT-441 benchmark chose both.

Logging: counts and timings only (AC5). No line text, no decoder message, ever.
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import numpy as np

from .config import Settings
from .decode import decode
from .engines import RapidReader, Segment, TesseractReader
from .merge import merge
from .preprocess import prepare
from .text import script_of

log = logging.getLogger("receipt_ocr.pipeline")

ENGINE_OCR = "rapid-tess"
ENGINE_PDF_TEXT = "pdf-text"
#: Contract bounds (OcrResultSchema in server/src/receipts/ocr-client.ts).
MAX_LINES = 5_000
MAX_LINE_CHARS = 2_000
MAX_PDF_TEXT = 200_000

_TESS_LANG = {"arab": "ara+eng", "hebr": "heb+eng"}


def dominant_script(segments: list[Segment]) -> str:
    """`arab` or `hebr` when the page has more of those letters than none, else `latn` (the spike's rule)."""
    arab = hebr = 0
    for seg in segments:
        script = script_of(seg.text)
        n = sum(ch.isalpha() for ch in seg.text)
        if script == "arab":
            arab += n
        elif script == "hebr":
            hebr += n
    if arab == 0 and hebr == 0:
        return "latn"
    return "arab" if arab >= hebr else "hebr"


class Reader:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.rapid = RapidReader(settings)
        self.tess = TesseractReader(settings)
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tesseract")

    def _read_tess(self, gray: np.ndarray) -> tuple[tuple[str, list[Segment]], int]:
        """The page's script and Tesseract's reading of it, and how long that took (ms)."""
        t = time.perf_counter()
        scale = self.settings.script_pick_scale
        if scale >= 1:
            first = self.tess.read(gray, "ara+heb+eng")
            script = dominant_script(first)
            tess = self.tess.read(gray, _TESS_LANG[script]) if script in _TESS_LANG else first
        else:
            import cv2

            small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            script = dominant_script(self.tess.read(small, "ara+heb+eng"))
            tess = self.tess.read(gray, _TESS_LANG.get(script, "eng"))
        return (script, tess), _ms(t)

    def warm_up(self) -> None:
        """Load both models now (RapidOCR loads its recogniser on first use), so the first receipt isn't the slow one."""
        blank = np.full((64, 256), 255, dtype=np.uint8)
        blank[24:40, 32:224] = 0
        self.rapid.read(blank)
        self.tess.read(blank, "eng")

    def read(self, body: bytes, content_type: str, hint: str) -> dict[str, Any]:
        started = time.perf_counter()
        decoded = decode(body, content_type)
        decode_ms = _ms(started)
        if decoded.pdf_text is not None:
            log.info("read", extra={"stats": {"engine": ENGINE_PDF_TEXT, "pages": decoded.page_count, "chars": len(decoded.pdf_text), "decodeMs": decode_ms}})
            return {"engine": ENGINE_PDF_TEXT, "lines": [], "pdfText": decoded.pdf_text[:MAX_PDF_TEXT], "pages": decoded.page_count}

        lines: list[dict[str, Any]] = []
        offset = 0.0
        timings = {"decodeMs": decode_ms, "prepareMs": 0, "rapidMs": 0, "tessMs": 0}
        scripts: list[str] = []
        for page in decoded.pages:
            t = time.perf_counter()
            gray = prepare(page, hint, flat=decoded.flat, upscale_below=self.settings.upscale_below)
            timings["prepareMs"] += _ms(t)
            if self.settings.parallel:
                pending = self._pool.submit(self._read_tess, gray)
                t = time.perf_counter()
                rapid = self.rapid.read(gray)
                timings["rapidMs"] += _ms(t)
                (script, tess), tess_ms = pending.result()
            else:
                t = time.perf_counter()
                rapid = self.rapid.read(gray)
                timings["rapidMs"] += _ms(t)
                (script, tess), tess_ms = self._read_tess(gray)
            timings["tessMs"] += tess_ms
            scripts.append(script)
            for seg in merge(rapid, tess, script):
                x0, y0, x1, y1 = seg.box
                line: dict[str, Any] = {
                    "text": seg.text[:MAX_LINE_CHARS],
                    "conf": round(max(0.0, min(1.0, seg.conf)), 4),
                    "box": [round(x0, 1), round(y0 + offset, 1), round(x1, 1), round(y1 + offset, 1)],
                }
                line_script = script_of(seg.text)
                if line_script:
                    line["script"] = line_script
                lines.append(line)
            # Pages stack top to bottom, so the extractor's rows never mix two pages.
            offset += float(gray.shape[0]) + 1
        lines = lines[:MAX_LINES]
        log.info(
            "read",
            extra={"stats": {"engine": ENGINE_OCR, "pages": decoded.page_count, "lines": len(lines), "scripts": scripts, "hint": hint, **timings, "totalMs": _ms(started)}},
        )
        return {"engine": ENGINE_OCR, "lines": lines, "pages": decoded.page_count}


def _ms(since: float) -> int:
    return int((time.perf_counter() - since) * 1000)
