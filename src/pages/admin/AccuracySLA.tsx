/**
 * AccuracySLA — admin-only per-venue × per-feature accuracy dashboard.
 *
 * The 99% SLA is how you deliver on the promise to customers. This page is
 * where the engineer on duty sees which venues are hitting, which are
 * drifting, and which features lack ground-truth coverage entirely.
 *
 * Data today:
 *   - Drink accuracy from worker confidence + unrung counts (proxy until
 *     review-queue backend lands per-event truth).
 *   - Forecast MAPE from backfilled actuals on daily forecast records.
 *   - Everything else renders a clean "awaiting data" card with the reason.
 *
 * When P1-8b ships the review-queue plumbing + P4-2 ships monthly GT audits,
 * the placeholder cards fill in automatically — no UI change needed.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, AlertTriangle, XCircle, Circle, RefreshCw, Loader2,
  Target, TrendingDown, TrendingUp,
} from 'lucide-react';
import { useAdminVenue } from '../../contexts/AdminVenueContext';
import { VenueSelector } from '../../components/admin/VenueSelector';
import accuracyService, {
  VenueAccuracySnapshot, FeatureAccuracy, AccuracyBand,
} from '../../services/accuracy.service';

const BAND_UI: Record<AccuracyBand, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
  green:   { icon: CheckCircle2,     color: 'text-green-400',  label: 'On target' },
  yellow:  { icon: AlertTriangle,    color: 'text-yellow-400', label: 'At risk'  },
  red:     { icon: XCircle,          color: 'text-red-400',    label: 'Off target' },
  'no-data': { icon: Circle,         color: 'text-gray-500',   label: 'No data yet' },
};

function fmtAccuracy(f: FeatureAccuracy): string {
  if (f.value === undefined) return '—';
  if (f.metric === 'mape') return `${f.value.toFixed(1)}%`; // lower is better
  return `${f.value.toFixed(1)}%`;
}

function fmtTarget(f: FeatureAccuracy): string {
  if (f.metric === 'mape') return `≤ ${f.target}%`;
  return `≥ ${f.target}%`;
}

function FeatureCard({ feature }: { feature: FeatureAccuracy }) {
  const ui = BAND_UI[feature.band];
  const Icon = ui.icon;
  const Trend = feature.metric === 'mape' ? TrendingDown : TrendingUp;
  return (
    <motion.div
      layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="glass-card p-4 flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">{feature.label}</div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`text-2xl font-bold ${ui.color}`}>
              {fmtAccuracy(feature)}
            </span>
            <span className="text-xs text-gray-500">
              target {fmtTarget(feature)}
            </span>
          </div>
        </div>
        <Icon className={`w-5 h-5 ${ui.color} flex-shrink-0`} />
      </div>
      <div className="text-xs text-gray-400 leading-relaxed">
        {feature.narrative}
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
        <span>
          <Trend className="w-3 h-3 inline mr-1" />
          {feature.metric === 'mape' ? 'MAPE' : '% accuracy'}
        </span>
        <span>
          {feature.sampleSize > 0 ? `n=${feature.sampleSize}` : '—'}
        </span>
      </div>
    </motion.div>
  );
}

export function AccuracySLA() {
  const { selectedVenue, venues } = useAdminVenue();

  const [snapshots, setSnapshots] = useState<VenueAccuracySnapshot[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [err,       setErr]       = useState<string | null>(null);
  const [lastUpd,   setLastUpd]   = useState<Date | null>(null);
  const [viewMode,  setViewMode]  = useState<'current' | 'all'>('current');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const target = viewMode === 'all'
        ? venues
        : (selectedVenue ? [selectedVenue] : venues.slice(0, 1));
      const results = await Promise.all(
        target.map(v => accuracyService.getVenueSnapshot(v.venueId, v.venueName))
      );
      setSnapshots(results);
      setLastUpd(new Date());
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to compute accuracy');
    } finally {
      setLoading(false);
    }
  }, [selectedVenue, venues, viewMode]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Aggregate all-venue rollup
  const rollup = useMemo(() => {
    if (snapshots.length === 0) return null;
    const allFeatures = snapshots.flatMap(s => s.features);
    const counts: Record<AccuracyBand, number> = { green: 0, yellow: 0, red: 0, 'no-data': 0 };
    for (const f of allFeatures) counts[f.band]++;
    const total = allFeatures.length;
    const coverage = total ? (counts.green + counts.yellow + counts.red) / total : 0;
    return { counts, total, coverage };
  }, [snapshots]);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="glass-card p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Target className="w-5 h-5 text-green-400" />
              Accuracy SLA
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Per-venue, per-feature. Target: 99% on counting features (drinks, people, turns),
              90% on pour detection, MAPE &lt; 15% on staffing forecast. Backed by POS
              reconciliation, worker confidence, and periodic ground-truth audits.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lastUpd && (
              <span className="text-xs text-gray-500">
                updated {lastUpd.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchAll} disabled={loading}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white text-xs"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Refresh
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <VenueSelector />
          <div className="flex items-center gap-1 bg-white/5 rounded p-0.5 text-xs">
            <button
              onClick={() => setViewMode('current')}
              className={`px-3 py-1 rounded ${viewMode === 'current' ? 'bg-cyan-600 text-white' : 'text-gray-400'}`}
            >Selected venue</button>
            <button
              onClick={() => setViewMode('all')}
              className={`px-3 py-1 rounded ${viewMode === 'all' ? 'bg-cyan-600 text-white' : 'text-gray-400'}`}
            >All venues</button>
          </div>
        </div>

        {err && (
          <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
            {err}
          </div>
        )}

        {/* Rollup tiles */}
        {rollup && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(['green', 'yellow', 'red', 'no-data'] as AccuracyBand[]).map(b => {
              const ui = BAND_UI[b];
              const Icon = ui.icon;
              return (
                <div key={b} className="bg-white/5 border border-white/10 rounded p-3 flex items-center gap-3">
                  <Icon className={`w-5 h-5 ${ui.color}`} />
                  <div>
                    <div className="text-xs uppercase tracking-wide text-gray-400">
                      {ui.label}
                    </div>
                    <div className={`text-xl font-bold ${ui.color}`}>
                      {rollup.counts[b]}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Per-venue sections ─────────────────────────────────────────── */}
      {loading ? (
        <div className="glass-card p-8 flex items-center justify-center text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Computing accuracy…
        </div>
      ) : snapshots.length === 0 ? (
        <div className="glass-card p-10 text-center text-gray-400">
          No venues to score.
        </div>
      ) : (
        <AnimatePresence>
          {snapshots.map(s => {
            const overallUi = BAND_UI[s.overall];
            const OverallIcon = overallUi.icon;
            return (
              <motion.div key={s.venueId}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="glass-card overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-white/10 flex items-center gap-3">
                  <OverallIcon className={`w-5 h-5 ${overallUi.color}`} />
                  <div>
                    <div className="font-semibold text-white">{s.venueName}</div>
                    <div className="text-xs text-gray-500">{s.venueId}</div>
                  </div>
                  <span className="ml-auto text-xs text-gray-400">
                    {s.features.filter(f => f.band !== 'no-data').length} of {s.features.length} features measured
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-4">
                  {s.features.map(f => (
                    <FeatureCard key={f.feature} feature={f} />
                  ))}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      )}
    </div>
  );
}

export default AccuracySLA;
