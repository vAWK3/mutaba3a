"""Turn the uploaded bytes into pixels or a PDF text layer, inside the R3 bounds.

Images: the size is read from the header (Pillow opens lazily) and checked against MAX_PIXELS before a single pixel is
decoded. PDFs: refused past MAX_PDF_PAGES, at most PDF_PAGES_READ pages read, each rasterised at PDF_DPI or lower so the
raster stays under MAX_PIXELS. A text layer is used instead of OCR only when its text is drawn visibly: an invisible
layer is a scanner's own OCR (MUT-504); MUT-590: the layer also comes placed on the page (`pdf_lines`), so a label
and the value printed apart from it meet on one row, as OCR boxes do. Anything the decoders can't make sense of is `unreadable`; their messages are dropped.
MUT-557: the QR reader looks at the same pages; a text-layer PDF's are rasterised for it alone, at QR_PDF_DPI, and a
failure there only leaves them out.
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
    #: MUT-590: that text layer placed on the page, `{text, conf, box}` like OCR lines; empty past MAX_LAYER_CHARS or
    #: when pdfium can't place it (the extractor then reads `pdf_text` line by line).
    pdf_lines: list[dict] = field(default_factory=list)
    #: How many pages were read.
    page_count: int = 0
    #: True for rasterised PDF pages: flat already, so no perspective step.
    flat: bool = False
    #: MUT-557: the pages for the QR reader when they aren't `pages` (a text-layer PDF's, rasterised for it alone).
    qr_pages: list[np.ndarray] | None = None

    @property
    def pages_for_qr(self) -> list[np.ndarray]:
        return self.pages if self.qr_pages is None else self.qr_pages


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
        if len("".join(text.split())) >= config.MIN_PDF_TEXT_CHARS and not _invisible_text(pdf, count):
            return Decoded(pdf_text=text, pdf_lines=_placed_lines(pdf, count), page_count=count, flat=True, qr_pages=_qr_rasters(pdf, count))
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


#: MUT-590: a text layer with more characters than this (on the pages read) is not placed, only read as text, so a
#: crafted PDF can't make the reader walk millions of character boxes.
MAX_LAYER_CHARS = 20_000
#: Two characters of one line further apart than this many character heights are two runs (a label and its value in
#: another column); the extractor puts runs that share a line back together in reading order.
RUN_GAP_HEIGHTS = 1.5


def _placed_lines(pdf, count: int) -> list[dict]:
    """The text layer as runs placed on the page; never a refusal: on any failure the text is read without places."""
    try:
        return _layer_lines(pdf, count)
    except Exception:
        return []


def _layer_lines(pdf, count: int) -> list[dict]:
    """Runs of the text layer, top-down page coordinates in points, pages stacked (page 2 below page 1). A run ends at
    pdfium's own line break or at a gap wider than RUN_GAP_HEIGHTS character heights. Characters stay in the layer's
    order; `pdf_text_to_logical`'s repair is applied to them later, with the whole layer's verdict."""
    textpages = [pdf[i].get_textpage() for i in range(count)]
    try:
        if sum(tp.count_chars() for tp in textpages) > MAX_LAYER_CHARS:
            return []
        lines: list[dict] = []
        offset = 0.0
        for i, tp in enumerate(textpages):
            height = pdf[i].get_size()[1]
            lines.extend(_page_runs(tp, height, offset))
            offset += height + 1
        return lines
    finally:
        for tp in textpages:
            tp.close()


def _page_runs(tp, height: float, offset: float) -> list[dict]:
    runs: list[dict] = []
    text: list[str] = []
    box: list[float] | None = None
    last: tuple[float, float, float, float] | None = None

    def close() -> None:
        nonlocal text, box, last
        joined = "".join(text).strip()
        if joined and box is not None:
            left, bottom, right, top = box
            runs.append({"text": joined, "conf": 1.0, "box": [round(left, 1), round(height - top + offset, 1), round(right, 1), round(height - bottom + offset, 1)]})
        text, box, last = [], None, None

    for index in range(tp.count_chars()):
        ch = tp.get_text_range(index, 1)
        if ch in ("\r", "\n"):
            close()
            continue
        if not ch.strip():
            if text:
                text.append(" ")
            continue
        left, bottom, right, top = tp.get_charbox(index)
        if last is not None:
            gap = max(last[0] - right, left - last[2])
            if gap > RUN_GAP_HEIGHTS * max(top - bottom, last[3] - last[1], 1.0):
                close()
        text.append(ch)
        box = [left, bottom, right, top] if box is None else [min(box[0], left), min(box[1], bottom), max(box[2], right), max(box[3], top)]
        last = (left, bottom, right, top)
    close()
    return runs


#: Text drawn without paint: invisible (3), or only added to the clip path (7). Both are another reader's OCR layer.
_HIDDEN_RENDER_MODES = (3, 7)
#: The visibility check looks at no more text objects than this, so a crafted PDF can't stall the reader.
MAX_TEXT_OBJECTS = 5_000


def _invisible_text(pdf, count: int) -> bool:
    """Whether most of the text, by area, is drawn without paint: another reader's OCR over a scanned image, as a
    scanner app writes it (MUT-504). Adobe Scan's Hebrew comes out as Latin junk, so the page is read as an image.
    Weighed by area, a small visible stamp ("Scanned with …") doesn't outvote the hidden layer. Any failure here reads
    the page as an image too: the safe way, never a refusal."""
    try:
        import pypdfium2.raw as pdfium_c

        hidden = shown = 0.0
        seen = 0
        for i in range(count):
            for obj in pdf[i].get_objects(filter=(pdfium_c.FPDF_PAGEOBJ_TEXT,), max_depth=3):
                seen += 1
                if seen > MAX_TEXT_OBJECTS:
                    return hidden > shown
                left, bottom, right, top = obj.get_bounds()
                area = max(0.0, right - left) * max(0.0, top - bottom)
                if pdfium_c.FPDFTextObj_GetTextRenderMode(obj.raw) in _HIDDEN_RENDER_MODES:
                    hidden += area
                else:
                    shown += area
        return hidden > shown
    except Exception:
        return True


def _qr_rasters(pdf, count: int) -> list[np.ndarray]:
    """MUT-557: a text-layer PDF's pages for the QR reader alone. Never a refusal: the text is read either way."""
    try:
        return [_rasterise(pdf[i], config.QR_PDF_DPI) for i in range(count)]
    except Exception:
        return []


def _rasterise(page, dpi: int = config.PDF_DPI) -> np.ndarray:
    width_pt, height_pt = page.get_size()
    if width_pt <= 0 or height_pt <= 0:
        raise Refusal("unreadable")
    scale = dpi / 72
    pixels = width_pt * height_pt * scale * scale
    if pixels > config.MAX_PIXELS:
        scale *= (config.MAX_PIXELS / pixels) ** 0.5
        # pdfium rounds the raster's sides up; step down until the rounded raster fits.
        while math.ceil(width_pt * scale) * math.ceil(height_pt * scale) > config.MAX_PIXELS:
            scale *= 0.999
    bitmap = page.render(scale=scale)
    return np.asarray(bitmap.to_pil().convert("RGB"))
