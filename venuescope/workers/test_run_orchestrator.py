#!/usr/bin/env python3
"""
Worker Tester — Test Run Orchestrator.

Reads a test-run spec from VenueScopeTestRuns, replays the requested NVR
window through the worker pipeline, captures worker health alongside, and
writes graded results back to the same DDB row. Results never touch the
live VenueScopeCameras / VenueScopeJobs tables.

Architecture:
  ┌──────────────────────────────────────────────────────────────────────┐
  │  TestRunOrchestrator(run_id)                                         │
  │   1. _load_run()           → spec from DDB                           │
  │   2. _mark_running()                                                 │
  │   3. for cam in run.cameras:                                         │
  │        replay = start_replay(cam.live_url, run.start_dt..end_dt)     │
  │        engine = _spawn_engine(local_manifest, cam.features, ...)     │
  │        while engine.alive():                                         │
  │             health.sample(engine.pid)                                │
  │             counts = _read_engine_counts()                           │
  │             _push_progress(counts, health.snapshot())                │
  │             sleep(5)                                                 │
  │   4. _grade(counts, ground_truth) → A-F per feature + overall        │
  │   5. _mark_complete(grades, health.finalize())                       │
  └──────────────────────────────────────────────────────────────────────┘

Run from CLI for a single run:
    python -m workers.test_run_orchestrator <run-id>

Or as a daemon that polls for `pending` runs (Phase 5 wires the admin UI
to POST a "start" event that flips a run to pending).
"""

from __future__ import annotations
import os
import sys
import time
import json
import logging
import argparse
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from core.nvr_replay import (   # noqa: E402
    ReplayJob, start_replay, stop_replay, manifest_url,
)
from core.worker_health import (  # noqa: E402
    HealthCollector, derive_stability,
)
from core.test_grader import (    # noqa: E402
    grade_run, grade_for_error, worst_grade,
)

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] %(name)s: %(message)s',
)
log = logging.getLogger("test_run_orchestrator")

# ── DDB clients (lazy) ───────────────────────────────────────────────────
_ddb = None

def _ddb_client():
    global _ddb
    if _ddb is None:
        import boto3
        _ddb = boto3.client("dynamodb", region_name=os.environ.get("AWS_REGION", "us-east-2"))
    return _ddb


TEST_RUNS_TABLE = "VenueScopeTestRuns"
CAMERAS_TABLE   = "VenueScopeCameras"

REPLAY_BASE_DIR = Path(os.environ.get("VS_REPLAY_DIR", "/tmp/venuescope-replays"))

# Lambda admin API — fallback when direct DDB writes fail (IAM not granted
# to the droplet for the new test-runs table). Read from .env.
ADMIN_API_URL = os.environ.get("VITE_ADMIN_API_URL", "").rstrip("/")


# Grading lives in core.test_grader (imported above) — see GRADE_RUBRIC there.
# ── DDB helpers ─────────────────────────────────────────────────────────

def _get_test_run(run_id: str) -> Dict[str, Any]:
    """Fetch a test run spec. Tries direct DDB first, falls back to the
    Lambda admin API if the droplet's IAM user can't read the table."""
    try:
        ddb = _ddb_client()
        r = ddb.get_item(TableName=TEST_RUNS_TABLE, Key={"runId": {"S": run_id}})
        item = r.get("Item")
        if item:
            cameras_json = item.get("camerasJson", {}).get("S", "[]")
            return {
                "runId":           run_id,
                "venueId":         item.get("venueId", {}).get("S", ""),
                "replayDate":      item.get("replayDate", {}).get("S", ""),
                "replayStartTime": item.get("replayStartTime", {}).get("S", ""),
                "replayEndTime":   item.get("replayEndTime", {}).get("S", ""),
                "replayTimezone":  item.get("replayTimezone", {}).get("S", "America/New_York"),
                "cameras":         json.loads(cameras_json),
                "pauseLiveCams":   item.get("pauseLiveCams", {}).get("BOOL", False),
            }
    except Exception as e:
        log.info("direct DDB read failed (%s) — falling back to admin API", type(e).__name__)
    # Fallback: HTTP to admin Lambda
    if not ADMIN_API_URL:
        raise RuntimeError(
            f"Test run {run_id} not found via DDB and VITE_ADMIN_API_URL not set"
        )
    import requests
    r = requests.get(f"{ADMIN_API_URL}/admin/test-runs/{run_id}", timeout=15)
    r.raise_for_status()
    data = r.json()
    return {
        "runId":           data["runId"],
        "venueId":         data["venueId"],
        "replayDate":      data["replayDate"],
        "replayStartTime": data["replayStartTime"],
        "replayEndTime":   data["replayEndTime"],
        "replayTimezone":  data.get("replayTimezone", "America/New_York"),
        "cameras":         data["cameras"],
        "pauseLiveCams":   data.get("pauseLiveCams", False),
    }


def _get_live_url(camera_id: str, venue_id: str) -> Optional[str]:
    item = _get_camera_item(camera_id, venue_id)
    if not item:
        return None
    return item.get("rtspUrl", {}).get("S", "") or None


def _get_camera_item(camera_id: str, venue_id: str) -> Optional[Dict[str, Any]]:
    """Fetch the full camera record from DDB."""
    ddb = _ddb_client()
    r = ddb.get_item(
        TableName=CAMERAS_TABLE,
        Key={"cameraId": {"S": camera_id}, "venueId": {"S": venue_id}},
    )
    return r.get("Item")


def _stage_bar_config(camera_id: str, venue_id: str, out_dir: Path) -> Optional[str]:
    """If the camera has a barConfigJson stored, write it to a temp file
    so we can pass --bar-config-json to test_engine_runner. Returns the
    file path, or None if no config exists.

    Without bar config, drink_count returns 0 — the engine doesn't know
    where the bar line is or which polygon is the customer side.
    """
    item = _get_camera_item(camera_id, venue_id)
    if not item:
        return None
    cfg_json = item.get("barConfigJson", {}).get("S", "")
    if not cfg_json or not cfg_json.strip():
        return None
    out_path = out_dir / "bar_config.json"
    out_path.write_text(cfg_json)
    return str(out_path)


def _patch_test_run(run_id: str, **fields) -> None:
    """Apply a partial update to a test run row. Uses the Lambda admin API
    so the droplet doesn't need direct DDB write permission to the new
    test-runs table — the Lambda role already has it."""
    if not fields: return
    if not ADMIN_API_URL:
        # Last-resort direct DDB attempt — works only if IAM is granted.
        return _patch_via_ddb(run_id, fields)
    import requests
    # Split fields by which endpoint owns them
    status_keys  = {"status", "progress", "startedAt", "completedAt", "errorMessage"}
    results_keys = {"liveCounts", "results", "workerHealth"}
    status_body  = {k: v for k, v in fields.items() if k in status_keys}
    results_body = {k: v for k, v in fields.items() if k in results_keys}
    if status_body:
        try:
            r = requests.patch(f"{ADMIN_API_URL}/admin/test-runs/{run_id}/status",
                               json=status_body, timeout=15)
            r.raise_for_status()
        except Exception as e:
            log.warning("status patch failed: %s", e)
    if results_body:
        try:
            r = requests.post(f"{ADMIN_API_URL}/admin/test-runs/{run_id}/results",
                              json=results_body, timeout=15)
            r.raise_for_status()
        except Exception as e:
            log.warning("results patch failed: %s", e)


def _patch_via_ddb(run_id: str, fields: Dict[str, Any]) -> None:
    """Direct DDB write — only works if droplet IAM user has access to
    VenueScopeTestRuns. Kept as a fallback path."""
    ddb = _ddb_client()
    sets, names, values = [], {}, {}
    field_to_attr = {
        "status":       ("status",            "status", "S"),
        "progress":     ("progress",          None,     "N"),
        "startedAt":    ("startedAt",         None,     "S"),
        "completedAt":  ("completedAt",       None,     "S"),
        "errorMessage": ("errorMessage",      None,     "S"),
        "liveCounts":   ("liveCountsJson",    None,     "S"),
        "results":      ("resultsJson",       None,     "S"),
        "workerHealth": ("workerHealthJson",  None,     "S"),
    }
    for i, (key, val) in enumerate(fields.items()):
        if key not in field_to_attr: continue
        attr, alias, kind = field_to_attr[key]
        # Use placeholder for reserved keyword "status"
        ph_name = f"#a{i}" if alias else attr
        ph_val  = f":v{i}"
        if alias:
            names[ph_name] = alias
        if kind == "N":
            values[ph_val] = {"N": str(val)}
        else:
            values[ph_val] = {"S": json.dumps(val) if isinstance(val, (dict, list)) else str(val)}
        sets.append(f"{ph_name} = {ph_val}")
    ddb.update_item(
        TableName=TEST_RUNS_TABLE,
        Key={"runId": {"S": run_id}},
        UpdateExpression="SET " + ", ".join(sets),
        ExpressionAttributeValues=values,
        ExpressionAttributeNames=names if names else None,
    )


# ── Replay window construction ──────────────────────────────────────────

def _build_replay_window(run: Dict[str, Any]):
    from zoneinfo import ZoneInfo
    tz_name = run.get("replayTimezone") or "America/New_York"
    tz = ZoneInfo(tz_name)
    date_str   = run["replayDate"]
    start_str  = run["replayStartTime"]
    end_str    = run["replayEndTime"]
    start_local = datetime.fromisoformat(f"{date_str}T{start_str}:00").replace(tzinfo=tz)
    end_local   = datetime.fromisoformat(f"{date_str}T{end_str}:00").replace(tzinfo=tz)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


# ── Engine integration (hook point) ─────────────────────────────────────

def _spawn_engine_for_camera(*, manifest_url: str, camera: Dict[str, Any],
                              run_id: str, features: List[str],
                              progress_path: Path,
                              venue_id: str,
                              bar_config_json_path: Optional[str] = None,
                              ) -> Optional[subprocess.Popen]:
    """Launch test_engine_runner against the local replay manifest.

    Spawns the worker engine in a subprocess so:
      - It has its own memory + GIL (won't block orchestrator's loop)
      - We can sample its CPU/RSS via psutil for the health badge
      - A crash in the engine doesn't take out the orchestrator
    """
    cam_id = camera.get("cameraId", "unknown")
    cmd = [
        sys.executable, "-m", "workers.test_engine_runner",
        "--manifest",   manifest_url,
        "--modes",      ",".join(features),
        "--output",     str(progress_path),
        "--camera-id",  cam_id,
        "--venue-id",   venue_id,
        "--max-seconds", "0",
    ]
    if bar_config_json_path:
        cmd += ["--bar-config-json", bar_config_json_path]

    log.info("spawning engine for %s: %s", cam_id, " ".join(cmd))
    log_path = progress_path.parent / "engine.log"
    log_fh = open(log_path, "ab")
    return subprocess.Popen(
        cmd,
        cwd=str(BASE),
        stdout=log_fh,
        stderr=subprocess.STDOUT,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )


def _read_engine_counts(progress_path: Path) -> Dict[str, int]:
    """Read live counts the engine wrote during processing. Returns {} if
    the file doesn't exist yet (engine still starting)."""
    try:
        return json.loads(progress_path.read_text())
    except Exception:
        return {}


# ── Main orchestration ───────────────────────────────────────────────────

def _run_one_camera(run_id: str, run: Dict[str, Any], cam_spec: Dict[str, Any],
                    start_utc: datetime, end_utc: datetime,
                    health: HealthCollector,
                    live_counts: Dict[str, Dict[str, int]]) -> Dict[str, Dict[str, Any]]:
    """Process a single camera spec end-to-end. Returns per-feature results."""
    camera_id = cam_spec["cameraId"]
    log.info("Processing camera %s features=%s", camera_id, cam_spec["features"])

    # 1. Resolve the camera's live URL → playback URL
    live_url = _get_live_url(camera_id, run["venueId"])
    if not live_url:
        log.error("camera %s has no live URL — skipping", camera_id)
        return {f: {"detected": 0, "expected": cam_spec.get("groundTruth", {}).get(f),
                    "errorPct": None, "grade": "F",
                    "notes": ["camera not found or no rtspUrl"]} for f in cam_spec["features"]}

    # 2. Spawn replay
    cam_dir = REPLAY_BASE_DIR / run_id / camera_id
    if cam_dir.exists():
        shutil.rmtree(cam_dir)
    cam_dir.mkdir(parents=True, exist_ok=True)
    progress_path = cam_dir / "engine_counts.json"

    replay = ReplayJob(
        live_url=live_url,
        start_dt=start_utc,
        end_dt=end_utc,
        out_dir=cam_dir,
    )
    start_replay(replay)
    log.info("replay started for %s -> %s", camera_id, cam_dir)

    # 3. Wait for the first fragment to land before launching engine
    deadline = time.time() + 30
    while time.time() < deadline and replay.progress.fragments == 0:
        time.sleep(1.0)
    if replay.progress.fragments == 0:
        log.error("no fragments arrived in 30s — aborting camera")
        stop_replay(replay)
        return {f: {"detected": 0, "expected": cam_spec.get("groundTruth", {}).get(f),
                    "errorPct": None, "grade": "F",
                    "notes": ["no playback fragments arrived"]} for f in cam_spec["features"]}

    # Stage the camera's bar config for the engine (drink_count needs it)
    bar_cfg_path = _stage_bar_config(camera_id, run["venueId"], cam_dir) \
                    if "drink_count" in cam_spec["features"] else None

    # 4. Engine integration — subprocess into test_engine_runner
    engine_proc = _spawn_engine_for_camera(
        manifest_url=manifest_url(replay),
        camera={"cameraId": camera_id, **cam_spec},
        run_id=run_id,
        features=cam_spec["features"],
        progress_path=progress_path,
        venue_id=run["venueId"],
        bar_config_json_path=bar_cfg_path,
    )

    # 5. Live-progress loop — sample worker health, push DDB updates
    last_push = 0.0
    while not replay.progress.finished:
        time.sleep(2.0)
        if engine_proc:
            health.sample(engine_proc.pid)
        # Read engine's cumulative counts (empty until hook is wired)
        live_counts[camera_id] = _read_engine_counts(progress_path)
        # Compute % progress from replay alone (engine runs alongside)
        pct = replay.progress.percent
        if time.time() - last_push >= 5.0:
            _patch_test_run(
                run_id,
                progress=round(pct, 1),
                liveCounts=live_counts,
            )
            last_push = time.time()

    # 6. Tear down replay + engine, gather final per-feature counts
    stop_replay(replay)
    if engine_proc and engine_proc.poll() is None:
        engine_proc.terminate()
        try: engine_proc.wait(timeout=5)
        except Exception: engine_proc.kill()

    final = _read_engine_counts(progress_path)
    log.info("camera %s done — counts=%s", camera_id, final)

    # 7. Per-feature grading
    gt = cam_spec.get("groundTruth", {})
    per_feature: Dict[str, Dict[str, Any]] = {}
    for feature in cam_spec["features"]:
        detected = int(final.get(feature, 0))
        expected = gt.get(feature)
        if expected is None or expected == 0:
            per_feature[feature] = {
                "detected": detected, "expected": expected,
                "errorPct": None, "grade": None,
                "notes": ["no ground truth for this feature"]
                            if expected is None else
                            ["expected = 0; comparison undefined"],
            }
            continue
        err = abs(detected - int(expected)) / float(expected)
        per_feature[feature] = {
            "detected": detected, "expected": int(expected),
            "errorPct": round(err, 3),
            "grade":    grade_for_error(err),
            "notes":    [],
        }
    return per_feature


def execute(run_id: str) -> int:
    log.info("execute run_id=%s", run_id)
    run = _get_test_run(run_id)
    start_utc, end_utc = _build_replay_window(run)
    log.info("replay window UTC: %s -> %s", start_utc.isoformat(), end_utc.isoformat())

    _patch_test_run(run_id, status="running",
                    startedAt=datetime.utcnow().isoformat() + "Z",
                    progress=0)

    health = HealthCollector()
    live_counts: Dict[str, Dict[str, int]] = {}
    per_camera_results: Dict[str, Dict[str, Dict[str, Any]]] = {}
    error_message: Optional[str] = None
    try:
        for cam_spec in run["cameras"]:
            per_camera_results[cam_spec["cameraId"]] = _run_one_camera(
                run_id, run, cam_spec, start_utc, end_utc, health, live_counts,
            )
    except Exception as e:
        log.exception("orchestrator failed")
        error_message = f"{type(e).__name__}: {e}"

    # Aggregate detected counts and ground truth across all cameras for the
    # run. We sum since cameras typically watch different bars / floor zones
    # and ground truth is the operator's total for the whole replay window.
    agg_counts: Dict[str, int] = {}
    agg_gt:     Dict[str, int] = {}
    requested:  set = set()
    for cam_id, feats in per_camera_results.items():
        for fname, fdata in feats.items():
            requested.add(fname)
            agg_counts[fname] = agg_counts.get(fname, 0) + (fdata["detected"] or 0)
            if fdata["expected"] is not None:
                agg_gt[fname] = agg_gt.get(fname, 0) + int(fdata["expected"])

    health_summary = health.finalize(
        completed=(error_message is None),
        notes=[error_message] if error_message else [],
    )
    stability = derive_stability(health_summary)

    graded = grade_run(
        feature_counts=agg_counts,
        ground_truth=agg_gt,
        stability=stability,
        stability_notes=health_summary.notes,
        requested_features=sorted(requested),
    )
    final_results = graded.to_dict()
    _patch_test_run(
        run_id,
        status="complete" if error_message is None else "failed",
        completedAt=datetime.utcnow().isoformat() + "Z",
        progress=100,
        results=final_results,
        workerHealth=health_summary.to_dict(),
        errorMessage=(error_message or ""),
    )
    log.info("done — overall=%s stability=%s", graded.overallGrade, stability)
    return 0 if error_message is None else 1


def _list_pending(limit: int = 50) -> List[Dict[str, Any]]:
    """Fetch all runs in 'pending' status. Uses the Lambda admin API
    (the droplet's IAM user can't scan the new test-runs table)."""
    if not ADMIN_API_URL:
        log.warning("daemon mode requires VITE_ADMIN_API_URL — skipping poll")
        return []
    import requests
    try:
        r = requests.get(f"{ADMIN_API_URL}/admin/test-runs?limit={limit}", timeout=15)
        r.raise_for_status()
        return [run for run in (r.json().get("runs") or []) if run.get("status") == "pending"]
    except Exception as e:
        log.warning("pending poll failed: %s", e)
        return []


def daemon_loop(interval_sec: int = 30) -> int:
    """Poll for pending runs; execute each found run sequentially.

    Sequential (not parallel) by design — running multiple replays at
    once would multiply CPU pressure on the same droplet that's serving
    live cameras. One-at-a-time keeps the worker tester resource cost
    predictable.
    """
    log.info("daemon_loop started — polling every %ds", interval_sec)
    while True:
        try:
            pending = _list_pending()
            if pending:
                log.info("daemon_loop: %d pending runs", len(pending))
                # Process oldest first
                pending.sort(key=lambda r: r.get("createdAt", ""))
                for run in pending:
                    rid = run.get("runId")
                    if not rid: continue
                    try:
                        execute(rid)
                    except Exception as e:
                        log.exception("execute failed for run %s: %s", rid, e)
        except Exception as e:
            log.exception("daemon tick failed: %s", e)
        time.sleep(interval_sec)


def main():
    ap = argparse.ArgumentParser(description="Worker Tester — execute test runs")
    ap.add_argument("run_id", nargs="?", default=None,
                    help="UUID of a specific run; omit to start daemon mode")
    ap.add_argument("--daemon", action="store_true",
                    help="Poll for pending runs in a loop (systemd-style service)")
    ap.add_argument("--interval", type=int, default=30,
                    help="Daemon poll interval seconds (default 30)")
    args = ap.parse_args()
    if args.daemon or not args.run_id:
        return daemon_loop(args.interval)
    return execute(args.run_id)


if __name__ == "__main__":
    sys.exit(main())
