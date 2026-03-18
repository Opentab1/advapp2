"""
VenueScope — SQLite job store.
Fixed: empty update() calls, proper column handling.
"""
from __future__ import annotations
import json, time, shutil
from pathlib import Path
from typing import Optional, Dict, Any
from sqlalchemy import (
    create_engine, MetaData, Table, Column,
    String, Float, Text, Boolean,
    select, insert, text
)
from core.config import DB_PATH, CONFIG_DIR

_engine = None
_meta   = MetaData()

jobs_table = Table("jobs", _meta,
    Column("job_id",        String,  primary_key=True),
    Column("analysis_mode", String,  nullable=False, default="drink_count"),
    Column("shift_id",      String,  nullable=True),
    Column("shift_json",    Text,    nullable=True),
    Column("source_type",   String,  nullable=False),
    Column("source_path",   String,  nullable=False),
    Column("model_profile", String,  nullable=False, default="fast"),
    Column("config_path",   String,  nullable=True),
    Column("status",        String,  nullable=False, default="pending"),
    Column("progress",      Float,   nullable=False, default=0.0),
    Column("created_at",    Float,   nullable=False),
    Column("finished_at",   Float,   nullable=True),
    Column("error_msg",     Text,    nullable=True),
    Column("result_dir",    String,  nullable=True),
    Column("annotate",      Boolean, nullable=False, default=False),
    Column("summary_json",  Text,    nullable=True),
    Column("clip_label",    String,  nullable=True),
)


def get_engine():
    global _engine
    if _engine is None:
        _engine = create_engine(
            f"sqlite:///{DB_PATH}", echo=False,
            connect_args={"check_same_thread": False}
        )
        _meta.create_all(_engine)
    return _engine


def _raw_update(job_id: str, **kw):
    """Raw SQL update — avoids SQLAlchemy ORM quirks with dynamic columns."""
    if not kw:
        return
    engine = get_engine()
    sets   = ", ".join(f"{k} = :{k}" for k in kw)
    kw["_job_id"] = job_id
    with engine.begin() as c:
        c.execute(text(f"UPDATE jobs SET {sets} WHERE job_id = :_job_id"), kw)


def create_job(job_id: str, analysis_mode: str, shift_id: Optional[str],
               shift_json: Optional[str], source_type: str, source_path: str,
               model_profile: str, config_path: Optional[str],
               annotate: bool, clip_label: str = "") -> None:
    with get_engine().begin() as c:
        c.execute(insert(jobs_table).values(
            job_id=job_id,
            analysis_mode=analysis_mode,
            shift_id=shift_id,
            shift_json=shift_json,
            source_type=source_type,
            source_path=source_path,
            model_profile=model_profile,
            config_path=config_path,
            status="pending",
            progress=0.0,
            created_at=time.time(),
            annotate=annotate,
            clip_label=clip_label,
        ))


def get_job(job_id: str) -> Optional[Dict]:
    with get_engine().connect() as c:
        row = c.execute(
            select(jobs_table).where(jobs_table.c.job_id == job_id)
        ).mappings().first()
    return dict(row) if row else None


def list_jobs(limit: int = 50) -> list:
    with get_engine().connect() as c:
        rows = c.execute(
            select(jobs_table)
            .order_by(jobs_table.c.created_at.desc())
            .limit(limit)
        ).mappings().all()
    return [dict(r) for r in rows]


def set_running(job_id):
    _raw_update(job_id, status="running")

def set_progress(job_id, p):
    _raw_update(job_id, progress=min(float(p), 99.9))

def set_done(job_id, rdir, summary):
    _raw_update(job_id,
                status="done",
                progress=100.0,
                finished_at=time.time(),
                result_dir=str(rdir),
                summary_json=json.dumps(summary))

def set_failed(job_id, err):
    _raw_update(job_id,
                status="failed",
                finished_at=time.time(),
                error_msg=str(err))

def update_shift_json(job_id: str, shift_json: str):
    _raw_update(job_id, shift_json=shift_json)


# ── Shift management ────────────────────────────────────────────────────────
shifts_table = Table("shifts", _meta,
    Column("shift_id",   String, primary_key=True),
    Column("shift_name", String, nullable=False),
    Column("created_at", Float,  nullable=False),
    Column("bartenders", Text,   nullable=False),
    Column("notes",      Text,   nullable=True),
)


def save_shift(shift_id: str, shift_name: str, bartenders: list, notes: str = "") -> None:
    engine = get_engine()
    with engine.begin() as c:
        existing = c.execute(
            select(shifts_table).where(shifts_table.c.shift_id == shift_id)
        ).mappings().first()
        if existing:
            c.execute(text(
                "UPDATE shifts SET shift_name=:n, bartenders=:b, notes=:no "
                "WHERE shift_id=:id"
            ), {"n": shift_name, "b": json.dumps(bartenders),
                "no": notes, "id": shift_id})
        else:
            c.execute(insert(shifts_table).values(
                shift_id=shift_id, shift_name=shift_name,
                bartenders=json.dumps(bartenders),
                notes=notes, created_at=time.time()
            ))


def get_shift(shift_id: str) -> Optional[Dict]:
    with get_engine().connect() as c:
        row = c.execute(
            select(shifts_table).where(shifts_table.c.shift_id == shift_id)
        ).mappings().first()
    if not row:
        return None
    d = dict(row)
    d["bartenders"] = json.loads(d["bartenders"])
    return d


def list_shifts(limit: int = 20) -> list:
    with get_engine().connect() as c:
        rows = c.execute(
            select(shifts_table)
            .order_by(shifts_table.c.created_at.desc())
            .limit(limit)
        ).mappings().all()
    result = []
    for r in rows:
        d = dict(r)
        d["bartenders"] = json.loads(d["bartenders"])
        result.append(d)
    return result


def delete_job(job_id: str) -> bool:
    """Delete a job record and its result directory. Returns True on success."""
    job = get_job(job_id)
    if not job:
        return False
    # Remove result dir
    rdir = job.get("result_dir")
    if rdir:
        try:
            shutil.rmtree(rdir, ignore_errors=True)
        except Exception:
            pass
    # Remove source file if still exists
    src = job.get("source_path")
    if src:
        try:
            Path(src).unlink(missing_ok=True)
            # also try parent dir if it's a job-specific upload folder
            p = Path(src).parent
            if p != Path(src) and not any(p.iterdir()):
                p.rmdir()
        except Exception:
            pass
    with get_engine().begin() as c:
        c.execute(text("DELETE FROM jobs WHERE job_id = :id"), {"id": job_id})
    return True


def retry_job(job_id: str) -> bool:
    """Reset a failed job back to pending so it can be resubmitted."""
    job = get_job(job_id)
    if not job or job.get("status") not in ("failed",):
        return False
    _raw_update(job_id,
                status="pending",
                progress=0.0,
                error_msg=None,
                finished_at=None)
    return True


def list_jobs_filtered(limit: int = 200,
                       date_str: str = None,
                       mode: str = None) -> list:
    """
    List jobs with optional filters.
    date_str: 'YYYY-MM-DD' — filter to jobs created on that date (local time)
    mode: analysis_mode string
    """
    import time as _time
    from datetime import datetime, timedelta

    all_jobs = []
    with get_engine().connect() as c:
        rows = c.execute(
            select(jobs_table)
            .order_by(jobs_table.c.created_at.desc())
            .limit(limit)
        ).mappings().all()
        all_jobs = [dict(r) for r in rows]

    if date_str:
        try:
            day_start = datetime.strptime(date_str, "%Y-%m-%d")
            day_end   = day_start + timedelta(days=1)
            ts_start  = day_start.timestamp()
            ts_end    = day_end.timestamp()
            all_jobs  = [j for j in all_jobs
                         if ts_start <= (j.get("created_at") or 0) < ts_end]
        except ValueError:
            pass

    if mode:
        all_jobs = [j for j in all_jobs if j.get("analysis_mode") == mode]

    return all_jobs


def export_configs() -> dict:
    """Export all bar configs and shifts as a single JSON blob for backup."""
    configs = {}
    for p in CONFIG_DIR.glob("*.json"):
        try:
            configs[p.stem] = json.loads(p.read_text())
        except Exception:
            pass
    shifts = list_shifts(200)
    return {"bar_configs": configs, "shifts": shifts,
            "exported_at": __import__("time").time()}


def import_configs(data: dict) -> tuple:
    """Import bar configs and shifts from a backup blob. Returns (n_configs, n_shifts)."""
    n_cfg = n_shift = 0
    for name, cfg_data in data.get("bar_configs", {}).items():
        try:
            p = CONFIG_DIR / f"{name}.json"
            p.write_text(json.dumps(cfg_data, indent=2))
            n_cfg += 1
        except Exception:
            pass
    for s in data.get("shifts", []):
        try:
            save_shift(s["shift_id"], s["shift_name"],
                       s["bartenders"], s.get("notes", ""))
            n_shift += 1
        except Exception:
            pass
    return n_cfg, n_shift


# ── Camera registry ──────────────────────────────────────────────────────────
cameras_table = Table("cameras", _meta,
    Column("camera_id",   String, primary_key=True),
    Column("name",        String, nullable=False),
    Column("rtsp_url",    String, nullable=False),
    Column("mode",        String, nullable=False, default="drink_count"),
    Column("config_path", String, nullable=True),
    Column("shift_id",    String, nullable=True),
    Column("model_profile", String, nullable=False, default="balanced"),
    Column("segment_seconds", Float, nullable=False, default=300.0),
    Column("enabled",     Boolean, nullable=False, default=True),
    Column("created_at",  Float, nullable=False),
    Column("notes",       Text, nullable=True),
)


def save_camera(camera_id: str, name: str, rtsp_url: str, mode: str,
                config_path: str = None, shift_id: str = None,
                model_profile: str = "balanced", segment_seconds: float = 300.0,
                enabled: bool = True, notes: str = "") -> None:
    engine = get_engine()
    with engine.begin() as c:
        existing = c.execute(
            select(cameras_table).where(cameras_table.c.camera_id == camera_id)
        ).mappings().first()
        if existing:
            c.execute(text(
                "UPDATE cameras SET name=:name, rtsp_url=:url, mode=:mode, "
                "config_path=:cp, shift_id=:sid, model_profile=:mp, "
                "segment_seconds=:seg, enabled=:en, notes=:no "
                "WHERE camera_id=:id"
            ), {"name": name, "url": rtsp_url, "mode": mode, "cp": config_path,
                "sid": shift_id, "mp": model_profile, "seg": segment_seconds,
                "en": enabled, "no": notes, "id": camera_id})
        else:
            c.execute(insert(cameras_table).values(
                camera_id=camera_id, name=name, rtsp_url=rtsp_url, mode=mode,
                config_path=config_path, shift_id=shift_id,
                model_profile=model_profile, segment_seconds=segment_seconds,
                enabled=enabled, notes=notes, created_at=time.time(),
            ))


def list_cameras() -> list:
    with get_engine().connect() as c:
        rows = c.execute(
            select(cameras_table).order_by(cameras_table.c.created_at.asc())
        ).mappings().all()
    return [dict(r) for r in rows]


def get_camera(camera_id: str) -> Optional[Dict]:
    with get_engine().connect() as c:
        row = c.execute(
            select(cameras_table).where(cameras_table.c.camera_id == camera_id)
        ).mappings().first()
    return dict(row) if row else None


def delete_camera(camera_id: str) -> bool:
    with get_engine().begin() as c:
        c.execute(text("DELETE FROM cameras WHERE camera_id = :id"), {"id": camera_id})
    return True


# ── Retention / cleanup ──────────────────────────────────────────────────────
def cleanup_old_results(retention_days: int) -> int:
    """
    Delete jobs (and their result directories) older than retention_days.
    Returns number of jobs deleted.
    """
    if retention_days <= 0:
        return 0
    import time as _time
    cutoff = _time.time() - retention_days * 86400
    with get_engine().connect() as c:
        rows = c.execute(
            select(jobs_table)
            .where(jobs_table.c.created_at < cutoff)
            .where(jobs_table.c.status.in_(["done", "failed"]))
        ).mappings().all()
    jobs_to_delete = [dict(r) for r in rows]
    deleted = 0
    for job in jobs_to_delete:
        try:
            delete_job(job["job_id"])
            deleted += 1
        except Exception:
            pass
    return deleted


def get_preferences() -> dict:
    """Load venue preferences from data/configs/preferences.json."""
    pref_file = CONFIG_DIR / "preferences.json"
    if not pref_file.exists():
        return {}
    try:
        return json.loads(pref_file.read_text())
    except Exception:
        return {}


def save_preferences(data: dict) -> None:
    """Save venue preferences to data/configs/preferences.json."""
    pref_file = CONFIG_DIR / "preferences.json"
    existing = get_preferences()
    existing.update(data)
    pref_file.write_text(json.dumps(existing, indent=2))
