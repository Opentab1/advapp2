/**
 * Results — Owner shift intelligence
 *
 * Period toggle → hero numbers → bar staff → theft → night log
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw, AlertTriangle, ShieldCheck, TrendingUp,
  ChevronDown, ChevronUp, User, Video, DollarSign,
  Wine, Users, Activity,
} from 'lucide-react';
import authService from '../services/auth.service';
import venueScopeService, { VenueScopeJob } from '../services/venuescope.service';
import venueSettingsService, { VenueSettings } from '../services/venue-settings.service';
import { isDemoAccount, generateDemoVenueScopeJobs } from '../utils/demoData';

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = 'today' | 'yesterday' | '7days' | '30days' | 'all';

interface StaffStat {
  name: string;
  drinks: number;
  shifts: number;
  perHour: number;
  theftFlags: number;
  overPours: number;
  totalOz: number;
  drinkTypes: Record<string, number>;
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

// ── Business-day helpers ──────────────────────────────────────────────────────
// Period windows are anchored to the venue's configured opening time (Settings →
// Business Hours). Each calendar day starts at that opening hour, not midnight.
//
// Key design: TODAY = calendar today from open-time to now (empty before the bar
// opens — correct). YESTERDAY = calendar yesterday from open-time to today's
// open-time (shows last night's shift when viewed the morning after). This maps
// to how a bar manager thinks: at 9 AM they want "Yesterday" for last night.
//
// Falls back to noon (12:00) when no hours are configured — safe for any bar
// since noon is before any realistic evening open time, and the 7/30-day rolling
// windows still capture everything across multiple days.

type BizHours = VenueSettings['businessHours'];

// Return [hour, minute] for the venue's opening time on a given calendar Date.
function openHMForDate(bh: BizHours | null | undefined, date: Date): [number, number] {
  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  if (bh?.days) {
    const key = DAY_KEYS[date.getDay()];
    const day = bh.days[key];
    if (day && !day.closed && day.open) {
      const [h, m] = day.open.split(':').map(Number);
      return [h || 0, m || 0];
    }
  }
  if (bh?.open) {
    const [h, m] = bh.open.split(':').map(Number);
    return [h || 0, m || 0];
  }
  return [12, 0]; // safe default: noon
}

// Unix seconds at which TODAY's business day opens (calendar today + open hour).
// If we're before today's open time the bar hasn't opened yet — return future
// timestamp so Today filter correctly shows 0 sessions.
function todayBizStart(bh: BizHours | null | undefined): number {
  const now = new Date();
  const [h, m] = openHMForDate(bh, now);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d.getTime() / 1000;
}

// Unix seconds at which YESTERDAY's business day opened (calendar yesterday + open hour).
function yesterdayBizStart(bh: BizHours | null | undefined): number {
  const now = new Date();
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  const [h, m] = openHMForDate(bh, d);
  d.setHours(h, m, 0, 0);
  return d.getTime() / 1000;
}

function periodBounds(period: Period, bh: BizHours | null | undefined): { start: number; end: number } {
  const now       = Date.now() / 1000;
  const todayOpen = todayBizStart(bh);      // today's opening time (may be future)
  const yestOpen  = yesterdayBizStart(bh);  // yesterday's opening time
  if (period === 'today')     return { start: todayOpen,              end: now };
  if (period === 'yesterday') return { start: yestOpen,               end: todayOpen };
  // 7/30-day rolling windows start from yesterday's open so the most recent
  // complete shift is always included even before today's bar opens.
  if (period === '7days')     return { start: yestOpen - 6 * 86400,  end: now };
  if (period === '30days')    return { start: yestOpen - 29 * 86400, end: now };
  return { start: 0, end: now };
}

function jobTs(j: VenueScopeJob): number {
  // finishedAt is always written for completed jobs; fall back to createdAt
  return j.finishedAt || j.updatedAt || j.createdAt || 0;
}

function filterJobs(jobs: VenueScopeJob[], period: Period, bh: BizHours | null | undefined): VenueScopeJob[] {
  if (period === 'all') return jobs;
  const { start, end } = periodBounds(period, bh);
  return jobs.filter(j => { const t = jobTs(j); return t >= start && t < end; });
}

function buildStaff(jobs: VenueScopeJob[]): StaffStat[] {
  const map = new Map<string, StaffStat>();

  for (const job of jobs) {
    if (job.bartenderBreakdown) {
      try {
        const bd = JSON.parse(job.bartenderBreakdown) as Record<string, {
          drinks: number; per_hour?: number; over_pours?: number; total_oz?: number; drink_types?: Record<string, number>;
        }>;
        for (const [name, d] of Object.entries(bd)) {
          if (!name || name === 'unknown') continue;
          if (!map.has(name)) map.set(name, { name, drinks: 0, shifts: 0, perHour: 0, theftFlags: 0, overPours: 0, totalOz: 0, drinkTypes: {}, shiftDrinks: [] });
          const s = map.get(name)!;
          s.drinks     += d.drinks ?? 0;
          s.shifts     += 1;
          s.perHour    += d.per_hour ?? 0;
          s.theftFlags += job.hasTheftFlag ? 1 : 0;
          s.overPours  += d.over_pours ?? 0;
          s.totalOz    += d.total_oz ?? 0;
          for (const [type, cnt] of Object.entries(d.drink_types ?? {})) {
            s.drinkTypes[type] = (s.drinkTypes[type] ?? 0) + cnt;
          }
          s.shiftDrinks.push({ date: job.createdAt ?? 0, drinks: d.drinks ?? 0, flag: job.hasTheftFlag });
        }
        continue;
      } catch { /* fall through */ }
    }
    // Fallback: topBartender
    if (job.topBartender) {
      const name = job.topBartender;
      if (!map.has(name)) map.set(name, { name, drinks: 0, shifts: 0, perHour: 0, theftFlags: 0, overPours: 0, totalOz: 0, drinkTypes: {}, shiftDrinks: [] });
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
    { id: 'today',     label: 'Today' },
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
  const totalDrinks   = jobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
  const theftCount    = jobs.filter(j => j.hasTheftFlag).length;
  const totalUnrung   = jobs.reduce((s, j) => s + (j.unrungDrinks ?? 0), 0);
  const recovered     = avgDrinkPrice > 0 ? totalUnrung * avgDrinkPrice : 0;
  const drinkJobs     = jobs.filter(j => (j.totalDrinks ?? 0) > 0);
  const nights        = new Set(drinkJobs.map(j => fmtDate(jobTs(j)))).size;
  const avgPerNight   = nights > 0 ? Math.round(totalDrinks / nights) : 0;

  // People count metrics
  const totalEntries  = jobs.reduce((s, j) => s + (j.totalEntries ?? 0), 0);
  const peakOccupancy = jobs.reduce((max, j) => Math.max(max, j.peakOccupancy ?? 0), 0);
  const uniqueTracked = jobs.reduce((s, j) => s + (j.uniqueTracked ?? 0), 0);
  const hasPeople     = totalEntries > 0 || peakOccupancy > 0 || uniqueTracked > 0;
  // headcount mode: cameras running people_count with no counting lines
  const headcountMode = totalEntries === 0 && (peakOccupancy > 0 || uniqueTracked > 0);

  // Unique camera-days
  const days = new Set(jobs.map(j => fmtDate(jobTs(j)))).size;

  const tiles = [
    {
      label: 'Drinks Detected',
      value: totalDrinks > 0 ? totalDrinks.toLocaleString() : jobs.length > 0 ? '0' : '—',
      color: totalDrinks > 0 ? 'text-teal' : 'text-text-muted',
      sub: nights > 0 ? `${nights} night${nights !== 1 ? 's' : ''}` : null,
    },
    hasPeople
      ? {
          label: uniqueTracked > 0 ? 'People Tracked' : 'Peak Occupancy',
          value: (uniqueTracked > 0 ? uniqueTracked : peakOccupancy).toLocaleString(),
          color: 'text-blue-400',
          sub: uniqueTracked > 0 && peakOccupancy > 0 ? `Peak: ${peakOccupancy}` : `across ${jobs.filter(j => (j.peakOccupancy ?? 0) > 0).length} sessions`,
        }
      : {
          label: 'Revenue Protected',
          value: recovered > 0 ? `$${recovered.toLocaleString()}` : totalUnrung > 0 ? `${totalUnrung} unrung` : '—',
          color: recovered > 0 ? 'text-emerald-400' : 'text-amber-400',
          sub: recovered > 0 ? `${totalUnrung} unrung drinks` : null,
        },
    {
      label: 'Theft Flags',
      value: theftCount > 0 ? String(theftCount) : '0',
      color: theftCount > 0 ? 'text-red-400' : 'text-emerald-400',
      sub: theftCount === 0 ? 'All clean' : `${theftCount} shift${theftCount !== 1 ? 's' : ''}`,
    },
    totalDrinks > 0
      ? {
          label: 'Avg / Night',
          value: avgPerNight > 0 ? String(avgPerNight) : '—',
          color: 'text-white',
          sub: 'drinks',
        }
      : {
          label: 'Sessions',
          value: jobs.length.toLocaleString(),
          color: 'text-white',
          sub: days > 0 ? `${days} day${days !== 1 ? 's' : ''}` : null,
        },
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
            <div className="px-4 pb-3 space-y-2 bg-whoop-bg/30">
              <div className="grid grid-cols-3 gap-2 pt-2">
                <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
                  <div className="text-base font-bold text-white">{person.shifts}</div>
                  <div className="text-[9px] text-text-muted uppercase tracking-wide">Shifts</div>
                </div>
                <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
                  <div className="text-base font-bold text-white">{person.shifts > 0 ? Math.round(person.drinks / person.shifts) : '—'}</div>
                  <div className="text-[9px] text-text-muted uppercase tracking-wide">Avg / Shift</div>
                </div>
                <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
                  <div className={`text-base font-bold ${person.theftFlags > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{person.theftFlags}</div>
                  <div className="text-[9px] text-text-muted uppercase tracking-wide">Flags</div>
                </div>
              </div>
              {/* Oz + over-pours row */}
              {(person.totalOz > 0 || person.overPours > 0) && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
                    <div className="text-base font-bold text-white">{person.totalOz.toFixed(1)}</div>
                    <div className="text-[9px] text-text-muted uppercase tracking-wide">Oz Poured</div>
                  </div>
                  <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
                    <div className={`text-base font-bold ${person.overPours > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{person.overPours}</div>
                    <div className="text-[9px] text-text-muted uppercase tracking-wide">Over-Pours</div>
                  </div>
                </div>
              )}
              {/* Drink type pills */}
              {Object.keys(person.drinkTypes).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(person.drinkTypes).sort((a,b) => b[1]-a[1]).map(([type, cnt]) => (
                    <span key={type} className="text-[10px] bg-whoop-bg border border-whoop-divider rounded-lg px-2 py-1 text-white">
                      {cnt} <span className="text-text-muted capitalize">{type}</span>
                    </span>
                  ))}
                </div>
              )}
              {/* Per-shift mini log */}
              <div className="space-y-1 pt-0.5">
                {person.shiftDrinks.sort((a, b) => b.date - a.date).slice(0, 6).map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className="text-text-muted">{fmtDate(s.date)} · {fmtTime(s.date)}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-semibold tabular-nums">{s.drinks} drinks</span>
                      {s.flag ? <span className="text-red-400">⚠</span> : <span className="text-emerald-400">✓</span>}
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

// ── Detection Event Log ───────────────────────────────────────────────────────

interface DetectionEvent {
  ts: number;           // epoch seconds
  type: 'drink' | 'people' | 'bottle' | 'pour' | 'theft';
  camera: string;
  stat: string;         // human-readable value
  detail: string;       // secondary detail
  flag?: boolean;
}

function buildEvents(jobs: VenueScopeJob[]): DetectionEvent[] {
  const events: DetectionEvent[] = [];

  for (const job of jobs) {
    const cam  = cameraName(job);
    const ts   = jobTs(job);
    const mode = job.analysisMode ?? '';

    // Drink detection events
    if ((mode === 'drink_count' || (job.activeModes ?? '').includes('drink_count')) && (job.totalDrinks ?? 0) > 0) {
      const dph  = job.drinksPerHour ? `${job.drinksPerHour.toFixed(0)}/hr` : '';
      const bartender = job.topBartender ? ` · ${job.topBartender}` : '';
      events.push({
        ts,
        type: 'drink',
        camera: cam,
        stat: `${job.totalDrinks} drink${(job.totalDrinks ?? 0) !== 1 ? 's' : ''}`,
        detail: [dph, bartender].filter(Boolean).join(''),
        flag: job.hasTheftFlag,
      });
    }

    // People count events
    if ((mode === 'people_count' || (job.activeModes ?? '').includes('people_count')) && (job.peakOccupancy ?? 0) > 0) {
      const entries = job.totalEntries ?? 0;
      events.push({
        ts,
        type: 'people',
        camera: cam,
        stat: `${job.peakOccupancy} in frame`,
        detail: entries > 0 ? `${entries} entries` : '',
      });
    }

    // Bottle count events
    if ((mode === 'bottle_count' || (job.activeModes ?? '').includes('bottle_count')) && (job.bottleCount ?? 0) > 0) {
      const pours = job.pourCount ? ` · ${job.pourCount} pours` : '';
      events.push({
        ts,
        type: 'bottle',
        camera: cam,
        stat: `${job.bottleCount} bottle${(job.bottleCount ?? 1) !== 1 ? 's' : ''}`,
        detail: `Peak: ${job.peakBottleCount ?? job.bottleCount}${pours}`,
      });
    }

    // Pour / over-pour events (from bottle_count jobs)
    if ((job.overPours ?? 0) > 0) {
      events.push({
        ts,
        type: 'pour',
        camera: cam,
        stat: `${job.overPours} over-pour${(job.overPours ?? 1) !== 1 ? 's' : ''}`,
        detail: job.totalPouredOz ? `${job.totalPouredOz.toFixed(1)} oz total` : '',
        flag: true,
      });
    }

    // Theft / unrung events
    if (job.hasTheftFlag && (job.unrungDrinks ?? 0) > 0) {
      events.push({
        ts,
        type: 'theft',
        camera: cam,
        stat: `${job.unrungDrinks} unrung drink${(job.unrungDrinks ?? 1) !== 1 ? 's' : ''}`,
        detail: 'Pull NVR footage to verify',
        flag: true,
      });
    }
  }

  // Sort newest first
  return events.sort((a, b) => b.ts - a.ts);
}

const EVENT_META: Record<DetectionEvent['type'], { label: string; color: string; icon: React.ReactNode }> = {
  drink:  { label: 'Drink Detection',  color: 'text-teal',        icon: <Wine className="w-3.5 h-3.5" /> },
  people: { label: 'People Count',     color: 'text-blue-400',    icon: <Users className="w-3.5 h-3.5" /> },
  bottle: { label: 'Bottle Count',     color: 'text-purple-400',  icon: <Activity className="w-3.5 h-3.5" /> },
  pour:   { label: 'Over-Pour Alert',  color: 'text-amber-400',   icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  theft:  { label: 'Theft Flag',       color: 'text-red-400',     icon: <AlertTriangle className="w-3.5 h-3.5" /> },
};

const FILTER_OPTIONS: Array<{ key: DetectionEvent['type'] | 'all'; label: string }> = [
  { key: 'all',    label: 'All' },
  { key: 'drink',  label: 'Drinks' },
  { key: 'people', label: 'People' },
  { key: 'bottle', label: 'Bottles' },
  { key: 'pour',   label: 'Mispours' },
  { key: 'theft',  label: 'Theft' },
];

function DetectionEventLog({ jobs }: { jobs: VenueScopeJob[] }) {
  const [expanded, setExpanded]   = useState(false);
  const [filter, setFilter]       = useState<DetectionEvent['type'] | 'all'>('all');

  const events  = useMemo(() => buildEvents(jobs), [jobs]);

  // Only show filter pills for types that actually have events
  const typesPresent = useMemo(() => new Set(events.map(e => e.type)), [events]);
  const visibleFilters = FILTER_OPTIONS.filter(f => f.key === 'all' || typesPresent.has(f.key));

  const filtered = useMemo(
    () => filter === 'all' ? events : events.filter(e => e.type === filter),
    [events, filter],
  );

  // Reset expanded when filter changes
  const handleFilter = (key: typeof filter) => { setFilter(key); setExpanded(false); };

  if (events.length === 0) return null;

  const visible = expanded ? filtered : filtered.slice(0, 12);

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
        <Activity className="w-4 h-4 text-teal" />
        <span className="text-sm font-semibold text-white">Detection Events</span>
        <span className="ml-auto text-[10px] text-text-muted">
          {filtered.length}{filter !== 'all' ? ` / ${events.length}` : ''} event{events.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Filter pills */}
      {visibleFilters.length > 2 && (
        <div className="flex gap-1.5 px-4 py-2.5 border-b border-whoop-divider/40 overflow-x-auto scrollbar-none">
          {visibleFilters.map(({ key, label }) => {
            const active = filter === key;
            const meta   = key !== 'all' ? EVENT_META[key] : null;
            return (
              <button
                key={key}
                onClick={() => handleFilter(key)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap transition-colors border ${
                  active
                    ? 'bg-teal/15 border-teal/40 text-teal'
                    : 'bg-whoop-bg border-whoop-divider text-text-muted hover:text-white'
                }`}
              >
                {meta && <span className={active ? meta.color : ''}>{meta.icon}</span>}
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Column headers */}
      <div className="grid gap-0 px-4 py-2 border-b border-whoop-divider/40 text-[9px] text-text-muted uppercase tracking-wider font-semibold"
        style={{ gridTemplateColumns: '4.5rem 1fr auto auto' }}>
        <span>Time</span>
        <span>Camera</span>
        <span className="text-right pr-4">Event · Stat</span>
        <span className="text-right">NVR ref</span>
      </div>

      {filtered.length === 0 ? (
        <div className="px-4 py-6 text-center text-[11px] text-text-muted">
          No {FILTER_OPTIONS.find(f => f.key === filter)?.label.toLowerCase()} events in this period
        </div>
      ) : (
        <div className="divide-y divide-whoop-divider/40">
          {visible.map((ev, i) => {
            const meta = EVENT_META[ev.type];
            return (
              <div key={i} className="grid items-center gap-3 px-4 py-3 hover:bg-whoop-bg/40 transition-colors"
                style={{ gridTemplateColumns: '4.5rem 1fr auto auto' }}>

                {/* Time */}
                <div>
                  <div className="text-[10px] font-semibold text-white tabular-nums">{fmtTime(ev.ts)}</div>
                  <div className="text-[9px] text-text-muted">{fmtDate(ev.ts)}</div>
                </div>

                {/* Camera */}
                <div className="min-w-0">
                  <div className="text-xs text-text-secondary truncate">{ev.camera}</div>
                  {ev.detail && <div className="text-[9px] text-text-muted/70 truncate mt-0.5">{ev.detail}</div>}
                </div>

                {/* Event type + stat */}
                <div className="text-right pr-2">
                  <div className={`flex items-center gap-1 justify-end text-[10px] font-medium ${meta.color}`}>
                    {meta.icon}
                    <span>{meta.label}</span>
                    {ev.flag && <AlertTriangle className="w-2.5 h-2.5 text-red-400 ml-0.5" />}
                  </div>
                  <div className="text-sm font-bold text-white tabular-nums mt-0.5">{ev.stat}</div>
                </div>

                {/* NVR timestamp */}
                <div className="text-right">
                  <div className="text-[9px] text-text-muted/50 font-mono tabular-nums leading-tight">{fmtTime(ev.ts)}</div>
                  <div className="text-[8px] text-text-muted/30 uppercase tracking-wide">NVR</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {filtered.length > 12 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full py-2.5 text-xs text-text-muted hover:text-white border-t border-whoop-divider transition-colors flex items-center justify-center gap-1"
        >
          {expanded
            ? <><ChevronUp className="w-3 h-3" /> Show less</>
            : <><ChevronDown className="w-3 h-3" /> Show all {filtered.length} events</>}
        </button>
      )}
    </div>
  );
}

// ── People Count Detail ────────────────────────────────────────────────────────

function PeopleSection({ jobs }: { jobs: VenueScopeJob[] }) {
  const peopleJobs = useMemo(
    () => jobs.filter(j => (j.peakOccupancy ?? 0) > 0 || (j.uniqueTracked ?? 0) > 0)
              .sort((a, b) => jobTs(b) - jobTs(a)),
    [jobs]
  );
  if (peopleJobs.length === 0) return null;

  const overallPeak    = peopleJobs.reduce((max, j) => Math.max(max, j.peakOccupancy ?? 0), 0);
  const totalUnique    = peopleJobs.reduce((s, j) => s + (j.uniqueTracked ?? 0), 0);
  const totalEntries   = peopleJobs.reduce((s, j) => s + (j.totalEntries ?? 0), 0);

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
        <Users className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-white">People Count</span>
        <span className="ml-auto text-[10px] text-text-muted">{peopleJobs.length} session{peopleJobs.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
            <div className="text-sm font-bold text-blue-400 tabular-nums">{overallPeak}</div>
            <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Peak Occupancy</div>
          </div>
          <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
            <div className="text-sm font-bold text-white tabular-nums">{totalUnique > 0 ? totalUnique : '—'}</div>
            <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">People Tracked</div>
          </div>
          <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
            <div className="text-sm font-bold text-white tabular-nums">{totalEntries > 0 ? totalEntries : '—'}</div>
            <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Total Entries</div>
          </div>
        </div>
        {/* Per-session peak breakdown */}
        <div className="space-y-1">
          {peopleJobs.slice(0, 8).map(job => {
            const peak = job.peakOccupancy ?? 0;
            const barPct = overallPeak > 0 ? (peak / overallPeak) * 100 : 0;
            return (
              <div key={job.jobId} className="flex items-center gap-2">
                <span className="text-[10px] text-text-muted w-20 flex-shrink-0 truncate">{cameraName(job)}</span>
                <div className="flex-1 h-1.5 bg-whoop-divider rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400/60 rounded-full" style={{ width: `${barPct}%` }} />
                </div>
                <span className="text-[10px] font-semibold text-white w-6 text-right tabular-nums">{peak}</span>
                <span className="text-[9px] text-text-muted w-12 flex-shrink-0">{fmtTime(jobTs(job))}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Drink Type Breakdown (gap #4) ─────────────────────────────────────────────

const DRINK_EMOJI: Record<string, string> = {
  shot: '🥃', spirit: '🍸', cocktail: '🍹', wine: '🍷', beer: '🍺', unknown: '❓',
};

function DrinkTypeSection({ jobs }: { jobs: VenueScopeJob[] }) {
  const types: Record<string, number> = {};
  let totalOz = 0, overPours = 0;

  for (const job of jobs) {
    if (!job.drinkTypeBreakdown) continue;
    try {
      const d = JSON.parse(job.drinkTypeBreakdown);
      for (const [k, v] of Object.entries(d.drink_types ?? {})) {
        types[k] = (types[k] ?? 0) + (v as number);
      }
      totalOz   += d.total_oz ?? 0;
      overPours += d.over_pours ?? 0;
    } catch { /* skip */ }
  }

  if (Object.keys(types).length === 0) return null;

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
        <Wine className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-semibold text-white">Drink Types</span>
        {overPours > 0 && (
          <span className="ml-auto text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5">
            {overPours} over-pour{overPours !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {Object.entries(types).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
            <div key={type} className="flex items-center gap-2 bg-whoop-bg border border-whoop-divider rounded-xl px-3 py-2">
              <span className="text-lg">{DRINK_EMOJI[type] ?? '🍶'}</span>
              <div>
                <div className="text-sm font-bold text-white tabular-nums">{count}</div>
                <div className="text-[9px] text-text-muted capitalize">{type}</div>
              </div>
            </div>
          ))}
        </div>
        {totalOz > 0 && (
          <div className="text-[11px] text-text-muted">
            Total poured: <span className="text-white font-semibold">{totalOz.toFixed(1)} oz</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Bottle Count Detail (gap #7) ───────────────────────────────────────────────

function BottleSection({ jobs }: { jobs: VenueScopeJob[] }) {
  const hasBottle = jobs.some(j => (j.bottleCount ?? 0) > 0);
  if (!hasBottle) return null;

  const totalBottles = jobs.reduce((s, j) => s + (j.bottleCount ?? 0), 0);
  const totalPours   = jobs.reduce((s, j) => s + (j.pourCount ?? 0), 0);
  const totalOz      = jobs.reduce((s, j) => s + (j.totalPouredOz ?? 0), 0);
  const overPours    = jobs.reduce((s, j) => s + (j.overPours ?? 0), 0);
  const walkOuts     = jobs.reduce((s, j) => s + (j.walkOutAlerts ?? 0), 0);

  const byClass: Record<string, number> = {};
  for (const job of jobs) {
    if (!job.bottleByClass) continue;
    try {
      const d = JSON.parse(job.bottleByClass) as Record<string, number>;
      for (const [k, v] of Object.entries(d)) byClass[k] = (byClass[k] ?? 0) + v;
    } catch { /* skip */ }
  }

  const classEmoji: Record<string, string> = { bottle: '🍾', wine_glass: '🍷', cup: '🍺' };

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
        <span className="text-base">🍾</span>
        <span className="text-sm font-semibold text-white">Bottle Count</span>
        {walkOuts > 0 && (
          <span className="ml-auto text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5">
            {walkOuts} walk-out{walkOuts !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Bottles', value: totalBottles, color: 'text-white' },
            { label: 'Pours', value: totalPours, color: 'text-white' },
            { label: 'Oz Poured', value: totalOz.toFixed(1), color: 'text-white' },
            { label: 'Over-pours', value: overPours, color: overPours > 0 ? 'text-amber-400' : 'text-emerald-400' },
          ].map(tile => (
            <div key={tile.label} className="bg-whoop-bg rounded-xl p-2.5 text-center">
              <div className={`text-sm font-bold tabular-nums ${tile.color}`}>{tile.value}</div>
              <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">{tile.label}</div>
            </div>
          ))}
        </div>
        {Object.keys(byClass).length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {Object.entries(byClass).map(([cls, cnt]) => (
              <div key={cls} className="flex items-center gap-1.5 bg-whoop-bg border border-whoop-divider rounded-xl px-3 py-2">
                <span className="text-base">{classEmoji[cls] ?? '🍶'}</span>
                <div>
                  <div className="text-sm font-bold text-white">{cnt}</div>
                  <div className="text-[9px] text-text-muted capitalize">{cls.replace('_', ' ')}</div>
                </div>
              </div>
            ))}
            {totalPours > 0 && totalOz > 0 && (
              <div className="flex items-center gap-1.5 bg-whoop-bg border border-whoop-divider rounded-xl px-3 py-2">
                <div>
                  <div className="text-sm font-bold text-white">{(totalOz / totalPours).toFixed(2)}</div>
                  <div className="text-[9px] text-text-muted">Avg oz/pour</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Table Turns Detail (gap #6) ────────────────────────────────────────────────

function TableTurnsSection({ jobs }: { jobs: VenueScopeJob[] }) {
  const turnJobs = useMemo(
    () => jobs.filter(j => (j.totalTurns ?? 0) > 0).sort((a, b) => jobTs(b) - jobTs(a)),
    [jobs]
  );
  if (turnJobs.length === 0) return null;

  const totalTurns = turnJobs.reduce((s, j) => s + (j.totalTurns ?? 0), 0);

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
        <span className="text-base">🪑</span>
        <span className="text-sm font-semibold text-white">Table Turns</span>
        <span className="ml-auto text-xs font-bold text-white tabular-nums">{totalTurns} total turns</span>
      </div>
      <div className="divide-y divide-whoop-divider/50">
        {turnJobs.slice(0, 8).map(job => {
          let tableRows: React.ReactNode = null;
          if (job.tableDetail) {
            try {
              const detail = JSON.parse(job.tableDetail) as Record<string, {
                label: string; turn_count: number; avg_dwell_min: number;
                avg_response_sec?: number; staff_attribution?: Record<string, number>;
              }>;
              const entries = Object.entries(detail).filter(([, t]) => t.turn_count > 0);
              if (entries.length > 0) {
                tableRows = (
                  <div className="mt-2 space-y-1">
                    {entries.map(([tid, t]) => (
                      <div key={tid} className="flex items-center justify-between text-[10px] px-1">
                        <span className="text-text-muted font-medium">{t.label}</span>
                        <div className="flex gap-3 text-right">
                          <span className="text-white font-semibold">{t.turn_count} turn{t.turn_count !== 1 ? 's' : ''}</span>
                          {t.avg_dwell_min > 0 && <span className="text-text-muted">{t.avg_dwell_min.toFixed(1)}min</span>}
                          {t.avg_response_sec != null && <span className="text-text-muted">{t.avg_response_sec.toFixed(0)}s resp</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }
            } catch { /* skip */ }
          }
          return (
            <div key={job.jobId} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-white truncate">{cameraName(job)}</span>
                <span className="text-[10px] text-text-muted flex-shrink-0">{fmtDate(jobTs(job))}</span>
                <span className="ml-auto text-xs font-bold text-white flex-shrink-0">{job.totalTurns} turns</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Avg Dwell', value: job.avgDwellMin != null ? `${job.avgDwellMin.toFixed(1)}min` : '—' },
                  { label: 'Avg Response', value: job.avgResponseSec != null ? `${job.avgResponseSec.toFixed(0)}s` : '—' },
                  { label: 'Turns', value: String(job.totalTurns) },
                ].map(stat => (
                  <div key={stat.label} className="bg-whoop-bg rounded-xl p-2 text-center">
                    <div className="text-xs font-bold text-white">{stat.value}</div>
                    <div className="text-[9px] text-text-muted">{stat.label}</div>
                  </div>
                ))}
              </div>
              {tableRows}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Staff Activity Detail (gap #8) ─────────────────────────────────────────────

function StaffActivitySection({ jobs }: { jobs: VenueScopeJob[] }) {
  const staffJobs = useMemo(
    () => jobs.filter(j => (j.uniqueStaff ?? 0) > 0).sort((a, b) => jobTs(b) - jobTs(a)),
    [jobs]
  );
  if (staffJobs.length === 0) return null;

  const peakStaff   = staffJobs.reduce((max, j) => Math.max(max, j.uniqueStaff ?? 0), 0);
  const peakHead    = staffJobs.reduce((max, j) => Math.max(max, j.peakHeadcount ?? 0), 0);
  const avgIdle     = staffJobs.filter(j => j.avgIdlePct != null);
  const avgIdlePct  = avgIdle.length > 0
    ? avgIdle.reduce((s, j) => s + (j.avgIdlePct ?? 0), 0) / avgIdle.length
    : 0;

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
        <Activity className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-white">Staff Activity</span>
        <span className={`ml-auto text-[10px] font-bold ${avgIdlePct > 30 ? 'text-amber-400' : 'text-emerald-400'}`}>
          {avgIdlePct.toFixed(1)}% avg idle
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Unique Staff', value: peakStaff, color: 'text-white' },
            { label: 'Peak Count', value: peakHead, color: 'text-white' },
            { label: 'Avg Idle', value: `${avgIdlePct.toFixed(1)}%`, color: avgIdlePct > 30 ? 'text-amber-400' : 'text-emerald-400' },
          ].map(tile => (
            <div key={tile.label} className="bg-whoop-bg rounded-xl p-2.5 text-center">
              <div className={`text-sm font-bold ${tile.color}`}>{tile.value}</div>
              <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">{tile.label}</div>
            </div>
          ))}
        </div>
        {/* Per-session staff breakdown */}
        {staffJobs.slice(0, 3).map(job => {
          if (!job.staffDetail) return null;
          try {
            const d = JSON.parse(job.staffDetail) as { staff_details: { track_id: number; idle_pct: number; active_seconds: number; idle_seconds: number }[] };
            if (!d.staff_details?.length) return null;
            return (
              <div key={job.jobId} className="space-y-1.5">
                <div className="text-[9px] text-text-muted uppercase tracking-wide">{fmtDate(jobTs(job))} · {cameraName(job)}</div>
                {d.staff_details.slice(0, 6).map(s => (
                  <div key={s.track_id} className="flex items-center gap-2">
                    <Users className="w-3 h-3 text-text-muted flex-shrink-0" />
                    <span className="text-[10px] text-text-muted w-16 flex-shrink-0">Staff #{s.track_id}</span>
                    <div className="flex-1 h-1.5 bg-whoop-divider rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${s.idle_pct > 30 ? 'bg-amber-400/70' : 'bg-emerald-400/70'}`}
                        style={{ width: `${Math.min(s.idle_pct, 100)}%` }}
                      />
                    </div>
                    <span className={`text-[10px] font-semibold w-9 text-right tabular-nums ${s.idle_pct > 30 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {s.idle_pct?.toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            );
          } catch { return null; }
        })}
      </div>
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
  const [period, setPeriod]           = useState<Period>('all');
  const [allJobs, setAllJobs]         = useState<VenueScopeJob[]>([]);
  const [loading, setLoading]         = useState(true);
  const [avgDrinkPrice, setAvgDrinkPrice] = useState(0);
  // Business hours from venue Settings — drives "Today" / "Yesterday" window boundaries.
  // Initialise synchronously from cache so first render is instant; refreshed from cloud below.
  const [businessHours, setBusinessHours] = useState<BizHours | null>(
    () => venueSettingsService.getBusinessHours(venueId) ?? null
  );

  // Always fetch the full 500 most recent jobs — no server-side date filtering.
  // Reason: the DDB sort key BETWEEN query misses jobs with legacy UUID sort keys
  // (inserted before the !{reverse_ts}_{jobId} format was introduced). Passing
  // startEpoch/endEpoch to listJobs causes different periods to return different
  // total sets, making Today vs 30Days vs AllTime inconsistent.
  // Client-side filterJobs() handles all period windowing from the same dataset.
  const load = useCallback(async () => {
    if (!venueId) { setLoading(false); return; }
    setLoading(true);
    try {
      const raw = isDemo
        ? generateDemoVenueScopeJobs()
        : await venueScopeService.listJobs(venueId, 500);
      setAllJobs(raw.filter(j => !j.isLive && j.status !== 'running'));
    } finally {
      setLoading(false);
    }
  }, [venueId, isDemo]);

  useEffect(() => { load(); }, [load]);

  // Load venue settings from cloud once on mount — updates business hours and drink price.
  // businessHours changing only affects filterJobs() client-side, no reload needed.
  useEffect(() => {
    if (!venueId) return;
    venueSettingsService.loadSettingsFromCloud(venueId).then(s => {
      if (s?.avgDrinkPrice && s.avgDrinkPrice > 0) setAvgDrinkPrice(s.avgDrinkPrice);
      if (s?.businessHours) setBusinessHours(s.businessHours);
    }).catch(() => {});
  }, [venueId]);

  const jobs = useMemo(() => filterJobs(allJobs, period, businessHours), [allJobs, period, businessHours]);

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
          <p className="text-xs text-text-muted mt-1">
            {allJobs.length > 0
              ? `${allJobs.length} session${allJobs.length !== 1 ? 's' : ''} exist outside this range`
              : 'No analysis sessions found'}
          </p>
          {period !== 'all' && (
            <button onClick={() => setPeriod('all')} className="mt-4 text-xs text-teal hover:underline">
              Show all {allJobs.length} sessions →
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
            <PeopleSection jobs={jobs} />
            <DrinkTypeSection jobs={jobs} />
            <BottleSection jobs={jobs} />
            <TableTurnsSection jobs={jobs} />
            <StaffActivitySection jobs={jobs} />
            <TheftSection jobs={jobs} />
            <DetectionEventLog jobs={jobs} />
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
