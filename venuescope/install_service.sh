#!/bin/bash
# Run on the DigitalOcean droplet as root to install/update the worker service.
#   bash /opt/venuescope/venuescope/install_service.sh
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENUESCOPE_DIR="$REPO_DIR/venuescope"
SYSTEMD_DEST="/etc/systemd/system/venuescope-worker.service"
KILL_SCRIPT="/opt/venuescope/kill_stale_workers.sh"

echo "Installing VenueScope worker service..."

# Copy kill script to /opt/venuescope/ (outside venuescope/ subdir so it's
# accessible as ExecStartPre before WorkingDirectory is set)
cp "$VENUESCOPE_DIR/kill_stale_workers.sh" "$KILL_SCRIPT"
chmod +x "$KILL_SCRIPT"
echo "  Installed kill script → $KILL_SCRIPT"

# Install systemd service
cp "$VENUESCOPE_DIR/venuescope-worker.service" "$SYSTEMD_DEST"
systemctl daemon-reload
systemctl enable venuescope-worker
systemctl restart venuescope-worker
echo "  Installed service → $SYSTEMD_DEST"

echo ""
echo "Done. Service status:"
systemctl status venuescope-worker --no-pager

echo ""
echo "Useful commands:"
echo "  View logs:    journalctl -u venuescope-worker -f"
echo "  Restart:      systemctl restart venuescope-worker"
echo "  Stop:         systemctl stop venuescope-worker"
