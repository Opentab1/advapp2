"""
VenueScope — Table turn time tracker.
Detects table occupancy, measures turn time, dwell time, and server response time.
User defines table zones as polygons on the dining floor frame.
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
    polygon_px: List[Tuple[float, float]]  # pixel-space polygon


@dataclass
class TableSession:
    table_id:        str
    seated_at:       float
    cleared_at:      Optional[float] = None
    first_service_t: Optional[float] = None    # t_sec of first server visit
    service_visits:  List[float]     = field(default_factory=list)  # all visit timestamps

    @property
    def dwell_seconds(self) -> Optional[float]:
        if self.cleared_at is not None:
            return round(self.cleared_at - self.seated_at, 1)
        return None

    @property
    def response_seconds(self) -> Optional[float]:
        """Seconds from seating to first server visit."""
        if self.first_service_t is not None:
            return round(self.first_service_t - self.seated_at, 1)
        return None


# Minimum / maximum dwell for a visit to be counted as a server (not a customer)
_SERVER_MIN_VISIT_SEC = 2.0    # filters single-frame ghosts
_SERVER_MAX_VISIT_SEC = 300.0  # >5 min means they sat down (new customer)


class _TableState:
    def __init__(self):
        self.person_frames:   int   = 0     # consecutive frames with person
        self.empty_frames:    int   = 0     # consecutive frames without person
        self.is_occupied:     bool  = False
        self.seated_at:       Optional[float] = None
        self.sessions:        List[TableSession] = []
        # Server visit tracking
        self._occupant_ids:    Set[int]           = set()  # IDs present at seating
        self._visitor_enters:  Dict[int, float]   = {}     # {track_id: enter_t_sec}
        self._current_session: Optional[TableSession] = None
        # Per-staff visit attribution: {track_id: visit_count}
        self._staff_visits:    Dict[int, int]     = {}


class TableTurnTracker:
    def __init__(self, tables: List[TableZone],
                 occupied_conf: int, empty_conf: int,
                 min_dwell_sec: float):
        self.tables         = {t.table_id: t for t in tables}
        self._states        = {t.table_id: _TableState() for t in tables}
        self.occupied_conf  = occupied_conf
        self.empty_conf     = empty_conf
        self.min_dwell_sec  = min_dwell_sec
        self.events: List[Dict] = []

    def update(self, frame_idx: int, t_sec: float,
               centroids: np.ndarray, track_ids: List[int]) -> List[Dict]:
        evs = []

        for tid, table in self.tables.items():
            state = self._states[tid]

            # Collect which track IDs are currently inside this zone
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

            # Transition: empty → occupied
            if not state.is_occupied and state.person_frames >= self.occupied_conf:
                state.is_occupied     = True
                state.seated_at       = t_sec
                state._occupant_ids   = ids_in_zone.copy()
                state._visitor_enters = {}
                session = TableSession(table_id=tid, seated_at=t_sec)
                state._current_session = session
                ev = {"event_type": "table_seated", "table_id": tid,
                      "label": table.label, "t_sec": round(t_sec, 1),
                      "frame_idx": frame_idx}
                self.events.append(ev); evs.append(ev)

            # Transition: occupied → empty
            elif state.is_occupied and state.empty_frames >= self.empty_conf:
                cleared_at = t_sec
                dwell = cleared_at - (state.seated_at or cleared_at)
                state.is_occupied = False

                if dwell >= self.min_dwell_sec and state.seated_at is not None:
                    sess = state._current_session or TableSession(
                        table_id=tid, seated_at=state.seated_at)
                    sess.cleared_at = cleared_at
                    state.sessions.append(sess)
                    ev = {"event_type": "table_cleared", "table_id": tid,
                          "label": table.label,
                          "t_sec": round(cleared_at, 1),
                          "dwell_seconds": round(dwell, 1),
                          "response_seconds": sess.response_seconds,
                          "service_visit_count": len(sess.service_visits),
                          "frame_idx": frame_idx}
                    self.events.append(ev); evs.append(ev)

                state.seated_at        = None
                state.person_frames    = 0
                state._occupant_ids    = set()
                state._visitor_enters  = {}
                state._current_session = None

            # Server visit detection while table is occupied
            if state.is_occupied and state._current_session is not None:
                sess = state._current_session
                # Detect new visitors (IDs not present at seating)
                new_ids = ids_in_zone - state._occupant_ids
                for vtid in new_ids:
                    if vtid not in state._visitor_enters:
                        state._visitor_enters[vtid] = t_sec

                # Detect visitors who just left the zone
                departed = set(state._visitor_enters.keys()) - ids_in_zone
                for vtid in departed:
                    enter_t = state._visitor_enters.pop(vtid)
                    visit_dur = t_sec - enter_t
                    if _SERVER_MIN_VISIT_SEC <= visit_dur <= _SERVER_MAX_VISIT_SEC:
                        # Record server visit
                        sess.service_visits.append(round(enter_t, 1))
                        state._staff_visits[vtid] = state._staff_visits.get(vtid, 0) + 1
                        if sess.first_service_t is None:
                            sess.first_service_t = round(enter_t, 1)
                            ev = {"event_type": "table_served", "table_id": tid,
                                  "label": table.label,
                                  "t_sec": round(enter_t, 1),
                                  "response_seconds": sess.response_seconds,
                                  "frame_idx": frame_idx}
                            self.events.append(ev); evs.append(ev)

        return evs

    def get_staff_attribution(self) -> Dict[str, Dict[int, int]]:
        """Returns {table_id: {track_id: visit_count}} for all tables with visits."""
        return {
            tid: dict(state._staff_visits)
            for tid, state in self._states.items()
            if state._staff_visits
        }

    def summary(self) -> Dict[str, Any]:
        result = {}
        for tid, state in self._states.items():
            table = self.tables[tid]
            dwells = [s.dwell_seconds for s in state.sessions
                      if s.dwell_seconds is not None]
            responses = [s.response_seconds for s in state.sessions
                         if s.response_seconds is not None]
            total_visits = sum(len(s.service_visits) for s in state.sessions)
            result[tid] = {
                "label":              table.label,
                "turn_count":         len(state.sessions),
                "avg_dwell_min":      round(np.mean(dwells) / 60, 1) if dwells else 0,
                "max_dwell_min":      round(max(dwells) / 60, 1) if dwells else 0,
                "min_dwell_min":      round(min(dwells) / 60, 1) if dwells else 0,
                "currently_occupied": state.is_occupied,
                # Server response time metrics
                "avg_response_sec":   round(float(np.mean(responses)), 1) if responses else None,
                "max_response_sec":   round(max(responses), 1) if responses else None,
                "min_response_sec":   round(min(responses), 1) if responses else None,
                "total_service_visits": total_visits,
                # Per-staff visit attribution: {track_id: visit_count}
                "staff_attribution":  dict(state._staff_visits),
            }
        return result
