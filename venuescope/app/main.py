"""
VenueScope — Main entry point.
"""
import os, sys
os.environ["YOLO_TELEMETRY"]                      = "False"
os.environ["STREAMLIT_BROWSER_GATHERUSAGESTATS"]  = "false"
os.environ["ULTRALYTICS_AUTOINSTALL"]             = "False"

from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import streamlit as st

st.set_page_config(
    page_title="VenueScope",
    page_icon="🎯",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Patch so child pages calling set_page_config are silently ignored
import streamlit as _st
_orig_spc = _st.set_page_config
def _noop_spc(*a, **kw): pass
_st.set_page_config = _noop_spc

# ── REST API — start once on first load ───────────────────────────────────────
try:
    from app.api import start_api_server
    start_api_server(background=True)
except Exception as _api_err:
    pass  # API optional — Streamlit UI still works without it

# ── Auth ──────────────────────────────────────────────────────────────────────
from core.auth import require_auth, logout
require_auth()

PAGES = {
    "🎯  VenueScope":      "app/pages/00_venuescope.py",
    "🏠  Dashboard":       "app/pages/00_dashboard.py",
    "▶️  Run Analysis":     "app/pages/01_run.py",
    "📊  Results":          "app/pages/02_results.py",
    "🔀  Compare Jobs":     "app/pages/08_compare.py",
    "📋  Unified Report":   "app/pages/07_unified.py",
    "🔑  Shift Setup":      "app/pages/03_shift.py",
    "⚙️  Zone Layout":      "app/pages/04_layout.py",
    "📡  Live Cameras":      "app/pages/05_live.py",
    "🔧  System Check":     "app/pages/05_system.py",
    "⚙️  Settings":          "app/pages/06_settings.py",
}

# ── Sidebar ───────────────────────────────────────────────────────────────────
venue_name = st.session_state.get("venue_name", "") or st.session_state.get("venue_id", "")
email      = st.session_state.get("email", "")
st.sidebar.markdown(f"""
<div style='padding:8px 0 4px 0'>
  <span style='font-size:22px;font-weight:700;color:#f97316'>🎯 VenueScope</span><br>
  <span style='font-size:12px;color:#64748b'>Venue Intelligence Platform</span>
  {f'<br><span style="font-size:12px;color:#94a3b8;margin-top:4px;display:block">📍 {venue_name}</span>' if venue_name else ''}
  {f'<span style="font-size:11px;color:#64748b">{email}</span>' if email else ''}
</div>
""", unsafe_allow_html=True)
st.sidebar.divider()

sel = st.sidebar.radio("Navigation", list(PAGES.keys()),
                        label_visibility="collapsed")
st.sidebar.divider()

# Model status
from pathlib import Path as _P
for name in ["yolov8n.pt", "yolov8s.pt", "yolov8m.pt"]:
    cands = [_P.home()/".cache"/"ultralytics"/"assets"/name,
             _P.home()/".cache"/"ultralytics"/name, _P(name)]
    icon = "✅" if any(c.exists() for c in cands) else "⬇️"
    st.sidebar.caption(f"{icon} {name}")

st.sidebar.divider()

# Default PIN warning
if st.session_state.get("auth_default_pin_warning"):
    st.sidebar.warning("⚠️ Default PIN active")

if st.sidebar.button("🔒 Lock", use_container_width=True):
    logout()
    st.rerun()

st.sidebar.caption("🔒 No cloud · No faces stored\nAll processing on-device")

# ── Route ─────────────────────────────────────────────────────────────────────
page_path = Path(PAGES[sel])
if not page_path.exists():
    st.error(f"Page not found: {page_path}")
else:
    exec(page_path.read_text(), {"__name__": "__main__"})
