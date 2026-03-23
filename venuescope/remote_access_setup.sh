#!/bin/bash
# VenueScope — Remote access setup via Tailscale
# Run this ONCE on the Mac that runs VenueScope.
# Bar owner installs Tailscale on their phone/laptop to access remotely.
#
# Usage: bash remote_access_setup.sh

set -e

echo "================================================"
echo "  VenueScope — Remote Access Setup"
echo "================================================"
echo ""

# 1. Install Tailscale
if command -v tailscale &>/dev/null; then
    echo "✓ Tailscale already installed"
else
    echo "Installing Tailscale..."
    if command -v brew &>/dev/null; then
        brew install --cask tailscale
        echo "✓ Tailscale installed via Homebrew"
    else
        echo ""
        echo "Homebrew not found. Install Tailscale manually:"
        echo "  1. Go to https://tailscale.com/download"
        echo "  2. Download and install the Mac app"
        echo "  3. Re-run this script"
        exit 1
    fi
fi

# 2. Open Tailscale (user needs to log in)
echo ""
echo "Opening Tailscale — log in with Google/GitHub/email..."
open -a Tailscale 2>/dev/null || true
sleep 3

# 3. Get Tailscale IP
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "")
if [ -z "$TAILSCALE_IP" ]; then
    echo ""
    echo "Tailscale not logged in yet."
    echo "  1. Log into Tailscale in the menu bar icon"
    echo "  2. Re-run this script to get your Tailscale IP"
    exit 0
fi

echo "✓ Tailscale IP: $TAILSCALE_IP"

# 4. Update .env to bind to 0.0.0.0 (accessible on Tailscale)
ENV_FILE="$(dirname "$0")/../.env"
if [ -f "$ENV_FILE" ]; then
    sed -i '' 's/VENUESCOPE_BIND=127.0.0.1/VENUESCOPE_BIND=0.0.0.0/' "$ENV_FILE"
    echo "✓ Updated .env: VENUESCOPE_BIND=0.0.0.0"
else
    echo "VENUESCOPE_BIND=0.0.0.0" >> "$ENV_FILE"
    echo "✓ Created .env with VENUESCOPE_BIND=0.0.0.0"
fi

# 5. Restart the app to pick up new bind address
echo ""
echo "Restarting VenueScope with network access..."
pkill -f "streamlit run app/main.py" 2>/dev/null || true
pkill -f "worker_daemon.py" 2>/dev/null || true
sleep 2
cd "$(dirname "$0")"
nohup bash start.sh > /tmp/venuescope_restart.log 2>&1 &
sleep 3

echo ""
echo "================================================"
echo "  DONE — Remote Access Active"
echo "================================================"
echo ""
echo "  On THIS Mac:     http://localhost:8501"
echo "  On phone/laptop: http://$TAILSCALE_IP:8501"
echo ""
echo "  Share with bar owner:"
echo "  ─────────────────────────────────────────────"
echo "  1. Have them install Tailscale:"
echo "     iPhone: App Store → Tailscale"
echo "     Android: Play Store → Tailscale"
echo "     Laptop: https://tailscale.com/download"
echo ""
echo "  2. They log in to Tailscale (same account or"
echo "     you add them to your Tailscale network)"
echo ""
echo "  3. They open: http://$TAILSCALE_IP:8501"
echo "  ─────────────────────────────────────────────"
echo ""
echo "  The Mac must stay on and connected."
echo "  PIN: change it in Settings > Security."
echo ""
