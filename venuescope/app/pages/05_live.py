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


# ── Page tabs ─────────────────────────────────────────────────────────────────

tab_live, tab_cameras, tab_add, tab_discover = st.tabs(
    ["🟢 Live Now", "📷 Cameras", "➕ Add Camera", "🔍 Discover Cameras"]
)

# ═══════════════════════════════════════════════════════════════════════════════
# TAB 1 — Live Now
# ═══════════════════════════════════════════════════════════════════════════════
with tab_live:
    cameras = list_cameras()

    # Header row
    hc1, hc2 = st.columns([5, 1])
    with hc1:
        st.markdown("### 🟢 Live Venue Dashboard")
    with hc2:
        auto = st.checkbox("Auto-refresh", value=True, key="live_auto")

    # ── Real-time live job panel ───────────────────────────────────────────────
    live_jobs = _live_job_metrics()
    if live_jobs:
        lt = _live_totals(live_jobs)
        elapsed_vals = [float(d.get("_elapsed_sec", 0)) for d in live_jobs]
        max_elapsed  = max(elapsed_vals) if elapsed_vals else 0
        hrs = int(max_elapsed // 3600)
        mins = int((max_elapsed % 3600) // 60)
        secs = int(max_elapsed % 60)
        elapsed_str = (f"{hrs}h {mins}m" if hrs else f"{mins}m {secs}s")

        st.markdown(
            f'<div style="background:#16a34a22;border:1px solid #16a34a;border-radius:12px;'
            f'padding:16px 20px;margin-bottom:12px;">'
            f'<span style="color:#4ade80;font-weight:700;font-size:1.05em">🔴 LIVE — '
            f'{len(live_jobs)} stream(s) running · {elapsed_str} elapsed</span>'
            f'</div>',
            unsafe_allow_html=True,
        )
        lc1, lc2, lc3, lc4 = st.columns(4)
        with lc1:
            st.markdown(f'<div class="live-number">{lt["drinks"]}</div>'
                        f'<div class="live-label">Drinks (live total)</div>',
                        unsafe_allow_html=True)
        with lc2:
            hc = max(0, lt["people_in"] - lt["people_out"])
            st.markdown(f'<div class="live-number" style="color:#38bdf8">{hc}</div>'
                        f'<div class="live-label">People in venue</div>',
                        unsafe_allow_html=True)
        with lc3:
            u_color = "#22c55e" if lt["unrung"] == 0 else "#ef4444"
            st.markdown(f'<div class="live-number" style="color:{u_color}">{lt["unrung"]}</div>'
                        f'<div class="live-label">Unrung drinks</div>',
                        unsafe_allow_html=True)
        with lc4:
            last_upd = max((float(d.get("_updated_at", 0)) for d in live_jobs), default=0)
            age_s = int(time.time() - last_upd) if last_upd else "—"
            st.markdown(f'<div class="live-number" style="color:#94a3b8;font-size:1.8em">'
                        f'{age_s}s</div>'
                        f'<div class="live-label">Since last update</div>',
                        unsafe_allow_html=True)

        # Per-stream detail
        for d in live_jobs:
            j = d.get("_job", {})
            label = j.get("clip_label", j.get("job_id", "?"))
            es    = float(d.get("_elapsed_sec", 0))
            bts   = d.get("bartenders", {})
            drinks_now = sum(int(b.get("total_drinks", 0)) for b in bts.values())
            st.caption(f"**{label}** · {drinks_now} drinks · "
                       f"{int(es//60)}m {int(es%60)}s elapsed · "
                       f"updated {int(time.time()-float(d.get('_updated_at',time.time())))}s ago")

        st.divider()
    else:
        st.caption("No continuous live streams running. "
                   "Add a camera with **Segment length = 0** for real-time mode, "
                   "or use segmented mode (60-120s) below.")
        st.divider()

    # ── Top KPIs (rolling 60-min from completed segments) ────────────────────
    st.caption("Rolling totals — completed segments from the last 60 minutes")
    m = _rolling_metrics()

    k1, k2, k3, k4, k5 = st.columns(5)
    with k1:
        st.markdown(f'<div class="live-number">{m["total_drinks"]}</div>'
                    f'<div class="live-label">Drinks Served (60 min)</div>',
                    unsafe_allow_html=True)
    with k2:
        color = "live-number" if m["current_headcount"] == 0 else "live-number"
        st.markdown(f'<div class="live-number" style="color:#38bdf8">'
                    f'{m["current_headcount"]}</div>'
                    f'<div class="live-label">People In Venue</div>',
                    unsafe_allow_html=True)
    with k3:
        rt = m["avg_response_sec"]
        rt_str = f"{int(rt)}s" if rt else "—"
        rt_color = "#22c55e" if rt and rt < 120 else "#f97316" if rt and rt < 300 else "#ef4444"
        st.markdown(f'<div class="live-number" style="color:{rt_color}">{rt_str}</div>'
                    f'<div class="live-label">Avg Server Response</div>',
                    unsafe_allow_html=True)
    with k4:
        u = m["unrung_drinks"]
        u_color = "#22c55e" if u == 0 else "#ef4444"
        st.markdown(f'<div class="live-number" style="color:{u_color}">{u}</div>'
                    f'<div class="live-label">Unrung Drinks</div>',
                    unsafe_allow_html=True)
    with k5:
        n_cams = len(cameras)
        active_cams = sum(1 for c in cameras
                          if (_camera_current_job(c["name"]) or {}).get("status")
                          in ("running", "pending"))
        st.markdown(f'<div class="live-number" style="color:#a78bfa">{active_cams}/{n_cams}</div>'
                    f'<div class="live-label">Cameras Active</div>',
                    unsafe_allow_html=True)

    st.divider()

    # ── Per-camera status ──────────────────────────────────────────────────────
    if not cameras:
        st.info("No cameras registered. Go to **➕ Add Camera** to get started.")
    else:
        st.subheader("Camera Status")
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
                            # Continuous — look for live.json
                            lf = Path(RESULT_DIR) / job["job_id"] / "live.json"
                            if lf.exists():
                                try:
                                    ld = json.loads(lf.read_text())
                                    es = float(ld.get("_elapsed_sec", 0))
                                    bts_live = ld.get("bartenders", {})
                                    d_live = sum(int(b.get("total_drinks",0)) for b in bts_live.values())
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
                    # Quick launch button
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
                                model_profile=cam.get("model_profile","balanced"),
                                config_path=cam.get("config_path"),
                                annotate=False, clip_label=label,
                            )
                            modes_list = [m.strip() for m in cam["mode"].split(",") if m.strip()]
                            extra["extra_modes"] = modes_list[1:]
                            _raw_update(jid, summary_json=json.dumps({"extra_config": extra}))
                            st.success(f"{'Live stream started' if seg==0 else 'Queued segment'} "
                                       f"for {cam['name']}")
                            st.rerun()
            st.divider()

    # ── Bartender leaderboard ──────────────────────────────────────────────────
    if m["bartenders"]:
        st.subheader("Bartender Performance — Last 60 Minutes")
        sorted_bts = sorted(m["bartenders"].items(),
                            key=lambda x: x[1]["drinks"], reverse=True)
        bt_cols = st.columns(min(len(sorted_bts), 4))
        for i, (name, data) in enumerate(sorted_bts[:4]):
            with bt_cols[i]:
                st.markdown(
                    f'<div style="background:#1e293b;border:1px solid #334155;'
                    f'border-radius:10px;padding:14px;text-align:center;">'
                    f'<div style="font-size:2em;font-weight:800;color:#f97316">'
                    f'{data["drinks"]}</div>'
                    f'<div style="color:#f1f5f9;font-weight:600;margin:4px 0">{name}</div>'
                    f'<div style="color:#94a3b8;font-size:0.8em">'
                    f'{data["per_hour"]:.1f} drinks/hr</div>'
                    f'</div>',
                    unsafe_allow_html=True)

    # Theft alert banner
    if m["unrung_drinks"] > 0:
        st.error(f"⚠️ **{m['unrung_drinks']} unrung drink(s) detected** in the last 60 minutes. "
                 f"Review the Results page for details.")

    # Auto-refresh
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
