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
from typing import Dict, Any, Optional, List

DYNAMODB_TABLE = "VenueScopeJobs"

# Offline queue — persisted locally when AWS is unreachable
_DATA_DIR      = Path(os.environ.get("VENUESCOPE_DATA_DIR",
                                      str(Path.home() / ".venuescope")))
_QUEUE_FILE    = _DATA_DIR / "sync_queue.json"
_IDENTITY_FILE = Path.home() / ".venuescope" / "venue_identity.json"


def _get_venue_id() -> str:
    """
    Resolve the active venueId in priority order:
    1. Identity file written by auth.py on login (multi-venue safe)
    2. VENUESCOPE_VENUE_ID env var (legacy / fallback)
    """
    try:
        if _IDENTITY_FILE.exists():
            data = json.loads(_IDENTITY_FILE.read_text())
            vid  = data.get("venueId", "")
            if vid:
                return vid
    except Exception:
        pass
    return os.environ.get("VENUESCOPE_VENUE_ID", "")

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
        and _get_venue_id()
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


def _upload_summary_to_s3(summary: Dict[str, Any], job_id: str, venue_id: str) -> Optional[str]:
    """
    Upload the full summary JSON to S3 so the web app can fetch rich detail.
    Key: venuescope/{venueId}/{jobId}/summary.json
    Always called on job completion (not just theft flagged).
    Returns S3 key or None if upload fails/not configured.
    """
    bucket = os.environ.get("S3_BUCKET", "")
    if not bucket:
        return None

    s3_key = f"venuescope/{venue_id}/{job_id}/summary.json"
    try:
        s3 = _get_client("s3")
        body = json.dumps(summary, default=str).encode()
        _retry(lambda: s3.put_object(
            Bucket=bucket,
            Key=s3_key,
            Body=body,
            ContentType="application/json",
        ))
        print(f"[aws_sync] Summary uploaded to s3://{bucket}/{s3_key}", flush=True)
        return s3_key
    except Exception as e:
        print(f"[aws_sync] S3 summary upload failed: {e}", flush=True)
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

    venue_id = _get_venue_id()
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


def push_live_metrics(job_id: str, summary: Dict[str, Any], elapsed_sec: float) -> bool:
    """
    Push real-time running totals to DynamoDB every ~30 s during live stream processing.
    Updates the existing job record with current drink counts, headcount, etc.
    The React dashboard reads these and refreshes the live view.
    """
    if not _is_configured():
        return False
    if not _cb.allow():
        return False

    venue_id = _get_venue_id()
    now      = str(time.time())

    # ── Extract current totals from partial summary ────────────────────────
    bts          = summary.get("bartenders", {})
    total_drinks = int(sum(d.get("total_drinks", 0) for d in bts.values()))
    unrung       = int(sum(d.get("unrung_drinks", 0) or 0 for d in bts.values()))

    people       = summary.get("people", {})
    people_in    = int(sum(l.get("in_count", 0) for l in people.values()))
    people_out   = int(sum(l.get("out_count", 0) for l in people.values()))
    headcount    = max(0, people_in - people_out)

    mode         = summary.get("analysis_mode", summary.get("mode", "drink_count"))

    update_expr = (
        "SET #st = :s, updatedAt = :u, isLive = :il, "
        "elapsedSec = :es, analysisMode = :am, "
        "totalDrinks = :td, unrungDrinks = :ud, "
        "peopleIn = :pi, peopleOut = :po, currentHeadcount = :hc"
    )
    expr_names = {"#st": "status"}
    expr_vals: Dict[str, Any] = {
        ":s":  {"S": "running"},
        ":u":  {"N": now},
        ":il": {"BOOL": True},
        ":es": {"N": str(round(elapsed_sec, 1))},
        ":am": {"S": mode},
        ":td": {"N": str(total_drinks)},
        ":ud": {"N": str(unrung)},
        ":pi": {"N": str(people_in)},
        ":po": {"N": str(people_out)},
        ":hc": {"N": str(headcount)},
    }

    # Include per-bartender breakdown if available
    if bts:
        bt_compact = {name: {"drinks": int(d.get("total_drinks", 0)),
                             "per_hour": round(float(d.get("drinks_per_hour", 0.0)), 1)}
                      for name, d in bts.items()}
        update_expr += ", bartenderSummary = :bs"
        expr_vals[":bs"] = {"S": json.dumps(bt_compact)}

    # Include table visits by staff for live dashboard attribution
    tables_data = summary.get("tables", {})
    if tables_data:
        live_visits: Dict[str, Dict[str, int]] = {}
        for tid, tdata in tables_data.items():
            attr = tdata.get("staff_attribution", {})
            if attr:
                live_visits[tid] = {str(k): v for k, v in attr.items()}
        if live_visits:
            update_expr += ", tableVisitsByStaff = :tvs"
            expr_vals[":tvs"] = {"S": json.dumps(live_visits)}

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
        print(f"[aws_sync] Live metrics push failed: {e}", flush=True)
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

    venue_id  = _get_venue_id()
    has_theft = bool(summary.get("has_theft_flag") or summary.get("unrung_drinks", 0) > 0)

    # Always upload full summary JSON to S3 for web app detail view
    summary_s3_key = _upload_summary_to_s3(summary, job_id, venue_id)

    # Upload flagged clip to S3
    clip_s3_key = None
    if has_theft:
        clip_s3_key = _upload_clip_to_s3(Path(result_dir), job_id, venue_id)

    # Active modes (primary + any extras run in same pass)
    active_modes = summary.get("modes", [summary.get("analysis_mode", "drink_count")])

    item: Dict[str, Any] = {
        "venueId":         {"S": venue_id},
        "jobId":           {"S": job_id},
        "status":          {"S": "done"},
        "createdAt":       {"N": str(summary.get("created_at", time.time()))},
        "finishedAt":      {"N": str(time.time())},
        "analysisMode":    {"S": summary.get("analysis_mode", "drink_count")},
        "activeModes":     {"S": json.dumps(active_modes)},
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

    if clip_s3_key:
        item["s3ClipKey"] = {"S": clip_s3_key}

    if summary_s3_key:
        item["summaryS3Key"] = {"S": summary_s3_key}

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

    # ── Bottle count metrics ───────────────────────────────────────────────────
    bottles = summary.get("bottles", {})
    if bottles:
        item["bottleCount"]         = {"N": str(int(bottles.get("total_bottles_seen", 0)))}
        item["peakBottleCount"]     = {"N": str(int(bottles.get("peak_count", 0)))}
        item["pourCount"]           = {"N": str(int(bottles.get("pours_detected", 0)))}
        item["totalPouredOz"]       = {"N": str(float(bottles.get("total_poured_oz", 0.0)))}
        item["overPours"]           = {"N": str(int(bottles.get("over_pours", 0)))}
        item["walkOutAlerts"]       = {"N": str(int(bottles.get("walk_out_alerts", 0)))}
        item["unknownBottleAlerts"] = {"N": str(int(bottles.get("unknown_bottle_alerts", 0)))}
        item["parLowEvents"]        = {"N": str(int(bottles.get("par_low_events", 0)))}
        if bottles.get("walk_out_alerts", 0) > 0 or bottles.get("unknown_bottle_alerts", 0) > 0:
            item["hasTheftFlag"] = {"BOOL": True}   # escalate flag if bottle theft detected

    # ── People count metrics ───────────────────────────────────────────────────
    people = summary.get("people", {})
    if people:
        item["totalEntries"]   = {"N": str(int(people.get("total_entries", 0)))}
        item["totalExits"]     = {"N": str(int(people.get("total_exits", 0)))}
        item["peakOccupancy"]  = {"N": str(int(people.get("peak_occupancy", 0)))}

    # ── Table turns metrics ────────────────────────────────────────────────────
    tables = summary.get("tables", {})
    if tables:
        total_turns = sum(d.get("turn_count", 0) for d in tables.values())
        item["totalTurns"] = {"N": str(total_turns)}
        responses = [v["avg_response_sec"] for v in tables.values()
                     if v.get("avg_response_sec") is not None]
        if responses:
            item["avgResponseSec"] = {"N": str(round(sum(responses) / len(responses), 1))}
        dwells = [v["avg_dwell_min"] for v in tables.values()
                  if v.get("avg_dwell_min") is not None]
        if dwells:
            item["avgDwellMin"] = {"N": str(round(sum(dwells) / len(dwells), 1))}

    # ── Staff activity metrics ─────────────────────────────────────────────────
    staff = summary.get("staff", {})
    if staff:
        item["uniqueStaff"]  = {"N": str(int(staff.get("total_unique_staff", 0)))}
        item["peakHeadcount"]= {"N": str(int(staff.get("peak_headcount", 0)))}
        item["avgIdlePct"]   = {"N": str(float(staff.get("avg_idle_pct", 0.0)))}

    # ── POS reconciliation ─────────────────────────────────────────────────────
    pos_data = summary.get("pos_reconciliation")
    if pos_data and pos_data.get("reconciled"):
        item["posProvider"]       = {"S": str(pos_data.get("provider", ""))}
        item["posRevenue"]        = {"N": str(float(pos_data.get("pos_revenue", 0)))}
        item["posItemCount"]      = {"N": str(int(pos_data.get("pos_drink_count", 0)))}
        item["posCameraCount"]    = {"N": str(int(pos_data.get("camera_drink_count", 0)))}
        item["posVariancePct"]    = {"N": str(float(pos_data.get("variance_pct", 0)))}
        item["posVarianceDrinks"] = {"N": str(int(pos_data.get("variance_drinks", 0)))}
        item["posLostRevenue"]    = {"N": str(float(pos_data.get("estimated_lost_revenue", 0)))}
        # Escalate theft flag if variance > 15%
        if pos_data.get("variance_pct", 0) > 15:
            item["hasTheftFlag"] = {"BOOL": True}

    # ── Table visits by staff ──────────────────────────────────────────────────
    tables = summary.get("tables", {})
    if tables:
        visits_by_staff: Dict[str, Dict[str, int]] = {}
        for tid, tdata in tables.items():
            attr = tdata.get("staff_attribution", {})
            if attr:
                visits_by_staff[tid] = {str(k): v for k, v in attr.items()}
        if visits_by_staff:
            item["tableVisitsByStaff"] = {"S": json.dumps(visits_by_staff)}

    # Circuit breaker check
    if not _cb.allow():
        print(f"[aws_sync] Circuit breaker open — queuing job {job_id} locally", flush=True)
        _enqueue_offline(job_id, item)
        return False

    try:
        ddb = _get_client("dynamodb")
        _retry(lambda: ddb.put_item(TableName=DYNAMODB_TABLE, Item=item))
        print(f"[aws_sync] Job {job_id} synced to DynamoDB ({venue_id})", flush=True)
    except Exception as e:
        print(f"[aws_sync] DynamoDB write failed: {e} — queuing locally", flush=True)
        _enqueue_offline(job_id, item)
        return False

    # ── Bartender profile sync ─────────────────────────────────────────────────
    try:
        from core.profiles.bartender_profile_sync import sync_bartender_profiles
        if summary.get("bartenders"):
            sync_bartender_profiles(venue_id, job_id, summary)
    except Exception as e:
        print(f"[aws_sync] Bartender profile sync failed (non-fatal): {e}", flush=True)

    return True
