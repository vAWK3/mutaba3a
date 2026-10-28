# receipt-ocr: licences (MUT-441, AC7)

Everything in the receipt-ocr image, with its licence. All of it allows commercial use; none of it is AGPL, GPL,
LGPL, OpenRAIL or non-commercial. `python check_licenses.py` checks the same list from the installed metadata and fails
on a denied or unrecognised licence; the image's test target runs it in CI.

Not shipped on purpose: **python-bidi** (LGPL-3.0), which RapidOCR uses to reorder its Arabic output. `app/text.py`
implements that reorder (UAX #9 for one line) and is tested against python-bidi's output, which was generated once
into `tests/fixtures/bidi_reference.json` outside this environment.

## Models and system packages

| What | Licence | Source |
|---|---|---|
| PP-OCRv5 mobile text detection, `ch_PP-OCRv5_det_mobile.onnx` (5.0 MB) | Apache-2.0 | PaddleOCR (PaddlePaddle), ONNX conversion by RapidAI/RapidOCR v3.10.0 (modelscope.cn) |
| PP-OCRv5 mobile Arabic recognition, `arabic_PP-OCRv5_rec_mobile.onnx` (8.0 MB; reads Arabic, Latin, digits) | Apache-2.0 | as above |
| tessdata_fast 4.1.0: `ara`, `heb`, `eng` (6.2 MB, the default) | Apache-2.0 | github.com/tesseract-ocr/tessdata_fast |
| tessdata_best 4.1.0: `ara`, `heb`, `eng` (30 MB, only with `TESSDATA_VARIANT=best`) | Apache-2.0 | github.com/tesseract-ocr/tessdata_best |
| Tesseract 5 (Debian `tesseract-ocr`: the binary and libtesseract; its own language data is removed) | Apache-2.0 | github.com/tesseract-ocr/tesseract |
| Leptonica (pulled in by tesseract-ocr) | BSD-2-Clause-style (Leptonica licence) | leptonica.org |
| Python 3.12 (`python:3.12-slim` base) | PSF-2.0 | python.org |

Each model's SHA-256 is pinned in `fetch_models.py`.

The Debian base image carries its own system packages under their own (mostly GPL) licences, as every Debian-based
image does. They are separate programs we don't modify or link our code into, so their copyleft doesn't reach ours.

## Python packages (`requirements.txt`, every pin including dependencies)

| Package | Version | Licence (from its metadata) |
|---|---|---|
| annotated-doc | 0.0.5 | MIT |
| annotated-types | 0.8.0 | MIT | MIT License |
| anyio | 4.15.1 | MIT |
| certifi | 2026.10.23 | MPL-2.0 | Mozilla Public License 2.0 (MPL 2.0) |
| charset-normalizer | 3.5.2 | MIT |
| click | 8.5.0 | BSD-3-Clause |
| colorlog | 6.12.0 | MIT License | MIT License |
| fastapi | 0.162.0 | MIT |
| flatbuffers | 25.12.19 | Apache 2.0 | Apache Software License |
| h11 | 0.16.0 | MIT | MIT License |
| idna | 3.20 | BSD-3-Clause |
| numpy | 2.5.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| omegaconf | 2.4.0 | BSD License |
| onnxruntime | 1.31.1 | MIT License | MIT License |
| opencv-python-headless | 5.0.0.93 | Apache 2.0 | Apache Software License |
| opentelemetry-api | 1.45.1 | Apache-2.0 |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| pillow | 13.0.0 | MIT-CMU |
| protobuf | 7.36.2 | 3-Clause BSD License |
| pyclipper | 1.4.0 | MIT | OSI Approved | MIT License |
| pydantic | 2.14.1 | MIT |
| pydantic_core | 2.50.1 | MIT |
| pypdfium2 | 5.14.0 | BSD-3-Clause, Apache-2.0, dependency licenses |
| pytesseract | 0.3.13 | Apache License 2.0 | Apache Software License |
| PyYAML | 6.0.3 | MIT | MIT License |
| rapidocr | 3.10.0 | Apache-2.0 |
| requests | 2.34.2 | Apache-2.0 | Apache Software License |
| shapely | 2.2.0 | BSD-3-Clause |
| six | 1.17.0 | MIT | MIT License |
| starlette | 1.10.0 | BSD-3-Clause |
| tqdm | 4.70.1 | MPL-2.0 AND MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| typing-inspection | 0.4.4 | MIT |
| urllib3 | 2.8.0 | MIT |
| uvicorn | 0.54.0 | BSD-3-Clause |

`colorama` (BSD-3-Clause) is pinned for Windows only and isn't installed in the image.

Notes:
- **certifi** and **tqdm** are MPL-2.0 (in part): file-level copyleft that covers changes to their own files only.
  We use them unmodified, as dependencies of `requests` and `rapidocr`.
- **pypdfium2** bundles PDFium (BSD-3-Clause and Apache-2.0) and PDFium's own dependencies (FreeType under its FTL
  option, libjpeg-turbo, zlib, lcms2, OpenJPEG, ICU: all permissive).
- **Bundled native libraries under LGPL-2.1, flagged for Basel.** Two wheels carry an unmodified, dynamically linked
  LGPL library inside them: **opencv-python-headless** (Linux wheel: FFmpeg; also libvpx and bzip2, which are
  permissive) and **shapely** (GEOS; a RapidOCR dependency used to expand text boxes). LGPL allows commercial use of
  an unmodified library linked this way; the obligations are to keep its notice (the wheels' own licence files are in
  the image) and to let someone swap the library, which a Python wheel already allows. The licence check reads each
  package's declared licence (Apache-2.0, BSD-3-Clause), so it doesn't see these; they are listed here instead. If
  even this is unwanted: OpenCV's few calls (`app/preprocess.py`, and RapidOCR's own) would move to Pillow and NumPy,
  and shapely would need a RapidOCR patch.

## Dev and test only (`requirements-dev.txt`, not in the service image)

pytest (MIT), httpx (BSD-3-Clause), httpcore (BSD-3-Clause), pip-licenses (MIT), and their dependencies.
