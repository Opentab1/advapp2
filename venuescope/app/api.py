"""
VenueScope REST API — http.server based JSON API for Advizia Pulse integration.
Runs on port 8502 alongside the Streamlit app on 8501.

Start standalone:  python3 app/api.py
Start programmatically: from app.api import start_api_server; start_api_server()
"""
from __future__ import annotations
import sys, json, time, threading
import re as _re
import time as _time
from collections import defaultdict
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

# Ensure project root is on path so core.* imports work
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.config   import CONFIG_DIR
from core.database import (list_jobs, get_job, list_cameras, list_venues, save_camera, delete_camera,
                            list_events, get_event, save_event, delete_event, get_concept_stats,
                            _compute_demand_score)
from core.onvif_discover import discover_cameras, get_rtsp_url

API_VERSION = "1.0"
API_PORT    = 8502


def _next_friday() -> str:
    from datetime import date, timedelta
    d = date.today()
    days = (4 - d.weekday()) % 7 or 7
    return (d + timedelta(days=days)).isoformat()

_JOB_ID_RE = _re.compile(r'^[a-zA-Z0-9_-]{1,64}$')

# Simple in-memory rate limiter: {ip: [timestamps]}
_rate_limit_log: dict = defaultdict(list)
_RATE_LIMIT_MAX = 60   # requests
_RATE_LIMIT_WINDOW = 60  # seconds

def _check_rate_limit(ip: str) -> bool:
    """Returns True if request is allowed, False if rate limited."""
    now = _time.time()
    window_start = now - _RATE_LIMIT_WINDOW
    # Prune old entries
    _rate_limit_log[ip] = [t for t in _rate_limit_log[ip] if t > window_start]
    if len(_rate_limit_log[ip]) >= _RATE_LIMIT_MAX:
        return False
    _rate_limit_log[ip].append(now)
    return True


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
    confidence_color = "yellow"
    try:
        from core.confidence import compute_confidence_score
        cs, _color, clabel = compute_confidence_score(summary)
        confidence_score = cs
        confidence_color = _color   # "green", "yellow", or "red"
        confidence_label = clabel
    except Exception:
        pass

    # theft flag
    has_theft_flag = bool(summary.get("theft_flags") or summary.get("theft_risk"))

    # unrung drinks count
    unrung_drinks = (
        summary.get("unrung_drinks")
        or summary.get("drink_quality", {}).get("unrung_serves", 0)
        or len(summary.get("theft_flags", []))
        or 0
    )

    return {
        "job_id":           job["job_id"],
        "clip_label":       job.get("clip_label") or "",
        "total_drinks":     total_drinks,
        "drinks_per_hour":  drinks_per_hour,
        "top_bartender":    top_bartender or "—",
        "confidence_score": confidence_score,
        "confidence_label": confidence_label,
        "confidence_color": confidence_color,    # "green", "yellow", or "red"
        "created_at":       job.get("created_at", 0),
        "has_theft_flag":   has_theft_flag,
        "unrung_drinks":    unrung_drinks,
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


def _handle_jobs_recent(mode: str | None = None, days: int = 30, limit: int = 20) -> dict:
    """Return recent completed jobs for the Analytics card job history."""
    from datetime import datetime, timezone
    cutoff = time.time() - days * 86400
    all_jobs = list_jobs(200)
    result = []
    for j in all_jobs:
        if j.get("status") != "done":
            continue
        if (j.get("created_at") or 0) < cutoff:
            continue
        if mode and j.get("analysis_mode") != mode:
            continue
        summary = _parse_summary(j) or {}
        total_drinks = sum(
            b.get("total_drinks", 0)
            for b in summary.get("bartenders", {}).values()
        )
        result.append({
            "job_id":        j["job_id"],
            "clip_label":    j.get("clip_label") or "",
            "analysis_mode": j.get("analysis_mode", ""),
            "total_drinks":  total_drinks,
            "created_at":    j.get("created_at", 0),
            "status":        j.get("status", ""),
        })
        if len(result) >= limit:
            break
    return {"jobs": result, "total": len(result)}


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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path   = parsed.path.rstrip("/")
        try:
            if path.startswith("/api/cameras/"):
                cam_id = path[len("/api/cameras/"):]
                if not cam_id:
                    _json_response(self, {"error": "camera_id required"}, 400)
                    return
                delete_camera(cam_id)
                _json_response(self, {"ok": True}, 200)
            elif path.startswith("/api/events/"):
                event_id = path[len("/api/events/"):]
                if not event_id:
                    _json_response(self, {"error": "event_id required"}, 400)
                    return
                delete_event(event_id)
                _json_response(self, {"ok": True}, 200)
            else:
                _json_response(self, {"error": "Not found"}, 404)
        except Exception as exc:
            _json_response(self, {"error": str(exc)}, 500)

    def do_POST(self):
        parsed = urlparse(self.path)
        path   = parsed.path.rstrip("/")
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length)) if length else {}

            if path == "/api/cameras":
                import uuid as _uuid
                cam_id = body.get("camera_id") or str(_uuid.uuid4())[:8]
                save_camera(
                    camera_id       = cam_id,
                    venue           = body.get("venue", "Default Venue"),
                    name            = body.get("name", "Camera"),
                    rtsp_url        = body.get("rtsp_url", ""),
                    mode            = body.get("mode", "drink_count"),
                    model_profile   = body.get("model_profile", "balanced"),
                    segment_seconds = float(body.get("segment_seconds", 300)),
                    notes           = body.get("notes", ""),
                )
                _json_response(self, {"ok": True, "camera_id": cam_id}, 201)

            elif path == "/api/cameras/fetch-rtsp":
                # Given an IP + credentials, fetch the RTSP URL via ONVIF
                ip       = body.get("ip", "")
                username = body.get("username", "admin")
                password = body.get("password", "")
                xaddrs   = body.get("xaddrs")
                if not ip:
                    _json_response(self, {"error": "ip required"}, 400)
                    return
                rtsp = get_rtsp_url(ip, username=username, password=password,
                                    xaddrs=xaddrs, timeout=6.0)
                if rtsp:
                    _json_response(self, {"ok": True, "rtsp_url": rtsp}, 200)
                else:
                    _json_response(self, {"ok": False, "error": "Could not retrieve RTSP URL — check credentials"}, 200)

            elif path == "/api/events":
                import uuid as _uuid
                event_id = body.get("event_id") or str(_uuid.uuid4())[:12]
                if not body.get("name") or not body.get("concept_type") or not body.get("event_date"):
                    _json_response(self, {"error": "name, concept_type, event_date required"}, 400)
                    return
                signals = {k: body.get(k) for k in [
                    "meta_cpc_a", "meta_cpc_b", "tiktok_save_rate",
                    "ig_dm_count", "ig_poll_pct", "google_trends_score", "eventbrite_pct"
                ] if body.get(k) is not None}
                demand_score, demand_verdict = _compute_demand_score(signals) if signals else (None, None)
                save_event(
                    event_id       = event_id,
                    name           = body["name"],
                    concept_type   = body["concept_type"],
                    event_date     = body["event_date"],
                    venue          = body.get("venue", ""),
                    expected_headcount = body.get("expected_headcount"),
                    cover_charge   = body.get("cover_charge"),
                    status         = body.get("status", "upcoming"),
                    notes          = body.get("notes", ""),
                    demand_score   = demand_score,
                    demand_verdict = demand_verdict,
                    threshold_headcount     = body.get("threshold_headcount"),
                    threshold_revenue_pct   = body.get("threshold_revenue_pct"),
                    **{k: body.get(k) for k in [
                        "meta_cpc_a", "meta_cpc_b", "meta_concept_a", "meta_concept_b",
                        "tiktok_save_rate", "ig_dm_count", "ig_poll_pct",
                        "google_trends_score", "eventbrite_pct", "job_ids", "camera_ids",
                        "peak_occupancy", "avg_drink_velocity", "event_health_score", "scorecard_json"
                    ] if body.get(k) is not None}
                )
                _json_response(self, {"ok": True, "event_id": event_id}, 201)

            elif path.startswith("/api/events/") and path != "/api/events/concepts":
                event_id = path[len("/api/events/"):]
                ev = get_event(event_id)
                if not ev:
                    _json_response(self, {"error": "Event not found"}, 404)
                    return
                # Merge new signals and recompute demand score
                signal_keys = ["meta_cpc_a", "meta_cpc_b", "meta_concept_a", "meta_concept_b",
                               "tiktok_save_rate", "ig_dm_count", "ig_poll_pct",
                               "google_trends_score", "eventbrite_pct"]
                signals = {k: body.get(k) if body.get(k) is not None else ev.get(k)
                           for k in signal_keys}
                demand_score, demand_verdict = _compute_demand_score(signals)
                update_vals = {k: v for k, v in body.items() if k not in ("event_id",)}
                update_vals["demand_score"]  = demand_score
                update_vals["demand_verdict"] = demand_verdict
                # Merge with existing, update
                save_event(
                    event_id     = event_id,
                    name         = update_vals.get("name", ev["name"]),
                    concept_type = update_vals.get("concept_type", ev["concept_type"]),
                    event_date   = update_vals.get("event_date", ev["event_date"]),
                    venue        = update_vals.get("venue", ev.get("venue", "")),
                    expected_headcount = update_vals.get("expected_headcount", ev.get("expected_headcount")),
                    cover_charge = update_vals.get("cover_charge", ev.get("cover_charge")),
                    status       = update_vals.get("status", ev.get("status", "upcoming")),
                    notes        = update_vals.get("notes", ev.get("notes", "")),
                    **{k: update_vals.get(k) if update_vals.get(k) is not None else ev.get(k)
                       for k in ["meta_cpc_a", "meta_cpc_b", "meta_concept_a", "meta_concept_b",
                                 "tiktok_save_rate", "ig_dm_count", "ig_poll_pct",
                                 "google_trends_score", "eventbrite_pct", "demand_score",
                                 "demand_verdict", "threshold_headcount", "threshold_revenue_pct",
                                 "job_ids", "camera_ids", "peak_occupancy", "avg_drink_velocity",
                                 "event_health_score", "scorecard_json"]
                       if (update_vals.get(k) is not None or ev.get(k) is not None)}
                )
                _json_response(self, {"ok": True, "event_id": event_id}, 200)
            else:
                _json_response(self, {"error": "Not found"}, 404)
        except Exception as exc:
            _json_response(self, {"error": str(exc)}, 500)

    def do_PATCH(self):
        """PATCH /api/events/{id} — update event signals/scorecard."""
        parsed = urlparse(self.path)
        path   = parsed.path.rstrip("/")
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length)) if length else {}
            if path.startswith("/api/events/"):
                event_id = path[len("/api/events/"):]
                ev = get_event(event_id)
                if not ev:
                    _json_response(self, {"error": "Event not found"}, 404)
                    return
                signal_keys = ["meta_cpc_a", "meta_cpc_b", "meta_concept_a", "meta_concept_b",
                               "tiktok_save_rate", "ig_dm_count", "ig_poll_pct",
                               "google_trends_score", "eventbrite_pct"]
                signals = {k: body.get(k) if body.get(k) is not None else ev.get(k)
                           for k in signal_keys}
                demand_score, demand_verdict = _compute_demand_score(signals)
                save_event(
                    event_id     = event_id,
                    name         = body.get("name", ev["name"]),
                    concept_type = body.get("concept_type", ev["concept_type"]),
                    event_date   = body.get("event_date", ev["event_date"]),
                    venue        = body.get("venue", ev.get("venue", "")),
                    expected_headcount = body.get("expected_headcount", ev.get("expected_headcount")),
                    cover_charge = body.get("cover_charge", ev.get("cover_charge")),
                    status       = body.get("status", ev.get("status", "upcoming")),
                    notes        = body.get("notes", ev.get("notes", "")),
                    demand_score   = demand_score,
                    demand_verdict = demand_verdict,
                    **{k: body.get(k) if body.get(k) is not None else ev.get(k)
                       for k in ["meta_cpc_a", "meta_cpc_b", "meta_concept_a", "meta_concept_b",
                                 "tiktok_save_rate", "ig_dm_count", "ig_poll_pct",
                                 "google_trends_score", "eventbrite_pct",
                                 "threshold_headcount", "threshold_revenue_pct",
                                 "job_ids", "camera_ids", "peak_occupancy", "avg_drink_velocity",
                                 "event_health_score", "scorecard_json"]
                       if (body.get(k) is not None or ev.get(k) is not None)}
                )
                _json_response(self, {"ok": True, "demand_score": demand_score,
                                      "demand_verdict": demand_verdict}, 200)
            else:
                _json_response(self, {"error": "Not found"}, 404)
        except Exception as exc:
            _json_response(self, {"error": str(exc)}, 500)

    def do_GET(self):
        client_ip = self.client_address[0]
        if not _check_rate_limit(client_ip):
            _json_response(self, {"error": "Rate limit exceeded"}, 429)
            return

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

            elif path == "/api/jobs/recent":
                from urllib.parse import parse_qs
                qs = parse_qs(urlparse(self.path).query)
                mode  = qs.get("mode",  [None])[0]
                days  = int(qs.get("days",  ["30"])[0])
                limit = int(qs.get("limit", ["20"])[0])
                limit = min(max(limit, 1), 100)  # clamp 1-100
                days  = min(max(days, 1), 365)   # clamp 1-365
                _json_response(self, _handle_jobs_recent(mode, days, limit))

            elif path == "/api/jobs":
                _json_response(self, _handle_jobs_list(), 200)

            elif path.startswith("/api/jobs/"):
                job_id = path[len("/api/jobs/"):]
                if not job_id or not _JOB_ID_RE.match(job_id):
                    _json_response(self, {"error": "Invalid job_id"}, 400)
                    return
                data, status = _handle_job_detail(job_id)
                _json_response(self, data, status)

            elif path == "/api/cameras":
                cams   = list_cameras()
                venues = list_venues()
                _json_response(self, {"cameras": cams, "venues": venues}, 200)

            elif path == "/api/events/forecast":
                # Attendance forecast for a given concept / date / capacity
                from urllib.parse import parse_qs
                qs           = parse_qs(urlparse(self.path).query)
                concept_type = qs.get("concept",  ["DJ Night"])[0]
                city         = qs.get("city",     [""])[0]
                event_date   = qs.get("date",     [""])[0]
                capacity     = int(qs.get("capacity", ["150"])[0])
                cover        = float(qs.get("cover", ["0"])[0])
                weather_risk = qs.get("weather_risk", ["none"])[0]
                try:
                    from core.forecasting import forecast_attendance
                    result = forecast_attendance(
                        concept_type=concept_type, city=city,
                        event_date_str=event_date or _next_friday(),
                        capacity=capacity, cover_charge=cover,
                        weather_risk=weather_risk,
                    )
                    _json_response(self, result, 200)
                except Exception as exc:
                    _json_response(self, {"error": str(exc)}, 500)

            elif path == "/api/events/validate":
                # Auto-validate an event concept — pulls Google Trends + weather + Reddit
                from urllib.parse import parse_qs
                qs           = parse_qs(urlparse(self.path).query)
                concept_type = qs.get("concept", ["DJ Night"])[0]
                city         = qs.get("city",    ["Tampa"])[0]
                event_date   = qs.get("date",    [""])[0]
                capacity     = int(qs.get("capacity", ["150"])[0])
                cover        = float(qs.get("cover", ["0"])[0]) or None
                try:
                    from core.event_intelligence import validate_event_concept
                    result = validate_event_concept(
                        concept_type=concept_type, city=city,
                        event_date=event_date or _next_friday(),
                        capacity=capacity, cover_charge=cover,
                    )
                    _json_response(self, result, 200)
                except Exception as exc:
                    _json_response(self, {"error": str(exc)}, 500)

            elif path == "/api/events":
                from urllib.parse import parse_qs
                qs    = parse_qs(urlparse(self.path).query)
                venue = qs.get("venue", [None])[0]
                limit = int(qs.get("limit", ["100"])[0])
                evs   = list_events(limit=limit, venue=venue)
                _json_response(self, {"events": evs}, 200)

            elif path == "/api/events/concepts":
                _json_response(self, {"concepts": get_concept_stats()}, 200)

            elif path.startswith("/api/events/"):
                event_id = path[len("/api/events/"):]
                ev = get_event(event_id)
                if not ev:
                    _json_response(self, {"error": "Event not found"}, 404)
                    return
                _json_response(self, ev, 200)

            elif path == "/api/cameras/discover":
                # WS-Discovery scan — finds ONVIF cameras on the local network
                found = discover_cameras(timeout=4.0)
                _json_response(self, {"cameras": found}, 200)

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
