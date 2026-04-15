"""
VenueScope — Output writer: events.csv, timeseries.csv, summary.json

Fixed:
  - add_frame was O(n²): looped all events every frame to count recent ones.
    On a 4-hour clip at 25fps with 300+ events = 108M iterations → freeze.
    Now O(1) using a deque sliding window.
  - timeseries only written every 30 frames (not every frame) to keep
    snapshots list small and avoid memory buildup on long recordings.
"""
from __future__ import annotations
import csv, json
from collections import deque
from pathlib import Path
from typing import List, Dict, Any, Optional, Deque
import numpy as np

from core.shift import ShiftManager

_WRITE_EVERY = 30   # only record a timeseries sample every N processed frames


class ResultWriter:
    def __init__(self, job_id: str, result_dir: Path, fps: float, is_live: bool = False):
        self.job_id       = job_id
        self.result_dir   = Path(result_dir)
        self.fps          = max(fps, 1.0)
        # Live RTSP streams: skip local CSV files — data lives in DDB/S3.
        self.is_live      = is_live
        self._events:     List[Dict]  = []
        self._snapshots:  List[Dict]  = []
        # Sliding window of event t_sec values for the last 60s — O(1) recent count
        self._recent_win: Deque[float] = deque()
        self._frame_n = 0

    def add_event(self, ev: Dict):
        self._events.append(ev)
        t = ev.get("t_sec", 0.0)
        self._recent_win.append(t)

    def add_frame(self, t_sec: float, shift: Optional[ShiftManager]):
        self._frame_n += 1
        if self._frame_n % _WRITE_EVERY != 0:
            return

        # Evict events older than 60s from the sliding window
        cutoff = t_sec - 60.0
        while self._recent_win and self._recent_win[0] < cutoff:
            self._recent_win.popleft()

        total = 0
        if shift:
            total = sum(r.total_drinks for r in shift.records.values())

        self._snapshots.append({
            "t_sec":     round(t_sec, 2),
            "count":     total,
            "rate_1min": len(self._recent_win),
        })

    def write_all(self, summary: Dict[str, Any]):
        self._write_events()
        self._write_timeseries()
        self._write_summary(summary)

    def _write_events(self):
        if not self._events or self.is_live:
            return
        path = self.result_dir / "events.csv"
        keys = sorted({k for ev in self._events for k in ev.keys()})
        with open(path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["job_id"] + keys,
                               extrasaction="ignore")
            w.writeheader()
            for ev in self._events:
                row = {"job_id": self.job_id}
                row.update(ev)
                w.writerow(row)

    def _write_timeseries(self):
        if not self._snapshots or self.is_live:
            return
        path = self.result_dir / "timeseries.csv"
        with open(path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["t_sec", "count", "rate_1min"])
            w.writeheader()
            for s in self._snapshots:
                w.writerow(s)

    def _write_summary(self, summary: Dict):
        def _clean(d):
            if isinstance(d, dict):       return {k: _clean(v) for k, v in d.items()}
            if isinstance(d, list):       return [_clean(v) for v in d]
            if isinstance(d, np.integer): return int(d)
            if isinstance(d, np.floating):return float(d)
            if isinstance(d, tuple):      return list(d)
            return d
        path = self.result_dir / "summary.json"
        path.write_text(json.dumps(_clean(summary), indent=2))
