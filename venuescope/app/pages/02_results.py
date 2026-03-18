"""
VenueScope Production — Results v6
Big-number hero, confidence badge, POS theft detection, PDF report,
POS profile persistence, Excel/CSV export, zero-drink help, annual loss persistence.
"""
import json
from pathlib import Path
import streamlit as st
import pandas as pd
import io

from core.database  import list_jobs, get_job, get_preferences, save_preferences
from core.config    import RESULT_DIR, ANALYSIS_MODES, CONFIG_DIR
from core.report    import generate_shift_report, REPORTLAB_OK
from core.confidence import compute_confidence_score
from core.auth import require_auth as _page_auth
_page_auth()

try:
    import openpyxl
    _OPENPYXL_OK = True
except ImportError:
    _OPENPYXL_OK = False

# ── POS profile helpers ───────────────────────────────────────────────────────
_POS_PROFILES_FILE = CONFIG_DIR / "pos_profiles.json"

def _load_pos_profiles() -> dict:
    if _POS_PROFILES_FILE.exists():
        try:
            return json.loads(_POS_PROFILES_FILE.read_text())
        except Exception:
            pass
    return {}

def _save_pos_profiles(profiles: dict) -> None:
    _POS_PROFILES_FILE.write_text(json.dumps(profiles, indent=2))

# ── Excel / CSV export helper ─────────────────────────────────────────────────
def _build_export(summary: dict, job: dict, sel_id: str,
                  pos_data: dict, mode: str) -> tuple:
    """
    Returns (bytes, filename, mime_type).
    Uses openpyxl for Excel if available, otherwise CSV.
    """
    bartenders = summary.get("bartenders", {})
    dur_secs   = summary.get("video_seconds", 0)

    # Gather sheets as DataFrames
    summary_rows = [
        {"Field": "Job ID",          "Value": sel_id},
        {"Field": "Clip Label",      "Value": job.get("clip_label","")},
        {"Field": "Analysis Mode",   "Value": ANALYSIS_MODES.get(mode, mode)},
        {"Field": "Video Duration (s)", "Value": dur_secs},
        {"Field": "Total Drinks (CV)", "Value": sum(d.get("total_drinks",0) for d in bartenders.values())},
        {"Field": "Confidence Score","Value": compute_confidence_score(summary)[0]},
        {"Field": "Model Profile",   "Value": job.get("model_profile","")},
    ]
    df_summary = pd.DataFrame(summary_rows)

    comp_rows = []
    for name, d in bartenders.items():
        cv  = d.get("total_drinks", 0)
        pos = pos_data.get(name, 0) if pos_data else 0
        delta = cv - pos
        pct   = f"{delta/max(pos,1)*100:.1f}%" if pos > 0 else "N/A"
        comp_rows.append({"Bartender": name, "CV Count": cv,
                           "POS Rings": pos, "Delta": delta,
                           "Variance %": pct,
                           "Drinks/hr": round(d.get("drinks_per_hour",0),1)})
    df_bartenders = pd.DataFrame(comp_rows) if comp_rows else pd.DataFrame()

    ts_rows = []
    for bname, bdata in bartenders.items():
        for ts in bdata.get("drink_timestamps", []):
            mins, secs = divmod(int(ts), 60)
            ts_rows.append({"Bartender": bname, "Time (s)": ts,
                             "Timestamp": f"{mins:02d}:{secs:02d}"})
    df_timeline = pd.DataFrame(ts_rows) if ts_rows else pd.DataFrame()

    if _OPENPYXL_OK:
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            df_summary.to_excel(writer, sheet_name="Summary", index=False)
            if not df_bartenders.empty:
                df_bartenders.to_excel(writer, sheet_name="Per-Bartender", index=False)
            if not df_timeline.empty:
                df_timeline.to_excel(writer, sheet_name="Serve Timeline", index=False)
            if pos_data and not df_bartenders.empty:
                df_bartenders.to_excel(writer, sheet_name="POS Comparison", index=False)
        buf.seek(0)
        return buf.read(), f"venuescope_{sel_id}.xlsx", \
               "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        # Fallback: CSV of per-bartender sheet (most useful single sheet)
        buf = io.StringIO()
        df_summary.to_csv(buf, index=False)
        buf.write("\n")
        if not df_bartenders.empty:
            df_bartenders.to_csv(buf, index=False)
        return buf.getvalue().encode(), f"venuescope_{sel_id}.csv", "text/csv"

st.set_page_config(page_title="Results · VenueScope", layout="wide")
st.markdown("""
<style>
.stApp,[data-testid="stSidebar"]{background:#0f172a;}
h1,h2,h3,label,p{color:#f1f5f9!important;}
div[data-testid="metric-container"]{background:#1e293b;border-radius:10px;
  padding:12px;border:1px solid #334155;}
.stButton>button{background:#f97316;color:#fff;border:none;border-radius:8px;font-weight:600;}
.stDataFrame{background:#1e293b!important;}
.badge-green{background:#16a34a;color:#fff;padding:6px 18px;border-radius:20px;
  font-weight:700;font-size:1.1em;display:inline-block;}
.badge-yellow{background:#ca8a04;color:#fff;padding:6px 18px;border-radius:20px;
  font-weight:700;font-size:1.1em;display:inline-block;}
.badge-red{background:#dc2626;color:#fff;padding:6px 18px;border-radius:20px;
  font-weight:700;font-size:1.1em;display:inline-block;}
.hero-number{font-size:3.5em;font-weight:800;color:#f97316;line-height:1.1;}
.hero-label{font-size:1em;color:#94a3b8;margin-top:0;}
.theft-flag{background:#7f1d1d;border:1px solid #dc2626;border-radius:8px;
  padding:12px 16px;margin:8px 0;color:#fca5a5;font-weight:600;}
.theft-ok{background:#14532d;border:1px solid #16a34a;border-radius:8px;
  padding:12px 16px;margin:8px 0;color:#86efac;font-weight:600;}
</style>""", unsafe_allow_html=True)

st.markdown("## 📊 Shift Results")

# ── Load persisted annual-loss preferences once per session ───────────────────
if "_prefs_loaded" not in st.session_state:
    _prefs = get_preferences()
    st.session_state.setdefault("avg_price",   _prefs.get("avg_price", 10))
    st.session_state.setdefault("shifts_pw",   _prefs.get("shifts_pw", 5))
    st.session_state.setdefault("shift_hrs",   _prefs.get("shift_hrs", 8))
    st.session_state["_prefs_loaded"] = True

jobs = [j for j in list_jobs(100) if j["status"]=="done"]
if not jobs:
    st.info("No completed jobs yet. Go to **▶️ Run Analysis** to process a video.")
    st.stop()

job_opts = {
    f"{ANALYSIS_MODES.get(j.get('analysis_mode',''),j.get('analysis_mode',''))} — "
    f"{j.get('clip_label') or j['job_id']}  [{j['job_id']}]": j["job_id"]
    for j in jobs
}

# Pre-select a job if the dashboard (or any other page) set results_job_id in session state
_preselect_id  = st.session_state.pop("results_job_id", None)
_opt_keys      = list(job_opts.keys())
_default_index = 0
if _preselect_id:
    for _i, _k in enumerate(_opt_keys):
        if job_opts[_k] == _preselect_id:
            _default_index = _i
            break

sel_id  = job_opts[st.selectbox("Select shift to view", _opt_keys, index=_default_index)]

# Clear stale POS data if user switched to a different job
if st.session_state.get("_last_sel_id") != sel_id:
    st.session_state.pop("pos_data", None)
    st.session_state["_last_sel_id"] = sel_id
job     = get_job(sel_id)
mode    = job.get("analysis_mode","drink_count")
rdir    = Path(job.get("result_dir") or Path(RESULT_DIR)/sel_id)
sumf    = rdir/"summary.json"
evf     = rdir/"events.csv"
tsf     = rdir/"timeseries.csv"
snap_dir= rdir/"snapshots"
heatmap = rdir/"heatmap.png"

if not sumf.exists():
    st.error("Summary file not found."); st.stop()

summary = json.loads(sumf.read_text())
quality = summary.get("quality",{})

# ── Confidence badge + key metadata ───────────────────────────────────────────
conf_score, conf_color, conf_label = compute_confidence_score(summary)
badge_html = f'<span class="badge-{conf_color}">{conf_label}</span>'

hdr1, hdr2 = st.columns([3, 2])
with hdr1:
    clip = job.get("clip_label","") or sel_id
    dur  = summary.get("video_seconds", 0)
    st.markdown(f"**{clip}** &nbsp;·&nbsp; {ANALYSIS_MODES.get(mode,mode)} &nbsp;·&nbsp; {dur:.0f}s", unsafe_allow_html=True)
with hdr2:
    st.markdown(badge_html, unsafe_allow_html=True)
    with st.expander("How is this score calculated?"):
        st.markdown(f"""
**Detection Confidence (45% weight)**
Average YOLO detection score across all detections in the clip.
Score of 0.60+ = 100%, 0.25 = 0%. Current: `{quality.get('avg_detection_conf', 0):.0%}`

**Tracking Stability (35% weight)**
Track ID switch rate — lower is better.
0% switches = 100%, 15%+ switches = 0%. Current switch rate: `{quality.get('tracking_switch_rate', 0):.3f}`

**Viability (20% weight)**
Whether drink count is non-zero and average detection confidence exceeds 0.40.
A zero-drink result in drink_count mode reduces this component.

---
**What each color means:**
- **Green (75–100)** — High trust. Results can be used with confidence.
- **Yellow (55–74)** — Review recommended. Spot-check verification clips and snapshots.
- **Red (0–54)** — Verify manually. Poor lighting, wrong angle, or short clip may be the cause.
""")

# Show any critical warnings
dq_warns = summary.get("drink_quality",{}).get("warnings",[])
for w in dq_warns:
    st.warning(f"⚠️ {w}")
st.divider()

# ─────────────────────────────────────────────────────────────────────────────
# DRINK COUNT
# ─────────────────────────────────────────────────────────────────────────────
if mode == "drink_count":
    bartenders = summary.get("bartenders",{})
    pos_data   = {}

    # ── Hero numbers ──────────────────────────────────────────────────────────
    total_cv = sum(d.get("total_drinks",0) for d in bartenders.values())
    dur_hrs  = summary.get("video_seconds",1) / 3600
    avg_rate = total_cv / max(dur_hrs, 0.001)
    top_bt   = max(bartenders.items(), key=lambda x: x[1].get("total_drinks",0))[0] if bartenders else "—"

    dq         = summary.get("drink_quality", {})
    high_conf  = dq.get("high_conf_serves", total_cv)
    low_conf   = dq.get("low_conf_serves", 0)

    hc1, hc2, hc3, hc4 = st.columns(4)
    with hc1:
        st.markdown(f'<div class="hero-number">{total_cv}</div>'
                    f'<div class="hero-label">Total Drinks Made</div>', unsafe_allow_html=True)
    with hc2:
        st.markdown(f'<div class="hero-number">{avg_rate:.0f}</div>'
                    f'<div class="hero-label">Drinks / Hour</div>', unsafe_allow_html=True)
    with hc3:
        st.markdown(f'<div class="hero-number" style="color:#22c55e">{high_conf}</div>'
                    f'<div class="hero-label">High-Confidence</div>', unsafe_allow_html=True)
    with hc4:
        lc_color = "#ef4444" if low_conf > 0 else "#22c55e"
        st.markdown(f'<div class="hero-number" style="color:{lc_color}">{low_conf}</div>'
                    f'<div class="hero-label">Low-Confidence (review)</div>', unsafe_allow_html=True)

    if low_conf > 0:
        st.warning(f"⚠️ {low_conf} serve(s) had low crossing confidence — check verification clips below to confirm or discard.")

    # ── Zero-drink troubleshooter ──────────────────────────────────────────
    if total_cv == 0:
        bar_line_y = None
        try:
            import ast
            cfg_path = job.get("config_path")
            if cfg_path and Path(cfg_path).exists():
                _cfg = json.loads(Path(cfg_path).read_text())
                bar_line_y = _cfg.get("bar_line_y") or (_cfg.get("zones",[{}]) or [{}])[0].get("bar_line_y")
        except Exception:
            pass
        _bar_hint = f" (currently `{bar_line_y:.2f}`)" if bar_line_y is not None else ""
        st.markdown(f"""
<div style="background:#7f1d1d;border:2px solid #dc2626;border-radius:10px;
padding:18px 22px;margin:16px 0;color:#fca5a5;">
<strong style="font-size:1.2em;">⚠️ 0 drinks detected — possible causes:</strong>
<ol style="margin-top:10px;line-height:1.9;color:#fecaca;">
<li><strong>Bar line y-coordinate</strong> — should be ~0.44 for a standard overhead bar camera{_bar_hint}. Check the Layout page and drag the bar line to where bartenders cross when serving.</li>
<li><strong>Station zones</strong> — zones must cover the area where bartenders typically stand. If zones are too narrow or positioned incorrectly, bartenders won't register inside them.</li>
<li><strong>Camera angle</strong> — this system is designed for overhead fisheye cameras. If using a side-angle camera, set <code>camera_mode='side_angle'</code> in the bar config.</li>
<li><strong>Clip length</strong> — minimum 2 minutes recommended. Very short clips may not contain any serve events.</li>
<li><strong>Bartender visibility</strong> — open the Annotated Analysis Video above to confirm bartenders were detected at all. If no bounding boxes appear, the model may not be detecting people in this footage.</li>
</ol>
</div>""", unsafe_allow_html=True)

    # ── Annotated video — show prominently here ────────────────────────────
    ann_path = rdir / "annotated.mp4"
    if ann_path.exists():
        st.divider()
        st.subheader("🎥 Annotated Analysis Video")
        st.caption("Bar lines (cyan), detected bartenders, and +1 serve flashes overlaid on every frame.")
        ann_size_mb = ann_path.stat().st_size / (1024 * 1024)
        if ann_size_mb > 200:
            st.warning(
                f"Video is {ann_size_mb:.0f} MB — too large to play inline. "
                "Download it below or re-run with a shorter clip."
            )
            with open(str(ann_path), "rb") as _af:
                st.download_button("⬇️ Download Annotated Video",
                                   _af.read(), f"ann_{sel_id}.mp4", "video/mp4")
        else:
            # Detect codec from file header (more reliable than CAP_PROP_FOURCC on macOS)
            # MP4 ftyp box contains 'avc1' for H.264, 'FMP4'/'mp4v' for MPEG-4 Part 2
            try:
                with open(str(ann_path), "rb") as _hf:
                    _header = _hf.read(64)
                _browser_ok = b"avc1" in _header or b"h264" in _header or b"H264" in _header
                _codec = "H.264" if _browser_ok else "MPEG-4 Part 2 (FMP4)"
            except Exception:
                _browser_ok = True
                _codec = "unknown"

            if _browser_ok:
                with open(str(ann_path), "rb") as _vf:
                    st.video(_vf.read())
            else:
                st.info(
                    f"This video was encoded with `{_codec}` which doesn't play in browsers. "
                    "Re-run this job to get an H.264 video that plays inline, "
                    "or download and open in VLC / QuickTime."
                )
                with open(str(ann_path), "rb") as _af:
                    st.download_button("⬇️ Download Annotated Video (open in VLC)",
                                       _af.read(), f"ann_{sel_id}.mp4", "video/mp4")

    st.divider()

    if bartenders:
        st.subheader("🍺 Per-Bartender Breakdown")
        rows=[{"Bartender":n,"Total Drinks":d.get("total_drinks",0),
               "Drinks/hr":round(d.get("drinks_per_hour",0),1),
               "Peak Hour Count":d.get("peak_hour_count",0)}
              for n,d in bartenders.items()]
        df = pd.DataFrame(rows).sort_values("Total Drinks",ascending=False)
        st.dataframe(df,use_container_width=True,hide_index=True)

        if len(bartenders) > 1:
            st.bar_chart(df.set_index("Bartender")[["Total Drinks"]])

        # ── Serve Timeline ────────────────────────────────────────────────────
        # Show when each bartender made drinks across the shift
        _all_ts = []
        for bname, bdata in bartenders.items():
            for ts in bdata.get("drink_timestamps", []):
                _all_ts.append({"Bartender": bname, "Time (s)": ts})
        if _all_ts:
            st.divider()
            st.subheader("⏱ Serve Timeline")
            st.caption("Each mark = one drink. Shows how activity was distributed across the clip.")
            ts_df = pd.DataFrame(_all_ts)
            # Bin into 30-second windows for a readable activity chart
            _dur = summary.get("video_seconds", 1)
            _bin = max(30, int(_dur / 20))  # ~20 bins across the clip, min 30s each
            ts_df["Bin"] = (ts_df["Time (s)"] // _bin * _bin).astype(int)
            ts_df["Bin_label"] = ts_df["Bin"].apply(lambda s: f"{s//60}:{s%60:02d}")
            pivot = ts_df.pivot_table(index="Bin_label", columns="Bartender",
                                      values="Time (s)", aggfunc="count", fill_value=0)
            # Preserve time order
            bin_order = sorted(ts_df["Bin"].unique())
            bin_labels = [f"{b//60}:{b%60:02d}" for b in bin_order]
            pivot = pivot.reindex(bin_labels).fillna(0)
            st.bar_chart(pivot, use_container_width=True)

        st.divider()
        st.subheader("🔍 POS Comparison — Theft Detection")

        # ── POS Profile: Load ─────────────────────────────────────────────
        _all_profiles = _load_pos_profiles()
        _profile_names = list(_all_profiles.keys())
        if _profile_names:
            _pc_load1, _pc_load2 = st.columns([3, 1])
            with _pc_load1:
                _sel_profile = st.selectbox(
                    "📂 Load saved POS profile",
                    ["— New Profile —"] + _profile_names,
                    key="pos_profile_select")
            with _pc_load2:
                st.write("")
                st.write("")
                if _sel_profile != "— New Profile —":
                    if st.button("Load Profile", key="pos_load_btn"):
                        _loaded = _all_profiles[_sel_profile]
                        for _bname, _bval in _loaded.get("counts", {}).items():
                            st.session_state[f"pos_{_bname}"] = _bval
                        st.success(f"Loaded profile '{_sel_profile}'")
                        st.rerun()

        tab1, tab2 = st.tabs(["📝 Enter Manually", "📤 Import POS CSV"])

        with tab1:
            cols = st.columns(min(len(bartenders),4))
            for i,name in enumerate(bartenders):
                with cols[i%len(cols)]:
                    pos_data[name] = st.number_input(
                        f"{name} POS rings", 0, value=0, key=f"pos_{name}")

        with tab2:
            st.markdown(
                "Upload any CSV from Square, Toast, Clover, Lightspeed, or a manual export. "
                "Pick which columns contain bartender names and drink counts."
            )
            pos_file = st.file_uploader("POS export CSV", type=["csv"], key="pos_csv")
            if pos_file:
                try:
                    pdf = pd.read_csv(pos_file)
                    pdf.columns = [c.strip() for c in pdf.columns]
                    cols = list(pdf.columns)

                    # Auto-guess best columns but let user override
                    def _guess(keywords, fallback_idx):
                        cl = [c for c in cols if any(k in c.lower() for k in keywords)]
                        return cl[0] if cl else cols[fallback_idx] if len(cols) > fallback_idx else cols[0]

                    pc1, pc2 = st.columns(2)
                    with pc1:
                        name_col = st.selectbox(
                            "Bartender name column", cols,
                            index=cols.index(_guess(["bar","name","staff","server","employee"], 0)),
                            key="pos_name_col")
                    with pc2:
                        drink_col = st.selectbox(
                            "Drink count column", cols,
                            index=cols.index(_guess(["drink","count","qty","rings","trans","sale"], 1)),
                            key="pos_drink_col")

                    st.dataframe(pdf[[name_col, drink_col]], use_container_width=True, hide_index=True)

                    if st.button("✅ Apply POS Mapping", key="apply_pos"):
                        matched = 0
                        for _, row in pdf.iterrows():
                            bname = str(row[name_col]).strip().lower()
                            # Fuzzy match: find best-overlapping bartender name
                            best_bk, best_score = None, 0
                            for bk in bartenders:
                                bkl = bk.lower()
                                # Score = longest common token overlap
                                b_tokens = set(bname.split())
                                k_tokens = set(bkl.split())
                                score = len(b_tokens & k_tokens) + (
                                    0.5 if bname in bkl or bkl in bname else 0)
                                if score > best_score:
                                    best_score, best_bk = score, bk
                            if best_bk and best_score > 0:
                                try:
                                    pos_data[best_bk] = int(float(str(row[drink_col])))
                                    matched += 1
                                except (ValueError, TypeError):
                                    pass
                        st.success(f"Matched {matched} of {len(bartenders)} bartender(s). "
                                   "Unmatched bartenders default to 0 POS rings.")
                        st.session_state["pos_data"] = pos_data
                except Exception as e:
                    st.error(f"CSV parse error: {e}")

        # ── POS Profile: Save ─────────────────────────────────────────────
        _current_pos = st.session_state.get("pos_data") or pos_data
        if any(v > 0 for v in _current_pos.values()):
            _sp_col1, _sp_col2 = st.columns([3, 1])
            with _sp_col1:
                _profile_name_input = st.text_input(
                    "Profile name (e.g. 'Friday Night Crew')",
                    value=st.session_state.get("venue_name", "My Venue"),
                    key="pos_profile_name_input")
            with _sp_col2:
                st.write("")
                st.write("")
                if st.button("💾 Save POS Profile", key="pos_save_btn"):
                    _pname = _profile_name_input.strip() or "Unnamed Profile"
                    _profiles = _load_pos_profiles()
                    _profiles[_pname] = {
                        "counts": {n: _current_pos.get(n, 0) for n in bartenders},
                        "bartenders": list(bartenders.keys()),
                    }
                    _save_pos_profiles(_profiles)
                    st.success(f"Saved profile '{_pname}'")

        st.divider()
        tc1, tc2 = st.columns(2)
        with tc1:
            thresh_review = st.number_input(
                "🚨 REVIEW threshold (drinks over POS)", 1, 200,
                int(st.session_state.get("thresh_review", 5)),
                help="Flag for manager review if CV exceeds POS by this many drinks")
            st.session_state["thresh_review"] = thresh_review
        with tc2:
            thresh_check = st.number_input(
                "⚠️ CHECK threshold (drinks over POS)", 1, 200,
                int(st.session_state.get("thresh_check", 2)),
                help="Soft warning if CV exceeds POS by this many drinks")
            st.session_state["thresh_check"] = thresh_check
        if thresh_check >= thresh_review:
            st.warning("CHECK threshold should be lower than REVIEW threshold.")

        if st.button("📐 Run Theft Analysis", type="primary"):
            comp=[]
            for name,d in bartenders.items():
                cv=d.get("total_drinks",0); pos=pos_data.get(name,0)
                delta=cv-pos
                pct=f"{delta/max(pos,1)*100:.1f}%" if pos>0 else "N/A"
                flag=("🚨 REVIEW" if delta>thresh_review
                      else "⚠️ CHECK" if delta>thresh_check else "✅ OK")
                comp.append({"Bartender":name,"CV Count":cv,"POS Rings":pos,
                             "Delta":delta,"Variance %":pct,"Status":flag})
            cdf=pd.DataFrame(comp).sort_values("Delta",ascending=False)
            st.dataframe(cdf,use_container_width=True,hide_index=True)
            flagged=[r for r in comp if "REVIEW" in r["Status"] or "CHECK" in r["Status"]]
            st.markdown("---")
            if flagged:
                for r in flagged:
                    icon = "🚨" if "REVIEW" in r["Status"] else "⚠️"
                    st.markdown(
                        f'<div class="theft-flag">{icon} <strong>{r["Bartender"]}</strong> — '
                        f'CV detected {r["CV Count"]} drinks vs {r["POS Rings"]} POS rings '
                        f'(+{r["Delta"]}, {r["Variance %"]} over). Review snapshots below.</div>',
                        unsafe_allow_html=True)
            else:
                st.markdown(
                    '<div class="theft-ok">✅ All bartenders within tolerance — no flags raised.</div>',
                    unsafe_allow_html=True)
            st.session_state["pos_data"]    = pos_data
            st.session_state["theft_comp"]  = comp

        # ── Annual Loss Calculator ─────────────────────────────────────────
        comp = st.session_state.get("theft_comp", [])
        total_unrung = sum(max(r["Delta"], 0) for r in comp)
        if total_unrung > 0:
            st.divider()
            st.subheader("💸 Annual Loss Estimate")
            lc1, lc2, lc3 = st.columns(3)
            with lc1:
                avg_price = st.number_input(
                    "Avg drink price ($)", min_value=1, max_value=100,
                    value=int(st.session_state.get("avg_price", 10)),
                    help="Average sale price per drink at your venue")
                if avg_price != st.session_state.get("avg_price"):
                    st.session_state["avg_price"] = avg_price
                    save_preferences({"avg_price": avg_price})
            with lc2:
                shifts_per_week = st.number_input(
                    "Shifts per week", min_value=1, max_value=21,
                    value=int(st.session_state.get("shifts_pw", 5)),
                    help="How many bartender shifts run per week at this bar")
                if shifts_per_week != st.session_state.get("shifts_pw"):
                    st.session_state["shifts_pw"] = shifts_per_week
                    save_preferences({"shifts_pw": shifts_per_week})
            with lc3:
                clip_hours = max(summary.get("video_seconds", 3600) / 3600, 0.1)
                shift_hours = st.number_input(
                    "Shift length (hours)", min_value=1, max_value=16,
                    value=int(st.session_state.get("shift_hrs", 8)),
                    help="Typical shift length — used to scale this clip's rate to a full shift")
                if shift_hours != st.session_state.get("shift_hrs"):
                    st.session_state["shift_hrs"] = shift_hours
                    save_preferences({"shift_hrs": shift_hours})

            # Scale unrung drinks from clip duration → full shift → annual
            unrung_per_shift = total_unrung * (shift_hours / clip_hours)
            annual_loss      = unrung_per_shift * avg_price * shifts_per_week * 52

            al1, al2, al3 = st.columns(3)
            with al1:
                st.markdown(
                    f'<div class="hero-number" style="color:#ef4444">'
                    f'${annual_loss:,.0f}</div>'
                    f'<div class="hero-label">Estimated Annual Exposure</div>',
                    unsafe_allow_html=True)
            with al2:
                st.markdown(
                    f'<div class="hero-number" style="color:#f97316">'
                    f'{unrung_per_shift:.1f}</div>'
                    f'<div class="hero-label">Unrung Drinks / Shift</div>',
                    unsafe_allow_html=True)
            with al3:
                monthly = annual_loss / 12
                st.markdown(
                    f'<div class="hero-number" style="color:#f97316">'
                    f'${monthly:,.0f}</div>'
                    f'<div class="hero-label">Estimated Monthly Loss</div>',
                    unsafe_allow_html=True)
            st.caption(
                f"Based on {total_unrung} unrung drink(s) detected in "
                f"{clip_hours:.1f}h clip · scaled to {shift_hours}h shift · "
                f"{shifts_per_week} shifts/week · ${avg_price} avg price"
            )

        # Hourly
        hourly=[]
        for n,d in bartenders.items():
            for k,v in (d.get("hourly_counts") or {}).items():
                hourly.append({"Bartender":n,"Hour":k,"Drinks":v})
        if hourly:
            st.subheader("⏱ Hourly Breakdown")
            hdf=pd.DataFrame(hourly)
            pivot=hdf.pivot_table(index="Hour",columns="Bartender",values="Drinks",fill_value=0)
            st.bar_chart(pivot)

    with st.expander("🔬 Detection Quality Details"):
        dq=summary.get("drink_quality",{})
        if dq:
            dc=st.columns(5)
            dc[0].metric("Serves Detected",   dq.get("total_serves_detected",0))
            dc[1].metric("High-Confidence",   dq.get("high_conf_serves", dq.get("total_serves_detected",0)))
            dc[2].metric("Low-Confidence",    dq.get("low_conf_serves",0))
            dc[3].metric("Unassigned Serves", dq.get("unassigned_serves",0))
            dc[4].metric("Frames Processed",  dq.get("frames_processed",0))
        qc = st.columns(4)
        qc[0].metric("Avg Detection Conf", f"{quality.get('avg_detection_conf',0):.0%}")
        qc[1].metric("Frames Processed",   quality.get("processed_frames",0))
        qc[2].metric("ID Switch Rate",      f"{quality.get('tracking_switch_rate',0):.3f}")
        qc[3].metric("Snapshots Saved",     summary.get("snap_count",0))

    # ── Flagged Event Review Queue ─────────────────────────────────────────
    _rev_df = pd.DataFrame()
    if evf.exists():
        try:
            _evs_df = pd.read_csv(evf)
            if "review" in _evs_df.columns:
                _rev_df = _evs_df[_evs_df["review"] == True].reset_index(drop=True)
        except Exception:
            pass

    if not _rev_df.empty:
        st.divider()
        _rev_file   = rdir / "review_decisions.json"
        _decisions  = json.loads(_rev_file.read_text()) if _rev_file.exists() else {}
        _n_total    = len(_rev_df)
        _n_approved = sum(1 for i in range(_n_total) if _decisions.get(str(i)) == "approved")
        _n_rejected = sum(1 for i in range(_n_total) if _decisions.get(str(i)) == "rejected")
        _n_pending  = _n_total - _n_approved - _n_rejected

        st.subheader(f"⚠️ {_n_total} Flagged Event{'s' if _n_total != 1 else ''} — Needs Review")
        st.caption(
            "These detections had low crossing confidence and were **not counted**. "
            "Watch each clip and approve (add to count) or reject (false positive). "
            f"**{_n_approved} approved · {_n_rejected} rejected · {_n_pending} pending**"
        )

        if _n_approved:
            _adj = total_cv + _n_approved
            st.info(f"✅ Adjusted total with your approvals: **{_adj} drinks** "
                    f"(+{_n_approved} from review)")

        for _ri, _row in _rev_df.iterrows():
            _t      = float(_row.get("t_sec", 0))
            _score  = float(_row.get("serve_score", 0))
            _bt     = str(_row.get("bartender", "")) or "unassigned"
            _dec    = _decisions.get(str(_ri))

            _border = ("#16a34a" if _dec == "approved"
                       else "#dc2626" if _dec == "rejected"
                       else "#334155")
            st.markdown(
                f'<div style="border:1px solid {_border};border-radius:8px;'
                f'padding:12px 16px;margin:8px 0;background:#1e293b;">',
                unsafe_allow_html=True)

            _col_media, _col_meta, _col_btns = st.columns([3, 2, 1])

            with _col_media:
                # Find matching clip or snapshot by timestamp
                _shown = False
                if clip_dir.exists():
                    _t_tag = f"_{_t:.1f}s"
                    _clip_matches = [c for c in sorted(clip_dir.glob("*.mp4"))
                                     if _t_tag in c.name]
                    if _clip_matches:
                        with open(str(_clip_matches[0]), "rb") as _cf:
                            st.video(_cf.read())
                        _shown = True
                if not _shown and snap_dir.exists():
                    _t_tag = f"_{_t:.1f}s"
                    _snap_matches = [s for s in sorted(snap_dir.glob("*.jpg"))
                                     if _t_tag in s.name]
                    if _snap_matches:
                        st.image(str(_snap_matches[0]))
                        _shown = True
                if not _shown:
                    st.caption("No clip/snapshot available for this event.")

            with _col_meta:
                mins, secs = divmod(int(_t), 60)
                st.markdown(f"**Time:** {mins:02d}:{secs:02d}")
                st.markdown(f"**Bartender:** {_bt}")
                st.markdown(f"**Score:** {_score:.3f}")
                _reason = str(_row.get("review_reason", ""))
                if _reason:
                    st.caption(_reason)
                if _dec:
                    _icon = "✅" if _dec == "approved" else "❌"
                    st.markdown(f"**Decision:** {_icon} {_dec.title()}")

            with _col_btns:
                st.write("")
                if st.button("✅ Approve", key=f"rv_approve_{sel_id}_{_ri}",
                             type="primary" if _dec != "approved" else "secondary",
                             use_container_width=True):
                    _decisions[str(_ri)] = "approved"
                    _rev_file.write_text(json.dumps(_decisions, indent=2))
                    st.rerun()
                if st.button("❌ Reject", key=f"rv_reject_{sel_id}_{_ri}",
                             use_container_width=True):
                    _decisions[str(_ri)] = "rejected"
                    _rev_file.write_text(json.dumps(_decisions, indent=2))
                    st.rerun()

            st.markdown("</div>", unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────────────────────────
# BOTTLE COUNT
# ─────────────────────────────────────────────────────────────────────────────
elif mode == "bottle_count":
    bottles = summary.get("bottles", {})
    total_b   = bottles.get("total_bottles_seen", 0)
    peak_b    = bottles.get("peak_count", 0)
    avg_b     = bottles.get("avg_count", 0)
    by_class  = bottles.get("by_class", {})

    hc1, hc2, hc3 = st.columns(3)
    with hc1:
        st.markdown(f'<div class="hero-number">{total_b}</div>'
                    f'<div class="hero-label">Bottles / Glasses Seen</div>', unsafe_allow_html=True)
    with hc2:
        st.markdown(f'<div class="hero-number">{peak_b}</div>'
                    f'<div class="hero-label">Peak Simultaneous</div>', unsafe_allow_html=True)
    with hc3:
        st.markdown(f'<div class="hero-number">{avg_b:.1f}</div>'
                    f'<div class="hero-label">Avg on Screen</div>', unsafe_allow_html=True)

    if by_class:
        st.divider()
        st.subheader("🍾 By Type")
        bc_cols = st.columns(len(by_class))
        for i, (cls, cnt) in enumerate(by_class.items()):
            bc_cols[i].metric(cls.replace("_"," ").title(), cnt)

    timeline = bottles.get("timeline", [])
    if timeline:
        st.divider()
        st.subheader("📈 Count Over Time")
        st.line_chart(pd.DataFrame(timeline).set_index("t_sec"))

# ─────────────────────────────────────────────────────────────────────────────
# PEOPLE COUNT
# ─────────────────────────────────────────────────────────────────────────────
elif mode == "people_count":
    p = summary.get("people", {})
    entries   = p.get("total_entries", 0)
    exits     = p.get("total_exits", 0)
    peak      = p.get("peak_occupancy", 0)
    net       = p.get("net_occupancy", 0)

    hc1, hc2, hc3, hc4 = st.columns(4)
    with hc1:
        st.markdown(f'<div class="hero-number">{entries}</div>'
                    f'<div class="hero-label">Total Entries</div>', unsafe_allow_html=True)
    with hc2:
        st.markdown(f'<div class="hero-number">{exits}</div>'
                    f'<div class="hero-label">Total Exits</div>', unsafe_allow_html=True)
    with hc3:
        st.markdown(f'<div class="hero-number">{peak}</div>'
                    f'<div class="hero-label">Peak Occupancy</div>', unsafe_allow_html=True)
    with hc4:
        st.markdown(f'<div class="hero-number">{net}</div>'
                    f'<div class="hero-label">Still Inside</div>', unsafe_allow_html=True)
    st.divider()

    per_line = p.get("per_line", {})
    if per_line:
        st.subheader("🚪 Per-Entrance Breakdown")
        ldf = pd.DataFrame([{"Entrance": ld.get("label", lid),
                              "Entries": ld.get("entries", 0),
                              "Exits":   ld.get("exits", 0),
                              "Net":     ld.get("entries",0)-ld.get("exits",0)}
                             for lid, ld in per_line.items()])
        st.dataframe(ldf, use_container_width=True, hide_index=True)
        st.bar_chart(ldf.set_index("Entrance")[["Entries","Exits"]])

    hourly = p.get("hourly_entries", {})
    hourly_exits = p.get("hourly_exits", {})
    if hourly:
        st.divider()
        st.subheader("⏱ Hourly Traffic")
        hours = sorted(set(list(hourly.keys()) + list(hourly_exits.keys())))
        hdf = pd.DataFrame([{"Hour": f"Hr {h}", "Entries": hourly.get(h,0),
                              "Exits": hourly_exits.get(h,0)} for h in hours])
        st.bar_chart(hdf.set_index("Hour"))

    occ_log = summary.get("occupancy_log", [])
    if occ_log:
        st.divider()
        st.subheader("📈 Occupancy Over Time")
        st.line_chart(pd.DataFrame(occ_log, columns=["t_sec","occupancy"]).set_index("t_sec"))

# ─────────────────────────────────────────────────────────────────────────────
# TABLE TURNS
# ─────────────────────────────────────────────────────────────────────────────
elif mode == "table_turns":
    tables = summary.get("tables", {})
    if not tables:
        st.info("No table data. Make sure table zones were defined before processing.")
    else:
        total_turns = sum(d.get("turn_count",0) for d in tables.values())
        best_table  = max(tables.items(), key=lambda x: x[1].get("turn_count",0))[1].get("label","—") if tables else "—"
        avg_dwell   = sum(d.get("avg_dwell_min",0) for d in tables.values()) / max(len(tables),1)

        hc1, hc2, hc3 = st.columns(3)
        with hc1:
            st.markdown(f'<div class="hero-number">{total_turns}</div>'
                        f'<div class="hero-label">Total Table Turns</div>', unsafe_allow_html=True)
        with hc2:
            st.markdown(f'<div class="hero-number">{avg_dwell:.0f} min</div>'
                        f'<div class="hero-label">Avg Party Dwell</div>', unsafe_allow_html=True)
        with hc3:
            st.markdown(f'<div class="hero-number">{best_table}</div>'
                        f'<div class="hero-label">Highest Turnover</div>', unsafe_allow_html=True)
        st.divider()

        st.subheader("🪑 Table Breakdown")
        rows = [{"Table": d.get("label",t),
                 "Turns": d.get("turn_count",0),
                 "Avg Dwell (min)": d.get("avg_dwell_min",0),
                 "Max Dwell (min)": d.get("max_dwell_min",0),
                 "Revenue Index": d.get("turn_count",0) * 10,
                 "Now": "🟢 Occupied" if d.get("currently_occupied") else "⚪ Empty"}
                for t,d in tables.items()]
        tdf = pd.DataFrame(rows).sort_values("Revenue Index", ascending=False)
        st.dataframe(tdf, use_container_width=True, hide_index=True)
        st.caption("Revenue Index = turns × 10 (relative profitability proxy)")
        st.bar_chart(tdf.set_index("Table")[["Turns","Avg Dwell (min)"]])

# ─────────────────────────────────────────────────────────────────────────────
# STAFF / SERVER ACTIVITY
# ─────────────────────────────────────────────────────────────────────────────
elif mode == "staff_activity":
    staff = summary.get("staff", {})
    details = staff.get("staff_details", [])
    total_s = staff.get("total_unique_staff", 0)
    peak_hc = staff.get("peak_headcount", 0)
    avg_idle= staff.get("avg_idle_pct", 0)

    hc1, hc2, hc3 = st.columns(3)
    with hc1:
        st.markdown(f'<div class="hero-number">{total_s}</div>'
                    f'<div class="hero-label">Staff Tracked</div>', unsafe_allow_html=True)
    with hc2:
        st.markdown(f'<div class="hero-number">{peak_hc}</div>'
                    f'<div class="hero-label">Peak Headcount</div>', unsafe_allow_html=True)
    with hc3:
        idle_color = "red" if avg_idle > 30 else "orange" if avg_idle > 15 else "green"
        st.markdown(f'<div class="hero-number" style="color:{"#ef4444" if avg_idle>30 else "#f97316" if avg_idle>15 else "#22c55e"}">'
                    f'{avg_idle:.0f}%</div>'
                    f'<div class="hero-label">Avg Idle Time</div>', unsafe_allow_html=True)
    st.divider()

    if details:
        st.subheader("👷 Per-Server Breakdown")
        sdf = pd.DataFrame([{
            "Track ID":      d.get("track_id",""),
            "On Screen":     f"{(d.get('last_seen_sec',0)-d.get('first_seen_sec',0))/60:.1f} min",
            "Active (min)":  round(d.get("active_seconds",0)/60, 1),
            "Idle (min)":    round(d.get("idle_seconds",0)/60, 1),
            "Idle %":        d.get("idle_pct", 0),
        } for d in details]).sort_values("Idle %", ascending=False)
        st.dataframe(sdf, use_container_width=True, hide_index=True)

        # Flag high-idle servers
        high_idle = [d for d in details if d.get("idle_pct",0) > 40]
        if high_idle:
            for d in high_idle:
                st.markdown(
                    f'<div class="theft-flag">⚠️ Track ID {d["track_id"]} was idle '
                    f'{d["idle_pct"]:.0f}% of their time on screen</div>',
                    unsafe_allow_html=True)
        else:
            st.markdown('<div class="theft-ok">✅ All staff activity within normal range</div>',
                        unsafe_allow_html=True)

    hc_log = summary.get("headcount_log", [])
    if hc_log:
        st.divider()
        st.subheader("📈 Headcount Over Time")
        st.line_chart(pd.DataFrame(hc_log, columns=["t_sec","headcount"]).set_index("t_sec"))

# ─────────────────────────────────────────────────────────────────────────────
# AFTER HOURS
# ─────────────────────────────────────────────────────────────────────────────
elif mode == "after_hours":
    motion = summary.get("motion", {})
    n = motion.get("total_motion_events", 0)
    hc1, hc2, hc3, hc4 = st.columns(4)
    with hc1:
        st.markdown(
            f'<div class="hero-number" style="color:{"#ef4444" if n>0 else "#22c55e"}">{n}</div>'
            f'<div class="hero-label">Motion Events</div>', unsafe_allow_html=True)
    hc2.metric("% of Clip",         f"{motion.get('motion_pct_of_clip',0):.1f}%")
    hc3.metric("Person Detections", motion.get("person_detections", 0))
    hc4.metric("Access Log Entries",motion.get("access_log_entries", 0))
    if n > 0:
        st.markdown('<div class="theft-flag">🚨 Motion detected outside service hours — review access log</div>',
                    unsafe_allow_html=True)
    else:
        st.markdown('<div class="theft-ok">✅ No after-hours motion detected</div>',
                    unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────────────────────────
# PDF REPORT  (prominent — before snapshots)
# ─────────────────────────────────────────────────────────────────────────────
st.divider()
st.subheader("📄 Download Shift Report")
if REPORTLAB_OK:
    pos_for_report = st.session_state.get("pos_data", {})
    rpc1, rpc2 = st.columns([2, 3])
    with rpc1:
        _vname = st.text_input("Venue name (printed on PDF)",
                                st.session_state.get("venue_name","My Venue"),
                                key="pdf_venue_name")
        st.session_state["venue_name"] = _vname
    with rpc2:
        st.caption("Generates a professional multi-page PDF with executive summary, "
                   "theft risk analysis, per-bartender breakdown, and timeline chart.")
    if st.button("⬇️ Generate & Download PDF Report", type="primary"):
        with st.spinner("Generating report…"):
            try:
                pdf_bytes=generate_shift_report(
                    summary=summary, job_id=sel_id,
                    clip_label=job.get("clip_label",""),
                    mode=mode, pos_data=pos_for_report or None,
                    venue_name=st.session_state.get("venue_name",""))
                st.download_button("⬇️ Save PDF", pdf_bytes,
                                    f"venuescope_{sel_id}.pdf","application/pdf",
                                    type="primary")
                st.success("Report ready — click Save PDF above.")
            except Exception as e:
                st.error(f"PDF error: {e}")
else:
    st.warning("Install reportlab: `pip install reportlab`")

# ─────────────────────────────────────────────────────────────────────────────
# HEAT MAP (all modes)
# ─────────────────────────────────────────────────────────────────────────────
if heatmap.exists():
    st.divider()
    st.subheader("🌡️ Activity Heat Map")
    st.caption("Red = high activity, blue = low. Shows where people spent the most time.")
    st.image(str(heatmap), use_container_width=True)

# ─────────────────────────────────────────────────────────────────────────────
# VIDEO CLIPS — one per detection event
# ─────────────────────────────────────────────────────────────────────────────
clip_dir = rdir / "clips"
if clip_dir.exists():
    clips = sorted(clip_dir.glob("*.mp4"))
    if clips:
        st.divider()
        st.subheader("🎬 Drink Verification Clips")
        st.caption("Short video clip around each detected drink — verify every pour.")
        for row_start in range(0, min(len(clips), 24), 3):
            vcols = st.columns(3)
            for col, clip in zip(vcols, clips[row_start:row_start+3]):
                with col:
                    st.caption(clip.stem.replace("_"," "))
                    with open(str(clip), "rb") as vf:
                        col.video(vf.read())

# ─────────────────────────────────────────────────────────────────────────────
# VERIFICATION SNAPSHOTS
# ─────────────────────────────────────────────────────────────────────────────
st.divider()
st.subheader("📷 Verification Snapshots")
st.caption("Frames captured at the moment of each detected event — spot-check for false positives.")
if snap_dir.exists():
    snaps=sorted(snap_dir.glob("*.jpg"))
    if snaps:
        for row_start in range(0,min(len(snaps),48),4):
            cols=st.columns(4)
            for col,snap in zip(cols,snaps[row_start:row_start+4]):
                col.image(str(snap),caption=snap.stem,use_container_width=True)
    else:
        st.info("No snapshots for this job.")

# ─────────────────────────────────────────────────────────────────────────────
# RAW DOWNLOADS
# ─────────────────────────────────────────────────────────────────────────────
st.divider()
st.subheader("⬇️ Raw Downloads")

# ── Excel / CSV export ────────────────────────────────────────────────────────
if mode == "drink_count":
    _export_label = "Export to Excel" if _OPENPYXL_OK else "Export to CSV"
    _export_note  = "" if _OPENPYXL_OK else " (install openpyxl for Excel)"
    _exp_bytes, _exp_fname, _exp_mime = _build_export(
        summary, job, sel_id,
        st.session_state.get("pos_data", {}), mode)
    st.download_button(
        f"📊 {_export_label}{_export_note}",
        _exp_bytes, _exp_fname, _exp_mime,
        help="Exports Summary, Per-Bartender, Serve Timeline, and POS Comparison sheets")
    st.divider()

dc=st.columns(4)
with dc[0]:
    if evf.exists(): st.download_button("events.csv",evf.read_bytes(),f"events_{sel_id}.csv","text/csv")
with dc[1]:
    if tsf.exists(): st.download_button("timeseries.csv",tsf.read_bytes(),f"ts_{sel_id}.csv","text/csv")
with dc[2]:
    st.download_button("summary.json",sumf.read_bytes(),f"summary_{sel_id}.json","application/json")
with dc[3]:
    _ann = rdir / "annotated.mp4"
    if _ann.exists():
        with open(_ann, "rb") as _af:
            st.download_button("annotated.mp4", _af.read(), f"ann_{sel_id}.mp4", "video/mp4")

with st.expander("Raw Event Log"):
    if evf.exists(): st.dataframe(pd.read_csv(evf),use_container_width=True,hide_index=True)
with st.expander("summary.json"):
    st.json(summary)
