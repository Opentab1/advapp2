"""
VenueScope — Webhook server (port 8502).
Handles Stripe events, venue Tailscale callbacks, and bar calibration.
"""
import os, sys, json, logging, tempfile, threading, uuid, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Load .env
env_file = Path(__file__).resolve().parent / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from core.billing import handle_webhook

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("webhook")

PORT         = int(os.environ.get("WEBHOOK_PORT", 8502))
ALERT_EMAIL  = os.environ.get("ALERT_EMAIL_TO", "steph@advizia.ai")
AWS_REGION   = os.environ.get("AWS_REGION", "us-east-2")

# CORS origin allowed for calibration API calls from advapp2
CORS_ORIGIN  = os.environ.get("CALIBRATION_CORS_ORIGIN", "*")

# ── Ops API secret ────────────────────────────────────────────────────────────
# Set OPS_SECRET in .env and VITE_OPS_SECRET in Amplify to the same value.
# Requests to /ops/* must include header: X-Ops-Secret: <value>
OPS_SECRET   = os.environ.get("OPS_SECRET", "")
DROPLET_DIR  = os.environ.get("VENUESCOPE_DEPLOY_DIR", "/opt/venuescope")

# ── Calibration job store (in-memory, survives the session) ───────────────────
# { job_id: {"status": "running"|"done"|"failed", "progress": 0-100,
#             "message": str, "result": dict|None, "error": str|None} }
_calib_jobs: dict = {}
_calib_lock  = threading.Lock()


def _set_job(job_id: str, **kwargs):
    with _calib_lock:
        if job_id not in _calib_jobs:
            _calib_jobs[job_id] = {}
        _calib_jobs[job_id].update(kwargs)


def _get_job(job_id: str) -> dict:
    with _calib_lock:
        return dict(_calib_jobs.get(job_id, {}))


def _run_calibration_bg(job_id: str, video_path: str, actual_count: int,
                        venue_id: str, camera_id: str):
    """Background thread: run CalibrationEngine and update job store."""
    try:
        from calibrate import CalibrationEngine

        def _cb(pct, msg):
            _set_job(job_id, progress=round(pct, 1), message=msg)
            log.info("Calibration %s [%.0f%%] %s", job_id, pct, msg)

        engine = CalibrationEngine(
            video_path   = video_path,
            actual_count = actual_count,
            venue_id     = venue_id,
            camera_id    = camera_id,
            progress_cb  = _cb,
        )
        result = engine.run()
        _set_job(job_id, status="done", progress=100, message="Done.", result=result)
        log.info("Calibration %s complete — best y=%.2f acc=%.1f%%",
                 job_id,
                 result.get("best", {}).get("y_position", 0),
                 result.get("best", {}).get("accuracy_pct", 0))
    except Exception as exc:
        log.exception("Calibration %s failed", job_id)
        _set_job(job_id, status="failed", progress=0, message="Failed.", error=str(exc))
    finally:
        # Clean up temp video after 10 minutes
        def _cleanup():
            time.sleep(600)
            try:
                Path(video_path).unlink(missing_ok=True)
            except Exception:
                pass
        threading.Thread(target=_cleanup, daemon=True).start()


# ── Email helper ─────────────────────────────────────────────────────────────

def send_email(subject: str, body: str):
    """Send via AWS SES."""
    try:
        import boto3
        client = boto3.client("ses", region_name=AWS_REGION)
        client.send_email(
            Source=ALERT_EMAIL,
            Destination={"ToAddresses": [ALERT_EMAIL]},
            Message={
                "Subject": {"Data": subject},
                "Body":    {"Text": {"Data": body}},
            },
        )
        log.info("Email sent: %s", subject)
    except Exception as e:
        log.error("Email failed: %s", e)


def handle_venue_connected(ip: str, hostname: str, venue: str):
    """Called when a venue's Tailscale setup script phones home."""
    log_file = Path(__file__).resolve().parent / "data" / "configs" / "tailscale_connections.json"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        connections = json.loads(log_file.read_text()) if log_file.exists() else []
    except Exception:
        connections = []

    entry = {
        "ip":       ip,
        "hostname": hostname,
        "venue":    venue or hostname,
        "time":     time.time(),
    }
    connections.append(entry)
    log_file.write_text(json.dumps(connections, indent=2))
    log.info("Venue connected: %s @ %s", hostname, ip)

    import datetime
    ts = datetime.datetime.now().strftime("%b %d %Y at %I:%M %p")
    send_email(
        subject=f"VenueScope — New venue connected: {venue or hostname}",
        body=(
            f"A venue just connected their camera network to VenueScope.\n\n"
            f"Venue:        {venue or hostname}\n"
            f"Tailscale IP: {ip}\n"
            f"Connected at: {ts}\n\n"
            f"Next step: add their cameras in the VenueScope dashboard.\n"
            f"Use {ip} as the IP in their RTSP URLs.\n\n"
            f"Dashboard: https://137-184-61-178.sslip.io"
        ),
    )


# ── Request handler ───────────────────────────────────────────────────────────

class WebhookHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        log.info(fmt % args)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin",  CORS_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Ops-Secret")

    def _json(self, code: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        """Pre-flight CORS."""
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _ops_auth(self) -> bool:
        """Return True if the ops secret header is valid (or no secret is configured)."""
        if not OPS_SECRET:
            return False  # No secret = ops API is disabled until configured
        return self.headers.get("X-Ops-Secret", "") == OPS_SECRET

    def do_GET(self):
        parsed = urlparse(self.path)

        # ── Ops API ───────────────────────────────────────────────────────────
        if parsed.path.startswith("/ops/"):
            if not self._ops_auth():
                self._json(401, {"error": "X-Ops-Secret header missing or invalid"})
                return
            if parsed.path == "/ops/status":
                self._handle_ops_status()
            elif parsed.path == "/ops/logs":
                params = parse_qs(parsed.query)
                lines  = int(params.get("lines", ["150"])[0])
                filt   = params.get("filter", [""])[0]
                self._handle_ops_logs(lines, filt)
            else:
                self._json(404, {"error": "unknown ops route"})
            return

        # Venue Tailscale callback
        if parsed.path == "/venue-connected":
            params   = parse_qs(parsed.query)
            ip       = params.get("ip",       ["unknown"])[0]
            hostname = params.get("hostname", ["unknown"])[0]
            venue    = params.get("venue",    [""])[0]
            handle_venue_connected(ip, hostname, venue)
            self.send_response(200)
            self._cors()
            self.end_headers()
            self.wfile.write(b"ok")
            return

        # Calibration status poll: GET /calibrate/status?job_id=...
        if parsed.path == "/calibrate/status":
            params = parse_qs(parsed.query)
            job_id = params.get("job_id", [""])[0]
            if not job_id:
                self._json(400, {"error": "job_id required"})
                return
            job = _get_job(job_id)
            if not job:
                self._json(404, {"error": "job not found"})
                return
            self._json(200, job)
            return

        # Config history: GET /calibrate/history?venue_id=X&camera_id=Y
        if parsed.path == "/calibrate/history":
            params    = parse_qs(parsed.query)
            venue_id  = params.get("venue_id",  [""])[0]
            camera_id = params.get("camera_id", [""])[0]
            if not venue_id or not camera_id:
                self._json(400, {"error": "venue_id and camera_id required"})
                return
            try:
                import boto3, os as _os
                _region = _os.environ.get("AWS_DEFAULT_REGION") or _os.environ.get("AWS_REGION", "us-east-2")
                _ddb    = boto3.resource("dynamodb", region_name=_region)
                _table  = _ddb.Table("VenueScopeCameras")
                resp    = _table.get_item(Key={"venueId": venue_id, "cameraId": camera_id})
                item    = resp.get("Item", {})
                history_json = item.get("barConfigHistory", "[]")
                history      = json.loads(history_json) if history_json else []
                # Strip config_json from list view — only return metadata
                preview = [{k: v for k, v in e.items() if k != "config_json"}
                           for e in history]
                self._json(200, {"history": preview, "count": len(preview)})
            except Exception as e:
                self._json(500, {"error": str(e)})
            return

        self.send_response(200)
        self._cors()
        self.end_headers()
        self.wfile.write(b"VenueScope webhook OK")

    def do_POST(self):
        parsed = urlparse(self.path)

        # ── Ops API ───────────────────────────────────────────────────────────
        if parsed.path.startswith("/ops/"):
            if not self._ops_auth():
                self._json(401, {"error": "X-Ops-Secret header missing or invalid"})
                return
            if parsed.path == "/ops/restart":
                self._handle_ops_restart()
            elif parsed.path == "/ops/deploy":
                self._handle_ops_deploy()
            else:
                self._json(404, {"error": "unknown ops route"})
            return

        # ── Calibration start ────────────────────────────────────────────────
        if parsed.path == "/calibrate":
            self._handle_calibrate()
            return

        # ── Restore previous config ───────────────────────────────────────────
        if parsed.path == "/calibrate/restore":
            self._handle_restore()
            return

        # ── Stripe webhook ───────────────────────────────────────────────────
        if parsed.path != "/webhook":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return

        length  = int(self.headers.get("Content-Length", 0))
        payload = self.rfile.read(length)
        sig     = self.headers.get("Stripe-Signature", "")

        try:
            etype = handle_webhook(payload, sig)
            log.info("Stripe event: %s", etype)
            self._json(200, {"received": True})
        except Exception as e:
            log.error("Webhook error: %s", e)
            self._json(400, {"error": str(e)})

    def _handle_calibrate(self):
        """
        POST /calibrate  (multipart/form-data)
        Fields:
          video        — video file (mp4, avi, mov)
          actual_count — integer, number of drinks actually served
          venue_id     — string, venue identifier (used for bar_main.json filename)
        Returns: {"job_id": "..."}
        """
        import cgi, io

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self._json(400, {"error": "Expected multipart/form-data"})
            return

        length = int(self.headers.get("Content-Length", 0))
        if length > 500 * 1024 * 1024:  # 500 MB limit
            self._json(413, {"error": "File too large (max 500 MB)"})
            return

        body = self.rfile.read(length)
        environ = {
            "REQUEST_METHOD":  "POST",
            "CONTENT_TYPE":    content_type,
            "CONTENT_LENGTH":  str(length),
        }
        form = cgi.FieldStorage(
            fp      = io.BytesIO(body),
            headers = self.headers,
            environ = environ,
        )

        # Extract fields
        venue_id     = (form.getvalue("venue_id")  or "").strip()
        camera_id    = (form.getvalue("camera_id") or "").strip()
        actual_count = int(form.getvalue("actual_count") or "0")
        video_item   = form["video"] if "video" in form else None

        if not venue_id:
            self._json(400, {"error": "venue_id required"})
            return
        if not camera_id:
            self._json(400, {"error": "camera_id required"})
            return
        if actual_count < 1:
            self._json(400, {"error": "actual_count must be >= 1"})
            return
        if video_item is None or not hasattr(video_item, "file"):
            self._json(400, {"error": "video file required"})
            return

        # Save video to temp file
        suffix = Path(getattr(video_item, "filename", "video.mp4") or "video.mp4").suffix or ".mp4"
        tmp    = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        tmp.write(video_item.file.read())
        tmp.close()
        video_path = tmp.name
        log.info("Calibration upload saved: %s (%d bytes) venue=%s camera=%s",
                 video_path, Path(video_path).stat().st_size, venue_id, camera_id)

        job_id = str(uuid.uuid4())[:8]
        _set_job(job_id,
                 status    = "running",
                 progress  = 0,
                 message   = "Queued…",
                 result    = None,
                 error     = None,
                 venue_id  = venue_id,
                 camera_id = camera_id,
                 started   = time.time())

        t = threading.Thread(
            target  = _run_calibration_bg,
            args    = (job_id, video_path, actual_count, venue_id, camera_id),
            daemon  = True,
        )
        t.start()

        self._json(200, {"job_id": job_id})

    def _handle_restore(self):
        """
        POST /calibrate/restore  (JSON body)
        { "venue_id": "...", "camera_id": "...", "history_index": 0 }

        Restores the config at history[history_index] as the live barConfigJson.
        The current live config is snapshotted back into history first so
        nothing is ever permanently lost.
        """
        import datetime as _dt
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            self._json(400, {"error": "Invalid JSON body"})
            return

        venue_id      = (body.get("venue_id")  or "").strip()
        camera_id     = (body.get("camera_id") or "").strip()
        history_index = int(body.get("history_index", 0))

        if not venue_id or not camera_id:
            self._json(400, {"error": "venue_id and camera_id required"})
            return

        try:
            import boto3, os as _os
            _region = _os.environ.get("AWS_DEFAULT_REGION") or _os.environ.get("AWS_REGION", "us-east-2")
            _ddb    = boto3.resource("dynamodb", region_name=_region)
            _table  = _ddb.Table("VenueScopeCameras")

            # Fetch current record
            resp    = _table.get_item(Key={"venueId": venue_id, "cameraId": camera_id})
            item    = resp.get("Item", {})
            history = json.loads(item.get("barConfigHistory", "[]") or "[]")

            if history_index < 0 or history_index >= len(history):
                self._json(400, {"error": f"history_index {history_index} out of range (0–{len(history)-1})"})
                return

            target_entry    = history[history_index]
            restore_json    = target_entry.get("config_json", "")
            current_json    = item.get("barConfigJson", "")

            if not restore_json:
                self._json(400, {"error": "History entry has no config_json"})
                return

            # Snapshot current live config into history before overwriting
            if current_json:
                try:
                    cur_cfg  = json.loads(current_json)
                    cur_st   = (cur_cfg.get("stations") or [{}])[0]
                    cur_y    = (cur_st.get("bar_line_p1") or [0, 0])[1]
                    cur_side = cur_st.get("customer_side", 0)
                    cur_note = cur_cfg.get("notes", "")
                except Exception:
                    cur_y = 0; cur_side = 0; cur_note = "Unknown"

                history.insert(0, {
                    "ts":            _dt.datetime.utcnow().isoformat(),
                    "label":         cur_note or f"y={cur_y:.2f}",
                    "y_position":    round(cur_y, 2),
                    "customer_side": cur_side,
                    "config_json":   current_json,
                    "source":        "pre-restore snapshot",
                })
                # Remove the entry we're restoring (was at history_index, now shifted by +1)
                del history[history_index + 1]
                history = history[:20]
            else:
                del history[history_index]

            _table.update_item(
                Key={"venueId": venue_id, "cameraId": camera_id},
                UpdateExpression="SET barConfigJson = :cfg, barConfigHistory = :hist",
                ExpressionAttributeValues={
                    ":cfg":  restore_json,
                    ":hist": json.dumps(history),
                },
            )
            log.info("Config restored: venue=%s camera=%s index=%d", venue_id, camera_id, history_index)
            self._json(200, {"ok": True, "restored": target_entry.get("label", "")})
        except Exception as e:
            log.exception("Restore failed")
            self._json(500, {"error": str(e)})


    # ── Ops handlers ──────────────────────────────────────────────────────────

    def _handle_ops_status(self):
        """GET /ops/status — droplet health + worker status + live jobs."""
        import subprocess, shutil

        # CPU — two /proc/stat reads 300ms apart for a meaningful sample
        def _cpu():
            try:
                def _read():
                    with open("/proc/stat") as f:
                        parts = list(map(int, f.readline().split()[1:8]))
                    idle  = parts[3] + parts[4]
                    total = sum(parts)
                    return idle, total
                i1, t1 = _read()
                time.sleep(0.3)
                i2, t2 = _read()
                dt = t2 - t1 or 1
                return round(100 * (1 - (i2 - i1) / dt), 1)
            except Exception:
                return -1

        def _ram():
            try:
                mem = {}
                with open("/proc/meminfo") as f:
                    for line in f:
                        k, v = line.split(":", 1)
                        mem[k.strip()] = int(v.split()[0])
                total = mem["MemTotal"] // 1024
                avail = mem["MemAvailable"] // 1024
                used  = total - avail
                return used, total, round(100 * used / max(total, 1), 1)
            except Exception:
                return -1, -1, -1

        def _disk():
            try:
                s = shutil.disk_usage("/")
                return round(s.used / 1e9, 1), round(s.total / 1e9, 1), round(100 * s.used / max(s.total, 1), 1)
            except Exception:
                return -1, -1, -1

        def _worker_status():
            try:
                r = subprocess.run(
                    ["systemctl", "is-active", "venuescope-worker"],
                    capture_output=True, text=True, timeout=5,
                )
                status = r.stdout.strip()
                r2 = subprocess.run(
                    ["systemctl", "show", "venuescope-worker",
                     "--property=ActiveEnterTimestamp,MainPID"],
                    capture_output=True, text=True, timeout=5,
                )
                props = {}
                for line in r2.stdout.splitlines():
                    if "=" in line:
                        k, v = line.split("=", 1)
                        props[k] = v
                return {
                    "status":    status,
                    "startedAt": props.get("ActiveEnterTimestamp", ""),
                    "pid":       props.get("MainPID", ""),
                }
            except Exception as e:
                return {"status": "unknown", "startedAt": "", "pid": "", "error": str(e)}

        def _live_jobs():
            try:
                import boto3, os as _os
                _r = _os.environ.get("AWS_DEFAULT_REGION") or _os.environ.get("AWS_REGION", "us-east-2")
                c  = boto3.client("dynamodb", region_name=_r)
                # Only truly live jobs: isLive=True AND updated in last 5 minutes
                recent_cutoff = str(int(time.time()) - 300)
                resp = c.scan(
                    TableName="VenueScopeJobs",
                    FilterExpression="isLive = :live AND updatedAt > :recent",
                    ExpressionAttributeValues={
                        ":live":   {"BOOL": True},
                        ":recent": {"N": recent_cutoff},
                    },
                    ProjectionExpression=(
                        "venueId, jobId, cameraLabel, analysisMode, "
                        "createdAt, drinksPerHour, progressPct"
                    ),
                )
                out = []
                for item in resp.get("Items", []):
                    jid = item.get("jobId", {}).get("S", "")
                    out.append({
                        "venueId":      item.get("venueId", {}).get("S", ""),
                        "jobId":        jid[:12],
                        "camera":       item.get("cameraLabel", {}).get("S", ""),
                        "mode":         item.get("analysisMode", {}).get("S", ""),
                        "startedAt":    item.get("createdAt", {}).get("N", ""),
                        "drinksPerHour": float(item.get("drinksPerHour", {}).get("N", "0") or "0"),
                        "progressPct":  float(item.get("progressPct", {}).get("N", "0") or "0"),
                    })
                return out
            except Exception as e:
                log.warning("ops/status: DDB scan failed: %s", e)
                return []

        cpu_pct           = _cpu()
        ram_used, ram_total, ram_pct = _ram()
        disk_used, disk_total, disk_pct = _disk()

        self._json(200, {
            "worker": _worker_status(),
            "system": {
                "cpu_pct":       cpu_pct,
                "ram_used_mb":   ram_used,
                "ram_total_mb":  ram_total,
                "ram_pct":       ram_pct,
                "disk_used_gb":  disk_used,
                "disk_total_gb": disk_total,
                "disk_pct":      disk_pct,
            },
            "liveJobs": _live_jobs(),
            "ts":       time.time(),
        })

    def _handle_ops_logs(self, lines: int, filter_text: str):
        """GET /ops/logs?lines=N&filter=text — tail worker service logs."""
        import subprocess
        lines = max(20, min(lines, 500))
        try:
            r = subprocess.run(
                ["journalctl", "-u", "venuescope-worker",
                 f"-n{lines}", "--no-pager", "--output=short-iso"],
                capture_output=True, text=True, timeout=15,
            )
            raw = (r.stdout or r.stderr or "").splitlines()
            if filter_text:
                fl = filter_text.lower()
                raw = [l for l in raw if fl in l.lower()]
            self._json(200, {"lines": raw, "count": len(raw)})
        except Exception as e:
            self._json(500, {"error": str(e), "lines": []})

    def _handle_ops_restart(self):
        """POST /ops/restart — restart the venuescope-worker systemd service."""
        import subprocess
        try:
            r = subprocess.run(
                ["systemctl", "restart", "venuescope-worker"],
                capture_output=True, text=True, timeout=20,
            )
            if r.returncode == 0:
                log.info("ops/restart: worker restarted OK")
                self._json(200, {"ok": True, "msg": "Worker restarted successfully"})
            else:
                msg = (r.stderr or r.stdout or "unknown error").strip()
                log.error("ops/restart failed: %s", msg)
                self._json(500, {"ok": False, "msg": msg})
        except Exception as e:
            self._json(500, {"ok": False, "msg": str(e)})

    def _handle_ops_deploy(self):
        """POST /ops/deploy — git pull latest code then restart worker."""
        import subprocess
        output = []
        try:
            # Pull latest
            r = subprocess.run(
                ["git", "-C", DROPLET_DIR, "pull", "origin", "main"],
                capture_output=True, text=True, timeout=60,
            )
            pull_out = (r.stdout or r.stderr or "").strip()
            output.append(f"git pull: {pull_out}")
            log.info("ops/deploy git pull rc=%d: %s", r.returncode, pull_out)

            if r.returncode != 0:
                self._json(500, {"ok": False, "output": output})
                return

            # Restart worker
            r2 = subprocess.run(
                ["systemctl", "restart", "venuescope-worker"],
                capture_output=True, text=True, timeout=20,
            )
            restart_msg = "OK" if r2.returncode == 0 else (r2.stderr or "").strip()
            output.append(f"restart worker: {restart_msg}")
            log.info("ops/deploy restart rc=%d", r2.returncode)

            self._json(200, {"ok": r2.returncode == 0, "output": output})
        except Exception as e:
            output.append(f"error: {e}")
            self._json(500, {"ok": False, "output": output})


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), WebhookHandler)
    log.info("Webhook server listening on port %d", PORT)
    server.serve_forever()
