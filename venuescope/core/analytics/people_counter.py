"""
VenueScope — People counter / occupancy tracker.
Supports multiple counting lines (one per entrance/exit point).
Also tracks total headcount in frame as zone occupancy.
Works with side-angle wall-mounted cameras.
"""
from __future__ import annotations
from collections import defaultdict
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Tuple
import numpy as np


def _side_of_line(px: float, py: float,
                  lp1: Tuple[float, float], lp2: Tuple[float, float]) -> int:
    dx = lp2[0] - lp1[0]; dy = lp2[1] - lp1[1]
    cross = dx * (py - lp1[1]) - dy * (px - lp1[0])
    return 1 if cross > 0 else (-1 if cross < 0 else 0)


@dataclass
class CountingLine:
    """One entrance/exit counting line."""
    line_id:    str
    label:      str
    p1:         Tuple[float, float]   # pixel coords
    p2:         Tuple[float, float]   # pixel coords
    entry_side: int                   # which side (+1/-1) is "inside"
    entries:    int = 0
    exits:      int = 0
    hourly_entries: Dict[int, int] = field(default_factory=lambda: defaultdict(int))
    hourly_exits:   Dict[int, int] = field(default_factory=lambda: defaultdict(int))


class _TrackLineState:
    """Per-track state for one counting line."""
    __slots__ = ("side_history", "confirmed_side", "counted_entry", "counted_exit",
                 "pending_side", "pending_dwell")
    def __init__(self):
        self.side_history:   List[int] = []
        self.confirmed_side: int       = 0
        self.counted_entry:  bool      = False
        self.counted_exit:   bool      = False
        self.pending_side:  int = 0   # side we're building dwell count toward
        self.pending_dwell: int = 0   # frames spent on pending_side so far


class PeopleCounter:
    """
    Multi-line people counter for venues with multiple entrances.
    Tracks:
    - Entries/exits per counting line
    - Total unique people seen in frame (zone headcount)
    - Occupancy curve over time
    - Hourly entry/exit volumes
    """
    def __init__(self, lines_config: List[Dict], confirm_frames: int, W: int, H: int,
                 stabilize_frames: int = 12):
        """
        lines_config: list of dicts with keys:
            line_id, label, p1 [norm], p2 [norm], entry_side
        """
        self.W = W; self.H = H
        self.confirm_frames = confirm_frames
        self.stabilize_frames = stabilize_frames

        # Build counting lines (convert normalized → pixel)
        self.lines: List[CountingLine] = []
        for lc in lines_config:
            p1_px = (lc["p1"][0] * W, lc["p1"][1] * H)
            p2_px = (lc["p2"][0] * W, lc["p2"][1] * H)
            self.lines.append(CountingLine(
                line_id=lc["line_id"],
                label=lc.get("label", lc["line_id"]),
                p1=p1_px, p2=p2_px,
                entry_side=lc.get("entry_side", -1),
            ))

        # Per-track, per-line crossing state
        # _states[track_id][line_idx] = _TrackLineState
        self._states: Dict[int, List[_TrackLineState]] = {}

        # Global occupancy (people currently visible in frame)
        self._active_tracks:     set  = set()
        self._seen_tracks:       set  = set()
        self._current_occupancy: int  = 0
        self.peak_occupancy:     int  = 0
        self.occupancy_log:      List[Tuple[float, int]] = []

        # Aggregate totals
        self.total_entries: int = 0
        self.total_exits:   int = 0
        self.hourly_entries: Dict[int, int] = defaultdict(int)
        self.hourly_exits:   Dict[int, int] = defaultdict(int)

    def update(self, frame_idx: int, t_sec: float,
               centroids: np.ndarray, track_ids: List[int]) -> List[Dict]:
        events = []
        hour   = int(t_sec // 3600)

        current_frame_tracks = set(track_ids)

        # Update zone headcount from tracks visible this frame
        new_arrivals = current_frame_tracks - self._active_tracks
        self._active_tracks = current_frame_tracks
        for tid in new_arrivals:
            if tid not in self._seen_tracks:
                self._seen_tracks.add(tid)

        # Use track count as proxy for current zone occupancy
        self._current_occupancy = len(current_frame_tracks)
        self.peak_occupancy = max(self.peak_occupancy, self._current_occupancy)

        if frame_idx % 10 == 0:
            self.occupancy_log.append((round(t_sec, 1), self._current_occupancy))

        # Per-line crossing detection
        for i, tid in enumerate(track_ids):
            if i >= len(centroids):
                continue
            cx, cy = float(centroids[i][0]), float(centroids[i][1])

            if tid not in self._states:
                self._states[tid] = [_TrackLineState() for _ in self.lines]

            for li, line in enumerate(self.lines):
                state = self._states[tid][li]
                side  = _side_of_line(cx, cy, line.p1, line.p2)
                state.side_history.append(side)

                window = self.confirm_frames + 4
                if len(state.side_history) > window:
                    state.side_history = state.side_history[-window:]

                recent = state.side_history[-self.confirm_frames:]
                if len(recent) < self.confirm_frames:
                    continue

                nz = [s for s in recent if s != 0]
                if not nz:
                    continue
                dominant = 1 if nz.count(1) >= nz.count(-1) else -1

                if dominant == state.confirmed_side:
                    # Stable on confirmed side — reset any pending dwell
                    state.pending_side  = 0
                    state.pending_dwell = 0
                    continue

                # A6: oscillation fix — require N frames of stable dwell before counting crossing
                if dominant != state.pending_side:
                    state.pending_side  = dominant
                    state.pending_dwell = 1
                else:
                    state.pending_dwell += 1

                if state.pending_dwell < self.stabilize_frames:
                    continue  # not yet stable — may be jitter/oscillation

                # Crossing confirmed — person has been on new side for stabilize_frames
                prev = state.confirmed_side
                state.confirmed_side = dominant
                state.pending_side   = 0
                state.pending_dwell  = 0

                if prev == 0:
                    continue  # first observation

                if dominant == line.entry_side:
                    # Reset exit flag so they can exit again later
                    state.counted_exit = False
                    if not state.counted_entry:
                        state.counted_entry = True
                        line.entries        += 1
                        self.total_entries  += 1
                        line.hourly_entries[hour] += 1
                        self.hourly_entries[hour] += 1
                        events.append({
                            "event_type": "entry",
                            "line_id":    line.line_id,
                            "line_label": line.label,
                            "track_id":   tid,
                            "t_sec":      round(t_sec, 3),
                            "frame_idx":  frame_idx,
                            "occupancy":  self._current_occupancy,
                        })

                elif dominant == -line.entry_side:
                    # Reset entry flag so they can re-enter again later
                    state.counted_entry = False
                    if not state.counted_exit:
                        state.counted_exit  = True
                        line.exits          += 1
                        self.total_exits    += 1
                        line.hourly_exits[hour] += 1
                        self.hourly_exits[hour] += 1
                        events.append({
                            "event_type": "exit",
                            "line_id":    line.line_id,
                            "line_label": line.label,
                            "track_id":   tid,
                            "t_sec":      round(t_sec, 3),
                            "frame_idx":  frame_idx,
                            "occupancy":  self._current_occupancy,
                        })

        return events

    def summary(self, total_sec: float) -> Dict[str, Any]:
        per_line = {}
        for line in self.lines:
            per_line[line.line_id] = {
                "label":           line.label,
                "entries":         line.entries,
                "exits":           line.exits,
                "hourly_entries":  dict(line.hourly_entries),
                "hourly_exits":    dict(line.hourly_exits),
            }

        peak_hour = (max(self.hourly_entries, key=self.hourly_entries.get)
                     if self.hourly_entries else 0)

        return {
            "total_entries":      self.total_entries,
            "total_exits":        self.total_exits,
            "net_occupancy":      max(0, self.total_entries - self.total_exits),
            "peak_occupancy":     self.peak_occupancy,
            "unique_tracks_seen": len(self._seen_tracks),
            "peak_entry_hour":    peak_hour,
            "hourly_entries":     dict(self.hourly_entries),
            "hourly_exits":       dict(self.hourly_exits),
            "per_line":           per_line,
        }
