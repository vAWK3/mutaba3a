"""Script detection, and the bidi reorder RapidOCR's Arabic recogniser needs.

The Arabic PP-OCR model reads a line's glyphs in visual order ("عومجملا" for "المجموع"). RapidOCR reorders its output
with python-bidi's `get_display` (LGPL-3.0). We don't ship that: `get_display` below runs the same Unicode
Bidirectional Algorithm (UAX #9) for the case that occurs here: one line, no explicit embeddings or isolates, the base
direction from the first strong character (P2, P3). Rules W1–W7, N1–N2, I1–I2, L2 and the bracket mirroring of L4.
"""

from __future__ import annotations

import re

_ARAB = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")
_HEBR = re.compile(r"[֐-׿יִ-ﭏ]")
_LATN = re.compile(r"[A-Za-zÀ-ɏ]")
_STRONG_RTL = re.compile(r"[֐-׿יִ-ﭏ؈؋؍؛-ي٭-ٯٱ-ەۥۦۮۯۺ-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")

_MIRROR = {"(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<", "«": "»", "»": "«"}


def script_of(text: str) -> str | None:
    """`arab`, `hebr` or `latn` by the letters the text has most of; None for digits and punctuation only."""
    counts = {
        "arab": len(_ARAB.findall(text)),
        "hebr": len(_HEBR.findall(text)),
        "latn": len(_LATN.findall(text)),
    }
    best = max(counts, key=lambda k: counts[k])
    return best if counts[best] > 0 else None


def has_arabic_letters(text: str) -> bool:
    return bool(_ARAB.search(text))


def bidi_class(ch: str) -> str:
    """The bidi class of one character, for the classes a receipt line holds; anything else is ON."""
    o = ord(ch)
    if o == 0x200F:  # RLM
        return "R"
    if o == 0x200E:  # LRM
        return "L"
    if o == 0x061C:  # ALM
        return "AL"
    if "0" <= ch <= "9" or 0x06F0 <= o <= 0x06F9:
        return "EN"
    if 0x0660 <= o <= 0x0669 or o in (0x066B, 0x066C):
        return "AN"
    if 0x064B <= o <= 0x065F or o == 0x0670 or 0x0591 <= o <= 0x05C7 and ch not in "־׀׃׆" or 0x06D6 <= o <= 0x06ED:
        return "NSM"
    if 0x0590 <= o <= 0x05FF or 0xFB1D <= o <= 0xFB4F:
        return "R"
    if _STRONG_RTL.match(ch):
        return "AL"
    if ch in "+-":
        return "ES"
    if ch in "#$%°¢£¤¥₪€؊٪‰‱":
        return "ET"
    if ch in ",.:/ ،":
        return "CS"
    if ch in " \t":
        return "WS"
    if ch.isalpha() or ch.isdigit():
        return "L"
    return "ON"


def get_display(text: str) -> str:
    """UAX #9 over one line, base direction from the first strong character; what python-bidi's get_display does."""
    if not text:
        return text
    types = [bidi_class(ch) for ch in text]
    first_strong = next((t for t in types if t in ("L", "R", "AL")), "L")
    base = 1 if first_strong in ("R", "AL") else 0
    sos = "R" if base else "L"
    n = len(types)
    # W1: a non-spacing mark takes the type of what precedes it.
    for i, t in enumerate(types):
        if t == "NSM":
            types[i] = types[i - 1] if i > 0 else sos
    # W2: EN after AL (as the last strong) is AN. W3: AL is R.
    last = sos
    for i, t in enumerate(types):
        if t in ("L", "R", "AL"):
            last = t
        elif t == "EN" and last == "AL":
            types[i] = "AN"
    types = ["R" if t == "AL" else t for t in types]
    # W4: one separator between two numbers of a kind joins them.
    for i in range(1, n - 1):
        a, t, b = types[i - 1], types[i], types[i + 1]
        if t == "ES" and a == b == "EN":
            types[i] = "EN"
        elif t == "CS" and a == b and a in ("EN", "AN"):
            types[i] = a
    # W5: terminators next to a European number are part of it.
    i = 0
    while i < n:
        if types[i] == "ET":
            j = i
            while j < n and types[j] == "ET":
                j += 1
            if (i > 0 and types[i - 1] == "EN") or (j < n and types[j] == "EN"):
                for k in range(i, j):
                    types[k] = "EN"
            i = j
        else:
            i += 1
    # W6: other separators and terminators are neutral.
    types = ["ON" if t in ("ES", "ET", "CS") else t for t in types]
    # W7: EN after L (as the last strong) is L.
    last = sos
    for i, t in enumerate(types):
        if t in ("L", "R"):
            last = t
        elif t == "EN" and last == "L":
            types[i] = "L"
    # N1, N2: a run of neutrals between two strong sides of one direction takes it (numbers count as R), else base.
    def strong(t: str) -> str:
        return "R" if t in ("R", "EN", "AN") else t

    i = 0
    while i < n:
        if types[i] in ("WS", "ON"):
            j = i
            while j < n and types[j] in ("WS", "ON"):
                j += 1
            before = strong(types[i - 1]) if i > 0 else sos
            after = strong(types[j]) if j < n else sos
            fill = before if before == after else sos
            for k in range(i, j):
                types[k] = fill
            i = j
        else:
            i += 1
    # I1, I2: resolved levels.
    levels = []
    for t in types:
        if base == 0:
            levels.append(1 if t == "R" else 2 if t in ("AN", "EN") else 0)
        else:
            levels.append(2 if t in ("L", "EN", "AN") else 1)
    # L4: mirror paired brackets at odd levels. L2: reverse runs from the highest level down to the lowest odd one.
    chars = [(_MIRROR.get(ch, ch) if lvl % 2 else ch) for ch, lvl in zip(text, levels)]
    order = list(range(n))
    top = max(levels)
    lowest_odd = min((lvl for lvl in levels if lvl % 2), default=top + 1)
    for level in range(top, lowest_odd - 1, -1):
        i = 0
        while i < n:
            if levels[order[i]] >= level:
                j = i
                while j < n and levels[order[j]] >= level:
                    j += 1
                order[i:j] = reversed(order[i:j])
                i = j
            else:
                i += 1
    return "".join(chars[k] for k in order)


def visual_to_logical(text: str) -> str:
    """A line RapidOCR's Arabic model read (visual order) in logical order; a line with no right-to-left letter is
    unchanged."""
    if not _STRONG_RTL.search(text):
        return text
    return get_display(text).strip()
