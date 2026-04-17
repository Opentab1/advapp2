#!/usr/bin/env python3
"""
VenueScope — Demo data seeder.
Run this ONCE before a demo to populate the DB with realistic jobs.

Usage:
    cd venuescope
    python3 seed_demo.py
"""
import json, time, uuid, sys, os, random
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
os.environ.setdefault("YOLO_TELEMETRY", "False")

from core.database import create_job, _raw_update, get_engine
from sqlalchemy import text

NOW = time.time()
HOUR = 3600

def _job(label, mode, minutes_ago, total_drinks=0, unrung=0, bartenders=None,
         people_in=0, people_out=0, avg_response=None, confidence=82,
         has_theft=False, model="balanced"):
    jid = str(uuid.uuid4())[:8]
    created = NOW - minutes_ago * 60
    bts = bartenders or {}

    # Build summary
    if mode == "drink_count":
        bt_summary = {}
        for name, drinks in bts.items():
            timestamps = sorted([created - random.uniform(0, 3600) for _ in range(drinks)])
            bt_summary[name] = {
                "total_drinks":    drinks,
                "unrung_drinks":   unrung if name == list(bts.keys())[0] else 0,
                "drinks_per_hour": round(drinks / max((NOW - created) / 3600, 0.1), 1),
                "drink_timestamps": timestamps,
            }
        summary = {
            "mode":             "drink_count",
            "video_seconds":    3600.0,
            "total_drinks":     total_drinks,
            "unrung_drinks":    unrung,
            "has_theft_flag":   has_theft,
            "top_bartender":    list(bts.keys())[0] if bts else "Unknown",
            "drinks_per_hour":  round(total_drinks / 1.0, 1),
            "confidence_score": confidence,
            "confidence_label": "High" if confidence > 75 else "Medium" if confidence > 50 else "Low",
            "confidence_color": "green" if confidence > 75 else "yellow" if confidence > 50 else "red",
            "bartenders":       bt_summary,
            "analysis_mode":    "drink_count",
            "clip_label":       label,
            "created_at":       created,
            "quality":          {"avg_detection_conf": 0.71, "warnings": []},
            "drink_quality":    {"review_count": 2 if unrung > 0 else 0},
            "review_events":    [],
            "camera_angle":     {"angle": "overhead", "confidence": 0.81},
        }
    elif mode == "people_count":
        summary = {
            "mode":          "people_count",
            "video_seconds": 3600.0,
            "people":        {
                "entrance_1": {
                    "label":     "Main Entrance",
                    "in_count":  people_in,
                    "out_count": people_out,
                    "net":       people_in - people_out,
                }
            },
            "analysis_mode": "people_count",
            "clip_label":    label,
            "created_at":    created,
            "quality":       {"avg_detection_conf": 0.74, "warnings": []},
        }
    elif mode == "table_turns":
        summary = {
            "mode":          "table_turns",
            "video_seconds": 3600.0,
            "tables":        {
                "table_1": {
                    "label":           "Table 1",
                    "total_sessions":  3,
                    "avg_dwell_sec":   2400,
                    "avg_response_sec": avg_response or 145,
                    "max_response_sec": (avg_response or 145) + 60,
                },
                "table_2": {
                    "label":           "Table 2",
                    "total_sessions":  2,
                    "avg_dwell_sec":   1800,
                    "avg_response_sec": (avg_response or 145) - 20,
                    "max_response_sec": (avg_response or 145) + 30,
                },
            },
            "analysis_mode": "table_turns",
            "clip_label":    label,
            "created_at":    created,
            "quality":       {"avg_detection_conf": 0.68, "warnings": []},
        }
    else:
        summary = {}

    create_job(
        job_id=jid, analysis_mode=mode, shift_id=None, shift_json=None,
        source_type="file", source_path=f"/demo/{jid}.mp4",
        model_profile=model, config_path=None, annotate=False,
        clip_label=label,
    )

    with get_engine().begin() as c:
        c.execute(text(
            "UPDATE jobs SET status='done', progress=100, "
            "created_at=:ca, finished_at=:fa, "
            "summary_json=:sj, result_dir=:rd "
            "WHERE job_id=:jid"
        ), {
            "ca":  created,
            "fa":  created + 3800,
            "sj":  json.dumps(summary),
            "rd":  f"/tmp/venuescope_results/{jid}",
            "jid": jid,
        })

    return jid


print("Seeding demo data...")

# Shift 1: Last night (6pm–2am) — theft flag: Jordan 4 unrung drinks 11:18–11:31 PM
_job("Main Bar — Last Night (6PM–2AM)", "drink_count", minutes_ago=600,
     total_drinks=162, unrung=4, confidence=87,
     bartenders={"Marcus": 91, "Priya": 67, "Jordan": 4}, has_theft=True)

_job("Entrance — Last Night", "people_count", minutes_ago=590,
     people_in=312, people_out=265)

_job("Floor Tables — Last Night", "table_turns", minutes_ago=585,
     avg_response=98)

# Shift 2: Tonight (6pm–now) — active, clean so far
_job("Main Bar — Tonight (6PM–)", "drink_count", minutes_ago=180,
     total_drinks=94, unrung=0, confidence=84,
     bartenders={"Marcus": 55, "Priya": 39}, has_theft=False)

_job("Entrance — Tonight", "people_count", minutes_ago=175,
     people_in=187, people_out=134)

_job("Floor Tables — Tonight", "table_turns", minutes_ago=170,
     avg_response=112)

# Shift 3: Two nights ago — clean night
_job("Main Bar — Two Nights Ago", "drink_count", minutes_ago=2400,
     total_drinks=148, unrung=0, confidence=91,
     bartenders={"Marcus": 89, "Jordan": 59}, has_theft=False)

# Recent RTSP segment (simulates live camera)
_job("📡 Bar Camera — seg 14", "drink_count", minutes_ago=12,
     total_drinks=8, unrung=0, confidence=83,
     bartenders={"Marcus": 5, "Priya": 3}, has_theft=False, model="fast")

_job("📡 Entrance Camera — seg 14", "people_count", minutes_ago=11,
     people_in=23, people_out=18)

print("✅ Demo data seeded — 9 jobs created.")
print("   Run: streamlit run app/main.py")
