"""
VenueScope — Bottle/glass counter for bar zones.

Counts YOLO COCO classes:
  39 = bottle
  40 = wine_glass
  41 = cup

Tracks detections across frames using IoU-based overlap (IoU > 0.3 = same object).
Emits bottle_appear events when a new bottle enters a zone.
"""
from __future__ import annotations

from typing import List, Dict, Any, Tuple, Optional
import numpy as np

# COCO class IDs for drinkware
_BOTTLE_CLASSES = {39, 40, 41}
_CLASS_NAMES = {39: "bottle", 40: "wine_glass", 41: "cup"}

_SAMPLE_INTERVAL_SEC = 5.0


def _point_in_polygon(px: float, py: float, poly: List[Tuple]) -> bool:
    n = len(poly); inside = False; j = n - 1
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi):
            inside = not inside
        j = i
    return inside


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    """Compute IoU between two boxes [x1, y1, x2, y2]."""
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1 = max(ax1, bx1); iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2); iy2 = min(ay2, by2)
    iw = max(0.0, ix2 - ix1); ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter == 0.0:
        return 0.0
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0.0 else 0.0


class _TrackedBottle:
    """Represents a single tracked bottle/glass/cup instance."""
    _id_counter = 0

    def __init__(self, box: np.ndarray, class_id: int, t_sec: float):
        _TrackedBottle._id_counter += 1
        self.uid: int = _TrackedBottle._id_counter
        self.box: np.ndarray = box.copy()
        self.class_id: int = class_id
        self.last_seen_t: float = t_sec
        self.missed_frames: int = 0


class BottleCounter:
    """
    Counts bottles, wine glasses, and cups visible in configurable bar zones.

    Parameters
    ----------
    zone_polys_norm : list of list of (float, float)
        Each entry is a polygon in normalized [0, 1] coordinates.
        Multiple zones are each tracked independently; overall summary
        aggregates across all zones.
    W, H : int
        Frame pixel dimensions used to scale normalized polygon coords.
    iou_threshold : float
        Minimum IoU to consider two detections in consecutive frames the
        same object (default 0.3).
    max_missed_frames : int
        Frames a track may be absent before it is dropped (default 5).
    """

    def __init__(
        self,
        zone_polys_norm: List[List[Tuple[float, float]]],
        W: int,
        H: int,
        iou_threshold: float = 0.3,
        max_missed_frames: int = 5,
    ):
        self.W = W
        self.H = H
        self.iou_threshold = iou_threshold
        self.max_missed_frames = max_missed_frames

        # Convert normalised polygons to pixel coords
        self._zone_polys: List[List[Tuple[float, float]]] = []
        for poly_norm in zone_polys_norm:
            px_poly = [(x * W, y * H) for x, y in poly_norm]
            self._zone_polys.append(px_poly)

        # Per-zone tracking state
        self._zone_tracks: List[List[_TrackedBottle]] = [[] for _ in self._zone_polys]

        # Per-zone statistics
        self._zone_peak: List[int] = [0] * len(self._zone_polys)
        self._zone_total_count: List[int] = [0] * len(self._zone_polys)  # sum of per-frame counts
        self._zone_frame_count: List[int] = [0] * len(self._zone_polys)  # frames with data

        # Global appearance tracking
        self._total_appearances: int = 0
        self._by_class: Dict[str, int] = {"bottle": 0, "wine_glass": 0, "cup": 0}

        # Timeline sampling (across all zones combined)
        self._timeline: List[Dict[str, Any]] = []
        self._last_sample_t: float = -_SAMPLE_INTERVAL_SEC

        # Running total for avg_count
        self._frame_count_total: int = 0
        self._count_sum_total: int = 0

        # Peak across all zones
        self._peak_count: int = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def update(
        self,
        frame_idx: int,
        t_sec: float,
        boxes_norm: np.ndarray,
        class_ids: List[int],
        confs: List[float],
    ) -> List[Dict[str, Any]]:
        """
        Process one frame of detections.

        Parameters
        ----------
        frame_idx : int
            Frame index (informational, included in events).
        t_sec : float
            Timestamp in seconds.
        boxes_norm : np.ndarray, shape (N, 4)
            Bounding boxes already scaled to pixel coords [x1, y1, x2, y2].
            Despite the parameter name matching the caller's convention, the
            values are expected in pixel space (as stated in the spec).
        class_ids : list of int
            COCO class IDs corresponding to each detection.
        confs : list of float
            Confidence scores for each detection.

        Returns
        -------
        list of dict
            bottle_appear events for any newly seen bottles.
        """
        events: List[Dict[str, Any]] = []

        # Guard: handle empty / malformed inputs gracefully
        if boxes_norm is None or len(boxes_norm) == 0:
            boxes_norm = np.zeros((0, 4), dtype=np.float32)

        n_det = len(boxes_norm)
        class_ids = list(class_ids) if class_ids is not None else []
        confs = list(confs) if confs is not None else []

        # Pad missing conf values
        while len(confs) < n_det:
            confs.append(0.0)

        # Filter to only drinkware classes
        drinkware_indices = [
            i for i in range(min(n_det, len(class_ids)))
            if class_ids[i] in _BOTTLE_CLASSES
        ]

        combined_visible_count = 0

        for zone_idx, poly in enumerate(self._zone_polys):
            # Find detections whose centre is inside this zone
            zone_det_indices = []
            for i in drinkware_indices:
                box = boxes_norm[i]
                cx = (box[0] + box[2]) / 2.0
                cy = (box[1] + box[3]) / 2.0
                if _point_in_polygon(cx, cy, poly):
                    zone_det_indices.append(i)

            # Match detections to existing tracks (greedy IoU)
            tracks = self._zone_tracks[zone_idx]
            matched_track_ids: set = set()
            matched_det_indices: set = set()

            for det_i in zone_det_indices:
                best_iou = self.iou_threshold
                best_track: Optional[_TrackedBottle] = None
                for trk in tracks:
                    if id(trk) in matched_track_ids:
                        continue
                    iou_val = _iou(boxes_norm[det_i], trk.box)
                    if iou_val > best_iou:
                        best_iou = iou_val
                        best_track = trk

                if best_track is not None:
                    # Update existing track
                    best_track.box = boxes_norm[det_i].copy()
                    best_track.last_seen_t = t_sec
                    best_track.missed_frames = 0
                    matched_track_ids.add(id(best_track))
                    matched_det_indices.add(det_i)
                else:
                    # New detection — create new track and emit event
                    cid = class_ids[det_i]
                    new_trk = _TrackedBottle(boxes_norm[det_i], cid, t_sec)
                    tracks.append(new_trk)
                    matched_track_ids.add(id(new_trk))
                    matched_det_indices.add(det_i)

                    self._total_appearances += 1
                    class_name = _CLASS_NAMES.get(cid, "bottle")
                    self._by_class[class_name] = self._by_class.get(class_name, 0) + 1

                    events.append({
                        "event_type": "bottle_appear",
                        "bottle_uid": new_trk.uid,
                        "class_id": cid,
                        "class_name": class_name,
                        "zone_idx": zone_idx,
                        "t_sec": round(t_sec, 3),
                        "frame_idx": frame_idx,
                        "confidence": round(confs[det_i], 4),
                    })

            # Age unmatched tracks; remove expired ones
            surviving: List[_TrackedBottle] = []
            for trk in tracks:
                if id(trk) in matched_track_ids:
                    surviving.append(trk)
                else:
                    trk.missed_frames += 1
                    if trk.missed_frames <= self.max_missed_frames:
                        surviving.append(trk)
            self._zone_tracks[zone_idx] = surviving

            # Per-zone stats
            visible_now = len(surviving)
            combined_visible_count += visible_now
            if visible_now > self._zone_peak[zone_idx]:
                self._zone_peak[zone_idx] = visible_now
            self._zone_total_count[zone_idx] += visible_now
            self._zone_frame_count[zone_idx] += 1

        # Global stats
        self._frame_count_total += 1
        self._count_sum_total += combined_visible_count
        if combined_visible_count > self._peak_count:
            self._peak_count = combined_visible_count

        # Timeline sampling
        if t_sec - self._last_sample_t >= _SAMPLE_INTERVAL_SEC:
            self._timeline.append({"t_sec": round(t_sec, 3), "count": combined_visible_count})
            self._last_sample_t = t_sec

        return events

    def summary(self) -> Dict[str, Any]:
        """
        Return a summary of bottle/glass counts observed so far.

        Returns
        -------
        dict with keys:
            total_bottles_seen : int   — total unique bottle appearances
            peak_count         : int   — max simultaneously visible (all zones)
            avg_count          : float — average bottles per frame (all zones)
            timeline           : list  — [{t_sec, count}] sampled every 5 s
            by_class           : dict  — {"bottle": N, "wine_glass": N, "cup": N}
        """
        avg = (
            self._count_sum_total / self._frame_count_total
            if self._frame_count_total > 0
            else 0.0
        )
        return {
            "total_bottles_seen": self._total_appearances,
            "peak_count": self._peak_count,
            "avg_count": round(avg, 3),
            "timeline": list(self._timeline),
            "by_class": dict(self._by_class),
        }
