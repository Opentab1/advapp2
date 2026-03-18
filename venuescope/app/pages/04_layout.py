"""VenueScope — Layout Config Editor (click-to-draw)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import json
import streamlit as st
from core.auth import require_auth as _page_auth
_page_auth()
import cv2
import numpy as np

from core.bar_config import BarConfig, BarStation, CONFIG_DIR
from core.config import UPLOAD_DIR
from core.canvas import draw_line_canvas, draw_polygon_canvas, _render_preview

st.title("⚙️ Layout Config Editor")

# ── Camera frame loader ──────────────────────────────────────────────────────
with st.expander("📷 Load Camera Frame", expanded="layout_frame" not in st.session_state):
    c1, c2 = st.columns(2)
    with c1:
        all_files = (list(UPLOAD_DIR.rglob("*.mp4")) + list(UPLOAD_DIR.rglob("*.MP4")) +
                     list(UPLOAD_DIR.rglob("*.avi")) + list(UPLOAD_DIR.rglob("*.mov")))
        if all_files:
            src = st.selectbox("Pick an uploaded clip", [str(f) for f in all_files], key="frame_src")
        else:
            src = st.text_input("Video path", placeholder="/home/pi/clips/cam.mp4", key="frame_src")
    with c2:
        t_frame = st.slider("Frame at (seconds)", 0, 120, 5, key="frame_t")
    if src and st.button("📷 Load Frame", type="primary"):
        try:
            cap = cv2.VideoCapture(str(src))
            fps = cap.get(cv2.CAP_PROP_FPS) or 25
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(t_frame * fps))
            ret, frame = cap.read()
            cap.release()
            if ret:
                st.session_state["layout_frame"] = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                st.success("Frame loaded.")
            else:
                st.error("Could not read frame.")
        except Exception as e:
            st.error(f"Error: {e}")

frame_rgb = st.session_state.get("layout_frame")
if frame_rgb is None:
    st.info("Load a frame above to continue.")
    st.stop()

H, W = frame_rgb.shape[:2]

tab1, tab2, tab3, tab4 = st.tabs(
    ["🍺 Bar Stations", "🚪 Counting Lines", "🪑 Table Zones", "👷 Server Zones"]
)


# ═══════════════════════════════════════════════════════════════════════════
# TAB 1 — Bar Stations
# ═══════════════════════════════════════════════════════════════════════════
with tab1:
    st.subheader("Bar Station Config")
    r1, r2, r3 = st.columns(3)
    with r1:
        venue_id   = st.text_input("Config ID", "bar_main", key="bar_vid")
        venue_name = st.text_input("Display Name", "Main Bar", key="bar_vname")
    with r2:
        overhead_camera = st.checkbox(
            "Overhead / fisheye ceiling camera",
            value=False,
            key="bar_overhead",
            help="Enable for top-down cameras. Lowers detection threshold to 0.15 and "
                 "increases inference resolution to 1280px for better blob detection.",
        )

    if "stations" not in st.session_state:
        st.session_state["stations"] = []
    stations = st.session_state["stations"]

    # Existing stations overview
    if stations:
        preview_lines = [
            {"line_id": s.zone_id, "label": s.label + " (bar line)",
             "p1": list(s.bar_line_p1), "p2": list(s.bar_line_p2),
             "entry_side": s.customer_side}
            for s in stations
        ]
        preview_zones = [
            {"label": s.label, "polygon": [list(p) for p in s.polygon]}
            for s in stations
        ]
        st.markdown("**Current stations overview:**")
        _render_preview(frame_rgb, preview_lines, preview_zones, height=320)
        st.caption("Orange = bar-front lines  |  Red = station zones")

        st.markdown(f"**{len(stations)} station(s):**")
        for s in stations:
            c1, c2 = st.columns([5, 1])
            with c1:
                st.markdown(
                    f"**{s.label}** (`{s.zone_id}`) · "
                    f"bar line ({s.bar_line_p1[0]:.3f},{s.bar_line_p1[1]:.3f}) → "
                    f"({s.bar_line_p2[0]:.3f},{s.bar_line_p2[1]:.3f}) · "
                    f"customer_side={s.customer_side}"
                )
            with c2:
                if st.button("🗑", key=f"bar_del_{s.zone_id}"):
                    st.session_state["stations"] = [x for x in stations if x.zone_id != s.zone_id]
                    st.rerun()
        st.divider()

    # Add new station form
    with st.expander("➕ Add New Station", expanded=len(stations) == 0):
        meta1, meta2 = st.columns(2)
        with meta1:
            s_id    = st.text_input("Zone ID", "well_a", key="bar_sid")
            s_label = st.text_input("Label", "Well A", key="bar_slabel")
        with meta2:
            customer_side = st.radio(
                "Customer side of bar-front line",
                [-1, 1],
                format_func=lambda x: "Above / Left of line (−1)" if x == -1 else "Below / Right of line (+1)",
                key="bar_cside",
                help="Which side of the drawn line the customers stand on.",
            )

        st.markdown("---")

        draw_col1, draw_col2 = st.columns(2)

        with draw_col1:
            st.markdown("**Step 1 — Draw bar-front line**")
            st.caption("The line the bartender crosses when serving.")
            line_data = draw_line_canvas(
                frame_rgb,
                key="bar_new_line",
                stroke_color="#f97316",
                height=360,
            )
            if line_data:
                p1, p2 = line_data["p1"], line_data["p2"]
                st.success(f"P1 ({p1[0]:.3f}, {p1[1]:.3f}) → P2 ({p2[0]:.3f}, {p2[1]:.3f})")
            else:
                st.info("Draw the bar line above.")

        with draw_col2:
            st.markdown("**Step 2 — Draw station zone**")
            st.caption("The area where the bartender stands. Double-click to close.")
            poly_data = draw_polygon_canvas(
                frame_rgb,
                key="bar_new_poly",
                stroke_color="#ef4444",
                fill_rgba="rgba(239,68,68,0.20)",
                height=360,
            )
            if poly_data:
                st.success(f"{len(poly_data)} corners drawn")
            else:
                st.info("Draw the zone polygon above.")

        ready = line_data is not None and poly_data is not None and len(poly_data) >= 3
        if st.button("✅ Add Station", type="primary", disabled=not ready, key="bar_add"):
            if any(s.zone_id == s_id for s in stations):
                st.error(f"Zone ID '{s_id}' already exists.")
            else:
                stations.append(BarStation(
                    zone_id=s_id, label=s_label,
                    polygon=poly_data,
                    bar_line_p1=tuple(line_data["p1"]),
                    bar_line_p2=tuple(line_data["p2"]),
                    customer_side=customer_side,
                ))
                st.session_state["stations"] = stations
                # Clear canvas state so next station starts fresh
                for k in (f"bar_new_line_result", f"bar_new_poly_result"):
                    st.session_state.pop(k, None)
                st.success(f"Added: {s_label}")
                st.rerun()

        if not ready and (line_data is None or poly_data is None):
            st.caption("Draw both the bar line and zone polygon to enable Add Station.")

    # Save / Load
    st.divider()
    col_save, col_load = st.columns(2)
    with col_save:
        if stations and st.button("💾 Save Bar Config", type="primary", use_container_width=True):
            cfg  = BarConfig(venue_id=venue_id, display_name=venue_name,
                             stations=stations, frame_width=W, frame_height=H,
                             overhead_camera=overhead_camera)
            path = cfg.save()
            st.success(f"Saved → `{path}`")
            st.json(cfg.to_dict())
    with col_load:
        existing = [p.stem for p in CONFIG_DIR.glob("*.json")
                    if not p.stem.startswith(("lines_", "tables_", "servers_"))]
        if existing:
            load_sel = st.selectbox("Load existing", existing, key="bar_load_sel")
            if st.button("📂 Load", key="bar_load_btn"):
                try:
                    loaded = BarConfig.load(load_sel)
                    if loaded:
                        st.session_state["stations"] = loaded.stations
                        st.success(f"Loaded: {load_sel} ({len(loaded.stations)} stations)")
                        st.rerun()
                except Exception as e:
                    st.error(f"Load error: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# TAB 2 — Counting Lines
# ═══════════════════════════════════════════════════════════════════════════
with tab2:
    st.subheader("Counting Lines Config")
    st.caption("For door/entrance cameras in people_count mode.")

    l1, l2 = st.columns(2)
    with l1:
        lines_cid  = st.text_input("Config ID", "door_main", key="lines_cid")
        lines_name = st.text_input("Display Name", "Main Entrance", key="lines_name")
    with l2:
        n_lines = st.number_input("Number of counting lines", 1, 6, 1, key="lines_n")

    counting_lines = []
    for i in range(int(n_lines)):
        with st.expander(f"Line {i+1}", expanded=True):
            lm1, lm2, lm3 = st.columns([1, 2, 1])
            with lm1:
                lid   = st.text_input("Line ID",  f"line_{i+1}", key=f"lid_{i}")
                label = st.text_input("Label",    f"Entrance {i+1}", key=f"llabel_{i}")
                side  = st.radio(
                    "Entry side", [-1, 1],
                    format_func=lambda x: "Left/Top (−1)" if x == -1 else "Right/Bottom (+1)",
                    horizontal=True, key=f"lside_{i}",
                )
            with lm2:
                line_result = draw_line_canvas(
                    frame_rgb,
                    key=f"lines_canvas_{i}",
                    stroke_color="#22c55e",
                    height=360,
                )
            with lm3:
                if line_result:
                    p1, p2 = line_result["p1"], line_result["p2"]
                    st.markdown("**Captured:**")
                    st.code(f"P1 ({p1[0]:.3f}, {p1[1]:.3f})\nP2 ({p2[0]:.3f}, {p2[1]:.3f})")
                    counting_lines.append({
                        "line_id": lid, "label": label,
                        "p1": p1, "p2": p2, "entry_side": side,
                    })
                else:
                    st.info("Draw line →")

    if counting_lines:
        st.markdown("**Preview:**")
        _render_preview(frame_rgb, counting_lines, [], height=320)

    st.divider()
    col_save2, col_load2 = st.columns(2)
    with col_save2:
        if counting_lines and st.button("💾 Save Counting Lines Config", type="primary",
                                        use_container_width=True):
            data = {"config_id": lines_cid, "display_name": lines_name, "lines": counting_lines}
            path = CONFIG_DIR / f"lines_{lines_cid}.json"
            path.write_text(json.dumps(data, indent=2))
            st.success(f"Saved → `{path}`")
            st.json(data)
    with col_load2:
        existing_lines = list(CONFIG_DIR.glob("lines_*.json"))
        if existing_lines:
            sel = st.selectbox("Load existing", [p.name for p in existing_lines], key="lines_load_sel")
            if st.button("📂 Load", key="lines_load_btn"):
                try:
                    d = json.loads((CONFIG_DIR / sel).read_text())
                    st.success(f"Loaded: {sel} — {len(d.get('lines', []))} lines")
                    st.json(d)
                except Exception as e:
                    st.error(f"Load error: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# TAB 3 — Table Zones
# ═══════════════════════════════════════════════════════════════════════════
with tab3:
    st.subheader("Table Zones Config")
    st.caption("For floor cameras in table_turns mode.")

    t1, t2 = st.columns(2)
    with t1:
        tables_cid  = st.text_input("Config ID", "floor_main", key="tables_cid")
        tables_name = st.text_input("Display Name", "Main Floor", key="tables_name")
    with t2:
        n_tables = st.number_input("Number of tables", 1, 12, 2, key="tables_n")

    table_zones = []
    ZONE_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#a855f7",
                   "#f97316", "#eab308", "#ec4899", "#06b6d4",
                   "#84cc16", "#f43f5e", "#8b5cf6", "#14b8a6"]

    for i in range(int(n_tables)):
        with st.expander(f"Table {i+1}", expanded=(i == 0)):
            tm1, tm2, tm3 = st.columns([1, 2, 1])
            color = ZONE_COLORS[i % len(ZONE_COLORS)]
            with tm1:
                tid    = st.text_input("Table ID", f"table_{i+1}", key=f"tid_{i}")
                tlabel = st.text_input("Label",    f"Table {i+1}", key=f"tlabel_{i}")
                st.markdown(f'<span style="color:{color}">■</span> Zone color', unsafe_allow_html=True)
            with tm2:
                pts = draw_polygon_canvas(
                    frame_rgb,
                    key=f"table_canvas_{i}",
                    stroke_color=color,
                    fill_rgba=f"rgba({int(color[1:3],16)},{int(color[3:5],16)},{int(color[5:7],16)},0.20)",
                    height=360,
                )
            with tm3:
                if pts:
                    st.markdown("**Captured:**")
                    st.code(f"{len(pts)} points")
                    table_zones.append({"table_id": tid, "label": tlabel, "polygon": pts})
                else:
                    st.info("Draw zone →")

    if table_zones:
        preview_tzones = [{"label": z["label"], "polygon": z["polygon"]} for z in table_zones]
        st.markdown("**All table zones preview:**")
        _render_preview(frame_rgb, [], preview_tzones, height=320)

    st.divider()
    col_save3, col_load3 = st.columns(2)
    with col_save3:
        if table_zones and st.button("💾 Save Table Zones Config", type="primary",
                                     use_container_width=True):
            data = {"config_id": tables_cid, "display_name": tables_name, "tables": table_zones}
            path = CONFIG_DIR / f"tables_{tables_cid}.json"
            path.write_text(json.dumps(data, indent=2))
            st.success(f"Saved → `{path}`")
            st.json(data)
    with col_load3:
        existing_tables = list(CONFIG_DIR.glob("tables_*.json"))
        if existing_tables:
            sel = st.selectbox("Load existing", [p.name for p in existing_tables], key="tables_load_sel")
            if st.button("📂 Load", key="tables_load_btn"):
                try:
                    d = json.loads((CONFIG_DIR / sel).read_text())
                    st.success(f"Loaded: {sel} — {len(d.get('tables', []))} tables")
                    st.json(d)
                except Exception as e:
                    st.error(f"Load error: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# TAB 4 — Server Zones
# ═══════════════════════════════════════════════════════════════════════════
with tab4:
    st.subheader("Server Zones Config")
    st.caption("For server/staff tracking.")

    sv1, sv2 = st.columns(2)
    with sv1:
        servers_cid = st.text_input("Config ID", "servers_main", key="servers_cid")
    with sv2:
        n_servers = st.number_input("Number of servers", 1, 8, 2, key="servers_n")

    server_names = []
    st.markdown("**Server names:**")
    name_cols = st.columns(min(int(n_servers), 4))
    for i in range(int(n_servers)):
        with name_cols[i % 4]:
            name = st.text_input(f"Server {i+1}", f"Server {i+1}", key=f"sname_{i}")
            server_names.append({"name": name})

    st.markdown("---")
    n_areas = st.number_input("Number of service areas", 1, 12, 2, key="servers_nareas")

    server_zones = []
    SRV_COLORS = ["#a855f7", "#3b82f6", "#22c55e", "#f97316",
                  "#ec4899", "#eab308", "#06b6d4", "#ef4444"]

    for i in range(int(n_areas)):
        with st.expander(f"Area {i+1}", expanded=(i == 0)):
            sa1, sa2, sa3 = st.columns([1, 2, 1])
            color = SRV_COLORS[i % len(SRV_COLORS)]
            with sa1:
                aid    = st.text_input("Area ID", f"area_{i+1}",   key=f"aid_{i}")
                alabel = st.text_input("Label",   f"Section {i+1}", key=f"alabel_{i}")
            with sa2:
                pts = draw_polygon_canvas(
                    frame_rgb,
                    key=f"server_canvas_{i}",
                    stroke_color=color,
                    fill_rgba=f"rgba({int(color[1:3],16)},{int(color[3:5],16)},{int(color[5:7],16)},0.20)",
                    height=360,
                )
            with sa3:
                if pts:
                    st.markdown("**Captured:**")
                    st.code(f"{len(pts)} points")
                    server_zones.append({"area_id": aid, "label": alabel, "polygon": pts})
                else:
                    st.info("Draw zone →")

    if server_zones:
        preview_szones = [{"label": z["label"], "polygon": z["polygon"]} for z in server_zones]
        st.markdown("**All server zones preview:**")
        _render_preview(frame_rgb, [], preview_szones, height=320)

    st.divider()
    col_save4, col_load4 = st.columns(2)
    with col_save4:
        if server_zones and st.button("💾 Save Server Zones Config", type="primary",
                                      use_container_width=True):
            data = {"config_id": servers_cid, "servers": server_names, "zones": server_zones}
            path = CONFIG_DIR / f"servers_{servers_cid}.json"
            path.write_text(json.dumps(data, indent=2))
            st.success(f"Saved → `{path}`")
            st.json(data)
    with col_load4:
        existing_servers = list(CONFIG_DIR.glob("servers_*.json"))
        if existing_servers:
            sel = st.selectbox("Load existing", [p.name for p in existing_servers], key="servers_load_sel")
            if st.button("📂 Load", key="servers_load_btn"):
                try:
                    d = json.loads((CONFIG_DIR / sel).read_text())
                    st.success(f"Loaded: {sel} — {len(d.get('zones', []))} areas, "
                               f"{len(d.get('servers', []))} servers")
                    st.json(d)
                except Exception as e:
                    st.error(f"Load error: {e}")
