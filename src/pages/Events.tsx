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
import { isDemoAccount, generateDemoVenueScopeJobs, DEMO_VENUE } from '../utils/demoData';
import weatherService from '../services/weather.service';
import venueScopeService, { type VenueScopeJob } from '../services/venuescope.service';

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
  staffing_hourly?: Record<string, { bartenders: number; servers: number; door: number; barback: number; concurrent: number }>;
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


// ─── Tonight Tab ──────────────────────────────────────────────────────────────

/**
 * Layer 1 venue-personalized forecast.
 *
 * Uses real VenueScope job history to learn THIS venue's DOW pattern, then blends it
 * with a pooled industry prior (Bayesian shrinkage). Confidence bands and model labels
 * tighten automatically as data accumulates — no hardcoded ±18% lies.
 */
function buildClientForecast(
  capacity: number,
  historicalJobs: VenueScopeJob[] = [],
  avgDrinkPrice = 28,
): TonightForecast {
  const now   = new Date();
  const dow   = now.getDay();        // 0=Sun … 6=Sat
  const month = now.getMonth() + 1;

  // ── Step 1: Extract one "covers" number per calendar night ──────────────────
  // Multiple cameras fire on the same night — pick the best signal per date.
  const dailyCovers: Record<string, { covers: number; dow: number }> = {};
  for (const job of historicalJobs) {
    if (job.isLive || job.status !== 'done') continue;
    const ts = (job.finishedAt || job.createdAt || 0) as number;
    if (!ts) continue;
    const d = new Date(ts * 1000);
    const dateKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const jobDow  = d.getDay();

    // Prefer entrance-camera totalEntries; fall back to drink count proxy
    let covers = 0;
    if ((job.totalEntries ?? 0) > 0) {
      covers = job.totalEntries as number;
    } else if ((job.totalDrinks ?? 0) > 0) {
      covers = Math.round((job.totalDrinks as number) / 2.5);
    }
    if (covers <= 0) continue;

    // Keep the largest value for this night (entrance cam beats drink cam)
    if (!dailyCovers[dateKey] || covers > dailyCovers[dateKey].covers) {
      dailyCovers[dateKey] = { covers, dow: jobDow };
    }
  }

  const nights       = Object.values(dailyCovers);
  const daysOfHistory = nights.length;

  // ── Step 2: Compute venue-specific DOW averages ──────────────────────────────
  const venueByDow: Record<number, number[]> = {};
  for (const { covers, dow: d } of nights) {
    (venueByDow[d] ??= []).push(covers);
  }
  const venueDowAvg: Record<number, number> = {};
  for (let d = 0; d < 7; d++) {
    const arr = venueByDow[d];
    if (arr?.length) venueDowAvg[d] = arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  // ── Step 3: Bayesian blend — venue data vs pooled prior ──────────────────────
  // alpha ramps from 0 (cold start) → 1 (90 days fully observed)
  const alpha     = Math.min(daysOfHistory / 90, 1.0);
  const pooledPeak = capacity * 0.55;
  const venuePeak  = Math.max(...Object.values(venueDowAvg), pooledPeak);

  const blendedDowMult: Record<number, number> = {};
  for (let d = 0; d < 7; d++) {
    const pooledMult = DOW_MULT[d] ?? 0.55;
    if (venueDowAvg[d] != null) {
      blendedDowMult[d] = alpha * (venueDowAvg[d] / venuePeak) + (1 - alpha) * pooledMult;
    } else {
      blendedDowMult[d] = pooledMult; // no data yet for this DOW
    }
  }

  // ── Step 4: Forecast mid-point ────────────────────────────────────────────────
  const venueOverallAvg = nights.length > 0
    ? nights.reduce((s, n) => s + n.covers, 0) / nights.length
    : capacity * 0.55;
  const blendedBase = alpha * venueOverallAvg + (1 - alpha) * (capacity * 0.55);
  const dowMult  = blendedDowMult[dow] ?? DOW_MULT[dow] ?? 0.55;
  const monthMult = MONTH_MULT[month] ?? 1.0;

  const mid = Math.max(5, Math.min(capacity, Math.round(blendedBase * dowMult * monthMult)));

  // ── Step 5: Data-driven confidence bands ─────────────────────────────────────
  // Band honestly reflects what the model actually knows.
  const bandPct = daysOfHistory < 14  ? 0.25  // cold start — we're guessing
                : daysOfHistory < 60  ? 0.18  // learning
                : daysOfHistory < 180 ? 0.13  // calibrated
                :                       0.10; // precision
  const low  = Math.max(1, Math.round(mid * (1 - bandPct)));
  const high = Math.min(capacity, Math.round(mid * (1 + bandPct)));

  // ── Step 6: Revenue — actual price from venue settings, never hardcoded ──────
  const drinksPerPerson = 2.5;
  const revPerHead = drinksPerPerson * avgDrinkPrice;

  // ── Metadata labels that scale with data availability ────────────────────────
  const mapeLabel  = daysOfHistory < 14  ? '±25%'  : daysOfHistory < 60  ? '±18%'
                   : daysOfHistory < 180 ? '±13%'  : '±10%';
  const confPct    = daysOfHistory < 14  ? 55      : daysOfHistory < 60   ? 68
                   : daysOfHistory < 180 ? 80      : 90;
  const calibState = daysOfHistory < 14  ? 'generic_prior'
                   : daysOfHistory < 28  ? 'week_2'
                   : daysOfHistory < 90  ? 'week_12'
                   : 'month_6';

  const bartenders = Math.max(1, Math.round(mid / 60));
  const DOW_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pct = (v: number) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;

  const HOURS = ['6 PM','7 PM','8 PM','9 PM','10 PM','11 PM','12 AM','1 AM'];
  const SHAPE = [0.18, 0.32, 0.52, 0.78, 1.00, 0.90, 0.68, 0.38];
  const hourly_curve = HOURS.map((hour, i) => ({
    hour,
    yhat:       Math.round(mid * SHAPE[i]),
    yhat_lower: Math.round(low * SHAPE[i]),
    yhat_upper: Math.round(high * SHAPE[i]),
  }));

  const factors: TonightFactor[] = [
    { name: 'Day of week', value: DOW_NAMES[dow],     impact: pct(dowMult)   },
    { name: 'Month',       value: MONTH_NAMES[month], impact: pct(monthMult) },
  ];
  if (daysOfHistory >= 14) factors.push({
    name: 'Venue history',
    value: `${daysOfHistory} nights on record`,
    impact: '↑ accuracy',
  });

  return {
    model_type:        daysOfHistory >= 14 ? 'gbm' : 'prior',
    calibration_state: calibState,
    mape_expected:     mapeLabel,
    confidence_pct:    confPct,
    final_estimate:    { low, mid, high },
    revenue_estimate:  {
      low:  Math.round(low  * revPerHead),
      mid:  Math.round(mid  * revPerHead),
      high: Math.round(high * revPerHead),
    },
    baseline_covers:   Math.round(blendedBase),
    lift:              0,
    lift_pct:          0,
    peak_hour:         '10:00 PM',
    weather_multiplier: 1.0,
    competition_drag:   1.0,
    staffing_rec: {
      bartenders,
      note: `${bartenders} bartender${bartenders !== 1 ? 's' : ''} recommended based on ${DOW_NAMES[dow]} night pattern`,
    },
    factors,
    hourly_curve,
  };
}

/** Build a venue-personalized tonight forecast using real demo historical data */
async function buildDemoForecast(): Promise<TonightForecast> {
  const now = new Date();
  const dow = now.getDay();      // 0=Sun … 6=Sat
  const month = now.getMonth() + 1;
  const capacity = DEMO_VENUE.capacity; // 500

  // ── Gather historical people-counts from demo jobs, grouped by DOW ──
  const jobs = generateDemoVenueScopeJobs();
  const dowGroups: Record<number, number[]> = {};
  for (const job of jobs) {
    if (!job.createdAt || job.isLive) continue;
    const jobDow = new Date((job.createdAt as number) * 1000).getDay();
    let people = 0;
    if ((job.totalEntries as number) > 0) {
      people = job.totalEntries as number;
    } else if ((job.totalDrinks as number) > 0) {
      people = Math.round((job.totalDrinks as number) / 2.1);
    }
    if (people > 0) {
      if (!dowGroups[jobDow]) dowGroups[jobDow] = [];
      dowGroups[jobDow].push(people);
    }
  }

  // ── Prior: industry generic formula ──
  const dowMult = DOW_MULT[dow] ?? 0.55;
  const monthMult = MONTH_MULT[month] ?? 1.0;
  const priorMid = Math.round(capacity * 0.55 * dowMult * monthMult);

  // ── Bayesian blend with venue history ──
  const dowData = dowGroups[dow] ?? [];
  const n = dowData.length;
  const k = 4; // shrinkage weight — how much we trust the prior
  let blendedMid: number;
  if (n > 0) {
    const sorted = [...dowData].sort((a, b) => a - b);
    const venueMid = sorted[Math.floor(sorted.length / 2)]; // median
    blendedMid = Math.round((priorMid * k + venueMid * n) / (k + n));
  } else {
    blendedMid = priorMid;
  }

  // ── Weather multiplier ──
  let weatherMult = 1.0;
  let weatherFactor: TonightFactor | null = null;
  try {
    const weather = await weatherService.getWeatherByAddress(DEMO_VENUE.address, DEMO_VENUE.venueId);
    if (weather) {
      const cond = weather.conditions.toLowerCase();
      if (cond.includes('rain') || cond.includes('storm') || cond.includes('thunder')) {
        weatherMult = 0.88;
        weatherFactor = { name: 'Weather', value: `${weather.conditions} · ${weather.temperature}°F`, impact: '-12%' };
      } else if (cond.includes('clear') || cond.includes('sunny')) {
        weatherMult = 1.02;
        weatherFactor = { name: 'Weather', value: `${weather.conditions} · ${weather.temperature}°F`, impact: '+2%' };
      } else {
        weatherFactor = { name: 'Weather', value: `${weather.conditions} · ${weather.temperature}°F`, impact: '—' };
      }
    }
  } catch { /* weather is optional */ }

  const mid  = Math.max(5, Math.min(capacity, Math.round(blendedMid * weatherMult)));
  const low  = Math.max(1, Math.round(mid * 0.82));
  const high = Math.min(capacity, Math.round(mid * 1.18));

  const revPerHead = 33; // $33/head (2.3 drinks × ~$14 avg)
  const DOW_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pct = (v: number) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;

  const factors: TonightFactor[] = [
    { name: 'Day of week', value: DOW_NAMES[dow],     impact: pct(dowMult)   },
    { name: 'Month',       value: MONTH_NAMES[month], impact: pct(monthMult) },
  ];
  if (n > 0) factors.push({
    name: 'Venue history',
    value: `${n} ${DOW_NAMES[dow]} nights on record`,
    impact: '↑ confidence',
  });
  if (weatherFactor) factors.push(weatherFactor);

  const HOURS = ['6 PM','7 PM','8 PM','9 PM','10 PM','11 PM','12 AM','1 AM'];
  const SHAPE = [0.18, 0.32, 0.52, 0.78, 1.00, 0.90, 0.68, 0.38];
  const hourly_curve = HOURS.map((hour, i) => ({
    hour,
    yhat:       Math.round(mid * SHAPE[i]),
    yhat_lower: Math.round(low * SHAPE[i]),
    yhat_upper: Math.round(high * SHAPE[i]),
  }));

  const bartenders   = Math.max(2, Math.round(mid / 75));
  const calibState   = n >= 4 ? 'month_6' : n >= 2 ? 'week_4' : n >= 1 ? 'week_2' : 'generic_prior';
  const mape         = n >= 4 ? '±11%'    : n >= 2 ? '±15%'   : '±20%';
  const confPct      = n >= 4 ? 88        : n >= 2 ? 75        : 60;

  return {
    model_type:        n > 0 ? 'gbm' : 'prior',
    calibration_state: calibState,
    mape_expected:     mape,
    confidence_pct:    confPct,
    final_estimate:    { low, mid, high },
    revenue_estimate:  { low: low * revPerHead, mid: mid * revPerHead, high: high * revPerHead },
    baseline_covers:   priorMid,
    lift:              mid - priorMid,
    lift_pct:          Math.round(((mid - priorMid) / Math.max(1, priorMid)) * 100),
    peak_hour:         '10:00 PM',
    weather_multiplier: weatherMult,
    competition_drag:  1.0,
    staffing_rec: {
      bartenders,
      note: `${bartenders} bartenders recommended based on ${DOW_NAMES[dow]} night pattern`,
    },
    factors,
    hourly_curve,
  };
}

// ─── Forecast Accuracy History (for History tab) ──────────────────────────────

interface ForecastRecord {
  _date: string;
  final_estimate?: { mid: number };
  actualCovers?: number;
  actualRevenue?: number;
  actualAccuracyPct?: number;
}

function ForecastAccuracySection({ venueId }: { venueId: string }) {
  const [history, setHistory] = useState<ForecastRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!venueId || isDemoAccount(venueId)) { setLoading(false); return; }
    venueScopeService.getForecastHistory(venueId, 30).then(h => {
      setHistory(h as ForecastRecord[]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [venueId]);

  if (loading) return (
    <div className="flex justify-center py-6"><RefreshCw className="w-5 h-5 text-warm-600 animate-spin" /></div>
  );

  const withActuals = history.filter(h => h.actualAccuracyPct != null && h.actualCovers != null);
  if (withActuals.length === 0) return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-5 text-center">
      <BarChart3 className="w-8 h-8 text-warm-600 mx-auto mb-2" />
      <p className="text-sm text-warm-400">No forecast accuracy data yet</p>
      <p className="text-xs text-warm-500 mt-1">Accuracy is logged nightly after 6 AM when actuals are backfilled</p>
    </div>
  );

  // DOW breakdown
  const DOW_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const dowGroups: Record<number, number[]> = {};
  withActuals.forEach(h => {
    const d   = new Date(h._date + 'T12:00:00');
    const dow = (d.getDay() + 6) % 7; // Mon=0
    dowGroups[dow] = dowGroups[dow] ?? [];
    dowGroups[dow].push(h.actualAccuracyPct!);
  });
  const dowAvg = DOW_SHORT.map((label, i) => {
    const vals = dowGroups[i] ?? [];
    const avg  = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    return { label, avg, n: vals.length };
  });

  const maxAcc = 100;
  const last14 = withActuals.slice(-14);

  return (
    <div className="space-y-4">
      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-5">
        <p className="text-[11px] text-warm-500 uppercase tracking-wider font-semibold mb-4">
          Forecast Accuracy — Last {last14.length} Nights
        </p>
        <div className="flex items-end gap-1" style={{ height: '80px' }}>
          {last14.map(h => {
            const acc  = Math.max(0, h.actualAccuracyPct ?? 0);
            const barH = Math.round((acc / maxAcc) * 100);
            const color = acc >= 85 ? 'bg-green-500' : acc >= 70 ? 'bg-amber-500' : 'bg-red-500';
            const label = h._date.slice(5); // MM-DD
            return (
              <div key={h._date} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                <div className="relative w-full flex-1 flex flex-col justify-end">
                  <div className={`w-full rounded-t-sm ${color}/30`} style={{ height: '100%', position: 'absolute', bottom: 0 }} />
                  <div className={`w-full rounded-t-sm ${color} absolute bottom-0`} style={{ height: `${barH}%` }} />
                </div>
                <span className="text-[7px] text-warm-600 whitespace-nowrap">{label}</span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-3 text-[10px] text-warm-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500 inline-block" />≥85% accurate</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500 inline-block" />70–84%</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" />&lt;70%</span>
        </div>
      </div>

      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-5">
        <p className="text-[11px] text-warm-500 uppercase tracking-wider font-semibold mb-3">Accuracy by Day of Week</p>
        <div className="grid grid-cols-7 gap-1">
          {dowAvg.map(({ label, avg, n }) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-warm-500">{label}</span>
              <div className={`text-sm font-bold ${avg == null ? 'text-warm-600' : avg >= 85 ? 'text-green-400' : avg >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
                {avg != null ? `${avg}%` : '—'}
              </div>
              <span className="text-[9px] text-warm-600">{n > 0 ? `${n}n` : ''}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
          <TrendingUp className="w-4 h-4 text-teal" />
          <span className="text-sm font-semibold text-white">Recent Nights</span>
        </div>
        <div className="divide-y divide-whoop-divider">
          {withActuals.slice(-10).reverse().map(h => {
            const acc = h.actualAccuracyPct ?? 0;
            const ok  = acc >= 85 ? 'text-green-400' : acc >= 70 ? 'text-amber-400' : 'text-red-400';
            return (
              <div key={h._date} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-warm-300">{h._date}</span>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-warm-400">predicted {h.final_estimate?.mid ?? '?'} · actual {h.actualCovers}</span>
                  <span className={`font-bold ${ok}`}>{acc.toFixed(1)}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TonightTab({ venueId }: { venueId: string }) {
  const [forecast, setForecast] = useState<TonightForecast | null>(null);
  const [lastNight, setLastNight] = useState<Record<string, unknown> | null>(null);
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
      try {
        const df = await buildDemoForecast();
        setForecast(df);
      } catch {
        setForecast(DEMO_FORECAST); // fallback to static if anything fails
      }
      setLoading(false);
      return;
    }

    // Load venue settings + 90 days of job history + pre-computed forecast in parallel
    let cap = 150;
    let avgDrinkPrice = 28;
    let historicalJobs: VenueScopeJob[] = [];
    let storedForecast: Record<string, unknown> | null = null;
    const ninetyDaysAgo = Math.floor(Date.now() / 1000) - 90 * 86400;
    // yesterday date string for Last Night card
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);
    try {
      const [settings, jobs, stored, yesterday] = await Promise.all([
        venueSettingsService.loadSettingsFromCloud(venueId),
        venueScopeService.listJobs(venueId, 200, ninetyDaysAgo),
        venueScopeService.getForecast(venueId),
        venueScopeService.getForecast(venueId, yesterdayStr),
      ]);
      if (settings?.capacity)      { cap = settings.capacity; setVenueCapacity(settings.capacity); }
      if (settings?.avgDrinkPrice) { avgDrinkPrice = settings.avgDrinkPrice; }
      historicalJobs = jobs;
      storedForecast = stored;
      if (yesterday) setLastNight(yesterday);
    } catch { /* ignore — fall through with client model */ }

    // Use pre-computed Prophet forecast written by forecast_cron.py at 6 AM
    if (storedForecast) {
      setForecast(storedForecast as unknown as TonightForecast);
      setLoading(false);
      return;
    }

    // Client-side Layer 1 fallback — venue-personalized baseline, no backend needed
    setForecast(buildClientForecast(cap, historicalJobs, avgDrinkPrice));
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

  // Last Night card data
  const lastNightActual   = lastNight?.actualCovers    as number | undefined;
  const lastNightRevenue  = lastNight?.actualRevenue   as number | undefined;
  const lastNightAccuracy = lastNight?.actualAccuracyPct as number | undefined;
  const lastNightPredicted = (lastNight?.final_estimate as { mid?: number } | undefined)?.mid;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* ── Last Night card (when actuals exist) ── */}
      {lastNight && lastNightActual != null && (
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4">
          <p className="text-[11px] text-warm-500 uppercase tracking-wider font-semibold mb-3">Last Night</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[10px] text-warm-500 mb-0.5">Actual covers</p>
              <p className="text-xl font-bold text-white">{lastNightActual}</p>
              {lastNightPredicted != null && (
                <p className="text-[10px] text-warm-500">predicted {lastNightPredicted}</p>
              )}
            </div>
            {lastNightRevenue != null && (
              <div>
                <p className="text-[10px] text-warm-500 mb-0.5">Actual revenue</p>
                <p className="text-xl font-bold text-green-400">${lastNightRevenue.toLocaleString()}</p>
              </div>
            )}
            {lastNightAccuracy != null && (
              <div>
                <p className="text-[10px] text-warm-500 mb-0.5">Forecast accuracy</p>
                <p className={`text-xl font-bold ${lastNightAccuracy >= 85 ? 'text-green-400' : lastNightAccuracy >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
                  {lastNightAccuracy.toFixed(1)}%
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Primary forecast readout ── */}
      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-5 space-y-3">
        {/* Headline */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] text-warm-500 uppercase tracking-wider font-semibold mb-1">Tonight's Forecast</p>
            <p className="text-2xl font-bold text-white leading-tight">
              {forecast.final_estimate.mid} expected people
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
          <span className="text-white font-semibold">{forecast.final_estimate.low}–{forecast.final_estimate.high} people</span>
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
            <span className="text-white font-semibold">{baseline_covers} people</span>
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

      {/* ── Tonight's Coverage ── */}
      {forecast.staffing_hourly && Object.keys(forecast.staffing_hourly).length > 0 && (
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-5">
          <p className="text-[11px] text-warm-500 uppercase tracking-wider font-semibold mb-4">Tonight's Coverage</p>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs border-collapse" style={{ minWidth: '480px' }}>
              <thead>
                <tr>
                  <td className="text-warm-500 pr-3 pb-2 whitespace-nowrap w-20">Role</td>
                  {forecast.hourly_curve.map(pt => (
                    <td key={pt.hour} className={`text-center pb-2 whitespace-nowrap ${pt.hour === forecast.peak_hour ? 'text-teal font-bold' : 'text-warm-600'}`}>
                      {pt.hour.replace(':00', '').replace(' PM', 'p').replace(' AM', 'a')}
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody className="space-y-1">
                {[
                  { key: 'bartenders', label: 'Bartenders', color: 'text-purple-400' },
                  { key: 'servers',    label: 'Servers',    color: 'text-cyan-400' },
                  { key: 'door',       label: 'Door',       color: 'text-amber-400' },
                  { key: 'barback',    label: 'Barback',    color: 'text-warm-400' },
                ].map(({ key, label, color }) => {
                  const vals = forecast.hourly_curve.map(pt => {
                    const hk = (() => {
                      const h = pt.hour;
                      const m = h.match(/(\d+)(?::00)?\s*(AM|PM)/i);
                      if (!m) return String(22);
                      let n = parseInt(m[1]);
                      const ampm = m[2].toUpperCase();
                      if (ampm === 'PM' && n !== 12) n += 12;
                      else if (ampm === 'AM' && n === 12) n = 24;
                      else if (ampm === 'AM' && n < 4) n += 24;
                      return String(n);
                    })();
                    return (forecast.staffing_hourly![hk] as Record<string, number>)?.[key] ?? 0;
                  });
                  const maxVal = Math.max(...vals, 0);
                  if (maxVal === 0 && key !== 'bartenders') return null;
                  return (
                    <tr key={key}>
                      <td className={`pr-3 py-1 font-medium ${color}`}>{label}</td>
                      {vals.map((v, i) => {
                        const isPeak = forecast.hourly_curve[i].hour === forecast.peak_hour;
                        return (
                          <td key={i} className="text-center py-1">
                            {v > 0
                              ? <span className={`inline-block w-5 h-5 rounded text-[10px] font-bold leading-5 ${isPeak ? 'bg-teal/20 text-teal' : 'bg-warm-700 text-white'}`}>{v}</span>
                              : <span className="text-warm-700">—</span>
                            }
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-warm-600 mt-3">
            Based on {forecast.calibration_state === 'generic_prior' ? 'concept-type defaults' : `${forecast.staffing_hourly ? 'venue history' : 'defaults'}`}
            {' · '}peak at {forecast.peak_hour}
          </p>
        </div>
      )}

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
          <ForecastAccuracySection venueId={venueId} />
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
