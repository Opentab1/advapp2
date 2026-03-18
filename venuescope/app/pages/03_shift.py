"""
VenueScope — Shift Setup page.
"""
import uuid, json
from pathlib import Path
import streamlit as st
from core.database import save_shift, list_shifts, get_shift
from core.shift    import BARTENDER_COLORS
from core.config   import CONFIG_DIR
from core.auth import require_auth as _page_auth
_page_auth()

st.title("🔑 Shift Setup")
st.markdown(
    "Create a shift before running a drink count analysis. "
    "A shift defines which bartender works which station zone."
)

# Load available station zones from bar configs
_zone_options = []
for _cfg_path in CONFIG_DIR.glob("*.json"):
    try:
        _d = json.loads(_cfg_path.read_text())
        for _s in _d.get("stations", []):
            _label = f"{_s.get('label', _s['zone_id'])} ({_cfg_path.stem})"
            _zone_options.append((_label, _s["zone_id"]))
    except Exception:
        pass

st.subheader("New Shift")

with st.form("shift_form"):
    shift_name = st.text_input("Shift name", placeholder="Friday Night — Week 12")
    n = st.number_input("Number of bartenders", 1, 8, 1)
    bartenders = []

    for i in range(int(n)):
        c1, c2, c3 = st.columns([2, 2, 1])
        with c1:
            name = st.text_input(f"Bartender #{i+1} name", key=f"name_{i}",
                                  placeholder=f"Bartender {i+1}")
        with c2:
            if _zone_options:
                zone_labels = [z[0] for z in _zone_options]
                zone_sel = st.selectbox(f"Station zone #{i+1}", zone_labels,
                                        key=f"zone_sel_{i}",
                                        help="Select which bar station this bartender works")
                station = _zone_options[zone_labels.index(zone_sel)][1]
            else:
                station = st.text_input(f"Station zone ID #{i+1}", key=f"station_{i}",
                                         placeholder="well_a",
                                         help="Must match zone_id in Bar Layout config")
        with c3:
            color = st.color_picker(f"Color #{i+1}", key=f"color_{i}",
                                     value=BARTENDER_COLORS[i % len(BARTENDER_COLORS)])
        if name:
            bartenders.append({"name": name, "station_id": station or "zone_1", "color": color})

    notes = st.text_area("Notes (optional)")
    submitted = st.form_submit_button("💾 Save Shift", type="primary")

if submitted:
    if not shift_name:
        st.error("Enter a shift name.")
    elif not bartenders:
        st.error("Add at least one bartender with name and station ID.")
    else:
        sid = str(uuid.uuid4())[:8]
        save_shift(sid, shift_name, bartenders, notes)
        st.success(f"✅ Shift **{shift_name}** saved — ID: `{sid}`")
        st.json({"shift_id": sid, "bartenders": bartenders})

st.divider()
st.subheader("Saved Shifts")

shifts = list_shifts()
if not shifts:
    st.info("No shifts saved yet.")
else:
    for sh in shifts:
        with st.expander(f"📋 {sh['shift_name']}  —  `{sh['shift_id']}`"):
            for b in sh["bartenders"]:
                st.markdown(
                    f"&nbsp;&nbsp;<span style='color:{b['color']}'>■</span> "
                    f"**{b['name']}** → station `{b['station_id']}`",
                    unsafe_allow_html=True)
            if st.button("Use as template", key=f"tmpl_{sh['shift_id']}"):
                st.session_state["shift_template"] = sh["bartenders"]
                st.success("Template loaded — scroll up to edit.")
