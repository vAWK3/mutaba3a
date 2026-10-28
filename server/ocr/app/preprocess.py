"""Image preparation before OCR (MUT-441 plan §1, from the MUT-253 spike's preprocess.py).

`photo`: find the receipt and correct the perspective (the spike's biggest single win), deskew, CLAHE, about 2x
upscale when small. `scanned` (the phone's Scan, or a rasterised PDF page): no perspective step, only normalise.
An image that is already black and white is never binarised or contrast-stretched again.
"""

from __future__ import annotations

import cv2
import numpy as np

from . import config

#: A quad must cover this share of the (downscaled) frame to count as the receipt.
MIN_QUAD_SHARE = 0.15
#: A quad covering nearly the whole frame means there is no background to cut away.
WHOLE_FRAME_SHARE = 0.97
#: Deskew only between these angles (degrees): smaller is noise, larger is not a skew.
MIN_SKEW_DEG, MAX_SKEW_DEG = 0.5, 15.0
#: Share of near-black or near-white pixels from which an image counts as already binary.
BINARY_SHARE = 0.97


def to_gray(rgb: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY) if rgb.ndim == 3 else rgb


def _order(pts: np.ndarray) -> np.ndarray:
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.float32([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]])


def find_receipt_quad(gray: np.ndarray) -> np.ndarray | None:
    """The largest bright four-sided region covering at least MIN_QUAD_SHARE of the frame, else None."""
    scale = min(1.0, 800 / max(gray.shape))
    small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else gray
    blur = cv2.GaussianBlur(small, (5, 5), 0)
    _, mask = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    biggest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(biggest) < MIN_QUAD_SHARE * small.shape[0] * small.shape[1]:
        return None
    approx = cv2.approxPolyDP(biggest, 0.02 * cv2.arcLength(biggest, True), True)
    if len(approx) != 4:
        approx = cv2.boxPoints(cv2.minAreaRect(biggest)).reshape(-1, 1, 2)
    return _order(approx.reshape(4, 2).astype(np.float32) / scale)


def perspective(gray: np.ndarray) -> np.ndarray:
    quad = find_receipt_quad(gray)
    h, w = gray.shape[:2]
    if quad is None or cv2.contourArea(quad) > WHOLE_FRAME_SHARE * h * w:
        return gray
    tl, tr, br, bl = quad
    width = int(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
    height = int(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
    if width < 32 or height < 32:
        return gray
    dst = np.float32([[0, 0], [width, 0], [width, height], [0, height]])
    m = cv2.getPerspectiveTransform(quad, dst)
    return cv2.warpPerspective(gray, m, (width, height), borderMode=cv2.BORDER_REPLICATE)


def skew_angle(gray: np.ndarray) -> float:
    """The text's tilt in degrees (positive: counter-clockwise), from the minimum-area box around the ink."""
    scale = min(1.0, 1000 / max(gray.shape))
    small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else gray
    _, ink = cv2.threshold(small, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # Join the letters of a printed line so the box follows the lines, not stray specks.
    ink = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((3, 25), np.uint8))
    points = cv2.findNonZero(ink)
    if points is None or len(points) < 50:
        return 0.0
    (_, _), (w, h), angle = cv2.minAreaRect(points)
    # OpenCV >= 4.5 reports (0, 90]; fold it to the smallest turn that levels the box.
    if w < h:
        angle -= 90
    if angle > 45:
        angle -= 90
    if angle < -45:
        angle += 90
    return float(angle)


def deskew(gray: np.ndarray) -> np.ndarray:
    angle = skew_angle(gray)
    if not MIN_SKEW_DEG <= abs(angle) <= MAX_SKEW_DEG:
        return gray
    h, w = gray.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def is_binary(gray: np.ndarray) -> bool:
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).ravel()
    extremes = hist[:16].sum() + hist[240:].sum()
    return extremes >= BINARY_SHARE * gray.size


def clahe(gray: np.ndarray) -> np.ndarray:
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)


def fit_size(gray: np.ndarray) -> np.ndarray:
    h, w = gray.shape[:2]
    if min(h, w) < config.UPSCALE_BELOW_SHORT_SIDE:
        factor = min(2.0, config.MAX_WORK_SIDE / max(h, w))
        if factor > 1.05:
            return cv2.resize(gray, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
        return gray
    if max(h, w) > config.MAX_WORK_SIDE:
        factor = config.MAX_WORK_SIDE / max(h, w)
        return cv2.resize(gray, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
    return gray


def prepare(rgb: np.ndarray, hint: str, flat: bool = False) -> np.ndarray:
    """A grayscale image ready for both engines. `hint` is `photo` or `scanned`; `flat` marks a rasterised PDF page."""
    gray = to_gray(rgb)
    # Shrink a huge photo first: the page search and the warp don't need 40 MP.
    if max(gray.shape) > 2 * config.MAX_WORK_SIDE:
        factor = 2 * config.MAX_WORK_SIDE / max(gray.shape)
        gray = cv2.resize(gray, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
    binary = is_binary(gray)
    if hint == "photo" and not flat:
        gray = perspective(gray)
        gray = deskew(gray)
    if not binary:
        gray = clahe(gray)
    return fit_size(gray)
