"""MUT-540: turn a page that was read on its side or upside down (D4, D9, D10).

A phone photo can lie at 90° with no EXIF turn, and OCR then reads almost nothing. A page whose first read is poor
(little sure text) or sideways-shaped (most lines in tall boxes) asks Tesseract's orientation model (OSD) for the turn,
is read once more turned that way, and keeps the turned read only when it reads clearly better. A good read costs
nothing; a poor one at most one OSD call and one re-read, skipped when the request's deadline is close.

RapidOCR turns any crop taller than wide by itself, so one sideways direction reads nearly as well as upright, in tall
boxes the extractor would glue into one row: box shape, not the score alone, tells that read from an upright one.

Counts only reach the logs (`turned`, `orientSkipped`), never text.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal

import numpy as np

from .config import Settings
from .engines import Segment

#: A line counts toward the score at or over this confidence.
SURE = 0.8
#: A line this long or longer shows its shape; a single digit or speck is tall on any page.
SHAPED_CHARS = 3
#: OSD's answers that are a turn.
TURNS = (0, 90, 180, 270)


def confident_chars(segments: list[Segment]) -> int:
    """The read's score: how many characters it read on sure lines."""
    return sum(len(s.text) for s in segments if s.conf >= SURE)


def looks_sideways(segments: list[Segment]) -> bool:
    """Most lines of SHAPED_CHARS or more sit in boxes taller than wide."""
    shaped = [s for s in segments if len(s.text.strip()) >= SHAPED_CHARS]
    tall = sum(1 for s in shaped if (s.box[3] - s.box[1]) > (s.box[2] - s.box[0]))
    return bool(shaped) and 2 * tall > len(shaped)


def needs_turn(segments: list[Segment], settings: Settings) -> bool:
    return confident_chars(segments) < settings.min_confident_chars or looks_sideways(segments)


def turn(page: np.ndarray, deg: int) -> np.ndarray:
    """The page (gray or RGB) turned upright: OSD reports how far it is turned counter-clockwise, so turn it back."""
    return page if deg == 0 else np.ascontiguousarray(np.rot90(page, k=-(deg // 90)))


def propose_turn(gray: np.ndarray, osd: Callable[[np.ndarray], int]) -> int | None:
    """OSD's turn for the page, or None when it has none to give (too little text, or an answer that isn't a turn)."""
    try:
        deg = int(osd(gray))
    except Exception:  # noqa: BLE001 - OSD fails on sparse pages ("Too few characters"); the first read stands
        return None
    return deg if deg in TURNS else None


def keep_turn(first: list[Segment], turned: list[Segment], settings: Settings) -> bool:
    """D9: a sideways-shaped first read gives way to an upright turned one unless the turn reads clearly worse;
    otherwise the turn must read clearly better (a strict gain and a minimum of characters: a tie never flips)."""
    a, b = confident_chars(first), confident_chars(turned)
    if looks_sideways(first) and not looks_sideways(turned):
        return b >= settings.sideways_keep * a
    return b > settings.turn_gain * a and b - a >= settings.min_turn_gain_chars


Outcome = Literal["upright", "turned", "kept", "skipped"]


@dataclass
class Reoriented:
    gray: np.ndarray
    segments: list[Segment]
    script: str
    #: upright: no turn needed; turned: the turned read won; kept: tried, the first read stands; skipped: no time.
    outcome: Outcome


def reorient(
    gray: np.ndarray,
    first: list[Segment],
    script: str,
    read_turned: Callable[[int], tuple[np.ndarray, list[Segment], str]],
    osd: Callable[[np.ndarray], int],
    *,
    budget_s: float | None,
    first_s: float,
    settings: Settings,
    pages_left: int = 0,
) -> Reoriented:
    """D4/D10: the page the right way up and its read. `read_turned(deg)` prepares the page again turned by `deg` (its
    perspective and deskew only work on upright lines) and reads it. `budget_s`: the time left for the request (None:
    unbounded); the retry runs only with twice the first read's time left plus one read for each of the `pages_left`
    still to read, so it can never cost the request its reads. A turned read that fails keeps the first."""
    if not settings.orientation or not needs_turn(first, settings):
        return Reoriented(gray, first, script, "upright")
    if budget_s is not None and budget_s < (2 + pages_left) * first_s:
        return Reoriented(gray, first, script, "skipped")
    deg = propose_turn(gray, osd)
    if not deg:
        return Reoriented(gray, first, script, "kept")
    try:
        turned_gray, turned, turned_script = read_turned(deg)
    except Exception:  # noqa: BLE001 - an engine or OpenCV failure on the turned page; the first read stands
        return Reoriented(gray, first, script, "kept")
    if keep_turn(first, turned, settings):
        return Reoriented(turned_gray, turned, turned_script, "turned")
    return Reoriented(gray, first, script, "kept")
