"""
VenueScope — Square Orders API v2 client.
Fetches orders for a given time window and returns drink-level metrics
for POS reconciliation against camera drink counts.

Env vars (or passed directly):
  SQUARE_ACCESS_TOKEN   — Square OAuth or personal access token
  SQUARE_LOCATION_ID    — Square location ID (found in Square Dashboard)
  SQUARE_ENVIRONMENT    — 'production' or 'sandbox' (default: production)
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


_BASE_URLS = {
    "production": "https://connect.squareup.com",
    "sandbox":    "https://connect.squareupsandbox.com",
}

_DEFAULT_DRINK_CATEGORIES = [
    "Bar", "Drinks", "Beverages", "Cocktails",
    "Beer", "Wine", "Spirits", "Alcohol",
]


class SquareClient:
    """
    Minimal Square Orders API v2 client using only stdlib HTTP.
    Handles pagination transparently.
    """

    def __init__(
        self,
        access_token: str,
        location_id: str,
        environment: str = "production",
    ) -> None:
        if not access_token:
            raise ValueError("[square] access_token is required")
        if not location_id:
            raise ValueError("[square] location_id is required")
        env = environment.lower()
        if env not in _BASE_URLS:
            raise ValueError(f"[square] environment must be 'production' or 'sandbox', got {environment!r}")

        self._token       = access_token
        self._location_id = location_id
        self._base_url    = _BASE_URLS[env]

    # ── Internal helpers ───────────────────────────────────────────────────

    def _request(self, method: str, path: str, body: Optional[Dict] = None) -> Dict:
        url     = self._base_url + path
        payload = json.dumps(body).encode() if body is not None else None
        req     = urllib.request.Request(
            url,
            data=payload,
            method=method,
            headers={
                "Authorization":  f"Bearer {self._token}",
                "Content-Type":   "application/json",
                "Accept":         "application/json",
                "Square-Version": "2024-01-17",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            body_text = exc.read().decode(errors="replace")
            raise RuntimeError(
                f"[square] HTTP {exc.code} on {method} {path}: {body_text[:400]}"
            ) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"[square] Network error on {method} {path}: {exc.reason}") from exc

    # ── Public API ─────────────────────────────────────────────────────────

    def fetch_orders(self, start_time: datetime, end_time: datetime) -> List[Dict]:
        """
        Fetch all COMPLETED orders between start_time and end_time.
        Handles pagination automatically; returns a flat list of order dicts.
        """
        start_iso = _to_rfc3339(start_time)
        end_iso   = _to_rfc3339(end_time)

        orders: List[Dict] = []
        cursor: Optional[str] = None
        page = 0

        while True:
            page += 1
            body: Dict[str, Any] = {
                "location_ids": [self._location_id],
                "query": {
                    "filter": {
                        "date_time_filter": {
                            "created_at": {
                                "start_at": start_iso,
                                "end_at":   end_iso,
                            }
                        },
                        "state_filter": {"states": ["COMPLETED"]},
                    }
                },
                "limit": 500,
            }
            if cursor:
                body["cursor"] = cursor

            resp = self._request("POST", "/v2/orders/search", body)

            batch = resp.get("orders") or []
            orders.extend(batch)

            cursor = resp.get("cursor")
            if not cursor:
                break

            # Safety guard — Square shouldn't return more than a few thousand orders
            # in a typical bar window, but prevent infinite loops on bad responses.
            if page > 50:
                print(
                    f"[square] Pagination safety limit reached ({page} pages, "
                    f"{len(orders)} orders so far) — stopping.",
                    flush=True,
                )
                break

        print(f"[square] Fetched {len(orders)} orders ({start_iso} → {end_iso})", flush=True)
        return orders

    def get_drink_item_count(
        self,
        orders: List[Dict],
        drink_categories: Optional[List[str]] = None,
    ) -> int:
        """
        Count drink line items across all orders.
        Matches against item category names (case-insensitive).
        Falls back to counting all items if category data is absent.
        """
        categories = {c.lower() for c in (drink_categories or _DEFAULT_DRINK_CATEGORIES)}
        total = 0

        for order in orders:
            for line in order.get("line_items") or []:
                qty = _parse_qty(line.get("quantity", "1"))

                # Check item variation data for a category
                cat_name = _extract_category_name(line)
                if cat_name is not None:
                    if cat_name.lower() in categories:
                        total += qty
                else:
                    # No category info — count every line item
                    # (conservative: better to over-count than miss drinks)
                    total += qty

        return total

    def get_revenue(self, orders: List[Dict]) -> float:
        """
        Sum total order amounts in dollars.
        Square stores money amounts in the smallest currency unit (cents for USD).
        """
        total_cents = 0
        for order in orders:
            money = order.get("total_money") or {}
            total_cents += int(money.get("amount", 0))
        return round(total_cents / 100, 2)

    def get_metrics_for_window(
        self,
        start_time: datetime,
        end_time: datetime,
    ) -> Dict[str, Any]:
        """
        Fetch orders for the window and return a consolidated metrics dict.
        """
        orders = self.fetch_orders(start_time, end_time)
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

def from_env() -> SquareClient:
    """Build a SquareClient from environment variables."""
    token       = os.environ.get("SQUARE_ACCESS_TOKEN", "")
    location_id = os.environ.get("SQUARE_LOCATION_ID", "")
    environment = os.environ.get("SQUARE_ENVIRONMENT", "production")
    return SquareClient(token, location_id, environment)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_rfc3339(dt: datetime) -> str:
    """Return an RFC-3339 / ISO-8601 UTC string like '2024-01-01T00:00:00Z'."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_qty(qty_str: str) -> int:
    """Square quantities are strings like '1', '2'. Return int, default 1."""
    try:
        return max(1, int(float(qty_str)))
    except (ValueError, TypeError):
        return 1


def _extract_category_name(line_item: Dict) -> Optional[str]:
    """
    Try to extract a category name from a Square line item.
    Square embeds category info inside catalog_object or modifiers; the most
    reliable field is line_item['catalog_object']['category']['name'] but the
    structure varies.  Return None if nothing useful is found.
    """
    # Path 1: item_variation_data.item_data.category.name (not embedded in Orders API
    #         unless catalog_version_token is included — usually absent)
    # Path 2: metadata tag "category" added by some integrations
    meta = line_item.get("metadata") or {}
    if isinstance(meta, dict):
        cat = meta.get("category") or meta.get("Category")
        if cat:
            return str(cat)

    # Path 3: note or name heuristic — if none of the above, return None so
    # the caller uses the fallback count-everything strategy.
    return None
