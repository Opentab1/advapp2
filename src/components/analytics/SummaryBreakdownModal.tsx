/**
 * SummaryBreakdownModal - Level 2 detail for summary
 * 
 * Shows: Hour-by-hour breakdown, factor scores, comparison
 */

import { motion } from 'framer-motion';
import { X, TrendingUp, TrendingDown } from 'lucide-react';
import { haptic } from '../../utils/haptics';
import type { InsightsSummary, HourlyData, FactorScore, PeriodComparison } from '../../types/insights';

interface SummaryBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  summary: InsightsSummary | null;
  hourlyData: HourlyData[];
  factorScores: FactorScore[];
  comparison: PeriodComparison | null;
  onViewRawData: () => void;
}

export function SummaryBreakdownModal({
  isOpen,
  onClose,
  summary: _summary,
  hourlyData,
  factorScores,
  comparison,
  onViewRawData,
}: SummaryBreakdownModalProps) {
  void _summary; // Used for future enhancements
  if (!isOpen) return null;

  const handleClose = () => {
    haptic('light');
    onClose();
  };

  const handleViewRaw = () => {
    haptic('medium');
    onViewRawData();
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <motion.div
        className="relative w-full max-w-lg max-h-[90vh] bg-whoop-panel border border-whoop-divider rounded-t-3xl lg:rounded-2xl overflow-hidden"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-whoop-panel border-b border-whoop-divider px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Last Night Breakdown</h2>
          <button onClick={handleClose} className="p-2 -mr-2 text-warm-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-60px)] p-5 space-y-6">
          {/* Score by Hour */}
          <section>
            <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop mb-3">
              Score by Hour
            </h3>
            <div className="space-y-2">
              {hourlyData.length > 0 ? hourlyData.map((hour) => (
                <div 
                  key={hour.hour}
                  className={`flex items-center gap-3 p-2 rounded-lg ${
                    hour.isHighlight ? 'bg-teal/10 border border-teal/20' : 'bg-warm-800/50'
                  }`}
                >
                  <span className="w-12 text-sm text-warm-400">{hour.hour}</span>
                  <div className="flex-1 h-2 bg-warm-700 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${
                        hour.score >= 80 ? 'bg-recovery-high' :
                        hour.score >= 60 ? 'bg-recovery-medium' :
                        'bg-recovery-low'
                      }`}
                      style={{ width: `${hour.score}%` }}
                    />
                  </div>
                  <span className={`w-8 text-sm font-medium ${
                    hour.isHighlight ? 'text-teal' : 'text-white'
                  }`}>
                    {hour.score}
                  </span>
                  <span className="text-xs text-warm-500 w-20 text-right">
                    {hour.label}
                    {hour.isHighlight && ' ★'}
                  </span>
                </div>
              )) : (
                <div className="text-sm text-warm-500 italic">No hourly data available</div>
              )}
            </div>
          </section>

          {/* Factor Breakdown */}
          <section>
            <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop mb-3">
              Factor Breakdown
            </h3>
            <div className="space-y-3">
              {factorScores.map((factor) => (
                <div key={factor.factor} className="flex items-center gap-3">
                  <span className="w-16 text-sm text-warm-400 capitalize">{factor.factor}</span>
                  <div className="flex-1 h-2 bg-warm-700 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${
                        factor.score >= 80 ? 'bg-recovery-high' :
                        factor.score >= 60 ? 'bg-recovery-medium' :
                        'bg-recovery-low'
                      }`}
                      style={{ width: `${factor.score}%` }}
                    />
                  </div>
                  <span className="w-8 text-sm font-medium text-white">{factor.score}</span>
                  <span className="text-xs text-warm-500 w-24 text-right">{factor.label}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Comparison */}
          {comparison && (
            <section>
              <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop mb-3">
                {comparison.periodLabel}
              </h3>
              <div className="bg-warm-800/50 rounded-xl p-4 space-y-3">
                <ComparisonRow
                  label="Score"
                  current={comparison.current.score}
                  previous={comparison.previous.score}
                />
                <ComparisonRow
                  label="Avg Stay"
                  current={comparison.current.avgStay}
                  previous={comparison.previous.avgStay}
                  suffix="m"
                />
                <ComparisonRow
                  label="Guests"
                  current={comparison.current.guests}
                  previous={comparison.previous.guests}
                />
              </div>
            </section>
          )}

          {/* View Raw Data Button */}
          <button
            onClick={handleViewRaw}
            className="w-full py-3 bg-whoop-panel-secondary border border-whoop-divider rounded-xl text-center text-primary font-medium hover:bg-warm-800 transition-colors"
          >
            View Raw Data →
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ComparisonRow({ 
  label, 
  current, 
  previous, 
  suffix = '' 
}: { 
  label: string; 
  current: number | null; 
  previous: number | null; 
  suffix?: string;
}) {
  // Handle null values
  if (current === null || previous === null) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-sm text-warm-400">{label}</span>
        <span className="text-sm text-warm-500 italic">Not enough data</span>
      </div>
    );
  }

  const delta = previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0;
  const isPositive = delta > 0;

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-warm-400">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm text-warm-500">{previous}{suffix}</span>
        <span className="text-warm-600">→</span>
        <span className="text-sm font-medium text-white">{current}{suffix}</span>
        {delta !== 0 && (
          <span className={`text-xs font-medium flex items-center gap-0.5 ${
            isPositive ? 'text-recovery-high' : 'text-recovery-low'
          }`}>
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
    </div>
  );
}

export default SummaryBreakdownModal;
