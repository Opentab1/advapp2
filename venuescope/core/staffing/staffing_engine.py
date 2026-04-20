"""
VenueScope — Staffing engine.

Converts an hourly occupancy forecast into per-hour staff headcounts.
Works in two modes:
  1. Learned (preferred): venue_dph + drinks_per_cover_per_hour from bartender_learner
  2. Default: covers_per_bartender from concept-type defaults

The result is stored in the DynamoDB forecast record under 'staffing_hourly'
and read by the React frontend for Tonight's Coverage + month auto-populate.
"""
from __future__ import annotations
import math
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Operating hour range (4 PM = 16, 1 AM = 25)
_OPEN_HOUR  = 16
_CLOSE_HOUR = 26   # exclusive


def compute_hourly_staffing(
    hourly_curve: list[dict],
    physics: dict,
    learned_model: Optional[dict] = None,
    capacity: Optional[int] = None,
) -> dict:
    """
    Compute required staff counts for each operating hour.

    Args:
        hourly_curve:  [{hour, yhat, yhat_lower, yhat_upper}, ...]
                       yhat is concurrent headcount for that hour.
        physics:       Venue physics dict (from venue_physics.get_venue_physics()).
        learned_model: Optional dict from bartender_learner.load_capacity_model().
        capacity:      Venue capacity (overrides physics if provided).

    Returns dict keyed by 24-hr hour string "16".."25":
    {
      "16": {"bartenders": 1, "servers": 0, "door": 0, "barback": 0, "concurrent": 9.6},
      "22": {"bartenders": 3, "servers": 0, "door": 1, "barback": 1, "concurrent": 66.0},
      ...
    }
    """
    cap              = capacity or physics.get("capacity", 150)
    bar_stations     = physics.get("bar_stations", 1)
    max_bartenders   = physics.get("max_bartenders", bar_stations * 2)
    always_bartenders = physics.get("always_bartenders", 1)
    door_threshold   = physics.get("door_threshold_pct", 0.55)
    barback_threshold = physics.get("barback_threshold_pct", 0.40)
    tables_per_server = physics.get("tables_per_server", 0.0)
    avg_party_size   = physics.get("avg_party_size", 2.5)

    # Prefer learned model over physics defaults
    if learned_model and learned_model.get("source") == "learned" and learned_model.get("covers_per_bartender", 0) > 0:
        covers_per_bartender = learned_model["covers_per_bartender"]
        data_note = f"learned ({learned_model.get('shifts_analyzed', 0)} shifts)"
    else:
        covers_per_bartender = physics.get("covers_per_bartender", 35)
        data_note = "concept defaults"

    logger.debug("[engine] covers_per_bartender=%d (%s)", covers_per_bartender, data_note)

    result: dict[str, dict] = {}

    for pt in hourly_curve:
        hour_key = _hour_key(pt)
        concurrent = float(pt.get("yhat", 0.0))

        # ── Bartenders ────────────────────────────────────────────────────────
        raw_bart = math.ceil(concurrent / max(covers_per_bartender, 1))
        bartenders = int(max(always_bartenders, min(raw_bart, max_bartenders)))

        # ── Servers (table-service venues) ────────────────────────────────────
        if tables_per_server > 0 and avg_party_size > 0:
            active_tables = concurrent / avg_party_size
            servers = int(max(0, math.ceil(active_tables / tables_per_server)))
        else:
            servers = 0

        # ── Threshold-based roles ─────────────────────────────────────────────
        occ_pct = concurrent / max(cap, 1)
        door    = 1 if occ_pct >= door_threshold   else 0
        barback = 1 if occ_pct >= barback_threshold else 0

        result[str(hour_key)] = {
            "bartenders": bartenders,
            "servers":    servers,
            "door":       door,
            "barback":    barback,
            "concurrent": round(concurrent, 1),
        }

    return result


def peak_staffing(staffing_hourly: dict) -> dict:
    """Return the max staff count across all hours per role."""
    if not staffing_hourly:
        return {"bartenders": 1, "servers": 0, "door": 0, "barback": 0}
    peak = {"bartenders": 0, "servers": 0, "door": 0, "barback": 0}
    for counts in staffing_hourly.values():
        for role in peak:
            peak[role] = max(peak[role], counts.get(role, 0))
    return peak


def staffing_to_shift_blocks(staffing_hourly: dict, date_str: str) -> list[dict]:
    """
    Convert per-hour counts into suggested shift blocks.
    Returns one block per role describing the contiguous covered window.

    Example output:
    [
      {"role": "bartender", "count": 2, "startTime": "18:00", "endTime": "02:00", "date": "2026-04-19"},
      {"role": "door",      "count": 1, "startTime": "21:00", "endTime": "02:00", "date": "2026-04-19"},
    ]
    """
    if not staffing_hourly:
        return []

    # Collect (hour, count) per role in sorted order
    role_hours: dict[str, list[tuple[int, int]]] = {
        "bartender": [],
        "server":    [],
        "door":      [],
        "barback":   [],
    }

    for hk in sorted(staffing_hourly.keys(), key=lambda x: int(x)):
        h = int(hk)
        counts = staffing_hourly[hk]
        role_hours["bartender"].append((h, counts.get("bartenders", 0)))
        role_hours["server"].append((h,    counts.get("servers",    0)))
        role_hours["door"].append((h,      counts.get("door",       0)))
        role_hours["barback"].append((h,   counts.get("barback",    0)))

    blocks = []
    for role, hours in role_hours.items():
        active = [(h, c) for h, c in hours if c > 0]
        if not active:
            continue

        max_count  = max(c for _, c in active)
        start_hour = active[0][0]
        end_hour   = active[-1][0] + 1   # shift ends at the end of last active hour

        blocks.append({
            "role":      role,
            "count":     max_count,
            "startTime": _hour_to_hhmm(start_hour),
            "endTime":   _hour_to_hhmm(end_hour),
            "date":      date_str,
        })

    return blocks


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hour_key(pt: dict) -> int:
    """
    Extract a 24-hr integer hour from an hourly_curve point.
    Returns values 16-25 (4 PM through 1 AM next day).
    """
    # Prefer ds datetime attribute
    ds = pt.get("ds")
    if ds and hasattr(ds, "hour"):
        h = ds.hour
        return h + 24 if h < 4 else h

    # Parse from label "10:00 PM", "12:00 AM", "1:00 AM"
    label = pt.get("hour", "")
    try:
        parts = label.replace(":00", "").strip().split()
        num  = int(parts[0])
        ampm = parts[1].upper() if len(parts) > 1 else "PM"
        if ampm == "PM":
            return 12 if num == 12 else num + 12
        else:  # AM
            if num == 12:
                return 24          # midnight
            if num < 4:
                return num + 24    # 1 AM → 25, 2 AM → 26
            return num
    except Exception:
        return 22   # fallback: 10 PM


def _hour_to_hhmm(hour: int) -> str:
    """24+ hr integer to HH:MM. e.g., 25 → '01:00', 26 → '02:00'."""
    h = hour % 24
    return f"{h:02d}:00"
