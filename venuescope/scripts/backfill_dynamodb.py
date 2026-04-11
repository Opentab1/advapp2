"""
backfill_dynamodb.py — One-time script to sync existing local jobs to DynamoDB.

Reads all completed jobs from the local SQLite database and pushes them to
the VenueScopeJobs DynamoDB table using the same format as aws_sync.py.

Usage:
    cd /Users/opentab/Downloads/venuescope_v6/venuescope
    python3 scripts/backfill_dynamodb.py

Requires AWS credentials in .env or environment variables.
"""
from __future__ import annotations
import os, sys, json
from pathlib import Path

# Load .env from project root
env_file = Path(__file__).resolve().parent.parent.parent / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

# Add venuescope to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.aws_sync import _get_venue_id, _get_client, _retry, DYNAMODB_TABLE
from core.database import get_engine
from sqlalchemy import text

def backfill():
    venue_id = _get_venue_id()
    if not venue_id:
        print("❌ No venue ID found. Make sure VENUESCOPE_VENUE_ID is set in .env or log in first.")
        sys.exit(1)

    if not os.environ.get("AWS_ACCESS_KEY_ID") or not os.environ.get("AWS_SECRET_ACCESS_KEY"):
        print("❌ AWS credentials not set in .env")
        sys.exit(1)

    print(f"📡 Syncing jobs for venue: {venue_id}")

    # Load jobs from SQLite
    engine = get_engine()
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT job_id, clip_label, analysis_mode, created_at, finished_at, summary_json "
            "FROM jobs WHERE status = 'done' AND (is_deleted IS NULL OR is_deleted = 0) "
            "ORDER BY created_at ASC"
        )).fetchall()

    print(f"📦 Found {len(rows)} completed jobs in local database")

    if not rows:
        print("Nothing to sync.")
        return

    ddb = _get_client("dynamodb")
    synced = 0
    skipped = 0
    failed = 0

    for row in rows:
        job_id      = row[0]
        clip_label  = row[1] or ""
        analysis_mode = row[2] or "drink_count"
        created_at  = row[3] or 0
        finished_at = row[4] or 0
        summary_raw = row[5]

        summary = {}
        if summary_raw:
            try:
                summary = json.loads(summary_raw)
            except Exception:
                pass

        # Check if already in DynamoDB
        try:
            existing = ddb.get_item(
                TableName=DYNAMODB_TABLE,
                Key={"venueId": {"S": venue_id}, "jobId": {"S": job_id}},
                ProjectionExpression="jobId",
            )
            if existing.get("Item"):
                print(f"  ⏭  {job_id[:12]}  {clip_label[:30]}  — already synced, skipping")
                skipped += 1
                continue
        except Exception as e:
            print(f"  ⚠️  Could not check existing for {job_id}: {e}")

        has_theft = bool(summary.get("has_theft_flag") or summary.get("unrung_drinks", 0) > 0)
        active_modes = summary.get("modes", [analysis_mode])

        item = {
            "venueId":         {"S": venue_id},
            "jobId":           {"S": job_id},
            "status":          {"S": "done"},
            "createdAt":       {"N": str(created_at)},
            "finishedAt":      {"N": str(finished_at)},
            "analysisMode":    {"S": analysis_mode},
            "activeModes":     {"S": json.dumps(active_modes)},
            "clipLabel":       {"S": clip_label},
            "totalDrinks":     {"N": str(int(summary.get("total_drinks", 0)))},
            "drinksPerHour":   {"N": str(float(summary.get("drinks_per_hour", 0.0)))},
            "topBartender":    {"S": str(summary.get("top_bartender", ""))},
            "confidenceScore": {"N": str(int(summary.get("confidence_score", 0)))},
            "confidenceLabel": {"S": summary.get("confidence_label", "")},
            "confidenceColor": {"S": summary.get("confidence_color", "yellow")},
            "hasTheftFlag":    {"BOOL": has_theft},
            "unrungDrinks":    {"N": str(int(summary.get("unrung_drinks", 0)))},
            "cameraLabel":     {"S": str(summary.get("camera_label", venue_id))},
        }

        # People count
        people = summary.get("people", {})
        if people:
            item["totalEntries"]  = {"N": str(int(people.get("total_entries", 0)))}
            item["totalExits"]    = {"N": str(int(people.get("total_exits", 0)))}
            item["peakOccupancy"] = {"N": str(int(people.get("peak_occupancy", 0)))}

        # Bottle count
        bottles = summary.get("bottles", {})
        if bottles:
            item["bottleCount"]     = {"N": str(int(bottles.get("total_bottles_seen", 0)))}
            item["pourCount"]       = {"N": str(int(bottles.get("pours_detected", 0)))}
            item["totalPouredOz"]   = {"N": str(float(bottles.get("total_poured_oz", 0.0)))}
            item["overPours"]       = {"N": str(int(bottles.get("over_pours", 0)))}

        try:
            _retry(lambda i=item: ddb.put_item(TableName=DYNAMODB_TABLE, Item=i))
            print(f"  ✅ {job_id[:12]}  {clip_label[:40]}")
            synced += 1
        except Exception as e:
            print(f"  ❌ {job_id[:12]}  {clip_label[:40]}  — FAILED: {e}")
            failed += 1

    print(f"\n{'='*50}")
    print(f"✅ Synced:  {synced}")
    print(f"⏭  Skipped: {skipped} (already in DynamoDB)")
    print(f"❌ Failed:  {failed}")
    print(f"Venue: {venue_id}")

if __name__ == "__main__":
    backfill()
