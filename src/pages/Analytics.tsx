/**
 * Analytics Page - Date-Based Reporting System
 *
 * Bar owners select one or more past dates and see a full shift report:
 * overview tiles, theft alerts, room breakdown, drink stats, staff performance.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  RefreshCw, Download, Calendar, AlertTriangle, User, Video, Award, ShieldCheck,
} from 'lucide-react';
import { format } from 'date-fns';
import { PullToRefresh } from '../components/common/PullToRefresh';
import { useDisplayName } from '../hooks/useDisplayName';
import authService from '../services/auth.service';
import venueScopeService, { VenueScopeJob } from '../services/venuescope.service';
import { haptic } from '../utils/haptics';

// ── Shift Grade ───────────────────────────────────────────────────────────────
function gradeShift(job: VenueScopeJob, avgDrinksPerShift: number): { grade: string; color: string } {
  let score = 0;
  if (!job.hasTheftFlag) score += 40;
  score += Math.round((job.confidenceScore ?? 50) * 0.3);
  if (avgDrinksPerShift > 0) {
    const ratio = (job.totalDrinks ?? 0) / avgDrinksPerShift;
    score += Math.min(30, Math.round(ratio * 20));
  } else {
    score += 20;
  }
  if (score >= 85) return { grade: 'A', color: 'text-emerald-400' };
  if (score >= 70) return { grade: 'B', color: 'text-teal' };
  if (score >= 55) return { grade: 'C', color: 'text-amber-400' };
  if (score >= 40) return { grade: 'D', color: 'text-orange-400' };
  return { grade: 'F', color: 'text-red-400' };
}

// ── Shift History ─────────────────────────────────────────────────────────────
function ShiftHistory({ jobs }: { jobs: VenueScopeJob[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? jobs : jobs.slice(0, 6);
  const avgDrinksPerShift = jobs.length
    ? Math.round(jobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0) / jobs.length)
    : 0;

  if (jobs.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-whoop-divider">
        <div className="flex items-center gap-2">
          <Video className="w-4 h-4 text-teal" />
          <span className="text-sm font-semibold text-white">Shift History</span>
          <span className="text-xs text-warm-500 bg-warm-800 px-1.5 py-0.5 rounded">{jobs.length}</span>
        </div>
      </div>

      <div className="divide-y divide-whoop-divider">
        {visible.map((job) => {
          const date = job.createdAt
            ? new Date(job.createdAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '—';
          const time = job.createdAt
            ? new Date(job.createdAt * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : '';
          const dph = job.drinksPerHour != null ? job.drinksPerHour.toFixed(0) : '—';
          const confidenceColors: Record<string, string> = {
            green:  'text-emerald-400',
            yellow: 'text-amber-400',
            red:    'text-red-400',
          };

          const { grade, color: gradeColor } = gradeShift(job, avgDrinksPerShift);

          return (
            <div key={job.jobId} className="flex items-center gap-3 px-4 py-3 hover:bg-warm-800/30 transition-colors">
              {/* Date */}
              <div className="w-14 flex-shrink-0">
                <div className="text-xs font-semibold text-white">{date}</div>
                <div className="text-[10px] text-warm-500">{time}</div>
              </div>

              {/* Label */}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-warm-300 truncate">
                  {job.roomLabel || job.clipLabel || job.jobId.slice(0, 10)}
                </div>
                {job.topBartender && (
                  <div className="text-[10px] text-warm-500 truncate">
                    <User className="w-2.5 h-2.5 inline mr-0.5" />{job.topBartender}
                  </div>
                )}
              </div>

              {/* Drinks */}
              <div className="text-center flex-shrink-0 w-12">
                <div className="text-sm font-bold text-teal">{job.totalDrinks ?? 0}</div>
                <div className="text-[9px] text-warm-500">{dph}/hr</div>
              </div>

              {/* Grade */}
              <span className={`text-sm font-bold w-6 text-center flex-shrink-0 ${gradeColor}`}>{grade}</span>

              {/* Theft / clean */}
              <div className="flex-shrink-0 w-16 text-right">
                {job.hasTheftFlag ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-400 bg-red-500/10 border border-red-500/20 rounded px-1.5 py-0.5">
                    <AlertTriangle className="w-2.5 h-2.5" />
                    {job.unrungDrinks ? `${job.unrungDrinks} unrung` : 'Flag'}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                    <ShieldCheck className="w-2.5 h-2.5" />
                    Clean
                  </span>
                )}
              </div>

              {/* Confidence */}
              <div className={`flex-shrink-0 text-[10px] font-semibold w-10 text-right ${confidenceColors[job.confidenceColor] ?? 'text-warm-400'}`}>
                {job.confidenceScore ? `${job.confidenceScore}%` : job.confidenceLabel || '—'}
              </div>
            </div>
          );
        })}
      </div>

      {jobs.length > 6 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center justify-center gap-1 py-2.5 text-xs text-warm-500 hover:text-warm-300 border-t border-whoop-divider transition-colors"
        >
          {expanded ? 'Show less' : `Show all ${jobs.length} shifts`}
        </button>
      )}
    </motion.div>
  );
}

// ── Staff Leaderboard ─────────────────────────────────────────────────────────
function StaffLeaderboard({ jobs }: { jobs: VenueScopeJob[] }) {
  const stats: Record<string, { drinks: number; shifts: number; theftShifts: number }> = {};

  jobs.forEach(job => {
    if (job.bartenderBreakdown) {
      try {
        const bd = JSON.parse(job.bartenderBreakdown) as Record<string, { drinks: number }>;
        Object.entries(bd).forEach(([name, data]) => {
          if (!stats[name]) stats[name] = { drinks: 0, shifts: 0, theftShifts: 0 };
          stats[name].drinks += data.drinks ?? 0;
          stats[name].shifts += 1;
          if (job.hasTheftFlag) stats[name].theftShifts += 1;
        });
        return;
      } catch { /* fall through */ }
    }
    if (job.topBartender) {
      const name = job.topBartender;
      if (!stats[name]) stats[name] = { drinks: 0, shifts: 0, theftShifts: 0 };
      stats[name].drinks += job.totalDrinks ?? 0;
      stats[name].shifts += 1;
      if (job.hasTheftFlag) stats[name].theftShifts += 1;
    }
  });

  const leaders = Object.entries(stats)
    .map(([name, s]) => ({ name, ...s, avg: s.shifts ? Math.round(s.drinks / s.shifts) : 0 }))
    .sort((a, b) => b.drinks - a.drinks)
    .slice(0, 5);

  if (leaders.length === 0) return null;

  const rankColors = ['text-amber-400', 'text-slate-300', 'text-amber-700', 'text-warm-400', 'text-warm-400'];
  const rankIcons  = ['🥇', '🥈', '🥉', '4', '5'];
  const maxDrinks  = leaders[0]?.drinks ?? 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
        <Award className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-white">Staff Performance</span>
        <span className="text-[10px] text-warm-500 ml-auto">Period totals</span>
      </div>

      <div className="p-4 space-y-3">
        {leaders.map((person, i) => {
          const barPct = (person.drinks / maxDrinks) * 100;
          return (
            <div key={person.name}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm w-5 text-center">{rankIcons[i]}</span>
                  <span className="text-sm text-white font-medium">{person.name}</span>
                  {person.theftShifts > 0 && (
                    <span className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-1">
                      {person.theftShifts} flag{person.theftShifts > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className={`text-sm font-bold ${rankColors[i]}`}>{person.drinks.toLocaleString()}</span>
                  <span className="text-[10px] text-warm-500 ml-1">drinks</span>
                </div>
              </div>
              <div className="h-1.5 bg-warm-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-slate-300' : 'bg-teal/60'}`}
                  style={{ width: `${barPct}%` }}
                />
              </div>
              <div className="flex justify-between mt-0.5">
                <span className="text-[9px] text-warm-600">{person.shifts} shift{person.shifts !== 1 ? 's' : ''}</span>
                <span className="text-[9px] text-warm-600">{person.avg} avg/shift</span>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Revenue Recovery Card ─────────────────────────────────────────────────────
const AVG_DRINK_PRICE = 8;

function RevenueRecovery({ jobs }: { jobs: VenueScopeJob[] }) {
  const totalUnrung = jobs.reduce((s, j) => s + (j.unrungDrinks ?? 0), 0);
  const recovered = totalUnrung * AVG_DRINK_PRICE;
  const flaggedShifts = jobs.filter(j => j.hasTheftFlag).length;

  if (totalUnrung === 0 && flaggedShifts === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-whoop-panel border-l-4 border-l-teal border border-whoop-divider rounded-2xl p-4"
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-teal/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <ShieldCheck className="w-4 h-4 text-teal" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-white">Revenue Protection</p>
          <p className="text-xs text-warm-300 mt-1">
            VenueScope flagged{' '}
            <span className="text-teal font-semibold">${recovered.toLocaleString()}</span>{' '}
            in potential theft this period.
          </p>
          {totalUnrung > 0 && (
            <p className="text-[11px] text-warm-500 mt-0.5">
              {totalUnrung} unrung drink{totalUnrung !== 1 ? 's' : ''} across{' '}
              {flaggedShifts} shift{flaggedShifts !== 1 ? 's' : ''} × ${AVG_DRINK_PRICE} avg drink price
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── DateRangePicker ───────────────────────────────────────────────────────────
function DateRangePicker({
  selectedDates,
  onChange,
  quickRange,
  onQuickRange,
}: {
  selectedDates: Set<string>;
  onChange: (dates: Set<string>) => void;
  quickRange: string;
  onQuickRange: (r: 'yesterday' | '7days' | 'custom') => void;
}) {
  // Build a Set of valid date strings for the past 30 days (today excluded)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  const validDates = new Set<string>();
  for (let i = 1; i <= 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    validDates.add(d.toISOString().slice(0, 10));
  }

  const yesterdayStr = (() => {
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    return y.toISOString().slice(0, 10);
  })();

  // Build calendar: start from Sunday on/before (today - 30 days)
  const oldest = new Date(today);
  oldest.setDate(today.getDate() - 30);
  const gridStart = new Date(oldest);
  gridStart.setDate(oldest.getDate() - oldest.getDay()); // back to Sunday

  // Build weeks array cleanly
  const weeks: string[][] = [];
  const cursor = new Date(gridStart);
  while (cursor < today) {
    const week: string[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  function toggleDate(dateStr: string) {
    const next = new Set(selectedDates);
    if (next.has(dateStr)) next.delete(dateStr);
    else next.add(dateStr);
    onChange(next);
    onQuickRange('custom');
  }

  // Month label: track per-render with a ref-like accumulator inside the map
  let renderedMonth = -1;

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4 space-y-3">
      {/* Quick buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onQuickRange('yesterday')}
          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
            quickRange === 'yesterday'
              ? 'bg-teal text-white'
              : 'bg-warm-800 text-warm-400 hover:text-white border border-warm-700'
          }`}
        >
          Yesterday
        </button>
        <button
          onClick={() => onQuickRange('7days')}
          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
            quickRange === '7days'
              ? 'bg-teal text-white'
              : 'bg-warm-800 text-warm-400 hover:text-white border border-warm-700'
          }`}
        >
          Last 7 Days
        </button>
        {selectedDates.size > 0 && (
          <span className="ml-auto text-xs text-warm-500">
            {selectedDates.size} day{selectedDates.size !== 1 ? 's' : ''} selected
          </span>
        )}
      </div>

      {/* Calendar */}
      <div>
        {/* Day-of-week header */}
        <div className="grid grid-cols-7 mb-1">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
            <div key={d} className="text-center text-[10px] text-warm-600 font-medium py-1">{d}</div>
          ))}
        </div>

        {weeks.map((week, wi) => {
          // Show month label when month changes within the visible range
          const firstValidInWeek = week.find(ds => validDates.has(ds));
          let monthLabel: string | null = null;
          if (firstValidInWeek) {
            const m = new Date(firstValidInWeek + 'T12:00:00').getMonth();
            if (m !== renderedMonth) {
              monthLabel = new Date(firstValidInWeek + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
              renderedMonth = m;
            }
          }

          return (
            <div key={wi}>
              {monthLabel && (
                <div className="text-[10px] text-warm-500 font-semibold mt-2 mb-0.5 px-0.5">{monthLabel}</div>
              )}
              <div className="grid grid-cols-7">
                {week.map((dateStr) => {
                  const isValid = validDates.has(dateStr);
                  const isSelected = selectedDates.has(dateStr);
                  const isYesterday = dateStr === yesterdayStr;
                  const dayNum = new Date(dateStr + 'T12:00:00').getDate();

                  if (!isValid) {
                    // Outside the 30-day window — render blank placeholder
                    return (
                      <div key={dateStr} className="flex items-center justify-center h-9">
                        <span className="text-xs text-warm-800">{dayNum}</span>
                      </div>
                    );
                  }

                  const isFuture = dateStr >= todayStr;

                  return (
                    <div key={dateStr} className="flex items-center justify-center h-9">
                      <button
                        disabled={isFuture}
                        onClick={() => toggleDate(dateStr)}
                        className={`
                          w-8 h-8 flex items-center justify-center text-xs rounded-full font-medium transition-all
                          ${isFuture ? 'text-warm-700 cursor-not-allowed' : ''}
                          ${isSelected ? 'bg-teal text-white shadow-sm' : ''}
                          ${!isSelected && !isFuture ? 'text-warm-300 hover:bg-warm-700 hover:text-white' : ''}
                          ${isYesterday && !isSelected ? 'ring-1 ring-teal/50' : ''}
                        `}
                      >
                        {dayNum}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ReportView ────────────────────────────────────────────────────────────────
function ReportView({ jobs, selectedDates }: { jobs: VenueScopeJob[]; selectedDates: Set<string> }) {
  const peopleCntJobs = jobs.filter(j => (j.analysisMode ?? '') === 'people_count' || (j.analysisMode ?? '').includes('people'));
  const drinkCntJobs  = jobs.filter(j => (j.analysisMode ?? '') === 'drink_count'  || (j.analysisMode ?? '').includes('drink'));

  // Section A — Overview tiles
  const totalGuestsIn  = peopleCntJobs.reduce((s, j) => s + (j.totalEntries ?? 0), 0)
    || jobs.reduce((s, j) => s + (j.totalEntries ?? 0), 0);

  let peakOcc = 0;
  let peakTime = '';
  jobs.forEach(j => {
    if ((j.peakOccupancy ?? 0) > peakOcc) {
      peakOcc = j.peakOccupancy ?? 0;
      peakTime = j.createdAt ? format(new Date(j.createdAt * 1000), 'h:mm a') : '';
    }
  });

  const dwellJobs = jobs.filter(j => j.avgDwellMin != null);
  const avgDwell = dwellJobs.length
    ? Math.round(dwellJobs.reduce((s, j) => s + (j.avgDwellMin ?? 0), 0) / dwellJobs.length)
    : null;

  const totalDrinks = drinkCntJobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0)
    || jobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0);

  // Section B — Theft alerts
  const theftJobs = jobs.filter(j => j.hasTheftFlag);

  // Section C — Room-by-room
  const roomMap = new Map<string, VenueScopeJob[]>();
  jobs.forEach(j => {
    const room = j.roomLabel || j.cameraLabel || 'Unknown Room';
    if (!roomMap.has(room)) roomMap.set(room, []);
    roomMap.get(room)!.push(j);
  });

  // Section D — Drink stats by bar (drink_count jobs only)
  const barMap = new Map<string, VenueScopeJob[]>();
  drinkCntJobs.forEach(j => {
    const bar = j.roomLabel || j.cameraLabel || 'Unknown Bar';
    if (!barMap.has(bar)) barMap.set(bar, []);
    barMap.get(bar)!.push(j);
  });

  const dateLabel = selectedDates.size === 1
    ? format(new Date([...selectedDates][0] + 'T12:00:00'), 'MMMM d, yyyy')
    : `${selectedDates.size} days`;

  return (
    <div className="space-y-6">
      <style>{`@media print { .no-print { display: none; } }`}</style>

      {/* Report title */}
      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl px-5 py-4">
        <p className="text-xs text-warm-500 uppercase tracking-wider font-semibold">Shift Report</p>
        <h2 className="text-lg font-bold text-white mt-0.5">{dateLabel}</h2>
        <p className="text-xs text-warm-500 mt-0.5">{jobs.length} session{jobs.length !== 1 ? 's' : ''} analyzed</p>
      </div>

      {/* Section A — Overview tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Guests In */}
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4 text-center">
          <div className="text-2xl font-bold text-white tabular-nums">{totalGuestsIn > 0 ? totalGuestsIn.toLocaleString() : '—'}</div>
          <div className="text-[11px] text-warm-500 mt-1 uppercase tracking-wider">Guests In</div>
        </div>
        {/* Peak Occupancy */}
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4 text-center">
          <div className="text-2xl font-bold text-white tabular-nums">{peakOcc > 0 ? peakOcc : '—'}</div>
          <div className="text-[11px] text-warm-500 mt-1 uppercase tracking-wider">Peak Occupancy</div>
          {peakTime && <div className="text-[10px] text-warm-600 mt-0.5">{peakTime}</div>}
        </div>
        {/* Avg Dwell */}
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4 text-center">
          <div className="text-2xl font-bold text-white tabular-nums">{avgDwell != null ? `${avgDwell}m` : '—'}</div>
          <div className="text-[11px] text-warm-500 mt-1 uppercase tracking-wider">Avg Dwell</div>
        </div>
        {/* Total Drinks */}
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4 text-center">
          <div className="text-2xl font-bold text-teal tabular-nums">{totalDrinks > 0 ? totalDrinks.toLocaleString() : '—'}</div>
          <div className="text-[11px] text-warm-500 mt-1 uppercase tracking-wider">Total Drinks</div>
        </div>
      </div>

      {/* Section B — Theft Alerts */}
      {theftJobs.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-red-500/20">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-bold text-red-400">Theft Alerts</span>
            <span className="text-[10px] text-red-500 bg-red-500/10 border border-red-500/20 rounded px-1.5 py-0.5 font-semibold">
              {theftJobs.length} shift{theftJobs.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="divide-y divide-red-500/10">
            {theftJobs.map(job => {
              const cameraName = job.roomLabel || job.cameraLabel || 'Camera';
              const timeStr = job.createdAt ? format(new Date(job.createdAt * 1000), 'h:mm a') : '—';
              return (
                <div key={job.jobId} className="px-4 py-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">{cameraName}</span>
                    <span className="text-xs text-warm-400">{timeStr}</span>
                  </div>
                  {job.unrungDrinks != null && job.unrungDrinks > 0 && (
                    <p className="text-xs text-red-300">
                      {job.unrungDrinks} unrung drink{job.unrungDrinks !== 1 ? 's' : ''} detected
                    </p>
                  )}
                  <p className="text-[11px] text-warm-500">
                    Review {cameraName} footage around {timeStr} on your NVR/DVR
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Revenue protection summary */}
      <RevenueRecovery jobs={jobs} />

      {/* Section C — Room-by-Room Breakdown */}
      {roomMap.size > 0 && (
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
            <Video className="w-4 h-4 text-teal" />
            <span className="text-sm font-semibold text-white">Room-by-Room Breakdown</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-whoop-divider">
                  <th className="text-left px-4 py-2 text-warm-500 font-semibold">Room</th>
                  <th className="text-left px-3 py-2 text-warm-500 font-semibold">Mode</th>
                  <th className="text-center px-3 py-2 text-warm-500 font-semibold">Guests In</th>
                  <th className="text-center px-3 py-2 text-warm-500 font-semibold">Peak</th>
                  <th className="text-center px-3 py-2 text-warm-500 font-semibold">Dwell</th>
                  <th className="text-center px-3 py-2 text-warm-500 font-semibold">Drinks</th>
                  <th className="text-center px-3 py-2 text-warm-500 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-whoop-divider">
                {[...roomMap.entries()].map(([room, rJobs]) => {
                  const rGuests   = rJobs.reduce((s, j) => s + (j.totalEntries ?? 0), 0);
                  const rPeak     = Math.max(...rJobs.map(j => j.peakOccupancy ?? 0));
                  const rDwellJs  = rJobs.filter(j => j.avgDwellMin != null);
                  const rDwell    = rDwellJs.length
                    ? Math.round(rDwellJs.reduce((s, j) => s + (j.avgDwellMin ?? 0), 0) / rDwellJs.length)
                    : null;
                  const rDrinks   = rJobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
                  const rTheft    = rJobs.some(j => j.hasTheftFlag);
                  const rMode     = rJobs[0]?.analysisMode ?? 'drink_count';
                  const isDrink   = rMode.includes('drink');

                  return (
                    <tr key={room} className="hover:bg-warm-800/20 transition-colors">
                      <td className="px-4 py-2.5 text-white font-medium">{room}</td>
                      <td className="px-3 py-2.5">
                        {isDrink
                          ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal/20 text-teal border border-teal/30">Drink Count</span>
                          : <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">People Count</span>
                        }
                      </td>
                      <td className="px-3 py-2.5 text-center text-warm-300">{rGuests > 0 ? rGuests : '—'}</td>
                      <td className="px-3 py-2.5 text-center text-warm-300">{rPeak > 0 ? rPeak : '—'}</td>
                      <td className="px-3 py-2.5 text-center text-warm-300">{rDwell != null ? `${rDwell}m` : '—'}</td>
                      <td className="px-3 py-2.5 text-center font-semibold text-teal">{rDrinks > 0 ? rDrinks : '—'}</td>
                      <td className="px-3 py-2.5 text-center">
                        {rTheft
                          ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-400 bg-red-500/10 border border-red-500/20 rounded px-1.5 py-0.5"><AlertTriangle className="w-2.5 h-2.5" />Theft</span>
                          : <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400"><ShieldCheck className="w-2.5 h-2.5" />Clean</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section D — Drink Stats by Bar */}
      {barMap.size > 0 && (
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
            <ShieldCheck className="w-4 h-4 text-teal" />
            <span className="text-sm font-semibold text-white">Drink Stats by Bar</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-whoop-divider">
                  <th className="text-left px-4 py-2 text-warm-500 font-semibold">Bar / Camera</th>
                  <th className="text-center px-3 py-2 text-warm-500 font-semibold">Total Drinks</th>
                  <th className="text-center px-3 py-2 text-warm-500 font-semibold">Rate (drinks/hr)</th>
                  <th className="text-left px-3 py-2 text-warm-500 font-semibold">Top Bartender</th>
                  <th className="text-center px-3 py-2 text-warm-500 font-semibold">Theft</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-whoop-divider">
                {[...barMap.entries()].map(([bar, bJobs]) => {
                  const bDrinks = bJobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
                  const bRate   = bJobs.reduce((s, j) => s + (j.drinksPerHour ?? 0), 0) / bJobs.length;
                  const bTop    = bJobs.find(j => j.topBartender)?.topBartender ?? '—';
                  const bTheft  = bJobs.some(j => j.hasTheftFlag);
                  return (
                    <tr key={bar} className="hover:bg-warm-800/20 transition-colors">
                      <td className="px-4 py-2.5 text-white font-medium">{bar}</td>
                      <td className="px-3 py-2.5 text-center font-bold text-teal">{bDrinks}</td>
                      <td className="px-3 py-2.5 text-center text-warm-300">{isNaN(bRate) ? '—' : bRate.toFixed(1)}</td>
                      <td className="px-3 py-2.5 text-warm-300">{bTop}</td>
                      <td className="px-3 py-2.5 text-center">
                        {bTheft
                          ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-400"><AlertTriangle className="w-2.5 h-2.5" />Yes</span>
                          : <span className="text-[10px] text-emerald-400">No</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section E — Staff Performance */}
      <StaffLeaderboard jobs={jobs} />

      {/* Section F — Shift History detail */}
      <ShiftHistory jobs={jobs} />

      {/* Section G — Print/Download */}
      <div className="no-print flex justify-center pt-2">
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-5 py-2.5 bg-teal text-white rounded-xl font-semibold text-sm hover:bg-teal/90 transition-colors"
        >
          <Download className="w-4 h-4" /> Download / Print Report
        </button>
      </div>
    </div>
  );
}

// ── Helper: bar-day date key ──────────────────────────────────────────────────
function jobDateKey(job: VenueScopeJob): string {
  // Bar day starts at noon — jobs between midnight and noon belong to prior calendar day
  const d = new Date((job.createdAt ?? 0) * 1000);
  if (d.getHours() < 12) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Analytics (main export) ───────────────────────────────────────────────────
export function Analytics() {
  useDisplayName(); // keep import alive

  // Date picker state
  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return new Set([y.toISOString().slice(0, 10)]);
  });
  const [quickRange, setQuickRange] = useState<'yesterday' | '7days' | 'custom'>('yesterday');

  // VenueScope jobs state
  const [allVsJobs, setAllVsJobs] = useState<VenueScopeJob[]>([]);
  const [vsLoading, setVsLoading] = useState(true);
  const [loading, setLoading] = useState(false);

  const loadJobs = useCallback(async () => {
    const venueId = authService.getStoredUser()?.venueId ?? '';
    if (!venueId) { setVsLoading(false); return; }
    setVsLoading(true);
    try {
      const jobs = await venueScopeService.listJobs(venueId, 200);
      setAllVsJobs(jobs.filter(j => !j.isLive));
    } finally {
      setVsLoading(false);
    }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const handleRefresh = async () => {
    haptic('medium');
    setLoading(true);
    await loadJobs();
    setLoading(false);
  };

  const reportJobs = allVsJobs.filter(j => !j.isLive && selectedDates.has(jobDateKey(j)));

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="space-y-4 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Reports</h1>
            <p className="text-xs text-text-secondary mt-0.5">
              {selectedDates.size === 1
                ? format(new Date([...selectedDates][0] + 'T12:00:00'), 'MMMM d, yyyy')
                : `${selectedDates.size} days selected`}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            className="p-2 rounded-lg bg-warm-800 border border-warm-700 text-warm-400 hover:text-white transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading || vsLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Date Picker — no-print */}
        <div className="no-print">
          <DateRangePicker
            selectedDates={selectedDates}
            onChange={dates => { setSelectedDates(dates); setQuickRange('custom'); }}
            quickRange={quickRange}
            onQuickRange={(r) => {
              setQuickRange(r);
              const today = new Date();
              if (r === 'yesterday') {
                const y = new Date(today);
                y.setDate(y.getDate() - 1);
                setSelectedDates(new Set([y.toISOString().slice(0, 10)]));
              } else if (r === '7days') {
                const dates = new Set<string>();
                for (let i = 1; i <= 7; i++) {
                  const d = new Date(today);
                  d.setDate(d.getDate() - i);
                  dates.add(d.toISOString().slice(0, 10));
                }
                setSelectedDates(dates);
              }
            }}
          />
        </div>

        {/* Report */}
        {vsLoading ? (
          <div className="text-center py-12 text-warm-500">Loading report...</div>
        ) : reportJobs.length === 0 ? (
          <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-8 text-center">
            <Calendar className="w-8 h-8 text-warm-600 mx-auto mb-3" />
            <p className="text-warm-400 font-medium">No data for selected date{selectedDates.size > 1 ? 's' : ''}</p>
            <p className="text-xs text-warm-600 mt-1">Try selecting a different date range</p>
          </div>
        ) : (
          <ReportView jobs={reportJobs} selectedDates={selectedDates} />
        )}
      </div>
    </PullToRefresh>
  );
}
