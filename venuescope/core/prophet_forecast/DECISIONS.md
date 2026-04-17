# Tonight's Forecast — Architectural Decisions

**Date: 2026-04-17**

---

## Forecaster: Prophet over GBM

**Decision:** Prophet is the default forecaster, gated by `FORECASTER=prophet|gbm` env var. GBM (sklearn GradientBoostingRegressor) is the fallback.

**Reasoning:** Bar occupancy has two dominant seasonality patterns: hour-of-day and day-of-week. These patterns are NOT independent — a Friday at 10 PM looks nothing like a Tuesday at 10 PM. Prophet's Fourier-basis seasonality with conditional components (one seasonality term per DOW, using `condition_name=is_dow_{0..6}`) models this interaction directly. GBM handles it implicitly through feature interactions, which requires significantly more training data to learn the same structure. Prophet gets to "good" behavior faster with 4–6 weeks of data; GBM needs 3+ months. Given that venues typically onboard mid-season and want useful forecasts quickly, Prophet's structured priors win.

Prophet configuration choices:
- `yearly_seasonality=10`: low Fourier order because bar occupancy doesn't follow precise annual seasonality — holidays matter but exact date patterns don't
- `weekly_seasonality=3`: minimal weekly basis; per-DOW hourly seasonalities carry most of the signal
- `daily_seasonality=False`: replaced by 7 custom conditional hourly seasonalities (one per DOW), each with `fourier_order=5` and `period=1` (day)
- `changepoint_prior_scale=0.05`: conservative — bars don't have sudden trend breaks; overfitting changepoints would hurt short-horizon forecasts
- `seasonality_prior_scale=10.0`: generous — seasonal patterns (Fri/Sat surges) should fit tightly to data
- `interval_width=0.80`: 80% credible interval for `yhat_lower`/`yhat_upper`; narrower than Prophet's default 95% because operators need actionable bands, not maximally wide ones
- Regressors: `temp`, `precip`, `wind`, `competing_events_count` — weather and competition are the two biggest exogenous drivers
- `add_country_holidays(country_name='US')`: US public holidays shift baseline occupancy significantly (Super Bowl Sunday, New Year's Eve, etc.)

---

## Weather: Open-Meteo over NWS

**Decision:** Use Open-Meteo (https://api.open-meteo.com) for weather data.

**Reasoning:**
1. **Already wired** — `core/event_intelligence.py` already fetches from Open-Meteo. Using it here is zero additional dependency.
2. **Global coverage** — NWS (National Weather Service) only covers the US. If VenueScope expands internationally, Open-Meteo works without code changes.
3. **15-minute resolution** — Open-Meteo returns hourly data which aligns with our 15-min bucket resolution (we interpolate within the hour).
4. **No API key required** — NWS requires `User-Agent` header and has irregular outages. Open-Meteo has no auth and consistent uptime.
5. **Historical archive** — Open-Meteo provides `archive-api.open-meteo.com/v1/archive` with the same parameter schema, making historical weather retrieval for training trivial.

Unit conversion is done at the **ingest layer only** (in `weather_ingest.py`), never inside the model. The model always sees US units (°F, in/hr, mph). This prevents unit confusion in downstream code.

---

## Occupancy Snapshots: SQLite, Not DynamoDB

**Decision:** New `occupancy_snapshots` table in SQLite via SQLAlchemy, matching the pattern in `core/database.py`.

**Reasoning:**
1. **Existing pattern** — All other persistent state (jobs, events, cameras, shifts) lives in SQLite via `core/database.py`. Adding a new DynamoDB table just for occupancy time series would create a two-system dependency that complicates backup, restore, and local development.
2. **Read pattern** — Training reads large sequential windows (60–90 days of 15-min snapshots = ~8,640 rows). DynamoDB is optimized for point lookups; range scans over a time series are expensive and slow on DDB. SQLite handles this natively with a `WHERE snapshot_ts BETWEEN x AND y` index scan.
3. **Write pattern** — Snapshots are written once per 15 minutes per venue. This is not a high-throughput write workload. DDB's provisioned throughput would be wasted.
4. `aws_sync.py` handles all DDB writes (camera shift totals, job sync). That file is not duplicated here — occupancy snapshots are a different concern.

---

## Event Data Provider: Stub → Ticketmaster → PredictHQ Ladder

**Decision:** Abstract `EventDataProvider` with three implementations, selected by `EVENT_PROVIDER=stub|ticketmaster|predicthq` env var.

**Reasoning:**

| Provider | Cost | Quality | Status |
|---|---|---|---|
| StubProvider | Free | No data | Default — C(t) = 1.0, no drag applied |
| TicketmasterProvider | Free tier (5000 req/day) | Major ticketed events | Available out-of-box |
| PredictHQProvider | $3,000–$10,000/month | All events including permits, sports, parades | Feature-flagged, raises NotImplementedError |

PredictHQ is the gold standard but costs $3k–$10k/month — not appropriate as a default. Ticketmaster's free tier covers the majority of events that would produce real competition drag (concerts, sports games, festivals). The stub allows venues to use the forecasting system before committing to an event data subscription.

`C(t) = 1.0` (no drag) when `EVENT_PROVIDER=stub`. The model still forecasts correctly — it just doesn't adjust for competing events. Operators can see the `competition_drag` field in the API response and understand what they'd gain by enabling an event provider.

---

## Drink Timestamps as Occupancy Shape Proxy

**Decision:** Use drink timestamps from `bartenderBreakdown → drink_timestamps` as the shape of hour-of-day occupancy, and `people.total_entries` as the magnitude calibration. These are processed separately ("shape from magnitude").

**Reasoning:** VenueScope does not have a 15-minute people-count sensor (yet). The YOLO/ByteTrack pipeline counts entries over an entire shift, but not headcount at each 15-minute interval. Drink serve events are a **lagging proxy** for occupancy — when more people are present, more drinks are served. The lag is approximately 20 minutes (time between arrival and first order).

The critical insight is that **shape and magnitude must be calibrated separately**:
- **Shape:** The relative distribution of drinks across 15-minute buckets tells us the occupancy curve's shape (when the crowd peaks, how fast it builds and decays). This is robust even with sparse data.
- **Magnitude:** `totalEntries` from the people counter gives the absolute headcount scale. We scale the drink-proxy curve so its integral matches `totalEntries`.

Formula: `headcount_per_bucket = (drinks_in_bucket / total_drinks) * total_entries`

If the drink-proxy training data looks noisy (high variance in drink density per 15-min slot), the shape is still usable — Prophet's seasonality smoothing will average over the noise. The magnitude calibration from `total_entries` anchors the forecast to reality even when individual shift data is sparse.

---

## MAPE Expectations Table

| Training data available | Calibration state | Expected MAPE |
|---|---|---|
| < 14 days | generic_prior | ±30% |
| 14–28 days (2 weeks) | week_2 | ±24% |
| 28–84 days (4 weeks) | week_4 | ±18% |
| 84–180 days (12 weeks) | week_12 | ±12% |
| 180–365 days (6 months) | month_6 | ±8% |
| 365+ days (12 months) | month_12 | ±5% |

These are empirical estimates based on Prophet's typical performance on hourly venue occupancy data. Actual MAPE is reported by `backtest.py` and surfaced in the API response as `mape_expected`. Weather events and local anomalies (venue closures, private buyouts) will produce outlier days that inflate MAPE; these are expected and do not indicate model failure.
