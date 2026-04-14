"""
VenueScope — People counter / occupancy tracker.

Mode: periodic snapshot headcount
──────────────────────────────────
Rather than counting line crossings (which accumulate error over a shift),
this counter takes a stable headcount snapshot every N minutes by averaging
ByteTrack's active IDs over a short rolling window.

Why this is more accurate than line crossing:
  - Overhead fisheye sees the entire room — no blind spots at entry/exit
  - ByteTrack keeps IDs stable across frames; the active-ID count is a
    reliable in-room estimate
  - Periodic snapshots have no accumulated error — each reading is independent
  - No line calibration required

Snapshot cadence: configurable, default 1200 s (20 min).
Smoothing: 30-frame rolling average before each snapshot to absorb
           single-frame detection misses without distorting the count.

Line-crossing mode is preserved as an opt-in feature for venues that want
entry/exit events (pass lines_config). When no lines are configured (the
default), only headcount snapshots are produced.
"""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Tuple
import numpy as np


# ── Optional line-crossing geometry (used only when lines are configured) ─────

def _side_of_line(px: float, py: float,
                  lp1: Tuple[float, float], lp2: Tuple[float, float]) -> int:
    dx = lp2[0] - lp1[0]; dy = lp2[1] - lp1[1]
    cross = dx * (py - lp1[1]) - dy * (px - lp1[0])
    return 1 if cross > 0 else (-1 if cross < 0 else 0)


@dataclass
class CountingLine:
    line_id:    str
    label:      str
    p1:         Tuple[float, float]
    p2:         Tuple[float, float]
    entry_side: int
    entries:    int = 0
    exits:      int = 0
    hourly_entries: Dict[int, int] = field(default_factory=lambda: defaultdict(int))
    hourly_exits:   Dict[int, int] = field(default_factory=lambda: defaultdict(int))


class _TrackLineState:
    __slots__ = ("confirmed_side", "counted_entry", "counted_exit",
                 "pending_side", "pending_dwell")
    def __init__(self):
        self.confirmed_side: int  = 0
        self.counted_entry:  bool = False
        self.counted_exit:   bool = False
        self.pending_side:   int  = 0
        self.pending_dwell:  int  = 0


# ── Headcount counter ─────────────────────────────────────────────────────────

_DEFAULT_SNAPSHOT_INTERVAL_SEC = 1200   # 20 minutes
_SMOOTH_FRAMES                 = 30     # rolling-average window before snapshot


class PeopleCounter:
    """
    Periodic-snapshot headcount counter.

    Parameters
    ----------
    lines_config : list of dict
        Optional entry/exit counting lines (legacy).  Leave empty (default)
        for pure headcount mode.
    confirm_frames : int
        Frames required to confirm a line crossing (line mode only).
    W, H : int
        Frame dimensions in pixels.
    stabilize_frames : int
        Additional dwell frames before committing a line crossing.
    snapshot_interval_sec : float
        How often to record a headcount snapshot.  Default 1200 s (20 min).
    smooth_frames : int
        Rolling window size for count smoothing before each snapshot.
    """

    def __init__(self,
                 lines_config: List[Dict],
                 confirm_frames: int,
                 W: int, H: int,
                 stabilize_frames: int = 12,
                 snapshot_interval_sec: float = _DEFAULT_SNAPSHOT_INTERVAL_SEC,
                 smooth_frames: int = _SMOOTH_FRAMES):
        self.W = W; self.H = H
        self.confirm_frames        = confirm_frames
        self.stabilize_frames      = stabilize_frames
        self._snapshot_interval    = snapshot_interval_sec
        self._smooth_frames        = max(1, smooth_frames)

        # Build counting lines if provided (optional)
        self.lines: List[CountingLine] = []
        for lc in (lines_config or []):
            p1_px = (lc["p1"][0] * W, lc["p1"][1] * H)
            p2_px = (lc["p2"][0] * W, lc["p2"][1] * H)
            self.lines.append(CountingLine(
                line_id=lc["line_id"],
                label=lc.get("label", lc["line_id"]),
                p1=p1_px, p2=p2_px,
                entry_side=lc.get("entry_side", -1),
            ))
        self._line_states: Dict[int, List[_TrackLineState]] = {}

        # ── Headcount state ────────────────────────────────────────────────
        self._recent_counts: deque = deque(maxlen=self._smooth_frames)
        self._last_snapshot_t: float = -self._snapshot_interval  # fire on first eligible frame
        self.snapshots: List[Dict] = []   # [{t_sec, count, raw_count}]

        self.current_headcount: int = 0
        self.peak_occupancy:    int = 0
        self._seen_tracks:      set = set()

        # Legacy totals (populated only in line mode)
        self.total_entries: int = 0
        self.total_exits:   int = 0
        self.hourly_entries: Dict[int, int] = defaultdict(int)
        self.hourly_exits:   Dict[int, int] = defaultdict(int)
        self.occupancy_log:  List[Tuple[float, int]] = []

    # ── Public ────────────────────────────────────────────────────────────────

    def update(self, frame_idx: int, t_sec: float,
               centroids: np.ndarray, track_ids: List[int]) -> List[Dict]:
        events: List[Dict] = []

        for tid in track_ids:
            self._seen_tracks.add(tid)

        # ── Rolling count + current headcount ─────────────────────────────
        raw_count = len(track_ids)
        self._recent_counts.append(raw_count)
        smoothed = round(sum(self._recent_counts) / len(self._recent_counts))
        self.current_headcount = smoothed
        self.peak_occupancy    = max(self.peak_occupancy, smoothed)

        # Lightweight occupancy log every 10 frames
        if frame_idx % 10 == 0:
            self.occupancy_log.append((round(t_sec, 1), smoothed))

        # ── Periodic snapshot ──────────────────────────────────────────────
        if t_sec - self._last_snapshot_t >= self._snapshot_interval:
            snap = {
                "t_sec":     round(t_sec, 1),
                "count":     smoothed,
                "raw_count": raw_count,
            }
            self.snapshots.append(snap)
            self._last_snapshot_t = t_sec
            events.append({
                "event_type": "headcount_snapshot",
                "t_sec":      snap["t_sec"],
                "count":      snap["count"],
                "frame_idx":  frame_idx,
            })

        # ── Line-crossing (opt-in, only when lines configured) ────────────
        if self.lines:
            events += self._update_lines(frame_idx, t_sec, centroids, track_ids)

        return events

    # ── Summary ───────────────────────────────────────────────────────────────

    def summary(self, total_sec: float) -> Dict[str, Any]:
        headcount_mode = not self.lines
        peak_hour = (max(self.hourly_entries, key=self.hourly_entries.get)
                     if self.hourly_entries else 0)

        per_line = {}
        for line in self.lines:
            per_line[line.line_id] = {
                "label":          line.label,
                "entries":        line.entries,
                "exits":          line.exits,
                "hourly_entries": dict(line.hourly_entries),
                "hourly_exits":   dict(line.hourly_exits),
            }

        return {
            "headcount_mode":       headcount_mode,
            "snapshot_interval_sec": self._snapshot_interval,
            "snapshots":            self.snapshots,
            "current_headcount":    self.current_headcount,
            "peak_occupancy":       self.peak_occupancy,
            "unique_tracks_seen":   len(self._seen_tracks),
            # Legacy line-mode fields (zero in headcount mode)
            "total_entries":        self.total_entries,
            "total_exits":          self.total_exits,
            "net_occupancy":        max(0, self.total_entries - self.total_exits)
                                    if self.lines else self.current_headcount,
            "peak_entry_hour":      peak_hour,
            "hourly_entries":       dict(self.hourly_entries),
            "hourly_exits":         dict(self.hourly_exits),
            "per_line":             per_line,
        }

    # ── Line-crossing internals (legacy opt-in) ───────────────────────────────

    def _update_lines(self, frame_idx: int, t_sec: float,
                      centroids: np.ndarray, track_ids: List[int]) -> List[Dict]:
        events: List[Dict] = []
        hour = int(t_sec // 3600)

        for i, tid in enumerate(track_ids):
            if i >= len(centroids):
                continue
            cx = float(centroids[i][0])
            cy = float(centroids[i][1])

            if tid not in self._line_states:
                self._line_states[tid] = [_TrackLineState() for _ in self.lines]
                for li, line in enumerate(self.lines):
                    self._line_states[tid][li].confirmed_side = _side_of_line(
                        cx, cy, line.p1, line.p2)

            for li, line in enumerate(self.lines):
                state = self._line_states[tid][li]
                side  = _side_of_line(cx, cy, line.p1, line.p2)

                if side == state.confirmed_side or side == 0:
                    state.pending_side  = 0
                    state.pending_dwell = 0
                    continue

                if side != state.pending_side:
                    state.pending_side  = side
                    state.pending_dwell = 1
                else:
                    state.pending_dwell += 1

                if state.pending_dwell < self.stabilize_frames:
                    continue

                prev = state.confirmed_side
                state.confirmed_side = side
                state.pending_side   = 0
                state.pending_dwell  = 0

                if prev == 0:
                    continue

                if side == line.entry_side:
                    state.counted_exit = False
                    if not state.counted_entry:
                        state.counted_entry = True
                        line.entries       += 1
                        self.total_entries += 1
                        line.hourly_entries[hour] += 1
                        self.hourly_entries[hour] += 1
                        events.append({
                            "event_type": "entry",
                            "line_id":    line.line_id,
                            "line_label": line.label,
                            "track_id":   tid,
                            "t_sec":      round(t_sec, 3),
                            "frame_idx":  frame_idx,
                            "occupancy":  self.current_headcount,
                        })
                elif side == -line.entry_side:
                    state.counted_entry = False
                    if not state.counted_exit:
                        state.counted_exit  = True
                        line.exits         += 1
                        self.total_exits   += 1
                        line.hourly_exits[hour] += 1
                        self.hourly_exits[hour] += 1
                        events.append({
                            "event_type": "exit",
                            "line_id":    line.line_id,
                            "line_label": line.label,
                            "track_id":   tid,
                            "t_sec":      round(t_sec, 3),
                            "frame_idx":  frame_idx,
                            "occupancy":  self.current_headcount,
                        })
        return events
