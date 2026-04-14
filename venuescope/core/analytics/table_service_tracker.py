"""
VenueScope — Table Service Tracker (table_service mode).

Server classification
─────────────────────
The fundamental problem with zone-only tracking is that seated customers
and walking servers both enter table polygons. This file adds a behavioral
classifier that uses three signals — without any camera re-training:

  1. Bar-zone dwell (>25 % of frames inside the bar polygon) → bartender
     Bartenders are excluded entirely from table-visit counting.

  2. Multi-table visits (≥ 2 distinct table zones in one session) → server
     No seated customer ever table-hops. This signal is near-100 % precise.

  3. Mobility score (avg displacement px/sec):
       > 20 px/s = active mover → likely server
       <  8 px/s = stationary  → likely seated customer

  Unclassified tracks (too short a history to decide) are counted only if
  their dwell at the table exceeds _MIN_VISIT_SEC_UNKNOWN (5 s) — much
  stricter than the 0.5 s used for confirmed servers, reducing false hits.

State machine per (track_id, table_id):
  OUTSIDE ──[enters zone]──> INSIDE
  INSIDE  ──[leaves zone]──> GRACE  (4-frame buffer before committing exit)
  GRACE   ──[re-enters]───> INSIDE  (glitch suppressed)
  GRACE   ──[grace expires]─> OUTSIDE + emit visit if dwell qualifies

Output events:
  server_visit    — {table_id, label, server_name, track_id, t_sec,
                     duration_sec, visit_number, is_pass_by, classification}
  unvisited_table — {table_id, label, t_sec, minutes_unvisited}
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Set, Tuple
from enum import Enum, auto


# ── Tunables ─────────────────────────────────────────────────────────────────

_MIN_VISIT_SEC_SERVER  = 0.5    # confirmed server: catches pass-by greetings
_MIN_VISIT_SEC_UNKNOWN = 5.0    # unclassified track: strict to avoid false hits
_MAX_VISIT_SEC         = 300.0  # > 5 min = likely seated customer, skip
_GRACE_FRAMES          = 4      # frames visitor can vanish without ending visit
_UNVISITED_ALERT_MIN   = 15.0   # flag table if no visit in this many minutes

# Server classifier thresholds
_BAR_PCT_BARTENDER          = 0.25   # > 25 % of frames in bar zone = bartender
_MULTI_TABLE_THRESHOLD      = 2      # ≥ N distinct table zones visited = server
_MOBILITY_SERVER_PX_SEC     = 20.0   # avg speed > this → active mover (server)
_MOBILITY_CUSTOMER_PX_SEC   = 8.0    # avg speed < this → stationary (customer)
_CUSTOMER_MIN_DWELL_SEC     = 60.0   # must have been tracked > this to call "customer"


# ── Geometry ─────────────────────────────────────────────────────────────────

def _point_in_polygon(px: float, py: float, poly: List[tuple]) -> bool:
    n = len(poly); inside = False; j = n - 1
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and \
           (px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi):
            inside = not inside
        j = i
    return inside


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class ServiceTableZone:
    table_id:   str
    label:      str
    polygon_px: List[tuple]


class _State(Enum):
    OUTSIDE = auto()
    INSIDE  = auto()
    GRACE   = auto()


@dataclass
class _TrackTableState:
    state:        _State = _State.OUTSIDE
    enter_t:      float  = 0.0
    dwell_frames: int    = 0
    grace_frames: int    = 0


@dataclass
class _TableMeta:
    visit_count:    int            = 0
    last_visit_t:   Optional[float] = None
    total_duration: float          = 0.0
    alerted:        bool           = False


@dataclass
class _ServerStats:
    visit_count:    int       = 0
    total_time_sec: float     = 0.0
    tables_served:  Set[str]  = field(default_factory=set)


# ── Behavioral classifier ─────────────────────────────────────────────────────

class _TrackProfile:
    """
    Per-ByteTrack-ID behavioral profile built incrementally from centroids.
    Used to classify each track as 'server', 'bartender', 'customer', or None.
    """
    __slots__ = (
        'tid', 'first_seen_t', 'last_seen_t',
        'last_cx', 'last_cy',
        'total_displacement', 'frame_count', 'bar_frames',
        'table_zones_visited', 'classified',
    )

    def __init__(self, tid: int, t_sec: float, cx: float, cy: float):
        self.tid               = tid
        self.first_seen_t      = t_sec
        self.last_seen_t       = t_sec
        self.last_cx           = cx
        self.last_cy           = cy
        self.total_displacement = 0.0
        self.frame_count        = 1
        self.bar_frames         = 0
        self.table_zones_visited: Set[str] = set()
        self.classified: Optional[str] = None  # 'server'|'bartender'|'customer'|None

    def update(self, t_sec: float, cx: float, cy: float, in_bar: bool) -> None:
        dist = ((cx - self.last_cx) ** 2 + (cy - self.last_cy) ** 2) ** 0.5
        self.total_displacement += dist
        self.last_seen_t  = t_sec
        self.last_cx      = cx
        self.last_cy      = cy
        self.frame_count += 1
        if in_bar:
            self.bar_frames += 1

    @property
    def bar_pct(self) -> float:
        return self.bar_frames / max(self.frame_count, 1)

    @property
    def avg_speed_px_sec(self) -> float:
        dur = max(self.last_seen_t - self.first_seen_t, 0.5)
        return self.total_displacement / dur

    @property
    def tracked_duration(self) -> float:
        return max(self.last_seen_t - self.first_seen_t, 0.0)

    def classify(self) -> Optional[str]:
        """
        Return classification, computing and caching it if not yet determined.
        Called per-visit so short histories return None (use conservative rules).
        """
        if self.classified is not None:
            return self.classified

        # Signal 1: heavy bar-zone presence = bartender (excluded from table visits)
        if self.bar_pct > _BAR_PCT_BARTENDER and self.tracked_duration > 30.0:
            self.classified = 'bartender'
            return self.classified

        # Signal 2: visited ≥ 2 distinct table zones = must be a server
        if len(self.table_zones_visited) >= _MULTI_TABLE_THRESHOLD:
            self.classified = 'server'
            return self.classified

        # Signal 3: mobility + any table presence = likely server
        if (self.avg_speed_px_sec > _MOBILITY_SERVER_PX_SEC
                and self.table_zones_visited
                and self.tracked_duration > 10.0):
            self.classified = 'server'
            return self.classified

        # Signal 4: low mobility + long track + minimal bar presence = customer
        if (self.avg_speed_px_sec < _MOBILITY_CUSTOMER_PX_SEC
                and self.tracked_duration > _CUSTOMER_MIN_DWELL_SEC
                and self.bar_pct < 0.05):
            self.classified = 'customer'
            return self.classified

        return None  # not enough history yet


# ── Tracker ───────────────────────────────────────────────────────────────────

class TableServiceTracker:
    """
    High-accuracy server-visit tracker with behavioral server classification.

    Args:
        tables:               List of ServiceTableZone objects (polygon in pixels).
        fps:                  Video frame rate.
        server_names:         Optional dict mapping track_id → display name.
        occupant_ids:         Optional set of known seated-customer track IDs.
        unvisited_alert_min:  Minutes before an unvisited-table alert fires.
        bar_zone_px:          Optional polygon (pixels) covering the bar area.
                              Tracks spending >25 % of frames here are classified
                              as bartenders and excluded from table-visit counting.
    """

    def __init__(self,
                 tables: List[ServiceTableZone],
                 fps: float = 25.0,
                 server_names: Optional[Dict[int, str]] = None,
                 occupant_ids: Optional[Set[int]] = None,
                 unvisited_alert_min: float = _UNVISITED_ALERT_MIN,
                 bar_zone_px: Optional[List[Tuple[float, float]]] = None):
        self._tables      = {t.table_id: t for t in tables}
        self._fps         = max(fps, 1.0)
        self._names       = server_names or {}
        self._occupants   = occupant_ids or set()
        self._alert_sec   = unvisited_alert_min * 60.0
        self._bar_zone_px = bar_zone_px  # None = no bar zone info

        # (track_id, table_id) → state machine
        self._track_states: Dict[tuple, _TrackTableState] = {}
        # per-table metadata
        self._table_meta: Dict[str, _TableMeta] = {
            tid: _TableMeta() for tid in self._tables
        }
        # per-server cumulative stats
        self._server_stats: Dict[str, _ServerStats] = {}
        # behavioral profiles — one per ByteTrack ID
        self._profiles: Dict[int, _TrackProfile] = {}

        self.events: List[Dict] = []

    # ── Public ────────────────────────────────────────────────────────────────

    def update(self, frame_idx: int, t_sec: float,
               centroids, track_ids: List[int]) -> List[Dict]:
        """
        Call once per frame with person centroids + track IDs.
        Returns list of events emitted this frame.
        """
        evs: List[Dict] = []
        n = min(len(centroids), len(track_ids))

        # ── Step 1: update behavioral profiles ───────────────────────────────
        for i in range(n):
            tid = track_ids[i]
            cx  = float(centroids[i][0])
            cy  = float(centroids[i][1])
            in_bar = (self._bar_zone_px is not None
                      and _point_in_polygon(cx, cy, self._bar_zone_px))

            if tid not in self._profiles:
                self._profiles[tid] = _TrackProfile(tid, t_sec, cx, cy)
                if in_bar:
                    self._profiles[tid].bar_frames += 1
            else:
                self._profiles[tid].update(t_sec, cx, cy, in_bar)

        # ── Step 2: zone state machines ───────────────────────────────────────
        for tid_table, table in self._tables.items():
            meta = self._table_meta[tid_table]

            ids_in_zone: Set[int] = set()
            for i in range(n):
                if track_ids[i] in self._occupants:
                    continue
                if _point_in_polygon(float(centroids[i][0]),
                                     float(centroids[i][1]),
                                     table.polygon_px):
                    ids_in_zone.add(track_ids[i])

            # Record which table zones each profile has visited
            for vtid in ids_in_zone:
                if vtid in self._profiles:
                    self._profiles[vtid].table_zones_visited.add(tid_table)

            # Advance existing state machines
            keys_for_table = [k for k in self._track_states if k[1] == tid_table]
            for key in keys_for_table:
                vtid = key[0]
                ts   = self._track_states.get(key)
                if ts is None:
                    continue

                if ts.state == _State.INSIDE:
                    if vtid in ids_in_zone:
                        ts.dwell_frames += 1
                    else:
                        ts.state        = _State.GRACE
                        ts.grace_frames = 1

                elif ts.state == _State.GRACE:
                    if vtid in ids_in_zone:
                        ts.state        = _State.INSIDE
                        ts.dwell_frames += 1
                        ts.grace_frames  = 0
                    else:
                        ts.grace_frames += 1
                        if ts.grace_frames > _GRACE_FRAMES:
                            ev_list = self._close_visit(
                                vtid, ts, t_sec, tid_table, table, meta, frame_idx)
                            evs.extend(ev_list)
                            del self._track_states[key]

            # Start tracking newly arrived non-occupant visitors
            for vtid in ids_in_zone:
                key = (vtid, tid_table)
                if key not in self._track_states:
                    self._track_states[key] = _TrackTableState(
                        state=_State.INSIDE,
                        enter_t=t_sec,
                        dwell_frames=1,
                        grace_frames=0,
                    )

            # Unvisited-table alert
            if not meta.alerted and self._alert_sec > 0:
                reference_t = meta.last_visit_t or 0.0
                if t_sec - reference_t >= self._alert_sec and t_sec > self._alert_sec:
                    meta.alerted = True
                    ev = {
                        "event_type":        "unvisited_table",
                        "table_id":          tid_table,
                        "label":             table.label,
                        "t_sec":             round(t_sec, 1),
                        "minutes_unvisited": round((t_sec - reference_t) / 60, 1),
                        "frame_idx":         frame_idx,
                    }
                    self.events.append(ev)
                    evs.append(ev)

        return evs

    def flush(self, t_sec: float) -> List[Dict]:
        """Call at end of video to close any open visits."""
        evs: List[Dict] = []
        for key in list(self._track_states):
            vtid, tid_table = key
            ts    = self._track_states[key]
            table = self._tables[tid_table]
            meta  = self._table_meta[tid_table]
            if ts.state in (_State.INSIDE, _State.GRACE):
                ev_list = self._close_visit(
                    vtid, ts, t_sec, tid_table, table, meta, frame_idx=0)
                evs.extend(ev_list)
        self._track_states.clear()
        return evs

    def summary(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {}

        for tid_table, table in self._tables.items():
            meta = self._table_meta[tid_table]
            result[tid_table] = {
                "label":                  table.label,
                "visit_count":            meta.visit_count,
                "avg_visit_duration_sec": round(
                    meta.total_duration / meta.visit_count, 1
                ) if meta.visit_count else 0.0,
                "last_visit_t": meta.last_visit_t,
            }

        leaderboard = sorted(
            [
                {
                    "server_name":    name,
                    "visit_count":    s.visit_count,
                    "tables_served":  sorted(s.tables_served),
                    "total_time_sec": round(s.total_time_sec, 1),
                }
                for name, s in self._server_stats.items()
            ],
            key=lambda x: x["visit_count"],
            reverse=True,
        )
        result["__leaderboard__"] = leaderboard

        # Classification breakdown
        class_counts: Dict[str, int] = {}
        for p in self._profiles.values():
            c = p.classify() or "unknown"
            class_counts[c] = class_counts.get(c, 0) + 1
        result["__classification_counts__"] = class_counts

        return result

    # ── Internal ──────────────────────────────────────────────────────────────

    def _close_visit(self, vtid: int, ts: _TrackTableState,
                     t_sec: float, table_id: str, table: ServiceTableZone,
                     meta: _TableMeta, frame_idx: int) -> List[Dict]:
        dwell_sec = ts.dwell_frames / self._fps

        # ── Classification gate ───────────────────────────────────────────────
        profile = self._profiles.get(vtid)
        classification = profile.classify() if profile else None

        # Bartenders are excluded — they work the bar, not the floor
        if classification == 'bartender':
            return []

        # Known seated customers are excluded
        if classification == 'customer' or vtid in self._occupants:
            return []

        # Apply appropriate minimum dwell threshold
        _min_dwell = (
            _MIN_VISIT_SEC_SERVER   if classification == 'server'
            else _MIN_VISIT_SEC_UNKNOWN  # unknown/None — be conservative
        )

        if not (_min_dwell <= dwell_sec <= _MAX_VISIT_SEC):
            return []

        # ─────────────────────────────────────────────────────────────────────
        name       = self._names.get(vtid, f"Server#{vtid}")
        is_pass_by = dwell_sec < 3.0
        exit_t     = ts.enter_t + dwell_sec

        meta.visit_count    += 1
        meta.last_visit_t    = round(exit_t, 2)
        meta.total_duration += dwell_sec
        meta.alerted         = False

        if name not in self._server_stats:
            self._server_stats[name] = _ServerStats()
        ss = self._server_stats[name]
        ss.visit_count    += 1
        ss.total_time_sec += dwell_sec
        ss.tables_served.add(table_id)

        ev = {
            "event_type":     "server_visit",
            "table_id":       table_id,
            "label":          table.label,
            "server_name":    name,
            "track_id":       vtid,
            "t_sec":          round(ts.enter_t, 2),
            "exit_t":         round(exit_t, 2),
            "duration_sec":   round(dwell_sec, 2),
            "visit_number":   meta.visit_count,
            "is_pass_by":     is_pass_by,
            "classification": classification or "unknown",
            "frame_idx":      frame_idx,
        }
        self.events.append(ev)
        return [ev]
