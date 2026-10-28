"""Turn the uploaded bytes into pixels or a PDF text layer, inside the R3 bounds.

Images: the size is read from the header (Pillow opens lazily) and checked against MAX_PIXELS before a single pixel is
decoded. PDFs: refused past MAX_PDF_PAGES, at most PDF_PAGES_READ pages read, each rasterised at PDF_DPI or lower so the
raster stays under MAX_PIXELS. Anything the decoders can't make sense of is `unreadable`; their messages are dropped.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageOps

from . import config
from .errors import Refusal

# Pillow's own bomb guard, as a second line behind the header check: it warns past this and raises past twice it.
Image.MAX_IMAGE_PIXELS = config.MAX_PIXELS


@dataclass
class Decoded:
    #: RGB pages to OCR, top to bottom (empty when the PDF text layer is used).
    pages: list[np.ndarray] = field(default_factory=list)
    #: The PDF's text layer, when it has enough characters to skip OCR.
    pdf_text: str | None = None
    #: How many pages were read.
    page_count: int = 0
    #: True for rasterised PDF pages: flat already, so no perspective step.
    flat: bool = False


def decode(body: bytes, content_type: str) -> Decoded:
    if len(body) > config.MAX_BODY_BYTES:
        raise Refusal("too_large")
    if content_type == "application/pdf":
        return _decode_pdf(body)
    if content_type in ("image/jpeg", "image/png"):
        return Decoded(pages=[_decode_image(body)], page_count=1)
    raise Refusal("unreadable")


def _decode_image(body: bytes) -> np.ndarray:
    try:
        img = Image.open(io.BytesIO(body))
        width, height = img.size
    except Image.DecompressionBombError:
        raise Refusal("too_large") from None
    except Exception:
        raise Refusal("unreadable") from None
    if img.format not in ("JPEG", "PNG"):
        raise Refusal("unreadable")
    if width <= 0 or height <= 0:
        raise Refusal("unreadable")
    if width * height > config.MAX_PIXELS:
        raise Refusal("too_large")
    try:
        img.load()
        # A phone photo is stored sideways with an EXIF turn; read it the way it was taken.
        img = ImageOps.exif_transpose(img)
        rgb = img.convert("RGB")
        return np.asarray(rgb)
    except Image.DecompressionBombError:
        raise Refusal("too_large") from None
    except Exception:
        raise Refusal("unreadable") from None


def _decode_pdf(body: bytes) -> Decoded:
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(body)
    except Exception:
        raise Refusal("unreadable") from None
    try:
        total = len(pdf)
        if total == 0:
            raise Refusal("unreadable")
        if total > config.MAX_PDF_PAGES:
            raise Refusal("too_large")
        count = min(total, config.PDF_PAGES_READ)
        text = _text_layer(pdf, count)
        if len("".join(text.split())) >= config.MIN_PDF_TEXT_CHARS:
            return Decoded(pdf_text=text, page_count=count, flat=True)
        return Decoded(pages=[_rasterise(pdf[i]) for i in range(count)], page_count=count, flat=True)
    except Refusal:
        raise
    except Exception:
        raise Refusal("unreadable") from None
    finally:
        pdf.close()


def _text_layer(pdf, count: int) -> str:
    parts: list[str] = []
    for i in range(count):
        textpage = pdf[i].get_textpage()
        try:
            parts.append(textpage.get_text_range())
        finally:
            textpage.close()
    return "\n".join(parts).replace("\r\n", "\n").replace("\r", "\n")


def _rasterise(page) -> np.ndarray:
    width_pt, height_pt = page.get_size()
    if width_pt <= 0 or height_pt <= 0:
        raise Refusal("unreadable")
    scale = config.PDF_DPI / 72
    pixels = width_pt * height_pt * scale * scale
    if pixels > config.MAX_PIXELS:
        scale *= (config.MAX_PIXELS / pixels) ** 0.5
        # pdfium rounds the raster's sides up; step down until the rounded raster fits.
        while math.ceil(width_pt * scale) * math.ceil(height_pt * scale) > config.MAX_PIXELS:
            scale *= 0.999
    bitmap = page.render(scale=scale)
    return np.asarray(bitmap.to_pil().convert("RGB"))
