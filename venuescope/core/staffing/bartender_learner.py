"""
VenueScope — Bartender capacity learner.

Reads last 90 days of completed job records from DynamoDB, extracts
per-bartender drinks/hr from bartenderBreakdown, and computes the
venue's drinks-per-cover ratio from (totalDrinks, totalEntries) pairs.

Writes learned model to DynamoDB as jobId='staffing#capacity_model'.
Called by forecast_cron.py at 6 AM alongside the Prophet retraining.
"""
from __future__ import annotations
import json
import logging
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

_DYNAMODB_TABLE = "VenueScopeJobs"


def _ddb_client():
    import boto3
    return boto3.client(
        "dynamodb",
        region_name=os.environ.get("AWS_REGION", "us-east-2"),
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )


def learn_bartender_capacities(venue_id: str, lookback_days: int = 90) -> dict:
    """
    Query DynamoDB for completed jobs in the last `lookback_days`.
    Extract per-bartender dph stats and venue drinks-per-cover ratio.

    Returns:
    {
      "bartenders": {
        "Sabrina": {"dph_median": 24.2, "dph_p60": 26.1, "shifts": 12}
      },
      "venue_dph": 26.1,                   # p60 median across all bartenders' readings
      "drinks_per_cover_per_hour": 0.82,   # learned from (drinks, entries) pairs
      "covers_per_bartender": 32,          # venue_dph / drinks_per_cover_per_hour
      "shifts_analyzed": 45,
      "data_age_days": 67,
      "source": "learned" | "no_data",
    }
    """
    try:
        ddb = _ddb_client()
    except Exception as exc:
        logger.warning("[learner] Cannot connect to DynamoDB: %s", exc)
        return _empty_result("no_data")

    cutoff_ts = int(time.time()) - lookback_days * 86400
    # Inverted sort key range: recent jobs have SMALLER inverted key
    inv_cutoff = 9999999999 - cutoff_ts
    sk_high = f"!{inv_cutoff:010d}\uffff"
    sk_low  = "!0000000000"

    all_items: list[dict] = []
    last_key = None
    try:
        while True:
            kwargs: dict = dict(
                TableName=_DYNAMODB_TABLE,
                KeyConditionExpression="venueId = :v AND jobId BETWEEN :lo AND :hi",
                ExpressionAttributeValues={
                    ":v":  {"S": venue_id},
                    ":lo": {"S": sk_low},
                    ":hi": {"S": sk_high},
                },
                Limit=200,
            )
            if last_key:
                kwargs["ExclusiveStartKey"] = last_key
            resp = ddb.query(**kwargs)
            all_items.extend(resp.get("Items", []))
            last_key = resp.get("LastEvaluatedKey")
            if not last_key or len(all_items) >= 1000:
                break
    except Exception as exc:
        logger.warning("[learner] DynamoDB query error: %s", exc)
        return _empty_result("no_data")

    if not all_items:
        return _empty_result("no_data")

    # ── Parse each job ────────────────────────────────────────────────────────
    bartender_dphs: dict[str, list[float]] = {}
    dpc_samples: list[float] = []    # drinks-per-cover (per shift, not per hour)
    shifts_analyzed = 0
    oldest_ts = int(time.time())

    for item in all_items:
        bd_raw = (item.get("bartenderBreakdown") or {}).get("S", "")
        if not bd_raw:
            continue

        try:
            bd = json.loads(bd_raw)
        except Exception:
            continue

        if not isinstance(bd, dict):
            continue

        shifts_analyzed += 1

        # Track oldest job timestamp from the inverted sort key
        try:
            sk = (item.get("jobId") or {}).get("S", "")
            if sk.startswith("!") and len(sk) >= 11:
                inv_ts = int(sk[1:11])
                ts = 9999999999 - inv_ts
                oldest_ts = min(oldest_ts, ts)
        except Exception:
            pass

        # Per-bartender dph — cap to realistic range (5-100 drinks/hr)
        # Values >100 are video-time artifacts (short clips inflate the rate)
        for name, data in bd.items():
            if not isinstance(data, dict):
                continue
            dph = data.get("per_hour", 0.0)
            if dph and 5.0 <= float(dph) <= 100.0:
                bartender_dphs.setdefault(name, []).append(float(dph))

        # Venue-level drinks-per-cover: total drinks / total entries (covers)
        total_drinks  = int((item.get("totalDrinks")  or {}).get("N", 0) or 0)
        total_entries = int((item.get("totalEntries") or {}).get("N", 0) or 0)
        if total_drinks > 0 and total_entries > 0:
            dpc = total_drinks / total_entries
            if 0.15 <= dpc <= 6.0:   # sanity bounds
                dpc_samples.append(dpc)

    if not bartender_dphs and not dpc_samples:
        return _empty_result("no_data")

    # ── Compute per-bartender stats ───────────────────────────────────────────
    bartender_stats: dict[str, dict] = {}
    all_dphs: list[float] = []

    for name, dphs in bartender_dphs.items():
        s = sorted(dphs)
        n = len(s)
        median = s[n // 2]
        p60    = s[min(int(n * 0.60), n - 1)]
        bartender_stats[name] = {
            "dph_median": round(median, 1),
            "dph_p60":    round(p60, 1),
            "shifts":     n,
        }
        all_dphs.extend(dphs)

    # Venue dph: p60 across all bartender readings
    if all_dphs:
        all_dphs.sort()
        venue_dph = all_dphs[min(int(len(all_dphs) * 0.60), len(all_dphs) - 1)]
    else:
        venue_dph = 28.0   # concept default fallback

    # ── Drinks-per-cover conversion ───────────────────────────────────────────
    # dpc_samples = drinks per total cover for the whole shift.
    # Convert to per-hour: assume avg visit = 2.5 hours
    AVG_VISIT_HOURS = 2.5
    if dpc_samples:
        dpc_samples.sort()
        dpc_shift = dpc_samples[len(dpc_samples) // 2]   # median
        dpc_per_hour = round(dpc_shift / AVG_VISIT_HOURS, 3)
    else:
        dpc_per_hour = 0.80   # pub default

    # Derived covers-per-bartender (for simple hourly scheduling)
    covers_per_bartender = max(10, int(round(venue_dph / max(dpc_per_hour, 0.1))))

    data_age_days = int((time.time() - oldest_ts) / 86400) if oldest_ts < int(time.time()) else 0

    return {
        "bartenders":                bartender_stats,
        "venue_dph":                 round(venue_dph, 1),
        "drinks_per_cover_per_hour": dpc_per_hour,
        "covers_per_bartender":      covers_per_bartender,
        "shifts_analyzed":           shifts_analyzed,
        "data_age_days":             data_age_days,
        "computed_at":               int(time.time()),
        "source":                    "learned",
    }


def _empty_result(source: str = "no_data") -> dict:
    return {
        "bartenders":                {},
        "venue_dph":                 28.0,
        "drinks_per_cover_per_hour": 0.80,
        "covers_per_bartender":      35,
        "shifts_analyzed":           0,
        "data_age_days":             0,
        "computed_at":               int(time.time()),
        "source":                    source,
    }


def run_and_store(venue_id: str) -> dict:
    """
    Learn bartender capacities and write to DynamoDB.
    Called from forecast_cron.py during the full 6 AM run.
    """
    result = learn_bartender_capacities(venue_id)

    try:
        ddb = _ddb_client()
        ddb.put_item(
            TableName=_DYNAMODB_TABLE,
            Item={
                "venueId":      {"S": venue_id},
                "jobId":        {"S": "staffing#capacity_model"},
                "capacityJson": {"S": json.dumps(result)},
                "generatedAt":  {"N": str(int(time.time()))},
            },
        )
        logger.info(
            "[staffing] Capacity model stored: %d shifts, venue_dph=%.1f, dpc=%.2f, cpb=%d",
            result["shifts_analyzed"],
            result["venue_dph"],
            result["drinks_per_cover_per_hour"],
            result["covers_per_bartender"],
        )
    except Exception as exc:
        logger.warning("[staffing] Could not store capacity model in DynamoDB: %s", exc)

    return result


def load_capacity_model(venue_id: str) -> Optional[dict]:
    """Read the previously stored capacity model from DynamoDB."""
    try:
        ddb = _ddb_client()
        resp = ddb.get_item(
            TableName=_DYNAMODB_TABLE,
            Key={"venueId": {"S": venue_id}, "jobId": {"S": "staffing#capacity_model"}},
        )
        item = resp.get("Item")
        if item and "capacityJson" in item:
            return json.loads(item["capacityJson"]["S"])
    except Exception as exc:
        logger.debug("[staffing] Could not load capacity model: %s", exc)
    return None
