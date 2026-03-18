"""
VenueScope — Credential storage.
RTSP passwords stored separately from main DB, with restricted file permissions.
File is excluded from config backups.
"""
from __future__ import annotations
import json, os, stat
from pathlib import Path
from core.config import CONFIG_DIR

_CRED_FILE = CONFIG_DIR / "credentials.json"


def _load_all() -> dict:
    if not _CRED_FILE.exists():
        return {}
    try:
        return json.loads(_CRED_FILE.read_text())
    except Exception:
        return {}


def _save_all(data: dict) -> None:
    _CRED_FILE.write_text(json.dumps(data, indent=2))
    try:
        # Restrict to owner read/write only (600)
        os.chmod(_CRED_FILE, stat.S_IRUSR | stat.S_IWUSR)
    except Exception:
        pass  # Windows doesn't support chmod — skip silently


def save_credential(camera_id: str, username: str, password: str) -> None:
    data = _load_all()
    data[camera_id] = {"username": username, "password": password}
    _save_all(data)


def load_credential(camera_id: str) -> tuple[str, str]:
    """Returns (username, password). Empty strings if not found."""
    data = _load_all()
    rec  = data.get(camera_id, {})
    return rec.get("username", ""), rec.get("password", "")


def delete_credential(camera_id: str) -> None:
    data = _load_all()
    data.pop(camera_id, None)
    _save_all(data)


def build_rtsp_url(base_url: str, camera_id: str) -> str:
    """
    Reconstruct full RTSP URL with credentials injected.
    base_url may be stored without credentials (rtsp://host:port/path)
    or already have them (rtsp://user:pass@host — returned as-is).
    """
    if not base_url:
        return base_url
    username, password = load_credential(camera_id)
    if not username and not password:
        return base_url  # no stored credentials — use URL as-is
    # Already has credentials embedded — don't double-inject
    if "@" in base_url.split("://", 1)[-1]:
        return base_url
    proto, rest = base_url.split("://", 1)
    return f"{proto}://{username}:{password}@{rest}"


def strip_credentials(rtsp_url: str) -> tuple[str, str, str]:
    """
    Parse rtsp://user:pass@host:port/path → (clean_url, username, password).
    If no credentials in URL, returns (original_url, "", "").
    """
    if not rtsp_url:
        return rtsp_url, "", ""
    try:
        proto, rest = rtsp_url.split("://", 1)
        if "@" not in rest:
            return rtsp_url, "", ""
        userinfo, hostpath = rest.split("@", 1)
        if ":" in userinfo:
            username, password = userinfo.split(":", 1)
        else:
            username, password = userinfo, ""
        clean = f"{proto}://{hostpath}"
        return clean, username, password
    except Exception:
        return rtsp_url, "", ""
