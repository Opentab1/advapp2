"""
VenueScope — Cognito authentication.

Users log in with their email + password (same credentials as the React app).
The venueId is pulled from their Cognito custom attributes so jobs always sync
to the correct venue — no .env editing required.

Identity is persisted to ~/.venuescope/venue_identity.json so the background
worker process can read the venueId without access to Streamlit session state.
"""
from __future__ import annotations
import json
import os
import time
import hashlib
from pathlib import Path
import streamlit as st

# ── Cognito config ─────────────────────────────────────────────────────────────
_USER_POOL_ID = "us-east-2_sMY1wYEF9"
_CLIENT_ID    = "3issslmbua5d9h5v3ais6iebi2"
_REGION       = "us-east-2"

# ── Identity file (read by aws_sync worker) ────────────────────────────────────
_IDENTITY_DIR  = Path.home() / ".venuescope"
_IDENTITY_FILE = _IDENTITY_DIR / "venue_identity.json"

SESSION_TIMEOUT_MINUTES = 480  # 8 hours
_MAX_ATTEMPTS    = 5
_LOCKOUT_SECONDS = 300


# ── Identity file helpers ──────────────────────────────────────────────────────

def save_identity(venue_id: str, venue_name: str, email: str) -> None:
    """Persist logged-in venue identity so the worker process can read it."""
    try:
        _IDENTITY_DIR.mkdir(parents=True, exist_ok=True)
        _IDENTITY_FILE.write_text(json.dumps({
            "venueId":   venue_id,
            "venueName": venue_name,
            "email":     email,
            "savedAt":   time.time(),
        }, indent=2))
    except Exception as e:
        print(f"[auth] Could not write identity file: {e}", flush=True)


def clear_identity() -> None:
    """Remove identity file on logout."""
    try:
        if _IDENTITY_FILE.exists():
            _IDENTITY_FILE.unlink()
    except Exception:
        pass


def load_identity() -> dict:
    """Read persisted identity. Returns {} if not found."""
    try:
        if _IDENTITY_FILE.exists():
            return json.loads(_IDENTITY_FILE.read_text())
    except Exception:
        pass
    return {}


# ── Cognito auth ───────────────────────────────────────────────────────────────

def _cognito_login(email: str, password: str) -> dict:
    """
    Authenticate against Cognito using USER_PASSWORD_AUTH.
    Returns user attributes dict on success, raises on failure.
    """
    import boto3
    client = boto3.client("cognito-idp", region_name=_REGION)

    resp = client.initiate_auth(
        AuthFlow="USER_PASSWORD_AUTH",
        AuthParameters={"USERNAME": email, "PASSWORD": password},
        ClientId=_CLIENT_ID,
    )

    # Handle new-password-required challenge
    if resp.get("ChallengeName") == "NEW_PASSWORD_REQUIRED":
        raise ValueError("NEW_PASSWORD_REQUIRED")

    # Fetch user attributes
    access_token = resp["AuthenticationResult"]["AccessToken"]
    user_resp    = client.get_user(AccessToken=access_token)

    attrs = {a["Name"]: a["Value"] for a in user_resp.get("UserAttributes", [])}
    return attrs


# ── Public API ─────────────────────────────────────────────────────────────────

def require_auth() -> bool:
    """
    Call at the top of every page. Returns True if authenticated.
    Renders login screen and stops execution if not authenticated.
    """
    if st.session_state.get("authenticated"):
        # Session timeout check
        last_ts = st.session_state.get("_auth_ts", 0)
        if time.time() - last_ts > SESSION_TIMEOUT_MINUTES * 60:
            st.session_state.pop("authenticated", None)
            st.session_state.pop("_auth_ts", None)
            clear_identity()
        else:
            st.session_state["_auth_ts"] = time.time()
            return True

    # ── Login UI ──────────────────────────────────────────────────────────────
    st.markdown("""
    <style>
    .auth-wrap {
        max-width: 400px;
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

        email    = st.text_input("Email", placeholder="you@venue.com", key="auth_email")
        password = st.text_input("Password", type="password", placeholder="Password", key="auth_password")

        if st.button("Sign In", type="primary", use_container_width=True):
            if not email or not password:
                st.error("Enter your email and password.")
            else:
                try:
                    attrs = _cognito_login(email.strip(), password)

                    venue_id   = attrs.get("custom:venueId", "")
                    venue_name = attrs.get("custom:venueName", venue_id)

                    if not venue_id:
                        st.error("Your account has no venue assigned. Contact support.")
                    else:
                        st.session_state["authenticated"] = True
                        st.session_state["_auth_ts"]      = time.time()
                        st.session_state["venue_id"]      = venue_id
                        st.session_state["venue_name"]    = venue_name
                        st.session_state["email"]         = email.strip()
                        st.session_state.pop("_auth_attempts",    None)
                        st.session_state.pop("_auth_lockout_until", None)

                        save_identity(venue_id, venue_name, email.strip())
                        st.rerun()

                except ValueError as e:
                    if "NEW_PASSWORD_REQUIRED" in str(e):
                        st.warning("You must set a new password. Use the React app to complete this first.")
                    else:
                        st.error(str(e))

                except Exception as e:
                    msg = str(e)
                    attempts = st.session_state.get("_auth_attempts", 0) + 1
                    st.session_state["_auth_attempts"] = attempts
                    remaining_attempts = _MAX_ATTEMPTS - attempts

                    if attempts >= _MAX_ATTEMPTS:
                        st.session_state["_auth_lockout_until"] = time.time() + _LOCKOUT_SECONDS
                        st.session_state["_auth_attempts"] = 0
                        st.error(f"🔒 {_MAX_ATTEMPTS} failed attempts — locked out for {_LOCKOUT_SECONDS // 60} minutes.")
                    elif "NotAuthorizedException" in msg or "Incorrect username" in msg:
                        st.error(f"Incorrect email or password. {remaining_attempts} attempt(s) remaining.")
                    elif "UserNotFoundException" in msg:
                        st.error(f"No account found for {email}.")
                    elif "EnableSoftwareTokenMFA" in msg or "USER_PASSWORD_AUTH" in msg:
                        st.error("Login flow not enabled. Contact your administrator.")
                    else:
                        st.error(f"Login failed: {msg}")

    st.stop()
    return False


def get_venue_id() -> str:
    """
    Return the venueId for the currently logged-in user.
    Checks session state first (Streamlit context), then identity file (worker context).
    Falls back to VENUESCOPE_VENUE_ID env var for backwards compatibility.
    """
    # Streamlit session (UI context)
    venue_id = st.session_state.get("venue_id", "")
    if venue_id:
        return venue_id

    # Identity file (worker/background process context)
    identity = load_identity()
    if identity.get("venueId"):
        return identity["venueId"]

    # Legacy fallback
    return os.environ.get("VENUESCOPE_VENUE_ID", "")


def logout():
    st.session_state.pop("authenticated", None)
    st.session_state.pop("_auth_ts",      None)
    st.session_state.pop("venue_id",      None)
    st.session_state.pop("venue_name",    None)
    st.session_state.pop("email",         None)
    clear_identity()
