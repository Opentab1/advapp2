"""
VenueScope — Tonight's Forecast HTTP service.
Handles POST /forecast/tonight and GET /forecast/tonight.
Integrates with the existing http.server BaseHTTPRequestHandler pattern in app/api.py.
"""
from __future__ import annotations
import json
import logging
import math
import os
import time
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler
from typing import Optional
from urllib.parse import parse_qs, urlparse

import pandas as pd

from core.prophet_forecast.model_interface import ForecastModel, get_forecaster
from core.prophet_forecast.weather_ingest import fetch_weather_forecast, weather_multiplier
from core.prophet_forecast.events_ingest import get_event_provider, compute_competition_drag
from core.prophet_forecast.training_pipeline import (
    _mape_from_days, _calibration_state_from_days,
)

logger = logging.getLogger(__name__)

# Operating window: 4 PM to 2 AM (next day)
_OPEN_HOUR = 16   # 4 PM
_CLOSE_HOUR = 26  # 2 AM next day (26 = 24 + 2)
_SLOT_MINUTES = 15
_SLOTS_PER_HOUR = 60 // _SLOT_MINUTES   # 4

# Default revenue per cover
_AVG_DRINK_PRICE = 33.0

# Day-of-week multipliers for generic prior (Mon=0 ... Sun=6)
# Used only if the venue hasn't supplied slowDayCovers + busyDayCovers at
# onboarding. When they have, we interpolate between those two numbers.
_DOW_PRIOR = {
    0: 0.40,   # Monday
    1: 0.45,   # Tuesday
    2: 0.50,   # Wednesday
    3: 0.65,   # Thursday
    4: 1.00,   # Friday
    5: 0.95,   # Saturday
    6: 0.55,   # Sunday
}

# Hour-of-day SHAPE (unitless, peak = 1.0) per venue tier. Scaled by the
# tier-specific base peak at runtime. Hours 16..25 span 4 PM → 1 AM next day.
# bar_late and restaurant peak at different hours — this is what makes a
# "small bar" prior actually look like a small bar rather than industry avg.
_HOUR_SHAPE_BY_TIER = {
    "bar_late": {    # cocktail/dive/sports bar — peaks 10-11 PM
        16: 0.15, 17: 0.25, 18: 0.40, 19: 0.55, 20: 0.75,
        21: 0.90, 22: 1.00, 23: 0.95, 24: 0.75, 25: 0.45,
    },
    "restaurant": {  # dinner service — peaks 7-8 PM, quiet after 10
        16: 0.30, 17: 0.60, 18: 0.90, 19: 1.00, 20: 0.95,
        21: 0.75, 22: 0.45, 23: 0.25, 24: 0.10, 25: 0.05,
    },
    "nightclub": {   # peaks midnight — slow start
        16: 0.05, 17: 0.10, 18: 0.15, 19: 0.25, 20: 0.45,
        21: 0.65, 22: 0.85, 23: 1.00, 24: 1.00, 25: 0.80,
    },
    "mixed": {       # restaurant-then-bar, both peaks
        16: 0.25, 17: 0.55, 18: 0.80, 19: 0.85, 20: 0.80,
        21: 0.90, 22: 1.00, 23: 0.90, 24: 0.65, 25: 0.35,
    },
}

# Tier → default weekend peak headcount when a venue hasn't supplied their own
# slowDayCovers/busyDayCovers numbers. Calibrated to realistic small-footprint
# venues. Final forecast is always capped at venue_capacity regardless.
_TIER_DEFAULT_PEAK = {
    "small_bar":    35,   # neighborhood bar, 40-cap-ish
    "mid_bar":      90,   # ~100-cap bar/lounge
    "large_bar":   220,   # big sports bar or music venue
    "restaurant":   70,   # mid-size dinner house
    "nightclub":   300,
    "mixed":        60,
}

# Back-compat hour shape used by anything importing _HOUR_SHAPE_PRIOR.
_HOUR_SHAPE_PRIOR = _HOUR_SHAPE_BY_TIER["bar_late"]

# Legacy constant kept as a fallback when tier is unknown AND no self-reported
# baseline exists. Consumer UIs should never actually hit this path — size
# tiers + capacity cap + self-report take precedence.
_GENERIC_PEAK = 120


def _tier_to_shape_key(tier: str) -> str:
    """Map an onboarding tier to the hour-shape table key."""
    t = (tier or "").lower().strip()
    if t in ("small_bar", "mid_bar", "large_bar"):
        return "bar_late"
    if t == "restaurant":
        return "restaurant"
    if t == "nightclub":
        return "nightclub"
    if t == "mixed":
        return "mixed"
    return "bar_late"

# Default avg visit duration in 15-min slots by venue concept type
_AVG_VISIT_SLOTS_BY_CONCEPT = {
    "bar":         8,   # 2.0 hours
    "cocktail":    8,   # 2.0 hours
    "nightclub":  10,   # 2.5 hours
    "sports_bar": 14,   # 3.5 hours
    "restaurant":  6,   # 1.5 hours
    "default":    10,   # 2.5 hours fallback
}


def _get_hospitality_holidays(year: int) -> dict[date, tuple[str, float]]:
    """
    Returns {date: (name, multiplier)} for key hospitality dates.
    Multiplier > 1.0 = venue gets busier. < 1.0 = venue gets quieter.
    """
    return {
        date(year, 1, 1):   ("New Year's Day",       1.10),
        date(year, 2, 14):  ("Valentine's Day",      1.35),
        date(year, 3, 17):  ("St. Patrick's Day",    1.80),
        date(year, 4, 20):  ("Easter Sunday",        0.70),  # bars quieter
        date(year, 5, 5):   ("Cinco de Mayo",        1.60),
        date(year, 5, 26):  ("Memorial Day Weekend", 1.30),  # approximate Mon
        date(year, 7, 4):   ("July 4th",             1.40),
        date(year, 9, 7):   ("Labor Day",            1.20),
        date(year, 10, 31): ("Halloween",            1.70),
        date(year, 11, 25): ("Thanksgiving Eve",     1.50),  # "Blackout Wednesday" approx
        date(year, 11, 26): ("Thanksgiving",         0.60),  # bars quiet
        date(year, 12, 24): ("Christmas Eve",        0.65),
        date(year, 12, 25): ("Christmas Day",        0.50),
        date(year, 12, 26): ("Day After Christmas",  1.20),
        date(year, 12, 31): ("New Year's Eve",       2.20),
    }


def _resolve_prior_peak(
    tier: str,
    venue_capacity: int,
    slow_day_covers: Optional[float],
    busy_day_covers: Optional[float],
    dow: int,
) -> float:
    """
    Pick the prior's peak headcount for this venue + day.

    Priority:
      1. Self-reported slow/busy day covers (best) — interpolate by DOW.
      2. Tier default peak, scaled by DOW multiplier.
      3. Legacy _GENERIC_PEAK × DOW multiplier (last resort).

    Then: hard-cap at venue_capacity (never predict above what fits).
    """
    dow_mult = _DOW_PRIOR.get(dow, 0.60)

    if slow_day_covers is not None and busy_day_covers is not None \
            and busy_day_covers > 0:
        # Map DOW weights onto the slow↔busy range. weekend-heavy DOWs use
        # numbers closer to busy_day_covers, quiet DOWs closer to slow_day_covers.
        # dow_mult 1.0 → busy, 0.40 → near slow. Normalize to [0,1].
        slow_w = min(_DOW_PRIOR.values())                # ~0.40
        busy_w = max(_DOW_PRIOR.values())                # ~1.00
        t = (dow_mult - slow_w) / max(1e-9, (busy_w - slow_w))
        t = max(0.0, min(1.0, t))
        peak = slow_day_covers + t * (busy_day_covers - slow_day_covers)
    else:
        base = _TIER_DEFAULT_PEAK.get(
            (tier or "").lower().strip(),
            _GENERIC_PEAK,
        )
        peak = base * dow_mult

    # Hard cap at physical capacity — no venue can fit more than it holds.
    if venue_capacity and venue_capacity > 0:
        peak = min(peak, float(venue_capacity))

    return max(0.0, peak)


def _generic_prior_forecast(
    target_date: date,
    tier: str = "small_bar",
    venue_capacity: int = 150,
    slow_day_covers: Optional[float] = None,
    busy_day_covers: Optional[float] = None,
    avg_visit_slots: int = 8,
) -> list[dict]:
    """
    Build the prior hourly curve when no trained model exists. Uses the
    venue's tier/capacity/self-reported numbers to scale the baseline so
    the prior actually resembles the venue instead of industry averages.

    Self-reported slow_day_covers / busy_day_covers are *total covers for
    the night*, not peak concurrent occupancy. We convert to per-slot peak
    by accounting for the shape integral and average visit duration — the
    downstream aggregation (total_yhat / avg_visit_slots) must land on the
    user's own number.
    """
    dow = target_date.weekday()
    target_covers = _resolve_prior_peak(
        tier, venue_capacity, slow_day_covers, busy_day_covers, dow,
    )

    shape_table = _HOUR_SHAPE_BY_TIER.get(_tier_to_shape_key(tier),
                                          _HOUR_SHAPE_BY_TIER["bar_late"])

    # Scale target_covers into the per-slot peak yhat that, after downstream
    # aggregation, produces mid_covers ≈ target_covers. See the aggregation
    # block at line ~520: mid_covers = sum(yhat over slots) / avg_visit_slots.
    shape_integral = sum(shape_table.get(h, 0.30) for h in range(_OPEN_HOUR, _CLOSE_HOUR))
    slots_per_shape_unit = shape_integral * _SLOTS_PER_HOUR
    if slots_per_shape_unit <= 0:
        slots_per_shape_unit = 1.0
    base_peak = target_covers * avg_visit_slots / slots_per_shape_unit

    # Safety: per-slot peak itself cannot exceed capacity (prevents pathological
    # tier/avg_visit combos from spiking a single slot above cap before the
    # later cap-clamp runs).
    if venue_capacity and venue_capacity > 0:
        base_peak = min(base_peak, float(venue_capacity))

    slots = []
    for hour_abs in range(_OPEN_HOUR, _CLOSE_HOUR):
        shape = shape_table.get(hour_abs, 0.30)
        yhat = base_peak * shape
        for slot in range(_SLOTS_PER_HOUR):
            slot_hour = hour_abs if hour_abs < 24 else hour_abs - 24
            slot_minute = slot * _SLOT_MINUTES
            if hour_abs < 24:
                slot_dt = datetime(target_date.year, target_date.month, target_date.day,
                                   slot_hour, slot_minute)
            else:
                next_day = target_date + timedelta(days=1)
                slot_dt = datetime(next_day.year, next_day.month, next_day.day,
                                   slot_hour, slot_minute)
            slots.append({
                "ds": slot_dt,
                "yhat": max(0.0, yhat),
                "yhat_lower": max(0.0, yhat * 0.70),
                "yhat_upper": yhat * 1.30,
            })

    return slots


def _build_future_df(target_date: date, weather_rows: list[dict],
                      competing_events_count: int) -> pd.DataFrame:
    """
    Build a future DataFrame at 15-min resolution from 4 PM to 2 AM.
    Joins weather by hour.
    """
    # Build weather lookup by hour (hour of day as int)
    weather_by_dt: dict[datetime, dict] = {}
    for w in weather_rows:
        wdt = w["ds"]
        if isinstance(wdt, str):
            wdt = datetime.fromisoformat(wdt)
        weather_by_dt[wdt.replace(minute=0, second=0, microsecond=0)] = w

    def _weather_at_hour(hour_dt: datetime) -> tuple[float, float, float]:
        key = hour_dt.replace(minute=0, second=0, microsecond=0)
        w = weather_by_dt.get(key)
        if w:
            return w.get("temp", 68.0), w.get("precip", 0.0), w.get("wind", 5.0)
        return 68.0, 0.0, 5.0

    rows = []
    for hour_abs in range(_OPEN_HOUR, _CLOSE_HOUR):
        hour_display = hour_abs if hour_abs < 24 else hour_abs - 24
        for slot in range(_SLOTS_PER_HOUR):
            slot_minute = slot * _SLOT_MINUTES
            if hour_abs < 24:
                slot_dt = datetime(target_date.year, target_date.month, target_date.day,
                                   hour_display, slot_minute)
            else:
                next_day = target_date + timedelta(days=1)
                slot_dt = datetime(next_day.year, next_day.month, next_day.day,
                                   hour_display, slot_minute)

            temp, precip, wind = _weather_at_hour(slot_dt)
            rows.append({
                "ds": slot_dt,
                "temp": temp,
                "precip": precip,
                "wind": wind,
                "competing_events_count": float(competing_events_count),
            })

    return pd.DataFrame(rows)


def _format_hour(dt: datetime) -> str:
    """Format a datetime as '10:00 PM' style."""
    h = dt.hour
    m = dt.minute
    period = "AM" if h < 12 else "PM"
    if h == 0:
        h_disp = 12
    elif h > 12:
        h_disp = h - 12
    else:
        h_disp = h
    return f"{h_disp}:{m:02d} {period}"


def _calibration_state(venue_id: str) -> tuple[str, str]:
    """
    Determine calibration state and MAPE estimate for the venue.
    Returns (calibration_state, mape_expected).
    """
    from core.prophet_forecast.occupancy_snapshots import get_snapshots
    now_ts = time.time()
    start_ts = now_ts - 400 * 86400  # look back up to 400 days
    snapshots = get_snapshots(venue_id, start_ts, now_ts)

    if not snapshots:
        return "generic_prior", "±30%"

    ts_min = snapshots[0]["snapshot_ts"]
    ts_max = snapshots[-1]["snapshot_ts"]
    days = (ts_max - ts_min) / 86400

    return _calibration_state_from_days(days), _mape_from_days(days)


def forecast_tonight(
    venue_id: str,
    target_date: Optional[date] = None,
    lat: float = 27.9506,
    lon: float = -82.4572,
    city: str = "tampa",
    avg_drink_price: float = _AVG_DRINK_PRICE,
    concept_type: str = "default",
    venue_capacity: int = 150,
    venue_tier: str = "small_bar",
    slow_day_covers: Optional[float] = None,
    busy_day_covers: Optional[float] = None,
) -> dict:
    """
    Produce the Tonight's Forecast for a venue.

    Steps:
      1. Load trained model (or fall back to generic prior)
      2. Fetch weather forecast
      3. Fetch competing events
      4. Compute C(t) competition drag
      5. Build future DataFrame (4 PM – 2 AM, 15-min slots)
      6. Run model.predict()
      7. Apply weather multiplier W(t) and competition drag C(t)
      8. Apply holiday multiplier if applicable
      9. Aggregate to final estimates
     10. Return structured response dict

    Returns the full forecast response dict (same structure as the API endpoint).
    """
    if target_date is None:
        target_date = date.today()

    # Resolve avg_visit_slots from concept type
    avg_visit_slots = _AVG_VISIT_SLOTS_BY_CONCEPT.get(
        concept_type.lower().replace(" ", "_").replace("-", "_"),
        _AVG_VISIT_SLOTS_BY_CONCEPT["default"]
    )

    # Step 1: Load model
    model_type = "prior"
    model: Optional[ForecastModel] = None

    try:
        from core.prophet_forecast.model_interface import ForecastModel
        loaded = ForecastModel.load(venue_id)
        if loaded is not None:
            model = loaded
            from core.prophet_forecast.model_interface import ProphetForecaster, GradientBoostingForecaster
            if isinstance(model, ProphetForecaster):
                model_type = "prophet"
            elif isinstance(model, GradientBoostingForecaster):
                model_type = "gbm"
            else:
                model_type = "prophet"
    except Exception as e:
        logger.warning("[forecast] Failed to load model for venue %s: %s — using prior", venue_id, e)

    # Step 2: Fetch weather
    weather_rows = []
    try:
        weather_rows = fetch_weather_forecast(lat, lon, target_date)
    except Exception as e:
        logger.warning("[forecast] Weather fetch failed: %s", e)

    # Compute representative weather for the operating window (4 PM – 2 AM)
    # Use median values across slots for the factor display
    if weather_rows:
        evening_weather = [
            w for w in weather_rows
            if isinstance(w["ds"], datetime) and 16 <= w["ds"].hour <= 23
        ]
        if evening_weather:
            rep_temp = sum(w["temp"] for w in evening_weather) / len(evening_weather)
            rep_precip = max(w["precip"] for w in evening_weather)
            rep_wind = sum(w["wind"] for w in evening_weather) / len(evening_weather)
        else:
            rep_temp, rep_precip, rep_wind = 68.0, 0.0, 5.0
    else:
        rep_temp, rep_precip, rep_wind = 68.0, 0.0, 5.0

    # Step 3: Fetch competing events
    event_provider = get_event_provider()
    competing_events = []
    try:
        window_start = datetime(target_date.year, target_date.month, target_date.day, 16, 0)
        next_day = target_date + timedelta(days=1)
        window_end = datetime(next_day.year, next_day.month, next_day.day, 2, 0)
        competing_events = event_provider.get_events_within_radius(
            lat, lon, 2.0, window_start, window_end
        )
    except Exception as e:
        logger.warning("[forecast] Event fetch failed: %s", e)

    # Step 4: Compute competition drag
    c_drag = compute_competition_drag(competing_events)

    # Step 5 & 6: Build future df and predict
    competing_events_count = len(competing_events)

    if model is not None:
        future_df = _build_future_df(target_date, weather_rows, competing_events_count)
        try:
            forecast_df = model.predict(future_df)
            slots_raw = forecast_df.to_dict("records")
        except Exception as e:
            logger.warning("[forecast] Model predict failed: %s — falling back to prior", e)
            model_type = "prior"
            slots_raw = _generic_prior_forecast(
                target_date,
                tier=venue_tier,
                venue_capacity=venue_capacity,
                slow_day_covers=slow_day_covers,
                busy_day_covers=busy_day_covers,
            )
    else:
        slots_raw = _generic_prior_forecast(
            target_date,
            tier=venue_tier,
            venue_capacity=venue_capacity,
            slow_day_covers=slow_day_covers,
            busy_day_covers=busy_day_covers,
            avg_visit_slots=avg_visit_slots,
        )

    # Step 7: Apply weather multiplier W(t) per slot
    # Compute per-slot weather multiplier (varies by hour)
    # Build weather lookup
    weather_by_hour: dict[int, dict] = {}
    for w in weather_rows:
        wdt = w["ds"]
        if isinstance(wdt, str):
            wdt = datetime.fromisoformat(wdt)
        weather_by_hour[wdt.hour] = w

    adjusted_slots = []
    for slot in slots_raw:
        ds = slot["ds"]
        if isinstance(ds, str):
            ds = datetime.fromisoformat(ds)

        hour = ds.hour
        w = weather_by_hour.get(hour, {})
        w_temp = w.get("temp", rep_temp)
        w_precip = w.get("precip", rep_precip)
        w_wind = w.get("wind", rep_wind)
        w_mult = weather_multiplier(w_temp, w_precip, w_wind)

        yhat_adj = slot["yhat"] * w_mult * c_drag
        ylow_adj = slot["yhat_lower"] * w_mult * c_drag
        yhigh_adj = slot["yhat_upper"] * w_mult * c_drag

        adjusted_slots.append({
            "ds": ds,
            "yhat": max(0.0, yhat_adj),
            "yhat_lower": max(0.0, ylow_adj),
            "yhat_upper": max(0.0, yhigh_adj),
            "hour_label": _format_hour(ds),
            "w_mult": w_mult,
        })

    # Step 8: Apply holiday multiplier
    holidays = _get_hospitality_holidays(target_date.year)
    holiday_info = holidays.get(target_date)
    holiday_mult = holiday_info[1] if holiday_info else 1.0
    holiday_name = holiday_info[0] if holiday_info else None

    if holiday_mult != 1.0:
        for slot in adjusted_slots:
            slot["yhat"]       *= holiday_mult
            slot["yhat_lower"] *= holiday_mult
            slot["yhat_upper"] *= holiday_mult

    # Step 8.5: Hard-cap every slot at venue capacity — even a trained Prophet
    # model should not predict more people than physically fit, and weather/
    # holiday multipliers can push past capacity on busy forecasts.
    if venue_capacity and venue_capacity > 0:
        _cap = float(venue_capacity)
        for slot in adjusted_slots:
            slot["yhat"]       = min(slot["yhat"],       _cap)
            slot["yhat_lower"] = min(slot["yhat_lower"], _cap)
            slot["yhat_upper"] = min(slot["yhat_upper"], _cap)

    # Step 9: Aggregate to hourly curve (group by hour label, take first slot per hour)
    hourly_by_hour: dict[str, dict] = {}
    for slot in adjusted_slots:
        hour_key = slot["ds"].strftime("%H:00")
        if hour_key not in hourly_by_hour:
            hourly_by_hour[hour_key] = {
                "hour": _format_hour(slot["ds"].replace(minute=0)),
                "yhat": 0.0,
                "yhat_lower": 0.0,
                "yhat_upper": 0.0,
                "_count": 0,
            }
        hourly_by_hour[hour_key]["yhat"] += slot["yhat"]
        hourly_by_hour[hour_key]["yhat_lower"] += slot["yhat_lower"]
        hourly_by_hour[hour_key]["yhat_upper"] += slot["yhat_upper"]
        hourly_by_hour[hour_key]["_count"] += 1

    hourly_curve = []
    for hk in sorted(hourly_by_hour.keys()):
        h = hourly_by_hour[hk]
        n = max(h["_count"], 1)
        hourly_curve.append({
            "hour": h["hour"],
            "yhat": round(h["yhat"] / n, 1),
            "yhat_lower": round(h["yhat_lower"] / n, 1),
            "yhat_upper": round(h["yhat_upper"] / n, 1),
        })

    # Step 10: Final estimates — sum yhat across all slots gives total covers
    total_yhat = sum(s["yhat"] for s in adjusted_slots)
    total_low = sum(s["yhat_lower"] for s in adjusted_slots)
    total_high = sum(s["yhat_upper"] for s in adjusted_slots)

    # Normalize to "covers during operating window" — peak concurrent occupancy
    # yhat per slot is already headcount (not cumulative), so take max across slots
    peak_yhat = max((s["yhat"] for s in adjusted_slots), default=0.0)
    peak_low = max((s["yhat_lower"] for s in adjusted_slots), default=0.0)
    peak_high = max((s["yhat_upper"] for s in adjusted_slots), default=0.0)

    # Final estimate is total unique covers (entries), approximate as sum / avg_visit_slots
    # avg_visit_slots is resolved from concept_type at the top of this function
    mid_covers = max(1, int(round(total_yhat / avg_visit_slots)))
    low_covers = max(1, int(round(total_low / avg_visit_slots)))
    high_covers = max(1, int(round(total_high / avg_visit_slots)))

    # Peak hour
    peak_slot = max(adjusted_slots, key=lambda s: s["yhat"], default=None)
    peak_hour_str = _format_hour(peak_slot["ds"]) if peak_slot else "10:00 PM"

    # Revenue estimates (covers * avg drink price)
    rev_mid = int(round(mid_covers * avg_drink_price))
    rev_low = int(round(low_covers * avg_drink_price))
    rev_high = int(round(high_covers * avg_drink_price))

    # ── Staffing: per-hour schedule via staffing engine ───────────────────────
    staffing_hourly: dict = {}
    try:
        from core.staffing.venue_physics    import get_venue_physics
        from core.staffing.bartender_learner import load_capacity_model
        from core.staffing.staffing_engine  import compute_hourly_staffing, peak_staffing

        physics       = get_venue_physics(venue_id, concept_type)
        learned_model = load_capacity_model(venue_id)

        staffing_hourly = compute_hourly_staffing(
            hourly_curve  = hourly_curve,
            physics       = physics,
            learned_model = learned_model,
            capacity      = venue_capacity,
        )
        _peak = peak_staffing(staffing_hourly)
        bartenders_needed = max(1, _peak["bartenders"])
    except Exception as exc:
        logger.warning("[forecast] Staffing engine failed (using cover ratio): %s", exc)
        bartenders_needed = max(1, math.ceil(mid_covers / 80))

    # Weather description
    def _weather_desc(temp_f, precip, wind):
        parts = []
        if precip >= 0.25:
            parts.append("rainy")
        elif precip > 0:
            parts.append("light rain")
        if temp_f < 35:
            parts.append("very cold")
        elif temp_f < 50:
            parts.append("cold")
        elif temp_f > 95:
            parts.append("very hot")
        elif temp_f > 85:
            parts.append("hot")
        if wind >= 35:
            parts.append("high winds")
        if not parts:
            parts.append("clear")
        return ", ".join(parts).capitalize()

    weather_desc = _weather_desc(rep_temp, rep_precip, rep_wind)
    w_overall = weather_multiplier(rep_temp, rep_precip, rep_wind)

    # DOW factor
    dow_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    dow_name = dow_names[target_date.weekday()]
    dow_mult = _DOW_PRIOR.get(target_date.weekday(), 0.60)
    dow_impact_pct = round((dow_mult - 1.0) * 100)
    dow_impact_str = f"{dow_impact_pct:+d}%" if dow_impact_pct != 0 else "baseline"

    # Month factor
    month_names = ["", "January", "February", "March", "April", "May", "June",
                   "July", "August", "September", "October", "November", "December"]
    month_name = month_names[target_date.month]

    # Weather impact as percentage
    w_impact_pct = round((w_overall - 1.0) * 100)
    w_impact_str = f"{w_impact_pct:+d}%" if w_impact_pct != 0 else "no impact"

    # Competition drag as percentage
    c_impact_pct = round((c_drag - 1.0) * 100)
    c_impact_str = f"{c_impact_pct:+d}%" if c_impact_pct != 0 else "no impact"

    # Baseline covers = the DOW-adjusted prior for THIS venue with no
    # weather / event / holiday effects applied. Using the venue's own
    # tier + slow/busy + capacity means the baseline is on the same scale
    # as mid_covers, and "lift" cleanly reads as "how much weather +
    # events pushed us above or below a normal night." Previously this
    # used _GENERIC_PEAK * dow_mult which produced a 100+ baseline for
    # small venues → the lift number was nonsensically negative.
    _month_mult_tbl = {
        1: 0.72, 2: 0.78, 3: 0.92, 4: 0.88, 5: 0.91, 6: 0.96,
        7: 0.94, 8: 0.93, 9: 0.87, 10: 0.97, 11: 0.85, 12: 1.12,
    }
    month_mult = _month_mult_tbl.get(target_date.month, 1.0)
    _baseline_slots = _generic_prior_forecast(
        target_date,
        tier            = venue_tier,
        venue_capacity  = venue_capacity,
        slow_day_covers = slow_day_covers,
        busy_day_covers = busy_day_covers,
        avg_visit_slots = avg_visit_slots,
    )
    baseline_slots_sum = sum(s["yhat"] for s in _baseline_slots)
    baseline_covers = max(1, int(round(baseline_slots_sum / avg_visit_slots)))
    lift = mid_covers - baseline_covers
    lift_pct = round((lift / baseline_covers) * 100) if baseline_covers > 0 else 0

    # Build factors list
    factors = [
        {
            "name": "Day of week",
            "value": dow_name,
            "impact": dow_impact_str,
        },
        {
            "name": "Month",
            "value": month_name,
            "impact": f"{round((month_mult - 1.0) * 100):+d}%" if month_mult != 1.0 else "baseline",
        },
        {
            "name": "Weather",
            "value": f"{weather_desc} · {rep_temp:.0f}°F",
            "impact": w_impact_str,
        },
    ]
    if competing_events:
        factors.append({
            "name": "Competing events",
            "value": f"{len(competing_events)} nearby",
            "impact": c_impact_str,
        })
    else:
        factors.append({
            "name": "Competing events",
            "value": "None detected",
            "impact": "no impact",
        })

    # Holiday factor
    if holiday_name:
        h_impact_pct = round((holiday_mult - 1.0) * 100)
        h_impact_str = f"{h_impact_pct:+d}%"
        factors.append({
            "name": "Holiday",
            "value": holiday_name,
            "impact": h_impact_str,
        })

    # Calibration state and MAPE
    cal_state, mape_str = _calibration_state(venue_id)
    if model_type == "prior":
        cal_state = "generic_prior"
        mape_str = "±30%"

    # Confidence pct (inverse of MAPE midpoint)
    mape_pct_map = {
        "±30%": 70, "±24%": 76, "±18%": 82,
        "±12%": 88, "±8%": 92, "±5%": 95,
    }
    confidence_pct = mape_pct_map.get(mape_str, 70)

    return {
        "venue_id": venue_id,
        "date": target_date.isoformat(),
        "model_type": model_type,
        "confidence_pct": confidence_pct,
        "final_estimate": {
            "low": low_covers,
            "mid": mid_covers,
            "high": high_covers,
        },
        "revenue_estimate": {
            "low": rev_low,
            "mid": rev_mid,
            "high": rev_high,
        },
        "baseline_covers": baseline_covers,
        "lift": lift,
        "lift_pct": lift_pct,
        "peak_hour": peak_hour_str,
        "weather_multiplier": round(w_overall, 4),
        "competition_drag": round(c_drag, 4),
        "staffing_rec": {
            "bartenders": bartenders_needed,
            "note": (
                f"Estimated {mid_covers} covers. "
                f"{bartenders_needed} bartender{'s' if bartenders_needed != 1 else ''} recommended."
            ),
        },
        "staffing_hourly": staffing_hourly,
        "hourly_curve": hourly_curve,
        "factors": factors,
        "calibration_state": cal_state,
        "mape_expected": mape_str,
    }


# ── HTTP handler ──────────────────────────────────────────────────────────────

def _parse_params(body: dict) -> tuple:
    """Extract and validate forecast request parameters from body dict."""
    venue_id = body.get("venue_id", os.environ.get("VENUESCOPE_VENUE_ID", "default"))
    date_str = body.get("date")
    if date_str:
        try:
            target_date = date.fromisoformat(date_str)
        except ValueError:
            target_date = date.today()
    else:
        target_date = date.today()

    lat = float(body.get("lat", 27.9506))
    lon = float(body.get("lon", -82.4572))
    city = body.get("city", "tampa")

    # If lat/lon not provided, try to look up from city
    if "lat" not in body and city:
        try:
            from core.event_intelligence import CITY_LATLON
            lat, lon = CITY_LATLON.get(city.lower(), (lat, lon))
        except Exception:
            pass

    return venue_id, target_date, lat, lon, city


def handle_request(method: str, path: str, query_string: str, body: dict) -> tuple[dict, int]:
    """
    Handle a forecast request from the API handler.

    method: 'GET' or 'POST'
    path: the request path (should be /forecast/tonight)
    query_string: URL query string (for GET requests)
    body: parsed JSON body (for POST requests)

    Returns (response_dict, http_status_code).
    """
    if method == "GET":
        qs = parse_qs(query_string)
        body = {
            "venue_id": qs.get("venue_id", [None])[0],
            "date": qs.get("date", [None])[0],
            "lat": qs.get("lat", [None])[0],
            "lon": qs.get("lon", [None])[0],
            "city": qs.get("city", [None])[0],
        }
        # Remove None values
        body = {k: v for k, v in body.items() if v is not None}

    try:
        venue_id, target_date, lat, lon, city = _parse_params(body)
        result = forecast_tonight(
            venue_id=venue_id,
            target_date=target_date,
            lat=lat,
            lon=lon,
            city=city,
        )
        return result, 200
    except Exception as exc:
        logger.error("[forecast_service] Request failed: %s", exc, exc_info=True)
        return {"error": str(exc)}, 500
