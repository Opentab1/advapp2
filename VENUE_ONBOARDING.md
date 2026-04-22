# Venue Onboarding Playbook
*How to bring a new Pulse venue to ≥95% accuracy on every feature in ~1 day.*

This document captures everything we learned landing Blind Goat. Follow the
steps in order. **Every step exists because skipping it has caused a
silent-failure mode in production before.**

---

## 0 · Prerequisites

Before touching anything in the admin portal:

- [ ] Venue has a **DigitalOcean droplet** (8 vCPU / 16 GB recommended once
      they hit 10+ cameras; 1 vCPU / 1 GB is fine for 3–5 cams only)
- [ ] Droplet has **Caddy + the worker + webhook services** running
      (clone from `venuescope_v6` repo, systemd units under `deploy/`)
- [ ] Caddy's `/etc/caddy/Caddyfile` has a `/cam/*` block reverse-proxying
      to the venue's **HTTP HLS port** (not RTSP). Verify with:
      ```
      curl -sS -o /dev/null -w "%{http_code} %{content_type}\n" \
        "http://<nvr_public_ip>:<http_port>/hls/live/ch1/1/livetop.mp4"
      ```
      Expect `200 video/mp4`. If it 404s, the NVR isn't serving HLS — pick
      a different port or a different playback path.
- [ ] `VENUESCOPE_NVR_HOST` in `/opt/venuescope/venuescope/.env` matches the
      host:port the Caddyfile points at (the snapshot service reads this)
- [ ] `VITE_ADMIN_API_URL` env var in Amplify points at the shared
      `VenueScopeAdminAPI` Lambda
- [ ] The venue exists in `VenueScopeVenues` DDB table with `venueId`
      matching what Cognito will send

---

## 1 · Connect cameras (10–20 min depending on count)

Admin → Cameras → Add a venue section → **Discover Cameras (Cortex IQ)**
auto-probes common NVR channels.

For each camera:
- [ ] Rename to something human (`CH1 Main Floor`, not `cam_1776...`)
- [ ] Set the correct **modes** (multi-select):
  - `drink_count` — bar cameras
  - `bottle_count` — bar cameras (same cameras as drink_count usually)
  - `people_count` — entrance + room cameras
  - `table_turns` — dining floor cameras
  - `table_service` — same cameras as table_turns (server visits tracked
    from the same polygons)
  - `staff_activity` — back-of-house cameras
  - `after_hours` — storage / walk-in cameras

**If a camera should be doing multiple jobs** (e.g. a floor cam does
`table_turns + people_count + table_service`), pick the **primary mode first**.
The primary determines which continuous loop runs; extras piggyback on the
same job.

- [ ] Set the venue-level **`camProxyUrl`** in the customer app's Settings
      page to the Caddy proxy URL (e.g. `https://<droplet>.sslip.io/cam`).
      Preview tiles and the /snapshot/* endpoint both depend on this.

---

## 2 · Verify NVR health before zone drawing

Skip zone-drawing if the NVR can't deliver frames. Check all at once:

```bash
# From admin → Cameras, click "Expand All" — every tile should show a
# JPEG snapshot within ~1 second. If any tile is black or says
# "Preview unavailable", debug that before moving on.

# Also run from the droplet:
for ch in $(seq 1 16); do
  printf "ch%-2s " "$ch"
  curl -sS -o /dev/null -w "HTTP %{http_code}\n" --max-time 5 \
    "http://<nvr_ip>:<port>/hls/live/ch$ch/1/livetop.mp4"
done
```

Common issues:
- **Router port-forward rule drifted** (happens monthly on residential
  Cablemodems): admin → Cameras → Change IP/Port → update the Caddyfile
  upstream port via the UI. No SSH needed.
- **NVR only serves main stream, not sub**: fall back to `/0/livetop.mp4`
  but expect slow snapshot load times.
- **Too many concurrent streams saturate NVR upstream**: cap the worker's
  parallel jobs with `VENUESCOPE_WORKERS=N` in `.env`.

---

## 3 · Auto-config Layer 1 (takes itself)

When a new `drink_count` or `table_turns`/`table_service` camera is enabled,
the worker's main loop runs auto_bar_config / auto_table_config within 60
seconds. No action required — just wait.

**Verify it ran:**
```bash
ssh root@<droplet> journalctl -u venuescope-worker --since "5 min ago" \
  | grep -E 'layer1|auto_bar|auto_table'
```
Expect lines like `[layer1] Saved bar config for <venue>/<cam>` or
`[layer1] Saved N table zones`. An empty result logs `No tables detected —
operator can draw manually` and enters a **24h cooldown** so the worker
doesn't hammer the NVR.

---

## 4 · Drink-count calibration against POS ground truth (30 min)

Auto-config gets us to ~70%. POS-calibration gets us to ~95%+.

**Pick a clip from a previous busy shift** (last Friday 9:00–9:15 PM is ideal):
- 5–10 minutes of MP4
- Pulled from the NVR's playback export
- Must have **real drink activity** (if it's a quiet moment, calibration
  finds nothing to calibrate against)

**Get the actual POS count** for that exact window — total drinks rung by
the bartenders working that camera.

**Run calibration:**
- Admin → Bar Calibration
- Pick venue + camera
- Drag the MP4
- Enter the actual count
- Run

The engine sweeps 8 bar-line Y positions × 2 customer-side options = 16
configs, picks the one that matches the POS number best, and one-click
applies. Accuracy at this point is typically 90-99%.

**Repeat for every drink_count camera.** If two cameras cover the same bar
from different angles (`Main Overhead Bar` + `Side View Bar`), the same
POS count works for both — calibrate once per camera.

---

## 5 · Table-zone verification (15 min)

Auto-detection (YOLO COCO class 60 = dining table) catches most tables but
misses heavily-occluded ones and false-positives on pool tables, bar tops,
etc.

For each `table_turns` / `table_service` camera:
- [ ] Admin → Cameras → click the **Tables** button on the camera row
- [ ] **Click "Auto-detect tables"** to populate initial polygons
- [ ] Drag / resize each polygon to cover the **actual seating area**
      (chair + body, not just the table top)
- [ ] Give each table a clear label (`Booth 3`, `Table 14`) — it shows up
      in reports
- [ ] Inline linter blocks Save on critical errors (tiny polygon, overlapping
      tables) and warns on risky configs
- [ ] Save

---

## 6 · People-count calibration (10 min)

Lightweight sparse YOLO. Runs every ~20 min per camera by default (to save
CPU). Verify it's working:

```bash
# From the droplet, check the most recent sparse-runner log:
journalctl -u venuescope-worker --since "1 hour ago" \
  | grep -E 'sparse YOLO|peak_occ|frame_estimates'
```

Expect `peak=N` lines with N > 0 when the venue is active. If always 0:
- YOLO conf threshold may be too high for low-light — set model profile
  to `low_quality` in admin for that camera
- Camera angle may be too extreme — IR / fisheye needs `overhead_camera:
  true` in the bar config (the flag also applies to people_count)

---

## 7 · Business hours + venue settings (5 min)

- [ ] Customer app → Settings → set **Business Hours** per day of week
- [ ] Settings → **Capacity** (max people) — drives occupancy % warnings
- [ ] Settings → **Avg drink price** — drives theft loss estimates
- [ ] Settings → **Camera proxy URL** (`https://<droplet>.sslip.io/cam`)

---

## 8 · Email reports (2 min)

Admin → Settings → Email Reporting:
- [ ] Add the venue owner's email
- [ ] Pick daily or weekly cadence
- [ ] Save

---

## 9 · POS Integration (if available)

Adds ~30 min to the process but unlocks:
- Layer 3 nightly auto-tune (POS variance automatically re-calibrates zones)
- POS vs. Pulse variance on dashboard
- Theft-loss calculation from unrung drinks

Add to `/opt/venuescope/venuescope/.env`:
```
SQUARE_ACCESS_TOKEN=<token>      # from Square → Apps → Custom integration
# OR
TOAST_API_KEY=<key>              # from Toast → APIs → Orders
```

Restart the webhook service:
```
systemctl restart venuescope-webhook
```

First variance data appears the next morning at 3 AM when the nightly
auto-tune cron runs.

---

## 10 · Watch it live for 30 minutes

Open the customer VenueScope page and eyeball:

- [ ] **Drinks per hour** climbing as shift warms up (not stuck at 0)
- [ ] **Table occupancy tiles** flipping occupied/empty as parties turn
- [ ] **People count** showing a realistic headcount
- [ ] **Admin "Zones may be misaligned" badge** NOT appearing on any camera
      (if it does, re-check layout for that camera)

Admin → Cameras tab should show every camera with a **green status dot**
and a **Layout Score** once we ship Layer C.

---

## Silent-failure killers — physical problems the software can't fix

These need venue intervention (tape, matting, physical changes):

| Problem | How it shows up | Fix |
|---|---|---|
| Mirror behind bar | Reflection counted as 2nd bartender on wrong side | Cover with art/tape or redraw polygon to include reflection |
| Polished stainless counter | Same, smaller scale | Fabric runner over the counter |
| Customer-visible monitor showing a cam feed | "Inception" false detections | Ignore-zone over the monitor area |
| Fluorescent anti-flicker off | Detection jitter, low-conf serves | Enable anti-flicker in NVR camera settings |
| Fisheye edge distortion | Detection degrades at corners | Enable `overhead_camera: true`; the dewarping pipeline kicks in |

---

## Post-onboarding maintenance

**Weekly:**
- Check admin → Cameras for amber "Zones may be misaligned" banners
- Review the low-confidence events queue (admin → Review Queue)

**Monthly:**
- Re-run Bar Calibration with fresh POS data — recalibrates in case the
  bartender work pattern has drifted or the NVR firmware changed stream
  characteristics
- Check disk retention on the droplet (`df -h`) — segment dir at
  `/opt/venuescope/venuescope/data/results/` should auto-prune but verify

**As-needed:**
- Router port-forward rule changed: admin → Cameras → Change IP/Port
- Add a new camera: it auto-configs within 60s
- Remove a camera: orphan reaper kills its worker within 30s

---

## Known failure modes we've fixed (don't re-introduce)

1. **`auto_bar_config` wrote `auto_detected: true` into the JSON but
   `BarConfig.__init__` didn't accept that key.** Every auto-saved
   config got silently rejected on load → `[BAR_CONFIG_MISSING]` error
   → 0 drinks counted. *Fix in commit `ea41371`.*

2. **Admin Lambda stripped `tableZonesJson` from `/admin/cameras`
   response** — customer side always worked because it reads DDB
   directly; admin side silently showed no overlays. *Fixed by
   bypassing Lambda for per-venue listing in commit `5460489`.*

3. **Caddy upstream port drifted** — router re-assigned HTTP port,
   every camera tile 502'd. *Fixed with `/ops/cam-proxy` endpoint +
   admin UI for self-service port updates.*

4. **Worker consuming all NVR upstream bandwidth** caused the snapshot
   pipeline to 502 for operators. *Fixed by moving snapshot pipeline
   to cv2 persistent captures (one per channel) rather than spawning
   ffmpeg per request.*

5. **Layer 1 auto-config loop** re-ran analyze_stream every 60s on
   cameras where detection returned empty, hammering the NVR
   indefinitely. *Fixed with a 24h cooldown on failed attempts.*

6. **Chrome waits 77 seconds** for canplay on this NVR's fMP4 live
   stream — the `<video>` tile never rendered before our 12s timeout.
   *Fixed by ditching `<video>` for `<img>` against a server-side
   JPEG snapshot pipeline.*

---

## Recipe for venue #2 deploy (copy-paste checklist)

```
Pre-flight (30 min):
  [ ] Droplet provisioned + services running
  [ ] NVR HLS reachable (curl returns 200 + video/mp4)
  [ ] Caddyfile /cam/* points at correct NVR host:port
  [ ] .env has AWS creds + VENUESCOPE_NVR_HOST
  [ ] Venue in VenueScopeVenues DDB table

Onboard (45 min):
  [ ] Discover + add cameras in admin portal
  [ ] Set modes per camera
  [ ] Set camProxyUrl in customer Settings
  [ ] Wait 60s → verify every camera has auto-config (bar + tables)
  [ ] Pull last-Friday clip + POS count for one drink_count camera
  [ ] Admin → Bar Calibration → run + apply
  [ ] Repeat for each drink_count camera
  [ ] Tables: Auto-detect + manual tweaks per floor camera
  [ ] Set business hours + capacity + avg drink price
  [ ] Enable email reports

Validate (20 min):
  [ ] Watch live VenueScope for 20 min during active service
  [ ] Confirm drinks counting, tables flipping, people showing
  [ ] No amber "Zones may be misaligned" banner anywhere

Optional (30 min):
  [ ] Add POS creds to .env + restart webhook
  [ ] Verify nightly auto-tune cron is installed
```

Total: **~1 day from zero to live with ≥95% accuracy.**
