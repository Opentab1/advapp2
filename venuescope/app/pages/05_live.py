"""
VenueScope — Live Cameras
Register cameras per venue, launch live analysis, monitor streams.
"""
from __future__ import annotations
import uuid, json, time
from pathlib import Path
import streamlit as st

from core.config   import CONFIG_DIR, RESULT_DIR, ANALYSIS_MODES
from core.database import (
    list_cameras, list_venues, get_camera, save_camera, delete_camera,
    create_job, list_jobs, _raw_update,
)

st.set_page_config(page_title="Live Cameras · VenueScope", layout="wide")
st.markdown("""
<style>
.stApp,[data-testid="stSidebar"]{background:#0f172a;}
h1,h2,h3,label,p{color:#f1f5f9!important;}
.stButton>button{background:#f97316;color:#fff;border:none;border-radius:8px;font-weight:600;}
.venue-header{background:#1e293b;border-left:4px solid #f97316;padding:8px 14px;
              border-radius:4px;margin:16px 0 8px 0;font-weight:700;color:#f1f5f9;}
.status-running{color:#22c55e;font-weight:700;}
.status-pending{color:#facc15;font-weight:700;}
.status-done{color:#94a3b8;font-weight:700;}
.status-failed{color:#ef4444;font-weight:700;}
</style>""", unsafe_allow_html=True)

st.title("📡 Live Cameras")
st.caption("Register cameras per venue. Launch live analysis and monitor results in real time.")

# ── RTSP URL templates by brand ───────────────────────────────────────────────
RTSP_TEMPLATES = {
    "Hikvision":   "rtsp://admin:PASSWORD@IP:554/Streaming/Channels/101",
    "Dahua":       "rtsp://admin:PASSWORD@IP:554/cam/realmonitor?channel=1&subtype=0",
    "Reolink":     "rtsp://admin:PASSWORD@IP:554/h264Preview_01_main",
    "Axis":        "rtsp://root:PASSWORD@IP/axis-media/media.amp",
    "Uniview":     "rtsp://admin:PASSWORD@IP:554/media/video1",
    "Hanwha":      "rtsp://admin:PASSWORD@IP:554/profile1/media.smp",
    "Bosch":       "rtsp://IP/rtsp_tunnel?inst=1",
    "Amcrest":     "rtsp://admin:PASSWORD@IP:554/cam/realmonitor?channel=1&subtype=0",
    "Generic NVR": "rtsp://admin:PASSWORD@IP:554/stream1",
}

cameras = list_cameras()

tab_monitor, tab_cameras, tab_add = st.tabs(
    ["📊 Monitor", "📷 Cameras by Venue", "➕ Add / Edit Camera"]
)

# ─── TAB 1: Monitor ───────────────────────────────────────────────────────────
with tab_monitor:
    st.subheader("Active & Recent Streams")

    all_jobs  = list_jobs(100)
    rtsp_jobs = [j for j in all_jobs
                 if j.get("source_type") == "rtsp"
                 or (j.get("clip_label", "") or "").startswith("📡")]

    if not rtsp_jobs:
        st.info("No live stream jobs yet. Go to **Cameras by Venue** tab and click **Launch**.")
    else:
        auto_refresh = st.checkbox("Auto-refresh every 5s", value=True, key="live_autorefresh")

        running = [j for j in rtsp_jobs if j.get("status") in ("running", "pending")]
        done    = [j for j in rtsp_jobs if j.get("status") == "done"]
        failed  = [j for j in rtsp_jobs if j.get("status") == "failed"]

        mc1, mc2, mc3 = st.columns(3)
        mc1.metric("🟢 Active",    len(running))
        mc2.metric("✅ Completed", len(done))
        mc3.metric("❌ Failed",    len(failed))
        st.divider()

        for job in rtsp_jobs[:40]:
            status = job.get("status", "unknown")
            prog   = job.get("progress", 0)
            label  = job.get("clip_label", job["job_id"])
            mode   = ANALYSIS_MODES.get(job.get("analysis_mode", ""), job.get("analysis_mode", ""))
            ts_str = time.strftime("%H:%M:%S", time.localtime(job.get("created_at", 0)))
            css    = {"running": "status-running", "pending": "status-pending",
                      "done": "status-done", "failed": "status-failed"}.get(status, "status-done")
            badge  = {"running": "● LIVE", "pending": "◐ Queued",
                      "done": "✓ Done", "failed": "✗ Failed"}.get(status, status)

            c1, c2, c3 = st.columns([4, 2, 2])
            with c1:
                st.markdown(
                    f'<span class="{css}">{badge}</span> &nbsp; **{label}**'
                    f' &nbsp; <span style="color:#64748b">{mode} · {ts_str}</span>',
                    unsafe_allow_html=True)
            with c2:
                if status == "running":
                    st.progress(int(prog))
                elif status == "done":
                    try:
                        sj  = json.loads(job.get("summary_json") or "{}")
                        bts = sj.get("bartenders", {})
                        total = sum(d.get("total_drinks", 0) for d in bts.values())
                        st.markdown(f"**{total}** drinks")
                    except Exception:
                        st.markdown("Done")
            with c3:
                if status == "failed":
                    st.caption(str(job.get("error_msg", ""))[:80])
            st.divider()

        if auto_refresh:
            time.sleep(5)
            st.rerun()

# ─── TAB 2: Cameras by Venue ──────────────────────────────────────────────────
with tab_cameras:
    if not cameras:
        st.info("No cameras registered yet. Use the **➕ Add / Edit Camera** tab.")
    else:
        all_venue_names = sorted({c.get("venue", "Default Venue") for c in cameras})
        venue_filter    = st.selectbox(
            "Filter by venue", ["All venues"] + all_venue_names, key="venue_filter"
        )
        filtered = cameras if venue_filter == "All venues" else [
            c for c in cameras if c.get("venue") == venue_filter
        ]

        # Group by venue
        from collections import defaultdict
        by_venue: dict = defaultdict(list)
        for cam in filtered:
            by_venue[cam.get("venue", "Default Venue")].append(cam)

        selected_ids: list = []

        for venue_name, cams in sorted(by_venue.items()):
            st.markdown(
                f'<div class="venue-header">🏠 {venue_name}'
                f' <span style="color:#94a3b8;font-weight:400;font-size:0.85em">'
                f'({len(cams)} camera{"s" if len(cams) != 1 else ""})</span></div>',
                unsafe_allow_html=True)

            for cam in cams:
                col_chk, col_info, col_mode, col_act = st.columns([0.5, 4, 2, 2])
                with col_chk:
                    if st.checkbox("", key=f"sel_{cam['camera_id']}",
                                   value=cam.get("enabled", True)):
                        selected_ids.append(cam["camera_id"])
                with col_info:
                    st.markdown(f"**{cam['name']}**")
                    st.caption(f"`{cam['rtsp_url']}`")
                    if cam.get("notes"):
                        st.caption(cam["notes"])
                with col_mode:
                    st.markdown(ANALYSIS_MODES.get(cam["mode"], cam["mode"]))
                    st.caption(
                        f"{cam.get('segment_seconds', 300):.0f}s · "
                        f"{cam.get('model_profile', 'balanced')}")
                with col_act:
                    if st.button("✏️ Edit", key=f"edit_{cam['camera_id']}"):
                        st.session_state["edit_camera_id"] = cam["camera_id"]
                        st.rerun()
                    if st.button("🗑", key=f"del_{cam['camera_id']}"):
                        delete_camera(cam["camera_id"])
                        st.rerun()

        st.divider()

        lc1, lc2, lc3 = st.columns([2, 2, 3])
        with lc1:
            n_segments = st.number_input(
                "Segments per camera", 1, 100, 1,
                help="How many consecutive segments to queue. 1 = one 5-min chunk.")
        with lc2:
            st.write(""); st.write("")
            selected_cams = [c for c in cameras if c["camera_id"] in selected_ids]
            if st.button(
                f"🚀 Launch {len(selected_cams)} Camera(s)",
                type="primary", disabled=len(selected_cams) == 0
            ):
                launched = 0
                for cam in selected_cams:
                    for seg_i in range(int(n_segments)):
                        jid       = str(uuid.uuid4())[:8]
                        seg_label = f"📡 {cam.get('venue','')} — {cam['name']}"
                        if n_segments > 1:
                            seg_label += f" seg {seg_i + 1}"
                        extra = {"max_seconds": float(cam.get("segment_seconds", 300))}
                        create_job(
                            job_id=jid, analysis_mode=cam["mode"],
                            shift_id=cam.get("shift_id"), shift_json=None,
                            source_type="rtsp", source_path=cam["rtsp_url"],
                            model_profile=cam.get("model_profile", "balanced"),
                            config_path=cam.get("config_path"),
                            annotate=False, clip_label=seg_label,
                        )
                        _raw_update(jid, summary_json=json.dumps({"extra_config": extra}))
                        launched += 1
                st.success(f"✅ Launched {launched} job(s). See **Monitor** tab.")
                st.rerun()
        with lc3:
            st.info(f"**{len(selected_cams)}** selected · worker daemon must be running")

# ─── TAB 3: Add / Edit Camera ─────────────────────────────────────────────────
with tab_add:
    edit_id  = st.session_state.pop("edit_camera_id", None)
    edit_cam = get_camera(edit_id) if edit_id else None

    st.subheader("Register Camera" if not edit_cam else f"Edit: {edit_cam['name']}")

    # RTSP template helper
    with st.expander("🔧 RTSP URL templates — pick your camera brand"):
        st.markdown(
            "Replace **IP** with the camera/NVR's IP address and **PASSWORD** with its password. "
            "The IP is usually on a sticker on the unit, or find it by running "
            "`arp -a` on a device connected to the venue WiFi."
        )
        brand = st.selectbox("Brand", list(RTSP_TEMPLATES.keys()))
        st.code(RTSP_TEMPLATES[brand], language="text")

    st.divider()

    # Pre-fill venue from existing venue list for fast re-use
    known_venues = list_venues()

    with st.form("add_cam_form"):
        fc1, fc2 = st.columns(2)
        with fc1:
            # Venue: free text with autocomplete from known venues
            default_venue = edit_cam["venue"] if edit_cam else (
                known_venues[0] if len(known_venues) == 1 else ""
            )
            if known_venues:
                venue_choice = st.selectbox(
                    "Venue *",
                    ["➕ New venue…"] + known_venues,
                    index=(known_venues.index(edit_cam["venue"]) + 1)
                          if edit_cam and edit_cam.get("venue") in known_venues else 0,
                )
                if venue_choice == "➕ New venue…":
                    cam_venue = st.text_input("New venue name", value="", placeholder="Ferg's Bar")
                else:
                    cam_venue = venue_choice
                    st.caption(f"Adding to: **{cam_venue}**")
            else:
                cam_venue = st.text_input(
                    "Venue name *",
                    value=default_venue,
                    placeholder="Ferg's Bar")

            cam_name = st.text_input(
                "Camera name *",
                value=edit_cam["name"] if edit_cam else "",
                placeholder="Bar — Channel 9")
            cam_url  = st.text_input(
                "RTSP URL *",
                value=edit_cam["rtsp_url"] if edit_cam else "",
                placeholder="rtsp://admin:pass@192.168.1.100:554/stream1")
            cam_mode = st.selectbox(
                "Analysis mode",
                list(ANALYSIS_MODES.keys()),
                index=list(ANALYSIS_MODES.keys()).index(edit_cam["mode"])
                      if edit_cam and edit_cam["mode"] in ANALYSIS_MODES else 0,
                format_func=lambda k: ANALYSIS_MODES[k])
        with fc2:
            cam_profile = st.selectbox(
                "Model profile", ["fast", "balanced", "accurate"],
                index=["fast", "balanced", "accurate"].index(
                    edit_cam.get("model_profile", "balanced")) if edit_cam else 1)
            cam_seg  = st.number_input(
                "Segment length (seconds)", 60, 3600,
                int(edit_cam.get("segment_seconds", 300)) if edit_cam else 300, 60,
                help="Each segment = one analysis job. 300s = 5 min.")
            cam_notes = st.text_area(
                "Notes",
                value=edit_cam.get("notes", "") if edit_cam else "",
                placeholder="Overhead fisheye, covers full bar. Channel 9.")

        configs  = [p.stem for p in CONFIG_DIR.glob("*.json")]
        cfg_opts = ["(none)"] + configs
        cur_cfg  = None
        if edit_cam and edit_cam.get("config_path"):
            stem    = Path(edit_cam["config_path"]).stem
            cur_cfg = stem if stem in configs else None
        cam_cfg_sel = st.selectbox(
            "Bar layout config (optional — drink count only)",
            cfg_opts,
            index=cfg_opts.index(cur_cfg) if cur_cfg and cur_cfg in cfg_opts else 0)
        cam_cfg = (str(CONFIG_DIR / f"{cam_cfg_sel}.json")
                   if cam_cfg_sel != "(none)" else None)

        btn_label = "💾 Update Camera" if edit_cam else "💾 Save Camera"
        if st.form_submit_button(btn_label, type="primary"):
            venue_val = cam_venue.strip() if isinstance(cam_venue, str) else cam_venue
            if not venue_val:
                st.error("Venue name is required.")
            elif not cam_name.strip():
                st.error("Camera name is required.")
            elif not cam_url.strip():
                st.error("RTSP URL is required.")
            else:
                cid = edit_id or str(uuid.uuid4())[:8]
                save_camera(
                    camera_id       = cid,
                    venue           = venue_val,
                    name            = cam_name.strip(),
                    rtsp_url        = cam_url.strip(),
                    mode            = cam_mode,
                    config_path     = cam_cfg,
                    model_profile   = cam_profile,
                    segment_seconds = float(cam_seg),
                    notes           = cam_notes.strip(),
                )
                action = "updated" if edit_cam else "saved"
                st.success(f"✅ Camera '{cam_name.strip()}' {action}.")
                st.rerun()

    st.divider()
    st.subheader("🔗 Test Connection")
    st.caption("Paste any RTSP URL to verify it's reachable and grab a live frame.")

    test_url = st.text_input("RTSP URL to test", placeholder="rtsp://admin:pass@192.168.1.x:554/stream1")
    if st.button("Test Connection") and test_url.strip():
        import cv2
        with st.spinner("Connecting (up to 10 s)…"):
            try:
                cap = cv2.VideoCapture(test_url.strip(), cv2.CAP_FFMPEG)
                cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 10000)
                cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC,  5000)
                ok = cap.isOpened()
                if ok:
                    ret, frame = cap.read()
                    if ret and frame is not None:
                        st.success(
                            f"✅ Connected! Frame: {frame.shape[1]}×{frame.shape[0]}")
                        st.image(
                            cv2.cvtColor(frame, cv2.COLOR_BGR2RGB),
                            caption="Live frame snapshot", use_container_width=True)
                    else:
                        st.warning("Connected but couldn't read a frame — check the stream path.")
                else:
                    st.error("❌ Could not connect. Check IP, port, credentials, and VPN/network.")
                cap.release()
            except Exception as e:
                st.error(f"Connection error: {e}")
