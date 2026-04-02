"""
VenueScope — Toast POS backend client.
Fetches orders from the Toast API for a given time window.

Env vars:
  TOAST_API_KEY         — Toast API key
  TOAST_RESTAURANT_GUID — Toast restaurant GUID
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


_TOAST_BASE = "https://ws-api.toasttab.com"

# Toast menu item category names considered drinks (case-insensitive).
_DEFAULT_DRINK_CATEGORIES = [
    "bar", "drinks", "beverages", "cocktails",
    "beer", "wine", "spirits", "alcohol",
    "draft beer", "craft beer", "liquor", "shots",
]


class ToastClient:
    """
    Toast Orders API v2 client using stdlib HTTP only.
    """

    def __init__(self, api_key: str, restaurant_guid: str) -> None:
        if not api_key:
            raise ValueError("[toast] api_key is required")
        if not restaurant_guid:
            raise ValueError("[toast] restaurant_guid is required")

        self._api_key         = api_key
        self._restaurant_guid = restaurant_guid

    # ── Internal helpers ───────────────────────────────────────────────────

    def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, str]] = None,
        body: Optional[Dict] = None,
    ) -> Any:
        url = _TOAST_BASE + path
        if params:
            url = url + "?" + urllib.parse.urlencode(params)

        payload = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            url,
            data=payload,
            method=method,
            headers={
                "Authorization":              f"Bearer {self._api_key}",
                "Toast-Restaurant-External-ID": self._restaurant_guid,
                "Content-Type":               "application/json",
                "Accept":                     "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            body_text = exc.read().decode(errors="replace")
            raise RuntimeError(
                f"[toast] HTTP {exc.code} on {method} {path}: {body_text[:400]}"
            ) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(
                f"[toast] Network error on {method} {path}: {exc.reason}"
            ) from exc

    # ── Public API ─────────────────────────────────────────────────────────

    def fetch_orders(self, start_time: datetime, end_time: datetime) -> List[Dict]:
        """
        Fetch all orders in the given time window via GET /orders/v2/orders.
        Toast uses ISO-8601 date strings in query params.
        Returns a flat list of order dicts.
        """
        start_iso = _to_rfc3339(start_time)
        end_iso   = _to_rfc3339(end_time)

        params: Dict[str, str] = {
            "startDate": start_iso,
            "endDate":   end_iso,
            "pageSize":  "100",
        }

        orders: List[Dict] = []
        page = 1

        while True:
            params["page"] = str(page)
            try:
                batch = self._request("GET", "/orders/v2/orders", params=params)
            except RuntimeError as exc:
                # Log and stop pagination on error rather than crashing
                print(f"[toast] fetch_orders page {page} failed: {exc}", flush=True)
                break

            if not batch:
                break

            if isinstance(batch, list):
                orders.extend(batch)
                if len(batch) < int(params.get("pageSize", "100")):
                    # Last page
                    break
            else:
                # Unexpected shape — attempt to extract orders key
                if isinstance(batch, dict) and "orders" in batch:
                    chunk = batch["orders"] or []
                    orders.extend(chunk)
                    if not batch.get("nextPageToken"):
                        break
                    params["pageToken"] = batch["nextPageToken"]
                else:
                    break

            page += 1
            if page > 100:
                print(
                    f"[toast] Pagination safety limit reached ({page} pages, "
                    f"{len(orders)} orders so far) — stopping.",
                    flush=True,
                )
                break

        print(f"[toast] Fetched {len(orders)} orders ({start_iso} → {end_iso})", flush=True)
        return orders

    def get_drink_item_count(self, orders: List[Dict]) -> int:
        """
        Count drink line items across all orders.
        Examines selection item names, menu group names, and display names for
        drink category keywords (case-insensitive).
        """
        drink_kws = set(_DEFAULT_DRINK_CATEGORIES)
        total = 0

        for order in orders:
            for check in order.get("checks") or [order]:
                for selection in check.get("selections") or []:
                    qty = int(selection.get("quantity", 1) or 1)

                    # Try to classify via menu group / display name / item name
                    category = (
                        (selection.get("menuGroup") or {}).get("name", "")
                        or selection.get("displayName", "")
                        or selection.get("itemGroup", {}).get("name", "")
                        if isinstance(selection.get("menuGroup"), dict)
                        else ""
                    )

                    if not category:
                        # Fall back to item name heuristic
                        category = selection.get("displayName", "")

                    if _matches_drink_category(category, drink_kws):
                        total += qty
                    elif not category:
                        # No metadata — count conservatively
                        total += qty

        return total

    def get_revenue(self, orders: List[Dict]) -> float:
        """
        Sum the total amount of all orders in dollars.
        Toast stores amounts as floats (already in dollars, not cents).
        """
        total = 0.0
        for order in orders:
            # Toast order-level total is in checks[].totalAmount or order.totalAmount
            checks = order.get("checks") or []
            if checks:
                for check in checks:
                    total += float(check.get("totalAmount", 0) or 0)
            else:
                total += float(order.get("totalAmount", 0) or 0)
        return round(total, 2)

    def get_metrics_for_window(
        self,
        start_time: datetime,
        end_time: datetime,
    ) -> Dict[str, Any]:
        """
        Fetch orders for the window and return a consolidated metrics dict.
        """
        orders      = self.fetch_orders(start_time, end_time)
        drink_count = self.get_drink_item_count(orders)
        revenue     = self.get_revenue(orders)
        order_count = len(orders)
        avg_order   = round(revenue / order_count, 2) if order_count > 0 else 0.0

        return {
            "drink_count":     drink_count,
            "revenue":         revenue,
            "order_count":     order_count,
            "avg_order_value": avg_order,
            "start_time_iso":  _to_rfc3339(start_time),
            "end_time_iso":    _to_rfc3339(end_time),
        }


# ── Module-level convenience constructor ──────────────────────────────────────

def from_env() -> ToastClient:
    """Build a ToastClient from environment variables."""
    api_key  = os.environ.get("TOAST_API_KEY", "")
    rest_guid = os.environ.get("TOAST_RESTAURANT_GUID", "")
    return ToastClient(api_key, rest_guid)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_rfc3339(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _matches_drink_category(text: str, keywords: set) -> bool:
    """Return True if any keyword appears as a word boundary match in text."""
    if not text:
        return False
    text_lower = text.lower()
    for kw in keywords:
        # Substring match is intentional — "Draft Beer" → "beer" should hit
        if kw in text_lower:
            return True
    return False
