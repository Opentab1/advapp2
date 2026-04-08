import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, Calendar, Users, DollarSign, Zap, ChevronDown, ChevronUp,
  CloudRain, MapPin, RefreshCw, AlertTriangle, BarChart3, Info,
} from 'lucide-react';
import venueSettingsService from '../services/venue-settings.service';
import authService from '../services/auth.service';

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  'DJ Night', 'Live Music', 'Trivia Night', 'Karaoke', 'Drag Show',
  'Sports Watch Party', 'Comedy Night', 'Happy Hour Special', 'Themed Party',
  'Open Mic', 'Paint & Sip', 'Speed Dating', 'Networking Event', 'Game Night',
  'Ladies Night', 'Brunch', 'Other',
];

const WEATHER_OPTIONS = [
  { value: 'none',     label: 'Clear',          penalty: '0%'  },
  { value: 'low',      label: 'Overcast',        penalty: '-3%' },
  { value: 'moderate', label: 'Rain / Wind',     penalty: '-12%'},
  { value: 'high',     label: 'Storm',           penalty: '-28%'},
  { value: 'extreme',  label: 'Severe Weather',  penalty: '-45%'},
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ForecastResult {
  low: number;
  mid: number;
  high: number;
  fill_rate_pct: number;
  model: string;
  model_short: string;
  confidence: string;
  revenue_low: number;
  revenue_mid: number;
  revenue_high: number;
  avg_spend_assumption: number;
  historical_sessions: number;
  note?: string;
  factors?: {
    base_fill_55pct: number;
    day_of_week_multiplier: number;
    month_seasonality: number;
    event_type_lift: number;
    holiday_factor: number;
    weather_penalty: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nextFriday(): string {
  const d = new Date();
  const diff = (5 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function fillColor(pct: number): string {
  if (pct >= 80) return 'text-green-400';
  if (pct >= 55) return 'text-teal';
  if (pct >= 35) return 'text-amber-400';
  return 'text-red-400';
}

function fillBarColor(pct: number): string {
  if (pct >= 80) return 'bg-green-400';
  if (pct >= 55) return 'bg-teal';
  if (pct >= 35) return 'bg-amber-400';
  return 'bg-red-400';
}

function fmt$(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n}`;
}

function factorLabel(key: string): string {
  const map: Record<string, string> = {
    base_fill_55pct:        'Base (55% fill rate)',
    day_of_week_multiplier: 'Day of week',
    month_seasonality:      'Month seasonality',
    event_type_lift:        'Event type lift',
    holiday_factor:         'Holiday factor',
    weather_penalty:        'Weather penalty',
  };
  return map[key] || key;
}

function factorDisplay(key: string, val: number): string {
  if (key === 'base_fill_55pct') return `${val} guests`;
  return `×${val.toFixed(2)}`;
}

function factorColor(key: string, val: number): string {
  if (key === 'base_fill_55pct') return 'text-warm-300';
  if (val > 1.0) return 'text-green-400';
  if (val < 0.9) return 'text-amber-400';
  return 'text-warm-400';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Forecast() {
  const user = authService.getStoredUser();
  const savedAddress = user?.venueId ? venueSettingsService.getAddress(user.venueId) : null;
  const savedCapacity = user?.venueId ? venueSettingsService.getCapacity(user.venueId) : null;

  const serverUrl = (import.meta.env.VITE_VENUESCOPE_URL || '').replace(':8501', ':8502').replace(/\/$/, '');

  const [concept, setConcept]           = useState('DJ Night');
  const [date, setDate]                 = useState(nextFriday());
  const [capacity, setCapacity]         = useState<number>(savedCapacity || 150);
  const [cover, setCover]               = useState<number>(0);
  const [city, setCity]                 = useState(savedAddress?.city || '');
  const [weatherRisk, setWeatherRisk]   = useState('none');

  const [loading, setLoading]           = useState(false);
  const [result, setResult]             = useState<ForecastResult | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const [showFactors, setShowFactors]   = useState(false);

  const runForecast = async () => {
    if (!serverUrl) { setError('No VenueScope server connected.'); return; }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({
        concept, city, date,
        capacity: String(capacity),
        cover: String(cover),
        weather_risk: weatherRisk,
      });
      const r = await fetch(`${serverUrl}/api/events/forecast?${params}`);
      if (!r.ok) throw new Error(`Server error ${r.status}`);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setResult(d);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch forecast');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Attendance Forecast</h1>
        <p className="text-sm text-warm-400 mt-1">
          Predict headcount and revenue before you book the event.
        </p>
      </div>

      {/* Inputs */}
      <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-5 space-y-4">

        {/* Concept + Date row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-warm-500 uppercase tracking-wide font-medium mb-1.5 block">Event Type</label>
            <select
              value={concept}
              onChange={e => setConcept(e.target.value)}
              className="w-full bg-warm-800 border border-warm-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal"
            >
              {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-warm-500 uppercase tracking-wide font-medium mb-1.5 block">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full bg-warm-800 border border-warm-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal"
            />
          </div>
        </div>

        {/* Capacity + Cover row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-warm-500 uppercase tracking-wide font-medium mb-1.5 block flex items-center gap-1">
              <Users className="w-3 h-3" /> Capacity
            </label>
            <input
              type="number"
              min={10} max={5000}
              value={capacity}
              onChange={e => setCapacity(Number(e.target.value))}
              className="w-full bg-warm-800 border border-warm-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal"
            />
          </div>
          <div>
            <label className="text-xs text-warm-500 uppercase tracking-wide font-medium mb-1.5 block flex items-center gap-1">
              <DollarSign className="w-3 h-3" /> Cover Charge
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-500 text-sm">$</span>
              <input
                type="number"
                min={0}
                value={cover}
                onChange={e => setCover(Number(e.target.value))}
                className="w-full bg-warm-800 border border-warm-600 rounded-xl pl-6 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal"
              />
            </div>
          </div>
        </div>

        {/* City + Weather row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-warm-500 uppercase tracking-wide font-medium mb-1.5 block flex items-center gap-1">
              <MapPin className="w-3 h-3" /> City
            </label>
            <input
              type="text"
              placeholder="e.g. Houston"
              value={city}
              onChange={e => setCity(e.target.value)}
              className="w-full bg-warm-800 border border-warm-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-warm-600 focus:outline-none focus:border-teal"
            />
          </div>
          <div>
            <label className="text-xs text-warm-500 uppercase tracking-wide font-medium mb-1.5 block flex items-center gap-1">
              <CloudRain className="w-3 h-3" /> Weather
            </label>
            <select
              value={weatherRisk}
              onChange={e => setWeatherRisk(e.target.value)}
              className="w-full bg-warm-800 border border-warm-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal"
            >
              {WEATHER_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label} ({o.penalty})</option>
              ))}
            </select>
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={runForecast}
          disabled={loading || !serverUrl}
          className="w-full flex items-center justify-center gap-2 py-3 bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
        >
          {loading
            ? <><RefreshCw className="w-4 h-4 animate-spin" /> Forecasting…</>
            : <><Zap className="w-4 h-4" /> Run Forecast</>
          }
        </button>

        {!serverUrl && (
          <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <p className="text-xs text-amber-300">No VenueScope server URL configured. Set VITE_VENUESCOPE_URL in .env.local.</p>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}
      </div>

      {/* Results */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >

            {/* Hero numbers */}
            <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-xs text-warm-500 uppercase tracking-wide font-medium">{concept} · {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                </div>
                <span className="text-xs px-2 py-1 bg-warm-700 border border-warm-600 rounded-full text-warm-300 font-medium">
                  {result.model_short}
                </span>
              </div>

              {/* Attendance range */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: 'Low',  val: result.low,  dim: true  },
                  { label: 'Expected', val: result.mid, dim: false },
                  { label: 'High', val: result.high, dim: true  },
                ].map(({ label, val, dim }) => (
                  <div key={label} className={`text-center p-3 rounded-xl ${dim ? 'bg-warm-800/60' : 'bg-primary/10 border border-primary/20'}`}>
                    <p className={`text-2xl font-bold ${dim ? 'text-warm-300' : 'text-white'}`}>{val}</p>
                    <p className={`text-xs mt-0.5 ${dim ? 'text-warm-500' : 'text-warm-400'}`}>{label}</p>
                  </div>
                ))}
              </div>

              {/* Fill rate bar */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-warm-500">Fill rate</span>
                  <span className={`text-sm font-bold ${fillColor(result.fill_rate_pct)}`}>
                    {result.fill_rate_pct}%
                  </span>
                </div>
                <div className="h-2 bg-warm-700 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${fillBarColor(result.fill_rate_pct)}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, result.fill_rate_pct)}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-warm-600 mt-1">
                  <span>0%</span>
                  <span>{capacity} cap</span>
                </div>
              </div>

              {/* Revenue */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Low',      val: result.revenue_low  },
                  { label: 'Expected', val: result.revenue_mid  },
                  { label: 'High',     val: result.revenue_high },
                ].map(({ label, val }) => (
                  <div key={label} className="text-center p-2 bg-warm-800/60 rounded-lg">
                    <p className="text-sm font-semibold text-green-400">{fmt$(val)}</p>
                    <p className="text-[10px] text-warm-500 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-warm-600 mt-2 text-center">
                Revenue = headcount × (${cover} cover + ${result.avg_spend_assumption} avg drink spend)
              </p>
            </div>

            {/* Model info + note */}
            <div className="flex items-start gap-3 p-4 bg-warm-800/30 border border-warm-700 rounded-xl">
              <Info className="w-4 h-4 text-warm-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-warm-400 font-medium">{result.model}</p>
                {result.note && <p className="text-xs text-warm-500 mt-1">{result.note}</p>}
                {result.historical_sessions > 0 && (
                  <p className="text-xs text-teal mt-1">{result.historical_sessions} real sessions from this venue used</p>
                )}
              </div>
            </div>

            {/* Factor breakdown (collapsible) */}
            {result.factors && (
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setShowFactors(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-warm-800/80 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-warm-400" />
                    <span className="text-sm font-medium text-white">Factor Breakdown</span>
                  </div>
                  {showFactors
                    ? <ChevronUp className="w-4 h-4 text-warm-500" />
                    : <ChevronDown className="w-4 h-4 text-warm-500" />
                  }
                </button>

                <AnimatePresence>
                  {showFactors && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-4 space-y-2 border-t border-warm-700">
                        {Object.entries(result.factors).map(([key, val]) => (
                          <div key={key} className="flex items-center justify-between py-1.5 border-b border-warm-700/50 last:border-0">
                            <span className="text-xs text-warm-400">{factorLabel(key)}</span>
                            <span className={`text-xs font-mono font-semibold ${factorColor(key, val)}`}>
                              {factorDisplay(key, val)}
                            </span>
                          </div>
                        ))}
                        <p className="text-[10px] text-warm-600 pt-1">
                          mid = base × DOW × month × event lift × holiday × weather
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Quick scenarios */}
            <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-warm-400" />
                <p className="text-sm font-medium text-white">Day Comparison</p>
              </div>
              <DayComparison concept={concept} date={date} capacity={capacity} cover={cover} weatherRisk={weatherRisk} serverUrl={serverUrl} />
            </div>

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Day Comparison sub-component ─────────────────────────────────────────────

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function DayComparison({ concept, date, capacity, cover, weatherRisk, serverUrl }: {
  concept: string; date: string; capacity: number; cover: number;
  weatherRisk: string; serverUrl: string;
}) {
  const [results, setResults]   = useState<Record<string, ForecastResult>>({});
  const [loading, setLoading]   = useState(false);

  const runAll = async () => {
    setLoading(true);
    // Get the week containing the selected date
    const base = new Date(date + 'T12:00:00');
    const monday = new Date(base);
    monday.setDate(base.getDate() - ((base.getDay() + 6) % 7));

    const fetches = DAYS.map((_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const ds = d.toISOString().split('T')[0];
      const params = new URLSearchParams({ concept, city: '', date: ds, capacity: String(capacity), cover: String(cover), weather_risk: weatherRisk });
      return fetch(`${serverUrl}/api/events/forecast?${params}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => [DAYS[i], data] as [string, ForecastResult | null])
        .catch(() => [DAYS[i], null] as [string, null]);
    });

    const all = await Promise.all(fetches);
    const map: Record<string, ForecastResult> = {};
    for (const [day, res] of all) {
      if (res && !res.error) map[day] = res;
    }
    setResults(map);
    setLoading(false);
  };

  const maxMid = Math.max(...Object.values(results).map(r => r.mid), 1);
  const selectedDow = DAYS[(new Date(date + 'T12:00:00').getDay() + 6) % 7];

  return (
    <div>
      {Object.keys(results).length === 0 ? (
        <button
          onClick={runAll}
          disabled={loading || !serverUrl}
          className="w-full py-2 text-xs text-teal border border-teal/30 bg-teal/10 hover:bg-teal/20 rounded-lg font-medium transition-all disabled:opacity-50"
        >
          {loading ? 'Loading all 7 days…' : 'Compare all days this week'}
        </button>
      ) : (
        <div className="space-y-1.5">
          {DAYS.map(day => {
            const r = results[day];
            if (!r) return null;
            const pct = r.mid / maxMid * 100;
            const isSelected = day === selectedDow;
            return (
              <div key={day} className={`flex items-center gap-3 ${isSelected ? 'opacity-100' : 'opacity-70'}`}>
                <span className={`text-xs w-7 font-medium ${isSelected ? 'text-white' : 'text-warm-500'}`}>{day}</span>
                <div className="flex-1 h-5 bg-warm-700/50 rounded-md overflow-hidden">
                  <motion.div
                    className={`h-full rounded-md ${isSelected ? 'bg-primary/70' : 'bg-warm-600/60'}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
                <span className={`text-xs font-mono w-8 text-right ${isSelected ? 'text-white font-semibold' : 'text-warm-500'}`}>{r.mid}</span>
                <span className={`text-[10px] w-12 text-right ${fillColor(r.fill_rate_pct)}`}>{r.fill_rate_pct}%</span>
              </div>
            );
          })}
          <button onClick={runAll} disabled={loading} className="mt-2 text-[10px] text-warm-600 hover:text-warm-400 transition-colors">
            {loading ? 'Refreshing…' : '↺ Refresh'}
          </button>
        </div>
      )}
    </div>
  );
}

export default Forecast;
