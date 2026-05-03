/**
 * PlaybackTab — venue-scoped historical/replay operations.
 *
 * Two sections, both running on the venue's own droplet:
 *
 *   1. Coverage & DR Replay
 *      - 7-day timeline heatmap of gaps in live capture
 *      - Click a gap → schedule a replay (default 4am venue-local,
 *        staggered by venue hash so concurrent venues don't all hit their
 *        NVRs at the same wall-clock minute)
 *      - Queue table of pending/running/done replay jobs
 *
 *   2. Test Runs (Worker Tester)
 *      - Replay arbitrary historical windows through the inference
 *        pipeline for accuracy testing — does not publish to consumer
 *        Reports. Same NVR connection the live worker already uses.
 *
 * Both share the worker's serial replay queue (one job at a time per
 * droplet). Operator schedules urgent stuff for "Run now," everything
 * else for venue-local off-hours.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Trash2, RefreshCw, ChevronDown, Activity,
} from 'lucide-react';
import { CoveragePanel } from './CoveragePanel';
import { WorkerTesterNewRunModal } from './WorkerTesterNewRunModal';
import {
  listTestRuns, deleteTestRun, getSnapshotUrl,
  TestRun, FeatureGrade, ServeEvent, FEATURE_LABELS,
} from '../../services/workerTester.service';
import authService from '../../services/auth.service';

interface Props {
  venueId:   string;
  venueName: string;
  /** IANA tz used for gap-detection day boundaries + scheduling defaults.
   *  Falls back to America/New_York when the venue has no businessHours yet. */
  tz?:       string;
}

const STATUS_COLORS: Record<string, string> = {
  pending:  'bg-gray-500/15 text-gray-300 border-gray-500/30',
  running:  'bg-amber-500/15 text-amber-300 border-amber-500/40',
  complete: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  failed:   'bg-red-500/15 text-red-300 border-red-500/40',
};

const GRADE_COLORS: Record<FeatureGrade, string> = {
  A: 'text-emerald-400',
  B: 'text-lime-400',
  C: 'text-amber-400',
  D: 'text-orange-400',
  F: 'text-red-400',
};

export function PlaybackTab({ venueId, tz = 'America/New_York' }: Props) {
  return (
    <div className="space-y-6">
      {/* ── Section 1: Coverage & DR Replay ──────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-3">
          Coverage &amp; DR Replay
        </h2>
        <p className="text-xs text-gray-400 mb-4 max-w-3xl">
          Gaps in live capture are surfaced below for the last 7 days. Click any
          red cell to queue a replay that re-runs the missed window through this
          venue's worker. By default replays run at venue-local off-hours so
          they don't compete with live monitoring for CPU/RAM.
        </p>
        <CoveragePanel venueId={venueId} tz={tz} />
      </div>

      {/* ── Section 2: Test Runs ─────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-3">
          Test Runs
        </h2>
        <p className="text-xs text-gray-400 mb-4 max-w-3xl">
          Replay historical NVR footage through the worker for accuracy testing.
          Results stay admin-only — the venue's Reports tab is unaffected. Use
          this to validate config tweaks, calibrate new cameras, or grade a
          shift before going live.
        </p>
        <VenueTestRunsSection venueId={venueId} />
      </div>
    </div>
  );
}

// ── Test runs section (venue-scoped) ────────────────────────────────────

function VenueTestRunsSection({ venueId }: { venueId: string }) {
  const [runs, setRuns]       = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [createdBy, setCreatedBy] = useState('admin');

  useEffect(() => {
    authService.getCurrentAuthenticatedUser()
      .then(u => u?.email && setCreatedBy(u.email))
      .catch(() => { /* fall back to 'admin' */ });
  }, []);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setRuns(await listTestRuns(venueId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [venueId]);

  // Auto-refresh while any run is pending or running.
  useEffect(() => {
    if (!runs.some(r => r.status === 'pending' || r.status === 'running')) return;
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, venueId]);

  const handleDelete = async (runId: string) => {
    if (!confirm('Delete this test run? Results cannot be recovered.')) return;
    try {
      await deleteTestRun(runId);
      setRuns(rs => rs.filter(r => r.runId !== runId));
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowNew(true)}
          className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-fuchsia-500 to-purple-600 hover:opacity-90 text-white font-semibold text-xs flex items-center gap-1.5 shadow-lg shadow-fuchsia-500/20"
        >
          <Plus className="w-3.5 h-3.5" />
          New Test Run
        </button>
        <button
          onClick={refresh}
          disabled={loading}
          className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 disabled:opacity-50 flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        <span className="text-[11px] text-gray-500 ml-2">
          {runs.length} run{runs.length === 1 ? '' : 's'} for this venue
        </span>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
          {error}
        </div>
      )}

      {!loading && runs.length === 0 && !error && (
        <div className="text-center py-10 rounded-2xl border border-dashed border-white/10 bg-white/[0.02]">
          <Activity className="w-7 h-7 mx-auto mb-2 text-gray-500" />
          <p className="text-gray-400 text-sm">No test runs for this venue yet.</p>
          <p className="text-gray-500 text-xs mt-1">
            Create one to replay a historical shift through the worker.
          </p>
        </div>
      )}

      {runs.map(run => (
        <motion.div
          key={run.runId}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 p-4 transition-colors"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold border ${STATUS_COLORS[run.status]}`}>
                  {run.status}
                </span>
                <span className="text-sm text-white font-semibold">
                  {run.replayDate} · {run.replayStartTime}–{run.replayEndTime}
                </span>
                <span className="text-xs text-gray-500">{run.replayTimezone}</span>
              </div>
              <div className="text-xs text-gray-400 mb-1.5">
                {run.cameras.length} camera{run.cameras.length !== 1 ? 's' : ''} ·{' '}
                {[...new Set(run.cameras.flatMap(c => c.features))].join(', ')}
              </div>
              <div className="text-[11px] text-gray-500">
                Created {new Date(run.createdAt).toLocaleString()} by {run.createdBy}
              </div>

              {run.status === 'running' && (
                <div className="mt-2 max-w-md">
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-fuchsia-500 to-purple-500 transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, run.progress))}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    {Math.round(run.progress)}% complete
                  </p>
                </div>
              )}

              {run.results && (
                <div className="mt-3">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-white/5 border border-white/10">
                      {run.results.overallGrade ? (
                        <span className={`text-2xl font-black ${GRADE_COLORS[run.results.overallGrade]}`}>
                          {run.results.overallGrade}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-500 font-semibold tracking-wider">N/A</span>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-gray-500">Stability</p>
                      <p className={`text-xs font-semibold ${run.results.stabilityGrade === 'stable' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {run.results.stabilityGrade ?? '—'}
                      </p>
                    </div>
                    <div className="flex-1" />
                    <button
                      onClick={() => setExpanded(s => {
                        const next = new Set(s);
                        if (next.has(run.runId)) next.delete(run.runId);
                        else next.add(run.runId);
                        return next;
                      })}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200"
                    >
                      Details
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform ${expanded.has(run.runId) ? 'rotate-180' : ''}`}
                      />
                    </button>
                  </div>
                  {expanded.has(run.runId) && (
                    <>
                      <FeatureBreakdown results={run.results} />
                      <ServeEventsGallery liveCounts={run.liveCounts} />
                    </>
                  )}
                </div>
              )}

              {run.errorMessage && (
                <div className="mt-2 text-xs text-red-300/90">
                  {run.errorMessage}
                </div>
              )}
            </div>

            <button
              onClick={() => handleDelete(run.runId)}
              title="Delete run"
              className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      ))}

      <WorkerTesterNewRunModal
        open={showNew}
        venueId={venueId}
        createdBy={createdBy}
        onClose={() => setShowNew(false)}
        onCreated={() => { refresh(); }}
      />
    </div>
  );
}

// ── Feature breakdown (mirrors WorkerTester.tsx) ─────────────────────────

function FeatureBreakdown({ results }: { results: NonNullable<TestRun['results']> }) {
  const features = Object.entries(results.perFeature || {});
  if (!features.length) return null;
  return (
    <div className="mt-3 border-t border-white/5 pt-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        Feature breakdown
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {features.map(([fname, fdata]) => {
          const grade = fdata.grade as FeatureGrade | null;
          const cls = grade ? GRADE_COLORS[grade] : 'text-gray-500';
          return (
            <div key={fname} className="rounded-lg bg-white/[0.03] border border-white/5 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-300 font-medium">
                  {(FEATURE_LABELS as Record<string, string>)[fname] || fname}
                </span>
                <span className={`text-base font-black ${cls}`}>
                  {grade ?? '—'}
                </span>
              </div>
              <div className="text-[10px] text-gray-500 mt-1">
                detected {fdata.detected ?? 0}
                {fdata.expected != null && <span> · expected {fdata.expected}</span>}
                {fdata.errorPct != null && <span> · {(fdata.errorPct * 100).toFixed(1)}% error</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ServeEventsGallery({ liveCounts }: { liveCounts: TestRun['liveCounts'] }) {
  const events: Array<ServeEvent & { cameraId: string }> = [];
  for (const [cid, payload] of Object.entries(liveCounts || {})) {
    const evList = (payload as any)?._events;
    if (Array.isArray(evList)) {
      for (const e of evList) events.push({ ...e, cameraId: cid });
    }
  }
  const [lightbox, setLightbox] = useState<{ url: string; event: ServeEvent } | null>(null);
  if (!events.length) return null;

  return (
    <div className="mt-3 border-t border-white/5 pt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
          Detected serves ({events.length})
        </div>
        <div className="text-[10px] text-gray-600">click a snapshot to enlarge</div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {events.slice(0, 24).map((e, i) => (
          <ServeThumb
            key={i} index={i} event={e}
            onZoom={(url) => setLightbox({ url, event: e })}
          />
        ))}
      </div>
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.url} alt="serve snapshot"
              className="w-full h-auto rounded-lg border border-white/10" />
            <button onClick={() => setLightbox(null)}
              className="mt-3 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white text-xs">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ServeThumb({
  event, onZoom, index,
}: {
  event: ServeEvent & { cameraId: string };
  onZoom: (url: string) => void;
  index: number;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!event.snapshot) return;
    let cancelled = false;
    setLoading(true);
    const stagger = Math.min(index, 12) * 80;
    const fetchOnce = () => getSnapshotUrl(event.snapshot!);
    const t = setTimeout(() => {
      fetchOnce()
        .catch(() => new Promise(r => setTimeout(r, 400)).then(fetchOnce))
        .then((u) => { if (!cancelled) setUrl(u); })
        .catch(() => { /* swallow — thumbnail just won't render */ })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, stagger);
    return () => { cancelled = true; clearTimeout(t); };
  }, [event.snapshot, index]);

  const ts = `${Math.floor(event.t / 60)}:${String(Math.floor(event.t % 60)).padStart(2, '0')}`;

  return (
    <button
      onClick={() => url && onZoom(url)}
      disabled={!url}
      className="text-left rounded-lg bg-white/[0.03] border border-white/10 hover:border-fuchsia-500/40 p-2 disabled:opacity-50 transition-colors"
      title={event.reason || 'serve event'}
    >
      <div className="aspect-video bg-black/30 rounded mb-1.5 overflow-hidden flex items-center justify-center">
        {url ? (
          <img src={url} alt="serve" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span className="text-[10px] text-gray-500">{loading ? 'loading…' : 'no preview'}</span>
        )}
      </div>
      <div className="text-[11px] text-white font-mono">+{ts}</div>
      <div className="text-[10px] text-gray-500">
        score {event.score?.toFixed(2)} · {event.station || '—'}
      </div>
    </button>
  );
}
