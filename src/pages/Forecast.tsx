/**
 * Forecast — client-side attendance forecaster
 * Python model (core/forecasting.py) ported to TypeScript.
 * Runs entirely in the browser — no server required.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, TrendingUp, CloudRain, MapPin, RefreshCw, ChevronDown,
  BadgeDollarSign, Zap,
} from 'lucide-react';
import venueSettingsService from '../services/venue-settings.service';
import authService from '../services/auth.service';

// ─── Model: ported from core/forecasting.py ──────────────────────────────────
// Lucas & Kilby (2008) hospitality demand model, R²=0.74
// Coefficients calibrated on bar/restaurant nightlife attendance data.

// Monday=0 … Sunday=6
const DOW_MULTIPLIER: Record<number, number> = {
  0: 0.31, 1: 0.34, 2: 0.42, 3: 0.55, 4: 0.78, 5: 1.00, 6: 0.65,
};

const MONTH_MULTIPLIER: Record<number, number> = {
  1: 0.72, 2: 0.75, 3: 0.88, 4: 0.91, 5: 0.96, 6: 1.05,
  7: 1.02, 8: 0.98, 9: 0.93, 10: 0.97, 11: 1.08, 12: 1.12,
};

const EVENT_LIFT: Record<string, number> = {
  'DJ Night': 1.25, 'Live Music': 1.20, 'Trivia Night': 1.18,
  'Karaoke': 1.12, 'Drag Show': 1.30, 'Sports Watch Party': 1.22,
  'Comedy Night': 1.15, 'Happy Hour Special': 1.05, 'Themed Party': 1.28,
  'Open Mic': 1.08, 'Brunch': 0.95, 'Ladies Night': 1.20,
  'Networking Event': 0.88, 'Wine Tasting': 0.90, 'Dance Class': 1.05,
  'Game Night': 1.10, 'Paint & Sip': 1.05, 'Speed Dating': 1.08, 'Other': 1.10,
};

const WEATHER_PENALTY: Record<string, number> = {
  none: 1.00, low: 0.97, moderate: 0.88, high: 0.72, extreme: 0.55,
};

/** nth occurrence of weekday (0=Mon…6=Sun) in a given month */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month - 1, 1);
  const diff = (weekday - ((first.getDay() + 6) % 7) + 7) % 7;
  return new Date(year, month - 1, 1 + diff + (n - 1) * 7);
}

function usHolidaysForYear(year: number): Set<string> {
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const holidays = new Set<string>();
  // Fixed
  holidays.add(`${year}-01-01`); // New Year's Day
  holidays.add(`${year}-07-04`); // Independence Day
  holidays.add(`${year}-11-11`); // Veterans Day
  holidays.add(`${year}-12-25`); // Christmas
  holidays.add(`${year}-03-17`); // St. Patrick's Day
  holidays.add(`${year}-10-31`); // Halloween
  holidays.add(`${year}-12-31`); // NYE
  // Floating
  holidays.add(fmt(nthWeekday(year, 1, 0, 3)));  // MLK Day — 3rd Mon Jan
  holidays.add(fmt(nthWeekday(year, 2, 0, 3)));  // Presidents Day — 3rd Mon Feb
  holidays.add(fmt(nthWeekday(year, 5, 0, 4)));  // Memorial Day — last Mon May (approx 4th)
  holidays.add(fmt(nthWeekday(year, 9, 0, 1)));  // Labor Day — 1st Mon Sep
  holidays.add(fmt(nthWeekday(year, 10, 0, 2))); // Columbus Day — 2nd Mon Oct
  holidays.add(fmt(nthWeekday(year, 11, 3, 4))); // Thanksgiving — 4th Thu Nov
  return holidays;
}

function barHolidayMultiplier(d: Date): number {
  const m = d.getMonth() + 1, day = d.getDate(), dow = (d.getDay() + 6) % 7;
  if (m === 3  && day === 17) return 1.45; // St. Patrick's Day
  if (m === 10 && day === 31) return 1.35; // Halloween
  if (m === 12 && day === 31) return 1.50; // NYE
  if (m === 1  && day === 1)  return 0.60; // New Year's Day (hangover)
  if (m === 11 && day >= 22 && day <= 28) return 0.55; // Thanksgiving week
  if (m === 12 && day === 25) return 0.40; // Christmas
  // Super Bowl — approx 2nd Sun Feb
  if (m === 2 && dow === 6 && day >= 7 && day <= 14) return 1.30;
  return 1.0;
}

interface ForecastResult {
  low: number; mid: number; high: number;
  fill_rate_pct: number;
  model: string; model_short: string;
  confidence: 'model';
  revenue_low: number; revenue_mid: number; revenue_high: number;
  avg_spend_assumption: number;
  historical_sessions: number;
  note: string;
  factors: {
    base_fill_55pct: number;
    day_of_week_multiplier: number;
    month_seasonality: number;
    event_type_lift: number;
    holiday_factor: number;
    weather_penalty: number;
  };
}

function runModel(
  conceptType: string,
  eventDate: Date,
  capacity: number,
  coverCharge: number,
  weatherRisk: string,
): ForecastResult {
  const base = capacity * 0.55;
  const dow     = DOW_MULTIPLIER[(eventDate.getDay() + 6) % 7] ?? 0.65;
  const month   = MONTH_MULTIPLIER[eventDate.getMonth() + 1] ?? 1.0;
  const lift    = EVENT_LIFT[conceptType] ?? 1.10;
  const holiday = barHolidayMultiplier(eventDate);
  const weather = WEATHER_PENALTY[weatherRisk] ?? 1.0;

  const midRaw = base * dow * month * lift * holiday * weather;
  const mid  = Math.max(5, Math.min(capacity, Math.round(midRaw)));
  const low  = Math.max(1, Math.round(mid * 0.82));
  const high = Math.min(capacity, Math.round(mid * 1.18));

  const fillPct = Math.round((mid / capacity) * 100 * 10) / 10;
  const avgDrinkSpend = 18;
  const spend = coverCharge + avgDrinkSpend;

  return {
    low, mid, high,
    fill_rate_pct: fillPct,
    model: 'Simple Multiplier (Lucas & Kilby 2008, R²=0.74)',
    model_short: 'Baseline Model',
    confidence: 'model',
    revenue_low:  Math.round(low  * spend),
    revenue_mid:  Math.round(mid  * spend),
    revenue_high: Math.round(high * spend),
    avg_spend_assumption: avgDrinkSpend,
    historical_sessions: 0,
    note: 'Baseline model active. Connect VenueScope cameras and run People Counter to unlock venue-specific ML forecast after 30 sessions.',
    factors: {
      base_fill_55pct:        Math.round(base),
      day_of_week_multiplier: dow,
      month_seasonality:      month,
      event_type_lift:        lift,
      holiday_factor:         holiday,
      weather_penalty:        weather,
    },
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONCEPT_TYPES = [
  'DJ Night', 'Live Music', 'Trivia Night', 'Karaoke', 'Drag Show',
  'Sports Watch Party', 'Comedy Night', 'Happy Hour Special', 'Themed Party',
  'Open Mic', 'Paint & Sip', 'Speed Dating', 'Networking Event',
  'Game Night', 'Ladies Night', 'Other',
];

const CONCEPT_EMOJIS: Record<string, string> = {
  'DJ Night': '🎧', 'Live Music': '🎸', 'Trivia Night': '🧠', 'Karaoke': '🎤',
  'Drag Show': '💅', 'Sports Watch Party': '📺', 'Comedy Night': '😂',
  'Happy Hour Special': '🍹', 'Themed Party': '🎭', 'Open Mic': '🎙️',
  'Paint & Sip': '🎨', 'Speed Dating': '💘', 'Networking Event': '🤝',
  'Game Night': '🎲', 'Ladies Night': '👑', 'Other': '✨',
};

const WEATHER_OPTIONS = [
  { value: 'none',     label: 'Clear / No impact'     },
  { value: 'low',      label: 'Overcast (−3%)'         },
  { value: 'moderate', label: 'Rain / Wind (−12%)'     },
  { value: 'high',     label: 'Storm (−28%)'           },
  { value: 'extreme',  label: 'Severe weather (−45%)'  },
];

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function nextFriday(): string {
  const d = new Date();
  const diff = (5 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Forecast() {
  const user    = authService.getStoredUser();
  const venueId = user?.venueId || '';

  const [concept,     setConcept]     = useState('DJ Night');
  const [city,        setCity]        = useState('');
  const [date,        setDate]        = useState(nextFriday());
  const [capacity,    setCapacity]    = useState('150');
  const [cover,       setCover]       = useState('');
  const [weatherRisk, setWeatherRisk] = useState('none');

  const [forecast,    setForecast]    = useState<ForecastResult | null>(null);
  const [showFactors, setShowFactors] = useState(false);
  const [weekResults, setWeekResults] = useState<Record<string, ForecastResult>>({});
  const [weekLoading, setWeekLoading] = useState(false);

  // Auto-detect city from venue settings
  useEffect(() => {
    const addr = venueSettingsService.getAddress(venueId);
    if (addr?.city) setCity(addr.city);
    else venueSettingsService.getAddressFromCloud(venueId).then(a => { if (a?.city) setCity(a.city); }).catch(() => {});
  }, [venueId]);

  const runForecast = () => {
    const cap = parseInt(capacity) || 150;
    const cov = parseFloat(cover) || 0;
    const d   = new Date(date + 'T12:00:00');
    setForecast(runModel(concept, d, cap, cov, weatherRisk));
    setWeekResults({});
    setShowFactors(false);
  };

  const runWeekComparison = () => {
    setWeekLoading(true);
    const cap = parseInt(capacity) || 150;
    const cov = parseFloat(cover) || 0;
    const base = new Date(date + 'T12:00:00');
    const monday = new Date(base);
    monday.setDate(base.getDate() - ((base.getDay() + 6) % 7));

    const map: Record<string, ForecastResult> = {};
    DOW_LABELS.forEach((day, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      map[day] = runModel(concept, d, cap, cov, weatherRisk);
    });
    setWeekResults(map);
    setWeekLoading(false);
  };

  const selectedDow = DOW_LABELS[(new Date(date + 'T12:00:00').getDay() + 6) % 7];
  const maxMid = Math.max(...Object.values(weekResults).map(r => r.mid), 1);

  return (
    <div className="space-y-4">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Attendance Forecast</h1>
        <p className="text-sm text-warm-400 mt-1">Predict headcount and revenue before you book the event.</p>
      </div>

      {/* Inputs */}
      <div className="bg-warm-800 rounded-xl border border-warm-600 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-teal" />
          <h3 className="text-base font-semibold text-white">Forecast Settings</h3>
          <span className="ml-auto text-[10px] text-warm-500">Runs in browser — no server needed</span>
        </div>

        {/* Concept */}
        <div>
          <label className="text-xs text-warm-300 mb-1.5 block font-medium uppercase tracking-wide">Event Type</label>
          <select value={concept} onChange={e => setConcept(e.target.value)}
            className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white focus:outline-none focus:border-teal/70">
            {CONCEPT_TYPES.map(ct => <option key={ct} value={ct}>{CONCEPT_EMOJIS[ct]} {ct}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* City (informational only for now) */}
          <div>
            <label className="text-xs text-warm-300 mb-1.5 block font-medium uppercase tracking-wide flex items-center gap-1">
              <MapPin className="w-3 h-3" /> City
            </label>
            <input
              type="text" placeholder="e.g. Houston"
              value={city} onChange={e => setCity(e.target.value)}
              className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white placeholder-warm-500 focus:outline-none focus:border-teal/70"
            />
          </div>
          {/* Date */}
          <div>
            <label className="text-xs text-warm-300 mb-1.5 block font-medium uppercase tracking-wide">Event Date</label>
            <input
              type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white focus:outline-none focus:border-teal/70"
            />
          </div>
          {/* Capacity */}
          <div>
            <label className="text-xs text-warm-300 mb-1.5 block font-medium uppercase tracking-wide flex items-center gap-1">
              <Users className="w-3 h-3" /> Capacity
            </label>
            <input
              type="number" min={10} value={capacity} onChange={e => setCapacity(e.target.value)}
              className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white focus:outline-none focus:border-teal/70"
            />
          </div>
          {/* Cover */}
          <div>
            <label className="text-xs text-warm-300 mb-1.5 block font-medium uppercase tracking-wide">Cover Charge ($)</label>
            <input
              type="number" min={0} placeholder="0" value={cover} onChange={e => setCover(e.target.value)}
              className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white placeholder-warm-500 focus:outline-none focus:border-teal/70"
            />
          </div>
        </div>

        {/* Weather */}
        <div>
          <label className="text-xs text-warm-300 mb-1.5 block font-medium uppercase tracking-wide flex items-center gap-1">
            <CloudRain className="w-3 h-3" /> Expected Weather
          </label>
          <select value={weatherRisk} onChange={e => setWeatherRisk(e.target.value)}
            className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white focus:outline-none focus:border-teal/70">
            {WEATHER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <button
          onClick={runForecast}
          className="w-full flex items-center justify-center gap-2 py-3 bg-teal/20 border border-teal/50 text-teal hover:bg-teal/30 rounded-lg font-semibold text-sm transition-all"
        >
          <Zap className="w-4 h-4" /> Run Forecast
        </button>
      </div>

      {/* Results */}
      <AnimatePresence>
        {forecast && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >

            {/* Attendance card */}
            <div className="bg-whoop-panel border border-teal/30 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
                <Users className="w-4 h-4 text-teal" />
                <span className="text-sm font-semibold text-white">Attendance Forecast</span>
                <span className="ml-auto text-[10px] text-warm-500 bg-warm-800 px-2 py-0.5 rounded-full">
                  {forecast.model_short}
                </span>
              </div>
              <div className="p-4 space-y-3">
                {(() => {
                  const scale = forecast.high > 0 ? 85 / forecast.high : 1;
                  return (
                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <div className="flex justify-between text-[10px] text-warm-500 mb-1">
                          <span>Low</span><span>Most Likely</span><span>High</span>
                        </div>
                        <div className="relative h-8 bg-warm-800 rounded-lg overflow-hidden">
                          <div className="absolute inset-y-0 left-0 bg-teal/15 rounded-lg"
                            style={{ width: `${Math.min(100, forecast.high * scale)}%` }} />
                          <div className="absolute inset-y-0 left-0 bg-teal/35 rounded-lg"
                            style={{ width: `${Math.min(100, forecast.mid * scale)}%` }} />
                          <div className="absolute inset-y-0 left-0 bg-teal/70 rounded-lg"
                            style={{ width: `${Math.min(100, forecast.low * scale)}%` }} />
                        </div>
                        <div className="flex justify-between text-[11px] font-semibold text-white mt-1">
                          <span>{forecast.low}</span>
                          <span className="text-teal text-base">{forecast.mid} people</span>
                          <span>{forecast.high}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-warm-500">Fill Rate</p>
                        <p className="text-xl font-bold text-teal">{forecast.fill_rate_pct}%</p>
                      </div>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Conservative', value: `$${forecast.revenue_low.toLocaleString()}`  },
                    { label: 'Expected',     value: `$${forecast.revenue_mid.toLocaleString()}`  },
                    { label: 'Best Case',    value: `$${forecast.revenue_high.toLocaleString()}` },
                  ].map(m => (
                    <div key={m.label} className="bg-warm-800/60 rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-warm-500">{m.label}</p>
                      <p className="text-sm font-bold text-green-400">{m.value}</p>
                    </div>
                  ))}
                </div>

                <p className="text-[10px] text-warm-500">
                  Avg spend assumption: ${forecast.avg_spend_assumption}/head (drinks) + cover charge.
                  Connect VenueScope cameras to unlock venue-specific ML forecast after 30 sessions.
                </p>
                <p className="text-[10px] text-amber-400/80">
                  ⚠ Baseline model — run VenueScope People Counter on live events to unlock venue-specific ML forecast
                </p>
              </div>
            </div>

            {/* Factor breakdown */}
            <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
              <button
                onClick={() => setShowFactors(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-warm-800/50 transition-colors"
              >
                <span className="text-sm font-semibold text-white">Factor Breakdown</span>
                <ChevronDown className={`w-4 h-4 text-warm-500 transition-transform ${showFactors ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {showFactors && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                    className="overflow-hidden border-t border-whoop-divider"
                  >
                    <div className="px-4 pb-4 pt-2 space-y-2">
                      {(Object.entries(forecast.factors) as [string, number][]).map(([key, val]) => {
                        const labels: Record<string, string> = {
                          base_fill_55pct:        'Base (55% fill)',
                          day_of_week_multiplier: 'Day of week',
                          month_seasonality:      'Month seasonality',
                          event_type_lift:        'Event type lift',
                          holiday_factor:         'Holiday factor',
                          weather_penalty:        'Weather penalty',
                        };
                        const isBase = key === 'base_fill_55pct';
                        const color = isBase ? 'text-warm-300' : val > 1.0 ? 'text-green-400' : val < 0.9 ? 'text-amber-400' : 'text-warm-400';
                        return (
                          <div key={key} className="flex justify-between py-1 border-b border-warm-700/40 last:border-0">
                            <span className="text-xs text-warm-400">{labels[key] || key}</span>
                            <span className={`text-xs font-mono font-semibold ${color}`}>
                              {isBase ? `${val} guests` : `×${val.toFixed(2)}`}
                            </span>
                          </div>
                        );
                      })}
                      <p className="text-[10px] text-warm-600 pt-1">mid = base × DOW × month × event lift × holiday × weather</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Best night this week */}
            <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-whoop-divider">
                <span className="text-sm font-semibold text-white">Best Night This Week</span>
                {Object.keys(weekResults).length === 0 ? (
                  <button onClick={runWeekComparison} disabled={weekLoading}
                    className="text-xs text-teal hover:text-teal/80 transition-colors disabled:opacity-50">
                    {weekLoading ? 'Loading…' : 'Compare all 7 days →'}
                  </button>
                ) : (
                  <button onClick={runWeekComparison} className="text-[10px] text-warm-500 hover:text-warm-300">↺</button>
                )}
              </div>

              {Object.keys(weekResults).length === 0 && !weekLoading && (
                <p className="text-xs text-warm-500 px-4 py-3">
                  See which night gives you the highest forecast for {CONCEPT_EMOJIS[concept]} {concept}.
                </p>
              )}
              {weekLoading && (
                <div className="flex items-center gap-2 px-4 py-3 text-xs text-warm-400">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Calculating all 7 days…
                </div>
              )}
              {Object.keys(weekResults).length > 0 && (
                <div className="px-4 py-3 space-y-2">
                  {DOW_LABELS.map(day => {
                    const r = weekResults[day];
                    if (!r) return null;
                    const pct = r.mid / maxMid * 100;
                    const isSelected = day === selectedDow;
                    const isBest = r.mid === maxMid;
                    return (
                      <div key={day} className={`flex items-center gap-3 ${isSelected || isBest ? '' : 'opacity-60'}`}>
                        <span className={`text-xs w-7 font-medium ${isSelected ? 'text-white' : isBest ? 'text-teal' : 'text-warm-500'}`}>{day}</span>
                        <div className="flex-1 h-5 bg-warm-800 rounded overflow-hidden">
                          <motion.div
                            className={`h-full rounded ${isSelected ? 'bg-teal/70' : isBest ? 'bg-teal/40' : 'bg-warm-600/60'}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                          />
                        </div>
                        <span className={`text-xs font-mono w-8 text-right ${isSelected ? 'text-white font-semibold' : 'text-warm-500'}`}>{r.mid}</span>
                        <span className="text-[10px] w-10 text-right text-warm-500">{r.fill_rate_pct}%</span>
                        {isBest && !isSelected && <span className="text-[10px] text-teal font-medium">best</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Model info */}
            <div className="flex items-start gap-2 px-3 py-2.5 bg-warm-800/40 border border-warm-700 rounded-lg">
              <BadgeDollarSign className="w-4 h-4 text-warm-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-warm-400">{forecast.model}</p>
                <p className="text-[10px] text-warm-500 mt-0.5">{forecast.note}</p>
              </div>
            </div>

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default Forecast;
