/**
 * Results — Owner shift intelligence
 *
 * Period toggle → hero numbers → bar staff → theft → night log
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw, AlertTriangle, ShieldCheck, TrendingUp,
  ChevronDown, ChevronUp, User, Video, DollarSign,
} from 'lucide-react';
import authService from '../services/auth.service';
import venueScopeService, { VenueScopeJob } from '../services/venuescope.service';
import venueSettingsService from '../services/venue-settings.service';
import { isDemoAccount, generateDemoVenueScopeJobs } from '../utils/demoData';

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = 'yesterday' | '7days' | '30days' | 'all';

interface StaffStat {
  name: string;
  drinks: number;
  shifts: number;
  perHour: number;
  theftFlags: number;
  shiftDrinks: { date: number; drinks: number; flag: boolean }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(ts: number, opts?: Intl.DateTimeFormatOptions): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString(undefined, opts ?? { month: 'short', day: 'numeric' });
}

function fmtTime(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function cameraName(job: VenueScopeJob): string {
  return job.roomLabel || job.cameraLabel || job.clipLabel?.replace(/^📡\s*/, '').replace(/\s*—\s*🔴\s*LIVE\s*$/i, '').trim() || 'Camera';
}

function periodStart(period: Period): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (period === 'yesterday') { now.setDate(now.getDate() - 1); return now.getTime() / 1000; }
  if (period === '7days')     { now.setDate(now.getDate() - 7); return now.getTime() / 1000; }
  if (period === '30days')    { now.setDate(now.getDate() - 30); return now.getTime() / 1000; }
  return 0;
}

function periodEnd(period: Period): number {
  if (period === 'yesterday') {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() / 1000;
  }
  return Date.now() / 1000;
}

function filterJobs(jobs: VenueScopeJob[], period: Period): VenueScopeJob[] {
  const start = periodStart(period);
  const end   = periodEnd(period);
  return jobs.filter(j => {
    const t = j.createdAt ?? 0;
    return t >= start && (period === 'all' || t < end);
  });
}

function buildStaff(jobs: VenueScopeJob[]): StaffStat[] {
  const map = new Map<string, StaffStat>();

  for (const job of jobs) {
    if (job.bartenderBreakdown) {
      try {
        const bd = JSON.parse(job.bartenderBreakdown) as Record<string, { drinks: number; per_hour?: number }>;
        for (const [name, d] of Object.entries(bd)) {
          if (!name || name === 'unknown') continue;
          if (!map.has(name)) map.set(name, { name, drinks: 0, shifts: 0, perHour: 0, theftFlags: 0, shiftDrinks: [] });
          const s = map.get(name)!;
          s.drinks    += d.drinks ?? 0;
          s.shifts    += 1;
          s.perHour   += d.per_hour ?? 0;
          s.theftFlags += job.hasTheftFlag ? 1 : 0;
          s.shiftDrinks.push({ date: job.createdAt ?? 0, drinks: d.drinks ?? 0, flag: job.hasTheftFlag });
        }
        continue;
      } catch { /* fall through */ }
    }
    // Fallback: topBartender
    if (job.topBartender) {
      const name = job.topBartender;
      if (!map.has(name)) map.set(name, { name, drinks: 0, shifts: 0, perHour: 0, theftFlags: 0, shiftDrinks: [] });
      const s = map.get(name)!;
      s.drinks    += job.totalDrinks ?? 0;
      s.shifts    += 1;
      s.perHour   += job.drinksPerHour ?? 0;
      s.theftFlags += job.hasTheftFlag ? 1 : 0;
      s.shiftDrinks.push({ date: job.createdAt ?? 0, drinks: job.totalDrinks ?? 0, flag: job.hasTheftFlag });
    }
  }

  return Array.from(map.values())
    .map(s => ({ ...s, perHour: s.shifts ? s.perHour / s.shifts : 0 }))
    .sort((a, b) => b.drinks - a.drinks);
}

// ── Period toggle ─────────────────────────────────────────────────────────────

function PeriodToggle({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const opts: { id: Period; label: string }[] = [
    { id: 'yesterday', label: 'Yesterday' },
    { id: '7days',     label: '7 Days' },
    { id: '30days',    label: '30 Days' },
    { id: 'all',       label: 'All Time' },
  ];
  return (
    <div className="flex gap-1 bg-whoop-bg border border-whoop-divider rounded-xl p-1">
      {opts.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            value === o.id
              ? 'bg-teal text-black shadow'
              : 'text-text-muted hover:text-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Hero numbers ──────────────────────────────────────────────────────────────

function HeroNumbers({ jobs, avgDrinkPrice }: { jobs: VenueScopeJob[]; avgDrinkPrice: number }) {
  const totalDrinks  = jobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
  const theftCount   = jobs.filter(j => j.hasTheftFlag).length;
  const totalUnrung  = jobs.reduce((s, j) => s + (j.unrungDrinks ?? 0), 0);
  const recovered    = avgDrinkPrice > 0 ? totalUnrung * avgDrinkPrice : 0;
  const drinkJobs    = jobs.filter(j => j.totalDrinks != null && j.totalDrinks > 0);
  const nights       = new Set(drinkJobs.map(j => fmtDate(j.createdAt ?? 0))).size;
  const avgPerNight  = nights > 0 ? Math.round(totalDrinks / nights) : 0;

  const tiles = [
    { label: 'Drinks Detected', value: totalDrinks > 0 ? totalDrinks.toLocaleString() : '—', color: 'text-teal', sub: nights > 1 ? `${nights} nights` : null },
    { label: 'Revenue Protected', value: recovered > 0 ? `$${recovered.toLocaleString()}` : totalUnrung > 0 ? `${totalUnrung} unrung` : '—', color: recovered > 0 ? 'text-emerald-400' : 'text-amber-400', sub: recovered > 0 ? `${totalUnrung} unrung drinks` : null },
    { label: 'Theft Flags', value: theftCount > 0 ? String(theftCount) : '0', color: theftCount > 0 ? 'text-red-400' : 'text-emerald-400', sub: theftCount === 0 ? 'All clean' : `${theftCount} shift${theftCount !== 1 ? 's' : ''}` },
    { label: 'Avg / Night', value: avgPerNight > 0 ? String(avgPerNight) : '—', color: 'text-white', sub: 'drinks' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map(t => (
        <div key={t.label} className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4 text-center">
          <div className={`text-2xl font-bold tabular-nums ${t.color}`}>{t.value}</div>
          <div className="text-[10px] text-text-muted uppercase tracking-wide mt-1">{t.label}</div>
          {t.sub && <div className="text-[10px] text-text-muted/60 mt-0.5">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Bar Staff leaderboard ─────────────────────────────────────────────────────

function StaffRow({ person, rank, maxDrinks }: { person: StaffStat; rank: number; maxDrinks: number }) {
  const [open, setOpen] = useState(false);
  const pct = maxDrinks > 0 ? (person.drinks / maxDrinks) * 100 : 0;
  const rankIcon = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `#${rank + 1}`;
  const riskColor = person.theftFlags === 0 ? 'text-emerald-400' : person.theftFlags === 1 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="border-b border-whoop-divider last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-whoop-bg/50 transition-colors text-left"
      >
        <span className="text-base w-7 text-center flex-shrink-0">{rankIcon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-white truncate">{person.name}</span>
            {person.theftFlags > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/25 text-red-400 flex-shrink-0">
                {person.theftFlags} flag{person.theftFlags !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="h-1.5 bg-whoop-divider rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${rank === 0 ? 'bg-amber-400' : rank === 1 ? 'bg-slate-400' : 'bg-teal/70'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-sm font-bold text-white tabular-nums">{person.drinks.toLocaleString()}</div>
          <div className="text-[9px] text-text-muted">{person.perHour.toFixed(1)}/hr</div>
        </div>
        <div className={`flex-shrink-0 text-xs font-semibold w-12 text-right ${riskColor}`}>
          {person.theftFlags === 0 ? '✓ Clean' : `⚠ Risk`}
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-text-muted flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 grid grid-cols-3 gap-2 bg-whoop-bg/30">
              <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
                <div className="text-base font-bold text-white">{person.shifts}</div>
                <div className="text-[9px] text-text-muted uppercase tracking-wide">Shifts</div>
              </div>
              <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
                <div className="text-base font-bold text-white">{person.shifts > 0 ? Math.round(person.drinks / person.shifts) : '—'}</div>
                <div className="text-[9px] text-text-muted uppercase tracking-wide">Avg / Shift</div>
              </div>
              <div className={`bg-whoop-bg rounded-xl p-2.5 text-center`}>
                <div className={`text-base font-bold ${person.theftFlags > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{person.theftFlags}</div>
                <div className="text-[9px] text-text-muted uppercase tracking-wide">Flags</div>
              </div>
              {/* Per-shift mini log */}
              <div className="col-span-3 space-y-1 pt-1">
                {person.shiftDrinks.sort((a, b) => b.date - a.date).slice(0, 6).map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className="text-text-muted">{fmtDate(s.date)} · {fmtTime(s.date)}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-semibold tabular-nums">{s.drinks} drinks</span>
                      {s.flag
                        ? <span className="text-red-400">⚠</span>
                        : <span className="text-emerald-400">✓</span>
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StaffSection({ jobs }: { jobs: VenueScopeJob[] }) {
  const staff = useMemo(() => buildStaff(jobs), [jobs]);
  if (staff.length === 0) return null;
  const maxDrinks = staff[0]?.drinks ?? 1;

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
        <User className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-white">Bar Staff</span>
        <span className="ml-auto text-[10px] text-text-muted">{staff.length} staff · tap to expand</span>
      </div>
      <div>
        {staff.map((p, i) => (
          <StaffRow key={p.name} person={p} rank={i} maxDrinks={maxDrinks} />
        ))}
      </div>
    </div>
  );
}

// ── Theft Incidents ───────────────────────────────────────────────────────────

function TheftSection({ jobs }: { jobs: VenueScopeJob[] }) {
  const flagged = useMemo(
    () => jobs.filter(j => j.hasTheftFlag).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    [jobs]
  );

  const allClear = flagged.length === 0;

  return (
    <div className={`border rounded-2xl overflow-hidden ${allClear ? 'bg-whoop-panel border-whoop-divider' : 'bg-red-950/30 border-red-500/30'}`}>
      <div className={`flex items-center gap-2 px-4 py-3 border-b ${allClear ? 'border-whoop-divider' : 'border-red-500/20'}`}>
        {allClear
          ? <ShieldCheck className="w-4 h-4 text-emerald-400" />
          : <AlertTriangle className="w-4 h-4 text-red-400" />
        }
        <span className={`text-sm font-semibold ${allClear ? 'text-white' : 'text-red-400'}`}>
          {allClear ? 'No Theft Flags' : 'Theft Incidents'}
        </span>
        {!allClear && (
          <span className="ml-auto text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5">
            {flagged.length} flag{flagged.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {allClear ? (
        <div className="px-4 py-5 text-center">
          <p className="text-emerald-400 text-xs">All shifts clean for this period</p>
        </div>
      ) : (
        <div className="divide-y divide-red-500/10">
          {flagged.map(job => (
            <div key={job.jobId} className="px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white">{cameraName(job)}</span>
                  {job.unrungDrinks != null && job.unrungDrinks > 0 && (
                    <span className="text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded px-1.5 py-0.5">
                      {job.unrungDrinks} unrung
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-text-muted mt-0.5">
                  {fmtDate(job.createdAt ?? 0, { month: 'short', day: 'numeric', year: 'numeric' })} · {fmtTime(job.createdAt ?? 0)}
                </p>
                <p className="text-[10px] text-text-muted/70 mt-1">
                  Pull <span className="text-white">{cameraName(job)}</span> on your NVR at <span className="text-white">{fmtTime(job.createdAt ?? 0)}</span>
                </p>
              </div>
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Night Log ─────────────────────────────────────────────────────────────────

function NightLog({ jobs }: { jobs: VenueScopeJob[] }) {
  const [expanded, setExpanded] = useState(false);

  // Dedupe: one row per job, sorted newest first
  const sorted = useMemo(
    () => [...jobs]
      .filter(j => (j.totalDrinks ?? 0) > 0 || j.hasTheftFlag || (j.totalEntries ?? 0) > 0)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    [jobs]
  );

  if (sorted.length === 0) return null;

  const visible = expanded ? sorted : sorted.slice(0, 8);

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
        <Video className="w-4 h-4 text-teal" />
        <span className="text-sm font-semibold text-white">Night Log</span>
        <span className="ml-auto text-[10px] text-text-muted">{sorted.length} sessions</span>
      </div>

      {/* Column headers */}
      <div className="grid gap-2 px-4 py-2 border-b border-whoop-divider/40 text-[9px] text-text-muted uppercase tracking-wider font-semibold"
        style={{ gridTemplateColumns: '5rem 1fr 3.5rem 2.5rem 3.5rem' }}>
        <span>Date</span>
        <span>Camera</span>
        <span className="text-center">Drinks</span>
        <span className="text-center">/hr</span>
        <span className="text-center">Status</span>
      </div>

      <div className="divide-y divide-whoop-divider/50">
        {visible.map(job => {
          const dph = job.drinksPerHour != null ? job.drinksPerHour.toFixed(0) : '—';
          return (
            <div
              key={job.jobId}
              className="grid items-center gap-2 px-4 py-2.5 hover:bg-whoop-bg/40 transition-colors"
              style={{ gridTemplateColumns: '5rem 1fr 3.5rem 2.5rem 3.5rem' }}
            >
              <div>
                <div className="text-xs font-medium text-white">{fmtDate(job.createdAt ?? 0)}</div>
                <div className="text-[9px] text-text-muted">{fmtTime(job.createdAt ?? 0)}</div>
              </div>
              <div className="text-xs text-text-secondary truncate">{cameraName(job)}</div>
              <div className="text-sm font-bold text-teal text-center tabular-nums">{job.totalDrinks ?? 0}</div>
              <div className="text-[10px] text-text-muted text-center tabular-nums">{dph}</div>
              <div className="text-center">
                {job.hasTheftFlag ? (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-red-400">
                    <AlertTriangle className="w-2.5 h-2.5" />
                    {job.unrungDrinks ? `${job.unrungDrinks}` : 'Flag'}
                  </span>
                ) : (
                  <span className="text-[9px] text-emerald-400">✓</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {sorted.length > 8 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full py-2.5 text-xs text-text-muted hover:text-white border-t border-whoop-divider transition-colors flex items-center justify-center gap-1"
        >
          {expanded ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> Show all {sorted.length} sessions</>}
        </button>
      )}
    </div>
  );
}

// ── Revenue banner ────────────────────────────────────────────────────────────

function RevenueBanner({ jobs, avgDrinkPrice }: { jobs: VenueScopeJob[]; avgDrinkPrice: number }) {
  const totalUnrung = jobs.reduce((s, j) => s + (j.unrungDrinks ?? 0), 0);
  if (totalUnrung === 0 || avgDrinkPrice <= 0) return null;
  const recovered = totalUnrung * avgDrinkPrice;
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 bg-teal/10 border border-teal/25 rounded-2xl px-4 py-3"
    >
      <DollarSign className="w-4 h-4 text-teal flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white">
          <span className="text-teal">${recovered.toLocaleString()}</span> in potential theft detected this period
        </p>
        <p className="text-[10px] text-text-muted mt-0.5">
          {totalUnrung} unrung drink{totalUnrung !== 1 ? 's' : ''} × ${avgDrinkPrice} avg price
        </p>
      </div>
      <TrendingUp className="w-4 h-4 text-teal flex-shrink-0" />
    </motion.div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function Analytics() {
  const venueId     = authService.getStoredUser()?.venueId ?? '';
  const isDemo      = isDemoAccount(venueId);
  const [period, setPeriod]           = useState<Period>('7days');
  const [allJobs, setAllJobs]         = useState<VenueScopeJob[]>([]);
  const [loading, setLoading]         = useState(true);
  const [avgDrinkPrice, setAvgDrinkPrice] = useState(0);

  const load = useCallback(async () => {
    if (!venueId) { setLoading(false); return; }
    setLoading(true);
    try {
      const raw = isDemo ? generateDemoVenueScopeJobs() : await venueScopeService.listJobs(venueId, 300);
      setAllJobs(raw.filter(j => !j.isLive && j.status !== 'running'));
    } finally {
      setLoading(false);
    }
  }, [venueId, isDemo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!venueId) return;
    venueSettingsService.loadSettingsFromCloud(venueId).then(s => {
      if (s?.avgDrinkPrice && s.avgDrinkPrice > 0) setAvgDrinkPrice(s.avgDrinkPrice);
    }).catch(() => {});
  }, [venueId]);

  const jobs = useMemo(() => filterJobs(allJobs, period), [allJobs, period]);

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Results</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {jobs.length} session{jobs.length !== 1 ? 's' : ''} · {allJobs.length} total
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-xl bg-whoop-panel border border-whoop-divider text-text-muted hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Period toggle */}
      <PeriodToggle value={period} onChange={setPeriod} />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-5 h-5 text-text-muted animate-spin" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl px-4 py-12 text-center">
          <Video className="w-8 h-8 text-text-muted mx-auto mb-3" />
          <p className="text-sm text-white font-medium">No sessions for this period</p>
          <p className="text-xs text-text-muted mt-1">Try a wider time range</p>
          {period !== 'all' && (
            <button onClick={() => setPeriod('all')} className="mt-4 text-xs text-teal hover:underline">
              Show all time →
            </button>
          )}
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={period}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            <HeroNumbers jobs={jobs} avgDrinkPrice={avgDrinkPrice} />
            {avgDrinkPrice > 0 && <RevenueBanner jobs={jobs} avgDrinkPrice={avgDrinkPrice} />}
            <StaffSection jobs={jobs} />
            <TheftSection jobs={jobs} />
            <NightLog jobs={jobs} />
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
