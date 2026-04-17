/**
 * BartenderProfiles — Cross-shift performance dashboard
 *
 * Views:
 *  - Leaderboard: ranked table with risk badges
 *  - Individual: trend chart, theft timeline, shift history
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserCheck, RefreshCw, Download, AlertTriangle, Shield,
  TrendingUp, User, ChevronUp, ChevronDown, Clock,
  Award, BarChart3, Activity,
} from 'lucide-react';
import authService from '../services/auth.service';
import bartenderProfilesService, { BartenderProfile } from '../services/bartender-profiles.service';
import { isDemoAccount } from '../utils/demoData';

// ── Demo profiles ──────────────────────────────────────────────────────────────

function makeDemoBartenderProfiles(venueId: string): BartenderProfile[] {
  const now = new Date();

  function shiftDate(daysAgo: number): string {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(22, 0, 0, 0);
    return d.toISOString();
  }

  // Marcus Williams — top performer, 18 shifts, clean
  const marcus: BartenderProfile = {
    venueId,
    bartenderId: 'demo-marcus',
    name: 'Marcus',
    displayName: 'Marcus Williams',
    totalShifts: 18,
    totalDrinks: 389,
    totalHours: 126,
    avgDrinksPerHour: 11.4,
    peakDrinksPerHour: 14.7,
    theftFlags: 0,
    lastSeen: shiftDate(1),
    avgIdlePct: 14,
    tableVisits: 127,
    createdAt: shiftDate(90),
    updatedAt: shiftDate(1),
    shiftHistory: [
      { date: shiftDate(1),  jobId: 'demo-100', drinks: 91, perHour: 11.4, durationHours: 8.0, hasTheft: false, avgIdlePct: 12, tableVisits: 14 },
      { date: shiftDate(2),  jobId: 'demo-202', drinks: 83, perHour: 12.1, durationHours: 6.9, hasTheft: false, avgIdlePct: 11, tableVisits: 12 },
      { date: shiftDate(3),  jobId: 'demo-207', drinks: 38, perHour:  9.5, durationHours: 4.0, hasTheft: false, avgIdlePct: 16, tableVisits:  8 },
      { date: shiftDate(4),  jobId: 'demo-209', drinks: 35, perHour:  8.8, durationHours: 4.0, hasTheft: false, avgIdlePct: 18, tableVisits:  7 },
      { date: shiftDate(5),  jobId: 'demo-214', drinks: 57, perHour: 11.4, durationHours: 5.0, hasTheft: false, avgIdlePct: 13, tableVisits: 11 },
      { date: shiftDate(7),  jobId: 'demo-h07', drinks: 88, perHour: 12.6, durationHours: 7.0, hasTheft: false, avgIdlePct: 12, tableVisits: 13 },
      { date: shiftDate(9),  jobId: 'demo-h09', drinks: 44, perHour: 11.0, durationHours: 4.0, hasTheft: false, avgIdlePct: 15, tableVisits:  9 },
      { date: shiftDate(10), jobId: 'demo-h10', drinks: 76, perHour: 12.7, durationHours: 6.0, hasTheft: false, avgIdlePct: 11, tableVisits: 12 },
      { date: shiftDate(11), jobId: 'demo-h11', drinks: 29, perHour:  9.7, durationHours: 3.0, hasTheft: false, avgIdlePct: 17, tableVisits:  7 },
      { date: shiftDate(12), jobId: 'demo-h12', drinks: 81, perHour: 13.5, durationHours: 6.0, hasTheft: false, avgIdlePct: 10, tableVisits: 14 },
      { date: shiftDate(14), jobId: 'demo-h14', drinks: 92, perHour: 14.7, durationHours: 6.3, hasTheft: false, avgIdlePct: 10, tableVisits: 15 },
      { date: shiftDate(16), jobId: 'demo-h16', drinks: 54, perHour: 10.8, durationHours: 5.0, hasTheft: false, avgIdlePct: 14, tableVisits: 10 },
      { date: shiftDate(17), jobId: 'demo-h17', drinks: 67, perHour: 11.2, durationHours: 6.0, hasTheft: false, avgIdlePct: 13, tableVisits: 11 },
      { date: shiftDate(18), jobId: 'demo-h18', drinks: 49, perHour: 12.3, durationHours: 4.0, hasTheft: false, avgIdlePct: 15, tableVisits:  9 },
    ],
  };

  // Priya Patel — solid #2 performer, 16 shifts, clean
  const priya: BartenderProfile = {
    venueId,
    bartenderId: 'demo-priya',
    name: 'Priya',
    displayName: 'Priya Patel',
    totalShifts: 16,
    totalDrinks: 312,
    totalHours: 108,
    avgDrinksPerHour: 8.6,
    peakDrinksPerHour: 11.2,
    theftFlags: 0,
    lastSeen: shiftDate(1),
    avgIdlePct: 22,
    tableVisits: 98,
    createdAt: shiftDate(90),
    updatedAt: shiftDate(1),
    shiftHistory: [
      { date: shiftDate(1),  jobId: 'demo-100', drinks: 67, perHour:  8.4, durationHours: 8.0, hasTheft: false, avgIdlePct: 20, tableVisits: 11 },
      { date: shiftDate(2),  jobId: 'demo-203', drinks: 44, perHour:  8.8, durationHours: 5.0, hasTheft: false, avgIdlePct: 22, tableVisits:  9 },
      { date: shiftDate(2),  jobId: 'demo-201', drinks: 29, perHour:  9.7, durationHours: 3.0, hasTheft: false, avgIdlePct: 18, tableVisits:  7 },
      { date: shiftDate(4),  jobId: 'demo-205', drinks: 55, perHour:  9.2, durationHours: 6.0, hasTheft: false, avgIdlePct: 21, tableVisits: 10 },
      { date: shiftDate(5),  jobId: 'demo-207', drinks: 72, perHour: 10.3, durationHours: 7.0, hasTheft: false, avgIdlePct: 19, tableVisits: 12 },
      { date: shiftDate(7),  jobId: 'demo-211', drinks: 79, perHour: 11.2, durationHours: 7.1, hasTheft: false, avgIdlePct: 18, tableVisits: 13 },
      { date: shiftDate(9),  jobId: 'demo-h09', drinks: 48, perHour:  8.0, durationHours: 6.0, hasTheft: false, avgIdlePct: 23, tableVisits:  9 },
      { date: shiftDate(10), jobId: 'demo-h10', drinks: 61, perHour:  8.7, durationHours: 7.0, hasTheft: false, avgIdlePct: 22, tableVisits: 10 },
      { date: shiftDate(11), jobId: 'demo-h11', drinks: 34, perHour:  8.5, durationHours: 4.0, hasTheft: false, avgIdlePct: 24, tableVisits:  7 },
      { date: shiftDate(12), jobId: 'demo-h12', drinks: 58, perHour:  9.7, durationHours: 6.0, hasTheft: false, avgIdlePct: 20, tableVisits: 10 },
      { date: shiftDate(14), jobId: 'demo-h14', drinks: 71, perHour: 10.1, durationHours: 7.0, hasTheft: false, avgIdlePct: 21, tableVisits: 11 },
      { date: shiftDate(16), jobId: 'demo-h16', drinks: 44, perHour:  8.8, durationHours: 5.0, hasTheft: false, avgIdlePct: 23, tableVisits:  8 },
    ],
  };

  // Jordan Lee — flagged, 10 shifts, 1 theft incident
  const jordan: BartenderProfile = {
    venueId,
    bartenderId: 'demo-jordan',
    name: 'Jordan',
    displayName: 'Jordan Lee',
    totalShifts: 10,
    totalDrinks: 162,
    totalHours: 68,
    avgDrinksPerHour: 3.8,
    peakDrinksPerHour: 9.1,
    theftFlags: 1,
    lastSeen: shiftDate(1),
    avgIdlePct: 38,
    tableVisits: 42,
    createdAt: shiftDate(60),
    updatedAt: shiftDate(1),
    shiftHistory: [
      { date: shiftDate(1),  jobId: 'demo-100', drinks:  4, perHour:  0.5, durationHours: 8.0, hasTheft: true,  avgIdlePct: 72, tableVisits:  2 },
      { date: shiftDate(3),  jobId: 'demo-206', drinks: 61, perHour:  9.1, durationHours: 6.7, hasTheft: false, avgIdlePct: 24, tableVisits:  9 },
      { date: shiftDate(5),  jobId: 'demo-208', drinks: 48, perHour:  8.0, durationHours: 6.0, hasTheft: false, avgIdlePct: 28, tableVisits:  8 },
      { date: shiftDate(7),  jobId: 'demo-213', drinks: 38, perHour:  7.6, durationHours: 5.0, hasTheft: false, avgIdlePct: 31, tableVisits:  6 },
      { date: shiftDate(9),  jobId: 'demo-h09', drinks: 42, perHour:  7.0, durationHours: 6.0, hasTheft: false, avgIdlePct: 33, tableVisits:  7 },
      { date: shiftDate(11), jobId: 'demo-h11', drinks: 35, perHour:  7.0, durationHours: 5.0, hasTheft: false, avgIdlePct: 35, tableVisits:  6 },
      { date: shiftDate(13), jobId: 'demo-h13', drinks: 28, perHour:  7.0, durationHours: 4.0, hasTheft: false, avgIdlePct: 39, tableVisits:  5 },
    ],
  };

  return [marcus, priya, jordan];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function fmtHours(h: number): string {
  if (!h) return '0h';
  return h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`;
}

function idleColor(pct: number): string {
  if (pct < 20) return 'text-emerald-400';
  if (pct <= 40) return 'text-amber-400';
  return 'text-red-400';
}

function idleBg(pct: number): string {
  if (pct < 20) return 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400';
  if (pct <= 40) return 'bg-amber-500/15 border-amber-500/30 text-amber-400';
  return 'bg-red-500/15 border-red-500/30 text-red-400';
}

function rankBadge(i: number): string {
  if (i === 0) return '🥇';
  if (i === 1) return '🥈';
  if (i === 2) return '🥉';
  return `#${i + 1}`;
}

// ── CSV export ─────────────────────────────────────────────────────────────────

function exportProfilesCsv(profiles: BartenderProfile[]) {
  const headers = [
    'Name', 'Total Shifts', 'Total Drinks', 'Total Hours',
    'Avg Drinks/hr', 'Peak Drinks/hr', 'Theft Flags',
    'Avg Idle %', 'Table Visits', 'Last Seen',
  ];
  const rows = profiles.map(p => [
    p.displayName || p.name,
    p.totalShifts,
    p.totalDrinks,
    p.totalHours.toFixed(1),
    p.avgDrinksPerHour.toFixed(2),
    p.peakDrinksPerHour.toFixed(2),
    p.theftFlags,
    p.avgIdlePct.toFixed(1),
    p.tableVisits,
    p.lastSeen,
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `bartender_profiles_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Mini bar chart (no external lib) ──────────────────────────────────────────

function TrendChart({ entries, maxBars = 14 }: {
  entries: BartenderProfile['shiftHistory'];
  maxBars?: number;
}) {
  const recent = entries.slice(-maxBars);
  if (recent.length === 0) {
    return <p className="text-xs text-text-muted py-4 text-center">No shift history available.</p>;
  }
  const maxVal = Math.max(...recent.map(e => e.perHour), 1);

  return (
    <div className="flex items-end gap-1.5 h-20">
      {recent.map((entry, i) => {
        const heightPct = (entry.perHour / maxVal) * 100;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none z-10">
              <div className="bg-whoop-panel border border-whoop-divider rounded-lg px-2 py-1 text-[10px] whitespace-nowrap shadow-lg">
                <p className="text-white font-semibold">{entry.perHour.toFixed(1)}/hr</p>
                <p className="text-text-muted">{entry.drinks} drinks</p>
                <p className="text-text-muted">{fmtDate(entry.date)}</p>
              </div>
              <div className="w-1.5 h-1.5 bg-whoop-panel border-r border-b border-whoop-divider rotate-45 -mt-0.5" />
            </div>
            <div className="w-full rounded-t-sm flex items-end overflow-hidden bg-teal/10" style={{ height: '52px' }}>
              <motion.div
                className={`w-full rounded-t-sm ${entry.hasTheft ? 'bg-red-400' : 'bg-teal'}`}
                initial={{ height: 0 }}
                animate={{ height: `${heightPct}%` }}
                transition={{ delay: i * 0.03, type: 'spring', stiffness: 300, damping: 28 }}
              />
            </div>
            <span className="text-[8px] text-text-muted truncate w-full text-center">
              {new Date(entry.date).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Shift history table ────────────────────────────────────────────────────────

type ShiftSortKey = 'date' | 'drinks' | 'perHour' | 'durationHours' | 'avgIdlePct' | 'tableVisits';

function ShiftHistoryTable({ entries }: { entries: BartenderProfile['shiftHistory'] }) {
  const [sortKey, setSortKey]   = useState<ShiftSortKey>('date');
  const [sortAsc, setSortAsc]   = useState(false);

  const sorted = useMemo(() => {
    const copy = [...entries].slice(0, 30);
    copy.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === 'string' && typeof vb === 'string') {
        return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      const na = Number(va); const nb = Number(vb);
      return sortAsc ? na - nb : nb - na;
    });
    return copy;
  }, [entries, sortKey, sortAsc]);

  if (sorted.length === 0) return null;

  const toggleSort = (key: ShiftSortKey) => {
    if (sortKey === key) { setSortAsc(a => !a); } else { setSortKey(key); setSortAsc(false); }
  };

  const SortIcon = ({ k }: { k: ShiftSortKey }) => {
    if (sortKey !== k) return null;
    return sortAsc
      ? <ChevronUp className="w-3 h-3 inline ml-0.5" />
      : <ChevronDown className="w-3 h-3 inline ml-0.5" />;
  };

  const th = (label: string, k: ShiftSortKey) => (
    <th
      className="text-left text-[10px] text-text-muted uppercase tracking-wide pb-2 cursor-pointer hover:text-white transition-colors whitespace-nowrap"
      onClick={() => toggleSort(k)}
    >
      {label}<SortIcon k={k} />
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            {th('Date', 'date')}
            {th('Drinks', 'drinks')}
            {th('/hr', 'perHour')}
            {th('Hours', 'durationHours')}
            {th('Idle %', 'avgIdlePct')}
            {th('Tables', 'tableVisits')}
            <th className="text-left text-[10px] text-text-muted uppercase tracking-wide pb-2">Theft</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-whoop-divider/50">
          {sorted.map((entry, i) => (
            <tr key={i} className="hover:bg-whoop-bg/50 transition-colors">
              <td className="py-2 pr-3 text-warm-300">{fmtDate(entry.date)}</td>
              <td className="py-2 pr-3 font-semibold text-teal">{entry.drinks}</td>
              <td className="py-2 pr-3 text-white">{entry.perHour.toFixed(1)}</td>
              <td className="py-2 pr-3 text-warm-400">{fmtHours(entry.durationHours)}</td>
              <td className={`py-2 pr-3 font-medium ${idleColor(entry.avgIdlePct)}`}>{entry.avgIdlePct.toFixed(0)}%</td>
              <td className="py-2 pr-3 text-warm-400">{entry.tableVisits}</td>
              <td className="py-2">
                {entry.hasTheft
                  ? <span className="inline-flex items-center gap-0.5 text-red-400"><AlertTriangle className="w-3 h-3" /> Flag</span>
                  : <span className="text-emerald-400">✓</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Table visits mini-heatmap ──────────────────────────────────────────────────

function TableVisitsHeatmap({ tableVisitsByStaff, staffName }: {
  tableVisitsByStaff: Record<string, Record<string, number>>;
  staffName: string;
}) {
  // Find the staff entry by name (case-insensitive partial match)
  const staffKey = Object.keys(tableVisitsByStaff).find(
    k => k.toLowerCase().includes(staffName.toLowerCase()) || staffName.toLowerCase().includes(k.toLowerCase())
  );
  const visits = staffKey ? tableVisitsByStaff[staffKey] : null;
  if (!visits) return null;

  const entries = Object.entries(visits).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;

  const maxVisits = Math.max(...entries.map(([, v]) => v), 1);

  return (
    <div>
      <h4 className="text-xs font-semibold text-white mb-2">Table Activity</h4>
      <div className="space-y-1.5">
        {entries.slice(0, 8).map(([tableId, count]) => (
          <div key={tableId} className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted w-14 flex-shrink-0">Table {tableId}</span>
            <div className="flex-1 bg-whoop-bg rounded-full h-2">
              <motion.div
                className="h-2 rounded-full bg-teal/70"
                initial={{ width: 0 }}
                animate={{ width: `${(count / maxVisits) * 100}%` }}
                transition={{ type: 'spring', stiffness: 200, damping: 25 }}
              />
            </div>
            <span className="text-[10px] text-warm-300 w-8 text-right flex-shrink-0">{count}x</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Individual view ────────────────────────────────────────────────────────────

function IndividualView({ profile, tableVisitsByStaff }: {
  profile: BartenderProfile;
  tableVisitsByStaff: Record<string, Record<string, number>> | null;
}) {
  const displayName = profile.displayName || profile.name;
  const theftShifts = profile.shiftHistory.filter(e => e.hasTheft);

  const stats = [
    { label: 'Avg/hr',    value: profile.avgDrinksPerHour.toFixed(1),  color: 'text-teal' },
    { label: 'Peak/hr',   value: profile.peakDrinksPerHour.toFixed(1), color: 'text-white' },
    { label: 'Hours',     value: fmtHours(profile.totalHours),          color: 'text-white' },
    { label: 'Tables',    value: profile.tableVisits.toString(),         color: 'text-white' },
    { label: 'Idle %',    value: `${profile.avgIdlePct.toFixed(0)}%`,    color: idleColor(profile.avgIdlePct) },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* Profile header */}
      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-teal/10 border border-teal/20 flex items-center justify-center flex-shrink-0">
            <User className="w-6 h-6 text-teal" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-white">{displayName}</h2>
            <p className="text-sm text-text-muted mt-0.5">
              {profile.totalDrinks.toLocaleString()} total drinks across {profile.totalShifts} shift{profile.totalShifts !== 1 ? 's' : ''}
            </p>
            {profile.lastSeen && (
              <p className="text-[11px] text-text-muted mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Last seen {fmtDate(profile.lastSeen)}
              </p>
            )}
          </div>
          {profile.theftFlags > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30 flex-shrink-0">
              <AlertTriangle className="w-3.5 h-3.5" />
              {profile.theftFlags} flag{profile.theftFlags !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-5 gap-2 mt-4">
          {stats.map(({ label, value, color }) => (
            <div key={label} className="bg-whoop-bg rounded-xl p-2.5 text-center">
              <div className={`text-base font-bold ${color}`}>{value}</div>
              <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Trend chart */}
      {profile.shiftHistory.length > 0 && (
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-teal" />
            Drinks/hr — Last {Math.min(14, profile.shiftHistory.length)} Shifts
          </h3>
          <TrendChart entries={profile.shiftHistory} />
          <p className="text-[10px] text-text-muted mt-2">
            Red bars indicate shifts with theft flags. Hover for details.
          </p>
        </div>
      )}

      {/* Theft timeline */}
      {theftShifts.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/30 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            Theft Timeline
          </h3>
          <div className="space-y-2">
            {theftShifts.map((entry, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 bg-whoop-bg border border-red-500/20 rounded-xl">
                <div>
                  <p className="text-sm font-medium text-white">{fmtDate(entry.date)}</p>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {entry.drinks} drinks · {entry.perHour.toFixed(1)}/hr · {fmtHours(entry.durationHours)}
                  </p>
                </div>
                <span className="text-xs text-red-400 font-semibold flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Flagged
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table visits heatmap */}
      {tableVisitsByStaff && (
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4">
          <TableVisitsHeatmap tableVisitsByStaff={tableVisitsByStaff} staffName={displayName} />
        </div>
      )}

      {/* Shift history table */}
      {profile.shiftHistory.length > 0 && (
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-teal" />
            Shift History
            <span className="text-[10px] text-text-muted ml-auto">Last 30 shown · click headers to sort</span>
          </h3>
          <ShiftHistoryTable entries={profile.shiftHistory} />
        </div>
      )}
    </motion.div>
  );
}

// ── Leaderboard row ────────────────────────────────────────────────────────────

function LeaderboardRow({ profile, rank, onClick, isActive }: {
  profile: BartenderProfile;
  rank: number;
  onClick: () => void;
  isActive: boolean;
}) {
  const displayName = profile.displayName || profile.name;
  const badge = rankBadge(rank);

  return (
    <motion.tr
      onClick={onClick}
      className={`cursor-pointer transition-colors ${isActive ? 'bg-teal/5' : 'hover:bg-whoop-bg/60'}`}
      whileTap={{ scale: 0.99 }}
    >
      <td className="py-3 px-4 text-sm font-bold text-text-muted w-12">
        {rank < 3 ? (
          <span className="text-base">{badge}</span>
        ) : (
          <span className="text-warm-500">#{rank + 1}</span>
        )}
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-whoop-bg border border-whoop-divider flex items-center justify-center flex-shrink-0">
            <User className="w-3.5 h-3.5 text-text-muted" />
          </div>
          <span className="text-sm font-medium text-white">{displayName}</span>
        </div>
      </td>
      <td className="py-3 pr-4 text-sm font-bold text-teal text-right">
        {profile.avgDrinksPerHour.toFixed(1)}
      </td>
      <td className="py-3 pr-4 text-sm text-warm-400 text-right">
        {profile.peakDrinksPerHour.toFixed(1)}
      </td>
      <td className="py-3 pr-4 text-sm text-warm-400 text-right">
        {profile.totalShifts}
      </td>
      <td className="py-3 pr-4 text-sm text-warm-400 text-right">
        {profile.tableVisits}
      </td>
      <td className="py-3 pr-4 text-right">
        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold border rounded-full px-2 py-0.5 ${idleBg(profile.avgIdlePct)}`}>
          {profile.avgIdlePct.toFixed(0)}%
        </span>
      </td>
      <td className="py-3 pr-4 text-right">
        {profile.theftFlags > 0 ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30 rounded-full px-2 py-0.5">
            <AlertTriangle className="w-3 h-3" />
            {profile.theftFlags} flag{profile.theftFlags !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-full px-2 py-0.5">
            <Shield className="w-3 h-3" />
            Clean
          </span>
        )}
      </td>
    </motion.tr>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

type ViewMode = 'leaderboard' | 'individual';
type SortField = 'avgDrinksPerHour' | 'totalDrinks' | 'totalShifts' | 'theftFlags' | 'avgIdlePct';

export function BartenderProfiles() {
  const user    = authService.getStoredUser();
  const venueId = user?.venueId ?? '';

  const [profiles, setProfiles]         = useState<BartenderProfile[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [view, setView]                 = useState<ViewMode>('leaderboard');
  const [selected, setSelected]         = useState<BartenderProfile | null>(null);
  const [sortField, setSortField]       = useState<SortField>('avgDrinksPerHour');
  const [sortAsc, setSortAsc]           = useState(false);

  // Aggregate tableVisitsByStaff — demo data or production AppSync data
  const tableVisitsByStaff = useMemo<Record<string, Record<string, number>> | null>(() => {
    if (isDemoAccount(venueId)) {
      return {
        'Marcus Williams': { 'Bar-A': 34, 'Bar-B': 28, 'VIP-1': 22, 'Patio': 17, 'Stage': 14, 'Entry': 12 },
        'Priya Patel':     { 'Bar-B': 29, 'Bar-A': 24, 'Lounge': 18, 'Patio': 14, 'VIP-2': 9, 'Entry': 4 },
        'Jordan Lee':      { 'Bar-A': 14, 'Bar-B': 11, 'Lounge': 8, 'Patio': 5, 'Entry': 4 },
      };
    }
    return null; // populated from job data in production
  }, [venueId]);

  const load = useCallback(async () => {
    if (!venueId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      if (isDemoAccount(venueId)) {
        setProfiles(makeDemoBartenderProfiles(venueId));
      } else {
        const data = await bartenderProfilesService.listProfiles(venueId);
        setProfiles(data);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load profiles.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const sorted = useMemo(() => {
    const copy = [...profiles];
    copy.sort((a, b) => {
      const va = a[sortField];
      const vb = b[sortField];
      const na = Number(va); const nb = Number(vb);
      return sortAsc ? na - nb : nb - na;
    });
    return copy;
  }, [profiles, sortField, sortAsc]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) { setSortAsc(a => !a); } else { setSortField(field); setSortAsc(false); }
  };

  const handleSelectRow = (profile: BartenderProfile) => {
    setSelected(profile);
    setView('individual');
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal/10 border border-teal/20 flex items-center justify-center">
            <UserCheck className="w-4.5 h-4.5 text-teal" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Bartender Profiles</h1>
            <p className="text-xs text-text-muted">Cross-shift performance history</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Sort menu (leaderboard only) */}
          {view === 'leaderboard' && profiles.length > 0 && (
            <select
              value={sortField}
              onChange={e => setSortField(e.target.value as SortField)}
              className="text-xs bg-whoop-panel border border-whoop-divider text-warm-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-teal/40"
            >
              <option value="avgDrinksPerHour">Sort: Avg Drinks/hr</option>
              <option value="totalDrinks">Sort: Total Drinks</option>
              <option value="totalShifts">Sort: Total Shifts</option>
              <option value="theftFlags">Sort: Theft Flags</option>
              <option value="avgIdlePct">Sort: Idle %</option>
            </select>
          )}
          <motion.button
            onClick={() => exportProfilesCsv(profiles)}
            disabled={profiles.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-whoop-panel border border-whoop-divider text-sm text-text-secondary rounded-xl hover:border-teal/40 transition-colors disabled:opacity-40"
            whileTap={{ scale: 0.97 }}
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </motion.button>
          <motion.button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-whoop-panel border border-whoop-divider text-sm text-text-secondary rounded-xl hover:border-teal/40 transition-colors disabled:opacity-50"
            whileTap={{ scale: 0.97 }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </motion.button>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-2">
        {([
          { id: 'leaderboard' as ViewMode, label: 'Leaderboard', icon: BarChart3 },
          { id: 'individual'  as ViewMode, label: 'Individual',  icon: User },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all text-sm ${
              view === id
                ? 'bg-teal/10 border border-teal/30 text-teal'
                : 'bg-whoop-panel border border-whoop-divider text-text-secondary hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
            {id === 'individual' && selected && (
              <span className="text-[10px] text-text-muted ml-1">· {selected.displayName || selected.name}</span>
            )}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 text-text-muted animate-spin" />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
          <p className="text-sm text-red-400 font-medium">{error}</p>
          <button
            onClick={load}
            className="px-4 py-2 bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl text-sm hover:bg-red-500/30 transition-colors"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && profiles.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-whoop-panel border border-whoop-divider flex items-center justify-center">
            <Award className="w-7 h-7 text-text-muted" />
          </div>
          <div>
            <h2 className="text-white font-semibold mb-1">No bartender profiles yet</h2>
            <p className="text-sm text-text-secondary max-w-sm">
              Profiles are built automatically after each shift is processed. Check back after your first VenueScope job completes.
            </p>
          </div>
        </div>
      )}

      {/* Leaderboard view */}
      <AnimatePresence mode="wait">
        {!loading && !error && profiles.length > 0 && view === 'leaderboard' && (
          <motion.div
            key="leaderboard"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden"
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-whoop-divider">
                    <th className="text-left text-[10px] text-text-muted uppercase tracking-wide px-4 py-3 w-12">Rank</th>
                    <th className="text-left text-[10px] text-text-muted uppercase tracking-wide pr-4 py-3">Name</th>
                    <th
                      className="text-right text-[10px] text-text-muted uppercase tracking-wide pr-4 py-3 cursor-pointer hover:text-white transition-colors whitespace-nowrap"
                      onClick={() => toggleSort('avgDrinksPerHour')}
                    >
                      Drinks/hr {sortField === 'avgDrinksPerHour' && (sortAsc ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />)}
                    </th>
                    <th
                      className="text-right text-[10px] text-text-muted uppercase tracking-wide pr-4 py-3 cursor-pointer hover:text-white transition-colors whitespace-nowrap"
                      onClick={() => toggleSort('avgDrinksPerHour')}
                    >
                      Peak/hr
                    </th>
                    <th
                      className="text-right text-[10px] text-text-muted uppercase tracking-wide pr-4 py-3 cursor-pointer hover:text-white transition-colors"
                      onClick={() => toggleSort('totalShifts')}
                    >
                      Shifts {sortField === 'totalShifts' && (sortAsc ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />)}
                    </th>
                    <th className="text-right text-[10px] text-text-muted uppercase tracking-wide pr-4 py-3">Tables</th>
                    <th
                      className="text-right text-[10px] text-text-muted uppercase tracking-wide pr-4 py-3 cursor-pointer hover:text-white transition-colors"
                      onClick={() => toggleSort('avgIdlePct')}
                    >
                      Idle% {sortField === 'avgIdlePct' && (sortAsc ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />)}
                    </th>
                    <th
                      className="text-right text-[10px] text-text-muted uppercase tracking-wide pr-4 py-3 cursor-pointer hover:text-white transition-colors"
                      onClick={() => toggleSort('theftFlags')}
                    >
                      Risk {sortField === 'theftFlags' && (sortAsc ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />)}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-whoop-divider/60">
                  {sorted.map((profile, i) => (
                    <LeaderboardRow
                      key={profile.bartenderId}
                      profile={profile}
                      rank={i}
                      onClick={() => handleSelectRow(profile)}
                      isActive={selected?.bartenderId === profile.bartenderId}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-whoop-divider">
              <p className="text-[10px] text-text-muted">Click a row to view individual performance details.</p>
            </div>
          </motion.div>
        )}

        {/* Individual view */}
        {!loading && !error && view === 'individual' && (
          <motion.div
            key="individual"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {selected ? (
              <IndividualView profile={selected} tableVisitsByStaff={tableVisitsByStaff} />
            ) : (
              <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-8 text-center">
                <UserCheck className="w-10 h-10 text-text-muted mx-auto mb-3" />
                <p className="text-sm text-text-secondary">
                  Select a bartender from the Leaderboard tab to view their detailed profile.
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default BartenderProfiles;
