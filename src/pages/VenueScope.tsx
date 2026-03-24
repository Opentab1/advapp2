/**
 * VenueScope — CCTV Analytics Dashboard
 *
 * Results are processed locally on your Mac and auto-synced to AWS DynamoDB.
 * This page reads from DynamoDB via AppSync — no local server required.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Video, ShieldCheck, AlertTriangle, RefreshCw,
  TrendingUp, Clock, User, ExternalLink, BarChart3,
  Eye, Camera, Loader2, Search, X, Download,
  Trash2, ChevronDown, ChevronUp, FileText,
} from 'lucide-react';
import authService from '../services/auth.service';
import venueScopeService, { VenueScopeJob, parseModes } from '../services/venuescope.service';
import { isDemoAccount, generateDemoVenueScopeJobs } from '../utils/demoData';

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

// ── Shared row helper ────────────────────────────────────────────────────────

function Row({ label, value, color }: {
  label: string;
  value: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="flex justify-between text-text-muted">
      <span>{label}</span>
      <span className={color ?? 'text-text-secondary'}>{value}</span>
    </div>
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

      {/* Active modes chips */}
      {(() => {
        const modes = parseModes(job);
        const modeLabels: Record<string, string> = {
          drink_count: '🍺 Drink Count', bottle_count: '🍾 Bottle Count',
          people_count: '🚶 People Count', table_turns: '🪑 Table Turns',
          staff_activity: '👷 Staff Activity', after_hours: '🔒 After Hours',
        };
        return modes.length > 1 ? (
          <div className="flex flex-wrap gap-1">
            {modes.map(m => (
              <span key={m} className="text-[9px] px-1.5 py-0.5 rounded-full bg-whoop-bg border border-whoop-divider text-text-secondary">
                {modeLabels[m] ?? m}
              </span>
            ))}
          </div>
        ) : null;
      })()}

      {/* Primary stats row — adapts to which modes ran */}
      {(() => {
        const modes = parseModes(job);
        const stats: { value: string | number; label: string; color: string }[] = [];

        if (modes.includes('drink_count')) {
          stats.push({ value: job.totalDrinks ?? 0,    label: 'Drinks',    color: 'text-teal' });
          stats.push({ value: job.drinksPerHour != null ? job.drinksPerHour.toFixed(1) : '—', label: 'Per Hour', color: 'text-white' });
          stats.push({ value: job.unrungDrinks ?? 0,   label: 'Unrung',    color: 'text-amber-400' });
        }
        if (modes.includes('people_count') && (job.totalEntries ?? 0) > 0) {
          stats.push({ value: job.totalEntries ?? 0,   label: 'Entries',   color: 'text-teal' });
          stats.push({ value: job.peakOccupancy ?? 0,  label: 'Peak',      color: 'text-white' });
        }
        if (modes.includes('bottle_count') && (job.bottleCount ?? 0) > 0) {
          stats.push({ value: job.bottleCount ?? 0,    label: 'Bottles',   color: 'text-teal' });
          stats.push({ value: job.pourCount ?? 0,      label: 'Pours',     color: 'text-white' });
        }
        if (modes.includes('table_turns') && (job.totalTurns ?? 0) > 0) {
          stats.push({ value: job.totalTurns ?? 0,     label: 'Turns',     color: 'text-teal' });
        }
        if (modes.includes('staff_activity') && (job.uniqueStaff ?? 0) > 0) {
          stats.push({ value: job.uniqueStaff ?? 0,    label: 'Staff',     color: 'text-teal' });
          stats.push({ value: `${(job.avgIdlePct ?? 0).toFixed(0)}%`,  label: 'Idle',  color: 'text-amber-400' });
        }

        // Default if no enriched data yet (old job)
        if (stats.length === 0) {
          stats.push({ value: job.totalDrinks ?? 0,   label: 'Drinks',   color: 'text-teal' });
          stats.push({ value: job.drinksPerHour != null ? job.drinksPerHour.toFixed(1) : '—', label: 'Per Hour', color: 'text-white' });
          stats.push({ value: job.unrungDrinks ?? 0,  label: 'Unrung',   color: 'text-amber-400' });
        }

        const cols = Math.min(stats.length, 4);
        return (
          <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {stats.slice(0, 4).map(({ value, label, color }) => (
              <div key={label} className="bg-whoop-bg rounded-xl p-3 text-center">
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Expandable detail */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between text-[10px] text-text-muted hover:text-text-secondary transition-colors pt-1"
      >
        <span>Full breakdown</span>
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
            <div className="space-y-3 pt-2 border-t border-whoop-divider">

              {/* Drink count detail */}
              {parseModes(job).includes('drink_count') && (job.totalDrinks ?? 0) > 0 && (
                <div>
                  <p className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">🍺 Drink Count</p>
                  <div className="space-y-1 text-[10px]">
                    <Row label="Total drinks"    value={job.totalDrinks ?? 0} />
                    <Row label="Drinks / hr"     value={job.drinksPerHour?.toFixed(1) ?? '—'} />
                    <Row label="Unrung drinks"   value={job.unrungDrinks ?? 0} color={job.unrungDrinks ? 'text-amber-400' : undefined} />
                    <Row label="Top bartender"   value={job.topBartender || '—'} />
                    {(job.reviewCount ?? 0) > 0 && <Row label="Needs review" value={job.reviewCount!} color="text-amber-400" />}
                  </div>
                </div>
              )}

              {/* Bottle count detail */}
              {parseModes(job).includes('bottle_count') && (job.bottleCount ?? 0) > 0 && (
                <div>
                  <p className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">🍾 Bottle Count</p>
                  <div className="space-y-1 text-[10px]">
                    <Row label="Total bottles"      value={job.bottleCount!} />
                    <Row label="Peak on shelf"      value={job.peakBottleCount ?? 0} />
                    <Row label="Pours detected"     value={job.pourCount ?? 0} />
                    <Row label="Total poured (oz)"  value={job.totalPouredOz?.toFixed(1) ?? '0'} />
                    {(job.overPours ?? 0) > 0       && <Row label="Over-pours"          value={job.overPours!}          color="text-amber-400" />}
                    {(job.walkOutAlerts ?? 0) > 0   && <Row label="Walk-out alerts"     value={job.walkOutAlerts!}      color="text-red-400" />}
                    {(job.unknownBottleAlerts ?? 0) > 0 && <Row label="Unknown bottles" value={job.unknownBottleAlerts!} color="text-red-400" />}
                    {(job.parLowEvents ?? 0) > 0    && <Row label="Par low events"      value={job.parLowEvents!}       color="text-amber-400" />}
                  </div>
                </div>
              )}

              {/* People count detail */}
              {parseModes(job).includes('people_count') && (job.totalEntries ?? 0) > 0 && (
                <div>
                  <p className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">🚶 People Count</p>
                  <div className="space-y-1 text-[10px]">
                    <Row label="Entries"       value={job.totalEntries ?? 0} />
                    <Row label="Exits"         value={job.totalExits ?? 0} />
                    <Row label="Peak occupancy" value={job.peakOccupancy ?? 0} />
                  </div>
                </div>
              )}

              {/* Table turns detail */}
              {parseModes(job).includes('table_turns') && (job.totalTurns ?? 0) > 0 && (
                <div>
                  <p className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">🪑 Table Turns</p>
                  <div className="space-y-1 text-[10px]">
                    <Row label="Total turns"   value={job.totalTurns!} />
                    {job.avgDwellMin   != null && <Row label="Avg dwell time"    value={`${job.avgDwellMin.toFixed(1)} min`} />}
                    {job.avgResponseSec != null && <Row label="Avg server response" value={job.avgResponseSec < 60 ? `${Math.round(job.avgResponseSec)}s` : `${(job.avgResponseSec / 60).toFixed(1)}m`} />}
                  </div>
                </div>
              )}

              {/* Staff activity detail */}
              {parseModes(job).includes('staff_activity') && (job.uniqueStaff ?? 0) > 0 && (
                <div>
                  <p className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">👷 Staff Activity</p>
                  <div className="space-y-1 text-[10px]">
                    <Row label="Unique staff"   value={job.uniqueStaff!} />
                    <Row label="Peak headcount" value={job.peakHeadcount ?? 0} />
                    <Row label="Avg idle"       value={`${(job.avgIdlePct ?? 0).toFixed(0)}%`} color={(job.avgIdlePct ?? 0) > 30 ? 'text-amber-400' : undefined} />
                  </div>
                </div>
              )}

              {/* Meta */}
              <div className="space-y-1 text-[10px] text-text-muted pt-1 border-t border-whoop-divider">
                <Row label="Job ID"    value={<span className="font-mono">{job.jobId.slice(-12)}</span>} />
                <Row label="Duration"  value={fmtDuration(job.createdAt, job.finishedAt)} />
                {job.cameraAngle && <Row label="Camera angle" value={job.cameraAngle} />}
              </div>
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
  const avgPerHour  = done.filter(j => (j.drinksPerHour ?? 0) > 0).length
    ? (done.reduce((s, j) => s + (j.drinksPerHour ?? 0), 0) /
       done.filter(j => (j.drinksPerHour ?? 0) > 0).length).toFixed(1)
    : '—';
  const totalEntries  = done.reduce((s, j) => s + (j.totalEntries ?? 0), 0);
  const totalPours    = done.reduce((s, j) => s + (j.pourCount ?? 0), 0);
  const totalTurns    = done.reduce((s, j) => s + (j.totalTurns ?? 0), 0);

  // Pick which summary stats are most relevant for the set of jobs shown
  const hasBottle  = done.some(j => (j.bottleCount ?? 0) > 0);
  const hasPeople  = done.some(j => (j.totalEntries ?? 0) > 0);
  const hasTables  = done.some(j => (j.totalTurns ?? 0) > 0);
  const hasDrinks  = done.some(j => (j.totalDrinks ?? 0) > 0);

  const stats = [
    hasDrinks  && { label: 'Total Drinks',    value: totalDrinks,  color: 'text-teal' },
    hasDrinks  && { label: 'Avg Drinks / Hr', value: avgPerHour,   color: 'text-white' },
    hasDrinks  && { label: 'Unrung',          value: totalUnrung,  color: 'text-amber-400' },
    hasPeople  && { label: 'Total Entries',   value: totalEntries, color: 'text-teal' },
    hasBottle  && { label: 'Total Pours',     value: totalPours,   color: 'text-teal' },
    hasTables  && { label: 'Table Turns',     value: totalTurns,   color: 'text-white' },
    { label: running > 0 ? `${running} Processing` : 'Flagged Jobs',
      value: running > 0 ? running : flaggedJobs,
      color: running > 0 ? 'text-teal' : flaggedJobs > 0 ? 'text-red-400' : 'text-emerald-400' },
  ].filter(Boolean).slice(0, 4) as { label: string; value: string | number; color: string }[];

  return (
    <div className="grid grid-cols-4 gap-3 mb-6">
      {stats.map(({ label, value, color }) => (
        <div key={label} className="bg-whoop-panel border border-whoop-divider rounded-2xl p-4 text-center">
          <div className={`text-3xl font-bold ${color}`}>{value}</div>
          <div className="text-[10px] text-text-muted uppercase tracking-wide mt-1">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000; // 30 seconds

export function VenueScope() {
  const venueId = authService.getStoredUser()?.venueId || '';
  const [jobs, setJobs]               = useState<VenueScopeJob[]>([]);
  const [loading, setLoading]         = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [newJobIds, setNewJobIds]     = useState<Set<string>>(new Set());
  const [newToast, setNewToast]       = useState<string | null>(null);
  const [dismissed, setDismissed]     = useState<Set<string>>(new Set());
  const [investigating, setInvestigating] = useState<VenueScopeJob | null>(null);
  const [nextPollIn, setNextPollIn]   = useState(POLL_INTERVAL_MS / 1000);
  const [filters, setFilters]         = useState<FilterState>({
    search: '', status: '', mode: '', flagged: false,
  });
  const knownIds = useRef<Set<string>>(new Set());
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const isDemo = isDemoAccount(venueId);

  const load = useCallback(async (silent = false) => {
    if (!venueId) return;
    if (!silent) setLoading(true);
    let data = isDemo
      ? generateDemoVenueScopeJobs()
      : await venueScopeService.listJobs(venueId, 50);

    // Detect brand-new jobs (not seen before this session's first load)
    if (knownIds.current.size > 0) {
      const incoming = data.filter(j => !knownIds.current.has(j.jobId) && j.status === 'done');
      if (incoming.length > 0) {
        setNewJobIds(prev => new Set([...prev, ...incoming.map(j => j.jobId)]));
        const label = incoming[0].clipLabel || incoming[0].jobId.slice(0, 8);
        setNewToast(incoming.length === 1 ? `New result: ${label}` : `${incoming.length} new results`);
        setTimeout(() => setNewToast(null), 5000);
      }
    }
    data.forEach(j => knownIds.current.add(j.jobId));

    setJobs(data);
    setLastRefresh(new Date());
    if (!silent) setLoading(false);
  }, [venueId]);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // For demo: simulate a new job arriving ~20s after page load so the toast fires
  useEffect(() => {
    if (!isDemo) return;
    const t = setTimeout(() => {
      setNewJobIds(prev => new Set([...prev, 'demo-000']));
      setNewToast('New result: Main Bar – Tonight (10 PM)');
      setTimeout(() => setNewToast(null), 5000);
    }, 20_000);
    return () => clearTimeout(t);
  }, [isDemo]);

  // Auto-poll while tab is visible
  useEffect(() => {
    function startPolling() {
      setNextPollIn(POLL_INTERVAL_MS / 1000);

      pollTimer.current = setInterval(() => {
        if (document.visibilityState === 'visible') {
          load(true);
          setNextPollIn(POLL_INTERVAL_MS / 1000);
        }
      }, POLL_INTERVAL_MS);

      countdownTimer.current = setInterval(() => {
        if (document.visibilityState === 'visible') {
          setNextPollIn(n => (n <= 1 ? POLL_INTERVAL_MS / 1000 : n - 1));
        }
      }, 1000);
    }

    function stopPolling() {
      if (pollTimer.current)    clearInterval(pollTimer.current);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        load(true);
        setNextPollIn(POLL_INTERVAL_MS / 1000);
      }
    }

    startPolling();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stopPolling(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [load]);

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

  // Split visible jobs into today vs older
  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() / 1000;
  }, []);

  const { todayJobs, olderJobs } = useMemo(() => {
    const t: VenueScopeJob[] = [], o: VenueScopeJob[] = [];
    visibleJobs.forEach(j => ((j.createdAt ?? 0) >= todayStart ? t : o).push(j));
    return { todayJobs: t, olderJobs: o };
  }, [visibleJobs, todayStart]);

  return (
    <div className="space-y-6">
      {/* Theft investigation modal */}
      {investigating && (
        <TheftModal job={investigating} onClose={() => setInvestigating(null)} />
      )}

      {/* New-job toast */}
      <AnimatePresence>
        {newToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
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
            <p className="text-xs text-text-muted">CCTV drink counting · Theft detection</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Live indicator + countdown */}
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-text-muted">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-teal" />
            </span>
            Live · {lastRefresh
              ? `updated ${lastRefresh.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
              : 'syncing…'}
            {' '}· next in {nextPollIn}s
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
            <>
              {/* TODAY section */}
              {todayJobs.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-semibold text-teal uppercase tracking-wider">Today</span>
                    <span className="text-[10px] text-text-muted bg-teal/10 border border-teal/20 px-1.5 py-0.5 rounded-full">
                      {todayJobs.length} result{todayJobs.length !== 1 ? 's' : ''}
                    </span>
                    <div className="h-px flex-1 bg-teal/20" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {todayJobs.map(job => (
                      <motion.div
                        key={job.jobId}
                        initial={newJobIds.has(job.jobId) ? { opacity: 0, scale: 0.97 } : false}
                        animate={{ opacity: 1, scale: 1 }}
                        className={newJobIds.has(job.jobId) ? 'ring-1 ring-teal/40 rounded-2xl' : ''}
                      >
                        <JobCard
                          job={job}
                          onDelete={handleDelete}
                          onInvestigate={setInvestigating}
                        />
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* OLDER section */}
              {olderJobs.length > 0 && (
                <div>
                  {todayJobs.length > 0 && (
                    <div className="flex items-center gap-2 mb-3 mt-2">
                      <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Earlier</span>
                      <div className="h-px flex-1 bg-whoop-divider" />
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {olderJobs.map(job => (
                      <JobCard
                        key={job.jobId}
                        job={job}
                        onDelete={handleDelete}
                        onInvestigate={setInvestigating}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default VenueScope;
