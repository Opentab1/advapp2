"""
VenueScope — Weather ingest layer.
Fetches hourly weather from Open-Meteo, converts metric→US units at ingest.
Caches in memory with a 3600-second TTL.
"""
from __future__ import annotations
import time
import logging
from datetime import datetime, date
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# ── In-memory cache ───────────────────────────────────────────────────────────
# Key: (lat, lon, date_str)  →  (fetched_at: float, data: list[dict])
_cache: dict[tuple, tuple[float, list]] = {}
_CACHE_TTL = 3600  # seconds


def _cache_get(key: tuple) -> Optional[list]:
    entry = _cache.get(key)
    if entry is None:
        return None
    fetched_at, data = entry
    if time.time() - fetched_at > _CACHE_TTL:
        del _cache[key]
        return None
    return data


def _cache_set(key: tuple, data: list) -> None:
    _cache[key] = (time.time(), data)


# ── Fetch ─────────────────────────────────────────────────────────────────────

def fetch_weather_forecast(lat: float, lon: float, target_date: date) -> list[dict]:
    """
    Fetch hourly weather forecast from Open-Meteo for a given location and date.

    Returns a list of dicts (one per hour, 0–23) with keys:
      ds      datetime  — UTC hour
      temp    float     — °F
      precip  float     — in/hr
      wind    float     — mph
    """
    date_str = target_date.isoformat()
    cache_key = (round(lat, 4), round(lon, 4), date_str)

    cached = _cache_get(cache_key)
    if cached is not None:
        logger.debug("[weather] Cache hit for (%s, %s, %s)", lat, lon, date_str)
        return cached

    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "temperature_2m,precipitation,windspeed_10m",
        "forecast_days": 3,
        "timezone": "auto",
    }

    try:
        r = requests.get(url, params=params, timeout=10)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.warning("[weather] Open-Meteo fetch failed: %s — returning empty weather", e)
        return []

    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    temps_c = hourly.get("temperature_2m", [])
    precip_mm = hourly.get("precipitation", [])
    wind_kmh = hourly.get("windspeed_10m", [])

    result = []
    for i, ts_str in enumerate(times):
        try:
            dt = datetime.fromisoformat(ts_str)
        except ValueError:
            continue
        if dt.date() != target_date:
            continue

        # Convert metric → US at ingest
        temp_c = temps_c[i] if i < len(temps_c) else 15.0
        temp_f = (temp_c * 9 / 5) + 32

        precip_mmphr = precip_mm[i] if i < len(precip_mm) else 0.0
        precip_inphr = precip_mmphr / 25.4

        wind_km = wind_kmh[i] if i < len(wind_kmh) else 0.0
        wind_mph = wind_km * 0.621371

        result.append({
            "ds": dt,
            "temp": round(temp_f, 1),
            "precip": round(precip_inphr, 4),
            "wind": round(wind_mph, 1),
        })

    _cache_set(cache_key, result)
    logger.info("[weather] Fetched %d hourly rows for %s on %s", len(result), (lat, lon), date_str)
    return result


def fetch_historical_weather(lat: float, lon: float,
                              start_date: date, end_date: date) -> list[dict]:
    """
    Fetch historical actual weather from Open-Meteo archive API.
    Same return format as fetch_weather_forecast.
    Used by training_pipeline.py to join historical weather to training snapshots.
    """
    cache_key = (round(lat, 4), round(lon, 4),
                 f"arch_{start_date.isoformat()}_{end_date.isoformat()}")

    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "hourly": "temperature_2m,precipitation,windspeed_10m",
        "timezone": "auto",
    }

    try:
        r = requests.get(url, params=params, timeout=20)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.warning("[weather] Open-Meteo archive fetch failed: %s — returning empty", e)
        return []

    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    temps_c = hourly.get("temperature_2m", [])
    precip_mm = hourly.get("precipitation", [])
    wind_kmh = hourly.get("windspeed_10m", [])

    result = []
    for i, ts_str in enumerate(times):
        try:
            dt = datetime.fromisoformat(ts_str)
        except ValueError:
            continue

        temp_c = temps_c[i] if i < len(temps_c) else 15.0
        temp_f = (temp_c * 9 / 5) + 32

        precip_mmphr = precip_mm[i] if i < len(precip_mm) else 0.0
        precip_inphr = precip_mmphr / 25.4

        wind_km = wind_kmh[i] if i < len(wind_kmh) else 0.0
        wind_mph = wind_km * 0.621371

        result.append({
            "ds": dt,
            "temp": round(temp_f, 1),
            "precip": round(precip_inphr, 4),
            "wind": round(wind_mph, 1),
        })

    _cache_set(cache_key, result)
    logger.info("[weather] Archive: %d hourly rows from %s to %s", len(result), start_date, end_date)
    return result


# ── Weather multiplier ────────────────────────────────────────────────────────

def weather_multiplier(temp_f: float, precip_inh: float, wind_mph: float) -> float:
    """
    Compute a scalar weather drag multiplier in range [0.0, 1.0].
    Returns product of three independent lookup-table multipliers.

    Lookup tables (from spec):
      Precip (in/hr): 0→1.0, <0.05→0.90, <0.25→0.75, <0.75→0.55, ≥0.75→0.40
      Temp (°F):      <20 or >100→0.50, <35 or >95→0.75, <50 or >85→0.90, 50–85→1.00
      Wind (mph):     <20→1.00, <35→0.90, ≥35→0.70
    """
    # Precipitation multiplier
    if precip_inh == 0.0:
        w_precip = 1.0
    elif precip_inh < 0.05:
        w_precip = 0.90
    elif precip_inh < 0.25:
        w_precip = 0.75
    elif precip_inh < 0.75:
        w_precip = 0.55
    else:
        w_precip = 0.40

    # Temperature multiplier
    if temp_f < 20 or temp_f > 100:
        w_temp = 0.50
    elif temp_f < 35 or temp_f > 95:
        w_temp = 0.75
    elif temp_f < 50 or temp_f > 85:
        w_temp = 0.90
    else:
        w_temp = 1.00

    # Wind multiplier
    if wind_mph < 20:
        w_wind = 1.00
    elif wind_mph < 35:
        w_wind = 0.90
    else:
        w_wind = 0.70

    return round(w_precip * w_temp * w_wind, 4)
