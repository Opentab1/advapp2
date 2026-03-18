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

    # Frame viability: if detections exist and conf > threshold
    drink_total = sum(
        b.get("total_drinks", 0)
        for b in summary.get("bartenders", {}).values()
    ) if summary.get("mode") == "drink_count" else 1
    viability = 1.0 if avg_conf > 0.40 else 0.5
    if summary.get("mode") == "drink_count" and drink_total == 0:
        viability = 0.3

    score_raw = 0.45 * conf_score + 0.35 * stability_score + 0.20 * viability
    score = int(round(score_raw * 100))
    score = max(0, min(100, score))

    if score >= 75:
        return score, "green", f"Detection Reliability: {score}%"
    elif score >= 55:
        return score, "yellow", f"Detection Reliability: {score}%"
    else:
        return score, "red", f"Detection Reliability: {score}%"
