import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FlaskConical, Plus, Trash2, RefreshCw, Activity, ChevronDown } from 'lucide-react';
import { useAdminVenue } from '../../contexts/AdminVenueContext';
import {
  listTestRuns,
  deleteTestRun,
  getSnapshotUrl,
  TestRun,
  FeatureGrade,
  ServeEvent,
  FEATURE_LABELS,
} from '../../services/workerTester.service';
import { WorkerTesterNewRunModal } from '../../components/admin/WorkerTesterNewRunModal';
import authService from '../../services/auth.service';

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

export function WorkerTester() {
  const { selectedVenueId } = useAdminVenue();
  const venueId = selectedVenueId;
  const [runs, setRuns]       = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [createdBy, setCreatedBy] = useState('admin');
  useEffect(() => {
    authService.getCurrentAuthenticatedUser()
      .then(u => u?.email && setCreatedBy(u.email))
      .catch(() => { /* no-op — fall back to 'admin' */ });
  }, []);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listTestRuns(venueId || undefined);
      setRuns(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      // Auto-refresh while any run is pending/running
      if (runs.some(r => r.status === 'pending' || r.status === 'running')) {
        refresh();
      }
    }, 5_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

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
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between mb-6"
      >
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-700 flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">Worker Tester</h1>
            <span className="px-2 py-0.5 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/40 text-fuchsia-300 text-[10px] uppercase tracking-wider font-semibold">
              Admin Only
            </span>
          </div>
          <p className="text-sm text-gray-400 max-w-2xl">
            Replay historical NVR footage through the live worker pipeline. Compare detections
            against ground truth, watch worker health in real time, get an A-F grade. Results
            never leave this page — customers do not see them.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={refresh}
            disabled={loading}
            className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-gray-300 disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-fuchsia-500 to-purple-600 hover:opacity-90 text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-fuchsia-500/20"
          >
            <Plus className="w-4 h-4" />
            New Test Run
          </button>
        </div>
      </motion.div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Runs list */}
      <div className="space-y-3">
        {!loading && runs.length === 0 && !error && (
          <div className="text-center py-16 rounded-2xl border border-dashed border-white/10 bg-white/[0.02]">
            <Activity className="w-10 h-10 mx-auto mb-3 text-gray-500" />
            <p className="text-gray-400 text-sm">No test runs yet.</p>
            <p className="text-gray-500 text-xs mt-1">
              Create one to replay a historical shift through the worker.
            </p>
          </div>
        )}

        {runs.map(run => (
          <motion.div
            key={run.runId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 p-5 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold border ${STATUS_COLORS[run.status]}`}>
                    {run.status}
                  </span>
                  <span className="text-sm text-white font-semibold">
                    {run.replayDate} · {run.replayStartTime}–{run.replayEndTime}
                  </span>
                  <span className="text-xs text-gray-500">{run.replayTimezone}</span>
                </div>
                <div className="text-xs text-gray-400 mb-2">
                  {run.cameras.length} camera{run.cameras.length !== 1 ? 's' : ''} ·{' '}
                  {[...new Set(run.cameras.flatMap(c => c.features))].join(', ')} ·{' '}
                  {run.pauseLiveCams ? 'Live cams paused' : 'Shared with live'}
                </div>
                <div className="text-[11px] text-gray-500">
                  Created {new Date(run.createdAt).toLocaleString()} by {run.createdBy}
                </div>

                {/* Progress bar (running) */}
                {run.status === 'running' && (
                  <div className="mt-3">
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-fuchsia-500 to-purple-500 transition-all"
                        style={{ width: `${Math.max(0, Math.min(100, run.progress))}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1">
                      {Math.round(run.progress)}% complete
                      {(() => {
                        if (!run.startedAt || run.progress < 2) return null;
                        const startMs = Date.parse(run.startedAt);
                        if (Number.isNaN(startMs)) return null;
                        const elapsedMs = Date.now() - startMs;
                        const totalMs = elapsedMs * 100 / run.progress;
                        const remainMs = Math.max(0, totalMs - elapsedMs);
                        const fmt = (ms: number) => {
                          const m = Math.floor(ms / 60000);
                          const s = Math.floor((ms % 60000) / 1000);
                          return m > 0 ? `${m}m ${s}s` : `${s}s`;
                        };
                        return (
                          <span className="text-gray-400 ml-2">
                            · elapsed {fmt(elapsedMs)} · ~{fmt(remainMs)} remaining
                          </span>
                        );
                      })()}
                    </p>
                  </div>
                )}

                {/* Final grade — render whenever we have results,
                    even if overallGrade is null (no ground truth set). */}
                {run.results && (
                  <div className="mt-3">
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-center justify-center w-14 h-14 rounded-xl bg-white/5 border border-white/10">
                        {run.results.overallGrade ? (
                          <span className={`text-2xl font-black ${GRADE_COLORS[run.results.overallGrade]}`}>
                            {run.results.overallGrade}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500 font-semibold tracking-wider">N/A</span>
                        )}
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-gray-500">Stability</p>
                        <p className={`text-sm font-semibold ${run.results.stabilityGrade === 'stable' ? 'text-emerald-400' : 'text-red-400'}`}>
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
                    {run.results.notes?.length ? (
                      <div className="text-[11px] text-amber-300/80 mt-2">
                        {run.results.notes.slice(0, 2).join(' · ')}
                      </div>
                    ) : null}
                    {expanded.has(run.runId) && (
                      <>
                        <FeatureBreakdown results={run.results} />
                        <ServeEventsGallery liveCounts={run.liveCounts} />
                      </>
                    )}
                  </div>
                )}

                {/* Error message */}
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
      </div>

      {/* New Run modal */}
      <WorkerTesterNewRunModal
        open={showNew}
        venueId={venueId || ''}
        createdBy={createdBy}
        onClose={() => setShowNew(false)}
        onCreated={() => { refresh(); }}
      />
    </div>
  );
}

// ── Per-feature breakdown component (renders inside the run card) ─────────

interface FeatureBreakdownProps {
  results: NonNullable<TestRun['results']>;
}

export function FeatureBreakdown({ results }: FeatureBreakdownProps) {
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
          const colors: Record<string, string> = {
            A: 'text-emerald-400',
            B: 'text-lime-400',
            C: 'text-amber-400',
            D: 'text-orange-400',
            F: 'text-red-400',
          };
          const cls = grade ? colors[grade] : 'text-gray-500';
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
                {fdata.expected != null && (
                  <span> · expected {fdata.expected}</span>
                )}
                {fdata.errorPct != null && (
                  <span> · {(fdata.errorPct * 100).toFixed(1)}% error</span>
                )}
              </div>
              {fdata.notes && fdata.notes.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {fdata.notes.slice(0, 2).map((n: string, i: number) => (
                    <li key={i} className="text-[10px] text-amber-300/80">• {n}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ServeEventsGallery — admin-only screenshot verification ─────────────────

interface ServeEventsGalleryProps {
  liveCounts: TestRun['liveCounts'];
}

export function ServeEventsGallery({ liveCounts }: ServeEventsGalleryProps) {
  // Gather all _events arrays across cameras
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
        <div className="text-[10px] text-gray-600">
          click a snapshot to enlarge
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {events.slice(0, 24).map((e, i) => (
          <ServeThumb key={i} event={e} onZoom={(url) => setLightbox({ url, event: e })} />
        ))}
      </div>
      {events.length > 24 && (
        <div className="text-[10px] text-gray-500 mt-2">
          showing first 24 of {events.length} serves
        </div>
      )}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative max-w-5xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightbox.url}
              alt="serve snapshot"
              className="w-full h-auto rounded-lg border border-white/10"
            />
            <div className="mt-3 flex items-center justify-between text-xs text-gray-300">
              <div className="font-mono">
                +{Math.floor(lightbox.event.t / 60)}:{String(Math.floor(lightbox.event.t % 60)).padStart(2, '0')}
                <span className="text-gray-500"> · score {lightbox.event.score?.toFixed(2)} · {lightbox.event.station || '—'}</span>
              </div>
              <button
                onClick={() => setLightbox(null)}
                className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ServeThumb({
  event,
  onZoom,
}: {
  event: ServeEvent & { cameraId: string };
  onZoom: (url: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Auto-fetch the presigned URL on mount so the thumbnail renders inline.
  useEffect(() => {
    let cancelled = false;
    if (!event.snapshot) return;
    setLoading(true);
    getSnapshotUrl(event.snapshot)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [event.snapshot]);

  const handleClick = () => {
    if (url) onZoom(url);
  };

  const ts = `${Math.floor(event.t / 60)}:${String(Math.floor(event.t % 60)).padStart(2, '0')}`;

  return (
    <button
      onClick={handleClick}
      disabled={!url}
      className="text-left rounded-lg bg-white/[0.03] border border-white/10 hover:border-fuchsia-500/40 p-2 disabled:opacity-50 transition-colors"
      title={event.reason || 'serve event'}
    >
      <div className="aspect-video bg-black/30 rounded mb-1.5 overflow-hidden flex items-center justify-center">
        {url ? (
          <img src={url} alt="serve" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span className="text-[10px] text-gray-500">
            {loading ? 'loading…' : (event.snapshot ? 'no preview' : 'no img')}
          </span>
        )}
      </div>
      <div className="text-[11px] text-white font-mono">+{ts}</div>
      <div className="text-[10px] text-gray-500">
        score {event.score?.toFixed(2)} · {event.station || '—'}
      </div>
      {error && <div className="text-[10px] text-red-300/80 mt-0.5">{error}</div>}
    </button>
  );
}
