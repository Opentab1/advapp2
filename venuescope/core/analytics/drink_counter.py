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
import logging
import numpy as np

from core.bar_config import BarConfig, station_polygon_px, bar_line_px
from core.shift      import ShiftManager
from core.config     import DrinkCountRules

_log = logging.getLogger("drink_counter")


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
    """Return the bounding-box point most advanced toward the customer side.

    Catches arm-reach serves where only the bartender's arm/torso crosses the
    bar line but the body centroid stays on the bartender side.

    Checks 20 points: 4 corners + midpoints + quarter-points on each edge so
    leaning-arm serves are caught even for partial arm extensions that don't
    reach a corner or midpoint.
    """
    dx = p2[0] - p1[0]; dy = p2[1] - p1[1]
    mx = (x1 + x2) / 2; my = (y1 + y2) / 2
    qx1 = x1 + (x2 - x1) * 0.25; qx3 = x1 + (x2 - x1) * 0.75
    qy1 = y1 + (y2 - y1) * 0.25; qy3 = y1 + (y2 - y1) * 0.75
    candidates = (
        (x1, y1), (x2, y1), (x1, y2), (x2, y2),   # corners
        (mx, y1), (mx, y2), (x1, my), (x2, my),     # edge midpoints
        (qx1, y1), (qx3, y1), (qx1, y2), (qx3, y2), # top/bottom quarters
        (x1, qy1), (x1, qy3), (x2, qy1), (x2, qy3), # left/right quarters
        (qx1, my), (qx3, my),                         # middle horizontal band
        (mx, qy1), (mx, qy3),                         # middle vertical band
    )
    best_pt = candidates[0]; best_val = float('-inf')
    for (px, py) in candidates:
        val = customer_side * (dx * (py - p1[1]) - dy * (px - p1[0]))
        if val > best_val:
            best_val = val; best_pt = (px, py)
    return best_pt


def _lean_bonus(box_w: float, box_h: float,
                prev_w_history: List[float]) -> bool:
    """Return True if the bounding box has widened significantly vs. recent
    history — indicates the person is leaning forward over the bar.
    A leaning pose reduces effective arm-reach distance so we grant a
    1-frame dwell bonus (caller can reduce serve_dwell_frames by 1).
    """
    if len(prev_w_history) < 5:
        return False
    avg_prev_w = sum(prev_w_history[-5:]) / 5
    return avg_prev_w > 0 and (box_w / avg_prev_w) >= 1.20  # 20% wider = leaning


class _TrackState:
    __slots__=("prep_frames","serve_side_buffer","cooldown_remaining",
               "last_confirmed_side","missing_frames","station_id_cache",
               "customer_dwell_frames","crossing_confs","centroid_history",
               "box_width_history")
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
        self.box_width_history: List[float] = []  # bounding box widths for lean detection


class DrinkCounter:
    def __init__(self, bar_config: Optional[BarConfig],
                 shift: ShiftManager, rules: DrinkCountRules,
                 W: int, H: int):
        import time as _t
        self._wall_start = _t.time()   # wall clock at job start (for state snapshots)
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
            # Spatial guard: only auto-assign if the track is actually inside THIS zone
            # polygon, not just drifting through a zone boundary from the customer area.
            if not _point_in_polygon(cx, cy, poly):
                continue
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
        _just_served: set = set()  # tracks that confirmed a serve this frame

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

            # A1: maintain centroid + box-width history for velocity / lean detection
            _vel_n = self.rules.velocity_window_frames
            state.centroid_history.append((cx, cy))
            if len(state.centroid_history) > _vel_n + 5:
                state.centroid_history = state.centroid_history[-(_vel_n + 5):]
            if boxes is not None and i < len(boxes):
                bx = boxes[i]
                state.box_width_history.append(float(bx[2]) - float(bx[0]))
                if len(state.box_width_history) > 20:
                    state.box_width_history = state.box_width_history[-20:]

            # Try auto re-ID if unassigned
            self._try_reid_by_zone(cx, cy, tid, active_set)

            station_id = self._resolve_station(cx, cy, tid)
            if station_id is None:
                continue

            # Station-level cooldown (survives track ID switches)
            if self._station_cooldown.get(station_id, 0) > 0:
                _log.debug("[reject] t=%.1f tid=%s station=%s reason=station_cooldown remaining=%d",
                           t_sec, tid, station_id, self._station_cooldown[station_id])
                continue
            if state.cooldown_remaining > 0:
                state.cooldown_remaining -= 1
                _log.debug("[reject] t=%.1f tid=%s station=%s reason=track_cooldown remaining=%d",
                           t_sec, tid, station_id, state.cooldown_remaining)
                continue

            # PREP: centroid must be in station zone
            if station_id in self._station_polys:
                if _point_in_polygon(cx,cy,self._station_polys[station_id]):
                    state.prep_frames += 1
                else:
                    state.prep_frames = max(0, state.prep_frames-1)

            if state.prep_frames < self.rules.min_prep_frames:
                _log.debug("[reject] t=%.1f tid=%s station=%s reason=prep_frames have=%d need=%d",
                           t_sec, tid, station_id, state.prep_frames, self.rules.min_prep_frames)
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
            # Lean bonus: if person is leaning forward (box widened 20%+) reduce
            # dwell requirement by 1 frame — leaning pose confirms intentional reach.
            _dwell_req = self.rules.serve_dwell_frames
            if boxes is not None and i < len(boxes):
                bx = boxes[i]
                _bw = float(bx[2]) - float(bx[0])
                if _lean_bonus(_bw, float(bx[3]) - float(bx[1]), state.box_width_history):
                    _dwell_req = max(1, _dwell_req - 1)
            if state.customer_dwell_frames < _dwell_req:
                _log.info("[reject] t=%.1f tid=%s station=%s reason=dwell_frames have=%d need=%d",
                          t_sec, tid, station_id, state.customer_dwell_frames, self.rules.serve_dwell_frames)
                continue

            # A1: velocity filter — reject fast sweeps (reaching, cleaning, handing change)
            _vel_n = self.rules.velocity_window_frames
            if len(state.centroid_history) >= _vel_n:
                _dx = cx - state.centroid_history[-_vel_n][0]
                _dy = cy - state.centroid_history[-_vel_n][1]
                _vel = (_dx*_dx + _dy*_dy) ** 0.5 / _vel_n
                if _vel >= self.rules.max_cross_velocity_px:
                    _log.info("[reject] t=%.1f tid=%s station=%s reason=velocity_too_high vel=%.1fpx max=%.1fpx",
                              t_sec, tid, station_id, _vel, self.rules.max_cross_velocity_px)
                    continue  # too fast — not a serve gesture

            # A4: time-based hard floor — guards against variable-rate video fps drift
            _elapsed_since_last = t_sec - self._station_last_serve_tsec.get(station_id, -9999.0)
            if _elapsed_since_last < self.rules.serve_cooldown_seconds:
                _log.info("[reject] t=%.1f tid=%s station=%s reason=time_cooldown elapsed=%.1fs need=%.1fs",
                          t_sec, tid, station_id, _elapsed_since_last, self.rules.serve_cooldown_seconds)
                continue

            # PER-EVENT CONFIDENCE: score based on detection quality + dwell duration
            avg_cross_conf = (sum(state.crossing_confs) / len(state.crossing_confs)
                              if state.crossing_confs else conf_map.get(tid, 0.0))
            dwell_score    = min(state.customer_dwell_frames / 15.0, 1.0)
            # High-conf bypass: fast but confident serves (quick hand-off, slide across bar)
            # don't need long dwell — detection quality is the ground truth.
            if avg_cross_conf >= 0.85 and state.customer_dwell_frames >= 2:
                serve_score = round(0.85 + 0.1 * dwell_score, 3)  # 0.85–0.95
            else:
                # Weight detection confidence 70%, dwell 30% (previously 60/40)
                # Fast high-confidence pours were being penalised by the dwell term.
                serve_score = round(0.7 * avg_cross_conf + 0.3 * dwell_score, 3)
            is_high_conf   = avg_cross_conf >= self.rules.min_serve_conf

            # CONFIRMED SERVE ─────────────────────────────────────────────
            _log.info("[serve] t=%.1f tid=%s station=%s score=%.3f dwell=%d conf=%.2f",
                      t_sec, tid, station_id, serve_score,
                      state.customer_dwell_frames, avg_cross_conf)
            _just_served.add(tid)
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
                _log.info("[review] t=%.1f tid=%s station=%s score=%.3f < min=%.3f → review bucket",
                          t_sec, tid, station_id, serve_score, self.rules.min_serve_score)
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

        # Reset confirmed side when bartender returns to their own side.
        # IMPORTANT: skip any track that just confirmed a serve this frame —
        # _reach_probe uses bbox corners so the centroid may already be on the
        # bartender side (arm-only crossing), which would immediately re-arm the
        # gate and allow the same gesture to count twice on the next frame.
        for i,tid in enumerate(track_ids):
            if i>=len(centroids): continue
            if tid in _just_served: continue  # don't re-arm in the same frame
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

    # ── Cross-segment state persistence ──────────────────────────────────────

    def get_cross_segment_state(self) -> dict:
        """
        Return a JSON-serialisable snapshot for handoff to the next segment.
        Converts video-relative serve timestamps to wall-clock epochs so they
        survive across independently-scheduled jobs.
        Includes accumulated drink counts per station so restart/reconnect
        does not reset the displayed total in the UI.
        """
        import time
        # Accumulated drinks per station (for UI continuity across restarts)
        station_drinks: dict = {}
        station_timestamps: dict = {}
        for rec in self.shift.records.values():
            if rec.station_id:
                station_drinks[rec.station_id] = rec.total_drinks
                # Store last 200 timestamps as wall-clock epochs
                station_timestamps[rec.station_id] = [
                    round(self._wall_start + t, 3) for t in rec.drink_timestamps[-200:]
                ]
        return {
            "saved_wall":        time.time(),
            "saved_date":        __import__("datetime").date.today().isoformat(),
            "station_serve_walls": {
                sid: self._wall_start + tsec
                for sid, tsec in self._station_last_serve_tsec.items()
            },
            "station_drinks":      station_drinks,
            "station_timestamps":  station_timestamps,
        }

    def restore_cross_segment_state(self, state: dict) -> None:
        """
        Seed cooldown state from the previous segment's snapshot.
        Maps wall-clock serve times back to negative t_sec offsets so the
        time-based cooldown check works correctly even though this segment
        starts at t_sec = 0.
        Also restores accumulated drink counts so the UI total is continuous
        across stream reconnects and worker restarts.
        Only restores counts from today — never carries over yesterday's shift.
        """
        if not state:
            return
        import time, datetime
        now   = time.time()
        today = datetime.date.today().isoformat()

        # Cooldown state (always restore regardless of date — safe for resets)
        for sid, serve_wall in state.get("station_serve_walls", {}).items():
            elapsed = now - serve_wall
            self._station_last_serve_tsec[sid] = -elapsed

        # Drink count accumulation — only if saved today (same shift)
        if state.get("saved_date") != today:
            return
        station_drinks     = state.get("station_drinks", {})
        station_timestamps = state.get("station_timestamps", {})
        for rec in self.shift.records.values():
            sid = rec.station_id
            if not sid or sid not in station_drinks:
                continue
            prior_drinks = int(station_drinks[sid])
            if prior_drinks <= 0:
                continue
            # Seed prior counts — new detections will add on top of these
            rec.total_drinks += prior_drinks
            # Restore timestamps as negative t_sec offsets (before this segment)
            for wall_t in station_timestamps.get(sid, []):
                t_sec = wall_t - self._wall_start  # will be negative (in the past)
                rec.drink_timestamps.append(round(t_sec, 1))
                bucket = max(0, int(t_sec // 3600)) if t_sec >= 0 else 0
                rec.hourly_counts[bucket] = rec.hourly_counts.get(bucket, 0) + 1
            rec.drink_timestamps.sort()

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
        # High-confidence review events (score just below threshold but detection
        # confidence was good) are likely real serves that weren't rung — count
        # them as potential unrung drinks for theft flagging purposes.
        _high_conf_review = sum(
            1 for ev in self._review_events
            if ev.get("confidence", 0.0) >= self.rules.min_serve_conf
        )
        if self._review_count > 0:
            warnings.append(
                f"REVIEW_BUCKET: {self._review_count} serve gesture(s) had serve_score "
                f"< {self.rules.min_serve_score:.2f} and were NOT counted — "
                f"check verification clips to confirm or dismiss. "
                f"{_high_conf_review} had high detection confidence (potential unrung).")
        return {
            "total_serves_detected": total,
            "high_conf_serves":      self._high_conf_serves,
            "low_conf_serves":       self._low_conf_serves,
            "unassigned_serves":     self._unassigned_serves,
            "frames_processed":      self._total_frames,
            "review_count":          self._review_count,
            "potential_unrung":      _high_conf_review,  # for theft flag escalation
            "warnings":              warnings,
        }
