#!/usr/bin/env python3
"""
VenueScope v6 — Worker daemon.
Run separately from Streamlit. Polls DB for pending jobs and processes them
in parallel using multiprocessing (up to MAX_PARALLEL concurrent jobs).
"""
from __future__ import annotations
import os, sys, time, json, traceback, signal, multiprocessing
from pathlib import Path
from typing import Dict

os.environ.setdefault("YOLO_TELEMETRY",          "False")
os.environ.setdefault("ULTRALYTICS_AUTOINSTALL", "False")

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

from core.config   import RESULT_DIR
from core.database import list_jobs, get_job, set_running, set_progress, set_done, set_failed
from core.bar_config import BarConfig, BarStation
from core.shift      import ShiftManager
from core.tracking.engine import VenueProcessor

POLL_INTERVAL = 2
MAX_PARALLEL  = int(os.environ.get("VENUESCOPE_WORKERS", "4"))


def run_job(job_id: str):
    print(f"[worker] Starting job {job_id}", flush=True)
    try:
        set_running(job_id)
        job = get_job(job_id)
        if not job:
            raise RuntimeError(f"Job {job_id} not found")

        result_dir = Path(RESULT_DIR) / job_id
        result_dir.mkdir(parents=True, exist_ok=True)

        mode = job.get("analysis_mode", "drink_count")
        set_progress(job_id, 2)
        print(f"[worker] Mode: {mode}  Source: {Path(job['source_path']).name}", flush=True)

        bar_config = None
        if job.get("config_path"):
            try:
                d        = json.loads(Path(job["config_path"]).read_text())
                stations = [BarStation(**s) for s in d.pop("stations", [])]
                cfg      = BarConfig(**d); cfg.stations = stations
                bar_config = cfg
                print(f"[worker] Bar config: {cfg.venue_id}", flush=True)
            except Exception as e:
                print(f"[worker] Bar config failed: {e}", flush=True)

        shift = None
        if job.get("shift_json"):
            try:
                sd = json.loads(job["shift_json"])
                if sd:
                    shift = ShiftManager.from_dict(sd)
                    print(f"[worker] Shift: {list(shift.records.keys())}", flush=True)
            except Exception as e:
                print(f"[worker] Shift failed: {e}", flush=True)

        extra_config = {}
        if job.get("summary_json"):
            try:
                stored = json.loads(job["summary_json"])
                if "extra_config" in stored:
                    extra_config = stored["extra_config"]
            except Exception:
                pass

        def cb(pct, msg):
            set_progress(job_id, pct)
            print(f"[worker] {pct:.0f}%  {msg}", flush=True)

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
        )

        summary = proc.run()
        set_done(job_id, str(result_dir), summary)
        print(f"[worker] Job {job_id} DONE", flush=True)

        src = Path(job["source_path"])
        if job["source_type"] == "file" and src.exists():
            try: src.unlink()
            except Exception: pass

    except MemoryError:
        msg = "Out of memory — try 'fast' profile or shorter clip"
        set_failed(job_id, msg)
        print(f"[worker] OOM: {msg}", flush=True)
    except Exception as e:
        short = str(e).split("\n")[0][:200]
        set_failed(job_id, short)
        print(f"[worker] FAILED: {short}", flush=True)
        print(traceback.format_exc(), flush=True)


def main():
    print("[worker] VenueScope v6 worker started", flush=True)
    print(f"[worker] Polling every {POLL_INTERVAL}s  MAX_PARALLEL={MAX_PARALLEL}", flush=True)

    # Reset any stuck running jobs from previous session that have no active process
    for job in list_jobs(50):
        if job["status"] == "running":
            set_failed(job["job_id"], "worker restarted — job was interrupted")
            print(f"[worker] Reset stuck job {job['job_id']}", flush=True)

    _last_cleanup = 0.0
    _active: Dict[str, multiprocessing.Process] = {}

    def handle_signal(sig, frame):
        print("[worker] Shutting down — terminating active processes", flush=True)
        for jid, proc in list(_active.items()):
            try:
                proc.terminate()
            except Exception:
                pass
        for jid, proc in list(_active.items()):
            try:
                proc.join(timeout=5)
            except Exception:
                pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT,  handle_signal)

    while True:
        try:
            # 1. Reap finished processes
            for job_id, proc in list(_active.items()):
                if not proc.is_alive():
                    proc.join()
                    del _active[job_id]
                    print(f"[worker] Reaped process for job {job_id}", flush=True)

            # Periodic retention cleanup (once every 6 hours)
            _now = time.time()
            if _now - _last_cleanup > 21600:
                try:
                    from core.database import cleanup_old_results, get_preferences
                    prefs = get_preferences()
                    days  = int(prefs.get("retention_days", 0))
                    if days > 0:
                        n = cleanup_old_results(days)
                        if n > 0:
                            print(f"[worker] Retention cleanup: deleted {n} job(s) older than {days} days", flush=True)
                except Exception as _ce:
                    print(f"[worker] Retention cleanup error: {_ce}", flush=True)
                _last_cleanup = _now

            # 2. Fill empty slots
            slots = MAX_PARALLEL - len(_active)
            if slots > 0:
                pending = [j for j in list_jobs(50) if j["status"] == "pending"]
                pending.sort(key=lambda j: j.get("created_at", 0))
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
                    print(f"[worker] Launched job {job_id} (pid={p.pid})", flush=True)
                    launched += 1

                # If we filled or tried to fill, loop immediately to reap quickly;
                # otherwise sleep before next poll.
                if launched == 0:
                    time.sleep(POLL_INTERVAL)
            else:
                # All slots busy — sleep before checking again
                time.sleep(POLL_INTERVAL)

        except KeyboardInterrupt:
            handle_signal(None, None)
        except Exception as e:
            print(f"[worker] Poll error: {e}", flush=True)
            time.sleep(5)


if __name__ == "__main__":
    main()
