"""
VenueScope — AWS sync module.
After a job completes locally, push results to DynamoDB (always)
and upload clip to S3 (only when theft is flagged).

Enterprise hardening: exponential-backoff retry, circuit breaker,
local offline queue for when AWS is unreachable.

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

# Offline queue — persisted locally when AWS is unreachable
_DATA_DIR   = Path(os.environ.get("VENUESCOPE_DATA_DIR",
                                   str(Path.home() / ".venuescope")))
_QUEUE_FILE = _DATA_DIR / "sync_queue.json"

# ── Circuit breaker ───────────────────────────────────────────────────────────

class _CircuitBreaker:
    """Stop calling AWS after too many failures; auto-reset after cooldown."""
    def __init__(self, max_failures: int = 5, window_sec: float = 3600,
                 cooldown_sec: float = 300):
        self._max       = max_failures
        self._window    = window_sec
        self._cooldown  = cooldown_sec
        self._failures: list[float] = []
        self._open_at:  Optional[float] = None

    def allow(self) -> bool:
        now = time.time()
        if self._open_at is not None:
            if now - self._open_at < self._cooldown:
                return False
            # Reset after cooldown
            self._open_at = None
            self._failures = []
        # Expire old failures
        self._failures = [t for t in self._failures if now - t < self._window]
        return True

    def record_failure(self):
        self._failures.append(time.time())
        if len(self._failures) >= self._max:
            self._open_at = time.time()
            print(f"[aws_sync] Circuit breaker OPEN — too many failures "
                  f"({self._max} in {self._window/3600:.0f}h). "
                  f"Cooling down {self._cooldown/60:.0f}m.", flush=True)

    def record_success(self):
        self._failures = []
        self._open_at  = None


_cb = _CircuitBreaker()


# ── Retry helper ─────────────────────────────────────────────────────────────

def _retry(fn, attempts: int = 3, base_delay: float = 1.0):
    """Call fn() with exponential backoff. Returns result or raises last exception."""
    last_exc = None
    for attempt in range(attempts):
        try:
            result = fn()
            _cb.record_success()
            return result
        except Exception as exc:
            last_exc = exc
            if attempt < attempts - 1:
                delay = base_delay * (2 ** attempt)
                print(f"[aws_sync] Attempt {attempt+1} failed: {exc}. "
                      f"Retrying in {delay:.1f}s…", flush=True)
                time.sleep(delay)
    _cb.record_failure()
    raise last_exc


# ── Offline queue ─────────────────────────────────────────────────────────────

def _enqueue_offline(job_id: str, item: Dict[str, Any]):
    """Save a sync item to local queue when AWS is unreachable."""
    try:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        queue = []
        if _QUEUE_FILE.exists():
            try:
                queue = json.loads(_QUEUE_FILE.read_text())
            except Exception:
                queue = []
        # Avoid duplicate entries for the same job
        queue = [q for q in queue if q.get("job_id") != job_id]
        queue.append({"job_id": job_id, "item": item, "queued_at": time.time()})
        _QUEUE_FILE.write_text(json.dumps(queue, indent=2))
        print(f"[aws_sync] Job {job_id} queued locally ({len(queue)} in queue)", flush=True)
    except Exception as e:
        print(f"[aws_sync] Failed to write offline queue: {e}", flush=True)


def drain_sync_queue() -> int:
    """Retry all locally-queued sync items. Returns count successfully synced."""
    if not _QUEUE_FILE.exists():
        return 0
    try:
        queue = json.loads(_QUEUE_FILE.read_text())
    except Exception:
        return 0

    if not queue:
        return 0

    if not _cb.allow():
        print("[aws_sync] Circuit breaker open — skipping queue drain", flush=True)
        return 0

    synced  = []
    failed  = []
    ddb     = _get_client("dynamodb")

    for entry in queue:
        try:
            _retry(lambda e=entry: ddb.put_item(
                TableName=DYNAMODB_TABLE, Item=e["item"]
            ))
            synced.append(entry["job_id"])
        except Exception as e:
            print(f"[aws_sync] Queue drain failed for {entry['job_id']}: {e}", flush=True)
            failed.append(entry)

    # Rewrite queue with only failed items
    try:
        _QUEUE_FILE.write_text(json.dumps(failed, indent=2))
    except Exception:
        pass

    if synced:
        print(f"[aws_sync] Drained {len(synced)} queued job(s)", flush=True)
    return len(synced)


# ── Internal helpers ──────────────────────────────────────────────────────────

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
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )


def _upload_clip_to_s3(result_dir: Path, job_id: str, venue_id: str) -> Optional[str]:
    """Upload the annotated video (or best available clip) to S3. Returns S3 key or None."""
    bucket = os.environ.get("S3_BUCKET", "")
    if not bucket:
        return None

    candidates = list(result_dir.glob("*annotated*.mp4")) + list(result_dir.glob("*.mp4"))
    if not candidates:
        return None

    clip_path = candidates[0]
    s3_key    = f"venuescope/{venue_id}/{job_id}/{clip_path.name}"

    try:
        s3 = _get_client("s3")
        _retry(lambda: s3.upload_file(
            str(clip_path), bucket, s3_key,
            ExtraArgs={"ContentType": "video/mp4"},
        ))
        print(f"[aws_sync] Clip uploaded to s3://{bucket}/{s3_key}", flush=True)
        return s3_key
    except Exception as e:
        print(f"[aws_sync] S3 upload failed: {e}", flush=True)
        return None


# ── Public API ────────────────────────────────────────────────────────────────

def sync_partial_to_aws(job_id: str, progress_pct: float,
                        status_msg: str = "", job_data: Optional[Dict] = None) -> bool:
    """
    Push in-progress status to DynamoDB so the React dashboard shows the job as running.
    Called periodically during processing (every ~60 s).
    Uses update_item so it creates the record on first call and patches it on subsequent calls.
    """
    if not _is_configured():
        return False
    if not _cb.allow():
        return False

    venue_id = os.environ["VENUESCOPE_VENUE_ID"]
    now      = str(time.time())
    pct      = str(int(max(0, min(100, progress_pct))))

    update_expr = "SET #st = :s, progressPct = :p, statusMsg = :m, updatedAt = :u"
    expr_names  = {"#st": "status"}
    expr_vals: Dict[str, Any] = {
        ":s": {"S": "running"},
        ":p": {"N": pct},
        ":m": {"S": (status_msg or "")[:200]},
        ":u": {"N": now},
    }

    if job_data:
        update_expr += ", clipLabel = :cl, analysisMode = :am, createdAt = :ca"
        expr_vals[":cl"] = {"S": str(job_data.get("clip_label", "") or "")}
        expr_vals[":am"] = {"S": str(job_data.get("analysis_mode", "drink_count"))}
        expr_vals[":ca"] = {"N": str(job_data.get("created_at", time.time()))}

    try:
        ddb = _get_client("dynamodb")
        _retry(lambda: ddb.update_item(
            TableName=DYNAMODB_TABLE,
            Key={"venueId": {"S": venue_id}, "jobId": {"S": job_id}},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_vals,
        ))
        return True
    except Exception as e:
        print(f"[aws_sync] Partial sync failed: {e}", flush=True)
        return False


def sync_job_to_aws(job_id: str, summary: Dict[str, Any], result_dir: Path) -> bool:
    """
    Push job summary to DynamoDB VenueScopeJobs table.
    If theft is flagged, also upload the clip to S3.
    Falls back to local offline queue if AWS is unreachable.
    Returns True on success (or successful enqueue).
    """
    if not _is_configured():
        print("[aws_sync] Not configured — set AWS_ACCESS_KEY_ID, "
              "AWS_SECRET_ACCESS_KEY, VENUESCOPE_VENUE_ID", flush=True)
        return False

    venue_id  = os.environ["VENUESCOPE_VENUE_ID"]
    has_theft = bool(summary.get("has_theft_flag") or summary.get("unrung_drinks", 0) > 0)
    s3_key    = None
    if has_theft:
        s3_key = _upload_clip_to_s3(Path(result_dir), job_id, venue_id)

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
        "syncStatus":      {"S": "synced"},
    }

    if s3_key:
        item["s3ClipKey"] = {"S": s3_key}

    camera = summary.get("camera_label") or summary.get("venue_id", "")
    if camera:
        item["cameraLabel"] = {"S": str(camera)}

    angle_info = summary.get("camera_angle") or {}
    if angle_info.get("angle"):
        item["cameraAngle"] = {"S": str(angle_info["angle"])}

    review_events = summary.get("review_events", [])
    drink_quality = summary.get("drink_quality", {})
    review_count  = len(review_events) or int(drink_quality.get("review_count", 0))
    if review_count > 0:
        item["reviewCount"] = {"N": str(review_count)}

    tables = summary.get("tables", {})
    if tables:
        responses = [v["avg_response_sec"] for v in tables.values()
                     if v.get("avg_response_sec") is not None]
        if responses:
            item["avgResponseSec"] = {"N": str(round(sum(responses) / len(responses), 1))}

    # Circuit breaker check
    if not _cb.allow():
        print(f"[aws_sync] Circuit breaker open — queuing job {job_id} locally", flush=True)
        _enqueue_offline(job_id, item)
        return False

    try:
        ddb = _get_client("dynamodb")
        _retry(lambda: ddb.put_item(TableName=DYNAMODB_TABLE, Item=item))
        print(f"[aws_sync] Job {job_id} synced to DynamoDB ({venue_id})", flush=True)
        return True
    except Exception as e:
        print(f"[aws_sync] DynamoDB write failed: {e} — queuing locally", flush=True)
        _enqueue_offline(job_id, item)
        return False
