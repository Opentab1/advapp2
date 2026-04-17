"""
VenueScope — Event data provider abstraction.
Fetches competing events from external sources to compute competition drag C(t).

Providers:
  StubProvider        — returns [] always (default, EVENT_PROVIDER=stub)
  TicketmasterProvider — free tier, requires TICKETMASTER_API_KEY
  PredictHQProvider   — paid ($3k-10k/mo), raises NotImplementedError

Competition drag C(t) is the product of (1 - ρ_i) for all competing events,
where ρ_i is the drag coefficient for event i.
"""
from __future__ import annotations
import os
import time
import logging
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# ── Abstract base ─────────────────────────────────────────────────────────────

class EventDataProvider(ABC):
    @abstractmethod
    def get_events_within_radius(
        self,
        lat: float,
        lon: float,
        radius_miles: float,
        start: datetime,
        end: datetime,
    ) -> list[dict]:
        """
        Return list of competing events within radius_miles of (lat, lon),
        occurring between start and end.

        Each event dict has:
          name               str
          start              datetime
          end                datetime
          attendees_estimate int
          category           str  — 'concert', 'sports', 'arts', 'other', 'competing_bar_dj', 'home_sports_game'
        """


# ── Stub provider ─────────────────────────────────────────────────────────────

class StubProvider(EventDataProvider):
    """Default provider — no event data. C(t) = 1.0, no drag."""

    def get_events_within_radius(
        self, lat: float, lon: float, radius_miles: float,
        start: datetime, end: datetime,
    ) -> list[dict]:
        return []


# ── Ticketmaster provider ─────────────────────────────────────────────────────

# Default attendee estimates by category when venue capacity not available
_TM_CATEGORY_DEFAULTS: dict[str, int] = {
    "concert": 2000,
    "sports": 5000,
    "arts": 500,
    "other": 300,
}

# In-memory cache: key → (fetched_at, data)
_tm_cache: dict[str, tuple[float, list]] = {}
_TM_CACHE_TTL = 6 * 3600  # 6 hours


def _tm_cache_key(lat: float, lon: float, radius: float,
                  start: datetime, end: datetime) -> str:
    return f"{round(lat, 3)},{round(lon, 3)},{radius},{start.date()},{end.date()}"


class TicketmasterProvider(EventDataProvider):
    """
    Ticketmaster Discovery API v2.
    Free tier: 5000 requests/day.
    Requires TICKETMASTER_API_KEY env var.
    Responses cached for 6 hours.
    """

    def __init__(self):
        self._api_key = os.environ.get("TICKETMASTER_API_KEY", "")
        if not self._api_key:
            raise ValueError(
                "TICKETMASTER_API_KEY env var is required for TicketmasterProvider."
            )

    def _map_category(self, tm_classification: str) -> str:
        cl = (tm_classification or "").lower()
        if any(k in cl for k in ("music", "concert", "festival")):
            return "concert"
        if any(k in cl for k in ("sports", "sport", "nfl", "nba", "mlb", "nhl", "mls")):
            return "sports"
        if any(k in cl for k in ("arts", "theatre", "theater", "opera", "ballet", "dance")):
            return "arts"
        return "other"

    def _estimate_attendees(self, event: dict, category: str) -> int:
        # Try to get venue capacity from TM response
        venues = event.get("_embedded", {}).get("venues", [])
        if venues:
            capacity = venues[0].get("generalInfo", {}).get("generalRule", None)
            # TM doesn't reliably expose numeric capacity in free tier
            # Fall through to category defaults
        return _TM_CATEGORY_DEFAULTS.get(category, 300)

    def get_events_within_radius(
        self, lat: float, lon: float, radius_miles: float,
        start: datetime, end: datetime,
    ) -> list[dict]:
        cache_key = _tm_cache_key(lat, lon, radius_miles, start, end)
        cached = _tm_cache.get(cache_key)
        if cached is not None:
            fetched_at, data = cached
            if time.time() - fetched_at <= _TM_CACHE_TTL:
                logger.debug("[ticketmaster] Cache hit for %s", cache_key)
                return data

        url = "https://app.ticketmaster.com/discovery/v2/events.json"
        params = {
            "latlong": f"{lat},{lon}",
            "radius": str(int(radius_miles)),
            "unit": "miles",
            "startDateTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endDateTime": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "apikey": self._api_key,
            "size": 50,
        }

        try:
            r = requests.get(url, params=params, timeout=10)
            r.raise_for_status()
            raw = r.json()
        except Exception as e:
            logger.warning("[ticketmaster] API fetch failed: %s — returning empty", e)
            return []

        events_raw = raw.get("_embedded", {}).get("events", [])
        results = []

        for ev in events_raw:
            name = ev.get("name", "Unknown Event")

            # Start time
            dates = ev.get("dates", {}).get("start", {})
            start_str = dates.get("dateTime") or dates.get("localDate", "")
            try:
                ev_start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            except Exception:
                ev_start = start

            # Category
            classifications = ev.get("classifications", [{}])
            cl_name = ""
            if classifications:
                seg = classifications[0].get("segment", {})
                cl_name = seg.get("name", "") or classifications[0].get("genre", {}).get("name", "")
            category = self._map_category(cl_name)

            attendees = self._estimate_attendees(ev, category)

            results.append({
                "name": name,
                "start": ev_start,
                "end": ev_start,  # TM doesn't reliably return end times
                "attendees_estimate": attendees,
                "category": category,
            })

        _tm_cache[cache_key] = (time.time(), results)
        logger.info("[ticketmaster] Fetched %d events within %.1f mi of (%s, %s)",
                    len(results), radius_miles, lat, lon)
        return results


# ── PredictHQ provider (stub — paid tier only) ───────────────────────────────

class PredictHQProvider(EventDataProvider):
    """
    PredictHQ event intelligence API.
    Costs $3,000–$10,000/month — not implemented by default.
    Set PREDICTHQ_API_KEY and EVENT_PROVIDER=predicthq to enable.
    """

    BASE_URL = "https://api.predicthq.com/v1/events/"

    def get_events_within_radius(
        self, lat: float, lon: float, radius_miles: float,
        start: datetime, end: datetime,
    ) -> list[dict]:
        raise NotImplementedError(
            "PredictHQ integration requires API key. "
            "Set PREDICTHQ_API_KEY and EVENT_PROVIDER=predicthq."
        )


# ── Competition drag calculator ───────────────────────────────────────────────

# ρ (rho) drag coefficients per event type
_RHO: dict[str, float] = {
    # large concert (2k+ attendees)
    "large_concert": 0.15,
    # mid concert (500-2k attendees)
    "mid_concert": 0.08,
    # small event (<500 attendees)
    "small_event": 0.03,
    # competing bar with DJ/event
    "competing_bar_dj": 0.12,
    # home sports game (lift, not drag)
    "home_sports_game": -0.05,
}


def _classify_drag_type(event: dict) -> str:
    """Map an event dict to a drag coefficient key."""
    category = event.get("category", "other")
    attendees = event.get("attendees_estimate", 0)

    if category == "home_sports_game":
        return "home_sports_game"
    if category == "competing_bar_dj":
        return "competing_bar_dj"
    if category in ("concert", "festival"):
        if attendees >= 2000:
            return "large_concert"
        elif attendees >= 500:
            return "mid_concert"
        else:
            return "small_event"
    if category == "sports":
        # Away game — draws fans away from bar
        if attendees >= 2000:
            return "large_concert"
        return "mid_concert"
    if category == "arts":
        return "small_event" if attendees < 500 else "mid_concert"
    # other / unknown
    if attendees >= 2000:
        return "large_concert"
    elif attendees >= 500:
        return "mid_concert"
    return "small_event"


def compute_competition_drag(events: list[dict]) -> float:
    """
    Compute competition drag multiplier C(t) as product of (1 - ρ_i) for all events.

    ρ values:
      large concert (2k+ attendees): 0.15
      mid concert (500-2k):          0.08
      small event (<500):            0.03
      competing_bar_dj:              0.12
      home_sports_game:             -0.05  (lift — negative drag)

    Returns float in (0, 1.0+]. Value of 1.0 means no drag. Value <1.0 means drag.
    Large sports games can push C(t) slightly above 1.0 (lift).
    """
    if not events:
        return 1.0

    c = 1.0
    for ev in events:
        drag_type = _classify_drag_type(ev)
        rho = _RHO.get(drag_type, 0.03)
        c *= (1.0 - rho)

    return round(c, 4)


# ── Factory ───────────────────────────────────────────────────────────────────

def get_event_provider() -> EventDataProvider:
    """
    Return the appropriate EventDataProvider based on EVENT_PROVIDER env var.
    Defaults to StubProvider (no event data, C(t) = 1.0).
    """
    provider_type = os.environ.get("EVENT_PROVIDER", "stub").lower().strip()
    if provider_type == "predicthq":
        logger.info("[events] Using PredictHQProvider")
        return PredictHQProvider()
    if provider_type == "ticketmaster":
        logger.info("[events] Using TicketmasterProvider")
        return TicketmasterProvider()
    logger.info("[events] Using StubProvider (EVENT_PROVIDER=%s)", provider_type)
    return StubProvider()
