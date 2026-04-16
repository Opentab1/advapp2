"""
VenueScope — Glass/cup bar-line crossing detector.

Tracks COCO cup (41) and wine_glass (40) objects crossing the bar line.
A physical cup crossing from the bartender side to the customer side is
near-100% accurate as a drink-serve signal — the object was literally
handed to a customer.

Body-crossing detection (DrinkCounter) fires on every arm lean, cleaning,
or conversation lean. Glass-crossing fires ONLY when the container moves.
When glass_crossing fires for a station, the body-crossing event for the
same station within the cooldown window is suppressed by the engine.

Drink type classification:
  glass_crossing matched to a pour_end (bottle) → spirit/wine/beer/shot
  glass_crossing with no bottle match           → "water" (no bottle used)

"water" events are kept in the total-drinks count (the bartender still
served something) but are excluded from the POS theft-detection comparison,
since waters are typically not rung up.
"""
from __future__ import annotations
from typing import List, Dict, Any, Optional, Tuple
import numpy as np

import logging as _logging
import sys as _sys
_log = _logging.getLogger("glass_crossing")
if not _log.handlers:
    _h = _logging.StreamHandler(_sys.stdout)
    _h.setFormatter(_logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    _log.addHandler(_h)
    _log.setLevel(_logging.INFO)
    _log.propagate = False

from core.bar_config import BarConfig, station_polygon_px, bar_line_px

_GLASS_CLASSES   = {39, 40, 41}          # bottle/can, wine_glass, cup
_CLASS_NAMES     = {39: "can", 40: "wine_glass", 41: "cup"}
_IOU_MATCH       = 0.10                  # lower than bottle — cups move across bar
_MIN_PREP_FRAMES = 1                     # frames on bartender side before crossing counts
_MIN_DWELL_FRAMES = 2                    # consecutive frames on customer side to confirm
_COOLDOWN_SEC    = 4.0                   # min seconds between serves per station
_MAX_MISSED      = 20                    # frames before track is dropped (~0.67s @ 30fps)
_UID_COUNTER     = 0


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    ax1,ay1,ax2,ay2 = float(a[0]),float(a[1]),float(a[2]),float(a[3])
    bx1,by1,bx2,by2 = float(b[0]),float(b[1]),float(b[2]),float(b[3])
    ix1=max(ax1,bx1); iy1=max(ay1,by1); ix2=min(ax2,bx2); iy2=min(ay2,by2)
    iw=max(0.0,ix2-ix1); ih=max(0.0,iy2-iy1); inter=iw*ih
    if inter==0.0: return 0.0
    union=(max(0.0,ax2-ax1)*max(0.0,ay2-ay1)+max(0.0,bx2-bx1)*max(0.0,by2-by1)-inter)
    return inter/union if union>0.0 else 0.0


def _side_of_line(p: Tuple[float,float], p1: Tuple, p2: Tuple) -> int:
    dx=p2[0]-p1[0]; dy=p2[1]-p1[1]
    cross=dx*(p[1]-p1[1])-dy*(p[0]-p1[0])
    return 1 if cross>0 else (-1 if cross<0 else 0)


class _GlassTrack:
    __slots__ = ("uid","box","class_id","last_seen_t","missed",
                 "prep_frames","last_side","customer_dwell","station_id")

    def __init__(self, box: np.ndarray, class_id: int, t_sec: float):
        global _UID_COUNTER
        _UID_COUNTER += 1
        self.uid            = _UID_COUNTER
        self.box            = box.copy()
        self.class_id       = class_id
        self.last_seen_t    = t_sec
        self.missed         = 0
        self.prep_frames    = 0    # frames observed on bartender side
        self.last_side      = 0   # 0=unseen, +1/-1 relative to customer_side
        self.customer_dwell = 0   # consecutive frames on customer side
        self.station_id: Optional[str] = None


class GlassCrossingDetector:
    """
    Detects when a cup or wine_glass physically crosses the bar line
    from bartender side to customer side.

    Parameters
    ----------
    bar_config : BarConfig
    W, H : int  — frame pixel dimensions
    """

    def __init__(self, bar_config: Optional[BarConfig], W: int, H: int):
        self.W = W; self.H = H
        self._bar_lines:  Dict[str, Tuple] = {}   # zone_id → (p1, p2, customer_side)
        self._tracks:     List[_GlassTrack] = []
        self._last_serve: Dict[str, float]  = {}  # zone_id → last serve t_sec
        self.events:      List[Dict]        = []

        if bar_config:
            for st in bar_config.stations:
                p1, p2 = bar_line_px(st, W, H)
                self._bar_lines[st.zone_id] = (p1, p2, st.customer_side)

    def update(
        self,
        frame_idx: int,
        t_sec: float,
        boxes_px: np.ndarray,       # (N,4) pixel coords
        class_ids: List[int],
        confs: List[float],
    ) -> List[Dict[str, Any]]:
        """Process one frame. Returns list of glass_serve events."""
        if not self._bar_lines:
            return []

        events: List[Dict] = []

        # Filter to glass classes
        glass_idx = [
            i for i in range(min(len(boxes_px), len(class_ids)))
            if class_ids[i] in _GLASS_CLASSES
        ]
        if glass_idx:
            _log.info("[glass] t=%.1f detected %d glass object(s): %s",
                      t_sec, len(glass_idx),
                      [_CLASS_NAMES.get(class_ids[i], "?") for i in glass_idx])

        # IoU match detections to existing tracks
        matched_tracks: set = set()
        matched_dets:   set = set()

        for di in glass_idx:
            best_iou = _IOU_MATCH
            best_trk: Optional[_GlassTrack] = None
            for trk in self._tracks:
                if id(trk) in matched_tracks:
                    continue
                score = _iou(boxes_px[di], trk.box)
                if score > best_iou:
                    best_iou = score; best_trk = trk
            if best_trk is not None:
                best_trk.box         = boxes_px[di].copy()
                best_trk.last_seen_t = t_sec
                best_trk.missed      = 0
                matched_tracks.add(id(best_trk))
                matched_dets.add(di)
            else:
                trk = _GlassTrack(boxes_px[di], class_ids[di], t_sec)
                self._tracks.append(trk)
                matched_tracks.add(id(trk))
                matched_dets.add(di)

        # Age unmatched tracks
        surviving: List[_GlassTrack] = []
        for trk in self._tracks:
            if id(trk) not in matched_tracks:
                trk.missed += 1
            if trk.missed < _MAX_MISSED:
                surviving.append(trk)
        self._tracks = surviving

        # Evaluate each matched track for bar-line crossing
        for trk in self._tracks:
            if trk.missed > 0:
                continue  # not visible this frame

            cx = (trk.box[0] + trk.box[2]) / 2.0
            cy = (trk.box[1] + trk.box[3]) / 2.0

            # Find which station bar line this glass is near
            best_zone: Optional[str] = None
            for zone_id, (p1, p2, customer_side) in self._bar_lines.items():
                # Check if glass centroid is within a reasonable horizontal band of the bar line
                # (within 25% of frame height on either side of the bar line y-coordinate)
                bar_y = (p1[1] + p2[1]) / 2.0
                if abs(cy - bar_y) < self.H * 0.30:
                    best_zone = zone_id
                    break
            if best_zone is None:
                best_zone = next(iter(self._bar_lines))  # single-zone fallback

            p1, p2, customer_side = self._bar_lines[best_zone]
            trk.station_id = best_zone
            side = _side_of_line((cx, cy), p1, p2)

            # Accumulate prep (bartender side) or dwell (customer side).
            # side==0 (exactly on the line) counts as prep — cups placed on the
            # bar counter for gun-fill often sit right at the bar line and should
            # still count as "starting on the bartender side" for detection purposes.
            if side == -customer_side:
                trk.prep_frames    = min(trk.prep_frames + 1, 30)
                trk.customer_dwell = 0
                trk.last_side      = -customer_side
            elif side == 0:
                # At the bar line: treat as prep if not yet seen on either side,
                # or continue current prep to avoid resetting state for cups resting on counter.
                trk.prep_frames    = min(trk.prep_frames + 1, 30)
                trk.customer_dwell = 0
                if trk.last_side == 0:
                    trk.last_side = -customer_side  # assume staff side for cups first seen at line
            elif side == customer_side:
                trk.customer_dwell += 1

            # Crossing confirmed: was on bartender side (prep), now dwelled on customer side
            if (trk.prep_frames >= _MIN_PREP_FRAMES
                    and trk.customer_dwell >= _MIN_DWELL_FRAMES
                    and trk.last_side == -customer_side):

                # Station cooldown
                elapsed = t_sec - self._last_serve.get(best_zone, -999.0)
                if elapsed < _COOLDOWN_SEC:
                    continue

                # CONFIRMED — glass physically crossed the bar
                _log.info("[glass_serve] t=%.1f uid=%d class=%s station=%s prep=%d dwell=%d",
                          t_sec, trk.uid, _CLASS_NAMES.get(trk.class_id,"?"),
                          best_zone, trk.prep_frames, trk.customer_dwell)
                self._last_serve[best_zone] = t_sec
                trk.last_side      = customer_side  # reset gate
                trk.prep_frames    = 0
                trk.customer_dwell = 0

                class_name = _CLASS_NAMES.get(trk.class_id, "cup")
                ev = {
                    "event_type":       "drink_serve",
                    "detection_method": "glass_crossing",
                    "drink_type":       "water",   # default; correlator may upgrade
                    "bartender":        None,       # no track_id — object-based
                    "station_id":       best_zone,
                    "track_id":         None,
                    "t_sec":            round(t_sec, 3),
                    "confidence":       round(confs[glass_idx[0]] if glass_idx else 0.5, 4),
                    "serve_score":      0.90,       # high — physical object crossed
                    "high_conf":        True,
                    "dwell_frames":     trk.customer_dwell + _MIN_DWELL_FRAMES,
                    "frame_idx":        frame_idx,
                    "review":           False,
                    "review_reason":    "",
                    "glass_class":      class_name,
                    "glass_uid":        trk.uid,
                }
                self.events.append(ev)
                events.append(ev)

        return events

    def last_serve_times(self) -> Dict[str, float]:
        """Expose station last-serve times so DrinkCounter can sync its cooldown."""
        return dict(self._last_serve)

    def quality_report(self) -> Dict[str, Any]:
        total = len(self.events)
        water = sum(1 for e in self.events if e.get("drink_type") == "water")
        return {
            "glass_crossings_total":   total,
            "glass_crossings_water":   water,
            "glass_crossings_alcohol": total - water,
        }
