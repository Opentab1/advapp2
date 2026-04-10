"""
VenueScope — Table Service Tracker (table_service mode).

Dedicated high-accuracy mode for tracking how many times servers visit each table.
Catches pass-by greetings (≥ 0.5s) with grace-period state machine.

State machine per (track_id, table_id):
  OUTSIDE ──[enters zone]──> INSIDE
  INSIDE  ──[leaves zone]──> GRACE  (4-frame buffer before committing exit)
  GRACE   ──[re-enters]───> INSIDE  (glitch suppressed)
  GRACE   ──[grace expires]─> OUTSIDE + emit visit if dwell ≥ 0.5s

Output events:
  server_visit   — {table_id, label, server_name, track_id, t_sec,
                    duration_sec, visit_number, is_pass_by}
  unvisited_table — {table_id, label, t_sec, minutes_unvisited}

Summary:
  per-table:    visit_count, avg_visit_duration_sec, last_visit_t
  per-server:   visit_count, tables_served (set→list), total_time_sec
  leaderboard:  sorted list of servers by visit count
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Set
from enum import Enum, auto


# ── Tunables ────────────────────────────────────────────────────────────────
_MIN_VISIT_SEC    = 0.5   # ≥ 0.5s = counts as a visit (pass-by greeting)
_MAX_VISIT_SEC    = 300.0 # > 5 min = likely seated customer, skip
_GRACE_FRAMES     = 4     # frames visitor can vanish without ending visit
_UNVISITED_ALERT_MIN = 15.0  # flag table if no visit in this many minutes


# ── Geometry ─────────────────────────────────────────────────────────────────
def _point_in_polygon(px: float, py: float,
                      poly: List[tuple]) -> bool:
    n = len(poly); inside = False; j = n - 1
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and \
           (px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi):
            inside = not inside
        j = i
    return inside


# ── Data structures ──────────────────────────────────────────────────────────
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
    visit_count:     int   = 0
    last_visit_t:    Optional[float] = None
    total_duration:  float = 0.0
    alerted:         bool  = False   # unvisited alert fired


@dataclass
class _ServerStats:
    visit_count:    int         = 0
    total_time_sec: float       = 0.0
    tables_served:  Set[str]    = field(default_factory=set)


# ── Tracker ──────────────────────────────────────────────────────────────────
class TableServiceTracker:
    """
    High-accuracy server-visit tracker for the table_service mode.

    Args:
        tables:       List of ServiceTableZone objects (polygon in pixels).
        fps:          Video frame rate — used to convert dwell_frames to seconds.
        server_names: Optional dict mapping track_id → display name.
        occupant_ids: Optional set of track IDs known to be seated customers
                      (excluded from server-visit counting).
        unvisited_alert_min: Minutes before an unvisited-table alert fires.
    """

    def __init__(self,
                 tables: List[ServiceTableZone],
                 fps: float = 25.0,
                 server_names: Optional[Dict[int, str]] = None,
                 occupant_ids: Optional[Set[int]] = None,
                 unvisited_alert_min: float = _UNVISITED_ALERT_MIN):
        self._tables      = {t.table_id: t for t in tables}
        self._fps         = max(fps, 1.0)
        self._names       = server_names or {}
        self._occupants   = occupant_ids or set()
        self._alert_sec   = unvisited_alert_min * 60.0

        # (track_id, table_id) → state machine
        self._track_states: Dict[tuple, _TrackTableState] = {}
        # per-table metadata
        self._table_meta: Dict[str, _TableMeta] = {
            tid: _TableMeta() for tid in self._tables
        }
        # per-server cumulative stats
        self._server_stats: Dict[str, _ServerStats] = {}

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

        for tid, table in self._tables.items():
            meta = self._table_meta[tid]

            # build set of non-occupant track IDs currently in this zone
            ids_in_zone: Set[int] = set()
            for i in range(n):
                if track_ids[i] in self._occupants:
                    continue
                if _point_in_polygon(float(centroids[i][0]),
                                     float(centroids[i][1]),
                                     table.polygon_px):
                    ids_in_zone.add(track_ids[i])

            # ── advance state machine for all (vtid, tid) pairs ──────────
            keys_for_table = [k for k in self._track_states if k[1] == tid]
            for key in keys_for_table:
                vtid = key[0]
                ts   = self._track_states.get(key)
                if ts is None:
                    continue  # already deleted this frame

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
                                vtid, ts, t_sec, tid, table, meta, frame_idx)
                            evs.extend(ev_list)
                            del self._track_states[key]

            # start tracking newly arrived visitors
            for vtid in ids_in_zone:
                key = (vtid, tid)
                if key not in self._track_states:
                    self._track_states[key] = _TrackTableState(
                        state=_State.INSIDE,
                        enter_t=t_sec,
                        dwell_frames=1,
                        grace_frames=0,
                    )

            # ── unvisited table alert ─────────────────────────────────────
            if not meta.alerted and self._alert_sec > 0:
                reference_t = meta.last_visit_t or 0.0
                if t_sec - reference_t >= self._alert_sec and t_sec > self._alert_sec:
                    meta.alerted = True
                    ev = {
                        "event_type":       "unvisited_table",
                        "table_id":         tid,
                        "label":            table.label,
                        "t_sec":            round(t_sec, 1),
                        "minutes_unvisited": round((t_sec - reference_t) / 60, 1),
                        "frame_idx":        frame_idx,
                    }
                    self.events.append(ev)
                    evs.append(ev)

        return evs

    def flush(self, t_sec: float) -> List[Dict]:
        """
        Call at end of video to close any open visits.
        Returns list of events emitted.
        """
        evs: List[Dict] = []
        for key in list(self._track_states):
            vtid, tid = key
            ts    = self._track_states[key]
            table = self._tables[tid]
            meta  = self._table_meta[tid]
            if ts.state in (_State.INSIDE, _State.GRACE):
                ev_list = self._close_visit(
                    vtid, ts, t_sec, tid, table, meta, frame_idx=0)
                evs.extend(ev_list)
        self._track_states.clear()
        return evs

    def summary(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {}

        # per-table
        for tid, table in self._tables.items():
            meta = self._table_meta[tid]
            result[tid] = {
                "label":                 table.label,
                "visit_count":           meta.visit_count,
                "avg_visit_duration_sec": round(
                    meta.total_duration / meta.visit_count, 1
                ) if meta.visit_count else 0.0,
                "last_visit_t":          meta.last_visit_t,
            }

        # per-server leaderboard
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
        return result

    # ── Internal ──────────────────────────────────────────────────────────────

    def _close_visit(self, vtid: int, ts: _TrackTableState,
                     t_sec: float, table_id: str, table: ServiceTableZone,
                     meta: _TableMeta, frame_idx: int) -> List[Dict]:
        dwell_sec = ts.dwell_frames / self._fps
        if not (_MIN_VISIT_SEC <= dwell_sec <= _MAX_VISIT_SEC):
            return []

        name      = self._names.get(vtid, f"Server#{vtid}")
        is_pass_by = dwell_sec < 3.0   # < 3s = brief greeting
        exit_t    = ts.enter_t + dwell_sec

        # update table meta
        meta.visit_count    += 1
        meta.last_visit_t    = round(exit_t, 2)
        meta.total_duration += dwell_sec
        meta.alerted         = False   # reset alert after any visit

        # update server stats
        if name not in self._server_stats:
            self._server_stats[name] = _ServerStats()
        ss = self._server_stats[name]
        ss.visit_count    += 1
        ss.total_time_sec += dwell_sec
        ss.tables_served.add(table_id)

        ev = {
            "event_type":   "server_visit",
            "table_id":     table_id,
            "label":        table.label,
            "server_name":  name,
            "track_id":     vtid,
            "t_sec":        round(ts.enter_t, 2),
            "exit_t":       round(exit_t, 2),
            "duration_sec": round(dwell_sec, 2),
            "visit_number": meta.visit_count,
            "is_pass_by":   is_pass_by,
            "frame_idx":    frame_idx,
        }
        self.events.append(ev)
        return [ev]
