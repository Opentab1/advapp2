"""
VenueScope — Camera health monitor.
Tracks last-seen timestamp per camera. Triggers alerts when cameras go offline.
State persisted to ~/.venuescope/camera_health.json.
"""
from __future__ import annotations
import time, json, os
from pathlib import Path
from typing import Dict, Optional

_DATA_DIR = Path(os.environ.get("VENUESCOPE_DATA_DIR",
                                str(Path.home() / ".venuescope")))
_HEALTH_FILE = _DATA_DIR / "camera_health.json"
_OFFLINE_THRESHOLD = float(os.environ.get("CAMERA_OFFLINE_THRESHOLD_SEC", "600"))  # 10 min

_health: Dict[str, dict] = {}
_alerted: Dict[str, float] = {}   # camera_id -> last alert timestamp
_loaded = False


def _load():
    global _health, _loaded
    if _loaded:
        return
    try:
        if _HEALTH_FILE.exists():
            _health = json.loads(_HEALTH_FILE.read_text())
    except Exception:
        _health = {}
    _loaded = True


def _save():
    try:
        _HEALTH_FILE.parent.mkdir(parents=True, exist_ok=True)
        _HEALTH_FILE.write_text(json.dumps(_health, indent=2))
    except Exception:
        pass


def record_frame(camera_id: str, camera_label: str = ""):
    """Call after every successfully captured segment from a camera."""
    _load()
    _health[camera_id] = {
        "camera_id":            camera_id,
        "label":                camera_label or camera_id,
        "last_seen":            time.time(),
        "status":               "online",
        "consecutive_failures": 0,
    }
    _save()


def record_failure(camera_id: str, camera_label: str = ""):
    """Call when a camera segment fails to capture or process."""
    _load()
    existing = _health.get(camera_id, {})
    failures = existing.get("consecutive_failures", 0) + 1
    _health[camera_id] = {
        "camera_id":            camera_id,
        "label":                camera_label or camera_id,
        "last_seen":            existing.get("last_seen", 0),
        "status":               "failing" if failures < 5 else "offline",
        "consecutive_failures": failures,
        "last_failure":         time.time(),
    }
    _save()


def get_offline_cameras() -> list:
    """Return cameras that haven't been seen in > OFFLINE_THRESHOLD seconds."""
    _load()
    now = time.time()
    return [
        info for info in _health.values()
        if now - info.get("last_seen", 0) > _OFFLINE_THRESHOLD
    ]


def check_and_alert():
    """Check for offline cameras; send alert at most once per hour per camera."""
    for cam in get_offline_cameras():
        cam_id = cam["camera_id"]
        if time.time() - _alerted.get(cam_id, 0) < 3600:
            continue
        try:
            from core.alerts import send_camera_offline_alert
            send_camera_offline_alert(cam_id, cam.get("label", cam_id),
                                      cam.get("last_seen", 0))
            _alerted[cam_id] = time.time()
        except Exception as e:
            print(f"[camera_health] Alert failed for {cam_id}: {e}", flush=True)


def get_all_status() -> Dict[str, dict]:
    """Return current health status for all known cameras."""
    _load()
    return dict(_health)


def get_camera_status(camera_id: str) -> Optional[dict]:
    _load()
    return _health.get(camera_id)
