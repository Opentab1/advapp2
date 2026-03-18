"""
VenueScope — System Check page.
Pre-flight: verify models downloaded, disk space, Python deps.
"""
import sys, shutil
from pathlib import Path
import streamlit as st
from core.auth import require_auth as _page_auth
_page_auth()

st.title("🔧 System Check")
st.markdown("Run this before your first analysis to make sure everything is ready.")

BASE = Path(__file__).resolve().parent.parent.parent

# ── Python deps ───────────────────────────────────────────────────────────────
st.subheader("1. Python Dependencies")
deps = {
    "ultralytics":  "YOLO models",
    "cv2":          "OpenCV",
    "numpy":        "NumPy",
    "pandas":       "Pandas",
    "streamlit":    "Streamlit",
    "sqlalchemy":   "Database",
    "reportlab":    "PDF reports (optional)",
}
for pkg, desc in deps.items():
    try:
        mod = __import__(pkg)
        ver = getattr(mod, "__version__", "?")
        st.success(f"✅ **{pkg}** ({desc}) — v{ver}")
    except ImportError:
        if pkg == "reportlab":
            st.warning(f"⚠️ **{pkg}** not installed — PDF reports disabled. "
                       f"Run: `pip install reportlab`")
        else:
            st.error(f"❌ **{pkg}** ({desc}) — **NOT INSTALLED**. "
                     f"Run: `pip install {pkg}`")

# ── YOLO models ───────────────────────────────────────────────────────────────
st.subheader("2. YOLO Model Files")
st.markdown("Models auto-download on first use **if the Pi has internet access**. "
            "Pre-download them here to avoid delays during analysis.")

model_info = {
    "yolov8n.pt": ("Fast profile",    "6 MB",  "fastest, good for well-lit footage"),
    "yolov8s.pt": ("Balanced profile","22 MB", "recommended for most venues"),
    "yolov8m.pt": ("Accurate profile","52 MB", "best accuracy, ~3× slower"),
}

# Common cache locations ultralytics uses
def find_model(name):
    candidates = [
        Path.home()/".cache"/"ultralytics"/"assets"/name,
        Path.home()/".cache"/"ultralytics"/name,
        Path(name),
        BASE/name,
    ]
    for c in candidates:
        if c.exists():
            return c
    return None

for mname, (profile, size, note) in model_info.items():
    found = find_model(mname)
    if found:
        st.success(f"✅ **{mname}** ({profile}, {size}) — found at `{found}`")
    else:
        col1, col2 = st.columns([3,1])
        col1.warning(f"⚠️ **{mname}** ({profile}, {size}) — not found. {note}.")
        with col2:
            if st.button(f"⬇️ Download {mname}", key=f"dl_{mname}"):
                with st.spinner(f"Downloading {mname}…"):
                    try:
                        from ultralytics import YOLO
                        YOLO(mname)  # triggers download
                        st.success(f"✅ {mname} downloaded.")
                        st.rerun()
                    except Exception as e:
                        st.error(f"Download failed: {e}\n\n"
                                 f"Copy {mname} manually to the Pi and place in the "
                                 f"venuescope_v5 folder.")

# ── Disk space ────────────────────────────────────────────────────────────────
st.subheader("3. Disk Space")
total, used, free = shutil.disk_usage("/")
gb = 1024**3
st.metric("Free disk space", f"{free/gb:.1f} GB",
          delta=None if free/gb > 5 else "⚠️ Low",
          delta_color="inverse")
if free/gb < 2:
    st.error("❌ Less than 2GB free. Analysis will fail. Clear old videos/results.")
elif free/gb < 5:
    st.warning("⚠️ Under 5GB free. Long clips may run out of space.")
else:
    st.success(f"✅ {free/gb:.1f} GB free ({used/gb:.1f} GB used of {total/gb:.1f} GB)")

# ── Data dirs ─────────────────────────────────────────────────────────────────
st.subheader("4. Data Directories")
from core.config import UPLOAD_DIR, RESULT_DIR, CONFIG_DIR, DB_PATH
dirs = {
    "Uploads": UPLOAD_DIR,
    "Results": RESULT_DIR,
    "Configs": CONFIG_DIR,
}
for label, d in dirs.items():
    try:
        d.mkdir(parents=True, exist_ok=True)
        st.success(f"✅ {label}: `{d}`")
    except Exception as e:
        st.error(f"❌ {label} ({d}): {e}")

st.success(f"✅ Database: `{DB_PATH}`") if DB_PATH.exists() else st.info(f"ℹ️ DB will be created on first run: `{DB_PATH}`")

# ── Camera / OpenCV ───────────────────────────────────────────────────────────
st.subheader("5. OpenCV Build Info")
import cv2
build = cv2.getBuildInformation()
ffmpeg_ok = "FFMPEG" in build and "YES" in build[build.find("FFMPEG"):build.find("FFMPEG")+30]
st.caption(f"OpenCV {cv2.__version__}")
if "FFMPEG" in build:
    st.success("✅ FFMPEG support — can read most video formats")
else:
    st.warning("⚠️ No FFMPEG — some video formats may not open")

# ── Quick self-test ───────────────────────────────────────────────────────────
st.subheader("6. Quick Processing Test")
if st.button("▶️ Run 5-second synthetic test", type="primary"):
    with st.spinner("Testing…"):
        try:
            import numpy as np, cv2, time
            from core.preprocessing import enhance_frame, frame_quality_score
            from core.analytics.people_counter import PeopleCounter

            # Synthetic 640x480 grey frame
            frame = np.random.randint(40,80,(480,640,3),dtype=np.uint8)
            t0=time.time()
            enhanced=enhance_frame(frame,"always")
            q=frame_quality_score(frame)
            pc=PeopleCounter([{"line_id":"t1","label":"Test","p1":[0.5,0.0],
                                "p2":[0.5,1.0],"entry_side":-1}],3,640,480)
            import numpy as np
            pc.update(0, 0.0, np.array([[320.0, 240.0]]), [1])
            elapsed=time.time()-t0
            st.success(f"✅ All subsystems OK — {elapsed*1000:.0f}ms")
        except Exception as e:
            st.error(f"❌ Test failed: {e}")

st.divider()
st.info(
    "**Setup checklist before first sale:**\n"
    "1. ✅ All Python deps installed\n"
    "2. ✅ yolov8n.pt and yolov8s.pt downloaded\n"
    "3. ✅ >5GB free disk\n"
    "4. ✅ Bar layout config created (⚙️ Bar Layout)\n"
    "5. ✅ At least one shift saved (🔑 Shift Setup)\n"
    "6. ✅ Test clip processed successfully"
)
