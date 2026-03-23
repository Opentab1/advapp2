"""
VenueScope — Bottle/glass counter for bar inventory & theft detection.

Inspired by BevCounter-style use cases:
  1. Premium pour theft  — detect which bottle is grabbed vs. what was rung
  2. BYOB scam           — flag bottles that appear mid-shift (not in opening inventory)
  3. Pour yield          — estimate oz poured via bottle-tilt duration
  4. Over-pour detection — flag pours exceeding the standard measure
  5. Bar par auditing    — alert when shelf count drops below configured par level
  6. Walk-out detection  — bottle removed from zone without a pour event

How tilt detection works
────────────────────────
YOLO's bounding box for an upright bottle is tall & narrow (h/w ≈ 3–5).
When a bartender tilts a bottle to pour, the box becomes wider relative to
its height (h/w drops toward 1.0).  We track the h/w ratio over a short
rolling window; a sustained drop below POUR_RATIO_THRESHOLD signals pouring.

COCO classes detected
─────────────────────
  39 = bottle   (spirits, water, mixers)
  40 = wine_glass
  41 = cup
"""
from __future__ import annotations

import time
from typing import List, Dict, Any, Tuple, Optional
import numpy as np

_BOTTLE_CLASSES = {39, 40, 41}
_CLASS_NAMES    = {39: "bottle", 40: "wine_glass", 41: "cup"}

# Aspect ratio (h/w) thresholds for pour detection
_UPRIGHT_RATIO  = 1.8   # h/w above this → bottle is upright
_POUR_RATIO     = 1.2   # h/w below this → bottle is being tilted/poured
_POUR_TILT_WINDOW = 4   # rolling frames used to smooth ratio

# Pour yield constants (free-pour)
_FLOW_RATE_OZ_PER_SEC = 0.75   # ~0.75 oz/sec for a standard free pour
_STANDARD_POUR_OZ     = 1.25   # standard measure (adjust per venue)
_OVER_POUR_FACTOR     = 1.4    # pours > factor × standard = over-pour flag

_SAMPLE_INTERVAL_SEC  = 5.0    # timeline resolution

_IOU_THRESHOLD        = 0.25   # IoU to match same bottle across frames
_MAX_MISSED_FRAMES    = 8      # frames before a track is dropped (≈0.3s @ 30fps)
_MIN_POUR_FRAMES      = 3      # min frames tilted to register as a real pour


def _point_in_polygon(px: float, py: float, poly: List[Tuple]) -> bool:
    n = len(poly); inside = False; j = n - 1
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi):
            inside = not inside
        j = i
    return inside


def _iou(a: np.ndarray, b: np.ndarray) -> float:
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


def _aspect_ratio(box: np.ndarray) -> float:
    """h/w — high = upright bottle, low = tilted/horizontal."""
    w = max(box[2] - box[0], 1.0)
    h = max(box[3] - box[1], 1.0)
    return h / w


class _BottleTrack:
    """Single tracked bottle/glass across frames."""
    _id_counter = 0

    def __init__(self, box: np.ndarray, class_id: int, t_sec: float, is_unknown: bool):
        _BottleTrack._id_counter += 1
        self.uid: int = _BottleTrack._id_counter
        self.box: np.ndarray = box.copy()
        self.class_id: int = class_id
        self.class_name: str = _CLASS_NAMES.get(class_id, "bottle")
        self.first_seen_t: float = t_sec
        self.last_seen_t: float = t_sec
        self.missed_frames: int = 0
        self.is_unknown: bool = is_unknown   # appeared after opening inventory

        # Pour tracking
        self._ratio_window: List[float] = [_aspect_ratio(box)]
        self.is_pouring: bool = False
        self._pour_start_t: Optional[float] = None
        self._pour_tilt_frames: int = 0
        self.pour_events: List[Dict] = []   # completed pour events for this bottle

    def update(self, box: np.ndarray, t_sec: float) -> Optional[Dict]:
        """
        Update track with new detection.
        Returns a pour_end event dict if a pour just completed, else None.
        """
        self.box = box.copy()
        self.last_seen_t = t_sec
        self.missed_frames = 0

        ratio = _aspect_ratio(box)
        self._ratio_window.append(ratio)
        if len(self._ratio_window) > _POUR_TILT_WINDOW:
            self._ratio_window.pop(0)
        smoothed = sum(self._ratio_window) / len(self._ratio_window)

        event = None
        if not self.is_pouring:
            if smoothed < _POUR_RATIO:
                self._pour_tilt_frames += 1
                if self._pour_tilt_frames >= _MIN_POUR_FRAMES:
                    self.is_pouring = True
                    self._pour_start_t = t_sec - (_MIN_POUR_FRAMES / 30.0)  # backdate
            else:
                self._pour_tilt_frames = 0
        else:
            if smoothed >= _UPRIGHT_RATIO:
                # Pour ended
                duration = max(0.1, t_sec - (self._pour_start_t or t_sec))
                est_oz   = round(duration * _FLOW_RATE_OZ_PER_SEC, 2)
                over     = est_oz > _STANDARD_POUR_OZ * _OVER_POUR_FACTOR
                event = {
                    "event_type":    "pour_end",
                    "bottle_uid":    self.uid,
                    "class_name":    self.class_name,
                    "t_sec":         round(t_sec, 3),
                    "pour_start_t":  round(self._pour_start_t or t_sec, 3),
                    "duration_sec":  round(duration, 2),
                    "estimated_oz":  est_oz,
                    "is_over_pour":  over,
                    "is_unknown_bottle": self.is_unknown,
                }
                self.pour_events.append(event)
                self.is_pouring = False
                self._pour_start_t = None
                self._pour_tilt_frames = 0
        return event

    def mark_missed(self):
        self.missed_frames += 1

    @property
    def currently_visible(self) -> bool:
        return self.missed_frames == 0

    def had_pour(self) -> bool:
        return len(self.pour_events) > 0


class BottleCounter:
    """
    Tracks bottles/glasses in defined bar zones with:
    - Live par-level monitoring
    - Pour detection + yield estimation
    - Over-pour flagging
    - Unknown bottle detection (BYOB scam)
    - Walk-out detection (bottle removed without pour)
    - POS reconciliation support (total oz poured per session)

    Parameters
    ----------
    zone_polys_norm : list of list of (float, float)
        Shelf/bar zones in normalised [0,1] coords.  Multiple zones
        tracked independently.
    W, H : int
        Frame pixel dimensions.
    par_levels : list of int, optional
        Expected minimum bottle count per zone.  Triggers par_low events.
    standard_pour_oz : float
        Standard measure in oz (default 1.25 oz = 1 jigger).
    flow_rate_oz_per_sec : float
        Free-pour flow rate for yield estimation (default 0.75 oz/sec).
    iou_threshold : float
        IoU to match the same bottle across consecutive frames.
    max_missed_frames : int
        Grace period before a track is dropped.
    """

    def __init__(
        self,
        zone_polys_norm: List[List[Tuple[float, float]]],
        W: int,
        H: int,
        par_levels: Optional[List[int]] = None,
        standard_pour_oz: float = _STANDARD_POUR_OZ,
        flow_rate_oz_per_sec: float = _FLOW_RATE_OZ_PER_SEC,
        iou_threshold: float = _IOU_THRESHOLD,
        max_missed_frames: int = _MAX_MISSED_FRAMES,
    ):
        self.W = W
        self.H = H
        self._iou_threshold      = iou_threshold
        self._max_missed         = max_missed_frames
        self._standard_pour_oz   = standard_pour_oz
        self._flow_rate          = flow_rate_oz_per_sec

        # Convert normalised polygons to pixel coords
        self._zone_polys: List[List[Tuple[float, float]]] = [
            [(x * W, y * H) for x, y in poly]
            for poly in (zone_polys_norm or [[[0, 0], [1, 0], [1, 1], [0, 1]]])
        ]
        n_zones = len(self._zone_polys)
        self._par_levels: List[Optional[int]] = (
            list(par_levels) if par_levels else [None] * n_zones
        )
        # Pad if fewer par values than zones
        while len(self._par_levels) < n_zones:
            self._par_levels.append(None)

        # Per-zone tracking state
        self._zone_tracks: List[List[_BottleTrack]] = [[] for _ in range(n_zones)]

        # Opening-inventory snapshot (set after first stable frame)
        # uid → True for every bottle present at start of shift
        self._opening_uids: Optional[set] = None
        self._opening_frame_idx: int = 30   # frames to wait before snapshotting

        # Global aggregates
        self._all_pour_events:   List[Dict] = []
        self._walk_out_events:   List[Dict] = []
        self._unknown_alerts:    List[Dict] = []
        self._par_low_events:    List[Dict] = []
        self._total_appearances: int = 0
        self._by_class:          Dict[str, int] = {"bottle": 0, "wine_glass": 0, "cup": 0}
        self._peak_count:        int = 0
        self._count_sum:         int = 0
        self._frame_count:       int = 0
        self._timeline:          List[Dict] = []
        self._last_sample_t:     float = -_SAMPLE_INTERVAL_SEC
        self._current_count:     int = 0
        self._par_low_active:    List[bool] = [False] * n_zones

    # ── Public API ────────────────────────────────────────────────────────────

    def update(
        self,
        frame_idx: int,
        t_sec: float,
        boxes_norm: np.ndarray,
        class_ids: List[int],
        confs: List[float],
    ) -> List[Dict[str, Any]]:
        """Process one frame. Returns list of events for this frame."""
        events: List[Dict] = []

        if boxes_norm is None or len(boxes_norm) == 0:
            boxes_norm = np.zeros((0, 4), dtype=np.float32)
        n_det = len(boxes_norm)
        class_ids = list(class_ids) if class_ids is not None else []
        confs = list(confs) if confs is not None else []
        while len(confs) < n_det:
            confs.append(0.0)

        # Only drinkware classes
        drinkware_idx = [
            i for i in range(min(n_det, len(class_ids)))
            if class_ids[i] in _BOTTLE_CLASSES
        ]

        total_visible = 0

        for zone_idx, poly in enumerate(self._zone_polys):
            # Detections whose centre falls inside this zone
            zone_det = [
                i for i in drinkware_idx
                if _point_in_polygon(
                    (boxes_norm[i][0] + boxes_norm[i][2]) / 2.0,
                    (boxes_norm[i][1] + boxes_norm[i][3]) / 2.0,
                    poly,
                )
            ]

            tracks = self._zone_tracks[zone_idx]
            matched_track_ids: set = set()
            matched_det_idx:   set = set()

            # Greedy IoU matching
            for det_i in zone_det:
                best_iou  = self._iou_threshold
                best_trk: Optional[_BottleTrack] = None
                for trk in tracks:
                    if id(trk) in matched_track_ids:
                        continue
                    score = _iou(boxes_norm[det_i], trk.box)
                    if score > best_iou:
                        best_iou = score
                        best_trk = trk

                if best_trk is not None:
                    pour_ev = best_trk.update(boxes_norm[det_i], t_sec)
                    if pour_ev:
                        events.append(pour_ev)
                        self._all_pour_events.append(pour_ev)
                    matched_track_ids.add(id(best_trk))
                    matched_det_idx.add(det_i)
                else:
                    # New bottle/glass
                    is_unknown = (
                        self._opening_uids is not None   # inventory already snapshotted
                    )
                    cid  = class_ids[det_i]
                    trk  = _BottleTrack(boxes_norm[det_i], cid, t_sec, is_unknown)
                    tracks.append(trk)
                    matched_track_ids.add(id(trk))
                    matched_det_idx.add(det_i)

                    self._total_appearances += 1
                    cn = _CLASS_NAMES.get(cid, "bottle")
                    self._by_class[cn] = self._by_class.get(cn, 0) + 1

                    appear_ev = {
                        "event_type":   "bottle_appear",
                        "bottle_uid":   trk.uid,
                        "class_name":   cn,
                        "zone_idx":     zone_idx,
                        "t_sec":        round(t_sec, 3),
                        "frame_idx":    frame_idx,
                        "confidence":   round(confs[det_i], 4),
                        "is_unknown":   is_unknown,
                    }
                    events.append(appear_ev)

                    # Unknown bottle alert (BYOB / unregistered inventory)
                    if is_unknown and cid == 39:   # only flag spirit bottles, not glasses
                        alert = {**appear_ev, "event_type": "unknown_bottle_alert",
                                 "reason": "Bottle appeared after shift start — verify it belongs to bar inventory"}
                        events.append(alert)
                        self._unknown_alerts.append(alert)

            # Age unmatched tracks
            surviving: List[_BottleTrack] = []
            for trk in tracks:
                if id(trk) in matched_track_ids:
                    surviving.append(trk)
                else:
                    trk.mark_missed()
                    if trk.missed_frames <= self._max_missed:
                        surviving.append(trk)
                    else:
                        # Track dropped — walk-out detection
                        if not trk.had_pour() and trk.class_id == 39:
                            wo = {
                                "event_type":   "walk_out_alert",
                                "bottle_uid":   trk.uid,
                                "class_name":   trk.class_name,
                                "zone_idx":     zone_idx,
                                "first_seen_t": round(trk.first_seen_t, 3),
                                "last_seen_t":  round(trk.last_seen_t, 3),
                                "reason":       "Bottle disappeared from zone without detected pour — possible walk-out",
                            }
                            events.append(wo)
                            self._walk_out_events.append(wo)

            self._zone_tracks[zone_idx] = surviving

            # Visible count = only tracks confirmed this frame (missed_frames == 0)
            visible_now = sum(1 for t in surviving if t.currently_visible)
            total_visible += visible_now

            # Par level monitoring
            par = self._par_levels[zone_idx]
            if par is not None:
                if visible_now < par and not self._par_low_active[zone_idx]:
                    pl = {
                        "event_type":    "par_low",
                        "zone_idx":      zone_idx,
                        "current_count": visible_now,
                        "par_level":     par,
                        "t_sec":         round(t_sec, 3),
                        "reason":        f"Shelf count ({visible_now}) fell below par ({par})",
                    }
                    events.append(pl)
                    self._par_low_events.append(pl)
                    self._par_low_active[zone_idx] = True
                elif visible_now >= par:
                    self._par_low_active[zone_idx] = False   # restocked

        # Opening inventory snapshot after warm-up
        if self._opening_uids is None and frame_idx >= self._opening_frame_idx:
            self._opening_uids = {
                trk.uid
                for zone_tracks in self._zone_tracks
                for trk in zone_tracks
                if trk.currently_visible
            }

        # Global stats
        self._frame_count += 1
        self._count_sum   += total_visible
        self._current_count = total_visible
        if total_visible > self._peak_count:
            self._peak_count = total_visible

        # Timeline sample
        if t_sec - self._last_sample_t >= _SAMPLE_INTERVAL_SEC:
            self._timeline.append({"t_sec": round(t_sec, 3), "count": total_visible})
            self._last_sample_t = t_sec

        return events

    def summary(self) -> Dict[str, Any]:
        """
        Return a full bottle analytics summary.

        Keys
        ────
        total_bottles_seen   int   unique bottle appearances
        current_count        int   visible in most recent frame
        peak_count           int   max simultaneously visible (correctly counted)
        avg_count            float average per frame
        by_class             dict  {bottle, wine_glass, cup}
        pours_detected       int   completed pour events
        total_poured_oz      float sum of estimated oz across all pours
        avg_pour_oz          float average pour size
        over_pours           int   pours exceeding standard × over-pour factor
        walk_out_alerts      int   bottles that vanished without a pour
        unknown_bottle_alerts int  bottles that appeared mid-shift
        par_low_events       int   times shelf dropped below par
        pour_events          list  [{bottle_uid, t_sec, duration_sec, estimated_oz, is_over_pour, ...}]
        timeline             list  [{t_sec, count}] sampled every 5 s
        """
        avg = self._count_sum / max(self._frame_count, 1)
        pours        = self._all_pour_events
        total_oz     = sum(p["estimated_oz"] for p in pours)
        over_pours   = sum(1 for p in pours if p["is_over_pour"])
        avg_pour_oz  = total_oz / len(pours) if pours else 0.0

        return {
            "total_bottles_seen":      self._total_appearances,
            "current_count":           self._current_count,
            "peak_count":              self._peak_count,
            "avg_count":               round(avg, 3),
            "by_class":                dict(self._by_class),
            "pours_detected":          len(pours),
            "total_poured_oz":         round(total_oz, 2),
            "avg_pour_oz":             round(avg_pour_oz, 2),
            "over_pours":              over_pours,
            "walk_out_alerts":         len(self._walk_out_events),
            "unknown_bottle_alerts":   len(self._unknown_alerts),
            "par_low_events":          len(self._par_low_events),
            "pour_events":             list(pours),
            "walk_out_details":        list(self._walk_out_events),
            "unknown_bottle_details":  list(self._unknown_alerts),
            "timeline":                list(self._timeline),
            "standard_pour_oz":        self._standard_pour_oz,
        }
