"""
NVR playback URL builder + ffmpeg bridge for the Worker Tester.

The Blind Goat NVR (custom Vue.js webpackSPA build, version 1.3.1.47) exposes
historical footage via the SAME path as the live stream, with a `starttime`
query parameter:

    http://{nvr_host}/hls/live/{channel}/0/livetop.mp4?starttime={ISO_8601}

Quirks of this NVR's playback delivery:
  - No auth required (live and playback are both anonymous)
  - HEVC 2560x1944 (Bento4-repackaged) vs Lavf-encoded live H264
  - Each HTTP response delivers ~1.8-4s of video then closes the connection
  - On reconnect, the server REPLAYS from the same starttime — so naive
    ffmpeg `-reconnect_at_eof` causes duplicate frames

Phase 2 (this module) gives us:
  - URL builder
  - Single-fragment ffmpeg bridge for *manual* per-fragment use

Phase 3 (planned) will add a smart-reconnect loop that:
  - Tracks the wall-clock seconds of video we've consumed so far
  - On each EOF, recomputes starttime = original_start + consumed_seconds
  - Spawns a fresh ffmpeg per fragment, appending to the same local HLS
    manifest with monotonic media-sequence numbers
  - Worker reads the growing manifest the same as any live HLS feed

Config carried on the venue record (nvrPlaybackTemplate) so each venue
can carry its own URL pattern as we onboard more vendors.
"""

from __future__ import annotations
import os
import shutil
import subprocess
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, urlencode

log = logging.getLogger(__name__)

# Default URL template used when the venue record carries no override.
# Tested working against The Blind Goat NVR on 2026-04-27.
DEFAULT_PLAYBACK_TEMPLATE = (
    # Sub-stream (1) instead of main (0) — matches what the live worker
    # actually consumes for floor + bar cams. Lower resolution = faster
    # decode + smaller model fits the data, so test runs at realtime.
    #
    # &duration=300 hint: empirically the NVR honors duration as a "give
    # me a long fragment" hint, returning 8-12s of video per request
    # instead of the default ~1.8s. Drops fragment count by 6× and brings
    # replay download to ~0.8× realtime (close enough to minute-for-minute).
    "http://{host}:{port}/hls/live/{channel}/1/livetop.mp4?starttime={start}&duration=300"
)


def build_playback_url(
    live_url: str,
    start: datetime,
    *,
    template: str = DEFAULT_PLAYBACK_TEMPLATE,
) -> str:
    """Construct the playback URL from a known live URL and a start time.

    The live URL provides host:port + channel/stream identity. We extract
    the channel (e.g. CH1) from the live path and substitute it into the
    template alongside the host/port from the live URL and the requested
    start time.

    Example:
        build_playback_url(
            "http://108.191.193.107:15007/hls/live/CH1/0/livetop.mp4",
            datetime(2026, 4, 25, 19, 0, tzinfo=timezone.utc),
        )
        -> "http://108.191.193.107:15007/hls/live/CH1/0/livetop.mp4?starttime=2026-04-25T19:00:00"
    """
    u = urlparse(live_url)
    host = u.hostname or ""
    port = u.port or 80
    # Extract channel from path: /hls/live/CH1/0/livetop.mp4 → CH1
    parts = [p for p in u.path.split("/") if p]
    channel = parts[2] if len(parts) >= 3 else "CH1"
    start_iso = start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    return template.format(host=host, port=port, channel=channel, start=start_iso)


# ── ffmpeg bridge ───────────────────────────────────────────────────────

def _have_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def spawn_ffmpeg_bridge(
    playback_url: str,
    out_dir: Path,
    *,
    duration_sec: int,
    segment_sec: int = 4,
    log_path: Optional[Path] = None,
) -> subprocess.Popen:
    """Launch an ffmpeg subprocess that consumes the NVR playback stream and
    writes an HLS manifest (`index.m3u8`) + fMP4 segments into `out_dir`.

    The worker then reads `out_dir/index.m3u8` exactly the way it reads any
    other HLS stream — same _HLSCapture path, no special-casing.

    We rely on:
      - `-reconnect 1 -reconnect_at_eof 1` to handle the NVR closing the
        connection after each fragment
      - `-t {duration}` to stop at the requested replay window
      - HEVC re-encoded to H.264 (worker pipeline trained on H.264) — this
        uses a tiny amount of CPU on the droplet but lets us drop in
        without retraining

    Returns the Popen handle so callers can monitor / terminate.
    """
    if not _have_ffmpeg():
        raise RuntimeError("ffmpeg not found on PATH")

    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = out_dir / "index.m3u8"

    cmd = [
        "ffmpeg",
        "-loglevel", "warning",
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_at_eof", "1",
        "-reconnect_delay_max", "5",
        "-i", playback_url,
        "-t", str(duration_sec),
        # HEVC -> H.264 (libx264 ultrafast preset is enough for re-mux level CPU).
        # If the source is already H.264 (some channels), libx264 is still cheap.
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26",
        "-an",  # drop audio entirely; worker doesn't use it
        "-f", "hls",
        "-hls_time", str(segment_sec),
        "-hls_list_size", "0",            # keep all segments in manifest
        "-hls_segment_type", "fmp4",
        "-hls_flags", "independent_segments",
        str(manifest),
    ]

    log_fh = open(log_path, "wb") if log_path else subprocess.DEVNULL
    log.info("[nvr_playback] ffmpeg bridge: %s -> %s (%ds)", playback_url, manifest, duration_sec)
    return subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=log_fh if log_path else subprocess.DEVNULL,
    )


def replay_local_url(out_dir: Path) -> str:
    """The local URL the worker uses to consume the bridged playback stream.

    Workers receive a `source_type='hls'` job pointing at this URL.
    """
    return "file://" + str((out_dir / "index.m3u8").resolve())
