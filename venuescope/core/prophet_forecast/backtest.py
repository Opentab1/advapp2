"""
VenueScope — MAPE backtest reporter.
Tests forecasting accuracy against historical occupancy data by
performing leave-one-day-out cross-validation.
"""
from __future__ import annotations
import logging
import math
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_CALIBRATION_STATES = ["generic_prior", "week_2", "week_4", "week_12", "month_6", "month_12"]


def _mape(actuals: list[float], predictions: list[float]) -> float:
    """
    Compute Mean Absolute Percentage Error.
    Ignores slots where actual == 0 to avoid division by zero.
    """
    if not actuals or not predictions:
        return 0.0
    errors = []
    for a, p in zip(actuals, predictions):
        if a > 0:
            errors.append(abs(a - p) / a)
    if not errors:
        return 0.0
    return sum(errors) / len(errors)


def _calibration_state_from_days(days: float) -> str:
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


def backtest_venue(venue_id: str, days: int = 30) -> dict:
    """
    Compute actual MAPE for venue over the last `days` days using
    leave-one-day-out cross-validation.

    Steps:
      1. Load all snapshots for venue
      2. For each day d in the last `days` days:
         a. Build training set: all snapshots BEFORE day d
         b. If < 14 days training data: skip (mark as 'prior')
         c. Fit a fresh model on training set
         d. Predict for day d
         e. Compare to actual snapshots for day d
         f. Compute MAPE for that day
      3. Aggregate and return stats

    Returns dict with keys:
      venue_id, days_tested, avg_mape, min_mape, max_mape,
      calibration_state, days_by_state, degrading
    """
    from core.prophet_forecast.occupancy_snapshots import get_snapshots
    from core.prophet_forecast.model_interface import get_forecaster
    from core.prophet_forecast.weather_ingest import fetch_historical_weather

    import pandas as pd

    now_ts = time.time()
    # Load enough history: backtest window + training window
    lookback_ts = now_ts - (days + 120) * 86400
    all_snapshots = get_snapshots(venue_id, lookback_ts, now_ts)

    if not all_snapshots:
        return {
            "venue_id": venue_id,
            "days_tested": 0,
            "avg_mape": None,
            "min_mape": None,
            "max_mape": None,
            "calibration_state": "generic_prior",
            "days_by_state": {s: 0 for s in _CALIBRATION_STATES},
            "degrading": False,
            "error": "No snapshot data available",
        }

    # Organize snapshots by date
    by_date: dict[str, list[dict]] = {}
    for snap in all_snapshots:
        dt = datetime.fromtimestamp(snap["snapshot_ts"], tz=timezone.utc)
        day_key = dt.date().isoformat()
        by_date.setdefault(day_key, []).append(snap)

    # Determine the test window: last `days` calendar days
    today = datetime.fromtimestamp(now_ts, tz=timezone.utc).date()
    test_days = []
    for i in range(1, days + 1):
        d = today - timedelta(days=i)
        if d.isoformat() in by_date:
            test_days.append(d)

    if not test_days:
        return {
            "venue_id": venue_id,
            "days_tested": 0,
            "avg_mape": None,
            "min_mape": None,
            "max_mape": None,
            "calibration_state": "generic_prior",
            "days_by_state": {s: 0 for s in _CALIBRATION_STATES},
            "degrading": False,
            "error": "No test days found in snapshot data",
        }

    mapes_by_day: dict[str, Optional[float]] = {}
    state_by_day: dict[str, str] = {}
    skipped_prior = 0

    # Default lat/lon (Tampa) — backtest uses approximate location
    try:
        from core.event_intelligence import CITY_LATLON
        lat, lon = CITY_LATLON.get("tampa", (27.9506, -82.4572))
    except Exception:
        lat, lon = 27.9506, -82.4572

    for test_day in sorted(test_days):
        test_day_str = test_day.isoformat()
        cutoff_ts = datetime(test_day.year, test_day.month, test_day.day,
                              tzinfo=timezone.utc).timestamp()

        # Training set: all snapshots before test_day
        train_snaps = [s for s in all_snapshots if s["snapshot_ts"] < cutoff_ts]

        if not train_snaps:
            state_by_day[test_day_str] = "generic_prior"
            skipped_prior += 1
            continue

        # Compute training data span
        train_min_ts = min(s["snapshot_ts"] for s in train_snaps)
        train_max_ts = max(s["snapshot_ts"] for s in train_snaps)
        train_days = (train_max_ts - train_min_ts) / 86400

        cal_state = _calibration_state_from_days(train_days)
        state_by_day[test_day_str] = cal_state

        if train_days < 14 or len(train_snaps) < 50:
            # Not enough training data — skip
            skipped_prior += 1
            mapes_by_day[test_day_str] = None
            continue

        # Build training DataFrame
        train_rows = []
        for snap in train_snaps:
            dt = datetime.fromtimestamp(snap["snapshot_ts"], tz=timezone.utc).replace(tzinfo=None)
            train_rows.append({"ds": dt, "y": float(snap["headcount"])})

        train_df = pd.DataFrame(train_rows).sort_values("ds").reset_index(drop=True)

        # Fetch historical weather for training period
        try:
            weather_rows = fetch_historical_weather(
                lat, lon,
                train_df["ds"].min().date(),
                train_df["ds"].max().date(),
            )
            if weather_rows:
                weather_df = pd.DataFrame(weather_rows)
                weather_df["ds"] = pd.to_datetime(weather_df["ds"]).dt.round("h")
                weather_df = weather_df.rename(columns={"ds": "ds_hour"})
                train_df["ds_hour"] = train_df["ds"].dt.round("h")
                train_df = train_df.merge(weather_df, on="ds_hour", how="left")
                train_df = train_df.drop(columns=["ds_hour"])
            else:
                train_df["temp"] = 68.0
                train_df["precip"] = 0.0
                train_df["wind"] = 5.0
        except Exception:
            train_df["temp"] = 68.0
            train_df["precip"] = 0.0
            train_df["wind"] = 5.0

        train_df["temp"] = train_df.get("temp", pd.Series([68.0] * len(train_df))).fillna(68.0)
        train_df["precip"] = train_df.get("precip", pd.Series([0.0] * len(train_df))).fillna(0.0)
        train_df["wind"] = train_df.get("wind", pd.Series([5.0] * len(train_df))).fillna(5.0)
        train_df["competing_events_count"] = 0

        # Fit model on training data
        try:
            model = get_forecaster()
            model.fit(train_df)
        except Exception as e:
            logger.warning("[backtest] Model fit failed for %s on day %s: %s",
                           venue_id, test_day_str, e)
            mapes_by_day[test_day_str] = None
            continue

        # Build future DataFrame for test_day
        test_snaps = by_date.get(test_day_str, [])
        if not test_snaps:
            mapes_by_day[test_day_str] = None
            continue

        # Get weather for test day
        try:
            test_weather = fetch_historical_weather(lat, lon, test_day, test_day)
        except Exception:
            test_weather = []

        weather_by_hour: dict[int, dict] = {}
        for w in test_weather:
            wdt = w["ds"]
            if isinstance(wdt, str):
                wdt = datetime.fromisoformat(wdt)
            weather_by_hour[wdt.hour] = w

        # Build prediction rows
        pred_rows = []
        for snap in test_snaps:
            dt = datetime.fromtimestamp(snap["snapshot_ts"], tz=timezone.utc).replace(tzinfo=None)
            w = weather_by_hour.get(dt.hour, {})
            pred_rows.append({
                "ds": dt,
                "temp": w.get("temp", 68.0),
                "precip": w.get("precip", 0.0),
                "wind": w.get("wind", 5.0),
                "competing_events_count": 0,
            })

        if not pred_rows:
            mapes_by_day[test_day_str] = None
            continue

        pred_df = pd.DataFrame(pred_rows)

        try:
            forecast = model.predict(pred_df)
        except Exception as e:
            logger.warning("[backtest] Predict failed for %s on day %s: %s",
                           venue_id, test_day_str, e)
            mapes_by_day[test_day_str] = None
            continue

        # Compare predictions to actuals
        actuals = [float(s["headcount"]) for s in test_snaps]
        preds = forecast["yhat"].clip(lower=0).tolist()

        # Align by position (both sorted by timestamp)
        n = min(len(actuals), len(preds))
        day_mape = _mape(actuals[:n], preds[:n])
        mapes_by_day[test_day_str] = day_mape

        logger.info("[backtest] %s day=%s mape=%.3f state=%s",
                    venue_id, test_day_str, day_mape, cal_state)

    # Aggregate results
    valid_mapes = [v for v in mapes_by_day.values() if v is not None]
    avg_mape = sum(valid_mapes) / len(valid_mapes) if valid_mapes else None
    min_mape = min(valid_mapes) if valid_mapes else None
    max_mape = max(valid_mapes) if valid_mapes else None

    # Count days by calibration state
    days_by_state: dict[str, int] = {s: 0 for s in _CALIBRATION_STATES}
    days_by_state["generic_prior"] = skipped_prior
    for state in state_by_day.values():
        if state in days_by_state:
            days_by_state[state] += 1

    # Overall calibration state based on total data span
    if all_snapshots:
        total_days = (all_snapshots[-1]["snapshot_ts"] - all_snapshots[0]["snapshot_ts"]) / 86400
        overall_state = _calibration_state_from_days(total_days)
    else:
        overall_state = "generic_prior"

    # Degradation check: is the last 7 days MAPE 15%+ worse than overall?
    degrading = False
    if avg_mape is not None and len(valid_mapes) >= 7:
        recent_days = sorted(mapes_by_day.keys())[-7:]
        recent_mapes = [mapes_by_day[d] for d in recent_days if mapes_by_day[d] is not None]
        if recent_mapes:
            recent_avg = sum(recent_mapes) / len(recent_mapes)
            if recent_avg > avg_mape * 1.15:
                degrading = True
                logger.warning(
                    "[backtest] Model degradation detected for %s: "
                    "recent_avg_mape=%.3f > overall_avg_mape=%.3f",
                    venue_id, recent_avg, avg_mape,
                )

    return {
        "venue_id": venue_id,
        "days_tested": len(test_days),
        "avg_mape": round(avg_mape, 4) if avg_mape is not None else None,
        "min_mape": round(min_mape, 4) if min_mape is not None else None,
        "max_mape": round(max_mape, 4) if max_mape is not None else None,
        "calibration_state": overall_state,
        "days_by_state": days_by_state,
        "degrading": degrading,
    }


def run_backtest_all_venues() -> list[dict]:
    """
    Run backtest for all venues with snapshot data.
    Returns list of backtest result dicts.
    """
    from sqlalchemy import text
    from core.database import get_engine

    engine = get_engine()
    venue_ids = []

    try:
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT DISTINCT venue_id FROM occupancy_snapshots"
            )).fetchall()
            venue_ids = [r[0] for r in rows if r[0]]
    except Exception as e:
        logger.warning("[backtest] Could not query venue IDs from occupancy_snapshots: %s", e)
        # Fall back to configured venue
        venue_ids = [os.environ.get("VENUESCOPE_VENUE_ID", "default")]

    if not venue_ids:
        venue_ids = [os.environ.get("VENUESCOPE_VENUE_ID", "default")]

    results = []
    for vid in venue_ids:
        logger.info("[backtest] Running backtest for venue %s", vid)
        try:
            result = backtest_venue(vid, days=30)
            results.append(result)
        except Exception as e:
            logger.error("[backtest] Failed for venue %s: %s", vid, e)
            results.append({
                "venue_id": vid,
                "days_tested": 0,
                "avg_mape": None,
                "error": str(e),
            })

    return results


# ── __main__ — print backtest report ─────────────────────────────────────────

if __name__ == "__main__":
    import sys
    from pathlib import Path

    # Ensure project root on path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    print("\n=== VenueScope Forecast Backtest Report ===\n")
    results = run_backtest_all_venues()

    if not results:
        print("No venues with data found.")
        sys.exit(0)

    # Print table
    header = f"{'Venue':<24} {'Days':>5} {'AvgMAPE':>9} {'Min':>8} {'Max':>8} {'State':<14} {'Degrading'}"
    print(header)
    print("-" * len(header))

    for r in results:
        venue = r.get("venue_id", "?")[:24]
        days = r.get("days_tested", 0)
        avg = f"{r['avg_mape']*100:.1f}%" if r.get("avg_mape") is not None else "N/A"
        mn = f"{r['min_mape']*100:.1f}%" if r.get("min_mape") is not None else "N/A"
        mx = f"{r['max_mape']*100:.1f}%" if r.get("max_mape") is not None else "N/A"
        state = r.get("calibration_state", "?")[:14]
        deg = "YES ⚠" if r.get("degrading") else "no"
        error = r.get("error", "")
        if error:
            print(f"{venue:<24} {days:>5}  ERROR: {error}")
        else:
            print(f"{venue:<24} {days:>5} {avg:>9} {mn:>8} {mx:>8} {state:<14} {deg}")

    print()
    print("Calibration states by day:")
    for r in results:
        dbs = r.get("days_by_state", {})
        if dbs:
            print(f"  {r.get('venue_id', '?')}: {dbs}")

    print("\nDone.")
