"""R3 (F1): decode bounds, the deadline and the refusals, in the API client's contract. None of these load a model."""

from __future__ import annotations

import io
import struct
import time
import zlib

import pypdfium2 as pdfium
import pytest
from fastapi.testclient import TestClient

from app import config, decode as decode_mod
from app.config import Settings
from app.decode import decode
from app.errors import Refusal
from app.main import create_app
from app.worker import ProcessWorker

FAST_S = 2.0


def png_header_only(width: int, height: int) -> bytes:
    """A PNG that declares width x height but carries a few bytes of pixels: a decompression bomb's header."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"\x00" * 64)) + chunk(b"IEND", b"")


def pdf_with_pages(count: int, size: tuple[float, float] = (200, 200)) -> bytes:
    pdf = pdfium.PdfDocument.new()
    for _ in range(count):
        pdf.new_page(*size)
    buf = io.BytesIO()
    pdf.save(buf)
    pdf.close()
    return buf.getvalue()


def pdf_with_text(text: str, render_mode: int) -> bytes:
    """A one-page PDF whose text is drawn with `render_mode` (0 visible, 3 invisible: what a scanner's OCR writes)."""
    stream = f"BT /F1 12 Tf {render_mode} Tr 20 100 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
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


RECEIPT_TEXT = "Grocer Ltd Total 61.83 Date 11/12/2025"


def test_a_visible_text_layer_is_read_as_text():
    decoded = decode(pdf_with_text(RECEIPT_TEXT, 0), "application/pdf")
    assert decoded.pdf_text is not None and "61.83" in decoded.pdf_text and decoded.pages == []


def test_an_invisible_text_layer_is_another_readers_ocr_so_the_page_is_rasterised():
    # MUT-504: Adobe Scan writes its OCR as invisible text over the scan; its Hebrew comes out as Latin junk.
    decoded = decode(pdf_with_text(RECEIPT_TEXT, 3), "application/pdf")
    assert decoded.pdf_text is None and len(decoded.pages) == 1 and decoded.flat


@pytest.fixture(scope="module")
def stub_client():
    """The real HTTP layer over a stand-in reader (tests/slow_reader.py) in a real worker process."""
    with TestClient(create_app(Settings(deadline_s=1.5, worker="process"), factory="slow_reader:SlowReader")) as c:
        yield c


def refusal_of(fn) -> tuple[str, float]:
    started = time.perf_counter()
    with pytest.raises(Refusal) as err:
        fn()
    return err.value.code, time.perf_counter() - started


@pytest.mark.parametrize(("width", "height"), [(50_000, 50_000), (7_000, 6_000)])
def test_an_image_over_40_mp_is_refused_from_its_header(width, height):
    code, took = refusal_of(lambda: decode(png_header_only(width, height), "image/png"))
    assert code == "too_large" and took < FAST_S


def test_a_300_page_pdf_is_refused_fast():
    body = pdf_with_pages(300)
    code, took = refusal_of(lambda: decode(body, "application/pdf"))
    assert code == "too_large" and took < FAST_S


def test_only_the_first_two_pages_are_read():
    decoded = decode(pdf_with_pages(5), "application/pdf")
    assert decoded.page_count == 2 and len(decoded.pages) == 2 and decoded.flat


def test_a_huge_pdf_page_is_rasterised_under_the_pixel_cap():
    decoded = decode(pdf_with_pages(1, size=(2_000, 2_000)), "application/pdf")  # 69 MP at 300 dpi
    h, w = decoded.pages[0].shape[:2]
    assert h * w <= config.MAX_PIXELS


@pytest.mark.parametrize(
    ("body", "content_type"),
    [(b"\xff\xd8\xff not really a jpeg", "image/jpeg"), (b"%PDF-1.7 broken", "application/pdf"), (b"", "image/png"), (png_header_only(10, 10)[:30], "image/png")],
)
def test_undecodable_files_are_unreadable(body, content_type):
    assert refusal_of(lambda: decode(body, content_type))[0] == "unreadable"


def test_an_image_that_is_not_jpeg_or_png_is_unreadable():
    gif = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
    assert refusal_of(lambda: decode(gif, "image/png"))[0] == "unreadable"


@pytest.mark.parametrize(
    ("body", "content_type", "status", "code"),
    [
        (png_header_only(50_000, 50_000), "image/png", 413, "too_large"),
        (pdf_with_pages(300), "application/pdf", 413, "too_large"),
        (b"\xff\xd8\xff not really a jpeg", "image/jpeg", 422, "unreadable"),
        (b"x", "image/gif", 422, "unreadable"),
    ],
)
def test_http_refusals_follow_the_client_contract(stub_client, body, content_type, status, code):
    started = time.perf_counter()
    res = stub_client.post("/v1/read", content=body, headers={"content-type": content_type})
    assert (res.status_code, res.json()) == (status, {"error": code})
    assert time.perf_counter() - started < FAST_S


def test_a_body_over_the_cap_is_413(stub_client, monkeypatch):
    monkeypatch.setattr(config, "MAX_BODY_BYTES", 100)
    res = stub_client.post("/v1/read", content=b"x" * 101, headers={"content-type": "image/jpeg"})
    assert res.status_code == 413 and res.json() == {"error": "too_large"}


def test_the_deadline_answers_504_timeout_and_the_worker_comes_back(stub_client):
    started = time.perf_counter()
    res = stub_client.post("/v1/read", content=b"slow", headers={"content-type": "image/jpeg"})
    assert res.status_code == 504 and res.json() == {"error": "timeout"}
    assert time.perf_counter() - started < 4
    # The stuck child was killed and replaced (reads meanwhile answer `timeout` within their deadline); then reads work.
    until = time.perf_counter() + 30
    while stub_client.get("/healthz").status_code != 200 and time.perf_counter() < until:
        time.sleep(0.05)
    ok = stub_client.post("/v1/read", content=b"fine", headers={"content-type": "image/jpeg", "x-capture-hint": "scanned"})
    assert ok.status_code == 200 and ok.json()["engine"] == "test"


def test_a_crash_in_the_reader_is_500_internal_with_no_message(stub_client):
    res = stub_client.post("/v1/read", content=b"crash", headers={"content-type": "image/jpeg"})
    assert res.status_code == 500 and res.json() == {"error": "internal"}
    assert "ZZRECEIPTTEXT" not in res.text


def test_inline_worker_soft_deadline():
    with TestClient(create_app(Settings(deadline_s=0.3, worker="inline"), factory="slow_reader:SlowReader")) as c:
        res = c.post("/v1/read", content=b"slow", headers={"content-type": "image/jpeg"})
    assert res.status_code == 504 and res.json() == {"error": "timeout"}


def test_decode_module_sets_pillows_own_bomb_guard():
    from PIL import Image

    assert Image.MAX_IMAGE_PIXELS == config.MAX_PIXELS
    assert decode_mod.config.MAX_PIXELS == 40_000_000


def _wait_ready(worker, limit_s: float = 30.0) -> None:
    until = time.perf_counter() + limit_s
    while not worker.ready and time.perf_counter() < until:
        time.sleep(0.05)
    assert worker.ready


def test_a_read_never_waits_on_a_worker_restart_past_its_deadline(monkeypatch):
    """MUT-441 review: a restart (up to START_TIMEOUT_S) must not hold a request past the request's own deadline."""
    worker = ProcessWorker(Settings(worker="process"), factory="slow_reader:SlowStartReader")
    worker.start()
    try:
        monkeypatch.setenv("SLOW_READER_WARM_UP_S", "6")
        assert refusal_of(lambda: worker.run(b"slow", "image/jpeg", "photo", 0.5))[0] == "timeout"
        # The child is being replaced (6 s to warm up): the next read answers `timeout` within its own deadline.
        code, took = refusal_of(lambda: worker.run(b"fine", "image/jpeg", "photo", 0.5))
        assert code == "timeout" and took < 1.5
        _wait_ready(worker)
        assert worker.run(b"fine", "image/jpeg", "photo", 2.0)["engine"] == "test"
    finally:
        worker.stop()


def test_a_worker_that_is_not_ready_answers_timeout_at_once_and_restarts_in_the_background():
    worker = ProcessWorker(Settings(worker="process"), factory="slow_reader:SlowReader")
    worker.start()
    worker.stop()
    try:
        code, took = refusal_of(lambda: worker.run(b"fine", "image/jpeg", "photo", 5.0))
        assert code == "timeout" and took < 1.0
        _wait_ready(worker)
        assert worker.run(b"fine", "image/jpeg", "photo", 2.0)["engine"] == "test"
    finally:
        worker.stop()
