"""
auto_table_config.py — Auto-detect dining-table polygons from a camera stream.

Algorithm:
  1. Grab up to 15 frames from the stream (first ~10s).
  2. Run YOLO on each frame filtered to COCO class 60 (dining table).
  3. Keep only confident detections (conf >= 0.30) within the frame.
  4. Cluster overlapping bboxes across frames (IoU > 0.35 → same table).
  5. Keep clusters seen in ≥ MIN_HITS frames (stability filter).
  6. Emit each surviving cluster as a rectangular polygon in normalized
     0-1 coordinates — matches the tableZonesJson schema the React
     TableZoneEditorModal and the table_turns_runner already consume.

Falls back to an empty list (no zones) if detection fails or the scene
has no tables — the operator still draws manually as a last resort.
"""
from __future__ import annotations
import logging
from typing import List, Tuple

log = logging.getLogger("auto_table_config")

# ── Tuning ────────────────────────────────────────────────────────────────────
MAX_FRAMES        = 15
CONF_THRESHOLD    = 0.30
IOU_MERGE         = 0.35           # clusters merge if overlap ≥ this
MIN_HITS          = 3              # seen in this many frames to be kept
COCO_TABLE_CLASS  = 60             # dining table in COCO
MAX_TABLES        = 30             # safety cap
_ANALYSIS_IMGSZ   = 640


def _iou(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float]) -> float:
    """IoU for two (x1,y1,x2,y2) boxes in normalized coords."""
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    inter_x1 = max(ax1, bx1); inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2); inter_y2 = min(ay2, by2)
    if inter_x2 <= inter_x1 or inter_y2 <= inter_y1:
        return 0.0
    inter = (inter_x2 - inter_x1) * (inter_y2 - inter_y1)
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _merge_box(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float]) -> Tuple[float, float, float, float]:
    """Return the enclosing rectangle of two boxes (widest coverage)."""
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def analyze_stream(rtsp_url: str, max_frames: int = MAX_FRAMES) -> List[dict]:
    """Return a list of table zone dicts ready to JSON-serialise into
    `tableZonesJson`. Empty list on any failure.
    """
    try:
        import cv2
    except Exception as e:
        log.warning(f"cv2 unavailable, cannot auto-detect tables: {e}")
        return []

    # Load YOLO via the shared loader so it matches the runtime model.
    try:
        from core.tracking.engine import _load_yolo
        model = _load_yolo("yolov8s.pt")
    except Exception as e:
        log.warning(f"YOLO load failed: {e}")
        return []

    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        log.warning(f"Cannot open stream: {rtsp_url}")
        return []

    try:
        # Boxes collected across frames as normalized (x1,y1,x2,y2)
        raw_boxes: List[Tuple[float, float, float, float]] = []
        frames_seen = 0
        frames_attempted = 0

        # Try to sample across a ~10s window rather than back-to-back frames
        while frames_seen < max_frames and frames_attempted < max_frames * 3:
            frames_attempted += 1
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            frames_seen += 1
            h, w = frame.shape[:2]
            if not h or not w:
                continue

            try:
                results = model.predict(
                    frame,
                    classes=[COCO_TABLE_CLASS],
                    conf=CONF_THRESHOLD,
                    imgsz=_ANALYSIS_IMGSZ,
                    verbose=False,
                )
            except Exception as e:
                log.debug(f"YOLO predict failed on frame: {e}")
                continue

            for r in results:
                boxes = getattr(r, "boxes", None)
                if boxes is None or not len(boxes):
                    continue
                for b in boxes.xyxy.tolist():
                    x1, y1, x2, y2 = b
                    raw_boxes.append((
                        max(0.0, x1 / w), max(0.0, y1 / h),
                        min(1.0, x2 / w), min(1.0, y2 / h),
                    ))

        if not raw_boxes:
            log.info(f"[auto_table_config] No tables detected across {frames_seen} frames")
            return []

        # ── Cluster overlapping bboxes across frames ───────────────────────
        clusters: List[dict] = []   # each {"box": tuple, "hits": int}
        for box in raw_boxes:
            merged = False
            for c in clusters:
                if _iou(c["box"], box) >= IOU_MERGE:
                    c["box"] = _merge_box(c["box"], box)
                    c["hits"] += 1
                    merged = True
                    break
            if not merged:
                clusters.append({"box": box, "hits": 1})

        # Filter by stability
        stable = [c for c in clusters if c["hits"] >= MIN_HITS]
        # Sort reading order — top-to-bottom, left-to-right
        stable.sort(key=lambda c: (round(c["box"][1], 2), round(c["box"][0], 2)))
        stable = stable[:MAX_TABLES]

        zones: List[dict] = []
        for i, c in enumerate(stable):
            x1, y1, x2, y2 = c["box"]
            # Pad very tight bboxes by 3% so the detection zone comfortably
            # contains the whole table outline including chairs pulled in.
            pad = 0.015
            x1 = max(0.0, x1 - pad); y1 = max(0.0, y1 - pad)
            x2 = min(1.0, x2 + pad); y2 = min(1.0, y2 + pad)
            zones.append({
                "table_id": f"t{i}",
                "label":    f"Table {i + 1}",
                "polygon": [
                    [round(x1, 4), round(y1, 4)],
                    [round(x2, 4), round(y1, 4)],
                    [round(x2, 4), round(y2, 4)],
                    [round(x1, 4), round(y2, 4)],
                ],
                # Debug / auditability fields — the TS schema ignores unknown keys.
                "auto_detected": True,
                "hits":          c["hits"],
            })

        log.info(
            f"[auto_table_config] {len(zones)} tables detected "
            f"({len(raw_boxes)} raw hits across {frames_seen} frames, "
            f"{len(clusters)} clusters, {len(stable)} stable)"
        )
        return zones
    finally:
        try: cap.release()
        except Exception: pass
