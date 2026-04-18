import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, BarChart3, TrendingUp, Minus,
  Users, AlertTriangle, RefreshCw, Trophy, ThumbsDown,
} from 'lucide-react';
import { generateCalendarEvents, type CalendarEventIdea } from '../services/events.service';
import { EventROITracker } from '../components/events/EventROITracker';
import { Forecast as ForecastPage } from './Forecast';
import authService from '../services/auth.service';
import venueSettingsService from '../services/venue-settings.service';
import { isDemoAccount } from '../utils/demoData';

// ─── Types ───────────────────────────────────────────────────────────────────

interface VenueEvent {
  event_id: string;
  name: string;
  concept_type: string;
  event_date: string;
  venue?: string;
  expected_headcount?: number;
  cover_charge?: number;
  status: 'upcoming' | 'live' | 'completed' | 'cancelled';
  // pre-launch signals
  meta_cpc_a?: number;
  meta_cpc_b?: number;
  meta_concept_a?: string;
  meta_concept_b?: string;
  tiktok_save_rate?: number;
  ig_dm_count?: number;
  ig_poll_pct?: number;
  google_trends_score?: number;
  eventbrite_pct?: number;
  demand_score?: number;
  demand_verdict?: 'green' | 'yellow' | 'red';
  // thresholds
  threshold_headcount?: number;
  threshold_revenue_pct?: number;
  // scorecard
  peak_occupancy?: number;
  avg_drink_velocity?: number;
  event_health_score?: number;
  scorecard_json?: string;
  notes?: string;
  created_at?: number;
}

interface ConceptStat {
  concept_type: string;
  run_count: number;
  avg_health_score?: number;
  verdict: 'keep' | 'optimize' | 'kill' | 'pending';
  avg_peak_occupancy?: number;
  avg_drink_velocity?: number;
}

// ─── Tonight Forecast Types ───────────────────────────────────────────────────

interface TonightFactor {
  name: string;
  value: string;
  impact: string;
}

interface HourlyPoint {
  hour: string;
  yhat: number;
  yhat_lower: number;
  yhat_upper: number;
}

interface TonightForecast {
  model_type: 'prophet' | 'gbm' | 'prior';
  calibration_state: string;
  mape_expected: string;
  confidence_pct: number;
  final_estimate: { low: number; mid: number; high: number };
  revenue_estimate: { low: number; mid: number; high: number };
  baseline_covers: number;
  lift: number;
  lift_pct: number;
  peak_hour: string;
  weather_multiplier: number;
  competition_drag: number;
  staffing_rec: { bartenders: number; note: string };
  factors: TonightFactor[];
  hourly_curve: HourlyPoint[];
}

// ─── Demo Forecast ─────────────────────────────────────────────────────────

const DEMO_FORECAST: TonightForecast = {
  model_type: 'prophet',
  calibration_state: 'month_6',
  mape_expected: '±11%',
  confidence_pct: 89,
  final_estimate: { low: 193, mid: 235, high: 277 },
  revenue_estimate: { low: 6360, mid: 7755, high: 9150 },
  baseline_covers: 220,
  lift: 15,
  lift_pct: 7,
  peak_hour: '10:00 PM',
  weather_multiplier: 0.90,
  competition_drag: 0.97,
  staffing_rec: { bartenders: 3, note: '1 extra bartender recommended after 9 PM based on Friday pattern' },
  factors: [
    { name: 'Day of week', value: 'Friday', impact: '+80%' },
    { name: 'Month',       value: 'October', impact: '+7%' },
    { name: 'Weather',     value: 'Light rain · 68°F', impact: '-10%' },
    { name: 'Competing events', value: 'Mid concert nearby', impact: '-3%' },
  ],
  hourly_curve: [
    { hour: '4:00 PM', yhat: 18, yhat_lower: 12, yhat_upper: 24 },
    { hour: '5:00 PM', yhat: 32, yhat_lower: 22, yhat_upper: 42 },
    { hour: '6:00 PM', yhat: 51, yhat_lower: 38, yhat_upper: 64 },
    { hour: '7:00 PM', yhat: 78, yhat_lower: 61, yhat_upper: 95 },
    { hour: '8:00 PM', yhat: 112, yhat_lower: 90, yhat_upper: 134 },
    { hour: '9:00 PM', yhat: 158, yhat_lower: 130, yhat_upper: 186 },
    { hour: '10:00 PM', yhat: 201, yhat_lower: 168, yhat_upper: 234 },
    { hour: '11:00 PM', yhat: 185, yhat_lower: 153, yhat_upper: 217 },
    { hour: '12:00 AM', yhat: 142, yhat_lower: 115, yhat_upper: 169 },
    { hour: '1:00 AM', yhat: 88, yhat_lower: 68, yhat_upper: 108 },
  ],
};

const CONCEPT_EMOJIS: Record<string, string> = {
  'DJ Night': '🎧', 'Live Music': '🎸', 'Trivia Night': '🧠', 'Karaoke': '🎤',
  'Drag Show': '💅', 'Sports Watch Party': '📺', 'Comedy Night': '😂',
  'Happy Hour Special': '🍹', 'Themed Party': '🎭', 'Open Mic': '🎙️',
  'Paint & Sip': '🎨', 'Speed Dating': '💘', 'Networking Event': '🤝', 'Other': '✨',
};

type EventsTab = 'tonight' | 'ideas' | 'attendance' | 'history';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getServerUrl() {
  return (import.meta.env.VITE_VENUESCOPE_URL || '').replace(':8501', ':8502').replace(/\/$/, '');
}

function verdictLabel(v: string) {
  if (v === 'keep')    return { label: 'Keep It', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30', icon: Trophy };
  if (v === 'optimize') return { label: 'Optimize', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', icon: TrendingUp };
  if (v === 'kill')    return { label: 'Kill It', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', icon: ThumbsDown };
  return { label: 'Not enough data', color: 'text-warm-500', bg: 'bg-warm-700 border-warm-600', icon: Minus };
}

function healthColor(score?: number) {
  if (!score) return 'text-warm-500';
  if (score >= 70) return 'text-green-400';
  if (score >= 45) return 'text-amber-400';
  return 'text-red-400';
}

function todayString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ─── Tonight Tab ──────────────────────────────────────────────────────────────

/** Build a client-side tonight forecast using the same multiplier model as runIdeaModel */
function buildClientForecast(capacity: number): TonightForecast {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun
  const month = now.getMonth() + 1;
  const dowMult = DOW_MULT[dow] ?? 0.55;
  const monthMult = MONTH_MULT[month] ?? 1.0;
  const base = capacity * 0.55;
  const mid = Math.max(5, Math.min(capacity, Math.round(base * dowMult * monthMult)));
  const low = Math.max(1, Math.round(mid * 0.82));
  const high = Math.min(capacity, Math.round(mid * 1.18));
  const revPerHead = 28;
  const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pct = (v: number) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;

  // Rough hourly curve: ramp up to peak around 10 PM then taper
  const HOURS = ['6 PM','7 PM','8 PM','9 PM','10 PM','11 PM','12 AM','1 AM'];
  const SHAPE = [0.18, 0.32, 0.52, 0.78, 1.00, 0.90, 0.68, 0.38];
  const hourly_curve = HOURS.map((hour, i) => ({
    hour,
    yhat:       Math.round(mid * SHAPE[i]),
    yhat_lower: Math.round(low * SHAPE[i]),
    yhat_upper: Math.round(high * SHAPE[i]),
  }));

  const bartenders = Math.max(1, Math.round(mid / 60));
  return {
    model_type:       'prior',
    calibration_state: 'generic_prior',
    mape_expected:    '±20%',
    confidence_pct:   60,
    final_estimate:   { low, mid, high },
    revenue_estimate: { low: low * revPerHead, mid: mid * revPerHead, high: high * revPerHead },
    baseline_covers:  mid,
    lift:  0,
    lift_pct: 0,
    peak_hour: '10:00 PM',
    weather_multiplier: 1.0,
    competition_drag:  1.0,
    staffing_rec: {
      bartenders,
      note: `${bartenders} bartender${bartenders !== 1 ? 's' : ''} recommended based on expected crowd`,
    },
    factors: [
      { name: 'Day of week', value: DOW_NAMES[dow],         impact: pct(dowMult) },
      { name: 'Month',       value: MONTH_NAMES[month],     impact: pct(monthMult) },
    ],
    hourly_curve,
  };
}

function TonightTab({ venueId }: { venueId: string }) {
  const [forecast, setForecast] = useState<TonightForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingClientModel, setUsingClientModel] = useState(false);
  const [venueCapacity, setVenueCapacity] = useState(150);

  const load = useCallback(async () => {
    setLoading(true);
    setUsingClientModel(false);

    if (!venueId) {
      setLoading(false);
      return;
    }

    if (isDemoAccount(venueId)) {
      setForecast(DEMO_FORECAST);
      setLoading(false);
      return;
    }

    // Load capacity for client-side fallback
    let cap = 150;
    try {
      const settings = await venueSettingsService.loadSettingsFromCloud(venueId);
      if (settings?.capacity) { cap = settings.capacity; setVenueCapacity(settings.capacity); }
    } catch { /* ignore */ }

    const serverUrl = getServerUrl();
    if (serverUrl) {
      try {
        const res = await fetch(`${serverUrl}/forecast/tonight`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ venue_id: venueId, date: todayString() }),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error('non-2xx');
        const data = await res.json();
        setForecast(data);
        setLoading(false);
        return;
      } catch { /* fall through to client model */ }
    }

    // Client-side model — always works, no backend needed
    setForecast(buildClientForecast(cap));
    setUsingClientModel(true);
    setLoading(false);
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  if (!venueId) {
    return (
      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-6 text-center">
        <TrendingUp className="w-8 h-8 text-warm-600 mx-auto mb-3" />
        <p className="text-sm text-warm-400">Configure your venue to enable forecasting</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="w-6 h-6 text-teal animate-spin" />
      </div>
    );
  }

  if (!forecast) return null;

  const { baseline_covers, lift, lift_pct } = forecast;

  // Confidence label — human-readable, no formula exposed
  const confidenceLabel: Record<string, string> = {
    generic_prior: 'building — using industry averages',
    week_2:        'early — 2-week pattern emerging',
    week_4:        'growing — 4-week pattern match',
    week_12:       'strong — 12-week pattern match',
    month_6:       'high — 6-month venue rhythm locked in',
    month_12:      'very high — full-year pattern',
  };
  const confLabel = confidenceLabel[forecast.calibration_state] ?? forecast.calibration_state.replace(/_/g, ' ');

  const maxYhat = Math.max(...forecast.hourly_curve.map(h => h.yhat_upper), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* ── Primary forecast readout ── */}
      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-5 space-y-3">
        {/* Headline */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] text-warm-500 uppercase tracking-wider font-semibold mb-1">Tonight's Forecast</p>
            <p className="text-2xl font-bold text-white leading-tight">
              {forecast.final_estimate.mid} covers
              <span className="text-warm-500 font-normal mx-2">·</span>
              <span className="text-green-400">${forecast.revenue_estimate.mid.toLocaleString()}</span>
              <span className="text-warm-500 font-normal mx-2">·</span>
              <span className="text-warm-400 text-lg">{forecast.mape_expected}</span>
            </p>
          </div>
          <TrendingUp className="w-5 h-5 text-teal flex-shrink-0 mt-1" />
        </div>

        {/* Range */}
        <p className="text-xs text-warm-400">
          Range:{' '}
          <span className="text-white font-semibold">{forecast.final_estimate.low}–{forecast.final_estimate.high} covers</span>
          <span className="mx-2 text-warm-600">·</span>
          <span className="text-white font-semibold">${forecast.revenue_estimate.low.toLocaleString()}–${forecast.revenue_estimate.high.toLocaleString()}</span>
        </p>

        <div className="h-px bg-whoop-divider" />

        {/* Baseline + lift */}
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-warm-500">
              Baseline {forecast.factors.find(f => f.name === 'Day of week')?.value ?? ''}{' '}
              {forecast.factors.find(f => f.name === 'Month')?.value ?? ''}
            </span>
            <span className="text-white font-semibold">{baseline_covers} covers</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-warm-500">Predicted lift</span>
            <span className={`font-bold ${lift >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {lift >= 0 ? '+' : ''}{lift} ({lift_pct >= 0 ? '+' : ''}{lift_pct}%)
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-warm-500">Confidence</span>
            <span className="text-warm-300">{confLabel}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-warm-500">Peak hour</span>
            <span className="text-white font-semibold">{forecast.peak_hour}</span>
          </div>
        </div>
      </div>

      {/* ── Recommended actions ── */}
      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-5">
        <p className="text-[11px] text-warm-500 uppercase tracking-wider font-semibold mb-3">Recommended Actions</p>
        <ul className="space-y-2">
          <li className="flex items-start gap-2 text-sm text-warm-200">
            <span className="text-teal font-bold flex-shrink-0">•</span>
            <span>
              <span className="font-semibold text-white">Staff:</span>{' '}
              {forecast.staffing_rec.note}
            </span>
          </li>
          {forecast.factors.map(f => {
            const isNegative = f.impact.startsWith('-');
            const isNeutral  = ['—', 'no impact', 'baseline'].includes(f.impact) || f.impact.startsWith('×');
            if (isNeutral) return null;
            return (
              <li key={f.name} className="flex items-start gap-2 text-sm text-warm-200">
                <span className={`font-bold flex-shrink-0 ${isNegative ? 'text-red-400' : 'text-teal'}`}>•</span>
                <span>
                  <span className="font-semibold text-white">{f.name}:</span>{' '}
                  {f.value}
                  <span className={`ml-1.5 text-xs font-bold ${isNegative ? 'text-red-400' : 'text-green-400'}`}>
                    {f.impact}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ── Hourly curve ── */}
      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-5">
        <p className="text-[11px] text-warm-500 uppercase tracking-wider font-semibold mb-4">Expected Crowd by Hour</p>
        <div className="flex items-end gap-1.5" style={{ height: '96px' }}>
          {forecast.hourly_curve.map(pt => {
            const bandH = Math.round((pt.yhat_upper / maxYhat) * 100);
            const barH  = Math.round((pt.yhat / maxYhat) * 100);
            const isPeak = pt.hour === forecast.peak_hour;
            return (
              <div key={pt.hour} className="flex-1 flex flex-col items-center h-full justify-end gap-1">
                <div className="relative w-full" style={{ height: '80px' }}>
                  <div className="absolute bottom-0 left-0 right-0 rounded-t-sm bg-teal/15" style={{ height: `${bandH}%` }} />
                  <div className={`absolute bottom-0 left-0 right-0 rounded-t-sm ${isPeak ? 'bg-teal' : 'bg-teal/60'}`} style={{ height: `${barH}%` }} />
                </div>
                <span className="text-[8px] text-warm-600 whitespace-nowrap">
                  {pt.hour.replace(':00', '').replace(' PM', 'p').replace(' AM', 'a')}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Calibration notice */}
      {(forecast.model_type === 'prior' || usingClientModel) && (
        <div className="bg-warm-800/40 border border-warm-700/50 rounded-xl p-3 flex items-start gap-2">
          <RefreshCw className="w-3.5 h-3.5 text-warm-500 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-warm-500 leading-relaxed">
            Forecast uses day-of-week and seasonal averages. Accuracy improves automatically as your venue history accumulates.
          </p>
        </div>
      )}
    </motion.div>
  );
}

// ─── Concept Optimizer ────────────────────────────────────────────────────────

function ConceptOptimizer({ concepts }: { concepts: ConceptStat[]; events?: VenueEvent[] }) {
  const [compareA, setCompareA] = useState<string>('');
  const [compareB, setCompareB] = useState<string>('');

  const completedConcepts = concepts.filter(c => c.run_count > 0);

  const conceptA = completedConcepts.find(c => c.concept_type === compareA);
  const conceptB = completedConcepts.find(c => c.concept_type === compareB);

  return (
    <div className="space-y-4">
      {/* Concept rankings */}
      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
          <Trophy className="w-4 h-4 text-teal" />
          <span className="text-sm font-semibold text-white">Concept Rankings</span>
          <span className="text-[10px] text-warm-500 ml-auto">Based on all completed events</span>
        </div>
        {completedConcepts.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm text-warm-500">No completed events yet.</p>
            <p className="text-xs text-warm-600 mt-1">Run events and mark them complete to see rankings.</p>
          </div>
        ) : (
          <div className="divide-y divide-whoop-divider">
            {completedConcepts.map((c, i) => {
              const v = verdictLabel(c.verdict);
              const VIcon = v.icon;
              return (
                <div key={c.concept_type} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-lg w-8 text-center flex-shrink-0">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
                  <span className="text-xl">{CONCEPT_EMOJIS[c.concept_type] || '✨'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">{c.concept_type}</p>
                    <p className="text-[10px] text-warm-500">{c.run_count} run{c.run_count !== 1 ? 's' : ''}{c.avg_peak_occupancy ? ` · avg ${c.avg_peak_occupancy} peak` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.avg_health_score != null && (
                      <span className={`text-sm font-bold ${healthColor(c.avg_health_score)}`}>{c.avg_health_score}</span>
                    )}
                    <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border ${v.bg} ${v.color}`}>
                      <VIcon className="w-3 h-3" />{v.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* A/B Compare */}
      {completedConcepts.length >= 2 && (
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
            <BarChart3 className="w-4 h-4 text-teal" />
            <span className="text-sm font-semibold text-white">Head-to-Head Comparison</span>
          </div>
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-warm-500 mb-1 block">Concept A</label>
                <select value={compareA} onChange={e => setCompareA(e.target.value)}
                  className="w-full bg-warm-900 border border-warm-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal/50">
                  <option value="">Select concept</option>
                  {completedConcepts.map(c => <option key={c.concept_type} value={c.concept_type}>{c.concept_type}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-warm-500 mb-1 block">Concept B</label>
                <select value={compareB} onChange={e => setCompareB(e.target.value)}
                  className="w-full bg-warm-900 border border-warm-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal/50">
                  <option value="">Select concept</option>
                  {completedConcepts.filter(c => c.concept_type !== compareA).map(c => <option key={c.concept_type} value={c.concept_type}>{c.concept_type}</option>)}
                </select>
              </div>
            </div>

            {conceptA && conceptB && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                {[
                  { label: 'Health Score', a: conceptA.avg_health_score, b: conceptB.avg_health_score, suffix: '/100' },
                  { label: 'Avg Peak Occupancy', a: conceptA.avg_peak_occupancy, b: conceptB.avg_peak_occupancy, suffix: ' people' },
                  { label: 'Avg Drinks/Hr', a: conceptA.avg_drink_velocity, b: conceptB.avg_drink_velocity, suffix: '/hr' },
                  { label: 'Times Run', a: conceptA.run_count, b: conceptB.run_count, suffix: '' },
                ].map(row => {
                  const aWins = row.a != null && row.b != null && row.a > row.b;
                  const bWins = row.a != null && row.b != null && row.b > row.a;
                  return (
                    <div key={row.label} className="bg-warm-800/40 rounded-xl p-3">
                      <p className="text-[10px] text-warm-500 mb-2 uppercase tracking-wide">{row.label}</p>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold flex-1 text-right ${aWins ? 'text-teal' : 'text-warm-300'}`}>
                          {row.a != null ? `${row.a}${row.suffix}` : '—'}
                          {aWins && ' 🏆'}
                        </span>
                        <span className="text-xs text-warm-600 flex-shrink-0">vs</span>
                        <span className={`text-sm font-bold flex-1 ${bWins ? 'text-teal' : 'text-warm-300'}`}>
                          {bWins && '🏆 '}
                          {row.b != null ? `${row.b}${row.suffix}` : '—'}
                        </span>
                      </div>
                    </div>
                  );
                })}

                <div className={`rounded-xl border p-3 text-center ${
                  (conceptA.avg_health_score || 0) > (conceptB.avg_health_score || 0)
                    ? 'bg-teal/10 border-teal/30' : 'bg-warm-700/30 border-warm-600'
                }`}>
                  <p className="text-xs font-semibold text-white">
                    {(conceptA.avg_health_score || 0) > (conceptB.avg_health_score || 0)
                      ? `${CONCEPT_EMOJIS[compareA]} ${compareA} is outperforming — run it more`
                      : (conceptB.avg_health_score || 0) > (conceptA.avg_health_score || 0)
                        ? `${CONCEPT_EMOJIS[compareB]} ${compareB} is outperforming — run it more`
                        : 'Too close to call — need more data'}
                  </p>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      )}

      {/* What to run next */}
      <div className="bg-teal/5 border border-teal/20 rounded-xl p-4">
        <p className="text-[10px] text-teal font-semibold uppercase tracking-wide mb-2">🎯 The A/B Rule</p>
        <p className="text-xs text-warm-300 leading-relaxed">
          Run any new concept <strong className="text-white">3 times</strong> before judging it.
          One bad night doesn't kill it. One great night doesn't prove it.
          Three runs on the same day of week gives you a real verdict.
        </p>
      </div>
    </div>
  );
}


// ─── Attendance Model ─────────────────────────────────────────────────────────

const DOW_MULT: Record<number, number> = {
  0: 0.31, 1: 0.34, 2: 0.42, 3: 0.55, 4: 0.78, 5: 1.00, 6: 0.65,
};
const MONTH_MULT: Record<number, number> = {
  1: 0.72, 2: 0.75, 3: 0.88, 4: 0.91, 5: 0.96, 6: 1.05,
  7: 1.02, 8: 0.98, 9: 0.93, 10: 0.97, 11: 1.08, 12: 1.12,
};
const IDEA_EVENT_LIFT: Record<string, number> = {
  'Sports Watch Party': 1.22, 'Themed Party': 1.28, 'Happy Hour Special': 1.05,
};
const IDEA_SPEND: Record<string, [number, number]> = {
  'Sports Watch Party': [14, 25], 'Themed Party': [18, 35], 'Happy Hour Special': [10, 18],
};

function ideaHolidayMult(d: Date): { mult: number; label: string } {
  const m = d.getMonth() + 1, day = d.getDate();
  if (m === 3  && day === 17) return { mult: 1.45, label: "St. Pat's boost +45%" };
  if (m === 10 && day === 31) return { mult: 1.35, label: 'Halloween boost +35%' };
  if (m === 12 && day === 31) return { mult: 1.50, label: 'NYE boost +50%' };
  if (m === 11 && day >= 22 && day <= 28) return { mult: 0.55, label: 'Thanksgiving week penalty -45%' };
  if (m === 2 && day >= 7 && day <= 14) return { mult: 1.30, label: "Valentine's boost +30%" };
  if (m === 2 && day >= 7 && day <= 13) return { mult: 1.30, label: "Super Bowl boost +30%" };
  return { mult: 1.0, label: 'No holiday' };
}

function getIdeaConcept(idea: CalendarEventIdea): string {
  const id = idea.id.replace(/-\d{4}$/, '');
  const sports = ['superbowl','marchmadness','finalfour','masters','nbafinals','nflkickoff','nflwildcard','worldseries','stanleycup','kentuckyderby','daytona500'];
  if (sports.includes(id)) return 'Sports Watch Party';
  if (['nyd','solstice'].includes(id)) return 'Happy Hour Special';
  return 'Themed Party';
}

interface IdeaForecast {
  low: number; mid: number; high: number; fillPct: number;
  revLow: number; revMid: number; revHigh: number;
  factors: { dow: number; dowLabel: string; month: number; monthLabel: string; lift: number; liftLabel: string; holiday: number; holidayLabel: string; };
}

function runIdeaModel(idea: CalendarEventIdea, capacity: number): IdeaForecast {
  const d = idea.date;
  const concept = getIdeaConcept(idea);
  const base = capacity * 0.55;
  const dow = DOW_MULT[(d.getDay() + 6) % 7] ?? 0.65;
  const month = MONTH_MULT[d.getMonth() + 1] ?? 1.0;
  const lift = IDEA_EVENT_LIFT[concept] ?? 1.10;
  const { mult: holiday, label: holidayLabel } = ideaHolidayMult(d);
  const mid = Math.max(5, Math.min(capacity, Math.round(base * dow * month * lift * holiday)));
  const low = Math.max(1, Math.round(mid * 0.82));
  const high = Math.min(capacity, Math.round(mid * 1.18));
  const [spLow, spHigh] = IDEA_SPEND[concept] ?? [14, 28];
  const avgSp = (spLow + spHigh) / 2;
  const DOW_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return {
    low, mid, high,
    fillPct: Math.round((mid / capacity) * 100),
    revLow: Math.round(low * spLow),
    revMid: Math.round(mid * avgSp),
    revHigh: Math.round(high * spHigh),
    factors: {
      dow, dowLabel: DOW_NAMES[d.getDay()],
      month, monthLabel: MONTH_NAMES[d.getMonth() + 1],
      lift, liftLabel: concept,
      holiday, holidayLabel,
    },
  };
}

// ─── Idea Card ────────────────────────────────────────────────────────────────

function IdeaCard({ idea, capacity }: { idea: CalendarEventIdea; capacity: number }) {
  const [expanded, setExpanded] = useState(false);
  const fc = runIdeaModel(idea, capacity);
  const diffColor = idea.difficulty === 'Easy'
    ? 'text-green-400 bg-green-500/10 border-green-500/30'
    : idea.difficulty === 'Medium'
    ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
    : 'text-red-400 bg-red-500/10 border-red-500/30';
  const cardBorder = idea.daysUntil <= 7 ? 'border-teal/40 bg-teal/5' : 'border-warm-700 bg-whoop-panel';

  return (
    <motion.div layoutId={`idea-${idea.id}`} className={`rounded-2xl border ${cardBorder} overflow-hidden`} layout>
      <button className="w-full text-left p-4" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-start gap-3">
          <span className="text-2xl flex-shrink-0">{idea.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-white">{idea.name}</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${diffColor}`}>
                {idea.difficulty}
              </span>
              {idea.daysUntil <= 7 && (
                <span className="text-[10px] font-bold text-teal bg-teal/10 border border-teal/30 rounded-full px-2 py-0.5">THIS WEEK</span>
              )}
            </div>
            <p className="text-xs text-warm-400 mt-0.5">{idea.dateLabel} · {idea.daysUntil} days away</p>
            <p className="text-xs text-warm-300 mt-1 leading-snug">{idea.description}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xl font-bold text-white">{fc.mid}</p>
            <p className="text-[10px] text-warm-500">est. guests</p>
          </div>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-warm-700/50">
              {/* Vision */}
              <div className="pt-3">
                <p className="text-[10px] text-warm-500 uppercase tracking-wider font-semibold mb-1.5">The Vision</p>
                <p className="text-xs text-warm-300 leading-relaxed">{idea.howTo}</p>
              </div>

              {/* Attendance Forecast */}
              <div className="bg-warm-800/60 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-3.5 h-3.5 text-teal" />
                  <span className="text-xs font-semibold text-white">Predicted Attendance</span>
                  <span className="ml-auto text-[10px] text-warm-500">{fc.fillPct}% fill rate</span>
                </div>
                <div className="relative h-6 bg-warm-700 rounded-lg overflow-hidden mb-2">
                  <div className="absolute inset-y-0 left-0 bg-teal/20 rounded-lg"
                    style={{ width: `${Math.min(100, (fc.high / capacity) * 100)}%` }} />
                  <div className="absolute inset-y-0 left-0 bg-teal/45 rounded-lg"
                    style={{ width: `${Math.min(100, (fc.mid / capacity) * 100)}%` }} />
                  <div className="absolute inset-y-0 left-0 bg-teal rounded-lg"
                    style={{ width: `${Math.min(100, (fc.low / capacity) * 100)}%` }} />
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-warm-400">{fc.low} low</span>
                  <span className="font-bold text-white">{fc.mid} expected</span>
                  <span className="text-warm-400">{fc.high} high</span>
                </div>
                <div className="flex justify-between text-[10px] text-green-400 mt-1">
                  <span>${fc.revLow.toLocaleString()}</span>
                  <span className="font-semibold">${fc.revMid.toLocaleString()} est. revenue</span>
                  <span>${fc.revHigh.toLocaleString()}</span>
                </div>
              </div>

              {/* Variable breakdown */}
              <div>
                <p className="text-[10px] text-warm-500 uppercase tracking-wider font-semibold mb-2">Why That Number</p>
                <div className="space-y-2">
                  {[
                    { label: `Day of week (${fc.factors.dowLabel})`, value: fc.factors.dow },
                    { label: `${fc.factors.monthLabel} seasonality`, value: fc.factors.month },
                    { label: `${fc.factors.liftLabel} lift`, value: fc.factors.lift },
                    ...(fc.factors.holiday !== 1.0 ? [{ label: fc.factors.holidayLabel, value: fc.factors.holiday }] : []),
                  ].map(({ label, value }) => {
                    const pct = Math.round((value - 1) * 100);
                    const barColor = value >= 1.0 ? 'bg-teal' : 'bg-red-500';
                    const textColor = value >= 1.15 ? 'text-green-400' : value >= 0.95 ? 'text-amber-400' : 'text-red-400';
                    return (
                      <div key={label}>
                        <div className="flex justify-between mb-0.5">
                          <span className="text-[10px] text-warm-400">{label}</span>
                          <span className={`text-[10px] font-semibold ${textColor}`}>
                            {pct >= 0 ? '+' : ''}{pct}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-warm-700 rounded-full">
                          <div className={`h-1.5 rounded-full ${barColor}`}
                            style={{ width: `${Math.min(100, Math.max(5, value * 60))}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-warm-600 mt-2.5">
                  Baseline: {Math.round(capacity * 0.55)} guests (55% capacity) × multipliers above = {fc.mid} expected
                </p>
              </div>

              {/* Lead time warning */}
              {idea.leadTimeDays > idea.daysUntil && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-300 leading-relaxed">
                    Recommended {idea.leadTimeDays}+ days of promotion — you only have {idea.daysUntil} days left. Start promoting today.
                  </p>
                </div>
              )}

              {/* Expected impact */}
              <div className="bg-teal/5 border border-teal/20 rounded-lg p-2.5">
                <p className="text-[10px] text-teal font-semibold">{idea.expectedImpact}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Ideas Tab ────────────────────────────────────────────────────────────────

function IdeasTab({ capacity }: { capacity: number }) {
  const [filter, setFilter] = useState<'All' | 'Easy' | 'Medium' | 'Hard'>('All');
  // Memoize so the list is generated once — prevents framer-motion ghost cards on re-render
  const ideas = useMemo(() => generateCalendarEvents(new Date(), 3), []);
  const filtered = filter === 'All' ? ideas : ideas.filter(i => i.difficulty === filter);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['All', 'Easy', 'Medium', 'Hard'] as const).map(f => (
          <motion.button key={f} onClick={() => setFilter(f)} whileTap={{ scale: 0.95 }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              filter === f
                ? f === 'Easy'   ? 'bg-green-500/10 border-green-500/40 text-green-400'
                : f === 'Medium' ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
                : f === 'Hard'   ? 'bg-red-500/10 border-red-500/40 text-red-400'
                : 'bg-teal/10 border-teal/40 text-teal'
                : 'bg-warm-800 border-warm-700 text-warm-400 hover:text-white'
            }`}>
            {f}
          </motion.button>
        ))}
        <span className="ml-auto text-[10px] text-warm-500 flex items-center">{filtered.length} ideas</span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-sm text-warm-500">No {filter.toLowerCase()} events in the next 3 months</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(idea => (
            <IdeaCard key={idea.id} idea={idea} capacity={capacity} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Events() {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';

  const [activeTab, setActiveTab] = useState<EventsTab>('tonight');
  const [events, setEvents] = useState<VenueEvent[]>([]);
  const [concepts, setConcepts] = useState<ConceptStat[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [venueCapacity, setVenueCapacity] = useState(150);

  useEffect(() => {
    if (isDemoAccount(venueId)) { setVenueCapacity(500); return; }
    const cap = venueSettingsService.getCapacity(venueId);
    if (cap) setVenueCapacity(cap);
    venueSettingsService.loadSettingsFromCloud(venueId).then(s => {
      if (s?.capacity) setVenueCapacity(s.capacity);
    }).catch(() => {});
  }, [venueId]);

  const loadEvents = async () => {
    setLoadingEvents(true);

    if (isDemoAccount(venueId)) {
      // Demo account: inject realistic concept history data
      setConcepts([
        { concept_type: 'Sports Watch Party',  run_count: 8,  avg_health_score: 84, verdict: 'keep',     avg_peak_occupancy: 412, avg_drink_velocity: 18.2 },
        { concept_type: 'DJ Night',            run_count: 12, avg_health_score: 79, verdict: 'keep',     avg_peak_occupancy: 389, avg_drink_velocity: 16.4 },
        { concept_type: 'Themed Party',        run_count: 5,  avg_health_score: 71, verdict: 'optimize', avg_peak_occupancy: 318, avg_drink_velocity: 13.7 },
        { concept_type: 'Live Music',          run_count: 6,  avg_health_score: 68, verdict: 'optimize', avg_peak_occupancy: 297, avg_drink_velocity: 12.1 },
        { concept_type: 'Happy Hour Special',  run_count: 14, avg_health_score: 62, verdict: 'optimize', avg_peak_occupancy: 178, avg_drink_velocity:  9.4 },
        { concept_type: 'Comedy Night',        run_count: 3,  avg_health_score: 44, verdict: 'kill',     avg_peak_occupancy: 134, avg_drink_velocity:  6.8 },
      ]);
      setEvents([]);
      setLoadingEvents(false);
      return;
    }

    try {
      const r = await fetch(`${getServerUrl()}/api/events`);
      const data = await r.json();
      setEvents(data.events || []);
    } catch { setEvents([]); }
    try {
      const r = await fetch(`${getServerUrl()}/api/events/concepts`);
      const data = await r.json();
      setConcepts(data.concepts || []);
    } catch { setConcepts([]); }
    setLoadingEvents(false);
  };

  useEffect(() => { loadEvents(); }, []);


  const tabs = [
    { id: 'tonight'    as const, label: "Tonight's Forecast",   icon: TrendingUp },
    { id: 'ideas'      as const, label: 'Ideas',                icon: Sparkles },
    { id: 'attendance' as const, label: 'Attendance Forecaster', icon: BarChart3 },
    { id: 'history'    as const, label: 'History',              icon: Trophy },
  ];

  return (
    <div className="pb-20 space-y-4">
      {/* Header */}
      <div className="pb-2">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-teal" />
          <h1 className="text-2xl font-bold text-white">Events</h1>
        </div>
        <p className="text-sm text-warm-400">Ideas · Forecast · Optimize</p>
      </div>

      {/* Tab Nav */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {tabs.map(tab => (
          <motion.button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap flex-shrink-0 ${
              activeTab === tab.id
                ? 'bg-teal/10 border border-teal/50 text-white'
                : 'bg-warm-800 border border-warm-700 text-warm-400 hover:text-white'
            }`}
            whileTap={{ scale: 0.95 }}>
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </motion.button>
        ))}
      </div>

      {/* Tonight's Forecast Tab */}
      {activeTab === 'tonight' && <TonightTab venueId={venueId} />}

      {/* Ideas Tab */}
      {activeTab === 'ideas' && <IdeasTab capacity={venueCapacity} />}

      {/* Attendance Forecaster Tab */}
      {activeTab === 'attendance' && <ForecastPage />}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <ConceptOptimizer concepts={concepts} events={events} />
          <div className="mt-6">
            <p className="text-[10px] text-warm-500 uppercase tracking-wider font-semibold mb-3">Past Event Performance</p>
            <EventROITracker />
          </div>
          {loadingEvents && (
            <div className="text-center py-4"><RefreshCw className="w-5 h-5 text-warm-600 animate-spin mx-auto" /></div>
          )}
        </div>
      )}
    </div>
  );
}
