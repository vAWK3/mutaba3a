"""Where a read runs, so the 30 s deadline (R3) is a hard one.

`ProcessWorker` (production) keeps the loaded models in one child process and talks to it over a pipe. A read that
outlives its deadline is answered `timeout` and the child is killed and started again: a Python thread can't be
stopped, a process can. `InlineWorker` (tests, `OCR_WORKER=inline`) runs the read in this process with a soft
deadline, so a test can watch everything the read does (its sockets, its log records).
"""

from __future__ import annotations

import importlib
import logging
import multiprocessing as mp
import threading
import time
from typing import Any, Callable

from .config import Settings
from .errors import Refusal

log = logging.getLogger("receipt_ocr.worker")

#: The child must load both models within this long, or it is treated as broken.
START_TIMEOUT_S = 180.0
DEFAULT_FACTORY = "app.pipeline:Reader"


class WorkerError(Exception):
    """The read failed in a way that says nothing about the file (a crash, a bug): the API retries it."""


def _load(factory: str) -> Callable[[Settings], Any]:
    module, _, name = factory.partition(":")
    return getattr(importlib.import_module(module), name)


def _serve(conn, settings: Settings, factory: str) -> None:  # runs in the child
    from .logs import configure

    configure()
    reader = _load(factory)(settings)
    reader.warm_up()
    conn.send(("ready",))
    while True:
        try:
            msg = conn.recv()
        except EOFError:
            return
        _, body, content_type, hint = msg
        try:
            conn.send(("ok", reader.read(body, content_type, hint)))
        except Refusal as refusal:
            conn.send(("refused", refusal.code))
        except Exception as exc:  # noqa: BLE001 - the type only; its message may quote the file
            log.error("read failed", extra={"stats": {"error": type(exc).__name__}})
            conn.send(("error",))


class ProcessWorker:
    def __init__(self, settings: Settings, factory: str = DEFAULT_FACTORY) -> None:
        self.settings = settings
        self.factory = factory
        self._ctx = mp.get_context("spawn")
        self._lock = threading.Lock()
        self._proc = None
        self._conn = None
        self._ready = threading.Event()
        self._restarting = threading.Event()

    @property
    def ready(self) -> bool:
        return self._ready.is_set()

    def start(self) -> None:
        with self._lock:
            self._start_locked()

    def _start_locked(self) -> None:
        self._ready.clear()
        parent, child = self._ctx.Pipe()
        proc = self._ctx.Process(target=_serve, args=(child, self.settings, self.factory), daemon=True)
        proc.start()
        child.close()
        if not parent.poll(START_TIMEOUT_S):
            proc.kill()
            raise WorkerError("worker did not start")
        try:
            parent.recv()
        except EOFError:
            raise WorkerError("worker died while starting") from None
        self._proc, self._conn = proc, parent
        self._ready.set()
        log.info("worker ready", extra={"stats": {"pid": proc.pid}})

    def _restart_locked(self) -> None:
        if self._proc is not None:
            self._proc.kill()
            self._proc.join(5)
        self._start_locked()

    def run(self, body: bytes, content_type: str, hint: str, timeout: float) -> dict[str, Any]:
        """Never waits past `timeout` (MUT-441 review): not even on a restart, which can take START_TIMEOUT_S. A read
        that arrives while the child is being replaced waits for it only within its own deadline; one that finds no
        child at all answers `timeout` at once and starts the replacement in the background."""
        deadline = time.monotonic() + max(0.0, timeout)
        if not self._lock.acquire(timeout=max(0.0, timeout)):
            raise Refusal("timeout")
        try:
            if not self._ready.is_set():
                self._restart_in_background()
                raise Refusal("timeout")
            assert self._conn is not None
            try:
                self._conn.send(("read", body, content_type, hint))
                remaining = deadline - time.monotonic()
                if not self._conn.poll(max(0.0, remaining)):
                    log.warning("read timed out; restarting the worker", extra={"stats": {"timeoutS": round(timeout, 2)}})
                    self._ready.clear()
                    self._restart_in_background()
                    raise Refusal("timeout")
                reply = self._conn.recv()
            except (EOFError, BrokenPipeError, OSError):
                self._ready.clear()
                self._restart_in_background()
                raise WorkerError("worker died") from None
        finally:
            self._lock.release()
        if reply[0] == "ok":
            return reply[1]
        if reply[0] == "refused":
            raise Refusal(reply[1])
        raise WorkerError("read failed")

    def _restart_in_background(self) -> None:
        # One replacement at a time; it takes the lock once the caller has released it.
        if self._restarting.is_set():
            return
        self._restarting.set()
        threading.Thread(target=self._background_restart, daemon=True).start()

    def _background_restart(self) -> None:
        # Reads that arrive meanwhile wait on the lock only within their own deadlines (see `run`).
        try:
            with self._lock:
                if not self._ready.is_set():
                    self._restart_locked()
        except WorkerError:
            log.error("worker restart failed")
        finally:
            self._restarting.clear()

    def stop(self) -> None:
        with self._lock:
            if self._proc is not None:
                self._proc.kill()
                self._proc.join(5)
            self._ready.clear()


class InlineWorker:
    def __init__(self, settings: Settings, factory: str = DEFAULT_FACTORY) -> None:
        self.settings = settings
        self._reader = _load(factory)(settings)
        self._reader.warm_up()

    ready = True

    def start(self) -> None:
        return None

    def run(self, body: bytes, content_type: str, hint: str, timeout: float) -> dict[str, Any]:
        result: dict[str, Any] = {}
        error: list[BaseException] = []

        def work() -> None:
            try:
                result.update(self._reader.read(body, content_type, hint))
            except BaseException as exc:  # noqa: BLE001
                error.append(exc)

        thread = threading.Thread(target=work, daemon=True)
        thread.start()
        thread.join(max(0.0, timeout))
        if thread.is_alive():
            raise Refusal("timeout")
        if error:
            if isinstance(error[0], Refusal):
                raise error[0]
            log.error("read failed", extra={"stats": {"error": type(error[0]).__name__}})
            raise WorkerError("read failed")
        return result

    def stop(self) -> None:
        return None


def make_worker(settings: Settings, factory: str = DEFAULT_FACTORY):
    return InlineWorker(settings, factory) if settings.worker == "inline" else ProcessWorker(settings, factory)
