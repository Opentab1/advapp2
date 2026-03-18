"""
VenueScope — Per-bartender drink counter v4.
Fixes:
  - Re-ID by station zone when track ID changes (bartender steps out/back)
  - Grace period: holds track state N frames after disappearance
  - Works correctly with side-angle cameras
  - Cooldown calibrated to stride, not raw frames
  - Unassigned track fallback: promote track if only one person in zone
"""
from __future__ import annotations
from collections import defaultdict
from typing import List, Dict, Any, Optional, Tuple
import numpy as np

from core.bar_config import BarConfig, station_polygon_px, bar_line_px
from core.shift      import ShiftManager
from core.config     import DrinkCountRules


def _point_in_polygon(px: float, py: float, poly: List[Tuple]) -> bool:
    n = len(poly); inside = False; j = n - 1
    for i in range(n):
        xi,yi=poly[i]; xj,yj=poly[j]
        if ((yi>py)!=(yj>py)) and (px<(xj-xi)*(py-yi)/(yj-yi+1e-9)+xi):
            inside=not inside
        j=i
    return inside


def _side_of_line(p: Tuple[float,float],
                   lp1: Tuple[int,int], lp2: Tuple[int,int]) -> int:
    dx=lp2[0]-lp1[0]; dy=lp2[1]-lp1[1]
    cross=dx*(p[1]-lp1[1])-dy*(p[0]-lp1[0])
    return 1 if cross>0 else (-1 if cross<0 else 0)


def _reach_probe(x1: float, y1: float, x2: float, y2: float,
                 p1, p2, customer_side: int) -> Tuple[float, float]:
    """Return the bounding-box corner most advanced toward the customer side.

    Catches arm-reach serves where only the bartender's arm/torso crosses the
    bar line but the body centroid stays on the bartender side.
    """
    dx = p2[0] - p1[0]; dy = p2[1] - p1[1]
    corners = ((x1, y1), (x2, y1), (x1, y2), (x2, y2))
    best_pt = corners[0]; best_val = float('-inf')
    for (px, py) in corners:
        val = customer_side * (dx * (py - p1[1]) - dy * (px - p1[0]))
        if val > best_val:
            best_val = val; best_pt = (px, py)
    return best_pt


class _TrackState:
    __slots__=("prep_frames","serve_side_buffer","cooldown_remaining",
               "last_confirmed_side","missing_frames","station_id_cache",
               "customer_dwell_frames","crossing_confs","centroid_history")
    def __init__(self):
        self.prep_frames           = 0
        self.serve_side_buffer:    List[int] = []
        self.cooldown_remaining    = 0
        self.last_confirmed_side   = 0
        self.missing_frames        = 0   # frames since last seen
        self.station_id_cache:     Optional[str] = None
        self.customer_dwell_frames = 0   # consecutive frames on customer side
        self.crossing_confs:       List[float] = []  # detection confs during crossing
        self.centroid_history: List[tuple] = []   # (cx, cy) per frame for velocity


class DrinkCounter:
    def __init__(self, bar_config: Optional[BarConfig],
                 shift: ShiftManager, rules: DrinkCountRules,
                 W: int, H: int):
        self.cfg   = bar_config
        self.shift = shift
        self.rules = rules
        self.W=W; self.H=H

        self._station_polys: Dict[str,List] = {}
        self._bar_lines:     Dict[str,Tuple] = {}

        if bar_config:
            for st in bar_config.stations:
                self._station_polys[st.zone_id] = station_polygon_px(st,W,H)
                p1,p2 = bar_line_px(st,W,H)
                self._bar_lines[st.zone_id] = (p1,p2,st.customer_side)

        self._states: Dict[int,_TrackState] = defaultdict(_TrackState)
        # Station-level cooldown — survives track ID switches
        self._station_cooldown: Dict[str, int] = {}

        self.events: List[Dict] = []
        self._total_frames      = 0
        self._unassigned_serves = 0
        self._high_conf_serves  = 0
        self._low_conf_serves   = 0
        self._review_count:              int            = 0
        self._review_events:             List[Dict]     = []
        self._station_last_serve_tsec:   Dict[str,float] = {}  # A4: time-based hard floor

        # Seed states for all pre-assigned tracks so grace period fires
        # even if the track is never seen (e.g. wrong ID was assigned)
        for rec in shift.records.values():
            if rec.track_id is not None:
                _ = self._states[rec.track_id]  # trigger defaultdict creation

    def _resolve_station(self, cx: float, cy: float,
                          tid: int) -> Optional[str]:
        """
        Find which BAR CONFIG zone_id this centroid belongs to.
        Returns a zone_id that exists in _station_polys / _bar_lines.
        Priority: 1) zone containment (even if track is assigned), 2) cached zone_id,
                  3) only-zone fallback, 4) None
        Note: We resolve to zone_id (bar config), NOT station_id (shift config),
        because these may differ (station_id='test', zone_id='well_a' etc).
        """
        # 1. Zone containment — works regardless of shift assignment
        for sid, poly in self._station_polys.items():
            if _point_in_polygon(cx, cy, poly):
                self._states[tid].station_id_cache = sid
                return sid

        # 2. Cached zone_id from a previous frame
        cached = self._states[tid].station_id_cache
        if cached and cached in self._bar_lines:
            return cached

        # 3. Single-zone fallback: if only one zone defined and track is assigned,
        #    assume this track belongs to that zone (bartender briefly out of zone bounds)
        bartender = self.shift.track_to_bartender(tid)
        if bartender and len(self._station_polys) == 1:
            sid = next(iter(self._station_polys))
            self._states[tid].station_id_cache = sid
            return sid

        return None

    def _try_reid_by_zone(self, cx: float, cy: float, tid: int,
                           active_set: set) -> bool:
        """
        If this track is unassigned but is the only person in a station zone
        (among all currently-visible tracks), auto-promote it to that
        station's bartender.
        Returns True if promoted.
        """
        if self.shift.track_to_bartender(tid):
            return False  # already assigned

        for sid, poly in self._station_polys.items():
            if not _point_in_polygon(cx, cy, poly):
                continue
            # Only block re-ID if another ASSIGNED bartender is already covering this zone
            # (unassigned tracks / customers briefly in zone should not prevent re-promotion)
            others_in_zone = [
                t for t in active_set
                if t != tid
                and self._states[t].station_id_cache == sid
                and self.shift.track_to_bartender(t) is not None
            ]
            if others_in_zone:
                continue  # another assigned bartender already here — don't reassign
            # Promote: find unassigned bartender for this station (by station_id match first)
            for name, rec in self.shift.records.items():
                if rec.station_id == sid and rec.track_id is None:
                    self.shift.assign(name, tid)
                    return True
            # Fallback: if only one unassigned bartender total, assign them
            # (handles station_id mismatch between shift config and bar config zone_id)
            unassigned = [(n, r) for n, r in self.shift.records.items()
                          if r.track_id is None]
            if len(unassigned) == 1:
                self.shift.assign(unassigned[0][0], tid)
                return True
        return False

    def update(self, frame_idx: int, t_sec: float,
               centroids: np.ndarray, track_ids: List[int],
               confs: List[float],
               boxes: Optional[np.ndarray] = None) -> List[Dict]:
        if not self._bar_lines:
            return []

        self._total_frames += 1
        events     = []
        conf_map   = {tid:confs[i] if i<len(confs) else 0.0
                      for i,tid in enumerate(track_ids)}
        active_set = set(track_ids)

        # Decrement station-level cooldowns
        for sid in list(self._station_cooldown.keys()):
            if self._station_cooldown[sid] > 0:
                self._station_cooldown[sid] -= 1

        # Age out missing tracks (decrement grace counter)
        for tid, state in list(self._states.items()):
            if tid not in active_set:
                state.missing_frames += 1
                if state.missing_frames > self.rules.reappear_grace_frames:
                    # Fully gone — unassign so zone re-ID can fire on next appearance
                    bar = self.shift.track_to_bartender(tid)
                    if bar:
                        bar.unassign()
                    del self._states[tid]
            else:
                state.missing_frames = 0

        for i, tid in enumerate(track_ids):
            if i >= len(centroids): continue
            cx,cy = float(centroids[i][0]), float(centroids[i][1])
            state  = self._states[tid]

            # A1: maintain centroid history for velocity check
            _vel_n = self.rules.velocity_window_frames
            state.centroid_history.append((cx, cy))
            if len(state.centroid_history) > _vel_n + 5:
                state.centroid_history = state.centroid_history[-(_vel_n + 5):]

            # Try auto re-ID if unassigned
            self._try_reid_by_zone(cx, cy, tid, active_set)

            station_id = self._resolve_station(cx, cy, tid)
            if station_id is None:
                continue

            # Station-level cooldown (survives track ID switches)
            if self._station_cooldown.get(station_id, 0) > 0:
                continue
            if state.cooldown_remaining > 0:
                state.cooldown_remaining -= 1
                continue

            # PREP: centroid must be in station zone
            if station_id in self._station_polys:
                if _point_in_polygon(cx,cy,self._station_polys[station_id]):
                    state.prep_frames += 1
                else:
                    state.prep_frames = max(0, state.prep_frames-1)

            if state.prep_frames < self.rules.min_prep_frames:
                continue

            if station_id not in self._bar_lines:
                continue

            # SERVE GESTURE: use leading box edge to catch arm-reach serves
            p1,p2,customer_side = self._bar_lines[station_id]
            if boxes is not None and i < len(boxes):
                bx = boxes[i]
                probe = _reach_probe(float(bx[0]), float(bx[1]),
                                     float(bx[2]), float(bx[3]),
                                     p1, p2, customer_side)
            else:
                probe = (cx, cy)
            side = _side_of_line(probe, p1, p2)
            state.serve_side_buffer.append(side)

            N = self.rules.serve_confirm_frames
            if len(state.serve_side_buffer) > N+10:
                state.serve_side_buffer = state.serve_side_buffer[-(N+10):]

            # Track dwell on customer side + accumulate confs during crossing
            if side == customer_side:
                state.customer_dwell_frames += 1
                state.crossing_confs.append(conf_map.get(tid, 0.0))
            else:
                state.customer_dwell_frames = 0
                state.crossing_confs = []

            buf = state.serve_side_buffer
            if len(buf) < N: continue

            nz = [s for s in buf[-N:] if s!=0]
            if not nz: continue
            dominant = 1 if nz.count(1)>=nz.count(-1) else -1

            # Must be on customer side AND different from last confirmed
            if dominant != customer_side: continue
            if state.last_confirmed_side == customer_side: continue

            # BILATERAL CROSSING: must have dwelled on customer side long enough
            # (filters out fast sweeping gestures — reaching for glass, handing change)
            if state.customer_dwell_frames < self.rules.serve_dwell_frames:
                continue

            # A1: velocity filter — reject fast sweeps (reaching, cleaning, handing change)
            _vel_n = self.rules.velocity_window_frames
            if len(state.centroid_history) >= _vel_n:
                _dx = cx - state.centroid_history[-_vel_n][0]
                _dy = cy - state.centroid_history[-_vel_n][1]
                _vel = (_dx*_dx + _dy*_dy) ** 0.5 / _vel_n
                if _vel >= self.rules.max_cross_velocity_px:
                    continue  # too fast — not a serve gesture

            # A4: time-based hard floor — guards against variable-rate video fps drift
            if t_sec - self._station_last_serve_tsec.get(station_id, -9999.0) < self.rules.serve_cooldown_seconds:
                continue

            # PER-EVENT CONFIDENCE: score based on dwell duration + detection quality
            avg_cross_conf = (sum(state.crossing_confs) / len(state.crossing_confs)
                              if state.crossing_confs else conf_map.get(tid, 0.0))
            dwell_score    = min(state.customer_dwell_frames / 15.0, 1.0)  # saturates at 15 frames
            serve_score    = round(0.6 * avg_cross_conf + 0.4 * dwell_score, 3)
            is_high_conf   = avg_cross_conf >= self.rules.min_serve_conf

            # CONFIRMED SERVE ─────────────────────────────────────────────
            state.last_confirmed_side  = customer_side
            state.cooldown_remaining   = self.rules.serve_cooldown_frames
            self._station_cooldown[station_id] = self.rules.serve_cooldown_frames
            self._station_last_serve_tsec[station_id] = t_sec   # A4
            state.prep_frames          = max(0, state.prep_frames-3)
            state.serve_side_buffer    = []
            state.customer_dwell_frames = 0
            state.crossing_confs       = []

            # A5: route low-score events to review bucket
            _is_review = serve_score < self.rules.min_serve_score
            if _is_review:
                self._review_count += 1
            elif is_high_conf:
                self._high_conf_serves += 1
            else:
                self._low_conf_serves += 1

            name = self.shift.record_drink(tid, t_sec) if not _is_review else None
            if name is None and not _is_review:
                # Fallback: assign drink to bartender at this station
                rec = self.shift.get_by_station(station_id)
                if rec is None and len(self.shift.records) == 1:
                    # Single-bartender scenario: assign to whoever is there
                    rec = next(iter(self.shift.records.values()))
                if rec is not None:
                    rec.record_drink(t_sec)
                    name = rec.name
                else:
                    self._unassigned_serves += 1
                    name = f"UNASSIGNED_track_{tid}"

            ev = {
                "event_type":   "drink_serve",
                "bartender":    name,
                "station_id":   station_id,
                "track_id":     tid,
                "t_sec":        round(t_sec, 3),
                "confidence":   round(conf_map.get(tid, 0.0), 4),
                "serve_score":  serve_score,
                "high_conf":    is_high_conf,
                "dwell_frames": state.customer_dwell_frames + self.rules.serve_dwell_frames,
                "frame_idx":    frame_idx,
                "review":       _is_review,
                "review_reason": f"low_serve_score_{serve_score:.3f}" if _is_review else "",
            }
            if _is_review:
                self._review_events.append(ev)
                events.append(ev)   # still return for clip/snapshot capture
            else:
                self.events.append(ev)
                events.append(ev)

        # Reset confirmed side when bartender returns to their own side
        for i,tid in enumerate(track_ids):
            if i>=len(centroids): continue
            cx,cy=float(centroids[i][0]),float(centroids[i][1])
            sid=self._resolve_station(cx,cy,tid)
            if sid and sid in self._bar_lines:
                p1,p2,customer_side=self._bar_lines[sid]
                side=_side_of_line((cx,cy),p1,p2)
                if side==-customer_side:
                    self._states[tid].last_confirmed_side=-customer_side

        return events

    def merge_track(self, old_id: int, new_id: int) -> None:
        """
        A2: IoU re-ID — new_id just appeared overlapping old_id's last position.
        Copy old_id's track state into new_id so prep/cooldown/side context is preserved.
        Also transfer any shift assignment.
        """
        if old_id not in self._states:
            return
        old_state = self._states[old_id]
        new_state = self._states[new_id]
        # Copy all relevant state
        new_state.prep_frames           = old_state.prep_frames
        new_state.cooldown_remaining    = old_state.cooldown_remaining
        new_state.last_confirmed_side   = old_state.last_confirmed_side
        new_state.station_id_cache      = old_state.station_id_cache
        new_state.customer_dwell_frames = old_state.customer_dwell_frames
        new_state.crossing_confs        = list(old_state.crossing_confs)
        new_state.centroid_history      = list(old_state.centroid_history)
        new_state.serve_side_buffer     = list(old_state.serve_side_buffer)
        # Transfer shift assignment
        bartender_name = self.shift.track_to_bartender(old_id)
        if bartender_name:
            rec = self.shift.records.get(bartender_name.name
                                         if hasattr(bartender_name, 'name') else str(bartender_name))
            if rec and rec.track_id == old_id:
                rec.track_id = new_id
        del self._states[old_id]

    def quality_report(self) -> Dict[str,Any]:
        warnings=[]
        total=sum(r.total_drinks for r in self.shift.records.values())
        if self._unassigned_serves>0:
            warnings.append(
                f"UNASSIGNED_SERVES: {self._unassigned_serves} serve gestures from "
                f"untracked bartenders. Check Track ID assignments.")
        if total==0 and self._total_frames>150:
            warnings.append(
                "NO_SERVES_DETECTED: Zero drinks counted after processing. "
                "Check: (1) bar-front line placement, (2) station zone covers bartender, "
                "(3) track ID assigned correctly, (4) try 'accurate' model profile.")
        if total>0 and self._unassigned_serves/max(total,1)>0.3:
            warnings.append(
                f"HIGH_UNASSIGNED_RATE: {self._unassigned_serves}/{total+self._unassigned_serves} "
                f"drinks unassigned. Re-assign track IDs — bartender may have changed ID mid-shift.")
        total_detected = self._high_conf_serves + self._low_conf_serves
        if self._low_conf_serves > 0 and total_detected > 0:
            low_pct = self._low_conf_serves / total_detected * 100
            warnings.append(
                f"LOW_CONF_SERVES: {self._low_conf_serves} of {total_detected} detected serves "
                f"({low_pct:.0f}%) had low crossing confidence — review verification clips.")
        if self._review_count > 0:
            warnings.append(
                f"REVIEW_BUCKET: {self._review_count} serve gesture(s) had serve_score "
                f"< {self.rules.min_serve_score:.2f} and were NOT counted — "
                f"check verification clips to confirm or dismiss.")
        return {
            "total_serves_detected": total,
            "high_conf_serves":      self._high_conf_serves,
            "low_conf_serves":       self._low_conf_serves,
            "unassigned_serves":     self._unassigned_serves,
            "frames_processed":      self._total_frames,
            "review_count":          self._review_count,
            "warnings":              warnings,
        }
