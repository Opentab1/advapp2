"""
VenueScope — Continuous camera loop daemon.
For each enabled registered camera, automatically queues new segment jobs
as previous segments complete. Runs as a background thread inside the
worker process, or standalone via: python -m core.camera_loop

This is what makes the system feel "real-time":
  - 60-second segments → results appear ~1-2 min after events happen
  - Loops forever until the camera is disabled or the process stops
  - Skips cameras that already have a pending/running job
"""
from __future__ import annotations
import json, time, uuid, threading, logging
from typing import Optional

log = logging.getLogger("camera_loop")

# Occupancy (people_counter) runs every 20 minutes — frees camera bandwidth
# for the high-priority modes: drink_count, bottle_counter, staff_activity, table_turns.
OCCUPANCY_INTERVAL = 1200  # seconds (20 minutes = 3x per hour)


def _recent_job_for_camera(camera_id: str, camera_name: str) -> Optional[dict]:
    """Return the most recent job for this camera if it's still active."""
    from core.database import list_jobs
    all_jobs = list_jobs(200)
    label_prefix = f"📡 {camera_name}"
    for job in all_jobs:
        lbl = job.get("clip_label", "") or ""
        cid = job.get("camera_id", "") or ""
        if (lbl.startswith(label_prefix) or cid == camera_id) \
                and job["status"] in ("pending", "running"):
            return job
    return None


def _parse_modes(mode_str: str) -> tuple[str, list[str]]:
    """Parse comma-separated mode string into (primary_mode, extra_modes)."""
    parts = [m.strip() for m in (mode_str or "drink_count").split(",") if m.strip()]
    if not parts:
        return "drink_count", []
    return parts[0], parts[1:]


def _launch_segment(cam: dict, seg_num: int = 0) -> str:
    """Create one segment job for this camera. Returns job_id.
    If segment_seconds == 0, runs continuously (no duration limit)."""
    from core.database import create_job, _raw_update
    jid   = str(uuid.uuid4())[:8]
    label = f"📡 {cam['name']}"
    seg_secs = float(cam.get("segment_seconds", 60))
    continuous = (seg_secs == 0)
    if seg_num > 0 and not continuous:
        label += f" — seg {seg_num}"
    if continuous:
        label += " — 🔴 LIVE"

    primary_mode, extra_modes = _parse_modes(cam.get("mode", "drink_count"))

    extra = {
        "max_seconds": 0 if continuous else seg_secs,
        "extra_modes": extra_modes,   # passed to VenueProcessor
    }
    create_job(
        job_id        = jid,
        analysis_mode = primary_mode,
        shift_id      = cam.get("shift_id"),
        shift_json    = None,
        source_type   = "rtsp",
        source_path   = cam["rtsp_url"],
        model_profile = cam.get("model_profile", "balanced"),
        config_path   = cam.get("config_path"),
        annotate      = False,
        clip_label    = label,
    )
    _raw_update(jid, summary_json=json.dumps({"extra_config": extra}))
    mode_str = "continuous" if continuous else f"{seg_secs:.0f}s"
    log.info(f"[camera_loop] Launched {label} → job {jid} "
             f"({mode_str}, modes={[primary_mode]+extra_modes})")
    return jid


def _effective_cam(cam: dict, last_occupancy_t: float) -> dict:
    """
    Return a copy of cam with people_counter throttled to OCCUPANCY_INTERVAL.
    If it's not yet time for an occupancy run, strip people_counter from modes
    so the segment runs only the high-priority modes (drink_count, bottle_counter,
    staff_activity, table_turns).
    """
    mode_str = cam.get("mode", "drink_count")
    all_modes = [m.strip() for m in mode_str.split(",") if m.strip()]

    if "people_counter" not in all_modes:
        return cam  # nothing to throttle

    elapsed = time.time() - last_occupancy_t
    if elapsed < OCCUPANCY_INTERVAL:
        # Not yet — strip people_counter for this segment
        filtered = [m for m in all_modes if m != "people_counter"]
        if not filtered:
            filtered = ["drink_count"]
        cam = dict(cam)
        cam["mode"] = ",".join(filtered)
    return cam


def _run_camera_loop(cam: dict, stop_event: threading.Event):
    """Continuously process segments for one camera until stop_event is set."""
    camera_id   = cam["camera_id"]
    camera_name = cam["name"]
    seg_num     = 0
    last_occupancy_t = 0.0  # epoch of last people_counter segment launch
    log.info(f"[camera_loop] Starting loop for '{camera_name}' ({camera_id})")

    while not stop_event.is_set():
        try:
            from core.database import get_camera
            # Reload camera config each iteration so changes take effect
            current = get_camera(camera_id)
            if not current or not current.get("enabled", True):
                log.info(f"[camera_loop] '{camera_name}' disabled — stopping loop")
                break

            # Don't launch if one is already running/pending
            active = _recent_job_for_camera(camera_id, camera_name)
            if active:
                log.debug(f"[camera_loop] '{camera_name}' has active job "
                          f"{active['job_id']} ({active['status']}) — waiting")
                stop_event.wait(10)
                continue

            # Apply occupancy throttle — people_counter only every 20 minutes
            effective = _effective_cam(current, last_occupancy_t)
            all_effective_modes = [m.strip() for m in effective.get("mode","").split(",") if m.strip()]
            if "people_counter" in all_effective_modes:
                last_occupancy_t = time.time()
                mins_next = OCCUPANCY_INTERVAL / 60
                log.info(f"[camera_loop] '{camera_name}' — occupancy run included "
                         f"(next in {mins_next:.0f} min)")
            elif "people_counter" in (current.get("mode","") or ""):
                remaining = int((OCCUPANCY_INTERVAL - (time.time() - last_occupancy_t)) / 60)
                log.debug(f"[camera_loop] '{camera_name}' — occupancy skipped "
                          f"({remaining}m until next run)")

            # Launch next segment (or continuous job)
            seg_num += 1
            _launch_segment(effective, seg_num)

            seg_secs = float(current.get("segment_seconds", 60))
            if seg_secs == 0:
                # Continuous mode: just poll every 10s to see if the job ended
                # (stream disconnect) so we can relaunch immediately
                stop_event.wait(10)
            else:
                # Segmented mode: wait roughly the segment duration before queuing
                # the next one — avoids flooding the job queue.
                waited = 0.0
                while waited < seg_secs and not stop_event.is_set():
                    stop_event.wait(min(5, seg_secs - waited))
                    waited += 5

        except Exception as e:
            log.error(f"[camera_loop] Error in loop for '{camera_name}': {e}")
            stop_event.wait(15)

    log.info(f"[camera_loop] Loop stopped for '{camera_name}'")


class CameraLoopManager:
    """
    Manages per-camera background threads.
    Call start_all() on boot, then call sync() periodically to pick up
    camera config changes (new cameras, disabled cameras).
    """

    def __init__(self):
        self._threads: dict[str, threading.Thread] = {}
        self._stops:   dict[str, threading.Event]  = {}
        self._lock     = threading.Lock()

    def sync(self):
        """Start loops for enabled cameras; stop loops for disabled/removed ones."""
        from core.database import list_cameras
        try:
            cameras = list_cameras()
        except Exception as e:
            log.warning(f"[camera_loop] sync: could not list cameras: {e}")
            return

        enabled_ids = {c["camera_id"] for c in cameras if c.get("enabled", True)}

        with self._lock:
            # Stop loops for cameras that are no longer enabled
            for cid in list(self._threads.keys()):
                if cid not in enabled_ids:
                    log.info(f"[camera_loop] Stopping loop for removed/disabled camera {cid}")
                    self._stops[cid].set()
                    self._threads.pop(cid, None)
                    self._stops.pop(cid, None)

            # Start loops for new enabled cameras
            for cam in cameras:
                cid = cam["camera_id"]
                if not cam.get("enabled", True):
                    continue
                if cid in self._threads and self._threads[cid].is_alive():
                    continue  # already running
                stop = threading.Event()
                t    = threading.Thread(
                    target=_run_camera_loop,
                    args=(cam, stop),
                    daemon=True,
                    name=f"cam-{cid}",
                )
                self._stops[cid]   = stop
                self._threads[cid] = t
                t.start()
                log.info(f"[camera_loop] Started loop thread for '{cam['name']}'")

    def stop_all(self):
        with self._lock:
            for stop in self._stops.values():
                stop.set()
            self._threads.clear()
            self._stops.clear()

    def status(self) -> list[dict]:
        with self._lock:
            return [
                {"camera_id": cid, "alive": t.is_alive()}
                for cid, t in self._threads.items()
            ]


# Module-level singleton used by worker_daemon.py
_manager: Optional[CameraLoopManager] = None


def get_manager() -> CameraLoopManager:
    global _manager
    if _manager is None:
        _manager = CameraLoopManager()
    return _manager


if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    mgr = get_manager()
    mgr.sync()
    log.info("Camera loop manager running. Ctrl-C to stop.")
    try:
        while True:
            time.sleep(30)
            mgr.sync()  # pick up config changes
    except KeyboardInterrupt:
        mgr.stop_all()
