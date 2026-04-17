"""
forecast_training_handler.py — AWS Lambda entry point for weekly model training.

Triggered by: EventBridge rule (weekly, Sundays 02:00 UTC)
Env vars required:
  DYNAMODB_TABLE    — forecast_models DynamoDB table name
  S3_BUCKET         — venuescope-media
  FORECASTER        — prophet | gbm  (default: prophet)
  VENUE_IDS         — comma-separated list of venue_ids to train, OR
                      leave blank to pull from DynamoDB scan
"""
from __future__ import annotations
import json
import logging
import os
import sys
import traceback
from datetime import date, timedelta

import boto3

# Add venuescope package to path (container layout)
sys.path.insert(0, "/var/task/venuescope")

logger = logging.getLogger()
logger.setLevel(logging.INFO)

DYNAMODB_TABLE = os.environ.get("DYNAMODB_TABLE", "forecast_models")
S3_BUCKET      = os.environ.get("S3_BUCKET", "venuescope-media")
FORECASTER     = os.environ.get("FORECASTER", "prophet")


def _get_venue_ids() -> list[str]:
    """Return list of venue_ids to train.
    Reads VENUE_IDS env var (comma-sep), or falls back to DynamoDB scan."""
    env_ids = os.environ.get("VENUE_IDS", "").strip()
    if env_ids:
        return [v.strip() for v in env_ids.split(",") if v.strip()]

    # Scan DynamoDB for all venue_ids that have snapshots
    ddb = boto3.resource("dynamodb")
    table = ddb.Table(DYNAMODB_TABLE)
    resp = table.scan(ProjectionExpression="venue_id")
    ids = list({item["venue_id"] for item in resp.get("Items", [])})
    if not ids:
        # Fall back to default single venue
        ids = [os.environ.get("VENUESCOPE_VENUE_ID", "default")]
    return ids


def _train_venue(venue_id: str) -> dict:
    """Run the full training pipeline for one venue. Returns status dict."""
    from core.prophet_forecast.training_pipeline import train_venue_model

    # city/lat/lon — pull from env or use defaults (Tampa)
    city = os.environ.get("VENUE_CITY", "tampa")
    lat  = float(os.environ.get("VENUE_LAT", "27.9506"))
    lon  = float(os.environ.get("VENUE_LON", "-82.4572"))

    return train_venue_model(venue_id=venue_id, city=city, lat=lat, lon=lon)


def handler(event: dict, context) -> dict:
    """Lambda handler — trains Prophet models for all venues."""
    logger.info("[training] EventBridge trigger: %s", json.dumps(event, default=str))

    venue_ids = _get_venue_ids()
    logger.info("[training] Venues to train: %s", venue_ids)

    results = {}
    for venue_id in venue_ids:
        try:
            res = _train_venue(venue_id)
            results[venue_id] = {"status": "ok", **res}
            logger.info("[training] %s: OK — %s", venue_id, res)
        except Exception as exc:
            tb = traceback.format_exc()
            results[venue_id] = {"status": "error", "error": str(exc), "traceback": tb}
            logger.error("[training] %s: FAILED — %s\n%s", venue_id, exc, tb)

    failed = [v for v, r in results.items() if r["status"] == "error"]
    return {
        "statusCode": 200 if not failed else 207,
        "body": json.dumps(results, default=str),
        "failed_venues": failed,
    }
