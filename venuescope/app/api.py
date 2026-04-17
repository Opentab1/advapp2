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
from core.prophet_forecast import forecast_service as _forecast_service

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

            if path == "/forecast/tonight":
                data, status = _forecast_service.handle_request(
                    method="POST",
                    path=path,
                    query_string=parsed.query,
                    body=body,
                )
                _json_response(self, data, status)

            elif path == "/api/cameras":
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

            elif path == "/api/cameras/identify":
                # Probe a camera IP: auto-try credentials, detect brand/model,
                # enumerate channels, return RTSP URLs.
                import socket as _sid_sock, urllib.request as _sid_req
                import urllib.error as _sid_err, base64 as _b64
                import concurrent.futures as _sid_cf, re as _sid_re

                ip4     = body.get("ip", "")
                u_hint  = body.get("username")
                p_hint  = body.get("password")
                if not ip4:
                    _json_response(self, {"error": "ip required"}, 400)
                    return

                COMMON_CREDS = [
                    ("admin", ""),
                    ("admin", "admin"),
                    ("admin", "12345"),
                    ("admin", "123456"),
                    ("admin", "1234"),
                    ("admin", "password"),
                    ("admin", "Admin1234!"),
                    ("root", ""),
                    ("root", "root"),
                    ("ubnt", "ubnt"),
                ]
                creds_list = []
                if u_hint is not None and p_hint is not None:
                    creds_list.append((u_hint, p_hint))
                for c in COMMON_CREDS:
                    if c not in creds_list:
                        creds_list.append(c)

                # ── helpers ───────────────────────────────────────
                def _http_get(url, user=None, pwd=None, timeout=3):
                    try:
                        req = _sid_req.Request(url)
                        if user is not None:
                            token = _b64.b64encode(f"{user}:{pwd}".encode()).decode()
                            req.add_header("Authorization", f"Basic {token}")
                        with _sid_req.urlopen(req, timeout=timeout) as r:
                            return r.status, r.read(4096).decode('utf-8', errors='ignore'), dict(r.headers)
                    except _sid_err.HTTPError as e:
                        try:
                            return e.code, e.read(512).decode('utf-8', errors='ignore'), {}
                        except Exception:
                            return e.code, "", {}
                    except Exception:
                        return None, "", {}

                def _brand_from_html(html, headers):
                    server = headers.get('Server', '')
                    h = (html + server).lower()
                    if 'hikvision' in h: return 'Hikvision'
                    if 'dahua' in h: return 'Dahua'
                    if 'amcrest' in h: return 'Amcrest'
                    if 'reolink' in h: return 'Reolink'
                    if 'axis' in h: return 'Axis'
                    if 'uniview' in h or 'unv' in h: return 'Uniview'
                    if 'hanwha' in h or 'samsung' in h: return 'Hanwha'
                    if 'ubnt' in h or 'ubiquiti' in h or 'unifi' in h: return 'Ubiquiti'
                    if 'synology' in h: return 'Synology'
                    if server: return server.split('/')[0].strip()
                    return None

                def _rtsp_reachable(rtsp_url, timeout=2):
                    try:
                        parsed = urlparse(rtsp_url)
                        h = parsed.hostname or ip4
                        p = parsed.port or 554
                        with _sid_sock.create_connection((h, p), timeout=timeout) as s:
                            req = (f"OPTIONS {rtsp_url} RTSP/1.0\r\n"
                                   f"CSeq: 1\r\nUser-Agent: VenueScope\r\n\r\n")
                            s.sendall(req.encode())
                            s.settimeout(timeout)
                            resp = s.recv(512).decode('utf-8', errors='ignore')
                            return ('RTSP/1.0 200' in resp or
                                    'RTSP/1.0 401' in resp or
                                    'RTSP/1.0 4' in resp)
                    except Exception:
                        return False

                def _try_onvif_identify(ip, u, p):
                    """Try ONVIF GetDeviceInformation + GetProfiles → RTSP URLs."""
                    try:
                        from core.onvif_discover import get_rtsp_url as _onvif_rtsp
                        rtsp = _onvif_rtsp(ip, username=u, password=p, timeout=4)
                        if rtsp:
                            return {"brand": "ONVIF", "model": "", "rtsp_urls": [rtsp],
                                    "channels": [{"num": 1, "rtsp_url": rtsp, "reachable": True}]}
                    except Exception:
                        pass
                    return None

                def _build_channel_urls(ip, u, p, brand):
                    """Generate RTSP URL candidates for channels 1-16 based on brand."""
                    auth = f"{u}:{p}@" if u else ""
                    templates = []
                    b = (brand or "").lower()
                    if 'dahua' in b or 'amcrest' in b:
                        templates = [
                            f"rtsp://{auth}{ip}:554/cam/realmonitor?channel={{n}}&subtype=0",
                        ]
                    elif 'hikvision' in b:
                        templates = [
                            f"rtsp://{auth}{ip}:554/Streaming/Channels/{{n}}01",
                        ]
                    elif 'axis' in b:
                        templates = [
                            f"rtsp://{auth}{ip}:554/axis-media/media.amp?camera={{n}}",
                        ]
                    elif 'reolink' in b:
                        templates = [
                            f"rtsp://{auth}{ip}:554/h264Preview_{{n:02d}}_main",
                        ]
                    else:
                        # Generic: try both patterns
                        templates = [
                            f"rtsp://{auth}{ip}:554/cam/realmonitor?channel={{n}}&subtype=0",
                            f"rtsp://{auth}{ip}:554/Streaming/Channels/{{n}}01",
                        ]
                    return templates

                def _enumerate_channels(ip, u, p, brand, max_ch=16):
                    """Try channels 1..max_ch and return reachable ones."""
                    templates = _build_channel_urls(ip, u, p, brand)
                    channels = []
                    def _probe_ch(n):
                        for tmpl in templates:
                            url = tmpl.format(n=n)
                            if _rtsp_reachable(url, timeout=1.5):
                                return {"num": n, "rtsp_url": url, "reachable": True,
                                        "label": f"Channel {n}"}
                        return None
                    with _sid_cf.ThreadPoolExecutor(max_workers=16) as ex:
                        results = list(ex.map(_probe_ch, range(1, max_ch + 1)))
                    return [r for r in results if r is not None]

                # ── main identify logic ────────────────────────────
                result = {
                    "ip": ip4, "brand": "Unknown", "model": "",
                    "auth_ok": False, "creds_used": None,
                    "channels": [], "single_stream": None,
                    "error": None,
                }

                # 1. HTTP banner
                status, html, headers = _http_get(f"http://{ip4}/")
                if html or headers:
                    b = _brand_from_html(html, headers)
                    if b:
                        result["brand"] = b

                # 2. Try ONVIF with each credential set
                for u, p in creds_list[:10]:
                    info = _try_onvif_identify(ip4, u, p)
                    if info:
                        result.update(info)
                        result["auth_ok"] = True
                        result["creds_used"] = {"username": u, "password": p}
                        break

                # 3. Try Hikvision ISAPI if not found yet
                if not result["auth_ok"]:
                    for u, p in creds_list[:10]:
                        code, body_txt, hdrs = _http_get(
                            f"http://{ip4}/ISAPI/System/deviceInfo", u, p)
                        if code == 200 and '<deviceName>' in body_txt:
                            result["brand"] = "Hikvision"
                            m = _sid_re.search(r'<model>(.*?)</model>', body_txt)
                            if m: result["model"] = m.group(1)
                            result["auth_ok"] = True
                            result["creds_used"] = {"username": u, "password": p}
                            break

                # 4. Try Dahua if not found yet
                if not result["auth_ok"]:
                    for u, p in creds_list[:10]:
                        code, body_txt, hdrs = _http_get(
                            f"http://{ip4}/cgi-bin/magicBox.cgi?action=getDeviceType",
                            u, p)
                        if code == 200 and 'type=' in body_txt:
                            result["brand"] = "Dahua"
                            m = _sid_re.search(r'type=(.*)', body_txt)
                            if m: result["model"] = m.group(1).strip()
                            result["auth_ok"] = True
                            result["creds_used"] = {"username": u, "password": p}
                            break

                # 5. Enumerate channels
                u_use = result["creds_used"]["username"] if result["creds_used"] else (u_hint or "admin")
                p_use = result["creds_used"]["password"] if result["creds_used"] else (p_hint or "")
                result["channels"] = _enumerate_channels(
                    ip4, u_use, p_use, result["brand"], max_ch=16)

                # If only 1 channel found and it's channel 1, also set single_stream
                if len(result["channels"]) == 1:
                    result["single_stream"] = result["channels"][0]["rtsp_url"]

                _json_response(self, result, 200)

            elif path == "/api/cameras/batch-register":
                # Register multiple cameras at once (e.g., all channels from an NVR)
                import uuid as _uuid2
                channels = body.get("channels", [])
                venue    = body.get("venue", "Default Venue")
                mode     = body.get("mode", "drink_count")
                profile  = body.get("model_profile", "balanced")
                registered = []
                for ch in channels:
                    if not ch.get("rtsp_url"):
                        continue
                    cam_id = str(_uuid2.uuid4())[:8]
                    save_camera(
                        camera_id       = cam_id,
                        venue           = venue,
                        name            = ch.get("name", ch.get("label", f"Camera {ch.get('num','')}") ),
                        rtsp_url        = ch["rtsp_url"],
                        mode            = ch.get("mode", mode),
                        model_profile   = profile,
                        segment_seconds = float(ch.get("segment_seconds", 300)),
                        notes           = ch.get("notes", ""),
                    )
                    registered.append(cam_id)
                _json_response(self, {"ok": True, "registered": registered, "count": len(registered)}, 201)

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

            elif path == "/api/cameras/scan-streams":
                # Test connectivity for every registered camera's RTSP/HLS URL.
                # For HLS URLs (http://…m3u8) — HTTP GET, check status.
                # For RTSP URLs (rtsp://…) — TCP connect to host:port.
                import socket, urllib.request, urllib.error
                cams = list_cameras()
                results = []
                for cam in cams:
                    url = cam.get("rtsp_url", "")
                    label = cam.get("name", cam.get("camera_id", ""))
                    status = "unknown"
                    latency_ms = None
                    error = None
                    if not url:
                        status = "no_url"
                    else:
                        parsed = urlparse(url)
                        try:
                            import time as _time
                            t0 = _time.time()
                            if parsed.scheme in ("http", "https"):
                                req = urllib.request.Request(url, method="GET")
                                try:
                                    resp = urllib.request.urlopen(req, timeout=4)
                                    latency_ms = int((_time.time() - t0) * 1000)
                                    status = "live" if resp.status == 200 else "offline"
                                    resp.close()
                                except urllib.error.HTTPError as e:
                                    latency_ms = int((_time.time() - t0) * 1000)
                                    status = "offline"
                                    error = f"HTTP {e.code}"
                            else:
                                # RTSP/other — TCP connect test
                                host = parsed.hostname or ""
                                port = parsed.port or 554
                                with socket.create_connection((host, port), timeout=4):
                                    latency_ms = int((_time.time() - t0) * 1000)
                                    status = "reachable"
                        except OSError as e:
                            status = "offline"
                            error = str(e).split("]")[-1].strip()
                        except Exception as e:
                            status = "error"
                            error = str(e)[:80]
                    results.append({
                        "camera_id": cam.get("camera_id"),
                        "name": label,
                        "url": url,
                        "status": status,
                        "latency_ms": latency_ms,
                        "error": error,
                        "enabled": cam.get("enabled", True),
                        "mode": cam.get("mode", ""),
                    })
                _json_response(self, {"cameras": results}, 200)

            elif path == "/api/cameras/network-info":
                # Return worker's network interfaces and IPs
                import socket as _sock, subprocess as _sp, platform as _pl, re as _nre2
                import ipaddress as _ipm
                interfaces = []

                # Try Linux: ip -4 addr show
                try:
                    r = _sp.run(['ip', '-4', 'addr', 'show'],
                                capture_output=True, text=True, timeout=3)
                    if r.returncode == 0:
                        cur = None
                        for line in r.stdout.splitlines():
                            m = _nre2.match(r'^\d+:\s+(\S+):', line)
                            if m:
                                cur = m.group(1).rstrip(':@')
                            am = _nre2.search(r'inet\s+([\d.]+)/(\d+)', line)
                            if am and cur:
                                ip4 = am.group(1)
                                plen = int(am.group(2))
                                if ip4.startswith('127.'):
                                    continue
                                net = str(_ipm.IPv4Network(f"{ip4}/{plen}", strict=False))
                                interfaces.append({"name": cur, "ip": ip4,
                                                   "subnet": net, "prefix": plen})
                except Exception:
                    pass

                # macOS fallback: ifconfig
                if not interfaces:
                    try:
                        r = _sp.run(['ifconfig'], capture_output=True, text=True, timeout=3)
                        if r.returncode == 0:
                            cur = None
                            for line in r.stdout.splitlines():
                                m = _nre2.match(r'^(\w[\w.]+\d*):', line)
                                if m:
                                    cur = m.group(1)
                                am = _nre2.search(
                                    r'inet\s+([\d.]+)\s+netmask\s+(0x[\da-fA-F]+|[\d.]+)', line)
                                if am and cur:
                                    ip4 = am.group(1)
                                    if ip4.startswith('127.'):
                                        continue
                                    raw_mask = am.group(2)
                                    try:
                                        if raw_mask.startswith('0x'):
                                            mask_int = int(raw_mask, 16)
                                            mask = str(_ipm.IPv4Address(mask_int))
                                        else:
                                            mask = raw_mask
                                        net_obj = _ipm.IPv4Network(f"{ip4}/{mask}", strict=False)
                                        interfaces.append({
                                            "name": cur, "ip": ip4,
                                            "subnet": str(net_obj),
                                            "prefix": net_obj.prefixlen,
                                        })
                                    except Exception:
                                        interfaces.append({"name": cur, "ip": ip4,
                                                           "subnet": None, "prefix": None})
                    except Exception:
                        pass

                # Last resort: socket
                if not interfaces:
                    try:
                        _, _, ips = _sock.gethostbyname_ex(_sock.gethostname())
                        for ip4 in ips:
                            if not ip4.startswith('127.'):
                                interfaces.append({"name": "default", "ip": ip4,
                                                   "subnet": None, "prefix": None})
                    except Exception:
                        pass

                _json_response(self, {
                    "hostname": _sock.gethostname(),
                    "platform": _pl.system(),
                    "interfaces": interfaces,
                }, 200)

            elif path == "/api/cameras/arp-table":
                # Parse ARP table — instantly shows what devices the OS has already seen
                import subprocess as _sp2, re as _re2
                # OUI → vendor map for common camera/network hardware
                _OUI = {
                    "fc:b5:77": "Ubiquiti",    "00:15:6d": "Ubiquiti",
                    "24:a4:3c": "Ubiquiti",    "70:a7:41": "Ubiquiti",
                    "ac:8b:a9": "Ubiquiti",    "e0:63:da": "Ubiquiti",
                    "68:d7:9a": "Ubiquiti",    "80:2a:a8": "Ubiquiti",
                    "a0:60:32": "Dahua",       "9c:8e:cd": "Dahua",
                    "ec:71:db": "Dahua",       "bc:32:5f": "Dahua",
                    "4c:11:bf": "Dahua",       "30:e3:7a": "Dahua",
                    "bc:ad:28": "Hikvision",   "44:19:b6": "Hikvision",
                    "8c:e7:48": "Hikvision",   "c0:56:e3": "Hikvision",
                    "28:57:be": "Hikvision",   "c4:2f:90": "Hikvision",
                    "ac:cc:8e": "Axis",        "00:40:8c": "Axis",
                    "b8:27:eb": "Raspberry Pi","dc:a6:32": "Raspberry Pi",
                    "e4:5f:01": "Raspberry Pi","88:a2:9e": "Raspberry Pi",
                    "d8:3a:dd": "Raspberry Pi",
                    "00:0c:e5": "Reolink",     "ec:71:db": "Reolink",
                    "00:62:6e": "Amcrest",
                    "00:0f:48": "Synology",
                    "d8:b3:70": "Ubiquiti",    "e8:65:d4": "Ubiquiti",
                }
                def _oui_vendor(mac):
                    if not mac: return None
                    parts = mac.replace('-',':').lower().split(':')
                    if len(parts) < 3: return None
                    # normalize single-digit octets
                    norm = ':'.join(p.zfill(2) for p in parts[:3])
                    return _OUI.get(norm)

                entries = []
                try:
                    # macOS: arp -an (-n skips DNS reverse lookup, much faster)
                    r = _sp2.run(['arp', '-an'], capture_output=True, text=True, timeout=5)
                    if r.returncode == 0:
                        for line in r.stdout.splitlines():
                            # Format: hostname (ip) at mac on iface
                            m = _re2.match(
                                r'^(\S+)\s+\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+(\S+)\s+on\s+(\S+)',
                                line)
                            if m:
                                hostname, ip, mac, iface = m.groups()
                                if mac == '(incomplete)' or ip.startswith('127.') or ip.endswith('.255'):
                                    continue
                                if ip.startswith('224.') or ip.startswith('239.'):
                                    continue
                                entries.append({
                                    "ip": ip,
                                    "mac": mac if mac != '(incomplete)' else None,
                                    "hostname": hostname if hostname != '?' else None,
                                    "interface": iface,
                                    "vendor": _oui_vendor(mac),
                                })
                except Exception:
                    pass
                if not entries:
                    try:
                        # Linux: ip neigh
                        r = _sp2.run(['ip', 'neigh'], capture_output=True, text=True, timeout=5)
                        if r.returncode == 0:
                            for line in r.stdout.splitlines():
                                parts = line.split()
                                if len(parts) >= 5 and parts[2] == 'dev':
                                    ip = parts[0]
                                    iface = parts[3] if len(parts) > 3 else ''
                                    mac = parts[4] if len(parts) > 4 else None
                                    state = parts[-1] if parts else ''
                                    if ip.startswith('127.') or state in ('FAILED', 'INCOMPLETE'):
                                        continue
                                    entries.append({
                                        "ip": ip,
                                        "mac": mac,
                                        "hostname": None,
                                        "interface": iface,
                                        "vendor": _oui_vendor(mac),
                                    })
                    except Exception:
                        pass
                _json_response(self, {"entries": entries, "count": len(entries)}, 200)

            elif path == "/api/cameras/test-stream":
                from urllib.parse import parse_qs as _pqs3
                import socket as _sock3
                qs3 = _pqs3(urlparse(self.path).query)
                url3 = qs3.get("url", [""])[0]
                if not url3:
                    _json_response(self, {"error": "url required"}, 400)
                    return
                parsed3 = urlparse(url3)
                host3 = parsed3.hostname or ""
                port3 = parsed3.port or 554
                ok3 = False
                latency3 = None
                detail3 = ""
                try:
                    t0 = time.time()
                    with _sock3.create_connection((host3, port3), timeout=5) as s:
                        latency3 = int((time.time() - t0) * 1000)
                        # Send RTSP OPTIONS
                        req = (f"OPTIONS {url3} RTSP/1.0\r\n"
                               f"CSeq: 1\r\nUser-Agent: VenueScope/1.0\r\n\r\n")
                        s.sendall(req.encode())
                        s.settimeout(4)
                        resp = s.recv(2048).decode('utf-8', errors='ignore')
                        if 'RTSP/1.0 200' in resp:
                            ok3 = True
                            detail3 = "Stream OK"
                        elif 'RTSP/1.0 401' in resp:
                            ok3 = True   # auth required but stream exists
                            detail3 = "Auth required (stream exists)"
                        elif 'RTSP/1.0' in resp:
                            detail3 = resp.split('\r\n')[0]
                        else:
                            detail3 = "No RTSP response"
                except Exception as e3:
                    detail3 = str(e3).split("]")[-1].strip()
                _json_response(self, {
                    "url": url3, "ok": ok3, "latency_ms": latency3, "detail": detail3
                }, 200)

            elif path == "/forecast/tonight":
                data, status = _forecast_service.handle_request(
                    method="GET",
                    path=path,
                    query_string=parsed.query,
                    body={},
                )
                _json_response(self, data, status)

            elif path == "/api/cameras/subnet-scan":
                # Scan a /24 (or smaller) subnet for devices with open camera ports
                import socket as _sock2, concurrent.futures as _cf
                import ipaddress as _ipm2
                from urllib.parse import parse_qs as _pqs2
                qs2 = _pqs2(urlparse(self.path).query)
                subnet_str = qs2.get("subnet", ["192.168.1.0/24"])[0]
                ports_raw  = qs2.get("ports",  ["554,80,8554,443"])[0]
                scan_ports = [int(p) for p in ports_raw.split(",")
                              if p.strip().isdigit()][:8]

                try:
                    network2 = _ipm2.ip_network(subnet_str, strict=False)
                except ValueError as ve:
                    _json_response(self, {"error": f"Invalid subnet: {ve}"}, 400)
                    return

                if network2.num_addresses > 256:
                    _json_response(self,
                        {"error": "Subnet too large — use /24 or smaller"}, 400)
                    return

                hosts_list = [str(h) for h in network2.hosts()]

                def _probe(ip):
                    open_p = {}
                    for p in scan_ports:
                        try:
                            t0 = time.time()
                            with _sock2.create_connection((ip, p), timeout=0.5):
                                open_p[str(p)] = int((time.time() - t0) * 1000)
                        except Exception:
                            pass
                    if not open_p:
                        return None
                    return {
                        "ip": ip,
                        "ports": open_p,
                        "is_camera": "554" in open_p or "8554" in open_p,
                    }

                with _cf.ThreadPoolExecutor(max_workers=64) as _ex:
                    raw2 = list(_ex.map(_probe, hosts_list))

                found2 = [r for r in raw2 if r is not None]
                # Sort: cameras first, then by IP
                found2.sort(key=lambda x: (not x["is_camera"],
                            tuple(int(o) for o in x["ip"].split("."))))
                _json_response(self, {
                    "subnet": subnet_str,
                    "scanned": len(hosts_list),
                    "found": found2,
                }, 200)

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
