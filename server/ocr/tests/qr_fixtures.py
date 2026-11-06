"""MUT-557: receipts carrying QR codes, made in the test (zxing-cpp's own writer), never stored as fixture files."""

from __future__ import annotations

import io

import cv2
import numpy as np
import zxingcpp
from PIL import Image

#: A payload no receipt or log line would hold by chance: the privacy tests look for it.
SECRET_PAYLOAD = "ZZQRSECRET|alloc=ZZ123456789|https://invoice.example.test/ZZQRSECRET"


def qr_image(payload: str, scale: int = 6) -> np.ndarray:
    """The QR code alone, grayscale, quiet zone included."""
    return np.asarray(zxingcpp.write_barcode_to_image(zxingcpp.create_barcode(payload, zxingcpp.BarcodeFormat.QRCode), scale=scale))


def page(qrs: list[tuple[str, int, int]] = (), size: tuple[int, int] = (1000, 800), text: bool = True) -> np.ndarray:
    """An RGB receipt page (height, width) with a few printed lines and each (payload, top, left) QR pasted on it."""
    height, width = size
    img = np.full((height, width, 3), 255, dtype=np.uint8)
    if text:
        for i, line in enumerate(("GROCER LTD", "MILK 12.50", "BREAD 9.90", "TOTAL 22.40", "DATE 05/11/2026")):
            cv2.putText(img, line, (60, 80 + 60 * i), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 0, 0), 3, cv2.LINE_AA)
    for payload, top, left in qrs:
        code = qr_image(payload)
        img[top : top + code.shape[0], left : left + code.shape[1]] = code[..., None]
    return img


def png(img: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, "PNG")
    return buf.getvalue()


def jpeg(img: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, "JPEG", quality=92)
    return buf.getvalue()


def image_pdf(*pages: np.ndarray) -> bytes:
    """A scanned PDF: each page an image, no text layer."""
    buf = io.BytesIO()
    first, *rest = [Image.fromarray(p) for p in pages]
    first.save(buf, "PDF", resolution=150, save_all=True, append_images=rest)
    return buf.getvalue()


def text_pdf_with_qr(payload: str, text: str = "Grocer Ltd Total 61.83 Date 11/12/2025") -> bytes:
    """A digital invoice: a visible text layer (so it is read from its text, not OCR'd) and a QR drawn as an image."""
    code = qr_image(payload, scale=4)
    h, w = code.shape
    stream = f"BT /F1 12 Tf 0 Tr 20 360 Td ({text}) Tj ET q {w * 0.6:.1f} 0 0 {h * 0.6:.1f} 20 40 cm /Im1 Do Q".encode()
    image = code.tobytes()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 /Length %d >>\nstream\n" % (w, h, len(image))
        + image
        + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)
