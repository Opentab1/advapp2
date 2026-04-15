"""
DrinkBottleCorrelator — Links bottle pours to drink serves in real time.

When drink_count and bottle_count both run on the same camera feed:
  1. pour_end events (from BottleCounter) are buffered in a rolling 8-second window
  2. Every drink_serve event is matched against that buffer
  3. Best-matching pour is claimed and its data enriches the serve event

Drink type classification (heuristic, tunable via config):
  bottle (COCO 39) + duration < 0.9s   → shot
  bottle (COCO 39) + duration 0.9–4s   → spirit
  bottle (COCO 39) + duration > 4s     → cocktail (long / mixed)
  wine_glass (COCO 40)                 → wine
  cup (COCO 41)                        → beer
  no pour matched within window        → unknown

Over-pour flag is lifted directly from BottleCounter's per-pour verdict
(pour_oz > standard_oz × over_pour_factor).

Per-bartender stats are accumulated so the summary can be merged into
the bartender breakdown that gets written to DynamoDB.
"""
from __future__ import annotations
from collections import deque, defaultdict
from typing import List, Dict, Any, Optional


_WINDOW_SEC = 8.0   # how far back to search for a matching pour


def _classify(pour_ev: Optional[Dict]) -> str:
    if pour_ev is None:
        return "unknown"
    cls = pour_ev.get("class_name", "bottle")
    dur = pour_ev.get("duration_sec", 0.0)
    if cls == "wine_glass":
        return "wine"
    if cls == "cup":
        return "beer"
    # bottle = spirits / shots / cocktails
    if dur < 0.9:
        return "shot"
    if dur < 4.0:
        return "spirit"
    return "cocktail"


class DrinkBottleCorrelator:
    """
    Stateful correlator — lives for the duration of one VenueProcessor run.

    Call process_events(evs) once per frame with the combined event list
    from all analyzers. It enriches drink_serve events in-place and
    accumulates stats for the final summary.
    """

    def __init__(self, standard_pour_oz: float = 1.25):
        self._standard_oz = standard_pour_oz
        self._buf: deque = deque()          # recent pour_end events
        self._stats: Dict[str, Any] = {
            "correlated":   0,
            "unmatched":    0,
            "over_pours":   0,
            "total_oz":     0.0,
            "drink_types":  defaultdict(int),
        }
        # per-bartender sub-stats
        self._by_bar: Dict[str, Dict] = defaultdict(lambda: {
            "over_pours":  0,
            "total_oz":    0.0,
            "drink_types": defaultdict(int),
        })

    # ── Public API ────────────────────────────────────────────────────────────

    def process_events(self, events: List[Dict]) -> List[Dict]:
        """
        Process one frame's event list.

        - Adds any pour_end events to the rolling buffer.
        - Enriches each drink_serve event with drink_type / poured_oz / is_over_pour.
        Returns the (same-length, enriched) list.
        """
        # --- collect pours for this frame first ---
        now_t: float = 0.0
        for ev in events:
            t = ev.get("t_sec", 0.0)
            if t > now_t:
                now_t = t
            if ev.get("event_type") == "pour_end":
                self._buf.append(dict(ev))   # copy so we can set _claimed

        # --- prune stale pours ---
        while self._buf and now_t - self._buf[0].get("t_sec", 0.0) > _WINDOW_SEC:
            self._buf.popleft()

        # --- enrich drink_serve events ---
        out: List[Dict] = []
        for ev in events:
            if ev.get("event_type") != "drink_serve":
                out.append(ev)
                continue

            t_serve = ev.get("t_sec", 0.0)
            best    = self._find_pour(t_serve)

            poured_oz   = round(best.get("estimated_oz", 0.0), 2) if best else 0.0
            is_over     = best.get("is_over_pour", False)            if best else False
            bottle_cls  = best.get("class_name")                     if best else None

            if best:
                best["_claimed"] = True
                self._stats["correlated"] += 1
                drink_type = _classify(best)
            else:
                self._stats["unmatched"] += 1
                # Glass crossings with no bottle match = water/soft drink (no bottle used).
                # Body crossings with no bottle match = truly unknown.
                drink_type = ("water" if ev.get("detection_method") == "glass_crossing"
                              else "unknown")

            self._stats["total_oz"]             += poured_oz
            self._stats["drink_types"][drink_type] += 1
            if is_over:
                self._stats["over_pours"] += 1

            name = ev.get("bartender") or "UNASSIGNED"
            self._by_bar[name]["over_pours"]  += 1 if is_over else 0
            self._by_bar[name]["total_oz"]    += poured_oz
            self._by_bar[name]["drink_types"][drink_type] += 1

            out.append({
                **ev,
                "drink_type":    drink_type,
                "poured_oz":     poured_oz,
                "is_over_pour":  is_over,
                "standard_oz":   self._standard_oz,
                "bottle_class":  bottle_cls,
            })

        return out

    def summary(self) -> Dict[str, Any]:
        corr = self._stats["correlated"]
        oz   = self._stats["total_oz"]
        return {
            "correlated":    corr,
            "unmatched":     self._stats["unmatched"],
            "over_pours":    self._stats["over_pours"],
            "total_oz":      round(oz, 2),
            "avg_oz":        round(oz / corr, 2) if corr else 0.0,
            "drink_types":   dict(self._stats["drink_types"]),
            "by_bartender":  {
                name: {
                    "over_pours":  d["over_pours"],
                    "total_oz":    round(d["total_oz"], 2),
                    "drink_types": dict(d["drink_types"]),
                }
                for name, d in self._by_bar.items()
            },
        }

    # ── Internal ──────────────────────────────────────────────────────────────

    def _find_pour(self, t_serve: float) -> Optional[Dict]:
        """
        Return the most-recent unclaimed pour within the window.
        Prefers pours that ended just before the serve (≤ 3s ago),
        but accepts any within _WINDOW_SEC.
        """
        best: Optional[Dict] = None
        best_delta = float("inf")
        for pour in self._buf:
            if pour.get("_claimed"):
                continue
            delta = t_serve - pour.get("t_sec", 0.0)
            # Prefer pours that ended shortly before the serve
            if -1.0 <= delta <= _WINDOW_SEC and delta < best_delta:
                best_delta = delta
                best = pour
        return best
