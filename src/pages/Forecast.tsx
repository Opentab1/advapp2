/**
 * Forecast — standalone attendance forecast tab
 * Uses the exact same UI as the embedded forecast card in Events.tsx
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, TrendingUp, CloudRain, MapPin, RefreshCw, ChevronDown,
  AlertTriangle, BadgeDollarSign, Zap,
} from 'lucide-react';
import venueSettingsService from '../services/venue-settings.service';
import authService from '../services/auth.service';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AttendanceForecast {
  low: number;
  mid: number;
  high: number;
  fill_rate_pct: number;
  model: string;
  model_short: string;
  confidence: 'model' | 'trained';
  revenue_low: number;
  revenue_mid: number;
  revenue_high: number;
  avg_spend_assumption: number;
  historical_sessions: number;
  note: string;
  factors?: Record<string, number>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONCEPT_TYPES = [
  'DJ Night', 'Live Music', 'Trivia Night', 'Karaoke', 'Drag Show',
  'Sports Watch Party', 'Comedy Night', 'Happy Hour Special', 'Themed Party',
  'Open Mic', 'Paint & Sip', 'Speed Dating', 'Networking Event', 'Other',
];

const CONCEPT_EMOJIS: Record<string, string> = {
  'DJ Night': '🎧', 'Live Music': '🎸', 'Trivia Night': '🧠', 'Karaoke': '🎤',
  'Drag Show': '💅', 'Sports Watch Party': '📺', 'Comedy Night': '😂',
  'Happy Hour Special': '🍹', 'Themed Party': '🎭', 'Open Mic': '🎙️',
  'Paint & Sip': '🎨', 'Speed Dating': '💘', 'Networking Event': '🤝', 'Other': '✨',
};

const WEATHER_OPTIONS = [
  { value: 'none',     label: 'Clear / No impact',        penalty: '' },
  { value: 'low',      label: 'Overcast (−3%)',            penalty: '' },
  { value: 'moderate', label: 'Rain / Wind (−12%)',        penalty: '' },
  { value: 'high',     label: 'Storm (−28%)',              penalty: '' },
  { value: 'extreme',  label: 'Severe weather (−45%)',     penalty: '' },
];

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const LS_KEY = 'venuescope_server_url';

function getServerUrl() {
  const fromEnv = (import.meta.env.VITE_VENUESCOPE_URL || '').replace(':8501', ':8502').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return (localStorage.getItem(LS_KEY) || '').replace(':8501', ':8502').replace(/\/$/, '');
}

function nextFriday(): string {
  const d = new Date();
  const daysToFriday = (5 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + daysToFriday);
  return d.toISOString().slice(0, 10);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Forecast() {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';

  const [concept, setConcept]           = useState('DJ Night');
  const [city, setCity]                 = useState('');
  const [date, setDate]                 = useState(nextFriday());
  const [capacity, setCapacity]         = useState('150');
  const [cover, setCover]               = useState('');
  const [weatherRisk, setWeatherRisk]   = useState('none');

  const [serverUrlInput, setServerUrlInput] = useState(() => localStorage.getItem(LS_KEY) || '');
  const [loading, setLoading]           = useState(false);
  const [forecast, setForecast]         = useState<AttendanceForecast | null>(null);
  const [error, setError]               = useState('');
  const [showFactors, setShowFactors]   = useState(false);
  const [weekResults, setWeekResults]   = useState<Record<string, AttendanceForecast>>({});
  const [weekLoading, setWeekLoading]   = useState(false);

  const saveServerUrl = () => {
    const url = serverUrlInput.trim().replace(/\/$/, '');
    localStorage.setItem(LS_KEY, url);
  };

  // Auto-detect city from venue settings
  useEffect(() => {
    const addr = venueSettingsService.getAddress(venueId);
    if (addr?.city) setCity(addr.city);
    else venueSettingsService.getAddressFromCloud(venueId).then(a => { if (a?.city) setCity(a.city); }).catch(() => {});
  }, [venueId]);

  const runForecast = async () => {
    const serverUrl = getServerUrl();
    if (!serverUrl) { setError('Enter your VenueScope server URL below'); return; }
    setLoading(true); setError(''); setForecast(null); setWeekResults({});
    try {
      const params = new URLSearchParams({
        concept, city, date, capacity, cover: cover || '0', weather_risk: weatherRisk,
      });
      const r = await fetch(`${serverUrl}/api/events/forecast?${params}`);
      if (!r.ok) throw new Error(`Server error ${r.status}`);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setForecast(d);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch forecast');
    }
    setLoading(false);
  };

  const runWeekComparison = async () => {
    const serverUrl = getServerUrl();
    if (!serverUrl || weekLoading) return;
    setWeekLoading(true);
    // Get the week containing the selected date
    const base = new Date(date + 'T12:00:00');
    const monday = new Date(base);
    monday.setDate(base.getDate() - ((base.getDay() + 6) % 7));

    const fetches = DOW_LABELS.map((_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const ds = d.toISOString().split('T')[0];
      const params = new URLSearchParams({ concept, city, date: ds, capacity, cover: cover || '0', weather_risk: weatherRisk });
      return fetch(`${serverUrl}/api/events/forecast?${params}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => [DOW_LABELS[i], data] as [string, AttendanceForecast | null])
        .catch(() => [DOW_LABELS[i], null] as [string, null]);
    });

    const all = await Promise.all(fetches);
    const map: Record<string, AttendanceForecast> = {};
    for (const [day, res] of all) {
      if (res && !(res as any).error) map[day] = res;
    }
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
          {/* City */}
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

        {/* Run button */}
        <button
          onClick={runForecast}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3 bg-teal/20 border border-teal/50 text-teal hover:bg-teal/30 rounded-lg font-semibold text-sm transition-all disabled:opacity-50"
        >
          {loading
            ? <><RefreshCw className="w-4 h-4 animate-spin" /> Forecasting…</>
            : <><Zap className="w-4 h-4" /> Run Forecast</>
          }
        </button>

        {/* Server URL config — shown when env var not set */}
        {!import.meta.env.VITE_VENUESCOPE_URL && (
          <div className="p-3 bg-warm-900/60 border border-warm-600 rounded-lg space-y-2">
            <p className="text-xs text-warm-400 font-medium">VenueScope Server URL</p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="http://your-server-ip:8502"
                value={serverUrlInput}
                onChange={e => setServerUrlInput(e.target.value)}
                className="flex-1 bg-warm-800 border border-warm-600 rounded-lg px-3 py-2 text-xs text-white placeholder-warm-600 focus:outline-none focus:border-teal font-mono"
              />
              <button
                onClick={saveServerUrl}
                className="px-3 py-2 bg-teal/20 border border-teal/40 text-teal text-xs rounded-lg hover:bg-teal/30 transition-colors font-medium"
              >
                Save
              </button>
            </div>
            <p className="text-[10px] text-warm-600">The IP address of the machine running VenueScope (port 8502)</p>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}
      </div>

      {/* Results — exact same UI as in Events.tsx ValidationReportCard */}
      <AnimatePresence>
        {forecast && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >

            {/* Attendance Forecast card — copied exactly from ValidationReportCard */}
            <div className="bg-whoop-panel border border-teal/30 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
                <Users className="w-4 h-4 text-teal" />
                <span className="text-sm font-semibold text-white">Attendance Forecast</span>
                <span className="ml-auto text-[10px] text-warm-500 bg-warm-800 px-2 py-0.5 rounded-full">
                  {forecast.model_short}
                </span>
              </div>
              <div className="p-4 space-y-3">
                {/* Attendance bar */}
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

                {/* Revenue grid */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Conservative', value: `$${forecast.revenue_low.toLocaleString()}` },
                    { label: 'Expected',     value: `$${forecast.revenue_mid.toLocaleString()}` },
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
                  {forecast.historical_sessions > 0
                    ? ` Trained on ${forecast.historical_sessions} real sessions from camera data.`
                    : ' Upgrade to ML model after 30 camera-tracked sessions.'}
                </p>
                {forecast.confidence === 'model' && (
                  <p className="text-[10px] text-amber-400/80">
                    ⚠ Baseline model — run VenueScope People Counter on live events to unlock venue-specific ML forecast
                  </p>
                )}
              </div>
            </div>

            {/* Factor breakdown */}
            {forecast.factors && (
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
                        {Object.entries(forecast.factors).map(([key, val]) => {
                          const labels: Record<string, string> = {
                            base_fill_55pct: 'Base (55% fill)',
                            day_of_week_multiplier: 'Day of week',
                            month_seasonality: 'Month seasonality',
                            event_type_lift: 'Event type lift',
                            holiday_factor: 'Holiday factor',
                            weather_penalty: 'Weather penalty',
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
            )}

            {/* Day comparison */}
            <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-whoop-divider">
                <span className="text-sm font-semibold text-white">Best Night This Week</span>
                {Object.keys(weekResults).length === 0 && (
                  <button
                    onClick={runWeekComparison} disabled={weekLoading}
                    className="text-xs text-teal hover:text-teal/80 transition-colors disabled:opacity-50"
                  >
                    {weekLoading ? 'Loading…' : 'Compare all 7 days →'}
                  </button>
                )}
                {Object.keys(weekResults).length > 0 && (
                  <button onClick={runWeekComparison} disabled={weekLoading} className="text-[10px] text-warm-500 hover:text-warm-300">
                    {weekLoading ? '…' : '↺'}
                  </button>
                )}
              </div>
              {Object.keys(weekResults).length === 0 && !weekLoading && (
                <p className="text-xs text-warm-500 px-4 py-3">See which night gives you the highest forecast for {CONCEPT_EMOJIS[concept]} {concept}.</p>
              )}
              {weekLoading && (
                <div className="flex items-center gap-2 px-4 py-3 text-xs text-warm-400">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Forecasting all 7 days…
                </div>
              )}
              {Object.keys(weekResults).length > 0 && (
                <div className="px-4 py-3 space-y-2">
                  {DOW_LABELS.map(day => {
                    const r = weekResults[day];
                    if (!r) return null;
                    const pct = r.mid / maxMid * 100;
                    const isSelected = day === selectedDow;
                    return (
                      <div key={day} className={`flex items-center gap-3 ${isSelected ? '' : 'opacity-60'}`}>
                        <span className={`text-xs w-7 font-medium ${isSelected ? 'text-white' : 'text-warm-500'}`}>{day}</span>
                        <div className="flex-1 h-5 bg-warm-800 rounded overflow-hidden">
                          <motion.div
                            className={`h-full rounded ${isSelected ? 'bg-teal/70' : 'bg-warm-600/60'}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                          />
                        </div>
                        <span className={`text-xs font-mono w-8 text-right ${isSelected ? 'text-white font-semibold' : 'text-warm-500'}`}>{r.mid}</span>
                        <span className="text-[10px] w-10 text-right text-warm-500">{r.fill_rate_pct}%</span>
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
                {forecast.note && <p className="text-[10px] text-warm-500 mt-0.5">{forecast.note}</p>}
              </div>
            </div>

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default Forecast;
