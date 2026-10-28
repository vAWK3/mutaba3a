"""Shared fixtures. Engine-backed tests skip, with the reason, when Tesseract or the models are missing locally;
in the image (CI) both are always there."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.engines import tesseract_available
from app.main import create_app

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SETTINGS = Settings(worker="inline")


def _engines_missing() -> str | None:
    if not tesseract_available():
        return "tesseract is not on PATH (brew install tesseract, or run in the image)"
    for path in (SETTINGS.det_model, SETTINGS.rec_model, *(SETTINGS.tessdata_dir / f"{l}.traineddata" for l in ("ara", "heb", "eng"))):
        if not path.is_file():
            return f"model {path.name} missing: run python fetch_models.py"
    return None


ENGINES_MISSING = _engines_missing()
needs_engines = pytest.mark.skipif(ENGINES_MISSING is not None, reason=ENGINES_MISSING or "")

CONTENT_TYPES = {".jpg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf"}


def fixture_bytes(name: str) -> tuple[bytes, str]:
    path = FIXTURES / name
    return path.read_bytes(), CONTENT_TYPES[path.suffix]


@pytest.fixture(scope="session")
def manifest() -> dict:
    return {f["file"]: f for f in json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))["fixtures"]}


@pytest.fixture(scope="session")
def client():
    """The real app over the real engines, in this process (OCR_WORKER=inline), models loaded once."""
    if ENGINES_MISSING:
        pytest.skip(ENGINES_MISSING)
    with TestClient(create_app(SETTINGS)) as c:
        yield c


def post(client: TestClient, body: bytes, content_type: str, hint: str | None = None):
    headers = {"content-type": content_type}
    if hint:
        headers["x-capture-hint"] = hint
    return client.post("/v1/read", content=body, headers=headers)
