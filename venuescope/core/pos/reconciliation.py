"""
VenueScope — POS reconciliation engine.
Compares camera-counted drinks against POS sales for the same time window.
Returns variance metrics that indicate potential theft or counting errors.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional


def get_configured_provider() -> Optional[str]:
    """
    Return 'square' if SQUARE_ACCESS_TOKEN is set,
    'toast' if TOAST_API_KEY is set, None otherwise.
    Square takes priority if both are configured.
    """
    if os.environ.get("SQUARE_ACCESS_TOKEN"):
        return "square"
    if os.environ.get("TOAST_API_KEY"):
        return "toast"
    return None


def reconcile(
    camera_drink_count: int,
    job_start_time: float,
    job_duration_sec: float,
    provider: str,
) -> Dict[str, Any]:
    """
    Compare camera-counted drinks against POS sales for the same time window.

    Parameters
    ----------
    camera_drink_count : int
        Total drinks counted by the camera analytics engine.
    job_start_time : float
        Unix timestamp for the start of the recording / shift window.
    job_duration_sec : float
        Duration of the analysed footage in seconds.
    provider : str
        POS provider to query — 'square' or 'toast'.

    Returns
    -------
    dict with keys:
        provider, pos_drink_count, camera_drink_count, variance_drinks,
        variance_pct, pos_revenue, pos_order_count, avg_drink_price,
        estimated_lost_revenue, reconciled, error, window_start, window_end.
    On failure:
        reconciled=False, error=<message>, provider, camera_drink_count.
    """
    provider = (provider or "").lower().strip()

    if provider not in ("square", "toast"):
        return _failed_result(
            provider=provider,
            camera_drink_count=camera_drink_count,
            error=f"Unknown POS provider {provider!r} — expected 'square' or 'toast'",
        )

    # Build the time window
    start_dt = datetime.fromtimestamp(job_start_time, tz=timezone.utc)
    end_dt   = datetime.fromtimestamp(job_start_time + max(job_duration_sec, 0), tz=timezone.utc)

    window_start = start_dt.strftime("%Y-%m-%dT%H:%M:%S")
    window_end   = end_dt.strftime("%Y-%m-%dT%H:%M:%S")

    print(
        f"[reconciliation] Fetching {provider} POS data "
        f"{window_start} → {window_end}  (camera drinks={camera_drink_count})",
        flush=True,
    )

    # Fetch POS metrics
    try:
        metrics = _fetch_metrics(provider, start_dt, end_dt)
    except Exception as exc:
        error_msg = str(exc)
        print(f"[reconciliation] POS fetch failed: {error_msg}", flush=True)
        return _failed_result(
            provider=provider,
            camera_drink_count=camera_drink_count,
            error=error_msg,
            window_start=window_start,
            window_end=window_end,
        )

    pos_drink_count = int(metrics.get("drink_count", 0))
    pos_revenue     = float(metrics.get("revenue", 0.0))
    pos_order_count = int(metrics.get("order_count", 0))

    variance_drinks = camera_drink_count - pos_drink_count
    max_count       = max(pos_drink_count, camera_drink_count, 1)
    variance_pct    = round(abs(variance_drinks) / max_count * 100, 1)

    avg_drink_price = (
        round(pos_revenue / pos_drink_count, 2)
        if pos_drink_count > 0
        else 0.0
    )
    estimated_lost = round(max(0, variance_drinks) * avg_drink_price, 2)

    result: Dict[str, Any] = {
        "provider":               provider,
        "pos_drink_count":        pos_drink_count,
        "camera_drink_count":     camera_drink_count,
        "variance_drinks":        variance_drinks,
        "variance_pct":           variance_pct,
        "pos_revenue":            pos_revenue,
        "pos_order_count":        pos_order_count,
        "avg_drink_price":        avg_drink_price,
        "estimated_lost_revenue": estimated_lost,
        "reconciled":             True,
        "error":                  None,
        "window_start":           window_start,
        "window_end":             window_end,
    }

    print(
        f"[reconciliation] Done — POS={pos_drink_count} camera={camera_drink_count} "
        f"variance={variance_drinks:+d} ({variance_pct:.1f}%) "
        f"est. lost=${estimated_lost:.2f}",
        flush=True,
    )
    return result


# ── Internal helpers ──────────────────────────────────────────────────────────

def _fetch_metrics(
    provider: str,
    start_dt: datetime,
    end_dt: datetime,
) -> Dict[str, Any]:
    """Instantiate the correct POS client and fetch metrics for the window."""
    if provider == "square":
        from core.pos.square_client import SquareClient

        access_token = os.environ.get("SQUARE_ACCESS_TOKEN", "")
        location_id  = os.environ.get("SQUARE_LOCATION_ID", "")
        environment  = os.environ.get("SQUARE_ENVIRONMENT", "production")

        if not access_token or not location_id:
            raise RuntimeError(
                "Square not fully configured — set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID"
            )

        client = SquareClient(access_token, location_id, environment)
        return client.get_metrics_for_window(start_dt, end_dt)

    elif provider == "toast":
        from core.pos.toast_client import ToastClient

        api_key       = os.environ.get("TOAST_API_KEY", "")
        restaurant_id = os.environ.get("TOAST_RESTAURANT_GUID", "")

        if not api_key or not restaurant_id:
            raise RuntimeError(
                "Toast not fully configured — set TOAST_API_KEY and TOAST_RESTAURANT_GUID"
            )

        client = ToastClient(api_key, restaurant_id)
        return client.get_metrics_for_window(start_dt, end_dt)

    raise RuntimeError(f"Unknown provider: {provider!r}")


def _failed_result(
    provider: str,
    camera_drink_count: int,
    error: str,
    window_start: str = "",
    window_end: str = "",
) -> Dict[str, Any]:
    return {
        "provider":           provider,
        "camera_drink_count": camera_drink_count,
        "reconciled":         False,
        "error":              error,
        "window_start":       window_start,
        "window_end":         window_end,
    }
