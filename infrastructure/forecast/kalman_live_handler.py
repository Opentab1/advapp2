"""
kalman_live_handler.py — Lightweight Kalman live-update Lambda.

Triggered by: EventBridge rule every 15 minutes while bar is open.
Does NOT import Prophet — numpy only. Fast cold start (~200 ms).

Steps:
  1. Fetch latest actual occupancy snapshot from DynamoDB (past 15 min)
  2. Fetch current forecast for venue from DynamoDB
  3. Run kalman_update() to blend actual into forecast
  4. Write updated forecast back to DynamoDB

Env vars required:
  DYNAMODB_TABLE     — forecast_models
  LIVE_STATE_TABLE   — forecast_live_state  (separate table, TTL-keyed per venue)
  VENUESCOPE_VENUE_ID — or VENUE_IDS comma-sep
"""
from __future__ import annotations
import json
import logging
import os
import sys
import time
from decimal import Decimal

import boto3

sys.path.insert(0, "/var/task/venuescope")

logger = logging.getLogger()
logger.setLevel(logging.INFO)

DYNAMODB_TABLE   = os.environ.get("DYNAMODB_TABLE", "forecast_models")
LIVE_STATE_TABLE = os.environ.get("LIVE_STATE_TABLE", "forecast_live_state")
S3_BUCKET        = os.environ.get("S3_BUCKET", "venuescope-media")


def _float(val) -> float:
    """Convert Decimal (DynamoDB) or str to float safely."""
    if isinstance(val, Decimal):
        return float(val)
    return float(val) if val is not None else 0.0


def _get_live_state(ddb, venue_id: str) -> dict | None:
    table = ddb.Table(LIVE_STATE_TABLE)
    resp = table.get_item(Key={"venue_id": venue_id})
    return resp.get("Item")


def _put_live_state(ddb, venue_id: str, state: dict) -> None:
    table = ddb.Table(LIVE_STATE_TABLE)
    # Set TTL to end of operating day + 6 hours (auto-clean stale records)
    ttl = int(time.time()) + 6 * 3600
    table.put_item(Item={
        "venue_id": venue_id,
        "ttl": ttl,
        **{k: Decimal(str(v)) if isinstance(v, float) else v for k, v in state.items()},
    })


def _get_latest_occupancy(venue_id: str) -> float | None:
    """
    Pull the most recent occupancy snapshot for this venue from DynamoDB.
    Returns None if no recent snapshot available.
    """
    try:
        from core.prophet_forecast.occupancy_snapshots import get_snapshots
        now_ts = time.time()
        # Look back 20 minutes to catch the latest 15-min bucket
        rows = get_snapshots(venue_id, now_ts - 20 * 60, now_ts)
        if rows:
            return float(rows[-1].get("headcount", 0))
    except Exception as exc:
        logger.warning("[kalman] get_snapshots failed: %s", exc)
    return None


def _process_venue(ddb, venue_id: str) -> dict:
    """Run Kalman update for one venue. Returns status dict."""
    from core.prophet_forecast.live_updater import kalman_update

    # Load live state — carries last forecast and uncertainty estimate
    state = _get_live_state(ddb, venue_id) or {}
    y_prev_forecast  = _float(state.get("y_forecast_last"))
    sigma_predicted  = _float(state.get("sigma_predicted")) or 20.0

    # Get actual occupancy
    y_actual = _get_latest_occupancy(venue_id)
    if y_actual is None:
        logger.info("[kalman] %s: no occupancy snapshot — skipping update", venue_id)
        return {"status": "no_data"}

    # Run Kalman update — returns blended estimate (single float)
    # kalman_update(predicted, actual, sigma_predicted, sigma_measurement)
    y_updated = kalman_update(
        predicted=y_prev_forecast,
        actual=y_actual,
        sigma_predicted=sigma_predicted,
    )

    # Decay sigma_predicted toward steady-state (trust model more over time)
    sigma_new = max(4.0, sigma_predicted * 0.9)

    # Persist updated state
    _put_live_state(ddb, venue_id, {
        "y_forecast_last": y_updated,
        "y_actual_last":   y_actual,
        "sigma_predicted": sigma_new,
        "updated_at":      int(time.time()),
    })

    logger.info(
        "[kalman] %s: actual=%.1f  forecast=%.1f  updated=%.1f  sigma=%.2f",
        venue_id, y_actual, y_prev_forecast, y_updated, sigma_new,
    )
    return {
        "status": "ok",
        "y_actual": y_actual,
        "y_forecast_prev": y_prev_forecast,
        "y_updated": y_updated,
        "sigma_predicted": sigma_new,
    }


def handler(event: dict, context) -> dict:
    """Lambda handler — runs Kalman live update for all active venues."""
    logger.info("[kalman] trigger: %s", json.dumps(event, default=str))

    env_ids = os.environ.get("VENUE_IDS", "").strip()
    if env_ids:
        venue_ids = [v.strip() for v in env_ids.split(",") if v.strip()]
    else:
        venue_ids = [os.environ.get("VENUESCOPE_VENUE_ID", "default")]

    ddb = boto3.resource("dynamodb")
    results = {}
    for venue_id in venue_ids:
        try:
            results[venue_id] = _process_venue(ddb, venue_id)
        except Exception as exc:
            logger.error("[kalman] %s: error — %s", venue_id, exc, exc_info=True)
            results[venue_id] = {"status": "error", "error": str(exc)}

    return {"statusCode": 200, "body": json.dumps(results, default=str)}
