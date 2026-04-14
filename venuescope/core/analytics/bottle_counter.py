"""
VenueScope — Bottle/glass counter for bar inventory & theft detection.

Detection methods
─────────────────
1. Tilt-based  — YOLO h/w aspect ratio drops when bottle tilts to pour.
                 Fires when bottle is partially visible while being poured.

2. Departure-based — bottle track disappears (picked up, occluded by body)
                     then reappears in the same zone. Duration of absence
                     = pour duration. More reliable for overhead/fisheye
                     cameras where pouring occludes the bottle completely.

Both methods share the same pour_end event format so downstream code is
unaffected.  When tilt fires first (before the track is dropped), departure
detection skips the pour to avoid double-counting.

Walk-out detection
──────────────────
Previous code fired after 8 missed frames (~0.27 s). That's wrong — any
temporary occlusion triggers it. New threshold: _WALKOUT_FRAMES (10 s).
Departure-based pour absorbs the 2–7 s a real pour takes, leaving only
genuine walk-outs (bottle taken away permanently) in the alert queue.

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

# Aspect ratio (h/w) thresholds for tilt-based pour detection
_UPRIGHT_RATIO    = 1.8   # h/w above this → bottle is upright
_POUR_RATIO       = 1.2   # h/w below this → bottle is being tilted/poured
_POUR_TILT_WINDOW = 4     # rolling frames used to smooth ratio

# Pour yield constants (free-pour)
_FLOW_RATE_OZ_PER_SEC = 0.75   # ~0.75 oz/sec for a standard free pour
_STANDARD_POUR_OZ     = 1.25   # standard measure for spirits (1 jigger)
_OVER_POUR_FACTOR     = 1.4    # pours > factor × standard = over-pour flag

# Per-class standard pour sizes (oz) — prevents false over-pour alerts for wine/beer
_CLASS_STANDARD_OZ: dict = {
    39: 1.25,   # spirit bottle → 1 jigger
    40: 5.0,    # wine glass → standard 5oz pour
    41: 16.0,   # cup/pint → 16oz
}

_SAMPLE_INTERVAL_SEC = 5.0    # timeline resolution

_IOU_THRESHOLD    = 0.25   # IoU to match same bottle across frames

# --- Track lifetime ---
# A pour takes 2–7 s. Tilt detection fires while the bottle is partially
# visible; departure detection needs the track alive until the bottle is
# put back.  Keep tracks alive for 7 s (≈210 frames at 30 fps) before
# promoting a prolonged absence to a walk-out alert.
_MAX_MISSED_FRAMES  = 210  # frames before a track is eligible for walk-out
_WALKOUT_FRAMES     = 300  # frames of absence → confirmed walk-out (~10 s @ 30 fps)
_PICKUP_THRESHOLD   = 5    # frames of absence before treating as "picked up"
_MIN_POUR_FRAMES    = 3    # min tilt-frames to register as a tilt-based pour
_MIN_DEPARTURE_SEC  = 0.5  # min absence to count as departure pour (avoid glitches)
_MAX_DEPARTURE_SEC  = 30.0 # max absence to call it a pour (> this = probably walk-out)


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
        self.is_unknown: bool = is_unknown

        # Tilt-based pour tracking
        self._ratio_window: List[float] = [_aspect_ratio(box)]
        self.is_pouring: bool = False
        self._pour_start_t: Optional[float] = None
        self._pour_tilt_frames: int = 0
        self._tilt_pour_fired: bool = False  # True if a tilt-based pour already fired

        # Departure-based pour tracking
        # Set when the track goes missing for >= _PICKUP_THRESHOLD frames
        self._pickup_start_t: Optional[float] = None

        self.pour_events: List[Dict] = []

    def update(self, box: np.ndarray, t_sec: float) -> Optional[Dict]:
        """
        Update track with new detection.
        Checks for departure-based pour first (bottle returned after being picked up),
        then continues with tilt-based detection.
        Returns a pour_end event dict if a pour just completed, else None.
        """
        event: Optional[Dict] = None
        _std_oz = _CLASS_STANDARD_OZ.get(self.class_id, _STANDARD_POUR_OZ)

        # ── Departure-based pour ──────────────────────────────────────────────
        # If the bottle was picked up (went missing for a while) and has just
        # returned, compute pour duration from absence time.  Only fire if the
        # tilt detector did not already fire for this pickup event.
        if self._pickup_start_t is not None and not self._tilt_pour_fired:
            duration = max(0.0, t_sec - self._pickup_start_t)
            if _MIN_DEPARTURE_SEC <= duration <= _MAX_DEPARTURE_SEC:
                est_oz = round(duration * _FLOW_RATE_OZ_PER_SEC, 2)
                over   = est_oz > _std_oz * _OVER_POUR_FACTOR
                event = {
                    "event_type":        "pour_end",
                    "detection_method":  "departure",
                    "bottle_uid":        self.uid,
                    "class_name":        self.class_name,
                    "t_sec":             round(t_sec, 3),
                    "pour_start_t":      round(self._pickup_start_t, 3),
                    "duration_sec":      round(duration, 2),
                    "estimated_oz":      est_oz,
                    "standard_oz":       _std_oz,
                    "is_over_pour":      over,
                    "is_unknown_bottle": self.is_unknown,
                }
                self.pour_events.append(event)

        # Reset departure state on return
        self._pickup_start_t   = None
        self._tilt_pour_fired  = False

        # ── Tilt-based pour ───────────────────────────────────────────────────
        self.box           = box.copy()
        self.last_seen_t   = t_sec
        self.missed_frames = 0

        ratio = _aspect_ratio(box)
        self._ratio_window.append(ratio)
        if len(self._ratio_window) > _POUR_TILT_WINDOW:
            self._ratio_window.pop(0)
        smoothed = sum(self._ratio_window) / len(self._ratio_window)

        tilt_event: Optional[Dict] = None

        if not self.is_pouring:
            if smoothed < _POUR_RATIO:
                self._pour_tilt_frames += 1
                if self._pour_tilt_frames >= _MIN_POUR_FRAMES:
                    self.is_pouring      = True
                    self._pour_start_t   = t_sec - (_MIN_POUR_FRAMES / 30.0)
                    self._tilt_pour_fired = False
            else:
                self._pour_tilt_frames = 0
        else:
            if smoothed >= _UPRIGHT_RATIO:
                duration = max(0.1, t_sec - (self._pour_start_t or t_sec))
                est_oz   = round(duration * _FLOW_RATE_OZ_PER_SEC, 2)
                over     = est_oz > _std_oz * _OVER_POUR_FACTOR
                tilt_event = {
                    "event_type":        "pour_end",
                    "detection_method":  "tilt",
                    "bottle_uid":        self.uid,
                    "class_name":        self.class_name,
                    "t_sec":             round(t_sec, 3),
                    "pour_start_t":      round(self._pour_start_t or t_sec, 3),
                    "duration_sec":      round(duration, 2),
                    "estimated_oz":      est_oz,
                    "standard_oz":       _std_oz,
                    "is_over_pour":      over,
                    "is_unknown_bottle": self.is_unknown,
                }
                self.pour_events.append(tilt_event)
                self._tilt_pour_fired = True
                self.is_pouring       = False
                self._pour_start_t    = None
                self._pour_tilt_frames = 0

        # Return whichever event fired (departure takes priority to avoid double-count)
        return event or tilt_event

    def mark_missed(self):
        """Called each frame the bottle is not detected."""
        self.missed_frames += 1
        # Start departure timer: assume picked up after _PICKUP_THRESHOLD frames absent
        if self.missed_frames == _PICKUP_THRESHOLD and self._pickup_start_t is None:
            # Use last confirmed position time as pick-up start
            self._pickup_start_t = self.last_seen_t

    @property
    def currently_visible(self) -> bool:
        return self.missed_frames == 0

    def had_pour(self) -> bool:
        return len(self.pour_events) > 0


class BottleCounter:
    """
    Tracks bottles/glasses in defined bar zones with:
    - Tilt-based pour detection (visible tilt while pouring)
    - Departure-based pour detection (bottle picked up, put back)
    - Over-pour flagging with per-class standard measures
    - Unknown bottle detection (BYOB scam — bottle appeared mid-shift)
    - Walk-out detection (bottle gone > 10 s with no pour)
    - Live par-level monitoring

    Parameters
    ----------
    zone_polys_norm : list of list of (float, float)
        Shelf/bar zones in normalised [0,1] coords.
    W, H : int
        Frame pixel dimensions.
    par_levels : list of int, optional
        Expected minimum bottle count per zone.
    standard_pour_oz : float
        Standard measure in oz (default 1.25 oz = 1 jigger).
    flow_rate_oz_per_sec : float
        Free-pour flow rate for yield estimation (default 0.75 oz/sec).
    iou_threshold : float
        IoU to match the same bottle across consecutive frames.
    max_missed_frames : int
        Grace period (frames) before a track becomes walk-out eligible.
        Default 210 ≈ 7 s @ 30 fps — long enough for a full pour.
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
        self._iou_threshold    = iou_threshold
        self._max_missed       = max_missed_frames
        self._standard_pour_oz = standard_pour_oz
        self._flow_rate        = flow_rate_oz_per_sec

        self._zone_polys: List[List[Tuple[float, float]]] = [
            [(x * W, y * H) for x, y in poly]
            for poly in (zone_polys_norm or [[[0, 0], [1, 0], [1, 1], [0, 1]]])
        ]
        n_zones = len(self._zone_polys)
        self._par_levels: List[Optional[int]] = (
            list(par_levels) if par_levels else [None] * n_zones
        )
        while len(self._par_levels) < n_zones:
            self._par_levels.append(None)

        self._zone_tracks: List[List[_BottleTrack]] = [[] for _ in range(n_zones)]

        # Opening-inventory snapshot
        self._opening_uids: Optional[set] = None
        self._opening_frame_idx: int = 30

        self._all_pour_events: List[Dict]  = []
        self._walk_out_events: List[Dict]  = []
        self._unknown_alerts:  List[Dict]  = []
        self._par_low_events:  List[Dict]  = []
        self._total_appearances: int       = 0
        self._by_class: Dict[str, int]     = {"bottle": 0, "wine_glass": 0, "cup": 0}
        self._peak_count: int              = 0
        self._count_sum: int               = 0
        self._frame_count: int             = 0
        self._timeline: List[Dict]         = []
        self._last_sample_t: float         = -_SAMPLE_INTERVAL_SEC
        self._current_count: int           = 0
        self._par_low_active: List[bool]   = [False] * n_zones

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
        confs     = list(confs) if confs is not None else []
        while len(confs) < n_det:
            confs.append(0.0)

        drinkware_idx = [
            i for i in range(min(n_det, len(class_ids)))
            if class_ids[i] in _BOTTLE_CLASSES
        ]

        total_visible = 0

        for zone_idx, poly in enumerate(self._zone_polys):
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
                    is_unknown = self._opening_uids is not None
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

                    if is_unknown and cid == 39:
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

                    if trk.missed_frames < self._max_missed:
                        # Track still alive — keep it (bottle may be being poured)
                        surviving.append(trk)
                    elif trk.missed_frames == self._max_missed:
                        # Grace period exhausted — promote to walk-out if no pour confirmed
                        # and truly gone long enough (>= _WALKOUT_FRAMES).
                        surviving.append(trk)  # keep one more frame to fire walk-out
                    else:
                        # Drop track — fire walk-out if spirit bottle, no pour, absent >= walkout threshold
                        if (not trk.had_pour()
                                and trk.class_id == 39
                                and trk.missed_frames >= _WALKOUT_FRAMES):
                            wo = {
                                "event_type":   "walk_out_alert",
                                "bottle_uid":   trk.uid,
                                "class_name":   trk.class_name,
                                "zone_idx":     zone_idx,
                                "first_seen_t": round(trk.first_seen_t, 3),
                                "last_seen_t":  round(trk.last_seen_t, 3),
                                "absent_sec":   round(t_sec - trk.last_seen_t, 1),
                                "reason":       "Bottle absent for >10 s with no pour detected — possible walk-out",
                            }
                            events.append(wo)
                            self._walk_out_events.append(wo)
                        # Don't add to surviving — track is dropped

            self._zone_tracks[zone_idx] = surviving

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
                    self._par_low_active[zone_idx] = False

        # Opening inventory snapshot after warm-up
        if self._opening_uids is None and frame_idx >= self._opening_frame_idx:
            self._opening_uids = {
                trk.uid
                for zone_tracks in self._zone_tracks
                for trk in zone_tracks
                if trk.currently_visible
            }

        self._frame_count  += 1
        self._count_sum    += total_visible
        self._current_count = total_visible
        if total_visible > self._peak_count:
            self._peak_count = total_visible

        if t_sec - self._last_sample_t >= _SAMPLE_INTERVAL_SEC:
            self._timeline.append({"t_sec": round(t_sec, 3), "count": total_visible})
            self._last_sample_t = t_sec

        return events

    def summary(self) -> Dict[str, Any]:
        avg          = self._count_sum / max(self._frame_count, 1)
        pours        = self._all_pour_events
        total_oz     = sum(p["estimated_oz"] for p in pours)
        over_pours   = sum(1 for p in pours if p["is_over_pour"])
        avg_pour_oz  = total_oz / len(pours) if pours else 0.0

        tilt_pours      = sum(1 for p in pours if p.get("detection_method") == "tilt")
        departure_pours = sum(1 for p in pours if p.get("detection_method") == "departure")

        return {
            "total_bottles_seen":      self._total_appearances,
            "current_count":           self._current_count,
            "peak_count":              self._peak_count,
            "avg_count":               round(avg, 3),
            "by_class":                dict(self._by_class),
            "pours_detected":          len(pours),
            "tilt_pours":              tilt_pours,
            "departure_pours":         departure_pours,
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
