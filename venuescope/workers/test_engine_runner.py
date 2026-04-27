#!/usr/bin/env python3
"""
Test Engine Runner — single-camera, single-replay invocation of the
production VenueProcessor against a local HLS manifest produced by
nvr_replay.

Spawned as a subprocess by test_run_orchestrator. Writes per-feature
cumulative counts to --output JSON as it processes, so the orchestrator
can stream live progress to DDB.

  python -m workers.test_engine_runner \
    --manifest file:///tmp/.../index.m3u8 \
    --modes drink_count,people_count \
    --output /tmp/.../engine_counts.json \
    --camera-id cam_1234 \
    --venue-id theblindgoat \
    [--bar-config-json '/path/to/bar_config.json'] \
    [--max-seconds 0]
"""

from __future__ import annotations
import os
import sys
import json
import time
import argparse
import logging
from pathlib import Path
from typing import Dict, Any, Optional

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] test_engine_runner: %(message)s',
)
log = logging.getLogger("test_engine_runner")


# ── Feature count extraction ─────────────────────────────────────────────

def _extract_counts(summary: Dict[str, Any]) -> Dict[str, int]:
    """Reduce VenueProcessor's rich summary dict to the simple per-feature
    integer counts the Worker Tester needs for grading.

    Mapping:
      drink_count    → sum of bartender drink totals
      bottle_count   → sum of bottle pours
      people_count   → peak concurrent occupancy (during the replay window)
      table_turns    → sum of turn_counts across tables
      table_service  → average response_seconds across visits
      staff_activity → total active minutes (from staff tracker)
    """
    counts: Dict[str, int] = {}

    # Only emit a feature key when the corresponding analyzer ran (i.e. its
    # output is present in summary). Always-emitting zeros would cause the
    # orchestrator to compute error% against ground truth even for features
    # the user didn't request.

    if "bartenders" in summary and isinstance(summary["bartenders"], dict):
        total = 0
        for v in summary["bartenders"].values():
            if isinstance(v, dict):
                total += int(v.get("drinks", 0))
        counts["drink_count"] = total

    if "bottles" in summary and isinstance(summary["bottles"], dict):
        total = 0
        for v in summary["bottles"].values():
            if isinstance(v, dict):
                total += int(v.get("count", 0)) or int(v.get("pours", 0))
        counts["bottle_count"] = total

    if "peak_occupancy" in summary:
        counts["people_count"] = int(summary["peak_occupancy"])

    if "tables" in summary and isinstance(summary["tables"], dict):
        total = 0
        for v in summary["tables"].values():
            if isinstance(v, dict):
                total += int(v.get("turn_count", 0)) or int(v.get("total_turns", 0))
        counts["table_turns"] = total

    visits = summary.get("table_service_visits") or summary.get("visits") or []
    if isinstance(visits, list) and visits:
        responses = [v.get("response_seconds") for v in visits if isinstance(v, dict)]
        responses = [r for r in responses if isinstance(r, (int, float))]
        if responses:
            counts["table_service"] = int(round(sum(responses) / len(responses)))

    if "staff" in summary and isinstance(summary["staff"], dict):
        counts["staff_activity"] = int(summary["staff"].get("active_minutes", 0))

    return counts


# ── Periodic progress writer (run in a thread alongside VenueProcessor) ──

class _ProgressWriter:
    """Polls a shared analyzers dict on a timer and dumps counts to JSON.

    The orchestrator reads this file every few seconds to push live
    progress to DDB. We poll instead of streaming so we don't have to
    hook into VenueProcessor's per-frame loop.
    """
    def __init__(self, output_path: Path, processor):
        self.output_path = output_path
        self.processor   = processor
        self._stop = False
        self._thread = None

    def start(self):
        import threading
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop = True
        if self._thread:
            self._thread.join(timeout=2.0)

    def _loop(self):
        import time
        # Poll interval — coarse enough that we don't spam disk, fine enough
        # that the admin UI sees movement every few seconds.
        while not self._stop:
            try:
                snap = self._snapshot()
                self.output_path.write_text(json.dumps(snap))
            except Exception as e:
                log.debug("progress snapshot failed: %s", e)
            time.sleep(3.0)

    def _snapshot(self) -> Dict[str, Any]:
        """Best-effort snapshot of current state. VenueProcessor exposes
        running totals via its analyzer instance attributes — we read those
        directly. If unavailable, we fall back to peak_occupancy from the
        processor itself."""
        out: Dict[str, Any] = {}
        try:
            out["people_count"] = int(getattr(self.processor, "_peak_people", 0))
        except Exception:
            pass
        # Live drink count: read from the DrinkCounter analyzer if present
        analyzers = getattr(self.processor, "_active_analyzers", None) or {}
        for mode, an in analyzers.items():
            try:
                if mode == "drink_count" and an is not None:
                    out["drink_count"] = int(getattr(an, "_total_serves", 0))
                elif mode == "bottle_count" and an is not None:
                    out["bottle_count"] = int(getattr(an, "_total_pours", 0))
                elif mode == "table_turns" and an is not None:
                    sessions = getattr(an, "completed_sessions", []) or []
                    out["table_turns"] = len(sessions)
            except Exception:
                pass
        return out


# ── Main ─────────────────────────────────────────────────────────────────

def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest",        required=True,
                    help="file:// URL or path to local HLS index.m3u8")
    ap.add_argument("--modes",           required=True,
                    help="comma-separated list of analysis modes")
    ap.add_argument("--output",          required=True,
                    help="JSON file path for live + final counts")
    ap.add_argument("--camera-id",       required=True)
    ap.add_argument("--venue-id",        required=True)
    ap.add_argument("--bar-config-json", default=None,
                    help="optional JSON file containing bar_config")
    ap.add_argument("--max-seconds",     default="0",
                    help="0 = run until source ends")
    args = ap.parse_args(argv)

    # Lazy imports — keep CLI startup fast for arg-only invocations
    from core.tracking.engine import VenueProcessor
    from core.bar_config import BarConfig, BarStation

    # Strip file:// prefix — VenueProcessor expects a path or http URL
    src = args.manifest
    if src.startswith("file://"):
        src = src[len("file://"):]

    modes = [m.strip() for m in args.modes.split(",") if m.strip()]
    primary_mode = modes[0]
    extra_modes  = modes[1:]
    log.info("starting: src=%s primary=%s extras=%s", src, primary_mode, extra_modes)

    bar_config = None
    if args.bar_config_json:
        try:
            d = json.loads(Path(args.bar_config_json).read_text())
            stations = [BarStation(**s) for s in d.pop("stations", [])]
            d.setdefault("venue_id",     args.venue_id)
            d.setdefault("display_name", args.camera_id)
            cfg = BarConfig(**d); cfg.stations = stations
            bar_config = cfg
        except Exception as e:
            log.warning("bar_config load failed: %s", e)

    extra_config = {
        "venue_id":   args.venue_id,
        "camera_id":  args.camera_id,
        "max_seconds": float(args.max_seconds),
        # Disable thumbnail uploads — orchestrator-mode runs are admin-only
        # and don't need S3 snapshot artifacts.
        "skip_snapshots": True,
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    proc = VenueProcessor(
        job_id=f"test_{args.camera_id}",
        analysis_mode=primary_mode,
        source=src,
        # Treat as file source — local manifest, finite, no aws_sync push.
        source_type="file",
        model_profile="balanced",
        bar_config=bar_config,
        shift=None,
        extra_config=extra_config,
        result_dir=str(output_path.parent),
        annotate=False,
        progress_cb=lambda pct, msg: log.info("[engine %.0f%%] %s", pct, msg),
        extra_modes=extra_modes,
    )

    # Live progress writer
    writer = _ProgressWriter(output_path, proc)
    writer.start()

    try:
        summary = proc.run()
    except Exception as e:
        log.exception("VenueProcessor.run() failed")
        writer.stop()
        # Persist whatever we had so the orchestrator can grade with partial data
        try:
            output_path.write_text(json.dumps({"_error": f"{type(e).__name__}: {e}"}))
        except Exception:
            pass
        return 1

    writer.stop()
    counts = _extract_counts(summary)
    log.info("final counts: %s", counts)
    output_path.write_text(json.dumps(counts))
    return 0


if __name__ == "__main__":
    sys.exit(main())
