"""
VenueScope — Table turn time tracker.
Detects table occupancy, measures turn time and dwell time.
User defines table zones as polygons on the dining floor frame.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Tuple
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
    table_id:   str
    seated_at:  float
    cleared_at: Optional[float] = None

    @property
    def dwell_seconds(self) -> Optional[float]:
        if self.cleared_at is not None:
            return round(self.cleared_at - self.seated_at, 1)
        return None


class _TableState:
    def __init__(self):
        self.person_frames:   int   = 0     # consecutive frames with person
        self.empty_frames:    int   = 0     # consecutive frames without person
        self.is_occupied:     bool  = False
        self.seated_at:       Optional[float] = None
        self.sessions:        List[TableSession] = []


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

            # Check if any person centroid is inside this table zone
            person_present = any(
                _point_in_polygon(float(centroids[i][0]), float(centroids[i][1]),
                                  table.polygon_px)
                for i in range(len(centroids))
                if i < len(track_ids)
            )

            if person_present:
                state.person_frames += 1
                state.empty_frames   = 0
            else:
                state.empty_frames  += 1
                state.person_frames  = 0

            # Transition: empty → occupied
            if not state.is_occupied and state.person_frames >= self.occupied_conf:
                state.is_occupied = True
                state.seated_at   = t_sec
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
                    session = TableSession(table_id=tid,
                                          seated_at=state.seated_at,
                                          cleared_at=cleared_at)
                    state.sessions.append(session)
                    ev = {"event_type": "table_cleared", "table_id": tid,
                          "label": table.label,
                          "t_sec": round(cleared_at, 1),
                          "dwell_seconds": round(dwell, 1),
                          "frame_idx": frame_idx}
                    self.events.append(ev); evs.append(ev)

                state.seated_at   = None
                state.person_frames = 0

        return evs

    def summary(self) -> Dict[str, Any]:
        result = {}
        for tid, state in self._states.items():
            table = self.tables[tid]
            dwells = [s.dwell_seconds for s in state.sessions
                      if s.dwell_seconds is not None]
            result[tid] = {
                "label":            table.label,
                "turn_count":       len(state.sessions),
                "avg_dwell_min":    round(np.mean(dwells) / 60, 1) if dwells else 0,
                "max_dwell_min":    round(max(dwells) / 60, 1) if dwells else 0,
                "min_dwell_min":    round(min(dwells) / 60, 1) if dwells else 0,
                "currently_occupied": state.is_occupied,
            }
        return result
