FROM python:3.11-slim

# System deps: OpenCV runtime, ffmpeg for RTSP, and build tools for lapx
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (cached layer)
COPY venuescope/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download YOLO models so the container doesn't need internet at runtime
RUN python -c "\
from ultralytics import YOLO; \
YOLO('yolov8n.pt'); \
YOLO('yolov8s.pt'); \
print('Models pre-downloaded.')"

# Copy application code
COPY venuescope/ .

# Data directories
RUN mkdir -p /data/results /data/uploads /data/configs /data/logs

ENV VENUESCOPE_DATA_DIR=/data
ENV VENUESCOPE_LOG_FILE=/data/logs/venuescope.log
ENV VENUESCOPE_LOG_LEVEL=INFO
ENV YOLO_TELEMETRY=False
ENV ULTRALYTICS_AUTOINSTALL=False

# ── Streamlit dashboard ───────────────────────────────────────────────────────
EXPOSE 8501
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8501/_stcore/health || exit 1

# Default: run the Streamlit app
# Override CMD to run worker_daemon.py for the worker container
CMD ["streamlit", "run", "app/main.py", \
     "--server.port=8501", \
     "--server.address=0.0.0.0", \
     "--server.headless=true", \
     "--browser.gatherUsageStats=false"]
