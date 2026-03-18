"""
VenueScope REST API — http.server based JSON API for Advizia Pulse integration.
Runs on port 8502 alongside the Streamlit app on 8501.

Start standalone:  python3 app/api.py
Start programmatically: from app.api import start_api_server; start_api_server()
"""
from __future__ import annotations
import sys, json, time, threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

# Ensure project root is on path so core.* imports work
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.config   import CONFIG_DIR
from core.database import list_jobs, get_job

API_VERSION = "1.0"
API_PORT    = 8502


# ── helpers ──────────────────────────────────────────────────────────────────

def _json_response(handler: BaseHTTPRequestHandler, data, status: int = 200) -> None:
    body = json.dumps(data, default=str).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    # CORS — allow any origin so Advizia Pulse can call from its own domain
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    handler.end_headers()
    handler.wfile.write(body)


def _parse_summary(job: dict) -> dict | None:
    """Parse summary_json field; return dict or None."""
    raw = job.get("summary_json")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _summary_payload(job: dict) -> dict:
    """Build the /api/summary/latest payload from a job row."""
    summary = _parse_summary(job) or {}
    extra   = summary.get("extra_config", {})

    # Drink count
    total_drinks = 0
    top_bartender = None
    top_count = -1
    for bname, bdata in summary.get("bartenders", {}).items():
        td = bdata.get("total_drinks", 0)
        total_drinks += td
        if td > top_count:
            top_count = td
            top_bartender = bname

    # drinks per hour
    dur_sec = summary.get("duration_seconds", 0) or summary.get("video_duration_seconds", 0) or 0
    drinks_per_hour = round(total_drinks / (dur_sec / 3600), 2) if dur_sec > 0 else 0.0

    # confidence
    confidence_score = 0
    confidence_label = "Unknown"
    try:
        from core.confidence import compute_confidence_score
        cs, _color, clabel = compute_confidence_score(summary)
        confidence_score = cs
        confidence_label = clabel
    except Exception:
        pass

    # theft flag
    has_theft_flag = bool(summary.get("theft_flags") or summary.get("theft_risk"))

    return {
        "job_id":           job["job_id"],
        "clip_label":       job.get("clip_label") or "",
        "total_drinks":     total_drinks,
        "drinks_per_hour":  drinks_per_hour,
        "top_bartender":    top_bartender,
        "confidence_score": confidence_score,
        "confidence_label": confidence_label,
        "created_at":       job.get("created_at", 0),
        "has_theft_flag":   has_theft_flag,
    }


def _handle_health() -> dict:
    return {"status": "ok", "version": API_VERSION}


def _handle_summary_latest() -> tuple[dict | None, int]:
    jobs = list_jobs(50)
    done = [j for j in jobs if j.get("status") == "done"
            and j.get("analysis_mode") == "drink_count"]
    if not done:
        return {"error": "No completed drink_count jobs found"}, 404
    return _summary_payload(done[0]), 200


def _handle_summary_30d() -> dict:
    from datetime import datetime, timedelta, timezone
    cutoff = time.time() - 30 * 86400
    jobs = list_jobs(200)
    recent = [j for j in jobs
              if (j.get("created_at") or 0) >= cutoff
              and j.get("status") == "done"]

    total_jobs    = len(recent)
    total_drinks  = 0
    total_entries = 0
    drinks_by_date: dict[str, int]  = {}
    entries_by_date: dict[str, int] = {}

    for j in recent:
        summary = _parse_summary(j) or {}
        # drinks
        dr = sum(b.get("total_drinks", 0) for b in summary.get("bartenders", {}).values())
        total_drinks += dr
        # entries (people count)
        en = summary.get("total_entries", 0) or summary.get("entries", 0) or 0
        total_entries += en
        # bucket by date
        ts  = j.get("created_at") or 0
        day = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
        drinks_by_date[day]  = drinks_by_date.get(day, 0)  + dr
        entries_by_date[day] = entries_by_date.get(day, 0) + en

    avg_drinks = round(total_drinks / total_jobs, 2) if total_jobs > 0 else 0.0

    return {
        "period":              "30d",
        "total_jobs":          total_jobs,
        "total_drinks":        total_drinks,
        "avg_drinks_per_shift": avg_drinks,
        "total_entries":       total_entries,
        "drinks_by_date":      drinks_by_date,
        "entries_by_date":     entries_by_date,
    }


def _handle_jobs_list() -> list:
    jobs = list_jobs(50)
    return [
        {
            "job_id":        j["job_id"],
            "status":        j.get("status"),
            "analysis_mode": j.get("analysis_mode"),
            "clip_label":    j.get("clip_label") or "",
            "model_profile": j.get("model_profile"),
            "created_at":    j.get("created_at"),
            "finished_at":   j.get("finished_at"),
        }
        for j in jobs
    ]


def _handle_job_detail(job_id: str) -> tuple[dict | None, int]:
    job = get_job(job_id)
    if not job:
        return {"error": f"Job '{job_id}' not found"}, 404
    # Return the full job row with summary parsed out
    payload = {k: v for k, v in job.items() if k != "summary_json"}
    summary = _parse_summary(job)
    if summary is not None:
        payload["summary"] = summary
    return payload, 200


# ── request handler ──────────────────────────────────────────────────────────

class _APIHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        # Suppress default request logging to keep console clean;
        # errors still surface via log_error.
        pass

    def do_OPTIONS(self):
        # Pre-flight CORS
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path   = parsed.path.rstrip("/")

        try:
            if path == "/api/health":
                _json_response(self, _handle_health(), 200)

            elif path == "/api/summary/latest":
                data, status = _handle_summary_latest()
                _json_response(self, data, status)

            elif path == "/api/summary/30d":
                _json_response(self, _handle_summary_30d(), 200)

            elif path == "/api/jobs":
                _json_response(self, _handle_jobs_list(), 200)

            elif path.startswith("/api/jobs/"):
                job_id = path[len("/api/jobs/"):]
                if not job_id:
                    _json_response(self, {"error": "Missing job_id"}, 400)
                else:
                    data, status = _handle_job_detail(job_id)
                    _json_response(self, data, status)

            else:
                _json_response(self, {"error": "Not found", "path": path}, 404)

        except Exception as exc:
            _json_response(self, {"error": "Internal server error", "detail": str(exc)}, 500)


# ── server lifecycle ─────────────────────────────────────────────────────────

_server_instance: HTTPServer | None = None


def start_api_server(port: int = API_PORT, background: bool = True) -> HTTPServer:
    """
    Start the API server.  If background=True, runs in a daemon thread so it
    doesn't block the calling process (used when launched alongside Streamlit).
    Returns the HTTPServer instance.
    """
    global _server_instance
    if _server_instance is not None:
        return _server_instance

    server = HTTPServer(("0.0.0.0", port), _APIHandler)
    _server_instance = server

    if background:
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        print(f"[VenueScope API] listening on http://0.0.0.0:{port}", flush=True)
    else:
        print(f"[VenueScope API] listening on http://0.0.0.0:{port} (blocking)", flush=True)
        server.serve_forever()

    return server


def stop_api_server() -> None:
    global _server_instance
    if _server_instance:
        _server_instance.shutdown()
        _server_instance = None


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="VenueScope REST API server")
    ap.add_argument("--port", type=int, default=API_PORT)
    args = ap.parse_args()
    start_api_server(port=args.port, background=False)
