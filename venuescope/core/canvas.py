"""
VenueScope — Interactive zone/line canvas v5.
Uses streamlit-drawable-canvas for true click-to-draw bidirectional interaction.

draw_line_canvas()    → click two points, get a bar/counting line
draw_polygon_canvas() → click corners + double-click to close, get a zone polygon
line_zone_editor()    → combined editor used by 01_run.py (backward-compatible API)
_render_preview()     → read-only HTML canvas overlay (used by 04_layout.py summary)
"""
from __future__ import annotations
import base64
import json
from typing import List, Optional, Tuple

import cv2
import numpy as np
import streamlit as st
import streamlit.components.v1 as components
from PIL import Image

try:
    from streamlit_drawable_canvas import st_canvas
    _HAS_CANVAS = True
except ImportError:
    _HAS_CANVAS = False

CANVAS_W = 760   # display pixel width for all draw canvases


# ── Helpers ─────────────────────────────────────────────────────────────────

def _to_pil(frame_rgb: np.ndarray, max_w: int = CANVAS_W) -> Tuple[Image.Image, int, int]:
    """Return (PIL image, display_w, display_h) scaled to max_w."""
    H, W = frame_rgb.shape[:2]
    if W > max_w:
        scale = max_w / W
        frame_rgb = cv2.resize(frame_rgb, (max_w, int(H * scale)))
        H, W = frame_rgb.shape[:2]
    return Image.fromarray(frame_rgb), W, H


def _frame_to_b64(frame_rgb: np.ndarray, max_w: int = CANVAS_W) -> Tuple[str, int, int]:
    """Return (base64 jpeg, display_w, display_h)."""
    H, W = frame_rgb.shape[:2]
    if W > max_w:
        scale = max_w / W
        frame_rgb = cv2.resize(frame_rgb, (max_w, int(H * scale)))
        H, W = frame_rgb.shape[:2]
    bgr = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
    _, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buf.tobytes()).decode(), W, H


def _parse_line(obj: dict, cw: int, ch: int) -> Optional[Tuple[float, float, float, float]]:
    """Extract normalised (p1x, p1y, p2x, p2y) from a canvas line object."""
    if obj.get("type") != "line":
        return None
    left = float(obj.get("left", 0))
    top  = float(obj.get("top",  0))
    x2   = float(obj.get("x2",  0))
    y2   = float(obj.get("y2",  0))
    return (
        round(left        / cw, 3),
        round(top         / ch, 3),
        round((left + x2) / cw, 3),
        round((top  + y2) / ch, 3),
    )


def _parse_polygon(obj: dict, cw: int, ch: int) -> Optional[List[List[float]]]:
    """Extract normalised [[x,y],...] from a canvas path (polygon) object."""
    if obj.get("type") not in ("path", "polygon"):
        return None
    path = obj.get("path", [])
    pts: List[List[float]] = []
    for cmd in path:
        if cmd[0] in ("M", "L") and len(cmd) >= 3:
            pts.append([round(float(cmd[1]) / cw, 3), round(float(cmd[2]) / ch, 3)])
    return pts if len(pts) >= 3 else None


# ── Public drawing widgets ───────────────────────────────────────────────────

def draw_line_canvas(
    frame_rgb:     np.ndarray,
    existing_line: Optional[dict] = None,
    key:           str = "draw_line",
    stroke_color:  str = "#f97316",
    height:        int = 400,
) -> Optional[dict]:
    """
    Click-to-draw a single line on the camera frame.
    Returns {"p1": [nx,ny], "p2": [nx,ny]} in 0–1 normalised coords,
    or `existing_line` if nothing drawn yet.

    Usage:
        line = draw_line_canvas(frame_rgb, key="bar_line")
        if line:
            st.write(line["p1"], line["p2"])
    """
    if not _HAS_CANVAS:
        return _line_fallback(existing_line, key)

    pil_img, cw, ch = _to_pil(frame_rgb)
    canvas_h = int(ch * CANVAS_W / cw) if cw else height

    # Always show reference frame so user can see the venue while drawing
    st.image(frame_rgb, caption="Reference frame — draw your line on the canvas below",
             use_container_width=True)
    st.caption("Click to place start point, click again for end point. "
               "Ctrl+Z to undo. Most recent line is used.")

    result = st_canvas(
        fill_color="rgba(249,115,22,0.15)",
        stroke_width=3,
        stroke_color=stroke_color,
        background_color="#1e293b",
        update_streamlit=True,
        height=canvas_h,
        width=CANVAS_W,
        drawing_mode="line",
        key=key,
    )

    if result.json_data:
        lines = [o for o in result.json_data.get("objects", [])
                 if o.get("type") == "line"]
        if lines:
            coords = _parse_line(lines[-1], CANVAS_W, canvas_h)
            if coords:
                p1x, p1y, p2x, p2y = coords
                drawn = {"p1": [p1x, p1y], "p2": [p2x, p2y]}
                # Mirror into session state so other widgets can read it
                st.session_state[f"{key}_result"] = drawn
                return drawn

    # Return previously-stored result if user hasn't drawn anything new
    cached = st.session_state.get(f"{key}_result")
    if cached:
        return cached
    return existing_line


def draw_polygon_canvas(
    frame_rgb:        np.ndarray,
    existing_polygon: Optional[List] = None,
    key:              str = "draw_poly",
    stroke_color:     str = "#ef4444",
    fill_rgba:        str = "rgba(239,68,68,0.18)",
    height:           int = 400,
) -> Optional[List[List[float]]]:
    """
    Click-to-draw a polygon zone on the camera frame.
    Returns [[nx,ny],...] in 0–1 normalised coords,
    or `existing_polygon` if nothing drawn yet.
    Double-click last point to close polygon.

    Usage:
        pts = draw_polygon_canvas(frame_rgb, key="zone_a")
        if pts:
            st.write(pts)
    """
    if not _HAS_CANVAS:
        return _poly_fallback(existing_polygon, key)

    pil_img, cw, ch = _to_pil(frame_rgb)
    canvas_h = int(ch * CANVAS_W / cw) if cw else height

    # Always show reference frame so user can see the venue while drawing
    st.image(frame_rgb, caption="Reference frame — draw your zone on the canvas below",
             use_container_width=True)
    st.caption("Click corners of the zone. Double-click on last point to close. Ctrl+Z to undo.")

    result = st_canvas(
        fill_color=fill_rgba,
        stroke_width=2,
        stroke_color=stroke_color,
        background_color="#1e293b",
        update_streamlit=True,
        height=canvas_h,
        width=CANVAS_W,
        drawing_mode="polygon",
        key=key,
    )

    if result.json_data:
        polys = [o for o in result.json_data.get("objects", [])
                 if o.get("type") in ("path", "polygon")]
        if polys:
            pts = _parse_polygon(polys[-1], CANVAS_W, canvas_h)
            if pts:
                st.session_state[f"{key}_result"] = pts
                return pts

    cached = st.session_state.get(f"{key}_result")
    if cached:
        return cached
    return existing_polygon


# ── Backward-compatible combined editor (used by 01_run.py) ─────────────────

def line_zone_editor(
    frame_rgb:       np.ndarray,
    session_key:     str  = "lz_state",
    mode:            str  = "lines_and_zones",
    n_lines_default: int  = 1,
    height:          int  = 460,
) -> dict:
    """
    Full interactive editor: canvas drawing + metadata inputs.
    Returns {"lines": [...], "zones": [...]}

    mode options: "lines_only", "zones_only", "lines_and_zones"
    """
    if session_key not in st.session_state:
        st.session_state[session_key] = {"n_lines": n_lines_default, "n_zones": 0}
    ss = st.session_state[session_key]

    lines: List[dict] = []
    zones: List[dict] = []

    # ── Lines ──────────────────────────────────────────────────────────────
    if mode in ("lines_only", "lines_and_zones"):
        n_lines = st.number_input(
            "Number of counting lines", 1, 6, int(ss.get("n_lines", n_lines_default)),
            key=f"{session_key}_nl",
        )
        ss["n_lines"] = int(n_lines)

        if _HAS_CANVAS:
            for i in range(int(n_lines)):
                with st.expander(f"📏 Line {i+1}", expanded=True):
                    mc1, mc2, mc3 = st.columns([1, 2, 1])
                    with mc1:
                        lid   = st.text_input("ID",    f"entrance_{i+1}", key=f"{session_key}_lid_{i}")
                        label = st.text_input("Label", f"Entrance {i+1}", key=f"{session_key}_llabel_{i}")
                        side  = st.radio(
                            "Entry direction", [-1, 1],
                            format_func=lambda x: "⬅ Left/Top" if x == -1 else "Right/Bottom ➡",
                            horizontal=True, key=f"{session_key}_side_{i}",
                        )
                    with mc2:
                        if frame_rgb is not None:
                            line_data = draw_line_canvas(
                                frame_rgb,
                                key=f"{session_key}_linecanvas_{i}",
                                height=height,
                            )
                        else:
                            line_data = None
                            st.info("Upload a clip to draw lines.")
                    with mc3:
                        if line_data:
                            p1, p2 = line_data["p1"], line_data["p2"]
                            st.markdown("**Captured:**")
                            st.code(f"P1 ({p1[0]:.3f}, {p1[1]:.3f})\n"
                                    f"P2 ({p2[0]:.3f}, {p2[1]:.3f})")
                            lines.append({
                                "line_id": lid, "label": label,
                                "p1": p1, "p2": p2,
                                "entry_side": side,
                            })
                        else:
                            st.caption("Draw a line →")
        else:
            # Fallback number inputs
            for i in range(int(n_lines)):
                with st.expander(f"📏 Line {i+1}", expanded=True):
                    c1, c2, c3 = st.columns([1, 1, 1])
                    with c1:
                        lid   = st.text_input("ID",    f"entrance_{i+1}", key=f"{session_key}_lid_{i}")
                        label = st.text_input("Label", f"Entrance {i+1}", key=f"{session_key}_llabel_{i}")
                        side  = st.radio(
                            "Entry direction", [-1, 1],
                            format_func=lambda x: "⬅ Left/Top" if x == -1 else "Right/Bottom ➡",
                            horizontal=True, key=f"{session_key}_side_{i}",
                        )
                    with c2:
                        st.markdown("**P1**")
                        x1 = st.number_input("P1 x", 0.0, 1.0, round(0.3 + i * 0.3, 2), 0.001,
                                             format="%.3f", key=f"{session_key}_x1_{i}")
                        y1 = st.number_input("P1 y", 0.0, 1.0, 0.0, 0.001,
                                             format="%.3f", key=f"{session_key}_y1_{i}")
                    with c3:
                        st.markdown("**P2**")
                        x2 = st.number_input("P2 x", 0.0, 1.0,
                                             round(min(0.9 - i * 0.3, 1.0), 2), 0.001,
                                             format="%.3f", key=f"{session_key}_x2_{i}")
                        y2 = st.number_input("P2 y", 0.0, 1.0, 1.0, 0.001,
                                             format="%.3f", key=f"{session_key}_y2_{i}")
                    lines.append({
                        "line_id": lid, "label": label,
                        "p1": [round(x1, 3), round(y1, 3)],
                        "p2": [round(x2, 3), round(y2, 3)],
                        "entry_side": side,
                    })

    # ── Zones ──────────────────────────────────────────────────────────────
    if mode in ("zones_only", "lines_and_zones"):
        n_zones = st.number_input(
            "Staff exclusion zones (optional)", 0, 4, int(ss.get("n_zones", 0)),
            key=f"{session_key}_nz",
        )
        ss["n_zones"] = int(n_zones)

        if _HAS_CANVAS:
            for i in range(int(n_zones)):
                with st.expander(f"🚫 Zone {i+1}", expanded=True):
                    zc1, zc2, zc3 = st.columns([1, 2, 1])
                    with zc1:
                        zlabel = st.text_input(
                            "Zone label", f"Staff Zone {i+1}", key=f"{session_key}_zlab_{i}"
                        )
                    with zc2:
                        if frame_rgb is not None:
                            pts = draw_polygon_canvas(
                                frame_rgb,
                                key=f"{session_key}_polycanvas_{i}",
                                height=height,
                            )
                        else:
                            pts = None
                    with zc3:
                        if pts:
                            st.markdown("**Captured:**")
                            st.code(f"{len(pts)} points")
                            zones.append({"label": zlabel, "polygon": pts})
                        else:
                            st.caption("Draw zone →")
        else:
            for i in range(int(n_zones)):
                with st.expander(f"🚫 Zone {i+1}", expanded=True):
                    zc1, zc2 = st.columns([1, 2])
                    with zc1:
                        zlabel = st.text_input(
                            "Zone label", f"Staff Zone {i+1}", key=f"{session_key}_zlab_{i}"
                        )
                    with zc2:
                        default = "0.0,0.7 0.3,0.7 0.3,1.0 0.0,1.0"
                        raw = st.text_input("Polygon points", default, key=f"{session_key}_zpoly_{i}")
                    try:
                        pts = [[float(v) for v in pair.split(",")]
                               for pair in raw.strip().split() if "," in pair]
                        if len(pts) >= 3:
                            zones.append({"label": zlabel, "polygon": pts})
                    except Exception:
                        pass

    # ── Preview ────────────────────────────────────────────────────────────
    if frame_rgb is not None and (lines or zones):
        st.markdown("**Preview of all drawn shapes:**")
        _render_preview(frame_rgb, lines, zones, height=min(height, 380))
    elif frame_rgb is None:
        st.info("Upload a clip above to see the live preview.")

    return {"lines": lines, "zones": zones}


# ── Read-only HTML preview (used by 04_layout.py overview panels) ────────────

def _render_preview(frame_rgb: np.ndarray, lines: list, zones: list,
                    height: int = 460):
    """Render a read-only HTML canvas with lines and zone overlays."""
    b64, W, H = _frame_to_b64(frame_rgb)
    lines_json = json.dumps(lines)
    zones_json = json.dumps(zones)
    html = f"""
<!DOCTYPE html><html><head>
<style>
* {{margin:0;padding:0;box-sizing:border-box;}}
body {{background:#0f172a;}}
canvas {{display:block;max-width:100%;}}
#info {{font-family:monospace;font-size:11px;color:#f97316;
        background:#0f172a;padding:4px 8px;min-height:20px;}}
</style></head><body>
<canvas id="c"></canvas>
<div id="info">Hover for coordinates</div>
<script>
const lines={lines_json}, zones={zones_json};
const IMG_W={W}, IMG_H={H};
const COLORS=['#f97316','#22c55e','#3b82f6','#a855f7','#ec4899','#eab308'];
const canvas=document.getElementById('c');
const ctx=canvas.getContext('2d');
const img=new Image();
img.onload=()=>{{canvas.width=img.width;canvas.height=img.height;draw();}};
img.src='data:image/jpeg;base64,{b64}';
canvas.addEventListener('mousemove',e=>{{
  const r=canvas.getBoundingClientRect();
  const sx=canvas.width/r.width, sy=canvas.height/r.height;
  const px=(e.clientX-r.left)*sx, py=(e.clientY-r.top)*sy;
  document.getElementById('info').textContent=
    'x='+(px/IMG_W).toFixed(3)+'  y='+(py/IMG_H).toFixed(3)+
    '  (px: '+Math.round(px)+','+Math.round(py)+')';
}});
function draw(){{
  if(!img.complete||!img.naturalWidth) return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,0,0);
  zones.forEach((z,i)=>{{
    const poly=z.polygon.map(([nx,ny])=>[nx*IMG_W,ny*IMG_H]);
    if(!poly.length) return;
    ctx.beginPath(); ctx.moveTo(poly[0][0],poly[0][1]);
    poly.slice(1).forEach(([x,y])=>ctx.lineTo(x,y));
    ctx.closePath();
    ctx.fillStyle='rgba(239,68,68,0.18)'; ctx.fill();
    ctx.strokeStyle='#ef4444'; ctx.lineWidth=2; ctx.stroke();
    ctx.fillStyle='#ef4444'; ctx.font='bold 12px monospace';
    ctx.fillText(z.label, poly[0][0]+4, poly[0][1]-6);
  }});
  lines.forEach((l,i)=>{{
    if(!l.p1||!l.p2) return;
    const color=COLORS[i%COLORS.length];
    const p1=[l.p1[0]*IMG_W,l.p1[1]*IMG_H];
    const p2=[l.p2[0]*IMG_W,l.p2[1]*IMG_H];
    ctx.beginPath(); ctx.moveTo(p1[0],p1[1]); ctx.lineTo(p2[0],p2[1]);
    ctx.strokeStyle=color; ctx.lineWidth=3; ctx.stroke();
    const mid=[(p1[0]+p2[0])/2,(p1[1]+p2[1])/2];
    const dx=p2[0]-p1[0], dy=p2[1]-p1[1];
    const perp=[-dy,dx]; const mag=Math.sqrt(perp[0]**2+perp[1]**2)||1;
    const side=l.entry_side||-1;
    const ae=[mid[0]+side*perp[0]/mag*36,mid[1]+side*perp[1]/mag*36];
    ctx.beginPath(); ctx.moveTo(mid[0],mid[1]); ctx.lineTo(ae[0],ae[1]);
    ctx.strokeStyle=color; ctx.lineWidth=2; ctx.stroke();
    const ang=Math.atan2(ae[1]-mid[1],ae[0]-mid[0]);
    ctx.beginPath();
    ctx.moveTo(ae[0],ae[1]);
    ctx.lineTo(ae[0]-11*Math.cos(ang-0.4),ae[1]-11*Math.sin(ang-0.4));
    ctx.lineTo(ae[0]-11*Math.cos(ang+0.4),ae[1]-11*Math.sin(ang+0.4));
    ctx.closePath(); ctx.fillStyle=color; ctx.fill();
    [p1,p2].forEach(([x,y])=>{{
      ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
    }});
    ctx.fillStyle=color; ctx.font='bold 12px monospace';
    ctx.fillText(l.label||(''+(i+1)),p1[0]+6,p1[1]-8);
    const txt='P1('+l.p1[0]+','+l.p1[1]+') P2('+l.p2[0]+','+l.p2[1]+')';
    ctx.fillStyle='rgba(0,0,0,0.65)';
    const tw=ctx.measureText(txt).width;
    ctx.fillRect(p1[0]+4,p1[1]+2,tw+8,16);
    ctx.fillStyle='#94a3b8'; ctx.font='10px monospace';
    ctx.fillText(txt,p1[0]+8,p1[1]+14);
  }});
}}
</script></body></html>"""
    components.html(html, height=height + 24, scrolling=False)


# ── Private fallbacks when drawable-canvas not installed ────────────────────

def _line_fallback(existing: Optional[dict], key: str) -> dict:
    st.warning("`streamlit-drawable-canvas` not found — using manual inputs. "
               "Run: `pip install streamlit-drawable-canvas`")
    ex = existing or {"p1": [0.1, 0.5], "p2": [0.9, 0.5]}
    c1, c2 = st.columns(2)
    with c1:
        x1 = st.number_input("P1 x", 0.0, 1.0, ex["p1"][0], 0.001, format="%.3f", key=f"{key}_x1")
        y1 = st.number_input("P1 y", 0.0, 1.0, ex["p1"][1], 0.001, format="%.3f", key=f"{key}_y1")
    with c2:
        x2 = st.number_input("P2 x", 0.0, 1.0, ex["p2"][0], 0.001, format="%.3f", key=f"{key}_x2")
        y2 = st.number_input("P2 y", 0.0, 1.0, ex["p2"][1], 0.001, format="%.3f", key=f"{key}_y2")
    return {"p1": [round(x1, 3), round(y1, 3)], "p2": [round(x2, 3), round(y2, 3)]}


def _poly_fallback(existing: Optional[List], key: str) -> Optional[List]:
    st.warning("`streamlit-drawable-canvas` not found — using manual inputs.")
    default = (" ".join(f"{p[0]},{p[1]}" for p in existing)
               if existing else "0.05,0.2 0.95,0.2 0.95,0.8 0.05,0.8")
    raw = st.text_area("Polygon corners (x,y pairs)", default, key=f"{key}_poly")
    try:
        pts = [[float(v) for v in p.split(",")]
               for p in raw.strip().split() if "," in p]
        return pts if len(pts) >= 3 else None
    except Exception:
        return None
