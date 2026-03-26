#!/bin/bash
# VenueScope v6 — Mac startup script
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "================================================"
echo "  VenueScope v6"
echo "================================================"

# Load .env if present
if [ -f "$SCRIPT_DIR/../.env" ]; then
    set -a
    source "$SCRIPT_DIR/../.env"
    set +a
    echo "✓ Loaded .env"
fi

# Kill any existing instances
pkill -f "streamlit run app/main.py" 2>/dev/null || true
pkill -f "worker_daemon.py" 2>/dev/null || true
sleep 1

export YOLO_TELEMETRY=False
export ULTRALYTICS_AUTOINSTALL=False
export STREAMLIT_BROWSER_GATHERUSAGESTATS=false
export PYTHONPATH="$SCRIPT_DIR"

# PIN: auth.json (set in Settings) > VENUESCOPE_PIN env var > warn
if python3 -c "
import json; from pathlib import Path
auth = Path('data/configs/auth.json')
exit(0 if auth.exists() and 'pin_hash' in json.loads(auth.read_text()) else 1)
" 2>/dev/null; then
    echo "✓ PIN set (auth.json)"
elif [ -n "$VENUESCOPE_PIN" ]; then
    echo "✓ PIN set (env var)"
else
    echo ""
    echo "  WARNING: Using default PIN 1234"
    echo "  Change it in the app: Settings > Security > Change PIN"
    echo ""
    export VENUESCOPE_PIN="1234"
fi

# Check dependencies
python3 -c "import streamlit, sqlalchemy, ultralytics, cv2" 2>/dev/null || {
    echo ""
    echo "Missing dependencies. Run:"
    echo "  pip3 install -r requirements.txt lapx"
    exit 1
}
echo "✓ Dependencies OK"

# Start worker daemon
echo "✓ Starting worker..."
nohup python3 worker_daemon.py >> worker.log 2>&1 &
WORKER_PID=$!
sleep 1
if kill -0 $WORKER_PID 2>/dev/null; then
    echo "✓ Worker running (PID $WORKER_PID)"
else
    echo "ERROR: Worker failed. Check worker.log"
    tail -10 worker.log
    exit 1
fi

# Network access mode: local (default) or network (0.0.0.0 for Tailscale/LAN)
BIND_ADDR="${VENUESCOPE_BIND:-127.0.0.1}"
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')

echo ""
if [ "$BIND_ADDR" = "0.0.0.0" ]; then
    echo "  Local:   http://localhost:8501"
    echo "  Network: http://$LOCAL_IP:8501"
else
    echo "  Open: http://localhost:8501"
    echo "  (For network access: VENUESCOPE_BIND=0.0.0.0 ./start.sh)"
fi
echo "  Worker log: tail -f $SCRIPT_DIR/worker.log"
echo ""

exec python3 -m streamlit run app/main.py \
    --server.headless=true \
    --server.address="$BIND_ADDR" \
    --server.port="${VENUESCOPE_PORT:-8501}" \
    --server.maxUploadSize=10000 \
    --server.maxMessageSize=10000 \
    --browser.gatherUsageStats=false
