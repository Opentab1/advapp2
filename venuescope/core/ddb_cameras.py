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
        "segment_seconds":  float(item.get("segmentSeconds", 0)),
        "interval_seconds": float(item["segmentInterval"]) if item.get("segmentInterval") else None,
        "enabled":         bool(item.get("enabled", True)),
        "notes":           item.get("notes", ""),
        "config_path":      None,
        "shift_id":         None,
        # Per-camera people-count calibration (0 = use global default)
        "blobs_per_person": int(item.get("blobsPerPerson", 0)),
        # Bar zone/line config saved by the React zone editor (JSON string)
        "bar_config_json":  item.get("barConfigJson", ""),
        # Table zone config saved by the React table zone editor (JSON array string)
        "table_zones_json": item.get("tableZonesJson", ""),
        # Source flag so camera_loop knows this came from DDB
        "_source":          "dynamodb",
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


def sync_sqlite_to_ddb(venue_id: str) -> int:
    """
    One-way sync: push cameras from local SQLite into DynamoDB using put_item
    with condition_not_exists so we never overwrite cameras that were edited
    in the admin portal. Returns the number of cameras upserted.
    Runs on worker startup so the admin portal always reflects reality.
    """
    ddb = _get_ddb()
    if ddb is None:
        return 0
    try:
        from core.database import list_cameras as list_cameras_sqlite
        import datetime
        sqlite_cams = list_cameras_sqlite()
        if not sqlite_cams:
            return 0
        table = ddb.Table(TABLE)
        synced = 0
        for cam in sqlite_cams:
            cid = cam.get("camera_id", "")
            if not cid:
                continue
            modes_parts = [cam.get("mode", "drink_count")]
            extra = cam.get("extra_modes") or []
            if isinstance(extra, list):
                modes_parts += extra
            modes_str = ",".join(m for m in modes_parts if m)
            try:
                table.put_item(
                    Item={
                        "venueId":        venue_id,
                        "cameraId":       cid,
                        "name":           cam.get("name", cid),
                        "rtspUrl":        cam.get("rtsp_url", ""),
                        "modes":          modes_str,
                        "enabled":        bool(cam.get("enabled", True)),
                        "segmentSeconds": str(float(cam.get("segment_seconds", 0))),
                        "modelProfile":   cam.get("model_profile", "balanced"),
                        "notes":          cam.get("notes", ""),
                        "createdAt":      datetime.datetime.utcnow().isoformat(),
                        "_syncedFromSqlite": True,
                    },
                    ConditionExpression="attribute_not_exists(cameraId)",
                )
                synced += 1
                log.info(f"[ddb_cameras] Synced '{cam.get('name', cid)}' → DynamoDB")
            except Exception as e:
                if "ConditionalCheckFailedException" in str(e):
                    pass  # already in DDB — skip
                else:
                    log.warning(f"[ddb_cameras] Failed to sync '{cid}': {e}")
        if synced:
            log.info(f"[ddb_cameras] sync_sqlite_to_ddb: pushed {synced} new cameras for venue '{venue_id}'")
        return synced
    except Exception as e:
        log.warning(f"[ddb_cameras] sync_sqlite_to_ddb failed: {e}")
        return 0


def update_camera_bar_config_json(venue_id: str, camera_id: str,
                                  bar_config_json: str) -> bool:
    """
    Write barConfigJson to a camera's DynamoDB record.
    Called after auto-detection to persist the result for future segments.
    Returns True on success.
    """
    ddb = _get_ddb()
    if not ddb:
        return False
    try:
        table = ddb.Table(TABLE)
        table.update_item(
            Key={"venueId": venue_id, "cameraId": camera_id},
            UpdateExpression="SET barConfigJson = :v",
            ExpressionAttributeValues={":v": bar_config_json},
        )
        log.info(f"[ddb_cameras] barConfigJson saved for {venue_id}/{camera_id}")
        return True
    except Exception as e:
        log.warning(f"[ddb_cameras] update_camera_bar_config_json failed: {e}")
        return False


def update_camera_next_occupancy(venue_id: str, camera_id: str, next_at: float) -> bool:
    """
    Write nextOccupancyAt (Unix epoch seconds) to the camera's DDB record.
    Called by camera_loop immediately after launching a people_count segment
    so the UI can show an accurate countdown to the next run.
    """
    from decimal import Decimal
    ddb = _get_ddb()
    if not ddb:
        return False
    try:
        table = ddb.Table(TABLE)
        table.update_item(
            Key={"venueId": venue_id, "cameraId": camera_id},
            UpdateExpression="SET nextOccupancyAt = :v",
            ExpressionAttributeValues={":v": Decimal(str(int(next_at)))},
        )
        log.debug(f"[ddb_cameras] nextOccupancyAt={int(next_at)} saved for {venue_id}/{camera_id}")
        return True
    except Exception as e:
        log.debug(f"[ddb_cameras] update_camera_next_occupancy failed: {e}")
        return False


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
