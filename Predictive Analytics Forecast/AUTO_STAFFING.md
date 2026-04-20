# VenueScope — Auto-Staffing System
## Full Architecture, Formula, and Implementation

---

## Overview

The auto-staffing system converts tonight's occupancy forecast into per-hour staff headcounts. It runs alongside the Prophet forecasting pipeline every morning at 6 AM, learns from each venue's actual bartender throughput, and drives two frontend features:

1. **Tonight's Coverage** (Events tab → Tonight's Forecast) — hourly grid showing bartenders/door/barback needed tonight
2. **Month Schedule** (Staff tab → Schedule) — full calendar with AI Auto-fill that pre-populates the entire month with suggested shifts

**Philosophy:** Industry averages at cold start. Venue-learned values within 30–60 days. The model gets smarter every morning.

---

## Source Files

| File | Purpose |
|---|---|
| `venuescope/core/staffing/venue_physics.py` | Reads/writes venue config from DynamoDB (bar stations, capacity, thresholds) |
| `venuescope/core/staffing/bartender_learner.py` | Learns per-bartender dph + drinks-per-cover from job history; writes to DynamoDB |
| `venuescope/core/staffing/staffing_engine.py` | Converts hourly occupancy curve into per-role staff counts |
| `venuescope/core/prophet_forecast/forecast_service.py` | Integrates staffing engine; adds `staffing_hourly` to forecast JSON output |
| `venuescope/workers/forecast_cron.py` | Runs bartender learner at 6 AM before Prophet retraining |
| `src/pages/Events.tsx` | TonightTab — displays Tonight's Coverage hourly grid |
| `src/pages/Staffing.tsx` | Month calendar + Auto-fill Month button |

---

## Step 1 — Bartender Capacity Learner (6 AM, runs first)

**File:** `bartender_learner.py` → `run_and_store(venue_id)`

### What It Does

Queries the last 90 days of completed job records from DynamoDB (`bartenderBreakdown` field). For each job:

1. Extracts `per_hour` (drinks per hour) for each bartender
2. Filters to realistic range: **5 to 100 dph** (values above 100 are video-time artifacts from short clips)
3. Extracts `(totalDrinks, totalEntries)` pairs to compute drinks-per-cover ratio

### Formulas

```
venue_dph = 60th percentile of all bartender dph readings across the 90-day window

dpc_shift = median(totalDrinks / totalEntries)  across all jobs with both fields
dpc_per_hour = dpc_shift / 2.5                  (convert per-shift to per-hour, assume 2.5hr avg visit)

covers_per_bartender = venue_dph / dpc_per_hour  (derived, used by staffing engine)
```

### Cold Start (no data yet)

| Condition | venue_dph | dpc_per_hour | covers_per_bartender |
|---|---|---|---|
| No jobs with `bartenderBreakdown` | 28.0 | 0.80 | 35 |
| dph readings but no entry data | learner value | 0.80 (default) | computed |

### Live Example (theblindgoat, April 2026)

```
shifts_analyzed:         24 jobs
venue_dph:               33.4 drinks/hr
drinks_per_cover_per_hr: 0.80
covers_per_bartender:    42
source:                  learned
```

### DynamoDB Write

```
venueId  = "theblindgoat"
jobId    = "staffing#capacity_model"
capacityJson = { ...full result dict... }
```

---

## Step 2 — Venue Physics Config

**File:** `venue_physics.py` → `get_venue_physics(venue_id, concept_type)`

Reads from DynamoDB `jobId = "config#venue_physics"` or falls back to concept-type defaults.

### Concept-Type Defaults

| Concept | covers_per_bartender | bartender_dph | drinks_per_cover/hr | door_threshold | barback_threshold |
|---|---|---|---|---|---|
| bar | 35 | 28 | 0.80 | 55% occ | 40% occ |
| cocktail | 28 | 18 | 0.65 | 60% occ | 45% occ |
| nightclub | 30 | 35 | 1.20 | 35% occ | 30% occ |
| sports_bar | 40 | 28 | 1.00 | 65% occ | 50% occ |
| restaurant | 40 | 20 | 0.50 | 85% occ | 60% occ |

**Key:** `covers_per_bartender` = how many concurrent guests one bartender can handle comfortably.

**Override via env var:**
```
VENUESCOPE_BAR_STATIONS=2
VENUESCOPE_CAPACITY=300
```

---

## Step 3 — Staffing Engine (per-hour computation)

**File:** `staffing_engine.py` → `compute_hourly_staffing(hourly_curve, physics, learned_model, capacity)`

### Input

`hourly_curve` from `forecast_service.py` — a list of `{hour, yhat, yhat_lower, yhat_upper}` where `yhat` is concurrent headcount for that hour.

### Formula Per Hour

```
concurrent = hourly_curve[hour].yhat     (concurrent guests at this hour)

# Bartenders
raw_bartenders    = ceil(concurrent / covers_per_bartender)
bartenders        = max(always_bartenders, min(raw_bartenders, max_bartenders))
                  where: max_bartenders = bar_stations × 2

# Servers (for table-service venues)
active_tables = concurrent / avg_party_size
servers       = ceil(active_tables / tables_per_server)  [0 for bar-only venues]

# Threshold-based roles
occupancy_pct = concurrent / capacity
door          = 1 if occupancy_pct >= door_threshold   else 0
barback       = 1 if occupancy_pct >= barback_threshold else 0
```

**Learned vs default:**
- If `bartender_learner` returned `source = "learned"` → use `covers_per_bartender` from learner
- If no learned data → use concept-type default from physics

### Output

```json
{
  "16": {"bartenders": 1, "servers": 0, "door": 0, "barback": 0, "concurrent": 13.2},
  "17": {"bartenders": 1, "servers": 0, "door": 0, "barback": 0, "concurrent": 23.1},
  "18": {"bartenders": 1, "servers": 0, "door": 0, "barback": 0, "concurrent": 36.3},
  "19": {"bartenders": 2, "servers": 0, "door": 0, "barback": 0, "concurrent": 46.2},
  "20": {"bartenders": 2, "servers": 0, "door": 0, "barback": 0, "concurrent": 56.1},
  "21": {"bartenders": 2, "servers": 0, "door": 0, "barback": 1, "concurrent": 62.7},
  "22": {"bartenders": 2, "servers": 0, "door": 0, "barback": 1, "concurrent": 66.0},
  "23": {"bartenders": 2, "servers": 0, "door": 0, "barback": 0, "concurrent": 59.4},
  "24": {"bartenders": 2, "servers": 0, "door": 0, "barback": 0, "concurrent": 46.2},
  "25": {"bartenders": 1, "servers": 0, "door": 0, "barback": 0, "concurrent": 26.4}
}
```

Hour keys are 24-hour integers: 16 = 4 PM, 22 = 10 PM, 24 = midnight, 25 = 1 AM.

---

## Full Example — Sunday April 19, 2026 (theblindgoat)

### Inputs

| Input | Value | Source |
|---|---|---|
| Model | Generic prior (0 snapshots) | Prophet not yet trained |
| DOW | Sunday = 0.55 multiplier | Generic prior table |
| Concurrent peak (10 PM) | 66.0 guests | 120 × 0.55 × 1.00 (weather) |
| Capacity | 150 | `VENUESCOPE_CAPACITY` env var |
| covers_per_bartender | 42 | Learned from 24 shifts |
| door_threshold | 55% = 82.5 concurrent | Concept default |
| barback_threshold | 40% = 60.0 concurrent | Concept default |

### Per-Hour Calculation

| Hour | Concurrent | Bartenders | Door | Barback | Calculation |
|---|---|---|---|---|---|
| 4 PM | 13.2 | 1 | 0 | 0 | ceil(13.2/42)=1, occ=8.8% |
| 7 PM | 46.2 | 2 | 0 | 0 | ceil(46.2/42)=2, occ=30.8% |
| 9 PM | 62.7 | 2 | 0 | **1** | occ=41.8% ≥ 40% → barback |
| 10 PM | 66.0 | 2 | 0 | **1** | occ=44.0% ≥ 40% → barback |
| 11 PM | 59.4 | 2 | 0 | 0 | occ=39.6% < 40% |
| 1 AM | 26.4 | 1 | 0 | 0 | ceil(26.4/42)=1 |

**No door on Sunday:** peak occupancy 44% < 55% door threshold.

### Staffing Output Stored in DynamoDB

Stored alongside the full Prophet forecast under `forecast#2026-04-19`:

```json
"staffing_rec": {
  "bartenders": 2,
  "note": "Estimated 174 covers. 2 bartenders recommended."
},
"staffing_hourly": { ...per-hour dict above... }
```

---

## Step 4 — DynamoDB Write

The `staffing_hourly` field is written to the same DynamoDB record as the Prophet forecast:

```
venueId      = "theblindgoat"
jobId        = "forecast#2026-04-19"
forecastJson = full JSON including staffing_hourly
```

---

## Frontend — Tonight's Coverage (Events.tsx)

**Location:** Events tab → Tonight's Forecast → "Tonight's Coverage" section (below hourly crowd chart)

Reads `forecast.staffing_hourly` from the DynamoDB forecast record loaded at page open.

### Display

```
TONIGHT'S COVERAGE
         4p  5p  6p  7p  8p  9p  10p  11p  12a  1a
Bartend: 1   1   1   2   2   2   2    2    2    1
Barback: —   —   —   —   —   1   1    —    —    —

Based on concept-type defaults · peak at 10:00 PM
```

- Peak hour column highlighted in teal
- Roles with all-zero counts are hidden (no servers or door means those rows don't appear)
- Falls back to empty if no `staffing_hourly` in forecast

---

## Frontend — Month Schedule + Auto-fill (Staffing.tsx)

**Location:** Staff tab → Schedule

### Month Calendar View

Replaced the 7-day week view with a full month calendar (4-5 rows of weeks). Each day cell shows:
- Date number
- Expected people (from client-side formula, e.g. "174p")
- Staffing icons: 🍺2 🚪1 (bartenders, door)
- Confirmed shift pills (first 2 shown, overflow indicated)
- "⚡ N suggested" badge if AI-suggested shifts exist for that day

### Client-Side Forecast Formula (mirrors Python engine)

The auto-fill does NOT call the droplet. It runs the same DOW × month multiplier math client-side:

```typescript
// Constants matching Python forecast_service.py
DOW_MULT   = [0.40, 0.45, 0.50, 0.65, 1.00, 0.95, 0.55]  // Mon–Sun
MONTH_MULT = [0, 0.72, 0.78, 0.92, 0.88, 0.91, 0.96, 0.94, 0.93, 0.87, 0.97, 0.85, 1.12]
GENERIC_PEAK      = 120   // concurrent at Friday peak
AVG_VISIT_SLOTS   = 10    // 2.5 hours / 15-min slot
SLOT_SHAPE_SUM    = 6.60  // sum of hour shapes

// For any given date:
concurrent_peak  = 120 × DOW_MULT[dow] × MONTH_MULT[month]
total_yhat       = 4 × concurrent_peak × 6.60   (4 slots/hr × sum of shapes)
mid_covers       = round(total_yhat / 10)        (÷ avg_visit_slots)

bartenders_needed = ceil(concurrent_peak / 42)   (covers_per_bartender = 42 learned)
door_needed       = concurrent_peak / 150 >= 0.55 ? 1 : 0
barback_needed    = concurrent_peak / 150 >= 0.40 ? 1 : 0
```

### Auto-fill Month Algorithm

1. Iterate every day in the displayed month
2. Skip days that already have confirmed (non-suggested) shifts
3. Compute `clientForecastForDate(day)` → {expectedPeople, bartenders, door, barback, isWeekend}
4. Assign staff from roster (round-robin by role):
   - Bartenders: `shift_count = bartenders_needed`, start 18:00 (weekend) or 20:00 (weekday), end 02:00
   - Door: start 21:00, end 02:00 (only if `door_needed > 0`)
   - Manager: scheduled on weekend nights (Thu/Fri/Sat), 18:00–02:00
5. Save as `suggested: true` shifts to localStorage

### Shift States

| Visual | Meaning |
|---|---|
| Solid role-color pill | Confirmed shift (manually added or confirmed from AI suggestion) |
| Dashed teal border + ⚡ icon | AI-suggested, awaiting confirmation |

**Confirm all** button → converts every suggested shift to confirmed for the whole month.
**Confirm** link on individual shift → confirms just that one.
**Click shift pill** → deletes it (same as ✕ button).

---

## Cron Schedule (droplet)

```
# 6 AM full run: learn → retrain → forecast + staffing → backfill
0 6 * * * cd /opt/venuescope && export $(grep -v "^#" .env | xargs) && PYTHONPATH=/opt/venuescope/venuescope /opt/venuescope/venv/bin/python3 venuescope/workers/forecast_cron.py >> /var/log/venuescope_forecast.log 2>&1

# 3 PM midday refresh: weather update + new staffing_hourly, no retraining
0 15 * * * cd /opt/venuescope && export $(grep -v "^#" .env | xargs) && PYTHONPATH=/opt/venuescope/venuescope /opt/venuescope/venv/bin/python3 venuescope/workers/forecast_cron.py --refresh >> /var/log/venuescope_forecast.log 2>&1
```

---

## How the System Gets More Accurate Over Time

| Stage | Trigger | What changes |
|---|---|---|
| Day 1 | No data | `covers_per_bartender = 35` (bar default) |
| Week 1–2 | First jobs with `bartenderBreakdown` | Learner has real dph readings; cpb adjusts to venue's actual throughput |
| Month 1 | 20+ shifts analyzed | `drinks_per_cover` learned from real entry counts; bartender schedule tightly calibrated |
| Month 3+ | Prophet also training | Hourly curve is venue-specific, not generic prior; staffing schedule derived from true occupancy pattern |
| Month 6+ | Full seasonal pattern | Door/barback thresholds can be tuned per-venue via `config#venue_physics` in DynamoDB |

Every morning at 6 AM the learner runs first, the forecast reruns, and the updated `staffing_hourly` is written to DynamoDB. The next time a manager opens the app, the Tonight's Coverage reflects the freshest data. When they hit "Auto-fill Month" on the Schedule tab, the client-side model also uses the updated `covers_per_bartender` (currently stored in the staffing_hourly data visible to the frontend).

---

## Env Vars for Tuning (droplet .env)

| Var | Default | Purpose |
|---|---|---|
| `VENUESCOPE_CAPACITY` | 150 | Venue capacity — denominator for door/barback thresholds |
| `VENUESCOPE_BAR_STATIONS` | 1 | Number of bar stations — caps max bartenders |
| `VENUESCOPE_CONCEPT_TYPE` | default | Concept type for physics defaults (bar/cocktail/nightclub/sports_bar/restaurant) |
| `VENUESCOPE_TIMEZONE` | America/New_York | Venue local timezone for correct DOW |
| `VENUESCOPE_AVG_DRINK_PRICE` | 33.0 | Revenue calculation |

---

## What to Add Next

1. **Venue physics onboarding wizard** — React form in Settings that writes `config#venue_physics` to DynamoDB, overriding concept defaults with actual bar stations, capacity, and custom thresholds.

2. **Manager override logging** — When a manager changes a staffing recommendation (e.g., adds an extra bartender), log the delta to DynamoDB. After 50 overrides, retrain `covers_per_bartender` for that specific DOW/occupancy band.

3. **Forecast vs actual staffing** — Read `actualCovers` from the backfill record, compare to what was recommended, show accuracy per night in the Performance tab.

4. **Per-bartender scheduling** — Use the learned per-person dph (Sabrina=26.1, Jake=19.8) to recommend which specific bartenders to schedule for a given forecast load. Fast bartenders on busy nights, slower ones on slow nights.

5. **Shift cost estimation** — With hourly staffing counts and hourly pay rates (configurable per role), compute estimated labor cost per shift and total for the week/month.
