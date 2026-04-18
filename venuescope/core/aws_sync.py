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

# ── Sortable DynamoDB key ──────────────────────────────────────────────────────
# DynamoDB sorts by jobId (sort key) ascending. To ensure the 500-item query
# always returns the MOST RECENT jobs, we prefix job IDs with a reverse
# timestamp: '!{9999999999 - int(createdAt):010d}_{job_id}'.
# '!' (ASCII 33) sorts before all hex chars so new items float to the top.
# Older jobs (random UUIDs) sink to the bottom and fall outside limit=500.
_job_ddb_key_cache: Dict[str, str] = {}

# ── Shift boundary tracking ────────────────────────────────────────────────────
# When the calendar date rolls over (midnight), emit a completed "shift summary"
# record to DynamoDB so the Results tab has historical data. After emitting, update
# the baseline so the live record's totalDrinks resets to today's count only.
# These dicts are in-process only — they reset on worker restart, which is acceptable
# since the day boundary detection only needs to fire once per calendar day.
_shift_date:      Dict[str, str] = {}  # job_id → last push date YYYY-MM-DD
_shift_baseline:  Dict[str, int] = {}  # job_id → total_drinks at start of current day
_unrung_baseline: Dict[str, int] = {}  # job_id → unrung_drinks at start of current day

def _ddb_sort_key(job_id: str, created_at: Optional[float] = None) -> str:
    """Return the stable DynamoDB sort key for this job within the current process."""
    if job_id in _job_ddb_key_cache:
        return _job_ddb_key_cache[job_id]
    ts = created_at if created_at is not None else time.time()
    reverse_ts = 9999999999 - int(ts)
    key = f"!{reverse_ts:010d}_{job_id}"
    _job_ddb_key_cache[job_id] = key
    return key

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


def _offline_queue_depth() -> int:
    """Return number of items waiting in the offline sync queue."""
    try:
        if not _QUEUE_FILE.exists():
            return 0
        return len(json.loads(_QUEUE_FILE.read_text()))
    except Exception:
        return 0


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


_SNAP_PRESIGN_SECONDS = 7 * 24 * 3600  # 7 days — max S3 allows for presigned URLs


def upload_serve_snapshot(frame_jpg: bytes, job_id: str, t_sec: float,
                          venue_id: str = "") -> Optional[str]:
    """
    Upload a JPEG snapshot frame to S3 at serve-confirm time.
    Returns a 7-day presigned URL (not the raw key) so React can load it
    directly without any public bucket policy. Objects stay private.
    Called from a background thread — never blocks the inference loop.
    """
    bucket = os.environ.get("S3_BUCKET", "")
    if not bucket or not frame_jpg:
        return None
    venue_id = venue_id or _get_venue_id()
    if not venue_id:
        return None
    s3_key = f"venuescope/{venue_id}/{job_id}/snapshots/{t_sec:.1f}.jpg"
    try:
        s3 = _get_client("s3")
        s3.put_object(
            Bucket=bucket,
            Key=s3_key,
            Body=frame_jpg,
            ContentType="image/jpeg",
        )
        # Generate presigned URL valid for 7 days so only authenticated owners
        # (who receive the URL via DDB/React) can view the snapshot.
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": s3_key},
            ExpiresIn=_SNAP_PRESIGN_SECONDS,
        )
        print(f"[aws_sync] Snapshot uploaded t={t_sec:.1f}s key={s3_key} presigned_ok=True", flush=True)
        return url
    except Exception as e:
        print(f"[aws_sync] Snapshot upload failed t={t_sec:.1f}s: {e}", flush=True)
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
                        status_msg: str = "", job_data: Optional[Dict] = None,
                        venue_id: str = "") -> bool:
    """
    Push in-progress status to DynamoDB so the React dashboard shows the job as running.
    Called periodically during processing (every ~60 s).
    Uses update_item so it creates the record on first call and patches it on subsequent calls.
    """
    if not _is_configured():
        return False
    if not _cb.allow():
        return False

    venue_id = venue_id or _get_venue_id()
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

    created_at_val: Optional[float] = None
    if job_data:
        created_at_val = job_data.get("created_at")
        clip_label = str(job_data.get("clip_label", "") or "")
        is_live_cam = "🔴 LIVE" in clip_label
        update_expr += ", clipLabel = :cl, analysisMode = :am, createdAt = :ca, internalJobId = :ij, isLive = :il"
        expr_vals[":cl"] = {"S": clip_label}
        expr_vals[":am"] = {"S": str(job_data.get("analysis_mode", "drink_count"))}
        expr_vals[":ca"] = {"N": str(created_at_val or time.time())}
        expr_vals[":ij"] = {"S": job_id}
        expr_vals[":il"] = {"BOOL": is_live_cam}
        # Prefer camera_id as cameraLabel for unique deduplication in React
        cam_name = str(job_data.get("camera_id", "") or "")
        if not cam_name and clip_label.startswith("📡 "):
            raw = clip_label[len("📡 "):]
            for _sfx in (" — 🔴 LIVE", " — seg "):
                if _sfx in raw:
                    raw = raw[:raw.index(_sfx)]
            cam_name = raw.strip()
        if cam_name:
            update_expr += ", cameraLabel = :cnl"
            expr_vals[":cnl"] = {"S": cam_name}

    ddb_key = _ddb_sort_key(job_id, created_at_val)
    try:
        ddb = _get_client("dynamodb")
        _retry(lambda: ddb.update_item(
            TableName=DYNAMODB_TABLE,
            Key={"venueId": {"S": venue_id}, "jobId": {"S": ddb_key}},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_vals,
        ))
        return True
    except Exception as e:
        print(f"[aws_sync] Partial sync failed: {e}", flush=True)
        return False


def _write_shift_summary(
    job_id: str,
    venue_id: str,
    summary: Dict[str, Any],
    shift_date: str,         # YYYY-MM-DD of the shift that just ended
    total_drinks: int,       # cumulative drinks at shift end
    drink_baseline: int,     # drinks counted in prior days (subtract to get shift total)
    unrung: int,
    unrung_baseline: int,
    wall_start: float,       # epoch when this camera session started (createdAt)
    midnight_ts: float,      # epoch of midnight ending the shift (finishedAt)
) -> None:
    """
    Write a completed 'done' DynamoDB record summarising the previous night's shift.
    Called once per calendar day rollover so the Results tab has historical data.
    """
    import datetime as _dt
    shift_drinks = max(0, total_drinks - drink_baseline)
    shift_unrung = max(0, unrung - unrung_baseline)
    if shift_drinks == 0:
        return  # nothing to record

    cam_id   = (summary.get("camera_id") or "").replace("/", "_") or job_id[:8]
    sum_id   = f"shift_{cam_id}_{shift_date}"
    sort_key = _ddb_sort_key(sum_id, wall_start)  # placed by shift-start time in DDB

    bts      = summary.get("bartenders", {})
    clip     = (summary.get("clip_label", "") or "").replace("🔴 LIVE", "").strip(" —").strip()
    cam_name = summary.get("camera_id") or summary.get("camera_label", "")
    mode     = summary.get("analysis_mode", summary.get("mode", "drink_count"))

    # Build bartender breakdown for shift (drinks are cumulative; subtract baseline
    # proportionally so per-bartender totals match shift_drinks).
    bt_compact: Dict[str, Any] = {}
    if bts and shift_drinks > 0 and total_drinks > 0:
        scale = shift_drinks / total_drinks
        for name, d in bts.items():
            shifted = max(0, round(int(d.get("total_drinks", 0)) * scale))
            if shifted > 0:
                bt_compact[name] = {
                    "drinks":   shifted,
                    "per_hour": round(float(d.get("drinks_per_hour", 0.0)), 1),
                }

    item: Dict[str, Any] = {
        "venueId":      {"S": venue_id},
        "jobId":        {"S": sort_key},
        "status":       {"S": "done"},
        "isLive":       {"BOOL": False},
        "createdAt":    {"N": str(wall_start)},
        "finishedAt":   {"N": str(midnight_ts)},
        "updatedAt":    {"N": str(time.time())},
        "totalDrinks":  {"N": str(shift_drinks)},
        "unrungDrinks": {"N": str(shift_unrung)},
        "hasTheftFlag": {"BOOL": shift_unrung > 0},
        "analysisMode": {"S": mode},
        "clipLabel":    {"S": clip or f"Shift {shift_date}"},
        "cameraLabel":  {"S": cam_name},
        "confidenceLabel": {"S": "Shift Summary"},
        "confidenceColor": {"S": "green"},
        "confidenceScore": {"N": "85"},
    }
    if bt_compact:
        bt_json = json.dumps(bt_compact)
        item["bartenderBreakdown"] = {"S": bt_json}
        item["bartenderSummary"]   = {"S": bt_json}
        # topBartender = name with most shift drinks
        top = max(bt_compact, key=lambda n: bt_compact[n].get("drinks", 0))
        item["topBartender"] = {"S": top}
        dph_sum = sum(d.get("per_hour", 0) for d in bt_compact.values())
        item["drinksPerHour"] = {"N": str(round(dph_sum, 1))}

    try:
        ddb = _get_client("dynamodb")
        _retry(lambda: ddb.put_item(TableName=DYNAMODB_TABLE, Item=item))
        print(f"[aws_sync] Shift summary written: {shift_drinks} drinks on {shift_date} "
              f"(cam={cam_id})", flush=True)
    except Exception as e:
        print(f"[aws_sync] Failed to write shift summary for {shift_date}: {e}", flush=True)


def push_live_metrics(job_id: str, summary: Dict[str, Any], elapsed_sec: float,
                      venue_id: str = "", created_at: Optional[float] = None) -> bool:
    """
    Push real-time running totals to DynamoDB every ~30 s during live stream processing.
    Updates the existing job record with current drink counts, headcount, etc.
    The React dashboard reads these and refreshes the live view.
    """
    if not _is_configured():
        return False
    if not _cb.allow():
        return False

    venue_id = venue_id or _get_venue_id()
    now      = str(time.time())

    # ── Extract current totals from partial summary ────────────────────────
    bts          = summary.get("bartenders", {})
    total_drinks = int(sum(d.get("total_drinks", 0) for d in bts.values()))
    unrung       = int(sum(d.get("unrung_drinks", 0) or 0 for d in bts.values()))

    # ── Day-boundary detection — emit shift summary + reset daily baseline ─────
    import datetime as _dt
    today_str  = _dt.date.today().isoformat()
    last_date  = _shift_date.get(job_id)
    d_baseline = _shift_baseline.get(job_id, 0)
    u_baseline = _unrung_baseline.get(job_id, 0)

    if last_date and last_date != today_str:
        # Calendar day rolled over — write yesterday's shift summary.
        midnight_ts = _dt.datetime.combine(_dt.date.today(), _dt.time(0, 0)).timestamp()
        _write_shift_summary(
            job_id, venue_id or _get_venue_id(), summary,
            last_date, total_drinks, d_baseline,
            unrung, u_baseline,
            float(created_at or time.time()), midnight_ts,
        )
        # Reset baselines so today starts from zero.
        _shift_baseline[job_id]  = total_drinks
        _unrung_baseline[job_id] = unrung
        d_baseline = total_drinks
        u_baseline = unrung

    _shift_date[job_id] = today_str

    # Report only today's drinks (subtract prior-day baseline).
    today_drinks = max(0, total_drinks - d_baseline)
    today_unrung = max(0, unrung - u_baseline)

    people       = summary.get("people", {})
    # people summary is flat: {total_entries: N, total_exits: N, ...}
    people_in    = int(people.get("total_entries", 0))
    people_out   = int(people.get("total_exits", 0))
    headcount    = max(0, people_in - people_out)

    mode         = summary.get("analysis_mode", summary.get("mode", "drink_count"))

    # For people_count mode, total_entries/exits are always 0 (lightweight runner
    # doesn't count door crossings). Use peak_occupancy from the blob estimator instead.
    peak_occ = int(people.get("peak_occupancy", headcount)) if mode == "people_count" else headcount

    update_expr = (
        "SET #st = :s, updatedAt = :u, isLive = :il, "
        "elapsedSec = :es, analysisMode = :am, "
        "totalDrinks = :td, unrungDrinks = :ud, "
        "peopleIn = :pi, peopleOut = :po, currentHeadcount = :hc, "
        "peakOccupancy = :po2"   # frontend reads peakOccupancy for live headcount
    )
    expr_names = {"#st": "status"}
    expr_vals: Dict[str, Any] = {
        ":s":   {"S": "running"},
        ":u":   {"N": now},
        ":il":  {"BOOL": True},
        ":es":  {"N": str(round(elapsed_sec, 1))},
        ":am":  {"S": mode},
        ":td":  {"N": str(today_drinks)},
        ":ud":  {"N": str(today_unrung)},
        ":pi":  {"N": str(people_in)},
        ":po":  {"N": str(people_out)},
        ":hc":  {"N": str(headcount)},
        ":po2": {"N": str(peak_occ)},
    }

    # Timestamp scaling for buffered NVR/HLS streams.
    #
    # The NVR delivers its buffer at ~1.87x real-time. t_sec = frame_idx/fps grows much faster
    # than wall time. React computes: wallTime = createdAt + tSec
    # So we must:
    #   1. Set createdAt = _wall_start (the moment the worker started processing)
    #   2. Scale all stored t_sec values by / delivery_rate so they reflect wall-clock offsets
    #
    # delivery_rate = NVR t_sec elapsed / wall time elapsed
    #   = (time.time() - _nwr_start) / (time.time() - _wall_start)
    # because _nwr_start = time.time() - t_sec (updated every frame)
    _nwr_start  = summary.get("drink_nwr_start")   # time.time() - current_t_sec at last frame
    _wall_start = summary.get("drink_wall_start")   # epoch when worker started
    T_push = time.time()
    if _nwr_start and _wall_start:
        _nwr_start   = float(_nwr_start)
        _wall_start  = float(_wall_start)
        wall_elapsed = max(T_push - _wall_start, 1.0)
        current_t_sec_est = T_push - _nwr_start   # ≈ current t_sec in NVR buffer
        raw_rate = current_t_sec_est / wall_elapsed
        delivery_rate = max(1.0, min(raw_rate, 20.0))  # clamp: 1x–20x
    else:
        _wall_start   = _wall_start or created_at or T_push
        delivery_rate = 1.0
    _ca = _wall_start  # createdAt = worker start; React adds scaled t_sec to get wall time
    update_expr += ", createdAt = :ca"
    expr_vals[":ca"] = {"N": str(_ca)}

    # ── Drinks per hour (live) ────────────────────────────────────────────────
    # Prior-segment drinks are restored as negative t_sec offsets (before this
    # segment started). Current-segment drinks have t_sec >= 0. Filter to get
    # only new detections so the rate isn't inflated by accumulated totals.
    _live_wall_elapsed = max(T_push - float(_ca), 1.0)
    _seg_drinks = sum(
        sum(1 for t in d.get("drink_timestamps", []) if t >= 0)
        for d in bts.values()
    )
    if _live_wall_elapsed >= 60 and _seg_drinks > 0:
        live_dph = round(_seg_drinks * 3600 / _live_wall_elapsed, 1)
        update_expr += ", drinksPerHour = :dph"
        expr_vals[":dph"] = {"N": str(live_dph)}
    # topBartender = station with most drinks this shift (total_drinks is cumulative)
    if bts:
        top_name = max(bts, key=lambda n: bts[n].get("total_drinks", 0))
        update_expr += ", topBartender = :tb"
        expr_vals[":tb"] = {"S": top_name}

    import time as _t
    print(f"[aws_sync] push delivery_rate={delivery_rate:.3f} "
          f"createdAt_EST={_t.strftime('%H:%M:%S', _t.gmtime(_ca - 3600*4))} "
          f"today_drinks={today_drinks} (cumulative={total_drinks}) job={job_id[:8]}", flush=True)

    # Write clipLabel + cameraLabel on first push so React can display the camera name
    # immediately — these are immutable for the job's lifetime, so if_not_exists is safe.
    clip = summary.get("clip_label", "")
    if clip:
        update_expr += ", clipLabel = if_not_exists(clipLabel, :cl)"
        expr_vals[":cl"] = {"S": clip}
        # Prefer camera_id for unique deduplication; derive from clip_label as fallback
        cam_name = summary.get("camera_id") or summary.get("camera_label", "")
        if not cam_name and clip.startswith("📡 "):
            raw = clip[len("📡 "):]
            for _sfx in (" — 🔴 LIVE", " — seg "):
                if _sfx in raw:
                    raw = raw[:raw.index(_sfx)]
            cam_name = raw.strip()
        if cam_name:
            update_expr += ", cameraLabel = if_not_exists(cameraLabel, :cnl)"
            expr_vals[":cnl"] = {"S": cam_name}

    # ── Live theft events (real-time) ─────────────────────────────────────────
    # Push the last 20 theft-relevant events so React shows alerts immediately
    # rather than waiting for end-of-shift sync.
    live_theft: list = []
    bottles = summary.get("bottles", {})
    for ev in bottles.get("walk_out_details", []):
        live_theft.append({"type": "walk_out", "t_sec": ev.get("t_sec") or ev.get("last_seen_t", 0), "detail": ev.get("reason", "")})
    for ev in bottles.get("unknown_bottle_details", []):
        live_theft.append({"type": "unknown_bottle", "t_sec": ev.get("t_sec", 0), "detail": ev.get("reason", "")})
    for ev in bottles.get("pour_events", []):
        if ev.get("is_over_pour"):
            live_theft.append({"type": "over_pour", "t_sec": ev.get("t_sec", 0),
                                "oz": ev.get("estimated_oz"), "std": ev.get("standard_oz")})
    # Sort by time, keep last 20
    live_theft.sort(key=lambda e: e.get("t_sec", 0))
    live_theft = live_theft[-20:]
    if live_theft:
        update_expr += ", liveTheftEvents = :lte"
        expr_vals[":lte"] = {"S": json.dumps(live_theft)}

    # ── Shrinkage estimate (oz poured - oz expected from drink count) ──────────
    pours_detected = len(bottles.get("pour_events", []))
    total_poured_oz = float(bottles.get("total_poured_oz", 0.0))
    expected_oz = total_drinks * 1.25  # standard spirit pour baseline
    shrinkage_oz = round(max(0.0, total_poured_oz - expected_oz), 2)
    if total_poured_oz > 0:
        update_expr += ", shrinkageOz = :soz, pourCount = :pc"
        expr_vals[":soz"] = {"N": str(shrinkage_oz)}
        expr_vals[":pc"]  = {"N": str(pours_detected)}

    # Include per-bartender breakdown if available
    if bts:
        bt_compact = {}
        for name, d in bts.items():
            ts   = d.get("drink_timestamps", [])[-50:]
            scrs = d.get("drink_scores", [])
            if len(scrs) > len(ts):
                scrs = scrs[-len(ts):]
            elif len(scrs) < len(ts):
                scrs = [0.0] * (len(ts) - len(scrs)) + scrs
            bt_compact[name] = {
                "drinks":        int(d.get("total_drinks", 0)),
                "per_hour":      round(float(d.get("drinks_per_hour", 0.0)), 1),
                # Wall-clock offsets from createdAt (= _wall_start).
                # Divide by delivery_rate to convert NVR t_sec → real elapsed seconds.
                "timestamps":    [round(t / delivery_rate, 1) for t in ts],
                # Confidence scores parallel to timestamps
                "drink_scores":  [round(s, 3) for s in scrs],
                # Hourly breakdown so dashboard can show "drinks per hour" curve
                "hourly_counts": {str(k): int(v) for k, v in d.get("hourly_counts", {}).items()},
            }
        bt_json = json.dumps(bt_compact)
        update_expr += ", bartenderSummary = :bs, bartenderBreakdown = :bd"
        expr_vals[":bs"] = {"S": bt_json}
        expr_vals[":bd"] = {"S": bt_json}

    # Push serve snapshot S3 keys so React shows frame thumbnails in the live drink log.
    # Keys are t_sec values — scale by delivery_rate so they match scaled timestamps.
    serve_snaps = summary.get("serve_snapshots", {})
    if serve_snaps:
        update_expr += ", serveSnapshots = :snaps"
        expr_vals[":snaps"] = {"S": json.dumps(
            {str(round(float(k) / delivery_rate, 1)): v for k, v in serve_snaps.items()}
        )}

    # Push low-confidence review events so React can show the "low confidence" log section
    # t_sec scaled by delivery_rate (React: wallTime = createdAt + tSec)
    review_evs = summary.get("review_events", [])
    if review_evs:
        update_expr += ", reviewEvents = :re"
        expr_vals[":re"] = {"S": json.dumps([
            {"t_sec": round(e["t_sec"] / delivery_rate, 1), "score": round(e["serve_score"], 3),
             "station_id": e.get("station_id", ""), "reason": e.get("review_reason", "")}
            for e in review_evs[-50:]
        ])}

    # Push per-zone drink counts + serve positions for zone breakdown UI
    _dq = summary.get("drink_quality", {})
    zone_drinks = _dq.get("zone_drinks", {})
    zone_events = _dq.get("zone_events", {})
    if zone_drinks:
        update_expr += ", zoneBreakdown = :zb"
        expr_vals[":zb"] = {"S": json.dumps({
            z: {
                "drinks": cnt,
                "label":  z,   # React can override with config label
                "events": zone_events.get(z, [])[-50:],  # last 50 serve positions
            }
            for z, cnt in zone_drinks.items()
        })}

    # Include table visits by staff + live occupancy for live dashboard
    tables_data = summary.get("tables", {})
    if tables_data:
        live_visits: Dict[str, Dict[str, int]] = {}
        live_occupancy: Dict[str, Any] = {}
        for tid, tdata in tables_data.items():
            attr = tdata.get("staff_attribution", {})
            if attr:
                live_visits[tid] = {str(k): v for k, v in attr.items()}
            live_occupancy[tid] = {
                "label":              tdata.get("label", tid),
                "currently_occupied": tdata.get("currently_occupied", False),
                "turn_count":         tdata.get("turn_count", 0),
                "avg_dwell_min":      tdata.get("avg_dwell_min", 0),
                "avg_response_sec":   tdata.get("avg_response_sec"),
            }
        if live_visits:
            update_expr += ", tableVisitsByStaff = :tvs"
            expr_vals[":tvs"] = {"S": json.dumps(live_visits)}
        update_expr += ", liveTableOccupancy = :lto"
        expr_vals[":lto"] = {"S": json.dumps(live_occupancy)}
        total_turns_live = sum(d.get("turn_count", 0) for d in tables_data.values())
        update_expr += ", totalTurns = :tt"
        expr_vals[":tt"] = {"N": str(total_turns_live)}
        dwells_live = [d.get("avg_dwell_min", 0) for d in tables_data.values() if d.get("avg_dwell_min")]
        if dwells_live:
            update_expr += ", avgDwellMin = :adm"
            expr_vals[":adm"] = {"N": str(round(sum(dwells_live) / len(dwells_live), 1))}
        resps_live = [d.get("avg_response_sec") for d in tables_data.values() if d.get("avg_response_sec") is not None]
        if resps_live:
            update_expr += ", avgResponseSec = :ars"
            expr_vals[":ars"] = {"N": str(round(sum(resps_live) / len(resps_live), 1))}

    # table_service mode live leaderboard
    svc_leaderboard = summary.get("tableVisitsByStaff", [])
    if svc_leaderboard and isinstance(svc_leaderboard, list):
        update_expr += ", tableVisitsByStaff = :tvs2"
        expr_vals[":tvs2"] = {"S": json.dumps(svc_leaderboard)}

    ddb_key = _ddb_sort_key(job_id)
    try:
        ddb = _get_client("dynamodb")
        _retry(lambda: ddb.update_item(
            TableName=DYNAMODB_TABLE,
            Key={"venueId": {"S": venue_id}, "jobId": {"S": ddb_key}},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_vals,
        ))
    except Exception as e:
        print(f"[aws_sync] Live metrics push failed: {e}", flush=True)
        return False

    # Also upsert the stable per-camera record (~{camera_id}) so the React
    # camera grid always has a current "live status" row for each camera.
    # This is the record the VenueScope tab deduplicates on (isGhost check).
    camera_id = summary.get("camera_id", "")
    if camera_id and venue_id:
        stable_key = f"~{camera_id}"
        # For the stable camera record, ALWAYS overwrite createdAt to the current
        # job start so React formula (wallTime = createdAt + t_sec) gives correct
        # local times. With if_not_exists the stable record would keep the first-ever
        # job start time, making t_sec offsets from the current job compute wall times
        # on the wrong day — React only shows time not date, so this surfaces as
        # drinks appearing 1-2+ hours off from reality.
        stable_update_expr = update_expr.replace(
            "createdAt = if_not_exists(createdAt, :ca)",
            "createdAt = :ca"
        )
        try:
            _retry(lambda: ddb.update_item(
                TableName=DYNAMODB_TABLE,
                Key={"venueId": {"S": venue_id}, "jobId": {"S": stable_key}},
                UpdateExpression=stable_update_expr,
                ExpressionAttributeNames=dict(expr_names),
                ExpressionAttributeValues=dict(expr_vals),
            ))
        except Exception as _se:
            print(f"[aws_sync] Stable camera record upsert failed: {_se}", flush=True)

    return True


def get_camera_shift_totals(camera_id: str, venue_id: str = "") -> Dict[str, Any]:
    """
    Read the stable per-camera DDB record (~{camera_id}) and return the
    current shift totals. Called at job start so the worker initialises
    drink counts from DDB rather than from local disk — DDB is the source
    of truth and survives worker restarts, crashes, and redeployments.

    Returns dict with keys:
      total_drinks      int
      bartender_summary dict   {name: {drinks, timestamps, ...}}
      created_at        float  unix epoch of the shift start (createdAt field)
      shift_date        str    ISO date of createdAt, or today if missing
    Returns empty dict if not configured or camera record not found.
    """
    if not _is_configured():
        return {}
    venue_id = venue_id or _get_venue_id()
    if not venue_id or not camera_id:
        return {}
    try:
        import datetime
        ddb      = _get_client("dynamodb")
        resp     = ddb.get_item(
            TableName=DYNAMODB_TABLE,
            Key={"venueId": {"S": venue_id}, "jobId": {"S": f"~{camera_id}"}},
        )
        item = resp.get("Item", {})
        if not item:
            return {}

        total_drinks = int(item.get("totalDrinks", {}).get("N", 0))
        created_at   = float(item.get("createdAt", {}).get("N", 0))
        shift_date   = (datetime.datetime.utcfromtimestamp(created_at).date().isoformat()
                        if created_at else datetime.date.today().isoformat())

        bt_summary = {}
        bt_json = (item.get("bartenderBreakdown") or item.get("bartenderSummary") or {})
        if isinstance(bt_json, dict):
            raw = bt_json.get("S", "")
        else:
            raw = ""
        if raw:
            try:
                bt_summary = json.loads(raw)
            except Exception:
                pass

        return {
            "total_drinks":      total_drinks,
            "bartender_summary": bt_summary,
            "created_at":        created_at,
            "shift_date":        shift_date,
        }
    except Exception as e:
        print(f"[aws_sync] get_camera_shift_totals failed (non-fatal): {e}", flush=True)
        return {}


def reset_camera_shift(camera_id: str, venue_id: str = "") -> bool:
    """
    Clear the stable per-camera DDB record (~{camera_id}) drink counts for a
    new shift/day. Called at job start when the stored createdAt date != today.
    This ensures the React dashboard shows 0 immediately when a new shift begins
    instead of displaying stale totals from the previous day until the first push.
    """
    if not _is_configured():
        return False
    venue_id = venue_id or _get_venue_id()
    if not venue_id or not camera_id:
        return False
    try:
        import datetime
        today = datetime.date.today().isoformat()
        ddb = _get_client("dynamodb")
        _retry(lambda: ddb.update_item(
            TableName=DYNAMODB_TABLE,
            Key={"venueId": {"S": venue_id}, "jobId": {"S": f"~{camera_id}"}},
            UpdateExpression=(
                "SET totalDrinks = :z, bartenderSummary = :bs, "
                "bartenderBreakdown = :bd, serveSnapshots = :ss, shiftDate = :sd "
                "REMOVE reviewEvents, liveTheftEvents, zoneBreakdown"
            ),
            ExpressionAttributeValues={
                ":z":  {"N": "0"},
                ":bs": {"S": "{}"},
                ":bd": {"S": "{}"},
                ":ss": {"S": "{}"},
                ":sd": {"S": today},
            },
        ))
        print(f"[aws_sync] Shift reset for camera {camera_id} (new day: {today})", flush=True)
        return True
    except Exception as e:
        print(f"[aws_sync] reset_camera_shift failed (non-fatal): {e}", flush=True)
        return False


def sync_job_to_aws(job_id: str, summary: Dict[str, Any], result_dir: Path,
                    venue_id: str = "") -> bool:
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

    venue_id  = venue_id or _get_venue_id()
    has_theft = bool(summary.get("has_theft_flag"))

    # Always upload full summary JSON to S3 for web app detail view
    summary_s3_key = _upload_summary_to_s3(summary, job_id, venue_id)

    # Upload flagged clip to S3
    clip_s3_key = None
    if has_theft:
        clip_s3_key = _upload_clip_to_s3(Path(result_dir), job_id, venue_id)

    # Active modes (primary + any extras run in same pass)
    active_modes = summary.get("modes", [summary.get("analysis_mode", "drink_count")])

    created_at = summary.get("created_at", time.time())
    ddb_key    = _ddb_sort_key(job_id, created_at)

    # Live camera jobs (continuous RTSP streams) keep status=running + isLive=true so
    # the React dashboard never shows a disconnect during the ~60s restart gap between
    # segments. The new segment's sync_partial_to_aws overwrites this within seconds.
    is_live_cam = "🔴 LIVE" in summary.get("clip_label", "")
    now_ts = str(time.time())

    item: Dict[str, Any] = {
        "venueId":         {"S": venue_id},
        "jobId":           {"S": ddb_key},
        "internalJobId":   {"S": job_id},   # original UUID for reference
        "status":          {"S": "running" if is_live_cam else "done"},
        "isLive":          {"BOOL": is_live_cam},
        "updatedAt":       {"N": now_ts},
        "createdAt":       {"N": str(created_at)},
        "analysisMode":    {"S": summary.get("analysis_mode") or summary.get("mode", "drink_count")},
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
    if not is_live_cam:
        item["finishedAt"] = {"N": now_ts}

    if clip_s3_key:
        item["s3ClipKey"] = {"S": clip_s3_key}

    if summary_s3_key:
        item["summaryS3Key"] = {"S": summary_s3_key}

    # ── Per-station bartender breakdown ────────────────────────────────────────
    # React reads bartenderBreakdown as JSON: {name: {drinks, per_hour, timestamps}}
    bts = summary.get("bartenders", {})
    if bts:
        bt_breakdown = {}
        for name, d in bts.items():
            ts   = d.get("drink_timestamps", [])[-50:]
            scrs = d.get("drink_scores", [])
            # Align scores with timestamps (pad with 0 if missing)
            if len(scrs) > len(ts):
                scrs = scrs[-len(ts):]
            elif len(scrs) < len(ts):
                scrs = [0.0] * (len(ts) - len(scrs)) + scrs
            bt_breakdown[name] = {
                "drinks":        int(d.get("total_drinks", 0)),
                "per_hour":      round(float(d.get("drinks_per_hour", 0.0)), 1),
                # Video-relative t_sec (React: wallTime = createdAt + tSec)
                "timestamps":    [round(t, 1) for t in ts],
                # Confidence scores (0.0–1.0) parallel to timestamps
                "drink_scores":  [round(s, 3) for s in scrs],
                # Hourly breakdown so dashboard can show "drinks per hour" curve per bartender
                "hourly_counts": {str(k): int(v) for k, v in d.get("hourly_counts", {}).items()},
            }
        # Enrich bartenderBreakdown with oz/over-pours from correlator
        corr_by_bar = summary.get("drink_correlation", {}).get("by_bartender", {})
        for name, bar_data in corr_by_bar.items():
            if name in bt_breakdown:
                bt_breakdown[name]["over_pours"]  = bar_data.get("over_pours", 0)
                bt_breakdown[name]["total_oz"]    = round(bar_data.get("total_oz", 0.0), 2)
                bt_breakdown[name]["drink_types"] = dict(bar_data.get("drink_types", {}))
        item["bartenderBreakdown"] = {"S": json.dumps(bt_breakdown)}

    # ── Low-confidence (review bucket) events ─────────────────────────────────
    review_evs = summary.get("review_events", [])
    if review_evs:
        item["reviewEvents"] = {"S": json.dumps([
            {"t_sec": round(e["t_sec"], 1), "score": round(e["serve_score"], 3),
             "station_id": e.get("station_id", ""), "reason": e.get("review_reason", "")}
            for e in review_evs[-50:]
        ])}

    # ── Zone breakdown — drinks per zone with serve positions for retroactive re-zoning ──
    _dq = summary.get("drink_quality", {})
    _zone_drinks = _dq.get("zone_drinks", {})
    _zone_events = _dq.get("zone_events", {})
    if _zone_drinks:
        item["zoneBreakdown"] = {"S": json.dumps({
            z: {
                "drinks": cnt,
                "label":  z,
                "events": _zone_events.get(z, [])[-50:],
            }
            for z, cnt in _zone_drinks.items()
        })}

    # ── Drink type breakdown (correlator) ──────────────────────────────────────
    corr = summary.get("drink_correlation", {})
    if corr and (corr.get("correlated", 0) > 0 or corr.get("over_pours", 0) > 0):
        item["drinkTypeBreakdown"] = {"S": json.dumps({
            "drink_types": dict(corr.get("drink_types", {})),
            "total_oz":    round(float(corr.get("total_oz", 0.0)), 2),
            "avg_oz":      round(float(corr.get("avg_oz", 0.0)), 2),
            "over_pours":  int(corr.get("over_pours", 0)),
        })}

    # Prefer explicit camera_id for deduplication — unique per camera, no collision.
    # Fall back to camera_label or derive from clip_label (strip seg/LIVE suffix).
    camera = summary.get("camera_id") or summary.get("camera_label") or ""
    if not camera:
        clip = summary.get("clip_label", "")
        if clip.startswith("📡 "):
            raw = clip[len("📡 "):]
            for _sfx in (" — 🔴 LIVE", " — seg "):
                if _sfx in raw:
                    raw = raw[:raw.index(_sfx)]
            camera = raw.strip()
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
        by_class = bottles.get("by_class", {})
        if by_class:
            item["bottleByClass"] = {"S": json.dumps({k: int(v) for k, v in by_class.items()})}
        avg_oz = bottles.get("avg_pour_oz", 0.0)
        if avg_oz:
            item["avgPourOz"] = {"N": str(round(float(avg_oz), 2))}
        if bottles.get("walk_out_alerts", 0) > 0 or bottles.get("unknown_bottle_alerts", 0) > 0:
            item["hasTheftFlag"] = {"BOOL": True}   # escalate flag if bottle theft detected

    # ── People count metrics ───────────────────────────────────────────────────
    people = summary.get("people", {})
    if people:
        item["totalEntries"]   = {"N": str(int(people.get("total_entries", 0)))}
        item["totalExits"]     = {"N": str(int(people.get("total_exits", 0)))}
        item["peakOccupancy"]  = {"N": str(int(people.get("peak_occupancy", 0)))}
        unique = people.get("unique_tracks_seen", 0)
        if unique > 0:
            item["uniqueTracked"] = {"N": str(int(unique))}

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
        # Per-table detail for UI breakdown
        table_detail = {
            tid: {
                "label":              tdata.get("label", tid),
                "turn_count":         tdata.get("turn_count", 0),
                "avg_dwell_min":      tdata.get("avg_dwell_min", 0),
                "min_dwell_min":      tdata.get("min_dwell_min", 0),
                "max_dwell_min":      tdata.get("max_dwell_min", 0),
                "avg_response_sec":   tdata.get("avg_response_sec"),
                "staff_attribution":  tdata.get("staff_attribution", {}),
                "currently_occupied": tdata.get("currently_occupied", False),
            }
            for tid, tdata in tables.items()
        }
        item["tableDetail"] = {"S": json.dumps(table_detail)}

    # ── Staff activity metrics ─────────────────────────────────────────────────
    staff = summary.get("staff", {})
    if staff:
        item["uniqueStaff"]  = {"N": str(int(staff.get("total_unique_staff", 0)))}
        item["peakHeadcount"]= {"N": str(int(staff.get("peak_headcount", 0)))}
        item["avgIdlePct"]   = {"N": str(float(staff.get("avg_idle_pct", 0.0)))}
        staff_details = staff.get("staff_details", [])
        if staff_details:
            item["staffDetail"] = {"S": json.dumps({"staff_details": staff_details})}

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

    # ── Table visits by staff (table_turns mode) ──────────────────────────────
    tables = summary.get("tables", {})
    if tables:
        visits_by_staff: Dict[str, Dict[str, int]] = {}
        for tid, tdata in tables.items():
            attr = tdata.get("staff_attribution", {})
            if attr:
                visits_by_staff[tid] = {str(k): v for k, v in attr.items()}
        if visits_by_staff:
            item["tableVisitsByStaff"] = {"S": json.dumps(visits_by_staff)}

    # ── Table service tracker (table_service mode) ────────────────────────────
    svc = summary.get("table_service", {})
    if svc:
        leaderboard = summary.get("tableVisitsByStaff", [])
        if leaderboard:
            item["tableVisitsByStaff"] = {"S": json.dumps(leaderboard)}
        # Per-table visit counts
        per_table = {tid: v for tid, v in svc.items() if tid != "__leaderboard__"}
        if per_table:
            item["tableServiceDetail"] = {"S": json.dumps(per_table)}

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

    # Keep the stable per-camera record (~{camera_id}) current so the React
    # camera grid always reflects the latest state even between segments.
    # For LIVE cameras: set status=running so the grid shows the camera as live.
    # For segmented cameras: set status=done so history reflects the last result.
    _cam_id = summary.get("camera_id", "")
    if _cam_id and venue_id:
        _stable_key = f"~{_cam_id}"
        _stable_item = dict(item)
        _stable_item["jobId"] = {"S": _stable_key}
        # LIVE cameras should always appear running in the camera grid
        if is_live_cam:
            _stable_item["status"] = {"S": "running"}
            _stable_item["isLive"] = {"BOOL": True}
        else:
            # Segmented cameras: keep running so the camera grid doesn't flicker
            # between segments; it will go to done if the camera is disabled.
            _stable_item["status"] = {"S": "running"}
            _stable_item["isLive"] = {"BOOL": True}
            _stable_item["lastSegmentAt"] = {"N": now_ts}
        try:
            _retry(lambda: ddb.put_item(TableName=DYNAMODB_TABLE, Item=_stable_item))
        except Exception as _se:
            print(f"[aws_sync] Stable camera record sync failed: {_se}", flush=True)

    # ── Bartender profile sync ─────────────────────────────────────────────────
    try:
        from core.profiles.bartender_profile_sync import sync_bartender_profiles
        if summary.get("bartenders"):
            sync_bartender_profiles(venue_id, job_id, summary)
    except Exception as e:
        print(f"[aws_sync] Bartender profile sync failed (non-fatal): {e}", flush=True)

    return True
