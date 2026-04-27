"""
Smart-reconnect NVR playback bridge for Worker Tester replays.

The Blind Goat NVR closes the connection after each ~1.8-4s playback
fragment AND replays from the same starttime on naive reconnect. This
module solves both by running a Python download loop that:

  1. Fetches one fragment via HTTP GET with starttime=t
  2. Probes its actual duration with PyAV
  3. Advances t by the fragment duration
  4. Re-fetches; repeat until end_time reached
  5. Each fragment is appended (transcoded to fMP4) into a local HLS manifest

The worker reads the growing local HLS manifest the same way it reads any
live RTSP/HLS feed — pyav-based _HLSCapture handles the manifest refresh
so as the downloader appends segments, the worker keeps consuming frames.

This preserves the worker's stateful pipelines (ByteTrack, DrinkCounter,
BartenderRegistry) across the entire replay window — exactly the same
behavior as a live shift.
"""

from __future__ import annotations
import os
import time
import shutil
import subprocess
import threading
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Callable

from .nvr_playback import build_playback_url

log = logging.getLogger(__name__)


@dataclass
class ReplayProgress:
    """Snapshot of where the replay is — surfaced live to the admin UI."""
    consumed_sec:    float = 0.0     # video seconds delivered to worker so far
    target_sec:      float = 0.0     # total seconds of footage requested
    fragments:       int   = 0
    bytes_downloaded:int   = 0
    last_starttime:  str   = ""
    error:           Optional[str] = None
    finished:        bool  = False

    @property
    def percent(self) -> float:
        if self.target_sec <= 0: return 0.0
        return min(100.0, (self.consumed_sec / self.target_sec) * 100.0)


@dataclass
class ReplayJob:
    live_url:   str            # any live URL from the same NVR (used to build playback URL)
    start_dt:   datetime       # UTC start of replay window
    end_dt:     datetime       # UTC end of replay window
    out_dir:    Path           # where to write the local HLS manifest + segments
    on_progress: Optional[Callable[[ReplayProgress], None]] = None

    # internals
    progress: ReplayProgress = field(default_factory=ReplayProgress)
    _stop:    threading.Event = field(default_factory=threading.Event)
    _thread:  Optional[threading.Thread] = None


# ── HTTP fragment fetch ─────────────────────────────────────────────────

def _fetch_fragment(url: str, out_path: Path, *, timeout: float = 30.0) -> int:
    """Download one playback fragment to disk. Returns bytes written.

    The NVR signals end-of-fragment by closing the connection mid-stream,
    which the requests library raises as ConnectionResetError or
    ChunkedEncodingError. We treat this as "fragment complete" and keep
    whatever bytes we already received — that's the actual fragment.
    """
    import requests
    from requests.exceptions import ChunkedEncodingError, ConnectionError as RequestsConnectionError
    bytes_written = 0
    # Fresh session per fetch — the NVR closing the connection poisons
    # any pooled keep-alive sockets we might reuse.
    sess = requests.Session()
    try:
        r = sess.get(url, stream=True, timeout=timeout)
        r.raise_for_status()
        with open(out_path, "wb") as fh:
            try:
                for chunk in r.iter_content(65536):
                    if not chunk:
                        break
                    fh.write(chunk)
                    bytes_written += len(chunk)
            except (ChunkedEncodingError, RequestsConnectionError, ConnectionResetError) as e:
                # Server closed mid-stream — that's the fragment boundary.
                # Anything we have on disk is a complete fragment up to that point.
                if bytes_written == 0:
                    raise  # genuinely failed, no data
                log.debug("[nvr_replay] fragment ended via connection close: %s (%d bytes)",
                          type(e).__name__, bytes_written)
        r.close()
    finally:
        sess.close()
    return bytes_written


def _probe_fragment_duration(path: Path) -> float:
    """Return the playable duration of a single MP4 fragment in seconds."""
    import av
    try:
        c = av.open(str(path))
        try:
            if c.duration:
                return float(c.duration) / 1_000_000.0
            # Fallback: walk the video stream for last pts
            stream = c.streams.video[0]
            last_pts = 0.0
            for pkt in c.demux(stream):
                if pkt.pts is not None:
                    last_pts = float(pkt.pts * pkt.time_base)
            return last_pts
        finally:
            c.close()
    except Exception as e:
        log.warning("[nvr_replay] probe failed for %s: %s", path, e)
        return 0.0


# ── HLS manifest writer ─────────────────────────────────────────────────

class _HlsManifestWriter:
    """Maintains a growing index.m3u8 + numbered fMP4 segments.

    Uses ffmpeg per fragment to transcode the NVR's HEVC-2K to H264-720p
    (same downsizing the live worker pipeline already uses). This keeps
    YOLO's preprocessing path simple and bounds CPU on the droplet.
    """

    def __init__(self, out_dir: Path, *, segment_target_w: int = 1280, remux_only: bool = True):
        """Default is REMUX (codec-copy). Re-encoding lost too much detection
        signal in tests — detected drinks at peak hour dropped from 1 → 0.

        Per-fragment fallback: if remux fails (some HEVC fragments have
        malformed extradata that ffmpeg refuses), we retry that single
        fragment with libx264 re-encode at native resolution. Mixed-codec
        manifests work fine in the worker's pyav reader.
        """
        self.out_dir = out_dir
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.manifest = out_dir / "index.m3u8"
        self.target_w = segment_target_w
        self.remux_only = remux_only
        self._seq = 0
        # Bootstrap the manifest with a header that worker pyav can open.
        self._write_manifest(end=False)

    def _write_manifest(self, *, end: bool):
        lines = [
            "#EXTM3U",
            "#EXT-X-VERSION:3",
            "#EXT-X-TARGETDURATION:6",
            "#EXT-X-MEDIA-SEQUENCE:0",
            "#EXT-X-PLAYLIST-TYPE:VOD",
        ]
        for seq, dur in self._segments():
            lines.append(f"#EXTINF:{dur:.3f},")
            lines.append(f"seg_{seq:05d}.ts")
        if end:
            lines.append("#EXT-X-ENDLIST")
        self.manifest.write_text("\n".join(lines) + "\n")

    def _segments(self):
        """Yield (seq, duration) for every segment we've written so far."""
        for p in sorted(self.out_dir.glob("seg_*.ts.dur")):
            seq = int(p.stem.split("_")[1].split(".")[0])
            try:
                dur = float(p.read_text().strip())
            except ValueError:
                dur = 0.0
            yield seq, dur

    def append_fragment(self, frag_mp4: Path, frag_duration: float) -> Path:
        """Transcode an MP4 fragment to a TS segment + update the manifest."""
        seq = self._seq
        self._seq += 1
        out_ts = self.out_dir / f"seg_{seq:05d}.ts"
        # Persist duration sidecar for manifest regen
        (self.out_dir / f"seg_{seq:05d}.ts.dur").write_text(f"{frag_duration:.3f}")

        remux_cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(frag_mp4),
            "-c", "copy", "-an",
            "-f", "mpegts",
            str(out_ts),
        ]
        reencode_cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(frag_mp4),
            # Native resolution preserves detection signal for night-mode
            # YOLO; the worker resizes internally to imgsz anyway.
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
            "-an",
            "-f", "mpegts",
            str(out_ts),
        ]

        rc = -1
        if self.remux_only:
            rc = subprocess.run(remux_cmd, capture_output=True).returncode
            if rc != 0:
                # Retry with re-encode for this single fragment
                log.warning("[nvr_replay] remux failed for %s, retrying with re-encode",
                            frag_mp4.name)
                rc = subprocess.run(reencode_cmd, capture_output=True).returncode
        else:
            rc = subprocess.run(reencode_cmd, capture_output=True).returncode

        if rc != 0:
            log.error("[nvr_replay] ffmpeg transcode failed for %s (both remux + re-encode)",
                      frag_mp4)
        else:
            self._write_manifest(end=False)
        return out_ts

    def finalize(self):
        """Mark the manifest as VOD-complete so pyav stops at #EXT-X-ENDLIST."""
        self._write_manifest(end=True)


# ── Main download loop ──────────────────────────────────────────────────

_PARALLEL_WORKERS = int(os.environ.get("VS_REPLAY_PARALLEL", "4"))
# 30s is the sweet spot: small enough that NVR's variable delivery
# (5s-88s per request) doesn't leave large gaps in coverage, large
# enough that we don't waste bandwidth on heavy overlap. Earlier
# chunk_sec=60 left 55s gaps when NVR returned a tiny 5s fragment;
# at chunk_sec=30 the worst-case gap is 25s, and the engine's
# stateful analyzers tolerate that without losing tracks.
_CHUNK_SEC        = int(os.environ.get("VS_REPLAY_CHUNK_SEC", "30"))


def _run_replay(job: ReplayJob) -> None:
    """Parallel-fetch replay loop.

    Issues N concurrent requests at staggered offsets (0s, 10s, 20s, 30s, ...
    where 10s is the conservative chunk size — NVR caps each response at
    ~12s of video). Fragments arrive out of order over the wire but are
    appended to the HLS manifest in starttime order. Net throughput on
    Blind Goat NVR: ~3-4× single-stream rate, hitting 1:1 or faster realtime.

    Sequential fetch is still available via VS_REPLAY_PARALLEL=1 env var.
    """
    from concurrent.futures import ThreadPoolExecutor

    target_sec = (job.end_dt - job.start_dt).total_seconds()
    log.info("[nvr_replay] starting %s -> %s (%.0fs window, parallel=%d, chunk=%ds)",
             job.start_dt.isoformat(), job.end_dt.isoformat(),
             target_sec, _PARALLEL_WORKERS, _CHUNK_SEC)

    job.progress.target_sec = target_sec
    writer = _HlsManifestWriter(job.out_dir)
    frag_dir = job.out_dir / "frags"
    frag_dir.mkdir(exist_ok=True)

    # Pre-compute chunk offsets so workers grab different starttimes
    chunks = []
    t = 0.0
    while t < target_sec:
        chunks.append(t)
        t += _CHUNK_SEC

    def _fetch_chunk(idx: int, offset_sec: float):
        """Fetch one chunk, return (idx, path, duration, bytes)."""
        if job._stop.is_set():
            return (idx, None, 0.0, 0)
        current_dt = job.start_dt + timedelta(seconds=offset_sec)
        url = build_playback_url(job.live_url, current_dt)
        path = frag_dir / f"frag_{idx:05d}.mp4"
        try:
            n_bytes = _fetch_fragment(url, path)
        except Exception as e:
            log.warning("[nvr_replay] fetch idx=%d failed: %s", idx, e)
            return (idx, None, 0.0, 0)
        dur = _probe_fragment_duration(path)
        return (idx, path, dur, n_bytes)

    completed: Dict[int, tuple] = {}
    next_to_append = 0
    fragments_count = 0
    bytes_total = 0

    with ThreadPoolExecutor(max_workers=_PARALLEL_WORKERS) as ex:
        futures = [ex.submit(_fetch_chunk, idx, offset)
                   for idx, offset in enumerate(chunks)]
        for fut in futures:
            if job._stop.is_set():
                break
            idx, path, dur, n_bytes = fut.result()
            completed[idx] = (path, dur)
            bytes_total += n_bytes
            job.progress.bytes_downloaded = bytes_total
            # Append any contiguous completed fragments to the manifest IN
            # ORDER so engine sees a clean monotonic stream.
            while next_to_append in completed:
                p, d = completed.pop(next_to_append)
                if p is not None and d > 0.1:
                    writer.append_fragment(p, d)
                    fragments_count += 1
                next_to_append += 1
                job.progress.fragments  = fragments_count
                job.progress.consumed_sec = min(next_to_append * _CHUNK_SEC, target_sec)
                if job.on_progress:
                    try: job.on_progress(job.progress)
                    except Exception: pass

    writer.finalize()
    job.progress.consumed_sec = target_sec
    job.progress.finished = True
    log.info("[nvr_replay] done — %d fragments, %.0fs of footage, %.1f MB",
             fragments_count, target_sec, bytes_total / 1_000_000)


def start_replay(job: ReplayJob) -> ReplayJob:
    """Kick off the replay download in a background thread. Returns the
    job handle; caller can poll job.progress or call stop_replay()."""
    if job._thread and job._thread.is_alive():
        raise RuntimeError("replay already running")
    job._stop.clear()
    job._thread = threading.Thread(target=_run_replay, args=(job,), daemon=True)
    job._thread.start()
    return job


def stop_replay(job: ReplayJob, *, timeout: float = 5.0) -> None:
    job._stop.set()
    if job._thread:
        job._thread.join(timeout=timeout)


def manifest_url(job: ReplayJob) -> str:
    """The URL the worker uses to consume the bridged playback. Local-only."""
    return "file://" + str((job.out_dir / "index.m3u8").resolve())
