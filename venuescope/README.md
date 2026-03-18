# VenueScope

Venue intelligence platform for bars and restaurants.
Runs entirely on a Raspberry Pi 5. No cloud. No faces. No PII.

## 5 Analysis Modes

| Mode | Camera | What it measures |
|------|--------|-----------------|
| 🍺 Drink Count | Bar overhead | Per-bartender drink counts, CV vs POS theft signal |
| 🚶 People Count | Entrance / dining | Entries, exits, occupancy curve, peak hours |
| 🪑 Table Turns | Dining floor | Table occupancy, turn times, dwell time |
| 👷 Staff Activity | Any camera | Headcount, idle time %, activity scoring |
| 🔒 After Hours | Storage / back bar | Motion alerts, access log, person detections |

## Workflow

1. Download a clip from your DVR
2. Go to **▶️ Run Analysis**
3. Upload the clip
4. Pick what to analyze
5. Configure and run
6. View results in **📊 Results** or **🏠 Dashboard**

## One-time setup (Drink Count only)

1. **⚙️ Bar Layout** — draw station zones and bar-front lines on overhead frame
2. **🔑 Shift Setup** — assign bartender names to station zones

## Start

```bash
cd /home/pi/venuescope
source ../venv/bin/activate
PYTHONPATH=/home/pi/venuescope streamlit run app/main.py
```

SSH tunnel from Mac:
```bash
ssh -L 8501:127.0.0.1:8501 pi@192.168.1.230
```

Then open: http://localhost:8501
