"""
lightweight_runner.py — YOLO-free people counter for people_count mode.

Uses OpenCV MOG2 background subtraction + contour detection.
RAM usage: ~15-30 MB per stream (vs ~500 MB for YOLO).
No model loading. Starts in <1s.

Output summary format is identical to VenueProcessor people_count output
so the rest of the pipeline (aws_sync, dashboard) works unchanged.
"""
from __future__ import annotations
import time, json, logging, collections
from pathlib import Path
from typing import Callable, Optional

log = logging.getLogger("lightweight_runner")

# Tuning — overhead fisheye cameras at typical bar resolution
MIN_BLOB_AREA   = 400    # px² — smaller blobs are noise
MAX_BLOB_AREA   = 80000  # px² — larger blobs are lighting/shadows
LEARN_RATE      = 0.005  # MOG2 background learning rate (slow = stable bg)
DILATE_ITERS    = 3      # grow foreground mask to fill gaps
OCCUPANCY_EVERY = 15     # log occupancy every N frames
LIVE_CB_EVERY   = 30     # seconds between live_cb calls for continuous streams
MAX_OCC         = 300    # sanity cap on occupancy reading


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
    import numpy as np

    source      = job["source_path"]
    job_id      = job["job_id"]
    max_seconds = float(extra_config.get("max_seconds", 0))  # 0 = run forever

    log.info(f"[lightweight] Opening stream: {Path(source).name}")
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open source: {source}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 15.0
    fps = max(1.0, min(fps, 60.0))

    # MOG2 background subtractor
    fgbg = cv2.createBackgroundSubtractorMOG2(
        history=int(fps * 30),   # 30 seconds of background history
        varThreshold=40,
        detectShadows=False,
    )
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    # State
    frame_idx        = 0
    t_sec            = 0.0
    occupancy_log    = []        # [(t_sec, count), ...]
    hourly_entries   = collections.defaultdict(int)
    hourly_exits     = collections.defaultdict(int)
    peak_occupancy   = 0
    prev_occupancy   = 0
    total_entries    = 0
    total_exits      = 0
    unique_seen      = 0
    _last_live_cb    = time.time()
    _start_wall      = time.time()
    _warmup_frames   = int(fps * 3)  # 3s warmup for background model

    progress_cb(5, "Stream opened — building background model")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                if is_continuous:
                    # Brief pause before declaring stream lost
                    time.sleep(0.5)
                    ret, frame = cap.read()
                    if not ret:
                        log.warning(f"[lightweight] Stream ended for job {job_id}")
                        break
                else:
                    break

            frame_idx += 1
            t_sec = frame_idx / fps

            # Hard time limit for segmented (non-continuous) jobs
            if max_seconds > 0 and t_sec >= max_seconds:
                break

            # Apply background subtraction
            fgmask = fgbg.apply(frame, learningRate=LEARN_RATE)

            # Skip warmup frames (background model still forming)
            if frame_idx < _warmup_frames:
                continue

            # Clean up mask
            fgmask = cv2.dilate(fgmask, kernel, iterations=DILATE_ITERS)
            fgmask = cv2.morphologyEx(fgmask, cv2.MORPH_CLOSE, kernel)

            # Find blobs (people)
            contours, _ = cv2.findContours(fgmask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            blobs = [c for c in contours if MIN_BLOB_AREA < cv2.contourArea(c) < MAX_BLOB_AREA]
            occupancy = min(len(blobs), MAX_OCC)

            # Track entries/exits as delta from previous frame
            delta = occupancy - prev_occupancy
            hour  = int(t_sec // 3600)
            if delta > 0:
                total_entries         += delta
                hourly_entries[hour]  += delta
                unique_seen           += delta
            elif delta < 0:
                total_exits           += abs(delta)
                hourly_exits[hour]    += abs(delta)

            prev_occupancy  = occupancy
            peak_occupancy  = max(peak_occupancy, occupancy)

            # Log occupancy periodically
            if frame_idx % OCCUPANCY_EVERY == 0:
                occupancy_log.append((round(t_sec, 1), occupancy))

            # Progress callback (for segmented jobs)
            if not is_continuous and frame_idx % int(fps * 5) == 0:
                if max_seconds > 0:
                    pct = min(95, int((t_sec / max_seconds) * 100))
                    progress_cb(pct, f"Counted {occupancy} people in frame")

            # Live callback for continuous streams
            if is_continuous:
                now = time.time()
                if now - _last_live_cb >= LIVE_CB_EVERY:
                    partial = _build_summary(
                        total_entries, total_exits, peak_occupancy,
                        unique_seen, hourly_entries, hourly_exits,
                        occupancy_log, t_sec,
                    )
                    try:
                        live_cb(partial, now - _start_wall)
                    except Exception as e:
                        log.debug(f"[lightweight] live_cb error: {e}")
                    _last_live_cb = now

    finally:
        cap.release()

    progress_cb(98, "Finalising occupancy report")
    summary = _build_summary(
        total_entries, total_exits, peak_occupancy,
        unique_seen, hourly_entries, hourly_exits,
        occupancy_log, t_sec,
    )
    log.info(
        f"[lightweight] Done — peak_occ={peak_occupancy}, "
        f"entries={total_entries}, exits={total_exits}, duration={t_sec:.0f}s"
    )
    return summary


def _build_summary(
    total_entries, total_exits, peak_occupancy,
    unique_seen, hourly_entries, hourly_exits,
    occupancy_log, total_sec,
) -> dict:
    net_occ   = max(0, total_entries - total_exits)
    peak_hour = max(hourly_entries, key=hourly_entries.get) if hourly_entries else 0
    return {
        "mode":          "people_count",
        "video_seconds": round(total_sec, 1),
        "quality":       "good",
        "people": {
            "total_entries":      total_entries,
            "total_exits":        total_exits,
            "net_occupancy":      net_occ,
            "peak_occupancy":     peak_occupancy,
            "unique_tracks_seen": unique_seen,
            "peak_entry_hour":    peak_hour,
            "hourly_entries":     dict(hourly_entries),
            "hourly_exits":       dict(hourly_exits),
            "per_line":           {},
        },
        "occupancy_log":  occupancy_log,
        "total_drinks":   0,
        "unrung_drinks":  0,
        "hasTheftFlag":   False,
    }
