/**
 * CoveragePanel — Data Coverage timeline + DR Replay queue for a venue.
 *
 * Pulls /ops/replay/gaps for the last 7 local days (parallel one-call-per-day)
 * and renders a row-per-camera × column-per-day grid. Each cell shows total
 * gap minutes for that day, color-coded. Click any gap → opens the schedule
 * modal so the operator can queue a fill.
 *
 * Below the timeline: the replay queue (pending → running → recent done/failed)
 * fetched from /ops/replay/jobs, with cancel button on pending rows.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldAlert, Loader2, RefreshCw, AlertTriangle, CheckCircle2,
  XCircle, Clock, Calendar, PlayCircle,
} from 'lucide-react';
import adminService from '../../services/admin.service';
import { ReplayScheduleModal } from './ReplayScheduleModal';

interface Props {
  venueId: string;
  /** ISO tz the venue operates in. UI defaults to NY if unknown. */
  tz?: string;
}

interface Gap {
  cameraId:    string;
  cameraName:  string;
  start:       string;
  end:         string;
  startEpoch:  number;
  endEpoch:    number;
  durationSec: number;
  /** Local date (YYYY-MM-DD in venue tz) — added by the loader. */
  dateIso:     string;
}

interface ReplayJob {
  jobId:        string;
  label:        string;
  status:       string;
  progress:     number;
  createdAt:    number;
  finishedAt?:  number;
  scheduledFor?: number;
  errorMessage?: string;
  gaps:         Array<{ cameraId: string; cameraName: string;
                        startEpoch: number; endEpoch: number; durationSec: number }>;
  outputMode:   'publish' | 'admin_only';
  requestedBy:  string;
  tz:           string;
  summary?:     any;
}

const STATUS_COLORS: Record<string, string> = {
  pending:  'bg-amber-500/10  text-amber-300  border-amber-500/30',
  running:  'bg-cyan-500/15   text-cyan-300   border-cyan-500/40',
  done:     'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  failed:   'bg-red-500/10    text-red-300    border-red-500/30',
};

function fmtLocal(epoch: number, tz: string): string {
  try {
    return new Date(epoch * 1000).toLocaleString('en-US', {
      timeZone: tz, month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return new Date(epoch * 1000).toLocaleString(); }
}

function fmtMinutes(sec: number): string {
  if (sec < 60)   return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function lastNDates(n: number, tz: string): string[] {
  // Build N local dates ending today (newest last). en-CA gives YYYY-MM-DD.
  const out: string[] = [];
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    out.push(fmt.format(d));
  }
  return out;
}

export function CoveragePanel({ venueId, tz = 'America/New_York' }: Props) {
  const [gaps,    setGaps]    = useState<Gap[]>([]);
  const [jobs,    setJobs]    = useState<ReplayJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [modalGap, setModalGap] = useState<Gap | null>(null);

  const dates = useMemo(() => lastNDates(7, tz), [tz]);

  const refresh = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    setError(null);
    try {
      const [gapResults, jobResp] = await Promise.all([
        Promise.all(dates.map(async d => {
          try {
            const r = await adminService.getReplayGaps(venueId, d, tz);
            return (r.gaps || []).map(g => ({ ...g, dateIso: d }));
          } catch {
            return [] as Gap[];          // best-effort per-day
          }
        })),
        adminService.listReplayJobs(venueId).catch(() => ({ jobs: [], count: 0 })),
      ]);
      setGaps(gapResults.flat());
      setJobs(jobResp.jobs || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [venueId, dates, tz]);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh every 15s while a replay is running.
  useEffect(() => {
    if (!jobs.some(j => j.status === 'running' || j.status === 'pending')) return;
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [jobs, refresh]);

  // ── Aggregate gaps by (camera, date) for the heatmap ──────────────────────
  const cameras = useMemo(() => {
    const set = new Set<string>();
    gaps.forEach(g => set.add(`${g.cameraId}::${g.cameraName}`));
    return Array.from(set).sort().map(s => {
      const [id, name] = s.split('::');
      return { id, name };
    });
  }, [gaps]);

  const heatmap = useMemo(() => {
    // Map<cameraId, Map<dateIso, Gap[]>>
    const m = new Map<string, Map<string, Gap[]>>();
    gaps.forEach(g => {
      let row = m.get(g.cameraId);
      if (!row) { row = new Map(); m.set(g.cameraId, row); }
      const arr = row.get(g.dateIso) || [];
      arr.push(g);
      row.set(g.dateIso, arr);
    });
    return m;
  }, [gaps]);

  const totalGapMinutes = useMemo(
    () => Math.round(gaps.reduce((s, g) => s + g.durationSec, 0) / 60),
    [gaps]
  );

  const handleCancelJob = async (jobId: string) => {
    if (!confirm('Cancel this queued replay?')) return;
    try {
      await adminService.cancelReplayJob(venueId, jobId);
      refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="glass-card overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <span className="font-semibold text-white text-sm">
            Data Coverage — Last 7 Days
          </span>
          <span className="text-xs text-gray-500 ml-2">
            {totalGapMinutes > 0
              ? `${totalGapMinutes} min total gap across ${cameras.length} cameras`
              : 'No gaps detected'}
          </span>
          <div className="flex-1" />
          <button
            onClick={refresh}
            disabled={loading}
            className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="m-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!error && cameras.length === 0 && !loading && (
          <div className="px-5 py-8 text-center text-sm text-gray-400">
            <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-emerald-400/70" />
            All enabled cameras have full coverage for the last 7 days.
          </div>
        )}

        {cameras.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-gray-500 text-[10px] uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Camera</th>
                  {dates.map(d => (
                    <th key={d} className="text-center px-2 py-3 min-w-[70px]">
                      {new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
                        timeZone: tz, month: 'short', day: 'numeric',
                      })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {cameras.map(cam => {
                  const row = heatmap.get(cam.id);
                  return (
                    <tr key={cam.id}>
                      <td className="px-5 py-2.5 font-medium text-white whitespace-nowrap">
                        {cam.name}
                        <span className="ml-2 text-[10px] text-gray-500 font-mono">
                          {cam.id}
                        </span>
                      </td>
                      {dates.map(d => {
                        const cellGaps = row?.get(d) || [];
                        const totalMin = Math.round(
                          cellGaps.reduce((s, g) => s + g.durationSec, 0) / 60,
                        );
                        const intensity = Math.min(1, totalMin / 240); // cap at 4hr
                        const bgColor =
                          totalMin === 0 ? 'bg-emerald-500/5  hover:bg-emerald-500/10' :
                          totalMin < 30  ? 'bg-amber-500/15   hover:bg-amber-500/25' :
                          totalMin < 120 ? 'bg-orange-500/20  hover:bg-orange-500/30' :
                                           'bg-red-500/25     hover:bg-red-500/40';
                        return (
                          <td key={d} className="px-1 py-2 text-center">
                            {totalMin === 0 ? (
                              <div className={`mx-auto w-12 h-7 rounded ${bgColor} flex items-center justify-center text-[10px] text-emerald-400/40`}>
                                ✓
                              </div>
                            ) : (
                              <button
                                onClick={() => setModalGap(cellGaps[0])}
                                title={cellGaps.map(g =>
                                  `${fmtLocal(g.startEpoch, tz)} → ${fmtLocal(g.endEpoch, tz)} (${fmtMinutes(g.durationSec)})`
                                ).join('\n')}
                                style={{ opacity: 0.5 + 0.5 * intensity }}
                                className={`mx-auto w-12 h-7 rounded ${bgColor} flex items-center justify-center text-[11px] font-mono text-white border border-white/10 hover:border-fuchsia-500/40 transition-colors`}
                              >
                                {totalMin >= 60 ? `${Math.round(totalMin/60)}h` : `${totalMin}m`}
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-5 py-2.5 text-[10px] text-gray-500 border-t border-white/5">
              Click any cell to schedule a DR replay for that gap. Heatmap intensity reflects total gap minutes per day per camera.
            </div>
          </div>
        )}
      </motion.div>

      {/* ── Replay Queue ──────────────────────────────────────────────────── */}
      {jobs.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
            <PlayCircle className="w-4 h-4 text-fuchsia-400" />
            <span className="font-semibold text-white text-sm">
              Replay Queue ({jobs.length})
            </span>
            <span className="text-xs text-gray-500 ml-2">
              one runs at a time per droplet
            </span>
          </div>
          <div className="divide-y divide-white/5">
            {jobs.map(j => (
              <div key={j.jobId} className="px-5 py-3 flex items-start gap-3">
                <span className={`mt-0.5 px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider font-semibold ${STATUS_COLORS[j.status] || ''}`}>
                  {j.status}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white font-medium truncate">{j.label}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
                    {j.scheduledFor ? (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        runs {fmtLocal(j.scheduledFor, tz)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> immediate
                      </span>
                    )}
                    <span>{j.gaps.length} gap(s)</span>
                    <span>tz {j.tz}</span>
                    <span>by {j.requestedBy}</span>
                    <span className={j.outputMode === 'publish'
                      ? 'text-fuchsia-300/80'
                      : 'text-gray-500'}>
                      {j.outputMode === 'publish' ? 'publish to Reports' : 'admin only'}
                    </span>
                  </div>
                  {j.status === 'running' && (
                    <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden max-w-md">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 transition-all"
                        style={{ width: `${Math.max(2, Math.min(99, j.progress))}%` }}
                      />
                    </div>
                  )}
                  {j.errorMessage && (
                    <div className="mt-1 text-[11px] text-red-300/80">{j.errorMessage}</div>
                  )}
                </div>
                {j.status === 'pending' && (
                  <button
                    onClick={() => handleCancelJob(j.jobId)}
                    title="Cancel queued replay"
                    className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-medium flex items-center gap-1"
                  >
                    <XCircle className="w-3 h-3" />
                    Cancel
                  </button>
                )}
                {j.status === 'running' && (
                  <span className="px-2.5 py-1 text-cyan-300 text-xs flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {Math.round(j.progress)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Schedule modal ─────────────────────────────────────────────────── */}
      {modalGap && (
        <ReplayScheduleModal
          venueId={venueId}
          tz={tz}
          gaps={
            // Pull every gap on the same camera + date as the clicked one so
            // the operator queues all of that day's outages in one job.
            gaps.filter(g =>
              g.cameraId === modalGap.cameraId && g.dateIso === modalGap.dateIso
            )
          }
          onClose={() => setModalGap(null)}
          onCreated={() => { setModalGap(null); refresh(); }}
        />
      )}
    </>
  );
}
