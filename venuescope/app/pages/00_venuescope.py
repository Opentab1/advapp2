from __future__ import annotations
import json, os, time, uuid
from pathlib import Path
from datetime import datetime, timedelta, date
import streamlit as st
from core.config import CONFIG_DIR, RESULT_DIR, ANALYSIS_MODES
from core.database import list_cameras, save_camera, list_jobs, list_jobs_filtered, create_job, _raw_update, get_preferences
from core.auth import require_auth as _page_auth
_page_auth()

st.set_page_config(page_title="VenueScope", page_icon="🎯", layout="wide")

st.markdown("""
<style>
[data-testid="stAppViewContainer"] { background: #0f172a; }
[data-testid="stSidebar"] { background: #0f172a; }
.vs-header { font-size: 2.4rem; font-weight: 800; color: #f8fafc; letter-spacing: -0.5px; line-height: 1.1; }
.vs-sub { font-size: 0.95rem; color: #64748b; margin-top: 2px; }
.vs-updated { font-size: 0.78rem; color: #475569; margin-top: 6px; }
.status-pill {
    display: inline-block; padding: 4px 14px; border-radius: 999px;
    font-size: 0.82rem; font-weight: 600; margin: 4px 4px 0 0;
}
.pill-green { background: #14532d; color: #4ade80; }
.pill-red   { background: #450a0a; color: #f87171; }
.pill-amber { background: #451a03; color: #fb923c; }
.stat-card {
    background: #1e293b; border-radius: 12px; padding: 20px 22px 16px;
    border: 1px solid #334155; text-align: center;
}
.stat-num  { font-size: 2.6rem; font-weight: 800; line-height: 1; }
.stat-lbl  { font-size: 0.82rem; color: #94a3b8; margin-top: 4px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
.camera-card {
    background: #1e293b; border-radius: 10px; padding: 14px 16px 10px;
    border-left: 4px solid #334155; border-top: 1px solid #334155;
    border-right: 1px solid #334155; border-bottom: 1px solid #334155;
    margin-bottom: 4px;
}
.cam-name  { font-size: 1rem; font-weight: 700; color: #f1f5f9; }
.cam-mode  { display: inline-block; background: #0f172a; color: #94a3b8; font-size: 0.72rem;
             padding: 2px 8px; border-radius: 999px; margin: 4px 0; border: 1px solid #334155; }
.cam-status-live    { color: #4ade80; font-weight: 700; }
.cam-status-pending { color: #fb923c; font-weight: 700; }
.cam-status-ready   { color: #94a3b8; font-weight: 600; }
.cam-status-error   { color: #f87171; font-weight: 700; }
.cam-last  { font-size: 0.78rem; color: #64748b; margin-top: 4px; }
.cam-url   { font-size: 0.72rem; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.alert-item {
    padding: 8px 14px; border-radius: 8px; margin-bottom: 6px;
    font-size: 0.85rem; display: flex; align-items: center; gap: 10px;
}
.alert-red    { background: #450a0a; border-left: 3px solid #f87171; color: #fca5a5; }
.alert-amber  { background: #451a03; border-left: 3px solid #fb923c; color: #fdba74; }
.alert-green  { background: #052e16; border-left: 3px solid #4ade80; color: #86efac; }
.section-title { font-size: 1.25rem; font-weight: 700; color: #f1f5f9; margin: 8px 0 14px; }
</style>
""", unsafe_allow_html=True)

# ── Helpers ───────────────────────────────────────────────────────────────────
def _parse_summary(job: dict) -> dict:
    raw = job.get("summary_json") or "{}"
    try:
        return json.loads(raw)
    except Exception:
        return {}

def _job_drinks(summary: dict) -> int:
    bt = summary.get("bartenders", {})
    return sum(v.get("total_drinks", 0) for v in bt.values()) if isinstance(bt, dict) else 0

def _job_people(summary: dict) -> int:
    people = summary.get("people", {})
    if isinstance(people, dict):
        return sum(v.get("in_count", 0) for v in people.values() if isinstance(v, dict))
    return 0

def _job_unrung(summary: dict) -> int:
    bt = summary.get("bartenders", {})
    if isinstance(bt, dict):
        return sum(v.get("unrung_drinks", 0) for v in bt.values())
    return 0

def _ts_label(ts: float) -> str:
    if not ts:
        return ""
    dt = datetime.fromtimestamp(ts)
    return dt.strftime("%-I:%M %p")

# ── Data fetch ────────────────────────────────────────────────────────────────
all_jobs   = list_jobs_filtered(limit=500)
cameras    = list_cameras()
prefs      = get_preferences()
avg_price  = prefs.get("avg_drink_price", 12)
today      = date.today()
week_ago   = today - timedelta(days=7)

today_done = [j for j in all_jobs
              if j.get("status") == "done"
              and datetime.fromtimestamp(j.get("created_at", 0)).date() == today]

drinks_today = sum(_job_drinks(_parse_summary(j)) for j in today_done
                   if j.get("analysis_mode", "").startswith("drink"))
people_today = sum(_job_people(_parse_summary(j)) for j in today_done
                   if j.get("analysis_mode", "").startswith("people"))
revenue_today = drinks_today * avg_price
alerts_today  = sum(1 for j in today_done
                    if _parse_summary(j).get("has_theft_flag") or _job_unrung(_parse_summary(j)) > 0)

# Camera live status
recent_jobs_map: dict[str, dict] = {}
all_recent = list_jobs(200)
for j in all_recent:
    lbl = j.get("clip_label", "")
    for cam in cameras:
        prefix = f"📡 {cam['name']}"
        if lbl.startswith(prefix) and cam["camera_id"] not in recent_jobs_map:
            recent_jobs_map[cam["camera_id"]] = j

live_count = sum(1 for cam in cameras
                 if recent_jobs_map.get(cam["camera_id"], {}).get("status") == "running")

# ── Venue header ─────────────────────────────────────────────────────────────
venue_raw  = os.environ.get("VENUESCOPE_VENUE_ID", "Your Venue")
venue_name = venue_raw.replace("_", " ").title()
now        = datetime.now()
day_str    = now.strftime("%A, %B %-d %Y")
updated_s  = int(time.time() % 60)

col_hdr, col_pills = st.columns([3, 1])
with col_hdr:
    st.markdown(f"""
    <div class="vs-header">{venue_name}</div>
    <div class="vs-sub">{day_str}</div>
    <div class="vs-updated">Last updated {updated_s}s ago</div>
    """, unsafe_allow_html=True)
with col_pills:
    st.markdown("<div style='padding-top:12px'>", unsafe_allow_html=True)
    cam_pill = (f'<span class="status-pill pill-green">🟢 {live_count} cameras live</span>'
                if live_count > 0 else '<span class="status-pill pill-red">🔴 No cameras live</span>')
    alert_pill = (f'<span class="status-pill pill-red">⚠️ {alerts_today} alerts</span>'
                  if alerts_today > 0 else '<span class="status-pill pill-green">✓ All clear</span>')
    st.markdown(cam_pill + "<br>" + alert_pill + "</div>", unsafe_allow_html=True)

st.markdown("<hr style='border-color:#1e293b;margin:16px 0'>", unsafe_allow_html=True)

# ── Stat cards ────────────────────────────────────────────────────────────────
st.markdown('<div class="section-title">Today at a Glance</div>', unsafe_allow_html=True)
c1, c2, c3, c4 = st.columns(4)

def _stat_card(col, num, label, color):
    with col:
        st.markdown(f"""
        <div class="stat-card">
          <div class="stat-num" style="color:{color}">{num}</div>
          <div class="stat-lbl">{label}</div>
        </div>
        """, unsafe_allow_html=True)

_stat_card(c1, drinks_today,         "Drinks Today",   "#f97316")
_stat_card(c2, f"${revenue_today:,}", "Est. Revenue",  "#4ade80")
_stat_card(c3, people_today,         "People Today",   "#38bdf8")
alert_color = "#f87171" if alerts_today > 0 else "#4ade80"
_stat_card(c4, alerts_today,         "Active Alerts",  alert_color)

st.markdown("<div style='margin-top:28px'>", unsafe_allow_html=True)

# ── Camera grid ───────────────────────────────────────────────────────────────
st.markdown('<div class="section-title">📷 Camera Grid</div>', unsafe_allow_html=True)

if not cameras:
    st.info("No cameras set up yet. Head to the **Live** page to add your first camera.")
else:
    cols = st.columns(3)
    for idx, cam in enumerate(cameras):
        last_job = recent_jobs_map.get(cam["camera_id"])
        status   = last_job.get("status", "idle") if last_job else "idle"

        border_color = {"running": "#4ade80", "pending": "#fb923c",
                        "failed": "#f87171"}.get(status, "#475569")

        if status == "running":
            status_html = '<span class="cam-status-live">● LIVE</span>'
        elif status == "pending":
            status_html = '<span class="cam-status-pending">◐ Processing</span>'
        elif status == "failed":
            status_html = '<span class="cam-status-error">✗ Error</span>'
        elif status == "done":
            status_html = '<span class="cam-status-ready">✓ Ready</span>'
        else:
            status_html = '<span class="cam-status-ready">⬜ Idle</span>'

        last_txt = ""
        if last_job and status == "done":
            s = _parse_summary(last_job)
            d = _job_drinks(s)
            p = _job_people(s)
            if d:
                last_txt = f"Last: {d} drinks"
            elif p:
                last_txt = f"Last: {p} people"

        url_display = (cam["rtsp_url"][:45] + "…") if len(cam["rtsp_url"]) > 45 else cam["rtsp_url"]
        mode_label  = cam.get("mode", "—").split(",")[0]

        with cols[idx % 3]:
            st.markdown(f"""
            <div class="camera-card" style="border-left-color:{border_color}">
              <div class="cam-name">{cam['name']}</div>
              <span class="cam-mode">{mode_label}</span>
              <div style="margin:6px 0">{status_html}</div>
              <div class="cam-last">{last_txt}</div>
              <div class="cam-url">{url_display}</div>
            </div>
            """, unsafe_allow_html=True)

            if status in ("running", "pending"):
                st.button("⏹ Stop", key=f"stop_{cam['camera_id']}", disabled=True,
                          use_container_width=True)
            else:
                if st.button("▶ Start", key=f"start_{cam['camera_id']}", use_container_width=True):
                    jid   = str(uuid.uuid4())[:8]
                    label = f"📡 {cam['name']}"
                    create_job(
                        job_id=jid,
                        analysis_mode=cam["mode"].split(",")[0],
                        shift_id=cam.get("shift_id"),
                        shift_json=None,
                        source_type="rtsp",
                        source_path=cam["rtsp_url"],
                        model_profile=cam.get("model_profile", "balanced"),
                        config_path=cam.get("config_path"),
                        annotate=False,
                        clip_label=label,
                    )
                    st.rerun()

st.markdown("</div>", unsafe_allow_html=True)
st.markdown("<div style='margin-top:28px'>", unsafe_allow_html=True)

# ── 7-day chart ───────────────────────────────────────────────────────────────
st.markdown("### 📈 Drinks Per Day — Last 7 Days")

week_jobs = [j for j in all_jobs
             if j.get("status") == "done"
             and j.get("analysis_mode", "").startswith("drink")
             and datetime.fromtimestamp(j.get("created_at", 0)).date() >= week_ago]

if week_jobs:
    import pandas as pd
    daily: dict[str, int] = {}
    for j in week_jobs:
        d_key = datetime.fromtimestamp(j.get("created_at", 0)).strftime("%a %-d")
        daily[d_key] = daily.get(d_key, 0) + _job_drinks(_parse_summary(j))

    df = pd.DataFrame({"Drinks": daily})
    st.bar_chart(df, color="#f97316")

    if daily:
        best_day = max(daily, key=daily.__getitem__)
        avg_7    = sum(daily.values()) / max(len(daily), 1)
        today_lbl = now.strftime("%a %-d")
        today_val = daily.get(today_lbl, 0)
        delta     = today_val - avg_7
        c1b, c2b = st.columns(2)
        c1b.metric("Best Day This Week", f"{best_day} ({daily[best_day]} drinks)")
        c2b.metric("Today vs 7-Day Avg", f"{today_val} drinks", f"{delta:+.0f}")
else:
    st.info("No shift data yet.")

st.markdown("</div>", unsafe_allow_html=True)
st.markdown("<div style='margin-top:28px'>", unsafe_allow_html=True)

# ── Alerts panel ──────────────────────────────────────────────────────────────
st.markdown("### 🚨 Alerts")

alerts = []

for j in today_done:
    s     = _parse_summary(j)
    ts    = _ts_label(j.get("created_at", 0))
    label = j.get("clip_label") or j.get("job_id", "")

    if s.get("has_theft_flag"):
        alerts.append(("red", f"🚨 Theft flag — {label}", ts))

    unrung = _job_unrung(s)
    if unrung > 0:
        alerts.append(("red", f"🍺 {unrung} unrung drink(s) — {label}", ts))

for j in all_jobs:
    if j.get("status") == "failed":
        ts = _ts_label(j.get("created_at", 0))
        alerts.append(("amber", f"⚠️ Job failed — {j.get('clip_label') or j.get('job_id','')}", ts))

two_hours_ago = time.time() - 7200
for cam in cameras:
    last = recent_jobs_map.get(cam["camera_id"])
    if not last or last.get("created_at", 0) < two_hours_ago:
        alerts.append(("amber", f"📷 {cam['name']} — no recent job (may be offline)", ""))

if alerts:
    for kind, msg, ts in alerts:
        ts_part = f'<span style="color:#475569;font-size:0.75rem;margin-left:auto">{ts}</span>' if ts else ""
        st.markdown(f'<div class="alert-item alert-{kind}">{msg}{ts_part}</div>',
                    unsafe_allow_html=True)
else:
    st.markdown('<div class="alert-item alert-green">✓ No alerts today — everything looks good</div>',
                unsafe_allow_html=True)

st.markdown("</div>", unsafe_allow_html=True)
st.markdown("<div style='margin-top:28px'>", unsafe_allow_html=True)

# ── Quick actions ─────────────────────────────────────────────────────────────
st.markdown("### ⚡ Quick Actions")
qa1, qa2, qa3 = st.columns(3)

with qa1:
    if st.button("▶ Start All Cameras", use_container_width=True, type="primary"):
        started = 0
        for cam in cameras:
            last = recent_jobs_map.get(cam["camera_id"])
            if last and last.get("status") in ("running", "pending"):
                continue
            jid   = str(uuid.uuid4())[:8]
            label = f"📡 {cam['name']}"
            create_job(
                job_id=jid,
                analysis_mode=cam["mode"].split(",")[0],
                shift_id=cam.get("shift_id"),
                shift_json=None,
                source_type="rtsp",
                source_path=cam["rtsp_url"],
                model_profile=cam.get("model_profile", "balanced"),
                config_path=cam.get("config_path"),
                annotate=False,
                clip_label=label,
            )
            started += 1
        if started:
            st.success(f"Started {started} camera(s).")
            st.rerun()
        else:
            st.info("All cameras already running.")

with qa2:
    if st.button("⬇ Download Today's Report", use_container_width=True):
        st.info("Go to the Results page to download individual reports.")

with qa3:
    if st.button("🔄 Refresh", use_container_width=True):
        st.rerun()

st.markdown("</div>", unsafe_allow_html=True)

# ── Auto-refresh ──────────────────────────────────────────────────────────────
st.markdown("<hr style='border-color:#1e293b;margin:24px 0 8px'>", unsafe_allow_html=True)
st.session_state["vs_autorefresh"] = st.checkbox(
    "Auto-refresh every 30s", value=True, key="vs_ar"
)

if st.session_state.get("vs_autorefresh", True):
    time.sleep(30)
    st.rerun()
