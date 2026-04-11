"""
VenueScope — Continuous camera loop daemon.
For each enabled registered camera, automatically queues new segment jobs
as previous segments complete. Runs as a background thread inside the
worker process, or standalone via: python -m core.camera_loop

Real-time detection design:
  - 15-second segments → detections write to DB within ~25s of the event
  - drink_count, bottle_counter, staff_activity, table_turns run every segment
  - people_counter throttled to every 20 minutes (3x/hour) — frees resources
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
    """Return the most recent job for this camera (active or most recent of any status)."""
    from core.database import list_jobs
    all_jobs = list_jobs(200)
    label_prefix = f"📡 {camera_name}"
    most_recent = None
    for job in all_jobs:
        lbl = job.get("clip_label", "") or ""
        cid = job.get("camera_id", "") or ""
        if lbl.startswith(label_prefix) or cid == camera_id:
            if job["status"] in ("pending", "running"):
                return job   # active job — return immediately
            if most_recent is None:
                most_recent = job  # track most recent completed/failed
    return most_recent


def _parse_modes(mode_str: str) -> tuple[str, list[str]]:
    """Parse comma-separated mode string into (primary_mode, extra_modes)."""
    parts = [m.strip() for m in (mode_str or "drink_count").split(",") if m.strip()]
    if not parts:
        return "drink_count", []
    return parts[0], parts[1:]


def _launch_segment(cam: dict, seg_num: int = 0) -> str:
    """Create one segment job for this camera. Returns job_id.
    Default segment is 15s for near-real-time detection.
    If segment_seconds == 0, runs continuously (no duration limit)."""
    from core.database import create_job, _raw_update
    jid   = str(uuid.uuid4())[:8]
    label = f"📡 {cam['name']}"
    primary_mode, extra_modes = _parse_modes(cam.get("mode", "drink_count"))
    # drink_count runs continuously by default — segmented clips drop gestures at boundaries.
    # All other modes default to 15s segments.
    default_seg = 0 if primary_mode == "drink_count" else 15
    seg_secs = float(cam.get("segment_seconds", default_seg))
    continuous = (seg_secs == 0)
    if seg_num > 0 and not continuous:
        label += f" — seg {seg_num}"
    if continuous:
        label += " — 🔴 LIVE"

    # Drink detection needs at least 'balanced' (yolov8s) — 'fast' (yolov8n) misses
    # bartenders on overhead fisheye IR cameras. Upgrade silently if set to fast.
    model_profile = cam.get("model_profile", "balanced")
    if primary_mode == "drink_count" and model_profile == "fast":
        model_profile = "balanced"
        log.info(f"[camera_loop] '{cam['name']}' upgraded to balanced profile for drink_count")

    extra = {
        "max_seconds":     0 if continuous else seg_secs,
        "extra_modes":     extra_modes,
        # Per-camera venue — multi-venue worker posts to the right DDB partition
        "venue_id":        cam.get("venue", ""),
        # Camera identity — used by worker to load/save cross-segment state
        "camera_id":       cam.get("camera_id", ""),
        # Per-camera people-count tuning (overrides global BLOBS_PER_PERSON constant)
        "blobs_per_person": cam.get("blobs_per_person", 0),  # 0 = use default
        # Bar config from DDB zone editor (JSON string); used if no file-based config_path
        "bar_config_json": cam.get("bar_config_json", ""),
    }
    create_job(
        job_id        = jid,
        analysis_mode = primary_mode,
        shift_id      = cam.get("shift_id"),
        shift_json    = None,
        source_type   = "rtsp",
        source_path   = cam["rtsp_url"],
        model_profile = model_profile,
        config_path   = cam.get("config_path"),
        annotate      = False,
        clip_label    = label,
    )
    _raw_update(jid, summary_json=json.dumps({"extra_config": extra}))
    mode_str = "continuous" if continuous else f"{seg_secs:.0f}s"
    log.info(f"[camera_loop] Launched {label} → job {jid} "
             f"({mode_str}, modes={[primary_mode]+extra_modes})")
    return jid


_PEOPLE_MODES = {"people_count", "people_counter"}  # both spellings


def _is_people_only(cam: dict) -> bool:
    """True if this camera runs people_count and nothing else."""
    modes = {m.strip() for m in cam.get("mode", "").split(",") if m.strip()}
    modes |= set(cam.get("extra_modes") or [])
    return bool(modes) and modes.issubset(_PEOPLE_MODES)


def _effective_cam(cam: dict, last_occupancy_t: float) -> dict:
    """
    Return a copy of cam with people_count throttled to OCCUPANCY_INTERVAL.
    - For cameras that mix drink/bottle + people_count: strip people_count from
      extra_modes when it's not yet time, so the segment still runs the primary mode.
    - For people_count-only cameras: handled by _run_camera_loop via interval wait.
    """
    mode_str  = cam.get("mode", "drink_count")
    all_modes = [m.strip() for m in mode_str.split(",") if m.strip()]

    has_people = any(m in _PEOPLE_MODES for m in all_modes)
    if not has_people:
        return cam  # nothing to throttle

    # people_count-only cameras — throttle is handled via interval sleep, not here
    if _is_people_only(cam):
        return cam

    elapsed = time.time() - last_occupancy_t
    if elapsed < OCCUPANCY_INTERVAL:
        # Not yet — strip people_count for this segment
        filtered = [m for m in all_modes if m not in _PEOPLE_MODES]
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
    last_occupancy_t = 0.0  # epoch of last people_count segment launch
    log.info(f"[camera_loop] Starting loop for '{camera_name}' ({camera_id})")

    while not stop_event.is_set():
        try:
            from core.ddb_cameras import get_camera_ddb
            from core.database import get_camera as get_camera_sqlite
            # Reload camera config each iteration — prefer DDB so app changes take effect
            current = get_camera_ddb(camera_id) or get_camera_sqlite(camera_id)
            if not current or not current.get("enabled", True):
                log.info(f"[camera_loop] '{camera_name}' disabled — stopping loop")
                break

            # Don't launch if one is already running/pending; back off if last job failed
            recent = _recent_job_for_camera(camera_id, camera_name)
            if recent:
                if recent["status"] in ("pending", "running"):
                    log.debug(f"[camera_loop] '{camera_name}' has active job "
                              f"{recent['job_id']} ({recent['status']}) — waiting")
                    stop_event.wait(10)
                    continue
                if recent["status"] == "failed":
                    log.warning(f"[camera_loop] '{camera_name}' last job failed "
                                f"— waiting 60s before retry")
                    stop_event.wait(60)
                    # fall through to launch new segment after wait

            # people_count-only cameras: wait OCCUPANCY_INTERVAL between snapshots
            if _is_people_only(current):
                elapsed = time.time() - last_occupancy_t
                if last_occupancy_t > 0 and elapsed < OCCUPANCY_INTERVAL:
                    wait_secs = OCCUPANCY_INTERVAL - elapsed
                    log.info(f"[camera_loop] '{camera_name}' — people_count next "
                             f"in {wait_secs/60:.0f}m, sleeping")
                    stop_event.wait(wait_secs)
                    continue
                last_occupancy_t = time.time()
                log.info(f"[camera_loop] '{camera_name}' — people_count snapshot "
                         f"(next in {OCCUPANCY_INTERVAL//60}m)")
                try:
                    from core.ddb_cameras import update_camera_next_occupancy
                    venue_id = current.get("venue", "")
                    if venue_id:
                        update_camera_next_occupancy(venue_id, camera_id,
                                                     last_occupancy_t + OCCUPANCY_INTERVAL)
                except Exception:
                    pass

            # Apply mixed-mode occupancy throttle (drink_count + people_count cameras)
            effective = _effective_cam(current, last_occupancy_t)
            all_effective_modes = [m.strip() for m in effective.get("mode","").split(",") if m.strip()]
            if any(m in _PEOPLE_MODES for m in all_effective_modes) and not _is_people_only(current):
                last_occupancy_t = time.time()
                log.info(f"[camera_loop] '{camera_name}' — mixed occupancy run "
                         f"(next in {OCCUPANCY_INTERVAL//60}m)")
                try:
                    from core.ddb_cameras import update_camera_next_occupancy
                    venue_id = current.get("venue", "")
                    if venue_id:
                        update_camera_next_occupancy(venue_id, camera_id,
                                                     last_occupancy_t + OCCUPANCY_INTERVAL)
                except Exception:
                    pass
            elif any(m in _PEOPLE_MODES for m in (current.get("mode","") or "").split(",")) \
                    and not _is_people_only(current):
                remaining = int((OCCUPANCY_INTERVAL - (time.time() - last_occupancy_t)) / 60)
                log.debug(f"[camera_loop] '{camera_name}' — occupancy skipped "
                          f"({remaining}m until next run)")

            # Queue depth throttle — don't pile up more than 3 pending segments
            # per camera (happens when processing is slower than real-time)
            try:
                from core.database import list_jobs_by_status
                pending_all = list_jobs_by_status("pending", limit=200)
                label_prefix = f"📡 {camera_name}"
                pending_this_cam = [
                    j for j in pending_all
                    if (j.get("clip_label") or "").startswith(label_prefix)
                    or j.get("camera_id") == camera_id
                ]
                if len(pending_this_cam) >= 3:
                    log.info(f"[camera_loop] '{camera_name}' — {len(pending_this_cam)} segments "
                             f"already pending, skipping new segment (backlog relief)")
                    stop_event.wait(seg_secs if seg_secs > 0 else 15)
                    continue
            except Exception:
                pass

            # Launch next segment (or continuous job)
            seg_num += 1
            _launch_segment(effective, seg_num)

            seg_secs    = float(current.get("segment_seconds", 15))
            # interval_seconds: how long to wait BETWEEN clips (defaults to seg_secs).
            # Set interval > seg_secs to run a short clip on a longer schedule,
            # e.g. seg_secs=30, interval_seconds=1200 → 30s snapshot every 20 min.
            interval_secs = float(current.get("interval_seconds") or seg_secs)

            if seg_secs == 0:
                # Continuous mode: poll every 10s to see if the job ended
                # (stream disconnect) so we can relaunch immediately
                stop_event.wait(10)
            else:
                # Segmented mode: wait interval_seconds before queuing the next clip.
                if interval_secs != seg_secs:
                    log.info(f"[camera_loop] '{camera_name}' — next segment in "
                             f"{interval_secs/60:.1f} min")
                waited = 0.0
                while waited < interval_secs and not stop_event.is_set():
                    stop_event.wait(min(30, interval_secs - waited))
                    waited += 30

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
        """Start loops for enabled cameras; stop loops for disabled/removed ones.
        Prefers DynamoDB (managed from the React admin app); falls back to SQLite."""
        from core.ddb_cameras import list_cameras_ddb
        from core.database import list_cameras as list_cameras_sqlite
        try:
            cameras = list_cameras_ddb()
            if not cameras:
                # DDB table not yet created or no cameras there — use SQLite registry
                cameras = list_cameras_sqlite()
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
