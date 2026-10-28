"""A stand-in reader for the HTTP and deadline tests: no models. b"slow" sleeps past any test deadline, b"crash"
raises, b"fine" answers; anything else goes through the real decode (and its refusals) and answers no lines."""

from __future__ import annotations

import time


class SlowReader:
    def __init__(self, settings) -> None:
        self.settings = settings

    def warm_up(self) -> None:
        return None

    def read(self, body: bytes, content_type: str, hint: str) -> dict:
        if body == b"slow":
            time.sleep(10)
        if body == b"crash":
            raise RuntimeError("a message that quotes ZZRECEIPTTEXT")
        if body == b"fine":
            return {"engine": "test", "lines": [], "pages": 1}
        from app.decode import decode

        decoded = decode(body, content_type)
        return {"engine": "test", "lines": [], "pages": decoded.page_count}
