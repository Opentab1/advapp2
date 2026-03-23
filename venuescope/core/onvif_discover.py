"""
VenueScope — ONVIF camera discovery.

Two-phase process:
  1. WS-Discovery: UDP multicast probe to 239.255.255.250:3702 to find ONVIF
     devices on the local network (no credentials required).
  2. ONVIF SOAP: GetProfiles + GetStreamUri to retrieve the RTSP URL for each
     device (requires username/password if the camera has auth enabled).

No third-party ONVIF library required — uses raw sockets + stdlib XML parsing.

Usage:
    from core.onvif_discover import discover_cameras, get_rtsp_url

    # Find all ONVIF cameras on the network (no credentials)
    cameras = discover_cameras(timeout=3.0)
    # [{"ip": "192.168.1.42", "xaddrs": ["http://192.168.1.42/onvif/device_service"]}]

    # Get RTSP URL for a specific camera
    url = get_rtsp_url("192.168.1.42", username="admin", password="pass123")
    # "rtsp://192.168.1.42:554/Streaming/Channels/101"
"""
from __future__ import annotations

import socket
import struct
import uuid
import logging
import re
from typing import Optional
from xml.etree import ElementTree as ET

try:
    import urllib.request as _urllib_req
    import urllib.error as _urllib_err
except ImportError:
    _urllib_req = None  # type: ignore

log = logging.getLogger("onvif_discover")

# WS-Discovery multicast address and port (ONVIF standard)
_WSD_ADDR = "239.255.255.250"
_WSD_PORT = 3702
_WSD_TTL  = 2

# WS-Discovery probe message template
_WSD_PROBE = """\
<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope
  xmlns:e="http://www.w3.org/2003/05/soap-envelope"
  xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
  xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:{msg_id}</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>"""

# ONVIF SOAP GetProfiles template
_SOAP_GET_PROFILES = """\
<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope
  xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
  <s:Header>{auth_header}</s:Header>
  <s:Body>
    <trt:GetProfiles/>
  </s:Body>
</s:Envelope>"""

# ONVIF SOAP GetStreamUri template
_SOAP_GET_STREAM_URI = """\
<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope
  xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
  xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Header>{auth_header}</s:Header>
  <s:Body>
    <trt:GetStreamUri>
      <trt:StreamSetup>
        <tt:Stream>RTP-Unicast</tt:Stream>
        <tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>
      </trt:StreamSetup>
      <trt:ProfileToken>{profile_token}</trt:ProfileToken>
    </trt:GetStreamUri>
  </s:Body>
</s:Envelope>"""

_NS = {
    "d":   "http://schemas.xmlsoap.org/ws/2005/04/discovery",
    "a":   "http://schemas.xmlsoap.org/ws/2004/08/addressing",
    "e":   "http://www.w3.org/2003/05/soap-envelope",
    "trt": "http://www.onvif.org/ver10/media/wsdl",
    "tt":  "http://www.onvif.org/ver10/schema",
}


# ── WS-Discovery ──────────────────────────────────────────────────────────────

def discover_cameras(timeout: float = 3.0, iface_ip: Optional[str] = None) -> list[dict]:
    """
    Broadcast a WS-Discovery probe and collect ProbeMatch responses.

    Returns list of dicts:
        {"ip": str, "xaddrs": [str], "types": str, "name": str}

    ``xaddrs`` contains the ONVIF device service URLs (e.g.
    "http://192.168.1.42/onvif/device_service").  Pass the first one to
    ``get_rtsp_url()``.
    """
    msg_id = str(uuid.uuid4())
    probe  = _WSD_PROBE.format(msg_id=msg_id).encode("utf-8")

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, _WSD_TTL)
    if iface_ip:
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF,
                        socket.inet_aton(iface_ip))
    sock.settimeout(timeout)

    results: dict[str, dict] = {}  # ip → entry (dedup)

    try:
        sock.sendto(probe, (_WSD_ADDR, _WSD_PORT))
        deadline = __import__("time").time() + timeout
        while True:
            remaining = deadline - __import__("time").time()
            if remaining <= 0:
                break
            sock.settimeout(remaining)
            try:
                data, addr = sock.recvfrom(65535)
            except socket.timeout:
                break
            ip = addr[0]
            entry = _parse_probe_match(data, ip)
            if entry and ip not in results:
                results[ip] = entry
                log.info(f"[onvif] Found camera at {ip}: {entry.get('name', 'unknown')}")
    except OSError as e:
        log.warning(f"[onvif] Discovery socket error: {e}")
    finally:
        sock.close()

    return list(results.values())


def _parse_probe_match(data: bytes, ip: str) -> Optional[dict]:
    """Parse a WS-Discovery ProbeMatch response."""
    try:
        root = ET.fromstring(data.decode("utf-8", errors="replace"))
    except ET.ParseError:
        return None

    # Find XAddrs — the ONVIF service URLs
    xaddrs_el = root.find(".//{%s}XAddrs" % _NS["d"])
    if xaddrs_el is None or not xaddrs_el.text:
        return None
    xaddrs = xaddrs_el.text.strip().split()

    types_el = root.find(".//{%s}Types" % _NS["d"])
    types_str = types_el.text.strip() if types_el is not None and types_el.text else ""

    # Try to extract a friendly name from the endpoint reference
    name_el = root.find(".//{%s}Address" % _NS["a"])
    name = name_el.text.strip() if name_el is not None and name_el.text else ip

    return {"ip": ip, "xaddrs": xaddrs, "types": types_str, "name": name}


# ── ONVIF SOAP helpers ────────────────────────────────────────────────────────

def _wsse_header(username: str, password: str) -> str:
    """Build a WS-Security UsernameToken header (PasswordText — simplest form)."""
    if not username:
        return ""
    # Escape XML special chars
    u = username.replace("&", "&amp;").replace("<", "&lt;")
    p = password.replace("&", "&amp;").replace("<", "&lt;")
    return (
        '<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/'
        'oasis-200401-wss-wssecurity-secext-1.0.xsd">'
        "<wsse:UsernameToken>"
        f"<wsse:Username>{u}</wsse:Username>"
        f'<wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/'
        f'oasis-200401-wss-username-token-profile-1.0#PasswordText">{p}</wsse:Password>'
        "</wsse:UsernameToken>"
        "</wsse:Security>"
    )


def _soap_post(url: str, body: str, timeout: float = 5.0) -> Optional[bytes]:
    """Send a SOAP POST and return the response bytes, or None on error."""
    if _urllib_req is None:
        log.error("[onvif] urllib not available")
        return None
    data = body.encode("utf-8")
    req  = _urllib_req.Request(
        url,
        data=data,
        headers={
            "Content-Type": 'application/soap+xml; charset=utf-8',
            "Content-Length": str(len(data)),
        },
    )
    try:
        with _urllib_req.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except _urllib_err.HTTPError as e:
        # Some cameras return 400 with useful body — read it anyway
        try:
            return e.read()
        except Exception:
            pass
        log.warning(f"[onvif] HTTP {e.code} from {url}")
        return None
    except Exception as e:
        log.warning(f"[onvif] SOAP request to {url} failed: {e}")
        return None


def _find_media_url(xaddrs: list[str]) -> Optional[str]:
    """
    Given a list of ONVIF xaddrs, derive the media service URL.
    ONVIF cameras typically expose it at /onvif/media_service or /onvif/Media.
    """
    for xaddr in xaddrs:
        # Replace 'device_service' or 'Device' with 'media_service'
        candidate = re.sub(r"(?i)(device[_\-]?service|device)", "media_service", xaddr)
        if candidate != xaddr:
            return candidate
        # Fallback: strip path and append standard path
        m = re.match(r"(https?://[^/]+)", xaddr)
        if m:
            return m.group(1) + "/onvif/media_service"
    return None


def get_rtsp_url(
    ip_or_xaddr: str,
    username: str = "",
    password: str = "",
    xaddrs: Optional[list[str]] = None,
    timeout: float = 5.0,
) -> Optional[str]:
    """
    Connect to an ONVIF camera and retrieve its primary RTSP stream URL.

    Args:
        ip_or_xaddr: Either an IP address (e.g. "192.168.1.42") or a full
                     xaddr URL from WS-Discovery.
        username:    Camera username (leave empty if no auth).
        password:    Camera password.
        xaddrs:      xaddrs list from discover_cameras() — speeds up lookup.
        timeout:     HTTP timeout in seconds.

    Returns:
        RTSP URL string, or None if the camera could not be reached.
    """
    # Determine the media service URL
    if ip_or_xaddr.startswith("http"):
        media_url = _find_media_url([ip_or_xaddr])
    elif xaddrs:
        media_url = _find_media_url(xaddrs)
    else:
        # Guess common paths
        media_url = f"http://{ip_or_xaddr}/onvif/media_service"

    if not media_url:
        log.warning(f"[onvif] Could not determine media service URL for {ip_or_xaddr}")
        return None

    auth_hdr = _wsse_header(username, password)

    # Step 1: GetProfiles
    profiles_resp = _soap_post(
        media_url,
        _SOAP_GET_PROFILES.format(auth_header=auth_hdr),
        timeout=timeout,
    )
    if not profiles_resp:
        # Try alternate media URL paths
        for path in ["/onvif/Media", "/onvif/media", "/onvif/services"]:
            alt = re.sub(r"(https?://[^/]+).*", r"\1" + path, media_url)
            profiles_resp = _soap_post(
                alt, _SOAP_GET_PROFILES.format(auth_header=auth_hdr), timeout=timeout
            )
            if profiles_resp:
                media_url = alt
                break

    if not profiles_resp:
        log.warning(f"[onvif] GetProfiles failed for {ip_or_xaddr}")
        return None

    profile_token = _extract_profile_token(profiles_resp)
    if not profile_token:
        log.warning(f"[onvif] No profiles found for {ip_or_xaddr}")
        return None

    # Step 2: GetStreamUri
    stream_resp = _soap_post(
        media_url,
        _SOAP_GET_STREAM_URI.format(auth_header=auth_hdr, profile_token=profile_token),
        timeout=timeout,
    )
    if not stream_resp:
        log.warning(f"[onvif] GetStreamUri failed for {ip_or_xaddr}")
        return None

    rtsp_url = _extract_rtsp_uri(stream_resp)
    if rtsp_url:
        # Inject credentials into the RTSP URL if provided
        if username and "://" in rtsp_url and "@" not in rtsp_url:
            rtsp_url = rtsp_url.replace(
                "rtsp://",
                f"rtsp://{_url_encode(username)}:{_url_encode(password)}@",
            )
        log.info(f"[onvif] Got RTSP URL for {ip_or_xaddr}: {_mask_url(rtsp_url)}")
    return rtsp_url


def _extract_profile_token(data: bytes) -> Optional[str]:
    """Extract the first profile token from a GetProfiles response."""
    try:
        root = ET.fromstring(data.decode("utf-8", errors="replace"))
    except ET.ParseError:
        return None
    # Look for token attribute on Profile elements
    for el in root.iter():
        if el.tag.endswith("}Profiles") or el.tag.endswith("}Profile"):
            tok = el.get("token")
            if tok:
                return tok
    return None


def _extract_rtsp_uri(data: bytes) -> Optional[str]:
    """Extract the RTSP URI from a GetStreamUri response."""
    try:
        root = ET.fromstring(data.decode("utf-8", errors="replace"))
    except ET.ParseError:
        return None
    for el in root.iter():
        if el.tag.endswith("}Uri") and el.text and el.text.startswith("rtsp://"):
            return el.text.strip()
    return None


def _url_encode(s: str) -> str:
    """Percent-encode special characters for use in a URL authority."""
    import urllib.parse
    return urllib.parse.quote(s, safe="")


def _mask_url(url: str) -> str:
    """Replace password in URL with *** for logging."""
    return re.sub(r"(rtsp://[^:]+:)[^@]+(@)", r"\1***\2", url)


# ── USB / local camera scan ───────────────────────────────────────────────────

def scan_usb_cameras(max_index: int = 8) -> list[dict]:
    """
    Try cv2.VideoCapture(0..max_index) and return indices that open successfully.
    Returns list of {"index": int, "source_path": str, "name": str}.
    """
    results = []
    try:
        import cv2
    except ImportError:
        log.warning("[onvif] opencv not available — USB scan skipped")
        return results

    for i in range(max_index + 1):
        cap = cv2.VideoCapture(i)
        if cap.isOpened():
            ret, _ = cap.read()
            cap.release()
            if ret:
                results.append({
                    "index":       i,
                    "source_path": str(i),
                    "name":        f"USB Camera {i}",
                })
                log.info(f"[onvif] USB camera found at index {i}")
    return results
