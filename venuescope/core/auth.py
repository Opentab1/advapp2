"""
VenueScope — Session authentication.
Simple PIN-based auth suitable for on-premises single-tenant deployment.
PIN priority: data/configs/auth.json > VENUESCOPE_PIN env var > "1234" default.
No user accounts — one PIN for the whole venue.
"""
from __future__ import annotations
import os
import json
import time
import hashlib
import streamlit as st
from pathlib import Path

_DEFAULT_PIN = "1234"

# ── PIN resolution ────────────────────────────────────────────────────────────
def _load_pin_hash() -> str:
    """Load PIN hash: auth.json > env var > default."""
    try:
        from core.config import CONFIG_DIR
        auth_file = CONFIG_DIR / "auth.json"
        if auth_file.exists():
            data = json.loads(auth_file.read_text())
            if "pin_hash" in data:
                return data["pin_hash"]
    except Exception:
        pass
    env_pin = os.environ.get("VENUESCOPE_PIN", _DEFAULT_PIN)
    return hashlib.sha256(env_pin.encode()).hexdigest()


_PIN_HASH = _load_pin_hash()

# Used only to show the "default PIN" warning when auth.json is not set
_ENV_PIN  = os.environ.get("VENUESCOPE_PIN", _DEFAULT_PIN)

# Rate limiting / lockout settings
_MAX_ATTEMPTS    = 5
_LOCKOUT_SECONDS = 300  # 5 minutes

SESSION_TIMEOUT_MINUTES = 480  # 8 hours default


def _check_pin(entered: str) -> bool:
    return hashlib.sha256(entered.encode()).hexdigest() == _PIN_HASH


# ── Public API ────────────────────────────────────────────────────────────────

def change_pin(new_pin: str) -> None:
    """
    Write a new PIN hash to data/configs/auth.json and update the in-memory
    _PIN_HASH module variable. Takes effect immediately — no restart needed.
    """
    global _PIN_HASH
    new_hash = hashlib.sha256(new_pin.encode()).hexdigest()
    try:
        from core.config import CONFIG_DIR
        auth_file = CONFIG_DIR / "auth.json"
        auth_file.write_text(json.dumps({"pin_hash": new_hash}, indent=2))
    except Exception as e:
        raise RuntimeError(f"Could not save auth.json: {e}") from e
    _PIN_HASH = new_hash


def require_auth() -> bool:
    """
    Call at the top of every page. Returns True if authenticated.
    Renders login screen and stops execution if not authenticated.
    Enforces session timeout and rate-limiting.
    """
    if st.session_state.get("authenticated"):
        # Session timeout check
        try:
            from core.database import get_preferences
            prefs   = get_preferences()
            timeout = int(prefs.get("session_timeout_minutes", SESSION_TIMEOUT_MINUTES))
        except Exception:
            timeout = SESSION_TIMEOUT_MINUTES
        last_ts = st.session_state.get("_auth_ts", 0)
        if time.time() - last_ts > timeout * 60:
            st.session_state.pop("authenticated", None)
            st.session_state.pop("_auth_ts", None)
            # Fall through to login screen
        else:
            st.session_state["_auth_ts"] = time.time()
            return True

    # ── Login UI styling ─────────────────────────────────────────────────────
    st.markdown("""
    <style>
    .auth-wrap {
        max-width: 380px;
        margin: 80px auto 0 auto;
        background: #1e293b;
        border-radius: 16px;
        padding: 40px 36px 32px 36px;
        border: 1px solid #334155;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    .auth-logo {
        font-size: 36px; font-weight: 800;
        color: #f97316; text-align: center;
        margin-bottom: 4px;
    }
    .auth-sub {
        font-size: 13px; color: #64748b;
        text-align: center; margin-bottom: 28px;
    }
    </style>
    <div class="auth-wrap">
      <div class="auth-logo">🎯 VenueScope</div>
      <div class="auth-sub">Venue Intelligence Platform</div>
    </div>
    """, unsafe_allow_html=True)

    col = st.columns([1, 2, 1])[1]
    with col:
        st.markdown("### Sign In")

        # ── Rate limiting / lockout ───────────────────────────────────────────
        now = time.time()
        lockout_until = st.session_state.get("_auth_lockout_until", 0.0)
        if now < lockout_until:
            remaining = int(lockout_until - now)
            st.error(
                f"🔒 Too many failed attempts. "
                f"Try again in **{remaining // 60}m {remaining % 60}s**."
            )
            st.stop()
            return False

        pin = st.text_input("PIN", type="password", placeholder="Enter PIN",
                             key="auth_pin_input",
                             help="PIN can be changed in Settings → Security")

        if st.button("Unlock", type="primary", use_container_width=True):
            if _check_pin(pin):
                st.session_state["authenticated"] = True
                st.session_state["_auth_ts"] = time.time()
                st.session_state.pop("_auth_attempts", None)
                st.session_state.pop("_auth_lockout_until", None)
                if _ENV_PIN == _DEFAULT_PIN:
                    st.session_state["auth_default_pin_warning"] = True
                st.rerun()
            else:
                attempts = st.session_state.get("_auth_attempts", 0) + 1
                st.session_state["_auth_attempts"] = attempts
                remaining_attempts = _MAX_ATTEMPTS - attempts
                if attempts >= _MAX_ATTEMPTS:
                    st.session_state["_auth_lockout_until"] = time.time() + _LOCKOUT_SECONDS
                    st.session_state["_auth_attempts"] = 0
                    st.error(
                        f"🔒 {_MAX_ATTEMPTS} failed attempts — locked out for "
                        f"{_LOCKOUT_SECONDS // 60} minutes."
                    )
                else:
                    st.error(
                        f"Incorrect PIN. "
                        f"{remaining_attempts} attempt(s) remaining before lockout."
                    )

        if _ENV_PIN == _DEFAULT_PIN:
            try:
                from core.config import CONFIG_DIR
                auth_file = CONFIG_DIR / "auth.json"
                if not auth_file.exists():
                    st.warning(
                        "⚠️ Using default PIN `1234`. "
                        "Change it in Settings → 🔐 Security."
                    )
            except Exception:
                pass

    st.stop()
    return False


def logout():
    st.session_state.pop("authenticated", None)
    st.session_state.pop("_auth_ts", None)
