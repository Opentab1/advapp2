"""
VenueScope — Billing & subscription state management.
"""
import os, json, time
from pathlib import Path

BILLING_FILE = Path(__file__).resolve().parent.parent / "data" / "configs" / "billing.json"
TRIAL_DAYS   = 14


# ── persistence ──────────────────────────────────────────────────────────────

def load_billing() -> dict:
    try:
        return json.loads(BILLING_FILE.read_text())
    except Exception:
        return {}

def save_billing(data: dict):
    BILLING_FILE.parent.mkdir(parents=True, exist_ok=True)
    BILLING_FILE.write_text(json.dumps(data, indent=2))


# ── state helpers ─────────────────────────────────────────────────────────────

def get_status() -> dict:
    b = load_billing()
    if not b:
        # First run — create trial
        b = {"status": "trial", "trial_ends_at": time.time() + TRIAL_DAYS * 86400}
        save_billing(b)
    # Auto-expire trial
    if b.get("status") == "trial" and time.time() > b.get("trial_ends_at", 0):
        b["status"] = "trial_expired"
        save_billing(b)
    return b

def is_configured() -> bool:
    return bool(os.environ.get("STRIPE_SECRET_KEY", "").strip())

def is_active() -> bool:
    return get_status().get("status") in ("trial", "active")

def trial_days_remaining() -> int:
    b = get_status()
    if b.get("status") != "trial":
        return 0
    return max(0, int((b.get("trial_ends_at", 0) - time.time()) / 86400))

def status_badge(status: str) -> tuple[str, str]:
    return {
        "trial":         ("🟡", "#f59e0b"),
        "active":        ("🟢", "#22c55e"),
        "past_due":      ("🔴", "#ef4444"),
        "canceled":      ("⚫", "#6b7280"),
        "trial_expired": ("🔴", "#ef4444"),
    }.get(status, ("⚪", "#6b7280"))


# ── Stripe API helpers ────────────────────────────────────────────────────────

def _stripe():
    import stripe as _s
    _s.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
    return _s

def sync_subscription() -> dict:
    b = load_billing()
    cust_id = b.get("stripe_customer_id")
    if not cust_id or not is_configured():
        return b
    try:
        s = _stripe()
        subs = list(s.Subscription.list(customer=cust_id, limit=1).auto_paging_iter())
        if subs:
            sub = subs[0]
            b["stripe_subscription_id"] = sub.id
            b["status"] = sub.status  # active / past_due / canceled etc.
            b["current_period_end"] = sub.current_period_end
            b["cancel_at_period_end"] = sub.cancel_at_period_end
            b["plan"] = sub["items"].data[0].price.nickname or "VenueScope Pro"
        b["last_synced_at"] = time.time()
        save_billing(b)
    except Exception:
        pass
    return b

def create_portal_session(customer_id: str) -> str:
    s = _stripe()
    session = s.billing_portal.Session.create(
        customer=customer_id,
        return_url="http://137.184.61.178:8501",
    )
    return session.url


# ── Webhook handler ───────────────────────────────────────────────────────────

def handle_webhook(payload: bytes, sig_header: str) -> str:
    """Process a Stripe webhook event. Returns event type string."""
    import stripe as _s
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    if secret:
        event = _s.Webhook.construct_event(payload, sig_header, secret)
    else:
        event = _s.Event.construct_from(json.loads(payload), _s.api_key)

    etype = event["type"]
    obj   = event["data"]["object"]

    b = load_billing()

    if etype in ("customer.subscription.created", "customer.subscription.updated"):
        b["stripe_customer_id"]    = obj.get("customer")
        b["stripe_subscription_id"]= obj.get("id")
        b["status"]                = obj.get("status", "active")
        b["current_period_end"]    = obj.get("current_period_end")
        b["cancel_at_period_end"]  = obj.get("cancel_at_period_end", False)
        b["last_synced_at"]        = time.time()

    elif etype == "invoice.paid":
        b["stripe_customer_id"] = obj.get("customer")
        b["status"]             = "active"
        b["last_synced_at"]     = time.time()

    elif etype == "invoice.payment_failed":
        b["status"]        = "past_due"
        b["last_synced_at"]= time.time()

    elif etype == "customer.subscription.deleted":
        b["status"]        = "canceled"
        b["last_synced_at"]= time.time()

    save_billing(b)
    return etype
