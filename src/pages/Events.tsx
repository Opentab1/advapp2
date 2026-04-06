import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar, Sparkles, Rocket, BarChart3, Zap, ChevronRight, ChevronDown,
  Plus, X, Check, TrendingUp, TrendingDown, Minus, Target, Clock,
  Users, DollarSign, Tv, AlertTriangle, ExternalLink, RefreshCw,
  Trophy, Flame, ThumbsDown, Activity, Search, CloudRain, MapPin,
  MessageCircle, Wine, BadgeDollarSign, Lightbulb,
} from 'lucide-react';
import { generateCalendarEvents, type CalendarEventIdea } from '../services/events.service';
import { EventROITracker } from '../components/events/EventROITracker';
import authService from '../services/auth.service';
import sportsService from '../services/sports.service';
import venueSettingsService from '../services/venue-settings.service';
import type { SportsGame } from '../types';

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

interface ValidationReport {
  concept_type: string;
  city: string;
  event_date: string;
  event_dow: string;
  validation_score: number;
  verdict: 'green' | 'yellow' | 'red';
  verdict_text: string;
  notes: string[];
  google_trends: { score: number; trend: string; keywords: string[]; error?: string };
  weather: { risk: string; temp_high_f?: number; temp_low_f?: number; precip_inches?: number; risk_factors?: string[]; attendance_impact?: string; error?: string };
  reddit: { mentions: number; sentiment: number; sentiment_label: string; top_posts: { title: string; score: number; sentiment: number }[]; error?: string };
  best_nights: string[];
  recommended_drinks: string[];
  pricing_guidance: { cover_range: [number, number]; vip_table_min: [number, number] | null };
  revenue_estimate: { attendance_range: [number, number]; gross_revenue_range: [number, number]; net_revenue_range: [number, number]; setup_cost_range: [number, number]; setup_cost_items: string[]; vip_table_min: [number, number] | null };
  setup_guide: { cost_range: [number, number]; line_items: string[] };
  pull_duration_sec: number;
}

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

interface ConceptStat {
  concept_type: string;
  run_count: number;
  avg_health_score?: number;
  verdict: 'keep' | 'optimize' | 'kill' | 'pending';
  avg_peak_occupancy?: number;
  avg_drink_velocity?: number;
}

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

type EventsTab = 'validate' | 'launch' | 'live' | 'history' | 'optimizer';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getServerUrl() {
  return (import.meta.env.VITE_VENUESCOPE_URL || '').replace(':8501', ':8502').replace(/\/$/, '');
}

function demandColor(verdict?: string) {
  if (verdict === 'green')  return 'text-green-400';
  if (verdict === 'yellow') return 'text-amber-400';
  if (verdict === 'red')    return 'text-red-400';
  return 'text-warm-500';
}

function demandBg(verdict?: string) {
  if (verdict === 'green')  return 'bg-green-500/10 border-green-500/30';
  if (verdict === 'yellow') return 'bg-amber-500/10 border-amber-500/30';
  if (verdict === 'red')    return 'bg-red-500/10 border-red-500/30';
  return 'bg-warm-700 border-warm-600';
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

// ─── Demand Score Widget ──────────────────────────────────────────────────────

function DemandScoreRing({ score, verdict }: { score: number; verdict?: string }) {
  const r = 28; const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = verdict === 'green' ? '#22c55e' : verdict === 'yellow' ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative w-20 h-20 flex items-center justify-center flex-shrink-0">
      <svg className="w-20 h-20 -rotate-90" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#1e293b" strokeWidth="6" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold text-white leading-none">{score}</span>
        <span className="text-[9px] text-warm-500">/ 100</span>
      </div>
    </div>
  );
}

// ─── Pre-Launch Signals Panel ─────────────────────────────────────────────────

function PreLaunchPanel({ event, onUpdate }: { event: VenueEvent; onUpdate: (updated: VenueEvent) => void }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [signals, setSignals] = useState({
    meta_concept_a: event.meta_concept_a || '',
    meta_concept_b: event.meta_concept_b || '',
    meta_cpc_a: event.meta_cpc_a?.toString() || '',
    meta_cpc_b: event.meta_cpc_b?.toString() || '',
    tiktok_save_rate: event.tiktok_save_rate?.toString() || '',
    ig_dm_count: event.ig_dm_count?.toString() || '',
    ig_poll_pct: event.ig_poll_pct?.toString() || '',
    google_trends_score: event.google_trends_score?.toString() || '',
    eventbrite_pct: event.eventbrite_pct?.toString() || '',
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (signals.meta_cpc_a)       body.meta_cpc_a = parseFloat(signals.meta_cpc_a);
      if (signals.meta_cpc_b)       body.meta_cpc_b = parseFloat(signals.meta_cpc_b);
      if (signals.meta_concept_a)   body.meta_concept_a = signals.meta_concept_a;
      if (signals.meta_concept_b)   body.meta_concept_b = signals.meta_concept_b;
      if (signals.tiktok_save_rate) body.tiktok_save_rate = parseFloat(signals.tiktok_save_rate);
      if (signals.ig_dm_count)      body.ig_dm_count = parseInt(signals.ig_dm_count);
      if (signals.ig_poll_pct)      body.ig_poll_pct = parseFloat(signals.ig_poll_pct);
      if (signals.google_trends_score) body.google_trends_score = parseInt(signals.google_trends_score);
      if (signals.eventbrite_pct)   body.eventbrite_pct = parseFloat(signals.eventbrite_pct);

      const r = await fetch(`${getServerUrl()}/api/events/${event.event_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      onUpdate({ ...event, ...body, demand_score: data.demand_score, demand_verdict: data.demand_verdict });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const steps = [
    {
      icon: '📱',
      title: 'Meta A/B Test',
      desc: 'Run two $50 ad sets — same audience, two different concepts. Which gets cheaper clicks?',
      action: 'Open Meta Ads Manager →',
      actionUrl: 'https://adsmanager.facebook.com',
      inputs: [
        { label: 'Concept A name', key: 'meta_concept_a', placeholder: 'e.g. DJ Night' },
        { label: 'Concept B name', key: 'meta_concept_b', placeholder: 'e.g. Trivia Night' },
        { label: 'Concept A cost/click ($)', key: 'meta_cpc_a', placeholder: '0.85', type: 'number' },
        { label: 'Concept B cost/click ($)', key: 'meta_cpc_b', placeholder: '1.20', type: 'number' },
      ],
      scoring: 'Lower CPC = stronger demand. If A < B, go with A.',
      complete: !!(signals.meta_cpc_a && signals.meta_cpc_b),
    },
    {
      icon: '🎵',
      title: 'TikTok Save Rate',
      desc: 'Post a 15s teaser for your concept. Saves/views % is the strongest organic demand signal.',
      action: 'Open TikTok Studio →',
      actionUrl: 'https://www.tiktok.com/creator-center',
      inputs: [
        { label: 'Saves ÷ Views (%)', key: 'tiktok_save_rate', placeholder: '1.2', type: 'number' },
      ],
      scoring: '>1% = strong · 0.5–1% = moderate · <0.5% = weak',
      complete: !!signals.tiktok_save_rate,
    },
    {
      icon: '📸',
      title: 'Instagram Signals',
      desc: 'Post a story poll "Would you show up to [concept]?" and count DMs you get unprompted.',
      inputs: [
        { label: 'Unprompted DMs received', key: 'ig_dm_count', placeholder: '7', type: 'number' },
        { label: '% voted Yes on story poll', key: 'ig_poll_pct', placeholder: '72', type: 'number' },
      ],
      scoring: '>10 DMs = green light · >60% poll = strong interest',
      complete: !!(signals.ig_dm_count || signals.ig_poll_pct),
    },
    {
      icon: '📈',
      title: 'Google Trends',
      desc: `Search "${event.concept_type}" in Google Trends filtered to your city. Enter the interest score (0–100).`,
      action: 'Open Google Trends →',
      actionUrl: `https://trends.google.com/trends/explore?q=${encodeURIComponent(event.concept_type)}`,
      inputs: [
        { label: 'Trends interest score (0–100)', key: 'google_trends_score', placeholder: '65', type: 'number' },
      ],
      scoring: '>60 = growing demand in your market',
      complete: !!signals.google_trends_score,
    },
    {
      icon: '🎟️',
      title: 'Eventbrite Velocity',
      desc: 'If ticketed: what % of capacity sold in the first 48 hours after publishing?',
      inputs: [
        { label: '% of capacity sold in 48h', key: 'eventbrite_pct', placeholder: '12', type: 'number' },
      ],
      scoring: '>15% = hit · 5–15% = test night · <5% = reconsider',
      complete: !!signals.eventbrite_pct,
    },
  ];

  const completedSteps = steps.filter(s => s.complete).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-warm-500 uppercase tracking-wider font-semibold">
          Pre-Launch Validator — {completedSteps}/{steps.length} signals
        </p>
        <div className="flex gap-1.5">
          {steps.map((s, i) => (
            <div key={i} className={`w-2 h-2 rounded-full ${s.complete ? 'bg-teal' : 'bg-warm-700'}`} />
          ))}
        </div>
      </div>

      {steps.map((step, i) => (
        <StepCard key={i} step={step} signals={signals}
          onChange={(k, v) => setSignals(prev => ({ ...prev, [k]: v }))} />
      ))}

      <motion.button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-3 bg-teal text-warm-900 font-bold rounded-xl flex items-center justify-center gap-2"
        whileTap={{ scale: 0.97 }}
      >
        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> :
         saved  ? <Check className="w-4 h-4" /> :
                  <Zap className="w-4 h-4" />}
        {saved ? 'Saved!' : 'Calculate Demand Score'}
      </motion.button>
    </div>
  );
}

function StepCard({ step, signals, onChange }: {
  step: { icon: string; title: string; desc: string; action?: string; actionUrl?: string; inputs: { label: string; key: string; placeholder: string; type?: string }[]; scoring: string; complete: boolean };
  signals: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`bg-warm-800/60 rounded-xl border transition-all ${step.complete ? 'border-teal/30' : 'border-warm-700'}`}>
      <button onClick={() => setOpen(!open)} className="w-full p-3 text-left flex items-center gap-3">
        <span className="text-xl">{step.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">{step.title}</span>
            {step.complete && <Check className="w-3.5 h-3.5 text-teal" />}
          </div>
          <p className="text-[10px] text-warm-500 mt-0.5 line-clamp-1">{step.desc}</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-warm-600 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-warm-700">
            <div className="p-3 space-y-3">
              <p className="text-xs text-warm-300">{step.desc}</p>
              {step.actionUrl && (
                <a href={step.actionUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-teal hover:underline">
                  <ExternalLink className="w-3.5 h-3.5" />
                  {step.action}
                </a>
              )}
              <div className="grid grid-cols-2 gap-2">
                {step.inputs.map(inp => (
                  <div key={inp.key}>
                    <label className="text-[10px] text-warm-500 mb-1 block">{inp.label}</label>
                    <input
                      type={inp.type || 'text'}
                      value={signals[inp.key] || ''}
                      onChange={e => onChange(inp.key, e.target.value)}
                      placeholder={inp.placeholder}
                      className="w-full bg-warm-900 border border-warm-700 rounded-lg px-3 py-2 text-sm text-white placeholder-warm-600 focus:outline-none focus:border-teal/50"
                    />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-warm-500 bg-warm-900/60 rounded-lg px-3 py-2">
                💡 {step.scoring}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Create Event Form ────────────────────────────────────────────────────────

function CreateEventForm({ onCreated }: { onCreated: (ev: VenueEvent) => void }) {
  const user = authService.getStoredUser();
  const [form, setForm] = useState({
    name: '', concept_type: CONCEPT_TYPES[0], event_date: '',
    expected_headcount: '', cover_charge: '',
    threshold_headcount: '', threshold_revenue_pct: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!form.name || !form.event_date) { setError('Name and date required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        concept_type: form.concept_type,
        event_date: form.event_date,
        venue: user?.venueName || user?.venueId || '',
        status: 'upcoming',
        notes: form.notes,
      };
      if (form.expected_headcount) body.expected_headcount = parseInt(form.expected_headcount);
      if (form.cover_charge) body.cover_charge = parseFloat(form.cover_charge);
      if (form.threshold_headcount) body.threshold_headcount = parseInt(form.threshold_headcount);
      if (form.threshold_revenue_pct) body.threshold_revenue_pct = parseFloat(form.threshold_revenue_pct);

      const r = await fetch(`${getServerUrl()}/api/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!data.ok) { setError(data.error || 'Failed to create event'); return; }
      onCreated({ ...body, event_id: data.event_id, status: 'upcoming', created_at: Date.now() / 1000 } as VenueEvent);
    } catch (e) { setError('Could not connect to VenueScope server'); }
    setSaving(false);
  };

  return (
    <div className="bg-warm-800/60 rounded-xl border border-warm-700 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Rocket className="w-4 h-4 text-teal" />
        <h3 className="text-sm font-semibold text-white">Launch a New Event</h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-[10px] text-warm-500 mb-1 block uppercase tracking-wide">Event Name</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Saturday Night DJ" className="w-full bg-warm-900 border border-warm-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-warm-600 focus:outline-none focus:border-teal/50" />
        </div>

        <div>
          <label className="text-[10px] text-warm-500 mb-1 block uppercase tracking-wide">Concept Type</label>
          <select value={form.concept_type} onChange={e => setForm(f => ({ ...f, concept_type: e.target.value }))}
            className="w-full bg-warm-900 border border-warm-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal/50">
            {CONCEPT_TYPES.map(ct => <option key={ct} value={ct}>{CONCEPT_EMOJIS[ct]} {ct}</option>)}
          </select>
        </div>

        <div>
          <label className="text-[10px] text-warm-500 mb-1 block uppercase tracking-wide">Date</label>
          <input type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))}
            className="w-full bg-warm-900 border border-warm-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal/50" />
        </div>

        <div>
          <label className="text-[10px] text-warm-500 mb-1 block uppercase tracking-wide">Expected Headcount</label>
          <input type="number" value={form.expected_headcount} onChange={e => setForm(f => ({ ...f, expected_headcount: e.target.value }))}
            placeholder="150" className="w-full bg-warm-900 border border-warm-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-warm-600 focus:outline-none focus:border-teal/50" />
        </div>

        <div>
          <label className="text-[10px] text-warm-500 mb-1 block uppercase tracking-wide">Cover Charge ($)</label>
          <input type="number" value={form.cover_charge} onChange={e => setForm(f => ({ ...f, cover_charge: e.target.value }))}
            placeholder="10" className="w-full bg-warm-900 border border-warm-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-warm-600 focus:outline-none focus:border-teal/50" />
        </div>
      </div>

      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 space-y-2">
        <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wide flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5" /> Set Success Threshold (lock in before the event)
        </p>
        <p className="text-[10px] text-warm-400">Lock these in now. After the event, VenueScope checks if you hit them — no post-hoc rationalization.</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-warm-500 mb-1 block">Min headcount by 10pm</label>
            <input type="number" value={form.threshold_headcount} onChange={e => setForm(f => ({ ...f, threshold_headcount: e.target.value }))}
              placeholder="80" className="w-full bg-warm-900 border border-warm-700 rounded-lg px-3 py-2 text-sm text-white placeholder-warm-600 focus:outline-none focus:border-teal/50" />
          </div>
          <div>
            <label className="text-[10px] text-warm-500 mb-1 block">% above baseline revenue</label>
            <input type="number" value={form.threshold_revenue_pct} onChange={e => setForm(f => ({ ...f, threshold_revenue_pct: e.target.value }))}
              placeholder="25" className="w-full bg-warm-900 border border-warm-700 rounded-lg px-3 py-2 text-sm text-white placeholder-warm-600 focus:outline-none focus:border-teal/50" />
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{error}</p>}

      <motion.button onClick={handleSubmit} disabled={saving}
        className="w-full py-3 bg-teal text-warm-900 font-bold rounded-xl flex items-center justify-center gap-2"
        whileTap={{ scale: 0.97 }}>
        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
        {saving ? 'Creating...' : 'Create Event & Validate'}
      </motion.button>
    </div>
  );
}

// ─── Event Card (History) ─────────────────────────────────────────────────────

function EventCard({ event, onUpdate }: { event: VenueEvent; onUpdate: (ev: VenueEvent) => void }) {
  const [expanded, setExpanded] = useState(false);
  const emoji = CONCEPT_EMOJIS[event.concept_type] || '✨';
  const dateLabel = new Date(event.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const isCompleted = event.status === 'completed';
  const isUpcoming = event.status === 'upcoming';

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="bg-warm-800/60 rounded-xl border border-warm-700 hover:border-teal/30 transition-all overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full p-4 text-left">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-warm-700/60 flex items-center justify-center text-xl flex-shrink-0">
            {emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white truncate">{event.name}</h3>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${
                isCompleted ? 'text-warm-400 bg-warm-700 border-warm-600' :
                isUpcoming  ? 'text-teal bg-teal/10 border-teal/30' :
                              'text-amber-400 bg-amber-500/10 border-amber-500/30'
              }`}>{event.status.toUpperCase()}</span>
            </div>
            <p className="text-[10px] text-warm-500 mt-0.5">{event.concept_type} · {dateLabel}</p>
            <div className="flex items-center gap-3 mt-1.5">
              {event.demand_score != null && !isCompleted && (
                <span className={`text-[10px] font-semibold flex items-center gap-1 ${demandColor(event.demand_verdict)}`}>
                  <Zap className="w-3 h-3" />Demand {event.demand_score}
                </span>
              )}
              {event.event_health_score != null && isCompleted && (
                <span className={`text-[10px] font-semibold flex items-center gap-1 ${healthColor(event.event_health_score)}`}>
                  <Activity className="w-3 h-3" />Health {event.event_health_score}
                </span>
              )}
              {event.expected_headcount && (
                <span className="text-[10px] text-warm-500 flex items-center gap-1">
                  <Users className="w-3 h-3" />{event.expected_headcount} expected
                </span>
              )}
            </div>
          </div>
          <ChevronRight className={`w-4 h-4 text-warm-600 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="border-t border-warm-700">
            <div className="p-4 space-y-4">
              {/* Demand Score */}
              {!isCompleted && (
                <div className="flex items-center gap-4">
                  <DemandScoreRing score={event.demand_score || 0} verdict={event.demand_verdict} />
                  <div>
                    <p className="text-xs font-semibold text-white">Demand Score</p>
                    <p className={`text-sm font-bold mt-0.5 ${demandColor(event.demand_verdict)}`}>
                      {event.demand_verdict === 'green' ? '🟢 Green light — book it' :
                       event.demand_verdict === 'yellow' ? '🟡 Test night first' :
                       event.demand_verdict === 'red'    ? '🔴 Concept needs work' :
                       'No signals entered yet'}
                    </p>
                    <p className="text-[10px] text-warm-500 mt-1">
                      Based on {[
                        event.meta_cpc_a && 'Meta A/B',
                        event.tiktok_save_rate && 'TikTok',
                        event.ig_dm_count && 'Instagram',
                        event.google_trends_score && 'Trends',
                        event.eventbrite_pct && 'Eventbrite',
                      ].filter(Boolean).join(' · ') || 'no signals yet'}
                    </p>
                  </div>
                </div>
              )}

              {/* Pre-launch Signals (upcoming events) */}
              {isUpcoming && (
                <PreLaunchPanel event={event} onUpdate={onUpdate} />
              )}

              {/* Scorecard (completed events) */}
              {isCompleted && (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Health Score', value: event.event_health_score != null ? `${event.event_health_score}/100` : '—', color: healthColor(event.event_health_score) },
                    { label: 'Peak Occupancy', value: event.peak_occupancy != null ? `${event.peak_occupancy} people` : '—', color: 'text-white' },
                    { label: 'Avg Drinks/Hr', value: event.avg_drink_velocity != null ? `${event.avg_drink_velocity}/hr` : '—', color: 'text-white' },
                  ].map(m => (
                    <div key={m.label} className="bg-warm-900/60 rounded-lg p-3">
                      <p className="text-[10px] text-warm-500">{m.label}</p>
                      <p className={`text-sm font-bold mt-0.5 ${m.color}`}>{m.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Success threshold check */}
              {isCompleted && event.threshold_headcount && (
                <div className={`rounded-xl border p-3 ${
                  (event.peak_occupancy || 0) >= event.threshold_headcount
                    ? 'bg-green-500/10 border-green-500/30'
                    : 'bg-red-500/10 border-red-500/30'
                }`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-warm-400 mb-1">Threshold Check</p>
                  <p className={`text-sm font-semibold ${(event.peak_occupancy || 0) >= event.threshold_headcount ? 'text-green-400' : 'text-red-400'}`}>
                    {(event.peak_occupancy || 0) >= event.threshold_headcount ? '✅' : '❌'} Headcount goal: {event.threshold_headcount}
                    {event.peak_occupancy != null ? ` (got ${event.peak_occupancy})` : ' (no camera data yet)'}
                  </p>
                </div>
              )}

              {event.notes && (
                <p className="text-xs text-warm-400 bg-warm-900/40 rounded-lg p-3">{event.notes}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Concept Optimizer ────────────────────────────────────────────────────────

function ConceptOptimizer({ concepts, events }: { concepts: ConceptStat[]; events: VenueEvent[] }) {
  const [compareA, setCompareA] = useState<string>('');
  const [compareB, setCompareB] = useState<string>('');

  const completedConcepts = concepts.filter(c => c.run_count > 0);

  const eventsForConcept = (ct: string) =>
    events.filter(e => e.concept_type === ct && e.status === 'completed');

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

// ─── Live Health Panel ────────────────────────────────────────────────────────

function LiveEventPanel({ events }: { events: VenueEvent[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const todayEvent = events.find(e => e.event_date === today && e.status !== 'cancelled');

  if (!todayEvent) {
    return (
      <div className="bg-warm-800/40 rounded-xl border border-warm-700 p-6 text-center space-y-2">
        <Flame className="w-8 h-8 text-warm-600 mx-auto" />
        <p className="text-sm font-semibold text-warm-400">No event scheduled for today</p>
        <p className="text-xs text-warm-600">Create an event in the Launch tab to enable live tracking.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-teal/5 border border-teal/30 rounded-2xl p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">{CONCEPT_EMOJIS[todayEvent.concept_type] || '✨'}</span>
          <div>
            <p className="text-base font-bold text-white">{todayEvent.name}</p>
            <p className="text-xs text-warm-400">{todayEvent.concept_type} · Live tonight</p>
          </div>
          <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/20 rounded-full px-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            LIVE
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Expected', value: todayEvent.expected_headcount ? `${todayEvent.expected_headcount} people` : '—', icon: Users },
            { label: 'Cover Charge', value: todayEvent.cover_charge ? `$${todayEvent.cover_charge}` : '—', icon: DollarSign },
          ].map(m => (
            <div key={m.label} className="bg-warm-800/60 rounded-xl p-3 flex items-center gap-2">
              <m.icon className="w-4 h-4 text-warm-500 flex-shrink-0" />
              <div>
                <p className="text-[10px] text-warm-500">{m.label}</p>
                <p className="text-sm font-semibold text-white">{m.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4 space-y-3">
        <p className="text-[11px] text-warm-500 uppercase tracking-wider font-semibold">Live Health Metrics</p>
        <p className="text-xs text-warm-400">
          VenueScope cameras are tracking tonight's event in real time. Check the VenueScope tab for live drink velocity and occupancy data.
        </p>
        <div className="grid grid-cols-1 gap-2">
          {[
            { tip: '📊 Watch drink velocity in VenueScope → Run Analysis for a live session', cta: 'Open VenueScope' },
            { tip: '⚠️ If the room drains fast, act within 15 minutes — run a drink promo or get the host on the floor', cta: null },
            { tip: '📝 After tonight, mark this event Complete and add the health score from the Results page', cta: null },
          ].map((t, i) => (
            <div key={i} className="bg-warm-800/40 rounded-lg px-3 py-2.5">
              <p className="text-xs text-warm-300">{t.tip}</p>
            </div>
          ))}
        </div>
      </div>

      {todayEvent.threshold_headcount && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
          <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wide mb-1">🎯 Tonight's Target</p>
          <p className="text-sm text-white font-semibold">
            {todayEvent.threshold_headcount}+ people by 10pm
            {todayEvent.threshold_revenue_pct && ` · ${todayEvent.threshold_revenue_pct}% above baseline revenue`}
          </p>
          <p className="text-[10px] text-warm-500 mt-1">Set pre-event — don't move the goalposts.</p>
        </div>
      )}
    </div>
  );
}

// ─── Concept Validator (One-Button Engine) ────────────────────────────────────

function ScoreRing({ score, verdict }: { score: number; verdict: string }) {
  const r = 34; const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = verdict === 'green' ? '#22c55e' : verdict === 'yellow' ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative w-24 h-24 flex items-center justify-center flex-shrink-0">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#1e293b" strokeWidth="7" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.8s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-white leading-none">{score}</span>
        <span className="text-[9px] text-warm-500 mt-0.5">/ 100</span>
      </div>
    </div>
  );
}

function DataLayer({ icon: Icon, label, value, sub, color = 'text-white', loading = false }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color?: string; loading?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 bg-warm-800/50 rounded-xl p-3">
      <div className="w-9 h-9 rounded-lg bg-warm-700/60 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-warm-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-warm-500 uppercase tracking-wide">{label}</p>
        {loading ? (
          <div className="h-4 bg-warm-700 rounded animate-pulse w-24 mt-1" />
        ) : (
          <p className={`text-sm font-semibold ${color}`}>{value}</p>
        )}
        {sub && !loading && <p className="text-[10px] text-warm-500 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

function ConceptValidator() {
  const user = authService.getStoredUser();
  const [concept, setConcept] = useState(CONCEPT_TYPES[0]);
  const [city, setCity] = useState('');
  const [date, setDate] = useState('');
  const [capacity, setCapacity] = useState('150');
  const [cover, setCover] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [error, setError] = useState('');
  const [compareMode, setCompareMode] = useState(false);
  const [conceptB, setConceptB] = useState(CONCEPT_TYPES[1]);
  const [reportB, setReportB] = useState<ValidationReport | null>(null);
  const [forecast, setForecast] = useState<AttendanceForecast | null>(null);
  const [forecastB, setForecastB] = useState<AttendanceForecast | null>(null);

  // Try to auto-detect city from venue settings
  useEffect(() => {
    const venueId = user?.venueId || '';
    const addr = venueSettingsService.getAddress(venueId);
    if (addr?.city) setCity(addr.city);
    else venueSettingsService.getAddressFromCloud(venueId).then(a => { if (a?.city) setCity(a.city); }).catch(() => {});
  }, []);

  // Default date to next Friday
  useEffect(() => {
    const d = new Date();
    const daysToFriday = (5 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + daysToFriday);
    setDate(d.toISOString().slice(0, 10));
  }, []);

  const runValidation = async (conceptType: string): Promise<ValidationReport | null> => {
    const url = `${getServerUrl()}/api/events/validate?concept=${encodeURIComponent(conceptType)}&city=${encodeURIComponent(city)}&date=${date}&capacity=${capacity}&cover=${cover || '0'}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };

  const runForecast = async (conceptType: string, weatherRisk: string = 'none'): Promise<AttendanceForecast | null> => {
    const url = `${getServerUrl()}/api/events/forecast?concept=${encodeURIComponent(conceptType)}&city=${encodeURIComponent(city)}&date=${date}&capacity=${capacity}&cover=${cover || '0'}&weather_risk=${weatherRisk}`;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return r.json();
    } catch { return null; }
  };

  const handleValidate = async () => {
    if (!city || !date) { setError('Enter your city and event date'); return; }
    setLoading(true); setError(''); setReport(null); setReportB(null); setForecast(null); setForecastB(null);
    try {
      const [ra, rb] = await Promise.all([
        runValidation(concept),
        compareMode ? runValidation(conceptB) : Promise.resolve(null),
      ]);
      setReport(ra);
      setReportB(rb);

      // Fetch forecasts in parallel using weather risk from validation results
      const weatherA = ra?.weather?.risk || 'none';
      const weatherB = rb?.weather?.risk || 'none';
      const [fa, fb] = await Promise.all([
        runForecast(concept, weatherA),
        compareMode && rb ? runForecast(conceptB, weatherB) : Promise.resolve(null),
      ]);
      setForecast(fa);
      setForecastB(fb);
    } catch (e) {
      setError('Could not connect to VenueScope server — make sure it\'s running');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      {/* Config panel */}
      <div className="bg-warm-800 rounded-xl border border-warm-600 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-teal" />
          <h3 className="text-base font-semibold text-white">Event Concept Validator</h3>
          <span className="ml-auto text-xs text-warm-400">Pulls live data automatically</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="text-xs text-warm-300 mb-1.5 block font-medium uppercase tracking-wide">Concept A</label>
            <select value={concept} onChange={e => setConcept(e.target.value)}
              className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white focus:outline-none focus:border-teal/70">
              {CONCEPT_TYPES.map(ct => <option key={ct} value={ct}>{CONCEPT_EMOJIS[ct]} {ct}</option>)}
            </select>
          </div>

          {compareMode && (
            <div className="col-span-2">
              <label className="text-xs text-warm-300 mb-1.5 block font-medium uppercase tracking-wide">Concept B (A/B Compare)</label>
              <select value={conceptB} onChange={e => setConceptB(e.target.value)}
                className="w-full bg-warm-700 border border-teal/50 rounded-lg px-3 py-3 text-sm text-white focus:outline-none focus:border-teal/70">
                {CONCEPT_TYPES.filter(ct => ct !== concept).map(ct => <option key={ct} value={ct}>{CONCEPT_EMOJIS[ct]} {ct}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs text-warm-300 mb-1.5 block font-medium uppercase tracking-wide">Your City</label>
            <input value={city} onChange={e => setCity(e.target.value)} placeholder="Tampa"
              className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white placeholder-warm-400 focus:outline-none focus:border-teal/70" />
          </div>

          <div>
            <label className="text-xs text-warm-300 mb-1.5 block font-medium uppercase tracking-wide">Event Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white focus:outline-none focus:border-teal/70" />
          </div>

          <div>
            <label className="text-xs text-warm-300 mb-1.5 block font-medium uppercase tracking-wide">Venue Capacity</label>
            <input type="number" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="150"
              className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white placeholder-warm-400 focus:outline-none focus:border-teal/70" />
          </div>

          <div>
            <label className="text-xs text-warm-300 mb-1.5 block font-medium uppercase tracking-wide">Cover Charge ($)</label>
            <input type="number" value={cover} onChange={e => setCover(e.target.value)} placeholder="No cover"
              className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white placeholder-warm-400 focus:outline-none focus:border-teal/70" />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <button onClick={() => setCompareMode(!compareMode)}
            className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-all ${compareMode ? 'border-teal/50 text-teal bg-teal/10' : 'border-warm-500 text-warm-300 hover:text-white hover:border-warm-400'}`}>
            <BarChart3 className="w-3.5 h-3.5" />
            {compareMode ? 'A/B Mode On' : 'A/B Compare'}
          </button>
          {error && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{error}</p>}
        </div>

        <motion.button onClick={handleValidate} disabled={loading}
          className="w-full py-3.5 bg-teal text-warm-900 font-bold rounded-xl flex items-center justify-center gap-2 text-sm"
          whileTap={{ scale: 0.97 }}>
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          {loading ? 'Pulling live data...' : compareMode ? 'Validate Both Concepts' : 'Validate This Concept'}
        </motion.button>

        {loading && (
          <p className="text-[10px] text-warm-500 text-center animate-pulse">
            Checking Google Trends · Weather forecast · Reddit demand signals...
          </p>
        )}
      </div>

      {/* Results */}
      <AnimatePresence>
        {report && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            {/* A/B header if comparing */}
            {compareMode && reportB && (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { r: report, f: forecast, label: 'Concept A', concept: concept },
                  { r: reportB, f: forecastB, label: 'Concept B', concept: conceptB },
                ].map(({ r, f, label, concept: ct }) => (
                  <div key={label} className={`rounded-xl border p-3 text-center ${r.verdict === 'green' ? 'border-green-500/40 bg-green-500/5' : r.verdict === 'yellow' ? 'border-amber-500/40 bg-amber-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
                    <p className="text-[10px] text-warm-500 mb-1">{label}</p>
                    <p className="text-base font-bold text-white">{CONCEPT_EMOJIS[ct]} {ct}</p>
                    <p className={`text-3xl font-bold mt-1 ${r.verdict === 'green' ? 'text-green-400' : r.verdict === 'yellow' ? 'text-amber-400' : 'text-red-400'}`}>{r.validation_score}</p>
                    <p className={`text-[10px] font-semibold mt-1 ${r.verdict === 'green' ? 'text-green-400' : r.verdict === 'yellow' ? 'text-amber-400' : 'text-red-400'}`}>
                      {r.verdict === 'green' ? '✅ Run It' : r.verdict === 'yellow' ? '🟡 Test First' : '🔴 Reconsider'}
                    </p>
                    {f && (
                      <div className="mt-2 pt-2 border-t border-warm-700/50">
                        <p className="text-xs font-bold text-white">{f.mid} people</p>
                        <p className="text-[10px] text-green-400">${f.revenue_mid.toLocaleString()} est.</p>
                        <p className="text-[10px] text-warm-600">{f.fill_rate_pct}% fill</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <ValidationReportCard report={report} forecast={forecast ?? undefined} title={compareMode ? `Concept A: ${concept}` : undefined} />
            {compareMode && reportB && <ValidationReportCard report={reportB} forecast={forecastB ?? undefined} title={`Concept B: ${conceptB}`} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ValidationReportCard({ report, forecast, title }: { report: ValidationReport; forecast?: AttendanceForecast; title?: string }) {
  const [showReddit, setShowReddit] = useState(false);
  const verdictColor = report.verdict === 'green' ? 'text-green-400' : report.verdict === 'yellow' ? 'text-amber-400' : 'text-red-400';
  const verdictBorder = report.verdict === 'green' ? 'border-green-500/30' : report.verdict === 'yellow' ? 'border-amber-500/30' : 'border-red-500/30';
  const verdictBg = report.verdict === 'green' ? 'bg-green-500/5' : report.verdict === 'yellow' ? 'bg-amber-500/5' : 'bg-red-500/5';

  return (
    <div className="space-y-3">
      {title && <p className="text-[10px] text-warm-500 uppercase tracking-wider font-semibold">{title}</p>}

      {/* Verdict hero */}
      <div className={`rounded-2xl border ${verdictBorder} ${verdictBg} p-4`}>
        <div className="flex items-center gap-4">
          <ScoreRing score={report.validation_score} verdict={report.verdict} />
          <div className="flex-1">
            <p className={`text-base font-bold ${verdictColor}`}>{report.verdict_text}</p>
            <p className="text-xs text-warm-400 mt-1">{CONCEPT_EMOJIS[report.concept_type]} {report.concept_type} · {report.event_dow} {report.event_date}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {report.best_nights.map(n => (
                <span key={n} className={`text-[10px] px-2 py-0.5 rounded-full border ${report.event_dow === n ? 'border-teal/50 text-teal bg-teal/10' : 'border-warm-600 text-warm-500'}`}>{n}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* What VenueScope found */}
      <div className="space-y-2">
        <p className="text-[10px] text-warm-500 uppercase tracking-wider font-semibold">What VenueScope Found</p>

        <DataLayer icon={TrendingUp} label="Google Trends"
          value={report.google_trends.error ? 'Unavailable' : `Score ${report.google_trends.score}/100 — ${report.google_trends.trend}`}
          sub={report.google_trends.keywords?.join(', ')}
          color={report.google_trends.score > 50 ? 'text-green-400' : report.google_trends.score > 25 ? 'text-amber-400' : 'text-warm-400'} />

        <DataLayer icon={CloudRain} label="Weather Forecast"
          value={report.weather.error ? 'Unavailable' : `${report.weather.temp_high_f}°F high · ${report.weather.precip_inches}"  precip`}
          sub={report.weather.risk === 'low' ? '✅ Clear conditions — no impact' : report.weather.risk_factors?.join(' · ')}
          color={report.weather.risk === 'low' ? 'text-green-400' : report.weather.risk === 'moderate' ? 'text-amber-400' : 'text-red-400'} />

        <DataLayer icon={MessageCircle} label="Reddit Demand"
          value={report.reddit.error ? 'Not configured' : `${report.reddit.mentions} mentions · ${report.reddit.sentiment_label}`}
          sub={report.reddit.error || (report.reddit.mentions === 0 ? 'Set REDDIT_CLIENT_ID to enable' : `Avg sentiment: ${report.reddit.sentiment}`)}
          color={report.reddit.sentiment > 0.1 ? 'text-green-400' : 'text-warm-400'} />

        {report.reddit.top_posts?.length > 0 && (
          <div>
            <button onClick={() => setShowReddit(!showReddit)} className="text-[10px] text-teal flex items-center gap-1">
              <ChevronDown className={`w-3 h-3 transition-transform ${showReddit ? 'rotate-180' : ''}`} />
              {showReddit ? 'Hide' : 'Show'} top Reddit posts
            </button>
            <AnimatePresence>
              {showReddit && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-2 space-y-1.5">
                  {report.reddit.top_posts.map((p, i) => (
                    <div key={i} className="bg-warm-800/40 rounded-lg px-3 py-2">
                      <p className="text-xs text-warm-300 leading-snug">{p.title}</p>
                      <p className="text-[10px] text-warm-600 mt-0.5">↑{p.score} · sentiment {p.sentiment > 0 ? '+' : ''}{p.sentiment}</p>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Validation notes */}
      {report.notes.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-warm-500 uppercase tracking-wider font-semibold">Signal Breakdown</p>
          {report.notes.map((note, i) => (
            <div key={i} className="bg-warm-800/40 rounded-lg px-3 py-2">
              <p className="text-xs text-warm-300">{note}</p>
            </div>
          ))}
        </div>
      )}

      {/* Attendance Forecast */}
      {forecast && (
        <div className="bg-whoop-panel border border-teal/30 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
            <Users className="w-4 h-4 text-teal" />
            <span className="text-sm font-semibold text-white">Attendance Forecast</span>
            <span className="ml-auto text-[10px] text-warm-500 bg-warm-800 px-2 py-0.5 rounded-full">
              {forecast.model_short}
            </span>
          </div>
          <div className="p-4 space-y-3">
            {/* Attendance bar — normalized so high=85% width, low/mid proportional */}
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
                { label: 'Expected', value: `$${forecast.revenue_mid.toLocaleString()}` },
                { label: 'Best Case', value: `$${forecast.revenue_high.toLocaleString()}` },
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
      )}

      {/* Setup costs — only show revenue rows when no forecast available (forecast has better numbers) */}
      <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
          <BadgeDollarSign className="w-4 h-4 text-teal" />
          <span className="text-sm font-semibold text-white">{forecast ? 'Setup Costs' : 'Revenue Estimate'}</span>
        </div>
        {!forecast && (
          <div className="p-3 grid grid-cols-2 gap-2">
            {[
              { label: 'Expected Attendance', value: `${report.revenue_estimate.attendance_range[0]}–${report.revenue_estimate.attendance_range[1]} people` },
              { label: 'Gross Revenue', value: `$${report.revenue_estimate.gross_revenue_range[0].toLocaleString()}–$${report.revenue_estimate.gross_revenue_range[1].toLocaleString()}` },
              { label: 'Est. Net (after costs)', value: `$${report.revenue_estimate.net_revenue_range[0].toLocaleString()}–$${report.revenue_estimate.net_revenue_range[1].toLocaleString()}` },
              { label: 'Setup Cost Range', value: `$${report.revenue_estimate.setup_cost_range[0]}–$${report.revenue_estimate.setup_cost_range[1]}` },
            ].map(m => (
              <div key={m.label} className="bg-warm-800/40 rounded-lg p-2.5">
                <p className="text-[10px] text-warm-500">{m.label}</p>
                <p className="text-sm font-semibold text-white mt-0.5">{m.value}</p>
              </div>
            ))}
          </div>
        )}
        {forecast && (
          <div className="p-3 grid grid-cols-2 gap-2">
            {[
              { label: 'Setup Cost Range', value: `$${report.revenue_estimate.setup_cost_range[0]}–$${report.revenue_estimate.setup_cost_range[1]}` },
              { label: 'Est. Net Revenue', value: `$${(report.revenue_estimate.net_revenue_range[0]).toLocaleString()}–$${(report.revenue_estimate.net_revenue_range[1]).toLocaleString()}` },
            ].map(m => (
              <div key={m.label} className="bg-warm-800/40 rounded-lg p-2.5">
                <p className="text-[10px] text-warm-500">{m.label}</p>
                <p className="text-sm font-semibold text-white mt-0.5">{m.value}</p>
              </div>
            ))}
          </div>
        )}
        <div className="px-3 pb-3">
          <p className="text-[10px] text-warm-500 mb-1.5">What you'll need to pay for:</p>
          <div className="flex flex-wrap gap-1.5">
            {report.setup_guide.line_items.map(item => (
              <span key={item} className="text-[10px] bg-warm-800 border border-warm-700 rounded-full px-2 py-0.5 text-warm-400">{item}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Drink recommendations */}
      <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
          <Wine className="w-4 h-4 text-teal" />
          <span className="text-sm font-semibold text-white">Recommended Drink Menu</span>
          <span className="text-[10px] text-warm-500 ml-auto">For this concept</span>
        </div>
        <div className="p-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            {report.recommended_drinks.map((d, i) => (
              <span key={i} className={`text-xs px-3 py-1.5 rounded-lg font-medium ${i === 0 ? 'bg-teal/10 border border-teal/30 text-teal' : 'bg-warm-800 border border-warm-700 text-warm-300'}`}>
                {i === 0 && '⭐ '}{d}
              </span>
            ))}
          </div>
          {report.pricing_guidance.cover_range[1] > 0 && (
            <p className="text-xs text-warm-400">
              💡 Cover charge range: ${report.pricing_guidance.cover_range[0]}–${report.pricing_guidance.cover_range[1]}
              {report.pricing_guidance.vip_table_min && ` · VIP table minimum: $${report.pricing_guidance.vip_table_min[0]}–$${report.pricing_guidance.vip_table_min[1]}`}
            </p>
          )}
        </div>
      </div>

      {/* Pricing check */}
      <div className="bg-teal/5 border border-teal/20 rounded-xl p-3 flex items-start gap-2">
        <Lightbulb className="w-4 h-4 text-teal flex-shrink-0 mt-0.5" />
        <p className="text-xs text-warm-300 leading-relaxed">
          <strong className="text-white">Data pulled in {report.pull_duration_sec}s</strong> from Google Trends + Open-Meteo weather.
          Add your own signals (Meta A/B, Instagram polls, TikTok save rate) in the Launch tab for an even higher-confidence score.
        </p>
      </div>
    </div>
  );
}

// ─── Calendar Suggestions (kept from original) ────────────────────────────────

const CITY_TEAM_KEYWORDS: Record<string, string[]> = {
  'Tampa': ['Tampa Bay', 'Buccaneers', 'Lightning', 'Rays'],
  'Baltimore': ['Baltimore', 'Ravens', 'Orioles'],
  'New York': ['New York', 'Yankees', 'Mets', 'Giants', 'Jets', 'Knicks', 'Nets', 'Rangers'],
  'Miami': ['Miami', 'Dolphins', 'Heat', 'Marlins', 'Inter Miami'],
  'Chicago': ['Chicago', 'Bears', 'Bulls', 'Cubs', 'White Sox', 'Blackhawks'],
  'Los Angeles': ['Los Angeles', 'Lakers', 'Clippers', 'Dodgers', 'Rams', 'Chargers'],
  'Houston': ['Houston', 'Texans', 'Rockets', 'Astros'],
};

function isLocalTeamGame(game: SportsGame, city: string): boolean {
  if (!city) return false;
  const keywords = CITY_TEAM_KEYWORDS[city] || [city];
  const gameStr = `${game.homeTeam} ${game.awayTeam}`.toLowerCase();
  return keywords.some(k => gameStr.includes(k.toLowerCase()));
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Events() {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';

  const [activeTab, setActiveTab] = useState<EventsTab>('validate');
  const [events, setEvents] = useState<VenueEvent[]>([]);
  const [concepts, setConcepts] = useState<ConceptStat[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [createdEvent, setCreatedEvent] = useState<VenueEvent | null>(null);

  // Calendar suggestions state
  const [calEvents, setCalEvents] = useState<CalendarEventIdea[]>([]);
  const [weekGames, setWeekGames] = useState<SportsGame[]>([]);
  const [venueCity, setVenueCity] = useState('');

  useEffect(() => {
    setCalEvents(generateCalendarEvents(new Date(), 3));
  }, []);

  useEffect(() => {
    const addr = venueSettingsService.getAddress(venueId);
    if (addr?.city) setVenueCity(addr.city);
    venueSettingsService.getAddressFromCloud(venueId).then(a => { if (a?.city) setVenueCity(a.city); }).catch(() => {});
  }, [venueId]);

  useEffect(() => {
    sportsService.getGames().then(games => {
      const now = Date.now(); const week = now + 7 * 86400000;
      setWeekGames(games.filter(g => { const t = new Date(g.startTime).getTime(); return (t > now || g.status === 'live') && t <= week; }));
    }).catch(() => {});
  }, []);

  const loadEvents = async () => {
    setLoadingEvents(true);
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

  const handleEventCreated = (ev: VenueEvent) => {
    setCreatedEvent(ev);
    setEvents(prev => [ev, ...prev]);
  };

  const handleEventUpdate = (updated: VenueEvent) => {
    setEvents(prev => prev.map(e => e.event_id === updated.event_id ? updated : e));
  };

  const upcomingEvents = events.filter(e => e.status === 'upcoming' || e.status === 'live');
  const completedEvents = events.filter(e => e.status === 'completed');
  const today = new Date().toISOString().slice(0, 10);
  const todayHasEvent = events.some(e => e.event_date === today);

  const tabs = [
    { id: 'validate' as const, label: 'Validate', icon: Search },
    { id: 'launch' as const,   label: 'Launch',   icon: Rocket },
    { id: 'live' as const,     label: 'Live',     icon: Flame,    dot: todayHasEvent },
    { id: 'history' as const,  label: 'History',  icon: Clock },
    { id: 'optimizer' as const, label: 'Optimizer', icon: TrendingUp },
  ];

  return (
    <div className="pb-20 space-y-4">
      {/* Header */}
      <div className="pb-2">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-teal" />
          <h1 className="text-2xl font-bold text-white">Events</h1>
          {upcomingEvents.length > 0 && (
            <span className="px-2 py-0.5 bg-teal/10 border border-teal/30 rounded-full text-[10px] font-semibold text-teal">
              {upcomingEvents.length} upcoming
            </span>
          )}
        </div>
        <p className="text-sm text-warm-400">Validate · Launch · Measure · Optimize</p>
      </div>

      {/* Tab Nav */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {tabs.map(tab => (
          <motion.button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap relative flex-shrink-0 ${
              activeTab === tab.id
                ? 'bg-teal/10 border border-teal/50 text-white'
                : 'bg-warm-800 border border-warm-700 text-warm-400 hover:text-white'
            }`}
            whileTap={{ scale: 0.95 }}>
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.dot && <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />}
          </motion.button>
        ))}
      </div>

      {/* Validate Tab */}
      {activeTab === 'validate' && <ConceptValidator />}

      {/* Launch Tab */}
      {activeTab === 'launch' && (
        <div className="space-y-4">
          {createdEvent ? (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-teal/10 border border-teal/30 rounded-xl p-4 flex items-start gap-3">
              <Check className="w-5 h-5 text-teal flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">"{createdEvent.name}" created!</p>
                <p className="text-xs text-warm-400 mt-0.5">Now fill in the pre-launch signals below to get your demand score.</p>
              </div>
              <button onClick={() => setCreatedEvent(null)} className="text-warm-600 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ) : (
            <CreateEventForm onCreated={handleEventCreated} />
          )}

          {createdEvent && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <PreLaunchPanel event={createdEvent} onUpdate={updated => {
                setCreatedEvent(updated);
                handleEventUpdate(updated);
              }} />
            </motion.div>
          )}

          {/* Calendar suggestions teaser */}
          {!createdEvent && (
            <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
                <Calendar className="w-4 h-4 text-teal" />
                <span className="text-sm font-semibold text-white">Upcoming Opportunities</span>
                <span className="text-[10px] text-warm-500 ml-auto">Next 7 days</span>
              </div>
              <div className="p-3 space-y-2">
                {calEvents.filter(e => e.daysUntil <= 7 && e.daysUntil >= 0).slice(0, 3).map((ev, i) => (
                  <div key={ev.id} className="flex items-center gap-3 p-2 bg-warm-800/40 rounded-lg">
                    <span className="text-lg">{ev.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white">{ev.name}</p>
                      <p className="text-[10px] text-warm-500">{ev.dateLabel} · {ev.difficulty}</p>
                    </div>
                    <button onClick={() => {
                      setCreatedEvent(null);
                      // pre-fill the form concept
                    }} className="text-[10px] text-teal border border-teal/30 rounded-lg px-2 py-1">
                      Use idea
                    </button>
                  </div>
                ))}
                {calEvents.filter(e => e.daysUntil <= 7 && e.daysUntil >= 0).length === 0 && (
                  <p className="text-xs text-warm-600 text-center py-3">No major events this week</p>
                )}
              </div>
            </div>
          )}

          {/* Sports this week */}
          {weekGames.length > 0 && (
            <div className="bg-whoop-panel border border-whoop-divider rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Tv className="w-4 h-4 text-teal" />
                <span className="text-sm font-semibold text-white">Big Games This Week</span>
              </div>
              <div className="space-y-2">
                {weekGames.slice(0, 4).map(g => {
                  const isLocal = isLocalTeamGame(g, venueCity);
                  return (
                    <div key={g.id} className={`flex items-center gap-2 rounded-lg p-2 ${isLocal ? 'bg-teal/5 border border-teal/15' : 'bg-warm-800/40'}`}>
                      <div className="flex-1">
                        <p className="text-xs font-medium text-white">{g.homeTeam} vs {g.awayTeam}</p>
                        <p className="text-[10px] text-warm-500">{g.sport} · {new Date(g.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                      </div>
                      {isLocal && <span className="text-[9px] font-bold text-teal bg-teal/10 border border-teal/30 rounded px-1.5 py-0.5">LOCAL</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live Tab */}
      {activeTab === 'live' && <LiveEventPanel events={events} />}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-warm-500">{events.length} total events</p>
            <motion.button onClick={loadEvents} whileTap={{ scale: 0.95 }}
              className="flex items-center gap-1.5 text-xs text-warm-400 hover:text-white">
              <RefreshCw className="w-3.5 h-3.5" />Refresh
            </motion.button>
          </div>

          {loadingEvents ? (
            <div className="text-center py-8"><RefreshCw className="w-5 h-5 text-warm-600 animate-spin mx-auto" /></div>
          ) : events.length === 0 ? (
            <div className="bg-warm-800/40 rounded-xl border border-warm-700 p-8 text-center">
              <Calendar className="w-8 h-8 text-warm-600 mx-auto mb-2" />
              <p className="text-sm text-warm-400 font-semibold">No events yet</p>
              <p className="text-xs text-warm-600 mt-1">Create your first event in the Launch tab.</p>
            </div>
          ) : (
            <>
              {upcomingEvents.length > 0 && (
                <div>
                  <p className="text-[10px] text-warm-500 uppercase tracking-wider font-semibold mb-2">Upcoming</p>
                  <div className="space-y-2">
                    {upcomingEvents.map(ev => <EventCard key={ev.event_id} event={ev} onUpdate={handleEventUpdate} />)}
                  </div>
                </div>
              )}
              {completedEvents.length > 0 && (
                <div>
                  <p className="text-[10px] text-warm-500 uppercase tracking-wider font-semibold mb-2 mt-4">Completed</p>
                  <div className="space-y-2">
                    {completedEvents.map(ev => <EventCard key={ev.event_id} event={ev} onUpdate={handleEventUpdate} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Optimizer Tab */}
      {activeTab === 'optimizer' && (
        <div className="space-y-4">
          <ConceptOptimizer concepts={concepts} events={events} />
          <div className="mt-6">
            <p className="text-[10px] text-warm-500 uppercase tracking-wider font-semibold mb-3">Past Event Performance</p>
            <EventROITracker />
          </div>
        </div>
      )}
    </div>
  );
}
