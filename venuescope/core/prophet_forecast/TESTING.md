# Tonight's Forecast — Testing Guide

**Date: 2026-04-17**

---

## 1. Running the Training Pipeline Manually

Before forecasting works well, you need to train the model on historical data.

```bash
# From the venuescope/ directory:
cd /path/to/venuescope_v6/venuescope

# Set up environment
export FORECASTER=prophet
export EVENT_PROVIDER=stub
export VENUESCOPE_VENUE_ID=theblindgoat
export VENUESCOPE_CITY=tampa

# Run training pipeline directly
python3 -c "
import sys
sys.path.insert(0, '.')
from core.prophet_forecast.training_pipeline import run_training_for_all_venues
results = run_training_for_all_venues()
for r in results:
    print(r)
"
```

Expected output on a fresh install (no historical data):
```
{'status': 'insufficient_data', 'venue_id': 'theblindgoat', 'snapshots_used': 0, ...}
```

After 2+ weeks of drink-count jobs:
```
{'status': 'trained', 'venue_id': 'theblindgoat', 'snapshots_used': 432, 'date_range': '2026-04-01 to 2026-04-17', 'mape_estimate': '±30%'}
```

---

## 2. curl Commands

### A. POST /forecast/tonight — today, no model (generic prior)

```bash
curl -s -X POST http://localhost:8502/forecast/tonight \
  -H "Content-Type: application/json" \
  -d '{"venue_id": "theblindgoat", "city": "tampa"}' | python3 -m json.tool
```

Expected: `"model_type": "prior"`, `"calibration_state": "generic_prior"`, `"mape_expected": "±30%"`

### B. POST /forecast/tonight — specific date with weather

```bash
curl -s -X POST http://localhost:8502/forecast/tonight \
  -H "Content-Type: application/json" \
  -d '{
    "venue_id": "theblindgoat",
    "date": "2026-04-18",
    "lat": 27.9506,
    "lon": -82.4572,
    "city": "tampa"
  }' | python3 -m json.tool
```

Expected: hourly_curve with 10 entries (4 PM to 1 AM), weather_multiplier near 1.0 if clear weather.

### C. GET /forecast/tonight — same as POST but query string (curl convenience)

```bash
curl -s "http://localhost:8502/forecast/tonight?venue_id=theblindgoat&city=tampa&date=2026-04-18" \
  | python3 -m json.tool
```

Expected: identical response to POST above.

### D. GET /api/health — verify API server is up

```bash
curl -s http://localhost:8502/api/health | python3 -m json.tool
```

Expected:
```json
{"status": "ok", "version": "1.0"}
```

### E. Trigger backtest from command line

```bash
# From the venuescope/ directory:
python3 core/prophet_forecast/backtest.py
```

Expected output when no data:
```
=== VenueScope Forecast Backtest Report ===

Venue                    Days  AvgMAPE     Min     Max  State          Degrading
...
```

Expected output with 4+ weeks of data:
```
theblindgoat              28    18.3%    12.1%   28.7%  week_4         no
```

---

## 3. What "Good" Output Looks Like

A healthy forecast response should have:

- **hourly_curve**: 10 entries for hours 4 PM through 1 AM. NOT all the same value.
- **Curve shape**: Should peak somewhere between 9 PM and midnight on a Friday/Saturday. Monday should be much lower.
- **final_estimate.mid**: For a bar with 100-200 capacity, expect 40–180 covers depending on DOW.
- **revenue_estimate.mid**: Should be `final_estimate.mid * 33` approximately.
- **weather_multiplier**: Should be 1.0 on a clear day, 0.40–0.75 on rainy/extreme days.
- **competition_drag**: Should be 1.0 when `EVENT_PROVIDER=stub`.
- **staffing_rec.bartenders**: `ceil(mid_covers / 80)`, minimum 1.

Example healthy response for a Friday with no model:
```json
{
  "model_type": "prior",
  "final_estimate": {"low": 40, "mid": 72, "high": 94},
  "revenue_estimate": {"low": 1320, "mid": 2376, "high": 3102},
  "peak_hour": "10:00 PM",
  "weather_multiplier": 1.0,
  "competition_drag": 1.0,
  "staffing_rec": {"bartenders": 1, "note": "Estimated 72 covers..."},
  "calibration_state": "generic_prior",
  "mape_expected": "±30%"
}
```

---

## 4. First 14 Days — Known Gotchas

During the first 14 days of operation:

- **MAPE ±30%**: Expected. The generic prior is a DOW × hour shape table, not a learned model.
- **Flat-looking curves**: If drink-proxy backfill is sparse (few jobs), the shape may not distinguish early vs. late peak. This is normal.
- **model_type = "prior"**: You will always see this until `train_venue_model()` succeeds (requires ≥14 days and ≥100 snapshots).
- **Weather impact**: The weather multiplier and competition drag still apply, so rainy nights will show reduced estimates even without a trained model.
- **No backtest results**: `backtest.py` skips days where training data < 14 days. The report may show 0 tested days initially.

What triggers auto-backfill:
```python
from core.prophet_forecast.occupancy_snapshots import backfill_from_jobs
n = backfill_from_jobs("theblindgoat")
print(f"Wrote {n} snapshots")
```
This runs automatically at the start of each training cycle. You can call it manually to verify.

---

## 5. Shape vs Magnitude Check

If the hourly curve looks wrong (too flat, too peaked, or wildly off in magnitude):

**Step 1 — Check the backfill**
```python
from core.prophet_forecast.occupancy_snapshots import get_snapshots
import time
snaps = get_snapshots("theblindgoat", time.time() - 90*86400, time.time())
print(f"Total snapshots: {len(snaps)}")
if snaps:
    hcs = [s['headcount'] for s in snaps]
    print(f"Min headcount: {min(hcs)}, Max: {max(hcs)}, Avg: {sum(hcs)/len(hcs):.1f}")
```

**Step 2 — Check shape vs magnitude alignment**

The training pipeline logs a warning if the drink-proxy curve's peak doesn't match `total_entries`:
```
WARNING: Shape vs magnitude mismatch: avg_peak=12.3, max_y=87.0, ratio=0.86
```
If you see this, check that `summary_json['people']['total_entries']` is populated in completed jobs. If `total_entries = 0`, the backfill skips that job.

**Step 3 — Check the curve is not flat**

A flat curve means Prophet has no time-of-day signal to learn from. This happens when:
- All drink-proxy snapshots are from similar time windows (e.g., all jobs are 2-hour clips)
- `drink_timestamps` are missing or all at the same relative offset

Fix: run more diverse jobs covering the full shift (start to close).

**Step 4 — Check weather multiplier is not zeroing everything**

If `weather_multiplier` returns 0.40, all yhat values will be reduced 60%. Verify:
```python
from core.prophet_forecast.weather_ingest import weather_multiplier
print(weather_multiplier(72.0, 0.0, 8.0))  # Should be 1.0
print(weather_multiplier(32.0, 0.5, 30.0)) # Should be ~0.49
```
