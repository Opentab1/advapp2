#!/usr/bin/env python3
"""
NVR Watchdog — auto-detects when a venue's NVR endpoint has changed
(port rotation, IP reassignment, modem reboot) and rewrites the
cameras' rtspUrl in DynamoDB so the worker picks up the new endpoint
within ~30s of the next retry cycle.

Architecture:
  - Runs as a separate systemd service alongside venuescope-worker
  - Polls every CHECK_INTERVAL seconds (default 60)
  - For each venue with cameras:
      1. Group cameras by host (parse from rtspUrl)
      2. Live-probe ONE camera per host with HEAD/GET
      3. If probe fails for >FAILURE_THRESHOLD consecutive checks,
         trigger discovery
      4. Discovery: TCP+HTTP scan candidate ports on the same host
         (DNS resolved, supports DDNS hostnames). Optional fallback
         hostname if the venue record carries one (nvrHostname).
      5. On match, rewrite all cameras for that host in DDB
  - Emits structured logs to journald so the existing accuracy dashboard
    + alert pipeline can surface "NVR endpoint changed" events.

The actual scanning is delegated to core/nvr_discovery.py for testability.
"""

from __future__ import annotations
import os
import sys
import time
import json
import socket
import logging
import signal
from pathlib import Path
from typing import Dict, List, Optional, Tuple

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from core.nvr_discovery import (  # noqa: E402
    discover_port,
    parse_endpoint_from_url,
    rewrite_url_with_endpoint,
)

# ── Config ──────────────────────────────────────────────────────────────
CHECK_INTERVAL_SEC      = int(os.environ.get("VS_NVR_WATCHDOG_INTERVAL", "60"))
FAILURE_THRESHOLD       = int(os.environ.get("VS_NVR_WATCHDOG_FAIL_AFTER", "2"))   # consecutive failed checks
PROBE_TIMEOUT_SEC       = float(os.environ.get("VS_NVR_WATCHDOG_PROBE_TIMEOUT", "4.0"))
DDB_REGION              = os.environ.get("AWS_REGION", "us-east-2")
CAMERAS_TABLE           = os.environ.get("VS_CAMERAS_TABLE", "VenueScopeCameras")
VENUES_TABLE            = os.environ.get("VS_VENUES_TABLE",  "VenueScopeVenues")

# Structured logging (matches worker_daemon style)
logging.basicConfig(
    level=logging.INFO,
    format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":%(message)s}',
    datefmt='%Y-%m-%dT%H:%M:%SZ',
)
log = logging.getLogger("nvr_watchdog")

# Per-host failure counter (host => consecutive failures)
_failures: Dict[str, int] = {}
# host => last port seen working. Persists across DDB rewrites so the next
# discovery starts with the smartest hint (current code does cached_port
# first in _iter_priority_ports, ahead of the dead prev_port).
_last_known_port: Dict[str, int] = {}
_last_recovery_at: Dict[str, float] = {}  # cooldown so we don't re-scan repeatedly

# Don't re-scan a host within this many seconds of a successful or attempted scan.
_RECOVERY_COOLDOWN_SEC = 300


def _safe_log(level: str, msg: str, **fields):
    """Emit a JSON-safe structured log line."""
    payload = {"event": msg, **fields}
    getattr(log, level.lower())(json.dumps(payload, default=str))


def _probe_camera_alive(url: str, timeout: float = PROBE_TIMEOUT_SEC) -> bool:
    """Quick reachability probe — does the camera respond to a TCP connect?
    We avoid pulling actual frame data; the worker handles that."""
    host, port, _ = parse_endpoint_from_url(url)
    if not host or not port:
        return False
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _get_ddb():
    """Lazily import boto3 + return a DynamoDB client."""
    import boto3
    return boto3.client("dynamodb", region_name=DDB_REGION)


def _scan_cameras(ddb) -> List[dict]:
    """Return all enabled camera records as raw DDB items."""
    items = []
    paginator = ddb.get_paginator("scan")
    for page in paginator.paginate(TableName=CAMERAS_TABLE):
        for it in page.get("Items", []):
            if it.get("enabled", {}).get("BOOL", True):
                items.append(it)
    return items


def _venue_hostname(ddb, venue_id: str) -> Optional[str]:
    """Optional DDNS override on the venue record (e.g. blindgoat.duckdns.org)."""
    try:
        r = ddb.get_item(
            TableName=VENUES_TABLE,
            Key={"venueId": {"S": venue_id}},
        )
        item = r.get("Item") or {}
        host = item.get("nvrHostname", {}).get("S", "").strip()
        return host or None
    except Exception as e:
        _safe_log("warning", "venue_lookup_failed", venueId=venue_id, error=str(e))
        return None


def _group_cameras_by_endpoint(cams: List[dict]) -> Dict[str, List[dict]]:
    """Bucket cameras by their host:port so we only probe + scan once per
    NVR (the typical setup is one NVR serving many cameras)."""
    groups: Dict[str, List[dict]] = {}
    for cam in cams:
        url = cam.get("rtspUrl", {}).get("S", "")
        host, port, _ = parse_endpoint_from_url(url)
        if not host or not port:
            continue
        key = f"{host}:{port}"
        groups.setdefault(key, []).append(cam)
    return groups


def _rewrite_cameras_in_ddb(ddb, cams: List[dict], new_host: str, new_port: int) -> int:
    """Update each camera's rtspUrl in place. Returns count updated."""
    updated = 0
    for cam in cams:
        old_url = cam.get("rtspUrl", {}).get("S", "")
        new_url = rewrite_url_with_endpoint(old_url, new_host, new_port)
        if new_url == old_url:
            continue
        cam_id   = cam["cameraId"]["S"]
        venue_id = cam["venueId"]["S"]
        try:
            ddb.update_item(
                TableName=CAMERAS_TABLE,
                Key={"cameraId": {"S": cam_id}, "venueId": {"S": venue_id}},
                UpdateExpression="SET rtspUrl = :u",
                ExpressionAttributeValues={":u": {"S": new_url}},
            )
            updated += 1
        except Exception as e:
            _safe_log("error", "ddb_update_failed", cameraId=cam_id, error=str(e))
    return updated


def _check_endpoint(ddb, endpoint: str, cams: List[dict]) -> None:
    """Probe an endpoint, escalate to discovery if persistently failing."""
    # Use the first camera's URL to probe — they all share the same host:port.
    sample_url  = cams[0].get("rtspUrl", {}).get("S", "")
    host_only, port_only, sample_path = parse_endpoint_from_url(sample_url)
    sample_path = sample_path or "/"
    if _probe_camera_alive(sample_url):
        if _failures.get(endpoint):
            _safe_log("info", "endpoint_recovered", endpoint=endpoint,
                      previousFailures=_failures[endpoint])
        _failures[endpoint] = 0
        # Cache last-known good port per host for future discovery hints
        if host_only and port_only:
            _last_known_port[host_only] = port_only
        return

    _failures[endpoint] = _failures.get(endpoint, 0) + 1
    fails = _failures[endpoint]
    _safe_log("warning", "endpoint_unreachable",
              endpoint=endpoint, consecutiveFailures=fails, sampleCameras=len(cams))

    if fails < FAILURE_THRESHOLD:
        return  # not yet escalating

    # Cooldown: don't re-scan if we just tried.
    now = time.time()
    last = _last_recovery_at.get(endpoint, 0)
    if now - last < _RECOVERY_COOLDOWN_SEC:
        _safe_log("info", "discovery_in_cooldown", endpoint=endpoint,
                  secondsUntilRetry=int(_RECOVERY_COOLDOWN_SEC - (now - last)))
        return

    # Trigger discovery
    host, port, _ = parse_endpoint_from_url(sample_url)
    if not host:
        return
    venue_id = cams[0].get("venueId", {}).get("S", "")

    # Optional DDNS hostname override on the venue
    ddns_host = _venue_hostname(ddb, venue_id) if venue_id else None
    scan_host = ddns_host or host

    _safe_log("info", "discovery_started",
              endpoint=endpoint, scanHost=scan_host, prevPort=port,
              ddnsHostname=ddns_host)

    _last_recovery_at[endpoint] = now
    cached_hint = _last_known_port.get(host)
    t0 = time.time()
    new_port = discover_port(
        scan_host,
        sample_path,
        prev_port=port,
        cached_port=cached_hint,
        max_workers=200,
        open_timeout=1.0,
        probe_timeout=4.0,
    )
    elapsed = time.time() - t0

    if not new_port:
        _safe_log("error", "discovery_failed",
                  endpoint=endpoint, scanHost=scan_host,
                  scanSeconds=round(elapsed, 1))
        return

    # Rewrite all cameras with the new (host, port). Use scan_host so DDNS
    # resolves consistently even if the underlying IP shifts.
    n_updated = _rewrite_cameras_in_ddb(ddb, cams, scan_host, new_port)

    _safe_log("info", "discovery_succeeded",
              endpoint=endpoint, scanHost=scan_host, oldPort=port,
              newPort=new_port, scanSeconds=round(elapsed, 1),
              camerasUpdated=n_updated)

    # Cache + reset
    _last_known_port[host] = new_port
    _failures[endpoint] = 0


def _tick(ddb) -> None:
    """One pass over all cameras."""
    cams = _scan_cameras(ddb)
    groups = _group_cameras_by_endpoint(cams)
    for endpoint, group in groups.items():
        try:
            _check_endpoint(ddb, endpoint, group)
        except Exception as e:
            _safe_log("error", "check_endpoint_exception",
                      endpoint=endpoint, error=str(e))


# ── Main loop + signal handling ─────────────────────────────────────────
_stop = False

def _sigterm(*_):
    global _stop
    _stop = True


def main() -> int:
    signal.signal(signal.SIGTERM, _sigterm)
    signal.signal(signal.SIGINT, _sigterm)
    _safe_log("info", "watchdog_started",
              checkInterval=CHECK_INTERVAL_SEC,
              failureThreshold=FAILURE_THRESHOLD)
    ddb = _get_ddb()
    while not _stop:
        try:
            _tick(ddb)
        except Exception as e:
            _safe_log("error", "tick_exception", error=str(e))
        # Sleep in 1s slices so SIGTERM is honored quickly
        for _ in range(CHECK_INTERVAL_SEC):
            if _stop:
                break
            time.sleep(1)
    _safe_log("info", "watchdog_stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
