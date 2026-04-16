"""
VenueScope — Configuration, model profiles, analysis modes.
"""
from __future__ import annotations
import os
from pathlib import Path
from dataclasses import dataclass
from typing import Dict, Any

os.environ.setdefault("YOLO_TELEMETRY", "False")
os.environ.setdefault("STREAMLIT_BROWSER_GATHERUSAGESTATS", "false")

BASE_DIR   = Path(__file__).resolve().parent.parent
DATA_DIR   = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
RESULT_DIR = DATA_DIR / "results"
CONFIG_DIR = DATA_DIR / "configs"
DB_PATH    = DATA_DIR / "venuescope.db"

for _d in (UPLOAD_DIR, RESULT_DIR, CONFIG_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ── Analysis modes ─────────────────────────────────────────────────────────
ANALYSIS_MODES = {
    "drink_count":    "🍺 Drink Count",
    "bottle_count":   "🍾 Bottle Count",
    "people_count":   "🚶 People Count",
    "table_turns":    "🪑 Table Turns",
    "table_service":  "🛎 Table Service",
    "staff_activity": "👷 Staff Activity",
    "after_hours":    "🔒 After Hours Motion",
}

# Modes temporarily disabled — code is intact, worker will not run them.
# Re-enable by removing mode keys from this set.
# ETA: ~3 weeks. Focus is drink/bottle detection and theft prevention.
DISABLED_MODES: set = {"people_count", "table_turns", "table_service"}

ANALYSIS_DESCRIPTIONS = {
    "drink_count":    "Bar overhead camera. Counts drinks made per bartender. Compare against POS to flag theft.",
    "bottle_count":   "Back bar or shelf camera. Counts bottles and glasses — tracks inventory usage and pours per bottle.",
    "people_count":   "Entrance or dining room camera. Counts people in/out, tracks occupancy curve and peak hours.",
    "table_turns":    "Dining floor camera. Detects table occupancy, measures turn times and customer dwell time.",
    "table_service":  "Dining floor camera. Tracks every server visit per table — including pass-by greetings. Alerts on unvisited tables.",
    "staff_activity": "Any camera. Measures staff headcount, idle time, and activity levels across the shift.",
    "after_hours":    "Storage, back bar, or walk-in camera. Detects motion outside service hours and logs access.",
}

# YOLO COCO class IDs for bottle counting
BOTTLE_CLASSES = [39, 40, 41]   # bottle, wine_glass, cup
BOTTLE_CLASS_NAMES = {39: "bottle", 40: "wine_glass", 41: "cup"}

# ── Model profiles ─────────────────────────────────────────────────────────
MODEL_PROFILES: Dict[str, Dict[str, Any]] = {
    "fast": {
        "model":   "yolov8n.pt",
        "imgsz":   480,
        "conf":    0.35,
        "iou":     0.45,
        "stride":  3,
        "tracker": "bytetrack.yaml",
    },
    "balanced": {
        "model":   "yolov8s.pt",
        "imgsz":   640,
        "conf":    0.30,
        "iou":     0.45,
        # stride=3: process every 3rd frame — at 2-4fps NVR streams this is
        # still ~1-1.5 inferences/sec which is sufficient for serve detection
        # (serves take 3-5 seconds). Saves ~33% CPU vs stride=2.
        "stride":  3,
        "tracker": "bytetrack.yaml",
    },
    "accurate": {
        "model":   "yolov8m.pt",
        "imgsz":   640,
        "conf":    0.25,
        "iou":     0.40,
        # stride=2: at 2fps NVR input → 1 YOLO inference/sec. Serves take
        # 3-8 seconds to complete — stride=2 captures all of them. Saves
        # ~50% CPU vs stride=1 with no accuracy loss at low NVR frame rates.
        "stride":  2,
        "tracker": "bytetrack.yaml",
    },
    "low_quality": {
        "model":   "yolov8m.pt",
        "imgsz":   1280,          # higher res processing extracts more detail
        "conf":    0.18,          # lower threshold to catch partial/blurry detections
        "iou":     0.40,
        "stride":  1,             # every frame — can't afford to miss frames
        "tracker": "bytetrack.yaml",
    },
}

# ── Drink counting rules ────────────────────────────────────────────────────
@dataclass
class DrinkCountRules:
    min_prep_frames:         int   = 8    # frames in zone before counting (prevents cold-start false positives)
    serve_confirm_frames:    int   = 2    # consecutive frames on customer side to confirm
    serve_dwell_frames:      int   = 2    # min frames bartender must dwell on customer side (bilateral crossing)
    serve_cooldown_seconds:  float = 4.0  # min seconds between serves per station — 8s was too long for busy bars doing back-to-back pours
    serve_cooldown_frames:   int   = 48   # computed by engine from serve_cooldown_seconds × effective_fps
    max_track_jump_px:       float = 150.0
    occlusion_iou_threshold: float = 0.25
    reappear_grace_frames:   int   = 100  # hold track state ~5s after disappearance
    min_serve_conf:          float = 0.30 # min avg detection conf during crossing to count as high-confidence
    # A1
    velocity_window_frames:  int   = 5     # frames back to measure crossing velocity
    max_cross_velocity_px:   float = 80.0  # px/frame — reject serve if faster than this
    # A4
    # (serve_cooldown_seconds already exists — A4 reuses it for time-based floor)
    # A5
    min_serve_score:         float = 0.35  # serves below this go to review bucket

@dataclass
class PeopleCountRules:
    min_track_age_frames: int   = 5
    entry_line_confirm:   int   = 3
    exit_line_confirm:    int   = 3

@dataclass
class TableRules:
    occupied_conf_frames:  int   = 30
    empty_conf_frames:     int   = 60
    min_dwell_seconds:     float = 300.0

@dataclass
class StaffRules:
    idle_threshold_seconds:  float = 120.0
    activity_window_seconds: float = 300.0

DEFAULT_RULES        = DrinkCountRules()
DEFAULT_PEOPLE_RULES = PeopleCountRules()
DEFAULT_TABLE_RULES  = TableRules()
DEFAULT_STAFF_RULES  = StaffRules()
