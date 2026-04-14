#!/bin/bash
# Run on the DigitalOcean droplet as root:
#   bash /root/wedid/venuescope/install_service.sh
set -e

SERVICE_FILE="/root/wedid/venuescope/venuescope-worker.service"
SYSTEMD_DEST="/etc/systemd/system/venuescope-worker.service"

echo "Installing VenueScope worker as systemd service..."

cp "$SERVICE_FILE" "$SYSTEMD_DEST"
systemctl daemon-reload
systemctl enable venuescope-worker
systemctl restart venuescope-worker

echo ""
echo "Done. Service status:"
systemctl status venuescope-worker --no-pager

echo ""
echo "Useful commands:"
echo "  View logs:    journalctl -u venuescope-worker -f"
echo "  Restart:      systemctl restart venuescope-worker"
echo "  Stop:         systemctl stop venuescope-worker"
echo "  Disable:      systemctl disable venuescope-worker"
