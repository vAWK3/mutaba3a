"""MUT-557 (D6): QR payloads in the read response. The decode tests load no model; the HTTP ones run the real app."""

from __future__ import annotations

import logging

import numpy as np
import pytest

from app import qr as qr_mod
from app.decode import decode
from app.logs import JsonFormatter
from app.qr import MAX_QR_CHARS, MAX_QR_PAYLOADS, read_qr
from conftest import needs_engines, post
from qr_fixtures import SECRET_PAYLOAD, image_pdf, jpeg, page, png, qr_image, text_pdf_with_qr

INVOICE_URL = "https://invoice.example.test/v/4f2a?alloc=123456789"
TLV = "AQ1HUk9DRVIgTFREAg8zMDAwMDAwMDAzMDAwMDMDFDIwMjYtMTEtMDVUMTA6MDA6MDBaBAUyMi40MA=="


def qr_of(body: bytes, content_type: str) -> list[str]:
    return read_qr(decode(body, content_type).pages_for_qr)


# ── decoding, no model ───────────────────────────────────────────────────────────────────────────────────────────


def test_a_photo_with_a_qr_code_gives_its_payload():
    assert qr_of(jpeg(page([(INVOICE_URL, 450, 450)])), "image/jpeg") == [INVOICE_URL]


def test_a_png_scan_with_a_qr_code_gives_its_payload():
    assert qr_of(png(page([(TLV, 420, 420)])), "image/png") == [TLV]


def test_an_image_without_a_qr_code_gives_none():
    assert qr_of(png(page()), "image/png") == []


def test_a_scanned_pdf_with_a_qr_code_on_page_1_gives_its_payload():
    body = image_pdf(page([(INVOICE_URL, 450, 450)]), page())
    decoded = decode(body, "application/pdf")
    assert decoded.pdf_text is None and decoded.page_count == 2
    assert read_qr(decoded.pages_for_qr) == [INVOICE_URL]


def test_a_qr_code_on_page_2_is_read_and_one_past_the_pages_read_is_not():
    body = image_pdf(page(), page([(TLV, 450, 450)]), page([(INVOICE_URL, 450, 450)]))
    assert qr_of(body, "application/pdf") == [TLV]


def test_a_text_layer_pdf_is_rasterised_for_its_qr_code_alone():
    decoded = decode(text_pdf_with_qr(INVOICE_URL), "application/pdf")
    assert decoded.pdf_text is not None and decoded.pages == [] and len(decoded.pages_for_qr) == 1
    assert read_qr(decoded.pages_for_qr) == [INVOICE_URL]


def test_a_text_layer_pdf_whose_qr_raster_fails_is_still_read_from_its_text(monkeypatch):
    from app import decode as decode_mod

    real = decode_mod._rasterise

    def failing(page, dpi=300):
        if dpi == decode_mod.config.QR_PDF_DPI:
            raise MemoryError
        return real(page, dpi)

    monkeypatch.setattr(decode_mod, "_rasterise", failing)
    decoded = decode(text_pdf_with_qr(INVOICE_URL), "application/pdf")
    assert decoded.pdf_text is not None and decoded.pages_for_qr == []


def test_payloads_come_in_reading_order_and_each_once():
    img = page([("second", 600, 60), ("third", 600, 500), ("first", 20, 500), ("second", 820, 500)], size=(1100, 800), text=False)
    assert read_qr([img]) == ["first", "second", "third"]


def test_the_same_payload_on_two_pages_is_returned_once():
    assert read_qr([page([(TLV, 450, 450)]), page([(TLV, 100, 100)])]) == [TLV]


def test_at_most_max_payloads_are_returned(monkeypatch):
    monkeypatch.setattr(qr_mod, "_page_payloads", lambda _page: [f"p{i}" for i in range(MAX_QR_PAYLOADS + 5)])
    assert read_qr([np.zeros((4, 4), np.uint8)]) == [f"p{i}" for i in range(MAX_QR_PAYLOADS)]


def test_an_overlong_empty_or_nul_payload_is_dropped_not_cut(monkeypatch):
    payloads = ["x" * (MAX_QR_CHARS + 1), "", "a\x00b", "y" * MAX_QR_CHARS, "ok"]
    monkeypatch.setattr(qr_mod, "_page_payloads", lambda _page: payloads)
    assert read_qr([np.zeros((4, 4), np.uint8)]) == ["y" * MAX_QR_CHARS, "ok"]


def test_a_damaged_qr_code_is_skipped():
    img = page([(INVOICE_URL, 450, 450)])
    size = qr_image(INVOICE_URL).shape[0]
    # Wipe a band across the middle of the code: past what its error correction can rebuild.
    img[450 + size // 3 : 450 + 2 * size // 3, 450 : 450 + size] = 255
    assert read_qr([img]) == []


def test_only_the_qr_family_is_read():
    import zxingcpp

    code = np.asarray(zxingcpp.write_barcode_to_image(zxingcpp.create_barcode("DATAMATRIX1", zxingcpp.BarcodeFormat.DataMatrix), scale=8))
    img = np.full((600, 600), 255, np.uint8)
    img[100 : 100 + code.shape[0], 100 : 100 + code.shape[1]] = code
    assert read_qr([img]) == []


def test_a_decoder_failure_gives_no_payloads_and_logs_only_its_type(monkeypatch, caplog):
    import zxingcpp

    def boom(*args, **kwargs):
        raise RuntimeError(f"decoder choked on {SECRET_PAYLOAD}")

    monkeypatch.setattr(zxingcpp, "read_barcodes", boom)
    caplog.set_level(logging.DEBUG)
    assert read_qr([page([(SECRET_PAYLOAD, 450, 450)])]) == []
    assert "ZZQRSECRET" not in caplog.text
    assert [getattr(r, "stats", {}).get("error") for r in caplog.records] == ["RuntimeError"]


# ── the HTTP contract, real engines ──────────────────────────────────────────────────────────────────────────────


def _text_pdf_without_qr() -> bytes:
    from test_caps import RECEIPT_TEXT, pdf_with_text

    return pdf_with_text(RECEIPT_TEXT, 0)


@needs_engines
@pytest.mark.parametrize(
    "make",
    [
        pytest.param(lambda: (jpeg(page()), "image/jpeg"), id="photo"),
        pytest.param(lambda: (image_pdf(page()), "application/pdf"), id="scanned-pdf"),
        pytest.param(lambda: (_text_pdf_without_qr(), "application/pdf"), id="text-pdf"),
    ],
)
def test_every_200_carries_qr_even_when_there_is_none(client, make):
    res = post(client, *make())
    assert res.status_code == 200
    assert res.json()["qr"] == []



@needs_engines
def test_the_read_response_carries_the_photos_qr_payload_beside_its_lines(client):
    res = post(client, jpeg(page([(INVOICE_URL, 450, 450)])), "image/jpeg", "photo")
    assert res.status_code == 200
    body = res.json()
    assert body["qr"] == [INVOICE_URL] and body["engine"] == "rapid-tess" and body["lines"]


@needs_engines
def test_a_text_layer_pdf_answers_its_text_and_its_qr_payload(client):
    res = post(client, text_pdf_with_qr(INVOICE_URL), "application/pdf")
    assert res.status_code == 200
    body = res.json()
    assert body["engine"] == "pdf-text" and "61.83" in body["pdfText"] and body["qr"] == [INVOICE_URL]


@needs_engines
def test_a_qr_payload_never_reaches_a_log_line(client, caplog):
    caplog.set_level(logging.DEBUG)
    for body, content_type in ((jpeg(page([(SECRET_PAYLOAD, 450, 450)])), "image/jpeg"), (text_pdf_with_qr(SECRET_PAYLOAD), "application/pdf")):
        res = post(client, body, content_type)
        assert res.status_code == 200 and res.json()["qr"] == [SECRET_PAYLOAD]
    formatter = JsonFormatter()
    rendered = "\n".join([caplog.text] + [formatter.format(r) for r in caplog.records])
    for fragment in ("ZZQRSECRET", "ZZ123456789", "invoice.example.test"):
        assert fragment not in rendered
    # The count is logged, never the payload.
    assert [getattr(r, "stats", {}).get("qr") for r in caplog.records if r.getMessage() == "read"] == [1, 1]
