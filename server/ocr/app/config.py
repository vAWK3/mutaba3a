"""Settings for the receipt-ocr sidecar (MUT-441), read once from the environment.

Every limit here is a decode or time bound from the eng review's R3 (F1); change them together with the API's
expectations in server/src/receipts/ocr-client.ts.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: R3: an image or a rasterised PDF page larger than this is refused before it is decoded.
MAX_PIXELS = 40_000_000
#: R3: at most this many PDF pages are read; a PDF with more than MAX_PDF_PAGES is refused outright.
PDF_PAGES_READ = 2
MAX_PDF_PAGES = 20
#: PDF pages are rasterised at this resolution, lowered when the raster would pass MAX_PIXELS.
PDF_DPI = 300
#: A PDF whose text layer (on the pages read) has at least this many non-space characters is not OCR'd.
MIN_PDF_TEXT_CHARS = 20
#: The API caps uploads at 10 MB (rules.ts); a little headroom, then 413.
MAX_BODY_BYTES = 12 * 1024 * 1024
#: The working image's long side after preprocessing; bigger photos are scaled down (OCR time grows with pixels).
MAX_WORK_SIDE = 2_500
#: A photo whose short side is under this is upscaled about 2x.
UPSCALE_BELOW_SHORT_SIDE = 1_000

ACCEPTED_TYPES = frozenset({"image/jpeg", "image/png", "application/pdf"})


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return float(raw) if raw else default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw else default


@dataclass(frozen=True)
class Settings:
    #: R3: the hard per-request deadline, from the moment the request arrives.
    deadline_s: float = 30.0
    #: `fast` (default: the MUT-253 spike found it better on receipts) or `best`.
    tessdata_variant: str = "fast"
    models_dir: Path = ROOT / "models"
    #: ONNX Runtime threads for RapidOCR. The service has 4 vCPU (receipt_ocr.tf): 3 here, 1 for Tesseract beside it.
    threads: int = 3
    #: `process` (production: a killable worker process) or `inline` (tests: same process, no hard kill).
    worker: str = "process"
    #: Run Tesseract (a subprocess) while RapidOCR reads, instead of after it (MUT-441 benchmark: p95 about halved, the
    #: same fields read).
    parallel: bool = True
    #: Tesseract's script-picking pass reads the page scaled by this; under 1 every page then gets a full-size
    #: `<script>+eng` (or `eng`) pass. 1 is the MUT-253 rule: one full-size `ara+heb+eng` pass, kept for Latin pages.
    #: 0.5 picks the same scripts on the benchmark and takes about a third off a read.
    script_pick_scale: float = 0.5
    #: A prepared page whose short side is under this is upscaled (up to 2x); 0 never upscales. Kept: without the
    #: upscale, Arabic photo dates fell from 12/14 to 6/14 on the benchmark.
    upscale_below: int = UPSCALE_BELOW_SHORT_SIDE

    @property
    def tessdata_dir(self) -> Path:
        return self.models_dir / "tessdata" / self.tessdata_variant

    @property
    def det_model(self) -> Path:
        return self.models_dir / "rapidocr" / "ch_PP-OCRv5_det_mobile.onnx"

    @property
    def rec_model(self) -> Path:
        return self.models_dir / "rapidocr" / "arabic_PP-OCRv5_rec_mobile.onnx"


def load_settings() -> Settings:
    variant = os.environ.get("OCR_TESSDATA", "fast")
    if variant not in ("fast", "best"):
        raise ValueError("OCR_TESSDATA must be fast or best")
    worker = os.environ.get("OCR_WORKER", "process")
    if worker not in ("process", "inline"):
        raise ValueError("OCR_WORKER must be process or inline")
    return Settings(
        deadline_s=_env_float("OCR_DEADLINE_S", 30.0),
        tessdata_variant=variant,
        models_dir=Path(os.environ.get("OCR_MODELS_DIR", str(ROOT / "models"))),
        threads=_env_int("OCR_THREADS", Settings.threads),
        worker=worker,
        parallel=os.environ.get("OCR_PARALLEL", "1" if Settings.parallel else "0") == "1",
        script_pick_scale=_env_float("OCR_SCRIPT_PICK_SCALE", Settings.script_pick_scale),
        upscale_below=_env_int("OCR_UPSCALE_BELOW", UPSCALE_BELOW_SHORT_SIDE),
    )
