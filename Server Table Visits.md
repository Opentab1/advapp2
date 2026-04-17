# Server Table Visits — Research & Implementation Notes

Internal reference document. All findings from R&D session April 16-17, 2026.

---

## What This Is

A computer vision feature that tracks how many times a server visits a table during a shift — check-ins, order taking, food delivery, etc. Gives restaurant managers visibility into service quality and table neglect.

---

## Market Research

No off-the-shelf product exists that does this cleanly. The space is fragmented:

- **Wobot.ai** ($5.4M raised) — touches QSR compliance and wait time detection but not per-table visit counting
- **PreciTaste** ($24M raised) — kitchen-side camera analytics, not dining room
- **SciForce** — built a custom engagement for a 1,200-location chain using YOLO + DeepSORT + POS integration. Not a product you can buy, bespoke services engagement
- **Cisco Meraki MV** — general people counting, no staff/customer role differentiation

**Conclusion:** This is a real gap in the market. No company owns it. The infrastructure VenueScope already runs (YOLO + ByteTrack + zone polygons) is architecturally identical to what deployed systems use.

---

## The Core Problem

Differentiating servers from customers. Every existing solution struggles with this. Three approaches used in the wild:

1. Uniform color classification — requires per-venue training data, breaks with casual dress codes
2. POS correlation — retroactively labels server positions using order timestamps, requires tight POS integration
3. Entry zone seeding — staff enter from kitchen/back-of-house, customers from front door

None of these alone is sufficient. The solution is combining multiple signals.

---

## The Approach

### Key Insight: Don't Classify in Real-Time

Observe for 3-5 minutes, then retroactively label. By then behavioral patterns are clear. Once a track is labeled as a server, go back through its full position history and log every table zone entry that lasted >15 seconds as a confirmed visit — including ones before the label was assigned. This solves the first-visit problem entirely.

---

### Four Signals — No Custom Model Training Required

**Signal 1 — The Shrink Event (identifies customers, fires instantly)**

From an overhead camera, a seated person's bounding box is 30-60% smaller than a standing person's (confirmed by overhead camera research datasets). When a standing track enters a table zone and bbox area drops 40%+ within 3 frames → person sat down → customer. Lock the label.

From a side camera this is even simpler — you can literally see whether someone is sitting or standing.

```
Track enters table zone
bbox area: 4000px → 1600px over 3 frames
→ CUSTOMER (locked)
```

**Signal 2 — Multi-Zone Traversal (identifies servers, fires within ~5 min)**

A server visits 3+ distinct table zones per shift. A customer sits at one table and never enters another table's polygon. This is the strongest single signal — customers physically don't walk into multiple table zones, they pass near them at most.

```
Track enters zone A → zone C → zone F
→ SERVER (locked), retroactively log all prior zone entries as visits
```

**Signal 3 — Object Detection (identifies servers, fires instantly)**

YOLO's COCO model already detects: bowl (class 45), cup (41), fork (42), knife (43), spoon (44). A moving track whose bounding box overlaps any of these = server carrying food. Customers don't carry plates across a restaurant floor. No additional training needed.

**Signal 4 — Service Zone Origin (strong server prior, fires on entry)**

Define a small polygon at the kitchen door or service station. Any track originating from this zone gets an immediate server prior before visiting a single table.

---

### Scoring System

Each tracked person gets a `server_score` 0.0–1.0, updated each frame:

| Event | Score Change |
|---|---|
| Originated from service/kitchen zone | +0.6 |
| Bbox overlaps plate/tray/bowl while moving | +0.8 |
| Entered 2nd unique table zone | +0.4 |
| Entered 3rd unique table zone | Lock as server (1.0) |
| Bbox shrank 40%+ entering table zone | Lock as customer (0.0) |
| Stationary in one zone >5 minutes | -0.5 |
| Arrived simultaneously with 2+ other people | -0.3 |

Once locked either way, the label persists for the full track lifetime including re-identification across stream reconnects.

---

### Sample Shift Output

```
TABLE VISIT SUMMARY — April 16 2026 — Blind Goat

Table 4:   9 visits   avg gap: 12min   longest gap: 26min  ⚠️
Table 7:   6 visits   avg gap: 18min   longest gap: 34min  🚨 NEGLECTED
Table 2:  12 visits   avg gap:  8min   longest gap: 14min
Table 9:   7 visits   avg gap: 15min   longest gap: 22min

SERVER BREAKDOWN:
  Server A (Track 07):  34 visits   avg duration: 1m45s
  Server B (Track 12):  28 visits   avg duration: 2m10s

FLAGS:
  Table 7 — 34-minute gap between visits at 9:12 PM
  Table 4 — 26-minute gap between visits at 10:45 PM
```

Tables flagged if gap exceeds a configurable threshold (e.g. 20 minutes).

---

## Camera Requirements

### Overhead Cameras
- Best for zone containment — clean polygon per table, no ambiguity
- No occlusion from seated customers
- Seated/standing detection requires bbox area math (the shrink event)
- Tray/plate detection harder (top-down view of objects)

### Side Cameras
- Seated vs standing is visually obvious — no math needed
- Tray/plate carrying clearly visible
- Zone containment is harder — tables visually overlap from the side
- Occlusion behind groups of seated customers

### Verdict
Either works. Side cameras are more common in restaurants (wall-mounted) and actually easier for the seated/standing signal. The trade-off is losing per-table precision — with side cameras you get section-level granularity ("left section," "middle section") rather than exact table IDs. Still operationally useful — managers know which section is being neglected.

No new camera installs required if the restaurant already has floor cameras.

---

## CPU Cost

### Current Baseline (Blind Goat)
- 2 drink-count cameras (CH8 + CH9) continuous: **~36% CPU total**
- Droplet: 2 vCPU, 8GB RAM, ~$24/mo (DigitalOcean)

### People Detection (simpler than drink count)
- No bar line crossing, no bottle tracking, no complex ByteTrack persistence
- At imgsz=320, 0.5fps: **~8-12% CPU per camera**

### Deployment Scenarios

**Option A — 3-4 floor cameras, side or overhead (fits current droplet)**

| Component | CPU |
|---|---|
| CH8 + CH9 drink count continuous | 36% |
| 3 floor cameras table service continuous | 30% |
| Total | ~66% |

Comfortable on current droplet. 34% headroom for spikes.

**Option B — 10 floor cameras continuous (needs upgrade)**

| Component | CPU |
|---|---|
| CH8 + CH9 drink count continuous | 36% |
| 10 floor cameras table service continuous | 80-100% |
| Total | ~116-136% |

Exceeds 1 vCPU. Needs 2-vCPU droplet ($24/mo DigitalOcean). With 200% capacity, runs at ~60-70% load with headroom.

**Option C — 10 floor cameras scheduled (fits current droplet with constraints)**

Scan each camera for 60 seconds every 5 minutes (20% duty cycle). Cheap but breaks the retroactive visit logging — you need continuous tracking to connect the same server across multiple table visits over an hour.

Not recommended for this use case. Continuous tracking is required for the multi-zone traversal signal to work correctly.

### Recommendation

Start with Option A — instrument 3-4 cameras covering the main dining areas. Validate the detection quality. If accuracy is good and the venue wants full coverage, upgrade to a 2-vCPU droplet and run all floor cameras.

---

## Implementation Complexity

Built on top of existing VenueScope infrastructure:

- YOLO + ByteTrack already running — no new models needed
- Zone polygon system already exists (same as bar zones)
- New config fields needed: `table_zones` (list of polygons), `service_zone` (kitchen door polygon)
- New analyzer class: `ServerVisitDetector`
- New DDB fields: `tableVisits`, `serverBreakdown`, `neglectedTables`

Estimated build time: moderate. The detection logic is straightforward. The main work is the retroactive visit logging and the UI to display per-table visit timelines.

---

## Status

Research complete. Not yet built. Flagged as a future feature for VenueScope restaurant clients.
