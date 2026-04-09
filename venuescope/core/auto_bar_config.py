"""
auto_bar_config.py — Auto-detect bar zone and bar line from a camera stream.

Algorithm:
  1. Grab up to 25 frames from the stream (first ~15s)
  2. Compute per-pixel median → stable background (removes moving people)
  3. Canny edge detection on the background
  4. HoughLinesP to find horizontal line segments
  5. Cluster lines by y-position (weighted by length)
  6. Strongest cluster in the middle 15-70% of frame → bar counter edge = bar line
  7. Build a BarConfig dict with bar zone polygon above/below the bar line

Falls back to sensible geometric defaults if detection fails or stream is empty.
The output dict is JSON-serialisable and matches the BarConfig / BarStation schema
so it can be stored as barConfigJson in DynamoDB and parsed by the Python backend.
"""
from __future__ import annotations
import logging
from typing import Optional

log = logging.getLogger("auto_bar_config")

# ── Tuning ────────────────────────────────────────────────────────────────────
_ANALYSIS_W      = 320   # resize to this width for fast analysis
_ANALYSIS_H      = 180   # and this height
_HOUGH_THRESHOLD = 30    # minimum Hough accumulator votes
_MIN_LINE_LEN    = 60    # minimum Hough line length (px in 320×180 space)
_MAX_LINE_GAP    = 20    # max gap within a single line (px)
_HORIZ_ANGLE_DEG = 18    # lines within this angle of horizontal are "horizontal"
_CLUSTER_TOL     = 0.06  # merge line clusters within this normalized-y distance


def _default_config(note: str = "fallback") -> dict:
    """
    Safe geometric default: bar zone covering 10-75% of frame height,
    bar line at y=0.44, customers below (customer_side=+1).
    Matches the existing bar_main.json default.
    """
    return {
        "venue_id":       "auto",
        "display_name":   "Auto-detected",
        "overhead_camera": True,
        "auto_detected":  True,
        "auto_note":      note,
        "stations": [
            {
                "zone_id":       "bar",
                "label":         "Bar",
                "polygon": [
                    [0.02, 0.08],
                    [0.98, 0.08],
                    [0.98, 0.74],
                    [0.02, 0.74],
                ],
                "bar_line_p1":   [0.0, 0.44],
                "bar_line_p2":   [1.0, 0.44],
                "customer_side": 1,
            }
        ],
    }


def analyze_stream(rtsp_url: str, max_frames: int = 25) -> dict:
    """
    Open the stream, grab frames, detect bar layout.
    Returns a barConfigJson-compatible dict.
    Safe to call in a subprocess — never raises.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        return _default_config("opencv_unavailable")

    # ── Grab frames ──────────────────────────────────────────────────────────
    try:
        cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            cap.release()
            cap = cv2.VideoCapture(rtsp_url)
    except Exception as e:
        log.warning(f"[auto_bar_config] Cannot open stream {rtsp_url}: {e}")
        return _default_config("stream_open_failed")

    frames = []
    read_attempts = 0
    max_attempts  = max_frames * 6   # skip bad/duplicate frames

    while len(frames) < max_frames and read_attempts < max_attempts:
        ret, frame = cap.read()
        read_attempts += 1
        if not ret:
            break
        # Sample every 3rd frame to get spread across the clip
        if read_attempts % 3 == 0:
            try:
                small = cv2.resize(frame, (_ANALYSIS_W, _ANALYSIS_H),
                                   interpolation=cv2.INTER_LINEAR)
                frames.append(small)
            except Exception:
                pass
    cap.release()

    if len(frames) < 5:
        log.warning(f"[auto_bar_config] Only {len(frames)} frames captured — using default config")
        return _default_config(f"too_few_frames_{len(frames)}")

    H_s, W_s = _ANALYSIS_H, _ANALYSIS_W

    # ── Background model (median removes people) ─────────────────────────────
    try:
        stack  = np.stack(frames, axis=0).astype(np.float32)
        median = np.median(stack, axis=0).astype(np.uint8)
    except Exception as e:
        log.warning(f"[auto_bar_config] Median failed: {e}")
        return _default_config("median_failed")

    # ── Edge detection ────────────────────────────────────────────────────────
    gray  = cv2.cvtColor(median, cv2.COLOR_BGR2GRAY)
    blur  = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 25, 80)

    # ── Hough horizontal lines ────────────────────────────────────────────────
    lines = cv2.HoughLinesP(
        edges, 1, 3.14159 / 180,
        threshold=_HOUGH_THRESHOLD,
        minLineLength=_MIN_LINE_LEN,
        maxLineGap=_MAX_LINE_GAP,
    )

    bar_line_y = _detect_bar_line(lines, H_s, W_s)
    log.info(f"[auto_bar_config] Detected bar_line_y={bar_line_y:.3f} "
             f"from {0 if lines is None else len(lines)} Hough lines")

    # ── Build output config ───────────────────────────────────────────────────
    # Bar zone: full width, from near top of frame down past customer zone
    zone_top    = 0.06
    zone_bottom = min(bar_line_y + 0.28, 0.90)

    return {
        "venue_id":        "auto",
        "display_name":    "Auto-detected",
        "overhead_camera": True,
        "auto_detected":   True,
        "auto_note":       f"bar_line_y={bar_line_y:.3f}",
        "stations": [
            {
                "zone_id":       "bar",
                "label":         "Bar",
                "polygon": [
                    [0.02, zone_top],
                    [0.98, zone_top],
                    [0.98, zone_bottom],
                    [0.02, zone_bottom],
                ],
                "bar_line_p1":   [0.0, bar_line_y],
                "bar_line_p2":   [1.0, bar_line_y],
                "customer_side": 1,   # below bar line = customer side (overhead)
            }
        ],
    }


def _detect_bar_line(lines, H: int, W: int) -> float:
    """
    From a set of HoughLinesP results, find the dominant horizontal line
    in the middle 15-70% of the frame. Returns normalized y (0-1).
    Falls back to 0.44 if nothing useful found.
    """
    import numpy as np
    if lines is None or len(lines) == 0:
        return 0.44

    candidates = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        angle_deg = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
        # Only near-horizontal lines
        if angle_deg > _HORIZ_ANGLE_DEG and angle_deg < (180 - _HORIZ_ANGLE_DEG):
            continue
        mid_y_norm = ((y1 + y2) / 2) / H
        # Only in the bar-line candidate band (15-70% of frame)
        if not (0.15 < mid_y_norm < 0.70):
            continue
        length = np.hypot(x2 - x1, y2 - y1)
        candidates.append((mid_y_norm, length))

    if not candidates:
        return 0.44

    # Greedy cluster: merge lines within _CLUSTER_TOL of each other
    candidates.sort(key=lambda x: x[0])
    clusters: list[list] = []
    for y, length in candidates:
        merged = False
        for cluster in clusters:
            c_y = sum(cy * cl for cy, cl in cluster) / sum(cl for _, cl in cluster)
            if abs(y - c_y) <= _CLUSTER_TOL:
                cluster.append((y, length))
                merged = True
                break
        if not merged:
            clusters.append([(y, length)])

    # Pick the cluster with greatest total line length
    best_cluster = max(clusters, key=lambda c: sum(cl for _, cl in c))
    total_len    = sum(cl for _, cl in best_cluster)
    bar_y        = sum(cy * cl for cy, cl in best_cluster) / total_len

    return round(float(bar_y), 3)
