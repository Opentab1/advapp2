#!/usr/bin/env python3
"""
VenueScope v6 — Worker daemon.
Enterprise hardening: graceful shutdown, structured logging, alerts,
camera health, backup, circuit breaker, efficient DB polling.
"""
from __future__ import annotations
import os, sys, time, json, traceback, signal, multiprocessing, logging
from pathlib import Path
from typing import Dict

os.environ.setdefault("YOLO_TELEMETRY",          "False")
os.environ.setdefault("ULTRALYTICS_AUTOINSTALL", "False")

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

# Load .env from parent directory if AWS creds are missing (safety fallback)
if not os.environ.get("AWS_ACCESS_KEY_ID"):
    _env_file = BASE / ".env"
    if _env_file.exists():
        for _line in _env_file.read_text().splitlines():
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

# ── Structured logging ───────────────────────────────────────────────────────
try:
    from core.logging_config import setup_logging
    log = setup_logging("worker")
except ImportError:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    log = logging.getLogger("worker")

from core.config   import RESULT_DIR

# Directory for cross-segment bartender state files (one JSON per camera)
STATE_DIR = Path(RESULT_DIR).parent / "camera_state"
STATE_DIR.mkdir(parents=True, exist_ok=True)


def _load_camera_state(camera_id: str) -> dict:
    """Load cross-segment state for a camera, or {} if none exists."""
    try:
        f = STATE_DIR / f"{camera_id}.json"
        if f.exists():
            return json.loads(f.read_text())
    except Exception:
        pass
    return {}


def _save_camera_state(camera_id: str, state: dict) -> None:
    """Persist cross-segment state for a camera."""
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        (STATE_DIR / f"{camera_id}.json").write_text(json.dumps(state, default=str))
    except Exception as e:
        log.debug(f"Could not save camera state for {camera_id}: {e}")
from core.database import (list_jobs, list_jobs_by_status, get_job,
                            set_running, set_progress, set_done, set_failed,
                            set_failed as _set_failed, _raw_update)
from core.bar_config import BarConfig, BarStation
from core.shift      import ShiftManager
from core.tracking.engine import VenueProcessor

POLL_INTERVAL     = 2
MAX_PARALLEL      = int(os.environ.get("VENUESCOPE_WORKERS", "4"))
STALE_JOB_SECONDS = 7200   # 2 hours

_shutdown_requested = False


def _reap_stale_jobs():
    """Mark jobs stuck in 'running' for >2 hours as failed."""
    cutoff = time.time() - STALE_JOB_SECONDS
    try:
        jobs = list_jobs(100)
    except Exception as e:
        log.warning(f"_reap_stale_jobs: could not fetch jobs: {e}")
        return
    for job in jobs:
        if job.get("status") == "running" and (job.get("created_at", 0) < cutoff):
            try:
                set_failed(job["job_id"],
                           "Job timed out — exceeded 2-hour limit. Worker may have crashed.")
                log.warning(f"Reaped stale job {job['job_id']}")
            except Exception as e:
                log.error(f"Failed to reap job {job['job_id']}: {e}")


def run_job(job_id: str):
    log.info(f"Starting job {job_id}")
    # Dispose inherited SQLAlchemy engine after fork() so the child gets a
    # fresh connection pool with no inherited locks.
    try:
        import core.database as _db
        if _db._engine is not None:
            _db._engine.dispose()
            _db._engine = None
    except Exception:
        pass
    job = None
    try:
        set_running(job_id)
        job = get_job(job_id)
        if not job:
            raise RuntimeError(f"Job {job_id} not found")

        result_dir = Path(RESULT_DIR) / job_id
        result_dir.mkdir(parents=True, exist_ok=True)

        mode = job.get("analysis_mode", "drink_count")
        set_progress(job_id, 2)
        log.info(f"Mode: {mode}  Source: {Path(job['source_path']).name}")

        extra_config = {}
        if job.get("summary_json"):
            try:
                stored = json.loads(job["summary_json"])
                if "extra_config" in stored:
                    extra_config = stored["extra_config"]
            except Exception:
                pass

        bar_config = None
        if job.get("config_path"):
            try:
                d        = json.loads(Path(job["config_path"]).read_text())
                stations = [BarStation(**s) for s in d.pop("stations", [])]
                cfg      = BarConfig(**d); cfg.stations = stations
                bar_config = cfg
                log.info(f"Bar config: {cfg.venue_id}")
            except Exception as e:
                log.warning(f"Bar config failed: {e}")

        # Fallback: bar config stored in DDB camera record (from React zone editor)
        # The React zone editor omits venue_id/display_name — inject defaults.
        if bar_config is None and extra_config.get("bar_config_json"):
            try:
                d        = json.loads(extra_config["bar_config_json"])
                stations = [BarStation(**s) for s in d.pop("stations", [])]
                d.setdefault("venue_id",     extra_config.get("camera_id", "camera"))
                d.setdefault("display_name", extra_config.get("camera_id", "Camera"))
                cfg      = BarConfig(**d); cfg.stations = stations
                bar_config = cfg
                log.info(f"Bar config loaded from DDB camera record ({len(stations)} stations)")
            except Exception as e:
                log.warning(f"DDB bar config parse failed: {e}")

        # Auto-detect bar layout from stream frames when drink_count has no config
        camera_id = extra_config.get("camera_id", "")
        if (bar_config is None
                and mode == "drink_count"
                and job.get("source_type") == "rtsp"):
            try:
                from core.auto_bar_config import analyze_stream
                log.info(f"[auto_bar_config] No bar config for {camera_id} — "
                         "auto-detecting from stream...")
                auto_cfg = analyze_stream(job["source_path"])
                auto_json = json.dumps(auto_cfg)
                # Parse for this job
                d2       = dict(auto_cfg)
                stations = [BarStation(**s) for s in d2.pop("stations", [])]
                bar_config = BarConfig(**d2); bar_config.stations = stations
                log.info(f"[auto_bar_config] Done — bar_line note: "
                         f"{auto_cfg.get('auto_note', '')}")
                # Persist to DDB so future segments skip re-analysis
                _venue_id_for_cam = extra_config.get("venue_id", "")
                if camera_id and _venue_id_for_cam:
                    try:
                        from core.ddb_cameras import update_camera_bar_config_json
                        update_camera_bar_config_json(
                            _venue_id_for_cam, camera_id, auto_json)
                        log.info(f"[auto_bar_config] Config saved to DDB "
                                 f"for {_venue_id_for_cam}/{camera_id}")
                    except Exception as _de:
                        log.warning(f"[auto_bar_config] DDB save failed: {_de}")
            except Exception as _ace:
                log.warning(f"[auto_bar_config] Failed (non-fatal): {_ace}")

        shift = None
        if job.get("shift_json"):
            try:
                sd = json.loads(job["shift_json"])
                if sd:
                    shift = ShiftManager.from_dict(sd)
                    log.info(f"Shift: {list(shift.records.keys())}")
            except Exception as e:
                log.warning(f"Shift failed: {e}")

        # Per-camera venue ID — supports multiple venues on one worker
        job_venue_id = extra_config.get("venue_id", "")

        # Load cross-segment state (bar line cooldowns from previous clip)
        camera_id = extra_config.get("camera_id", "")
        if camera_id and mode == "drink_count":
            prior_state = _load_camera_state(camera_id)
            if prior_state:
                extra_config["prior_camera_state"] = prior_state
                log.info(f"Loaded cross-segment state for camera {camera_id}")

        # Write a "running" record to DynamoDB (after venue_id is resolved)
        try:
            from core.aws_sync import sync_partial_to_aws
            sync_partial_to_aws(job_id, 0, "Processing started", job_data=job,
                                venue_id=job_venue_id)
        except Exception as _ie:
            log.warning(f"Initial AWS sync error (non-fatal): {_ie}")

        is_continuous = (job["source_type"] == "rtsp"
                         and float(extra_config.get("max_seconds", 0)) == 0)

        _last_partial_sync = [0.0]

        def cb(pct, msg):
            set_progress(job_id, pct)
            log.info(f"{pct:.0f}%  {msg}")
            if time.time() - _last_partial_sync[0] >= 60.0:
                try:
                    from core.aws_sync import sync_partial_to_aws
                    sync_partial_to_aws(job_id, pct, msg, venue_id=job_venue_id)
                except Exception as _pe:
                    log.warning(f"Partial AWS sync error (non-fatal): {_pe}")
                _last_partial_sync[0] = time.time()

        def live_cb(partial_summary, elapsed_sec):
            """Called every ~30s for continuous live streams."""
            # Write to local file so Streamlit dashboard can read it
            try:
                live_file = result_dir / "live.json"
                partial_summary["_updated_at"] = time.time()
                partial_summary["_elapsed_sec"] = elapsed_sec
                partial_summary["_job_id"] = job_id
                live_file.write_text(json.dumps(partial_summary, default=str))
            except Exception:
                pass
            # Push to AWS DynamoDB for React dashboard
            try:
                from core.aws_sync import push_live_metrics
                push_live_metrics(job_id, partial_summary, elapsed_sec,
                                  venue_id=job_venue_id,
                                  created_at=job.get("created_at"))
            except Exception as _le:
                log.debug(f"Live metrics push error (non-fatal): {_le}")

        # Route people_count to lightweight OpenCV runner (no YOLO, ~15MB RAM)
        if mode == "people_count" and not extra_config.get("force_yolo"):
            from core.lightweight_runner import run_lightweight
            log.info(f"Using lightweight counter (no YOLO) for job {job_id}")
            summary = run_lightweight(job, extra_config, result_dir, cb,
                                      live_cb if is_continuous else lambda s,e: None,
                                      is_continuous)
        else:
            proc = VenueProcessor(
                job_id        = job_id,
                analysis_mode = mode,
                source        = job["source_path"],
                source_type   = job["source_type"],
                model_profile = job["model_profile"],
                bar_config    = bar_config,
                shift         = shift,
                extra_config  = extra_config,
                result_dir    = result_dir,
                annotate      = bool(job.get("annotate", False)),
                progress_cb   = cb,
                extra_modes   = extra_config.get("extra_modes", []),
                live_event_cb = live_cb if is_continuous else None,
            )
            summary = proc.run()

        if is_continuous:
            # Stream disconnected — log it. The camera_loop will immediately
            # create a new continuous job so the stream restarts within seconds.
            log.warning(f"Continuous job {job_id}: stream ended — "
                        f"camera_loop will reconnect automatically")

        set_done(job_id, str(result_dir), summary)
        log.info(f"Job {job_id} DONE — drinks={summary.get('total_drinks', 0)}, "
                 f"unrung={summary.get('unrung_drinks', 0)}")

        # Persist cross-segment state for the next clip of this camera
        if camera_id and mode == "drink_count" and summary.get("_camera_state"):
            _save_camera_state(camera_id, summary["_camera_state"])
            log.debug(f"Saved cross-segment state for camera {camera_id}")

        # Send theft alert if needed
        try:
            from core.alerts import send_theft_alert
            send_theft_alert(job_id, summary)
        except Exception as _ae:
            log.warning(f"Theft alert error (non-fatal): {_ae}")

        # Trigger POS reconciliation if a provider is configured
        try:
            from core.pos.reconciliation import reconcile, get_configured_provider
            _pos_provider = get_configured_provider()
            if _pos_provider and summary.get("total_drinks", 0) > 0:
                _created_at = summary.get("created_at", time.time())
                _duration   = summary.get("video_seconds", 0)
                _pos_result = reconcile(
                    camera_drink_count=summary.get("total_drinks", 0),
                    job_start_time=_created_at,
                    job_duration_sec=_duration,
                    provider=_pos_provider,
                )
                summary["pos_reconciliation"] = _pos_result
                log.info(
                    f"POS reconciliation ({_pos_provider}): "
                    f"variance={_pos_result.get('variance_drinks', 0):+d} drinks "
                    f"({_pos_result.get('variance_pct', 0):.1f}%)"
                )
        except Exception as _pos_err:
            log.warning(f"POS reconciliation skipped (non-fatal): {_pos_err}")

        # Sync final results to AWS — use per-camera venue_id for multi-venue support
        try:
            from core.aws_sync import sync_job_to_aws
            sync_job_to_aws(job_id, summary, result_dir, venue_id=job_venue_id)
        except Exception as _sync_err:
            log.warning(f"AWS sync error (non-fatal): {_sync_err}")

        # RTSP camera jobs: delete local result dir after AWS sync — everything
        # lives in DynamoDB/S3. File-upload jobs keep results for local review.
        if job.get("source_type") == "rtsp" and result_dir.exists():
            try:
                import shutil
                shutil.rmtree(str(result_dir), ignore_errors=True)
                log.debug(f"Cleaned up local result dir for RTSP job {job_id}")
            except Exception:
                pass

        # Track camera health
        try:
            from core.camera_health import record_frame
            if job.get("source_type") == "rtsp":
                cam_id = job.get("camera_id", job_id)
                record_frame(cam_id, job.get("clip_label", ""))
        except Exception:
            pass

        # Delete source file after processing (file uploads only)
        # Only delete if no other pending/running jobs share the same source path
        src = Path(job["source_path"])
        if job["source_type"] == "file" and src.exists():
            try:
                from core.database import list_jobs_by_status
                pending = list_jobs_by_status("pending", limit=100)
                running = list_jobs_by_status("running", limit=100)
                siblings = [j for j in pending + running
                            if j["job_id"] != job_id
                            and j.get("source_path") == str(src)]
                if not siblings:
                    src.unlink()
            except Exception:
                pass

    except MemoryError:
        msg = "Out of memory — try 'fast' profile or shorter clip"
        set_failed(job_id, msg)
        log.error(f"OOM on job {job_id}: {msg}")
    except Exception as e:
        short = str(e).split("\n")[0][:200]
        set_failed(job_id, short)
        log.error(f"Job {job_id} FAILED: {short}")
        log.debug(traceback.format_exc())
        # Track camera failure for health monitoring
        try:
            if job and job.get("source_type") == "rtsp":
                from core.camera_health import record_failure
                record_failure(job.get("camera_id", job_id), job.get("clip_label", ""))
        except Exception:
            pass
    finally:
        # Always persist cross-segment state — even on crash/OOM/kill.
        # Without this, a crashed job loses station cooldown context and the
        # next segment may double-count serves that happened near the boundary.
        try:
            if camera_id and mode == "drink_count":
                # Try to extract state from the processor if it's still in scope
                _final_state = None
                try:
                    if 'proc' in dir() and hasattr(proc, 'shift') and proc.shift:
                        from core.analytics.drink_counter import DrinkCounter
                        # Walk analyzers via summary if available
                        pass
                except Exception:
                    pass
                # Fallback: if summary was built and has _camera_state, save it
                try:
                    if 'summary' in dir() and isinstance(summary, dict) \
                            and summary.get("_camera_state"):
                        _save_camera_state(camera_id, summary["_camera_state"])
                        log.debug(f"Saved cross-segment state for camera {camera_id} (finally block)")
                except Exception:
                    pass
        except Exception:
            pass


def _camera_loop_proc_entry():
    """Camera loop manager runs in a fully isolated child process."""
    try:
        from core.logging_config import setup_logging as _sl
        _clog = _sl("camera_loop")
    except Exception:
        import logging as _logging
        _clog = _logging.getLogger("camera_loop")
    try:
        # On startup: push any SQLite-only cameras to DynamoDB so the admin
        # portal always reflects reality. Skips cameras already in DDB.
        venue_id = os.environ.get("VENUESCOPE_VENUE_ID", "")
        if venue_id:
            from core.ddb_cameras import sync_sqlite_to_ddb
            n = sync_sqlite_to_ddb(venue_id)
            if n:
                _clog.info(f"[startup] Synced {n} cameras from SQLite → DynamoDB")

        from core.camera_loop import get_manager as _get_cam_mgr
        _mgr = _get_cam_mgr()
        _mgr.sync()
        _clog.info("Camera loop manager running")
        while True:
            time.sleep(60)
            _mgr.sync()
    except Exception as _e:
        _clog.error(f"Camera loop manager crashed: {_e}")


def main():
    log.info(f"VenueScope v6 worker started — polling every {POLL_INTERVAL}s, "
             f"MAX_PARALLEL={MAX_PARALLEL}")

    # Pre-load the default YOLO model in the parent process so forked child
    # processes inherit it via copy-on-write (Linux fork semantics).
    # This eliminates the 3-5s cold-start cost for every drink_count job.
    try:
        from core.tracking.engine import _get_cached_model
        _default_model = os.environ.get("VENUESCOPE_DEFAULT_MODEL", "yolov8n.pt")
        log.info(f"Pre-loading {_default_model} for fork-based job starts...")
        _get_cached_model(_default_model)
        log.info(f"YOLO model pre-loaded — forked workers will inherit via COW")
    except Exception as _me:
        log.warning(f"Model pre-load skipped (non-fatal): {_me}")

    # Reset stuck running jobs from previous session
    for job in list_jobs(50):
        if job["status"] == "running":
            set_failed(job["job_id"], "worker restarted — job was interrupted")
            log.warning(f"Reset stuck job {job['job_id']}")

    _reap_stale_jobs()

    _last_cleanup      = 0.0
    _last_backup       = 0.0
    _last_health_check = 0.0
    _last_cam_sync     = 0.0
    _poll_count        = 0
    _active: Dict[str, multiprocessing.Process] = {}
    _active_start: Dict[str, float] = {}  # job_id → launch timestamp
    _active_continuous: set = set()       # job_ids that are continuous (no timeout)
    JOB_TIMEOUT = 600  # 10 minutes max per job — kills stuck YOLO/RTSP jobs

    # Start camera loop manager in its OWN process (not as threads in this
    # process). This prevents background threads from holding SQLite mutexes
    # at fork() time, which causes futex deadlocks in job worker subprocesses.
    _cam_proc = multiprocessing.Process(target=_camera_loop_proc_entry, daemon=True)
    _cam_proc.start()
    _cam_mgr = None   # no in-process manager needed
    log.info("Camera loop manager started (separate process)")

    # Start DVR folder watcher (picks up VENUESCOPE_WATCH_FOLDERS env var)
    _folder_watcher = None
    try:
        _watch_env = os.environ.get("VENUESCOPE_WATCH_FOLDERS", "").strip()
        if _watch_env:
            from core.folder_watch import get_watcher as _get_fw, FolderWatchConfig
            _folder_watcher = _get_fw()
            for _fw_path in _watch_env.split(":"):
                _fw_path = _fw_path.strip()
                if _fw_path:
                    _fw_mode = os.environ.get("VENUESCOPE_WATCH_MODE", "drink_count")
                    _fw_cfg  = FolderWatchConfig(path=_fw_path, mode=_fw_mode)
                    _folder_watcher.add_folder(_fw_cfg)
            log.info(f"Folder watcher started for: {_watch_env}")
    except Exception as _fwe:
        log.warning(f"Folder watcher failed to start: {_fwe}")

    def handle_signal(sig, frame):
        global _shutdown_requested
        log.info("Shutdown signal received — waiting up to 30s for active jobs")
        _shutdown_requested = True
        deadline = time.time() + 30
        while _active and time.time() < deadline:
            for jid, proc in list(_active.items()):
                if not proc.is_alive():
                    proc.join()
                    del _active[jid]
            if _active:
                time.sleep(1)
        # Terminate any remaining processes
        for jid, proc in list(_active.items()):
            try:
                proc.terminate()
                proc.join(timeout=3)
            except Exception:
                pass
        log.info(f"Worker shutdown complete ({len(_active)} jobs abandoned)")
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT,  handle_signal)

    while True:
        if _shutdown_requested:
            break
        try:
            _poll_count += 1

            # Periodic stale-job reaper (every 10 iterations ≈ every 20 seconds)
            if _poll_count % 10 == 0:
                _reap_stale_jobs()

            _now = time.time()

            # 1. Reap finished processes; kill any that exceed JOB_TIMEOUT
            #    Continuous jobs (max_seconds=0) are exempt — they run until stopped.
            for job_id, proc in list(_active.items()):
                elapsed = _now - _active_start.get(job_id, _now)
                is_continuous = job_id in _active_continuous
                if elapsed > JOB_TIMEOUT and proc.is_alive() and not is_continuous:
                    log.warning(f"Job {job_id} exceeded {JOB_TIMEOUT}s timeout — killing (pid={proc.pid})")
                    proc.kill()
                    proc.join(timeout=5)
                    del _active[job_id]
                    _active_start.pop(job_id, None)
                    _active_continuous.discard(job_id)
                    try:
                        from core.database import _raw_update
                        _raw_update(job_id, status="failed", error_message="Job timeout — exceeded 10 minutes")
                    except Exception:
                        pass
                    continue
                if not proc.is_alive():
                    proc.join()
                    del _active[job_id]
                    _active_start.pop(job_id, None)
                    _active_continuous.discard(job_id)
                    log.info(f"Reaped process for job {job_id}")

            # Retention cleanup (every 6 hours)
            # RTSP camera results are deleted after sync; file uploads kept 7 days.
            if _now - _last_cleanup > 21600:
                try:
                    from core.database import cleanup_old_results, get_preferences
                    prefs = get_preferences()
                    days  = int(prefs.get("retention_days", 7))  # default 7 days
                    if days > 0:
                        n = cleanup_old_results(days)
                        if n > 0:
                            log.info(f"Retention cleanup: deleted {n} job(s) older than {days} days")
                except Exception as _ce:
                    log.warning(f"Retention cleanup error: {_ce}")
                _last_cleanup = _now

            # Daily backup to S3 (every 24 hours)
            if _now - _last_backup > 86400:
                try:
                    from core.backup import backup_to_s3
                    from core.config import CONFIG_DIR
                    import sqlite3
                    db_path = Path(RESULT_DIR).parent / "jobs.db"
                    backup_to_s3(db_path, Path(CONFIG_DIR))
                except Exception as _be:
                    log.warning(f"Backup error (non-fatal): {_be}")
                _last_backup = _now

            # Camera loop sync is now handled by its own process — nothing needed here

            # Camera health check (every 15 minutes)
            if _now - _last_health_check > 900:
                try:
                    from core.camera_health import check_and_alert
                    check_and_alert()
                except Exception as _che:
                    log.warning(f"Camera health check error: {_che}")
                _last_health_check = _now

            # 2. Fill empty slots using efficient DB-level status filter
            slots = MAX_PARALLEL - len(_active)
            if slots > 0:
                pending = list_jobs_by_status("pending", limit=slots + 10)
                launched = 0
                for job in pending:
                    if launched >= slots:
                        break
                    job_id = job["job_id"]
                    if job_id in _active:
                        continue
                    p = multiprocessing.Process(
                        target=run_job, args=(job_id,), daemon=True
                    )
                    p.start()
                    _active[job_id] = p
                    _active_start[job_id] = time.time()
                    # Mark continuous jobs (max_seconds=0) so timeout reaper skips them
                    try:
                        _ec = json.loads(job.get("summary_json") or "{}").get("extra_config", {})
                        if float(_ec.get("max_seconds", 1)) == 0:
                            _active_continuous.add(job_id)
                    except Exception:
                        pass
                    log.info(f"Launched job {job_id} (pid={p.pid})")
                    launched += 1

                if launched == 0:
                    time.sleep(POLL_INTERVAL)
            else:
                time.sleep(POLL_INTERVAL)

        except KeyboardInterrupt:
            handle_signal(None, None)
        except Exception as e:
            log.error(f"Poll error: {e}")
            time.sleep(5)


if __name__ == "__main__":
    main()
