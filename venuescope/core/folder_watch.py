"""
VenueScope — DVR folder watcher.

Polls a directory for new video files (mp4, avi, mov, mkv, ts) and
auto-submits them as analysis jobs.  Designed for DVR/NVR systems that
drop recordings into a shared folder.

Features:
  - Polling-based (no inotify/fsevents deps — pure stdlib)
  - Stability check: file size must be unchanged for N seconds before submit
    (ensures the DVR has finished writing before we read it)
  - State persisted to ~/.venuescope/folder_watch_state.json so seen files
    survive restarts without re-submitting
  - Per-folder configuration: analysis mode, model profile, optional bar config

Usage (embedded in worker_daemon.py):
    from core.folder_watch import get_watcher, FolderWatchConfig
    cfg = FolderWatchConfig(path="/mnt/dvr/bar", mode="drink_count")
    watcher = get_watcher()
    watcher.add_folder(cfg)
    watcher.start()   # background thread; call once

Usage (standalone):
    python -m core.folder_watch /mnt/dvr/bar
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

log = logging.getLogger("folder_watch")

_VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".ts", ".m4v", ".wmv"}
_STABILITY_SECONDS = 5.0    # file size must be unchanged for this long
_DEFAULT_POLL_SEC  = 15.0   # poll interval in seconds
_STATE_PATH        = Path.home() / ".venuescope" / "folder_watch_state.json"


@dataclass
class FolderWatchConfig:
    path:          str
    mode:          str   = "drink_count"
    model_profile: str   = "balanced"
    config_path:   Optional[str] = None
    annotate:      bool  = False
    poll_seconds:  float = _DEFAULT_POLL_SEC
    folder_id:     str   = field(default_factory=lambda: str(uuid.uuid4())[:8])
    label_prefix:  str   = ""   # prepended to clip_label; defaults to folder basename

    def label(self) -> str:
        prefix = self.label_prefix or Path(self.path).name
        return f"📂 {prefix}"


class FolderWatcher:
    """
    Manages per-folder polling threads.  Use the module-level singleton
    returned by get_watcher() rather than instantiating directly.
    """

    def __init__(self):
        self._folders: dict[str, FolderWatchConfig] = {}   # folder_id → config
        self._threads: dict[str, threading.Thread]  = {}
        self._stops:   dict[str, threading.Event]   = {}
        self._lock     = threading.Lock()
        self._state    = _load_state()

    # ── Public API ────────────────────────────────────────────────────────────

    def add_folder(self, cfg: FolderWatchConfig) -> str:
        """Register a folder and start watching it. Returns folder_id."""
        with self._lock:
            # Dedup by path
            for existing in self._folders.values():
                if existing.path == cfg.path:
                    log.info(f"[folder_watch] Already watching {cfg.path}")
                    return existing.folder_id
            self._folders[cfg.folder_id] = cfg
            self._start_thread(cfg)
            _save_state(self._state)
            log.info(f"[folder_watch] Watching {cfg.path} (id={cfg.folder_id})")
        return cfg.folder_id

    def remove_folder(self, folder_id: str):
        """Stop watching a folder."""
        with self._lock:
            stop = self._stops.pop(folder_id, None)
            if stop:
                stop.set()
            self._threads.pop(folder_id, None)
            self._folders.pop(folder_id, None)
            log.info(f"[folder_watch] Stopped watching folder {folder_id}")

    def list_folders(self) -> list[dict]:
        """Return current watcher configs as dicts."""
        with self._lock:
            return [
                {**asdict(cfg), "alive": self._threads.get(cfg.folder_id, threading.Thread()).is_alive()}
                for cfg in self._folders.values()
            ]

    def start(self):
        """Start watching all registered folders (used after bulk add_folder calls)."""
        # Threads are started in add_folder; this is a no-op kept for API clarity.
        pass

    def stop_all(self):
        with self._lock:
            for stop in self._stops.values():
                stop.set()
            self._threads.clear()
            self._stops.clear()
            self._folders.clear()

    # ── Internal ─────────────────────────────────────────────────────────────

    def _start_thread(self, cfg: FolderWatchConfig):
        """Must be called with self._lock held."""
        stop = threading.Event()
        t    = threading.Thread(
            target=self._watch_loop,
            args=(cfg, stop),
            daemon=True,
            name=f"watch-{cfg.folder_id}",
        )
        self._stops[cfg.folder_id]   = stop
        self._threads[cfg.folder_id] = t
        t.start()

    def _watch_loop(self, cfg: FolderWatchConfig, stop: threading.Event):
        """Polling loop for one folder."""
        log.info(f"[folder_watch] Loop started for '{cfg.path}'")
        # pending_files: path_str → (first_seen_size, first_seen_time)
        pending: dict[str, tuple[int, float]] = {}

        while not stop.is_set():
            try:
                self._poll(cfg, pending)
            except Exception as e:
                log.error(f"[folder_watch] Error polling '{cfg.path}': {e}")
            stop.wait(cfg.poll_seconds)

        log.info(f"[folder_watch] Loop stopped for '{cfg.path}'")

    def _poll(self, cfg: FolderWatchConfig, pending: dict):
        folder = Path(cfg.path)
        if not folder.exists():
            log.warning(f"[folder_watch] Folder '{cfg.path}' does not exist — waiting")
            return

        seen_in_state = self._state.get("seen_files", {})
        now = time.time()

        for fpath in folder.iterdir():
            if fpath.suffix.lower() not in _VIDEO_EXTENSIONS:
                continue
            key = str(fpath.resolve())

            # Already processed?
            if key in seen_in_state:
                continue

            try:
                size = fpath.stat().st_size
            except OSError:
                continue

            if key not in pending:
                pending[key] = (size, now)
                log.debug(f"[folder_watch] New file detected: {fpath.name} ({size} bytes)")
                continue

            prev_size, first_seen = pending[key]
            if size != prev_size:
                # File is still being written — update size
                pending[key] = (size, now)
                continue

            # Size has been stable since first_seen
            elapsed = now - first_seen
            if elapsed < _STABILITY_SECONDS:
                continue

            # File is stable — submit as job
            log.info(f"[folder_watch] Stable file — submitting: {fpath.name}")
            job_id = self._submit(fpath, cfg)
            if job_id:
                seen_in_state[key] = {"job_id": job_id, "submitted_at": now}
                _save_state(self._state)
            pending.pop(key, None)

    def _submit(self, fpath: Path, cfg: FolderWatchConfig) -> Optional[str]:
        """Create a job for this video file. Returns job_id or None."""
        try:
            from core.database import create_job, _raw_update
        except ImportError as e:
            log.error(f"[folder_watch] Cannot import database: {e}")
            return None

        # Parse multi-mode string
        parts = [m.strip() for m in cfg.mode.split(",") if m.strip()]
        primary_mode = parts[0] if parts else "drink_count"
        extra_modes  = parts[1:] if len(parts) > 1 else []

        jid   = str(uuid.uuid4())[:8]
        label = f"{cfg.label()} — {fpath.name}"

        try:
            create_job(
                job_id        = jid,
                analysis_mode = primary_mode,
                shift_id      = None,
                shift_json    = None,
                source_type   = "file",
                source_path   = str(fpath.resolve()),
                model_profile = cfg.model_profile,
                config_path   = cfg.config_path,
                annotate      = cfg.annotate,
                clip_label    = label,
            )
            if extra_modes:
                import json as _json
                _raw_update(jid, summary_json=_json.dumps({
                    "extra_config": {"extra_modes": extra_modes}
                }))
            log.info(f"[folder_watch] Submitted job {jid} for {fpath.name}")
            return jid
        except Exception as e:
            log.error(f"[folder_watch] Failed to create job for {fpath.name}: {e}")
            return None


# ── State persistence ─────────────────────────────────────────────────────────

def _load_state() -> dict:
    try:
        if _STATE_PATH.exists():
            return json.loads(_STATE_PATH.read_text())
    except Exception:
        pass
    return {"seen_files": {}}


def _save_state(state: dict):
    try:
        _STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _STATE_PATH.write_text(json.dumps(state, indent=2))
    except Exception as e:
        log.warning(f"[folder_watch] Could not save state: {e}")


# ── Module-level singleton ────────────────────────────────────────────────────

_watcher: Optional[FolderWatcher] = None


def get_watcher() -> FolderWatcher:
    global _watcher
    if _watcher is None:
        _watcher = FolderWatcher()
    return _watcher


# ── Standalone CLI ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    import os
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    folder = sys.argv[1] if len(sys.argv) > 1 else "."
    mode   = sys.argv[2] if len(sys.argv) > 2 else "drink_count"

    cfg = FolderWatchConfig(path=folder, mode=mode)
    w   = get_watcher()
    w.add_folder(cfg)
    log.info(f"Watching '{folder}' for {mode}. Ctrl-C to stop.")
    try:
        while True:
            time.sleep(30)
    except KeyboardInterrupt:
        w.stop_all()
