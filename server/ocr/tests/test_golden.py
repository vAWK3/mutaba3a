"""Golden-ish reads of five synthetic MUT-253 receipts: the total's and the date's digits appear in some line.

Not exact text: OCR wording drifts with engine versions; what the API's extractor needs is the digits. The benchmark
(plan task 8) scores the fields per language on the full set.
"""

from __future__ import annotations

import re

import pytest

from conftest import fixture_bytes, needs_engines, post

pytestmark = needs_engines

# file -> (the total as printed, the date as printed or as the line's visual order renders it)
EXPECTED = {
    "syn-001-ar-photo.jpg": ("64.180", r"20-01-2025|2025-01-20"),
    "syn-009-he-photo.jpg": ("240.82", r"16/06/2026"),
    "syn-025-en-photo.jpg": ("52.470", r"25-06-2026"),
    "syn-043-ar-pdf-image.pdf": ("174.49", r"26/02/2025|2025/02/26"),
}


def assert_contract(body: dict) -> None:
    assert re.fullmatch(r"[A-Za-z0-9._-]{1,40}", body["engine"])
    assert isinstance(body["pages"], int) and 0 <= body["pages"] <= 100
    for line in body["lines"]:
        assert set(line) <= {"text", "conf", "box", "script"}
        assert isinstance(line["text"], str) and 0 < len(line["text"]) <= 2000
        assert 0 <= line["conf"] <= 1
        assert len(line["box"]) == 4 and line["box"][0] <= line["box"][2] and line["box"][1] <= line["box"][3]
        assert line.get("script", "latn") in ("arab", "hebr", "latn")


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_reads_the_total_and_the_date(client, manifest, name):
    total, date = EXPECTED[name]
    truth = manifest[name]["truth"]
    assert total.replace(".", "").lstrip("0") == str(truth["totalMinor"])  # the expectation matches the manifest
    res = post(client, *fixture_bytes(name))
    assert res.status_code == 200
    body = res.json()
    assert_contract(body)
    assert body["engine"] == "rapid-tess" and body["pages"] == 1
    texts = [line["text"] for line in body["lines"]]
    assert any(total in t for t in texts), f"total {total} not read"
    assert any(re.search(date, t) for t in texts), "date not read"


def test_a_text_layer_pdf_is_read_from_its_text_not_ocr(client, manifest):
    res = post(client, *fixture_bytes("syn-039-he-pdf-text.pdf"))
    assert res.status_code == 200
    body = res.json()
    assert_contract(body)
    assert body["engine"] == "pdf-text" and body["lines"] == [] and body["pages"] == 1
    assert "302.97" in body["pdfText"] and "28.01.25" in body["pdfText"]
    assert manifest["syn-039-he-pdf-text.pdf"]["truth"]["totalMinor"] == 30297


def test_scripts_are_tagged(client):
    body = post(client, *fixture_bytes("syn-009-he-photo.jpg")).json()
    assert "hebr" in {line.get("script") for line in body["lines"]}
    body = post(client, *fixture_bytes("syn-001-ar-photo.jpg")).json()
    assert "arab" in {line.get("script") for line in body["lines"]}


def test_scanned_hint_skips_the_perspective_step_and_still_reads(client):
    res = post(client, *fixture_bytes("syn-025-en-photo.jpg"), hint="scanned")
    assert res.status_code == 200
    assert any("52.470" in line["text"] for line in res.json()["lines"])


def test_healthz(client):
    assert client.get("/healthz").json() == {"ok": True}
