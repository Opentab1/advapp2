"""
VenueScope — Weekly model retraining pipeline.
Builds a training DataFrame from occupancy snapshots + historical weather,
fits the forecaster, and saves the model to disk.
"""
from __future__ import annotations
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import pandas as pd

from core.prophet_forecast.occupancy_snapshots import (
    backfill_from_jobs,
    get_snapshots,
)
from core.prophet_forecast.model_interface import get_forecaster, ForecastModel
from core.prophet_forecast.weather_ingest import fetch_historical_weather

logger = logging.getLogger(__name__)

_MIN_DAYS = 14
_MIN_SNAPSHOTS = 100
_TRAINING_WINDOW_DAYS = 90


# ── Shape vs magnitude validation ────────────────────────────────────────────

def _check_shape_magnitude(df: pd.DataFrame) -> bool:
    """
    Log a warning if the shape of the drink-proxy curve doesn't match the
    magnitude implied by peak_occupancy.

    Check: max(15-min bucket headcount) should be within 20% of
    the overall max(y) in the training data.

    Returns True if shape looks consistent, False if suspect.
    """
    if df.empty or "y" not in df.columns:
        return True

    max_y = df["y"].max()
    if max_y == 0:
        return True

    # Group by 15-min bucket across all days, take average peak
    df2 = df.copy()
    df2["hour"] = pd.to_datetime(df2["ds"]).dt.hour
    df2["minute_bucket"] = (pd.to_datetime(df2["ds"]).dt.minute // 15) * 15
    avg_by_slot = df2.groupby(["hour", "minute_bucket"])["y"].mean()

    if avg_by_slot.empty:
        return True

    avg_peak = avg_by_slot.max()
    ratio = abs(avg_peak - max_y) / max_y if max_y > 0 else 0

    if ratio > 0.20:
        logger.warning(
            "[training] Shape vs magnitude mismatch: avg_peak=%.1f, max_y=%.1f, ratio=%.2f. "
            "Drink-proxy curve may be misscaled. Check total_entries vs drink timestamps.",
            avg_peak, max_y, ratio,
        )
        return False
    return True


def _validate_capacity_bounds(df: pd.DataFrame, venue_capacity: int = 2000) -> list[str]:
    """Check for headcounts exceeding venue capacity — suggests re-entry double counting."""
    warnings = []
    over = df[df["y"] > venue_capacity]
    if not over.empty:
        warnings.append(
            f"[validator] {len(over)} snapshots exceed venue capacity ({venue_capacity}). "
            f"Max seen: {df['y'].max():.0f}. Possible re-entry double counting."
        )
    return warnings


def _validate_snapshot_continuity(df: pd.DataFrame, max_gap_hours: float = 4.0) -> list[str]:
    """Check for long gaps in snapshot data — suggests camera offline periods."""
    warnings = []
    if df.empty or len(df) < 2:
        return warnings
    df_sorted = df.sort_values("ds")
    gaps = df_sorted["ds"].diff().dt.total_seconds() / 3600
    long_gaps = gaps[gaps > max_gap_hours]
    if not long_gaps.empty:
        worst_gap = long_gaps.max()
        warnings.append(
            f"[validator] {len(long_gaps)} gaps > {max_gap_hours}h in snapshot data. "
            f"Longest gap: {worst_gap:.1f}h. Camera may have been offline — "
            f"model may learn false low-traffic patterns."
        )
    return warnings


def _validate_dow_coverage(df: pd.DataFrame) -> list[str]:
    """Check that training data covers all 7 days of the week."""
    warnings = []
    if df.empty:
        return warnings
    covered_dows = set(pd.to_datetime(df["ds"]).dt.dayofweek.unique())
    all_dows = set(range(7))
    missing = all_dows - covered_dows
    dow_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    if missing:
        missing_names = [dow_names[d] for d in sorted(missing)]
        warnings.append(
            f"[validator] Training data missing DOW(s): {', '.join(missing_names)}. "
            f"Forecasts for those days will use prior, not learned pattern."
        )
    return warnings


# ── Training data builder ─────────────────────────────────────────────────────

def _build_training_df(venue_id: str, lat: float, lon: float,
                        snapshots: list[dict]) -> pd.DataFrame:
    """
    Join occupancy snapshots with historical weather to build a training DataFrame.

    Returns DataFrame with columns:
      ds, y, temp, precip, wind, competing_events_count
    """
    if not snapshots:
        return pd.DataFrame()

    # Build base DataFrame from snapshots
    rows = []
    for snap in snapshots:
        ts = snap["snapshot_ts"]
        dt = datetime.fromtimestamp(ts, tz=timezone.utc).replace(tzinfo=None)
        rows.append({"ds": dt, "y": float(snap["headcount"])})

    df = pd.DataFrame(rows).sort_values("ds").reset_index(drop=True)

    # Fetch historical weather for the date range
    start_date = df["ds"].min().date()
    end_date = df["ds"].max().date()

    weather_rows = fetch_historical_weather(lat, lon, start_date, end_date)

    if weather_rows:
        weather_df = pd.DataFrame(weather_rows)
        weather_df["ds"] = pd.to_datetime(weather_df["ds"]).dt.round("h")
        weather_df = weather_df.rename(columns={"ds": "ds_hour"})

        # Join weather by rounding snapshot ds to nearest hour
        df["ds_hour"] = df["ds"].dt.round("h")
        df = df.merge(weather_df, on="ds_hour", how="left")
        df = df.drop(columns=["ds_hour"])
    else:
        # No weather data available — fill with neutral defaults
        logger.warning("[training] No historical weather data; using neutral defaults")
        df["temp"] = 68.0
        df["precip"] = 0.0
        df["wind"] = 5.0

    # Fill any remaining NaN weather values
    df["temp"] = df["temp"].fillna(68.0)
    df["precip"] = df["precip"].fillna(0.0)
    df["wind"] = df["wind"].fillna(5.0)

    # No historical event data yet
    df["competing_events_count"] = 0

    # Drop rows with NaN in y
    df = df.dropna(subset=["y"])

    return df


# ── Main training function ────────────────────────────────────────────────────

def train_venue_model(
    venue_id: str,
    city: str,
    lat: float,
    lon: float,
) -> dict:
    """
    Train or retrain the forecaster for a venue.

    Steps:
      1. Backfill drink-proxy snapshots from completed jobs
      2. Load 90-day snapshot window
      3. Build training DataFrame with weather
      4. Validate: need ≥ 14 days and ≥ 100 snapshots
      5. Shape vs magnitude check
      6. Fit model
      7. Save model to disk
      8. Return training stats dict

    Returns dict with keys:
      status           'trained' | 'insufficient_data' | 'error'
      venue_id         str
      snapshots_used   int
      date_range       str  (e.g. '2026-01-01 to 2026-04-17')
      mape_estimate    str  (e.g. '±18%')
      error            str  (only if status='error')
    """
    logger.info("[training] Starting training for venue %s", venue_id)

    # Step 1: Backfill drink-proxy snapshots
    try:
        written = backfill_from_jobs(venue_id)
        logger.info("[training] Backfill wrote %d new snapshots", written)
    except Exception as e:
        logger.warning("[training] Backfill failed: %s", e)

    # Step 2: Load snapshots
    now_ts = time.time()
    window_start = now_ts - _TRAINING_WINDOW_DAYS * 86400
    snapshots = get_snapshots(venue_id, window_start, now_ts)
    n_snapshots = len(snapshots)

    logger.info("[training] Loaded %d snapshots for venue %s", n_snapshots, venue_id)

    # Step 4: Validate
    if n_snapshots < _MIN_SNAPSHOTS:
        logger.warning("[training] Insufficient snapshots: %d < %d", n_snapshots, _MIN_SNAPSHOTS)
        return {
            "status": "insufficient_data",
            "venue_id": venue_id,
            "snapshots_used": n_snapshots,
            "date_range": None,
            "mape_estimate": "±30%",
            "reason": f"Need at least {_MIN_SNAPSHOTS} snapshots; have {n_snapshots}",
        }

    if snapshots:
        ts_min = snapshots[0]["snapshot_ts"]
        ts_max = snapshots[-1]["snapshot_ts"]
        days_span = (ts_max - ts_min) / 86400
    else:
        days_span = 0

    if days_span < _MIN_DAYS:
        logger.warning("[training] Insufficient days: %.1f < %d", days_span, _MIN_DAYS)
        return {
            "status": "insufficient_data",
            "venue_id": venue_id,
            "snapshots_used": n_snapshots,
            "date_range": None,
            "mape_estimate": "±30%",
            "reason": f"Need at least {_MIN_DAYS} days of data; have {days_span:.1f} days",
        }

    # Step 3: Build training DataFrame
    try:
        df = _build_training_df(venue_id, lat, lon, snapshots)
    except Exception as e:
        logger.error("[training] Failed to build training df: %s", e)
        return {
            "status": "error",
            "venue_id": venue_id,
            "snapshots_used": n_snapshots,
            "date_range": None,
            "mape_estimate": "±30%",
            "error": str(e),
        }

    if df.empty:
        return {
            "status": "insufficient_data",
            "venue_id": venue_id,
            "snapshots_used": 0,
            "date_range": None,
            "mape_estimate": "±30%",
            "reason": "Training DataFrame is empty after join",
        }

    date_range = (
        f"{df['ds'].min().date().isoformat()} to {df['ds'].max().date().isoformat()}"
    )

    # Step 5: Shape vs magnitude check
    _check_shape_magnitude(df)

    # Data quality validators
    all_warnings = (
        _validate_capacity_bounds(df) +
        _validate_snapshot_continuity(df) +
        _validate_dow_coverage(df)
    )
    for w in all_warnings:
        logger.warning(w)

    # Determine calibration state and MAPE estimate
    mape_estimate = _mape_from_days(days_span)

    # Step 6: Fit model
    try:
        model = get_forecaster()
        model.fit(df)
    except Exception as e:
        logger.error("[training] Model fit failed: %s", e)
        return {
            "status": "error",
            "venue_id": venue_id,
            "snapshots_used": n_snapshots,
            "date_range": date_range,
            "mape_estimate": mape_estimate,
            "error": str(e),
        }

    # Step 7: Save model
    try:
        model.save(venue_id)
    except Exception as e:
        logger.error("[training] Failed to save model: %s", e)
        return {
            "status": "error",
            "venue_id": venue_id,
            "snapshots_used": n_snapshots,
            "date_range": date_range,
            "mape_estimate": mape_estimate,
            "error": f"Model fit OK but save failed: {e}",
        }

    logger.info(
        "[training] Training complete for venue %s: %d snapshots, %s, MAPE %s",
        venue_id, n_snapshots, date_range, mape_estimate,
    )

    return {
        "status": "trained",
        "venue_id": venue_id,
        "snapshots_used": n_snapshots,
        "date_range": date_range,
        "mape_estimate": mape_estimate,
    }


def _mape_from_days(days: float) -> str:
    """Return expected MAPE string based on days of training data."""
    if days < 14:
        return "±30%"
    elif days < 28:
        return "±24%"
    elif days < 84:
        return "±18%"
    elif days < 180:
        return "±12%"
    elif days < 365:
        return "±8%"
    else:
        return "±5%"


def _calibration_state_from_days(days: float) -> str:
    """Return calibration state label based on days of training data."""
    if days < 14:
        return "generic_prior"
    elif days < 28:
        return "week_2"
    elif days < 84:
        return "week_4"
    elif days < 180:
        return "week_12"
    elif days < 365:
        return "month_6"
    else:
        return "month_12"


# ── Run all venues ────────────────────────────────────────────────────────────

def run_training_for_all_venues() -> list[dict]:
    """
    Read distinct venue IDs from the SQLite jobs table and train a model for each.
    Requires that venue lat/lon/city are derivable or that a default is used.
    Returns list of training result dicts.
    """
    from sqlalchemy import text as _text
    from core.database import get_engine

    engine = get_engine()
    try:
        with engine.connect() as conn:
            rows = conn.execute(_text(
                "SELECT DISTINCT clip_label FROM jobs "
                "WHERE status = 'done' AND is_deleted = 0 AND clip_label IS NOT NULL"
            )).fetchall()
        # clip_label is used as a rough venue proxy since there's no explicit venue_id column in jobs
        # In production, venue_id would be a real field; for now use the VENUESCOPE_VENUE_ID env var
        import os
        venue_id = os.environ.get("VENUESCOPE_VENUE_ID", "default")
    except Exception as e:
        logger.error("[training] Failed to query venue IDs: %s", e)
        return []

    # For now, train the single configured venue
    import os
    venue_id = os.environ.get("VENUESCOPE_VENUE_ID", "default")
    city = os.environ.get("VENUESCOPE_CITY", "tampa")

    # Look up lat/lon from event_intelligence CITY_LATLON dict
    try:
        from core.event_intelligence import CITY_LATLON
        lat, lon = CITY_LATLON.get(city.lower(), (27.9506, -82.4572))
    except Exception:
        lat, lon = 27.9506, -82.4572  # default Tampa

    results = []
    result = train_venue_model(venue_id=venue_id, city=city, lat=lat, lon=lon)
    results.append(result)

    for r in results:
        status = r.get("status")
        venue = r.get("venue_id")
        snaps = r.get("snapshots_used", 0)
        mape = r.get("mape_estimate", "?")
        logger.info("[training] venue=%s status=%s snapshots=%d mape=%s",
                    venue, status, snaps, mape)

    return results
