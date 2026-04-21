#!/bin/bash
# Kill stale venuescope worker_daemon processes before service start.
# Matches by "worker_daemon" in cmdline to catch processes started from any
# working directory. Does NOT kill streamlit or other venv apps.
MYPID=$$
for pid in $(pgrep -f 'worker_daemon' 2>/dev/null); do
    [ "$pid" = "$MYPID" ] && continue
    cmdline=$(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null || echo '')
    if echo "$cmdline" | grep -q python; then
        kill -9 "$pid" 2>/dev/null && echo "Killed stale worker pid=$pid: $cmdline"
    fi
done
sleep 2
exit 0
