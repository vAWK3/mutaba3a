"""MUT-557 (D6): the QR codes on the pages the OCR reads, as their text payloads.

zxing-cpp (Apache-2.0) decodes in this process: no network, no file, no model. Only the QR family (QR, Micro QR,
rMQR). A payload stays in memory and goes back in the response, nothing else: it can carry the receipt's own data (a
JoFotara or ZATCA TLV, an allocation number), so it is never logged and never quoted in an exception. A code that
won't decode is skipped, and a QR failure of any kind leaves `qr` empty: it never fails the read.
"""

from __future__ import annotations

import logging

import numpy as np

log = logging.getLogger("receipt_ocr.qr")

#: Contract bounds (OcrResultSchema in server/src/receipts/ocr-client.ts): at most this many payloads per read...
MAX_QR_PAYLOADS = 8
#: ...each at most this long; a longer one is dropped, not cut (a cut TLV or URL would parse into nonsense).
MAX_QR_CHARS = 4_096


def read_qr(pages: list[np.ndarray]) -> list[str]:
    """The QR payloads on `pages` (RGB or grayscale), page by page, top to bottom then left to right on each page;
    each payload once, empty ones and ones holding a NUL dropped, at most MAX_QR_PAYLOADS."""
    payloads: list[str] = []
    seen: set[str] = set()
    for page in pages:
        for text in _page_payloads(page):
            if not text or len(text) > MAX_QR_CHARS or "\x00" in text or text in seen:
                continue
            seen.add(text)
            payloads.append(text)
            if len(payloads) == MAX_QR_PAYLOADS:
                return payloads
    return payloads


def _page_payloads(page: np.ndarray) -> list[str]:
    try:
        import zxingcpp

        found = zxingcpp.read_barcodes(_gray(page), formats=zxingcpp.BarcodeFormat.QRCode, text_mode=zxingcpp.TextMode.Plain)
        found = [code for code in found if code.valid]
        found.sort(key=_reading_order)
        return [code.text for code in found]
    except Exception as exc:  # noqa: BLE001 - the type only; never the payload or the decoder's message
        log.warning("qr read failed", extra={"stats": {"error": type(exc).__name__}})
        return []


def _gray(page: np.ndarray) -> np.ndarray:
    """zxing-cpp takes a 3-channel array as BGR; the pages are RGB, so hand it the luminance instead."""
    if page.ndim == 2:
        return np.ascontiguousarray(page)
    import cv2

    return cv2.cvtColor(np.ascontiguousarray(page), cv2.COLOR_RGB2GRAY)


def _reading_order(code) -> tuple[int, int]:
    pos = code.position
    corners = (pos.top_left, pos.top_right, pos.bottom_right, pos.bottom_left)
    return min(p.y for p in corners), min(p.x for p in corners)
