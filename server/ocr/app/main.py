"""receipt-ocr: the API's own OCR service (MUT-441). No database, no bucket, no secret, no outbound network.

    POST /v1/read   body = the receipt's bytes; Content-Type image/jpeg | image/png | application/pdf;
                    X-Capture-Hint: scanned | photo (default photo)
        200 {engine, lines: [{text, conf, box, script?}], pdfText?, pages}
        422 {error: 'unreadable'}   413 {error: 'too_large'}   504 {error: 'timeout'}
        500 {error: 'internal'}     (the API retries it)
    GET /healthz    200 once the models are loaded, 503 before

One read at a time (R3 concurrency 1): the semaphore below, one uvicorn worker, Cloud Run concurrency 1.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import config
from .config import Settings, load_settings
from .errors import Refusal
from .logs import configure
from .worker import WorkerError, make_worker

log = logging.getLogger("receipt_ocr.http")

HINTS = ("scanned", "photo")


def refuse(code: str) -> JSONResponse:
    return JSONResponse({"error": code}, status_code=Refusal(code).status)


def create_app(settings: Settings | None = None, factory: str | None = None) -> FastAPI:
    settings = settings or load_settings()
    state: dict = {}

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        worker = make_worker(settings, factory) if factory else make_worker(settings)
        await asyncio.to_thread(worker.start)
        state["worker"] = worker
        state["slot"] = asyncio.Semaphore(1)
        try:
            yield
        finally:
            worker.stop()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(Exception)
    async def unexpected(_: Request, exc: Exception) -> JSONResponse:
        # The type only: an exception's message may quote the file.
        log.error("unhandled error", extra={"stats": {"error": type(exc).__name__}})
        return JSONResponse({"error": "internal"}, status_code=500)

    @app.get("/healthz")
    async def healthz() -> JSONResponse:
        worker = state.get("worker")
        ok = worker is not None and worker.ready
        return JSONResponse({"ok": ok}, status_code=200 if ok else 503)

    @app.post("/v1/read")
    async def read(request: Request) -> JSONResponse:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + settings.deadline_s
        started = time.perf_counter()
        content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
        hint = request.headers.get("x-capture-hint", "photo").strip().lower()
        hint = hint if hint in HINTS else "photo"
        if content_type not in config.ACCEPTED_TYPES:
            return _done(refuse("unreadable"), started, "unsupported_type")
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > config.MAX_BODY_BYTES:
            return _done(refuse("too_large"), started, "too_large")
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > config.MAX_BODY_BYTES:
                return _done(refuse("too_large"), started, "too_large")
        slot: asyncio.Semaphore = state["slot"]
        try:
            await asyncio.wait_for(slot.acquire(), timeout=max(0.0, deadline - loop.time()))
        except TimeoutError:
            return _done(refuse("timeout"), started, "timeout")
        try:
            result = await asyncio.to_thread(state["worker"].run, bytes(body), content_type, hint, max(0.0, deadline - loop.time()))
        except Refusal as refusal:
            return _done(refuse(refusal.code), started, refusal.code)
        except WorkerError:
            return _done(JSONResponse({"error": "internal"}, status_code=500), started, "internal")
        finally:
            slot.release()
        return _done(JSONResponse(result), started, "ok", bytesIn=len(body), lines=len(result.get("lines", [])))

    return app


def _done(response: JSONResponse, started: float, outcome: str, **counts: int) -> JSONResponse:
    log.info("read request", extra={"stats": {"outcome": outcome, "status": response.status_code, "ms": int((time.perf_counter() - started) * 1000), **counts}})
    return response


def app_factory() -> FastAPI:
    """uvicorn --factory app.main:app_factory"""
    configure()
    return create_app()
