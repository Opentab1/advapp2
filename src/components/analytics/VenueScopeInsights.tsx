/**
 * VenueScopeInsights
 *
 * Shows a native summary card in the Analytics tab pulled from the
 * VenueScope REST API. Only renders when the API is reachable.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Video, TrendingUp, TrendingDown, AlertTriangle, ShieldCheck, RefreshCw, ExternalLink } from 'lucide-react';
import venueScopeService, {
  VenueScopeLatestSummary,
  VenueScope30dSummary,
  VenueScopeRecentJob,
} from '../../services/venuescope.service';

const RAW_URL = import.meta.env.VITE_VENUESCOPE_URL || '';
const IS_CONFIGURED = RAW_URL !== '' && !RAW_URL.includes('localhost') && !RAW_URL.includes('127.0.0.1');

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
  const [latest, setLatest] = useState<VenueScopeLatestSummary | null>(null);
  const [summary30d, setSummary30d] = useState<VenueScope30dSummary | null>(null);
  const [recentJobs, setRecentJobs] = useState<VenueScopeRecentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  useEffect(() => {
    if (!IS_CONFIGURED) { setLoading(false); return; }
    let cancelled = false;

    async function load() {
      setLoading(true);
      const alive = await venueScopeService.checkHealth();
      if (cancelled) return;
      setOnline(alive);
      if (alive) {
        const [lat, sum, jobs] = await Promise.all([
          venueScopeService.getLatestSummary(),
          venueScopeService.get30dSummary(),
          venueScopeService.getRecentJobs(5),
        ]);
        if (!cancelled) { setLatest(lat); setSummary30d(sum); setRecentJobs(jobs); }
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [lastRefresh]);

  // Don't render if VenueScope isn't set up
  if (!IS_CONFIGURED) return null;

  // Don't render while loading (silent)
  if (loading) return null;

  // Server offline — show a minimal offline pill
  if (!online) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-4 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <Video className="w-4 h-4 text-warm-500" />
          <span className="text-sm text-warm-500">VenueScope offline</span>
        </div>
        <button
          onClick={() => setLastRefresh(Date.now())}
          className="text-xs text-warm-500 hover:text-warm-300 flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      </motion.div>
    );
  }

  // No data yet
  if (!latest && !summary30d) return null;

  const drinkTrend = summary30d && summary30d.total_jobs > 1
    ? (() => {
        const dates = Object.keys(summary30d.drinks_by_date).sort();
        if (dates.length < 2) return null;
        const half = Math.floor(dates.length / 2);
        const first = dates.slice(0, half).reduce((s, d) => s + (summary30d.drinks_by_date[d] || 0), 0) / half;
        const second = dates.slice(half).reduce((s, d) => s + (summary30d.drinks_by_date[d] || 0), 0) / (dates.length - half);
        if (first === 0) return null;
        return Math.round(((second - first) / first) * 100);
      })()
    : null;

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLastRefresh(Date.now())}
            className="text-warm-500 hover:text-warm-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <a
            href={RAW_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-warm-500 hover:text-teal transition-colors"
            title="Open VenueScope"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Latest shift */}
      {latest && (
        <div className="px-4 pb-3 border-b border-whoop-divider">
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="text-xs text-warm-500 uppercase tracking-wide mb-0.5">Last Analysis</p>
              <p className="text-sm text-warm-300 truncate max-w-[200px]">
                {latest.clip_label || latest.job_id}
              </p>
            </div>
            <ConfidenceBadge color={latest.confidence_color} label={latest.confidence_label} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            {/* Total drinks */}
            <div className="bg-whoop-panel rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-teal">{latest.total_drinks}</div>
              <div className="text-[10px] text-warm-500 uppercase tracking-wide mt-0.5">Drinks Made</div>
            </div>
            {/* Rate */}
            <div className="bg-whoop-panel rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-white">{latest.drinks_per_hour.toFixed(0)}</div>
              <div className="text-[10px] text-warm-500 uppercase tracking-wide mt-0.5">Per Hour</div>
            </div>
            {/* Theft status */}
            <div className="bg-whoop-panel rounded-xl p-3 text-center flex flex-col items-center justify-center gap-1">
              {latest.has_theft_flag ? (
                <>
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <div className="text-[10px] text-red-400 font-semibold uppercase tracking-wide">
                    {latest.unrung_drinks ? `${latest.unrung_drinks} unrung` : 'Review'}
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

          {latest.top_bartender && latest.top_bartender !== '—' && (
            <p className="text-xs text-warm-500 mt-2">
              Top: <span className="text-warm-300">{latest.top_bartender}</span>
            </p>
          )}
        </div>
      )}

      {/* 30-day summary */}
      {summary30d && summary30d.total_jobs > 0 && (
        <div className="px-4 py-3">
          <p className="text-xs text-warm-500 uppercase tracking-wide mb-2">Last 30 Days</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <div className="text-lg font-bold text-white">{summary30d.total_jobs}</div>
              <div className="text-[10px] text-warm-500">Shifts Analyzed</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-white">{summary30d.total_drinks.toLocaleString()}</div>
              <div className="text-[10px] text-warm-500">Total Drinks</div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1">
                <span className="text-lg font-bold text-white">{summary30d.avg_drinks_per_shift.toFixed(0)}</span>
                {drinkTrend !== null && (
                  drinkTrend > 0
                    ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    : <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                )}
              </div>
              <div className="text-[10px] text-warm-500">Avg / Shift</div>
            </div>
          </div>

          {/* Mini drink trend bar chart */}
          {Object.keys(summary30d.drinks_by_date).length > 2 && (
            <div className="mt-3">
              <div className="flex items-end gap-0.5 h-8">
                {Object.entries(summary30d.drinks_by_date)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .slice(-14)
                  .map(([date, count]) => {
                    const max = Math.max(...Object.values(summary30d.drinks_by_date));
                    const pct = max > 0 ? (count / max) * 100 : 0;
                    return (
                      <div
                        key={date}
                        className="flex-1 bg-teal/40 rounded-sm hover:bg-teal/70 transition-colors"
                        style={{ height: `${Math.max(pct, 8)}%` }}
                        title={`${date}: ${count} drinks`}
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

      {/* Recent shifts */}
      {recentJobs.length > 1 && (
        <div className="px-4 pb-3 border-t border-whoop-divider pt-3">
          <p className="text-xs text-warm-500 uppercase tracking-wide mb-2">Recent Shifts</p>
          <div className="space-y-1.5">
            {recentJobs.slice(0, 5).map(job => (
              <div key={job.job_id} className="flex items-center justify-between">
                <span className="text-xs text-warm-300 truncate max-w-[160px]">
                  {job.clip_label || job.job_id.slice(0, 8)}
                </span>
                <span className="text-xs font-semibold text-teal flex-shrink-0 ml-2">
                  {job.total_drinks} drinks
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default VenueScopeInsights;
