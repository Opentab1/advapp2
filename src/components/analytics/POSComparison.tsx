/**
 * POSComparison - VenueScope drink count vs POS sales
 *
 * Fetches today's Toast POS metrics and compares against a manually entered
 * or stored VenueScope drink count. Flags variances > threshold.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, AlertTriangle, RefreshCw, TrendingDown, DollarSign, ChevronDown } from 'lucide-react';
import toastPosService from '../../services/toast-pos.service';

interface POSMetrics {
  totalOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
  topItems: Array<{ name: string; count: number }>;
}

const DRINK_COUNT_KEY = 'venuescope_last_drink_count';

function VarianceBadge({ pct }: { pct: number }) {
  const abs = Math.abs(pct);
  if (abs < 5) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-teal/15 text-teal border border-teal/30">
      <ShieldCheck className="w-3 h-3" /> Normal
    </span>
  );
  if (abs < 15) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
      <AlertTriangle className="w-3 h-3" /> {abs.toFixed(0)}% off
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
      <TrendingDown className="w-3 h-3" /> {abs.toFixed(0)}% variance
    </span>
  );
}

export function POSComparison({
  onVarianceChange,
  vsDrinkCount,
}: {
  onVarianceChange?: (pct: number | null) => void;
  vsDrinkCount?: number;
}) {
  const [metrics, setMetrics] = useState<POSMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drinkCount, setDrinkCount] = useState<string>(() => {
    const stored = localStorage.getItem(DRINK_COUNT_KEY);
    if (stored) return stored;
    if (vsDrinkCount != null) return String(vsDrinkCount);
    return '';
  });
  const [expanded, setExpanded] = useState(false);

  const isPOSConfigured = toastPosService.isConfigured();

  const fetchMetrics = useCallback(async () => {
    if (!isPOSConfigured) return;
    setLoading(true);
    setError(null);
    try {
      const end = new Date();
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const data = await toastPosService.getMetrics(start, end);
      setMetrics(data as POSMetrics);
    } catch (e: any) {
      setError('Could not fetch POS data. Check your integration in Settings.');
    } finally {
      setLoading(false);
    }
  }, [isPOSConfigured]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  // Auto-fill from VenueScope when no manual entry and prop arrives
  useEffect(() => {
    if (vsDrinkCount != null && drinkCount === '') {
      setDrinkCount(String(vsDrinkCount));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vsDrinkCount]);

  // Compute variance
  const posCount = metrics?.totalOrders ?? null;
  const vsCount = drinkCount !== '' ? parseInt(drinkCount) : null;
  const variancePct: number | null =
    posCount !== null && vsCount !== null && posCount > 0
      ? ((vsCount - posCount) / posCount) * 100
      : null;

  useEffect(() => {
    onVarianceChange?.(variancePct);
    if (drinkCount !== '') localStorage.setItem(DRINK_COUNT_KEY, drinkCount);
  }, [variancePct, drinkCount, onVarianceChange]);

  if (!isPOSConfigured) {
    return (
      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-5 h-5 text-text-muted" />
          <h3 className="text-base font-semibold text-white">POS Comparison</h3>
        </div>
        <p className="text-sm text-text-muted">
          Connect your POS system in{' '}
          <span className="text-teal">Settings → Integrations</span>{' '}
          to compare drink counts and detect theft automatically.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden"
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-5 hover:bg-whoop-panel-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-teal" />
          <div className="text-left">
            <h3 className="text-base font-semibold text-white">POS vs VenueScope</h3>
            <p className="text-xs text-text-muted">Theft detection comparison</p>
          </div>
          {variancePct !== null && <VarianceBadge pct={variancePct} />}
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            onClick={e => { e.stopPropagation(); fetchMetrics(); }}
            disabled={loading}
            className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-white rounded-lg transition-colors"
            whileTap={{ scale: 0.9 }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </motion.button>
          <ChevronDown className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-whoop-divider">
          {error ? (
            <p className="text-sm text-red-400 pt-4">{error}</p>
          ) : (
            <>
              {/* Three-column comparison */}
              <div className="grid grid-cols-3 gap-3 pt-4">
                {/* POS */}
                <div className="bg-whoop-panel-secondary rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-white tabular-nums">
                    {loading ? '—' : (metrics?.totalOrders ?? '—')}
                  </div>
                  <div className="text-[10px] text-text-muted uppercase tracking-wider mt-1">POS Orders</div>
                </div>

                {/* VenueScope */}
                <div className="bg-whoop-panel-secondary rounded-xl p-3 text-center">
                  <input
                    type="number"
                    value={drinkCount}
                    onChange={e => setDrinkCount(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    placeholder="—"
                    className="w-full text-2xl font-bold text-white tabular-nums text-center bg-transparent outline-none border-b border-whoop-divider focus:border-teal transition-colors placeholder:text-text-muted"
                  />
                  <div className="text-[10px] text-text-muted uppercase tracking-wider mt-1">
                    VS Drinks{vsDrinkCount != null && drinkCount === String(vsDrinkCount) ? ' (auto)' : ''}
                  </div>
                </div>

                {/* Variance */}
                <div className={`rounded-xl p-3 text-center ${
                  variancePct === null ? 'bg-whoop-panel-secondary' :
                  Math.abs(variancePct) < 5 ? 'bg-teal/10' :
                  Math.abs(variancePct) < 15 ? 'bg-amber-500/10' : 'bg-red-500/10'
                }`}>
                  <div className={`text-2xl font-bold tabular-nums ${
                    variancePct === null ? 'text-text-muted' :
                    Math.abs(variancePct) < 5 ? 'text-teal' :
                    Math.abs(variancePct) < 15 ? 'text-amber-400' : 'text-red-400'
                  }`}>
                    {variancePct !== null ? `${variancePct > 0 ? '+' : ''}${variancePct.toFixed(0)}%` : '—'}
                  </div>
                  <div className="text-[10px] text-text-muted uppercase tracking-wider mt-1">Variance</div>
                </div>
              </div>

              {/* Revenue row */}
              {metrics && (
                <div className="flex items-center gap-3 py-2 px-3 bg-whoop-panel-secondary rounded-xl">
                  <DollarSign className="w-4 h-4 text-teal flex-shrink-0" />
                  <div className="flex-1 flex items-center justify-between gap-2 text-sm">
                    <span className="text-text-muted">Today's POS revenue</span>
                    <span className="font-semibold text-white">
                      ${metrics.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              )}

              {/* High variance warning */}
              {variancePct !== null && Math.abs(variancePct) >= 15 && (
                <div className="flex items-start gap-2.5 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-300">
                    <span className="font-semibold">High variance detected.</span>{' '}
                    VenueScope counted {Math.abs(variancePct).toFixed(0)}% {vsCount! < posCount! ? 'fewer' : 'more'} drinks than your POS recorded.
                    Review your shift footage for discrepancies.
                  </p>
                </div>
              )}

              {drinkCount === '' && (
                <p className="text-xs text-text-muted text-center">
                  Enter your VenueScope drink count above to see the comparison
                </p>
              )}
            </>
          )}
        </div>
      )}
    </motion.div>
  );
}

export default POSComparison;
