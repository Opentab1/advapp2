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

# Modes that are temporarily disabled — camera_loop will strip them from every
# job before launch. See core/config.py DISABLED_MODES. Re-enable there.
from core.config import DISABLED_MODES as _DISABLED_MODES

# Occupancy (people_counter) runs every 20 minutes — frees camera bandwidth
# for the high-priority modes: drink_count, bottle_counter, staff_activity.
OCCUPANCY_INTERVAL = 1200  # seconds (20 minutes = 3x per hour)

# Modes that require YOLO inference — these run as continuous jobs and poll every 10s.
_YOLO_MODES = {"drink_count", "bottle_count", "staff_activity", "after_hours",
               "table_turns", "table_service"}


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
    primary_mode, _parsed_extra = _parse_modes(cam.get("mode", "drink_count"))
    # _item_to_camera (DDB source) stores extra modes in cam["extra_modes"] separately
    # from cam["mode"] which only holds the primary mode string. Merge both sources so
    # we don't lose extra modes like "staff_activity" when coming from DDB cameras.
    _cam_extra = [m for m in (cam.get("extra_modes") or [])
                  if m and m != primary_mode and m not in _parsed_extra]
    extra_modes = list(_parsed_extra) + _cam_extra

    # Strip temporarily disabled modes — never launch them. Code stays in repo.
    if primary_mode in _DISABLED_MODES:
        log.info(f"[camera_loop] '{cam.get('name')}' primary mode '{primary_mode}' "
                 f"is disabled — skipping launch")
        return ""
    extra_modes = [m for m in extra_modes if m not in _DISABLED_MODES]
    # YOLO cameras run continuously (max_seconds=0) — with 4+ vCPUs each camera
    # gets its own dedicated core and never needs to yield to other cameras.
    # Continuous mode eliminates segment gaps and cross-segment state fragility.
    # People-only cameras (lightweight, no YOLO) use 20-min snapshots.
    _all_modes = set([primary_mode] + list(extra_modes))
    _needs_yolo = bool(_all_modes & _YOLO_MODES)
    # YOLO cameras: always continuous. Non-YOLO: 15s segments.
    # Ignore segment_seconds from DDB for YOLO cameras — it was set as a workaround
    # for single-CPU deployments and no longer applies with multi-CPU hardware.
    if _needs_yolo:
        seg_secs  = 0   # continuous — never ending
        continuous = True
    else:
        seg_secs   = float(cam.get("segment_seconds", 15))
        continuous = (seg_secs == 0)
    if seg_num > 0 and not continuous:
        label += f" — seg {seg_num} (df{jid})"
    if continuous:
        label += " — 🔴 LIVE"

    # Drink detection: prefer 'accurate' (yolov8m) on GPU for best precision.
    # On CPU-only hosts the engine automatically downgrades overhead cameras to
    # yolov8n@640 so they can run in real-time (see engine.py overhead block).
    # We still set 'accurate' here so GPU hosts get full quality; the engine
    # handles the CPU override internally.
    model_profile = cam.get("model_profile", "balanced")
    if primary_mode == "drink_count" and model_profile in ("fast", "balanced"):
        model_profile = "accurate"
        log.info(f"[camera_loop] '{cam['name']}' upgraded to accurate profile for drink_count")

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
        # Table zone config from DDB zone editor (JSON array of {table_id, label, polygon})
        "tables": json.loads(cam.get("table_zones_json") or "[]"),
        # Per-camera table_rules override. Defaults to DEFAULT_TABLE_RULES on
        # the worker side; use this for bar-stool cams where people may
        # disappear for a few minutes (bathroom) mid-session and for fast
        # drink turnover that should still count as a seated visit.
        # Keys honored by table_turns_runner + TableTurnTracker:
        #   occupied_conf_samples | empty_conf_samples | min_dwell_seconds
        "table_rules": json.loads(cam.get("table_rules_json") or "{}"),
    }
    # Sub-stream swap for non-drink_count jobs.
    # Background: the NVR's residential upstream can't saturate with all 10+
    # cameras pulling /0/ (main stream, 2560×1944 @ ~500 KB/s each). Some jobs
    # starve their RTSP reads and stall, which we saw as CH6/CH7/CH13 stuck
    # in reconnect cascades while CH1–5 stayed live.
    #
    # drink_count NEEDS main-stream resolution — the bartender reach probe
    # relies on full pixel detail. Everything else (table_turns via MOG2
    # motion, table_service centroid-in-polygon, people_count YOLO at imgsz
    # 480) is fine on /1/ (sub-stream, ~704×480 @ ~50 KB/s). 10× bandwidth
    # saving per camera, enough to keep all 10 cams live on one residential
    # connection.
    _source_path = cam["rtsp_url"]
    # Per-camera override: some NVR channels have broken sub-stream encoders
    # (e.g. CH7 drops after ~6 frames on /1/ while /0/ works fine). Setting
    # forceMainStream=True in DDB keeps the cam on /0/ regardless of mode.
    _force_main = bool(cam.get("force_main_stream") or cam.get("forceMainStream"))
    if (primary_mode != "drink_count"
        and not _force_main
        and "/hls/live/" in _source_path
        and "/0/" in _source_path):
        _source_path = _source_path.replace("/0/livetop.mp4", "/1/livetop.mp4")
        log.info(f"[camera_loop] '{cam['name']}' using NVR sub-stream (mode={primary_mode})")
    elif _force_main:
        log.info(f"[camera_loop] '{cam['name']}' forced to main stream (force_main_stream=True)")

    create_job(
        job_id        = jid,
        analysis_mode = primary_mode,
        shift_id      = cam.get("shift_id"),
        shift_json    = None,
        source_type   = "rtsp",
        source_path   = _source_path,
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
    # Merge primary + extras so the filter has the COMPLETE mode set. Without
    # this, a camera with primary=people_count and extras=[table_turns,
    # table_service] sees all_modes=["people_count"] only, the filter strips
    # it, the fallback injects "drink_count" — and the camera launches with a
    # mode it was never configured for (silent mis-launch on CH6/CH13).
    primary_list = [m.strip() for m in cam.get("mode", "drink_count").split(",") if m.strip()]
    extra_list   = list(cam.get("extra_modes") or [])
    all_modes    = primary_list + [m for m in extra_list if m not in primary_list]

    has_people = any(m in _PEOPLE_MODES for m in all_modes)
    if not has_people:
        return cam  # nothing to throttle

    # people_count-only cameras — throttle is handled via interval sleep, not here
    if _is_people_only(cam):
        return cam

    elapsed = time.time() - last_occupancy_t
    if elapsed < OCCUPANCY_INTERVAL:
        # Not yet time for the people_count sample. Strip it but PRESERVE the
        # rest (table_turns, drink_count, whatever the camera actually does).
        # Before, the fallback to ["drink_count"] fired when filtering emptied
        # the list — now that all_modes includes extras, it never does.
        filtered = [m for m in all_modes if m not in _PEOPLE_MODES]
        if not filtered:
            # Truly people_only cam — nothing to run without people_count
            return cam
        cam = dict(cam)
        cam["mode"] = filtered[0]
        # Extras become everything after the new primary
        cam["extra_modes"] = filtered[1:]
    return cam


def _run_camera_loop(cam: dict, stop_event: threading.Event):
    """Continuously process segments for one camera until stop_event is set."""
    camera_id   = cam["camera_id"]
    camera_name = cam["name"]
    seg_num     = 0
    # Each camera gets a deterministic offset (0 to OCCUPANCY_INTERVAL-1 seconds)
    # based on a hash of its ID, so cameras spread evenly across the 20-min window
    # rather than all firing at once. E.g. 15 cameras → one every ~80s across 20 min.
    _cam_offset = hash(camera_id) % OCCUPANCY_INTERVAL
    now = time.time()
    # Find the most recent boundary for THIS camera's schedule
    last_occupancy_t = now - ((now - _cam_offset) % OCCUPANCY_INTERVAL)
    log.info(f"[camera_loop] Starting loop for '{camera_name}' ({camera_id}) "
             f"(schedule offset: {_cam_offset}s within {OCCUPANCY_INTERVAL//60}min window)")
    # Track the last job we launched so we can give it a startup grace period.
    # On a loaded CPU, YOLO jobs can take 20-30s to open the stream and report
    # their first heartbeat. Without this, camera_loop sees the job as "failed"
    # (because it was just-created and got caught by worker startup cleanup) and
    # relaunches, creating duplicate processes.
    _last_launched_job_id: str = ""
    _last_launch_t: float      = 0.0
    _LAUNCH_GRACE_SEC          = 45   # seconds to wait after launch before declaring failure


    while not stop_event.is_set():
        try:
            from core.ddb_cameras import get_camera_ddb
            from core.database import get_camera as get_camera_sqlite
            # Reload camera config each iteration — prefer DDB so app changes take effect
            current = get_camera_ddb(camera_id) or get_camera_sqlite(camera_id)
            if not current or not current.get("enabled", True):
                log.info(f"[camera_loop] '{camera_name}' disabled — stopping loop")
                break
            # Stop loop if all configured modes are disabled
            _all_cam_modes = {m.strip() for m in current.get("mode","").split(",") if m.strip()}
            _all_cam_modes |= set(current.get("extra_modes") or [])
            if _all_cam_modes and _all_cam_modes.issubset(_DISABLED_MODES):
                log.info(f"[camera_loop] '{camera_name}' all modes disabled "
                         f"({_all_cam_modes}) — loop idle until re-enabled")
                stop_event.wait(300)  # check every 5 min in case config changes
                continue

            # Don't launch if one is already running/pending; back off if last job failed
            recent = _recent_job_for_camera(camera_id, camera_name)
            if recent:
                if recent["status"] in ("pending", "running"):
                    log.debug(f"[camera_loop] '{camera_name}' has active job "
                              f"{recent['job_id']} ({recent['status']}) — waiting")
                    stop_event.wait(10)
                    continue
                if recent["status"] == "failed":
                    # Grace period: if we just launched this job, don't immediately
                    # declare it failed. On a loaded box, YOLO takes 20-30s to start
                    # and the job can get cancelled by worker startup cleanup before it
                    # even runs — without this guard, camera_loop relaunches instantly
                    # and creates duplicate YOLO processes.
                    secs_since_launch = time.time() - _last_launch_t
                    if (recent["job_id"] == _last_launched_job_id
                            and secs_since_launch < _LAUNCH_GRACE_SEC):
                        log.debug(f"[camera_loop] '{camera_name}' job {recent['job_id']} "
                                  f"shows failed but was just launched {secs_since_launch:.0f}s ago "
                                  f"— holding ({_LAUNCH_GRACE_SEC - secs_since_launch:.0f}s grace remaining)")
                        stop_event.wait(5)
                        continue
                    _consecutive_fails = getattr(stop_event, "_cam_fails", 0) + 1
                    stop_event._cam_fails = _consecutive_fails
                    # Exponential backoff: 15s, 30s, 60s, 120s, 240s — capped at 300s.
                    # Linear backoff (was 60×n) reached 10 min after 10 failures,
                    # leaving a 5-min gap if the camera recovered at failure #8.
                    import random as _rng
                    wait = min(15 * (2 ** min(_consecutive_fails - 1, 4)), 300)
                    wait += _rng.uniform(0, 10)  # jitter to avoid thundering herd
                    log.warning(f"[camera_loop] '{camera_name}' last job failed "
                                f"(#{_consecutive_fails}) — waiting {wait:.0f}s before retry")
                    stop_event.wait(wait)
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
                # Snap to this camera's schedule slot after running
                now = time.time()
                last_occupancy_t = now - ((now - _cam_offset) % OCCUPANCY_INTERVAL)
                next_at = last_occupancy_t + OCCUPANCY_INTERVAL
                log.info(f"[camera_loop] '{camera_name}' — people_count snapshot "
                         f"(next in {int((next_at - now) / 60)}m)")
                try:
                    from core.ddb_cameras import update_camera_next_occupancy
                    venue_id = current.get("venue", "")
                    if venue_id:
                        update_camera_next_occupancy(venue_id, camera_id, next_at)
                except Exception:
                    pass

            # Apply mixed-mode occupancy throttle (drink_count + people_count cameras)
            effective = _effective_cam(current, last_occupancy_t)
            all_effective_modes = [m.strip() for m in effective.get("mode","").split(",") if m.strip()]
            if any(m in _PEOPLE_MODES for m in all_effective_modes) and not _is_people_only(current):
                now = time.time()
                last_occupancy_t = now - ((now - _cam_offset) % OCCUPANCY_INTERVAL)
                next_at = last_occupancy_t + OCCUPANCY_INTERVAL
                log.info(f"[camera_loop] '{camera_name}' — mixed occupancy run "
                         f"(next in {OCCUPANCY_INTERVAL//60}m)")
                try:
                    from core.ddb_cameras import update_camera_next_occupancy
                    venue_id = current.get("venue", "")
                    if venue_id:
                        update_camera_next_occupancy(venue_id, camera_id, next_at)
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

            # Reset failure counter on successful launch
            stop_event._cam_fails = 0
            # Launch next segment (or continuous job)
            seg_num += 1
            launched_id = _launch_segment(effective, seg_num)
            _last_launched_job_id = launched_id or ""
            _last_launch_t = time.time()

            # YOLO cameras always run continuously — ignore DDB segment_seconds /
            # interval_seconds (those were set for old people_count throttling and
            # must NOT override the continuous-poll behaviour for bar cameras).
            _eff_modes = set([effective.get("mode","drink_count").split(",")[0]]
                             + list(effective.get("extra_modes") or []))
            _is_yolo_cam = bool(_eff_modes & _YOLO_MODES)
            if _is_yolo_cam:
                seg_secs = 0  # force continuous regardless of DDB config
            else:
                seg_secs = float(current.get("segment_seconds", 15))
            # interval_seconds: how long to wait BETWEEN clips (defaults to seg_secs).
            # Set interval > seg_secs to run a short clip on a longer schedule,
            # e.g. seg_secs=30, interval_seconds=1200 → 30s snapshot every 20 min.
            _iv = current.get("interval_seconds") if not _is_yolo_cam else None
            interval_secs = float(_iv) if _iv is not None else seg_secs

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
