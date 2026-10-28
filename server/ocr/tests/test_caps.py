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
    # The stuck child was killed and replaced; the next read works.
    ok = stub_client.post("/v1/read", content=b"fine", headers={"content-type": "image/jpeg", "x-capture-hint": "scanned"}, timeout=60)
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
