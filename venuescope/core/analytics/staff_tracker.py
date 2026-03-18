"""
VenueScope — Staff activity tracker + After-hours motion detector.

Fixes from audit:
  - idle/active seconds now correctly accumulate using dt between frames
  - dt no longer reads pixel x-coord as a timestamp
  - after-hours person detection wired correctly (YOLO runs separately)
"""
from __future__ import annotations
from typing import List, Dict, Any, Tuple, Optional
import numpy as np


# ── Staff Activity ──────────────────────────────────────────────────────────

class _StaffTrack:
    def __init__(self, tid: int, t_sec: float, cx: float, cy: float):
        self.tid               = tid
        self.first_seen        = t_sec
        self.last_seen         = t_sec   # updated AFTER dt is computed
        self.last_cx           = cx
        self.last_cy           = cy
        self.idle_seconds      = 0.0
        self.active_seconds    = 0.0
        self.last_move_t       = t_sec
        self.idle_threshold    = 120.0
        self.move_threshold_px = 15.0

    def update(self, t_sec: float, cx: float, cy: float):
        # dt = time since we last saw this person
        dt   = max(0.0, t_sec - self.last_seen)
        dist = ((cx - self.last_cx) ** 2 + (cy - self.last_cy) ** 2) ** 0.5

        if dist < self.move_threshold_px:
            self.idle_seconds   += dt
        else:
            self.active_seconds += dt
            self.last_move_t     = t_sec

        # Update AFTER computing dt
        self.last_seen = t_sec
        self.last_cx   = cx
        self.last_cy   = cy

    def is_currently_idle(self, t_sec: float) -> bool:
        return (t_sec - self.last_move_t) > self.idle_threshold


class StaffActivityTracker:
    def __init__(self, idle_threshold_sec: float = 120.0):
        self.idle_threshold = idle_threshold_sec
        self._tracks: Dict[int, _StaffTrack] = {}
        self.events:  List[Dict] = []
        self._peak_count = 0
        self.headcount_log: List[Tuple[float, int]] = []

    def update(self, frame_idx: int, t_sec: float,
               centroids: np.ndarray, track_ids: List[int]) -> List[Dict]:
        evs           = []
        current_count = len(track_ids)
        self._peak_count = max(self._peak_count, current_count)

        if frame_idx % 10 == 0:
            self.headcount_log.append((round(t_sec, 1), current_count))

        for i, tid in enumerate(track_ids):
            if i >= len(centroids):
                continue
            cx, cy = float(centroids[i][0]), float(centroids[i][1])

            if tid not in self._tracks:
                t = _StaffTrack(tid, t_sec, cx, cy)
                t.idle_threshold = self.idle_threshold
                self._tracks[tid] = t
            else:
                self._tracks[tid].update(t_sec, cx, cy)

        return evs

    def summary(self, total_sec: float) -> Dict[str, Any]:
        tracks      = list(self._tracks.values())
        idle_now    = sum(1 for t in tracks if t.is_currently_idle(total_sec))
        total_staff = len(tracks)

        avg_idle_pct = 0.0
        if tracks:
            idle_fracs = []
            for t in tracks:
                on_screen = max(t.last_seen - t.first_seen, 0.001)
                idle_fracs.append(min(1.0, t.idle_seconds / on_screen))
            avg_idle_pct = round(float(np.mean(idle_fracs)) * 100, 1)

        return {
            "total_unique_staff": total_staff,
            "peak_headcount":     self._peak_count,
            "currently_idle":     idle_now,
            "avg_idle_pct":       avg_idle_pct,
            "staff_details": [
                {
                    "track_id":        t.tid,
                    "first_seen_sec":  round(t.first_seen, 1),
                    "last_seen_sec":   round(t.last_seen, 1),
                    "idle_seconds":    round(t.idle_seconds, 1),
                    "active_seconds":  round(t.active_seconds, 1),
                    "idle_pct": round(
                        100 * t.idle_seconds /
                        max(t.last_seen - t.first_seen, 0.001), 1
                    ),
                }
                for t in tracks
            ]
        }


# ── After Hours Motion ──────────────────────────────────────────────────────

class AfterHoursDetector:
    """
    Motion detection for storage/back bar cameras during non-service hours.
    Uses frame differencing.
    Person detection is passed in from the engine (YOLO runs separately
    in after_hours mode via the engine's use_yolo flag — see engine.py).
    """
    def __init__(self, motion_threshold: float = 1500.0):
        self.motion_threshold    = motion_threshold
        self._prev_gray          = None
        self.motion_events:      List[Dict] = []
        self.access_log:         List[Dict] = []
        self._motion_frame_count = 0
        self._total_frames       = 0
        self._in_motion_burst    = False
        self._burst_start_t      = 0.0
        self.person_detections   = 0

    def update_frame(self, frame_idx: int, t_sec: float,
                     frame_gray: np.ndarray,
                     persons_detected: int = 0) -> List[Dict]:
        import cv2
        self._total_frames += 1
        evs = []

        if persons_detected > 0:
            self.person_detections += persons_detected
            self.access_log.append({
                "t_sec":     round(t_sec, 1),
                "persons":   persons_detected,
                "frame_idx": frame_idx,
            })

        if self._prev_gray is None:
            self._prev_gray = frame_gray
            return []

        diff  = cv2.absdiff(self._prev_gray, frame_gray)
        score = float(diff.mean() * diff.shape[0] * diff.shape[1] / 1000)
        self._prev_gray = frame_gray

        if score > self.motion_threshold:
            self._motion_frame_count += 1
            if not self._in_motion_burst:
                self._in_motion_burst = True
                self._burst_start_t   = t_sec
                ev = {
                    "event_type":   "motion_start",
                    "t_sec":        round(t_sec, 1),
                    "motion_score": round(score, 1),
                    "frame_idx":    frame_idx,
                }
                self.motion_events.append(ev)
                evs.append(ev)
        else:
            if self._in_motion_burst:
                self._in_motion_burst = False
                ev = {
                    "event_type":   "motion_end",
                    "t_sec":        round(t_sec, 1),
                    "duration_sec": round(t_sec - self._burst_start_t, 1),
                    "frame_idx":    frame_idx,
                }
                self.motion_events.append(ev)
                evs.append(ev)

        return evs

    def summary(self) -> Dict[str, Any]:
        motion_pct = round(
            100 * self._motion_frame_count / max(self._total_frames, 1), 1)
        bursts = [e for e in self.motion_events if e["event_type"] == "motion_start"]
        return {
            "total_motion_events":  len(bursts),
            "motion_pct_of_clip":   motion_pct,
            "person_detections":    self.person_detections,
            "access_log_entries":   len(self.access_log),
            "motion_events":        self.motion_events,
            "access_log":           self.access_log,
        }
