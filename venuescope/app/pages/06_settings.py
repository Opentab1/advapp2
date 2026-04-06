"""
VenueScope — Settings & Backup
- Export/import all configs (bar layouts + shifts) as JSON backup
- Multi-camera batch job submission
- Venue preferences
"""
import json, time
import streamlit as st
from pathlib import Path

from core.database import (export_configs, import_configs, create_job, list_jobs_filtered,
                           list_cameras, list_venues, get_camera, save_camera, delete_camera,
                           _raw_update)
from core.config   import UPLOAD_DIR, RESULT_DIR, CONFIG_DIR, ANALYSIS_MODES, MODEL_PROFILES
from core.shift    import ShiftManager
from core.bar_config import BarConfig
import shutil
from core.auth import require_auth as _page_auth
_page_auth()

st.title("⚙️ Settings & Backup")

tab1, tab2, tab3, tab4, tab5, tab6 = st.tabs(["📡 Cameras", "💾 Backup & Restore", "🎥 Batch Analysis", "🏠 Venue", "🔐 Security", "📋 Compliance"])

# ─────────────────────────────────────────────────────────────────────────────
# TAB 1: Backup / Restore
# ─────────────────────────────────────────────────────────────────────────────
with tab1:  # ── Cameras ──────────────────────────────────────────────────────
    import uuid as _uuid, json as _json

    RTSP_TEMPLATES = {
        "Hikvision":   "rtsp://admin:PASSWORD@IP:554/Streaming/Channels/101",
        "Dahua":       "rtsp://admin:PASSWORD@IP:554/cam/realmonitor?channel=1&subtype=0",
        "Reolink":     "rtsp://admin:PASSWORD@IP:554/h264Preview_01_main",
        "Axis":        "rtsp://root:PASSWORD@IP/axis-media/media.amp",
        "Uniview":     "rtsp://admin:PASSWORD@IP:554/media/video1",
        "Amcrest":     "rtsp://admin:PASSWORD@IP:554/cam/realmonitor?channel=1&subtype=0",
        "Generic NVR": "rtsp://admin:PASSWORD@IP:554/stream1",
    }

    cameras_list = list_cameras()
    cam_tab_reg, cam_tab_add = st.tabs(["📷 Registered Cameras", "➕ Add Camera"])

    with cam_tab_reg:
        if not cameras_list:
            st.info("No cameras registered yet. Use **Add Camera** to get started.")
        else:
            all_venue_names = sorted({c.get("venue","Default Venue") for c in cameras_list})
            vf = st.selectbox("Filter by venue", ["All venues"] + all_venue_names, key="cam_vf")
            shown = cameras_list if vf == "All venues" else [
                c for c in cameras_list if c.get("venue") == vf
            ]
            from collections import defaultdict as _dd
            by_venue = _dd(list)
            for c in shown:
                by_venue[c.get("venue","Default Venue")].append(c)

            for vname, vcams in sorted(by_venue.items()):
                st.markdown(f"**🏠 {vname}** &nbsp; <span style='color:#94a3b8;font-size:0.85em'>({len(vcams)} camera{'s' if len(vcams)!=1 else ''})</span>", unsafe_allow_html=True)
                for cam in vcams:
                    c1, c2, c3, c4 = st.columns([3, 2, 1, 1])
                    with c1:
                        st.markdown(f"**{cam['name']}**")
                        st.caption(f"`{cam['rtsp_url']}`")
                    with c2:
                        st.caption(ANALYSIS_MODES.get(cam["mode"], cam["mode"]))
                        st.caption(f"{cam.get('segment_seconds',300):.0f}s · {cam.get('model_profile','balanced')}")
                    with c3:
                        if st.button("Edit", key=f"se_{cam['camera_id']}"):
                            st.session_state["_edit_cam_id"] = cam["camera_id"]
                            st.rerun()
                    with c4:
                        if st.button("🗑", key=f"sd_{cam['camera_id']}"):
                            delete_camera(cam["camera_id"])
                            st.rerun()
                st.divider()

        # Test connection
        st.subheader("🔗 Test Connection")
        test_url = st.text_input("RTSP URL", placeholder="rtsp://admin:pass@192.168.1.x:554/stream1", key="cam_test_url")
        if st.button("Test") and test_url.strip():
            import cv2 as _cv2
            with st.spinner("Connecting…"):
                try:
                    cap = _cv2.VideoCapture(test_url.strip(), _cv2.CAP_FFMPEG)
                    cap.set(_cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 10000)
                    if cap.isOpened():
                        ret, frame = cap.read()
                        if ret and frame is not None:
                            st.success(f"✅ Connected — {frame.shape[1]}×{frame.shape[0]}")
                            st.image(_cv2.cvtColor(frame, _cv2.COLOR_BGR2RGB), use_container_width=True)
                        else:
                            st.warning("Connected but no frame — check stream path.")
                    else:
                        st.error("❌ Could not connect — check IP, port, and credentials.")
                    cap.release()
                except Exception as _e:
                    st.error(f"Error: {_e}")

    with cam_tab_add:
        edit_id  = st.session_state.pop("_edit_cam_id", None)
        edit_cam = get_camera(edit_id) if edit_id else None
        st.subheader("Edit Camera" if edit_cam else "Register New Camera")

        with st.expander("🔧 RTSP URL templates by brand"):
            st.markdown("Replace **IP** with the camera/NVR IP and **PASSWORD** with its password.")
            brand = st.selectbox("Brand", list(RTSP_TEMPLATES.keys()), key="cam_brand")
            st.code(RTSP_TEMPLATES[brand])

        known_venues = list_venues()
        with st.form("cam_form"):
            f1, f2 = st.columns(2)
            with f1:
                if known_venues:
                    vc = st.selectbox("Venue *", ["➕ New venue…"] + known_venues,
                                      index=(known_venues.index(edit_cam["venue"])+1
                                             if edit_cam and edit_cam.get("venue") in known_venues else 0),
                                      key="cam_venue_sel")
                    cam_venue = st.text_input("New venue name", key="cam_venue_new") if vc == "➕ New venue…" else vc
                else:
                    cam_venue = st.text_input("Venue name *", value=edit_cam["venue"] if edit_cam else "", placeholder="Ferg's Bar")
                cam_name    = st.text_input("Camera name *", value=edit_cam["name"] if edit_cam else "", placeholder="Bar — CH9")
                cam_url     = st.text_input("RTSP URL *",    value=edit_cam["rtsp_url"] if edit_cam else "", placeholder="rtsp://…")
                cam_mode    = st.selectbox("Analysis mode", list(ANALYSIS_MODES.keys()),
                                           index=list(ANALYSIS_MODES.keys()).index(edit_cam["mode"]) if edit_cam and edit_cam["mode"] in ANALYSIS_MODES else 0,
                                           format_func=lambda k: ANALYSIS_MODES[k])
            with f2:
                cam_profile = st.selectbox("Model profile", ["fast","balanced","accurate"],
                                           index=["fast","balanced","accurate"].index(edit_cam.get("model_profile","balanced")) if edit_cam else 1)
                cam_seg     = st.number_input("Segment (sec)", 60, 3600, int(edit_cam.get("segment_seconds",300)) if edit_cam else 300, 60)
                cam_notes   = st.text_area("Notes", value=edit_cam.get("notes","") if edit_cam else "", placeholder="Overhead fisheye, full bar. CH9.")

            configs  = [p.stem for p in CONFIG_DIR.glob("*.json")]
            cfg_opts = ["(none)"] + configs
            cur_cfg  = Path(edit_cam["config_path"]).stem if edit_cam and edit_cam.get("config_path") else None
            cam_cfg_sel = st.selectbox("Bar layout config (optional)", cfg_opts,
                                       index=cfg_opts.index(cur_cfg) if cur_cfg and cur_cfg in cfg_opts else 0)
            cam_cfg = str(CONFIG_DIR/f"{cam_cfg_sel}.json") if cam_cfg_sel != "(none)" else None

            if st.form_submit_button("💾 Save Camera", type="primary"):
                vv = (cam_venue or "").strip()
                if not vv:
                    st.error("Venue name required.")
                elif not cam_name.strip():
                    st.error("Camera name required.")
                elif not cam_url.strip():
                    st.error("RTSP URL required.")
                else:
                    save_camera(camera_id=edit_id or str(_uuid.uuid4())[:8],
                                venue=vv, name=cam_name.strip(), rtsp_url=cam_url.strip(),
                                mode=cam_mode, config_path=cam_cfg, model_profile=cam_profile,
                                segment_seconds=float(cam_seg), notes=cam_notes.strip())
                    st.success(f"✅ Camera '{cam_name.strip()}' saved.")
                    st.rerun()

# ─────────────────────────────────────────────────────────────────────────────
# TAB 2: Backup / Restore (was tab1)
# ─────────────────────────────────────────────────────────────────────────────
with tab2:
    st.subheader("Export Backup")
    st.markdown(
        "Exports all bar layout configs and shift templates as a single JSON file. "
        "**Save this file somewhere safe** — if the Pi fails, you can restore from it."
    )

    if st.button("📦 Generate Backup", type="primary"):
        data = export_configs()
        n_cfg   = len(data.get("bar_configs", {}))
        n_shift = len(data.get("shifts", []))
        blob    = json.dumps(data, indent=2)
        fname   = f"venuescope_backup_{time.strftime('%Y%m%d_%H%M')}.json"
        st.download_button(
            f"⬇️ Download Backup ({n_cfg} configs, {n_shift} shifts)",
            blob, fname, "application/json", type="primary"
        )
        st.success(f"Backup ready: {n_cfg} bar config(s), {n_shift} shift(s)")

    st.divider()
    st.subheader("Restore from Backup")
    st.warning("⚠️ Restoring will **add or overwrite** configs and shifts with names matching the backup. "
               "Existing configs with different names are not affected.")

    restore_file = st.file_uploader("Upload backup JSON", type=["json"], key="restore_upload")
    if restore_file:
        try:
            data = json.loads(restore_file.read())
            n_cfg   = len(data.get("bar_configs", {}))
            n_shift = len(data.get("shifts", []))
            st.info(f"Backup contains: {n_cfg} bar config(s), {n_shift} shift(s)")
            if st.button("✅ Restore", type="primary"):
                imported_cfg, imported_shift = import_configs(data)
                st.success(f"Restored {imported_cfg} bar config(s) and {imported_shift} shift(s).")
        except Exception as e:
            st.error(f"Could not read backup: {e}")

    st.divider()
    st.subheader("Disk Usage")
    import shutil as _sh
    total, used, free = _sh.disk_usage("/")
    gb = 1024**3
    st.metric("Free disk", f"{free/gb:.1f} GB")

    # Show result dirs by size
    result_path = Path(RESULT_DIR)
    if result_path.exists():
        dirs = sorted(result_path.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
        rows = []
        total_results_mb = 0
        for d in dirs[:20]:
            if d.is_dir():
                sz = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
                total_results_mb += sz / 1024**2
                rows.append({"Job": d.name, "Size (MB)": round(sz/1024**2, 1)})
        if rows:
            import pandas as pd
            st.caption(f"Result directories using {total_results_mb:.0f} MB total")
            st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
            st.caption("Delete jobs from the Dashboard to free space.")

# ─────────────────────────────────────────────────────────────────────────────
# TAB 3: Batch / Multi-Camera
# ─────────────────────────────────────────────────────────────────────────────
with tab3:
    st.subheader("🎥 Multi-Camera Batch Analysis")
    st.markdown(
        "Submit multiple clips at once — one per camera. "
        "They will queue and process in order (Pi 5 runs one job at a time)."
    )

    # Common settings
    bc1, bc2 = st.columns(2)
    with bc1:
        batch_mode = st.selectbox("Analysis mode (applied to all)",
                                   list(ANALYSIS_MODES.keys()),
                                   format_func=lambda k: ANALYSIS_MODES[k])
        batch_profile = st.select_slider("Speed/accuracy",
                                          ["fast", "balanced", "accurate"],
                                          value="balanced")
    with bc2:
        batch_label_prefix = st.text_input("Label prefix",
                                            placeholder="Friday Night",
                                            help="Each clip will be labeled 'prefix — filename'")
        if batch_mode == "drink_count":
            configs = [p.stem for p in CONFIG_DIR.glob("*.json")]
            batch_config = st.selectbox("Bar layout config", configs) if configs else None
            from core.database import list_shifts
            shifts = list_shifts()
            if shifts:
                sopts = {f"{s['shift_name']} [{s['shift_id']}]": s["shift_id"] for s in shifts}
                batch_shift_key = st.selectbox("Shift", list(sopts.keys()))
                batch_shift_id  = sopts[batch_shift_key]
            else:
                batch_shift_id = None
                st.warning("No shifts saved.")
        else:
            batch_config   = None
            batch_shift_id = None

    st.markdown("**Upload clips (one per camera):**")
    batch_files = st.file_uploader(
        "Video clips", type=["mp4","avi","mov","mpeg4"],
        accept_multiple_files=True, key="batch_upload"
    )

    if batch_files:
        st.caption(f"{len(batch_files)} file(s) selected")
        for bf in batch_files:
            st.markdown(f"  · `{bf.name}`")

        if st.button(f"🚀 Submit {len(batch_files)} Job(s)", type="primary"):
            from workers.job_runner import get_runner
            import uuid
            submitted = []
            for bf in batch_files:
                job_id = str(uuid.uuid4())[:8]
                jdir   = Path(UPLOAD_DIR)/job_id
                jdir.mkdir(parents=True, exist_ok=True)
                dest   = jdir/bf.name
                dest.write_bytes(bf.read())

                # Build shift_json if needed
                shift_json = None
                if batch_shift_id:
                    from core.database import get_shift
                    so = get_shift(batch_shift_id)
                    if so:
                        sm = ShiftManager(batch_shift_id, so["bartenders"])
                        shift_json = json.dumps(sm.to_dict())

                config_path = (str(CONFIG_DIR/f"{batch_config}.json")
                               if batch_config else None)
                label = f"{batch_label_prefix} — {bf.name}" if batch_label_prefix else bf.name

                create_job(
                    job_id=job_id, analysis_mode=batch_mode,
                    shift_id=batch_shift_id, shift_json=shift_json,
                    source_type="file", source_path=str(dest),
                    model_profile=batch_profile, config_path=config_path,
                    annotate=False, clip_label=label
                )
                import json as _json
                from core.database import _raw_update
                _raw_update(job_id, summary_json=_json.dumps({"extra_config":{}}))
                get_runner().submit(job_id)
                submitted.append(job_id)

            st.success(f"✅ {len(submitted)} job(s) queued: {', '.join(submitted)}")
            st.info("Monitor progress on the Dashboard or Run Analysis page.")

    # Show current queue
    st.divider()
    st.subheader("Current Queue")
    running = [j for j in list_jobs_filtered(50)
               if j["status"] in ("pending","running")]
    if not running:
        st.caption("No jobs running.")
    else:
        import pandas as pd
        rows = [{"ID": j["job_id"], "Clip": j.get("clip_label",""),
                 "Status": j["status"], "Progress": f"{j.get('progress',0):.0f}%"}
                for j in running]
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
        st.button("↻ Refresh queue", on_click=st.rerun)

# ─────────────────────────────────────────────────────────────────────────────
# TAB 4: Venue preferences
# ─────────────────────────────────────────────────────────────────────────────
with tab4:
    st.subheader("🏠 Venue Preferences")

    # PIN change
    st.markdown("**Change Access PIN**")
    import os
    current_pin_env = os.environ.get("VENUESCOPE_PIN","1234")
    st.info(
        "The PIN is set via the `VENUESCOPE_PIN` environment variable. "
        "To change it, update that variable and restart VenueScope.\n\n"
        "Example: `VENUESCOPE_PIN=9876 ./start.sh`"
    )
    if current_pin_env == "1234":
        st.warning("⚠️ You are using the default PIN `1234`. Change it before going live.")

    st.divider()

    # Venue name (stored in session)
    st.markdown("**Venue Name**")
    st.caption("This appears on PDF reports.")
    vname = st.text_input("Venue name",
                           st.session_state.get("venue_name","My Venue"),
                           key="settings_venue_name")
    if st.button("Save venue name"):
        st.session_state["venue_name"] = vname
        st.success(f"Saved: {vname}")

    st.divider()

    # Theft defaults
    st.markdown("**Default Theft Thresholds**")
    dt1, dt2 = st.columns(2)
    with dt1:
        default_review = st.number_input(
            "Default REVIEW threshold", 1, 100,
            int(st.session_state.get("thresh_review", 5)))
    with dt2:
        default_check = st.number_input(
            "Default CHECK threshold", 1, 100,
            int(st.session_state.get("thresh_check", 2)))
    if st.button("Save defaults"):
        st.session_state["thresh_review"] = default_review
        st.session_state["thresh_check"]  = default_check
        st.success("Defaults saved for this session.")
    st.caption("These are session defaults — they pre-fill on the Results page.")

# ─────────────────────────────────────────────────────────────────────────────
# TAB 5: Security
# ─────────────────────────────────────────────────────────────────────────────
with tab5:
    st.subheader("🔐 Access Security")

    # PIN change
    st.markdown("**Change Access PIN**")
    st.caption("The new PIN takes effect immediately — no restart required.")
    from core.auth import change_pin
    import os as _os
    current_env_pin = _os.environ.get("VENUESCOPE_PIN", "1234")
    if current_env_pin == "1234":
        st.warning("⚠️ You are still using the default PIN `1234`. Change it now.")

    with st.form("pin_change_form"):
        new_pin1 = st.text_input("New PIN", type="password", placeholder="Enter new PIN")
        new_pin2 = st.text_input("Confirm PIN", type="password", placeholder="Re-enter new PIN")
        if st.form_submit_button("🔑 Update PIN", type="primary"):
            if not new_pin1:
                st.error("PIN cannot be empty.")
            elif new_pin1 != new_pin2:
                st.error("PINs do not match.")
            elif len(new_pin1) < 4:
                st.error("PIN must be at least 4 characters.")
            else:
                change_pin(new_pin1)
                st.success("✅ PIN updated. Use the new PIN on next login.")

    st.divider()

    # Session timeout
    st.markdown("**Session Timeout**")
    from core.database import get_preferences, save_preferences
    prefs = get_preferences()
    current_timeout = int(prefs.get("session_timeout_minutes", 480))
    new_timeout = st.select_slider(
        "Auto-lock after inactivity",
        options=[30, 60, 120, 240, 480, 1440],
        value=current_timeout if current_timeout in [30,60,120,240,480,1440] else 480,
        format_func=lambda v: f"{v} min ({v//60}h)" if v >= 60 else f"{v} min"
    )
    if st.button("Save timeout"):
        save_preferences({"session_timeout_minutes": new_timeout})
        st.success(f"Session timeout set to {new_timeout} minutes.")

    st.divider()

    # Data retention
    st.markdown("**Data Retention**")
    st.caption("Automatically delete completed job results older than N days. "
               "Snapshots, clips, annotated videos, and CSV exports are all removed. "
               "Set to 0 to keep everything forever.")
    current_retention = int(prefs.get("retention_days", 0))
    new_retention = st.number_input(
        "Delete results older than (days)", 0, 3650, current_retention,
        help="0 = keep forever. 30 = delete results after 30 days. Runs automatically every 6 hours."
    )
    if new_retention != current_retention:
        if st.button("Save retention policy"):
            save_preferences({"retention_days": new_retention})
            st.success(f"Retention set to {new_retention} days." if new_retention > 0
                       else "Retention disabled — results kept forever.")

    if new_retention > 0:
        st.info(f"Results older than **{new_retention} days** will be automatically deleted by the worker daemon.")
        if st.button("🗑 Run cleanup now"):
            from core.database import cleanup_old_results
            n = cleanup_old_results(new_retention)
            st.success(f"Deleted {n} old job(s).")

# ─────────────────────────────────────────────────────────────────────────────
# TAB 6: Compliance
# ─────────────────────────────────────────────────────────────────────────────
with tab6:
    st.subheader("📋 Recording Compliance Checklist")
    st.markdown(
        "VenueScope records video of your staff and premises. "
        "Complete this checklist to confirm you've met your legal obligations. "
        "Requirements vary by jurisdiction — consult a lawyer if unsure."
    )

    from core.database import get_preferences, save_preferences
    prefs = get_preferences()
    compliance = prefs.get("compliance", {})

    items = [
        ("notice_posted",    "📌 **Recording notices are posted** at all camera locations visible to staff and customers"),
        ("staff_informed",   "👷 **Staff have been notified** in writing that they are monitored by video surveillance"),
        ("retention_set",    "🗓 **A data retention policy is in place** — recordings are not kept indefinitely"),
        ("access_limited",   "🔒 **Access to recordings is limited** to authorized management only"),
        ("no_audio",         "🔇 **Audio is NOT recorded** (or local laws permit audio surveillance)"),
        ("legal_basis",      "⚖️ **A lawful basis exists** for surveillance (legitimate business interest / employee contract clause / local law compliance)"),
    ]

    updated = dict(compliance)
    all_checked = True
    for key, label in items:
        val = st.checkbox(label, value=bool(compliance.get(key, False)), key=f"comp_{key}")
        updated[key] = val
        if not val:
            all_checked = False

    st.divider()
    if st.button("💾 Save Compliance Status", type="primary"):
        save_preferences({"compliance": updated})
        st.success("Compliance status saved.")

    st.divider()
    if all_checked:
        st.success("✅ All compliance items confirmed.")
    else:
        unchecked = sum(1 for k, _ in items if not updated.get(k, False))
        st.warning(f"⚠️ {unchecked} item(s) not yet confirmed. A reminder banner will appear on the Dashboard.")

    st.divider()
    st.subheader("Useful References")
    st.markdown("""
- 🇺🇸 **USA**: [FTC Workplace Monitoring Guidelines](https://www.ftc.gov) · Most states require posted notice for video surveillance
- 🇬🇧 **UK**: [ICO CCTV Code of Practice](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/cctv-and-surveillance/) · GDPR applies to stored footage
- 🇪🇺 **EU**: GDPR Article 6 lawful basis required · DPIA may be needed
- 🇨🇦 **Canada**: PIPEDA applies · Written notice required in most provinces
- **General**: Consult an employment lawyer before deploying in your jurisdiction.
""")

# ─────────────────────────────────────────────────────────────────────────────
# STORAGE MANAGEMENT  (appended below all tabs — always visible)
# ─────────────────────────────────────────────────────────────────────────────
import os as _os
import time as _time
from pathlib import Path as _Path

st.divider()
with st.expander("💾 Storage Management", expanded=False):
    _upload_dir  = _Path(UPLOAD_DIR)
    _result_dir  = _Path(RESULT_DIR)

    # ── Disk usage ────────────────────────────────────────────────────────────
    def _dir_size_mb(p: _Path) -> float:
        if not p.exists():
            return 0.0
        return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) / 1024 ** 2

    _up_mb  = _dir_size_mb(_upload_dir)
    _res_mb = _dir_size_mb(_result_dir)
    _total_mb = _up_mb + _res_mb

    _sm1, _sm2, _sm3 = st.columns(3)
    _sm1.metric("Uploads folder", f"{_up_mb:.1f} MB")
    _sm2.metric("Results folder", f"{_res_mb:.1f} MB")
    _sm3.metric("Total usage",    f"{_total_mb:.1f} MB")

    # ── Job counts by status ───────────────────────────────────────────────
    st.divider()
    _all_jobs_sm = list_jobs_filtered(500)
    _status_counts = {}
    for _j in _all_jobs_sm:
        _s = _j.get("status", "unknown")
        _status_counts[_s] = _status_counts.get(_s, 0) + 1

    _jc_cols = st.columns(4)
    _jc_cols[0].metric("Done",    _status_counts.get("done", 0))
    _jc_cols[1].metric("Failed",  _status_counts.get("failed", 0))
    _jc_cols[2].metric("Running", _status_counts.get("running", 0))
    _jc_cols[3].metric("Pending", _status_counts.get("pending", 0))

    # ── Oldest / newest job ──────────────────────────────────────────────
    _now_ts = _time.time()
    _ts_list = [_j["created_at"] for _j in _all_jobs_sm if _j.get("created_at")]
    if _ts_list:
        _oldest_days = (_now_ts - min(_ts_list)) / 86400
        _newest_days = (_now_ts - max(_ts_list)) / 86400
        st.caption(
            f"Oldest job: **{_oldest_days:.0f} days ago**  "
            f"&nbsp;·&nbsp;  Newest job: **{_newest_days:.0f} days ago**"
        )

    # ── Auto-purge snapshots older than N days ────────────────────────────
    st.divider()
    st.markdown("**Auto-purge snapshots older than N days**")
    st.caption("Deletes snapshot subdirectories from result folders older than the threshold. "
               "Keeps summary.json, events.csv, and annotated videos.")
    _purge_days = st.number_input("Purge snapshots older than (days)", 1, 3650, 90,
                                   key="sm_purge_days")
    _purge_confirm = st.checkbox("I understand this is permanent (snapshot purge)",
                                  key="sm_purge_confirm")
    if st.button("🗑 Purge Old Snapshots", key="sm_purge_btn",
                 disabled=not _purge_confirm):
        _cutoff = _now_ts - _purge_days * 86400
        _purged = 0
        if _result_dir.exists():
            for _job_dir in _result_dir.iterdir():
                if not _job_dir.is_dir():
                    continue
                _snap_dir = _job_dir / "snapshots"
                if _snap_dir.exists():
                    _mtime = _snap_dir.stat().st_mtime
                    if _mtime < _cutoff:
                        try:
                            shutil.rmtree(str(_snap_dir))
                            _purged += 1
                        except Exception:
                            pass
        st.success(f"Purged {_purged} snapshot director{'ies' if _purged != 1 else 'y'}.")

    # ── Delete all failed jobs ─────────────────────────────────────────────
    st.divider()
    st.markdown("**Delete all failed jobs**")
    st.caption("Removes the job record and result directory for every job with status 'failed'.")
    _failed_jobs_sm = [_j for _j in _all_jobs_sm if _j.get("status") == "failed"]
    if not _failed_jobs_sm:
        st.caption("No failed jobs to delete.")
    else:
        st.caption(f"{len(_failed_jobs_sm)} failed job(s) will be deleted.")
        _del_failed_confirm = st.checkbox("I understand this is permanent (delete failed jobs)",
                                           key="sm_del_failed_confirm")
        if st.button(f"🗑 Delete {len(_failed_jobs_sm)} Failed Job(s)", key="sm_del_failed_btn",
                     disabled=not _del_failed_confirm):
            from core.database import delete_job as _delete_job
            _deleted = 0
            for _fj in _failed_jobs_sm:
                try:
                    if _delete_job(_fj["job_id"]):
                        _deleted += 1
                except Exception:
                    pass
            st.success(f"Deleted {_deleted} failed job(s).")
            st.rerun()

    # ── Delete all annotated videos ────────────────────────────────────────
    st.divider()
    st.markdown("**Delete all annotated videos**")
    st.caption("Removes `annotated.mp4` from every result directory to free space. "
               "Keeps summary.json, snapshots, events.csv, and clips.")
    _ann_paths = []
    if _result_dir.exists():
        _ann_paths = [p for p in _result_dir.rglob("annotated.mp4") if p.is_file()]
    _ann_total_mb = sum(p.stat().st_size for p in _ann_paths) / 1024 ** 2

    if not _ann_paths:
        st.caption("No annotated videos found.")
    else:
        st.caption(f"{len(_ann_paths)} annotated video(s) found — "
                   f"{_ann_total_mb:.1f} MB total.")
        _del_ann_confirm = st.checkbox("I understand this is permanent (delete annotated videos)",
                                        key="sm_del_ann_confirm")
        if st.button(f"🗑 Delete {len(_ann_paths)} Annotated Video(s)", key="sm_del_ann_btn",
                     disabled=not _del_ann_confirm):
            _del_ann_count = 0
            for _ap in _ann_paths:
                try:
                    _ap.unlink()
                    _del_ann_count += 1
                except Exception:
                    pass
            st.success(f"Deleted {_del_ann_count} annotated video(s), "
                       f"freeing ~{_ann_total_mb:.1f} MB.")
            st.rerun()
