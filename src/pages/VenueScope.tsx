/**
 * VenueScope — CCTV Analytics Dashboard
 *
 * Results are processed locally on your Mac and auto-synced to AWS DynamoDB.
 * This page reads from DynamoDB via AppSync — no local server required.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Video, ShieldCheck, AlertTriangle, RefreshCw,
  TrendingUp, Clock, User, ExternalLink, BarChart3,
} from 'lucide-react';
import authService from '../services/auth.service';
import venueScopeService, { VenueScopeJob } from '../services/venuescope.service';

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
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

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
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
        <p className="text-sm text-text-secondary mb-5">
          Process your first video in the VenueScope app on your Mac, then results will appear here automatically.
        </p>
        <a
          href="http://localhost:8501"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal/10 border border-teal/30 text-teal text-sm font-medium rounded-xl hover:bg-teal/20 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          Open VenueScope on this Mac
        </a>
      </motion.div>
    </div>
  );
}

// ── Job card ─────────────────────────────────────────────────────────────────

function JobCard({ job }: { job: VenueScopeJob }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4 space-y-3"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">
            {job.clipLabel || job.jobId}
          </p>
          <p className="text-xs text-text-muted mt-0.5">
            {job.cameraLabel || job.analysisMode || 'drink_count'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {job.hasTheftFlag ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30">
              <AlertTriangle className="w-2.5 h-2.5" />
              Review
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <ShieldCheck className="w-2.5 h-2.5" />
              Clean
            </span>
          )}
          <ConfidenceBadge color={job.confidenceColor} label={job.confidenceLabel} />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-whoop-bg rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-teal">{job.totalDrinks ?? 0}</div>
          <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Drinks</div>
        </div>
        <div className="bg-whoop-bg rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-white">
            {job.drinksPerHour != null ? job.drinksPerHour.toFixed(1) : '—'}
          </div>
          <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Per Hour</div>
        </div>
        <div className="bg-whoop-bg rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-amber-400">{job.unrungDrinks ?? 0}</div>
          <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Unrung</div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-text-muted pt-1 border-t border-whoop-divider">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {fmtTime(job.createdAt)}
        </span>
        <span className="flex items-center gap-1">
          <User className="w-3 h-3" />
          {job.topBartender || 'Unknown'}
        </span>
        <span>{fmtDuration(job.createdAt, job.finishedAt)}</span>
      </div>

      {/* S3 clip link (theft only) */}
      {job.s3ClipKey && (
        <div className="text-[10px] text-red-400 flex items-center gap-1 pt-1">
          <AlertTriangle className="w-3 h-3" />
          Flagged clip saved to S3
        </div>
      )}
    </motion.div>
  );
}

// ── Summary bar ──────────────────────────────────────────────────────────────

function SummaryBar({ jobs }: { jobs: VenueScopeJob[] }) {
  const totalDrinks   = jobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
  const totalUnrung   = jobs.reduce((s, j) => s + (j.unrungDrinks ?? 0), 0);
  const flaggedJobs   = jobs.filter(j => j.hasTheftFlag).length;
  const avgPerHour    = jobs.length
    ? (jobs.reduce((s, j) => s + (j.drinksPerHour ?? 0), 0) / jobs.length).toFixed(1)
    : '—';

  return (
    <div className="grid grid-cols-4 gap-3 mb-6">
      {[
        { label: 'Total Drinks',  value: totalDrinks,  color: 'text-teal' },
        { label: 'Avg / Hr',      value: avgPerHour,   color: 'text-white' },
        { label: 'Unrung',        value: totalUnrung,  color: 'text-amber-400' },
        { label: 'Flagged Jobs',  value: flaggedJobs,  color: 'text-red-400' },
      ].map(({ label, value, color }) => (
        <div key={label} className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4 text-center">
          <div className={`text-3xl font-bold ${color}`}>{value}</div>
          <div className="text-[10px] text-text-muted uppercase tracking-wide mt-1">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function VenueScope() {
  const venueId = authService.getStoredUser()?.venueId || '';
  const [jobs, setJobs]       = useState<VenueScopeJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    const data = await venueScopeService.listJobs(venueId, 50);
    setJobs(data);
    setLastRefresh(new Date());
    setLoading(false);
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal/10 border border-teal/20 flex items-center justify-center">
            <Video className="w-4.5 h-4.5 text-teal" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">VenueScope</h1>
            <p className="text-xs text-text-muted">CCTV drink counting · Theft detection</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-[10px] text-text-muted hidden sm:block">
              Updated {lastRefresh.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <motion.button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-whoop-panel border border-whoop-divider text-sm text-text-secondary rounded-xl hover:border-teal/40 transition-colors disabled:opacity-50"
            whileTap={{ scale: 0.97 }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </motion.button>
          <a
            href="http://localhost:8501"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-teal/10 border border-teal/30 text-teal text-sm font-medium rounded-xl hover:bg-teal/20 transition-colors"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Process Video
          </a>
        </div>
      </div>

      {/* Body */}
      {loading && jobs.length === 0 ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <RefreshCw className="w-6 h-6 text-text-muted animate-spin" />
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <SummaryBar jobs={jobs} />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {jobs.map(job => (
              <JobCard key={job.jobId} job={job} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default VenueScope;
