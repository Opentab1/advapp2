#!/bin/bash
# VenueScope v6 — Mac startup script
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "================================================"
echo "  VenueScope v6"
echo "================================================"

# Kill any existing instances
pkill -f "streamlit run app/main.py" 2>/dev/null || true
pkill -f "worker_daemon.py" 2>/dev/null || true
sleep 1

export YOLO_TELEMETRY=False
export ULTRALYTICS_AUTOINSTALL=False
export STREAMLIT_BROWSER_GATHERUSAGESTATS=false
export PYTHONPATH="$SCRIPT_DIR"

if [ -z "$VENUESCOPE_PIN" ]; then
    echo "  PIN: 1234 (default — set with VENUESCOPE_PIN=xxxx ./start.sh)"
    export VENUESCOPE_PIN="1234"
else
    echo "✓ Custom PIN set"
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

echo ""
echo "  Open: http://localhost:8501"
echo "  Worker log: tail -f $SCRIPT_DIR/worker.log"
echo ""

exec python3 -m streamlit run app/main.py \
    --server.headless=true \
    --server.address=127.0.0.1 \
    --server.port=8501 \
    --browser.gatherUsageStats=false
