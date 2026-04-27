"""
Worker health snapshot for Test Run reports.

Captures per-process and system-wide signals so the test grade can
distinguish "model accuracy was bad" from "the worker was thrashing
and dropped half the frames."
"""

from __future__ import annotations
import os
import time
import logging
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional

log = logging.getLogger(__name__)


@dataclass
class HealthSample:
    ts:              float = 0.0
    process_pcpu:    float = 0.0   # this process %CPU (sum of children)
    process_rss_mb:  float = 0.0
    system_load_1m:  float = 0.0
    system_mem_pct:  float = 0.0
    swap_pct:        float = 0.0


@dataclass
class HealthSummary:
    samples:           int   = 0
    duration_sec:      float = 0.0
    peak_pcpu:         float = 0.0
    peak_rss_mb:       float = 0.0
    peak_load_1m:      float = 0.0
    peak_swap_pct:     float = 0.0
    dropped_frames:    int   = 0
    error_count:       int   = 0
    restarts:          int   = 0
    completed:         bool  = False
    timeline:          List[Dict] = field(default_factory=list)
    notes:             List[str]  = field(default_factory=list)

    def to_dict(self) -> Dict:
        d = asdict(self)
        # cap timeline so DDB attribute stays under 400KB even on long runs
        if len(d["timeline"]) > 600:
            stride = max(1, len(d["timeline"]) // 600)
            d["timeline"] = d["timeline"][::stride]
        return d


# ── psutil-backed sampling ────────────────────────────────────────────────

def _try_psutil():
    try:
        import psutil  # type: ignore
        return psutil
    except Exception:
        return None


def take_sample(pid: int, *, psutil_mod=None) -> HealthSample:
    """Snapshot CPU/RSS for `pid` (and its children) and system signals.

    Falls back to /proc/-based reading if psutil isn't available, so this
    works on a stripped-down droplet too.
    """
    s = HealthSample(ts=time.time())
    psutil_mod = psutil_mod or _try_psutil()

    if psutil_mod:
        try:
            p = psutil_mod.Process(pid)
            kids = p.children(recursive=True)
            s.process_pcpu = p.cpu_percent(interval=None) + sum(k.cpu_percent(interval=None) for k in kids)
            s.process_rss_mb = (p.memory_info().rss + sum(k.memory_info().rss for k in kids)) / (1024 * 1024)
        except Exception as e:
            log.debug("[worker_health] psutil per-proc failed: %s", e)
        try:
            s.system_load_1m = os.getloadavg()[0]
            vm = psutil_mod.virtual_memory()
            s.system_mem_pct = vm.percent
            s.swap_pct = psutil_mod.swap_memory().percent
        except Exception as e:
            log.debug("[worker_health] psutil system failed: %s", e)
        return s

    # Pure-stdlib fallback: /proc/{pid}/status, /proc/loadavg, /proc/meminfo
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    s.process_rss_mb = int(line.split()[1]) / 1024
                    break
    except Exception:
        pass
    try:
        s.system_load_1m = os.getloadavg()[0]
    except Exception:
        pass
    try:
        with open("/proc/meminfo") as f:
            mem = {k.strip(): int(v.split()[0]) for k, v in (l.split(":", 1) for l in f if ":" in l)}
            total = mem.get("MemTotal", 1)
            avail = mem.get("MemAvailable", total)
            s.system_mem_pct = round(100.0 * (1.0 - avail / total), 1)
            swap_total = mem.get("SwapTotal", 0)
            swap_free  = mem.get("SwapFree", 0)
            s.swap_pct = round(100.0 * (1.0 - (swap_free / swap_total)) if swap_total else 0.0, 1)
    except Exception:
        pass
    return s


class HealthCollector:
    """Time-series collector — call .sample(pid) periodically; finalize() at end."""

    def __init__(self):
        self._psutil = _try_psutil()
        self._samples: List[HealthSample] = []
        self._t_start: Optional[float] = None

    def sample(self, pid: int) -> HealthSample:
        if self._t_start is None:
            self._t_start = time.time()
        s = take_sample(pid, psutil_mod=self._psutil)
        self._samples.append(s)
        return s

    def increment(self, summary_field: str, by: int = 1) -> None:
        """Bump a counter (dropped_frames/error_count/restarts) on the running summary."""
        if not hasattr(self, "_counters"):
            self._counters = {}
        self._counters[summary_field] = self._counters.get(summary_field, 0) + by

    def finalize(self, *, completed: bool, notes: Optional[List[str]] = None) -> HealthSummary:
        # Always coerce to numeric values — DDB serializes `None` differently
        # than `0.0` and the stability rubric assumes numeric comparisons.
        peak_cpu  = float(max((s.process_pcpu   for s in self._samples), default=0.0) or 0.0)
        peak_rss  = float(max((s.process_rss_mb for s in self._samples), default=0.0) or 0.0)
        peak_load = float(max((s.system_load_1m for s in self._samples), default=0.0) or 0.0)
        peak_swap = float(max((s.swap_pct       for s in self._samples), default=0.0) or 0.0)
        duration  = float((self._samples[-1].ts - self._samples[0].ts) if len(self._samples) >= 2 else 0.0)
        timeline  = [
            {
                "t":     round(s.ts - (self._t_start or s.ts), 1),
                "cpu":   round(s.process_pcpu, 1),
                "rss":   round(s.process_rss_mb, 1),
                "load":  round(s.system_load_1m, 2),
                "memPct":round(s.system_mem_pct, 1),
                "swap":  round(s.swap_pct, 1),
            }
            for s in self._samples
        ]
        counters = getattr(self, "_counters", {})
        return HealthSummary(
            samples=len(self._samples),
            duration_sec=round(duration, 1),
            peak_pcpu=round(peak_cpu, 1),
            peak_rss_mb=round(peak_rss, 1),
            peak_load_1m=round(peak_load, 2),
            peak_swap_pct=round(peak_swap, 1),
            dropped_frames=counters.get("dropped_frames", 0),
            error_count=counters.get("error_count", 0),
            restarts=counters.get("restarts", 0),
            completed=completed,
            timeline=timeline,
            notes=list(notes or []),
        )


# ── Stability badge derivation ─────────────────────────────────────────────

def derive_stability(summary: HealthSummary, *, n_cores: int = 4) -> str:
    """Reduce the time-series to a single 'stable' or 'unstable' signal.

    Unstable triggers (any one):
      - Worker did NOT complete
      - Peak load > 1.5× n_cores (severe oversubscription)
      - Peak swap > 50%
      - Any errors or worker restarts during the run
      - Dropped frames > 5% of total samples (proxy)

    "No samples collected" is NOT unstable on its own — it just means the
    health collector couldn't attach to the engine subprocess (often a
    permission or short-lifetime issue). We assume stable in that case.
    """
    if not summary.completed:
        return "unstable"
    if summary.error_count > 0 or summary.restarts > 0:
        return "unstable"
    if summary.peak_load_1m and summary.peak_load_1m > 1.5 * n_cores:
        return "unstable"
    if summary.peak_swap_pct and summary.peak_swap_pct > 50:
        return "unstable"
    if summary.samples > 0 and summary.dropped_frames > 0.05 * summary.samples:
        return "unstable"
    return "stable"
