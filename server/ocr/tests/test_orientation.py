"""MUT-540: turning a page read on its side or upside down (D4, D9, D10). Pure units over fake readings: no engines."""

from __future__ import annotations

import numpy as np
import pytest

from app import orientation
from app.config import Settings
from app.engines import Segment

SETTINGS = Settings(worker="inline")


def seg(text: str, conf: float = 0.95, w: float = 200, h: float = 20) -> Segment:
    return Segment(text, conf, (0.0, 0.0, w, h))


def wide(n: int, text: str = "Total 52.470 JOD", conf: float = 0.95) -> list[Segment]:
    return [seg(text, conf) for _ in range(n)]


def tall(n: int, text: str = "Total 52.470 JOD", conf: float = 0.95) -> list[Segment]:
    return [seg(text, conf, w=20, h=200) for _ in range(n)]


# --- the score and the triggers -----------------------------------------------------------------------------------


def test_confident_chars_counts_only_the_sure_lines():
    assert orientation.confident_chars([seg("abcd", 0.9), seg("efgh", 0.79), seg("ij", 0.8)]) == 6
    assert orientation.confident_chars([]) == 0


def test_looks_sideways_when_most_lines_of_three_or_more_characters_are_taller_than_wide():
    assert orientation.looks_sideways(tall(5) + wide(2))
    assert not orientation.looks_sideways(wide(5) + tall(2))
    # Single digits and specks are tall on any page: they don't count.
    assert not orientation.looks_sideways(wide(3) + [seg("1", w=8, h=20) for _ in range(10)])
    assert not orientation.looks_sideways([])


def test_needs_turn_on_little_sure_text_or_tall_lines_never_on_a_good_read():
    assert not orientation.needs_turn(wide(10), SETTINGS)
    assert orientation.needs_turn(wide(2), SETTINGS)  # 32 confident characters < 80
    assert orientation.needs_turn(wide(10, conf=0.5), SETTINGS)
    assert orientation.needs_turn(tall(10), SETTINGS)


# --- turning ------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("deg", [90, 180, 270])
def test_turn_undoes_the_counter_clockwise_turn_osd_reports(deg):
    page = np.arange(36, dtype=np.uint8).reshape(3, 4, 3)  # an RGB page; a gray one turns the same way
    turned_away = np.rot90(page, k=deg // 90)  # PIL's rotate(deg): counter-clockwise, as OSD's `rotate` reports it
    assert np.array_equal(orientation.turn(turned_away, deg), page)
    assert np.array_equal(orientation.turn(turned_away[..., 0], deg), page[..., 0])
    assert orientation.turn(page, 0) is page


def test_propose_turn_takes_only_a_quarter_turn_and_never_raises():
    gray = np.zeros((10, 10), np.uint8)
    assert orientation.propose_turn(gray, lambda g: 90) == 90
    assert orientation.propose_turn(gray, lambda g: 0) == 0
    assert orientation.propose_turn(gray, lambda g: 45) is None

    def too_few_characters(g):
        raise RuntimeError("Too few characters. Skipping this page")

    assert orientation.propose_turn(gray, too_few_characters) is None


# --- the keep rule (D9) -------------------------------------------------------------------------------------------


def test_a_turn_is_kept_only_on_a_clear_gain():
    assert orientation.keep_turn(wide(2), wide(4), SETTINGS)  # 32 -> 64: 2x and +32
    assert not orientation.keep_turn(wide(4), wide(5), SETTINGS)  # 64 -> 80: 1.25x exactly is a tie, not a gain
    assert not orientation.keep_turn([seg("ab")], [seg("abcd")], SETTINGS)  # 2x but only +2 characters
    assert not orientation.keep_turn([], [], SETTINGS)  # nothing vs nothing never flips a page


def test_a_sideways_shaped_first_read_gives_way_to_an_upright_turn_unless_it_reads_clearly_worse():
    # RapidOCR turns tall crops itself, so one sideways direction reads as well as upright, in tall boxes.
    assert orientation.keep_turn(tall(10), wide(10), SETTINGS)
    assert orientation.keep_turn(tall(10), wide(8), SETTINGS)  # 0.8x of the first
    assert not orientation.keep_turn(tall(10), wide(7), SETTINGS)  # under 0.8x: clearly worse
    assert not orientation.keep_turn(tall(10), tall(12), SETTINGS)  # still sideways: the plain gain rule


# --- one page (D4, D10): at most one OSD call and one re-read, inside the deadline ---------------------------------


class Fakes:
    def __init__(self, reread: list[Segment], osd_turn=90):
        self.reread = reread
        self.osd_turn = osd_turn
        self.reads: list[np.ndarray] = []
        self.osd_calls = 0

    def read_turned(self, deg):
        self.reads.append(deg)
        return np.zeros((4, 3), np.uint8), self.reread, "latn"

    def osd(self, gray):
        self.osd_calls += 1
        if isinstance(self.osd_turn, Exception):
            raise self.osd_turn
        return self.osd_turn


def reorient(first, fakes: Fakes, budget_s=None, first_s=1.0, settings=SETTINGS, pages_left=0):
    gray = np.arange(12, dtype=np.uint8).reshape(3, 4)
    return gray, orientation.reorient(gray, first, "latn", fakes.read_turned, fakes.osd, budget_s=budget_s, first_s=first_s, settings=settings, pages_left=pages_left)


def test_a_good_page_costs_nothing():
    fakes = Fakes(wide(10))
    _, result = reorient(wide(10), fakes)
    assert result.outcome == "upright" and fakes.osd_calls == 0 and fakes.reads == []


def test_a_poor_page_is_turned_once_when_the_turn_reads_better():
    fakes = Fakes(wide(10), osd_turn=90)
    _, result = reorient(wide(1), fakes)
    assert result.outcome == "turned" and fakes.osd_calls == 1 and fakes.reads == [90]
    assert result.segments == fakes.reread and result.gray.shape == (4, 3)


def test_a_turn_that_reads_no_better_keeps_the_first_read():
    first = wide(1)
    fakes = Fakes(wide(1), osd_turn=180)
    gray, result = reorient(first, fakes)
    assert result.outcome == "kept" and result.segments is first and result.gray is gray and len(fakes.reads) == 1


@pytest.mark.parametrize("osd_turn", [0, RuntimeError("Too few characters"), 45])
def test_no_turn_or_an_osd_failure_keeps_the_first_read_without_a_re_read(osd_turn):
    first = wide(1)
    fakes = Fakes(wide(10), osd_turn=osd_turn)
    _, result = reorient(first, fakes)
    assert result.outcome == "kept" and result.segments is first and fakes.reads == []


def test_with_too_little_time_left_the_retry_is_skipped():
    first = wide(1)
    fakes = Fakes(wide(10))
    _, result = reorient(first, fakes, budget_s=1.9, first_s=1.0)  # under 2x the first read
    assert result.outcome == "skipped" and result.segments is first and fakes.osd_calls == 0 and fakes.reads == []
    _, result = reorient(first, Fakes(wide(10)), budget_s=2.5, first_s=1.0)
    assert result.outcome == "turned"


def test_orientation_off_never_asks_osd():
    from dataclasses import replace

    fakes = Fakes(wide(10))
    _, result = reorient(wide(1), fakes, settings=replace(SETTINGS, orientation=False))
    assert result.outcome == "upright" and fakes.osd_calls == 0


# --- MUT-540 pre-landing review ------------------------------------------------------------------------------------


def test_the_retry_leaves_time_for_the_pages_still_to_read():
    """Review #3: page 1's retry may not eat page 2's read: with one page left it needs 3x the first read's time."""
    first = wide(1)
    _, result = reorient(first, Fakes(wide(10)), budget_s=2.5, first_s=1.0, pages_left=1)
    assert result.outcome == "skipped"
    _, result = reorient(first, Fakes(wide(10)), budget_s=3.1, first_s=1.0, pages_left=1)
    assert result.outcome == "turned"


def test_a_failing_turned_read_keeps_the_first_read():
    """Review #4: the first read stands when the turned page can't be read (an engine or OpenCV error)."""
    first = wide(1)
    fakes = Fakes(wide(10))

    def broken(deg):
        raise RuntimeError("engine failure on the turned page")

    gray = np.zeros((3, 4), np.uint8)
    result = orientation.reorient(gray, first, "latn", broken, fakes.osd, budget_s=None, first_s=1.0, settings=SETTINGS)
    assert result.outcome == "kept" and result.segments is first
