/**
 * OpsMonitor — Live operations monitor across all venues + droplet controls.
 *
 * Top half: Droplet health (CPU/RAM/disk), worker status, restart/deploy buttons,
 *           live jobs from DDB, collapsible log viewer.
 * Bottom half: Per-venue health table (unchanged from prior version).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, RefreshCw, Camera, Clock, AlertTriangle, ChevronRight,
  Server, Cpu, HardDrive, MemoryStick, Power, Upload, Terminal,
  ChevronDown, ChevronUp, CheckCircle, XCircle, Loader2, Zap,
} from 'lucide-react';
import adminService, {
  AdminVenue, AdminJob, AdminCamera, OpsStatus,
} from '../../services/admin.service';
import { useAdminVenue } from '../../contexts/AdminVenueContext';
import { VenueSelector } from '../../components/admin/VenueSelector';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ts: number | null): string {
  if (!ts) return 'Never';
  const secs = Math.floor((Date.now() - ts * 1000) / 1000);
  if (secs < 60) return 'Just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function durationSince(startedAt: string): string {
  if (!startedAt || startedAt === 'n/a' || startedAt.includes('not set')) return '—';
  try {
    const ts = new Date(startedAt).getTime();
    if (isNaN(ts)) return '—';
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60)   return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  } catch { return '—'; }
}

type VenueHealth = 'green' | 'yellow' | 'red';
function venueHealth(venue: AdminVenue, lastJobTs: number | null): VenueHealth {
  if (venue.status === 'suspended') return 'red';
  if (!lastJobTs) return 'red';
  const hoursAgo = (Date.now() - lastJobTs * 1000) / 3600000;
  if (hoursAgo < 2) return 'green';
  if (hoursAgo < 8) return 'yellow';
  return 'red';
}
function HealthDot({ health }: { health: VenueHealth }) {
  const cls: Record<VenueHealth, string> = {
    green: 'bg-green-400 animate-pulse', yellow: 'bg-yellow-400', red: 'bg-red-500',
  };
  return <span className={`w-2.5 h-2.5 rounded-full inline-block ${cls[health]}`} />;
}
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-white/5 ${className}`} />;
}

// ─── Gauge ───────────────────────────────────────────────────────────────────

function Gauge({ label, value, max, unit, color }: {
  label: string; value: number; max: number; unit: string; color: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const barColor = pct > 85 ? 'bg-red-500' : pct > 65 ? 'bg-yellow-500' : color;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-xs text-gray-400">
        <span>{label}</span>
        <span className="text-white font-mono">
          {value < 0 ? '—' : `${value}${unit}`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: value < 0 ? '0%' : `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Action Button ────────────────────────────────────────────────────────────

function ActionButton({
  onClick, loading, disabled, danger, children,
}: {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
        danger
          ? 'bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30'
          : 'bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10'
      }`}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  title, message, onConfirm, onCancel,
}: { title: string; message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        className="glass-card p-6 max-w-sm w-full mx-4"
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      >
        <h3 className="text-white font-bold text-lg mb-2">{title}</h3>
        <p className="text-gray-400 text-sm mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-sm hover:bg-white/10">
            Cancel
          </button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-lg bg-red-500/80 hover:bg-red-500 text-white text-sm font-medium">
            Confirm
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Venue row type ───────────────────────────────────────────────────────────

interface VenueRow {
  venue: AdminVenue;
  drinksToday: number;
  drinksLastHour: number;
  lastDetectionTs: number | null;
  camerasActive: number;
  camerasTotal: number;
  health: VenueHealth;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function OpsMonitor() {
  const { venues, loadingVenues, selectedVenueId } = useAdminVenue();

  // Venue health table data
  const [jobs,           setJobs]           = useState<AdminJob[]>([]);
  const [cameras,        setCameras]        = useState<AdminCamera[]>([]);
  const [loadingJobs,    setLoadingJobs]    = useState(true);
  const [loadingCameras, setLoadingCameras] = useState(true);

  // Ops / droplet data
  const [opsStatus,      setOpsStatus]      = useState<OpsStatus | null>(null);
  const [opsLoading,     setOpsLoading]     = useState(true);
  const [opsError,       setOpsError]       = useState<string | null>(null);

  // Logs
  const [logsOpen,       setLogsOpen]       = useState(false);
  const [logLines,       setLogLines]       = useState<string[]>([]);
  const [logFilter,      setLogFilter]      = useState('');
  const [logsLoading,    setLogsLoading]    = useState(false);

  // Actions
  const [restarting,     setRestarting]     = useState(false);
  const [deploying,      setDeploying]      = useState(false);
  const [deployOutput,   setDeployOutput]   = useState<string[] | null>(null);
  const [actionMsg,      setActionMsg]      = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm,        setConfirm]        = useState<'restart' | 'deploy' | null>(null);

  const [lastUpdated,    setLastUpdated]    = useState<Date | null>(null);
  const [countdown,      setCountdown]      = useState(30);

  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch venue health data ─────────────────────────────────────────────────

  const fetchVenueData = useCallback(async () => {
    setLoadingJobs(true);
    setLoadingCameras(true);
    const [jr, cr] = await Promise.allSettled([
      adminService.listJobs(undefined, 200),
      adminService.listCameras(undefined),
    ]);
    if (jr.status === 'fulfilled') setJobs(jr.value);
    if (cr.status === 'fulfilled') setCameras(cr.value);
    setLoadingJobs(false);
    setLoadingCameras(false);
  }, []);

  // ── Fetch droplet ops status ────────────────────────────────────────────────

  const fetchOpsStatus = useCallback(async () => {
    setOpsLoading(true);
    setOpsError(null);
    try {
      const status = await adminService.getOpsStatus();
      setOpsStatus(status);
    } catch (e: any) {
      setOpsError(e.message ?? 'Failed to reach droplet ops API');
    } finally {
      setOpsLoading(false);
    }
  }, []);

  // ── Fetch logs ─────────────────────────────────────────────────────────────

  const fetchLogs = useCallback(async (filter: string) => {
    setLogsLoading(true);
    try {
      const data = await adminService.getOpsLogs(150, filter);
      setLogLines(data.lines);
    } catch (e: any) {
      setLogLines([`Error: ${e.message}`]);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  // ── Combined refresh ────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setCountdown(30);
    await Promise.all([fetchVenueData(), fetchOpsStatus()]);
    setLastUpdated(new Date());
  }, [fetchVenueData, fetchOpsStatus]);

  useEffect(() => {
    fetchAll();
    intervalRef.current  = setInterval(fetchAll, 30000);
    countdownRef.current = setInterval(() => setCountdown(c => (c <= 1 ? 30 : c - 1)), 1000);
    return () => {
      if (intervalRef.current)  clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [fetchAll]);

  useEffect(() => {
    if (logsOpen) fetchLogs(logFilter);
  }, [logsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ─────────────────────────────────────────────────────────────────

  const doRestart = async () => {
    setConfirm(null);
    setRestarting(true);
    setActionMsg(null);
    try {
      const res = await adminService.restartWorker();
      setActionMsg({ ok: res.ok, text: res.msg });
      setTimeout(fetchOpsStatus, 3000);
    } catch (e: any) {
      setActionMsg({ ok: false, text: e.message });
    } finally {
      setRestarting(false);
    }
  };

  const doDeploy = async () => {
    setConfirm(null);
    setDeploying(true);
    setDeployOutput(null);
    setActionMsg(null);
    try {
      const res = await adminService.deployUpdate();
      setDeployOutput(res.output);
      setActionMsg({ ok: res.ok, text: res.ok ? 'Deployed successfully' : 'Deploy failed — see output below' });
      if (res.ok) setTimeout(fetchOpsStatus, 5000);
    } catch (e: any) {
      setActionMsg({ ok: false, text: e.message });
    } finally {
      setDeploying(false);
    }
  };

  // ── Venue health rows ───────────────────────────────────────────────────────

  const now = Date.now();
  const dayAgo  = now - 86400000;
  const hourAgo = now - 3600000;

  const displayVenues = selectedVenueId
    ? venues.filter(v => v.venueId === selectedVenueId)
    : venues;

  const rows: VenueRow[] = displayVenues.map(venue => {
    const vj = jobs.filter(j => j.venueId === venue.venueId);
    const jToday = vj.filter(j => j.createdAt * 1000 > dayAgo);
    const jHour  = vj.filter(j => j.createdAt * 1000 > hourAgo);
    const latest = vj.reduce<AdminJob | null>((b, j) => (!b || j.createdAt > b.createdAt ? j : b), null);
    const vc = cameras.filter(c => c.venueId === venue.venueId);
    return {
      venue,
      drinksToday:     jToday.reduce((a, j) => a + (j.totalDrinks || 0), 0),
      drinksLastHour:  jHour.reduce((a, j)  => a + (j.totalDrinks || 0), 0),
      lastDetectionTs: latest?.createdAt ?? null,
      camerasActive:   vc.filter(c => c.enabled).length,
      camerasTotal:    vc.length,
      health:          venueHealth(venue, latest?.createdAt ?? null),
    };
  });

  const localHour = new Date().getHours();
  const staleVenues = rows.filter(r =>
    localHour >= 16 && r.venue.status !== 'suspended' &&
    (!r.lastDetectionTs || (now - r.lastDetectionTs * 1000) > 4 * 3600000)
  );

  const isTableLoading = loadingVenues || loadingJobs;
  const sys = opsStatus?.system;
  const wkr = opsStatus?.worker;

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <motion.div className="flex flex-wrap items-center justify-between gap-4"
        initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}
      >
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Activity className="w-8 h-8 text-amber-400" />
            Live Operations
          </h1>
          <p className="text-gray-400 text-sm mt-1">Droplet health · worker controls · venue monitoring</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <VenueSelector />
          {lastUpdated && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Clock className="w-3.5 h-3.5" />
              <span>Updated {lastUpdated.toLocaleTimeString()}</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Refresh in {countdown}s
              </span>
            </div>
          )}
          <button onClick={fetchAll} disabled={opsLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${opsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </motion.div>

      {/* ── Confirm Dialog ─────────────────────────────────────────────────── */}
      {confirm === 'restart' && (
        <ConfirmDialog
          title="Restart Worker?"
          message="This will restart the venuescope-worker service on the droplet. Any ongoing detection will be interrupted for ~15 seconds while it restarts."
          onConfirm={doRestart}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'deploy' && (
        <ConfirmDialog
          title="Deploy Update?"
          message="This will git pull the latest code from GitHub and restart the worker. Takes ~30 seconds. Any ongoing detection will be briefly interrupted."
          onConfirm={doDeploy}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* ── Action Message ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {actionMsg && (
          <motion.div
            className={`p-4 rounded-xl border flex items-center gap-3 ${
              actionMsg.ok
                ? 'border-green-500/40 bg-green-500/10 text-green-300'
                : 'border-red-500/40 bg-red-500/10 text-red-300'
            }`}
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {actionMsg.ok
              ? <CheckCircle className="w-5 h-5 shrink-0" />
              : <XCircle className="w-5 h-5 shrink-0" />}
            <span className="text-sm">{actionMsg.text}</span>
            <button onClick={() => setActionMsg(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Deploy Output ──────────────────────────────────────────────────── */}
      {deployOutput && (
        <div className="glass-card p-4 font-mono text-xs text-gray-300 space-y-1">
          <div className="text-gray-500 mb-2">Deploy output:</div>
          {deployOutput.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {/* ── Droplet Health + Controls ──────────────────────────────────────── */}
      <motion.div className="glass-card p-6"
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-400" />
            Droplet — DigitalOcean (137.184.61.178)
          </h2>
          {opsError && (
            <span className="text-xs text-red-400 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> {opsError}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {/* Worker Status */}
          <div className="bg-white/5 rounded-xl p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide">
              <Power className="w-3.5 h-3.5" /> Worker
            </div>
            {opsLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <>
                <div className={`text-2xl font-bold ${
                  wkr?.status === 'active' ? 'text-green-400' :
                  wkr?.status === 'inactive' ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {wkr?.status ?? '—'}
                </div>
                <div className="text-xs text-gray-500">
                  up {durationSince(wkr?.startedAt ?? '')} · pid {wkr?.pid || '—'}
                </div>
              </>
            )}
          </div>

          {/* CPU */}
          <div className="bg-white/5 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide">
              <Cpu className="w-3.5 h-3.5" /> CPU
            </div>
            {opsLoading
              ? <Skeleton className="h-12" />
              : <Gauge label="Usage" value={sys?.cpu_pct ?? -1} max={100} unit="%" color="bg-cyan-500" />
            }
          </div>

          {/* RAM */}
          <div className="bg-white/5 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide">
              <MemoryStick className="w-3.5 h-3.5" /> RAM
            </div>
            {opsLoading
              ? <Skeleton className="h-12" />
              : <Gauge label={`${sys?.ram_used_mb ?? '—'} / ${sys?.ram_total_mb ?? '—'} MB`} value={sys?.ram_pct ?? -1} max={100} unit="%" color="bg-purple-500" />
            }
          </div>

          {/* Disk */}
          <div className="bg-white/5 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide">
              <HardDrive className="w-3.5 h-3.5" /> Disk
            </div>
            {opsLoading
              ? <Skeleton className="h-12" />
              : <Gauge label={`${sys?.disk_used_gb ?? '—'} / ${sys?.disk_total_gb ?? '—'} GB`} value={sys?.disk_pct ?? -1} max={100} unit="%" color="bg-amber-500" />
            }
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-3">
          <ActionButton
            onClick={() => setConfirm('restart')}
            loading={restarting}
            disabled={opsLoading || !!opsError}
            danger
          >
            <Power className="w-4 h-4" />
            Restart Worker
          </ActionButton>
          <ActionButton
            onClick={() => setConfirm('deploy')}
            loading={deploying}
            disabled={opsLoading || !!opsError}
          >
            <Upload className="w-4 h-4" />
            Deploy Update (git pull + restart)
          </ActionButton>
          <ActionButton
            onClick={() => { setLogsOpen(v => !v); if (!logsOpen) fetchLogs(logFilter); }}
            disabled={!!opsError}
          >
            <Terminal className="w-4 h-4" />
            {logsOpen ? 'Hide Logs' : 'View Logs'}
            {logsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </ActionButton>
        </div>

        {/* Log Viewer */}
        <AnimatePresence>
          {logsOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="flex items-center gap-3 mb-3">
                  <input
                    type="text"
                    placeholder="Filter logs (e.g. CH8, error, drink)"
                    value={logFilter}
                    onChange={e => setLogFilter(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && fetchLogs(logFilter)}
                    className="flex-1 px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50"
                  />
                  <button
                    onClick={() => fetchLogs(logFilter)}
                    disabled={logsLoading}
                    className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-300 hover:bg-white/10 disabled:opacity-50"
                  >
                    {logsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Filter'}
                  </button>
                </div>
                <div className="bg-black/40 rounded-xl p-4 h-72 overflow-y-auto font-mono text-xs text-gray-400 space-y-0.5">
                  {logsLoading ? (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading logs…
                    </div>
                  ) : logLines.length === 0 ? (
                    <span className="text-gray-600">No log lines found</span>
                  ) : (
                    logLines.map((line, i) => (
                      <div key={i} className={
                        line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')
                          ? 'text-red-400'
                          : line.toLowerCase().includes('warn')
                          ? 'text-yellow-400'
                          : line.toLowerCase().includes('drink') || line.toLowerCase().includes('serve')
                          ? 'text-green-400'
                          : ''
                      }>
                        {line}
                      </div>
                    ))
                  )}
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  {logLines.length} lines · venuescope-worker service · journalctl
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Live Jobs ──────────────────────────────────────────────────────── */}
      {opsStatus && opsStatus.liveJobs.length > 0 && (
        <motion.div className="glass-card overflow-hidden"
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        >
          <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
            <Zap className="w-4 h-4 text-green-400 animate-pulse" />
            <span className="font-semibold text-white text-sm">
              Live Jobs ({opsStatus.liveJobs.length})
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-gray-500 text-xs uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Camera</th>
                  <th className="text-left px-4 py-3">Mode</th>
                  <th className="text-left px-4 py-3">Venue</th>
                  <th className="text-right px-4 py-3">Running</th>
                  <th className="text-right px-4 py-3">Drinks/hr</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {opsStatus.liveJobs.map((job, i) => (
                  <tr key={i} className="hover:bg-white/3">
                    <td className="px-5 py-3 font-medium text-white">{job.camera || job.jobId}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 text-xs border border-cyan-500/20">
                        {job.mode}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{job.venueId}</td>
                    <td className="px-4 py-3 text-right text-gray-300">
                      {durationSince(
                        job.startedAt ? new Date(parseFloat(job.startedAt) * 1000).toISOString() : ''
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-green-400">
                      {job.drinksPerHour > 0 ? job.drinksPerHour.toFixed(1) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* ── Stale Warning ──────────────────────────────────────────────────── */}
      {staleVenues.length > 0 && (
        <motion.div
          className="p-4 rounded-xl border border-orange-500/40 bg-orange-500/10 flex items-start gap-3"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        >
          <AlertTriangle className="w-5 h-5 text-orange-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-orange-300 font-semibold text-sm">
              {staleVenues.length} venue{staleVenues.length > 1 ? 's have' : ' has'} not detected activity in &gt; 4 hours during business hours
            </p>
            <p className="text-orange-400/70 text-xs mt-1">
              Affected: {staleVenues.map(r => r.venue.venueName || r.venue.venueId).join(', ')}
            </p>
          </div>
        </motion.div>
      )}

      {/* ── Venue Health Table ─────────────────────────────────────────────── */}
      <motion.div className="glass-card overflow-hidden"
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
      >
        <div className="px-5 py-4 border-b border-white/10">
          <span className="font-semibold text-white text-sm">Venue Health</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-4">Venue</th>
                <th className="text-left px-4 py-4">Status</th>
                <th className="text-right px-4 py-4">Drinks Today</th>
                <th className="text-right px-4 py-4">Last Hour</th>
                <th className="text-left px-4 py-4">Last Detection</th>
                <th className="text-left px-4 py-4">Cameras</th>
                <th className="px-4 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isTableLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-4"><Skeleton className="h-5" /></td>
                  ))}</tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                    <Activity className="w-8 h-8 mx-auto mb-3 opacity-40" />
                    <p>No venues to display</p>
                  </td>
                </tr>
              ) : rows.map((row, idx) => (
                <motion.tr
                  key={row.venue.venueId}
                  className="hover:bg-white/3 transition-colors group"
                  initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.04 }}
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <HealthDot health={row.health} />
                      <div>
                        <div className="font-medium text-white">{row.venue.venueName || row.venue.venueId}</div>
                        <div className="text-xs text-gray-500">{row.venue.venueId}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      row.venue.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>{row.venue.status}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="font-semibold text-white">{row.drinksToday}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className={row.drinksLastHour > 0 ? 'text-cyan-400 font-semibold' : 'text-gray-500'}>
                      {row.drinksLastHour}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span className={
                      row.health === 'green' ? 'text-green-400' :
                      row.health === 'yellow' ? 'text-yellow-400' : 'text-red-400'
                    }>{timeAgo(row.lastDetectionTs)}</span>
                  </td>
                  <td className="px-4 py-4">
                    {loadingCameras ? <Skeleton className="h-4 w-12" /> : (
                      <div className="flex items-center gap-1.5">
                        <Camera className="w-3.5 h-3.5 text-gray-500" />
                        <span className={row.camerasActive > 0 ? 'text-white' : 'text-gray-500'}>
                          {row.camerasActive}/{row.camerasTotal}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <button className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300">
                      View Jobs <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* ── Footer Summary ─────────────────────────────────────────────────── */}
      {!isTableLoading && rows.length > 0 && (
        <motion.div className="flex flex-wrap gap-4 text-xs text-gray-500"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
        >
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            Active ({'<'}2h): {rows.filter(r => r.health === 'green').length}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-yellow-400" />
            Idle (2–8h): {rows.filter(r => r.health === 'yellow').length}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            Stale ({'>'} 8h): {rows.filter(r => r.health === 'red').length}
          </span>
          <span className="ml-auto">
            {rows.reduce((a, r) => a + r.drinksToday, 0)} total drinks today
          </span>
        </motion.div>
      )}
    </div>
  );
}
