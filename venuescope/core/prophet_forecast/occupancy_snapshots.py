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

    For each done job:
      - Parse drink timestamps from all bartenders
      - Bucket into 15-min intervals → drink count per bucket (shape)
      - Get total_entries from summary_json['people']['total_entries'] (magnitude)
      - Scale: headcount_per_bucket = (drinks_in_bucket / total_drinks) * total_entries
      - Write each bucket as a snapshot with source='drink_proxy'
      - Skip jobs where all snapshot_ts already exist in the table

    Returns count of new snapshots written.
    """
    from core.database import get_engine as _db_engine
    from sqlalchemy import text as _text

    ensure_table()
    engine = _db_engine()

    # Load all done jobs
    try:
        with engine.connect() as conn:
            rows = conn.execute(_text(
                "SELECT job_id, created_at, summary_json "
                "FROM jobs "
                "WHERE status = 'done' AND is_deleted = 0 AND summary_json IS NOT NULL "
                "ORDER BY created_at ASC"
            )).fetchall()
    except Exception as e:
        logger.error("[backfill] Failed to load jobs: %s", e)
        return 0

    total_written = 0

    for job_id, created_at, summary_raw in rows:
        try:
            summary = json.loads(summary_raw)
        except Exception:
            continue

        # Collect all drink timestamps across all bartenders
        all_timestamps: list[float] = []
        bartenders = summary.get("bartenders", {})
        for bname, bdata in bartenders.items():
            ts_list = bdata.get("drink_timestamps", [])
            all_timestamps.extend([float(t) for t in ts_list if t is not None])

        if not all_timestamps:
            continue

        total_drinks = len(all_timestamps)
        total_entries = (
            summary.get("people", {}).get("total_entries", 0)
            or summary.get("total_entries", 0)
            or 0
        )

        if total_entries <= 0:
            # Can't calibrate magnitude without entries — skip
            continue

        # Bucket into 15-min intervals
        # Align to 15-min boundaries relative to the session start
        session_start = min(all_timestamps)
        bucket_size = 15 * 60  # 15 minutes in seconds

        buckets: dict[int, int] = {}  # bucket_index → drink count
        for ts in all_timestamps:
            bucket_idx = int((ts - session_start) // bucket_size)
            buckets[bucket_idx] = buckets.get(bucket_idx, 0) + 1

        # Check if any of these snapshots already exist
        # Use the first bucket's timestamp as a representative check
        first_bucket_ts = session_start + (min(buckets.keys()) * bucket_size)
        try:
            with _get_engine().connect() as conn:
                existing = conn.execute(text(
                    "SELECT COUNT(*) FROM occupancy_snapshots "
                    "WHERE venue_id = :vid AND snapshot_ts = :ts"
                ), {"vid": venue_id, "ts": round(first_bucket_ts, 1)}).scalar()
            if existing and existing > 0:
                logger.debug("[backfill] Job %s already backfilled, skipping", job_id)
                continue
        except Exception:
            pass

        # Scale headcount per bucket
        written_this_job = 0
        for bucket_idx, drink_count in sorted(buckets.items()):
            bucket_ts = session_start + (bucket_idx * bucket_size)
            headcount_estimate = int(round(
                (drink_count / total_drinks) * total_entries
            ))
            if headcount_estimate <= 0:
                headcount_estimate = 1

            try:
                write_snapshot(
                    venue_id=venue_id,
                    ts=round(bucket_ts, 1),
                    headcount=headcount_estimate,
                    source="drink_proxy",
                )
                written_this_job += 1
            except Exception as e:
                logger.warning("[backfill] Failed to write snapshot for job %s bucket %d: %s",
                               job_id, bucket_idx, e)

        total_written += written_this_job
        if written_this_job > 0:
            logger.info("[backfill] Job %s → %d snapshots written (venue=%s)",
                        job_id, written_this_job, venue_id)

    logger.info("[backfill] Total snapshots written for venue %s: %d", venue_id, total_written)
    return total_written
