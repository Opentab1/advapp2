"""
NVR endpoint discovery — find which port the venue's NVR is currently
serving HLS on, even after the external port (or IP) changes.

Triggered by nvr_watchdog when all cameras for a venue have been failing
to connect for more than ~90 seconds. Returns the new port (or None if
nothing matches), and the watchdog rewrites the camera URLs in DDB.

Design:
  1. Resolve hostname → IP (handles Dynamic DNS like duckdns.org)
  2. Try the previous port first (cheap, sometimes the box just came back)
  3. Sweep the most likely ranges in priority order:
       a. 8000-9999    (HTTP-style)
       b. 30000-65535  (UPnP ephemeral / CGN range)
       c. 1024-29999   (everything else, last resort)
  4. For each candidate port, do an HTTP GET of the camera's path with a
     1-byte Range header. If we get HTTP 200 + a video content-type, that's
     our service. Use parallel probing (default 200 workers) to keep the
     scan time reasonable.
"""

from __future__ import annotations
import socket
import logging
import re
from typing import Optional, Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

log = logging.getLogger(__name__)

# Priority bands of TCP ports to scan. Ordered by where consumer NVRs
# typically land after UPnP allocation or CGN port mapping. Empirically
# Blind Goat's NVR has used ports 15007 and 58024 — both within the
# common 8000-65535 range, so we sweep that broadly first.
PORT_BANDS: tuple[tuple[int, int], ...] = (
    (8000,  29999),    # most consumer NVR HTTP/HLS allocations land here
    (30000, 65535),    # ephemeral / CGN range
    (1024,  7999),     # less common, last resort
)

# Keywords in the response Content-Type that confirm we hit the HLS service.
_VIDEO_CT_RE = re.compile(r"video/|application/(?:vnd\.apple\.mpegurl|x-mpegurl|octet-stream)", re.I)


def _resolve_host(host: str) -> Optional[str]:
    """Resolve a host (DNS name or IP) to an IPv4 address. Handles DDNS."""
    try:
        return socket.gethostbyname(host)
    except OSError as e:
        log.warning("[nvr_discovery] DNS resolution failed for %s: %s", host, e)
        return None


def _tcp_open(ip: str, port: int, timeout: float = 1.5) -> bool:
    """Cheap TCP connectivity check. Just confirms something accepts SYN."""
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def _probe_hls(ip: str, port: int, path: str, timeout: float = 3.5) -> bool:
    """HTTP GET the HLS path and confirm it returns video content.

    We deliberately use raw sockets rather than `requests` to avoid an
    extra dependency on the discovery hot-path; the HTTP we need is
    trivial (single GET, no auth, no redirects expected).
    """
    request = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {ip}:{port}\r\n"
        f"Range: bytes=0-1024\r\n"
        f"User-Agent: VenueScope-NVR-Discovery/1\r\n"
        f"Connection: close\r\n"
        f"\r\n"
    ).encode()
    try:
        with socket.create_connection((ip, port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            sock.sendall(request)
            chunks = []
            total = 0
            while total < 4096:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
                if b"\r\n\r\n" in b"".join(chunks):
                    break
            head = b"".join(chunks).decode("latin-1", errors="ignore")
    except OSError:
        return False

    # Status check
    first_line = head.split("\r\n", 1)[0] if head else ""
    if " 200" not in first_line and " 206" not in first_line:
        return False
    # Content-Type sniff
    ct_match = re.search(r"^Content-Type:\s*([^\r\n]+)", head, re.I | re.M)
    if not ct_match:
        return False
    return bool(_VIDEO_CT_RE.search(ct_match.group(1)))


def _iter_priority_ports(
    prev_port: Optional[int],
    *,
    cached_port: Optional[int] = None,
    proximity: int = 500,
) -> Iterable[int]:
    """Yield ports to try, in priority order, deduped.

    Order:
      1. cached_port (last successful discovery for this host)
      2. prev_port   (current value in DDB)
      3. ports near cached_port (±proximity)
      4. PORT_BANDS in declared order
    """
    seen: set[int] = set()

    def _emit(p: int):
        if 1 <= p <= 65535 and p not in seen:
            seen.add(p)
            return p
        return None

    for hint in (cached_port, prev_port):
        if hint is not None:
            v = _emit(hint)
            if v is not None:
                yield v

    if cached_port is not None:
        for delta in range(1, proximity + 1):
            for cand in (cached_port - delta, cached_port + delta):
                v = _emit(cand)
                if v is not None:
                    yield v

    for lo, hi in PORT_BANDS:
        for p in range(lo, hi + 1):
            v = _emit(p)
            if v is not None:
                yield v


def discover_port(
    host: str,
    path: str,
    *,
    prev_port: Optional[int] = None,
    cached_port: Optional[int] = None,
    max_workers: int = 200,
    open_timeout: float = 1.2,
    probe_timeout: float = 5.0,
    band_limit: Optional[int] = None,
) -> Optional[int]:
    """Find a port on `host` that serves the given HLS `path` with HTTP 200.

    Two-phase scan:
      Phase 1 — fast TCP-open probe across the candidate port range.
                Filters tens of thousands of ports down to a handful.
      Phase 2 — HTTP GET on each open port, confirm video content-type.

    Args:
        host:          DNS name or IP of the NVR's external endpoint
        path:          Path to probe (e.g. "/hls/live/CH1/0/livetop.mp4")
        prev_port:     The previously-known port — tried first
        max_workers:   Concurrency for Phase 1 TCP probe
        open_timeout:  Per-port timeout for Phase 1
        probe_timeout: Per-port timeout for Phase 2 HTTP GET
        band_limit:    Stop after scanning this many candidate ports.
                       Default None = full sweep. Useful for tests.

    Returns the discovered port, or None if nothing matched.
    """
    ip = _resolve_host(host)
    if not ip:
        return None

    candidates = list(_iter_priority_ports(prev_port, cached_port=cached_port))
    if band_limit:
        candidates = candidates[:band_limit]

    log.info("[nvr_discovery] scanning %s (%s) %d ports — phase 1 (TCP open)",
             host, ip, len(candidates))

    open_ports: list[int] = []
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        future_to_port = {
            ex.submit(_tcp_open, ip, port, open_timeout): port
            for port in candidates
        }
        for fut in as_completed(future_to_port):
            if fut.result():
                open_ports.append(future_to_port[fut])

    log.info("[nvr_discovery] phase 1 found %d open ports — phase 2 (HTTP probe)",
             len(open_ports))

    # Phase 2: HTTP probe. Run in priority order, return first match.
    open_set = set(open_ports)
    for port in candidates:
        if port not in open_set:
            continue
        if _probe_hls(ip, port, path, probe_timeout):
            log.info("[nvr_discovery] MATCH host=%s port=%d path=%s", host, port, path)
            return port

    log.warning("[nvr_discovery] no HLS service found on %s across %d ports",
                host, len(candidates))
    return None


def parse_endpoint_from_url(url: str) -> tuple[Optional[str], Optional[int], Optional[str]]:
    """Pull (host, port, path) out of an rtspUrl/rtspUrl-like field.

    Returns (None, None, None) if the URL is malformed.
    """
    try:
        u = urlparse(url)
        if not u.netloc:
            return None, None, None
        host = u.hostname
        port = u.port
        path = u.path or "/"
        if u.query:
            path = f"{path}?{u.query}"
        return host, port, path
    except (ValueError, AttributeError):
        return None, None, None


def rewrite_url_with_endpoint(url: str, new_host: str, new_port: int) -> str:
    """Rebuild a URL pointing at the same path but a new host:port."""
    u = urlparse(url)
    auth_userinfo = f"{u.username}:{u.password}@" if u.username else ""
    new_netloc = f"{auth_userinfo}{new_host}:{new_port}"
    rebuilt = u._replace(netloc=new_netloc).geturl()
    return rebuilt
