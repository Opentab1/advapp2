"""
VenueScope — Occupancy snapshots table.
Stores 15-min headcount snapshots derived from sensors or drink-proxy backfill.
Matches the SQLAlchemy/SQLite pattern from core/database.py.
"""
from __future__ import annotations
import json
import logging
import time
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Table, Column, String, Float, Integer, Text, MetaData,
    select, insert, text,
)

logger = logging.getLogger(__name__)

# ── Table definition ──────────────────────────────────────────────────────────

_meta = MetaData()

occupancy_snapshots_table = Table(
    "occupancy_snapshots", _meta,
    Column("venue_id",    String,  nullable=False),
    Column("snapshot_ts", Float,   nullable=False),   # unix epoch
    Column("headcount",   Integer, nullable=False),
    Column("source",      String,  nullable=False, default="sensor"),
    # PRIMARY KEY (venue_id, snapshot_ts) — enforced via unique constraint below
)


def _get_engine():
    """Import engine lazily to avoid circular imports."""
    from core.database import get_engine
    return get_engine()


def ensure_table() -> None:
    """Create the occupancy_snapshots table if it doesn't exist."""
    engine = _get_engine()
    try:
        with engine.begin() as conn:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS occupancy_snapshots ("
                "  venue_id    TEXT    NOT NULL,"
                "  snapshot_ts REAL    NOT NULL,"
                "  headcount   INTEGER NOT NULL,"
                "  source      TEXT    NOT NULL DEFAULT 'sensor',"
                "  PRIMARY KEY (venue_id, snapshot_ts)"
                ")"
            ))
    except Exception as e:
        logger.warning("[occupancy_snapshots] ensure_table failed: %s", e)


# Call on import
try:
    ensure_table()
except Exception:
    pass  # May fail if DB not yet initialized; will retry on first use


# ── Write ─────────────────────────────────────────────────────────────────────

def write_snapshot(venue_id: str, ts: float, headcount: int,
                   source: str = "sensor") -> None:
    """
    Write a single occupancy snapshot. Upserts — if (venue_id, snapshot_ts)
    already exists, the existing row is replaced.
    """
    ensure_table()
    engine = _get_engine()
    try:
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT OR REPLACE INTO occupancy_snapshots "
                "(venue_id, snapshot_ts, headcount, source) "
                "VALUES (:vid, :ts, :hc, :src)"
            ), {"vid": venue_id, "ts": ts, "hc": int(headcount), "src": source})
    except Exception as e:
        logger.error("[occupancy_snapshots] write_snapshot failed: %s", e)
        raise


# ── Read ──────────────────────────────────────────────────────────────────────

def get_snapshots(venue_id: str, start_ts: float, end_ts: float) -> list[dict]:
    """
    Return all occupancy snapshots for venue_id within [start_ts, end_ts].
    Each row is a dict with keys: venue_id, snapshot_ts, headcount, source.
    """
    ensure_table()
    engine = _get_engine()
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT venue_id, snapshot_ts, headcount, source "
                "FROM occupancy_snapshots "
                "WHERE venue_id = :vid "
                "  AND snapshot_ts >= :start "
                "  AND snapshot_ts <= :end "
                "ORDER BY snapshot_ts ASC"
            ), {"vid": venue_id, "start": start_ts, "end": end_ts}).fetchall()
        return [
            {"venue_id": r[0], "snapshot_ts": r[1], "headcount": r[2], "source": r[3]}
            for r in rows
        ]
    except Exception as e:
        logger.error("[occupancy_snapshots] get_snapshots failed: %s", e)
        return []


def has_sufficient_data(venue_id: str, min_days: int = 60) -> bool:
    """
    Return True if the venue has ≥ min_days worth of sensor snapshots.
    Only counts 'sensor' source rows (not drink_proxy backfill).
    """
    ensure_table()
    engine = _get_engine()
    try:
        with engine.connect() as conn:
            row = conn.execute(text(
                "SELECT MIN(snapshot_ts), MAX(snapshot_ts), COUNT(*) "
                "FROM occupancy_snapshots "
                "WHERE venue_id = :vid AND source = 'sensor'"
            ), {"vid": venue_id}).fetchone()
        if not row or row[2] == 0:
            return False
        min_ts, max_ts, count = row
        days_span = (max_ts - min_ts) / 86400
        return days_span >= min_days
    except Exception as e:
        logger.error("[occupancy_snapshots] has_sufficient_data failed: %s", e)
        return False


# ── Backfill from jobs ────────────────────────────────────────────────────────

def backfill_from_jobs(venue_id: str) -> int:
    """
    Backfill occupancy_snapshots from completed VenueScope jobs for venue_id.

    Room-based (2026-04-21 rewrite): we rely on peak_occupancy from
    people_count jobs as the magnitude signal, because entry/exit line
    counting produces false counts at venues with loitering / re-entry.

    Strategy:
      Path A — PEOPLE_COUNT jobs (primary, room-based):
        Each job already has peak_occupancy. Sample the job window at
        15-min intervals, writing that venue-peak as the headcount for each
        bucket. Simple: "how many people were in this room at this time".

      Path B — DRINK_COUNT jobs (fallback, drink-proxy):
        Only used when we have zero people_count jobs for a time window.
        Builds 15-min buckets of drink timestamps, normalizes the shape,
        and scales by the job's reported peak_occupancy (if present) or a
        conservative default so Prophet has SOMETHING to train on.

    Snapshots are keyed by (venue_id, snapshot_ts) so repeated runs are
    idempotent — we just skip rows that already exist.

    Returns count of new snapshots written.
    """
    from core.database import get_engine as _db_engine
    from sqlalchemy import text as _text

    ensure_table()
    engine = _db_engine()

    # Pull all completed jobs and split by mode
    try:
        with engine.connect() as conn:
            rows = conn.execute(_text(
                "SELECT job_id, analysis_mode, created_at, summary_json "
                "FROM jobs "
                "WHERE status = 'done' AND is_deleted = 0 AND summary_json IS NOT NULL "
                "ORDER BY created_at ASC"
            )).fetchall()
    except Exception as e:
        logger.error("[backfill] Failed to load jobs: %s", e)
        return 0

    people_jobs = []
    drink_jobs  = []
    for row in rows:
        mode = (row[1] or "").strip()
        if mode == "people_count": people_jobs.append(row)
        elif mode == "drink_count": drink_jobs.append(row)

    logger.info("[backfill] jobs available — people_count=%d  drink_count=%d",
                len(people_jobs), len(drink_jobs))

    bucket_size = 15 * 60  # 15 minutes

    def _existing_headcount(ts: float) -> int:
        # Room-max across cameras: if another camera already wrote this bucket,
        # only overwrite when our peak is higher. Returns -1 if no row exists.
        try:
            with _get_engine().connect() as conn:
                row = conn.execute(text(
                    "SELECT headcount FROM occupancy_snapshots "
                    "WHERE venue_id = :vid AND snapshot_ts = :ts"
                ), {"vid": venue_id, "ts": round(ts, 1)}).first()
            return int(row[0]) if row is not None else -1
        except Exception:
            return -1

    total_written = 0

    # ─── Path A — room-based (primary) ──────────────────────────────────────
    for job_id, mode, created_at, summary_raw in people_jobs:
        try:
            summary = json.loads(summary_raw)
        except Exception:
            continue
        # `peak_occupancy` is the room-max over the job's observation window.
        # If the number is 0 the camera saw no one; still write the row so
        # Prophet learns "empty shift" shape — it's a valid observation.
        peak = int(
            summary.get("peak_occupancy")
            or summary.get("peak")
            or summary.get("people", {}).get("peak_occupancy")
            or summary.get("occupancy", {}).get("peak", 0)
            or 0
        )
        started = float(created_at or 0)
        duration = float(summary.get("video_seconds")
                          or summary.get("duration_seconds")
                          or summary.get("elapsed_sec") or 0)
        if started <= 0 or duration <= 0:
            continue
        # One snapshot per 15-min bucket overlapping the job window
        first_bucket = int(started // bucket_size) * bucket_size
        last_bucket  = int((started + duration) // bucket_size) * bucket_size
        written_this_job = 0
        for bts in range(int(first_bucket), int(last_bucket) + bucket_size, bucket_size):
            existing = _existing_headcount(bts)
            if existing >= peak:
                continue  # another camera already wrote an equal-or-higher peak for this bucket
            try:
                # write_snapshot uses INSERT OR REPLACE — safe to overwrite
                write_snapshot(venue_id=venue_id, ts=float(bts),
                                headcount=peak, source="people_count")
                written_this_job += 1
            except Exception as e:
                logger.warning("[backfill] write failed job=%s bucket=%d: %s",
                                job_id, bts, e)
        if written_this_job > 0:
            logger.info("[backfill] A/people_count job %s → %d snapshots (peak=%d)",
                         job_id, written_this_job, peak)
        total_written += written_this_job

    # ─── Path B — drink-proxy (fallback for early days) ─────────────────────
    # Only write a bucket if no people_count row already owns it.
    for job_id, mode, created_at, summary_raw in drink_jobs:
        try:
            summary = json.loads(summary_raw)
        except Exception:
            continue

        all_timestamps: list[float] = []
        bartenders = summary.get("bartenders", {})
        for bname, bdata in bartenders.items():
            ts_list = bdata.get("drink_timestamps", [])
            all_timestamps.extend([float(t) for t in ts_list if t is not None])
        if not all_timestamps:
            continue

        total_drinks = len(all_timestamps)
        # Use peak_occupancy if the job carries it; otherwise a conservative
        # default (10 people per shift with drinks). Avoid 0 → no training signal.
        magnitude = int(
            summary.get("peak_occupancy")
            or summary.get("people", {}).get("peak_occupancy", 0)
            or summary.get("people", {}).get("total_entries", 0)
            or 10
        )

        session_start = min(all_timestamps)
        buckets: dict[int, int] = {}
        for ts in all_timestamps:
            bidx = int((ts - session_start) // bucket_size)
            buckets[bidx] = buckets.get(bidx, 0) + 1

        written_this_job = 0
        for bidx, drinks_in_bucket in sorted(buckets.items()):
            bts = session_start + (bidx * bucket_size)
            if _existing_headcount(bts) >= 0:  # people_count always wins if present
                continue
            estimate = max(1, int(round((drinks_in_bucket / total_drinks) * magnitude)))
            try:
                write_snapshot(venue_id=venue_id, ts=round(bts, 1),
                                headcount=estimate, source="drink_proxy")
                written_this_job += 1
            except Exception as e:
                logger.warning("[backfill] write failed job=%s bucket=%d: %s",
                                job_id, bidx, e)
        if written_this_job > 0:
            logger.info("[backfill] B/drink_proxy job %s → %d snapshots (mag=%d)",
                         job_id, written_this_job, magnitude)
        total_written += written_this_job

    logger.info("[backfill] Total snapshots written for venue %s: %d",
                 venue_id, total_written)
    return total_written
