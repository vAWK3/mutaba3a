"""MUT-557 (D6): what kind of QR codes the real receipts carry, without showing what they say.

    server/ocr/.venv/bin/python server/ocr/bench/qr_shapes.py [--real ~/Work/Barmajiyat/Mutaba3a/receipt-bench/allocation-2026]

Reads the `reads.json` a bench run left in the real folder (bench/run.py --real <folder>) and prints, per receipt and
QR payload, its shape: every digit as 9, every letter as a, other characters kept (so `https://x.gov.il/?a=1` reads
`aaaaa://a.aaa.aa/?a=9`), the length, and, when the folder's manifest gives the receipt an allocation number, whether
the payload holds those nine digits. That answers whether a QR parser is worth writing and which format it reads,
without a receipt's content leaving its folder. Base64 or TLV payloads are flagged as such; their decoded bytes are
not printed.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import re
from pathlib import Path

DEFAULT_REAL = Path.home() / "Work/Barmajiyat/Mutaba3a/receipt-bench/allocation-2026"
#: Longer shapes are cut here: the start says which format it is.
SHAPE_CHARS = 120


def shape(payload: str) -> str:
    masked = re.sub(r"[0-9]", "9", payload)
    masked = re.sub(r"[^\W\d_]", "a", masked)
    return masked if len(masked) <= SHAPE_CHARS else masked[:SHAPE_CHARS] + "…"


def decoded(payload: str) -> bytes | None:
    """The payload's bytes when it is plain base64 (ZATCA and JoFotara QRs are base64 TLV), else None."""
    if not re.fullmatch(r"[A-Za-z0-9+/=\s]{16,}", payload):
        return None
    try:
        return base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError):
        return None


def kind(payload: str) -> str:
    if re.match(r"https?://", payload, re.I):
        return "url"
    raw = decoded(payload)
    if raw is not None:
        return "base64-tlv" if len(raw) > 2 and raw[0] == 1 and raw[1] < len(raw) else "base64"
    if payload.lstrip().startswith(("{", "[")):
        return "json"
    return "text"


def holds(payload: str, number: str) -> bool:
    if number in re.sub(r"\D", "", payload):
        return True
    raw = decoded(payload)
    return raw is not None and number.encode() in raw


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--real", type=Path, default=DEFAULT_REAL)
    args = ap.parse_args()
    reads_path = args.real / "reads.json"
    if not reads_path.is_file():
        print(f"No reads.json in {args.real}: run bench/run.py --real {args.real} first.")
        return 1
    truth: dict[str, str] = {}
    manifest = args.real / "manifest.json"
    if manifest.is_file():
        for e in json.loads(manifest.read_text(encoding="utf-8")).get("receipts", []):
            number = (e.get("truth") or {}).get("allocationNumber")
            if number:
                truth[e["file"]] = str(number)
    reads = json.loads(reads_path.read_text(encoding="utf-8"))
    with_qr = 0
    carrying = 0
    for read in reads:
        payloads = (read.get("result") or {}).get("qr") or []
        if not payloads:
            continue
        with_qr += 1
        number = truth.get(read["id"])
        print(read["id"])
        for p in payloads:
            has = holds(p, number) if number else None
            carrying += bool(has)
            mark = "" if has is None else ("  ← holds its allocation number" if has else "  (not its allocation number)")
            print(f"  {kind(p):10} {len(p):5} chars  {shape(p)}{mark}")
    print(f"\n{with_qr}/{len(reads)} receipts carried a QR; {carrying} payload(s) hold the receipt's allocation number.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
