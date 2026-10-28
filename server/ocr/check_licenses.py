"""AC7: every package and model in the receipt-ocr image allows commercial use, with no AGPL, GPL or OpenRAIL terms.

Checks the installed metadata of every package requirements.txt pins (the image's runtime set, dependencies
included) and the models and system packages listed in MODELS below. Exits non-zero on a denied licence, a licence
it doesn't recognise, or a pinned package that isn't installed. LICENSES.md is the human-readable copy of this list.

    python check_licenses.py           # run in the image (CI) or the local venv
"""

from __future__ import annotations

import re
import sys
from importlib import metadata
from pathlib import Path

HERE = Path(__file__).resolve().parent

#: Copyleft that would reach our code, use-restricted model licences, and non-commercial terms. LGPL is denied too:
#: nothing here needs it (python-bidi was replaced by app/text.py), so keeping it out keeps the question closed.
DENY = re.compile(
    r"\bA?GPL|\bLGPL|GNU (Affero |Lesser |Library )?General Public|OpenRAIL|\bRAIL\b|non-?commercial|\bCC-BY-NC|"
    r"\bSSPL|Server Side Public|\bBUSL|Business Source|Commons Clause",
    re.IGNORECASE,
)
#: Permissive (and file-level weak copyleft, MPL-2.0, which leaves our code alone) licences we accept.
ALLOW = re.compile(
    r"\bMIT\b|MIT-CMU|\bBSD\b|BSD-[23]-Clause|0BSD|Apache|\bMPL[- ]?2\.0|Mozilla Public License 2\.0|PSF|Python Software Foundation|"
    r"\bISC\b|Zlib|CC0|HPND|Unlicense",
    re.IGNORECASE,
)

#: Not Python packages: what the image holds besides them. (name, licence, source)
MODELS = [
    ("PP-OCRv5 mobile text detection (ch_PP-OCRv5_det_mobile.onnx)", "Apache-2.0", "PaddleOCR, via RapidOCR's ONNX conversion"),
    ("PP-OCRv5 mobile Arabic recognition (arabic_PP-OCRv5_rec_mobile.onnx)", "Apache-2.0", "PaddleOCR, via RapidOCR's ONNX conversion"),
    ("tessdata_fast 4.1.0 ara, heb, eng", "Apache-2.0", "github.com/tesseract-ocr/tessdata_fast"),
    ("tessdata_best 4.1.0 ara, heb, eng (only when built with TESSDATA_VARIANT=best)", "Apache-2.0", "github.com/tesseract-ocr/tessdata_best"),
    ("tesseract-ocr 5 (Debian package, the binary and libtesseract)", "Apache-2.0", "github.com/tesseract-ocr/tesseract"),
]


def pinned_names(requirements: Path) -> list[str]:
    """The pinned packages that install on this platform (a `; sys_platform == 'win32'` pin is skipped here)."""
    from packaging.requirements import Requirement

    names = []
    for line in requirements.read_text(encoding="utf-8").splitlines():
        if re.match(r"^[A-Za-z0-9_.\-]+==", line):
            req = Requirement(line.rstrip("\\ ").strip())
            if req.marker is None or req.marker.evaluate():
                names.append(req.name)
    return names


def licence_text(dist: metadata.Distribution) -> str:
    meta = dist.metadata
    parts = [meta.get("License-Expression") or ""]
    # A `License` field is sometimes the whole licence text; its first line names it.
    parts.append((meta.get("License") or "").strip().splitlines()[0] if meta.get("License") else "")
    parts += [c.split("::")[-1].strip() for c in meta.get_all("Classifier") or [] if c.startswith("License ::")]
    return " | ".join(p for p in parts if p)


def verdict(text: str) -> str | None:
    """None when the licence is acceptable, else why not."""
    if DENY.search(text):
        return f"denied licence: {text}"
    if not ALLOW.search(text):
        return f"unrecognised licence (review it, then extend ALLOW): {text or '(none declared)'}"
    return None


def check(requirements: Path = HERE / "requirements.txt") -> list[str]:
    problems = []
    for name in pinned_names(requirements):
        try:
            dist = metadata.distribution(name)
        except metadata.PackageNotFoundError:
            problems.append(f"{name}: pinned but not installed")
            continue
        why = verdict(licence_text(dist))
        if why:
            problems.append(f"{name} {dist.version}: {why}")
    for name, licence, _ in MODELS:
        why = verdict(licence)
        if why:
            problems.append(f"{name}: {why}")
    return problems


def main() -> int:
    problems = check()
    for p in problems:
        print(f"FAIL {p}")
    if problems:
        return 1
    print(f"ok: {len(pinned_names(HERE / 'requirements.txt'))} packages and {len(MODELS)} models/system packages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
