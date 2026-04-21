"""
VenueScope — Table-turns detector (sparse YOLO).

2026-04-21 rewrite: was MOG2 background subtraction; now sparse YOLO person
detection. MOG2 systematically reported 0 turns in bar / restaurant lighting
because seated customers become "background" to the model in 8-15 seconds,
long before the 5-minute minimum dwell threshold is reached.

Sparse-YOLO approach:
  - Grab one frame every SAMPLE_INTERVAL_SEC (default 3s)
  - Run YOLO v8 nano with .track(persist=True) → stable track IDs across samples
  - For each detected person, determine which table zone contains the centroid
  - Feed the tracker with the flat list of centroids + track_ids; it does the
    per-zone occupancy state machine internally

CPU budget:
  1 inference per 3s × 2 table cameras = 0.67 inferences/sec ≈ 8% of one core.
  Far cheaper than per-frame MOG2 at fps, and actually counts real people.

Tracker parameters are scaled for the sparse sample rate:
  occupied_conf: 3 samples (= 9s real time) before confirming "seated"
  empty_conf:    5 samples (= 15s) before confirming "cleared"
  min_dwell:     300s (unchanged — real-time, not sample-based)

Cross-segment state persistence is preserved — an in-progress TableSession
across worker restarts still counts correctly via restore_cross_segment_state.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Callable, Dict, List, Tuple

import cv2
import numpy as np

from core.analytics.table_tracker import TableTurnTracker, TableZone

# ─── Constants ────────────────────────────────────────────────────────────────

# Seconds between YOLO samples. 3s is a good default — seated people don't
# move frame-to-frame so we can skip 95% of frames and still capture all
# occupancy transitions within ~15s resolution.
DEFAULT_SAMPLE_SEC = float(os.environ.get("VENUESCOPE_TABLE_SAMPLE_SEC", "3.0"))
DEFAULT_CONF       = float(os.environ.get("VENUESCOPE_TABLE_CONF", "0.25"))
DEFAULT_IMGSZ      = int(os.environ.get("VENUESCOPE_TABLE_IMGSZ", "640"))
DEFAULT_MODEL      = os.environ.get("VENUESCOPE_TABLE_MODEL", "yolov8n.pt")

# Tracker confirmation windows at the sparse sample rate. These are "samples
# at sample_sec spacing", not raw frames. With 3s sampling, occupied_conf=3
# means 9 seconds of continuous presence before the zone is called occupied.
DEFAULT_TABLE_RULES = {
    "occupied_conf_samples": 3,
    "empty_conf_samples":    5,
    "min_dwell_seconds":     300,
}

LIVE_CB_EVERY = 30.0
PERSON_CLS    = 0


# ─── Main runner ──────────────────────────────────────────────────────────────

def run_table_turns_lightweight(
    job: Dict,
    extra_config: Dict,
    result_dir: Path,
    progress_cb: Callable[[float, str], None],
    live_cb: Callable[[Dict, float], None],
    is_continuous: bool,
) -> Dict:
    """
    Sparse-YOLO replacement for the MOG2 table-turns runner.

    Returns a summary dict compatible with the existing aws_sync path. The
    `_table_state` key carries forward in-progress sessions so a worker
    restart mid-shift doesn't lose turn counts.
    """
    source        = job["source_path"]
    job_id        = job.get("job_id", "?")
    max_seconds   = float(extra_config.get("max_seconds", 0))
    tables_cfg    = extra_config.get("tables", [])
    rules         = extra_config.get("table_rules", DEFAULT_TABLE_RULES)
    camera_id     = extra_config.get("camera_id", "")
    clip_label    = job.get("clip_label", camera_id or "table_turns")
    sample_sec    = float(extra_config.get("sample_interval_sec", DEFAULT_SAMPLE_SEC))
    conf_thresh   = float(extra_config.get("conf",  DEFAULT_CONF))
    imgsz         = int(extra_config.get("imgsz",   DEFAULT_IMGSZ))
    model_name    = str(extra_config.get("model",   DEFAULT_MODEL))

    occ_conf      = int(rules.get("occupied_conf_samples",
                                   rules.get("occupied_conf_frames", 3)))
    emp_conf      = int(rules.get("empty_conf_samples",
                                   rules.get("empty_conf_frames", 5)))
    min_dwell     = float(rules.get("min_dwell_seconds", 300))

    import logging
    log = logging.getLogger("table_turns_runner")
    log.info(f"[table] sparse YOLO — sample={sample_sec:.1f}s model={model_name}")

    # Load YOLO (fork-COW inherits parent model on the worker)
    from core.tracking.engine import _load_yolo
    model = _load_yolo(model_name)

    # ── Open stream ─────────────────────────────────────────────────────────
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open source: {source}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 15.0
    fps = max(1.0, min(fps, 60.0))
    sample_every_frames = max(1, int(round(sample_sec * fps)))
    max_frames = int(max_seconds * fps) if max_seconds > 0 else 0

    progress_cb(2, "Opened stream — initialising table zones")

    # Read first frame to determine resolution (for polygon scaling)
    ret, first_frame = cap.read()
    if not ret or first_frame is None:
        cap.release()
        raise RuntimeError("Could not read first frame from source")
    H, W = first_frame.shape[:2]

    # ── Build table zones from config ───────────────────────────────────────
    table_zones: List[TableZone] = []
    for t in tables_cfg:
        poly_norm = t.get("polygon", [])
        if len(poly_norm) < 3:
            continue
        poly_px = [(px * W, py * H) for px, py in poly_norm]
        table_zones.append(TableZone(
            table_id   = t.get("id", t.get("table_id", f"t{len(table_zones)}")),
            label      = t.get("label", f"Table {len(table_zones)+1}"),
            polygon_px = poly_px,
        ))

    if not table_zones:
        cap.release()
        log.warning(f"[table] no table zones configured for {camera_id} — returning empty summary")
        return {
            "analysis_mode":    "table_turns",
            "clip_label":       clip_label,
            "total_turns":      0,
            "avg_dwell_min":    0,
            "avg_response_sec": None,
            "table_detail":     {},
            "events":           [],
            "video_seconds":    0,
        }

    # Tracker effective fps = one "tick" per sample
    effective_fps = 1.0 / max(sample_sec, 0.1)
    tracker = TableTurnTracker(
        tables        = table_zones,
        occupied_conf = occ_conf,
        empty_conf    = emp_conf,
        min_dwell_sec = min_dwell,
        fps           = effective_fps,
    )
    prior_state = extra_config.get("prior_table_state", {})
    if prior_state:
        try: tracker.restore_cross_segment_state(prior_state)
        except Exception: pass

    # ── Main loop — sparse sample + YOLO track ──────────────────────────────
    frame_idx      = 0
    proc_idx       = 0
    last_sample_fr = -sample_every_frames
    start_wall     = time.time()
    last_live_push = start_wall
    t_sec          = 0.0

    # Prime with first frame
    pending_frame: np.ndarray | None = first_frame

    while True:
        if pending_frame is not None:
            frame = pending_frame
            pending_frame = None
            ret = True
        else:
            # For non-sample frames: cheap grab() without full decode
            need_sample = (frame_idx - last_sample_fr) >= sample_every_frames
            if need_sample:
                ret, frame = cap.read()
            else:
                ret   = cap.grab()
                frame = None

        if not ret:
            if is_continuous:
                time.sleep(0.5)
                continue
            break

        frame_idx += 1
        t_sec      = frame_idx / fps

        if max_frames > 0 and frame_idx > max_frames:
            break
        if os.environ.get("_VENUESCOPE_STOP"):
            break

        need_sample = (frame_idx - last_sample_fr) >= sample_every_frames
        if not need_sample or frame is None:
            continue

        last_sample_fr = frame_idx
        proc_idx += 1

        # ── Run YOLO with persistent tracking across samples ────────────────
        try:
            results = model.track(
                frame,
                persist   = True,
                classes   = [PERSON_CLS],
                conf      = conf_thresh,
                imgsz     = imgsz,
                verbose   = False,
            )
            r = results[0] if results else None
        except Exception as e:
            log.warning(f"[table] inference err at t={t_sec:.1f}s: {e}")
            continue

        centroids_list: List[Tuple[float, float]] = []
        track_ids_list: List[int] = []
        if r is not None and r.boxes is not None and len(r.boxes):
            boxes = r.boxes.xyxy.cpu().numpy()
            ids   = (r.boxes.id.cpu().numpy().astype(int).tolist()
                     if r.boxes.id is not None
                     else list(range(-proc_idx * 100, -proc_idx * 100 + len(boxes))))
            for (x1, y1, x2, y2), tid in zip(boxes, ids):
                cx = (x1 + x2) / 2.0
                cy = (y1 + y2) / 2.0
                centroids_list.append((float(cx), float(cy)))
                track_ids_list.append(int(tid))

        centroids_arr = np.array(centroids_list, dtype=np.float32) \
                        if centroids_list else np.empty((0, 2), dtype=np.float32)
        tracker.update(proc_idx, t_sec, centroids_arr, track_ids_list)

        # Live push
        if is_continuous and (time.time() - last_live_push) >= LIVE_CB_EVERY:
            try:
                partial = _build_summary(tracker, t_sec, clip_label)
                live_cb(partial, time.time() - start_wall)
            except Exception as e:
                log.debug(f"[table] live_cb err: {e}")
            last_live_push = time.time()

        if not is_continuous and max_seconds > 0:
            pct = min(95, int((t_sec / max_seconds) * 100))
            progress_cb(pct, f"t={int(t_sec)}s  {len(centroids_list)} people seen")

    cap.release()
    progress_cb(98, "Finalising table turns")

    summary = _build_summary(tracker, t_sec, clip_label)
    try:
        summary["_table_state"] = tracker.get_cross_segment_state() \
            if hasattr(tracker, "get_cross_segment_state") else {}
    except Exception:
        summary["_table_state"] = {}

    log.info(
        f"[table] done — turns={summary.get('total_turns',0)} "
        f"tables={len(tables_cfg)} samples={proc_idx} dur={t_sec:.0f}s"
    )
    return summary


def _build_summary(tracker: TableTurnTracker, total_sec: float, clip_label: str) -> Dict:
    """Compact, aws_sync-compatible summary."""
    # Gather per-table detail using the tracker's public attrs
    table_detail: Dict[str, Dict] = {}
    total_turns = 0
    dwells: List[float] = []
    for tid, table in tracker.tables.items():
        state = tracker._states.get(tid)
        sessions = getattr(state, "sessions", []) if state else []
        t_turns = len(sessions)
        total_turns += t_turns
        table_dwells = [s.cleared_at - s.seated_at
                        for s in sessions
                        if s.seated_at is not None and s.cleared_at is not None]
        dwells.extend(table_dwells)
        table_detail[tid] = {
            "label":        table.label,
            "turns":        t_turns,
            "is_occupied":  bool(getattr(state, "is_occupied", False)),
            "avg_dwell_min": round(sum(table_dwells) / len(table_dwells) / 60, 1) if table_dwells else 0,
        }
    avg_dwell_min = round(sum(dwells) / len(dwells) / 60, 1) if dwells else 0
    return {
        "analysis_mode":    "table_turns",
        "clip_label":       clip_label,
        "total_turns":      total_turns,
        "avg_dwell_min":    avg_dwell_min,
        "avg_response_sec": None,
        "table_detail":     table_detail,
        "tables":           table_detail,   # alias — some downstream code looks under "tables"
        "events":           getattr(tracker, "events", []),
        "video_seconds":    round(total_sec, 1),
    }
