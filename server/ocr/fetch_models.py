"""Fetch the OCR models into models/ and verify each against its pinned SHA-256 (MUT-441).

Build time and local setup only: the Dockerfile runs it while building the image, so the running service never
downloads anything (AC4). The app itself never imports this file.

    python fetch_models.py                 # RapidOCR models + tessdata fast
    python fetch_models.py --tessdata best # RapidOCR models + tessdata best
    python fetch_models.py --tessdata all  # both tessdata variants (the benchmark compares them)
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "models"

RAPIDOCR = "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv5"
TESSDATA = "https://github.com/tesseract-ocr/tessdata_{variant}/raw/4.1.0/{lang}.traineddata"

# (path under models/, URL, SHA-256). The RapidOCR hashes are the ones rapidocr 3.10.0's default_models.yaml pins.
COMMON = [
    ("rapidocr/ch_PP-OCRv5_det_mobile.onnx", f"{RAPIDOCR}/det/ch_PP-OCRv5_det_mobile.onnx", "4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae"),
    ("rapidocr/arabic_PP-OCRv5_rec_mobile.onnx", f"{RAPIDOCR}/rec/arabic_PP-OCRv5_rec_mobile.onnx", "c1192e632d0baa9146ae5b756a0e635e3dc63c1733737ebfd1629e87144e9295"),
]
TESS_SHA = {
    "fast": {
        "ara": "e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729",
        "heb": "11f9e43ab227f786352a50f75c94c2e9906f1baba86d93276da19da7ce0904db",
        "eng": "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
    },
    "best": {
        "ara": "ab9d157d8e38ca00e7e39c7d5363a5239e053f5b0dbdb3167dde9d8124335896",
        "heb": "dbaa827aea6bc21215638447f17783a1004987c2d0bf5573d111fee397abdae5",
        "eng": "8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba",
    },
}


def files(variants: list[str]) -> list[tuple[str, str, str]]:
    out = list(COMMON)
    for variant in variants:
        for lang, sha in TESS_SHA[variant].items():
            out.append((f"tessdata/{variant}/{lang}.traineddata", TESSDATA.format(variant=variant, lang=lang), sha))
    return out


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(rel: str, url: str, expected: str) -> None:
    dest = ROOT / rel
    if dest.is_file() and sha256(dest) == expected:
        print(f"ok      {rel}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=120) as res, tmp.open("wb") as out:  # noqa: S310 - pinned https URLs
        while chunk := res.read(1 << 20):
            out.write(chunk)
    got = sha256(tmp)
    if got != expected:
        tmp.unlink()
        raise SystemExit(f"hash mismatch for {rel}: got {got}, expected {expected}")
    tmp.replace(dest)
    print(f"fetched {rel}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tessdata", choices=["fast", "best", "all"], default="fast")
    args = ap.parse_args()
    variants = ["fast", "best"] if args.tessdata == "all" else [args.tessdata]
    for rel, url, sha in files(variants):
        fetch(rel, url, sha)


if __name__ == "__main__":
    sys.exit(main())
