#!/bin/bash
cd /opt/venuescope/venuescope
git fetch origin && git reset --hard origin/main
pkill -f worker_daemon.py
sleep 2
nohup /opt/venuescope/venv/bin/python worker_daemon.py >> /opt/venuescope/worker.log 2>&1 &
disown
echo "Worker restarted (PID $!)"
