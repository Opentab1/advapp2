"""
VenueScope — Dashboard with date filtering and correct "today" metrics.
"""
import json
from pathlib import Path
from datetime import datetime, timedelta
import streamlit as st
import pandas as pd

from core.database import list_jobs_filtered, delete_job
from core.config   import RESULT_DIR, ANALYSIS_MODES

st.set_page_config(page_title="Dashboard · VenueScope", layout="wide")
st.markdown("""
<style>
.stApp,[data-testid="stSidebar"]{background:#0f172a;}
h1,h2,h3,label,p,.stMarkdown{color:#f1f5f9!important;}
div[data-testid="metric-container"]{background:#1e293b;border-radius:10px;
  padding:12px;border:1px solid #334155;}
.stButton>button{background:#f97316;color:#fff;border:none;border-radius:8px;font-weight:600;}
.stDataFrame{background:#1e293b!important;}
.vs-brand{font-size:2.2em;font-weight:800;color:#f97316;letter-spacing:-1px;}
.vs-tagline{color:#94a3b8;font-size:0.95em;margin-top:-8px;}
</style>""", unsafe_allow_html=True)

st.markdown('<div class="vs-brand">VenueScope</div>'
            '<div class="vs-tagline">Bar Intelligence Platform — powered by computer vision</div>',
            unsafe_allow_html=True)

# Compliance banner — show if checklist not completed
from core.database import get_preferences
_prefs = get_preferences()
_comp  = _prefs.get("compliance", {})
_comp_items = ["notice_posted","staff_informed","retention_set","access_limited","legal_basis"]
_unchecked  = [k for k in _comp_items if not _comp.get(k, False)]
if _unchecked:
    st.warning(
        f"⚠️ **Recording compliance checklist incomplete** — {len(_unchecked)} item(s) outstanding. "
        "Go to **⚙️ Settings → 📋 Compliance** to review your obligations before using VenueScope. "
        "| [Open Compliance Checklist](#)",
        icon=None
    )

st.markdown("---")

# ── Filters ───────────────────────────────────────────────────────────────────
fc1, fc2, fc3 = st.columns([2, 2, 3])
today = datetime.now().date()
with fc1:
    date_range = st.selectbox("Date range",
        ["Today", "Last 7 days", "Last 30 days", "All time", "Custom date"],
        index=1)
with fc2:
    mode_filter = st.selectbox(
        "Mode",
        ["All"] + list(ANALYSIS_MODES.keys()),
        format_func=lambda k: "All Modes" if k == "All" else ANALYSIS_MODES[k]
    )
with fc3:
    if date_range == "Custom date":
        date_sel = st.date_input("Pick date", value=today, max_value=today)
    else:
        date_sel = None
        st.caption(f"Showing: **{date_range}**"
                   + (f" · {ANALYSIS_MODES[mode_filter]}" if mode_filter != "All" else ""))

# Compute date filter
date_str = None
if date_range == "Today":
    date_str = today.strftime("%Y-%m-%d")
elif date_range == "Custom date" and date_sel:
    date_str = date_sel.strftime("%Y-%m-%d")

# For multi-day ranges, filter after fetching
range_days = {"Last 7 days": 7, "Last 30 days": 30}.get(date_range)

jobs_raw = list_jobs_filtered(
    limit=500,
    date_str=date_str,
    mode=mode_filter if mode_filter != "All" else None
)

if range_days:
    cutoff = (today - timedelta(days=range_days)).toordinal()
    jobs = [j for j in jobs_raw
            if datetime.fromtimestamp(j.get("created_at", 0)).date().toordinal() >= cutoff]
else:
    jobs = jobs_raw

done_jobs = [j for j in jobs if j["status"] == "done"]

if not done_jobs:
    st.info(f"No completed jobs for {date_str}. "
            "Change the date filter or go to **▶️ Run Analysis**.")
else:
    # ── Metrics ───────────────────────────────────────────────────────────────
    st.subheader(f"📊 {'Today' if date_sel == today else date_str} at a Glance")
    total_drinks = total_entries = total_tables = motion_alerts = 0

    for job in done_jobs:
        rdir = Path(job.get("result_dir") or Path(RESULT_DIR) / job["job_id"])
        sumf = rdir / "summary.json"
        if not sumf.exists():
            continue
        try:
            s    = json.loads(sumf.read_text())
            mode = s.get("mode", "")
            if mode == "drink_count":
                for bdata in s.get("bartenders", {}).values():
                    total_drinks += bdata.get("total_drinks", 0)
            elif mode == "people_count":
                total_entries += s.get("people", {}).get("total_entries", 0)
            elif mode == "table_turns":
                for td in s.get("tables", {}).values():
                    total_tables += td.get("turn_count", 0)
            elif mode == "after_hours":
                motion_alerts += s.get("motion", {}).get("total_motion_events", 0)
        except Exception:
            pass

    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Jobs Done",      len(done_jobs))
    c2.metric("Drinks Counted", total_drinks)
    c3.metric("Door Entries",   total_entries)
    c4.metric("Table Turns",    total_tables)
    c5.metric("Motion Alerts",  motion_alerts,
              delta="⚠️ review" if motion_alerts > 0 else None,
              delta_color="inverse")
    st.divider()

    # ── Drink summary ─────────────────────────────────────────────────────────
    drink_jobs = [j for j in done_jobs if j.get("analysis_mode") == "drink_count"]
    if drink_jobs:
        st.subheader("🍺 Drink Count Summary")
        rows = []
        for job in drink_jobs:
            rdir = Path(job.get("result_dir") or Path(RESULT_DIR)/job["job_id"])
            sumf = rdir/"summary.json"
            if not sumf.exists(): continue
            try:
                s = json.loads(sumf.read_text())
                for name, bdata in s.get("bartenders", {}).items():
                    rows.append({
                        "Job":       job["job_id"],
                        "Clip":      job.get("clip_label", ""),
                        "Bartender": name,
                        "CV Count":  bdata.get("total_drinks", 0),
                        "Drinks/hr": bdata.get("drinks_per_hour", 0),
                        "Peak Hour": bdata.get("peak_hour_count", 0),
                    })
            except Exception: pass
        if rows:
            st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
        st.divider()

    # ── People count ──────────────────────────────────────────────────────────
    people_jobs = [j for j in done_jobs if j.get("analysis_mode") == "people_count"]
    if people_jobs:
        st.subheader("🚶 Occupancy Summary")
        rows = []
        for job in people_jobs:
            rdir = Path(job.get("result_dir") or Path(RESULT_DIR)/job["job_id"])
            sumf = rdir/"summary.json"
            if not sumf.exists(): continue
            try:
                s = json.loads(sumf.read_text())
                p = s.get("people", {})
                rows.append({
                    "Job":            job["job_id"],
                    "Clip":           job.get("clip_label", ""),
                    "Total Entries":  p.get("total_entries", 0),
                    "Total Exits":    p.get("total_exits", 0),
                    "Peak Occupancy": p.get("peak_occupancy", 0),
                    "Net In Venue":   p.get("net_occupancy", 0),
                })
            except Exception: pass
        if rows:
            st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
        st.divider()

# ── All jobs table ─────────────────────────────────────────────────────────────
st.subheader("All Jobs")

all_jobs = jobs
if not all_jobs:
    st.info("No jobs found.")
else:
    job_rows = []
    for j in all_jobs:
        created = datetime.fromtimestamp(j.get("created_at", 0)).strftime("%m/%d %H:%M")
        status_icon = {"done":"✅","running":"⏳","failed":"❌","pending":"🕐"}.get(
            j["status"], j["status"])
        job_rows.append({
            "ID":      j["job_id"],
            "Mode":    ANALYSIS_MODES.get(j.get("analysis_mode",""), j.get("analysis_mode","")),
            "Clip":    j.get("clip_label",""),
            "Status":  f"{status_icon} {j['status']}",
            "Profile": j.get("model_profile",""),
            "Created": created,
        })

    df = pd.DataFrame(job_rows)
    st.dataframe(df, use_container_width=True, hide_index=True)

    # ── Delete jobs ────────────────────────────────────────────────────────────
    st.divider()
    st.subheader("🗑 Manage Jobs")

    del_opts = ["— select job to delete —"] + [
        f"{j['job_id']} · {j.get('clip_label','no label')} · {j['status']}"
        for j in all_jobs
    ]
    del_sel = st.selectbox("Select job to delete", del_opts)
    if del_sel != del_opts[0]:
        del_id = del_sel.split(" · ")[0]
        if st.button(f"🗑 Delete `{del_id}` and its results", type="primary"):
            if delete_job(del_id):
                st.success(f"Deleted job `{del_id}` and its result files.")
                st.rerun()
            else:
                st.error("Delete failed.")
