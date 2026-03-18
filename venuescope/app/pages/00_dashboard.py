"""
VenueScope — Dashboard v2
Adds: 30-day trending chart, unrung % badge, monthly theft tracker, better empty
state, color-coded job status table.
"""
import json
from pathlib import Path
from datetime import datetime, timedelta, date
import streamlit as st
import pandas as pd

from core.database import list_jobs_filtered, delete_job, get_preferences, save_preferences
from core.config   import RESULT_DIR, ANALYSIS_MODES
from core.auth import require_auth as _page_auth
_page_auth()

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
.badge-green{background:#16a34a;color:#fff;padding:4px 14px;border-radius:20px;
  font-weight:700;font-size:0.95em;display:inline-block;}
.badge-yellow{background:#ca8a04;color:#fff;padding:4px 14px;border-radius:20px;
  font-weight:700;font-size:0.95em;display:inline-block;}
.badge-red{background:#dc2626;color:#fff;padding:4px 14px;border-radius:20px;
  font-weight:700;font-size:0.95em;display:inline-block;}
.theft-tracker{background:#1e293b;border:1px solid #334155;border-radius:10px;
  padding:14px 20px;margin:8px 0;}
.theft-tracker h4{color:#f97316!important;margin:0 0 4px 0;}
.theft-tracker p{color:#f1f5f9!important;margin:0;font-size:1.05em;}
</style>""", unsafe_allow_html=True)

st.markdown('<div class="vs-brand">VenueScope</div>'
            '<div class="vs-tagline">Bar Intelligence Platform — powered by computer vision</div>',
            unsafe_allow_html=True)

# ── Compliance banner ──────────────────────────────────────────────────────────
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

# ── Filters ────────────────────────────────────────────────────────────────────
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


# ── Helper: read summary safely ───────────────────────────────────────────────
def _read_summary(job: dict) -> dict:
    rdir = Path(job.get("result_dir") or Path(RESULT_DIR) / job["job_id"])
    sumf = rdir / "summary.json"
    if not sumf.exists():
        return {}
    try:
        return json.loads(sumf.read_text())
    except Exception:
        return {}


def _read_review_decisions(job: dict) -> dict:
    rdir = Path(job.get("result_dir") or Path(RESULT_DIR) / job["job_id"])
    revf = rdir / "review_decisions.json"
    if not revf.exists():
        return {}
    try:
        return json.loads(revf.read_text())
    except Exception:
        return {}


# ── 30-day trending chart (all drink_count done jobs regardless of filter) ────
def _build_trending_chart():
    cutoff_30 = today - timedelta(days=29)
    # Fetch all done drink_count jobs from last 30 days (ignore current filter)
    all_recent = list_jobs_filtered(limit=500)
    drink_done = [
        j for j in all_recent
        if j["status"] == "done"
        and j.get("analysis_mode") == "drink_count"
        and datetime.fromtimestamp(j.get("created_at", 0)).date() >= cutoff_30
    ]

    if not drink_done:
        return None

    # Aggregate drinks per calendar day
    day_drinks: dict[date, int] = {}
    for job in drink_done:
        job_date = datetime.fromtimestamp(job.get("created_at", 0)).date()
        s = _read_summary(job)
        drinks = sum(
            bdata.get("total_drinks", 0)
            for bdata in s.get("bartenders", {}).values()
        )
        day_drinks[job_date] = day_drinks.get(job_date, 0) + drinks

    if not day_drinks:
        return None

    # Build a full 30-day series (missing days = 0)
    dates = [cutoff_30 + timedelta(days=i) for i in range(30)]
    series = {d: day_drinks.get(d, 0) for d in dates}
    df = pd.DataFrame({"Date": list(series.keys()), "Drinks": list(series.values())})
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.set_index("Date")
    return df


# ── Monthly theft tracker ──────────────────────────────────────────────────────
def _compute_monthly_theft():
    """
    Scan all done drink_count jobs from the current calendar month.
    For each job, look for approved low-conf review events (review_decisions.json)
    and POS-flagged unrung counts stored in summary.json pos_comparison.
    Returns (total_unrung_drinks: int, estimated_loss: float, avg_price: int).
    """
    prefs     = get_preferences()
    avg_price = int(prefs.get("avg_drink_price", 10))

    # Calendar month start
    month_start = today.replace(day=1)
    all_jobs    = list_jobs_filtered(limit=500)
    month_drink_done = [
        j for j in all_jobs
        if j["status"] == "done"
        and j.get("analysis_mode") == "drink_count"
        and datetime.fromtimestamp(j.get("created_at", 0)).date() >= month_start
    ]

    total_unrung = 0
    for job in month_drink_done:
        s = _read_summary(job)

        # Method 1: POS comparison stored in summary
        pos_comp = s.get("pos_comparison", [])
        for row in pos_comp:
            delta = row.get("delta", row.get("Delta", 0))
            if isinstance(delta, (int, float)) and delta > 0:
                total_unrung += int(delta)

        # Method 2: approved low-conf events from review_decisions.json
        # (only count if no POS comparison available for this job)
        if not pos_comp:
            decisions = _read_review_decisions(job)
            approved = sum(1 for v in decisions.values() if v == "approved")
            total_unrung += approved

    return total_unrung, total_unrung * avg_price, avg_price


# ── Unrung % badge for a single drink_count job ───────────────────────────────
def _unrung_badge(job: dict, s: dict) -> str | None:
    """Return HTML badge string for unrung % if POS comparison data is available."""
    pos_comp = s.get("pos_comparison", [])
    if not pos_comp:
        return None

    total_cv  = sum(r.get("cv_count",  r.get("CV Count",  0)) for r in pos_comp)
    total_pos = sum(r.get("pos_rings", r.get("POS Rings", 0)) for r in pos_comp)
    if total_pos == 0:
        return None

    delta   = total_cv - total_pos
    pct     = delta / total_pos * 100
    if pct <= 5:
        color, label = "green", f"+{pct:.0f}% OK"
    elif pct <= 15:
        color, label = "yellow", f"+{pct:.0f}% Watch"
    else:
        color, label = "red", f"+{pct:.0f}% FLAG"
    return f'<span class="badge-{color}">{label}</span>'


# ── No jobs empty state ────────────────────────────────────────────────────────
if not done_jobs and not jobs:
    st.markdown("## Get Started with VenueScope")
    st.markdown("""
No jobs found for the selected date range. Here's what to do next:

**1. Upload a video clip**
Go to **▶️ Run Analysis** in the sidebar. Upload an MP4 or MOV file from your bar camera.

**2. Choose an analysis mode**
- **Drink Count** — compare CV counts against POS to detect unrung drinks
- **People Count** — track door entries, exits, and peak occupancy
- **Table Turns** — measure table dwell time and turn rate

**3. Review your results**
After processing completes, open **📊 Results** to see the full shift breakdown,
confidence badge, and optional POS theft comparison.

**4. Configure your bar layout**
Set up zones and the bar line in **📐 Bar Layout** so detections are correctly
attributed to each bartender station.
""")
    st.info("Tip: Change the **Date range** filter above to **All time** to see older jobs.")
    st.stop()

# ── Metrics row ───────────────────────────────────────────────────────────────
if done_jobs:
    st.subheader("📊 At a Glance")
    total_drinks = total_entries = total_tables = motion_alerts = 0

    for job in done_jobs:
        s    = _read_summary(job)
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

    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Jobs Done",      len(done_jobs))
    c2.metric("Drinks Counted", total_drinks)
    c3.metric("Door Entries",   total_entries)
    c4.metric("Table Turns",    total_tables)
    c5.metric("Motion Alerts",  motion_alerts,
              delta="review" if motion_alerts > 0 else None,
              delta_color="inverse")
    st.divider()

# ── 30-day trending chart ──────────────────────────────────────────────────────
trend_df = _build_trending_chart()
if trend_df is not None:
    st.subheader("📈 Drinks / Day — Last 30 Days")
    st.bar_chart(trend_df, use_container_width=True, height=200)
    st.divider()

# ── Monthly theft tracker ──────────────────────────────────────────────────────
month_unrung, month_loss, avg_price_stored = _compute_monthly_theft()

prefs = get_preferences()
st.subheader(f"💸 Theft Tracker — {today.strftime('%B %Y')}")
thr1, thr2, thr3 = st.columns([2, 2, 2])
with thr1:
    new_avg_price = st.number_input(
        "Avg drink price ($)", min_value=1, max_value=200,
        value=avg_price_stored,
        help="Used to calculate estimated revenue loss from unrung drinks",
        key="dash_avg_price"
    )
    if new_avg_price != avg_price_stored:
        save_preferences({"avg_drink_price": new_avg_price})
        st.rerun()
with thr2:
    loss_display = month_unrung * new_avg_price
    st.markdown(
        f'<div class="theft-tracker">'
        f'<h4>This Month</h4>'
        f'<p>{month_unrung} unrung drink{"s" if month_unrung != 1 else ""} detected</p>'
        f'</div>',
        unsafe_allow_html=True
    )
with thr3:
    st.markdown(
        f'<div class="theft-tracker">'
        f'<h4>Est. Revenue Loss</h4>'
        f'<p>${loss_display:,.0f} @ ${new_avg_price}/drink</p>'
        f'</div>',
        unsafe_allow_html=True
    )
st.caption(
    "Unrung count sources: POS variance from theft analysis (pos_comparison in summary) "
    "or approved low-confidence events from the review queue."
)
st.divider()

# ── Drink summary with unrung % badge ─────────────────────────────────────────
if done_jobs:
    drink_jobs = [j for j in done_jobs if j.get("analysis_mode") == "drink_count"]
    if drink_jobs:
        st.subheader("Drink Count Summary")
        rows = []
        for job in drink_jobs:
            s = _read_summary(job)
            if not s:
                continue
            badge = _unrung_badge(job, s)
            for name, bdata in s.get("bartenders", {}).items():
                row = {
                    "Job":        job["job_id"],
                    "Clip":       job.get("clip_label", ""),
                    "Bartender":  name,
                    "CV Count":   bdata.get("total_drinks", 0),
                    "Drinks/hr":  bdata.get("drinks_per_hour", 0),
                    "Peak Hour":  bdata.get("peak_hour_count", 0),
                    "Unrung %":   "",
                }
                if badge:
                    row["Unrung %"] = badge
                rows.append(row)
        if rows:
            # Render table; badge column has raw HTML so render it separately
            df_drinks = pd.DataFrame(rows)
            # Drop the HTML badge col for dataframe (not renderable); show inline caption instead
            df_no_badge = df_drinks.drop(columns=["Unrung %"])
            st.dataframe(df_no_badge, use_container_width=True, hide_index=True)

            # Show unrung badges per job as inline pills below the table
            seen_jobs: set = set()
            for job in drink_jobs:
                if job["job_id"] in seen_jobs:
                    continue
                seen_jobs.add(job["job_id"])
                s = _read_summary(job)
                badge = _unrung_badge(job, s)
                if badge:
                    clip = job.get("clip_label") or job["job_id"]
                    st.markdown(
                        f"**{clip}** — POS variance: {badge}",
                        unsafe_allow_html=True
                    )
        st.divider()

    # ── People count ──────────────────────────────────────────────────────────
    people_jobs = [j for j in done_jobs if j.get("analysis_mode") == "people_count"]
    if people_jobs:
        st.subheader("Occupancy Summary")
        rows = []
        for job in people_jobs:
            s = _read_summary(job)
            if not s:
                continue
            p = s.get("people", {})
            rows.append({
                "Job":            job["job_id"],
                "Clip":           job.get("clip_label", ""),
                "Total Entries":  p.get("total_entries", 0),
                "Total Exits":    p.get("total_exits", 0),
                "Peak Occupancy": p.get("peak_occupancy", 0),
                "Net In Venue":   p.get("net_occupancy", 0),
            })
        if rows:
            st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
        st.divider()

# ── All jobs table with color-coded status ────────────────────────────────────
st.subheader("All Jobs")

all_jobs = jobs
if not all_jobs:
    st.info("No jobs found for this filter.")
else:
    # Status color mapping using st.dataframe column styling via pandas Styler
    STATUS_COLORS = {
        "done":    "#16a34a",   # green
        "running": "#ca8a04",   # yellow
        "failed":  "#dc2626",   # red
        "pending": "#64748b",   # slate
    }
    job_rows = []
    for j in all_jobs:
        created = datetime.fromtimestamp(j.get("created_at", 0)).strftime("%m/%d %H:%M")
        status  = j["status"]
        icon    = {"done": "✅", "running": "⏳", "failed": "❌", "pending": "🕐"}.get(status, status)
        job_rows.append({
            "ID":      j["job_id"],
            "Mode":    ANALYSIS_MODES.get(j.get("analysis_mode", ""), j.get("analysis_mode", "")),
            "Clip":    j.get("clip_label", ""),
            "Status":  f"{icon} {status}",
            "_status": status,   # raw value for styling
            "Profile": j.get("model_profile", ""),
            "Created": created,
        })

    df_all = pd.DataFrame(job_rows)

    # Apply row background tinting via pandas Styler
    def _style_status_row(row):
        color = STATUS_COLORS.get(row["_status"], "")
        if color:
            bg = color + "22"   # 13% opacity hex suffix
            return [f"background-color:{bg}" for _ in row]
        return ["" for _ in row]

    df_display = df_all.drop(columns=["_status"])
    # Apply styling on display-only df (no _status column) so we never need to hide it
    styled = df_display.style.apply(
        lambda row: [
            f"background-color:{STATUS_COLORS.get(df_all.at[row.name, '_status'], '')}22"
            if STATUS_COLORS.get(df_all.at[row.name, "_status"])
            else ""
            for _ in row
        ],
        axis=1
    )

    try:
        st.dataframe(styled, use_container_width=True, hide_index=True)
    except Exception:
        # Fallback: plain dataframe without styling if Styler isn't supported
        st.dataframe(df_display, use_container_width=True, hide_index=True)

    # ── View Results buttons for completed jobs ────────────────────────────────
    done_in_filter = [j for j in all_jobs if j["status"] == "done"]
    if done_in_filter:
        st.divider()
        st.subheader("Quick Access")
        st.caption("Jump directly to the Results page for any completed job.")
        _btn_cols = st.columns(min(len(done_in_filter), 4))
        for _idx, _job in enumerate(done_in_filter):
            _job_id    = _job["job_id"]
            _job_label = _job.get("clip_label") or _job_id
            _mode_name = ANALYSIS_MODES.get(_job.get("analysis_mode", ""), _job.get("analysis_mode", ""))
            with _btn_cols[_idx % 4]:
                if st.button(
                    f"📊 View",
                    key=f"view_{_job_id}",
                    help=f"{_mode_name} — {_job_label}",
                    use_container_width=True,
                ):
                    st.session_state["results_job_id"] = _job_id
                    try:
                        st.switch_page("app/pages/02_results.py")
                    except AttributeError:
                        # st.switch_page not available in older Streamlit versions
                        st.info(
                            f"Navigate to **📊 Results** in the sidebar to view **{_job_label}**."
                        )
                st.caption(f"{_job_label}")

    # ── Delete jobs ────────────────────────────────────────────────────────────
    st.divider()
    st.subheader("Manage Jobs")

    del_opts = ["— select job to delete —"] + [
        f"{j['job_id']} · {j.get('clip_label','no label')} · {j['status']}"
        for j in all_jobs
    ]
    del_sel = st.selectbox("Select job to delete", del_opts)
    if del_sel != del_opts[0]:
        del_id = del_sel.split(" · ")[0]
        if st.button(f"Delete `{del_id}` and its results", type="primary"):
            if delete_job(del_id):
                st.success(f"Deleted job `{del_id}` and its result files.")
                st.rerun()
            else:
                st.error("Delete failed.")
