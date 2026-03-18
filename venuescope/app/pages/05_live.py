"""
VenueScope — Live Cameras (RTSP multi-stream)
Register cameras, launch all at once, monitor live status.
"""
from __future__ import annotations
import uuid, json, time
from pathlib import Path
import streamlit as st

from core.config   import CONFIG_DIR, RESULT_DIR, ANALYSIS_MODES
from core.database import (
    list_cameras, get_camera, save_camera, delete_camera,
    create_job, list_jobs, get_job, _raw_update,
)

st.set_page_config(page_title="Live Cameras · VenueScope", layout="wide")
st.markdown("""
<style>
.stApp,[data-testid="stSidebar"]{background:#0f172a;}
h1,h2,h3,label,p{color:#f1f5f9!important;}
.stButton>button{background:#f97316;color:#fff;border:none;border-radius:8px;font-weight:600;}
.cam-card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:14px 16px;margin:6px 0;}
.status-running{color:#22c55e;font-weight:700;}
.status-pending{color:#facc15;font-weight:700;}
.status-done{color:#94a3b8;font-weight:700;}
.status-failed{color:#ef4444;font-weight:700;}
</style>""", unsafe_allow_html=True)

st.title("📡 Live Cameras")
st.caption("Register RTSP cameras, launch simultaneous analysis streams, monitor results in real time.")

cameras = list_cameras()

# ── Tabs ──────────────────────────────────────────────────────────────────────
tab_monitor, tab_cameras, tab_add = st.tabs(["📊 Monitor", "📷 Cameras", "➕ Add Camera"])

# ─── TAB 1: Monitor ───────────────────────────────────────────────────────────
with tab_monitor:
    st.subheader("Active & Recent Streams")

    # Find recent RTSP jobs (source_type == rtsp OR label contains "📡")
    all_jobs = list_jobs(100)
    rtsp_jobs = [j for j in all_jobs
                 if j.get("source_type") == "rtsp"
                 or (j.get("clip_label", "") or "").startswith("📡")]

    if not rtsp_jobs:
        st.info("No live stream jobs yet. Go to **Cameras** tab and click **Launch**.")
    else:
        # Auto-refresh toggle
        auto_refresh = st.checkbox("Auto-refresh every 5s", value=True, key="live_autorefresh")

        # Group by camera label prefix (📡 CameraName — …)
        running = [j for j in rtsp_jobs if j.get("status") in ("running", "pending")]
        done    = [j for j in rtsp_jobs if j.get("status") == "done"]
        failed  = [j for j in rtsp_jobs if j.get("status") == "failed"]

        mc1, mc2, mc3 = st.columns(3)
        mc1.metric("🟢 Active", len(running))
        mc2.metric("✅ Completed", len(done))
        mc3.metric("❌ Failed", len(failed))

        st.divider()
        for job in rtsp_jobs[:40]:
            status = job.get("status", "unknown")
            prog   = job.get("progress", 0)
            label  = job.get("clip_label", job["job_id"])
            mode   = ANALYSIS_MODES.get(job.get("analysis_mode", ""), job.get("analysis_mode", ""))
            ts     = job.get("created_at", 0)
            ts_str = time.strftime("%H:%M:%S", time.localtime(ts))

            css_cls = {"running": "status-running", "pending": "status-pending",
                       "done": "status-done", "failed": "status-failed"}.get(status, "status-done")
            status_label = {"running": "● LIVE", "pending": "◐ Queued",
                            "done": "✓ Done", "failed": "✗ Failed"}.get(status, status)

            with st.container():
                c1, c2, c3 = st.columns([4, 2, 2])
                with c1:
                    st.markdown(f'<span class="{css_cls}">{status_label}</span> &nbsp; **{label}** &nbsp; <span style="color:#64748b">{mode} · {ts_str}</span>', unsafe_allow_html=True)
                with c2:
                    if status == "running":
                        st.progress(int(prog))
                    elif status == "done":
                        # Show quick drink count if available
                        try:
                            sj = json.loads(job.get("summary_json") or "{}")
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

# ─── TAB 2: Cameras ───────────────────────────────────────────────────────────
with tab_cameras:
    if not cameras:
        st.info("No cameras registered yet. Use the **➕ Add Camera** tab.")
    else:
        st.subheader(f"{len(cameras)} Registered Camera(s)")

        # Select which cameras to launch
        selected = []
        for cam in cameras:
            col1, col2, col3, col4 = st.columns([0.5, 4, 2, 2])
            with col1:
                chk = st.checkbox("", key=f"sel_{cam['camera_id']}", value=cam.get("enabled", True))
                if chk:
                    selected.append(cam)
            with col2:
                st.markdown(f"**{cam['name']}**")
                st.caption(f"`{cam['rtsp_url']}`")
            with col3:
                st.markdown(ANALYSIS_MODES.get(cam["mode"], cam["mode"]))
                st.caption(f"{cam.get('segment_seconds', 300):.0f}s segments · {cam.get('model_profile','balanced')}")
            with col4:
                if st.button("🗑 Remove", key=f"del_{cam['camera_id']}"):
                    delete_camera(cam["camera_id"])
                    st.rerun()

        st.divider()

        lc1, lc2, lc3 = st.columns([2, 2, 3])
        with lc1:
            n_segments = st.number_input("Segments per camera", 1, 100, 1,
                help="How many consecutive segments to queue per camera. "
                     "1 = one 5-min chunk. Set high for all-night recording.")
        with lc2:
            st.write("")
            st.write("")
            if st.button(f"🚀 Launch {len(selected)} Camera(s)", type="primary",
                         disabled=len(selected) == 0):
                launched = 0
                for cam in selected:
                    for seg_i in range(int(n_segments)):
                        jid = str(uuid.uuid4())[:8]
                        seg_label = f"📡 {cam['name']}"
                        if n_segments > 1:
                            seg_label += f" — seg {seg_i+1}"

                        extra = {"max_seconds": float(cam.get("segment_seconds", 300))}

                        create_job(
                            job_id        = jid,
                            analysis_mode = cam["mode"],
                            shift_id      = cam.get("shift_id"),
                            shift_json    = None,
                            source_type   = "rtsp",
                            source_path   = cam["rtsp_url"],
                            model_profile = cam.get("model_profile", "balanced"),
                            config_path   = cam.get("config_path"),
                            annotate      = False,
                            clip_label    = seg_label,
                        )
                        # Store extra_config in summary_json slot (same trick as run page)
                        _raw_update(jid, summary_json=json.dumps({"extra_config": extra}))
                        launched += 1

                st.success(f"✅ Launched {launched} job(s). Go to **Monitor** tab to watch progress.")
                st.rerun()
        with lc3:
            st.info(f"**{len(selected)}** camera(s) selected · worker daemon must be running to process jobs")

# ─── TAB 3: Add Camera ────────────────────────────────────────────────────────
with tab_add:
    st.subheader("Register New Camera")

    with st.form("add_cam_form"):
        fc1, fc2 = st.columns(2)
        with fc1:
            cam_name = st.text_input("Camera name *", placeholder="Main Bar — Left Angle")
            cam_url  = st.text_input("RTSP URL *",
                placeholder="rtsp://admin:pass@192.168.1.100:554/stream1")
            cam_mode = st.selectbox("Analysis mode",
                list(ANALYSIS_MODES.keys()), format_func=lambda k: ANALYSIS_MODES[k])
        with fc2:
            cam_profile = st.selectbox("Model profile", ["fast", "balanced", "accurate"],
                index=1)
            cam_seg = st.number_input("Segment length (seconds)", 60, 3600, 300, 60,
                help="Each segment is processed as one job. 300s = 5 min per segment.")
            cam_notes = st.text_area("Notes", placeholder="Optional — location, angle, etc.")

        # Bar config picker (for drink_count mode)
        configs = [p.stem for p in CONFIG_DIR.glob("*.json")]
        cam_cfg = None
        if configs:
            cam_cfg_sel = st.selectbox("Bar layout config (optional)", ["(none)"] + configs)
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
                    camera_id     = cid,
                    name          = cam_name.strip(),
                    rtsp_url      = cam_url.strip(),
                    mode          = cam_mode,
                    config_path   = cam_cfg,
                    model_profile = cam_profile,
                    segment_seconds = float(cam_seg),
                    notes         = cam_notes.strip(),
                )
                st.success(f"✅ Camera '{cam_name}' saved! Go to **Cameras** tab to launch it.")
                st.rerun()

    st.divider()
    st.subheader("Test Connection")
    test_url = st.text_input("Test RTSP URL", placeholder="rtsp://...")
    if st.button("🔗 Test Connection") and test_url.strip():
        import cv2
        with st.spinner("Connecting..."):
            try:
                cap = cv2.VideoCapture(test_url.strip(), cv2.CAP_FFMPEG)
                ok  = cap.isOpened()
                if ok:
                    ret, frame = cap.read()
                    if ret and frame is not None:
                        import numpy as np
                        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                        st.success(f"✅ Connected! Frame: {frame.shape[1]}×{frame.shape[0]}")
                        st.image(frame_rgb, caption="Live frame", use_container_width=True)
                    else:
                        st.warning("Connected but could not read a frame.")
                else:
                    st.error("Could not connect. Check the URL and network.")
                cap.release()
            except Exception as e:
                st.error(f"Connection error: {e}")
