"""
VenueScope — Bartender profile accumulator.
After each completed job, extracts per-bartender metrics and upserts
into the BartenderProfiles DynamoDB table.

DynamoDB table: BartenderProfiles
  PK: venueId (S)
  SK: bartenderId (S)  — normalized bartender name (lowercase, spaces→underscores)

Fields:
  name (S), displayName (S), totalShifts (N), totalDrinks (N),
  totalHours (N), avgDrinksPerHour (N), peakDrinksPerHour (N),
  theftFlags (N), lastSeen (S), shiftHistory (S) [JSON],
  avgIdlePct (N), tableVisits (N), createdAt (S), updatedAt (S)
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

PROFILES_TABLE = "BartenderProfiles"

# Maximum number of historical shift records to retain per bartender
_MAX_SHIFT_HISTORY = 90


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalize_id(name: str) -> str:
    """
    Convert a display name to a stable DynamoDB sort-key identifier.
    e.g. 'Alex Smith' → 'alex_smith', 'DJ Óscar!' → 'dj_scar'
    """
    lowered  = name.lower()
    no_space = lowered.replace(" ", "_")
    cleaned  = re.sub(r"[^a-z0-9_]", "", no_space)
    # Collapse multiple consecutive underscores
    return re.sub(r"_+", "_", cleaned).strip("_") or "unknown"


def get_shift_has_theft(summary: Dict[str, Any]) -> bool:
    """Return True if the summary indicates a theft flag or unrung drinks."""
    if summary.get("has_theft_flag"):
        return True
    if int(summary.get("unrung_drinks", 0) or 0) > 0:
        return True
    # Also check POS reconciliation variance if present
    pos = summary.get("pos_reconciliation") or {}
    if pos.get("reconciled") and pos.get("variance_pct", 0) > 15:
        return True
    return False


def get_bartender_idle_pct(name: str, summary: Dict[str, Any]) -> float:
    """
    Return idle percentage for a given bartender name.
    Attempts to match by name in staff_details; falls back to the venue-wide
    avg_idle_pct if a per-person match is not possible.
    """
    staff = summary.get("staff") or {}
    details: List[Dict] = staff.get("staff_details") or []

    # Try to match by display name (case-insensitive) if staff details carry names
    for d in details:
        if d.get("name", "").lower() == name.lower():
            total   = float(d.get("total_seconds", 0) or 0)
            idle    = float(d.get("idle_seconds",  0) or 0)
            if total > 0:
                return round(idle / total * 100, 1)

    # Fallback: venue-wide average
    return float(staff.get("avg_idle_pct", 0.0) or 0.0)


# ── DynamoDB client replication (mirrors aws_sync._get_client pattern) ────────

def _get_client(service: str):
    import boto3
    return boto3.client(
        service,
        region_name=os.environ.get("AWS_REGION", "us-east-2"),
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )


def _retry(fn, attempts: int = 3, base_delay: float = 1.0):
    """Exponential-backoff retry.  Raises the last exception after all attempts."""
    last_exc: Optional[Exception] = None
    for attempt in range(attempts):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            if attempt < attempts - 1:
                delay = base_delay * (2 ** attempt)
                print(
                    f"[profile_sync] Attempt {attempt + 1} failed: {exc}. "
                    f"Retrying in {delay:.1f}s…",
                    flush=True,
                )
                time.sleep(delay)
    raise last_exc  # type: ignore[misc]


def _is_configured() -> bool:
    return bool(
        os.environ.get("AWS_ACCESS_KEY_ID")
        and os.environ.get("AWS_SECRET_ACCESS_KEY")
    )


# ── Core logic ────────────────────────────────────────────────────────────────

def sync_bartender_profiles(
    venue_id: str,
    job_id: str,
    summary: Dict[str, Any],
) -> bool:
    """
    Extract per-bartender metrics from the job summary and upsert into
    BartenderProfiles DynamoDB table.

    Returns True on success, False if skipped or AWS not configured.
    """
    if not _is_configured():
        print("[profile_sync] AWS not configured — skipping profile sync", flush=True)
        return False

    bartenders: Dict[str, Any] = summary.get("bartenders") or {}
    if not bartenders:
        return False

    has_theft    = get_shift_has_theft(summary)
    video_sec    = float(summary.get("video_seconds", 0) or 0)
    shift_hours  = round(video_sec / 3600, 4) if video_sec > 0 else 0.0
    job_date     = datetime.fromtimestamp(
        float(summary.get("created_at", time.time()) or time.time()),
        tz=timezone.utc,
    ).strftime("%Y-%m-%d")
    now_iso      = datetime.now(tz=timezone.utc).isoformat()

    # Table visits by staff: {track_id_str: total_visits_across_all_tables}
    table_visits_by_staff: Dict[str, int] = {}
    for _tid, tdata in (summary.get("tables") or {}).items():
        attr = tdata.get("staff_attribution") or {}
        for track_str, visits in attr.items():
            key = str(track_str)
            table_visits_by_staff[key] = table_visits_by_staff.get(key, 0) + int(visits)

    # Also honour explicit summary["table_visits_by_staff"] if present
    explicit_tvbs = summary.get("table_visits_by_staff") or {}
    for track_str, visits in explicit_tvbs.items():
        key = str(track_str)
        table_visits_by_staff[key] = table_visits_by_staff.get(key, 0) + int(visits)

    ddb     = _get_client("dynamodb")
    success = True

    for display_name, bdata in bartenders.items():
        if not display_name:
            continue

        bartender_id = _normalize_id(display_name)
        total_drinks = int(bdata.get("total_drinks", 0) or 0)
        dph          = float(bdata.get("drinks_per_hour", 0.0) or 0.0)
        idle_pct     = get_bartender_idle_pct(display_name, summary)

        # Table visits for this bartender — we don't reliably have track_id → name
        # mapping at this stage, so we use the station_id key or sum if only one bartender
        b_table_visits = 0
        if len(bartenders) == 1:
            # Single bartender: all table visits attributed to them
            b_table_visits = sum(table_visits_by_staff.values())
        # Multi-bartender: visits cannot be attributed without track→name mapping here;
        # the summary["table_visits_by_staff"] populated by aws_sync carries track IDs.
        # We leave b_table_visits=0 for multi-bartender jobs unless explicit data exists.

        # ── Fetch existing profile ─────────────────────────────────────────
        existing: Dict[str, Any] = {}
        try:
            resp = _retry(lambda: ddb.get_item(
                TableName=PROFILES_TABLE,
                Key={
                    "venueId":     {"S": venue_id},
                    "bartenderId": {"S": bartender_id},
                },
            ))
            existing = resp.get("Item") or {}
        except Exception as exc:
            print(
                f"[profile_sync] Could not fetch existing profile for {display_name}: {exc}",
                flush=True,
            )
            # Continue with empty existing — we'll create a fresh record

        # ── Merge metrics ──────────────────────────────────────────────────
        prev_shifts       = int(_n(existing.get("totalShifts")) or 0)
        prev_drinks       = int(_n(existing.get("totalDrinks")) or 0)
        prev_hours        = float(_n(existing.get("totalHours")) or 0.0)
        prev_theft_flags  = int(_n(existing.get("theftFlags")) or 0)
        prev_table_visits = int(_n(existing.get("tableVisits")) or 0)
        prev_peak_dph     = float(_n(existing.get("peakDrinksPerHour")) or 0.0)
        created_at        = _s(existing.get("createdAt")) or now_iso

        new_shifts       = prev_shifts + 1
        new_drinks       = prev_drinks + total_drinks
        new_hours        = round(prev_hours + shift_hours, 4)
        new_theft_flags  = prev_theft_flags + (1 if has_theft else 0)
        new_table_visits = prev_table_visits + b_table_visits
        new_peak_dph     = max(prev_peak_dph, dph)
        new_avg_dph      = round(new_drinks / new_hours, 2) if new_hours > 0 else 0.0
        new_avg_idle     = round(
            (float(_n(existing.get("avgIdlePct")) or 0.0) * prev_shifts + idle_pct)
            / new_shifts,
            1,
        ) if new_shifts > 0 else idle_pct

        # ── Shift history (newest-first ring buffer) ───────────────────────
        history_json = _s(existing.get("shiftHistory")) or "[]"
        try:
            history: List[Dict] = json.loads(history_json)
            if not isinstance(history, list):
                history = []
        except (json.JSONDecodeError, ValueError):
            history = []

        new_entry: Dict[str, Any] = {
            "date":          job_date,
            "jobId":         job_id,
            "drinks":        total_drinks,
            "perHour":       round(dph, 2),
            "durationHours": round(shift_hours, 3),
            "hasTheft":      has_theft,
            "avgIdlePct":    idle_pct,
            "tableVisits":   b_table_visits,
        }
        history.insert(0, new_entry)
        history = history[:_MAX_SHIFT_HISTORY]

        # ── Upsert to DynamoDB ─────────────────────────────────────────────
        item: Dict[str, Any] = {
            "venueId":          {"S": venue_id},
            "bartenderId":      {"S": bartender_id},
            "name":             {"S": bartender_id},
            "displayName":      {"S": display_name},
            "totalShifts":      {"N": str(new_shifts)},
            "totalDrinks":      {"N": str(new_drinks)},
            "totalHours":       {"N": str(new_hours)},
            "avgDrinksPerHour": {"N": str(new_avg_dph)},
            "peakDrinksPerHour":{"N": str(new_peak_dph)},
            "theftFlags":       {"N": str(new_theft_flags)},
            "lastSeen":         {"S": job_date},
            "shiftHistory":     {"S": json.dumps(history)},
            "avgIdlePct":       {"N": str(new_avg_idle)},
            "tableVisits":      {"N": str(new_table_visits)},
            "createdAt":        {"S": created_at},
            "updatedAt":        {"S": now_iso},
        }

        try:
            _retry(lambda i=item: ddb.put_item(TableName=PROFILES_TABLE, Item=i))
            print(
                f"[profile_sync] Updated profile for {display_name} ({venue_id}): "
                f"shifts={new_shifts} drinks={new_drinks} dph={new_avg_dph:.1f}",
                flush=True,
            )
        except Exception as exc:
            print(
                f"[profile_sync] Failed to upsert profile for {display_name}: {exc}",
                flush=True,
            )
            success = False

    return success


# ── Attribute extraction helpers ──────────────────────────────────────────────

def _n(attr: Optional[Dict]) -> Optional[str]:
    """Extract a DynamoDB N (number) attribute value as a string, or None."""
    if attr and isinstance(attr, dict):
        return attr.get("N")
    return None


def _s(attr: Optional[Dict]) -> Optional[str]:
    """Extract a DynamoDB S (string) attribute value, or None."""
    if attr and isinstance(attr, dict):
        return attr.get("S")
    return None
