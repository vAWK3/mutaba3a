"""The two readers: RapidOCR (PP-OCRv5 detection and Arabic recognition, ONNX Runtime CPU) and Tesseract 5.

Both read only the files under `models/` (baked into the image; fetch_models.py verifies their hashes). Neither is
given a path, URL or setting that would let it download anything.
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass

import numpy as np

from .config import Settings
from .text import visual_to_logical

#: Tesseract: page segmentation 6 (one uniform block) and the LSTM engine, as the MUT-253 spike measured.
TESS_PSM = 6
TESS_OEM = 1


@dataclass
class Segment:
    """One reading of one stretch of a printed line."""

    text: str
    conf: float  # 0..1
    box: tuple[float, float, float, float]  # x0, y0, x1, y1, y down


class RapidReader:
    def __init__(self, settings: Settings) -> None:
        from rapidocr import EngineType, LangDet, LangRec, ModelType, OCRVersion, RapidOCR

        for path in (settings.det_model, settings.rec_model):
            if not path.is_file():
                raise FileNotFoundError(f"missing model {path.name}; run fetch_models.py")
        # Rec.lang_type is LATIN on purpose: with ARABIC, RapidOCR reorders through python-bidi (LGPL). The model and
        # its character set come from model_path (the dictionary is embedded in the ONNX file); text.py reorders.
        self._engine = RapidOCR(
            params={
                "Global.use_cls": False,
                "Global.log_level": "error",
                "Det.engine_type": EngineType.ONNXRUNTIME,
                "Det.model_path": str(settings.det_model),
                "Det.ocr_version": OCRVersion.PPOCRV5,
                "Det.model_type": ModelType.MOBILE,
                "Det.lang_type": LangDet.CH,
                "Rec.engine_type": EngineType.ONNXRUNTIME,
                "Rec.model_path": str(settings.rec_model),
                "Rec.ocr_version": OCRVersion.PPOCRV5,
                "Rec.model_type": ModelType.MOBILE,
                "Rec.lang_type": LangRec.LATIN,
                "EngineConfig.onnxruntime.intra_op_num_threads": settings.threads,
                "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            }
        )

    def read(self, gray: np.ndarray) -> list[Segment]:
        import cv2

        result = self._engine(cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR))
        if result.txts is None or result.boxes is None:
            return []
        segments = []
        for box, text, score in zip(result.boxes, result.txts, result.scores):
            xs = [float(p[0]) for p in box]
            ys = [float(p[1]) for p in box]
            logical = visual_to_logical(text.strip())
            if logical:
                segments.append(Segment(logical, float(score), (min(xs), min(ys), max(xs), max(ys))))
        return segments


def tesseract_available() -> bool:
    return shutil.which("tesseract") is not None


class TesseractReader:
    def __init__(self, settings: Settings) -> None:
        import pytesseract

        if not tesseract_available():
            raise FileNotFoundError("tesseract is not on PATH")
        for lang in ("ara", "heb", "eng"):
            if not (settings.tessdata_dir / f"{lang}.traineddata").is_file():
                raise FileNotFoundError(f"missing {lang}.traineddata; run fetch_models.py")
        self._tess = pytesseract
        # TESSDATA_PREFIX, not --tessdata-dir: a config string is split on spaces, and a path may hold one. The
        # process reads one receipt at a time, so setting it here is safe.
        os.environ["TESSDATA_PREFIX"] = str(settings.tessdata_dir)
        os.environ["OMP_THREAD_LIMIT"] = "1"

    def read(self, gray: np.ndarray, lang: str) -> list[Segment]:
        """One Tesseract pass; its words grouped back into its own lines."""
        data = self._tess.image_to_data(
            gray, lang=lang, config=f"--psm {TESS_PSM} --oem {TESS_OEM}", output_type=self._tess.Output.DICT
        )
        lines: dict[tuple[int, int, int, int], list[int]] = {}
        for i, word in enumerate(data["text"]):
            if word and word.strip() and float(data["conf"][i]) >= 0:
                key = (data["page_num"][i], data["block_num"][i], data["par_num"][i], data["line_num"][i])
                lines.setdefault(key, []).append(i)
        segments = []
        for idx in lines.values():
            x0 = min(data["left"][i] for i in idx)
            y0 = min(data["top"][i] for i in idx)
            x1 = max(data["left"][i] + data["width"][i] for i in idx)
            y1 = max(data["top"][i] + data["height"][i] for i in idx)
            text = " ".join(data["text"][i].strip() for i in idx)
            conf = sum(float(data["conf"][i]) for i in idx) / len(idx) / 100
            segments.append(Segment(text, max(0.0, min(1.0, conf)), (float(x0), float(y0), float(x1), float(y1))))
        return segments
