/**
 * VenueScope — CCTV Analytics Dashboard
 *
 * Owner-focused view: tonight's hero numbers → live room cameras →
 * bartender leaderboard → theft alerts → collapsed history.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Video, ShieldCheck, AlertTriangle, RefreshCw,
  Clock, User, BarChart3,
  Camera, Loader2, X, Download,
  ChevronDown, ChevronUp, FileText,
  Activity, Users, Zap, DollarSign,
} from 'lucide-react';
import authService from '../services/auth.service';
import venueScopeService, { VenueScopeJob, parseModes } from '../services/venuescope.service';
import venueSettingsService from '../services/venue-settings.service';
import { isDemoAccount, generateDemoVenueScopeJobs } from '../utils/demoData';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function fmtDuration(created: number, finished: number): string {
  if (!created || !finished) return '—';
  const secs = Math.round(finished - created);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function fmtElapsed(secs: number): string {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function ConfidenceBadge({ color, label }: { color: string; label: string }) {
  const cls =
    color === 'green' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
    color === 'red'   ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                        'bg-amber-500/20 text-amber-400 border-amber-500/30';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>
      <BarChart3 className="w-2.5 h-2.5" />
      {label || 'Unknown'}
    </span>
  );
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCsv(jobs: VenueScopeJob[]) {
  const headers = [
    'Room', 'Status', 'Mode', 'Bartender',
    'Total Drinks', 'Drinks/Hr', 'Unrung', 'Theft Flag',
    'Entries', 'Peak Occupancy', 'Created',
  ];
  const rows = jobs.map(j => [
    j.roomLabel || j.cameraLabel || '',
    j.status, j.analysisMode || '',
    j.topBartender || '',
    j.totalDrinks ?? 0, j.drinksPerHour?.toFixed(1) ?? '',
    j.unrungDrinks ?? 0, j.hasTheftFlag ? 'YES' : 'no',
    j.totalEntries ?? 0, j.peakOccupancy ?? 0,
    j.createdAt ? new Date(j.createdAt * 1000).toISOString() : '',
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `venuescope_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Bartender aggregation ─────────────────────────────────────────────────────

interface BartenderStat {
  name: string;
  drinks: number;
  perHour: number;
  hasTheft: boolean;
}

function aggregateBartenders(jobs: VenueScopeJob[]): BartenderStat[] {
  const map = new Map<string, BartenderStat>();

  for (const job of jobs) {
    // Try bartenderBreakdown JSON first (most detailed)
    if (job.bartenderBreakdown) {
      try {
        const bd = JSON.parse(job.bartenderBreakdown) as Record<string, { drinks?: number; total_drinks?: number; per_hour?: number; drinks_per_hour?: number }>;
        for (const [name, d] of Object.entries(bd)) {
          if (!name || name === 'Unknown') continue;
          const drinks = d.drinks ?? d.total_drinks ?? 0;
          const perHour = d.per_hour ?? d.drinks_per_hour ?? 0;
          const existing = map.get(name);
          if (!existing) {
            map.set(name, { name, drinks, perHour, hasTheft: job.hasTheftFlag && job.topBartender === name });
          } else {
            existing.drinks += drinks;
            existing.perHour = Math.max(existing.perHour, perHour);
            if (job.hasTheftFlag && job.topBartender === name) existing.hasTheft = true;
          }
        }
        continue;
      } catch { /* fall through to topBartender */ }
    }
    // Fallback: just use topBartender + totalDrinks
    const name = job.topBartender;
    if (name && name !== 'Unknown') {
      const existing = map.get(name);
      if (!existing) {
        map.set(name, { name, drinks: job.totalDrinks ?? 0, perHour: job.drinksPerHour ?? 0, hasTheft: job.hasTheftFlag });
      } else {
        existing.drinks += job.totalDrinks ?? 0;
        existing.perHour = Math.max(existing.perHour, job.drinksPerHour ?? 0);
        if (job.hasTheftFlag) existing.hasTheft = true;
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.drinks - a.drinks);
}

// ── Room grouping ─────────────────────────────────────────────────────────────

interface RoomSummary {
  label: string;
  isLive: boolean;
  mode: string;
  // drink_count
  totalDrinks: number;
  drinksPerHour: number;
  topBartender: string;
  hasTheftFlag: boolean;
  unrungDrinks: number;
  // people_count
  currentOccupancy: number;
  peakOccupancy: number;
  totalEntries: number;
  // meta
  elapsedSec: number;
  updatedAt: number;
  job: VenueScopeJob;
}

function buildRooms(jobs: VenueScopeJob[]): RoomSummary[] {
  // Group by roomLabel (fall back to cameraLabel → jobId prefix)
  const map = new Map<string, VenueScopeJob[]>();
  for (const job of jobs) {
    const key = job.roomLabel || job.cameraLabel || job.jobId.slice(0, 12);
    const arr = map.get(key) ?? [];
    arr.push(job);
    map.set(key, arr);
  }

  return Array.from(map.entries()).map(([label, roomJobs]) => {
    // Prefer live jobs, then most recent
    const best = roomJobs.find(j => j.isLive) ?? roomJobs[0];
    const modes = parseModes(best);
    const isDrink  = modes.includes('drink_count');
    const isPeople = modes.includes('people_count');

    // Aggregate across all done+live jobs for this room
    const totalDrinks   = roomJobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
    const totalEntries  = roomJobs.reduce((s, j) => s + (j.totalEntries ?? 0), 0);
    const peakOccupancy = Math.max(...roomJobs.map(j => j.peakOccupancy ?? 0), 0);
    const currentOcc    = best.isLive
      ? Math.max(0, (best.totalEntries ?? 0) - (best.totalExits ?? 0))
      : 0;

    return {
      label,
      isLive: best.isLive ?? false,
      mode: isDrink ? 'drink_count' : isPeople ? 'people_count' : (best.analysisMode ?? 'unknown'),
      totalDrinks,
      drinksPerHour: best.drinksPerHour ?? 0,
      topBartender: best.topBartender ?? '',
      hasTheftFlag: roomJobs.some(j => j.hasTheftFlag),
      unrungDrinks: roomJobs.reduce((s, j) => s + (j.unrungDrinks ?? 0), 0),
      currentOccupancy: currentOcc,
      peakOccupancy,
      totalEntries,
      elapsedSec: best.elapsedSec ?? 0,
      updatedAt: best.updatedAt ?? best.createdAt ?? 0,
      job: best,
    };
  }).sort((a, b) => {
    // Live rooms first, then by most drinks
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return b.totalDrinks - a.totalDrinks;
  });
}

// ── Theft investigation modal ─────────────────────────────────────────────────

function TheftModal({ job, avgDrinkPrice, onClose }: { job: VenueScopeJob; avgDrinkPrice: number; onClose: () => void }) {
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="bg-whoop-panel border border-red-500/30 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
          initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
          onClick={e => e.stopPropagation()}
        >
          <div className="p-5 border-b border-whoop-divider flex items-start justify-between">
            <div>
              <h2 className="text-white font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                Theft Investigation
              </h2>
              <p className="text-xs text-text-muted mt-0.5">
                {job.roomLabel || job.clipLabel || job.jobId} · {fmtTime(job.createdAt)}
              </p>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-4 gap-3">
              {[
                { v: job.unrungDrinks ?? 0, l: 'Unrung', c: 'text-red-400' },
                { v: job.totalDrinks ?? 0,  l: 'Total',  c: 'text-white' },
                { v: `${job.totalDrinks ? Math.round(((job.unrungDrinks ?? 0) / job.totalDrinks) * 100) : 0}%`, l: 'Rate', c: 'text-amber-400' },
                { v: `$${((job.unrungDrinks ?? 0) * avgDrinkPrice).toFixed(0)}`, l: 'Est. Loss', c: 'text-red-400' },
              ].map(({ v, l, c }) => (
                <div key={l} className="bg-whoop-bg rounded-xl p-3 text-center">
                  <div className={`text-xl font-bold ${c}`}>{v}</div>
                  <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">{l}</div>
                </div>
              ))}
            </div>
            {job.topBartender && (
              <div className="bg-whoop-bg rounded-xl px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-text-muted flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Flagged bartender</span>
                <span className="text-sm font-semibold text-white">{job.topBartender}</span>
              </div>
            )}
            <div>
              <h3 className="text-xs font-semibold text-white mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Next Steps
              </h3>
              <ul className="space-y-1.5 text-xs text-text-secondary">
                {[
                  'Review the annotated video clip for the flagged serves',
                  'Cross-reference with POS transaction log for this shift',
                  `Check bartender ${job.topBartender || 'Unknown'}'s total ring count vs detected drinks`,
                  'Compare opening/closing register totals',
                  'Document findings in incident report',
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full border border-whoop-divider flex-shrink-0 flex items-center justify-center text-[9px] text-text-muted mt-0.5">{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Tonight hero numbers ──────────────────────────────────────────────────────

function TonightHero({ jobs, avgDrinkPrice }: { jobs: VenueScopeJob[]; avgDrinkPrice: number }) {
  const totalDrinks    = jobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
  const totalEntries   = jobs.reduce((s, j) => s + (j.totalEntries ?? 0), 0);
  const totalExits     = jobs.reduce((s, j) => s + (j.totalExits   ?? 0), 0);
  const liveJobs       = jobs.filter(j => j.isLive);
  // Net line-crossings from entrance camera (most accurate — requires people_count mode)
  const netLineCount   = totalEntries > 0 ? Math.max(0, totalEntries - totalExits) : 0;
  // Fallback: sum peakOccupancy across ALL live jobs (guest-only counts from bar cameras, updated every 30s)
  const liveCamOccupancy = liveJobs.reduce((s, j) => s + (j.peakOccupancy ?? 0), 0);
  const currentOccupancy = netLineCount > 0 ? netLineCount : liveCamOccupancy;
  const occupancyIsEntrance = netLineCount > 0;
  const theftCount     = jobs.filter(j => j.hasTheftFlag).length;
  const unrung         = jobs.reduce((s, j) => s + (j.unrungDrinks ?? 0), 0);
  const estRevenue     = totalDrinks * avgDrinkPrice;

  // Drinks/hr: weighted avg across live jobs that have a rate
  const liveJobsWithRate = liveJobs.filter(j => (j.drinksPerHour ?? 0) > 0);
  const pace = liveJobsWithRate.length > 0
    ? liveJobsWithRate.reduce((s, j) => s + (j.drinksPerHour ?? 0), 0) / liveJobsWithRate.length
    : null;

  const stats = [
    {
      icon: <Zap className="w-4 h-4" />,
      value: totalDrinks.toString(),
      label: 'Drinks Today',
      color: 'text-teal',
      bg: 'bg-teal/10 border-teal/20',
      iconColor: 'text-teal',
    },
    {
      icon: <Users className="w-4 h-4" />,
      value: currentOccupancy > 0 ? currentOccupancy.toString() : '—',
      label: 'Current Occupancy',
      color: 'text-white',
      bg: 'bg-whoop-panel border-whoop-divider',
      iconColor: 'text-text-muted',
      sub: currentOccupancy > 0
        ? (occupancyIsEntrance ? 'door count · live' : 'bar area visible')
        : 'add entrance camera for full count',
    },
    {
      icon: <DollarSign className="w-4 h-4" />,
      value: estRevenue > 0 ? `$${Math.round(estRevenue).toLocaleString()}` : '—',
      label: 'Est. Revenue',
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/5 border-emerald-500/20',
      iconColor: 'text-emerald-400',
      sub: pace != null ? `${pace.toFixed(1)}/hr pace` : undefined,
    },
    theftCount > 0
      ? {
          icon: <AlertTriangle className="w-4 h-4" />,
          value: theftCount.toString(),
          label: `Alert${theftCount !== 1 ? 's' : ''} · $${(unrung * avgDrinkPrice).toFixed(0)} est.`,
          color: 'text-red-400',
          bg: 'bg-red-500/10 border-red-500/30',
          iconColor: 'text-red-400',
        }
      : {
          icon: <ShieldCheck className="w-4 h-4" />,
          value: 'Clean',
          label: 'No Theft Flags',
          color: 'text-emerald-400',
          bg: 'bg-emerald-500/5 border-emerald-500/20',
          iconColor: 'text-emerald-400',
        },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map(({ icon, value, label, color, bg, iconColor, sub }) => (
        <div key={label} className={`border rounded-2xl p-4 ${bg}`}>
          <div className={`w-7 h-7 rounded-lg bg-black/20 flex items-center justify-center mb-3 ${iconColor}`}>
            {icon}
          </div>
          <div className={`text-3xl font-bold ${color} leading-none`}>{value}</div>
          <div className="text-[10px] text-text-muted uppercase tracking-wide mt-1.5">{label}</div>
          {sub && <div className="text-[10px] text-text-muted mt-0.5">{sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Live room card ────────────────────────────────────────────────────────────

function RoomCard({ room, onInvestigate }: { room: RoomSummary; onInvestigate: (job: VenueScopeJob) => void }) {
  const isDrink  = room.mode === 'drink_count';
  const isPeople = room.mode === 'people_count';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-whoop-panel border rounded-2xl p-4 space-y-3 ${
        room.hasTheftFlag ? 'border-red-500/40' : room.isLive ? 'border-teal/30' : 'border-whoop-divider'
      }`}
    >
      {/* Room header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
            room.isLive ? 'bg-teal/15' : 'bg-whoop-bg'
          }`}>
            <Camera className={`w-3.5 h-3.5 ${room.isLive ? 'text-teal' : 'text-text-muted'}`} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{room.label || 'Camera'}</p>
            <p className="text-[10px] text-text-muted capitalize">{room.mode.replace(/_/g, ' ')}</p>
          </div>
        </div>
        {room.isLive ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal/20 text-teal border border-teal/30 flex-shrink-0">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-teal" />
            </span>
            Live
          </span>
        ) : (
          <span className="text-[10px] text-text-muted flex-shrink-0">{fmtTime(room.updatedAt)}</span>
        )}
      </div>

      {/* Primary metrics */}
      {isDrink && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
            <div className="text-xl font-bold text-teal">{room.totalDrinks}</div>
            <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Drinks</div>
          </div>
          <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
            <div className="text-xl font-bold text-white">
              {room.drinksPerHour > 0 ? room.drinksPerHour.toFixed(1) : '—'}
            </div>
            <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Per Hour</div>
          </div>
          <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
            <div className={`text-xl font-bold ${room.unrungDrinks > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {room.unrungDrinks}
            </div>
            <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Unrung</div>
          </div>
        </div>
      )}

      {isPeople && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
            <div className="text-xl font-bold text-teal">{room.currentOccupancy || room.peakOccupancy}</div>
            <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">
              {room.isLive ? 'In Room' : 'Peak'}
            </div>
          </div>
          <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
            <div className="text-xl font-bold text-white">{room.totalEntries}</div>
            <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">In</div>
          </div>
          <div className="bg-whoop-bg rounded-xl p-2.5 text-center">
            <div className="text-xl font-bold text-white">{room.peakOccupancy}</div>
            <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Peak</div>
          </div>
        </div>
      )}

      {!isDrink && !isPeople && (
        <div className="bg-whoop-bg rounded-xl p-3 text-center">
          <div className="text-xs text-text-muted capitalize">{room.mode.replace(/_/g, ' ')}</div>
          {room.elapsedSec > 0 && (
            <div className="text-[10px] text-text-muted mt-0.5">{fmtElapsed(room.elapsedSec)} elapsed</div>
          )}
        </div>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between text-[10px] text-text-muted">
        {isDrink && room.topBartender ? (
          <span className="flex items-center gap-1">
            <User className="w-3 h-3" />
            {room.topBartender}
          </span>
        ) : room.elapsedSec > 0 ? (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {fmtElapsed(room.elapsedSec)}
          </span>
        ) : <span />}

        {room.hasTheftFlag ? (
          <button
            onClick={() => onInvestigate(room.job)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
          >
            <AlertTriangle className="w-2.5 h-2.5" />
            Review
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-emerald-400">
            <ShieldCheck className="w-3 h-3" />
            Clean
          </span>
        )}
      </div>
    </motion.div>
  );
}

// ── Bartender leaderboard ─────────────────────────────────────────────────────

function BartenderBoard({ bartenders }: { bartenders: BartenderStat[] }) {
  if (bartenders.length === 0) return null;
  const max = bartenders[0].drinks || 1;

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-teal" />
          Behind the Bar
        </h2>
        <span className="text-[10px] text-text-muted bg-whoop-bg border border-whoop-divider px-2 py-0.5 rounded-full">
          {bartenders.length} bartender{bartenders.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="space-y-3">
        {bartenders.map((b, i) => (
          <div key={b.name} className="flex items-center gap-3">
            <span className="text-[10px] text-text-muted w-4 text-right flex-shrink-0">{i + 1}</span>
            <div className="w-7 h-7 rounded-full bg-whoop-bg border border-whoop-divider flex items-center justify-center flex-shrink-0">
              <User className="w-3.5 h-3.5 text-text-muted" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-white truncate">{b.name}</span>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  <span className="text-xs font-bold text-teal">{b.drinks}</span>
                  <span className="text-[10px] text-text-muted">drinks</span>
                  {b.perHour > 0 && (
                    <span className="text-[10px] text-text-muted ml-1">{b.perHour.toFixed(1)}/hr</span>
                  )}
                  {b.hasTheft && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30">
                      <AlertTriangle className="w-2 h-2" />
                      Alert
                    </span>
                  )}
                </div>
              </div>
              <div className="w-full bg-whoop-bg rounded-full h-1">
                <div
                  className={`h-1 rounded-full transition-all duration-700 ${b.hasTheft ? 'bg-red-400' : 'bg-teal'}`}
                  style={{ width: `${(b.drinks / max) * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Theft alert panel ─────────────────────────────────────────────────────────

function TheftAlerts({ jobs, avgDrinkPrice, onInvestigate }: {
  jobs: VenueScopeJob[];
  avgDrinkPrice: number;
  onInvestigate: (job: VenueScopeJob) => void;
}) {
  const flagged = jobs.filter(j => j.hasTheftFlag);
  if (flagged.length === 0) return null;
  const totalLoss = flagged.reduce((s, j) => s + (j.unrungDrinks ?? 0) * avgDrinkPrice, 0);

  return (
    <div className="bg-red-500/5 border border-red-500/30 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          Theft Alerts
        </h2>
        <span className="text-xs text-red-400 font-semibold">
          ~${totalLoss.toFixed(0)} est. loss
        </span>
      </div>
      <div className="space-y-2">
        {flagged.map(job => (
          <div key={job.jobId} className="bg-whoop-bg border border-red-500/20 rounded-xl px-3 py-2.5 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">
                {job.roomLabel || job.clipLabel || job.cameraLabel || 'Camera'}
              </p>
              <p className="text-[10px] text-text-muted mt-0.5">
                {job.unrungDrinks ?? 0} unrung · {fmtTime(job.createdAt)}
                {job.topBartender ? ` · ${job.topBartender}` : ''}
              </p>
            </div>
            <button
              onClick={() => onInvestigate(job)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors flex-shrink-0 ml-3"
            >
              Investigate
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── History accordion ─────────────────────────────────────────────────────────

function Row({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="flex justify-between text-text-muted">
      <span>{label}</span>
      <span className={color ?? 'text-text-secondary'}>{value}</span>
    </div>
  );
}

function HistoryAccordion({ jobs, onInvestigate, onExport }: {
  jobs: VenueScopeJob[];
  onInvestigate: (job: VenueScopeJob) => void;
  onExport: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (jobs.length === 0) return null;

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-text-secondary hover:text-white transition-colors"
      >
        <span className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5" />
          Job History ({jobs.length})
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={e => { e.stopPropagation(); onExport(); }}
            className="text-[10px] text-text-muted hover:text-teal transition-colors flex items-center gap-1"
          >
            <Download className="w-3 h-3" />
            CSV
          </button>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-whoop-divider divide-y divide-whoop-divider">
              {jobs.map(job => (
                <HistoryRow key={job.jobId} job={job} onInvestigate={onInvestigate} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HistoryRow({ job, onInvestigate }: {
  job: VenueScopeJob;
  onInvestigate: (j: VenueScopeJob) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const modes = parseModes(job);
  const isLive = job.isLive || job.status === 'running';

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Camera className={`w-3.5 h-3.5 flex-shrink-0 ${isLive ? 'text-teal' : 'text-text-muted'}`} />
          <div className="min-w-0">
            <p className="text-sm text-white truncate">
              {job.roomLabel || job.cameraLabel || job.clipLabel || job.jobId.slice(-8)}
            </p>
            <p className="text-[10px] text-text-muted">{fmtTime(job.createdAt)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isLive ? (
            <span className="text-[10px] text-teal flex items-center gap-1">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              Live
            </span>
          ) : (
            <>
              {(job.totalDrinks ?? 0) > 0 && (
                <span className="text-xs font-semibold text-teal">{job.totalDrinks} drinks</span>
              )}
              {(job.totalEntries ?? 0) > 0 && (
                <span className="text-xs text-text-secondary">{job.totalEntries} in</span>
              )}
            </>
          )}
          {job.hasTheftFlag && (
            <button onClick={() => onInvestigate(job)} className="text-red-400 hover:text-red-300 transition-colors">
              <AlertTriangle className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-text-muted hover:text-white transition-colors"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 pt-3 border-t border-whoop-divider space-y-1.5 text-[10px] pl-6">
              {modes.includes('drink_count') && (
                <>
                  <Row label="Total drinks"  value={job.totalDrinks ?? 0} />
                  <Row label="Drinks / hr"   value={job.drinksPerHour?.toFixed(1) ?? '—'} />
                  <Row label="Unrung"        value={job.unrungDrinks ?? 0} color={(job.unrungDrinks ?? 0) > 0 ? 'text-amber-400' : undefined} />
                  {job.topBartender && <Row label="Bartender"   value={job.topBartender} />}
                </>
              )}
              {modes.includes('people_count') && (
                <>
                  <Row label="Entries"       value={job.totalEntries ?? 0} />
                  <Row label="Peak occupancy" value={job.peakOccupancy ?? 0} />
                </>
              )}
              <Row label="Duration" value={fmtDuration(job.createdAt, job.finishedAt)} />
              <ConfidenceBadge color={job.confidenceColor} label={job.confidenceLabel} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ venueId }: { venueId: string }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-sm w-full text-center"
      >
        <div className="w-14 h-14 rounded-2xl bg-teal/10 border border-teal/20 flex items-center justify-center mx-auto mb-4">
          <Video className="w-7 h-7 text-teal" />
        </div>
        <h2 className="text-white font-semibold mb-2">No results yet</h2>
        <p className="text-sm text-text-secondary">
          Results will appear here automatically once your cameras start processing.
        </p>
        {venueId && (
          <p className="text-[10px] text-text-muted mt-3 font-mono opacity-60">
            querying: {venueId}
          </p>
        )}
      </motion.div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 10_000;

export function VenueScope() {
  const venueId = authService.getStoredUser()?.venueId || '';
  const [jobs, setJobs]               = useState<VenueScopeJob[]>([]);
  const [loading, setLoading]         = useState(true);
  const [avgDrinkPrice, setAvgDrinkPrice] = useState(() => venueSettingsService.getAvgDrinkPrice(venueId));
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [newToast, setNewToast]       = useState<string | null>(null);
  const [investigating, setInvestigating] = useState<VenueScopeJob | null>(null);
  const [nextPollIn, setNextPollIn]   = useState(POLL_INTERVAL_MS / 1000);
  const knownIds    = useRef<Set<string>>(new Set());
  const pollTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const isDemo = isDemoAccount(venueId);

  const load = useCallback(async (silent = false) => {
    if (!venueId) return;
    if (!silent) setLoading(true);
    const data = isDemo
      ? generateDemoVenueScopeJobs()
      : await venueScopeService.listJobs(venueId, 100);

    // Toast for new completed jobs
    if (knownIds.current.size > 0) {
      const incoming = data.filter(j => !knownIds.current.has(j.jobId) && j.status === 'done');
      if (incoming.length > 0) {
        const label = incoming[0].roomLabel || incoming[0].clipLabel || incoming[0].jobId.slice(0, 8);
        setNewToast(incoming.length === 1 ? `New result: ${label}` : `${incoming.length} new results`);
        setTimeout(() => setNewToast(null), 5000);
      }
    }
    data.forEach(j => knownIds.current.add(j.jobId));

    setJobs(data);
    setLastRefresh(new Date());
    if (!silent) setLoading(false);
  }, [venueId, isDemo]);

  useEffect(() => {
    if (!venueId) return;
    venueSettingsService.loadSettingsFromCloud(venueId).then(s => {
      if (s?.avgDrinkPrice) setAvgDrinkPrice(s.avgDrinkPrice);
    });
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  // Demo: simulate a new job after 20s
  useEffect(() => {
    if (!isDemo) return;
    const t = setTimeout(() => {
      setNewToast('New result: Main Bar — Today');
      setTimeout(() => setNewToast(null), 5000);
    }, 20_000);
    return () => clearTimeout(t);
  }, [isDemo]);

  // Auto-poll
  useEffect(() => {
    pollTimer.current = setInterval(() => {
      if (document.visibilityState === 'visible') { load(true); setNextPollIn(POLL_INTERVAL_MS / 1000); }
    }, POLL_INTERVAL_MS);
    countdownTimer.current = setInterval(() => {
      if (document.visibilityState === 'visible') setNextPollIn(n => n <= 1 ? POLL_INTERVAL_MS / 1000 : n - 1);
    }, 1000);
    const onVis = () => { if (document.visibilityState === 'visible') { load(true); setNextPollIn(POLL_INTERVAL_MS / 1000); } };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if (pollTimer.current)    clearInterval(pollTimer.current);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  // "Tonight" = after midnight local time (bar shifts that started today)
  const todayStart  = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime() / 1000; }, []);
  // Guard against null/undefined entries that AppSync occasionally returns
  const safeJobs    = useMemo(() => jobs.filter((j): j is VenueScopeJob => j != null && typeof j === 'object'), [jobs]);
  const tonightJobs = useMemo(() => safeJobs.filter(j => (j.createdAt ?? 0) >= todayStart || j.isLive), [safeJobs, todayStart]);
  const olderJobs   = useMemo(() => safeJobs.filter(j => (j.createdAt ?? 0) < todayStart && !j.isLive), [safeJobs, todayStart]);

  const allRooms    = useMemo(() => { try { return buildRooms(tonightJobs); } catch(e) { console.error('[VenueScope] buildRooms error:', e); return []; } }, [tonightJobs]);
  const liveRooms   = useMemo(() => allRooms.filter(r => r.isLive), [allRooms]);
  const doneRooms   = useMemo(() => allRooms.filter(r => !r.isLive), [allRooms]);
  const bartenders  = useMemo(() => { try { return aggregateBartenders(tonightJobs); } catch(e) { console.error('[VenueScope] aggregateBartenders error:', e); return []; } }, [tonightJobs]);
  // History = today's completed rooms + all older jobs
  const historyJobs = useMemo(() => [
    ...doneRooms.map(r => r.job),
    ...olderJobs,
  ], [doneRooms, olderJobs]);

  return (
    <div className="space-y-6">
      {/* Theft investigation modal */}
      {investigating && (
        <TheftModal job={investigating} avgDrinkPrice={avgDrinkPrice} onClose={() => setInvestigating(null)} />
      )}

      {/* New-job toast */}
      <AnimatePresence>
        {newToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-teal text-black text-sm font-semibold rounded-2xl shadow-lg flex items-center gap-2"
          >
            <div className="w-2 h-2 rounded-full bg-black/30 animate-ping" />
            {newToast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal/10 border border-teal/20 flex items-center justify-center">
            <Video className="w-4.5 h-4.5 text-teal" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">VenueScope</h1>
            <p className="text-xs text-text-muted">Live CCTV analytics</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-text-muted">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-teal" />
            </span>
            {lastRefresh
              ? `Updated ${lastRefresh.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
              : 'Syncing…'}
            {' '}· {nextPollIn}s
          </div>
          <motion.button
            onClick={() => load()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-whoop-panel border border-whoop-divider text-sm text-text-secondary rounded-xl hover:border-teal/40 transition-colors disabled:opacity-50"
            whileTap={{ scale: 0.97 }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </motion.button>
        </div>
      </div>

      {/* Body */}
      {loading && jobs.length === 0 ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <RefreshCw className="w-6 h-6 text-text-muted animate-spin" />
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState venueId={venueId} />
      ) : (
        <>
          {/* 1. Today's hero numbers */}
          {tonightJobs.length > 0 && (
            <TonightHero jobs={tonightJobs} avgDrinkPrice={avgDrinkPrice} />
          )}

          {/* 2. Live cameras only */}
          {liveRooms.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-teal uppercase tracking-wider">Cameras Live Now</span>
                <span className="text-[10px] text-teal bg-teal/10 border border-teal/20 px-1.5 py-0.5 rounded-full">
                  {liveRooms.length} live
                </span>
                <div className="h-px flex-1 bg-teal/20" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {liveRooms.map(room => (
                  <RoomCard key={room.label} room={room} onInvestigate={setInvestigating} />
                ))}
              </div>
            </div>
          )}

          {/* 3. Bartender leaderboard */}
          {bartenders.length > 0 && (
            <BartenderBoard bartenders={bartenders} />
          )}

          {/* 4. Theft alerts */}
          {tonightJobs.some(j => j.hasTheftFlag) && (
            <TheftAlerts
              jobs={tonightJobs.filter(j => j.hasTheftFlag)}
              avgDrinkPrice={avgDrinkPrice}
              onInvestigate={setInvestigating}
            />
          )}

          {/* 5. History — completed tonight + all older jobs */}
          <HistoryAccordion
            jobs={historyJobs}
            onInvestigate={setInvestigating}
            onExport={() => exportCsv(jobs)}
          />
        </>
      )}
    </div>
  );
}

export default VenueScope;
