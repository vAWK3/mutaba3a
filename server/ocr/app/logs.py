"""JSON log lines for Cloud Logging: a message and a `stats` dict of counts, codes and timings. Never receipt text (AC5).

Nothing here formats an exception or its traceback: an exception's message may quote the file it choked on.
"""

from __future__ import annotations

import json
import logging
import sys

_LEVEL = {"DEBUG": "DEBUG", "INFO": "INFO", "WARNING": "WARNING", "ERROR": "ERROR", "CRITICAL": "CRITICAL"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {"severity": _LEVEL.get(record.levelname, "DEFAULT"), "logger": record.name, "message": record.getMessage()}
        stats = getattr(record, "stats", None)
        if isinstance(stats, dict):
            entry.update(stats)
        return json.dumps(entry, ensure_ascii=False)


def configure(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # RapidOCR logs its model paths and settings; keep only its errors.
    logging.getLogger("RapidOCR").setLevel(logging.ERROR)
