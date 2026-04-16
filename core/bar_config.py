"""
VenueScope — Bar layout configuration.
Normalized 0-1 coordinates. Saved as JSON per venue.
"""
from __future__ import annotations
import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List, Optional, Tuple
from core.config import CONFIG_DIR

Point = Tuple[float, float]


@dataclass
class BarStation:
    zone_id:          str
    label:            str
    polygon:          List[Point]
    bar_line_p1:      Point
    bar_line_p2:      Point
    customer_side:    int        = -1   # -1 = top/left (customer), +1 = bottom/right
    extra_bar_lines:  List[dict] = field(default_factory=list)  # [{p1,p2,customer_side}, ...]


@dataclass
class BarConfig:
    venue_id:        str
    display_name:    str
    stations:        List[BarStation] = field(default_factory=list)
    frame_width:     Optional[int]    = None
    frame_height:    Optional[int]    = None
    notes:           str              = ""
    overhead_camera: bool             = False   # True for top-down/fisheye ceiling cameras

    def save(self) -> Path:
        path = CONFIG_DIR / f"{self.venue_id}.json"
        path.write_text(json.dumps(asdict(self), indent=2))
        return path

    @classmethod
    def load(cls, venue_id: str) -> Optional["BarConfig"]:
        path = CONFIG_DIR / f"{venue_id}.json"
        if not path.exists():
            return None
        d = json.loads(path.read_text())
        stations_raw = d.pop("stations", [])
        for s in stations_raw:
            s.setdefault("extra_bar_lines", [])
        stations = [BarStation(**s) for s in stations_raw]
        # Tolerate old configs that lack overhead_camera
        d.setdefault("overhead_camera", False)
        obj = cls(**d)
        obj.stations = stations
        return obj

    def to_dict(self) -> dict:
        return asdict(self)


def norm_to_px(p: Point, w: int, h: int) -> Tuple[int, int]:
    return int(p[0] * w), int(p[1] * h)

def station_polygon_px(station: BarStation, w: int, h: int) -> List[Tuple[int, int]]:
    return [norm_to_px(p, w, h) for p in station.polygon]

def bar_line_px(station: BarStation, w: int, h: int):
    return norm_to_px(station.bar_line_p1, w, h), norm_to_px(station.bar_line_p2, w, h)

def all_bar_lines_px(station: BarStation, w: int, h: int) -> List[tuple]:
    """Return list of (p1_px, p2_px, customer_side) for all bar lines on this station."""
    result = [(norm_to_px(station.bar_line_p1, w, h),
               norm_to_px(station.bar_line_p2, w, h),
               station.customer_side)]
    for bl in (station.extra_bar_lines or []):
        result.append((norm_to_px(tuple(bl["p1"]), w, h),
                       norm_to_px(tuple(bl["p2"]), w, h),
                       int(bl["customer_side"])))
    return result
