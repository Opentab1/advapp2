"""
VenueScope — Bar layout auto-calibration.

Single YOLO+ByteTrack pass that simultaneously scores every
(bar_line_y, customer_side) combination. Much faster than running the
full VenueProcessor 16 times. Upload a 5-10 min clip with known drink
count, get the best bar line config written automatically.
"""
from __future__ import annotations
import os, json, logging, time
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Callable

log = logging.getLogger("calibrate")

# ── Sweep parameters ──────────────────────────────────────────────────────────
Y_POSITIONS    = [0.33, 0.36, 0.39, 0.42, 0.45, 0.48, 0.51, 0.54]
CUSTOMER_SIDES = [+1, -1]  # +1 = customers below line (higher Y), -1 = above line

# Processing settings — maximise speed on 1-vCPU droplet
CALIB_MODEL    = "yolov8n.pt"
CALIB_IMGSZ    = 480
CALIB_CONF     = 0.35
CALIB_IOU      = 0.45
CALIB_STRIDE   = 3           # process every 3rd frame
CALIB_MAX_SEC  = 300.0       # cap at 5 min regardless of clip length

# Cooldown: min frames between counted crossings per (combo, track_id).
# effective_fps ≈ 25/3 ≈ 8; 40 frames ≈ 5 s cooldown.
COOLDOWN_FRAMES = 40
DEAD_ZONE_NORM  = 0.03       # normalised-Y band around bar line — ignore jitter crossings


class CalibrationEngine:
    """
    Run one YOLO pass, score all bar-line configurations simultaneously.
    Call run() — it blocks until complete and returns a results dict.
    """

    def __init__(
        self,
        video_path:   str,
        actual_count: int,
        venue_id:     str,
        camera_id:    str = "",
        y_positions:  Optional[List[float]] = None,
        progress_cb:  Optional[Callable[[float, str], None]] = None,
    ):
        self.video_path   = str(video_path)
        self.actual_count = actual_count
        self.venue_id     = venue_id
        self.camera_id    = camera_id  # specific camera this clip came from
        self.y_positions  = y_positions or Y_POSITIONS
        self.cb           = progress_cb or (lambda p, m: None)

        # Per-combo state: last known side, cooldown, total count
        # key = (y_idx, side_idx)
        self._last_side: Dict[Tuple, Dict[int, int]] = {}
        self._cooldown:  Dict[Tuple, Dict[int, int]] = {}
        self._counts:    Dict[Tuple, int]            = {}

        for yi in range(len(self.y_positions)):
            for si in range(len(CUSTOMER_SIDES)):
                k = (yi, si)
                self._last_side[k] = {}
                self._cooldown[k]  = {}
                self._counts[k]    = 0

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _side_of(self, norm_y: float, y_pos: float, customer_side: int) -> int:
        """Return +1 (customer side) or -1 (bartender side)."""
        if customer_side == +1:
            return +1 if norm_y > y_pos else -1
        else:
            return +1 if norm_y < y_pos else -1

    def _score_frame(self, track_ids, centroids_norm_y, frame_rel: int):
        """Update all combo counters for one frame of person detections."""
        import numpy as np  # already imported via ultralytics at this point

        for ti, track_id in enumerate(track_ids):
            ny = centroids_norm_y[ti]

            for yi, y_pos in enumerate(self.y_positions):
                for si, customer_side in enumerate(CUSTOMER_SIDES):
                    k = (yi, si)
                    current_side = self._side_of(ny, y_pos, customer_side)

                    # Decay cooldown
                    cd = self._cooldown[k]
                    if track_id in cd and cd[track_id] > 0:
                        cd[track_id] -= 1

                    prev_side = self._last_side[k].get(track_id)
                    self._last_side[k][track_id] = current_side

                    if prev_side is None:
                        continue

                    # Count serve: bartender side → customer side crossing
                    if prev_side == -1 and current_side == +1:
                        # Skip jitter near the line
                        dist = abs(ny - y_pos)
                        if dist < DEAD_ZONE_NORM:
                            continue
                        # Skip cooldown
                        if cd.get(track_id, 0) > 0:
                            continue
                        self._counts[k] += 1
                        cd[track_id] = COOLDOWN_FRAMES

    # ── Main run ─────────────────────────────────────────────────────────────

    def run(self) -> Dict:
        """
        Execute calibration sweep. Returns dict with per-combo results and
        the best-match bar config (already written to disk).
        """
        os.environ.setdefault("YOLO_TELEMETRY", "False")
        import cv2
        import numpy as np
        from ultralytics import YOLO

        self.cb(2, "Loading YOLO model…")
        model = YOLO(CALIB_MODEL)

        self.cb(5, "Opening video…")
        cap = cv2.VideoCapture(self.video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video: {self.video_path}")

        fps     = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_f = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or -1
        W       = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        H       = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        max_frames = int(CALIB_MAX_SEC * fps)
        if total_f > 0:
            max_frames = min(max_frames, total_f)

        self.cb(8, f"Video: {W}×{H} @{fps:.1f}fps — scanning up to {min(CALIB_MAX_SEC, total_f/fps if total_f>0 else CALIB_MAX_SEC):.0f}s")

        frame_idx  = 0
        proc_count = 0
        t_start    = time.time()

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            frame_idx += 1
            if frame_idx > max_frames:
                break
            if frame_idx % CALIB_STRIDE != 0:
                continue

            # Progress update every ~5 seconds of video
            if proc_count % 40 == 0 and proc_count > 0:
                pct     = 8 + 82 * min(frame_idx / max(max_frames, 1), 1.0)
                elapsed = time.time() - t_start
                remain  = elapsed / proc_count * (max_frames / CALIB_STRIDE - proc_count)
                self.cb(pct, f"Frame {frame_idx}/{max_frames} — ETA {max(0, remain):.0f}s")

            # YOLO + ByteTrack
            res = model.track(
                frame,
                imgsz   = CALIB_IMGSZ,
                conf    = CALIB_CONF,
                iou     = CALIB_IOU,
                classes = [0],       # person only
                persist = True,
                verbose = False,
                tracker = "bytetrack.yaml",
            )
            proc_count += 1

            if not res or res[0].boxes is None:
                continue
            boxes = res[0].boxes
            if boxes.id is None:
                continue

            xyxy      = boxes.xyxy.cpu().numpy()
            track_ids = boxes.id.cpu().numpy().astype(int)
            cy_vals   = ((xyxy[:, 1] + xyxy[:, 3]) / 2) / H  # normalised Y centroids

            self._score_frame(track_ids, cy_vals, frame_idx)

        cap.release()

        self.cb(92, "Ranking configurations…")
        return self._build_results(fps, frame_idx)

    # ── Result building ───────────────────────────────────────────────────────

    def _build_results(self, fps: float, last_frame: int) -> Dict:
        rows = []
        for yi, y_pos in enumerate(self.y_positions):
            for si, customer_side in enumerate(CUSTOMER_SIDES):
                k        = (yi, si)
                detected = self._counts[k]
                err      = abs(detected - self.actual_count)
                pct_err  = err / max(self.actual_count, 1) * 100
                accuracy = max(0.0, round(100.0 - pct_err, 1))
                rows.append({
                    "y_position":    round(y_pos, 2),
                    "customer_side": customer_side,
                    "detected":      detected,
                    "actual":        self.actual_count,
                    "error":         err,
                    "accuracy_pct":  accuracy,
                })

        rows.sort(key=lambda r: (r["error"], -r["accuracy_pct"]))
        best = rows[0] if rows else None

        bar_config_path = None
        if best:
            bar_config_path = self._write_bar_config(
                best["y_position"], best["customer_side"]
            )

        self.cb(100, "Done.")
        return {
            "venue_id":        self.venue_id,
            "camera_id":       self.camera_id,
            "actual_count":    self.actual_count,
            "video_seconds":   round(last_frame / fps, 1),
            "best":            best,
            "results":         rows,
            "bar_config_path": str(bar_config_path) if bar_config_path else None,
        }

    def _write_bar_config(self, y_pos: float, customer_side: int) -> Path:
        """
        Write winning config to disk AND push to DDB barConfigJson for the
        specific camera so the worker picks it up on the next segment.
        Filename: {camera_id}.json if camera_id given, else {venue_id}.json.
        """
        from core.config import CONFIG_DIR

        note = (
            f"Auto-calibrated: bar_line_y={y_pos:.2f}, "
            f"customer_side={'+1' if customer_side > 0 else '-1'}"
            + (f", camera={self.camera_id}" if self.camera_id else "")
        )
        config = {
            "venue_id":       self.venue_id,
            "display_name":   self.venue_id.replace("_", " ").title(),
            "overhead_camera": False,
            "notes":          note,
            "frame_width":    None,
            "frame_height":   None,
            "stations": [{
                "zone_id":         "bar_main",
                "label":           "Bar",
                "polygon": [
                    [0.0, 0.05], [1.0, 0.05],
                    [1.0, 0.95], [0.0, 0.95],
                ],
                "bar_line_p1":    [0.0, y_pos],
                "bar_line_p2":    [1.0, y_pos],
                "customer_side":   customer_side,
                "extra_bar_lines": [],
            }],
        }
        config_json = json.dumps(config, indent=2)

        # ── Write to disk (backup / local jobs) ──────────────────────────────
        file_key = self.camera_id if self.camera_id else self.venue_id
        path = CONFIG_DIR / f"{file_key}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(config_json)
        log.info("Bar config written to disk: %s (y=%.2f, side=%+d)", path, y_pos, customer_side)

        # ── Push to DDB barConfigJson for this specific camera ────────────────
        # Worker loads barConfigJson from DDB — this is what makes it take effect live.
        if self.camera_id and self.venue_id:
            try:
                from core.ddb_cameras import update_camera_bar_config_json
                ok = update_camera_bar_config_json(self.venue_id, self.camera_id, config_json)
                if ok:
                    log.info("Bar config pushed to DDB: venue=%s camera=%s",
                             self.venue_id, self.camera_id)
                else:
                    log.warning("DDB push returned False for %s/%s",
                                self.venue_id, self.camera_id)
            except Exception as e:
                log.warning("DDB push failed (config still saved to disk): %s", e)

        return path
