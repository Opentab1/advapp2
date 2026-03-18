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
    zone_id:       str
    label:         str
    polygon:       List[Point]
    bar_line_p1:   Point
    bar_line_p2:   Point
    customer_side: int = -1   # -1 = top/left (customer), +1 = bottom/right


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
        required = {"venue_id", "display_name"}
        missing = required - set(d.keys())
        if missing:
            raise ValueError(f"Bar config for '{venue_id}' missing required fields: {missing}")
        try:
            stations = [BarStation(**s) for s in d.pop("stations", [])]
        except (TypeError, KeyError) as e:
            raise ValueError(f"Corrupt bar config for venue '{venue_id}': {e}. "
                             f"Delete {path} and reconfigure in Zone Layout.") from e
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
