"""
VenueScope — Detection confidence score calculator.
Returns 0-100 score and color badge for display in UI and PDF.
"""
from __future__ import annotations
from typing import Dict, Any, Tuple


def compute_confidence_score(summary: Dict[str, Any]) -> Tuple[int, str, str]:
    """
    Returns (score_0_to_100, badge_color, label).
    badge_color: 'green' | 'yellow' | 'red'
    """
    quality = summary.get("quality", {})
    avg_conf     = quality.get("avg_detection_conf", 0)
    switch_rate  = quality.get("tracking_switch_rate", 0)
    processed    = quality.get("processed_frames", 0)
    dropped      = quality.get("dropped_frames", 0)

    # Detection confidence (0.6+ conf = 100, 0.25 = 0) — calibrated for overhead bar cams
    conf_score = min(max((avg_conf - 0.25) / 0.35, 0.0), 1.0)

    # Tracking stability (0% switches = 100, 15%+ = 0)
    stability_score = max(0.0, 1.0 - switch_rate / 0.15)

    # Frame viability. Gate on whether the detector itself is healthy.
    # 2026-04-21 fix: the old logic dropped viability to 0.3 whenever a
    # drink_count job reported 0 drinks, which punished every quiet 15-second
    # window even when the camera was clearly working fine. That made the
    # shift-level score look like a detection failure when it was really just
    # a low-serve moment. Now we only apply the "broken camera" penalty when
    # BOTH drinks=0 AND person detection is weak — the actual broken signal.
    mode = summary.get("mode")
    drink_total = sum(
        b.get("total_drinks", 0)
        for b in summary.get("bartenders", {}).values()
    ) if mode == "drink_count" else 1

    if   avg_conf > 0.55: viability = 1.0   # excellent bar-cam detection
    elif avg_conf > 0.40: viability = 0.85
    elif avg_conf > 0.25: viability = 0.60
    else:                 viability = 0.30

    # Broken-camera signal: zero drinks AND weak person detection = probably broken.
    # Zero drinks AND strong person detection = just a quiet window, not a failure.
    if mode == "drink_count" and drink_total == 0 and avg_conf <= 0.40:
        viability = min(viability, 0.35)

    score_raw = 0.45 * conf_score + 0.35 * stability_score + 0.20 * viability
    score = int(round(score_raw * 100))
    score = max(0, min(100, score))

    if score >= 75:
        return score, "green", f"Detection Reliability: {score}%"
    elif score >= 55:
        return score, "yellow", f"Detection Reliability: {score}%"
    else:
        return score, "red", f"Detection Reliability: {score}%"
