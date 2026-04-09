"""
lightweight_runner.py — YOLO-free occupancy estimator for people_count mode.

Uses OpenCV MOG2 background subtraction + contour detection.
RAM usage: ~15-30 MB per stream (vs ~500 MB for YOLO).

Accuracy notes:
  - MOG2 detects foreground AREA, not individual people.
  - Each person at bar-camera resolution covers ~3-6 contour blobs after
    dilation, so raw blob count / BLOBS_PER_PERSON gives a headcount estimate.
  - We report the MEDIAN frame estimate (not max) to avoid noise spikes from
    lighting changes, reflections, or passing staff.
  - total_entries / total_exits are NOT reported (frame-delta tracking is
    meaningless noise for overhead cameras — these fields are only valid for
    real door-line counters).
"""
from __future__ import annotations
import time, logging, collections
from pathlib import Path
from typing import Callable

log = logging.getLogger("lightweight_runner")

# ── Tuning ────────────────────────────────────────────────────────────────────
MIN_BLOB_AREA    = 800     # px² — ignore small noise blobs
MAX_BLOB_AREA    = 60000   # px² — ignore large lighting/shadow blobs
LEARN_RATE       = 0.003   # MOG2 learning rate (slow = stable background)
DILATE_ITERS     = 1       # minimal dilation to avoid merging nearby people
BLOBS_PER_PERSON = 4       # empirical: one person ≈ 4 foreground blobs
OCCUPANCY_EVERY  = 15      # log one occupancy sample every N frames
LIVE_CB_EVERY    = 30      # seconds between live_cb calls (continuous mode)
WARMUP_SECS      = 5       # seconds to let background model stabilise


def run_lightweight(
    job: dict,
    extra_config: dict,
    result_dir: Path,
    progress_cb: Callable,
    live_cb: Callable,
    is_continuous: bool,
) -> dict:
    """
    Drop-in replacement for VenueProcessor.run() for people_count mode.
    Returns a summary dict compatible with the standard pipeline.
    """
    import cv2

    source      = job["source_path"]
    job_id      = job["job_id"]
    clip_label  = job.get("clip_label", "")
    max_seconds = float(extra_config.get("max_seconds", 0))  # 0 = no limit

    log.info(f"[lightweight] Opening stream: {Path(source).name}")
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open source: {source}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 15.0
    fps = max(1.0, min(fps, 60.0))

    fgbg   = cv2.createBackgroundSubtractorMOG2(
        history=int(fps * 60),  # 60s background history
        varThreshold=50,        # higher = less sensitive to slow changes
        detectShadows=False,
    )
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))

    frame_idx      = 0
    t_sec          = 0.0
    warmup_frames  = int(fps * WARMUP_SECS)
    frame_estimates: list[int] = []   # per-frame people estimates (post-warmup)
    occupancy_log:  list       = []
    _last_live_cb  = time.time()
    _start_wall    = time.time()

    progress_cb(5, "Stream opened — building background model")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                if is_continuous:
                    time.sleep(0.5)
                    ret, frame = cap.read()
                    if not ret:
                        log.warning(f"[lightweight] Stream ended for job {job_id}")
                        break
                else:
                    break

            frame_idx += 1
            t_sec = frame_idx / fps

            if max_seconds > 0 and t_sec >= max_seconds:
                break

            # Background subtraction
            fgmask = fgbg.apply(frame, learningRate=LEARN_RATE)

            # Skip warmup — background model still forming
            if frame_idx < warmup_frames:
                continue

            # Minimal morphology to clean noise without merging people
            fgmask = cv2.morphologyEx(fgmask, cv2.MORPH_OPEN,  kernel)
            fgmask = cv2.dilate(fgmask, kernel, iterations=DILATE_ITERS)

            # Count contour blobs in valid size range
            contours, _ = cv2.findContours(fgmask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            blobs = sum(1 for c in contours if MIN_BLOB_AREA < cv2.contourArea(c) < MAX_BLOB_AREA)

            # Convert blobs → estimated people
            estimated = max(0, round(blobs / BLOBS_PER_PERSON))
            frame_estimates.append(estimated)

            # Sample for log
            if frame_idx % OCCUPANCY_EVERY == 0:
                occupancy_log.append((round(t_sec, 1), estimated))

            # Progress
            if not is_continuous and frame_idx % int(fps * 5) == 0 and max_seconds > 0:
                pct = min(95, int((t_sec / max_seconds) * 100))
                progress_cb(pct, f"~{estimated} people in frame")

            # Live callback
            if is_continuous:
                now = time.time()
                if now - _last_live_cb >= LIVE_CB_EVERY:
                    partial = _build_summary(frame_estimates, occupancy_log, t_sec)
                    partial["clip_label"]    = clip_label
                    partial["analysis_mode"] = "people_count"
                    try:
                        live_cb(partial, now - _start_wall)
                    except Exception as e:
                        log.debug(f"[lightweight] live_cb error: {e}")
                    _last_live_cb = now

    finally:
        cap.release()

    progress_cb(98, "Finalising occupancy report")
    summary = _build_summary(frame_estimates, occupancy_log, t_sec)
    summary["clip_label"]    = clip_label
    summary["analysis_mode"] = "people_count"

    peak = summary["people"]["peak_occupancy"]
    avg  = summary["people"].get("avg_occupancy", 0)
    log.info(f"[lightweight] Done — est_peak={peak}, est_avg={avg}, frames={len(frame_estimates)}, duration={t_sec:.0f}s")
    return summary


def _median(values: list[int]) -> int:
    if not values:
        return 0
    s = sorted(values)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) // 2


def _build_summary(
    frame_estimates: list[int],
    occupancy_log: list,
    total_sec: float,
) -> dict:
    """
    Build summary from per-frame people estimates.

    peak_occupancy = 90th-percentile frame estimate (avoids outlier spikes)
    avg_occupancy  = median frame estimate (robust central tendency)

    total_entries / total_exits are intentionally 0 — frame-delta counting
    on overhead cameras produces noise, not real door crossings.
    """
    if frame_estimates:
        sorted_est = sorted(frame_estimates)
        n = len(sorted_est)
        # 90th percentile as "peak" — filters top 10% noise spikes
        p90_idx   = min(n - 1, int(n * 0.90))
        peak_occ  = sorted_est[p90_idx]
        avg_occ   = _median(frame_estimates)
    else:
        peak_occ = avg_occ = 0

    return {
        "mode":          "people_count",
        "video_seconds": round(total_sec, 1),
        "quality":       "good",
        "people": {
            "total_entries":      0,   # not tracked — overhead cameras don't count doors
            "total_exits":        0,
            "net_occupancy":      avg_occ,
            "peak_occupancy":     peak_occ,
            "avg_occupancy":      avg_occ,
            "unique_tracks_seen": 0,
            "peak_entry_hour":    0,
            "hourly_entries":     {},
            "hourly_exits":       {},
            "per_line":           {},
        },
        "occupancy_log":  occupancy_log,
        "total_drinks":   0,
        "unrung_drinks":  0,
        "hasTheftFlag":   False,
    }
