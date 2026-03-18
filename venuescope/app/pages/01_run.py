"""
VenueScope Production — Run Analysis v4 (fixed)
"""
import uuid, json, sys, shutil
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import streamlit as st
import cv2, numpy as np

from core.config     import UPLOAD_DIR, RESULT_DIR, CONFIG_DIR
from core.config     import MODEL_PROFILES, ANALYSIS_MODES, ANALYSIS_DESCRIPTIONS
from core.database   import (create_job, list_shifts, get_shift, get_job,
                              _raw_update, retry_job, list_jobs_filtered)
from core.bar_config import BarConfig
from core.shift      import ShiftManager
from core.preprocessing import (draw_counting_lines, draw_bar_zones,
                                 frame_quality_score)
from core.canvas     import line_zone_editor
from workers.job_runner import get_runner

st.set_page_config(page_title="Run Analysis · VenueScope", layout="wide")
st.markdown("""<style>
[data-testid="stSidebar"]{background:#0f172a;}
.stApp{background:#0f172a;}
h1,h2,h3,label,p,.stMarkdown{color:#f1f5f9!important;}
.stTextInput input,.stSelectbox div div div,.stNumberInput input{
  background:#1e293b!important;color:#f1f5f9!important;border:1px solid #334155!important;}
.stButton>button{background:#f97316;color:#fff;border:none;border-radius:8px;font-weight:600;}
.stButton>button:hover{background:#ea6c0a;}
div[data-testid="metric-container"]{background:#1e293b;border-radius:10px;
  padding:12px;border:1px solid #334155;}
</style>""", unsafe_allow_html=True)

st.title("▶️ Run Analysis")

# ── Venue Profile save / load ───────────────────────────────────────────────
_PROFILES_FILE = CONFIG_DIR / "profiles.json"

def _load_profiles() -> dict:
    if _PROFILES_FILE.exists():
        try:
            return json.loads(_PROFILES_FILE.read_text())
        except Exception:
            pass
    return {}

def _save_profiles(profiles: dict) -> None:
    _PROFILES_FILE.write_text(json.dumps(profiles, indent=2))

with st.expander("📋 Venue Profile", expanded=False):
    _profiles = _load_profiles()
    _profile_names = list(_profiles.keys())

    vp_col1, vp_col2 = st.columns([2, 1])
    with vp_col1:
        if _profile_names:
            _sel_profile = st.selectbox("Saved profiles", ["— select —"] + _profile_names,
                                        key="vp_select")
        else:
            _sel_profile = None
            st.caption("No saved profiles yet.")

    with vp_col2:
        st.write("")  # vertical alignment spacer
        if _profile_names and _sel_profile and _sel_profile != "— select —":
            _load_col, _del_col = st.columns(2)
            with _load_col:
                if st.button("Load", key="vp_load_btn"):
                    _p = _profiles[_sel_profile]
                    st.session_state["vp_loaded"] = _p
                    st.success(f"Profile '{_sel_profile}' loaded — settings applied below.")
                    st.rerun()
            with _del_col:
                if st.button("Delete", key="vp_del_btn"):
                    del _profiles[_sel_profile]
                    _save_profiles(_profiles)
                    st.success(f"Profile '{_sel_profile}' deleted.")
                    st.rerun()

    st.divider()
    st.caption("**Save current settings as a profile:**")
    vp_s1, vp_s2, vp_s3 = st.columns([3, 2, 1])
    with vp_s1:
        _new_profile_name = st.text_input("Profile name", placeholder="e.g. Main Bar Weekend",
                                          key="vp_new_name")
    with vp_s2:
        # Preview which values will be captured (read from session or defaults)
        _vp_preview = st.session_state.get("vp_loaded", {})
        st.caption(f"Will capture: mode, model, camera angle, config, shift")
    with vp_s3:
        st.write("")
        if st.button("Save", key="vp_save_btn"):
            if not _new_profile_name.strip():
                st.warning("Enter a profile name.")
            else:
                # Gather current widget values from session state keys set by the
                # widgets below (they haven't rendered yet on first run, so we fall
                # back to any previously loaded profile values).
                _vp_cur = st.session_state.get("vp_loaded", {})
                _new_entry = {
                    "mode":          st.session_state.get("vp_mode",         _vp_cur.get("mode", "drink_count")),
                    "model_profile": st.session_state.get("vp_model_profile", _vp_cur.get("model_profile", "balanced")),
                    "camera_mode":   st.session_state.get("vp_camera_mode",   _vp_cur.get("camera_mode", "normal")),
                    "config_path":   st.session_state.get("vp_config_path",   _vp_cur.get("config_path", "")),
                    "shift_id":      st.session_state.get("vp_shift_id",      _vp_cur.get("shift_id", "")),
                }
                _profiles[_new_profile_name.strip()] = _new_entry
                _save_profiles(_profiles)
                st.success(f"Profile '{_new_profile_name.strip()}' saved.")
                st.rerun()

# Apply loaded profile defaults into session state keys for widgets
_loaded_profile: dict = st.session_state.pop("vp_loaded", {})  # consume once per rerun


def _get_frame(path: str, t_sec: float = 3.0):
    try:
        cap = cv2.VideoCapture(str(path))
        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(t_sec*fps))
        ret, frame = cap.read(); cap.release()
        if ret:
            return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    except Exception:
        pass
    return None


def _save_upload(uploaded) -> str:
    jdir = Path(UPLOAD_DIR)/"preview"; jdir.mkdir(parents=True, exist_ok=True)
    dest = str(jdir/uploaded.name)
    if not Path(dest).exists():
        Path(dest).write_bytes(uploaded.read())
    return dest


# ── STEP 1 ─────────────────────────────────────────────────────────────────
st.subheader("① Source & Mode")
col1, col2 = st.columns([3,2])
with col1:
    src_tab1, src_tab2 = st.tabs(["📁 Upload File", "📡 RTSP / IP Camera"])
    with src_tab1:
        uploaded   = st.file_uploader("Video clip (MP4/AVI/MOV)", type=["mp4","avi","mov","mpeg4"])
    with src_tab2:
        st.caption("Enter your IP camera RTSP stream URL.")
        rtsp_url   = st.text_input("RTSP URL",
                                    placeholder="rtsp://admin:password@192.168.1.100:554/stream1")
        rtsp_dur   = st.number_input("Record duration (seconds)", 30, 3600, 300, 30,
                                      help="How many seconds to capture before analysis")
        st.info("ℹ️ The stream will be captured live during analysis. "
                "Make sure the Pi can reach the camera on the network.")
    clip_label = st.text_input("Label", placeholder="e.g. Main Bar – Fri 9pm")
with col2:
    _mode_keys = list(ANALYSIS_MODES.keys())
    _mode_default = _loaded_profile.get("mode", "drink_count")
    _mode_index   = _mode_keys.index(_mode_default) if _mode_default in _mode_keys else 0
    mode = st.radio("Mode", _mode_keys,
                    index=_mode_index,
                    format_func=lambda k: ANALYSIS_MODES[k])
    st.session_state["vp_mode"] = mode
    st.caption(ANALYSIS_DESCRIPTIONS.get(mode,""))

uploaded   = locals().get("uploaded")
rtsp_url   = locals().get("rtsp_url","").strip()
saved_path = None
source_type = "file"
if uploaded:
    saved_path  = _save_upload(uploaded)
    source_type = "file"
elif rtsp_url:
    saved_path  = rtsp_url
    source_type = "rtsp"

# ── STEP 2: Frame quality ──────────────────────────────────────────────────
st.divider()
st.subheader("② Frame Quality Check")

frame_rgb = None
if saved_path:
    prev_t = st.slider("Preview at (seconds)", 0, 300, 3, key="prev_t")
    frame_rgb = _get_frame(saved_path, prev_t)
    if frame_rgb is not None:
        H_f, W_f = frame_rgb.shape[:2]
        q = frame_quality_score(cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR))
        st.session_state.update({"frame_quality":q,"preview_frame":frame_rgb,
                                  "preview_WH":(W_f,H_f)})
        qc = st.columns(4)
        qc[0].metric("Quality",    q["grade"])
        qc[1].metric("Brightness", f"{q['mean_luminance']:.0f}/255")
        qc[2].metric("Blur",       f"{q['blur_score']:.0f}")
        qc[3].metric("Distortion", f"{q['distortion_est']:.2f}")
        for w in q["warnings"]: st.warning(w)
        # Screen recording detection (fast, runs on preview frame)
        try:
            from core.tracking.engine import _detect_screen_recording
            sr_warn = _detect_screen_recording(
                cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR), W_f, H_f
            )
            if sr_warn:
                st.error(f"⚠️ {sr_warn}")
        except Exception:
            pass
        st.image(frame_rgb, caption=f"Frame @ {prev_t}s", use_container_width=True)

        # ── Test Detection button ──────────────────────────────────────────
        if st.button("🔍 Test Detection (Single Frame)", key="test_detection_btn",
                     help="Run YOLO on this frame to verify persons are detected before full analysis"):
            with st.spinner("Running detection…"):
                try:
                    from ultralytics import YOLO
                    _yolo_model = YOLO("yolov8n.pt")
                    _det_frame  = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
                    _results    = _yolo_model(_det_frame, conf=0.30, classes=[0], verbose=False)
                    _boxes      = _results[0].boxes if _results else None
                    _n_persons  = int(len(_boxes)) if _boxes is not None else 0

                    # Draw bounding boxes on a copy of the frame
                    _vis = frame_rgb.copy()
                    if _boxes is not None and _n_persons > 0:
                        for _box in _boxes:
                            _x1, _y1, _x2, _y2 = [int(v) for v in _box.xyxy[0].tolist()]
                            _conf_val = float(_box.conf[0])
                            cv2.rectangle(_vis, (_x1, _y1), (_x2, _y2), (255, 100, 30), 2)
                            cv2.putText(_vis, f"{_conf_val:.2f}", (_x1, max(_y1 - 6, 0)),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 100, 30), 2)

                    st.image(_vis, caption="Detection result", use_container_width=True)

                    if _n_persons == 0:
                        st.warning("⚠️ No people detected — check camera angle, lighting, "
                                   "and ensure YOLO models are installed.")
                    else:
                        st.success(f"✅ {_n_persons} person(s) detected in this frame "
                                   f"with confidence ≥ 0.30")
                except ImportError:
                    st.error("ultralytics not installed. Run: pip install ultralytics")
                except Exception as _det_err:
                    st.error(f"Detection failed: {_det_err}")

# ── STEP 3: Zone & line setup ──────────────────────────────────────────────
st.divider()
st.subheader("③ Set Up Zones & Lines")

frame_rgb  = st.session_state.get("preview_frame")
q          = st.session_state.get("frame_quality",{})
extra_config = {}
config_path  = None
shift_id     = None
shift_json   = None

if mode == "people_count":
    # Load saved counting lines config if available
    lines_configs = [p.stem.replace("lines_","") for p in CONFIG_DIR.glob("lines_*.json")]
    if lines_configs:
        lc1, lc2 = st.columns([2,3])
        with lc1:
            use_saved = st.checkbox("Use saved counting lines config", value=True)
        if use_saved:
            lsel = st.selectbox("Counting lines config", lines_configs)
            try:
                ldata = json.loads((CONFIG_DIR/f"lines_{lsel}.json").read_text())
                extra_config["lines"] = ldata.get("lines", [])
                st.success(f"Loaded: {ldata.get('display_name', lsel)} — {len(extra_config['lines'])} line(s)")
            except Exception as e:
                st.warning(f"Could not load config: {e}")
        else:
            st.info("📏 Draw a counting line across each entrance doorway.")
            state = line_zone_editor(frame_rgb, session_key="lz_people",
                                      mode="lines_and_zones", n_lines_default=2)
            extra_config["lines"] = state["lines"]
    else:
        st.info("📏 Draw a counting line across each entrance doorway. "
                "Or save one in ⚙️ Zone Layout first.")
        state = line_zone_editor(frame_rgb, session_key="lz_people",
                                  mode="lines_and_zones", n_lines_default=2)
        extra_config["lines"]        = state["lines"]
        extra_config["ignore_zones"] = state["zones"]

elif mode == "bottle_count":
    st.info("🍾 Optionally draw a zone to restrict bottle counting to a specific shelf or area. "
            "Leave empty to count bottles across the full frame.")
    state = line_zone_editor(frame_rgb, session_key="lz_bottle",
                              mode="zones_only", height=420)
    extra_config["zones"] = state["zones"]

elif mode == "drink_count":
    # Zone editor for staff exclusion only
    st.info("🚫 Optionally draw staff-only exclusion zones to filter customers from detection.")
    state = line_zone_editor(frame_rgb, session_key="lz_drink",
                              mode="zones_only", height=420)
    extra_config["ignore_zones"] = state["zones"]

    st.markdown("**Bar Layout Config:**")
    configs = [p.stem for p in CONFIG_DIR.glob("*.json")
               if p.stem not in ("profiles", "preferences")]
    if configs:
        _cp_default = Path(_loaded_profile.get("config_path", "")).stem
        _cp_index   = configs.index(_cp_default) if _cp_default in configs else 0
        config_sel  = st.selectbox("Layout", configs, index=_cp_index)
        config_path = str(CONFIG_DIR/f"{config_sel}.json")
        st.session_state["vp_config_path"] = config_path
        if frame_rgb is not None:
            try:
                cfg = BarConfig.load(Path(config_path).stem)
                if cfg:
                    overlay = draw_bar_zones(frame_rgb, cfg.stations,
                                             extra_config.get("ignore_zones",[]))
                    st.image(overlay, caption="Bar layout overlay", use_container_width=True)
            except Exception as e:
                st.warning(f"Could not load bar config overlay: {e}")
    else:
        st.warning("⚠️ No bar layout configs. Go to ⚙️ Bar Layout first.")

    st.markdown("**Shift:**")
    shifts = list_shifts()
    if shifts:
        sopts      = {f"{s['shift_name']} [{s['shift_id']}]":s["shift_id"] for s in shifts}
        _sopts_keys = list(sopts.keys())
        _sid_default = _loaded_profile.get("shift_id", "")
        # Find the selectbox entry whose value matches the loaded shift_id
        _sid_index  = next(
            (i for i, k in enumerate(_sopts_keys) if sopts[k] == _sid_default), 0
        )
        ssel     = st.selectbox("Shift", _sopts_keys, index=_sid_index)
        shift_id = sopts[ssel]
        st.session_state["vp_shift_id"] = shift_id
        so       = get_shift(shift_id)
        sm       = ShiftManager(shift_id, so["bartenders"])
        shift_json = json.dumps(sm.to_dict())
    else:
        st.warning("⚠️ No shifts. Set up a shift in 🔑 Shift Setup first.")

elif mode == "table_turns":
    # Load saved table zones config if available
    table_configs = [p.stem.replace("tables_","") for p in CONFIG_DIR.glob("tables_*.json")]
    if table_configs:
        use_saved_t = st.checkbox("Use saved table zones config", value=True)
        if use_saved_t:
            tsel = st.selectbox("Table zones config", table_configs)
            try:
                tdata = json.loads((CONFIG_DIR/f"tables_{tsel}.json").read_text())
                extra_config["tables"] = tdata.get("tables", [])
                st.success(f"Loaded: {tdata.get('display_name', tsel)} — {len(extra_config['tables'])} table(s)")
            except Exception as e:
                st.warning(f"Could not load table config: {e}")
        else:
            st.info("🪑 Draw a zone polygon for each table.")
            state = line_zone_editor(frame_rgb, session_key="lz_tables",
                                      mode="zones_only", height=420)
            tables = [{"table_id": f"table_{i+1}", "label": z.get("label", f"Table {i+1}"),
                       "polygon": z["polygon"]} for i, z in enumerate(state["zones"])]
            extra_config["tables"] = tables
    else:
        st.info("🪑 Draw a zone polygon for each table. Or save a layout in ⚙️ Zone Layout first.")
        state = line_zone_editor(frame_rgb, session_key="lz_tables",
                                  mode="zones_only", height=420)
        tables = [{"table_id": f"table_{i+1}", "label": z.get("label", f"Table {i+1}"),
                   "polygon": z["polygon"]} for i, z in enumerate(state["zones"])]
        extra_config["tables"] = tables

elif mode == "staff_activity":
    if frame_rgb is not None:
        st.image(frame_rgb, caption="Frame preview", use_container_width=True)
    idle_min=st.slider("Idle alert threshold (min)",1,10,2)
    extra_config["idle_threshold_seconds"]=idle_min*60

elif mode == "after_hours":
    if frame_rgb is not None:
        st.image(frame_rgb, caption="Frame preview", use_container_width=True)
    motion_thr=st.slider("Motion sensitivity",500,5000,1500)
    extra_config["motion_threshold"]=motion_thr

    st.markdown("**Ignore Zones (optional):**")
    st.caption("Draw zones to ignore (e.g., exit signs, clocks, fans that cause false motion)")
    ah_state = line_zone_editor(frame_rgb, session_key="lz_after_hours",
                                 mode="zones_only", height=420)
    extra_config["ignore_zones"] = ah_state["zones"]

# ── STEP 4: Processing ─────────────────────────────────────────────────────
st.divider()
st.subheader("④ Processing Speed")

dist_est = q.get("distortion_est",0.0)
is_dark  = q.get("mean_luminance",128) < 70

pc1,pc2=st.columns(2)
with pc1:
    _mp_default = _loaded_profile.get("model_profile", "balanced")
    if _mp_default not in ("fast", "balanced", "accurate"):
        _mp_default = "balanced"
    model_profile=st.select_slider("Speed vs accuracy",
        options=["fast","balanced","accurate"],value=_mp_default,
        help="Fast=stride 3, Balanced=stride 2, Accurate=every frame (~3× slower)")
    st.session_state["vp_model_profile"] = model_profile
with pc2:
    if mode == "drink_count":
        annotate = True
        st.info("📹 Annotated video always saved for drink count — verify every detected pour.")
    else:
        annotate=st.checkbox("Save annotated video",
            help="Saves a debug video with bounding boxes — doubles processing time")

# Advanced settings collapsed by default
camera_mode = "normal"
min_age = 8
with st.expander("⚙️ Advanced Settings"):
    st.caption("These settings are auto-detected from your video and rarely need changing.")
    ac1, ac2, ac3 = st.columns(3)
    with ac1:
        camera_quality = st.selectbox(
            "Camera quality",
            ["good", "fair", "poor"],
            format_func=lambda x: {
                "good": "✅ Good — clear, well-lit camera",
                "fair": "🟡 Fair — some blur or low light",
                "poor": "🔴 Poor — dark, blurry, or old camera",
            }[x],
            index=1 if q.get("grade","").startswith("🟡") else (2 if q.get("grade","").startswith("🔴") else 0),
            help="Sets enhancement level and detection sensitivity automatically"
        )
    with ac2:
        _cm_default = _loaded_profile.get("camera_mode", "normal")
        _cm_opts    = ["normal", "side_angle"]
        _cm_index   = _cm_opts.index(_cm_default) if _cm_default in _cm_opts else 0
        camera_mode = st.selectbox(
            "Camera angle",
            _cm_opts,
            index=_cm_index,
            format_func=lambda x: "Normal/overhead" if x == "normal" else "Side/wall-mounted",
            help="Side angle adjusts centroid to head/shoulders for better line crossing"
        )
        st.session_state["vp_camera_mode"] = camera_mode
    with ac3:
        dewarp = st.checkbox(
            "Fisheye correction",
            value=(dist_est > 0.35),
            help="Corrects barrel/fisheye distortion (wide-angle/dome cameras)"
        )
        dewarp_str = st.slider("Strength", 0.1, 1.0,
            float(min(0.4 + dist_est * 0.3, 0.9)), 0.05) if dewarp else 0.4
        min_age = st.slider("Min track age (frames)", 3, 20, 8,
            help="Detections must persist this many frames before counting")

    # Map camera quality → enhancement settings
    _quality_map = {
        "good": {"enhance_strength": "off",    "model_override": None},
        "fair": {"enhance_strength": "light",  "model_override": None},
        "poor": {"enhance_strength": "strong", "model_override": "low_quality"},
    }
    _qsettings = _quality_map[camera_quality]
    if camera_quality == "poor":
        st.info("🔧 Poor camera mode: frame enhancement + high-sensitivity detection enabled. Processing will be slower.")

extra_config.update({
    "camera_mode":       camera_mode,
    "enhance_strength":  _qsettings["enhance_strength"],
    "dewarp":            dewarp,
    "dewarp_strength":   dewarp_str,
    "min_track_age_frames": min_age,
})
# For poor cameras, pass the low_quality profile via extra_config (not as the DB model_profile)
# so the standard slider value stays valid and the daemon doesn't need a restart to pick it up
if _qsettings["model_override"] and mode != "after_hours":
    extra_config["model_override"] = _qsettings["model_override"]

# ── STEP 5: Launch ────────────────────────────────────────────────────────
st.divider()
st.subheader("⑤ Launch")

# Advisory: warn if drink count mode is selected but no shifts exist
shifts_configured = len(list_shifts()) > 0
if mode in ("drink_count", "full") and not shifts_configured:
    st.warning("⚠️ No shifts configured. Add a shift in **Shift Setup** before running "
               "drink count analysis, or switch to People Count only mode.")

if not uploaded and not rtsp_url:
    st.info("Upload a video clip or enter an RTSP URL in Step 1.")
elif mode=="drink_count" and not config_path:
    st.warning("Select a bar layout config before launching.")
elif mode=="drink_count" and not shift_json:
    st.warning("Select a shift before launching.")
elif st.button("🚀 Start Analysis", type="primary", use_container_width=True):
    job_id = str(uuid.uuid4())[:8]
    jdir   = Path(UPLOAD_DIR)/job_id; jdir.mkdir(parents=True, exist_ok=True)

    if source_type == "rtsp":
        dest = Path(rtsp_url)  # RTSP: URL passed directly, no file copy
    else:
        dest = jdir/(uploaded.name if uploaded else "clip.mp4")
        if saved_path and Path(saved_path).exists():
            shutil.copy(saved_path, dest)
        elif uploaded:
            dest.write_bytes(uploaded.read())

    create_job(job_id=job_id, analysis_mode=mode,
               shift_id=shift_id, shift_json=shift_json,
               source_type=source_type, source_path=str(dest) if source_type=="file" else rtsp_url,
               model_profile=model_profile, config_path=config_path,
               annotate=annotate,
               clip_label=clip_label or (uploaded.name if uploaded else rtsp_url or "clip"))

    _raw_update(job_id, summary_json=json.dumps({"extra_config":extra_config}))

    # Submit immediately — auto zone re-ID handles bartender assignment
    get_runner().submit(job_id)
    st.session_state["active_job"] = job_id
    st.success(f"✅ Job `{job_id}` submitted!")
    st.rerun()

# ── Live progress ──────────────────────────────────────────────────────────
active_job = st.session_state.get("active_job")
if active_job:
    st.divider()
    job=get_job(active_job)
    if job:
        pct=float(job.get("progress",0)); status=job.get("status","pending")
        if status=="done":
            st.success(f"✅ Job `{active_job}` complete — go to 📊 Results")
            if st.button("Clear"): st.session_state.pop("active_job",None); st.rerun()
        elif status=="failed":
            st.error(f"Job failed: {job.get('error_msg','unknown error')}")
            if st.button("Clear"): st.session_state.pop("active_job",None); st.rerun()
        elif status=="pending":
            st.info(f"⏳ Job `{active_job}` is queued — worker will start it automatically")
            st.progress(0.0, text="Waiting in queue…")
            st.caption("Another job is processing. This will start when the current job finishes.")
            st.button("↻ Refresh", on_click=st.rerun)
            import time as _t; _t.sleep(5); st.rerun()
        else:
            st.subheader(f"⏳ Processing: `{active_job}`")
            st.progress(int(min(pct,100))/100, text=f"Running…  {pct:.0f}%")
            st.caption("Page auto-refreshes every 5 seconds")
            st.button("↻ Refresh now", on_click=st.rerun)
            import time as _t; _t.sleep(5); st.rerun()

# ── Retry failed jobs ──────────────────────────────────────────────────────
st.divider()
st.subheader("🔁 Retry Failed Jobs")
failed = [j for j in list_jobs_filtered(50) if j["status"] == "failed"]
if not failed:
    st.caption("No failed jobs.")
else:
    for fj in failed[:5]:
        fc1, fc2, fc3 = st.columns([3,3,1])
        fc1.markdown(f"`{fj['job_id']}` — {fj.get('clip_label','')}")
        fc2.caption(f"❌ {(fj.get('error_msg') or 'unknown error')[:80]}")
        with fc3:
            if st.button("Retry", key=f"retry_{fj['job_id']}"):
                if retry_job(fj["job_id"]):
                    get_runner().submit(fj["job_id"])
                    st.session_state["active_job"] = fj["job_id"]
                    st.success(f"Resubmitted `{fj['job_id']}`")
                    st.rerun()
