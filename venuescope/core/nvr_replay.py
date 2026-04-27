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

    def __init__(self, out_dir: Path, *, segment_target_w: int = 1280):
        self.out_dir = out_dir
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.manifest = out_dir / "index.m3u8"
        self.target_w = segment_target_w
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

        cmd = [
            "ffmpeg", "-y",
            "-loglevel", "error",
            "-i", str(frag_mp4),
            "-vf", f"scale={self.target_w}:-2",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26",
            "-an",
            "-f", "mpegts",
            str(out_ts),
        ]
        rc = subprocess.run(cmd, capture_output=True).returncode
        if rc != 0:
            log.error("[nvr_replay] ffmpeg transcode failed for %s", frag_mp4)
        else:
            self._write_manifest(end=False)
        return out_ts

    def finalize(self):
        """Mark the manifest as VOD-complete so pyav stops at #EXT-X-ENDLIST."""
        self._write_manifest(end=True)


# ── Main download loop ──────────────────────────────────────────────────

def _run_replay(job: ReplayJob) -> None:
    log.info("[nvr_replay] starting %s -> %s (%.0fs window)",
             job.start_dt.isoformat(), job.end_dt.isoformat(),
             (job.end_dt - job.start_dt).total_seconds())

    target_sec = (job.end_dt - job.start_dt).total_seconds()
    job.progress.target_sec = target_sec

    writer = _HlsManifestWriter(job.out_dir)
    frag_dir = job.out_dir / "frags"
    frag_dir.mkdir(exist_ok=True)

    consumed = 0.0
    fragment_idx = 0
    consecutive_zero = 0

    while not job._stop.is_set() and consumed < target_sec:
        current_dt = job.start_dt + timedelta(seconds=consumed)
        url = build_playback_url(job.live_url, current_dt)
        job.progress.last_starttime = current_dt.isoformat()

        frag_path = frag_dir / f"frag_{fragment_idx:05d}.mp4"
        try:
            n_bytes = _fetch_fragment(url, frag_path)
        except Exception as e:
            log.error("[nvr_replay] fetch failed at %s: %s", current_dt, e)
            job.progress.error = f"fetch: {e}"
            time.sleep(2.0)
            continue
        job.progress.bytes_downloaded += n_bytes

        dur = _probe_fragment_duration(frag_path)
        if dur <= 0.1:
            consecutive_zero += 1
            log.warning("[nvr_replay] zero-duration fragment at %s (idx=%d, run=%d)",
                        current_dt, fragment_idx, consecutive_zero)
            if consecutive_zero >= 5:
                job.progress.error = "5 consecutive zero-duration fragments — likely no recording"
                break
            time.sleep(1.0)
            consumed += 1.0  # nudge forward to escape gaps
            continue
        consecutive_zero = 0

        writer.append_fragment(frag_path, dur)
        consumed += dur
        fragment_idx += 1
        job.progress.consumed_sec = consumed
        job.progress.fragments = fragment_idx
        if job.on_progress:
            try: job.on_progress(job.progress)
            except Exception: pass

    writer.finalize()
    job.progress.finished = True
    log.info("[nvr_replay] done — %d fragments, %.1fs of footage, %.1f MB",
             fragment_idx, consumed, job.progress.bytes_downloaded / 1_000_000)


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
