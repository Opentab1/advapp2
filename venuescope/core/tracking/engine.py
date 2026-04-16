"""
VenueScope v6 — Mac-native drink count engine.
Clean, simple, no Pi workarounds. Just:
  - Open video
  - Load YOLO
  - Detect & track people
  - Count drinks per bartender
  - Write results
"""
from __future__ import annotations
import os, time, cv2, json, threading
import numpy as np
from pathlib import Path
from typing import Callable, Optional, Dict, Any, List
from collections import deque

os.environ.setdefault("YOLO_TELEMETRY",          "False")
os.environ.setdefault("ULTRALYTICS_AUTOINSTALL", "False")

from ultralytics import YOLO

from core.config     import MODEL_PROFILES, DEFAULT_RULES, DEFAULT_PEOPLE_RULES
from core.config     import DEFAULT_TABLE_RULES, DEFAULT_STAFF_RULES, BOTTLE_CLASSES, CONFIG_DIR
from core.preprocessing import (enhance_for_detection, build_dewarp_maps, dewarp_frame, enhance_frame,
                                 upscale_for_detection, detect_night_mode, night_mode_enhance,
                                 detect_camera_angle)
from core.bar_config import BarConfig
from core.shift      import ShiftManager
from core.analytics.drink_counter         import DrinkCounter
from core.analytics.bottle_counter        import BottleCounter
from core.analytics.drink_bottle_correlator import DrinkBottleCorrelator
from core.analytics.glass_crossing          import GlassCrossingDetector
from core.analytics.people_counter import PeopleCounter
from core.analytics.table_tracker         import TableTurnTracker, TableZone
from core.analytics.table_service_tracker import TableServiceTracker, ServiceTableZone
from core.analytics.staff_tracker         import StaffActivityTracker, AfterHoursDetector
from core.output.writer            import ResultWriter

ProgressCB = Callable[[float, str], None]


def _centroids(boxes: np.ndarray) -> np.ndarray:
    if not len(boxes):
        return np.empty((0, 2), dtype=np.float32)
    return np.stack([(boxes[:,0]+boxes[:,2])/2,
                     (boxes[:,1]+boxes[:,3])/2], axis=1)


def _in_ignore_zone(cx, cy, zones, W, H):
    for zone in zones:
        poly = [(p[0]*W, p[1]*H) for p in zone.get("polygon", [])]
        if len(poly) < 3: continue
        n = len(poly); inside = False; j = n-1
        for i in range(n):
            xi,yi=poly[i]; xj,yj=poly[j]
            if ((yi>cy)!=(yj>cy)) and (cx<(xj-xi)*(cy-yi)/(yj-yi+1e-9)+xi):
                inside = not inside
            j = i
        if inside: return True
    return False


_MIN_MODEL_MB = 1      # reject files smaller than this (corrupted download)
_MAX_MODEL_MB = 800    # reject files larger than this (wrong file type)

# Per-process model cache — survives across jobs in the same process (Pool workers
# or parent-fork COW inheritance). On Linux the worker_daemon pre-loads the default
# model in the parent so forked child processes inherit it via copy-on-write.
_model_cache: dict = {}


def _load_yolo(model_name: str) -> YOLO:
    """Find and load YOLO model from any common location, with size validation."""
    candidates = [
        Path.home() / ".cache" / "ultralytics" / "assets" / model_name,
        Path.home() / ".cache" / "ultralytics" / model_name,
        Path.cwd() / model_name,
        Path(model_name),
    ]
    for c in candidates:
        if c.exists():
            size_mb = c.stat().st_size / 1_048_576
            if size_mb < _MIN_MODEL_MB:
                raise RuntimeError(
                    f"Model file {c} looks corrupted ({size_mb:.1f} MB < {_MIN_MODEL_MB} MB). "
                    "Delete it and let VenueScope re-download."
                )
            if size_mb > _MAX_MODEL_MB:
                raise RuntimeError(
                    f"Model file {c} is unexpectedly large ({size_mb:.0f} MB). "
                    "Check that the correct .pt file is referenced."
                )
            return YOLO(str(c))
    # Not found locally — let ultralytics download it
    return YOLO(model_name)


def _get_cached_model(model_name: str) -> YOLO:
    """Return a cached YOLO model, loading from disk only on first call per process."""
    if model_name not in _model_cache:
        _model_cache[model_name] = _load_yolo(model_name)
    return _model_cache[model_name]


def _check_memory_mb(required_mb: int = 1024):
    """Raise MemoryError if available system RAM < required_mb."""
    try:
        import psutil
        avail = psutil.virtual_memory().available / 1_048_576
        if avail < required_mb:
            raise MemoryError(
                f"Insufficient RAM: {avail:.0f} MB available, "
                f"{required_mb} MB required. Close other applications or use 'fast' profile."
            )
    except ImportError:
        pass  # psutil not installed — skip check


def _rtsp_read(cap: cv2.VideoCapture, timeout_sec: float = 10.0):
    """Read one frame from cap with a thread-based timeout for RTSP hang prevention."""
    result = [False, None]
    exc    = [None]

    def _reader():
        try:
            result[0], result[1] = cap.read()
        except Exception as e:
            exc[0] = e

    t = threading.Thread(target=_reader, daemon=True)
    t.start()
    t.join(timeout_sec)
    if t.is_alive():
        return False, None, True   # timed out
    if exc[0]:
        raise exc[0]
    return result[0], result[1], False


import io as _io_module

class _HLSCapture:
    """
    Streaming PyAV capture for NVR fragmented-MP4 live streams.

    The NVR at 192.168.1.252 serves /hls/live/CHn/0/livetop.mp4 as a
    fragmented MP4 (fMP4) live stream over HTTP:
      • First ~64 KB: ftyp + moov header (delivered at full network speed)
      • Remainder:    moof + mdat fragments at live encoding rate (~30 fps)
      • Connection resets after some buffer window

    On reconnect the stream restarts PTS from 0 (or from session start).
    We track last_pts and skip duplicate frames efficiently as they arrive.

    Uses a non-seekable streaming IO so PyAV reads the response without
    issuing secondary seek/range requests.
    """

    # Keep the buffer small — if YOLO inference lags, drop old frames rather
    # than accumulating a multi-minute backlog that makes detections stale.
    _QUEUE_MAXSIZE = 20

    def __init__(self, url: str, w: int, h: int, dup_factor: int = 1):
        import av as _av, requests as _req, logging, queue, threading, io
        logging.getLogger("libav").setLevel(logging.CRITICAL)
        self._url    = url
        self._w      = w
        self._h      = h
        self._av     = _av
        self._req    = _req
        self._io_mod = io
        self._threading = threading
        self._q: queue.Queue = queue.Queue(maxsize=self._QUEUE_MAXSIZE)
        self._opened = False
        self._stop   = threading.Event()
        # Frame duplication: repeat each unique frame dup_factor times so the
        # detection pipeline sees a higher effective fps (fixes 2fps NVR streams)
        self._dup_factor    = max(1, dup_factor)
        self._dup_remaining = 0
        self._last_frame    = None
        self._queue_drops   = 0   # frames dropped due to full queue
        self._thread = threading.Thread(target=self._bg, daemon=True)
        self._thread.start()
        # Wait up to 20 s for first frame
        import time as _time
        deadline = _time.time() + 20.0
        while _time.time() < deadline:
            if not self._q.empty():
                self._opened = True
                break
            _time.sleep(0.2)

    # ── non-seekable streaming IO ──────────────────────────────────────────

    class _StreamIO(_io_module.RawIOBase):
        """File-like object backed by a streaming HTTP response."""
        def __init__(self, url, req_module, stop_event, chunk_q):
            self._buf   = b""
            self._q     = chunk_q
            self._done  = False
            self._stop  = stop_event

        def readable(self)  -> bool: return True
        def seekable(self)  -> bool: return False
        def writable(self)  -> bool: return False

        def readinto(self, b):
            target = len(b)
            while len(self._buf) < target:
                if self._done:
                    break
                try:
                    chunk = self._q.get(timeout=10.0)
                except Exception:
                    self._done = True
                    break
                if chunk is None:
                    self._done = True
                    break
                self._buf += chunk
            n = min(target, len(self._buf))
            b[:n] = self._buf[:n]
            self._buf = self._buf[n:]
            return n

    def _stream_connection(self, last_pts: float) -> float:
        """
        Open one HTTP connection, stream fMP4 frames via PyAV, return updated last_pts.
        Returns when the connection resets or self._stop is set.
        """
        import queue as _qmod
        chunk_q: _qmod.Queue = _qmod.Queue(maxsize=64)

        def _reader():
            try:
                r = self._req.get(self._url, stream=True, timeout=30)
                for chunk in r.iter_content(32768):
                    if self._stop.is_set():
                        break
                    chunk_q.put(chunk)
                r.close()
            except Exception:
                pass
            chunk_q.put(None)  # sentinel

        t = self._threading.Thread(target=_reader, daemon=True)
        t.start()

        sio = self._StreamIO(self._url, self._req, self._stop, chunk_q)
        try:
            container = self._av.open(sio, format="mp4")
            for frame in container.decode(video=0):
                if self._stop.is_set():
                    break
                pts = (float(frame.pts * frame.time_base)
                       if frame.pts is not None else -1.0)
                if pts <= last_pts:
                    continue   # duplicate from reconnect

                arr = frame.to_ndarray(format="bgr24")
                if arr.shape[1] != self._w or arr.shape[0] != self._h:
                    arr = cv2.resize(arr, (self._w, self._h),
                                     interpolation=cv2.INTER_LINEAR)
                try:
                    self._q.put(arr, timeout=5.0)
                    last_pts = pts
                    if self._queue_drops > 0:
                        # Log recovery after a run of drops
                        print(f"[HLS] Queue recovered after {self._queue_drops} dropped frames", flush=True)
                        self._queue_drops = 0
                except Exception:
                    self._queue_drops += 1
                    if self._queue_drops % 30 == 1:  # log first drop and every 30th after
                        print(f"[HLS] WARNING: frame queue full — {self._queue_drops} dropped "
                              f"(processing {self._dup_factor}x slower than stream)", flush=True)
            container.close()
        except Exception:
            pass
        chunk_q.put(None)   # ensure reader thread can exit
        return last_pts

    def _bg(self):
        import time as _time
        last_pts = -1.0
        while not self._stop.is_set():
            last_pts = self._stream_connection(last_pts)
            if not self._stop.is_set():
                _time.sleep(1.0)   # brief pause before reconnect

    # ── Public cap interface ───────────────────────────────────────────────

    def read(self):
        import queue
        if not self._opened:
            return False, None
        # Return cached frame for remaining duplicates before fetching a new one
        if self._dup_remaining > 0 and self._last_frame is not None:
            self._dup_remaining -= 1
            return True, self._last_frame
        try:
            frame = self._q.get(timeout=30.0)
            self._last_frame    = frame
            self._dup_remaining = self._dup_factor - 1
            return True, frame
        except queue.Empty:
            self._opened = False
            return False, None

    def isOpened(self) -> bool:
        return self._opened

    def release(self):
        self._stop.set()
        self._opened = False
        try:
            while not self._q.empty():
                self._q.get_nowait()
        except Exception:
            pass

    def get(self, prop_id: int) -> float:
        return 0.0


# Gap 3: Mode-specific ByteTrack configs
# Lower match_thresh = tracks survive more occlusion; higher track_buffer = longer ID persistence
_TRACKER_PARAMS = {
    "drink_count":    {"match_thresh": 0.55, "track_buffer": 90,  "new_track_thresh": 0.20},
    "people_count":   {"match_thresh": 0.65, "track_buffer": 60,  "new_track_thresh": 0.25},
    "table_turns":    {"match_thresh": 0.60, "track_buffer": 60,  "new_track_thresh": 0.25},
    "staff_activity": {"match_thresh": 0.60, "track_buffer": 60,  "new_track_thresh": 0.25},
    "after_hours":    {"match_thresh": 0.70, "track_buffer": 30,  "new_track_thresh": 0.25},
    "bottle_count":   {"match_thresh": 0.70, "track_buffer": 30,  "new_track_thresh": 0.25},
}
_tracker_yaml_cache: Dict[str, str] = {}

def _get_tracker_yaml(mode: str) -> str:
    """Return path to mode-specific ByteTrack YAML, creating it if needed."""
    if mode in _tracker_yaml_cache:
        return _tracker_yaml_cache[mode]
    p = _TRACKER_PARAMS.get(mode, {"match_thresh": 0.70, "track_buffer": 30, "new_track_thresh": 0.25})
    tracker_dir = CONFIG_DIR / "trackers"
    tracker_dir.mkdir(parents=True, exist_ok=True)
    yaml_path = tracker_dir / f"bytetrack_{mode}.yaml"
    yaml_path.write_text(
        f"tracker_type: bytetrack\n"
        f"track_high_thresh: 0.25\n"
        f"track_low_thresh: 0.10\n"
        f"new_track_thresh: {p['new_track_thresh']}\n"
        f"track_buffer: {p['track_buffer']}\n"
        f"match_thresh: {p['match_thresh']}\n"
        f"fuse_score: True\n"
    )
    _tracker_yaml_cache[mode] = str(yaml_path)
    return str(yaml_path)


# Gap 2: Screen recording detection
_SCREEN_RESOLUTIONS = {(1920,1080),(1280,720),(2560,1440),(3840,2160),(2560,1600),(1366,768)}

def _detect_screen_recording(frame: np.ndarray, W: int, H: int, source_type: str = "file") -> Optional[str]:
    """
    Heuristic check for screen-recorded footage.
    Returns a warning string if suspicious, else None.
    Checks:
      1. Solid-color horizontal strip at bottom (player controls)
      2. Solid-color strip at top (browser/OS chrome)
      3. Standard desktop screen resolution
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    # Check bottom 5% and top 5% for flat color (std dev < 18 = essentially solid)
    bottom = gray[int(H * 0.93):, :]
    top    = gray[:int(H * 0.05), :]
    if np.std(bottom) < 18:
        return ("SCREEN_RECORDING: Solid color strip detected at the bottom of the frame — "
                "likely a video player UI. The actual bar area may be compressed into the upper "
                "portion of the frame, causing missed detections. "
                "Re-export directly from the CCTV DVR/NVR instead of screen-recording a player.")
    if np.std(top) < 18:
        return ("SCREEN_RECORDING: Solid color strip detected at the top of the frame — "
                "likely a browser toolbar or app chrome. "
                "Re-export directly from the CCTV DVR/NVR for full-frame accuracy.")
    # Only flag resolution match for file uploads — live RTSP streams are always
    # served at native NVR resolution (1080p etc.) and are never screen-recorded.
    if (W, H) in _SCREEN_RESOLUTIONS and source_type != "rtsp":
        return ("SCREEN_RECORDING_SUSPECTED: Video resolution matches a common desktop screen size. "
                "If this was screen-recorded from a player app, bar content may be compressed. "
                "Consider exporting directly from your DVR/NVR.")
    return None


def _iou(b1: np.ndarray, b2: np.ndarray) -> float:
    """Intersection-over-Union for two [x1,y1,x2,y2] boxes."""
    ix1 = max(b1[0], b2[0]); iy1 = max(b1[1], b2[1])
    ix2 = min(b1[2], b2[2]); iy2 = min(b1[3], b2[3])
    inter = max(0.0, ix2-ix1) * max(0.0, iy2-iy1)
    if inter == 0.0:
        return 0.0
    a1 = (b1[2]-b1[0]) * (b1[3]-b1[1])
    a2 = (b2[2]-b2[0]) * (b2[3]-b2[1])
    return inter / (a1 + a2 - inter + 1e-9)


class VenueProcessor:

    def __init__(self, job_id, analysis_mode, source, source_type,
                 model_profile, bar_config, shift, extra_config,
                 result_dir, annotate=False, progress_cb=None,
                 extra_modes: List[str] = None,
                 live_event_cb: Optional[Callable] = None):
        self.job_id      = job_id
        # Primary mode drives tracker config + annotation
        self.mode        = analysis_mode
        # All modes (primary + any extras) — each gets its own analyzer
        self.modes: List[str] = [analysis_mode] + [
            m for m in (extra_modes or []) if m and m != analysis_mode
        ]
        self.source      = source
        self.source_type = source_type
        ec_tmp = extra_config or {}
        _override = ec_tmp.get("model_override", model_profile)
        if _override in MODEL_PROFILES:
            self.profile = MODEL_PROFILES[_override]
        elif model_profile in MODEL_PROFILES:
            self.profile = MODEL_PROFILES[model_profile]
        else:
            self.profile = MODEL_PROFILES["accurate"]  # safe fallback
        self.bar_config  = bar_config
        self.shift       = shift
        self.ec          = extra_config or {}
        self.result_dir  = Path(result_dir)
        # Annotate for file-upload jobs only — never write video to disk for
        # continuous live streams (disk fill + CPU overhead, data goes to DDB).
        _is_continuous_rtsp = (source_type == "rtsp" and
                               float((extra_config or {}).get("max_seconds", 1)) == 0)
        self.annotate    = False if _is_continuous_rtsp else (annotate or (analysis_mode == "drink_count"))

        import torch as _torch_init
        _has_gpu = _torch_init.cuda.is_available() or (
            hasattr(_torch_init.backends, 'mps') and _torch_init.backends.mps.is_available())
        self._has_gpu = _has_gpu   # store so run() can reference without reimport

        # Live CPU override: keep RTSP jobs real-time on a 1vCPU droplet.
        # drink_count gets yolov8s@320px — ROI crop means YOLO only sees the bar zone
        # at full 320px resolution (bartenders go from ~50px → ~120px tall in input),
        # so yolov8s@320 delivers significantly better accuracy than yolov8n@480 for
        # roughly the same wall-clock inference time.
        # Other modes (people_count etc.) keep nano@320 — no ROI available.
        if self.source_type == "rtsp" and not _has_gpu:
            self.profile = dict(self.profile)
            if analysis_mode == "drink_count":
                self.profile["model"]  = "yolov8s.pt"   # 3× more accurate than nano
                self.profile["imgsz"]  = 320             # ROI crop compensates for lower res
            elif analysis_mode == "bottle_count":
                self.profile["model"]  = "yolov8n.pt"
                self.profile["imgsz"]  = min(self.profile.get("imgsz", 480), 480)
            else:
                self.profile["model"]  = "yolov8n.pt"
                self.profile["imgsz"]  = min(self.profile.get("imgsz", 320), 320)
            self.profile["stride"] = max(self.profile.get("stride", 2), 2)

        # Gap 1: Overhead camera — lower conf floor for top-down fisheye
        self._overhead = bool(bar_config and getattr(bar_config, "overhead_camera", False))
        if self._overhead:
            self.profile = dict(self.profile)   # shallow copy so we don't mutate the global
            self.profile["conf"] = min(self.profile["conf"], 0.15)
            if _has_gpu:
                # GPU: full resolution + every frame
                self.profile["imgsz"]  = max(self.profile["imgsz"], 1280)
                self.profile["stride"] = 1
            # CPU: handled by live CPU override above (yolov8s@320 for drink_count)
            # Auto-enable fisheye dewarping for overhead RTSP cameras.
            # YOLO is trained on normal images — dewarping normalises the fisheye lens
            # so bartenders look upright rather than distorted overhead blobs.
            # Conservative strength=0.3 avoids over-correction on unknown lens params.
            if self.source_type == "rtsp" and not self.ec.get("dewarp", False):
                self._dewarp         = True
                self._dewarp_strength = float(self.ec.get("dewarp_strength", 0.3))

        # Bottle count: bottles in overhead/fisheye cameras need high-res inference.
        # YOLO misses them at 640px but detects reliably at 1280px.
        if analysis_mode == "bottle_count":
            self.profile = dict(self.profile)
            self.profile["imgsz"] = max(self.profile.get("imgsz", 640), 1280)
            self.profile["conf"]  = min(self.profile["conf"], 0.15)

        # Gap 3: Swap in mode-specific ByteTrack YAML
        self.profile = dict(self.profile)
        self.profile["tracker"] = _get_tracker_yaml(analysis_mode)
        self.cb          = progress_cb or (lambda p, m: None)
        self._serve_flashes: List[Dict] = []  # active serve event overlays

        self.result_dir.mkdir(parents=True, exist_ok=True)
        (self.result_dir / "snapshots").mkdir(exist_ok=True)

        self._conf_sum = 0.0; self._conf_n = 0
        self._total = self._processed = self._dropped = 0
        self._screen_recording_warning: Optional[str] = None   # Gap 2
        self._prev_ids = set(); self._id_switches = 0
        self._last_boxes:  Dict[int, np.ndarray] = {}  # A2: last known box per track
        self._lost_boxes:  Dict[int, tuple]      = {}  # A2: {old_id: (box, frame_idx)}
        self._track_ages: Dict[int,int] = {}
        self._snap_count = 0
        self._clip_count  = 0
        self._serve_snapshots: Dict[float, str] = {}  # t_sec -> S3 key (populated async)
        self._snap_executor = None  # ThreadPoolExecutor, created lazily
        self._min_track_age = self.ec.get("min_track_age_frames", 8)
        self._ignore_zones  = self.ec.get("ignore_zones", [])

        # Preprocessing
        self._enhance_strength = self.ec.get("enhance_strength", "off")
        self._dewarp           = self.ec.get("dewarp", False)
        self._dewarp_strength  = float(self.ec.get("dewarp_strength", 0.4))
        self._dewarp_maps      = None   # built lazily after first frame

        # Improvement 2: Adaptive confidence
        self._adaptive_conf    = self.ec.get("adaptive_conf", True)
        self._running_conf_sum = 0.0
        self._running_conf_n   = 0
        self._conf_threshold   = self.profile["conf"]  # starts at profile default, may adapt

        # Improvement 3: Night/IR camera detection
        self._night_mode         = False
        self._night_mode_checked = False

        # Feature 4: Camera angle auto-detection
        self._angle_info:    Optional[Dict[str, Any]] = None
        self._angle_checked: bool = False
        # Only auto-configure overhead if bar_config hasn't explicitly set it
        self._explicit_overhead = bool(bar_config and getattr(bar_config, "overhead_camera", False))

        # Improvement 5: ROI crop for drink_count
        # Auto-enabled for all RTSP drink_count jobs with a bar config — crops the frame
        # to the bar zone polygon bounding box before YOLO inference. At 320px imgsz,
        # bartenders occupy ~120px of the input vs ~50px on the full frame at 480px.
        # Also enabled when enhance_strength is explicitly set (existing behaviour).
        self._roi_crop  = (self.mode == "drink_count" and
                           self.bar_config is not None and
                           (self.source_type == "rtsp" or
                            self.ec.get("enhance_strength", "off") in ("light", "strong")))
        self._roi_boxes: Optional[tuple] = None   # (x1, y1, x2, y2) in pixels, set lazily

        self._max_seconds = float(self.ec.get("max_seconds", 0))  # 0 = unlimited

        # RTSP health tracking
        self._rtsp_errors     = 0
        self._rtsp_timeouts   = 0

        # Per-frame timing for performance monitoring
        self._frame_times: List[float] = []   # ms per processed frame

        # Live push — called every ~10s for rtsp streams with max_seconds=0
        # (was 30s; reduced so dashboards refresh faster during live shifts)
        self._live_event_cb:    Optional[Callable] = live_event_cb
        self._last_live_push:   float = 0.0
        self._live_push_interval: float = float(
            self.ec.get("live_push_interval", 5.0))  # 5s default (was 10s)

        # Checkpoint / resume
        self._checkpoint_file   = self.result_dir / "checkpoint.json"
        self._checkpoint_every  = 1000  # save every N processed frames (disk I/O reduction)
        self._resumed_from      = 0     # frame_idx we resumed from (0 = fresh start)

        # Pre-job memory check (require at least 1 GB free)
        _check_memory_mb(required_mb=int(os.environ.get("VENUESCOPE_MIN_RAM_MB", "1024")))

        # Rolling frame buffer for clip saving (stores thumbnail-size frames)
        self._clip_fps   = 0.0          # set once fps is known
        self._clip_W     = 480
        self._frame_buf: deque = deque(maxlen=90)   # up to ~3s pre-event buffer
        self._pending_clips: List[Dict] = []         # clips currently writing forward frames

    def run(self) -> Dict[str, Any]:
        self.cb(0, "Opening video...")
        _src_str = str(self.source)
        # Treat both .m3u8 and /hls/ path URLs as HLS — NVR streams use
        # fragmented MP4 (.mp4 extension) under the /hls/ path and need
        # the PyAV _HLSCapture wrapper to deliver full framerate.
        _is_hls     = (self.source_type == "rtsp"
                       and _src_str.startswith("http")
                       and (_src_str.endswith(".m3u8") or "/hls/" in _src_str))
        _use_ffmpeg = (self.source_type == "rtsp" and not _is_hls)
        # For RTSP camera jobs, skip writing clips/snapshots to disk —
        # everything goes to AWS. Clips are only useful for local file-upload review.
        _save_local = (self.source_type != "rtsp")
        cap = (cv2.VideoCapture(self.source, cv2.CAP_FFMPEG)
               if _use_ffmpeg
               else cv2.VideoCapture(str(self.source)))
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open: {self.source}")

        # H.265/HEVC codec check — OpenCV may silently decode H.265 to black frames
        # if libx265 or the relevant FFMPEG decoder is not available on this system.
        # Check the first readable frame; if it's a valid-size all-black image, warn.
        # (Non-HLS file sources only — HLS uses PyAV which handles codecs differently.)
        if not _is_hls and self.source_type in ("file", "rtsp"):
            _codec_ok, _test_frame = cap.read()
            if not _codec_ok or _test_frame is None:
                raise RuntimeError(
                    f"Cannot read first frame from source. "
                    f"If this is an H.265/HEVC stream, ensure ffmpeg with HEVC support is installed: "
                    f"ffmpeg -codecs | grep hevc"
                )
            if _codec_ok and _test_frame is not None and _test_frame.size > 0:
                _brightness = float(np.mean(_test_frame))
                if _brightness < 1.5:
                    self.cb(0, f"WARNING: First frame is nearly black (mean={_brightness:.2f}). "
                               f"H.265/HEVC cameras may require ffmpeg with HEVC support. "
                               f"If all frames are black, the stream codec is unsupported.")
            # Reset to start — for RTSP we can't seek back, so just continue from frame 2
            if self.source_type == "file":
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

        fps     = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_f = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or -1
        W       = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        H       = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        # HLS low-fps fix: NVR delivers 2fps — duplicate each frame to reach ~14fps
        # so frame-count thresholds (prep_frames, dwell_frames, cooldowns) work correctly.
        _hls_dup_factor = 1
        if _is_hls and fps < 5.0:
            # GPU: target 14fps effective (GPU can process every duplicated frame)
            # CPU: target 4fps effective — yolov8n@480px processes ~2.5fps per core,
            # so dup_factor=2 at 2fps real = 4fps effective stays within budget.
            # dup_factor=7 (14fps) on CPU caused "7x slower than stream" queue backup
            # making the live dashboard report 7 minutes of lag. Fix: match real throughput.
            _target_fps = 14.0 if self._has_gpu else 4.0
            _hls_dup_factor = max(1, round(_target_fps / max(fps, 0.5)))
            _raw_fps = fps
            fps = _raw_fps * _hls_dup_factor
            self.cb(2, f"HLS: stream is {_raw_fps:.1f}fps — enabling {_hls_dup_factor}x frame "
                       f"duplication → effective {fps:.0f}fps for detection pipeline")
            # Reduce min_track_age: ByteTrack may reset track IDs on each new NVR frame
            # (0.5s gap, person can move enough that IoU drops below match threshold).
            # With dup_factor frames per NVR frame and stride, we get dup_factor/stride
            # processed frames per real frame — use that as the new min_track_age.
            stride = self.profile.get("stride", 2)
            _hls_min_age = max(2, _hls_dup_factor // max(stride, 1))
            self._min_track_age = _hls_min_age
            self.cb(2, f"HLS: min_track_age reduced to {_hls_min_age} "
                       f"(was {self.ec.get('min_track_age_frames', 8)})")
        self._clip_fps = fps / max(self.profile.get("stride", 2), 1)
        self._clip_H   = int(H * self._clip_W / W)
        self.cb(2, f"Video: {W}x{H} @ {fps:.1f}fps  ({total_f} frames, {total_f/fps/60:.1f} min)")
        if self._overhead:
            self.cb(2, f"Overhead camera mode: conf={self.profile['conf']}, "
                       f"imgsz={self.profile['imgsz']}, stride={self.profile.get('stride',1)}, "
                       f"model={self.profile.get('model','yolov8m.pt')}")
        if _save_local:
            (self.result_dir / "clips").mkdir(exist_ok=True)

        # Build one analyzer per mode — single YOLO pass feeds them all
        analyzers  = {m: self._build_analyzer(W, H, fps, mode_override=m)
                      for m in self.modes}
        analyzer   = analyzers[self.mode]   # primary (used for annotation)
        # True when bottle_count runs alongside a person-tracking primary mode.
        # Requires detecting both class 0 (person) and bottle classes in one pass.
        _bottle_alongside = ("bottle_count" in self.modes and self.mode != "bottle_count")
        # Correlator: links pour_end events from BottleCounter to drink_serve events
        # from DrinkCounter. Only active when both modes are running together.
        _correlator: Optional[DrinkBottleCorrelator] = (
            DrinkBottleCorrelator() if _bottle_alongside else None
        )
        self._correlator = _correlator  # stored so _build_summary can include its stats

        # Glass crossing detector — auto-enabled for drink_count mode.
        # Tracks physical cup/wine_glass crossing the bar line (near-zero false positives).
        # When it fires for a station, body-crossing (DrinkCounter) events for the
        # same station within the cooldown window are suppressed to avoid double-counting.
        _glass_detector: Optional[GlassCrossingDetector] = (
            GlassCrossingDetector(self.bar_config, W, H)
            if self.mode == "drink_count" and self.bar_config is not None
            else None
        )
        self._glass_detector = _glass_detector
        # station_id → last glass-serve t_sec; DrinkCounter checks this to suppress
        # body-crossing events when a glass crossing already confirmed the serve.
        _glass_served: Dict[str, float] = {}
        model_name = self.profile["model"]
        self.cb(4, f"Loading {model_name}...")
        model = _get_cached_model(model_name)
        self.cb(5, f"Model ready. Starting analysis...")

        _is_live = (self.source_type == "rtsp" and self._max_seconds == 0)
        writer = ResultWriter(self.job_id, self.result_dir, fps, is_live=_is_live)
        vout   = None
        if self.annotate:
            # avc1 = H.264 — browser-native codec; falls back to mp4v if unavailable
            _fourcc = cv2.VideoWriter_fourcc(*"avc1")
            _test   = cv2.VideoWriter(str(self.result_dir / "annotated.mp4"),
                                      _fourcc, fps, (W, H))
            if not _test.isOpened():
                _test.release()
                _fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                _test   = cv2.VideoWriter(str(self.result_dir / "annotated.mp4"),
                                          _fourcc, fps, (W, H))
            vout = _test

        stride    = self.profile["stride"]
        imgsz     = self.profile["imgsz"]
        frame_idx = 0
        t0        = time.time()

        # Checkpoint resume: seek to last saved position
        if self._checkpoint_file.exists():
            try:
                ck = json.loads(self._checkpoint_file.read_text())
                resume_frame = int(ck.get("frame_idx", 0))
                if resume_frame > 0 and self.source_type != "rtsp":
                    # Sanity check: checkpoint must not exceed video length
                    if total_f > 0 and resume_frame >= total_f:
                        self.cb(0, f"Checkpoint frame {resume_frame} >= total {total_f} "
                                   f"— ignoring (video may have changed)")
                        resume_frame = 0
                    if resume_frame > 0:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, resume_frame)
                        # Verify the seek actually worked (some codecs don't support it)
                        actual_frame = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
                        if resume_frame > 10 and actual_frame < resume_frame - 10:
                            self.cb(0, f"Checkpoint seek to {resume_frame} failed "
                                       f"(codec limitation, got {actual_frame}) — starting fresh")
                            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                            resume_frame = 0
                        else:
                            frame_idx          = resume_frame
                            self._total        = resume_frame
                            self._processed    = ck.get("processed", 0)
                            self._dropped      = ck.get("dropped", 0)
                            self._resumed_from = resume_frame
                            self.cb(0, f"Resuming from frame {resume_frame} "
                                       f"(checkpoint found — {resume_frame/fps/60:.1f} min in)")
            except Exception as _ce:
                self.cb(0, f"Checkpoint load failed (starting fresh): {_ce}")

        # For HLS live streams: switch to ffmpeg-subprocess capture now that we have W/H.
        # cv2.VideoCapture works for metadata but fails on frame reads ("partial file" errors)
        # because the NVR serves a continuously-written MP4 buffer.
        if _is_hls:
            cap.release()
            cap = _HLSCapture(self.source, W, H, dup_factor=_hls_dup_factor)
            self.cb(0, f"HLS live stream: switched to ffmpeg pipe reader "
                       f"(dup_factor={_hls_dup_factor})")

        _rtsp_consecutive_errors = 0
        _rtsp_reconnect_count    = 0    # how many reconnects have been attempted
        # Continuous jobs (max_seconds=0) never give up — the bar is open and the
        # camera WILL come back. Use a very large limit instead of float('inf')
        # to avoid any overflow issues in comparison operators.
        _MAX_RTSP_ERRORS         = (10_000_000 if self._max_seconds == 0 else 60)
        _RTSP_RECONNECT_AFTER    = 15   # reconnect after 15 consecutive failures (was 5)
        # NVR streams can have >10s buffering latency — 5 failures = 2.5s at 2fps was
        # too aggressive, causing flapping that resets ByteTrack track IDs mid-shift.

        while True:
            _ft_start = time.perf_counter()

            if _use_ffmpeg:
                ret, frame, timed_out = _rtsp_read(cap, timeout_sec=10.0)
                if timed_out:
                    self._rtsp_timeouts      += 1
                    _rtsp_consecutive_errors += 1
                    self.cb(0, f"RTSP read timeout #{self._rtsp_timeouts} "
                               f"(frame {frame_idx}) — retrying")
                    if _rtsp_consecutive_errors >= _MAX_RTSP_ERRORS:
                        self.cb(0, f"RTSP: {_MAX_RTSP_ERRORS} consecutive errors — aborting stream")
                        break
                    # Try to reopen the connection after a few consecutive timeouts
                    if _rtsp_consecutive_errors % _RTSP_RECONNECT_AFTER == 0:
                        _rtsp_reconnect_count += 1
                        _backoff = min(2.0 * (2 ** min(_rtsp_reconnect_count - 1, 4)), 30.0)
                        self.cb(0, f"RTSP: reconnecting (attempt {_rtsp_reconnect_count}, "
                                   f"backoff={_backoff:.0f}s)...")
                        try:
                            cap.release()
                            time.sleep(_backoff)
                            cap = cv2.VideoCapture(self.source, cv2.CAP_FFMPEG)
                            if cap.isOpened():
                                self.cb(0, "RTSP: reconnected successfully")
                                _rtsp_reconnect_count = 0  # reset on successful reconnect
                        except Exception as _re:
                            self.cb(0, f"RTSP: reconnect failed: {_re}")
                    continue
            else:
                ret, frame = cap.read()
                timed_out  = False

            if not ret:
                if self.source_type == "rtsp":
                    self._rtsp_errors        += 1
                    _rtsp_consecutive_errors += 1
                    if _rtsp_consecutive_errors >= _MAX_RTSP_ERRORS:
                        break
                    # Try to reopen after a few consecutive failures
                    if _rtsp_consecutive_errors % _RTSP_RECONNECT_AFTER == 0:
                        _rtsp_reconnect_count += 1
                        _backoff = min(2.0 * (2 ** min(_rtsp_reconnect_count - 1, 4)), 30.0)
                        self.cb(0, f"RTSP: reconnecting after {_rtsp_consecutive_errors} "
                                   f"failures (attempt {_rtsp_reconnect_count}, "
                                   f"backoff={_backoff:.0f}s)...")
                        try:
                            cap.release()
                            time.sleep(_backoff)
                            if _is_hls:
                                cap = _HLSCapture(self.source, W, H, dup_factor=_hls_dup_factor)
                            elif _use_ffmpeg:
                                cap = cv2.VideoCapture(self.source, cv2.CAP_FFMPEG)
                            else:
                                cap = cv2.VideoCapture(self.source)
                            if cap.isOpened():
                                self.cb(0, "RTSP: reconnected")
                                _rtsp_reconnect_count = 0
                        except Exception as _re:
                            self.cb(0, f"RTSP: reconnect failed: {_re}")
                    else:
                        time.sleep(0.1)
                    continue
                break

            _rtsp_consecutive_errors = 0
            self._total += 1

            if frame_idx % stride != 0:
                frame_idx += 1; self._dropped += 1; continue
            self._processed += 1

            # Buffer thumbnail for clip saving (before detection) — RTSP jobs skip this
            if _save_local:
                try:
                    thumb_buf = cv2.resize(frame, (self._clip_W, self._clip_H),
                                           interpolation=cv2.INTER_LINEAR)
                    self._frame_buf.append(thumb_buf)
                    # Write forward frames into any open clip writers
                    for pc in self._pending_clips:
                        if pc["frames_left"] > 0:
                            pc["writer"].write(thumb_buf)
                            pc["frames_left"] -= 1
                    # Close finished clips
                    done = [pc for pc in self._pending_clips if pc["frames_left"] <= 0]
                    for pc in done:
                        pc["writer"].release()
                    self._pending_clips = [pc for pc in self._pending_clips
                                           if pc["frames_left"] > 0]
                except Exception:
                    pass

            # Gap 2: Screen recording check on first processed frame only
            if self._processed == 1 and self._screen_recording_warning is None:
                w = _detect_screen_recording(frame, W, H, source_type=self.source_type)
                if w:
                    self._screen_recording_warning = w
                    self.cb(0, f"WARNING: {w[:120]}...")

            # Keep original frame for annotation (boxes are transformed back to full-frame coords)
            orig_frame = frame if not self.annotate else frame.copy()

            # Per-frame init for ROI offset (Improvement 5)
            _roi_offset_x = 0
            _roi_offset_y = 0

            # Preprocessing for bad cameras
            if self._dewarp:
                if self._dewarp_maps is None:
                    self._dewarp_maps = build_dewarp_maps(W, H, self._dewarp_strength)
                frame = dewarp_frame(frame, self._dewarp_maps[0], self._dewarp_maps[1])
            if self._enhance_strength != "off":
                frame = enhance_for_detection(frame, self._enhance_strength)

            # Improvement 3: Night/IR camera auto-detection (check on first 3 processed frames)
            if not self._night_mode_checked and self._processed <= 3:
                if detect_night_mode(frame):
                    self._night_mode = True
                    if self._processed == 1:
                        # IR/night cameras: YOLO (RGB-trained) needs lower conf + every-frame
                        # processing to reliably detect people in grayscale overhead footage.
                        # Benchmark: on CH9 (1920x1080 IR), people visible at conf=0.08 but not 0.15.
                        _has_gpu = self._has_gpu
                        self._conf_threshold        = min(self._conf_threshold, 0.08)
                        self.profile["conf"]        = self._conf_threshold
                        if _has_gpu:
                            # GPU: process every frame at higher res for IR detail
                            self.profile["stride"]  = 1
                            self.profile["imgsz"]   = max(self.profile.get("imgsz", 640), 960)
                        else:
                            # CPU: keep stride=2 and cap imgsz at 480 — IR mode can't
                            # override the real-time budget (2fps stream, ~0.4s/frame).
                            # stride=1 at 640px would fall 3x behind; stride=2 at 480px keeps up.
                            self.profile["stride"]  = max(self.profile.get("stride", 2), 2)
                            self.profile["imgsz"]   = min(self.profile.get("imgsz", 480), 480)
                        self.cb(0, f"Night/IR camera detected — conf→{self._conf_threshold:.2f}, "
                                   f"imgsz→{self.profile['imgsz']}, "
                                   f"stride→{self.profile['stride']}")
                        # Relax drink counter gates for IR cameras — track IDs flicker more
                        # in low-conf mode, so require fewer consecutive frames to count a serve.
                        if "drink_count" in analyzers:
                            _dc = analyzers["drink_count"]
                            _dc.rules.min_prep_frames      = max(2, int(_dc.rules.min_prep_frames * 0.5))
                            _dc.rules.serve_dwell_frames   = max(1, int(_dc.rules.serve_dwell_frames * 0.5))
                            _dc.rules.serve_confirm_frames = max(1, int(_dc.rules.serve_confirm_frames * 0.5))
                            _dc.rules.reappear_grace_frames = max(30, _dc.rules.reappear_grace_frames)
                            self.cb(0, "Drink counter: night-mode gate scaling applied")
                if self._processed >= 3:
                    self._night_mode_checked = True
            if self._night_mode:
                frame = night_mode_enhance(frame)

            # Feature 4: Camera angle auto-detection on first frame
            if not self._angle_checked and self._processed == 1:
                self._angle_info    = detect_camera_angle(frame)
                self._angle_checked = True
                ai = self._angle_info
                self.cb(0, f"Camera angle: {ai['angle']} "
                           f"(confidence {ai['confidence']:.0%}, "
                           f"vertical_edge_ratio={ai['vertical_edge_ratio']:.2f})")
                # Auto-configure overhead mode if not explicitly set and detected with high confidence
                if not self._explicit_overhead and ai["angle"] == "overhead" \
                        and ai["confidence"] >= 0.60:
                    hints = ai["config_hints"]
                    self._overhead              = True
                    self.profile["conf"]        = min(self.profile["conf"],
                                                      hints.get("conf", 0.15))
                    self.profile["imgsz"]       = max(self.profile["imgsz"],
                                                      hints.get("imgsz", 1280))
                    self.profile["stride"]      = hints.get("stride", 1)
                    self._conf_threshold        = self.profile["conf"]
                    self.cb(0, "Auto-configured for overhead camera: "
                               f"conf={self.profile['conf']}, "
                               f"imgsz={self.profile['imgsz']}, stride=1")
                    # Relax drink counter gates for this auto-detected overhead camera
                    # (rules were built before frame 1 — patch the live analyzer directly)
                    if "drink_count" in analyzers:
                        _dc = analyzers["drink_count"]
                        _dc.rules.max_cross_velocity_px = 150.0
                        _dc.rules.min_prep_frames       = max(2, int(_dc.rules.min_prep_frames * 0.7))
                        _dc.rules.serve_dwell_frames    = max(1, int(_dc.rules.serve_dwell_frames * 0.7))
                        _dc.rules.serve_confirm_frames  = max(1, int(_dc.rules.serve_confirm_frames * 0.7))
                        self.cb(0, "Drink counter: overhead gate scaling applied")

            # Improvement 4: Auto-upscale low-res cameras (< 720p shorter side) before YOLO
            _fh, _fw = frame.shape[:2]
            if self._enhance_strength in ("light", "strong") and min(_fh, _fw) < 720:
                frame = upscale_for_detection(frame, min_side=720)

            # Improvement 5: ROI crop for drink_count — focus on bar zone for better resolution
            if self._roi_crop and self.bar_config:
                if self._roi_boxes is None:
                    _cur_H, _cur_W = frame.shape[:2]
                    all_pts = []
                    for _st in self.bar_config.stations:
                        for _p in _st.polygon:
                            all_pts.append((_p[0] * _cur_W, _p[1] * _cur_H))
                    if all_pts:
                        _pad = 0.05  # 5% padding
                        _xs = [p[0] for p in all_pts]
                        _ys = [p[1] for p in all_pts]
                        _rx1 = max(0,       int(min(_xs) - _pad * _cur_W))
                        _ry1 = max(0,       int(min(_ys) - _pad * _cur_H))
                        _rx2 = min(_cur_W,  int(max(_xs) + _pad * _cur_W))
                        _ry2 = min(_cur_H,  int(max(_ys) + _pad * _cur_H))
                        self._roi_boxes = (_rx1, _ry1, _rx2, _ry2)
                if self._roi_boxes:
                    _rx1, _ry1, _rx2, _ry2 = self._roi_boxes
                    _roi_offset_x = _rx1
                    _roi_offset_y = _ry1
                    frame = frame[_ry1:_ry2, _rx1:_rx2]

            # Resize frame down to imgsz before YOLO — critical for high-res cameras
            H_orig, W_orig = frame.shape[:2]
            scale = min(imgsz / W_orig, imgsz / H_orig, 1.0)
            if scale < 1.0:
                yolo_frame = cv2.resize(frame,
                                        (int(W_orig*scale), int(H_orig*scale)),
                                        interpolation=cv2.INTER_LINEAR)
            else:
                yolo_frame = frame
                scale      = 1.0

            if _bottle_alongside:
                detect_classes = list({0} | set(BOTTLE_CLASSES))  # people + bottles
            elif self.mode == "bottle_count":
                detect_classes = BOTTLE_CLASSES
            elif self.mode == "drink_count":
                # Detect people + all drink containers for GlassCrossingDetector.
                # 39=bottle/can, 40=wine_glass, 41=cup
                # YOLO detects beer/seltzer cans as class 39 (bottle) from overhead.
                detect_classes = [0, 39, 40, 41]
            else:
                detect_classes = [0]
            results = model.track(yolo_frame, persist=True,
                                  imgsz=imgsz,
                                  conf=self._conf_threshold,
                                  iou=self.profile["iou"],
                                  classes=detect_classes,
                                  tracker=self.profile["tracker"],
                                  verbose=False)

            boxes_px:  np.ndarray = np.empty((0, 4), dtype=np.float32)
            track_ids: List[int]  = []
            confs:     List[float]= []

            class_ids: List[int] = []
            res = results[0] if results else None
            if res and res.boxes is not None and len(res.boxes):
                raw       = res.boxes.xyxy.cpu().numpy() / scale
                # Improvement 5: shift coords back to full-frame space if ROI crop was applied
                if _roi_offset_x != 0 or _roi_offset_y != 0:
                    raw[:, 0] += _roi_offset_x
                    raw[:, 1] += _roi_offset_y
                    raw[:, 2] += _roi_offset_x
                    raw[:, 3] += _roi_offset_y
                raw_ids   = (res.boxes.id.cpu().numpy().astype(int).tolist()
                             if res.boxes.id is not None else list(range(len(raw))))
                raw_confs = (res.boxes.conf.cpu().numpy().tolist()
                             if res.boxes.conf is not None else [0.5]*len(raw))
                raw_cls   = (res.boxes.cls.cpu().numpy().astype(int).tolist()
                             if res.boxes.cls is not None else [0]*len(raw))

                fb, fi, fc, fk = [], [], [], []
                for box, tid, conf, cls in zip(raw, raw_ids, raw_confs, raw_cls):
                    cx = (box[0]+box[2])/2; cy = (box[1]+box[3])/2
                    if self._ignore_zones and _in_ignore_zone(cx, cy, self._ignore_zones, W, H):
                        continue
                    fb.append(box); fi.append(tid); fc.append(conf); fk.append(cls)

                if fb:
                    boxes_px  = np.stack(fb).astype(np.float32)
                    track_ids = fi; confs = fc; class_ids = fk

            # When bottle_count runs alongside a person-tracking primary:
            # split detections so each analyzer gets the right object class.
            # BottleCounter has its own IoU tracker — it only needs raw boxes.
            # ByteTrack / drink_count must only see person (class 0) boxes.
            _bottle_boxes_cur  = np.empty((0, 4), dtype=np.float32)
            _bottle_cls_cur:   list = []
            _bottle_conf_cur:  list = []
            if _bottle_alongside and len(boxes_px):
                _bc_set = set(BOTTLE_CLASSES)
                _b_mask = [c in _bc_set for c in class_ids]
                _p_mask = [c == 0        for c in class_ids]
                if any(_b_mask):
                    _bottle_boxes_cur = boxes_px[np.array(_b_mask)]
                    _bottle_cls_cur   = [c for c, m in zip(class_ids, _b_mask) if m]
                    _bottle_conf_cur  = [c for c, m in zip(confs,     _b_mask) if m]
                # Keep only person boxes in the main pipeline
                boxes_px  = boxes_px[np.array(_p_mask)] if any(_p_mask) else np.empty((0,4), dtype=np.float32)
                track_ids = [t for t, m in zip(track_ids, _p_mask) if m]
                confs     = [c for c, m in zip(confs,     _p_mask) if m]
                class_ids = [c for c, m in zip(class_ids, _p_mask) if m]

            # Skip min-age filter for bottle mode (bottles don't move, no track age warmup needed)
            if self.mode != "bottle_count":
                for tid in track_ids:
                    self._track_ages[tid] = self._track_ages.get(tid, 0) + 1
                mask      = [self._track_ages.get(t,0) >= self._min_track_age for t in track_ids]
                boxes_px  = boxes_px[mask]  if len(boxes_px)  else boxes_px
                track_ids = [t for t,m in zip(track_ids,mask) if m]
                confs     = [c for c,m in zip(confs,mask)     if m]
                class_ids = [k for k,m in zip(class_ids,mask) if m]

            if len(boxes_px):
                    # A2: IoU track re-ID — inherit state when new ID overlaps lost track
                    cur = set(track_ids)
                    just_lost     = self._prev_ids - cur
                    just_appeared = cur - self._prev_ids
                    for _tid in just_lost:
                        if _tid in self._last_boxes:
                            self._lost_boxes[_tid] = (self._last_boxes[_tid], frame_idx)
                    for _new_tid in just_appeared:
                        _ni = track_ids.index(_new_tid) if _new_tid in track_ids else -1
                        if _ni < 0 or _ni >= len(boxes_px):
                            continue
                        _new_box = boxes_px[_ni]
                        _best_old = None; _best_iou = 0.50
                        for _old_tid, (_old_box, _lf) in list(self._lost_boxes.items()):
                            if frame_idx - _lf > 60:
                                continue
                            _s = _iou(_new_box, _old_box)
                            if _s > _best_iou:
                                _best_iou = _s; _best_old = _old_tid
                        if _best_old is not None:
                            if hasattr(analyzer, 'merge_track'):
                                analyzer.merge_track(_best_old, _new_tid)
                            self._lost_boxes.pop(_best_old, None)
                    # Evict stale lost boxes
                    self._lost_boxes = {t: v for t, v in self._lost_boxes.items()
                                        if frame_idx - v[1] <= 60}
                    # Update last-known boxes for current tracks
                    for _tid, _box in zip(track_ids, boxes_px):
                        self._last_boxes[_tid] = _box

                    self._conf_sum += sum(confs); self._conf_n += len(confs)
                    self._id_switches += min(len(self._prev_ids-cur), len(cur-self._prev_ids))
                    self._prev_ids = cur

                    # Improvement 2: Adaptive confidence — lower threshold if detections are poor,
                    # slowly raise it back when quality recovers (prevents false positives persisting
                    # after a transient bad window like a lighting change or occlusion).
                    if self._adaptive_conf and len(confs) > 0:
                        self._running_conf_sum += sum(confs)
                        self._running_conf_n   += len(confs)
                        # Re-evaluate every 50 accumulated detections
                        if self._running_conf_n >= 50 and self._running_conf_n % 50 == 0:
                            rolling_avg = self._running_conf_sum / self._running_conf_n
                            if rolling_avg < 0.30 and self._conf_threshold > 0.15:
                                self._conf_threshold = max(0.15, self._conf_threshold - 0.03)
                                self.cb(0, f"Confidence threshold lowered to {self._conf_threshold:.2f} (poor detection quality)")
                            elif rolling_avg > 0.50 and self._conf_threshold < self.profile["conf"]:
                                # Slowly recover — one step per 50-detection window, max back to profile default
                                self._conf_threshold = min(self.profile["conf"], self._conf_threshold + 0.01)
                                if self._running_conf_n % 500 == 0:
                                    self.cb(0, f"Confidence threshold recovered to {self._conf_threshold:.2f}")

            t_sec     = frame_idx / fps
            # For live streams (rtsp/http sources), use wall-clock time for the
            # segment limit — the NVR may buffer frames and deliver them faster
            # than the nominal fps, causing frame_idx/fps to advance faster than
            # real time and ending the segment prematurely.
            _wall_elapsed = time.time() - t0
            _seg_elapsed  = _wall_elapsed if self.source_type == "rtsp" else t_sec
            if self._max_seconds > 0 and _seg_elapsed >= self._max_seconds:
                self.cb(95, f"Segment limit reached ({self._max_seconds:.0f}s) — stopping.")
                break
            centroids = _centroids(boxes_px)
            # Feed detections to ALL analyzers — one YOLO pass, many metrics
            evs = []
            for _m, _az in analyzers.items():
                if _az is None:
                    continue
                if _m == "bottle_count" and _bottle_alongside:
                    # Multi-mode: bottle_count gets the pre-split bottle boxes,
                    # not the person-only boxes that drink_count sees.
                    evs += _az.update(frame_idx, t_sec,
                                      _bottle_boxes_cur,
                                      _bottle_cls_cur,
                                      _bottle_conf_cur)
                else:
                    evs += self._run_analyzer(_az, frame, frame_idx, t_sec,
                                              centroids, track_ids, confs,
                                              boxes_px, class_ids,
                                              mode_override=_m)

            # Glass crossing detection — runs on cup/wine_glass detections from YOLO.
            # Physical object crossing bar line = near-zero false positive serve signal.
            # Must run BEFORE correlator so glass_serve events are enriched too.
            if _glass_detector is not None:
                # Split glass-class boxes from the full detection set
                _g_mask  = [c in {39, 40, 41} for c in class_ids]
                _g_boxes = boxes_px[np.array(_g_mask)] if any(_g_mask) else np.empty((0,4), dtype=np.float32)
                _g_cls   = [c for c, m in zip(class_ids, _g_mask) if m]
                _g_conf  = [c for c, m in zip(confs,     _g_mask) if m]
                _glass_evs = _glass_detector.update(frame_idx, t_sec, _g_boxes, _g_cls, _g_conf)

                if _glass_evs:
                    # Record stations where glass crossing just fired
                    for _gev in _glass_evs:
                        _sid = _gev.get("station_id")
                        if _sid:
                            _glass_served[_sid] = t_sec

                    # Suppress body-crossing drink_serve events for stations where
                    # glass crossing already confirmed the serve this frame —
                    # avoid double-counting the same pour.
                    _suppress_stations = {ev.get("station_id") for ev in _glass_evs}
                    evs = [
                        ev for ev in evs
                        if not (ev.get("event_type") == "drink_serve"
                                and ev.get("detection_method") != "glass_crossing"
                                and ev.get("station_id") in _suppress_stations)
                    ]
                    evs.extend(_glass_evs)

                # Also suppress body-crossing events for stations where a glass
                # crossing fired within the cooldown window (not just this frame).
                _GLASS_COOLDOWN = 4.0
                evs = [
                    ev for ev in evs
                    if not (ev.get("event_type") == "drink_serve"
                            and ev.get("detection_method") != "glass_crossing"
                            and (t_sec - _glass_served.get(ev.get("station_id",""), -999.0))
                            < _GLASS_COOLDOWN)
                ]

            # Correlate bottle pours with drink serves — enriches drink_serve events
            # in-place with drink_type, poured_oz, is_over_pour when a matching
            # pour_end event exists within the 8-second rolling buffer.
            # Also enriches glass_crossing events: matched pour → spirit/wine/beer/shot,
            # unmatched → stays "water" (no bottle involved).
            if _correlator is not None:
                evs = _correlator.process_events(evs)

            snap_dir = self.result_dir / "snapshots"
            clip_dir = self.result_dir / "clips"

            # RTSP live snapshot upload — fire-and-forget to S3 for each drink serve
            if not _save_local:
                _drink_evs = [ev for ev in evs
                              if ev.get("event_type") == "drink_serve"
                              and self._snap_count < 500]
                if _drink_evs:
                    try:
                        import concurrent.futures as _cf
                        from core.aws_sync import upload_serve_snapshot as _upload_snap
                        if self._snap_executor is None:
                            self._snap_executor = _cf.ThreadPoolExecutor(max_workers=2,
                                                                          thread_name_prefix="snap")
                        # Encode once, upload for each event (usually 1 per frame)
                        _thumb = cv2.resize(frame, (640, int(H * 640 / W)))
                        _ok, _buf = cv2.imencode('.jpg', _thumb,
                                                 [cv2.IMWRITE_JPEG_QUALITY, 75])
                        if _ok:
                            _jpg = _buf.tobytes()
                            _jid = self.job_id
                            _vid = self.ec.get("venue_id", "")
                            for _ev in _drink_evs:
                                _ts = float(_ev.get("t_sec", 0.0))
                                def _do_upload(jpg=_jpg, jid=_jid, vid=_vid, ts=_ts):
                                    key = _upload_snap(jpg, jid, ts, vid)
                                    if key:
                                        self._serve_snapshots[ts] = key
                                self._snap_executor.submit(_do_upload)
                                self._snap_count += 1
                    except Exception as _se:
                        pass  # never crash the inference loop

            for ev in evs:
                # Local snapshot and clip writing only for file-upload jobs
                if not _save_local:
                    continue

                # Snapshot (single frame)
                if self._snap_count < 60:
                    try:
                        thumb = cv2.resize(frame, (480, int(H*480/W)))
                        fname = f"{self._snap_count:03d}_{ev.get('event_type','ev')}_{ev.get('t_sec',0):.1f}s.jpg"
                        cv2.imwrite(str(snap_dir/fname), thumb, [cv2.IMWRITE_JPEG_QUALITY, 80])
                        ev["snapshot"] = fname
                    except Exception: pass
                    self._snap_count += 1

                # Video clip: pre-event buffer + 60 forward frames (~2s each side)
                if self._clip_count < 60:
                    try:
                        cfname  = f"{self._clip_count:03d}_{ev.get('event_type','ev')}_{ev.get('t_sec',0):.1f}s.mp4"
                        cpath   = str(clip_dir/cfname)
                        fourcc  = cv2.VideoWriter_fourcc(*"avc1")
                        cwriter = cv2.VideoWriter(cpath, fourcc,
                                                  max(self._clip_fps, 8.0),
                                                  (self._clip_W, self._clip_H))
                        if not cwriter.isOpened():
                            cwriter.release()
                            fourcc  = cv2.VideoWriter_fourcc(*"mp4v")
                            cwriter = cv2.VideoWriter(cpath, fourcc,
                                                  max(self._clip_fps, 8.0),
                                                  (self._clip_W, self._clip_H))
                        # Write buffered pre-event frames
                        for bf in list(self._frame_buf):
                            cwriter.write(bf)
                        # Schedule forward-frame capture
                        self._pending_clips.append({
                            "writer":     cwriter,
                            "frames_left": int(self._clip_fps * 2) + 1,  # ~2s after event
                        })
                        ev["clip"] = cfname
                        self._clip_count += 1
                    except Exception:
                        pass

            for ev in evs: writer.add_event(ev)
            writer.add_frame(t_sec, self.shift)

            # Event-driven push — fires immediately on drink/pour detections.
            # Debounced to 2s so back-to-back detections merge into one DDB write.
            # This replaces the 30s wait with sub-second latency for each serve.
            _PUSH_NOW_TYPES = {"drink_serve", "pour_end", "walk_out_alert",
                               "unknown_bottle_alert", "over_pour"}
            if (self._live_event_cb is not None
                    and self._max_seconds == 0
                    and self.source_type == "rtsp"
                    and any(e.get("event_type") in _PUSH_NOW_TYPES for e in evs)
                    and (time.time() - self._last_live_push) >= 2.0):
                try:
                    partial = self._build_summary(analyzers, t_sec, fps)
                    partial["_elapsed_sec"] = t_sec
                    # Attach cross-segment state so live_cb can persist it to disk
                    # even if the worker is killed before the job ends cleanly.
                    if "drink_count" in analyzers and analyzers["drink_count"] is not None:
                        try:
                            partial["_camera_state"] = analyzers["drink_count"].get_cross_segment_state()
                        except Exception:
                            pass
                    self._live_event_cb(partial, t_sec)
                except Exception:
                    pass
                self._last_live_push = time.time()

            # Periodic heartbeat push — fires every _live_push_interval seconds
            # even when nothing is detected (keeps headcount, elapsed time fresh).
            # Only for rtsp/http sources running continuously (max_seconds == 0)
            if (self._live_event_cb is not None
                    and self._max_seconds == 0
                    and self.source_type == "rtsp"
                    and (time.time() - self._last_live_push) >= self._live_push_interval):
                try:
                    partial = self._build_summary(analyzers, t_sec, fps)
                    partial["_elapsed_sec"] = t_sec
                    if "drink_count" in analyzers and analyzers["drink_count"] is not None:
                        try:
                            partial["_camera_state"] = analyzers["drink_count"].get_cross_segment_state()
                        except Exception:
                            pass
                    self._live_event_cb(partial, t_sec)
                except Exception:
                    pass
                self._last_live_push = time.time()

            # Track serve flashes for annotation overlay
            for ev in evs:
                if ev.get("event_type") == "drink_serve":
                    self._serve_flashes.append({
                        "bartender":   ev.get("bartender", "?"),
                        "station":     ev.get("station_id", ""),
                        "frames_left": int(fps * 3),  # show 3 seconds
                    })
            for f in self._serve_flashes:
                f["frames_left"] -= 1
            self._serve_flashes = [f for f in self._serve_flashes if f["frames_left"] > 0]

            if vout:
                vout.write(self._annotate_frame(orig_frame, boxes_px, track_ids,
                                                W, H, t_sec, self._serve_flashes))

            frame_idx += 1

            # Prune stale track ages
            if frame_idx % 150 == 0 and self._track_ages:
                active = set(track_ids)
                for t in [t for t in list(self._track_ages)
                          if t not in active and self._track_ages.get(t,0) < 5]:
                    self._track_ages.pop(t, None)

            # Per-frame timing
            _ft_ms = (time.perf_counter() - _ft_start) * 1000
            self._frame_times.append(_ft_ms)
            if len(self._frame_times) > 200:
                self._frame_times = self._frame_times[-200:]

            # Checkpoint every N processed frames (file jobs only)
            if (self.source_type != "rtsp" and
                    self._processed > 0 and
                    self._processed % self._checkpoint_every == 0):
                try:
                    self._checkpoint_file.write_text(json.dumps({
                        "frame_idx": frame_idx,
                        "processed": self._processed,
                        "dropped":   self._dropped,
                    }))
                except Exception:
                    pass

            if total_f > 0 and frame_idx % 30 == 0:
                pct  = min(5 + 90*frame_idx/total_f, 95)
                efps = self._processed / max(time.time()-t0, 0.01)
                elapsed   = time.time() - t0
                remaining = (elapsed / max(self._processed,1)) * max(total_f//stride - self._processed, 0)
                mins_left = int(remaining // 60)
                avg_ms    = sum(self._frame_times[-30:]) / max(len(self._frame_times[-30:]), 1)
                self.cb(pct, f"Frame {int(frame_idx)}/{total_f}  {efps:.1f}fps  "
                             f"~{mins_left}min left  {avg_ms:.0f}ms/frame")

        cap.release()
        if vout: vout.release()
        # Close any clip writers that didn't finish forward capture
        for pc in self._pending_clips:
            try: pc["writer"].release()
            except Exception: pass
        self._pending_clips = []

        # Remove checkpoint — job completed successfully
        try:
            if self._checkpoint_file.exists():
                self._checkpoint_file.unlink()
        except Exception:
            pass

        # Wait for any in-flight S3 snapshot uploads to finish before building final summary
        if self._snap_executor is not None:
            try:
                self._snap_executor.shutdown(wait=True, cancel_futures=False)
            except Exception:
                pass
            self._snap_executor = None

        self.cb(96, "Writing results...")
        summary = self._build_summary(analyzers, frame_idx/fps, fps)
        writer.write_all(summary)
        # Attach cross-segment state snapshot so worker_daemon can persist it
        if "drink_count" in analyzers:
            try:
                summary["_camera_state"] = analyzers["drink_count"].get_cross_segment_state()
            except Exception:
                pass
        if "table_turns" in analyzers and analyzers["table_turns"] is not None:
            try:
                existing = summary.get("_camera_state") or {}
                existing["_table_turns_state"] = analyzers["table_turns"].get_cross_segment_state()
                summary["_camera_state"] = existing
            except Exception:
                pass
        self.cb(100, "Done.")
        return summary

    def _build_analyzer(self, W, H, fps: float = 25.0, mode_override: str = None):
        ec = self.ec; mode = mode_override or self.mode
        from core.config import DISABLED_MODES as _dm
        if mode in _dm:
            return None   # mode temporarily disabled — no-op, code intact
        if mode == "drink_count":
            import copy
            rules = copy.copy(DEFAULT_RULES)
            effective_fps = max(1.0, fps / max(self.profile.get("stride", 1), 1))
            rules.serve_cooldown_frames   = max(10, int(rules.serve_cooldown_seconds * effective_fps))
            # Grace period: keep track state for 90s of video time so bartenders returning
            # from a back-room trip or long conversation still get re-assigned by zone
            rules.reappear_grace_frames   = max(100, int(effective_fps * 90))
            # Low-fps adaptation: NVR streams often deliver 2fps. Relax frame-count
            # thresholds so a serve spanning only 2-4 frames can still be detected.
            if effective_fps < 4.0:
                rules.min_prep_frames      = max(2, int(rules.min_prep_frames * effective_fps / 10))
                rules.serve_dwell_frames   = 1     # 1 frame on customer side is enough at low fps
                rules.serve_confirm_frames = 1
                rules.min_serve_score      = 0.20  # overhead/IR cameras have lower detection conf
                # NVR velocity: centroid history is populated at duplicated rate so real
                # movement per dup-frame is lower — scale threshold down proportionally.
                if effective_fps < 2.5:
                    rules.max_cross_velocity_px = max(30.0, rules.max_cross_velocity_px * 0.5)
            # Overhead camera adaptation: fisheye perspective compresses vertical motion
            # and arm-only reaches look "fast" from top-down — relax velocity and gate counts.
            if self._overhead:
                rules.max_cross_velocity_px = 150.0   # fisheye perspective inflates movement
                rules.min_prep_frames       = max(2, int(rules.min_prep_frames * 0.7))
                rules.serve_dwell_frames    = max(1, int(rules.serve_dwell_frames * 0.7))
                rules.serve_confirm_frames  = max(1, int(rules.serve_confirm_frames * 0.7))
            shift = self.shift
            if shift is None:
                # Auto-create one bartender per station from bar config
                if self.bar_config and self.bar_config.stations:
                    from core.shift import BARTENDER_COLORS
                    bartenders = [
                        {"name": st.label, "station_id": st.zone_id,
                         "color": BARTENDER_COLORS[i % len(BARTENDER_COLORS)]}
                        for i, st in enumerate(self.bar_config.stations)
                    ]
                else:
                    bartenders = [{"name": "Bartender 1", "station_id": "zone_1",
                                   "color": "#f97316"}]
                shift = ShiftManager("auto", bartenders)
                self.shift = shift  # store so _build_summary can read it
            dc = DrinkCounter(self.bar_config, shift, rules, W, H)
            # Restore cross-segment cooldown state from previous clip (if any)
            prior = self.ec.get("prior_camera_state")
            if prior:
                dc.restore_cross_segment_state(prior)
            return dc
        elif mode == "bottle_count":
            zones = ec.get("zones", [])
            polys     = [z.get("polygon", []) for z in zones] if zones else [
                [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]
            ]
            par_levels = [z.get("par_level") for z in zones] if zones else [None]
            return BottleCounter(
                zone_polys_norm   = polys,
                W                 = W,
                H                 = H,
                par_levels        = par_levels,
                standard_pour_oz  = float(ec.get("standard_pour_oz", 1.25)),
                flow_rate_oz_per_sec = float(ec.get("flow_rate_oz_per_sec", 0.75)),
            )
        elif mode == "people_count":
            lines = ec.get("lines", [])
            snapshot_interval = float(ec.get("snapshot_interval_sec", 1200))  # default 20 min
            return PeopleCounter(lines_config=lines,
                                 confirm_frames=DEFAULT_PEOPLE_RULES.entry_line_confirm,
                                 W=W, H=H,
                                 snapshot_interval_sec=snapshot_interval)
        elif mode == "table_turns":
            zones = [TableZone(table_id=t["table_id"],
                               label=t.get("label",t["table_id"]),
                               polygon_px=[(p[0]*W,p[1]*H) for p in t["polygon"]])
                     for t in ec.get("tables",[])]
            r = DEFAULT_TABLE_RULES
            tracker = TableTurnTracker(zones, r.occupied_conf_frames,
                                       r.empty_conf_frames, r.min_dwell_seconds)
            # Restore any active sessions from prior segment
            prior = self.ec.get("prior_camera_state") or {}
            prior_tt = prior.get("_table_turns_state")
            if prior_tt:
                tracker.restore_cross_segment_state(prior_tt)
            return tracker
        elif mode == "table_service":
            zones = [ServiceTableZone(table_id=t["table_id"],
                                      label=t.get("label", t["table_id"]),
                                      polygon_px=[(p[0]*W, p[1]*H) for p in t["polygon"]])
                     for t in ec.get("tables", [])]
            server_names = {}
            if self.shift:
                for b in self.shift.bartenders:
                    if hasattr(b, "track_id") and b.track_id is not None:
                        server_names[b.track_id] = b.name
            # Build bar-zone polygon in pixels so the classifier can exclude
            # bartenders (tracks that spend most of their time behind the bar).
            bar_zone_px = None
            if self.bar_config and self.bar_config.stations:
                bar_pts = []
                for st in self.bar_config.stations:
                    for p in st.polygon:
                        bar_pts.append((float(p[0]) * W, float(p[1]) * H))
                if bar_pts:
                    bar_zone_px = bar_pts
            return TableServiceTracker(
                tables=zones,
                fps=fps,
                server_names=server_names,
                unvisited_alert_min=float(ec.get("unvisited_alert_min", 15.0)),
                bar_zone_px=bar_zone_px,
            )
        elif mode == "staff_activity":
            return StaffActivityTracker(idle_threshold_sec=ec.get(
                "idle_threshold_seconds", DEFAULT_STAFF_RULES.idle_threshold_seconds))
        elif mode == "after_hours":
            return AfterHoursDetector(motion_threshold=ec.get("motion_threshold",1500.0))
        raise ValueError(f"Unknown mode: {mode}")

    def _run_analyzer(self, analyzer, frame, frame_idx, t_sec,
                      centroids, track_ids, confs, boxes_px, class_ids=None,
                      mode_override: str = None):
        if analyzer is None:
            return []   # disabled mode — skip silently
        mode = mode_override or self.mode
        if mode == "drink_count":
            return analyzer.update(frame_idx, t_sec, centroids, track_ids, confs,
                                   boxes=boxes_px if len(boxes_px) else None)
        elif mode == "bottle_count":
            return analyzer.update(frame_idx, t_sec, boxes_px, class_ids or [], confs)
        elif mode in ("people_count", "table_turns", "table_service", "staff_activity"):
            return analyzer.update(frame_idx, t_sec, centroids, track_ids)
        elif mode == "after_hours":
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            return analyzer.update_frame(frame_idx, t_sec, gray, len(track_ids))
        return []

    def _build_summary(self, analyzers, total_sec, fps):
        """
        Build summary from all analyzers (dict of mode -> analyzer).
        When multiple modes are active, all results are merged into one summary dict.
        """
        avg_conf    = self._conf_sum / max(self._conf_n, 1)
        switch_rate = self._id_switches / max(self._processed, 1)
        warnings = []
        if avg_conf < 0.45:
            warnings.append("LOW_CONFIDENCE: check lighting or camera angle")
        if switch_rate > 0.05:
            warnings.append("HIGH_ID_SWITCHES: try 'accurate' profile")
        if self._screen_recording_warning:
            warnings.append(self._screen_recording_warning)

        avg_frame_ms = (sum(self._frame_times) / max(len(self._frame_times), 1)
                        if self._frame_times else 0.0)
        quality = {"avg_detection_conf":      round(avg_conf, 4),
                   "tracking_switch_rate":    round(switch_rate, 4),
                   "dropped_frames":          self._dropped,
                   "processed_frames":        self._processed,
                   "warnings":                warnings,
                   "adapted_conf_threshold":  round(self._conf_threshold, 3),
                   "night_mode_detected":     self._night_mode,
                   "avg_frame_ms":            round(avg_frame_ms, 1),
                   "rtsp_errors":             self._rtsp_errors + self._rtsp_timeouts,
                   "resumed_from_frame":      self._resumed_from}

        b = {"mode":         self.mode,
             "modes":        self.modes,          # all active modes
             "video_seconds": round(total_sec, 1),
             "quality":       quality,
             "snap_count":    self._snap_count,
             "heatmap_generated": False,
             "serve_snapshots": dict(self._serve_snapshots)}

        if self._angle_info:
            b["camera_angle"] = self._angle_info

        # Collect results from every active mode
        for mode, analyzer in analyzers.items():
            if analyzer is None:
                continue   # disabled mode — skip
            if mode == "drink_count":
                _glass_rpt = (getattr(self, "_glass_detector", None) or
                              object()).__class__.__name__  # safe no-op default
                _glass_rpt = (getattr(self, "_glass_detector").quality_report()
                              if getattr(self, "_glass_detector", None) else {})
                b.update({"bartenders":    self.shift.summary(total_sec) if self.shift else {},
                          "drink_quality": {**analyzer.quality_report(), **_glass_rpt},
                          "review_events": [
                              {"t_sec": e["t_sec"], "serve_score": e["serve_score"],
                               "station_id": e["station_id"], "track_id": e["track_id"],
                               "review_reason": e["review_reason"],
                               "snapshot": e.get("snapshot"), "clip": e.get("clip")}
                              for e in analyzer._review_events
                          ]})
            elif mode == "bottle_count":
                b["bottles"] = analyzer.summary()
                # Include pour-serve correlation stats when both modes ran together
                if getattr(self, "_correlator", None) is not None:
                    b["pour_correlation"] = self._correlator.summary()
            elif mode == "people_count":
                b.update({"people":        analyzer.summary(total_sec),
                          "occupancy_log": analyzer.occupancy_log})
            elif mode == "table_turns":
                b["tables"] = analyzer.summary()
            elif mode == "table_service":
                analyzer.flush(total_sec)   # close any open visits at end of video
                full = analyzer.summary()
                b["table_service"] = full
                b["tableVisitsByStaff"] = full.get("__leaderboard__", [])
            elif mode == "staff_activity":
                b.update({"staff":         analyzer.summary(total_sec),
                          "headcount_log": analyzer.headcount_log})
            elif mode == "after_hours":
                b["motion"] = analyzer.summary()
        return b

    def _annotate_frame(self, frame, boxes, track_ids, W, H,
                        t_sec: float = 0.0, serve_flashes: list = None):
        ann = frame.copy()

        # ── Bar lines + station labels ──────────────────────────────────────
        if self.bar_config:
            for st in self.bar_config.stations:
                p1 = (int(st.bar_line_p1[0]*W), int(st.bar_line_p1[1]*H))
                p2 = (int(st.bar_line_p2[0]*W), int(st.bar_line_p2[1]*H))
                cv2.line(ann, p1, p2, (0, 230, 255), 2)   # cyan bar line
                mid = ((p1[0]+p2[0])//2, (p1[1]+p2[1])//2)
                cv2.putText(ann, st.label, (mid[0]+6, mid[1]),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0,230,255), 1)

        # ── Bounding boxes + bartender labels + drink counter ───────────────
        for i, box in enumerate(boxes):
            x1,y1,x2,y2 = int(box[0]),int(box[1]),int(box[2]),int(box[3])
            tid   = track_ids[i] if i < len(track_ids) else "?"
            label = f"#{tid}"; color = (0,200,0); rec = None
            if self.shift:
                rec = self.shift.track_to_bartender(
                    int(tid) if str(tid).isdigit() else -1)
                if rec:
                    label = rec.name
                    try:
                        c = tuple(int(rec.color.lstrip("#")[k:k+2], 16) for k in (0,2,4))
                        color = (c[2], c[1], c[0])
                    except Exception:
                        pass
            cv2.rectangle(ann, (x1,y1), (x2,y2), color, 2)

            pad = 4
            fs  = 0.55
            if rec:
                # Running drink count up to the current video timestamp
                drinks_so_far = sum(1 for t in rec.drink_timestamps if t <= t_sec)
                count_text = f"{drinks_so_far} drink{'s' if drinks_so_far != 1 else ''}"
                (nw, nh), _ = cv2.getTextSize(label,      cv2.FONT_HERSHEY_SIMPLEX, fs, 1)
                (cw, ch), _ = cv2.getTextSize(count_text, cv2.FONT_HERSHEY_SIMPLEX, fs, 1)
                lw = max(nw, cw) + pad * 2
                # ── Name row (colored background) just above box ──────────
                name_top = y1 - nh - pad * 2
                cv2.rectangle(ann, (x1, name_top), (x1 + lw, y1), color, -1)
                cv2.putText(ann, label, (x1 + pad, y1 - pad),
                            cv2.FONT_HERSHEY_SIMPLEX, fs, (255, 255, 255), 1)
                # ── Drink counter badge (dark bg, teal text) above name ───
                count_top = name_top - ch - pad * 2
                cv2.rectangle(ann, (x1, count_top), (x1 + lw, name_top), (15, 15, 15), -1)
                cv2.rectangle(ann, (x1, count_top), (x1 + lw, name_top), color, 1)
                cv2.putText(ann, count_text, (x1 + pad, name_top - pad),
                            cv2.FONT_HERSHEY_SIMPLEX, fs, (0, 230, 200), 1)
            else:
                # Unknown track — show track ID only
                (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, fs, 1)
                cv2.rectangle(ann, (x1, y1 - th - pad * 2), (x1 + tw + pad, y1), color, -1)
                cv2.putText(ann, label, (x1 + 2, y1 - pad),
                            cv2.FONT_HERSHEY_SIMPLEX, fs, (255, 255, 255), 1)

        # ── Serve event flash banners (top of frame) ─────────────────────
        if serve_flashes:
            y_off = 10
            for flash in serve_flashes:
                alpha  = min(flash["frames_left"] / max(10, 1), 1.0)
                name   = flash["bartender"]
                # semi-transparent dark panel
                panel_h = 40; panel_w = 280
                overlay = ann.copy()
                cv2.rectangle(overlay, (10, y_off), (10+panel_w, y_off+panel_h),
                              (10,10,10), -1)
                cv2.addWeighted(overlay, 0.6*alpha, ann, 1-0.6*alpha, 0, ann)
                text = f"  +1 DRINK  {name}"
                cv2.putText(ann, text, (18, y_off+27),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255,165,0), 2)
                y_off += panel_h + 6

        # ── Timestamp bottom-right ───────────────────────────────────────
        mins, secs = divmod(int(t_sec), 60)
        ts_label = f"{mins:02d}:{secs:02d}"
        (tw, th), _ = cv2.getTextSize(ts_label, cv2.FONT_HERSHEY_SIMPLEX, 0.65, 2)
        cv2.rectangle(ann, (W-tw-14, H-th-14), (W-2, H-2), (0,0,0), -1)
        cv2.putText(ann, ts_label, (W-tw-10, H-8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (200,200,200), 2)

        return ann
