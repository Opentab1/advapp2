#!/usr/bin/env python3
"""
VenueScope — Morning forecast cron job.

Runs once at 6 AM venue-local time. Retrains the Prophet model on the last
90 days of occupancy data, generates tonight's forecast, then writes the
result to DynamoDB. The React frontend reads the stored forecast at page load
— no HTTP call to the droplet ever required.

A 3 PM midday refresh can be triggered with --refresh to update weather/events
without retraining the model.

Crontab entries (add with `crontab -e`):

# 6 AM — full run: retrain + forecast + backfill
0 6 * * * cd /opt/venuescope && export $(grep -v "^#" .env | xargs) && PYTHONPATH=/opt/venuescope/venuescope /opt/venuescope/venv/bin/python3 venuescope/workers/forecast_cron.py >> /var/log/venuescope_forecast.log 2>&1

# 3 PM — midday refresh: updated weather only, no retraining
0 15 * * * cd /opt/venuescope && export $(grep -v "^#" .env | xargs) && PYTHONPATH=/opt/venuescope/venuescope /opt/venuescope/venv/bin/python3 venuescope/workers/forecast_cron.py --refresh >> /var/log/venuescope_forecast.log 2>&1

Steps:
  1. Resolve venue config (venue_id, city, lat/lon)
  2. Retrain Prophet on last 90 days of occupancy snapshots (skipped with --refresh)
  3. Generate tonight's forecast (Prophet → weather → competition drag → holidays)
  4. Write result to DynamoDB under jobId = "forecast#YYYY-MM-DD"
  5. Backfill yesterday's actual covers into yesterday's forecast record
"""
from __future__ import annotations
import argparse
import json
import logging
import os
import sys
import time
import zoneinfo
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# ── Path setup so crontab invocations can find the project ────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_PROJECT_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("forecast_cron")

# ── DynamoDB table name (shared with aws_sync.py) ─────────────────────────────
_DYNAMODB_TABLE = "VenueScopeJobs"


# ─────────────────────────────────────────────────────────────────────────────
# Timezone helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_venue_today(tz_name: str = "America/New_York") -> date:
    """Return today's date in the venue's local timezone."""
    try:
        tz = zoneinfo.ZoneInfo(tz_name)
        return datetime.now(tz).date()
    except Exception:
        return date.today()  # fallback


# ─────────────────────────────────────────────────────────────────────────────
# Config helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_venue_config() -> tuple[str, str, float, float]:
    """
    Return (venue_id, city, lat, lon).
    Priority: VENUESCOPE_VENUE_ID env var → identity file written by auth.py on login.
    """
    venue_id = os.environ.get("VENUESCOPE_VENUE_ID", "")
    if not venue_id:
        identity_file = Path.home() / ".venuescope" / "venue_identity.json"
        if identity_file.exists():
            try:
                data = json.loads(identity_file.read_text())
                venue_id = data.get("venueId", "")
            except Exception:
                pass

    if not venue_id:
        logger.error(
            "No venue ID configured. Set VENUESCOPE_VENUE_ID env var or log in via the app first."
        )
        sys.exit(1)

    city = os.environ.get("VENUESCOPE_CITY", "tampa")

    try:
        from venuescope.core.event_intelligence import CITY_LATLON
        lat, lon = CITY_LATLON.get(city.lower(), (27.9506, -82.4572))
    except Exception:
        lat, lon = 27.9506, -82.4572  # Tampa default

    return venue_id, city, lat, lon


def _get_avg_drink_price() -> float:
    """Read from env var; venues can override via VENUESCOPE_AVG_DRINK_PRICE."""
    return float(os.environ.get("VENUESCOPE_AVG_DRINK_PRICE", "33.0"))


def _get_venue_capacity() -> int:
    """Read venue capacity; used by the staffing engine."""
    return int(os.environ.get("VENUESCOPE_CAPACITY", "150"))


def _fetch_venue_profile(venue_id: str) -> dict:
    """
    Pull per-venue onboarding profile from DDB so the prior forecast can
    scale to this venue instead of using a generic industry baseline.

    Returns {"capacity", "tier", "slow_day_covers", "busy_day_covers"} —
    any missing field falls back to .env/default.
    """
    profile: dict = {}
    try:
        import boto3
        ddb = boto3.resource(
            "dynamodb",
            region_name=os.environ.get("AWS_REGION", "us-east-2"),
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        )
        item = ddb.Table("VenueScopeVenues").get_item(
            Key={"venueId": venue_id}
        ).get("Item", {})
        if item.get("capacity") is not None:
            profile["capacity"] = int(item["capacity"])
        if item.get("venueTier"):
            profile["tier"] = str(item["venueTier"])
        if item.get("slowDayCovers") is not None:
            profile["slow_day_covers"] = float(item["slowDayCovers"])
        if item.get("busyDayCovers") is not None:
            profile["busy_day_covers"] = float(item["busyDayCovers"])
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(
            "[forecast_cron] failed to load venue profile for %s: %s",
            venue_id, e,
        )
    return profile


# ─────────────────────────────────────────────────────────────────────────────
# DynamoDB write
# ─────────────────────────────────────────────────────────────────────────────

def _write_forecast_to_ddb(venue_id: str, target_date: date, forecast: dict) -> bool:
    """
    Write the forecast dict to DynamoDB.

    Item layout:
      venueId               = venue_id                      (partition key)
      jobId                 = "forecast#YYYY-MM-DD"         (sort key)
      forecastJson          = json.dumps(forecast)          (full result)
      forecastDate          = "YYYY-MM-DD"                  (for freshness check)
      generatedAt           = unix timestamp                (for TTL / display)
      modelType             = "trained" | "prior"           (for learning %)
      trainingSnapshotCount = N                             (for learning %)
      trainingThreshold     = 100                           (hardcoded target)

    The two new training-signal fields drive the PWA's "Learning mode — N%
    trained" banner. Learning % = min(100, snapshotCount / threshold * 100).
    When modelType == "trained" we're at 100%. When "prior", percent reflects
    progress toward the threshold.

    The "forecast#" prefix keeps these items well away from the "!" reverse-ts
    job items and "~" live-camera items — they sort naturally to the end of the
    key space and won't appear in job list queries.
    """
    try:
        import boto3
        ddb = boto3.client(
            "dynamodb",
            region_name=os.environ.get("AWS_REGION", "us-east-2"),
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        )
        date_str = target_date.isoformat()
        job_id   = f"forecast#{date_str}"

        # Mirror two key fields to top-level attrs so the PWA doesn't have to
        # JSON-parse forecastJson just to render the learning banner.
        model_type        = str(forecast.get("model_type", "unknown"))
        snapshot_count    = int(forecast.get("training_snapshots")
                                or forecast.get("snapshot_count") or 0)
        training_target   = int(forecast.get("training_target", 100))

        ddb.put_item(
            TableName=_DYNAMODB_TABLE,
            Item={
                "venueId":               {"S": venue_id},
                "jobId":                 {"S": job_id},
                "forecastJson":          {"S": json.dumps(forecast)},
                "forecastDate":          {"S": date_str},
                "generatedAt":           {"N": str(int(time.time()))},
                "modelType":             {"S": model_type},
                "trainingSnapshotCount": {"N": str(snapshot_count)},
                "trainingThreshold":     {"N": str(training_target)},
            },
        )
        logger.info(
            "[cron] Forecast written → %s / %s  (model=%s snapshots=%d/%d)",
            venue_id, job_id, model_type, snapshot_count, training_target,
        )
        return True
    except Exception as exc:
        logger.error("[cron] DynamoDB write failed: %s", exc)
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Actuals backfill
# ─────────────────────────────────────────────────────────────────────────────

def _backfill_actual(venue_id: str, yesterday: date) -> None:
    """
    Read yesterday's completed jobs from DynamoDB, compute actual covers,
    and write them back to the forecast#{yesterday} record.
    Fields added: actualCovers, actualRevenue, actualAccuracyPct.
    """
    import boto3
    ddb = boto3.client(
        "dynamodb",
        region_name=os.environ.get("AWS_REGION", "us-east-2"),
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )

    # Read yesterday's forecast from DynamoDB to get predicted mid
    forecast_job_id = f"forecast#{yesterday.isoformat()}"
    try:
        r = ddb.get_item(
            TableName="VenueScopeJobs",
            Key={"venueId": {"S": venue_id}, "jobId": {"S": forecast_job_id}},
        )
        item = r.get("Item")
        if not item:
            logger.info("[backfill] No forecast record for %s — skipping", yesterday)
            return
        fc = json.loads(item["forecastJson"]["S"])
        predicted_mid = fc.get("final_estimate", {}).get("mid", 0)
    except Exception as exc:
        logger.warning("[backfill] Could not read yesterday's forecast: %s", exc)
        return

    # Query all completed jobs for yesterday from DynamoDB
    # Yesterday = createdAt between yesterday 16:00 and today 02:00 (operating window)
    tz_name = os.environ.get("VENUESCOPE_TIMEZONE", "America/New_York")
    try:
        tz = zoneinfo.ZoneInfo(tz_name)
        window_start = int(datetime(yesterday.year, yesterday.month, yesterday.day, 16, 0, tzinfo=tz).timestamp())
        window_end   = int(datetime(yesterday.year, yesterday.month, yesterday.day + 1 if yesterday.day < 28 else 1,
                                    2, 0, tzinfo=tz).timestamp())
    except Exception:
        window_start = int(datetime(yesterday.year, yesterday.month, yesterday.day, 16, 0).timestamp())
        window_end   = window_start + 36000

    # Scan for jobs in that window — look for totalEntries (people_count) first
    try:
        # Use inverted sort key range to find jobs in the time window
        inv_start = 9999999999 - window_end
        inv_end   = 9999999999 - window_start
        sk_low  = f"!{inv_start:010d}"
        sk_high = f"!{inv_end:010d}_\uffff"

        resp = ddb.query(
            TableName="VenueScopeJobs",
            KeyConditionExpression="venueId = :v AND jobId BETWEEN :lo AND :hi",
            ExpressionAttributeValues={
                ":v":  {"S": venue_id},
                ":lo": {"S": sk_low},
                ":hi": {"S": sk_high},
            },
        )
        jobs = resp.get("Items", [])
    except Exception as exc:
        logger.warning("[backfill] Could not query yesterday's jobs: %s", exc)
        return

    if not jobs:
        logger.info("[backfill] No jobs found for %s window — skipping actuals", yesterday)
        return

    # Best signal: totalEntries from people_count job
    actual_covers = 0
    for job in jobs:
        mode = (job.get("analysisMode") or {}).get("S", "")
        entries = int((job.get("totalEntries") or {}).get("N", 0) or 0)
        drinks  = int((job.get("totalDrinks")  or {}).get("N", 0) or 0)
        if mode == "people_count" and entries > 0:
            actual_covers = max(actual_covers, entries)
        elif drinks > 0 and actual_covers == 0:
            actual_covers = max(actual_covers, int(drinks / 2.5))

    if actual_covers == 0:
        logger.info("[backfill] Could not determine actual covers for %s", yesterday)
        return

    avg_drink_price = float(os.environ.get("VENUESCOPE_AVG_DRINK_PRICE", "33.0"))
    actual_revenue = round(actual_covers * avg_drink_price)
    # Symmetric MAPE-style accuracy, clamped to [0, 100].
    # The previous formula divided the error by `predicted`, which went deeply
    # negative when actual >> predicted (e.g. predicted=89, actual=644 → -523%).
    # Dividing by max(actual, predicted) keeps the score interpretable as
    # "how close we were" and caps the worst case at 0%.
    if predicted_mid:
        err = abs(actual_covers - predicted_mid)
        denom = max(actual_covers, predicted_mid, 1)
        accuracy_pct = round(max(0.0, min(100.0, (1 - err / denom) * 100)), 1)
    else:
        accuracy_pct = None

    try:
        ddb.update_item(
            TableName="VenueScopeJobs",
            Key={"venueId": {"S": venue_id}, "jobId": {"S": forecast_job_id}},
            UpdateExpression="SET actualCovers = :ac, actualRevenue = :ar, actualAccuracyPct = :aa",
            ExpressionAttributeValues={
                ":ac": {"N": str(actual_covers)},
                ":ar": {"N": str(actual_revenue)},
                ":aa": {"N": str(accuracy_pct or 0)},
            },
        )
        logger.info(
            "[backfill] %s → actual=%d covers / $%d revenue / %.1f%% accuracy (predicted %d)",
            yesterday, actual_covers, actual_revenue, accuracy_pct or 0, predicted_mid,
        )
    except Exception as exc:
        logger.warning("[backfill] DynamoDB update failed: %s", exc)


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true",
                        help="Midday refresh: update weather/events, skip model retraining")
    args = parser.parse_args()

    t0 = time.time()
    logger.info("=== VenueScope Forecast Cron starting (refresh=%s) ===", args.refresh)

    venue_id, city, lat, lon = _get_venue_config()
    tz_name         = os.environ.get("VENUESCOPE_TIMEZONE", "America/New_York")
    concept_type    = os.environ.get("VENUESCOPE_CONCEPT_TYPE", "default")
    today           = _get_venue_today(tz_name)
    avg_drink_price = _get_avg_drink_price()
    venue_capacity  = _get_venue_capacity()

    # Per-venue onboarding profile overrides the env defaults when the owner
    # has filled it in during onboarding. Keeps the generic prior from
    # overshooting for small venues (Blind Goat 22 actual vs 158 predicted).
    _profile = _fetch_venue_profile(venue_id)
    if "capacity" in _profile:
        venue_capacity = _profile["capacity"]
    venue_tier        = _profile.get("tier", "small_bar")
    slow_day_covers   = _profile.get("slow_day_covers")
    busy_day_covers   = _profile.get("busy_day_covers")

    logger.info("venue=%s  city=%s  date=%s  tz=%s  concept=%s  avg_drink_price=$%.2f  capacity=%d",
                venue_id, city, today, tz_name, concept_type, avg_drink_price, venue_capacity)

    # ── Step 0: Learn bartender capacities (full run only) ────────────────────
    if not args.refresh:
        logger.info("[0/3] Learning bartender capacities from last 90 days…")
        try:
            from venuescope.core.staffing.bartender_learner import run_and_store
            cap_result = run_and_store(venue_id)
            logger.info(
                "[0/3] Capacity model: %d shifts analyzed, venue_dph=%.1f, cpb=%d, source=%s",
                cap_result.get("shifts_analyzed", 0),
                cap_result.get("venue_dph", 0),
                cap_result.get("covers_per_bartender", 0),
                cap_result.get("source", "?"),
            )
        except Exception as exc:
            logger.warning("[0/3] Bartender learner failed (non-fatal): %s", exc)

    # ── Step 1: Retrain Prophet (skipped in --refresh mode) ───────────────────
    # Keep training-signal counts around so we can mirror them into the forecast
    # record — the PWA renders "Learning mode — N% trained" from these.
    last_train_snapshots = 0
    last_train_status    = "skipped"
    if not args.refresh:
        logger.info("[1/3] Retraining Prophet model on last 90 days…")
        try:
            from venuescope.core.prophet_forecast.training_pipeline import train_venue_model
            train_result = train_venue_model(venue_id=venue_id, city=city, lat=lat, lon=lon)
            last_train_snapshots = int(train_result.get("snapshots_used") or 0)
            last_train_status    = str(train_result.get("status") or "unknown")
            logger.info(
                "[1/3] Training → status=%s  snapshots=%d  mape=%s",
                last_train_status, last_train_snapshots,
                train_result.get("mape_estimate", "?"),
            )
            if last_train_status == "insufficient_data":
                logger.info("[1/3] Not enough data yet — will use prior for forecast")
        except Exception as exc:
            # Non-fatal: forecast_tonight will fall back to the generic prior
            logger.warning("[1/3] Training failed (will use existing/prior model): %s", exc)
    else:
        logger.info("[1/3] Skipping retraining (midday refresh mode)")
        # Best-effort: read current snapshot count so the learning% still moves
        try:
            from venuescope.core.prophet_forecast.occupancy_snapshots import get_snapshots
            last_train_snapshots = len(get_snapshots(venue_id) or [])
        except Exception:
            pass

    # ── Step 2: Generate tonight's forecast ───────────────────────────────────
    logger.info("[2/3] Generating tonight's forecast…")
    try:
        from venuescope.core.prophet_forecast.forecast_service import forecast_tonight
        forecast = forecast_tonight(
            venue_id        = venue_id,
            target_date     = today,
            lat             = lat,
            lon             = lon,
            city            = city,
            avg_drink_price = avg_drink_price,
            concept_type    = concept_type,
            venue_capacity  = venue_capacity,
            venue_tier      = venue_tier,
            slow_day_covers = slow_day_covers,
            busy_day_covers = busy_day_covers,
        )
        mid        = forecast.get("final_estimate", {}).get("mid", "?")
        mape       = forecast.get("mape_expected", "?")
        model_type = forecast.get("model_type", "?")
        logger.info("[2/3] Forecast → model=%s  mid=%s people  mape=%s",
                    model_type, mid, mape)
    except Exception as exc:
        logger.error("[2/3] Forecast generation failed: %s", exc)
        sys.exit(1)

    # Attach training-signal fields so _write_forecast_to_ddb can mirror
    # them to top-level DDB attrs for the PWA's learning banner.
    forecast.setdefault("training_snapshots", last_train_snapshots)
    forecast.setdefault("training_target", 100)

    # ── Step 3: Write to DynamoDB ─────────────────────────────────────────────
    logger.info("[3/3] Writing to DynamoDB…")
    if not _write_forecast_to_ddb(venue_id, today, forecast):
        logger.error("[3/3] Write failed — forecast will not appear in the app")
        sys.exit(1)

    # ── Step 4: Backfill yesterday's actuals (only on full run, not refresh) ──
    if not args.refresh:
        yesterday = today - timedelta(days=1)
        logger.info("[backfill] Backfilling actuals for %s…", yesterday)
        _backfill_actual(venue_id, yesterday)

    logger.info("=== Done in %.1fs ===", time.time() - t0)


if __name__ == "__main__":
    main()
