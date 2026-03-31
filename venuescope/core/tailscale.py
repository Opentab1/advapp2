"""
VenueScope — Tailscale helpers.
Generates venue onboarding commands and checks connectivity.
"""
import os, subprocess
from typing import Optional


AUTHKEY = os.environ.get("TAILSCALE_AUTHKEY", "")


def get_install_command(platform: str = "linux") -> str:
    """One-liner for venue owners to run on their NVR/PC."""
    if not AUTHKEY:
        return "# Add TAILSCALE_AUTHKEY to .env first"
    if platform == "linux":
        return (
            f"curl -fsSL https://tailscale.com/install.sh | sh && "
            f"sudo tailscale up --authkey={AUTHKEY} --hostname=venue-cameras"
        )
    elif platform == "windows":
        return (
            f"# 1. Download Tailscale from https://tailscale.com/download/windows\n"
            f"# 2. Install it, then open PowerShell and run:\n"
            f"tailscale up --authkey={AUTHKEY} --hostname=venue-cameras"
        )
    elif platform == "mac":
        return (
            f"curl -fsSL https://tailscale.com/install.sh | sh && "
            f"sudo tailscale up --authkey={AUTHKEY} --hostname=venue-cameras"
        )
    return ""


def vps_tailscale_ip() -> str:
    """Return the VPS Tailscale IP (stored or detected)."""
    return os.environ.get("TAILSCALE_VPS_IP", "100.85.234.116")


def ping_device(tailscale_ip: str, timeout: int = 3) -> bool:
    """Check if a Tailscale device is reachable from VPS."""
    try:
        result = subprocess.run(
            ["ping", "-c", "1", "-W", str(timeout), tailscale_ip],
            capture_output=True, timeout=timeout + 1
        )
        return result.returncode == 0
    except Exception:
        return False


def test_rtsp(rtsp_url: str) -> bool:
    """Quick check if an RTSP stream is reachable."""
    try:
        import cv2
        cap = cv2.VideoCapture(rtsp_url)
        ok = cap.isOpened()
        cap.release()
        return ok
    except Exception:
        return False
