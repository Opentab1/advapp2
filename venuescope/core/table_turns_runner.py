"""
VenueScope — Lightweight table-turns detector (no YOLO).

Uses per-zone MOG2 background subtraction + blob detection instead of full
YOLO inference. ~3-5ms per frame vs 48ms for ONNX YOLO, same accuracy for
slow-moving seated people detected from overhead cameras.

Route: table_turns primary mode on RTSP + CPU-only → this runner.
YOLO engine is still used when GPU is present or when table_turns is an
extra mode on top of drink_count (which already runs YOLO).
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np

from core.analytics.table_tracker import TableTurnTracker, TableZone

# ─── Constants ────────────────────────────────────────────────────────────────

DEFAULT_TABLE_RULES = {
    "occupied_conf_frames": 30,    # consecutive frames with motion to call occupied
    "empty_conf_frames":    60,    # consecutive empty frames to call cleared
    "min_dwell_seconds":    300,   # minimum dwell for a turn to count (5 min)
}

# MOG2 per-zone params
_MOG2_HISTORY     = 500   # frames in BG model
_MOG2_VAR_THRESH  = 25    # sensitivity (lower = more sensitive)
_MOG2_LEARN_RATE  = 0.005 # slow learning so a seated person doesn't become BG

# Blob detector params
_BLOB_MIN_AREA_PX = 200   # minimum fg blob area to count as a person
_BLOB_MAX_AREA_PX = 50000 # ignore huge blobs (camera shake, lighting change)

# Centroid tracker params
_MAX_DIST_PX    = 80   # max centroid jump per frame to maintain ID
_TRACK_TIMEOUT  = 3.0  # seconds without detection before track is dropped

# Live push interval (seconds)
_LIVE_INTERVAL  = 5.0

# Process every Nth frame. Seated people barely move — 3 effective FPS from
# a 15-FPS stream is more than sufficient. Reduces CPU ~5x vs full-rate.
_PROCESS_EVERY_N = 5


# ─── Centroid tracker ─────────────────────────────────────────────────────────

class _CentroidTracker:
    """
    Nearest-neighbour centroid tracker that emits stable integer track IDs.
    Used to give TableTurnTracker the same track_ids interface it expects from YOLO.
    """

    def __init__(self):
        self._next_id = 1
        # track_id → (cx, cy, last_seen_t)
        self._tracks: Dict[int, Tuple[float, float, float]] = {}

    def update(
        self,
        centroids: List[Tuple[float, float]],
        t_sec: float,
    ) -> List[Tuple[int, float, float]]:
        """
        Match detections to existing tracks by nearest-neighbour distance.
        Returns list of (track_id, cx, cy) for all matched/new centroids.
        """
        # Drop timed-out tracks
        self._tracks = {
            tid: (cx, cy, ts)
            for tid, (cx, cy, ts) in self._tracks.items()
            if t_sec - ts <= _TRACK_TIMEOUT
        }

        if not centroids:
            return []

        result: List[Tuple[int, float, float]] = []
        used_tracks: set = set()

        for cx, cy in centroids:
            best_tid   = None
            best_dist  = _MAX_DIST_PX + 1

            for tid, (tx, ty, _) in self._tracks.items():
                if tid in used_tracks:
                    continue
                d = ((cx - tx) ** 2 + (cy - ty) ** 2) ** 0.5
                if d < best_dist:
                    best_dist = d
                    best_tid  = tid

            if best_tid is not None:
                self._tracks[best_tid] = (cx, cy, t_sec)
                used_tracks.add(best_tid)
                result.append((best_tid, cx, cy))
            else:
                new_id = self._next_id
                self._next_id += 1
                self._tracks[new_id] = (cx, cy, t_sec)
                result.append((new_id, cx, cy))

        return result


# ─── Zone helpers ─────────────────────────────────────────────────────────────

def _build_mask(polygon_px: List[Tuple[float, float]],
                h: int, w: int) -> np.ndarray:
    """Binary mask for a polygon (1 inside, 0 outside)."""
    pts = np.array([[int(x), int(y)] for x, y in polygon_px], dtype=np.int32)
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(mask, [pts], 1)
    return mask


def _detect_centroids(
    fg_mask: np.ndarray,
    zone_mask: np.ndarray,
) -> List[Tuple[float, float]]:
    """
    Find person centroids in a foreground mask restricted to zone_mask.
    Uses connected-component analysis (faster + more accurate than findContours
    for blob counting).
    """
    masked = cv2.bitwise_and(fg_mask, fg_mask, mask=zone_mask)

    # Morphological cleanup — remove noise, fill holes
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    cleaned = cv2.morphologyEx(masked, cv2.MORPH_OPEN,  kernel, iterations=2)
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel, iterations=2)

    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
        cleaned, connectivity=8)

    result: List[Tuple[float, float]] = []
    for i in range(1, num_labels):  # skip background label 0
        area = int(stats[i, cv2.CC_STAT_AREA])
        if _BLOB_MIN_AREA_PX <= area <= _BLOB_MAX_AREA_PX:
            result.append((float(centroids[i][0]), float(centroids[i][1])))

    return result


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
    Lightweight table-turns detection without YOLO.

    Reads frames from RTSP stream, applies per-zone MOG2 background subtraction,
    extracts person centroids via blob analysis, tracks them with a centroid
    tracker, and feeds the result into TableTurnTracker for occupancy state.

    Returns a summary dict compatible with the VenueProcessor output format
    (same keys consumed by aws_sync.py + React dashboard).
    """
    source        = job["source_path"]
    max_seconds   = float(extra_config.get("max_seconds", 0))  # 0 = continuous
    tables_cfg    = extra_config.get("tables", [])
    rules         = extra_config.get("table_rules", DEFAULT_TABLE_RULES)
    camera_id     = extra_config.get("camera_id", "")
    clip_label    = job.get("clip_label", camera_id or "table_turns")
    analysis_mode = "table_turns"

    occ_conf  = int(rules.get("occupied_conf_frames", DEFAULT_TABLE_RULES["occupied_conf_frames"]))
    emp_conf  = int(rules.get("empty_conf_frames",    DEFAULT_TABLE_RULES["empty_conf_frames"]))
    min_dwell = float(rules.get("min_dwell_seconds",  DEFAULT_TABLE_RULES["min_dwell_seconds"]))

    # ── Open stream ─────────────────────────────────────────────────────────
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open source: {source}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 15.0
    fps = max(float(fps), 1.0)
    total_frames_hint = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    max_frames = int(max_seconds * fps) if max_seconds > 0 else 0

    progress_cb(2, "Opened stream — initialising table zones")

    # ── Build table zones ───────────────────────────────────────────────────
    # Read one frame to get actual resolution (RTSP reports 0x0 until first read)
    ret, first_frame = cap.read()
    if not ret or first_frame is None:
        cap.release()
        raise RuntimeError("Could not read first frame from source")

    H, W = first_frame.shape[:2]

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
        return {
            "analysis_mode": analysis_mode,
            "clip_label":    clip_label,
            "total_turns":   0,
            "avg_dwell_min": 0,
            "avg_response_sec": None,
            "table_detail":  {},
            "events":        [],
            "video_seconds": 0,
        }

    # Effective FPS seen by the tracker (after frame skipping)
    effective_fps = fps / _PROCESS_EVERY_N

    tracker = TableTurnTracker(
        tables        = table_zones,
        occupied_conf = occ_conf,
        empty_conf    = emp_conf,
        min_dwell_sec = min_dwell,
        fps           = effective_fps,
    )

    # Restore cross-segment state (active sessions survive worker restart)
    prior_state = extra_config.get("prior_table_state", {})
    if prior_state:
        try:
            tracker.restore_cross_segment_state(prior_state)
        except Exception:
            pass

    # ── Per-zone MOG2 subtractors + centroid trackers ───────────────────────
    mog2_per_zone: Dict[str, cv2.BackgroundSubtractorMOG2] = {}
    masks_per_zone: Dict[str, np.ndarray] = {}
    centroid_trackers: Dict[str, _CentroidTracker] = {}

    for tz in table_zones:
        mog2_per_zone[tz.table_id] = cv2.createBackgroundSubtractorMOG2(
            history=_MOG2_HISTORY,
            varThreshold=_MOG2_VAR_THRESH,
            detectShadows=True,   # shadows → grey, not white → cleaner masks
        )
        masks_per_zone[tz.table_id]      = _build_mask(tz.polygon_px, H, W)
        centroid_trackers[tz.table_id]   = _CentroidTracker()

    # Downscale factor for MOG2 processing. Full 1080p is expensive; 540p is
    # sufficient for blob detection of seated people from overhead cameras.
    _SCALE = 0.5
    _SW = max(1, int(W * _SCALE))
    _SH = max(1, int(H * _SCALE))

    # Rebuild masks at reduced resolution
    for tz in table_zones:
        scaled_poly = [(x * _SCALE, y * _SCALE) for x, y in tz.polygon_px]
        masks_per_zone[tz.table_id] = _build_mask(scaled_poly, _SH, _SW)

    # ── Main processing loop ─────────────────────────────────────────────────
    frame_idx      = 0
    proc_idx       = 0   # count of actually-processed frames
    start_wall     = time.time()
    t_sec          = 0.0
    last_live_push = 0.0

    # Feed first frame through (already read above)
    frames_to_process = [first_frame]

    while True:
        if frames_to_process:
            frame = frames_to_process.pop(0)
        else:
            ret, frame = cap.read()
            if not ret or frame is None:
                break

        frame_idx += 1
        t_sec      = frame_idx / fps

        # Honour max_seconds cap for non-continuous jobs
        if max_frames > 0 and frame_idx > max_frames:
            break

        # Shutdown hook for graceful kill
        if os.environ.get("_VENUESCOPE_STOP"):
            break

        # Frame skip — decode all frames but only run MOG2 every N frames.
        # This dramatically reduces CPU since seated people move slowly.
        if frame_idx % _PROCESS_EVERY_N != 1:
            continue

        proc_idx += 1

        # Downscale frame for processing
        small = cv2.resize(frame, (_SW, _SH), interpolation=cv2.INTER_LINEAR)

        # ── Per-zone detection ───────────────────────────────────────────────
        all_centroids: List[Tuple[float, float]] = []
        all_track_ids: List[int] = []

        for tz in table_zones:
            zmog = mog2_per_zone[tz.table_id]
            zmask = masks_per_zone[tz.table_id]
            zctrack = centroid_trackers[tz.table_id]

            fg = zmog.apply(small, learningRate=_MOG2_LEARN_RATE)
            # Threshold: shadows (127) → 0, foreground (255) → 255
            _, fg_bin = cv2.threshold(fg, 200, 255, cv2.THRESH_BINARY)

            zone_centroids = _detect_centroids(fg_bin, zmask)
            # Scale centroids back to original frame coordinates
            zone_centroids_full = [(cx / _SCALE, cy / _SCALE) for cx, cy in zone_centroids]
            tracked = zctrack.update(zone_centroids_full, t_sec)

            for tid, cx, cy in tracked:
                all_centroids.append((cx, cy))
                all_track_ids.append(tid)

        # Feed TableTurnTracker (use proc_idx so conf_frames counts processed frames)
        if all_centroids:
            c_arr = np.array(all_centroids, dtype=np.float32)
            tracker.update(proc_idx, t_sec, c_arr, all_track_ids)
        else:
            tracker.update(proc_idx, t_sec, np.empty((0, 2), dtype=np.float32), [])

        # ── Progress ────────────────────────────────────────────────────────
        if proc_idx % 30 == 0:
            if total_frames_hint > 0 and max_frames == 0:
                pct = min(95.0, 100.0 * frame_idx / total_frames_hint)
            elif max_frames > 0:
                pct = min(95.0, 100.0 * frame_idx / max_frames)
            else:
                elapsed_wall = time.time() - start_wall
                pct = min(95.0, elapsed_wall / 3600 * 100)  # rough estimate

            tbl_summary = tracker.summary()
            occ_count   = sum(1 for td in tbl_summary.values() if td.get("currently_occupied"))
            progress_cb(pct, f"{occ_count}/{len(table_zones)} tables occupied")

        # ── Live push ────────────────────────────────────────────────────────
        elapsed_wall = time.time() - start_wall
        if is_continuous and elapsed_wall - last_live_push >= _LIVE_INTERVAL:
            last_live_push = elapsed_wall
            tbl_summary    = tracker.summary()
            _push_live(
                live_cb, tracker, tbl_summary, t_sec, clip_label,
                camera_id, analysis_mode, table_zones,
            )

    cap.release()

    # ── Final summary ────────────────────────────────────────────────────────
    progress_cb(98, "Computing final summary")
    tbl_summary = tracker.summary()
    return _build_summary(
        tbl_summary, tracker, t_sec, clip_label, analysis_mode, table_zones
    )


# ─── Summary helpers ──────────────────────────────────────────────────────────

def _build_summary(
    tbl_summary: Dict,
    tracker: TableTurnTracker,
    video_seconds: float,
    clip_label: str,
    analysis_mode: str,
    table_zones: List[TableZone],
) -> Dict:
    all_turns  = sum(td["turn_count"]  for td in tbl_summary.values())
    all_dwells = [td["avg_dwell_min"]  for td in tbl_summary.values() if td["avg_dwell_min"] > 0]
    all_resps  = [td["avg_response_sec"] for td in tbl_summary.values()
                  if td.get("avg_response_sec") is not None]

    return {
        "analysis_mode":    analysis_mode,
        "clip_label":       clip_label,
        "total_turns":      all_turns,
        "avg_dwell_min":    round(float(np.mean(all_dwells)), 1) if all_dwells else 0,
        "avg_response_sec": round(float(np.mean(all_resps)),  1) if all_resps  else None,
        "table_detail":     tbl_summary,
        "events":           tracker.events,
        "video_seconds":    round(video_seconds, 1),
        # Keys expected by aws_sync.py
        "total_drinks":     0,
        "unrung_drinks":    0,
        "has_theft_flag":   False,
        # Cross-segment state for next segment
        "_table_state":     tracker.get_cross_segment_state(),
    }


def _push_live(
    live_cb: Callable[[Dict, float], None],
    tracker: TableTurnTracker,
    tbl_summary: Dict,
    elapsed_sec: float,
    clip_label: str,
    camera_id: str,
    analysis_mode: str,
    table_zones: List[TableZone],
) -> None:
    occ_count  = sum(1 for td in tbl_summary.values() if td.get("currently_occupied"))
    all_turns  = sum(td["turn_count"]  for td in tbl_summary.values())
    all_dwells = [td["avg_dwell_min"]  for td in tbl_summary.values() if td["avg_dwell_min"] > 0]
    all_resps  = [td.get("avg_response_sec") for td in tbl_summary.values()
                  if td.get("avg_response_sec") is not None]

    live_occ = {
        tid: {
            "currently_occupied": td["currently_occupied"],
            "turn_count":         td["turn_count"],
            "avg_dwell_min":      td["avg_dwell_min"],
            "avg_response_sec":   td.get("avg_response_sec"),
        }
        for tid, td in tbl_summary.items()
    }

    partial: Dict = {
        "analysis_mode":       analysis_mode,
        "clip_label":          clip_label,
        "camera_id":           camera_id,
        "total_turns":         all_turns,
        "avg_dwell_min":       round(float(np.mean(all_dwells)), 1) if all_dwells else 0,
        "avg_response_sec":    round(float(np.mean(all_resps)),  1) if all_resps  else None,
        "liveTableOccupancy":  json.dumps(live_occ),
        "table_detail":        tbl_summary,
        "total_drinks":        0,
        "unrung_drinks":       0,
        "has_theft_flag":      False,
        "_table_state":        tracker.get_cross_segment_state(),
    }
    try:
        live_cb(partial, elapsed_sec)
    except Exception:
        pass
