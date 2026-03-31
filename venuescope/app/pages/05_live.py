"""
VenueScope — Live Cameras & Real-Time Dashboard
Shows real-time metrics pushed every 30 s from continuous live streams,
plus rolling 60-minute totals from completed segments.
Auto-refreshes every 10 seconds.
"""
from __future__ import annotations
import json, time, uuid
from pathlib import Path
import streamlit as st

from core.config   import CONFIG_DIR, RESULT_DIR, ANALYSIS_MODES
from core.database import (
    list_cameras, get_camera, save_camera, delete_camera,
    create_job, list_jobs, _raw_update,
)
from core.auth import require_auth as _page_auth
_page_auth()

st.set_page_config(page_title="Live · VenueScope", layout="wide")
st.markdown("""
<style>
.stApp,[data-testid="stSidebar"]{background:#0f172a;}
h1,h2,h3,label,p,.stMarkdown{color:#f1f5f9!important;}
.stButton>button{background:#f97316;color:#fff;border:none;border-radius:8px;font-weight:600;}
.live-card{background:#1e293b;border:1px solid #334155;border-radius:12px;
  padding:18px 20px;margin:6px 0;}
.live-badge-green{background:#16a34a22;border:1px solid #16a34a;color:#4ade80;
  padding:3px 12px;border-radius:20px;font-weight:700;font-size:0.85em;display:inline-block;}
.live-badge-amber{background:#ca8a0422;border:1px solid #ca8a04;color:#fbbf24;
  padding:3px 12px;border-radius:20px;font-weight:700;font-size:0.85em;display:inline-block;}
.live-badge-red{background:#dc262622;border:1px solid #dc2626;color:#f87171;
  padding:3px 12px;border-radius:20px;font-weight:700;font-size:0.85em;display:inline-block;}
.live-number{font-size:2.6em;font-weight:800;color:#f97316;line-height:1.1;}
.live-label{color:#94a3b8;font-size:0.78em;text-transform:uppercase;letter-spacing:.08em;}
.cam-label{font-size:1.1em;font-weight:700;color:#f1f5f9;}
.status-live{color:#22c55e;font-weight:700;}
.status-queued{color:#facc15;font-weight:700;}
.status-done{color:#94a3b8;}
.status-failed{color:#ef4444;font-weight:700;}
.hero-card{background:#1e293b;border-left:4px solid #f97316;border-radius:12px;
  padding:20px 22px;margin:4px 0;height:100%;}
.alert-banner{background:#7f1d1d33;border:1px solid #dc2626;border-radius:10px;
  padding:14px 20px;margin:10px 0;color:#fca5a5;font-weight:700;font-size:1.02em;}
.clear-banner{background:#14532d33;border:1px solid #16a34a;border-radius:10px;
  padding:10px 20px;margin:10px 0;color:#86efac;font-weight:600;font-size:0.92em;}
.bt-card{background:#1e293b;border:1px solid #334155;border-radius:12px;
  padding:18px 16px;text-align:center;position:relative;}
.bt-rank-gold{background:#92400e;color:#fcd34d;border-radius:50%;width:28px;height:28px;
  display:inline-flex;align-items:center;justify-content:center;font-weight:800;
  font-size:0.85em;margin-bottom:8px;}
.bt-rank-silver{background:#374151;color:#d1d5db;border-radius:50%;width:28px;height:28px;
  display:inline-flex;align-items:center;justify-content:center;font-weight:800;
  font-size:0.85em;margin-bottom:8px;}
.bt-rank-bronze{background:#431407;color:#fb923c;border-radius:50%;width:28px;height:28px;
  display:inline-flex;align-items:center;justify-content:center;font-weight:800;
  font-size:0.85em;margin-bottom:8px;}
.bt-rank-other{background:#1e293b;color:#64748b;border-radius:50%;width:28px;height:28px;
  display:inline-flex;align-items:center;justify-content:center;font-weight:800;
  font-size:0.85em;margin-bottom:8px;}
.event-card{background:#1e293b;border:1px solid #334155;border-radius:10px;
  padding:12px 16px;margin:5px 0;color:#f1f5f9;}
.pace-placeholder{background:#1e293b;border:1px dashed #334155;border-radius:10px;
  padding:24px;text-align:center;color:#475569;font-size:0.9em;margin:10px 0;}
</style>""", unsafe_allow_html=True)

# ── Helpers ───────────────────────────────────────────────────────────────────

WINDOW_SEC = 3600  # aggregate last 60 minutes of segment results

def _parse_summary(job: dict) -> dict:
    try:
        return json.loads(job.get("summary_json") or "{}")
    except Exception:
        return {}

def _rolling_metrics(mode_filter: str = None) -> dict:
    """
    Aggregate completed segment jobs from the last WINDOW_SEC seconds
    into a single set of live KPIs.
    """
    cutoff  = time.time() - WINDOW_SEC
    all_jobs = list_jobs(500)
    recent  = [j for j in all_jobs
               if j["status"] == "done"
               and j.get("created_at", 0) > cutoff
               and (mode_filter is None or j.get("analysis_mode") == mode_filter)]

    metrics = {
        "total_drinks":    0,
        "unrung_drinks":   0,
        "people_in":       0,
        "people_out":      0,
        "current_headcount": 0,
        "tables_served":   0,
        "avg_response_sec": None,
        "bartenders":      {},   # name -> {drinks, drinks_per_hour}
        "theft_flags":     0,
        "segment_count":   len(recent),
        "window_min":      WINDOW_SEC // 60,
    }

    response_times = []

    for job in recent:
        s  = _parse_summary(job)
        mode = job.get("analysis_mode", "")

        if mode == "drink_count":
            bts = s.get("bartenders", {})
            for name, d in bts.items():
                drinks = int(d.get("total_drinks", 0))
                metrics["total_drinks"]  += drinks
                metrics["unrung_drinks"] += int(d.get("unrung_drinks", 0) or 0)
                if name not in metrics["bartenders"]:
                    metrics["bartenders"][name] = {"drinks": 0, "per_hour": 0}
                metrics["bartenders"][name]["drinks"] += drinks
                metrics["bartenders"][name]["per_hour"] = round(
                    d.get("drinks_per_hour", 0), 1)
            if s.get("has_theft_flag") or metrics["unrung_drinks"] > 0:
                metrics["theft_flags"] += 1

        elif mode == "people_count":
            pdata = s.get("people", {})
            for line in pdata.values():
                metrics["people_in"]  += int(line.get("in_count",  0))
                metrics["people_out"] += int(line.get("out_count", 0))
            metrics["current_headcount"] = max(0,
                metrics["people_in"] - metrics["people_out"])

        elif mode == "table_turns":
            tables = s.get("tables", {})
            for tbl in tables.values():
                if tbl.get("total_sessions", 0) > 0:
                    metrics["tables_served"] += tbl["total_sessions"]
                if tbl.get("avg_response_sec") is not None:
                    response_times.append(tbl["avg_response_sec"])

    if response_times:
        metrics["avg_response_sec"] = round(
            sum(response_times) / len(response_times), 0)

    return metrics


def _camera_current_job(cam_name: str) -> dict | None:
    """Return the most recent job for this camera (any status)."""
    all_jobs = list_jobs(200)
    prefix   = f"📡 {cam_name}"
    for job in all_jobs:
        if (job.get("clip_label", "") or "").startswith(prefix):
            return job
    return None


def _live_job_metrics() -> list[dict]:
    """
    Read live.json written every ~30s by the worker for continuous RTSP jobs.
    Returns a list of partial summary dicts, one per currently running live job.
    """
    results = []
    for job in list_jobs(100):
        if job["status"] != "running" or job.get("source_type") != "rtsp":
            continue
        rd = Path(RESULT_DIR) / job["job_id"]
        live_file = rd / "live.json"
        if not live_file.exists():
            continue
        try:
            data = json.loads(live_file.read_text())
            # Only show if the data is fresh (written in last 90s)
            if time.time() - float(data.get("_updated_at", 0)) > 90:
                continue
            data["_job"] = job
            results.append(data)
        except Exception:
            pass
    return results


def _live_totals(live_jobs: list[dict]) -> dict:
    """Aggregate real-time totals across all live running jobs."""
    t = {"drinks": 0, "unrung": 0, "people_in": 0, "people_out": 0, "bartenders": {}}
    for d in live_jobs:
        bts = d.get("bartenders", {})
        for name, bt in bts.items():
            t["drinks"] += int(bt.get("total_drinks", 0))
            t["unrung"] += int(bt.get("unrung_drinks", 0) or 0)
            if name not in t["bartenders"]:
                t["bartenders"][name] = {"drinks": 0, "per_hour": 0}
            t["bartenders"][name]["drinks"] += int(bt.get("total_drinks", 0))
            t["bartenders"][name]["per_hour"] = round(float(bt.get("drinks_per_hour", 0)), 1)
        people = d.get("people", {})
        for line in people.values():
            t["people_in"]  += int(line.get("in_count", 0))
            t["people_out"] += int(line.get("out_count", 0))
    return t


# ── ESPN helper ───────────────────────────────────────────────────────────────

def _fetch_espn_games() -> list[dict]:
    """
    Fetch today's games from ESPN public scoreboard API (no key required).
    Returns a list of game dicts with keys: sport, home, away, status, network, time_str.
    Results cached in session_state for 5 minutes.
    """
    import urllib.request
    import urllib.error
    import datetime

    cache_key = "espn_cache"
    cache_ts_key = "espn_cache_ts"
    now = time.time()

    if (cache_key in st.session_state
            and now - st.session_state.get(cache_ts_key, 0) < 300):
        return st.session_state[cache_key]

    endpoints = {
        "NFL":   "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
        "NBA":   "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
        "NHL":   "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
        "MLB":   "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
        "NCAAF": "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
    }

    games = []
    for sport, url in endpoints.items():
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "VenueScope/1.0"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode())
            for event in data.get("events", []):
                comp = (event.get("competitions") or [{}])[0]
                competitors = comp.get("competitors", [])
                home = next((c["team"]["shortDisplayName"] for c in competitors
                             if c.get("homeAway") == "home"), "?")
                away = next((c["team"]["shortDisplayName"] for c in competitors
                             if c.get("homeAway") == "away"), "?")
                status_obj = event.get("status", {})
                status_type = status_obj.get("type", {})
                status_desc = status_type.get("shortDetail", status_type.get("description", ""))
                state = status_type.get("state", "pre")  # pre / in / post

                broadcasts = comp.get("broadcasts", [])
                network = ""
                if broadcasts:
                    names = broadcasts[0].get("names", [])
                    network = names[0] if names else ""

                # Parse start time to local-friendly string
                date_str = event.get("date", "")
                time_str = status_desc
                if state == "pre" and date_str:
                    try:
                        dt = datetime.datetime.fromisoformat(
                            date_str.replace("Z", "+00:00"))
                        # Convert to local time (simple UTC offset)
                        import datetime as _dt
                        local = dt.astimezone(_dt.timezone(
                            _dt.timedelta(hours=-5)))  # ET fallback
                        time_str = local.strftime("%-I:%M %p ET")
                    except Exception:
                        pass

                games.append({
                    "sport": sport,
                    "home": home,
                    "away": away,
                    "status": status_desc,
                    "state": state,
                    "network": network,
                    "time_str": time_str,
                })
        except Exception:
            pass

    st.session_state[cache_key] = games
    st.session_state[cache_ts_key] = now
    return games


def _fetch_holidays() -> list[str]:
    """
    Fetch US public holidays for the current year from Nager.at API (free, no key).
    Returns list of holiday names if today is a holiday, else empty list.
    """
    import urllib.request
    import datetime

    today = datetime.date.today()
    cache_key = "holiday_cache"
    if cache_key in st.session_state:
        holidays_map = st.session_state[cache_key]
    else:
        holidays_map = {}
        try:
            url = f"https://date.nager.at/api/v3/PublicHolidays/{today.year}/US"
            req = urllib.request.Request(url, headers={"User-Agent": "VenueScope/1.0"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode())
            for h in data:
                holidays_map[h["date"]] = h["localName"]
        except Exception:
            pass
        st.session_state[cache_key] = holidays_map

    today_str = today.isoformat()
    if today_str in holidays_map:
        return [holidays_map[today_str]]
    return []


def _pace_buckets() -> dict:
    """
    Build 4 time buckets of 15 minutes each for the last 60 minutes.
    Returns {"-60min": N, "-45min": N, "-30min": N, "-15min": N}.
    """
    now = time.time()
    buckets = {"-60 min": 0, "-45 min": 0, "-30 min": 0, "-15 min": 0}
    bucket_edges = [
        ("-60 min", now - 3600, now - 2700),
        ("-45 min", now - 2700, now - 1800),
        ("-30 min", now - 1800, now - 900),
        ("-15 min", now - 900,  now),
    ]
    cutoff = now - 3600
    all_jobs = list_jobs(500)
    recent = [j for j in all_jobs
              if j["status"] == "done"
              and j.get("created_at", 0) > cutoff
              and j.get("analysis_mode") == "drink_count"]
    for job in recent:
        created = float(job.get("created_at", 0))
        s = _parse_summary(job)
        drinks = sum(int(d.get("total_drinks", 0))
                     for d in s.get("bartenders", {}).values())
        for label, start, end in bucket_edges:
            if start <= created < end:
                buckets[label] += drinks
                break
    return buckets


# ── Page tabs ─────────────────────────────────────────────────────────────────

tab_live, tab_cameras, tab_add, tab_discover = st.tabs(
    ["🟢 Live Now", "📷 Cameras", "➕ Add Camera", "🔍 Discover Cameras"]
)

# ═══════════════════════════════════════════════════════════════════════════════
# TAB 1 — Live Now (redesigned)
# ═══════════════════════════════════════════════════════════════════════════════
with tab_live:
    import datetime as _datetime

    cameras = list_cameras()

    # ── Header row with auto-refresh toggle ───────────────────────────────────
    hdr_col, ctrl_col = st.columns([6, 2])
    with hdr_col:
        st.markdown("## 🟢 Live Venue Dashboard")
        st.caption(f"Rolling 60-minute window · updated {_datetime.datetime.now().strftime('%H:%M:%S')}")
    with ctrl_col:
        st.markdown("<div style='height:20px'></div>", unsafe_allow_html=True)
        auto = st.checkbox("Auto-refresh (10s)", value=True, key="live_auto")

    # ── Shift settings expander ───────────────────────────────────────────────
    with st.expander("⚙️ Shift settings", expanded=False):
        ss_col1, ss_col2 = st.columns(2)
        with ss_col1:
            avg_drink_price = st.number_input(
                "Avg drink price ($)",
                min_value=1, max_value=100, value=12, step=1,
                key="avg_drink_price",
                help="Used to estimate revenue from drinks served",
            )
        with ss_col2:
            shift_start_input = st.text_input(
                "Shift start time (HH:MM, 24h)",
                value="",
                placeholder="e.g. 17:00",
                key="shift_start_time",
                help="If set, the Shift Time KPI shows elapsed time",
            )

    # Resolve shift settings from session state
    avg_price = st.session_state.get("avg_drink_price", 12)
    shift_start_raw = st.session_state.get("shift_start_time", "").strip()
    shift_elapsed_str = None
    if shift_start_raw:
        try:
            now_dt = _datetime.datetime.now()
            sh, sm = [int(x) for x in shift_start_raw.split(":")]
            shift_dt = now_dt.replace(hour=sh, minute=sm, second=0, microsecond=0)
            if shift_dt > now_dt:
                shift_dt -= _datetime.timedelta(days=1)
            elapsed_sec = int((now_dt - shift_dt).total_seconds())
            eh = elapsed_sec // 3600
            em = (elapsed_sec % 3600) // 60
            shift_elapsed_str = f"{eh}h {em}m" if eh else f"{em}m"
        except Exception:
            shift_elapsed_str = None

    # ── Collect data ──────────────────────────────────────────────────────────
    live_jobs = _live_job_metrics()
    lt = _live_totals(live_jobs) if live_jobs else {"drinks": 0, "unrung": 0, "people_in": 0, "people_out": 0, "bartenders": {}}
    m = _rolling_metrics()

    total_drinks = m["total_drinks"] + lt["drinks"]
    total_unrung = m["unrung_drinks"] + lt["unrung"]
    headcount    = max(m["current_headcount"], max(0, lt["people_in"] - lt["people_out"]))
    est_revenue  = total_drinks * avg_price

    # Merge bartender data from rolling + live
    all_bartenders: dict = {}
    for name, data in m["bartenders"].items():
        all_bartenders[name] = {"drinks": data["drinks"], "per_hour": data["per_hour"]}
    for name, data in lt["bartenders"].items():
        if name in all_bartenders:
            all_bartenders[name]["drinks"] += data["drinks"]
        else:
            all_bartenders[name] = {"drinks": data["drinks"], "per_hour": data["per_hour"]}

    # ── Live streams panel (compact, shown at top when active) ────────────────
    if live_jobs:
        elapsed_vals = [float(d.get("_elapsed_sec", 0)) for d in live_jobs]
        max_elapsed  = max(elapsed_vals) if elapsed_vals else 0
        hrs  = int(max_elapsed // 3600)
        mins = int((max_elapsed % 3600) // 60)
        elapsed_str = (f"{hrs}h {mins}m" if hrs else f"{mins}m {int(max_elapsed % 60)}s")

        st.markdown(
            f'<div style="background:#052e16;border:1px solid #16a34a;border-radius:12px;'
            f'padding:14px 20px;margin-bottom:14px;">'
            f'<span style="color:#4ade80;font-weight:700;font-size:1.05em">🔴 LIVE &nbsp;—&nbsp; '
            f'{len(live_jobs)} stream(s) active &nbsp;·&nbsp; {elapsed_str} elapsed</span>'
            f'</div>',
            unsafe_allow_html=True,
        )
        # Per-stream compact table
        rows_html = ""
        for d in live_jobs:
            j = d.get("_job", {})
            label = j.get("clip_label", j.get("job_id", "?"))
            es = float(d.get("_elapsed_sec", 0))
            bts = d.get("bartenders", {})
            drinks_now = sum(int(b.get("total_drinks", 0)) for b in bts.values())
            age_s = int(time.time() - float(d.get("_updated_at", time.time())))
            rows_html += (
                f'<tr style="border-bottom:1px solid #1e293b;">'
                f'<td style="padding:6px 12px;color:#f1f5f9;font-weight:600">{label}</td>'
                f'<td style="padding:6px 12px;color:#f97316;font-weight:700">{drinks_now}</td>'
                f'<td style="padding:6px 12px;color:#94a3b8">{int(es//60)}m {int(es%60)}s</td>'
                f'<td style="padding:6px 12px;color:#64748b">{age_s}s ago</td>'
                f'</tr>'
            )
        st.markdown(
            f'<table style="width:100%;border-collapse:collapse;background:#0f172a;'
            f'border-radius:8px;overflow:hidden;font-size:0.88em;">'
            f'<thead><tr style="background:#1e293b;">'
            f'<th style="padding:6px 12px;color:#64748b;text-align:left;font-weight:600">Stream</th>'
            f'<th style="padding:6px 12px;color:#64748b;text-align:left;font-weight:600">Drinks</th>'
            f'<th style="padding:6px 12px;color:#64748b;text-align:left;font-weight:600">Elapsed</th>'
            f'<th style="padding:6px 12px;color:#64748b;text-align:left;font-weight:600">Updated</th>'
            f'</tr></thead><tbody>{rows_html}</tbody></table>',
            unsafe_allow_html=True,
        )
        st.markdown("<div style='height:10px'></div>", unsafe_allow_html=True)

    # ── Alert / clear banner ──────────────────────────────────────────────────
    if total_unrung > 0 or m["theft_flags"] > 0:
        loss_est = total_unrung * avg_price
        st.markdown(
            f'<div class="alert-banner">'
            f'⚠️ &nbsp;<strong>{total_unrung} unrung drink(s) detected</strong>'
            f' — possible revenue loss of '
            f'<strong>${loss_est:,.0f}</strong>. '
            f'Review the Results page for details.'
            f'</div>',
            unsafe_allow_html=True,
        )
    else:
        st.markdown(
            '<div class="clear-banner">✓ &nbsp;All clear — no unrung drinks or theft flags detected</div>',
            unsafe_allow_html=True,
        )

    st.markdown("<div style='height:6px'></div>", unsafe_allow_html=True)

    # ── Hero KPI strip ────────────────────────────────────────────────────────
    k1, k2, k3, k4, k5 = st.columns(5)

    with k1:
        st.markdown(
            '<div class="hero-card">'
            f'<div class="live-number">{total_drinks}</div>'
            '<div class="live-label">Drinks Served</div>'
            '<div style="color:#64748b;font-size:0.75em;margin-top:4px">last 60 min + live</div>'
            '</div>',
            unsafe_allow_html=True,
        )

    with k2:
        rev_str = f"${est_revenue:,.0f}"
        st.markdown(
            '<div class="hero-card" style="border-left-color:#22c55e">'
            f'<div class="live-number" style="color:#4ade80">{rev_str}</div>'
            '<div class="live-label">Est. Revenue</div>'
            f'<div style="color:#64748b;font-size:0.75em;margin-top:4px">${avg_price}/drink</div>'
            '</div>',
            unsafe_allow_html=True,
        )

    with k3:
        st.markdown(
            '<div class="hero-card" style="border-left-color:#38bdf8">'
            f'<div class="live-number" style="color:#38bdf8">{headcount}</div>'
            '<div class="live-label">People in Venue</div>'
            '<div style="color:#64748b;font-size:0.75em;margin-top:4px">current headcount</div>'
            '</div>',
            unsafe_allow_html=True,
        )

    with k4:
        u_color = "#ef4444" if total_unrung > 0 else "#4ade80"
        u_border = "#ef4444" if total_unrung > 0 else "#22c55e"
        st.markdown(
            f'<div class="hero-card" style="border-left-color:{u_border}">'
            f'<div class="live-number" style="color:{u_color}">{total_unrung}</div>'
            '<div class="live-label">Unrung Drinks</div>'
            '<div style="color:#64748b;font-size:0.75em;margin-top:4px">last 60 min</div>'
            '</div>',
            unsafe_allow_html=True,
        )

    with k5:
        if shift_elapsed_str:
            shift_display = shift_elapsed_str
            shift_sub = f"since {shift_start_raw}"
        else:
            shift_display = _datetime.datetime.now().strftime("%H:%M")
            shift_sub = "current time"
        st.markdown(
            '<div class="hero-card" style="border-left-color:#a78bfa">'
            f'<div class="live-number" style="color:#a78bfa;font-size:2em">{shift_display}</div>'
            '<div class="live-label">Shift Time</div>'
            f'<div style="color:#64748b;font-size:0.75em;margin-top:4px">{shift_sub}</div>'
            '</div>',
            unsafe_allow_html=True,
        )

    st.markdown("<div style='height:20px'></div>", unsafe_allow_html=True)

    # ── Tonight section ───────────────────────────────────────────────────────
    st.markdown("### 📅 Tonight")
    tonight_left, tonight_right = st.columns([3, 2])

    with tonight_left:
        st.markdown("##### 🏟️ Sports Tonight")
        with st.spinner("Loading sports schedule..."):
            games = _fetch_espn_games()

        if not games:
            st.markdown(
                '<div class="pace-placeholder">No major games found tonight</div>',
                unsafe_allow_html=True,
            )
        else:
            # Group by sport
            by_sport: dict[str, list] = {}
            for g in games:
                by_sport.setdefault(g["sport"], []).append(g)

            for sport, sport_games in by_sport.items():
                st.markdown(f"<span style='color:#94a3b8;font-size:0.8em;font-weight:700;"
                            f"text-transform:uppercase;letter-spacing:.08em'>{sport}</span>",
                            unsafe_allow_html=True)
                for g in sport_games[:6]:  # cap per sport
                    state_dot = "🔴" if g["state"] == "in" else ("✓" if g["state"] == "post" else "🕐")
                    network_str = f" · <span style='color:#64748b'>{g['network']}</span>" if g["network"] else ""
                    st.markdown(
                        f'<div class="event-card" style="margin:3px 0;padding:9px 14px;">'
                        f'<span style="font-weight:600">{g["away"]} vs {g["home"]}</span>'
                        f' &nbsp;{state_dot}&nbsp; '
                        f'<span style="color:#94a3b8;font-size:0.88em">{g["time_str"]}</span>'
                        f'{network_str}'
                        f'</div>',
                        unsafe_allow_html=True,
                    )

    with tonight_right:
        st.markdown("##### 📆 Day & Events")
        today_dt = _datetime.date.today()
        day_name = today_dt.strftime("%A")
        month_day = today_dt.strftime("%B %-d")

        # Day context
        dow = today_dt.weekday()  # 0=Mon, 6=Sun
        if dow == 4:
            day_context = "Friday — expect late crowd"
        elif dow == 5:
            day_context = "Saturday — peak night"
        elif dow == 6:
            day_context = "Sunday — wrap-up crowd"
        elif dow == 3:
            day_context = "Thursday — weekend kickoff"
        else:
            day_names_full = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
            day_context = day_names_full[dow]

        st.markdown(
            f'<div class="event-card">'
            f'<div style="font-size:1.4em;font-weight:800;color:#f97316">{day_name}</div>'
            f'<div style="color:#94a3b8;font-size:0.9em">{month_day}</div>'
            f'<div style="color:#cbd5e1;font-size:0.85em;margin-top:6px">{day_context}</div>'
            f'</div>',
            unsafe_allow_html=True,
        )

        # Holidays
        try:
            holidays = _fetch_holidays()
        except Exception:
            holidays = []

        if holidays:
            for hname in holidays:
                st.markdown(
                    f'<div class="event-card" style="border-color:#f97316;margin-top:6px">'
                    f'<span style="font-size:1.2em">🎉</span> '
                    f'<strong style="color:#fb923c">Holiday:</strong> '
                    f'<span style="color:#f1f5f9">{hname}</span>'
                    f'</div>',
                    unsafe_allow_html=True,
                )
        else:
            st.markdown(
                '<div style="color:#475569;font-size:0.82em;margin-top:8px">'
                'No US public holidays today</div>',
                unsafe_allow_html=True,
            )

    st.markdown("<div style='height:20px'></div>", unsafe_allow_html=True)

    # ── Bartender leaderboard ─────────────────────────────────────────────────
    st.markdown("### 🍺 Bartender Performance")

    if not all_bartenders:
        st.markdown(
            '<div class="pace-placeholder">'
            'Waiting for data... Bartender cards will appear once drink-count jobs complete.'
            '</div>',
            unsafe_allow_html=True,
        )
    else:
        sorted_bts = sorted(all_bartenders.items(),
                            key=lambda x: x[1]["drinks"], reverse=True)
        rank_styles = [
            ("bt-rank-gold",   "#92400e", "#fcd34d", "#f97316"),   # #1
            ("bt-rank-silver", "#374151", "#d1d5db", "#94a3b8"),   # #2
            ("bt-rank-bronze", "#431407", "#fb923c", "#fb923c"),   # #3
            ("bt-rank-other",  "#1e293b", "#64748b", "#64748b"),   # #4
        ]
        bt_cols = st.columns(min(len(sorted_bts), 4))
        for i, (name, data) in enumerate(sorted_bts[:4]):
            rank_cls, rank_bg, rank_fg, num_color = rank_styles[i] if i < 4 else rank_styles[3]
            pace = float(data.get("per_hour", 0))
            if pace > 20:
                pace_color = "#4ade80"
                pace_label = "Fast pace"
            elif pace >= 10:
                pace_color = "#fbbf24"
                pace_label = "Moderate"
            else:
                pace_color = "#f87171"
                pace_label = "Slow"

            with bt_cols[i]:
                st.markdown(
                    f'<div class="bt-card">'
                    f'<div style="display:flex;justify-content:center;margin-bottom:6px">'
                    f'<div style="background:{rank_bg};color:{rank_fg};border-radius:50%;'
                    f'width:30px;height:30px;display:flex;align-items:center;'
                    f'justify-content:center;font-weight:800;font-size:0.9em">#{i+1}</div>'
                    f'</div>'
                    f'<div style="font-size:2.2em;font-weight:800;color:{num_color};line-height:1">'
                    f'{data["drinks"]}</div>'
                    f'<div style="color:#f1f5f9;font-weight:600;margin:6px 0 4px;font-size:0.95em">'
                    f'{name}</div>'
                    f'<div style="color:{pace_color};font-size:0.8em;font-weight:600">'
                    f'{pace:.1f}/hr &nbsp;·&nbsp; {pace_label}</div>'
                    f'</div>',
                    unsafe_allow_html=True,
                )

    st.markdown("<div style='height:20px'></div>", unsafe_allow_html=True)

    # ── Drink pace chart ──────────────────────────────────────────────────────
    st.markdown("### 📈 Drink Pace — Last 60 Minutes")

    buckets = _pace_buckets()
    total_bucketed = sum(buckets.values())

    if total_bucketed == 0:
        st.markdown(
            '<div class="pace-placeholder">'
            'No data yet — pace chart will appear once jobs complete'
            '</div>',
            unsafe_allow_html=True,
        )
    else:
        import pandas as pd
        pace_df = pd.DataFrame({
            "Window": list(buckets.keys()),
            "Drinks": list(buckets.values()),
        }).set_index("Window")
        st.bar_chart(pace_df, use_container_width=True, height=200)

    st.markdown("<div style='height:20px'></div>", unsafe_allow_html=True)

    # ── Per-camera status ──────────────────────────────────────────────────────
    if cameras:
        st.markdown("### 📷 Camera Status")
        for cam in cameras:
            job    = _camera_current_job(cam["name"])
            status = job["status"] if job else "idle"
            prog   = job.get("progress", 0) if job else 0

            css_status = {"running": "status-live", "pending": "status-queued",
                          "done": "status-done", "failed": "status-failed",
                          "idle": "status-done"}.get(status, "status-done")
            status_label = {"running": "● LIVE", "pending": "◐ Queued",
                            "done": "✓ Ready", "failed": "✗ Error",
                            "idle": "⬜ Idle"}.get(status, status)

            with st.container():
                c1, c2, c3, c4 = st.columns([3, 2, 2, 2])
                with c1:
                    st.markdown(
                        f'<span class="cam-label">{cam["name"]}</span><br>'
                        f'<span class="{css_status}">{status_label}</span> '
                        f'<span style="color:#64748b;font-size:0.8em">'
                        f'{ANALYSIS_MODES.get(cam["mode"], cam["mode"])}</span>',
                        unsafe_allow_html=True)
                with c2:
                    seg = float(cam.get("segment_seconds", 60))
                    if status == "running":
                        if seg == 0:
                            lf = Path(RESULT_DIR) / job["job_id"] / "live.json"
                            if lf.exists():
                                try:
                                    ld = json.loads(lf.read_text())
                                    es = float(ld.get("_elapsed_sec", 0))
                                    bts_live = ld.get("bartenders", {})
                                    d_live = sum(int(b.get("total_drinks", 0)) for b in bts_live.values())
                                    age = int(time.time() - float(ld.get("_updated_at", time.time())))
                                    st.caption(f"🔴 {int(es//60)}m {int(es%60)}s · "
                                               f"**{d_live}** drinks · updated {age}s ago")
                                except Exception:
                                    st.caption("🔴 Running continuously...")
                            else:
                                st.caption("🔴 Starting...")
                        else:
                            st.progress(int(prog))
                            st.caption(f"{prog}% — {seg:.0f}s segment")
                    elif status == "done" and job:
                        s = _parse_summary(job)
                        bts = s.get("bartenders", {})
                        drinks = sum(d.get("total_drinks", 0) for d in bts.values())
                        st.caption(f"Last segment: **{drinks}** drinks")
                with c3:
                    cam_modes = [mm.strip() for mm in cam["mode"].split(",") if mm.strip()]
                    for cm in cam_modes[:3]:
                        cm_m = _rolling_metrics(cm)
                        if cm == "drink_count":
                            st.metric("Drinks (60 min)", cm_m["total_drinks"])
                        elif cm == "people_count":
                            st.metric("In venue", cm_m["current_headcount"])
                        elif cm == "table_turns":
                            rt = cm_m.get("avg_response_sec")
                            st.metric("Avg response", f"{int(rt)}s" if rt else "—")
                with c4:
                    seg = float(cam.get("segment_seconds", 60))
                    btn_label = "🔴 Go Live" if seg == 0 else "▶ Start"
                    if status not in ("running", "pending"):
                        if st.button(btn_label, key=f"quick_{cam['camera_id']}"):
                            jid   = str(uuid.uuid4())[:8]
                            label = f"📡 {cam['name']}"
                            if seg == 0:
                                label += " — 🔴 LIVE"
                            extra = {"max_seconds": seg}
                            create_job(
                                job_id=jid, analysis_mode=cam["mode"].split(",")[0],
                                shift_id=cam.get("shift_id"), shift_json=None,
                                source_type="rtsp", source_path=cam["rtsp_url"],
                                model_profile=cam.get("model_profile", "balanced"),
                                config_path=cam.get("config_path"),
                                annotate=False, clip_label=label,
                            )
                            modes_list = [mm.strip() for mm in cam["mode"].split(",") if mm.strip()]
                            extra["extra_modes"] = modes_list[1:]
                            _raw_update(jid, summary_json=json.dumps({"extra_config": extra}))
                            st.success(f"{'Live stream started' if seg==0 else 'Queued segment'} "
                                       f"for {cam['name']}")
                            st.rerun()
            st.divider()
    else:
        st.info("No cameras registered. Go to **➕ Add Camera** to get started.")

    # ── Auto-refresh ──────────────────────────────────────────────────────────
    if auto:
        time.sleep(10)
        st.rerun()


# ═══════════════════════════════════════════════════════════════════════════════
# TAB 2 — Cameras
# ═══════════════════════════════════════════════════════════════════════════════
with tab_cameras:
    cameras = list_cameras()
    if not cameras:
        st.info("No cameras registered yet. Use the **➕ Add Camera** tab.")
    else:
        st.subheader(f"{len(cameras)} Registered Camera(s)")
        st.caption("The worker daemon automatically loops each enabled camera. "
                   "Use ▶ Start on the Live Now tab for an immediate segment.")

        for cam in cameras:
            col1, col2, col3, col4 = st.columns([4, 2, 2, 1])
            with col1:
                st.markdown(f"**{cam['name']}**")
                st.caption(f"`{cam['rtsp_url']}`")
                if cam.get("notes"):
                    st.caption(cam["notes"])
            with col2:
                st.markdown(ANALYSIS_MODES.get(cam["mode"].split(",")[0], cam["mode"]))
                seg = float(cam.get("segment_seconds", 60))
                seg_label = "🔴 Continuous live" if seg == 0 else f"{seg:.0f}s segments"
                st.caption(f"{seg_label} · {cam.get('model_profile','balanced')}")
            with col3:
                enabled = cam.get("enabled", True)
                badge   = "live-badge-green" if enabled else "live-badge-amber"
                label   = "✓ Enabled" if enabled else "⏸ Paused"
                st.markdown(f'<span class="{badge}">{label}</span>',
                            unsafe_allow_html=True)
                # Toggle enabled state
                new_enabled = st.checkbox("Active", value=enabled,
                                          key=f"en_{cam['camera_id']}")
                if new_enabled != enabled:
                    save_camera(
                        camera_id=cam["camera_id"], name=cam["name"],
                        rtsp_url=cam["rtsp_url"], mode=cam["mode"],
                        config_path=cam.get("config_path"),
                        model_profile=cam.get("model_profile","balanced"),
                        segment_seconds=cam.get("segment_seconds", 60),
                        enabled=new_enabled, notes=cam.get("notes",""),
                    )
                    st.rerun()
            with col4:
                if st.button("🗑", key=f"del_{cam['camera_id']}",
                             help="Remove camera"):
                    delete_camera(cam["camera_id"])
                    st.rerun()
            st.divider()


# ═══════════════════════════════════════════════════════════════════════════════
# TAB 3 — Add Camera
# ═══════════════════════════════════════════════════════════════════════════════
with tab_add:
    st.subheader("Register New Camera")

    # ── Quick-add Blind Goat cameras ──────────────────────────────────────────
    _BG_CAMERAS = [
        ("CH7 — Bar (drink count)",       "http://192.168.1.252/hls/live/CH7/0/livetop.mp4",  "drink_count"),
        ("CH8 — Bar overhead (drink)",    "http://192.168.1.252/hls/live/CH8/0/livetop.mp4",  "drink_count"),
        ("CH9 — Behind bar (bottles)",    "http://192.168.1.252/hls/live/CH9/0/livetop.mp4",  "bottle_count"),
        ("CH2 — Patio seating",           "http://192.168.1.252/hls/live/CH2/0/livetop.mp4",  "people_count"),
        ("CH5 — Indoor floor",            "http://192.168.1.252/hls/live/CH5/0/livetop.mp4",  "table_turns"),
        ("CH6 — Dining room",             "http://192.168.1.252/hls/live/CH6/0/livetop.mp4",  "people_count"),
        ("CH1 — Main floor",              "http://192.168.1.252/hls/live/CH1/0/livetop.mp4",  "people_count"),
        ("CH3 — Outdoor/entrance",        "http://192.168.1.252/hls/live/CH3/0/livetop.mp4",  "people_count"),
        ("CH4 — Neon bar area",           "http://192.168.1.252/hls/live/CH4/0/livetop.mp4",  "drink_count"),
        ("CH10 — Parking/back entrance",  "http://192.168.1.252/hls/live/CH10/0/livetop.mp4", "after_hours"),
        ("CH12 — Parking lot",            "http://192.168.1.252/hls/live/CH12/0/livetop.mp4", "after_hours"),
    ]
    _existing_urls = {c["rtsp_url"] for c in list_cameras()}
    _unregistered  = [(n, u, m) for n, u, m in _BG_CAMERAS if u not in _existing_urls]
    if _unregistered:
        with st.expander(f"⚡ Quick-add Blind Goat cameras ({len(_unregistered)} not yet registered)",
                         expanded=True):
            st.caption("One click to add each camera in continuous live mode.")
            for _cn, _cu, _cm in _unregistered:
                _qc1, _qc2 = st.columns([5, 2])
                with _qc1:
                    st.markdown(f"**{_cn}**")
                    st.caption(f"`{_cu}`  ·  mode: {ANALYSIS_MODES.get(_cm, _cm)}")
                with _qc2:
                    if st.button("➕ Add live", key=f"qadd_{_cn}"):
                        _cid = str(uuid.uuid4())[:8]
                        save_camera(
                            camera_id=_cid, name=_cn.split(" — ")[0] + " Blind Goat",
                            rtsp_url=_cu, mode=_cm,
                            config_path=None, model_profile="fast",
                            segment_seconds=0.0,  # continuous
                            enabled=True,
                            notes=f"Blind Goat DVR — {_cn}",
                        )
                        st.success(f"✅ {_cn} added in continuous live mode!")
                        st.rerun()
                st.divider()

    st.subheader("Custom Camera")
    with st.form("add_cam_form"):
        fc1, fc2 = st.columns(2)
        with fc1:
            cam_name = st.text_input("Camera name *",
                placeholder="Main Bar — Overhead")
            cam_url  = st.text_input("Stream URL *",
                placeholder="http://192.168.1.252/hls/live/CH7/0/livetop.mp4  or  rtsp://...")
            st.caption("**What to detect** — select all that apply for this camera")
            all_modes = list(ANALYSIS_MODES.keys())
            selected_modes = st.multiselect(
                "Detection modes",
                options=all_modes,
                default=["drink_count"],
                format_func=lambda k: ANALYSIS_MODES[k],
                help="One camera can detect multiple things simultaneously. "
                     "First selected = primary mode."
            )
            cam_mode = ",".join(selected_modes) if selected_modes else "drink_count"
        with fc2:
            cam_profile = st.selectbox("Speed vs accuracy",
                ["fast", "balanced", "accurate"], index=0,
                help="'fast' recommended for real-time — results every 1-2 minutes.")
            cam_continuous = st.checkbox(
                "🔴 Continuous live mode",
                value=True,
                help="Stream runs forever — metrics pushed to dashboard every 30 seconds. "
                     "Best for always-on monitoring. Disable to use segmented mode instead."
            )
            if cam_continuous:
                cam_seg = 0.0
                st.caption("Segment length: **continuous** — never stops, "
                            "live metrics every 30s")
            else:
                cam_seg = float(st.number_input(
                    "Segment length (seconds)",
                    min_value=30, max_value=3600, value=60, step=30,
                    help="60s = near real-time. 300s = more accurate but 5 min delay."))
            cam_notes = st.text_area("Notes / location",
                placeholder="e.g. Left bar, overhead fisheye, covers 3 stations")

        configs = [p.stem for p in CONFIG_DIR.glob("*.json")]
        cam_cfg = None
        if configs and cam_mode == "drink_count":
            cam_cfg_sel = st.selectbox("Bar layout config (optional)",
                ["(none)"] + configs)
            if cam_cfg_sel != "(none)":
                cam_cfg = str(CONFIG_DIR / f"{cam_cfg_sel}.json")

        submitted = st.form_submit_button("💾 Save Camera", type="primary")
        if submitted:
            if not cam_name.strip():
                st.error("Camera name is required.")
            elif not cam_url.strip():
                st.error("RTSP URL is required.")
            else:
                cid = str(uuid.uuid4())[:8]
                save_camera(
                    camera_id=cid, name=cam_name.strip(),
                    rtsp_url=cam_url.strip(), mode=cam_mode,
                    config_path=cam_cfg, model_profile=cam_profile,
                    segment_seconds=float(cam_seg), enabled=True,
                    notes=cam_notes.strip(),
                )
                st.success(f"✅ Camera '{cam_name}' saved! "
                           "It will start automatically when the worker daemon is running.")
                st.rerun()

    st.divider()
    st.subheader("🔗 Test Camera Connection")
    test_url = st.text_input("RTSP URL to test",
        placeholder="rtsp://admin:pass@192.168.1.100:554/stream1")
    if st.button("Test Connection") and test_url.strip():
        import cv2
        with st.spinner("Connecting (up to 10 seconds)..."):
            try:
                cap = cv2.VideoCapture(test_url.strip(), cv2.CAP_FFMPEG)
                cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 8000)
                ok  = cap.isOpened()
                if ok:
                    ret, frame = cap.read()
                    if ret and frame is not None:
                        import numpy as np
                        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                        st.success(f"✅ Connected! Resolution: {frame.shape[1]}×{frame.shape[0]}")
                        st.image(frame_rgb, caption="Live frame snapshot",
                                 use_container_width=True)
                    else:
                        st.warning("Connected but couldn't read a frame — "
                                   "check stream path.")
                else:
                    st.error("Could not connect. Check the IP, port, username and password.")
                cap.release()
            except Exception as e:
                st.error(f"Connection error: {e}")

    st.divider()
    st.subheader("📋 Common RTSP URL formats")
    st.code("""
# Hikvision
rtsp://admin:PASSWORD@192.168.1.100:554/Streaming/Channels/101

# Dahua
rtsp://admin:PASSWORD@192.168.1.100:554/cam/realmonitor?channel=1&subtype=0

# Reolink
rtsp://admin:PASSWORD@192.168.1.100:554/h264Preview_01_main

# Generic (try this first)
rtsp://admin:PASSWORD@192.168.1.100:554/stream1
rtsp://admin:PASSWORD@192.168.1.100:554/live

# No auth
rtsp://192.168.1.100:554/stream
""", language="text")


# ═══════════════════════════════════════════════════════════════════════════════
# TAB 4 — Discover Cameras
# ═══════════════════════════════════════════════════════════════════════════════
with tab_discover:
    st.subheader("🔍 Discover Cameras on Your Network")
    st.caption(
        "Automatically finds ONVIF-compatible IP cameras on your local network "
        "using WS-Discovery multicast. Also scans USB/local cameras."
    )

    # ── ONVIF scan ────────────────────────────────────────────────────────────
    st.markdown("#### 📡 ONVIF Network Scan")
    st.info(
        "Click **Scan Network** to broadcast a WS-Discovery probe. Any ONVIF camera "
        "on the same subnet will respond. Most IP cameras from Hikvision, Dahua, Reolink, "
        "Axis, and Hanwha support ONVIF.",
        icon="ℹ️",
    )

    d1, d2 = st.columns([2, 1])
    with d1:
        onvif_timeout = st.slider("Scan timeout (seconds)", 2, 10, 3, key="onvif_timeout")
    with d2:
        onvif_user = st.text_input("Camera username", value="admin", key="onvif_user")
        onvif_pass = st.text_input("Camera password", type="password", key="onvif_pass")

    if st.button("🔍 Scan Network", type="primary", key="onvif_scan_btn"):
        with st.spinner(f"Scanning for {onvif_timeout}s..."):
            try:
                from core.onvif_discover import discover_cameras, get_rtsp_url
                found = discover_cameras(timeout=float(onvif_timeout))
                st.session_state["onvif_found"] = found
                if not found:
                    st.warning(
                        "No ONVIF cameras found. Make sure:\n"
                        "- This computer is on the same network as the cameras\n"
                        "- Cameras have ONVIF enabled (usually in the camera's web UI)\n"
                        "- Firewall allows UDP traffic to 239.255.255.250:3702"
                    )
                else:
                    st.success(f"Found {len(found)} camera(s)!")
            except Exception as e:
                st.error(f"Scan error: {e}")

    # Show discovered cameras
    if "onvif_found" in st.session_state and st.session_state["onvif_found"]:
        st.markdown("**Discovered cameras** — click Add to register:")
        for i, cam_info in enumerate(st.session_state["onvif_found"]):
            ip     = cam_info["ip"]
            xaddrs = cam_info.get("xaddrs", [])
            col_a, col_b, col_c = st.columns([3, 3, 2])
            with col_a:
                st.markdown(f"**{ip}**")
                if xaddrs:
                    st.caption(xaddrs[0][:60] + ("..." if len(xaddrs[0]) > 60 else ""))
            with col_b:
                if st.button(f"Fetch RTSP URL", key=f"fetch_rtsp_{i}"):
                    with st.spinner(f"Connecting to {ip}..."):
                        try:
                            from core.onvif_discover import get_rtsp_url
                            url = get_rtsp_url(
                                ip,
                                username=st.session_state.get("onvif_user", "admin"),
                                password=st.session_state.get("onvif_pass", ""),
                                xaddrs=xaddrs,
                            )
                            if url:
                                st.session_state[f"rtsp_for_{i}"] = url
                                st.success(f"Got URL: `{url[:60]}...`" if len(url) > 60 else f"Got URL: `{url}`")
                            else:
                                st.error("Could not retrieve RTSP URL. Check credentials.")
                        except Exception as e:
                            st.error(f"Error: {e}")
            with col_c:
                rtsp_url = st.session_state.get(f"rtsp_for_{i}")
                if rtsp_url and st.button(f"➕ Add Camera", key=f"add_disc_{i}"):
                    cid = str(uuid.uuid4())[:8]
                    save_camera(
                        camera_id=cid,
                        name=f"Camera {ip}",
                        rtsp_url=rtsp_url,
                        mode="drink_count",
                        config_path=None,
                        model_profile="balanced",
                        segment_seconds=60.0,
                        enabled=True,
                        notes=f"Auto-discovered via ONVIF from {ip}",
                    )
                    st.success(f"Camera added! Edit it in the **📷 Cameras** tab.")
                    st.rerun()
            st.divider()

    # ── USB / local camera scan ───────────────────────────────────────────────
    st.markdown("#### 🔌 USB / Local Cameras")
    st.caption("Scans device indices 0–8 for USB webcams or capture cards.")
    if st.button("Scan USB Cameras", key="usb_scan_btn"):
        with st.spinner("Scanning..."):
            try:
                from core.onvif_discover import scan_usb_cameras
                usb_cams = scan_usb_cameras()
                if not usb_cams:
                    st.info("No USB cameras found (indices 0–8).")
                else:
                    st.success(f"Found {len(usb_cams)} USB camera(s)!")
                    for uc in usb_cams:
                        ucol1, ucol2 = st.columns([3, 2])
                        with ucol1:
                            st.markdown(f"**{uc['name']}** (index {uc['index']})")
                        with ucol2:
                            if st.button(f"➕ Add {uc['name']}", key=f"add_usb_{uc['index']}"):
                                cid = str(uuid.uuid4())[:8]
                                save_camera(
                                    camera_id=cid,
                                    name=uc["name"],
                                    rtsp_url=uc["source_path"],
                                    mode="people_count",
                                    config_path=None,
                                    model_profile="fast",
                                    segment_seconds=60.0,
                                    enabled=True,
                                    notes="USB camera",
                                )
                                st.success(f"{uc['name']} added!")
                                st.rerun()
            except Exception as e:
                st.error(f"USB scan error: {e}")

    # ── Folder Watcher ────────────────────────────────────────────────────────
    st.divider()
    st.markdown("#### 📂 DVR Folder Watcher")
    st.caption(
        "If your DVR/NVR saves recordings to a network share or local folder, "
        "VenueScope can automatically process new files as they appear."
    )

    with st.form("folder_watch_form"):
        fw1, fw2 = st.columns(2)
        with fw1:
            fw_path  = st.text_input("Folder path *",
                placeholder="/mnt/dvr/bar  or  /Volumes/NAS/cameras/bar")
            fw_modes_sel = st.multiselect(
                "Detection modes",
                options=list(ANALYSIS_MODES.keys()),
                default=["drink_count"],
                format_func=lambda k: ANALYSIS_MODES[k],
            )
        with fw2:
            fw_profile = st.selectbox("Model speed", ["fast", "balanced", "accurate"],
                                      key="fw_profile")
            fw_poll    = st.number_input("Poll interval (seconds)", 10, 300, 15, step=5)
            fw_label   = st.text_input("Label prefix", placeholder="Bar DVR")

        fw_submitted = st.form_submit_button("📂 Start Watching Folder", type="primary")
        if fw_submitted:
            if not fw_path.strip():
                st.error("Folder path is required.")
            else:
                try:
                    from core.folder_watch import get_watcher, FolderWatchConfig
                    mode_str = ",".join(fw_modes_sel) if fw_modes_sel else "drink_count"
                    cfg = FolderWatchConfig(
                        path=fw_path.strip(),
                        mode=mode_str,
                        model_profile=fw_profile,
                        poll_seconds=float(fw_poll),
                        label_prefix=fw_label.strip(),
                    )
                    watcher = get_watcher()
                    fid = watcher.add_folder(cfg)
                    st.success(f"Now watching `{fw_path}` (id={fid}). "
                               "New video files will be auto-submitted as jobs.")
                except Exception as e:
                    st.error(f"Failed to start watcher: {e}")

    # Show active watchers
    try:
        from core.folder_watch import get_watcher
        watchers_list = get_watcher().list_folders()
        if watchers_list:
            st.markdown("**Active folder watchers:**")
            for fw in watchers_list:
                wc1, wc2, wc3 = st.columns([4, 2, 1])
                with wc1:
                    st.markdown(f"`{fw['path']}`")
                    st.caption(f"Mode: {fw['mode']} · Poll: {fw['poll_seconds']:.0f}s")
                with wc2:
                    alive = fw.get("alive", False)
                    st.markdown(
                        f'<span class="{"live-badge-green" if alive else "live-badge-amber"}">'
                        f'{"● Running" if alive else "⏸ Stopped"}</span>',
                        unsafe_allow_html=True,
                    )
                with wc3:
                    if st.button("Stop", key=f"stop_fw_{fw['folder_id']}"):
                        get_watcher().remove_folder(fw["folder_id"])
                        st.rerun()
                st.divider()
    except Exception:
        pass
