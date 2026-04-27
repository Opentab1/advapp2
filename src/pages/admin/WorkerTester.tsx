import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FlaskConical, Plus, Trash2, RefreshCw, Activity } from 'lucide-react';
import { useAdminVenue } from '../../contexts/AdminVenueContext';
import {
  listTestRuns,
  deleteTestRun,
  TestRun,
  FeatureGrade,
} from '../../services/workerTester.service';

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
                    <p className="text-[11px] text-gray-500 mt-1">{Math.round(run.progress)}% complete</p>
                  </div>
                )}

                {/* Final grade */}
                {run.results && run.results.overallGrade && (
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex flex-col items-center justify-center w-14 h-14 rounded-xl bg-white/5 border border-white/10">
                      <span className={`text-2xl font-black ${GRADE_COLORS[run.results.overallGrade]}`}>
                        {run.results.overallGrade}
                      </span>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-gray-500">Stability</p>
                      <p className={`text-sm font-semibold ${run.results.stabilityGrade === 'stable' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {run.results.stabilityGrade ?? '—'}
                      </p>
                    </div>
                    {run.results.notes?.length ? (
                      <div className="text-[11px] text-amber-300/80 max-w-md">
                        {run.results.notes.slice(0, 2).join(' · ')}
                      </div>
                    ) : null}
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

      {/* Modal placeholder — full form ships in Phase 5 */}
      {showNew && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="rounded-2xl bg-zinc-900 border border-white/10 p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-2">New Test Run</h2>
            <p className="text-sm text-gray-400">
              The full form (date/time picker, camera + feature selection, ground truth entry)
              ships in Phase 5. The foundation, Lambda CRUD, and DDB table are in place — you
              can already POST to <code className="text-amber-400">/admin/test-runs</code>.
            </p>
            <button
              onClick={() => setShowNew(false)}
              className="mt-4 w-full py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
