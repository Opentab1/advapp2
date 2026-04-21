"""
lightweight_runner.py — YOLO-sparse occupancy estimator for people_count mode.

2026-04-21 rewrite: replaces the previous MOG2 background-subtraction approach.

Why the rewrite:
  MOG2 was CPU-cheap but accuracy-lethal for bar environments — low lighting,
  people who linger at the bar become "background" after a few seconds, and
  the 8-second warmup eats most of each 15-second segment. Every job on Blind
  Goat was reporting peak_occupancy=0 despite real people in frame.

New approach:
  Sparse YOLO sampling. Grab one frame every SAMPLE_INTERVAL_SEC seconds,
  run yolov8n person detection on it, count detections. Over a 15s job:
    - 3 samples × ~100ms per yolov8n inference on CPU = ~300ms CPU per job
    - Comparable to the old dense-MOG2 cost (~150ms/job)
    - Dramatically higher accuracy — YOLO reliably detects people at conf≥0.25
      on the lit-or-dim bar frames we verified

CPU math on the 4-vCPU droplet:
  11 people_count cameras × 1 sample per 5s = 2.2 inferences/sec
  ≈ 22% of one core sustained (fits comfortably alongside drink_count continuous
  jobs that currently pin ~2 cores).

RAM: model is fork-COW'd from the parent (same as drink_count), so per-job
memory overhead is minimal — the YOLO weights are shared.

Interface is preserved — same summary shape, same callback signatures,
compatible with aws_sync.push logic expecting `people.peak_occupancy`.
"""
from __future__ import annotations
import time, logging, os
from pathlib import Path
from typing import Callable

log = logging.getLogger("lightweight_runner")

# ── Tuning ────────────────────────────────────────────────────────────────────
# How often to sample + run YOLO. 5s is a good default — catches transient
# peaks (bar fills briefly after last call) without chewing too much CPU.
# Override per-camera via extra_config["sample_interval_sec"] or env
# VENUESCOPE_LIGHTWEIGHT_SAMPLE_SEC.
DEFAULT_SAMPLE_SEC = float(os.environ.get("VENUESCOPE_LIGHTWEIGHT_SAMPLE_SEC", "5.0"))

# Confidence floor for person detection. Drop to 0.20 for IR / low-light cams
# if you see undercounting; raise to 0.30 to suppress false positives in
# high-clutter rooms.
DEFAULT_CONF      = float(os.environ.get("VENUESCOPE_LIGHTWEIGHT_CONF", "0.25"))

# YOLO input resolution. 480 is plenty for person detection at bar-camera
# distances. Smaller = faster inference. Override via extra_config["imgsz"].
DEFAULT_IMGSZ     = int(os.environ.get("VENUESCOPE_LIGHTWEIGHT_IMGSZ", "480"))

# Default model (nano = fastest). Override via extra_config["model"] if you
# need higher recall at low light — yolov8s is ~2x slower but ~5% better mAP.
DEFAULT_MODEL     = os.environ.get("VENUESCOPE_LIGHTWEIGHT_MODEL", "yolov8n.pt")

# Live callback frequency (continuous mode)
LIVE_CB_EVERY     = 30        # seconds between live_cb() calls

# Person class index in COCO
PERSON_CLS        = 0


def run_lightweight(
    job: dict,
    extra_config: dict,
    result_dir: Path,
    progress_cb: Callable,
    live_cb: Callable,
    is_continuous: bool,
) -> dict:
    """
    Drop-in replacement for VenueProcessor.run() for people_count mode.
    Returns a summary dict compatible with the existing pipeline.
    """
    import cv2

    source      = job["source_path"]
    job_id      = job["job_id"]
    clip_label  = job.get("clip_label", "")
    max_seconds = float(extra_config.get("max_seconds", 0))

    sample_sec  = float(extra_config.get("sample_interval_sec", DEFAULT_SAMPLE_SEC))
    conf_thresh = float(extra_config.get("conf", DEFAULT_CONF))
    imgsz       = int(extra_config.get("imgsz", DEFAULT_IMGSZ))
    model_name  = str(extra_config.get("model", DEFAULT_MODEL))

    log.info(f"[lightweight] Opening stream: {Path(source).name}  "
             f"sample={sample_sec:.0f}s model={model_name} imgsz={imgsz}")

    # Load YOLO via the shared loader so fork-COW works + device selection is
    # consistent with the main engine. On a CPU-only droplet this returns a
    # CPU model; on a laptop it picks MPS / CUDA.
    from core.tracking.engine import _load_yolo
    model = _load_yolo(model_name)

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open source: {source}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 15.0
    fps = max(1.0, min(fps, 60.0))
    sample_every_frames = max(1, int(round(sample_sec * fps)))

    frame_idx       = 0
    t_sec           = 0.0
    last_sample_fr  = -sample_every_frames   # fire on first frame
    frame_estimates: list[int] = []
    occupancy_log:   list      = []
    _last_live_cb   = time.time()
    _start_wall     = time.time()
    consecutive_read_failures = 0

    progress_cb(5, f"Stream opened — sparse YOLO every {sample_sec:.0f}s")

    try:
        while True:
            # For non-sample frames: grab() without decode — 10-50x faster.
            # Every Nth frame we do read() + inference.
            need_sample = (frame_idx - last_sample_fr) >= sample_every_frames
            if need_sample:
                ret, frame = cap.read()
            else:
                ret  = cap.grab()
                frame = None

            if not ret:
                consecutive_read_failures += 1
                if is_continuous and consecutive_read_failures < 5:
                    time.sleep(0.5)
                    continue
                else:
                    log.warning(f"[lightweight] stream ended for job {job_id}")
                    break
            consecutive_read_failures = 0

            frame_idx += 1
            t_sec = frame_idx / fps
            if max_seconds > 0 and t_sec >= max_seconds:
                break

            if not need_sample or frame is None:
                continue

            # ── YOLO inference on the sampled frame ────────────────────────
            last_sample_fr = frame_idx
            try:
                results = model.predict(
                    frame,
                    classes=[PERSON_CLS],
                    conf=conf_thresh,
                    imgsz=imgsz,
                    verbose=False,
                )
                r = results[0] if results else None
                n_people = int(len(r.boxes)) if (r and r.boxes is not None) else 0
            except Exception as e:
                log.warning(f"[lightweight] inference failed at t={t_sec:.1f}s: {e}")
                n_people = 0

            frame_estimates.append(n_people)
            occupancy_log.append((round(t_sec, 1), n_people))

            # ── Progress / live callback ───────────────────────────────────
            if not is_continuous and max_seconds > 0:
                pct = min(95, int((t_sec / max_seconds) * 100))
                progress_cb(pct, f"t={int(t_sec)}s  headcount≈{n_people}")

            if is_continuous:
                now = time.time()
                if now - _last_live_cb >= LIVE_CB_EVERY:
                    partial = _build_summary(frame_estimates, occupancy_log, t_sec)
                    partial["clip_label"]    = clip_label
                    partial["analysis_mode"] = "people_count"
                    try:
                        live_cb(partial, now - _start_wall)
                    except Exception as e:
                        log.debug(f"[lightweight] live_cb error: {e}")
                    _last_live_cb = now
    finally:
        cap.release()

    progress_cb(98, "Finalising occupancy report")
    summary = _build_summary(frame_estimates, occupancy_log, t_sec)
    summary["clip_label"]    = clip_label
    summary["analysis_mode"] = "people_count"

    peak = summary["people"]["peak_occupancy"]
    avg  = summary["people"].get("avg_occupancy", 0)
    log.info(
        f"[lightweight] Done — peak={peak} avg={avg} "
        f"samples={len(frame_estimates)} duration={t_sec:.0f}s model={model_name}"
    )
    return summary


def _median(values: list[int]) -> int:
    if not values: return 0
    s = sorted(values); n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) // 2


def _percentile(values: list[int], pct: float) -> int:
    if not values: return 0
    s = sorted(values)
    idx = max(0, min(len(s) - 1, int(round(len(s) * pct))))
    return s[idx]


def _build_summary(
    frame_estimates: list[int],
    occupancy_log: list,
    total_sec: float,
) -> dict:
    """
    Build summary from per-sample people counts.

    peak_occupancy = 75th-percentile sample (suppresses single-frame spikes)
    avg_occupancy  = median sample (robust central tendency)

    total_entries / total_exits are intentionally 0 — room-based cameras
    don't count doorway crossings; use a dedicated counting-line camera if
    entry/exit accounting is required.
    """
    if frame_estimates:
        avg_occ  = _median(frame_estimates)
        # Peak = max of samples. Was 75th percentile but that was undercounting
        # real peaks at sparse sample rates (verified via manual YOLO check
        # showing 11 people in frame when 75th percentile of 4 samples said 7).
        # Single outlier frames are acceptable — sparse YOLO is already robust
        # to per-frame noise because each inference uses confidence≥0.25.
        peak_occ = max(frame_estimates)
    else:
        peak_occ = avg_occ = 0

    return {
        "mode":          "people_count",
        "video_seconds": round(total_sec, 1),
        "quality":       "good",
        "people": {
            "total_entries":      0,
            "total_exits":        0,
            "net_occupancy":      avg_occ,
            "peak_occupancy":     peak_occ,
            "avg_occupancy":      avg_occ,
            "unique_tracks_seen": sum(frame_estimates),  # rough proxy, no tracker
            "peak_entry_hour":    0,
            "hourly_entries":     {},
            "hourly_exits":       {},
            "per_line":           {},
        },
        "occupancy_log":  occupancy_log,
        "total_drinks":   0,
        "unrung_drinks":  0,
        "hasTheftFlag":   False,
    }
