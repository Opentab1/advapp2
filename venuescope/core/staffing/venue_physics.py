"""
VenueScope — Venue physics configuration.
Stores physical layout + staffing thresholds in DynamoDB as jobId='config#venue_physics'.
Falls back to concept-type defaults when not configured.
"""
from __future__ import annotations
import json
import logging
import os
import time

logger = logging.getLogger(__name__)

# ── Concept-type defaults ─────────────────────────────────────────────────────
# covers_per_bartender: how many concurrent guests one bartender can serve
# bartender_dph: drinks produced per hour at sustainable pace (used with learned dpc)
# drinks_per_cover_per_hour: drinks consumed per guest per hour
# tables_per_server: concurrent tables one server covers (0 = bar-only, no servers)

_CONCEPT_DEFAULTS: dict[str, dict] = {
    "bar": {
        "drinks_per_cover_per_hour": 0.80,
        "bartender_dph": 28,
        "covers_per_bartender": 35,
        "tables_per_server": 0,
        "avg_party_size": 2.0,
        "door_threshold_pct": 0.55,
        "barback_threshold_pct": 0.40,
        "always_bartenders": 1,
    },
    "cocktail": {
        "drinks_per_cover_per_hour": 0.65,
        "bartender_dph": 18,
        "covers_per_bartender": 28,
        "tables_per_server": 5.0,
        "avg_party_size": 2.5,
        "door_threshold_pct": 0.60,
        "barback_threshold_pct": 0.45,
        "always_bartenders": 1,
    },
    "nightclub": {
        "drinks_per_cover_per_hour": 1.20,
        "bartender_dph": 35,
        "covers_per_bartender": 30,
        "tables_per_server": 0,
        "avg_party_size": 3.0,
        "door_threshold_pct": 0.35,
        "barback_threshold_pct": 0.30,
        "always_bartenders": 2,
    },
    "sports_bar": {
        "drinks_per_cover_per_hour": 1.00,
        "bartender_dph": 28,
        "covers_per_bartender": 40,
        "tables_per_server": 6.0,
        "avg_party_size": 3.5,
        "door_threshold_pct": 0.65,
        "barback_threshold_pct": 0.50,
        "always_bartenders": 1,
    },
    "restaurant": {
        "drinks_per_cover_per_hour": 0.50,
        "bartender_dph": 20,
        "covers_per_bartender": 40,
        "tables_per_server": 5.0,
        "avg_party_size": 2.5,
        "door_threshold_pct": 0.85,
        "barback_threshold_pct": 0.60,
        "always_bartenders": 1,
    },
    "default": {
        "drinks_per_cover_per_hour": 0.80,
        "bartender_dph": 28,
        "covers_per_bartender": 35,
        "tables_per_server": 0,
        "avg_party_size": 2.5,
        "door_threshold_pct": 0.55,
        "barback_threshold_pct": 0.40,
        "always_bartenders": 1,
    },
}

_DYNAMODB_TABLE = "VenueScopeJobs"


def _concept_key(concept_type: str) -> str:
    return concept_type.lower().replace(" ", "_").replace("-", "_")


def get_venue_physics(venue_id: str, concept_type: str = "default") -> dict:
    """
    Load venue physics from DynamoDB (jobId='config#venue_physics').
    Falls back to concept-type defaults.

    Guaranteed keys in returned dict:
      bar_stations, max_bartenders, capacity,
      drinks_per_cover_per_hour, bartender_dph, covers_per_bartender,
      tables_per_server, avg_party_size,
      door_threshold_pct, barback_threshold_pct, always_bartenders
    """
    defaults = dict(_CONCEPT_DEFAULTS.get(_concept_key(concept_type), _CONCEPT_DEFAULTS["default"]))

    # Try DynamoDB
    try:
        import boto3
        ddb = boto3.client(
            "dynamodb",
            region_name=os.environ.get("AWS_REGION", "us-east-2"),
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        )
        resp = ddb.get_item(
            TableName=_DYNAMODB_TABLE,
            Key={"venueId": {"S": venue_id}, "jobId": {"S": "config#venue_physics"}},
        )
        item = resp.get("Item")
        if item and "configJson" in item:
            stored = json.loads(item["configJson"]["S"])
            defaults.update(stored)
            logger.debug("[physics] Loaded venue physics for %s from DynamoDB", venue_id)
    except Exception as exc:
        logger.debug("[physics] DynamoDB unavailable, using concept defaults: %s", exc)

    # Env-var overrides (useful for cron environment)
    defaults.setdefault("bar_stations", int(os.environ.get("VENUESCOPE_BAR_STATIONS", "1")))
    defaults.setdefault("max_bartenders", defaults["bar_stations"] * 2)
    defaults.setdefault("capacity", int(os.environ.get("VENUESCOPE_CAPACITY", "150")))

    return defaults


def save_venue_physics(venue_id: str, config: dict) -> bool:
    """Persist venue physics config to DynamoDB."""
    try:
        import boto3
        ddb = boto3.client(
            "dynamodb",
            region_name=os.environ.get("AWS_REGION", "us-east-2"),
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        )
        ddb.put_item(
            TableName=_DYNAMODB_TABLE,
            Item={
                "venueId":    {"S": venue_id},
                "jobId":      {"S": "config#venue_physics"},
                "configJson": {"S": json.dumps(config)},
                "updatedAt":  {"N": str(int(time.time()))},
            },
        )
        logger.info("[physics] Saved venue physics for %s", venue_id)
        return True
    except Exception as exc:
        logger.error("[physics] Save failed: %s", exc)
        return False
