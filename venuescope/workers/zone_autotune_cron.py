#!/usr/bin/env python3
"""
Layer 3 — Nightly zone accuracy check against POS ground truth.

For each enabled drink_count camera:
  1. Sum detected drinks from yesterday's shift (VenueScopeJobs DDB records).
  2. Query the venue's POS provider for the same window.
  3. Compute variance_pct. Write it to the camera record.
  4. If |variance_pct| > 15%, set needsRecalibration=True so the admin
     portal surfaces a recalibration prompt on the camera row (Layer 2 badge).

The actual *auto-apply-a-better-config* step requires a replay clip so we
can run the calibrate.py sweep — clip-capture infrastructure is not in
place yet, so for now we log the recommendation and let the operator
re-draw zones manually from the admin editor (Layer 4). Once RTSP
clip-capture lands, the apply-if-better step slots in right here.

Run via cron (see bottom of this file for the crontab entry).
"""
from __future__ import annotations
import os, sys, json, logging, time
from datetime import datetime, timedelta
from pathlib import Path

# Path fix so we can run `python3 venuescope/workers/zone_autotune_cron.py`
# from anywhere without a prior `cd`.
_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parent.parent.parent))
sys.path.insert(0, str(_HERE.parent.parent))

# Load .env for AWS creds + POS tokens
_env = _HERE.parent.parent / ".env"
if _env.exists():
    for _line in _env.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip())

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("zone_autotune")


# Threshold above which we flag the camera for recalibration.
VARIANCE_FLAG_PCT = 15.0

# Shift window convention: 6pm yesterday → 2am today (venue time)
SHIFT_START_HOUR = 18  # 6 pm
SHIFT_END_HOUR   = 26  # 2 am next day (24+2)


def _yesterday_shift_window() -> tuple[float, float]:
    """Return (start_ts, end_ts) for last night's shift in unix seconds."""
    now = datetime.now()
    # If it's between midnight and 3am, "yesterday's shift" is the one that
    # just ended a few hours ago. Otherwise it's the previous night.
    if now.hour < 3:
        shift_end = datetime(now.year, now.month, now.day, 2, 0, 0)
    else:
        tomorrow_2am = datetime(now.year, now.month, now.day, 2, 0, 0) + timedelta(days=1)
        shift_end = tomorrow_2am - timedelta(days=1)   # 2am today
    shift_start = shift_end - timedelta(hours=8)       # 6pm previous day
    return shift_start.timestamp(), shift_end.timestamp()


def _get_camera_detected_drinks(
    venue_id: str, camera_id: str, start_ts: float, end_ts: float,
) -> int | None:
    """Sum drinks detected by the worker for this camera during the window.
    Queries VenueScopeJobs DDB records for the camera. Returns None if no
    records found (camera offline all shift).
    """
    import boto3
    region = (os.environ.get("AWS_DEFAULT_REGION")
              or os.environ.get("AWS_REGION", "us-east-2"))
    ddb = boto3.resource("dynamodb", region_name=region)
    jobs = ddb.Table("VenueScopeJobs")

    # Stable status record (keyed "~cameraId") holds the current running total.
    # Good enough for a nightly check since totalDrinks resets each shift.
    try:
        resp = jobs.get_item(Key={"venueId": venue_id, "jobId": f"~{camera_id}"})
        item = resp.get("Item", {}) or {}
    except Exception as e:
        log.warning(f"[autotune] DDB get_item failed for {camera_id}: {e}")
        return None

    updated_at = float(item.get("updatedAt", 0) or 0)
    # If the stable record was last updated inside (or just after) the shift
    # window, its totalDrinks is the shift total.
    if updated_at < start_ts - 300:
        return None  # record is older than the shift — nothing recent
    return int(item.get("totalDrinks", 0) or 0)


def _check_camera(venue_id: str, camera_id: str) -> dict | None:
    """Returns a dict with variance_pct / recommendation, or None if skipped."""
    from core.pos.reconciliation import reconcile, get_configured_provider

    provider = get_configured_provider()
    if not provider:
        log.debug(f"[autotune] {venue_id}/{camera_id}: no POS provider configured — skip")
        return None

    start_ts, end_ts = _yesterday_shift_window()
    duration = end_ts - start_ts

    detected = _get_camera_detected_drinks(venue_id, camera_id, start_ts, end_ts)
    if detected is None:
        log.info(f"[autotune] {venue_id}/{camera_id}: no recent detection data — skip")
        return None

    try:
        result = reconcile(
            camera_drink_count=detected,
            job_start_time=start_ts,
            job_duration_sec=duration,
            provider=provider,
        )
    except Exception as e:
        log.warning(f"[autotune] reconcile() failed for {camera_id}: {e}")
        return None

    if not result.get("reconciled"):
        log.info(
            f"[autotune] {venue_id}/{camera_id}: "
            f"POS query failed — {result.get('error','unknown')}"
        )
        return None

    variance = float(result.get("variance_pct", 0) or 0)
    pos_count = int(result.get("pos_drink_count", 0) or 0)
    log.info(
        f"[autotune] {venue_id}/{camera_id}: "
        f"detected={detected} pos={pos_count} variance={variance:+.1f}% "
        f"({'OK' if abs(variance) <= VARIANCE_FLAG_PCT else 'NEEDS RECAL'})"
    )
    return {
        "variance_pct":  variance,
        "detected":       detected,
        "pos_count":      pos_count,
        "needs_recal":   abs(variance) > VARIANCE_FLAG_PCT,
    }


def _update_camera_flags(venue_id: str, camera_id: str, result: dict) -> None:
    """Write variance + recalibration flag to the camera record in DDB."""
    import boto3
    region = (os.environ.get("AWS_DEFAULT_REGION")
              or os.environ.get("AWS_REGION", "us-east-2"))
    ddb = boto3.resource("dynamodb", region_name=region)
    cams = ddb.Table("VenueScopeCameras")

    try:
        cams.update_item(
            Key={"venueId": venue_id, "cameraId": camera_id},
            UpdateExpression=(
                "SET posVariancePct   = :v, "
                "    posCheckedAt    = :t, "
                "    posDetectedLast = :d, "
                "    posCountLast    = :p"
            ),
            ExpressionAttributeValues={
                ":v": int(round(result["variance_pct"])),
                ":t": int(time.time()),
                ":d": int(result["detected"]),
                ":p": int(result["pos_count"]),
            },
        )
        if result["needs_recal"]:
            cams.update_item(
                Key={"venueId": venue_id, "cameraId": camera_id},
                UpdateExpression="SET needsRecalibration = :v",
                ExpressionAttributeValues={":v": True},
            )
    except Exception as e:
        log.warning(f"[autotune] DDB update failed for {camera_id}: {e}")


def main() -> int:
    log.info("=== Zone auto-tune cron starting ===")
    try:
        from core.ddb_cameras import list_cameras_ddb
        cams = list_cameras_ddb()
    except Exception as e:
        log.error(f"[autotune] list_cameras_ddb failed: {e}")
        return 1

    checked = 0
    flagged = 0
    for c in cams:
        if not c.get("enabled", True):
            continue
        mode = c.get("mode", "")
        extra = c.get("extra_modes", []) or []
        if mode != "drink_count" and "drink_count" not in extra:
            continue
        venue_id = c.get("venue", "")
        camera_id = c.get("camera_id", "")
        if not venue_id or not camera_id:
            continue

        result = _check_camera(venue_id, camera_id)
        if result is None:
            continue
        checked += 1
        if result["needs_recal"]:
            flagged += 1
        _update_camera_flags(venue_id, camera_id, result)

    log.info(f"=== Zone auto-tune done: {checked} checked, {flagged} flagged ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# ── Cron setup ────────────────────────────────────────────────────────────────
# Add to root's crontab on the droplet (`crontab -e`):
#
#   0 3 * * *  cd /opt/venuescope && \
#              /opt/venuescope/venv/bin/python3 \
#              venuescope/workers/zone_autotune_cron.py \
#              >> /var/log/venuescope_zone_autotune.log 2>&1
#
# Runs every night at 3 AM. Requires SQUARE_ACCESS_TOKEN or TOAST_API_KEY
# in /opt/venuescope/venuescope/.env to actually reconcile (no-op otherwise).
