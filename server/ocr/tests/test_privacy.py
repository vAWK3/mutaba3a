"""AC4: a full read makes no network call. AC5: no receipt text reaches a log line.

AC4 here is the code-level proof: every way Python opens a connection or resolves a name raises, the engines are
built and warmed under that, and each kind of file is read. CI repeats the suite under `docker run --network none`,
which also covers the Tesseract subprocess (a separate binary this patch can't reach; it has no network code path).
"""

from __future__ import annotations

import json
import logging
import socket

import pytest

from app.logs import JsonFormatter
from app.pipeline import Reader
from conftest import SETTINGS, fixture_bytes, needs_engines, post

pytestmark = needs_engines

FILES = ["syn-001-ar-photo.jpg", "syn-009-he-photo.jpg", "syn-025-en-photo.jpg", "syn-039-he-pdf-text.pdf", "syn-043-ar-pdf-image.pdf"]


class NetworkCall(AssertionError):
    pass


@pytest.fixture
def no_network(monkeypatch):
    calls: list[str] = []

    def refuse(name):
        def _raise(*args, **kwargs):
            calls.append(name)
            raise NetworkCall(f"network call: {name}")

        return _raise

    monkeypatch.setattr(socket.socket, "connect", refuse("socket.connect"))
    monkeypatch.setattr(socket.socket, "connect_ex", refuse("socket.connect_ex"))
    monkeypatch.setattr(socket.socket, "sendto", refuse("socket.sendto"))
    monkeypatch.setattr(socket, "create_connection", refuse("socket.create_connection"))
    monkeypatch.setattr(socket, "getaddrinfo", refuse("socket.getaddrinfo"))
    monkeypatch.setattr(socket, "gethostbyname", refuse("socket.gethostbyname"))
    return calls


def test_ac4_building_the_engines_and_reading_every_kind_of_file_makes_no_network_call(no_network):
    reader = Reader(SETTINGS)
    reader.warm_up()
    for name in FILES:
        body, content_type = fixture_bytes(name)
        result = reader.read(body, content_type, "photo")
        assert result["lines"] or result.get("pdfText")
    assert no_network == []


def test_ac4_the_guard_itself_works(no_network):
    with pytest.raises(NetworkCall):
        socket.create_connection(("example.com", 443))


def _receipt_words(body: dict) -> set[str]:
    words = {w for line in body["lines"] for w in line["text"].split() if len(w) >= 3}
    words |= {w for w in (body.get("pdfText") or "").split() if len(w) >= 3}
    return words


def test_ac5_no_receipt_text_in_any_log_record(client, caplog):
    caplog.set_level(logging.DEBUG)
    formatter = JsonFormatter()
    seen_words: set[str] = set()
    for name in FILES:
        res = post(client, *fixture_bytes(name))
        assert res.status_code == 200
        seen_words |= _receipt_words(res.json())
    # Numbers like "2025" or "100" could appear as counts or timings; a word with a letter can't.
    words = {w for w in seen_words if any(ch.isalpha() for ch in w)}
    assert len(words) > 30
    rendered = "\n".join([caplog.text] + [formatter.format(r) for r in caplog.records])
    leaked = sorted(w for w in words if w in rendered)
    assert leaked == []
    stats = [getattr(r, "stats", {}) for r in caplog.records if r.getMessage() == "read"]
    assert len(stats) == len(FILES) and all("totalMs" in s or "chars" in s for s in stats)


def test_ac5_a_refusal_logs_only_its_code(client, caplog):
    caplog.set_level(logging.DEBUG)
    res = post(client, b"\xff\xd8\xff ZZSECRETVENDOR", "image/jpeg")
    assert res.status_code == 422
    assert "ZZSECRETVENDOR" not in caplog.text
    assert any(getattr(r, "stats", {}).get("outcome") == "unreadable" for r in caplog.records)


def test_ac5_the_json_formatter_never_formats_an_exception():
    record = logging.LogRecord("x", logging.ERROR, __file__, 1, "read failed", None, None)
    try:
        raise ValueError("ZZSECRETVENDOR")
    except ValueError:
        import sys

        record.exc_info = sys.exc_info()
    record.stats = {"error": "ValueError"}
    out = JsonFormatter().format(record)
    assert "ZZSECRETVENDOR" not in out and json.loads(out)["error"] == "ValueError"
