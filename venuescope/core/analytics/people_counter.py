"""
VenueScope — People counter / occupancy tracker.

Accuracy improvements over v1
──────────────────────────────
1. Initial-position fix
   When a track is first detected, its side of the line is recorded
   immediately (no warmup needed). Subsequent crossings are relative to
   this confirmed baseline.  Fixes: people already inside at t=0, and
   people who enter during a detection gap.

2. Velocity direction gate
   A crossing is only counted if the person's recent centroid trajectory
   is pointing toward the target side of the line.  Filters false crossings
   from people walking parallel to the line or from detection jitter.

3. Occupancy floor
   net_occupancy = max(entries - exits, visible_in_frame).
   If line-counting misses entries (crowded door, occlusion), the frame-
   visible count provides a lower bound, preventing impossible negatives.

4. Deep-inside entry detection
   When a new track appears whose centroid is clearly on the "inside" of
   every configured entry line (not near any of them), they were likely
   missed at the door — count them as an entry immediately.

5. Trajectory smoothing
   Centroid is smoothed over the last 5 positions before line-side
   computation, reducing jitter-driven false crossings from detection noise.
"""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Tuple, Deque
import numpy as np


# ── Geometry ──────────────────────────────────────────────────────────────────

def _side_of_line(px: float, py: float,
                  lp1: Tuple[float, float], lp2: Tuple[float, float]) -> int:
    dx = lp2[0] - lp1[0]; dy = lp2[1] - lp1[1]
    cross = dx * (py - lp1[1]) - dy * (px - lp1[0])
    return 1 if cross > 0 else (-1 if cross < 0 else 0)


def _dist_to_line(px: float, py: float,
                  lp1: Tuple[float, float], lp2: Tuple[float, float]) -> float:
    """Perpendicular distance from point (px, py) to the infinite line through lp1, lp2."""
    dx = lp2[0] - lp1[0]; dy = lp2[1] - lp1[1]
    length = (dx*dx + dy*dy) ** 0.5
    if length < 1e-6:
        return ((px - lp1[0])**2 + (py - lp1[1])**2) ** 0.5
    return abs(dx * (lp1[1] - py) - (lp1[0] - px) * dy) / length


# ── Data structures ───────────────────────────────────────────────────────────

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

    @property
    def length_px(self) -> float:
        return ((self.p2[0]-self.p1[0])**2 + (self.p2[1]-self.p1[1])**2) ** 0.5


class _TrackLineState:
    """Per-track state for one counting line."""
    __slots__ = ("confirmed_side", "counted_entry", "counted_exit",
                 "pending_side", "pending_dwell")

    def __init__(self):
        self.confirmed_side: int  = 0   # 0 = not yet established
        self.counted_entry:  bool = False
        self.counted_exit:   bool = False
        self.pending_side:   int  = 0
        self.pending_dwell:  int  = 0


# ── Tracker ───────────────────────────────────────────────────────────────────

# How close (px) a new-track centroid must be to a line before we skip the
# deep-inside entry heuristic (they might be entering right now, not missed)
_LINE_PROXIMITY_PX   = 80
# Smoothing window for centroid (reduces jitter)
_SMOOTH_WINDOW       = 5
# Velocity history window for direction gate (in smoothed frames)
_VELOCITY_LOOKBACK   = 4


class PeopleCounter:
    """
    Multi-line people counter for venues with multiple entrances.

    Tracks:
    - Entries/exits per counting line (with direction gate + initial-position fix)
    - Total unique people seen in frame (zone headcount)
    - Occupancy = max(net line count, visible in frame)
    - Hourly entry/exit volumes
    """

    def __init__(self, lines_config: List[Dict], confirm_frames: int,
                 W: int, H: int, stabilize_frames: int = 12):
        """
        lines_config: list of dicts with keys:
            line_id, label, p1 [norm], p2 [norm], entry_side
        """
        self.W = W; self.H = H
        self.confirm_frames   = confirm_frames
        self.stabilize_frames = stabilize_frames

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
        self._states: Dict[int, List[_TrackLineState]] = {}

        # Centroid history per track for smoothing + velocity direction gate
        # Stores smoothed (cx, cy) positions in frame order
        self._centroid_hist: Dict[int, Deque[Tuple[float, float]]] = {}

        # Occupancy
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

        # Occupancy floor: tracks visible in current frame
        self._frame_visible: int = 0

    # ── Public ────────────────────────────────────────────────────────────────

    def update(self, frame_idx: int, t_sec: float,
               centroids: np.ndarray, track_ids: List[int]) -> List[Dict]:
        events = []
        hour   = int(t_sec // 3600)

        current_frame_tracks = set(track_ids)
        self._active_tracks  = current_frame_tracks
        self._frame_visible  = len(current_frame_tracks)
        self.peak_occupancy  = max(self.peak_occupancy,
                                   self.net_occupancy,
                                   self._frame_visible)

        for tid in current_frame_tracks:
            self._seen_tracks.add(tid)

        if frame_idx % 10 == 0:
            self.occupancy_log.append((round(t_sec, 1), self.net_occupancy))

        if not self.lines:
            self._current_occupancy = self._frame_visible
            return events

        # ── Per-track crossing detection ───────────────────────────────────
        for i, tid in enumerate(track_ids):
            if i >= len(centroids):
                continue
            raw_cx = float(centroids[i][0])
            raw_cy = float(centroids[i][1])

            # Initialise centroid history
            if tid not in self._centroid_hist:
                self._centroid_hist[tid] = deque(maxlen=max(_SMOOTH_WINDOW,
                                                             _VELOCITY_LOOKBACK + 2))
            self._centroid_hist[tid].append((raw_cx, raw_cy))

            # Smoothed centroid
            hist = list(self._centroid_hist[tid])
            w = min(len(hist), _SMOOTH_WINDOW)
            cx = sum(p[0] for p in hist[-w:]) / w
            cy = sum(p[1] for p in hist[-w:]) / w

            # Initialise crossing state
            if tid not in self._states:
                self._states[tid] = [_TrackLineState() for _ in self.lines]
                # FIX 1: Initial-position fix — record which side each line the
                # person is already on so their first crossing is detected correctly
                for li, line in enumerate(self.lines):
                    side = _side_of_line(cx, cy, line.p1, line.p2)
                    self._states[tid][li].confirmed_side = side

                # FIX 4: Deep-inside detection — if this new track is well inside
                # the venue (far from all entry lines, on the inside), count as entry
                if self.lines:
                    all_inside = all(
                        _side_of_line(cx, cy, line.p1, line.p2) == line.entry_side
                        for line in self.lines
                    )
                    far_from_lines = all(
                        _dist_to_line(cx, cy, line.p1, line.p2) > _LINE_PROXIMITY_PX
                        for line in self.lines
                    )
                    if all_inside and far_from_lines and frame_idx > 30:
                        # Person appeared deep inside — probably missed at door
                        primary_line = self.lines[0]
                        self.total_entries += 1
                        primary_line.entries += 1
                        primary_line.hourly_entries[hour] += 1
                        self.hourly_entries[hour] += 1
                        self._states[tid][0].counted_entry = True
                        events.append({
                            "event_type": "entry",
                            "line_id":    primary_line.line_id,
                            "line_label": primary_line.label,
                            "track_id":   tid,
                            "t_sec":      round(t_sec, 3),
                            "frame_idx":  frame_idx,
                            "method":     "deep_inside",
                            "occupancy":  self.net_occupancy,
                        })

            for li, line in enumerate(self.lines):
                state = self._states[tid][li]
                side  = _side_of_line(cx, cy, line.p1, line.p2)

                if side == state.confirmed_side or side == 0:
                    # Still on confirmed side — reset pending
                    state.pending_side  = 0
                    state.pending_dwell = 0
                    continue

                # Accumulate dwell on the new side
                if side != state.pending_side:
                    state.pending_side  = side
                    state.pending_dwell = 1
                else:
                    state.pending_dwell += 1

                if state.pending_dwell < self.stabilize_frames:
                    continue  # not yet stable — may be jitter

                # FIX 2: Velocity direction gate — only count if movement is
                # actually heading toward the target side
                if not self._moving_toward(tid, side, line):
                    # Person is on the new side but not moving toward it —
                    # likely detection noise, not a real crossing. Reset pending.
                    state.pending_side  = 0
                    state.pending_dwell = 0
                    continue

                # Crossing confirmed
                prev = state.confirmed_side
                state.confirmed_side = side
                state.pending_side   = 0
                state.pending_dwell  = 0

                if prev == 0:
                    continue  # first observation, side already set in init

                if side == line.entry_side:
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
                            "method":     "line_crossing",
                            "occupancy":  self.net_occupancy,
                        })

                elif side == -line.entry_side:
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
                            "method":     "line_crossing",
                            "occupancy":  self.net_occupancy,
                        })

        # FIX 3: Occupancy floor — net count can't go below what we can actually see
        self._current_occupancy = self.net_occupancy

        return events

    # ── Internal ──────────────────────────────────────────────────────────────

    def _moving_toward(self, tid: int, target_side: int, line: CountingLine) -> bool:
        """
        Return True if the track's recent velocity is pointing toward target_side.
        Falls back to True when insufficient history (allows counting early crossings).
        """
        hist = list(self._centroid_hist.get(tid, []))
        if len(hist) < _VELOCITY_LOOKBACK:
            return True  # not enough history — give benefit of the doubt

        # Velocity from _VELOCITY_LOOKBACK frames ago to now
        old = hist[-_VELOCITY_LOOKBACK]
        new = hist[-1]
        dx = new[0] - old[0]
        dy = new[1] - old[1]
        if abs(dx) < 1e-3 and abs(dy) < 1e-3:
            return True  # stationary — allow (could be a slow crosser)

        # Line direction vector
        ldx = line.p2[0] - line.p1[0]
        ldy = line.p2[1] - line.p1[1]

        # Cross product of velocity with line direction tells us which side
        # the movement is heading toward (same sign convention as _side_of_line)
        cross = ldx * dy - ldy * dx
        moving_to = 1 if cross > 0 else -1

        return moving_to == target_side

    @property
    def net_occupancy(self) -> int:
        """
        FIX 3: Occupancy = max(entries - exits, visible_in_frame).
        Line-counting errors can't push occupancy below what YOLO actually sees.
        """
        net = max(0, self.total_entries - self.total_exits)
        return max(net, self._frame_visible)

    # ── Summary ───────────────────────────────────────────────────────────────

    def summary(self, total_sec: float) -> Dict[str, Any]:
        per_line = {}
        for line in self.lines:
            per_line[line.line_id] = {
                "label":          line.label,
                "entries":        line.entries,
                "exits":          line.exits,
                "hourly_entries": dict(line.hourly_entries),
                "hourly_exits":   dict(line.hourly_exits),
            }

        peak_hour = (max(self.hourly_entries, key=self.hourly_entries.get)
                     if self.hourly_entries else 0)

        headcount_mode = not self.lines
        return {
            "headcount_mode":     headcount_mode,
            "total_entries":      self.total_entries,
            "total_exits":        self.total_exits,
            "net_occupancy":      self.net_occupancy,
            "peak_occupancy":     self.peak_occupancy,
            "unique_tracks_seen": len(self._seen_tracks),
            "peak_entry_hour":    peak_hour,
            "hourly_entries":     dict(self.hourly_entries),
            "hourly_exits":       dict(self.hourly_exits),
            "per_line":           per_line,
        }
