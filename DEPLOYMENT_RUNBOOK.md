# VenueScope Deployment Runbook — 10-Venue Rollout

## Prerequisites (one-time, per droplet)

```bash
# Install system deps
apt-get update && apt-get install -y python3-pip ffmpeg libgl1

# Install Python deps
cd /opt/venuescope/venuescope
pip3 install -r requirements.txt

# Install systemd service (auto-restart on crash)
cp venuescope.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable venuescope-worker
```

## Per-Venue Setup Checklist

For each new venue, complete ALL steps before going live:

### Step 1 — Environment
- [ ] Add `VENUESCOPE_VENUE_ID=<venue_id>` to `/opt/venuescope/venuescope/.env`
- [ ] Verify AWS creds in `.env`: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- [ ] Confirm venue exists in DynamoDB (VenueScopeVenues table)

### Step 2 — Camera Registration
- [ ] Add camera in admin UI (Settings → Cameras → Add Camera)
- [ ] Enter RTSP URL (format: `rtsp://user:pass@192.168.x.x:554/stream1`)
- [ ] Test stream connectivity: Settings → Cameras → Test Stream
- [ ] Confirm first frame is NOT black (H.265 codec check)

### Step 3 — Bar Config (CRITICAL — zero drinks without this)
- [ ] Open Layout page for this camera
- [ ] Draw zone polygon covering the bartender area
- [ ] Draw bar-front line between bartender and customer side
- [ ] Set customer_side (which side the customers are on)
- [ ] Click "Save Config"
- [ ] Verify config saved: camera should show "Config: ready" in admin UI

### Step 4 — Validation Test
- [ ] Run a 2-minute test clip from this camera
- [ ] Verify at least 1 drink detected (or confirm no serves happened)
- [ ] Review annotated output — check zone and bar line placement look correct
- [ ] Adjust bar line Y position if counts seem wrong

### Step 5 — Go Live
- [ ] Enable continuous monitoring in camera settings
- [ ] Confirm worker picks up job within 30 seconds
- [ ] Check health endpoint: `curl http://<droplet_ip>:8765/health`
- [ ] Verify data flowing to React dashboard

### Step 6 — Monitoring
- [ ] Bookmark `/health` endpoint for this droplet
- [ ] Set up uptime monitor on `/health` (e.g. UptimeRobot, free tier)
- [ ] Verify theft alerts are going to the right email/Slack

## Worker Management

```bash
# Start worker (systemd)
systemctl start venuescope-worker

# Stop worker
systemctl stop venuescope-worker

# View logs (live)
journalctl -u venuescope-worker -f

# Check health
curl http://localhost:8765/health

# Check worker status
systemctl status venuescope-worker

# Restart after code update
cd /opt/venuescope/venuescope && git pull origin main
systemctl restart venuescope-worker
```

## Deploying Code Updates

```bash
ssh root@137.184.61.178
cd /opt/venuescope/venuescope
git pull origin main
systemctl restart venuescope-worker
# Verify it came back up
sleep 5 && curl http://localhost:8765/health
```

## H.265 Camera Troubleshooting

If a camera stream shows black frames or zero detections:
```bash
# Check if ffmpeg has HEVC support
ffmpeg -codecs 2>/dev/null | grep hevc

# If missing, install
apt-get install -y ffmpeg
# or on older Ubuntu:
add-apt-repository ppa:mc3man/trusty-media
apt-get install ffmpeg

# Test stream directly
ffplay rtsp://user:pass@camera_ip:554/stream1
```

## Multi-Venue Scaling Notes

- Current: MAX_PARALLEL=4 workers, max 2 per venue (fair queue)
- 10 venues × 1 camera = 10 continuous jobs cycling through 4 slots
- Each job runs until stream disconnect, camera loop relaunches within 10s
- If processing falls behind (queue depth > 5), increase droplet RAM or add a second droplet

## Emergency Contacts

- Droplet IP: 137.184.61.178
- Code repo: github.com/BringThemBack/wedid (main branch)
- React: github.com/Opentab1/advapp2 (main branch)
