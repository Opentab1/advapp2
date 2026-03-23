/**
 * VenueScope — CCTV Analytics Dashboard
 *
 * Results are processed locally on your Mac and auto-synced to AWS DynamoDB.
 * This page reads from DynamoDB via AppSync — no local server required.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Video, ShieldCheck, AlertTriangle, RefreshCw,
  TrendingUp, Clock, User, ExternalLink, BarChart3,
  Eye, Timer, Camera, Loader2, Search, X, Download,
  Trash2, ChevronDown, ChevronUp, FileText,
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

// ── CSV export ───────────────────────────────────────────────────────────────

function exportCsv(jobs: VenueScopeJob[]) {
  const headers = [
    'Job ID', 'Clip', 'Status', 'Mode', 'Bartender',
    'Total Drinks', 'Drinks/Hr', 'Unrung', 'Theft Flag',
    'Confidence', 'Camera Angle', 'Avg Response (s)', 'Created', 'Finished',
  ];
  const rows = jobs.map(j => [
    j.jobId, j.clipLabel || '', j.status, j.analysisMode || '',
    j.topBartender || '', j.totalDrinks ?? 0, j.drinksPerHour?.toFixed(1) ?? '',
    j.unrungDrinks ?? 0, j.hasTheftFlag ? 'YES' : 'no',
    j.confidenceLabel || '', j.cameraAngle || '',
    j.avgResponseSec?.toFixed(1) ?? '',
    j.createdAt  ? new Date(j.createdAt  * 1000).toISOString() : '',
    j.finishedAt ? new Date(j.finishedAt * 1000).toISOString() : '',
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `venuescope_export_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Theft investigation modal ─────────────────────────────────────────────────

function TheftModal({ job, onClose }: { job: VenueScopeJob; onClose: () => void }) {
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="bg-whoop-panel border border-red-500/30 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={e => e.stopPropagation()}
        >
          <div className="p-5 border-b border-whoop-divider flex items-start justify-between">
            <div>
              <h2 className="text-white font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                Theft Investigation
              </h2>
              <p className="text-xs text-text-muted mt-0.5">
                {job.clipLabel || job.jobId} · {fmtTime(job.createdAt)}
              </p>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* Summary stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-whoop-bg rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-red-400">{job.unrungDrinks ?? 0}</div>
                <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Unrung</div>
              </div>
              <div className="bg-whoop-bg rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-white">{job.totalDrinks ?? 0}</div>
                <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Total</div>
              </div>
              <div className="bg-whoop-bg rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-amber-400">
                  {job.totalDrinks ? Math.round(((job.unrungDrinks ?? 0) / job.totalDrinks) * 100) : 0}%
                </div>
                <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Rate</div>
              </div>
            </div>

            {/* Bartender */}
            {job.topBartender && (
              <div className="bg-whoop-bg rounded-xl px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-text-muted flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> Flagged bartender
                </span>
                <span className="text-sm font-semibold text-white">{job.topBartender}</span>
              </div>
            )}

            {/* S3 clip */}
            {job.s3ClipKey && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-red-400 flex items-center gap-1.5">
                  <Video className="w-3.5 h-3.5" /> Flagged clip saved to S3
                </span>
                <span className="text-[10px] font-mono text-text-muted">{job.s3ClipKey}</span>
              </div>
            )}

            {/* Investigation checklist */}
            <div>
              <h3 className="text-xs font-semibold text-white mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Next Steps
              </h3>
              <ul className="space-y-1.5 text-xs text-text-secondary">
                {[
                  'Review the annotated video clip for the flagged serves',
                  'Cross-reference with POS transaction log for this shift',
                  `Check bartender ${job.topBartender || 'Unknown'}'s total ring count vs detected drinks`,
                  'Review S3 flagged clip if available (clips saved for theft-flagged jobs)',
                  'Compare opening/closing register totals',
                  'Interview bartender if discrepancy exceeds threshold',
                  'Document findings in incident report',
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full border border-whoop-divider flex-shrink-0 flex items-center justify-center text-[9px] text-text-muted mt-0.5">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ul>
            </div>

            <div className="text-[10px] text-text-muted pt-2 border-t border-whoop-divider">
              Clip: {job.jobId} · Confidence: {job.confidenceLabel} · Processed: {fmtTime(job.finishedAt)}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
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

// ── In-progress card ─────────────────────────────────────────────────────────

function RunningCard({ job }: { job: VenueScopeJob }) {
  const pct = job.progressPct ?? 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-whoop-panel border border-teal/30 rounded-2xl p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">
            {job.clipLabel || job.jobId}
          </p>
          <p className="text-xs text-text-muted mt-0.5">
            {job.cameraLabel || job.analysisMode || 'drink_count'}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal/20 text-teal border border-teal/30 flex-shrink-0">
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
          Processing {pct}%
        </span>
      </div>
      <div className="w-full bg-whoop-bg rounded-full h-1.5">
        <div
          className="bg-teal h-1.5 rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      {job.statusMsg && (
        <p className="text-[10px] text-text-muted truncate">{job.statusMsg}</p>
      )}
      <div className="text-[10px] text-text-muted flex items-center gap-1">
        <Clock className="w-3 h-3" />
        Started {fmtTime(job.createdAt)}
      </div>
    </motion.div>
  );
}

// ── Job card ─────────────────────────────────────────────────────────────────

function JobCard({
  job, onDelete, onInvestigate,
}: {
  job: VenueScopeJob;
  onDelete: (id: string) => void;
  onInvestigate: (job: VenueScopeJob) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (job.status === 'running') return <RunningCard job={job} />;

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
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-xs text-text-muted">
              {job.cameraLabel || job.analysisMode || 'drink_count'}
            </p>
            {job.cameraAngle && (
              <span className="inline-flex items-center gap-0.5 text-[9px] text-text-muted">
                <Camera className="w-2.5 h-2.5" />
                {job.cameraAngle}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {job.hasTheftFlag ? (
            <button
              onClick={() => onInvestigate(job)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
            >
              <AlertTriangle className="w-2.5 h-2.5" />
              Review
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <ShieldCheck className="w-2.5 h-2.5" />
              Clean
            </span>
          )}
          {(job.reviewCount ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Eye className="w-2.5 h-2.5" />
              {job.reviewCount} review
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

      {/* Service response time (table_turns mode) */}
      {job.avgResponseSec != null && (
        <div className="bg-whoop-bg rounded-xl px-3 py-2 flex items-center justify-between">
          <span className="text-[10px] text-text-muted flex items-center gap-1">
            <Timer className="w-3 h-3" />
            Avg server response
          </span>
          <span className="text-sm font-bold text-white">
            {job.avgResponseSec < 60
              ? `${Math.round(job.avgResponseSec)}s`
              : `${(job.avgResponseSec / 60).toFixed(1)}m`}
          </span>
        </div>
      )}

      {/* Expandable detail */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between text-[10px] text-text-muted hover:text-text-secondary transition-colors pt-1"
      >
        <span>Details</span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5 text-[10px] text-text-muted pt-1 border-t border-whoop-divider">
              <div className="flex justify-between">
                <span>Job ID</span>
                <span className="font-mono text-text-secondary">{job.jobId.slice(-12)}</span>
              </div>
              <div className="flex justify-between">
                <span>Duration</span>
                <span>{fmtDuration(job.createdAt, job.finishedAt)}</span>
              </div>
              {job.cameraAngle && (
                <div className="flex justify-between">
                  <span>Camera angle</span>
                  <span className="capitalize">{job.cameraAngle}</span>
                </div>
              )}
              {(job.reviewCount ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span>Low-confidence serves</span>
                  <span className="text-amber-400">{job.reviewCount}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
        <button
          onClick={() => onDelete(job.jobId)}
          className="flex items-center gap-1 text-text-muted hover:text-red-400 transition-colors"
          title="Remove from view"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

type FilterState = {
  search:  string;
  status:  string;
  mode:    string;
  flagged: boolean;
};

function FilterBar({
  filters, onChange, jobs, onExport,
}: {
  filters: FilterState;
  onChange: (f: Partial<FilterState>) => void;
  jobs: VenueScopeJob[];
  onExport: () => void;
}) {
  const modes = useMemo(() => {
    const set = new Set(jobs.map(j => j.analysisMode).filter(Boolean));
    return Array.from(set);
  }, [jobs]);

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {/* Search */}
      <div className="relative flex-1 min-w-[160px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
        <input
          type="text"
          placeholder="Search clips…"
          value={filters.search}
          onChange={e => onChange({ search: e.target.value })}
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-whoop-panel border border-whoop-divider rounded-xl text-white placeholder:text-text-muted focus:outline-none focus:border-teal/50"
        />
      </div>

      {/* Status */}
      <select
        value={filters.status}
        onChange={e => onChange({ status: e.target.value })}
        className="text-xs bg-whoop-panel border border-whoop-divider rounded-xl px-2.5 py-1.5 text-white focus:outline-none focus:border-teal/50"
      >
        <option value="">All status</option>
        <option value="done">Done</option>
        <option value="running">Running</option>
        <option value="failed">Failed</option>
      </select>

      {/* Mode */}
      {modes.length > 1 && (
        <select
          value={filters.mode}
          onChange={e => onChange({ mode: e.target.value })}
          className="text-xs bg-whoop-panel border border-whoop-divider rounded-xl px-2.5 py-1.5 text-white focus:outline-none focus:border-teal/50"
        >
          <option value="">All modes</option>
          {modes.map(m => (
            <option key={m} value={m}>{m?.replace(/_/g, ' ')}</option>
          ))}
        </select>
      )}

      {/* Flagged toggle */}
      <button
        onClick={() => onChange({ flagged: !filters.flagged })}
        className={`text-xs px-2.5 py-1.5 rounded-xl border transition-colors ${
          filters.flagged
            ? 'bg-red-500/20 border-red-500/40 text-red-400'
            : 'bg-whoop-panel border-whoop-divider text-text-muted hover:border-red-500/30'
        }`}
      >
        <AlertTriangle className="w-3 h-3 inline mr-1" />
        Flagged only
      </button>

      {/* CSV export */}
      <button
        onClick={onExport}
        className="text-xs px-2.5 py-1.5 rounded-xl border border-whoop-divider bg-whoop-panel text-text-muted hover:text-teal hover:border-teal/40 transition-colors"
      >
        <Download className="w-3 h-3 inline mr-1" />
        Export CSV
      </button>
    </div>
  );
}

// ── Summary bar ──────────────────────────────────────────────────────────────

function SummaryBar({ jobs }: { jobs: VenueScopeJob[] }) {
  const done        = jobs.filter(j => j.status !== 'running');
  const running     = jobs.filter(j => j.status === 'running').length;
  const totalDrinks = done.reduce((s, j) => s + (j.totalDrinks ?? 0), 0);
  const totalUnrung = done.reduce((s, j) => s + (j.unrungDrinks ?? 0), 0);
  const flaggedJobs = done.filter(j => j.hasTheftFlag).length;
  const avgPerHour  = done.length
    ? (done.reduce((s, j) => s + (j.drinksPerHour ?? 0), 0) / done.length).toFixed(1)
    : '—';

  return (
    <div className="grid grid-cols-4 gap-3 mb-6">
      {[
        { label: 'Total Drinks',  value: totalDrinks,                      color: 'text-teal' },
        { label: 'Avg / Hr',      value: avgPerHour,                       color: 'text-white' },
        { label: 'Unrung',        value: totalUnrung,                      color: 'text-amber-400' },
        { label: running > 0 ? `${running} Processing` : 'Flagged Jobs',
          value: running > 0 ? running : flaggedJobs,
          color: running > 0 ? 'text-teal' : 'text-red-400' },
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
  const [jobs, setJobs]             = useState<VenueScopeJob[]>([]);
  const [loading, setLoading]       = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [dismissed, setDismissed]   = useState<Set<string>>(new Set());
  const [investigating, setInvestigating] = useState<VenueScopeJob | null>(null);
  const [filters, setFilters]       = useState<FilterState>({
    search: '', status: '', mode: '', flagged: false,
  });

  const load = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    const data = await venueScopeService.listJobs(venueId, 50);
    setJobs(data);
    setLastRefresh(new Date());
    setLoading(false);
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const visibleJobs = useMemo(() => {
    return jobs.filter(j => {
      if (dismissed.has(j.jobId)) return false;
      if (filters.status  && j.status !== filters.status) return false;
      if (filters.mode    && j.analysisMode !== filters.mode) return false;
      if (filters.flagged && !j.hasTheftFlag) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!(j.clipLabel || '').toLowerCase().includes(q) &&
            !(j.jobId).toLowerCase().includes(q) &&
            !(j.topBartender || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [jobs, dismissed, filters]);

  const handleDelete = useCallback((jobId: string) => {
    setDismissed(prev => new Set([...prev, jobId]));
  }, []);

  const updateFilters = useCallback((patch: Partial<FilterState>) => {
    setFilters(prev => ({ ...prev, ...patch }));
  }, []);

  return (
    <div className="space-y-6">
      {/* Theft investigation modal */}
      {investigating && (
        <TheftModal job={investigating} onClose={() => setInvestigating(null)} />
      )}

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
          <SummaryBar jobs={visibleJobs} />
          <FilterBar
            filters={filters}
            onChange={updateFilters}
            jobs={jobs}
            onExport={() => exportCsv(visibleJobs)}
          />
          {visibleJobs.length === 0 ? (
            <div className="text-center py-16 text-text-muted text-sm">
              No jobs match your filters.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleJobs.map(job => (
                <JobCard
                  key={job.jobId}
                  job={job}
                  onDelete={handleDelete}
                  onInvestigate={setInvestigating}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default VenueScope;
