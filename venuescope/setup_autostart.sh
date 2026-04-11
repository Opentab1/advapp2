#!/bin/bash
# VenueScope — One-time autostart setup
# Run once on the venue Mac: bash setup_autostart.sh
# After this, VenueScope starts automatically on every boot/login.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_DST="$HOME/Library/LaunchAgents/com.venuescope.plist"
PYTHON="/Library/Frameworks/Python.framework/Versions/3.12/bin/python3"
USER_HOME="$HOME"

echo "================================================"
echo "  VenueScope — Autostart Setup"
echo "================================================"
echo ""

# ── 1. Prevent sleep ─────────────────────────────────────────────────────────
echo "→ Disabling sleep..."
sudo pmset -a sleep 0 disksleep 0 powernap 0
sudo pmset -a womp 1   # wake on network access
echo "  ✓ Mac will not sleep"
echo ""

# ── 2. Tailscale ─────────────────────────────────────────────────────────────
echo "→ Setting up Tailscale..."
if command -v tailscale &>/dev/null; then
    echo "  ✓ Tailscale already installed"
else
    if command -v brew &>/dev/null; then
        echo "  Installing Tailscale via Homebrew..."
        brew install tailscale
    else
        echo "  ✗ Homebrew not found."
        echo "    Install Tailscale manually: https://tailscale.com/download/mac"
        echo "    Then re-run this script."
        exit 1
    fi
fi

# Start the Tailscale system daemon (needs sudo)
if ! sudo tailscaled --state=/var/lib/tailscale/tailscaled.state &>/dev/null & then
    true  # already running — that's fine
fi
sleep 2

echo ""
echo "  Connecting to Tailscale..."
echo "  (A browser window may open to log in — use the same account on all your devices)"
echo ""
sudo tailscale up --accept-routes || true

TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "")
if [ -n "$TAILSCALE_IP" ]; then
    echo "  ✓ Tailscale connected — your Mac's address: $TAILSCALE_IP"
    echo "  → Access VenueScope from anywhere at: http://$TAILSCALE_IP:8501"
else
    echo "  ⚠ Tailscale not yet connected. Run 'sudo tailscale up' after setup."
fi
echo ""

# ── 3. LaunchAgent plist ─────────────────────────────────────────────────────
echo "→ Creating LaunchAgent (auto-start on login)..."

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_DST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.venuescope</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT_DIR/start.sh</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>VENUESCOPE_BIND</key>
        <string>0.0.0.0</string>
        <key>PATH</key>
        <string>/Library/Frameworks/Python.framework/Versions/3.12/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>$USER_HOME</string>
        <key>YOLO_TELEMETRY</key>
        <string>False</string>
        <key>ULTRALYTICS_AUTOINSTALL</key>
        <string>False</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>$SCRIPT_DIR/autostart.log</string>

    <key>StandardErrorPath</key>
    <string>$SCRIPT_DIR/autostart.log</string>
</dict>
</plist>
PLIST

# Unload first if already loaded (avoids duplicate)
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load -w "$PLIST_DST"
echo "  ✓ LaunchAgent installed and started"
echo ""

# ── 4. Auto-login reminder ───────────────────────────────────────────────────
echo "================================================"
echo "  IMPORTANT: Enable Auto-Login"
echo "================================================"
echo ""
echo "  LaunchAgents run after login. To start VenueScope"
echo "  automatically on reboot (without anyone typing a password):"
echo ""
echo "  System Settings → Users & Groups → Automatic login → opentab"
echo ""
echo "  If the Mac has FileVault enabled, auto-login is disabled by"
echo "  Apple for security. In that case, someone needs to log in once"
echo "  after a reboot — everything else is automatic after that."
echo ""

# ── 5. Summary ───────────────────────────────────────────────────────────────
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "pending")
echo "================================================"
echo "  Setup Complete"
echo "================================================"
echo ""
echo "  ✓ Sleep:      disabled"
echo "  ✓ Tailscale:  $TAILSCALE_IP"
echo "  ✓ Auto-start: on every login"
echo "  ✓ VenueScope: starting now..."
echo ""
echo "  Access from anywhere:  http://$TAILSCALE_IP:8501"
echo "  Logs:                  tail -f $SCRIPT_DIR/autostart.log"
echo "                         tail -f $SCRIPT_DIR/worker.log"
echo ""
