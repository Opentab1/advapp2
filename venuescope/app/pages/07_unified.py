"""
VenueScope — Unified Multi-Camera / Multi-Mode Report
Select any combination of completed jobs and generate one combined PDF report.
"""
import json
from pathlib import Path
import streamlit as st
import pandas as pd

from core.database import list_jobs, get_job
from core.config   import RESULT_DIR, ANALYSIS_MODES
from core.confidence import compute_confidence_score
from core.auth import require_auth as _page_auth
_page_auth()

st.markdown("## 📋 Unified Shift Report")
st.caption(
    "Combine results from multiple cameras or modes into one report. "
    "Select up to 4 completed jobs below — e.g. bar cam + door cam + floor cam."
)

jobs = [j for j in list_jobs(100) if j["status"] == "done"]
if not jobs:
    st.info("No completed jobs yet. Run some analyses first.")
    st.stop()

# ── Job selector ──────────────────────────────────────────────────────────────
st.subheader("① Select Jobs to Include")

job_options = {
    f"{ANALYSIS_MODES.get(j.get('analysis_mode',''), j.get('analysis_mode',''))} — "
    f"{j.get('clip_label') or j['job_id']} [{j['job_id']}]": j["job_id"]
    for j in jobs
}

selected_labels = st.multiselect(
    "Jobs to combine (select 1–4)",
    list(job_options.keys()),
    max_selections=4,
    help="Pick one job per camera / mode for best results"
)

selected_ids = [job_options[l] for l in selected_labels]

if not selected_ids:
    st.info("Select at least one job above.")
    st.stop()

# ── Preview selected jobs ─────────────────────────────────────────────────────
st.divider()
st.subheader("② Summary Preview")

job_summaries = []
for jid in selected_ids:
    job = get_job(jid)
    rdir = Path(job.get("result_dir") or Path(RESULT_DIR) / jid)
    sumf = rdir / "summary.json"
    if not sumf.exists():
        st.warning(f"Summary missing for job {jid}")
        continue
    summary = json.loads(sumf.read_text())
    score, color, label = compute_confidence_score(summary)
    job_summaries.append({
        "job_id":     jid,
        "mode":       job.get("analysis_mode",""),
        "clip_label": job.get("clip_label",""),
        "summary":    summary,
        "conf_score": score,
        "conf_color": color,
        "conf_label": label,
    })

# Preview table
badge_map = {"green": "🟢", "yellow": "🟡", "red": "🔴"}
preview_rows = []
for js in job_summaries:
    s = js["summary"]
    mode = js["mode"]
    key_metric = "—"
    if mode == "drink_count":
        total = sum(b.get("total_drinks",0) for b in s.get("bartenders",{}).values())
        key_metric = f"{total} drinks"
    elif mode == "bottle_count":
        key_metric = f"{s.get('bottles',{}).get('total_bottles_seen',0)} bottles"
    elif mode == "people_count":
        key_metric = f"{s.get('people',{}).get('total_entries',0)} entries"
    elif mode == "table_turns":
        total_turns = sum(t.get("turn_count",0) for t in s.get("tables",{}).values())
        key_metric = f"{total_turns} turns"
    elif mode == "staff_activity":
        key_metric = f"{s.get('staff',{}).get('total_unique_staff',0)} staff"
    elif mode == "after_hours":
        n = s.get("motion",{}).get("total_motion_events",0)
        key_metric = f"{'🚨 ' if n>0 else ''}{n} events"

    preview_rows.append({
        "Mode":       ANALYSIS_MODES.get(mode, mode),
        "Clip":       js["clip_label"] or js["job_id"],
        "Key Metric": key_metric,
        "Confidence": f"{badge_map.get(js['conf_color'],'⚪')} {js['conf_score']}%",
        "Duration":   f"{s.get('video_seconds',0):.0f}s",
    })

st.dataframe(pd.DataFrame(preview_rows), use_container_width=True, hide_index=True)

# ── Report config ─────────────────────────────────────────────────────────────
st.divider()
st.subheader("③ Report Settings")

rc1, rc2 = st.columns(2)
with rc1:
    venue_name = st.text_input("Venue name",
                                st.session_state.get("venue_name", "My Venue"),
                                key="unified_venue")
    st.session_state["venue_name"] = venue_name
with rc2:
    include_pos = st.checkbox("Include POS theft comparison", value=False)

pos_data_all: dict = {}
if include_pos and any(js["mode"] == "drink_count" for js in job_summaries):
    st.markdown("**POS rings per bartender (for theft analysis):**")
    for js in job_summaries:
        if js["mode"] != "drink_count": continue
        bartenders = js["summary"].get("bartenders", {})
        cols = st.columns(min(len(bartenders), 4))
        for i, name in enumerate(bartenders):
            with cols[i % len(cols)]:
                pos_data_all[name] = st.number_input(
                    f"{name} POS rings", 0, value=0, key=f"unified_pos_{js['job_id']}_{name}")

# ── Generate ──────────────────────────────────────────────────────────────────
st.divider()

try:
    from core.report import generate_combined_report, REPORTLAB_OK
    has_combined = True
except ImportError:
    has_combined = False
    REPORTLAB_OK = False

if REPORTLAB_OK and has_combined:
    if st.button("⬇️ Generate Combined PDF Report", type="primary", use_container_width=True):
        with st.spinner("Building report…"):
            try:
                pdf_bytes = generate_combined_report(
                    job_summaries=job_summaries,
                    venue_name=venue_name,
                    pos_data=pos_data_all or None,
                )
                fname = f"venuescope_combined_{'-'.join(selected_ids[:2])}.pdf"
                st.download_button("⬇️ Save Combined PDF", pdf_bytes,
                                   fname, "application/pdf", type="primary")
                st.success(f"Report ready — {len(pdf_bytes)//1024} KB")
            except Exception as e:
                st.error(f"Report error: {e}")
                import traceback; st.code(traceback.format_exc())
elif not REPORTLAB_OK:
    st.warning("Install reportlab: `pip install reportlab`")
else:
    st.info("Combined report function not yet available — PDF agent still building.")
    # Fallback: individual PDFs per job
    from core.report import generate_shift_report, REPORTLAB_OK as RL_OK
    if RL_OK:
        st.caption("Fallback: generate individual PDFs per job:")
        for js in job_summaries:
            if st.button(f"PDF for {js['clip_label'] or js['job_id']}", key=f"pdf_{js['job_id']}"):
                try:
                    pdf_bytes = generate_shift_report(
                        summary=js["summary"], job_id=js["job_id"],
                        clip_label=js["clip_label"], mode=js["mode"],
                        pos_data=pos_data_all or None, venue_name=venue_name)
                    st.download_button("⬇️ Save", pdf_bytes,
                                       f"vs_{js['job_id']}.pdf", "application/pdf")
                except Exception as e:
                    st.error(f"PDF error: {e}")
