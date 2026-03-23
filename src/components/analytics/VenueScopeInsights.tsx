/**
 * VenueScopeInsights
 *
 * Analytics panel card showing VenueScope summary pulled from DynamoDB via AppSync.
 * Replaces the old REST/Streamlit API approach.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Video, TrendingUp, TrendingDown, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';
import venueScopeService, { VenueScopeJob } from '../../services/venuescope.service';
import authService from '../../services/auth.service';

function ConfidenceBadge({ color, label }: { color: string; label: string }) {
  const colors: Record<string, string> = {
    green:  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    yellow: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    red:    'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${colors[color] ?? colors.yellow}`}>
      {label}
    </span>
  );
}

export function VenueScopeInsights() {
  const venueId = authService.getStoredUser()?.venueId || '';
  const [jobs, setJobs]     = useState<VenueScopeJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  useEffect(() => {
    if (!venueId) { setLoading(false); return; }
    let cancelled = false;
    venueScopeService.listJobs(venueId, 30).then(data => {
      if (!cancelled) { setJobs(data.filter(j => j.status === 'done')); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [venueId, lastRefresh]);

  if (!venueId || loading) return null;
  if (jobs.length === 0) return null;

  const latest = jobs[0];
  const thirtyDaysAgo = Date.now() / 1000 - 30 * 86400;
  const recent = jobs.filter(j => (j.createdAt ?? 0) > thirtyDaysAgo);

  const totalDrinks30d = recent.reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
  const avgPerShift    = recent.length ? Math.round(totalDrinks30d / recent.length) : 0;

  // Simple trend: compare first-half to second-half of recent jobs
  const drinkTrend = (() => {
    if (recent.length < 4) return null;
    const half   = Math.floor(recent.length / 2);
    const first  = recent.slice(half).reduce((s, j) => s + (j.totalDrinks ?? 0), 0) / half;
    const second = recent.slice(0, half).reduce((s, j) => s + (j.totalDrinks ?? 0), 0) / half;
    if (first === 0) return null;
    return Math.round(((second - first) / first) * 100);
  })();

  // Build drinks-by-date for mini chart
  const drinksByDate: Record<string, number> = {};
  recent.forEach(j => {
    if (!j.createdAt) return;
    const d = new Date(j.createdAt * 1000).toISOString().slice(0, 10);
    drinksByDate[d] = (drinksByDate[d] ?? 0) + (j.totalDrinks ?? 0);
  });
  const chartDates = Object.keys(drinksByDate).sort().slice(-14);
  const chartMax   = Math.max(...chartDates.map(d => drinksByDate[d]), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-teal animate-pulse" />
          <Video className="w-4 h-4 text-teal" />
          <span className="text-sm font-semibold text-white">VenueScope</span>
          <span className="text-xs text-warm-500">CCTV Analytics</span>
        </div>
        <button
          onClick={() => setLastRefresh(Date.now())}
          className="text-warm-500 hover:text-warm-300 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Latest shift */}
      <div className="px-4 pb-3 border-b border-whoop-divider">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="text-xs text-warm-500 uppercase tracking-wide mb-0.5">Last Analysis</p>
            <p className="text-sm text-warm-300 truncate max-w-[200px]">
              {latest.clipLabel || latest.jobId}
            </p>
          </div>
          <ConfidenceBadge color={latest.confidenceColor} label={latest.confidenceLabel} />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="bg-whoop-panel rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-teal">{latest.totalDrinks ?? 0}</div>
            <div className="text-[10px] text-warm-500 uppercase tracking-wide mt-0.5">Drinks</div>
          </div>
          <div className="bg-whoop-panel rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-white">
              {latest.drinksPerHour != null ? latest.drinksPerHour.toFixed(0) : '—'}
            </div>
            <div className="text-[10px] text-warm-500 uppercase tracking-wide mt-0.5">Per Hour</div>
          </div>
          <div className="bg-whoop-panel rounded-xl p-3 text-center flex flex-col items-center justify-center gap-1">
            {latest.hasTheftFlag ? (
              <>
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <div className="text-[10px] text-red-400 font-semibold uppercase tracking-wide">
                  {latest.unrungDrinks ? `${latest.unrungDrinks} unrung` : 'Review'}
                </div>
              </>
            ) : (
              <>
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <div className="text-[10px] text-emerald-400 uppercase tracking-wide">Clean</div>
              </>
            )}
          </div>
        </div>

        {latest.topBartender && (
          <p className="text-xs text-warm-500 mt-2">
            Top: <span className="text-warm-300">{latest.topBartender}</span>
          </p>
        )}
      </div>

      {/* 30-day summary */}
      {recent.length > 0 && (
        <div className="px-4 py-3">
          <p className="text-xs text-warm-500 uppercase tracking-wide mb-2">Last 30 Days</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <div className="text-lg font-bold text-white">{recent.length}</div>
              <div className="text-[10px] text-warm-500">Shifts</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-white">{totalDrinks30d.toLocaleString()}</div>
              <div className="text-[10px] text-warm-500">Total Drinks</div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1">
                <span className="text-lg font-bold text-white">{avgPerShift}</span>
                {drinkTrend !== null && (
                  drinkTrend > 0
                    ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    : <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                )}
              </div>
              <div className="text-[10px] text-warm-500">Avg / Shift</div>
            </div>
          </div>

          {/* Mini bar chart */}
          {chartDates.length > 2 && (
            <div className="mt-3">
              <div className="flex items-end gap-0.5 h-8">
                {chartDates.map(date => {
                  const pct = (drinksByDate[date] / chartMax) * 100;
                  return (
                    <div
                      key={date}
                      className="flex-1 bg-teal/40 rounded-sm hover:bg-teal/70 transition-colors"
                      style={{ height: `${Math.max(pct, 8)}%` }}
                      title={`${date}: ${drinksByDate[date]} drinks`}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[9px] text-warm-600">14 days ago</span>
                <span className="text-[9px] text-warm-600">today</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent shifts list */}
      {jobs.length > 1 && (
        <div className="px-4 pb-3 border-t border-whoop-divider pt-3">
          <p className="text-xs text-warm-500 uppercase tracking-wide mb-2">Recent Shifts</p>
          <div className="space-y-1.5">
            {jobs.slice(0, 5).map(job => (
              <div key={job.jobId} className="flex items-center justify-between">
                <span className="text-xs text-warm-300 truncate max-w-[160px]">
                  {job.clipLabel || job.jobId.slice(0, 8)}
                </span>
                <span className="text-xs font-semibold text-teal flex-shrink-0 ml-2">
                  {job.totalDrinks ?? 0} drinks
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
