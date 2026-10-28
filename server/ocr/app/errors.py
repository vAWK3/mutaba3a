"""The sidecar's refusals, in the API client's contract (server/src/receipts/ocr-client.ts).

A refusal carries a code and nothing else: never a word of the receipt, never the decoder's own message.
"""

from __future__ import annotations

#: code -> HTTP status, as OcrRefusalSchema and the client's status fallback expect.
STATUS = {"unreadable": 422, "too_large": 413, "timeout": 504}


class Refusal(Exception):
    def __init__(self, code: str) -> None:
        if code not in STATUS:
            raise ValueError("unknown refusal code")
        super().__init__(code)
        self.code = code

    @property
    def status(self) -> int:
        return STATUS[self.code]
