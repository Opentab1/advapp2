"""
VenueScope — Live Kalman-filter forecast updater.
Updates the tonight's forecast every 15 minutes once doors open,
using actual headcount readings from DynamoDB.
"""
from __future__ import annotations
import logging
import math
import time
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

# Operating hours: 4 PM to 2 AM
_OPEN_HOUR = 16
_CLOSE_HOUR = 26  # 2 AM next day

# Default measurement noise (people count sensor uncertainty)
_SIGMA_MEASUREMENT_DEFAULT = 4.0


# ── Kalman update ─────────────────────────────────────────────────────────────

def kalman_update(
    predicted: float,
    actual: float,
    sigma_predicted: float,
    sigma_measurement: float = _SIGMA_MEASUREMENT_DEFAULT,
) -> float:
    """
    Single-step Kalman update for occupancy.

    Formula:
      alpha = sigma_predicted² / (sigma_predicted² + sigma_measurement²)
      updated = alpha * actual + (1 - alpha) * predicted

    When sigma_predicted is large (uncertain model): alpha → 1, trust actual more.
    When sigma_measurement is large (noisy sensor): alpha → 0, trust model more.

    Returns the updated headcount estimate.
    """
    alpha = (sigma_predicted ** 2) / (sigma_predicted ** 2 + sigma_measurement ** 2)
    return alpha * actual + (1.0 - alpha) * predicted


# ── Live forecast updater ─────────────────────────────────────────────────────

class LiveForecastUpdater:
    """
    Maintains a live-updated version of tonight's forecast using Kalman filtering.

    Once doors open, every 15 minutes:
      1. Read actual headcount from sensor/DDB
      2. Kalman-update the current slot
      3. Scale remaining slots proportionally
      4. Recompute final_estimate
    """

    def __init__(
        self,
        venue_id: str,
        original_forecast: list[dict],
        sigma_per_slot: Optional[list[float]] = None,
    ):
        """
        venue_id:          Venue identifier
        original_forecast: list of {ds, yhat, yhat_lower, yhat_upper} from forecast_service
        sigma_per_slot:    list of prediction uncertainty per slot (defaults to yhat * 0.3)
        """
        self.venue_id = venue_id
        self.original_forecast = original_forecast
        self.updated_curve = [dict(s) for s in original_forecast]  # deep copy

        if sigma_per_slot is not None:
            self.sigma_per_slot = sigma_per_slot
        else:
            # Default: 30% of predicted value as uncertainty, minimum 5
            self.sigma_per_slot = [
                max(5.0, s.get("yhat", 10.0) * 0.30)
                for s in original_forecast
            ]

        self._update_count = 0

    def _find_current_slot_index(self, current_time: datetime) -> Optional[int]:
        """Find the index of the 15-min slot that contains current_time."""
        for i, slot in enumerate(self.updated_curve):
            slot_dt = slot["ds"]
            if isinstance(slot_dt, str):
                from datetime import datetime as _dt
                slot_dt = _dt.fromisoformat(slot_dt)
            slot_end = slot_dt + timedelta(minutes=15)
            if slot_dt <= current_time < slot_end:
                return i
        return None

    def update(self, current_time: datetime, actual_headcount: float) -> dict:
        """
        Apply a Kalman update for the current time slot.

        current_time:      Current wall-clock time
        actual_headcount:  Actual headcount reading from sensor/DDB

        Returns updated final_estimate dict:
          {low: int, mid: int, high: int}
        """
        slot_idx = self._find_current_slot_index(current_time)

        if slot_idx is None:
            logger.warning("[live] Current time %s is outside the forecast window", current_time)
            return self._compute_final_estimate()

        current_slot = self.updated_curve[slot_idx]
        predicted = current_slot.get("yhat", 0.0)
        sigma = self.sigma_per_slot[slot_idx] if slot_idx < len(self.sigma_per_slot) else 10.0

        # Kalman update for current slot
        updated_yhat = kalman_update(
            predicted=predicted,
            actual=actual_headcount,
            sigma_predicted=sigma,
        )
        updated_yhat = max(0.0, updated_yhat)

        # Update the current slot
        self.updated_curve[slot_idx]["yhat"] = updated_yhat

        # Proportionally scale remaining slots
        if predicted > 0:
            scale_factor = updated_yhat / predicted
        else:
            scale_factor = 1.0

        # Only scale future slots (not past or current)
        for j in range(slot_idx + 1, len(self.updated_curve)):
            orig_yhat = self.updated_curve[j]["yhat"]
            self.updated_curve[j]["yhat"] = max(0.0, orig_yhat * scale_factor)
            self.updated_curve[j]["yhat_lower"] = max(
                0.0, self.updated_curve[j].get("yhat_lower", orig_yhat * 0.8) * scale_factor
            )
            self.updated_curve[j]["yhat_upper"] = max(
                0.0, self.updated_curve[j].get("yhat_upper", orig_yhat * 1.2) * scale_factor
            )

        # Reduce uncertainty for future slots (we've seen actual data)
        for j in range(slot_idx, len(self.sigma_per_slot)):
            self.sigma_per_slot[j] = max(2.0, self.sigma_per_slot[j] * 0.85)

        self._update_count += 1
        logger.info(
            "[live] Slot %d updated: predicted=%.1f actual=%.1f updated=%.1f scale=%.3f",
            slot_idx, predicted, actual_headcount, updated_yhat, scale_factor,
        )

        return self._compute_final_estimate()

    def _compute_final_estimate(self) -> dict:
        """Compute the final_estimate from remaining updated slots."""
        remaining = [s for s in self.updated_curve if s.get("yhat", 0) > 0]
        if not remaining:
            return {"low": 0, "mid": 0, "high": 0}

        # Recompute covers using same logic as forecast_service
        avg_visit_slots = 10
        total_yhat = sum(s.get("yhat", 0) for s in self.updated_curve)
        total_low = sum(s.get("yhat_lower", s.get("yhat", 0) * 0.8) for s in self.updated_curve)
        total_high = sum(s.get("yhat_upper", s.get("yhat", 0) * 1.2) for s in self.updated_curve)

        mid = max(1, int(round(total_yhat / avg_visit_slots)))
        low = max(1, int(round(total_low / avg_visit_slots)))
        high = max(1, int(round(total_high / avg_visit_slots)))

        return {"low": low, "mid": mid, "high": high}

    def get_updated_curve(self) -> list[dict]:
        """Return the current state of the updated hourly curve."""
        return [
            {
                "ds": s["ds"].isoformat() if isinstance(s["ds"], datetime) else s["ds"],
                "yhat": round(s.get("yhat", 0.0), 1),
                "yhat_lower": round(s.get("yhat_lower", 0.0), 1),
                "yhat_upper": round(s.get("yhat_upper", 0.0), 1),
            }
            for s in self.updated_curve
        ]


# ── Background worker ─────────────────────────────────────────────────────────

def _is_operating_hours(now: Optional[datetime] = None) -> bool:
    """Return True if now falls within the 4 PM – 2 AM operating window."""
    if now is None:
        now = datetime.now()
    h = now.hour
    # 4 PM (16) to midnight (23): operating
    # midnight (0) to 2 AM (2): operating
    return (16 <= h <= 23) or (0 <= h < 2)


def _read_actual_headcount(venue_id: str) -> Optional[float]:
    """
    Read the current actual headcount from DynamoDB via aws_sync.
    Returns None if not available.
    """
    try:
        from core.aws_sync import get_camera_shift_totals
        # Use the venue_id as a proxy for camera lookup
        # In production, there would be a mapping; for now use venue_id directly
        data = get_camera_shift_totals(camera_id=venue_id, venue_id=venue_id)
        if data:
            # The DDB record contains people count info from the shift
            # Use peak_occupancy or current_occupancy if available
            occupancy = data.get("current_occupancy") or data.get("peak_occupancy")
            if occupancy is not None:
                return float(occupancy)
    except Exception as e:
        logger.debug("[live] Could not read from DDB: %s", e)
    return None


def run_live_updates(venue_id: str, lat: float, lon: float) -> None:
    """
    Background worker function. Runs every 15 minutes during operating hours.
    Reads actual headcount from DDB, applies Kalman update, writes snapshot.

    This function blocks indefinitely (runs as a daemon thread or process).
    """
    from core.prophet_forecast.forecast_service import forecast_tonight
    from core.prophet_forecast.occupancy_snapshots import write_snapshot

    logger.info("[live] Starting live update worker for venue %s", venue_id)

    updater: Optional[LiveForecastUpdater] = None
    last_forecast_date: Optional[datetime] = None

    while True:
        now = datetime.now()

        # Only run during operating hours
        if not _is_operating_hours(now):
            time.sleep(60)  # Check again in 1 minute
            continue

        # Rebuild forecast at start of each day's session
        today = now.date()
        if last_forecast_date != today:
            logger.info("[live] Building fresh forecast for %s", today)
            try:
                from datetime import date as _date
                forecast_result = forecast_tonight(
                    venue_id=venue_id,
                    target_date=today,
                    lat=lat,
                    lon=lon,
                )
                # Convert hourly_curve to slot-level list
                raw_slots = forecast_result.get("hourly_curve", [])
                # Build slot dicts with datetime objects
                slot_list = []
                for s in raw_slots:
                    # Parse hour string back to datetime for updater
                    slot_list.append({
                        "ds": s.get("hour", ""),
                        "yhat": s.get("yhat", 0.0),
                        "yhat_lower": s.get("yhat_lower", 0.0),
                        "yhat_upper": s.get("yhat_upper", 0.0),
                    })
                updater = LiveForecastUpdater(venue_id=venue_id, original_forecast=slot_list)
                last_forecast_date = today
            except Exception as e:
                logger.error("[live] Failed to build forecast: %s", e)
                time.sleep(300)
                continue

        # Read actual headcount
        actual_hc = _read_actual_headcount(venue_id)

        if actual_hc is not None and updater is not None:
            try:
                updated_estimate = updater.update(now, actual_hc)
                logger.info("[live] Kalman update: actual=%.1f estimate=%s",
                            actual_hc, updated_estimate)

                # Write updated snapshot to occupancy_snapshots table
                write_snapshot(
                    venue_id=venue_id,
                    ts=now.timestamp(),
                    headcount=int(round(actual_hc)),
                    source="sensor",
                )
            except Exception as e:
                logger.error("[live] Update failed: %s", e)
        else:
            logger.debug("[live] No actual headcount available; skipping Kalman update")

        # Sleep for 15 minutes
        time.sleep(15 * 60)
