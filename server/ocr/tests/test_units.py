"""Pure units: the bidi reorder, scripts, the row merge, preprocessing, the licence check (AC7)."""

from __future__ import annotations

import json

import cv2
import numpy as np
import pytest

import check_licenses
from app import preprocess
from app.config import Settings, load_settings
from app.engines import Segment
from app.merge import is_separator_noise, join_number_fragments, merge
from app.text import get_display, pdf_text_to_logical, script_of, visual_to_logical
from conftest import FIXTURES


# --- text ---------------------------------------------------------------------------------------------------------


def test_get_display_matches_the_reference_bidi_implementation():
    pairs = json.loads((FIXTURES / "bidi_reference.json").read_text(encoding="utf-8"))["pairs"]
    assert len(pairs) > 300
    mismatches = [(src, want, get_display(src)) for src, want in pairs if get_display(src) != want]
    assert mismatches == []


@pytest.mark.parametrize(
    ("visual", "logical"),
    [
        ("عومجملا 64.180", "64.180 المجموع"),
        ("64.180 (رانيد) عومجملا", "المجموع (دينار) 64.180"),
        ("Total (JD) 52.470", "Total (JD) 52.470"),
        ("12.50", "12.50"),
    ],
)
def test_visual_to_logical(visual, logical):
    assert visual_to_logical(visual) == logical


@pytest.mark.parametrize(("text", "script"), [("المجموع 5", "arab"), ('סה"כ 5', "hebr"), ("Total 5", "latn"), ("12.50", None), ("٨٦.٧٠", "arab")])
def test_script_of(text, script):
    assert script_of(text) == script


# --- merge --------------------------------------------------------------------------------------------------------


def seg(text, conf, x0, y0, x1, y1):
    return Segment(text, conf, (x0, y0, x1, y1))


def test_split_number_boxes_join_left_to_right():
    joined = join_number_fragments([seg("180", 0.99, 60, 0, 90, 20), seg("64.", 0.98, 20, 0, 58, 20), seg("المجموع", 0.9, 300, 0, 400, 20)])
    assert [s.text for s in joined] == ["64.180", "المجموع"]
    assert joined[0].conf == 0.98 and joined[0].box == (20, 0, 90, 20)


def test_two_complete_amounts_side_by_side_stay_apart():
    # MUT-504: two readings of a till receipt's total were glued into "61.8361.83".
    joined = join_number_fragments([seg("61.83", 0.99, 0, 0, 50, 20), seg("61.83", 0.99, 52, 0, 102, 20)])
    assert [s.text for s in joined] == ["61.83", "61.83"]


def test_number_boxes_far_apart_stay_apart():
    joined = join_number_fragments([seg("079", 1, 0, 0, 30, 20), seg("8452064", 1, 200, 0, 300, 20)])
    assert [s.text for s in joined] == ["079", "8452064"]


def test_the_more_confident_reading_of_a_line_wins_and_no_line_is_read_twice():
    rapid = [seg("Total", 0.99, 0, 100, 50, 120), seg("52.470", 0.99, 300, 100, 360, 120), seg("Cash", 0.6, 0, 140, 40, 160)]
    tess = [seg("Tota1 52.47O", 0.7, 0, 101, 360, 121), seg("Cash 80.000", 0.9, 0, 141, 360, 161)]
    out = merge(rapid, tess, "latn")
    assert [s.text for s in out] == ["Total", "52.470", "Cash 80.000"]


def test_a_tesseract_line_spanning_two_rapid_rows_is_weighed_against_both():
    rapid = [seg("مياه معدنية", 0.96, 200, 100, 400, 118), seg("100.72", 0.93, 0, 109, 80, 127)]
    tess = [seg("مياة معذلية 100.72", 0.76, 0, 100, 400, 127)]
    out = merge(rapid, tess, "arab")
    assert sorted(s.text for s in out) == ["100.72", "مياه معدنية"]


def test_on_a_hebrew_page_tesseract_reads_and_rapid_only_adds_digit_lines_it_missed():
    rapid = [seg("RRSEEERR", 0.7, 0, 0, 300, 20), seg("240.82", 0.999, 0, 50, 80, 70), seg("04-9675428", 0.99, 0, 200, 120, 220)]
    tess = [seg('סה"כ לתשלום (₪) 240.82', 0.92, 0, 50, 300, 70)]
    out = merge(rapid, tess, "hebr")
    assert [s.text for s in out] == ['סה"כ לתשלום (₪) 240.82', "04-9675428"]


def tess_line(words, y0=50, y1=70):
    """A Tesseract line with its words (text, conf, x0, x1), as TesseractReader returns it."""
    segs = [seg(text, conf, x0, y0, x1, y1) for text, conf, x0, x1 in words]
    return Segment(" ".join(w.text for w in segs), sum(w.conf for w in segs) / len(segs), (min(w.box[0] for w in segs), y0, max(w.box[2] for w in segs), y1), tuple(segs))


def test_on_a_hebrew_page_rapid_digits_replace_tesseracts_unsure_ones_and_its_words_stay():
    # MUT-504: Tesseract garbles bold digits ("2025 12:49" for "11/12/2025 12:49") that RapidOCR reads at 0.99.
    rapid = [seg("11/12/2025", 0.99, 40, 50, 140, 70), seg("12:49:52", 0.98, 150, 50, 230, 70), seg("RRSEEERR", 0.7, 0, 200, 300, 220)]
    tess = [tess_line([("12:49", 0.55, 150, 200), ("2025", 0.4, 90, 140), ("תאריך", 0.82, 300, 360)])]
    out = merge(rapid, tess, "hebr")
    # The two digit boxes sit side by side, so they join into one (join_number_fragments).
    assert [s.text for s in out] == ["תאריך", "11/12/2025 12:49:52"]
    assert out[0].conf == pytest.approx(0.82) and out[0].box == (300, 50, 360, 70)


def test_on_a_hebrew_page_sure_tesseract_digits_are_kept():
    rapid = [seg("61.83", 0.99, 0, 50, 60, 70)]
    tess = [tess_line([("61.83", 0.9, 0, 60), ("לתשלום", 0.9, 200, 300)])]
    assert [s.text for s in merge(rapid, tess, "hebr")] == ["61.83 לתשלום"]


def test_on_a_hebrew_page_unsure_rapid_digits_do_not_replace_tesseracts():
    rapid = [seg("61.88", 0.6, 0, 50, 60, 70)]
    tess = [tess_line([("61.83", 0.7, 0, 60), ("לתשלום", 0.9, 200, 300)])]
    assert [s.text for s in merge(rapid, tess, "hebr")] == ["61.83 לתשלום"]


def test_on_a_hebrew_page_a_tesseract_digit_word_no_rapid_box_covers_is_kept():
    # RapidOCR read only the time; Tesseract's date, however unsure, is all the line has.
    rapid = [seg("14:24", 0.97, 150, 50, 200, 70)]
    tess = [tess_line([("תאריך", 0.9, 300, 360), ("07/05/2025", 0.5, 40, 140), ("14:2A", 0.5, 150, 200)])]
    out = merge(rapid, tess, "hebr")
    # Its own segment, at its own confidence (not averaged with the label).
    assert [s.text for s in out] == ["תאריך", "07/05/2025", "14:24"]


def test_on_a_hebrew_page_one_unsure_rapid_box_does_not_keep_out_a_sure_one():
    rapid = [seg("88", 0.4, 200, 50, 230, 70), seg("61.83", 0.99, 0, 50, 60, 70)]
    tess = [tess_line([("תיז", 0.2, 300, 340), ("88", 0.3, 200, 230)])]
    assert [s.text for s in merge(rapid, tess, "hebr")] == ["תיז", "88", "61.83"]


def test_on_a_hebrew_page_a_taken_rapid_box_does_not_duplicate_a_sure_digit_word_under_it():
    rapid = [seg("61.83 1", 0.95, 0, 50, 72, 70)]
    tess = [tess_line([("61.83", 0.9, 0, 50), ("₪1", 0.4, 52, 70), ("לתשלום", 0.9, 200, 300)])]
    texts = " ".join(s.text for s in merge(rapid, tess, "hebr"))
    assert texts.count("61.83") == 1


def test_on_a_hebrew_page_an_unsure_digit_word_kept_keeps_its_own_confidence():
    rapid = [seg("14:24", 0.97, 150, 50, 200, 70)]
    tess = [tess_line([("תאריך", 0.95, 300, 360), ("07/05/2025", 0.3, 40, 140), ("14:2A", 0.5, 150, 200)])]
    out = merge(rapid, tess, "hebr")
    date = next(s for s in out if "07/05/2025" in s.text)
    assert date.text == "07/05/2025" and date.conf == pytest.approx(0.3)


def test_off_a_hebrew_page_the_merge_is_unchanged_by_tesseract_words():
    rapid = [seg("Total", 0.99, 0, 100, 50, 120), seg("52.470", 0.99, 300, 100, 360, 120)]
    tess = [tess_line([("Tota1", 0.6, 0, 50), ("52.47O", 0.5, 300, 360)], 101, 121)]
    assert [s.text for s in merge(rapid, tess, "latn")] == ["Total", "52.470"]


@pytest.mark.parametrize(("text", "noise"), [("RRREEERRSRSR", True), ("ERRBREERSRSRESHEER", True), ("Notebook", False), ("University", False), ("Bookshop12345678", False)])
def test_separator_noise(text, noise):
    assert is_separator_noise(text) is noise


# --- preprocess ---------------------------------------------------------------------------------------------------


def text_image() -> np.ndarray:
    img = np.full((600, 900), 245, np.uint8)
    for i in range(8):
        cv2.putText(img, f"ITEM {i} PRICE 12.{i}0", (60, 80 + i * 60), cv2.FONT_HERSHEY_SIMPLEX, 1.2, 20, 3)
    return img


def rotate(img: np.ndarray, deg: float) -> np.ndarray:
    h, w = img.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1.0)
    return cv2.warpAffine(img, m, (w, h), borderValue=245)


@pytest.mark.parametrize("deg", [4.0, -6.0])
def test_deskew_levels_a_tilted_page(deg):
    tilted = rotate(text_image(), deg)
    assert abs(preprocess.skew_angle(tilted)) > 3
    assert abs(preprocess.skew_angle(preprocess.deskew(tilted))) < 1.0


def test_perspective_cuts_the_receipt_out_of_the_background():
    frame = np.full((1000, 800), 90, np.uint8)
    paper = np.array([[250, 150], [560, 180], [540, 860], [230, 830]], np.int32)
    cv2.fillPoly(frame, [paper], 240)
    out = preprocess.perspective(frame)
    assert out.shape[0] < 800 and out.shape[1] < 400 and out.mean() > 200


def test_scanned_input_skips_the_perspective_step(monkeypatch):
    monkeypatch.setattr(preprocess, "perspective", lambda g: pytest.fail("perspective ran on a scan"))
    monkeypatch.setattr(preprocess, "deskew", lambda g: pytest.fail("deskew ran on a scan"))
    preprocess.prepare(np.dstack([text_image()] * 3), "scanned")
    preprocess.prepare(np.dstack([text_image()] * 3), "photo", flat=True)


def test_an_already_binary_image_is_not_contrast_stretched_again(monkeypatch):
    binary = np.where(text_image() > 128, 255, 0).astype(np.uint8)
    assert preprocess.is_binary(binary) and not preprocess.is_binary(text_image() // 2 + 60)
    monkeypatch.setattr(preprocess, "clahe", lambda g: pytest.fail("CLAHE ran on a binary image"))
    preprocess.prepare(binary, "scanned")


def test_a_small_photo_is_upscaled_and_a_huge_one_is_capped():
    small = preprocess.fit_size(np.zeros((400, 300), np.uint8))
    assert small.shape == (800, 600)
    big = preprocess.fit_size(np.zeros((4000, 3000), np.uint8))
    assert max(big.shape) == 2_500


def test_upscale_below_zero_never_upscales_and_a_lower_bar_upscales_less():
    assert preprocess.fit_size(np.zeros((400, 300), np.uint8), upscale_below=0).shape == (400, 300)
    assert preprocess.fit_size(np.zeros((400, 300), np.uint8), upscale_below=250).shape == (400, 300)
    assert preprocess.fit_size(np.zeros((400, 300), np.uint8), upscale_below=301).shape == (800, 600)


# --- PDF text layers whose Arabic words are in visual order (MUT-441 benchmark) -------------------------------------


def test_a_visual_order_text_layer_gets_its_reversed_arabic_words_put_back():
    # Chromium's Arabic PDF text layer: words in logical order, some words' letters reversed (syn-038).
    layer = "ةيلديص الشفاء\nخيراتلا 23/02/2025 تقولا 10:24\nالمجموع يعرفلا 185.19"
    assert pdf_text_to_logical(layer) == "صيدلية الشفاء\nالتاريخ 23/02/2025 الوقت 10:24\nالمجموع الفرعي 185.19"


@pytest.mark.parametrize(
    "layer",
    [
        "مطعم أبو شكري\nأهلا وسهلا\nالمجموع 12.00",  # logical: nothing starts with a final-only letter
        "שלום ע\"מ 123\nTotal 9.90",  # no Arabic at all
        "أهلا وسهلا\nةيلديص",  # visual layer: a short word ending in لا is not taken for a reversed article
    ],
)
def test_a_logical_text_layer_and_short_words_are_left_alone(layer):
    fixed = pdf_text_to_logical(layer)
    assert "أهلا" in fixed if "أهلا" in layer else fixed == layer


# --- settings (MUT-441 benchmark tuning) --------------------------------------------------------------------------


def test_the_defaults_are_what_the_benchmark_chose_for_the_4_vcpu_service():
    s = Settings()
    assert s.threads == 3  # + 1 for Tesseract beside it = the 4 vCPU in receipt_ocr.tf
    assert s.parallel is True
    assert s.script_pick_scale == 0.5
    assert s.upscale_below == 1_000


def test_load_settings_keeps_the_defaults_without_env(monkeypatch):
    for name in ("OCR_THREADS", "OCR_PARALLEL", "OCR_SCRIPT_PICK_SCALE", "OCR_UPSCALE_BELOW"):
        monkeypatch.delenv(name, raising=False)
    s = load_settings()
    assert (s.threads, s.parallel, s.script_pick_scale, s.upscale_below) == (3, True, 0.5, 1_000)


def test_load_settings_reads_the_tuning_overrides(monkeypatch):
    monkeypatch.setenv("OCR_THREADS", "4")
    monkeypatch.setenv("OCR_PARALLEL", "0")
    monkeypatch.setenv("OCR_SCRIPT_PICK_SCALE", "1")
    monkeypatch.setenv("OCR_UPSCALE_BELOW", "0")
    s = load_settings()
    assert (s.threads, s.parallel, s.script_pick_scale, s.upscale_below) == (4, False, 1.0, 0)


# --- licences (AC7) -----------------------------------------------------------------------------------------------


def test_ac7_every_pinned_package_and_model_passes():
    assert check_licenses.check() == []


@pytest.mark.parametrize(
    "licence",
    ["GNU General Public License v3 (GPLv3)", "AGPL-3.0-only", "LGPL-3.0-or-later", "CreativeML OpenRAIL-M", "CC-BY-NC-4.0", "Non-commercial use only", "SSPL-1.0"],
)
def test_ac7_denied_licences_fail(licence):
    assert check_licenses.verdict(licence) is not None


def test_ac7_an_unknown_licence_fails_until_reviewed():
    assert "unrecognised" in (check_licenses.verdict("Proprietary") or "")
    assert check_licenses.verdict("Apache-2.0") is None and check_licenses.verdict("MIT-CMU") is None


@pytest.mark.parametrize("package", ["opencv-python-headless", "shapely"])
@pytest.mark.parametrize("licence", ["LGPL-2.1-only", "LGPL-2.1-or-later", "GNU Lesser General Public License v2.1"])
def test_ac7_accepted_bundled_lgpl_2_1_passes_for_its_two_packages(package, licence):
    assert check_licenses.verdict(licence, package) is None


@pytest.mark.parametrize("package", [None, "numpy", "pillow", "rapidocr", "opencv-python", "shapely-extra"])
def test_ac7_lgpl_2_1_still_fails_for_any_other_package(package):
    assert check_licenses.verdict("LGPL-2.1-only", package) is not None


@pytest.mark.parametrize(
    "licence", ["LGPL-3.0-or-later", "GNU General Public License v2 (GPLv2)", "AGPL-3.0-only", "CreativeML OpenRAIL-M", "CC-BY-NC-4.0", "LGPL-2.1-only | GPL-3.0"]
)
@pytest.mark.parametrize("package", ["opencv-python-headless", "shapely"])
def test_ac7_the_accepted_packages_still_fail_on_any_other_copyleft(package, licence):
    assert check_licenses.verdict(licence, package) is not None


def test_ac7_the_accepted_list_is_exactly_the_two_bundled_libraries():
    assert set(check_licenses.ACCEPTED_LGPL) == {"opencv-python-headless", "shapely"}
    assert {p for p, _, _ in check_licenses.BUNDLED} == set(check_licenses.ACCEPTED_LGPL)
