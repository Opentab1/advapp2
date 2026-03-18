"""
VenueScope — Settings & Backup
- Export/import all configs (bar layouts + shifts) as JSON backup
- Multi-camera batch job submission
- Venue preferences
"""
import json, time
import streamlit as st
from pathlib import Path

from core.database import export_configs, import_configs, create_job, list_jobs_filtered
from core.config   import UPLOAD_DIR, RESULT_DIR, CONFIG_DIR, ANALYSIS_MODES, MODEL_PROFILES
from core.shift    import ShiftManager
from core.bar_config import BarConfig
import shutil

st.title("⚙️ Settings & Backup")

tab1, tab2, tab3, tab4, tab5 = st.tabs(["💾 Backup & Restore", "🎥 Batch Analysis", "🏠 Venue", "🔐 Security", "📋 Compliance"])

# ─────────────────────────────────────────────────────────────────────────────
# TAB 1: Backup / Restore
# ─────────────────────────────────────────────────────────────────────────────
with tab1:
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
# TAB 2: Batch / Multi-Camera
# ─────────────────────────────────────────────────────────────────────────────
with tab2:
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
# TAB 3: Venue preferences
# ─────────────────────────────────────────────────────────────────────────────
with tab3:
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
# TAB 4: Security
# ─────────────────────────────────────────────────────────────────────────────
with tab4:
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
# TAB 5: Compliance
# ─────────────────────────────────────────────────────────────────────────────
with tab5:
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
