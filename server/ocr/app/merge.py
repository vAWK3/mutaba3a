"""Keep the more confident reading of each printed line (MUT-441 plan §1).

RapidOCR returns segments (a label and its amount are two boxes on one line); Tesseract returns whole lines. Segments
that overlap vertically are grouped into rows by the same rule the API's extractor uses (server/src/receipts/extract/
rows.ts, SAME_ROW_OVERLAP), each Tesseract line is paired with the RapidOCR row it overlaps most, and of each pair
the reading with the higher mean confidence is kept. A row only one engine saw is kept as it is. The result never
holds two readings of the same line, so the extractor's own row grouping sees each line once.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .engines import Segment
from .text import has_arabic_letters

#: Two spans share a row when their vertical overlap is at least this share of the shorter one (rows.ts).
SAME_ROW_OVERLAP = 0.5
#: Within this confidence gap, the reading with more digits wins: PP-OCR's Arabic model drops digits inside Arabic
#: lines (MUT-253 spike), and the digits are what the extractor needs.
DIGIT_TIE_GAP = 0.05
#: A line with no letter or digit is noise.
MIN_ALNUM = 1
#: Two number fragments side by side on a row are one number when the gap between them is under this share of the
#: row's height (RapidOCR's detector sometimes boxes "64." and "180" apart); under the tight share, with no space.
NUMBER_GAP_SHARE = 0.8
NUMBER_TIGHT_GAP_SHARE = 0.25
#: On a Hebrew page, a reader is sure of its digits at this mean confidence (MUT-504). RapidOCR's sure digits replace
#: Tesseract's unsure ones on the same line; Tesseract's words stay.
SURE_DIGITS = 0.85


@dataclass
class Row:
    top: float
    bottom: float
    segments: list[Segment] = field(default_factory=list)

    @property
    def conf(self) -> float:
        return sum(s.conf for s in self.segments) / len(self.segments)

    @property
    def digits(self) -> int:
        return sum(ch.isdigit() for s in self.segments for ch in s.text)


def overlap_share(a: tuple[float, float], b: tuple[float, float]) -> float:
    overlap = min(a[1], b[1]) - max(a[0], b[0])
    shorter = min(a[1] - a[0], b[1] - b[0])
    return overlap / shorter if shorter > 0 else 0.0


def _is_number_fragment(text: str) -> bool:
    return any(ch.isdigit() for ch in text) and not any(ch.isalpha() for ch in text)


#: An amount with its decimals: a whole number already, never the first half of one (MUT-504: "61.8361.83").
_COMPLETE_AMOUNT = re.compile(r"\d+[.,]\d{2,3}")
#: MUT-540: a date as receipts print it (14/03/2026, 14.03.26).
_DATE = re.compile(r"\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}")
#: MUT-540: punctuation a number may carry at a word's edge ("14/03/2026:", "(63.25)").
_WORD_PUNCTUATION = ":;,|()[]\"'"


def join_number_fragments(segments: list[Segment]) -> list[Segment]:
    """Within one row, number fragments that sit side by side become one segment, read left to right."""
    ordered = sorted(segments, key=lambda s: s.box[0])
    out: list[Segment] = []
    for seg in ordered:
        prev = out[-1] if out else None
        both_complete = prev is not None and bool(_COMPLETE_AMOUNT.fullmatch(prev.text.strip()) and _COMPLETE_AMOUNT.fullmatch(seg.text.strip()))
        if prev is not None and _is_number_fragment(prev.text) and _is_number_fragment(seg.text) and not both_complete:
            height = max(prev.box[3] - prev.box[1], seg.box[3] - seg.box[1], 1.0)
            gap = seg.box[0] - prev.box[2]
            if gap < NUMBER_GAP_SHARE * height:
                sep = "" if gap < NUMBER_TIGHT_GAP_SHARE * height else " "
                out[-1] = Segment(
                    prev.text + sep + seg.text,
                    min(prev.conf, seg.conf),
                    (prev.box[0], min(prev.box[1], seg.box[1]), max(prev.box[2], seg.box[2]), max(prev.box[3], seg.box[3])),
                )
                continue
        out.append(seg)
    return out


def group_rows(segments: list[Segment]) -> list[Row]:
    rows: list[Row] = []
    for seg in sorted(segments, key=lambda s: s.box[1] + s.box[3]):
        span = (seg.box[1], seg.box[3])
        row = next((r for r in rows if overlap_share((r.top, r.bottom), span) >= SAME_ROW_OVERLAP), None)
        if row is None:
            rows.append(Row(span[0], span[1], [seg]))
        else:
            row.segments.append(seg)
            row.top, row.bottom = min(row.top, span[0]), max(row.bottom, span[1])
    for row in rows:
        row.segments = join_number_fragments(row.segments)
    return rows


#: A dashed or patterned separator line comes out as one long run of two or three letters ("RRREEERRSR"): a token at
#: least this long, with no digit and no space, whose two commonest characters make up this share of it.
NOISE_MIN_LEN = 10
NOISE_TOP2_SHARE = 0.6


def is_separator_noise(text: str) -> bool:
    token = text.strip()
    if len(token) < NOISE_MIN_LEN or " " in token or any(ch.isdigit() for ch in token):
        return False
    counts = sorted((token.count(ch) for ch in set(token)), reverse=True)
    return sum(counts[:2]) >= NOISE_TOP2_SHARE * len(token)


def _useful(seg: Segment) -> bool:
    return sum(ch.isalnum() for ch in seg.text) >= MIN_ALNUM and not is_separator_noise(seg.text)


def _better(a: Row, b: Row) -> Row:
    if abs(a.conf - b.conf) <= DIGIT_TIE_GAP and a.digits != b.digits:
        return a if a.digits > b.digits else b
    return a if a.conf >= b.conf else b


def _has_digit(text: str) -> bool:
    return any(ch.isdigit() for ch in text)


def _mean_conf(segments: list[Segment]) -> float:
    return sum(s.conf for s in segments) / len(segments) if segments else 0.0


def _x_overlap(a: Segment, b: Segment) -> bool:
    """Whether two boxes on one row cover the same stretch: at least SAME_ROW_OVERLAP of the narrower one."""
    return overlap_share((a.box[0], a.box[2]), (b.box[0], b.box[2])) >= SAME_ROW_OVERLAP


def _hebrew_line(line: Segment, rapid_digits: list[Segment], lettered: frozenset[int] = frozenset()) -> list[Segment]:
    """A Tesseract line on a Hebrew page, with RapidOCR's digit readings of it (MUT-504).

    Tesseract reads the Hebrew; RapidOCR, which has no Hebrew model, reads the digits better (bold totals and dates
    Tesseract garbles). Word by word: a digit word Tesseract is unsure of gives way to a sure RapidOCR box covering
    it, and a sure RapidOCR box Tesseract has no word under is added. A taken box replaces every digit word under it,
    so no amount appears twice. Tesseract's letter words stay as one segment at their own confidence; its digit words
    that stay keep their own, so an unsure amount is never averaged up by sure words. With nothing replaced or added,
    the line stays as it is.
    """
    words = list(line.words) or [line]
    sure = [r for r in rapid_digits if r.conf >= SURE_DIGITS]
    taken: list[Segment] = []
    kept: list[Segment] = []
    for word in words:
        cover = [r for r in sure if _x_overlap(word, r)] if _has_digit(word.text) and word.conf < SURE_DIGITS else []
        if cover:
            taken.extend(r for r in cover if r not in taken)
        else:
            kept.append(word)
    taken.extend(r for r in sure if r not in taken and not any(_x_overlap(word, r) for word in words))
    if not taken:
        return [line]
    letters = [w for w in kept if not _has_digit(w.text)]
    # MUT-540: a lettered RapidOCR box's numbers (`lettered`, ids) span its whole box; under it, a sure digit word
    # stays unless the box read that same number again.
    digits = [w for w in kept if _has_digit(w.text) and not any(_x_overlap(w, r) and (id(r) not in lettered or w.text in r.text.split()) for r in taken)]
    out = sorted(taken, key=lambda r: r.box[0])
    out[:0] = [Segment(w.text, w.conf, (w.box[0], line.box[1], w.box[2], line.box[3])) for w in digits]
    if letters:
        box = (min(w.box[0] for w in letters), line.box[1], max(w.box[2] for w in letters), line.box[3])
        out.insert(0, Segment(" ".join(w.text for w in letters), _mean_conf(letters), box))
    return out


def _dropped_amounts(nearby: list[Segment], line: Segment) -> list[Segment]:
    """MUT-540: the amounts a Tesseract line read that RapidOCR, whose reading of the line won, dropped. PP-OCR's
    Arabic model drops the digits of a mixed line ("المجموع الكلي: 88.50" read as the words alone, its box still
    spanning the amount), so Tesseract's complete amount words stay beside the line at their own confidence. Only when
    no RapidOCR row the line overlaps (`nearby`, claimed by an earlier line or not) holds a complete amount: then
    RapidOCR read it, and Tesseract's copy is a second, maybe misread, reading (86.50 for 88.50)."""
    if any(_COMPLETE_AMOUNT.search(r.text) for r in nearby):
        return []
    return [Segment(w.text, w.conf, (w.box[0], line.box[1], w.box[2], line.box[3])) for w in line.words if _COMPLETE_AMOUNT.search(w.text)]


def _sure_numbers_in_lettered(rapid: list[Segment]) -> list[Segment]:
    """MUT-540: on a Hebrew page, the dates and complete amounts in a sure RapidOCR box that also holds letters. Its
    Arabic model invents the Hebrew letters but reads the digits ("מסוף 09:12 14/03/2026" as "g1on 09:12 14/03/2026" at
    0.92). They stay together as one segment in the box they were read in, spaces between (two segments sharing a box
    would be joined as number fragments, "14/03/202663.25"); the letters never count."""
    out: list[Segment] = []
    for seg in rapid:
        if seg.conf < SURE_DIGITS or not any(ch.isalpha() for ch in seg.text):
            continue
        # Only a number standing as its own word: one glued into a code ("ab1-02.11.47-$3") is no date (bench p11).
        tokens = [w.strip(_WORD_PUNCTUATION) for w in seg.text.split()]
        numbers = [t for t in tokens if _DATE.fullmatch(t) or _COMPLETE_AMOUNT.fullmatch(t)]
        if numbers:
            out.append(Segment(" ".join(numbers), seg.conf, seg.box))
    return out


def merge(rapid: list[Segment], tess: list[Segment], page_script: str) -> list[Segment]:
    """The kept segments, top to bottom. `page_script` is the script Tesseract picked for the page.

    On a Hebrew page Tesseract is the reader; RapidOCR adds digit lines Tesseract missed, and its sure digits replace
    Tesseract's unsure ones on a line both read (`_hebrew_line`, MUT-504). Otherwise each
    Tesseract line is weighed against every RapidOCR row it overlaps (a tilted line can be two RapidOCR rows) that
    no earlier line claimed; when RapidOCR's reading wins, the amounts it dropped and Tesseract read stay beside it
    (`_dropped_amounts`, MUT-540). A Tesseract line whose rows were all claimed already is a second reading of a line that
    is decided, so it is dropped.
    """
    hebrew = page_script == "hebr"
    tess_lines = sorted((s for s in tess if _useful(s)), key=lambda s: s.box[1])
    lettered_for: dict[int, list[Segment]] = {}
    lettered_ids: frozenset[int] = frozenset()
    if hebrew:
        # PP-OCR has no Hebrew model: on a Hebrew page its Arabic recogniser turns Hebrew into invented letters. Only
        # its letter-free readings (amounts, dates, phone numbers) are kept, and only for lines Tesseract didn't see.
        # MUT-540: the sure dates and amounts inside a box its invented letters share help only the Tesseract line
        # they overlap most, as that line's digits; they never form a row, so they never claim (and drop) a line.
        lettered = _sure_numbers_in_lettered(rapid)
        lettered_ids = frozenset(id(s) for s in lettered)
        for number in lettered:
            span = (number.box[1], number.box[3])
            best = max(tess_lines, key=lambda t: overlap_share((t.box[1], t.box[3]), span), default=None)
            if best is not None and overlap_share((best.box[1], best.box[3]), span) >= SAME_ROW_OVERLAP:
                lettered_for.setdefault(id(best), []).append(number)
        rapid = [s for s in rapid if not any(ch.isalpha() for ch in s.text)]
    rapid_rows = group_rows([s for s in rapid if _useful(s)])
    claimed: set[int] = set()
    kept: list[Row] = []
    for seg in tess_lines:
        t_row = Row(seg.box[1], seg.box[3], [seg])
        overlapping = [i for i, r in enumerate(rapid_rows) if overlap_share((t_row.top, t_row.bottom), (r.top, r.bottom)) >= SAME_ROW_OVERLAP]
        extra = lettered_for.get(id(seg), [])
        if not overlapping:
            kept.append(Row(t_row.top, t_row.bottom, _hebrew_line(seg, extra, lettered_ids)) if extra else t_row)
            continue
        free = [i for i in overlapping if i not in claimed]
        if not free:
            continue
        claimed.update(free)
        if hebrew:
            digits = sorted([*(s for i in free for s in rapid_rows[i].segments), *extra], key=lambda s: s.box[0])
            kept.append(Row(t_row.top, t_row.bottom, _hebrew_line(seg, digits, lettered_ids)))
            continue
        joined = Row(min(rapid_rows[i].top for i in free), max(rapid_rows[i].bottom for i in free), [s for i in free for s in rapid_rows[i].segments])
        better = _better(joined, t_row)
        if better is joined:
            joined.segments.extend(_dropped_amounts([s for i in overlapping for s in rapid_rows[i].segments], seg))
        kept.append(better)
    kept.extend(r for i, r in enumerate(rapid_rows) if i not in claimed)
    kept.sort(key=lambda r: r.top)
    return [s for r in kept for s in r.segments]
