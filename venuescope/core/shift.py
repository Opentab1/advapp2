"""
VenueScope — Shift assignment: maps track IDs to named bartenders.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, Optional, List, Any
import time

BARTENDER_COLORS = [
    "#f97316", "#22c55e", "#38bdf8", "#a78bfa",
    "#f43f5e", "#facc15", "#2dd4bf", "#fb7185",
]


@dataclass
class BartenderRecord:
    name:             str
    color:            str
    station_id:       str
    track_id:         Optional[int]   = None
    assigned_at:      Optional[float] = None
    total_drinks:     int             = 0
    drink_timestamps: List[float]     = field(default_factory=list)
    drink_scores:     List[float]     = field(default_factory=list)
    hourly_counts:    Dict[int, int]  = field(default_factory=dict)

    def assign_track(self, track_id: int):
        self.track_id    = track_id
        self.assigned_at = time.time()

    def unassign(self):
        self.track_id    = None
        self.assigned_at = None

    def record_drink(self, t_sec: float, serve_score: float = 0.0):
        self.total_drinks += 1
        self.drink_timestamps.append(t_sec)
        self.drink_scores.append(round(serve_score, 3))
        bucket = int(t_sec // 3600)
        self.hourly_counts[bucket] = self.hourly_counts.get(bucket, 0) + 1

    def summary(self, total_video_sec: float) -> Dict[str, Any]:
        hrs = max(total_video_sec / 3600, 1 / 60)
        return {
            "name":              self.name,
            "station_id":        self.station_id,
            "total_drinks":      self.total_drinks,
            "drinks_per_hour":   round(self.total_drinks / hrs, 1),
            "hourly_counts":     {f"hour_{k}": v for k, v in sorted(self.hourly_counts.items())},
            "peak_hour_count":   max(self.hourly_counts.values(), default=0),
            "drink_timestamps":  [round(t, 1) for t in self.drink_timestamps],
            "drink_scores":      [round(s, 3) for s in self.drink_scores],
        }


class ShiftManager:
    def __init__(self, shift_id: str, bartenders: List[Dict]):
        self.shift_id = shift_id
        self.records: Dict[str, BartenderRecord] = {}
        seen_names = set()
        for i, b in enumerate(bartenders):
            name = b["name"].strip()
            if not name:
                continue
            # Deduplicate: if same name appears twice, append station to disambiguate
            if name in seen_names:
                name = f"{name} ({b.get('station_id','?')})"
            seen_names.add(name)
            color = b.get("color") or BARTENDER_COLORS[i % len(BARTENDER_COLORS)]
            self.records[name] = BartenderRecord(
                name=name, color=color, station_id=b["station_id"]
            )

    def assign(self, name: str, track_id: int):
        if name not in self.records:
            return
        for rec in self.records.values():
            if rec.track_id == track_id and rec.name != name:
                rec.unassign()
        self.records[name].assign_track(track_id)

    def track_to_bartender(self, track_id: int) -> Optional[BartenderRecord]:
        for rec in self.records.values():
            if rec.track_id == track_id:
                return rec
        return None

    def get_by_station(self, station_id: str) -> Optional[BartenderRecord]:
        for rec in self.records.values():
            if rec.station_id == station_id:
                return rec
        return None

    def record_drink(self, track_id: int, t_sec: float, serve_score: float = 0.0) -> Optional[str]:
        rec = self.track_to_bartender(track_id)
        if rec:
            rec.record_drink(t_sec, serve_score)
            return rec.name
        return None

    def to_dict(self) -> Dict:
        return {
            "shift_id": self.shift_id,
            "bartenders": [
                {"name": r.name, "station_id": r.station_id,
                 "color": r.color, "track_id": r.track_id}
                for r in self.records.values()
            ]
        }

    @classmethod
    def from_dict(cls, d: Dict) -> "ShiftManager":
        sm = cls(d.get("shift_id", "unknown"), d.get("bartenders", []))
        for b in d.get("bartenders", []):
            if b.get("track_id") is not None:
                sm.assign(b["name"], b["track_id"])
        return sm

    def summary(self, total_video_sec: float) -> Dict[str, Any]:
        return {r.name: r.summary(total_video_sec) for r in self.records.values()}
