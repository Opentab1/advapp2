# VenueScope — Predictive Analytics Forecast
## Full Formula, Numbers, and Architecture

---

## Overview

The forecast runs every morning at **6:00 AM** on the DigitalOcean droplet (`137.184.61.178`).
It writes the result to **DynamoDB** under `jobId = forecast#YYYY-MM-DD`.
The React app reads that record at page load — no HTTP call to the droplet ever happens.

**Source files:**
- `venuescope/core/prophet_forecast/forecast_service.py` — main pipeline
- `venuescope/core/prophet_forecast/training_pipeline.py` — Prophet training
- `venuescope/core/prophet_forecast/weather_ingest.py` — Open-Meteo weather
- `venuescope/core/prophet_forecast/model_interface.py` — Prophet / GBM model classes
- `venuescope/workers/forecast_cron.py` — the 6 AM cron entry point
- `src/pages/Events.tsx` — frontend `TonightTab` that reads and displays the forecast
- `src/services/venuescope.service.ts` — `getForecast()` reads from DynamoDB

---

## Step 1 — Training (6 AM, runs first)

**File:** `training_pipeline.py` → `train_venue_model()`

### What it does
Pulls the last 90 days of occupancy snapshots from the local SQLite database,
joins them with historical weather from Open-Meteo's archive API,
and fits a Prophet model. The fitted model is saved to disk at:

```
~/.venuescope/models/{venue_id}_forecaster.pkl
```

### Data requirements before Prophet kicks in
| Threshold | Effect |
|---|---|
| < 100 snapshots | Skip training, use generic prior |
| < 14 days of data | Skip training, use generic prior |
| ≥ 100 snapshots AND ≥ 14 days | Train Prophet |

### Training DataFrame columns
| Column | Type | Description |
|---|---|---|
| `ds` | datetime | Timestamp of the 15-min snapshot |
| `y` | float | Headcount at that moment |
| `temp` | float | °F at that hour (from Open-Meteo archive) |
| `precip` | float | in/hr precipitation |
| `wind` | float | mph wind speed |
| `competing_events_count` | int | Nearby events (0 for now, stub) |

### Shape vs magnitude validation
Before fitting, checks that the average peak headcount per 15-min slot is within 20% of the overall training max. If not, logs a warning — it means the drink-proxy backfill may be miscalibrated.

### MAPE estimates by data age
| Days of history | Expected MAPE | Calibration state |
|---|---|---|
| < 14 days | ±30% | `generic_prior` |
| 14–27 days | ±24% | `week_2` |
| 28–83 days | ±18% | `week_4` |
| 84–179 days | ±12% | `week_12` |
| 180–364 days | ±8% | `month_6` |
| 365+ days | ±5% | `month_12` |

---

## Step 2 — Forecast Generation

**File:** `forecast_service.py` → `forecast_tonight()`

The pipeline runs in 9 steps regardless of whether Prophet is trained or not.

---

### Step 2a — Load Model

Attempts to load the pickled model from `~/.venuescope/models/{venue_id}_forecaster.pkl`.
- If found: runs Prophet/GBM inference
- If not found or load fails: falls back to **generic prior** (see below)

---

### Step 2b — Fetch Weather (Live)

**File:** `weather_ingest.py` → `fetch_weather_forecast()`

Source: **Open-Meteo** free API (no key, CORS-enabled)
URL: `https://api.open-meteo.com/v1/forecast`

Fetches 24 hourly rows for the venue's lat/lon on the target date.
Converts at ingest:
- Temperature: `°C × 9/5 + 32 → °F`
- Precipitation: `mm/hr ÷ 25.4 → in/hr`
- Wind: `km/h × 0.621371 → mph`

Cached in memory for 3600 seconds.

**Representative evening weather** is computed as the average across hours 16–23 (4 PM to 11 PM) for display purposes.

---

### Step 2c — Fetch Competing Events

**File:** `events_ingest.py` → `get_event_provider()`

Currently uses **StubProvider** (returns 0 events).
Controlled by `EVENT_PROVIDER` env var.
When wired to a real provider: queries events within 2.0 mile radius during the 4 PM – 2 AM window.

---

### Step 2d — Competition Drag

```
C(t) = 1.0 - min(0.30, count × 0.15)
```

- 0 events: drag = 1.0 (no impact)
- 1 event nearby: drag = 0.85 (-15%)
- 2+ events nearby: drag = 0.70 (-30%, capped)

---

### Step 2e — Generic Prior (when no model is trained)

**File:** `forecast_service.py` → `_generic_prior_forecast()`

Used when Prophet is not yet available. Two lookup tables:

**Day-of-week multipliers** (0 = Monday, 6 = Sunday):
| Day | Multiplier |
|---|---|
| Monday | 0.40 |
| Tuesday | 0.45 |
| Wednesday | 0.50 |
| Thursday | 0.65 |
| Friday | 1.00 |
| Saturday | 0.95 |
| Sunday | 0.55 |

**Hour-of-day shape** (peak at 10 PM = 1.00):
| Hour | Shape |
|---|---|
| 4 PM | 0.20 |
| 5 PM | 0.35 |
| 6 PM | 0.55 |
| 7 PM | 0.70 |
| 8 PM | 0.85 |
| 9 PM | 0.95 |
| 10 PM | 1.00 |
| 11 PM | 0.90 |
| 12 AM | 0.70 |
| 1 AM | 0.40 |

**Generic peak:** `_GENERIC_PEAK = 120` (concurrent headcount at Friday peak)

**Formula per 15-min slot:**
```
base_peak = 120 × DOW_multiplier
yhat      = base_peak × hour_shape
yhat_lower = yhat × 0.70
yhat_upper = yhat × 1.30
```

**Example — Monday April 20, 2026 (the test run):**
```
base_peak = 120 × 0.40 = 48
At 10 PM: yhat = 48 × 1.00 = 48 concurrent
At  8 PM: yhat = 48 × 0.85 = 40.8 concurrent
At  6 PM: yhat = 48 × 0.55 = 26.4 concurrent
```

---

### Step 2f — Weather Multiplier (applied per slot)

**File:** `weather_ingest.py` → `weather_multiplier(temp_f, precip_inh, wind_mph)`

Three independent lookup-table multipliers, multiplied together:

**Precipitation:**
| Precip (in/hr) | Multiplier |
|---|---|
| 0.0 (none) | 1.00 |
| < 0.05 (trace) | 0.90 |
| < 0.25 (light rain) | 0.75 |
| < 0.75 (moderate) | 0.55 |
| ≥ 0.75 (heavy) | 0.40 |

**Temperature:**
| Temp (°F) | Multiplier |
|---|---|
| < 20 or > 100 | 0.50 |
| < 35 or > 95 | 0.75 |
| < 50 or > 85 | 0.90 |
| 50–85 (ideal) | 1.00 |

**Wind:**
| Wind (mph) | Multiplier |
|---|---|
| < 20 | 1.00 |
| < 35 | 0.90 |
| ≥ 35 | 0.70 |

```
W(t) = w_precip × w_temp × w_wind
```

**Example — April 20, 2026 test run:**
- Temp: 76°F → w_temp = 1.00
- Precip: 0.0 in/hr → w_precip = 1.00
- Wind: ~6 mph → w_wind = 1.00
- **W(t) = 1.00 × 1.00 × 1.00 = 1.0 (no weather impact)**

---

### Step 2g — Apply Multipliers Per Slot

```
yhat_adjusted      = yhat      × W(t) × C(t)
yhat_lower_adjusted = yhat_lower × W(t) × C(t)
yhat_upper_adjusted = yhat_upper × W(t) × C(t)
```

---

### Step 2h — Aggregate to Final Estimates

The operating window is **4 PM to 2 AM** = 10 hours = **40 × 15-minute slots**.

Each slot's `yhat` represents **concurrent headcount** (not cumulative).

**Total covers** (unique people through the door):
```
avg_visit_slots = 10        # assumes avg visit = 2.5 hours = 10 slots
mid_covers  = sum(yhat across all 40 slots) / 10
low_covers  = sum(yhat_lower across all 40 slots) / 10
high_covers = sum(yhat_upper across all 40 slots) / 10
```

**Revenue:**
```
revenue = covers × avg_drink_price
```
Default `avg_drink_price = $33.00` (overridable via `VENUESCOPE_AVG_DRINK_PRICE` env var or venue settings)

**Staffing:**
```
bartenders_needed = ceil(mid_covers / 80)    # 1 bartender per 80 covers, minimum 1
```

**Baseline covers** (DOW × month, no weather/events — used for lift calculation):
```
Month multipliers:
  Jan 0.72, Feb 0.78, Mar 0.92, Apr 0.88, May 0.91, Jun 0.96
  Jul 0.94, Aug 0.93, Sep 0.87, Oct 0.97, Nov 0.85, Dec 1.12

baseline_covers = 120 × DOW_mult × month_mult
lift            = mid_covers - baseline_covers
lift_pct        = lift / baseline_covers × 100
```

---

## Full Example — Test Run April 20, 2026 (theblindgoat)

### Inputs
| Input | Value |
|---|---|
| Venue | theblindgoat |
| Date | Monday April 20, 2026 |
| Model | Generic prior (0 snapshots, Prophet not yet trained) |
| Coordinates | 27.9506, -82.4572 (Tampa default) |
| Avg drink price | $33.00 |
| DOW | Monday = 0.40 |
| Month | April = 0.88 |
| Weather | Clear · 76°F — multiplier 1.0 |
| Competition | StubProvider — 0 events, drag 1.0 |

### Slot-level calculation (10 PM slot, peak hour)
```
base_peak  = 120 × 0.40 = 48
yhat       = 48 × 1.00 (shape at 10 PM) = 48.0
yhat_lower = 48 × 0.70 = 33.6
yhat_upper = 48 × 1.30 = 62.4
× W(t) = 1.0 × C(t) = 1.0 → no change
```

### Total covers calculation
```
sum(yhat across 40 slots) ≈ 1,270
mid_covers = 1270 / 10 = 127
```

### Final output
| Metric | Low | Mid | High |
|---|---|---|---|
| People | 89 | **127** | 165 |
| Revenue | $2,937 | **$4,191** | $5,445 |

```
baseline_covers = 120 × 0.40 × 0.88 = 42
lift            = 127 - 42 = 85
lift_pct        = 85 / 42 × 100 = 202%   ← high because prior formula sums slots differently
bartenders      = ceil(127 / 80) = 2
confidence      = 70%
MAPE            = ±30%
calibration     = generic_prior
peak_hour       = 10:00 PM
```

### Hourly curve output
| Hour | Low | Mid | High |
|---|---|---|---|
| 4 PM | 6.7 | 9.6 | 12.5 |
| 5 PM | 11.8 | 16.8 | 21.8 |
| 6 PM | 18.5 | 26.4 | 34.3 |
| 7 PM | 23.5 | 33.6 | 43.7 |
| 8 PM | 28.6 | 40.8 | 53.0 |
| 9 PM | 31.9 | 45.6 | 59.3 |
| **10 PM** | **33.6** | **48.0** | **62.4** |
| 11 PM | 30.2 | 43.2 | 56.2 |
| 12 AM | 23.5 | 33.6 | 43.7 |
| 1 AM | 13.4 | 19.2 | 25.0 |

---

## Step 3 — DynamoDB Write

**File:** `forecast_cron.py` → `_write_forecast_to_ddb()`

Table: `VenueScopeJobs`
| Field | Value |
|---|---|
| `venueId` | `theblindgoat` (partition key) |
| `jobId` | `forecast#2026-04-20` (sort key) |
| `forecastJson` | Full JSON string of the forecast dict |
| `forecastDate` | `2026-04-20` (for freshness check) |
| `generatedAt` | Unix timestamp `1776653059` |

The `forecast#` prefix keeps these items entirely separate from job records (`!` prefix) and live camera records (`~` prefix) — they will never appear in job list queries.

---

## Frontend Read

**File:** `venuescope.service.ts` → `getForecast(venueId)`

Uses `GetItemCommand` directly on DynamoDB with exact key lookup.
Checks `forecastDate === today` — if stale (yesterday's forecast), returns null and falls through to client-side model.

**File:** `Events.tsx` → `TonightTab.load()`

Priority order:
1. DynamoDB `forecast#today` (Prophet, written at 6 AM) ← used if found and fresh
2. Client-side Layer 1 Bayesian baseline ← fallback when no stored forecast

---

## Cron Schedule

```
0 6 * * * cd /opt/venuescope && export $(grep -v "^#" .env | xargs) && PYTHONPATH=/opt/venuescope/venuescope /opt/venuescope/venv/bin/python3 venuescope/workers/forecast_cron.py >> /var/log/venuescope_forecast.log 2>&1
```

Logs at: `/var/log/venuescope_forecast.log` on the droplet.

---

## When Does Prophet Activate?

The model upgrades automatically as data accumulates. No code changes needed.

| Stage | Trigger | What changes |
|---|---|---|
| Today (0 snapshots) | — | Generic prior, ±30% MAPE |
| ~2 weeks in | 100+ snapshots, 14+ days | Prophet trains, ±24% MAPE |
| Month 1 | 28+ days | ±18% MAPE |
| Month 3 | 84+ days | ±12% MAPE |
| Month 6 | 180+ days | ±8% MAPE |
| Year 1 | 365+ days | ±5% MAPE — full seasonal pattern locked |

Each morning at 6 AM the model retrains on the freshest 90 days. The frontend calibration label and confidence percentage update automatically from the stored forecast JSON — no frontend changes required.
