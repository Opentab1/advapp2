"""
VenueScope — Camera Setup Wizard
The easiest way to configure any camera:
  1. Pick a registered camera (or enter RTSP URL)
  2. Click "Grab Live Frame" — snapshots the camera right now
  3. Draw your lines and zones on ONE canvas with a mode switcher
  4. Save — config is attached to that camera automatically

Supports: bar line + station zone, counting lines, table zones, ignore zones.
"""
from __future__ import annotations
import json, time, uuid
from pathlib import Path
import cv2
import numpy as np
import streamlit as st
from PIL import Image

from core.config    import CONFIG_DIR, UPLOAD_DIR
from core.bar_config import BarConfig, BarStation
from core.database  import list_cameras, save_camera, get_camera
from core.canvas    import _render_preview, _frame_to_b64, CANVAS_W
from core.auth import require_auth as _page_auth
_page_auth()

try:
    from streamlit_drawable_canvas import st_canvas
    _HAS_CANVAS = True
except ImportError:
    _HAS_CANVAS = False

st.set_page_config(page_title="Camera Setup · VenueScope", layout="wide")
st.markdown("""
<style>
.stApp,[data-testid="stSidebar"]{background:#0f172a;}
h1,h2,h3,label,p,.stMarkdown{color:#f1f5f9!important;}
.stButton>button{background:#f97316;color:#fff;border:none;border-radius:8px;font-weight:600;}
.step-badge{background:#1e293b;border:1px solid #334155;border-radius:8px;
  padding:8px 14px;margin:4px 0;color:#f1f5f9;}
.step-num{color:#f97316;font-weight:800;margin-right:8px;}
.shape-line{color:#f97316;font-weight:700;}
.shape-zone{color:#ef4444;font-weight:700;}
.shape-count{color:#22c55e;font-weight:700;}
.shape-table{color:#3b82f6;font-weight:700;}
</style>""", unsafe_allow_html=True)

st.markdown("## 📷 Camera Setup Wizard")
st.caption("Draw zones and lines directly on a live camera frame. "
           "One canvas — all shapes together.")


# ── STEP 1: Pick camera & grab frame ─────────────────────────────────────────

with st.container():
    st.markdown('<div class="step-badge"><span class="step-num">1</span>'
                'Choose your camera and grab a frame</div>', unsafe_allow_html=True)

    cameras = list_cameras()
    src_options = (["— Enter RTSP URL manually —"] +
                   [f"{c['name']}  ({c['rtsp_url'][:50]}…)" for c in cameras])

    col_src, col_btn = st.columns([4, 1])
    with col_src:
        src_sel = st.selectbox("Camera source", src_options, key="wiz_cam_sel",
                               label_visibility="collapsed")

    rtsp_url = ""
    selected_cam = None
    if src_sel == "— Enter RTSP URL manually —":
        rtsp_url = st.text_input("RTSP URL",
            placeholder="rtsp://admin:password@192.168.1.100:554/stream1",
            key="wiz_rtsp_url")
    else:
        idx = src_options.index(src_sel) - 1
        selected_cam = cameras[idx]
        rtsp_url = selected_cam["rtsp_url"]
        st.caption(f"Mode(s): **{selected_cam['mode']}** · "
                   f"{selected_cam.get('segment_seconds',60):.0f}s segments")

    with col_btn:
        st.write("")  # vertical align
        grab_clicked = st.button("📸 Grab Live Frame", type="primary",
                                 key="wiz_grab", use_container_width=True)

    # Also allow loading from uploaded video
    st.caption("No RTSP access right now? Load a frame from an uploaded video instead.")
    alt_col1, alt_col2, alt_col3 = st.columns([3, 1, 1])
    with alt_col1:
        all_vids = (list(UPLOAD_DIR.rglob("*.mp4")) + list(UPLOAD_DIR.rglob("*.MP4")) +
                    list(UPLOAD_DIR.rglob("*.mov")) + list(UPLOAD_DIR.rglob("*.avi")))
        if all_vids:
            vid_sel = st.selectbox("Or pick uploaded video",
                ["(none)"] + [str(v) for v in all_vids], key="wiz_vid_sel",
                label_visibility="collapsed")
        else:
            vid_sel = "(none)"
    with alt_col2:
        seek_t = st.number_input("At second", 0, 300, 5, key="wiz_seek_t",
                                 label_visibility="collapsed")
    with alt_col3:
        vid_grab = st.button("Load from video", key="wiz_vid_grab",
                             use_container_width=True)

# Grab from RTSP
if grab_clicked and rtsp_url:
    with st.spinner(f"Connecting to camera…"):
        try:
            cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 8000)
            ok = cap.isOpened()
            if ok:
                for _ in range(5):   # skip a few frames — RTSP often sends stale I-frame first
                    cap.read()
                ret, frame = cap.read()
                cap.release()
                if ret and frame is not None:
                    st.session_state["wiz_frame"] = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    st.session_state["wiz_shapes"] = []
                    st.session_state.pop("wiz_canvas_key", None)
                    st.success(f"✅ Frame captured  {frame.shape[1]}×{frame.shape[0]}")
                else:
                    st.error("Connected but couldn't read a frame. Check stream path.")
            else:
                st.error("Could not connect — check IP address, port, and credentials.")
                st.info("Tip: Try the **Test Connection** in the Live tab first.")
            cap.release()
        except Exception as e:
            st.error(f"Connection error: {e}")

# Grab from video file
if vid_grab and vid_sel and vid_sel != "(none)":
    try:
        cap = cv2.VideoCapture(str(vid_sel))
        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(seek_t * fps))
        ret, frame = cap.read()
        cap.release()
        if ret:
            st.session_state["wiz_frame"] = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            st.session_state["wiz_shapes"] = []
            st.session_state.pop("wiz_canvas_key", None)
            st.success("Frame loaded from video.")
        else:
            st.error("Could not read frame.")
    except Exception as e:
        st.error(f"Error: {e}")

frame_rgb = st.session_state.get("wiz_frame")
if frame_rgb is None:
    st.info("Grab a frame above to start drawing.")
    st.stop()

H_orig, W_orig = frame_rgb.shape[:2]
st.divider()


# ── STEP 2: Draw on unified canvas ───────────────────────────────────────────

st.markdown('<div class="step-badge"><span class="step-num">2</span>'
            'Draw lines and zones — switch mode to draw different shapes</div>',
            unsafe_allow_html=True)

# What shapes are needed based on camera mode
if selected_cam:
    cam_modes = [m.strip() for m in selected_cam["mode"].split(",")]
    hints = []
    if "drink_count" in cam_modes:
        hints.append('<span class="shape-line">— Bar Line</span> (where bartender crosses to serve)')
        hints.append('<span class="shape-zone">▣ Station Zone</span> (where each bartender stands)')
    if "people_count" in cam_modes:
        hints.append('<span class="shape-count">— Counting Line</span> (door entry/exit line)')
    if "table_turns" in cam_modes:
        hints.append('<span class="shape-table">▣ Table Zone</span> (each table seating area)')
    if "after_hours" in cam_modes:
        hints.append('<span class="shape-zone">▣ Ignore Zone</span> (areas to exclude from motion)')
    if hints:
        st.markdown("**For this camera you need:** " + "  ·  ".join(hints),
                    unsafe_allow_html=True)
else:
    st.caption("Draw bar lines (orange), zones/polygons (red), counting lines (green), "
               "or table zones (blue) — switch mode below.")

# Mode selector + color
draw_col, meta_col = st.columns([3, 1])
with meta_col:
    draw_mode_label = st.radio(
        "Draw mode",
        ["Bar Line 🟠", "Count Line 🟢", "Zone/Polygon 🔴", "Table Zone 🔵", "Ignore Zone ⬜"],
        key="wiz_draw_mode",
    )
    mode_map = {
        "Bar Line 🟠":     ("line",    "#f97316", "bar_line"),
        "Count Line 🟢":   ("line",    "#22c55e", "count_line"),
        "Zone/Polygon 🔴": ("polygon", "#ef4444", "station_zone"),
        "Table Zone 🔵":   ("polygon", "#3b82f6", "table_zone"),
        "Ignore Zone ⬜":  ("polygon", "#94a3b8", "ignore_zone"),
    }
    canvas_mode, stroke_color, shape_type = mode_map[draw_mode_label]

    shape_label = st.text_input("Name this shape",
        placeholder="e.g. Bar Line A, Table 1, Main Entrance",
        key="wiz_shape_label")

    entry_side = 1
    if canvas_mode == "line" and shape_type == "count_line":
        entry_side = st.radio("Entry direction", [-1, 1],
            format_func=lambda x: "⬅ Left/Top" if x == -1 else "Right/Bottom ➡",
            horizontal=True, key="wiz_entry_side")

    customer_side = -1
    if canvas_mode == "line" and shape_type == "bar_line":
        customer_side = st.radio("Customer side", [-1, 1],
            format_func=lambda x: "Above line (−1)" if x == -1 else "Below line (+1)",
            key="wiz_cust_side")

    if st.button("🗑 Clear canvas", key="wiz_clear"):
        # Force canvas re-render with new key
        st.session_state["wiz_canvas_key"] = str(uuid.uuid4())[:8]
        st.rerun()

with draw_col:
    # Build overlay image — draw all saved shapes on the frame
    saved_shapes = st.session_state.get("wiz_shapes", [])
    overlay = frame_rgb.copy()
    for sh in saved_shapes:
        color_bgr = tuple(int(sh["color"].lstrip("#")[i:i+2], 16) for i in (4, 2, 0))
        if sh["type"] == "line":
            p1 = (int(sh["p1"][0] * W_orig), int(sh["p1"][1] * H_orig))
            p2 = (int(sh["p2"][0] * W_orig), int(sh["p2"][1] * H_orig))
            cv2.line(overlay, p1, p2, color_bgr, 3)
            cv2.circle(overlay, p1, 6, color_bgr, -1)
            cv2.circle(overlay, p2, 6, color_bgr, -1)
            mid = ((p1[0]+p2[0])//2, (p1[1]+p2[1])//2)
            cv2.putText(overlay, sh["label"], (mid[0]+6, mid[1]-8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, color_bgr, 2)
        elif sh["type"] == "polygon":
            pts_px = np.array([[int(p[0]*W_orig), int(p[1]*H_orig)]
                                for p in sh["pts"]], dtype=np.int32)
            cv2.polylines(overlay, [pts_px], True, color_bgr, 2)
            alpha_layer = overlay.copy()
            cv2.fillPoly(alpha_layer, [pts_px], color_bgr)
            cv2.addWeighted(alpha_layer, 0.18, overlay, 0.82, 0, overlay)
            cv2.putText(overlay, sh["label"], (pts_px[0][0]+4, pts_px[0][1]-8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, color_bgr, 2)

    pil_overlay = Image.fromarray(overlay)
    # Scale to CANVAS_W
    cw = min(CANVAS_W, W_orig)
    ch = int(H_orig * cw / W_orig)

    canvas_key = st.session_state.get("wiz_canvas_key", "wiz_main_canvas")

    if _HAS_CANVAS:
        result = st_canvas(
            fill_color=f"rgba({int(stroke_color[1:3],16)},{int(stroke_color[3:5],16)},{int(stroke_color[5:7],16)},0.18)",
            stroke_width=3,
            stroke_color=stroke_color,
            background_image=pil_overlay,
            update_streamlit=True,
            height=ch,
            width=cw,
            drawing_mode=canvas_mode,
            key=canvas_key,
            display_toolbar=True,
        )
    else:
        st.warning("Install streamlit-drawable-canvas for interactive drawing: "
                   "`pip install streamlit-drawable-canvas`")
        result = None
        st.image(overlay, use_container_width=True)

# ── Capture drawn shape ───────────────────────────────────────────────────────
if _HAS_CANVAS and result and result.json_data:
    objs = result.json_data.get("objects", [])
    if objs:
        last = objs[-1]
        captured = None
        lbl = shape_label.strip() or f"{shape_type}_{len(saved_shapes)+1}"

        if last.get("type") == "line":
            left = float(last.get("left", 0))
            top  = float(last.get("top",  0))
            x2   = float(last.get("x2",  0))
            y2   = float(last.get("y2",  0))
            captured = {
                "type":          "line",
                "shape_type":    shape_type,
                "label":         lbl,
                "color":         stroke_color,
                "p1":            [round(left / cw, 4),        round(top / ch, 4)],
                "p2":            [round((left+x2) / cw, 4),   round((top+y2) / ch, 4)],
                "entry_side":    entry_side,
                "customer_side": customer_side,
            }
        elif last.get("type") in ("path", "polygon"):
            path = last.get("path", [])
            pts  = [[round(float(c[1])/cw, 4), round(float(c[2])/ch, 4)]
                    for c in path if c[0] in ("M", "L") and len(c) >= 3]
            if len(pts) >= 3:
                captured = {
                    "type":       "polygon",
                    "shape_type": shape_type,
                    "label":      lbl,
                    "color":      stroke_color,
                    "pts":        pts,
                }

        add_col, _ = st.columns([2, 3])
        with add_col:
            if captured and st.button("✅ Save this shape", type="primary", key="wiz_save_shape"):
                shapes = st.session_state.get("wiz_shapes", [])
                shapes.append(captured)
                st.session_state["wiz_shapes"] = shapes
                st.session_state["wiz_canvas_key"] = str(uuid.uuid4())[:8]
                st.success(f"Saved: {captured['label']}")
                st.rerun()

st.divider()


# ── STEP 3: Review & saved shapes ────────────────────────────────────────────

saved_shapes = st.session_state.get("wiz_shapes", [])
st.markdown('<div class="step-badge"><span class="step-num">3</span>'
            f'Review your shapes ({len(saved_shapes)} saved)</div>',
            unsafe_allow_html=True)

if saved_shapes:
    for i, sh in enumerate(saved_shapes):
        sc1, sc2, sc3 = st.columns([4, 2, 1])
        with sc1:
            type_icon = "—" if sh["type"] == "line" else "▣"
            st.markdown(
                f'<span style="color:{sh["color"]}">{type_icon}</span> '
                f'**{sh["label"]}** · `{sh["shape_type"]}`',
                unsafe_allow_html=True)
        with sc2:
            if sh["type"] == "line":
                st.caption(f"P1({sh['p1'][0]:.3f},{sh['p1'][1]:.3f}) "
                           f"P2({sh['p2'][0]:.3f},{sh['p2'][1]:.3f})")
            else:
                st.caption(f"{len(sh['pts'])} points")
        with sc3:
            if st.button("🗑", key=f"wiz_del_{i}"):
                saved_shapes.pop(i)
                st.session_state["wiz_shapes"] = saved_shapes
                st.rerun()
else:
    st.info("No shapes saved yet. Draw and click **Save this shape** above.")

st.divider()


# ── STEP 4: Export & save config ─────────────────────────────────────────────

if not saved_shapes:
    st.stop()

st.markdown('<div class="step-badge"><span class="step-num">4</span>'
            'Save config and attach to camera</div>', unsafe_allow_html=True)

save_c1, save_c2 = st.columns(2)

with save_c1:
    cfg_id   = st.text_input("Config name",
        value=selected_cam["name"].lower().replace(" ", "_") if selected_cam else "bar_main",
        key="wiz_cfg_id")
    cfg_name = st.text_input("Display name",
        value=selected_cam["name"] if selected_cam else "Main Bar",
        key="wiz_cfg_name")
    overhead = st.checkbox("Overhead / fisheye camera",
        value=bool(selected_cam and "overhead" in selected_cam.get("notes","").lower()),
        key="wiz_overhead")

with save_c2:
    st.markdown("**What configs will be generated:**")
    has_bar    = any(s["shape_type"] in ("bar_line", "station_zone") for s in saved_shapes)
    has_lines  = any(s["shape_type"] == "count_line" for s in saved_shapes)
    has_tables = any(s["shape_type"] == "table_zone" for s in saved_shapes)
    has_ignore = any(s["shape_type"] == "ignore_zone" for s in saved_shapes)
    if has_bar:    st.markdown("✅ Bar station config (for drink_count)")
    if has_lines:  st.markdown("✅ Counting lines config (for people_count)")
    if has_tables: st.markdown("✅ Table zones config (for table_turns)")
    if has_ignore: st.markdown("✅ Ignore zones (attached as extra_config)")

if st.button("💾 Save All Configs", type="primary", key="wiz_save_all",
             use_container_width=True):
    saved_paths = []
    bar_cfg_path = None

    # ── Bar station config ────────────────────────────────────────────────
    if has_bar:
        bar_lines   = [s for s in saved_shapes if s["shape_type"] == "bar_line"]
        bar_zones   = [s for s in saved_shapes if s["shape_type"] == "station_zone"]
        stations    = []
        for i, bl in enumerate(bar_lines):
            # Match station zone by index or use full-bar default polygon
            zone_pts = (bar_zones[i]["pts"] if i < len(bar_zones)
                        else [[0.0,0.0],[1.0,0.0],[1.0,1.0],[0.0,1.0]])
            zone_lbl  = bar_zones[i]["label"] if i < len(bar_zones) else bl["label"]
            zone_id   = f"zone_{i+1}"
            stations.append(BarStation(
                zone_id=zone_id,
                label=zone_lbl,
                polygon=zone_pts,
                bar_line_p1=tuple(bl["p1"]),
                bar_line_p2=tuple(bl["p2"]),
                customer_side=bl.get("customer_side", -1),
            ))
        if stations:
            cfg = BarConfig(venue_id=cfg_id, display_name=cfg_name,
                            stations=stations, frame_width=W_orig,
                            frame_height=H_orig, overhead_camera=overhead)
            bar_cfg_path = str(cfg.save())
            saved_paths.append(bar_cfg_path)
            st.success(f"✅ Bar config saved → `{bar_cfg_path}`")

    # ── Counting lines config ─────────────────────────────────────────────
    if has_lines:
        count_lines = [s for s in saved_shapes if s["shape_type"] == "count_line"]
        lines_data  = {
            "config_id":    f"lines_{cfg_id}",
            "display_name": cfg_name,
            "lines": [{
                "line_id":    f"line_{i+1}",
                "label":      s["label"],
                "p1":         s["p1"],
                "p2":         s["p2"],
                "entry_side": s.get("entry_side", -1),
            } for i, s in enumerate(count_lines)],
        }
        p = CONFIG_DIR / f"lines_{cfg_id}.json"
        p.write_text(json.dumps(lines_data, indent=2))
        saved_paths.append(str(p))
        st.success(f"✅ Counting lines saved → `{p}`")

    # ── Table zones config ────────────────────────────────────────────────
    if has_tables:
        tbl_zones  = [s for s in saved_shapes if s["shape_type"] == "table_zone"]
        tables_data = {
            "config_id":    f"tables_{cfg_id}",
            "display_name": cfg_name,
            "tables": [{
                "table_id": f"table_{i+1}",
                "label":    s["label"],
                "polygon":  s["pts"],
            } for i, s in enumerate(tbl_zones)],
        }
        p = CONFIG_DIR / f"tables_{cfg_id}.json"
        p.write_text(json.dumps(tables_data, indent=2))
        saved_paths.append(str(p))
        st.success(f"✅ Table zones saved → `{p}`")

    # ── Ignore zones in extra config ──────────────────────────────────────
    ignore_zones_data = [{"label": s["label"], "polygon": s["pts"]}
                         for s in saved_shapes if s["shape_type"] == "ignore_zone"]

    # ── Attach config to camera ───────────────────────────────────────────
    if selected_cam and saved_paths:
        # Update camera to point to bar config (primary config)
        primary_cfg = bar_cfg_path or saved_paths[0]
        cam = selected_cam
        save_camera(
            camera_id=cam["camera_id"],
            name=cam["name"],
            rtsp_url=cam["rtsp_url"],
            mode=cam["mode"],
            config_path=primary_cfg,
            model_profile=cam.get("model_profile", "balanced"),
            segment_seconds=cam.get("segment_seconds", 60),
            enabled=cam.get("enabled", True),
            notes=cam.get("notes", ""),
        )
        st.success(f"✅ Config attached to camera **{cam['name']}** — "
                   "will be used for all future segments automatically.")

    if not saved_paths:
        st.warning("No shapes to save. Draw some shapes first.")
    else:
        st.balloons()
        # Clear session for next camera
        st.session_state.pop("wiz_shapes", None)
        st.session_state.pop("wiz_frame", None)
