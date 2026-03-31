"""
VenueScope — Venue Network Setup (Tailscale)
"""
import os, sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import streamlit as st
st.set_page_config(page_title="Network Setup — VenueScope", page_icon="🔗", layout="wide")

from core.tailscale import vps_tailscale_ip, ping_device

AUTHKEY    = os.environ.get("TAILSCALE_AUTHKEY", "")
CALLBACK   = "https://137-184-61-178.sslip.io/venue-connected"
DASHBOARD  = "https://137-184-61-178.sslip.io"


def make_mac_script(venue_name: str) -> bytes:
    return f"""#!/bin/bash
clear
echo "========================================"
echo "  VenueScope Camera Setup"
echo "========================================"
echo ""
echo "This will connect your cameras to VenueScope."
echo "It takes about 30 seconds."
echo ""

# Install Tailscale if not present
if ! command -v tailscale &>/dev/null; then
    echo "Step 1/2 — Installing Tailscale..."
    curl -fsSL https://tailscale.com/install.sh | sh
    echo ""
fi

echo "Step 2/2 — Connecting to VenueScope network..."
sudo tailscale up --authkey={AUTHKEY} --hostname=venue-cameras --accept-routes 2>/dev/null

MYIP=$(tailscale ip -4 2>/dev/null || echo "unknown")

# Phone home — notify VenueScope automatically
curl -s "{CALLBACK}?ip=$MYIP&hostname=venue-cameras&venue={venue_name}" >/dev/null 2>&1 || true

clear
echo "========================================"
echo "  ALL DONE! Cameras connected."
echo "========================================"
echo ""
echo "  Please send this number to your"
echo "  VenueScope contact:"
echo ""
echo "  >>> YOUR IP: $MYIP <<<"
echo ""
echo "  That's all you need to do."
echo "========================================"
echo ""
read -p "Press Enter to close this window..."
""".encode()


def make_linux_script(venue_name: str) -> bytes:
    return f"""#!/bin/bash
clear
echo "========================================"
echo "  VenueScope Camera Setup"
echo "========================================"
echo ""

if ! command -v tailscale &>/dev/null; then
    echo "Installing Tailscale..."
    curl -fsSL https://tailscale.com/install.sh | sh
fi

echo "Connecting to VenueScope network..."
sudo tailscale up --authkey={AUTHKEY} --hostname=venue-cameras --accept-routes 2>/dev/null

MYIP=$(tailscale ip -4 2>/dev/null || echo "unknown")

curl -s "{CALLBACK}?ip=$MYIP&hostname=venue-cameras&venue={venue_name}" >/dev/null 2>&1 || true

clear
echo "========================================"
echo "  ALL DONE! Cameras connected."
echo "  VenueScope notified automatically."
echo "========================================"
""".encode()


def make_windows_script(venue_name: str) -> bytes:
    return f"""@echo off
cls
echo ========================================
echo   VenueScope Camera Setup
echo ========================================
echo.
echo This connects your cameras to VenueScope.
echo It takes about 30 seconds.
echo.

where tailscale >nul 2>&1
if %errorlevel% neq 0 (
    echo Tailscale is not installed.
    echo.
    echo Opening the Tailscale installer now...
    start https://tailscale.com/download/windows
    echo.
    echo Please install Tailscale, then double-click
    echo this file again.
    echo.
    pause
    exit /b 1
)

echo Connecting to VenueScope network...
tailscale up --authkey={AUTHKEY} --hostname=venue-cameras --accept-routes

for /f "tokens=*" %%i in ('tailscale ip -4 2^>nul') do set MYIP=%%i

curl -s "{CALLBACK}?ip=%MYIP%&hostname=venue-cameras&venue={venue_name}" >nul 2>&1

cls
echo ========================================
echo   ALL DONE! Cameras connected.
echo ========================================
echo.
echo   Please send this number to your
echo   VenueScope contact:
echo.
echo   ^>^>^> YOUR IP: %MYIP% ^<^<^<
echo.
echo   That's all you need to do.
echo ========================================
pause
""".encode()


# ── Page ──────────────────────────────────────────────────────────────────────
st.markdown("## 🔗 Venue Network Setup")
st.markdown("Send a setup file to the venue — they double-click it and you get an email when it's done.")
st.divider()

# ── Venue name ────────────────────────────────────────────────────────────────
venue_name = st.text_input(
    "Venue name",
    placeholder="e.g. The Blind Goat",
    help="Used to identify this venue in the notification email"
)

st.markdown("### Select the venue's operating system")

col1, col2, col3 = st.columns(3)
platform = st.session_state.get("platform")

with col1:
    if st.button("🍎  Mac", use_container_width=True,
                 type="primary" if platform == "mac" else "secondary"):
        st.session_state["platform"] = "mac"
        st.rerun()
with col2:
    if st.button("🪟  Windows", use_container_width=True,
                 type="primary" if platform == "windows" else "secondary"):
        st.session_state["platform"] = "windows"
        st.rerun()
with col3:
    if st.button("🐧  Linux", use_container_width=True,
                 type="primary" if platform == "linux" else "secondary"):
        st.session_state["platform"] = "linux"
        st.rerun()

platform = st.session_state.get("platform")

if platform:
    st.markdown("<br>", unsafe_allow_html=True)
    vname = venue_name.strip().replace(" ", "_") or "venue"

    if platform == "mac":
        file_bytes = make_mac_script(vname)
        filename   = "connect-venuescope.command"
        instructions = [
            "Email or AirDrop this file to the venue",
            "They double-click it — Terminal opens and connects automatically",
            "The terminal will show their <b>Tailscale IP</b> (looks like 100.x.x.x) — ask them to send you a screenshot or text it to you",
        ]
    elif platform == "windows":
        file_bytes = make_windows_script(vname)
        filename   = "connect-venuescope.bat"
        instructions = [
            "Email this file to the venue",
            "They double-click it — connects automatically (installs Tailscale if needed)",
            "The window will show their <b>Tailscale IP</b> (looks like 100.x.x.x) — ask them to send you a screenshot or text it to you",
        ]
    else:
        file_bytes = make_linux_script(vname)
        filename   = "connect-venuescope.sh"
        instructions = [
            "Send this file to the venue",
            "They run: chmod +x connect-venuescope.sh && ./connect-venuescope.sh",
            "The terminal will show their <b>Tailscale IP</b> (looks like 100.x.x.x) — ask them to send you a screenshot or text it to you",
        ]

    st.download_button(
        label="⬇️  Download Setup File",
        data=file_bytes,
        file_name=filename,
        mime="application/octet-stream",
        use_container_width=True,
        type="primary",
    )

    st.markdown("<br>", unsafe_allow_html=True)
    for i, step in enumerate(instructions, 1):
        st.markdown(f"""
        <div style='display:flex;gap:12px;margin-bottom:10px;align-items:center'>
            <div style='background:#f97316;color:white;border-radius:50%;min-width:28px;height:28px;
                        display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px'>{i}</div>
            <div style='background:#1e293b;border-radius:8px;padding:10px 14px;flex:1;
                        color:#f1f5f9;font-size:14px'>{step}</div>
        </div>
        """, unsafe_allow_html=True)

    st.divider()

    # ── Recent connections ────────────────────────────────────────────────────
    st.markdown("### Recent venue connections")
    conn_file = Path(__file__).resolve().parent.parent.parent / "data" / "configs" / "tailscale_connections.json"
    if conn_file.exists():
        try:
            connections = json.loads(conn_file.read_text())
            if connections:
                import pandas as pd, time
                rows = [{
                    "Venue":    c.get("venue", "—"),
                    "IP":       c.get("ip", "—"),
                    "Connected": pd.Timestamp(c["time"], unit="s").strftime("%b %d %H:%M"),
                } for c in reversed(connections[-10:])]
                st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
            else:
                st.caption("No venues connected yet.")
        except Exception:
            st.caption("No venues connected yet.")
    else:
        st.caption("No venues connected yet.")

    # ── Manual connection test ────────────────────────────────────────────────
    with st.expander("Manually test a connection"):
        c1, c2 = st.columns([2, 1])
        with c1:
            device_ip = st.text_input("Venue's Tailscale IP", placeholder="100.x.x.x")
        with c2:
            st.markdown("<br>", unsafe_allow_html=True)
            if st.button("🔍 Test", use_container_width=True):
                if device_ip:
                    with st.spinner("Pinging..."):
                        ok = ping_device(device_ip)
                    if ok:
                        st.success(f"✓ {device_ip} reachable")
                    else:
                        st.error(f"✗ Can't reach {device_ip}")
                else:
                    st.warning("Enter an IP first")
