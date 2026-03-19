"""
VenueScope — AWS sync module.
After a job completes locally, push results to DynamoDB (always)
and upload clip to S3 (only when theft is flagged).

Required env vars:
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_REGION            (default: us-east-2)
  VENUESCOPE_VENUE_ID   (which venue these results belong to)
  S3_BUCKET             (for flagged clip uploads)
"""
from __future__ import annotations
import os, json, time
from pathlib import Path
from typing import Dict, Any, Optional

DYNAMODB_TABLE = "VenueScopeJobs"


def _is_configured() -> bool:
    return bool(
        os.environ.get("AWS_ACCESS_KEY_ID")
        and os.environ.get("AWS_SECRET_ACCESS_KEY")
        and os.environ.get("VENUESCOPE_VENUE_ID")
    )


def _get_client(service: str):
    import boto3
    return boto3.client(
        service,
        region_name=os.environ.get("AWS_REGION", "us-east-2"),
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    )


def _upload_clip_to_s3(result_dir: Path, job_id: str, venue_id: str) -> Optional[str]:
    """Upload the annotated video (or best available clip) to S3. Returns S3 key or None."""
    bucket = os.environ.get("S3_BUCKET", "")
    if not bucket:
        return None

    # Look for annotated video first, then raw video fallback
    candidates = list(result_dir.glob("*annotated*.mp4")) + list(result_dir.glob("*.mp4"))
    if not candidates:
        return None

    clip_path = candidates[0]
    s3_key = f"venuescope/{venue_id}/{job_id}/{clip_path.name}"

    try:
        s3 = _get_client("s3")
        s3.upload_file(
            str(clip_path),
            bucket,
            s3_key,
            ExtraArgs={"ContentType": "video/mp4"},
        )
        print(f"[aws_sync] Clip uploaded to s3://{bucket}/{s3_key}", flush=True)
        return s3_key
    except Exception as e:
        print(f"[aws_sync] S3 upload failed: {e}", flush=True)
        return None


def sync_job_to_aws(job_id: str, summary: Dict[str, Any], result_dir: Path) -> bool:
    """
    Push job summary to DynamoDB VenueScopeJobs table.
    If theft is flagged, also upload the clip to S3.
    Returns True on success, False on any failure.
    """
    if not _is_configured():
        print("[aws_sync] Not configured — set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, VENUESCOPE_VENUE_ID", flush=True)
        return False

    venue_id = os.environ["VENUESCOPE_VENUE_ID"]

    # Upload clip to S3 only for theft-flagged jobs
    s3_key = None
    has_theft = bool(summary.get("has_theft_flag") or summary.get("unrung_drinks", 0) > 0)
    if has_theft:
        s3_key = _upload_clip_to_s3(Path(result_dir), job_id, venue_id)

    # Build DynamoDB item — convert all values to DynamoDB-safe types
    item: Dict[str, Any] = {
        "venueId":         {"S": venue_id},
        "jobId":           {"S": job_id},
        "status":          {"S": "done"},
        "createdAt":       {"N": str(summary.get("created_at", time.time()))},
        "finishedAt":      {"N": str(time.time())},
        "analysisMode":    {"S": summary.get("analysis_mode", "drink_count")},
        "clipLabel":       {"S": summary.get("clip_label", "")},
        "totalDrinks":     {"N": str(int(summary.get("total_drinks", 0)))},
        "drinksPerHour":   {"N": str(float(summary.get("drinks_per_hour", 0.0)))},
        "topBartender":    {"S": str(summary.get("top_bartender", ""))},
        "confidenceScore": {"N": str(int(summary.get("confidence_score", 0)))},
        "confidenceLabel": {"S": summary.get("confidence_label", "")},
        "confidenceColor": {"S": summary.get("confidence_color", "yellow")},
        "hasTheftFlag":    {"BOOL": has_theft},
        "unrungDrinks":    {"N": str(int(summary.get("unrung_drinks", 0)))},
    }

    if s3_key:
        item["s3ClipKey"] = {"S": s3_key}

    # Include camera label from bar config if present
    camera = summary.get("camera_label") or summary.get("venue_id", "")
    if camera:
        item["cameraLabel"] = {"S": str(camera)}

    try:
        ddb = _get_client("dynamodb")
        ddb.put_item(TableName=DYNAMODB_TABLE, Item=item)
        print(f"[aws_sync] Job {job_id} synced to DynamoDB ({venue_id})", flush=True)
        return True
    except Exception as e:
        print(f"[aws_sync] DynamoDB write failed: {e}", flush=True)
        return False
