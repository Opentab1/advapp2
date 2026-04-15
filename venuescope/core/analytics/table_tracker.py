"""
VenueScope — Table turn tracker (table_turns mode).

Detects table occupancy, measures turn time, dwell time, and server response time.
User defines table zones as polygons on the dining floor frame.

v3 fixes:
  - Server vs customer distinction: tracks dwelling >60s in the zone are
    reclassified as customers (occupants), not server visits. Eliminates the
    most common false positive: a customer whose track ID changes mid-session.
  - Occupant ID refresh: if a seated customer's track ID is reassigned by YOLO
    (e.g., after occlusion), their new ID is promoted to occupant status within
    60s — no false "server visit" is counted.
  - Minimum server visit: 0.5s (catches "pass by and say hi")
  - Maximum server visit: 240s (>4 min = seated customer, not server)
  - Grace period: 4 frames so tracking glitches don't split one visit into two
  - Per-server visit leaderboard in summary
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Tuple, Set
import numpy as np


def _point_in_polygon(px: float, py: float,
                      poly: List[Tuple[float, float]]) -> bool:
    n = len(poly); inside = False; j = n - 1
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and \
           (px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi):
            inside = not inside
        j = i
    return inside


@dataclass
class TableZone:
    table_id:   str
    label:      str
    polygon_px: List[Tuple[float, float]]


@dataclass
class TableVisit:
    track_id:    int
    server_name: str
    enter_t:     float
    exit_t:      float
    duration:    float
    visit_num:   int


@dataclass
class TableSession:
    table_id:        str
    seated_at:       float
    cleared_at:      Optional[float] = None
    first_service_t: Optional[float] = None
    visits:          List[TableVisit] = field(default_factory=list)

    @property
    def dwell_seconds(self) -> Optional[float]:
        if self.cleared_at is not None:
            return round(self.cleared_at - self.seated_at, 1)
        return None

    @property
    def response_seconds(self) -> Optional[float]:
        if self.first_service_t is not None:
            return round(self.first_service_t - self.seated_at, 1)
        return None

    @property
    def visit_count(self) -> int:
        return len(self.visits)


# Track dwell thresholds
_SERVER_MIN_VISIT_SEC  = 0.5    # ≥ 0.5s = counts — catches pass-by greetings
_SERVER_MAX_VISIT_SEC  = 240.0  # > 4 min = probably seated customer, not server
_VISIT_GRACE_FRAMES    = 4      # frames visitor can vanish without ending visit
_CUSTOMER_PROMOTE_SEC  = 60.0   # after 60s in zone, reclassify visitor as customer


class _VisitorTrack:
    __slots__ = ("enter_t", "dwell_frames", "out_frames")

    def __init__(self, enter_t: float):
        self.enter_t      = enter_t
        self.dwell_frames = 1
        self.out_frames   = 0


class _TableState:
    def __init__(self):
        self.person_frames:    int   = 0
        self.empty_frames:     int   = 0
        self.is_occupied:      bool  = False
        self.seated_at:        Optional[float] = None
        self._occupant_ids:    Set[int] = set()
        self._visitors:        Dict[int, _VisitorTrack] = {}
        self._current_session: Optional[TableSession] = None
        self.sessions:         List[TableSession] = []


class TableTurnTracker:
    def __init__(self, tables: List[TableZone],
                 occupied_conf: int, empty_conf: int,
                 min_dwell_sec: float,
                 fps: float = 25.0,
                 server_names: Optional[Dict[int, str]] = None):
        self.tables        = {t.table_id: t for t in tables}
        self._states       = {t.table_id: _TableState() for t in tables}
        self.occupied_conf = occupied_conf
        self.empty_conf    = empty_conf
        self.min_dwell_sec = min_dwell_sec
        self._fps          = max(fps, 1.0)
        self._names        = server_names or {}
        self.events:       List[Dict] = []

    def update(self, frame_idx: int, t_sec: float,
               centroids: np.ndarray, track_ids: List[int]) -> List[Dict]:
        evs = []

        for tid, table in self.tables.items():
            state = self._states[tid]

            ids_in_zone: Set[int] = {
                track_ids[i]
                for i in range(min(len(centroids), len(track_ids)))
                if _point_in_polygon(float(centroids[i][0]),
                                     float(centroids[i][1]),
                                     table.polygon_px)
            }
            person_present = bool(ids_in_zone)

            if person_present:
                state.person_frames += 1
                state.empty_frames   = 0
            else:
                state.empty_frames  += 1
                state.person_frames  = 0

            # empty → occupied
            if not state.is_occupied and state.person_frames >= self.occupied_conf:
                state.is_occupied    = True
                state.seated_at      = t_sec
                state._occupant_ids  = ids_in_zone.copy()
                state._visitors      = {}
                session = TableSession(table_id=tid, seated_at=t_sec)
                state._current_session = session
                ev = {"event_type": "table_seated", "table_id": tid,
                      "label": table.label, "t_sec": round(t_sec, 1),
                      "frame_idx": frame_idx}
                self.events.append(ev); evs.append(ev)

            # occupied → empty
            elif state.is_occupied and state.empty_frames >= self.empty_conf:
                dwell = t_sec - (state.seated_at or t_sec)
                state.is_occupied = False
                if dwell >= self.min_dwell_sec and state.seated_at is not None:
                    sess = state._current_session or TableSession(
                        table_id=tid, seated_at=state.seated_at)
                    sess.cleared_at = t_sec
                    state.sessions.append(sess)
                    ev = {"event_type":         "table_cleared",
                          "table_id":           tid,
                          "label":              table.label,
                          "t_sec":              round(t_sec, 1),
                          "dwell_seconds":       round(dwell, 1),
                          "response_seconds":    sess.response_seconds,
                          "service_visit_count": sess.visit_count,
                          "frame_idx":           frame_idx}
                    self.events.append(ev); evs.append(ev)
                state.seated_at          = None
                state.person_frames      = 0
                state._occupant_ids      = set()
                state._visitors          = {}
                state._current_session   = None

            # server visit tracking while occupied
            if state.is_occupied and state._current_session is not None:
                sess      = state._current_session
                newcomers = ids_in_zone - state._occupant_ids

                for vtid in newcomers:
                    if vtid not in state._visitors:
                        state._visitors[vtid] = _VisitorTrack(enter_t=t_sec)
                    else:
                        state._visitors[vtid].dwell_frames += 1
                        state._visitors[vtid].out_frames    = 0

                # ── Customer promotion ────────────────────────────────────────
                # If a "visitor" has been in the zone continuously for >60 seconds
                # they are a seated customer, not a server. Promote them to occupant
                # so they stop generating server-visit events. This handles:
                #   1. Track ID changes mid-session (YOLO reassigns the ID of a
                #      seated customer after occlusion — new ID shows up as "newcomer")
                #   2. Customers who arrived after initial seating detection
                _to_promote = [
                    vtid for vtid, vt in state._visitors.items()
                    if (vt.dwell_frames / self._fps) >= _CUSTOMER_PROMOTE_SEC
                ]
                for vtid in _to_promote:
                    state._occupant_ids.add(vtid)
                    del state._visitors[vtid]

                for vtid in list(state._visitors):
                    if vtid not in newcomers:
                        state._visitors[vtid].out_frames += 1
                        if state._visitors[vtid].out_frames > _VISIT_GRACE_FRAMES:
                            ev_list = self._close_visit(
                                vtid, state._visitors[vtid], t_sec, tid, table, sess)
                            evs.extend(ev_list)
                            del state._visitors[vtid]

        return evs

    def _close_visit(self, vtid: int, vt: _VisitorTrack,
                     t_sec: float, table_id: str, table: TableZone,
                     sess: TableSession) -> List[Dict]:
        dwell_sec = vt.dwell_frames / self._fps
        if not (_SERVER_MIN_VISIT_SEC <= dwell_sec <= _SERVER_MAX_VISIT_SEC):
            return []

        name      = self._names.get(vtid, f"Server#{vtid}")
        visit_num = sess.visit_count + 1
        exit_t    = vt.enter_t + dwell_sec

        sess.visits.append(TableVisit(
            track_id=vtid, server_name=name,
            enter_t=round(vt.enter_t, 2), exit_t=round(exit_t, 2),
            duration=round(dwell_sec, 2), visit_num=visit_num))

        if sess.first_service_t is None:
            sess.first_service_t = round(vt.enter_t, 2)

        ev = {
            "event_type":   "server_visit",
            "table_id":     table_id,
            "label":        table.label,
            "server_name":  name,
            "track_id":     vtid,
            "t_sec":        round(vt.enter_t, 2),
            "duration_sec": round(dwell_sec, 2),
            "visit_number": visit_num,
            "response_sec": sess.response_seconds,
            "frame_idx":    0,
        }
        self.events.append(ev)
        return [ev]

    def get_cross_segment_state(self) -> Dict:
        """Serialize active sessions so they survive a worker restart."""
        active = {}
        for tid, state in self._states.items():
            if state.is_occupied and state.seated_at is not None:
                active[tid] = {
                    "seated_at":      state.seated_at,
                    "person_frames":  state.person_frames,
                    "sessions_count": len(state.sessions),
                }
        return {"active_sessions": active, "completed_turns": {
            tid: len(state.sessions) for tid, state in self._states.items()
        }}

    def restore_cross_segment_state(self, state_dict: Dict) -> None:
        """Re-hydrate active table sessions from a prior segment's state."""
        if not state_dict:
            return
        active = state_dict.get("active_sessions", {})
        for tid, info in active.items():
            if tid in self._states:
                s = self._states[tid]
                s.is_occupied   = True
                s.seated_at     = info["seated_at"]
                s.person_frames = info.get("person_frames", self.occupied_conf)
                if s._current_session is None:
                    s._current_session = TableSession(table_id=tid, seated_at=info["seated_at"])

    def summary(self) -> Dict[str, Any]:
        result = {}
        for tid, state in self._states.items():
            table  = self.tables[tid]
            dwells = [s.dwell_seconds for s in state.sessions if s.dwell_seconds is not None]
            resp   = [s.response_seconds for s in state.sessions if s.response_seconds is not None]

            attribution: Dict[str, int] = {}
            for s in state.sessions:
                for v in s.visits:
                    attribution[v.server_name] = attribution.get(v.server_name, 0) + 1

            result[tid] = {
                "label":                table.label,
                "turn_count":           len(state.sessions),
                "avg_dwell_min":        round(float(np.mean(dwells)) / 60, 1) if dwells else 0,
                "max_dwell_min":        round(max(dwells) / 60, 1)            if dwells else 0,
                "min_dwell_min":        round(min(dwells) / 60, 1)            if dwells else 0,
                "currently_occupied":   state.is_occupied,
                "avg_response_sec":     round(float(np.mean(resp)), 1) if resp else None,
                "max_response_sec":     round(max(resp), 1)            if resp else None,
                "min_response_sec":     round(min(resp), 1)            if resp else None,
                "total_service_visits": sum(s.visit_count for s in state.sessions),
                "staff_attribution":    attribution,
            }
        return result
