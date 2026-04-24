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
  Wine, Users, Activity, Search, X, Camera,
  Armchair, UserCheck, Clock,
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

function filterJobs(jobs: VenueScopeJob[], period: Period, bh: BizHours | null | undefined, isDemo = false): VenueScopeJob[] {
  if (period === 'all') return jobs;
  if (isDemo && period === 'today') {
    // Demo bar is always open — "Today" = last 8 hours so the live shift is always visible
    const now = Date.now() / 1000;
    return jobs.filter(j => {
      const t = jobTs(j) || j.createdAt || 0;
      return t >= now - 8 * 3600;
    });
  }
  const { start, end } = periodBounds(period, bh);
  return jobs.filter(j => { const t = jobTs(j); return t >= start && t < end; });
}

function buildStaff(jobs: VenueScopeJob[]): StaffStat[] {
  const map = new Map<string, StaffStat>();

  for (const job of jobs) {
    if (job.bartenderBreakdown) {
      try {
        const bd = JSON.parse(job.bartenderBreakdown) as Record<string, {
          drinks: number; per_hour?: number; over_pours?: number; total_oz?: number;
          drink_types?: Record<string, number>; timestamps?: number[]; drink_scores?: number[];
        }>;

        // Build tSec → bartender lookup from breakdown timestamps (for serveSnapshot attribution)
        const bdLookup = new Map<number, string>();
        for (const [name, d] of Object.entries(bd)) {
          for (const t of d.timestamps ?? []) bdLookup.set(t, name);
        }

        // Count drinks per bartender from serveSnapshots when available.
        // serveSnapshots has one entry per detected drink, matching totalDrinks.
        const snapCounts = new Map<string, number>();
        const snapshots: Record<string, string> = {};
        try {
          if ((job as any).serveSnapshots) Object.assign(snapshots, JSON.parse((job as any).serveSnapshots));
        } catch { /* no-op */ }

        const snapKeys = Object.keys(snapshots);
        if (snapKeys.length > 0 && bdLookup.size > 0) {
          for (const k of snapKeys) {
            const tSec = parseFloat(k);
            let bestName = '';
            let bestDiff = 30;
            for (const [bTSec, name] of bdLookup) {
              const diff = Math.abs(bTSec - tSec);
              if (diff < bestDiff) { bestDiff = diff; bestName = name; }
            }
            if (bestName && bestName !== 'unknown') {
              snapCounts.set(bestName, (snapCounts.get(bestName) ?? 0) + 1);
            }
          }
        }

        for (const [name, d] of Object.entries(bd)) {
          if (!name || name === 'unknown') continue;
          if (!map.has(name)) map.set(name, { name, drinks: 0, shifts: 0, perHour: 0, theftFlags: 0, overPours: 0, totalOz: 0, drinkTypes: {}, shiftDrinks: [] });
          const s = map.get(name)!;
          // Prefer serveSnapshot count (matches totalDrinks), fall back to d.drinks
          const drinkCount = snapCounts.size > 0 ? (snapCounts.get(name) ?? 0) : (d.drinks ?? 0);
          s.drinks     += drinkCount;
          s.shifts     += 1;
          // Sanity-clamp per_hour: the backend occasionally divides drinks by a
          // tiny elapsed window and reports 10k+/hr. No bar does that. Drop
          // anything outside the plausible 0–200 range so the leaderboard
          // shows real numbers instead of astronomical /hr rates.
          const rawPerHour = Number(d.per_hour ?? 0);
          s.perHour    += (rawPerHour > 0 && rawPerHour <= 200) ? rawPerHour : 0;
          s.theftFlags += job.hasTheftFlag ? 1 : 0;
          s.overPours  += d.over_pours ?? 0;
          s.totalOz    += d.total_oz ?? 0;
          for (const [type, cnt] of Object.entries(d.drink_types ?? {})) {
            s.drinkTypes[type] = (s.drinkTypes[type] ?? 0) + cnt;
          }
          s.shiftDrinks.push({ date: job.createdAt ?? 0, drinks: drinkCount, flag: job.hasTheftFlag });
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
      const rawDph = Number(job.drinksPerHour ?? 0);
      s.perHour   += (rawDph > 0 && rawDph <= 200) ? rawDph : 0;
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

  // People count metrics.
  // peakOccupancy = venue-wide max at any one moment across the period. This
  // is the metric the owner actually cares about ("how crowded did it get").
  // uniqueTracked (sum across continuous jobs) double-counts: a continuous job
  // started yesterday shows the same cumulative total in every time window,
  // and a customer who walks past N cameras is counted N times. We stopped
  // summing it as the primary display for that reason.
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
          label: 'Peak Occupancy',
          value: peakOccupancy.toLocaleString(),
          color: 'text-blue-400',
          sub: `across ${jobs.filter(j => (j.peakOccupancy ?? 0) > 0).length} session${jobs.filter(j => (j.peakOccupancy ?? 0) > 0).length !== 1 ? 's' : ''}`,
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
  ts: number;           // epoch seconds (wall clock)
  // Unified feed across every worker-emitted signal — drink serves at the
  // bar, table activity on the floor, server-visit behaviour, etc.
  type: 'drink' | 'people' | 'bottle' | 'pour' | 'theft'
      | 'turn'       // table_turns: a completed seated session
      | 'service'    // table_service: server approached a table
      | 'unvisited'; // table_service: table went >threshold minutes without a visit
  camera: string;
  stat: string;
  detail: string;
  flag?: boolean;
  snapshotKey?: string; // presigned URL or S3 key for frame snapshot
  bartender?: string;
  score?: number;
}

// Resolve a snapshot URL from a key (presigned URL or raw S3 key)
function snapUrl(key: string): string | null {
  if (!key) return null;
  if (key.startsWith('https://')) return key;
  const base = (import.meta.env.VITE_S3_SUMMARY_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/${key}` : null;
}


function buildEvents(jobs: VenueScopeJob[]): DetectionEvent[] {
  const events: DetectionEvent[] = [];

  for (const job of jobs) {
    const cam  = cameraName(job);
    const mode = job.analysisMode ?? '';
    const isDrink = mode === 'drink_count' || (job.activeModes ?? '').includes('drink_count');

    // ── Individual drink serves (one row per serve with snapshot) ──────────
    if (isDrink) {
      // Parse serveSnapshots — the authoritative per-detection source.
      // The worker saves one snapshot per detected drink, so its key count
      // should match totalDrinks. Use this as the primary event source so
      // the log count and VenueScope count agree.
      const snapshots: Record<string, string> = {};
      try {
        if ((job as any).serveSnapshots) Object.assign(snapshots, JSON.parse((job as any).serveSnapshots));
      } catch { /* no-op */ }

      // Build a fast bartender lookup: tSec → { name, score }
      // Used to attribute each snapshot to a bartender (30-second window).
      const bdLookup = new Map<number, { name: string; score: number }>();
      if (job.bartenderBreakdown) {
        try {
          const bd = JSON.parse(job.bartenderBreakdown) as Record<string, {
            timestamps?: number[]; drink_scores?: number[];
          }>;
          for (const [name, d] of Object.entries(bd)) {
            const ts = d.timestamps ?? [];
            const scores = d.drink_scores ?? [];
            for (let i = 0; i < ts.length; i++) {
              bdLookup.set(ts[i], { name, score: scores[i] ?? 0 });
            }
          }
        } catch { /* no-op */ }
      }

      const snapKeys = Object.keys(snapshots);

      if (snapKeys.length > 0) {
        // ── Primary path: one event per snapshot entry ──────────────────
        // Every detection has a snapshot → every row gets a thumbnail.
        for (const k of snapKeys) {
          const tSec = parseFloat(k);
          const wallTime = (job.createdAt ?? 0) + tSec;
          // Find closest bartender within 30-second window
          let bestName = '';
          let bestScore = 0;
          let bestDiff = 30;
          for (const [bTSec, info] of bdLookup) {
            const diff = Math.abs(bTSec - tSec);
            if (diff < bestDiff) { bestDiff = diff; bestName = info.name; bestScore = info.score; }
          }
          events.push({
            ts: wallTime,
            type: 'drink',
            camera: cam,
            stat: '1 drink',
            detail: bestName && bestName !== 'unknown' ? bestName : '',
            snapshotKey: snapshots[k],
            bartender: bestName || undefined,
            score: bestScore || undefined,
          });
        }
      } else if (bdLookup.size > 0) {
        // ── Fallback: no snapshots — use bartenderBreakdown timestamps ──
        if (job.bartenderBreakdown) {
          try {
            const bd = JSON.parse(job.bartenderBreakdown) as Record<string, {
              drinks?: number; per_hour?: number; timestamps?: number[]; drink_scores?: number[];
            }>;
            for (const [name, d] of Object.entries(bd)) {
              const ts = d.timestamps ?? [];
              const scores = d.drink_scores ?? [];
              for (let i = 0; i < ts.length; i++) {
                events.push({
                  ts: (job.createdAt ?? 0) + ts[i],
                  type: 'drink',
                  camera: cam,
                  stat: '1 drink',
                  detail: name && name !== 'unknown' ? name : '',
                  bartender: name || undefined,
                  score: scores[i] ?? undefined,
                });
              }
            }
          } catch { /* no-op */ }
        }
      } else if ((job.totalDrinks ?? 0) > 0) {
        // ── Last resort: single aggregate row ───────────────────────────
        const dph = job.drinksPerHour ? `${job.drinksPerHour.toFixed(0)}/hr` : '';
        events.push({
          ts: jobTs(job),
          type: 'drink',
          camera: cam,
          stat: `${job.totalDrinks} drinks`,
          detail: [dph, job.topBartender].filter(Boolean).join(' · '),
          flag: job.hasTheftFlag,
        });
      }
    }

    // People count events
    if ((mode === 'people_count' || (job.activeModes ?? '').includes('people_count')) && (job.peakOccupancy ?? 0) > 0) {
      const entries = job.totalEntries ?? 0;
      events.push({
        ts: jobTs(job),
        type: 'people',
        camera: cam,
        stat: `${job.peakOccupancy} in frame`,
        detail: entries > 0 ? `${entries} entries` : '',
      });
    }

    // Pour events (renamed from "Bottle count events")
    if ((mode === 'bottle_count' || (job.activeModes ?? '').includes('bottle_count')) && (job.pourCount ?? 0) > 0) {
      const oz = job.totalPouredOz ? ` · ${job.totalPouredOz.toFixed(1)} oz` : '';
      const avg = (job.pourCount ?? 0) > 0 && job.totalPouredOz
        ? ` · ${(job.totalPouredOz / (job.pourCount ?? 1)).toFixed(1)} oz/pour` : '';
      events.push({
        ts: jobTs(job),
        type: 'bottle',
        camera: cam,
        stat: `${job.pourCount} pour${(job.pourCount ?? 1) !== 1 ? 's' : ''}`,
        detail: `${oz}${avg}`.trim().replace(/^·\s*/, ''),
      });
    }

    // Over-pour events
    if ((job.overPours ?? 0) > 0) {
      events.push({
        ts: jobTs(job),
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
        ts: jobTs(job),
        type: 'theft',
        camera: cam,
        stat: `${job.unrungDrinks} unrung`,
        detail: 'Pull NVR footage to verify',
        flag: true,
      });
    }

    // Table turns — one aggregate row per job when turns were logged.
    // The worker stores totalTurns/avgDwellMin/avgResponseSec on each job
    // record; we surface them here so the Detection Events feed shows the
    // dining room's activity, not just the bar.
    if ((mode === 'table_turns' || (job.activeModes ?? '').includes('table_turns'))
        && (job.totalTurns ?? 0) > 0) {
      const dwell = job.avgDwellMin ? ` · avg dwell ${job.avgDwellMin.toFixed(1)}m` : '';
      events.push({
        ts: jobTs(job),
        type: 'turn',
        camera: cam,
        stat: `${job.totalTurns} turn${(job.totalTurns ?? 1) !== 1 ? 's' : ''}`,
        detail: `${dwell}`.trim().replace(/^·\s*/, ''),
      });
    }

    // Server visits — derived from the per-table-per-staff JSON the worker
    // writes under tableVisitsByStaff. We count total visits and surface the
    // top server. Low fidelity compared to per-event logging, but every visit
    // still contributes to the count — good enough for the activity feed.
    if ((mode === 'table_service' || (job.activeModes ?? '').includes('table_service'))
        && job.tableVisitsByStaff) {
      try {
        const byStaff = JSON.parse(job.tableVisitsByStaff) as Record<string, Record<string, number>>;
        let total = 0;
        const perStaff: Record<string, number> = {};
        for (const tableId of Object.keys(byStaff)) {
          for (const [staffId, n] of Object.entries(byStaff[tableId])) {
            total += n;
            perStaff[staffId] = (perStaff[staffId] ?? 0) + n;
          }
        }
        if (total > 0) {
          const topStaff = Object.entries(perStaff).sort((a, b) => b[1] - a[1])[0];
          const respSec = job.avgResponseSec ? ` · avg response ${Math.round(job.avgResponseSec)}s` : '';
          events.push({
            ts: jobTs(job),
            type: 'service',
            camera: cam,
            stat: `${total} visit${total !== 1 ? 's' : ''}`,
            detail: `${topStaff ? topStaff[0] : ''}${respSec}`.trim().replace(/^·\s*/, ''),
          });
        }
      } catch { /* malformed JSON — skip */ }
    }
  }

  return events.sort((a, b) => b.ts - a.ts);
}

const EVENT_META: Record<DetectionEvent['type'], { label: string; color: string; icon: React.ReactNode }> = {
  drink:  { label: 'Drink Detection',  color: 'text-teal',        icon: <Wine className="w-3.5 h-3.5" /> },
  people: { label: 'People Count',     color: 'text-blue-400',    icon: <Users className="w-3.5 h-3.5" /> },
  bottle: { label: 'Bottle Count',     color: 'text-purple-400',  icon: <Activity className="w-3.5 h-3.5" /> },
  pour:   { label: 'Over-Pour Alert',  color: 'text-amber-400',   icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  theft:  { label: 'Theft Flag',       color: 'text-red-400',     icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  turn:      { label: 'Table Turn',      color: 'text-green-400',  icon: <Armchair className="w-3.5 h-3.5" /> },
  service:   { label: 'Server Visit',    color: 'text-sky-400',    icon: <UserCheck className="w-3.5 h-3.5" /> },
  unvisited: { label: 'Unvisited Table', color: 'text-orange-400', icon: <Clock className="w-3.5 h-3.5" /> },
};

const FILTER_OPTIONS: Array<{ key: DetectionEvent['type'] | 'all'; label: string }> = [
  { key: 'all',       label: 'All' },
  { key: 'drink',     label: 'Drinks' },
  { key: 'turn',      label: 'Turns' },
  { key: 'service',   label: 'Service' },
  { key: 'people',    label: 'People' },
  { key: 'bottle',    label: 'Bottles' },
  { key: 'pour',      label: 'Mispours' },
  { key: 'theft',     label: 'Theft' },
  { key: 'unvisited', label: 'Unvisited' },
];

// ── Snap row + modal ──────────────────────────────────────────────────────────

function SnapRow({
  ev,
  meta,
  url,
}: {
  ev: DetectionEvent;
  meta: { label: string; color: string; icon: React.ReactNode };
  url: string | null;
}) {
  const [open, setOpen] = useState(false);

  // Wall-clock time of this serve
  const d = new Date(ev.ts * 1000);
  const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  // NVR reference: show wall-clock time so the owner can pull footage
  const nvrRef = timeStr;

  return (
    <>
      {/* Row — NVR REF column removed: it duplicated the TIME column, and the
          thumbnail already opens the full snapshot on click. */}
      <div
        className="grid items-center gap-2 px-4 py-2.5 hover:bg-whoop-bg/40 transition-colors"
        style={{ gridTemplateColumns: '2.5rem 4.5rem 1fr 1fr' }}
      >
        {/* Thumbnail */}
        <div className="w-10 h-7 rounded overflow-hidden bg-whoop-bg border border-whoop-divider flex-shrink-0 flex items-center justify-center">
          {url ? (
            <button onClick={() => setOpen(true)} className="w-full h-full">
              <img src={url} alt="serve" className="w-full h-full object-cover" />
            </button>
          ) : (
            <Camera className={`w-3.5 h-3.5 ${meta.color} opacity-50`} />
          )}
        </div>

        {/* Time */}
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-white tabular-nums leading-tight">{timeStr}</div>
          <div className="text-[9px] text-text-muted">{dateStr}</div>
        </div>

        {/* Camera */}
        <div className="min-w-0">
          <div className="text-[11px] text-white truncate">{ev.camera}</div>
          {ev.flag && <span className="text-[9px] text-red-400">⚠ flagged</span>}
        </div>

        {/* Bartender */}
        <div className="min-w-0">
          {ev.bartender && ev.bartender !== 'unknown' ? (
            <div className="text-[11px] text-white truncate">{ev.bartender}</div>
          ) : (
            <div className="text-[11px] text-text-muted/50 italic">—</div>
          )}
          {ev.score != null && ev.score > 0 && (
            <div className="text-[9px] text-text-muted">{Math.round(ev.score * 100)}% conf</div>
          )}
        </div>

      </div>

      {/* Expanded snapshot modal */}
      {open && url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative max-w-2xl w-full mx-4 bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-whoop-divider">
              <div>
                <div className="text-sm font-semibold text-white">{ev.camera}</div>
                <div className="text-[11px] text-text-muted">
                  {dateStr} · {timeStr}
                  {ev.bartender && ev.bartender !== 'unknown' && ` · ${ev.bartender}`}
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-text-muted hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Image */}
            <img src={url} alt="serve snapshot" className="w-full object-contain max-h-[60vh]" />
            {/* Footer */}
            <div className="px-4 py-3 border-t border-whoop-divider flex items-center justify-between">
              <span className="text-[11px] text-text-muted">
                Pull NVR footage at <span className="text-white font-semibold">{nvrRef}</span> to verify
              </span>
              {ev.score != null && ev.score > 0 && (
                <span className="text-[10px] text-text-muted">
                  {Math.round(ev.score * 100)}% confidence
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DetectionEventLog({ jobs }: { jobs: VenueScopeJob[] }) {
  const [expanded, setExpanded]   = useState(false);
  const [filter, setFilter]       = useState<DetectionEvent['type'] | 'all'>('all');
  const [search, setSearch]       = useState('');

  const events  = useMemo(() => buildEvents(jobs), [jobs]);

  // Only show filter pills for types that actually have events
  const typesPresent = useMemo(() => new Set(events.map(e => e.type)), [events]);
  const visibleFilters = FILTER_OPTIONS.filter(f => f.key === 'all' || typesPresent.has(f.key));

  const filtered = useMemo(() => {
    let result = filter === 'all' ? events : events.filter(e => e.type === filter);
    const q = search.trim().toLowerCase().replace(/\s+/g, '');
    if (q) {
      result = result.filter(ev => {
        // Normalise all searchable fields into one string (no spaces) for flexible matching.
        // e.g. "8pm" matches "8:00 PM", "blindgoat" matches "Blind Goat", "drink" matches "Drink Detection"
        const hay = [
          fmtTime(ev.ts),
          fmtDate(ev.ts),
          ev.camera,
          ev.stat,
          ev.detail ?? '',
          EVENT_META[ev.type].label,
        ].join(' ').toLowerCase().replace(/\s+/g, '');
        return hay.includes(q);
      });
    }
    return result;
  }, [events, filter, search]);

  // Reset expanded when filter or search changes
  const handleFilter = (key: typeof filter) => { setFilter(key); setExpanded(false); };
  const handleSearch = (v: string) => { setSearch(v); setExpanded(false); };

  if (events.length === 0) return null;

  const visible = expanded ? filtered : filtered.slice(0, 12);
  const isFiltering = filter !== 'all' || search.trim() !== '';

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
        <Activity className="w-4 h-4 text-teal" />
        <span className="text-sm font-semibold text-white">Detection Events</span>
        <span className="ml-auto text-[10px] text-text-muted">
          {filtered.length}{isFiltering ? ` / ${events.length}` : ''} event{events.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Search bar */}
      <div className="px-4 py-2.5 border-b border-whoop-divider/40">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 w-3 h-3 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search by time (8pm, 11:20), camera, or event…"
            className="w-full bg-whoop-bg border border-whoop-divider rounded-lg pl-7 pr-7 py-1.5 text-[11px] text-white placeholder-text-muted/50 focus:outline-none focus:border-teal/50 transition-colors"
          />
          {search && (
            <button onClick={() => handleSearch('')} className="absolute right-2 text-text-muted hover:text-white transition-colors">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
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
        style={{ gridTemplateColumns: '2.5rem 4rem 1fr 1fr' }}>
        <span></span>
        <span>Time</span>
        <span>Camera</span>
        <span>Bartender</span>
      </div>

      {filtered.length === 0 ? (
        <div className="px-4 py-6 text-center text-[11px] text-text-muted">
          {search.trim()
            ? `No events matching "${search.trim()}"`
            : `No ${FILTER_OPTIONS.find(f => f.key === filter)?.label.toLowerCase()} events in this period`}
        </div>
      ) : (
        <div className="divide-y divide-whoop-divider/40">
          {visible.map((ev, i) => {
            const meta = EVENT_META[ev.type];
            const url  = ev.snapshotKey ? snapUrl(ev.snapshotKey) : null;
            return (
              <SnapRow key={i} ev={ev} meta={meta} url={url} />
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

// ── Pour Activity (formerly Bottle Count) ────────────────────────────────────
// Renamed 2026-04-21 per product decision: static "bottles visible on shelf"
// was a useless number to venue owners. What matters is pour events (how many
// pours, how long, how many over-pours, any walk-outs). The underlying worker
// still tracks bottle appearances internally — required to detect pour events
// and walk-outs — but we no longer surface the raw count.

function BottleSection({ jobs }: { jobs: VenueScopeJob[] }) {
  const hasPours = jobs.some(j => (j.pourCount ?? 0) > 0);
  if (!hasPours) return null;

  const totalPours   = jobs.reduce((s, j) => s + (j.pourCount ?? 0), 0);
  const totalOz      = jobs.reduce((s, j) => s + (j.totalPouredOz ?? 0), 0);
  const overPours    = jobs.reduce((s, j) => s + (j.overPours ?? 0), 0);
  const avgOzPerPour = totalPours > 0 ? (totalOz / totalPours) : 0;

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
        <span className="text-base">🥃</span>
        <span className="text-sm font-semibold text-white">Pour Activity</span>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Pours',       value: totalPours,                         color: 'text-white' },
            { label: 'Oz Poured',   value: totalOz.toFixed(1),                 color: 'text-white' },
            { label: 'Avg / Pour',  value: `${avgOzPerPour.toFixed(1)} oz`,    color: 'text-white' },
            { label: 'Over-pours',  value: overPours,                          color: overPours > 0 ? 'text-amber-400' : 'text-emerald-400' },
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
  const [period, setPeriod]           = useState<Period>('today');
  const [allJobs, setAllJobs]         = useState<VenueScopeJob[]>([]);
  const [loading, setLoading]         = useState(true);
  const [avgDrinkPrice, setAvgDrinkPrice] = useState(() => isDemo ? 14 : 0);
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
      // Include live/running jobs so Today tab shows in-progress shift data.
      // Deduplicate stable live records (~prefix) by camera key — keep the one
      // with the highest totalDrinks so today's running count is always visible.
      setAllJobs(raw);
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

  const jobs = useMemo(() => filterJobs(allJobs, period, businessHours, isDemo), [allJobs, period, businessHours, isDemo]);

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
