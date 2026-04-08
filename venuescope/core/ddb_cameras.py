"""
ddb_cameras.py — Read camera configs from DynamoDB VenueScopeCameras table.

The admin React app writes cameras here. The worker polls this every sync
cycle (every 60s via camera_loop_manager.sync()) to pick up add/remove/edit.

Falls back silently to an empty list if the table doesn't exist yet or
credentials are not available — the camera_loop then uses its SQLite registry
as before, ensuring backward compatibility.
"""
from __future__ import annotations
import logging
import os
from typing import Optional

log = logging.getLogger(__name__)

TABLE = "VenueScopeCameras"

_ddb = None
def _get_ddb():
    global _ddb
    if _ddb is None:
        try:
            import boto3
            region = os.environ.get("AWS_DEFAULT_REGION") or os.environ.get("AWS_REGION", "us-east-2")
            _ddb = boto3.resource("dynamodb", region_name=region)
        except Exception as e:
            log.debug(f"[ddb_cameras] boto3 unavailable: {e}")
    return _ddb


def _item_to_camera(item: dict) -> dict:
    """Convert a DynamoDB item to the same dict shape as database.get_camera()."""
    modes_str = item.get("modes", "drink_count")
    modes = [m.strip() for m in modes_str.split(",") if m.strip()]
    # camera_loop expects a 'mode' string and an 'extra_modes' list
    primary_mode = modes[0] if modes else "drink_count"
    extra_modes   = modes[1:] if len(modes) > 1 else []
    return {
        "camera_id":       item.get("cameraId", ""),
        "venue":           item.get("venueId", ""),
        "name":            item.get("name", ""),
        "rtsp_url":        item.get("rtspUrl", ""),
        "mode":            primary_mode,
        "extra_modes":     extra_modes,
        "model_profile":   item.get("modelProfile", "balanced"),
        "segment_seconds": float(item.get("segmentSeconds", 0)),
        "enabled":         bool(item.get("enabled", True)),
        "notes":           item.get("notes", ""),
        "config_path":     None,
        "shift_id":        None,
        # Source flag so camera_loop knows this came from DDB
        "_source":         "dynamodb",
    }


def list_cameras_ddb(venue_id: Optional[str] = None) -> list[dict]:
    """
    List cameras from DynamoDB for a given venue, or all venues if venue_id is None.
    Returns [] on any error (caller falls back to SQLite).
    """
    ddb = _get_ddb()
    if ddb is None:
        return []
    try:
        table = ddb.Table(TABLE)
        if venue_id:
            resp = table.query(
                KeyConditionExpression="venueId = :v",
                ExpressionAttributeValues={":v": venue_id},
            )
        else:
            resp = table.scan()
        items = resp.get("Items", [])
        # Handle DDB pagination
        while "LastEvaluatedKey" in resp:
            if venue_id:
                resp = table.query(
                    KeyConditionExpression="venueId = :v",
                    ExpressionAttributeValues={":v": venue_id},
                    ExclusiveStartKey=resp["LastEvaluatedKey"],
                )
            else:
                resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
            items.extend(resp.get("Items", []))

        cameras = [_item_to_camera(item) for item in items if item.get("enabled", True)]
        log.debug(f"[ddb_cameras] Loaded {len(cameras)} cameras from DynamoDB")
        return cameras
    except Exception as e:
        log.debug(f"[ddb_cameras] list_cameras_ddb failed (falling back to SQLite): {e}")
        return []


def get_camera_ddb(camera_id: str) -> Optional[dict]:
    """Get a single camera from DynamoDB by camera_id (scans by SK — use sparingly)."""
    ddb = _get_ddb()
    if ddb is None:
        return None
    try:
        table = ddb.Table(TABLE)
        # camera_id is the sort key; we'd need the PK (venueId) for a direct GetItem.
        # Use a scan with filter since we may not have venueId available here.
        resp = table.scan(
            FilterExpression="cameraId = :c",
            ExpressionAttributeValues={":c": camera_id},
        )
        items = resp.get("Items", [])
        if items:
            return _item_to_camera(items[0])
        return None
    except Exception as e:
        log.debug(f"[ddb_cameras] get_camera_ddb failed: {e}")
        return None
