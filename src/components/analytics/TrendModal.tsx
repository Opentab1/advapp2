/**
 * TrendModal - Level 2 detail for trend analysis
 * 
 * Shows: Full trend chart, week-over-week comparison, highlights
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Star, AlertCircle } from 'lucide-react';
import { haptic } from '../../utils/haptics';
import { AreaChart } from '../common/MiniChart';
import type { TrendData, InsightsTimeRange } from '../../types/insights';

interface TrendModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: TrendData | null;
  timeRange: InsightsTimeRange;
  chartData: Array<{ date: Date; score: number; avgStay: number; guests: number }>;
  onViewRawData: () => void;
}

type ChartMetric = 'score' | 'avgStay' | 'guests';

export function TrendModal({
  isOpen,
  onClose,
  data,
  timeRange: _timeRange,
  chartData,
  onViewRawData,
}: TrendModalProps) {
  void _timeRange; // Reserved for future filtering
  const [activeMetric, setActiveMetric] = useState<ChartMetric>('score');
  
  if (!isOpen || !data) return null;

  const handleClose = () => {
    haptic('light');
    onClose();
  };

  const handleViewRaw = () => {
    haptic('medium');
    onViewRawData();
  };

  const handleMetricChange = (metric: ChartMetric) => {
    haptic('selection');
    setActiveMetric(metric);
  };

  // Prepare chart data based on active metric
  const chartValues = chartData.map(d => ({
    label: d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: activeMetric === 'score' ? d.score : activeMetric === 'avgStay' ? d.avgStay : d.guests,
  }));

  const getMetricColor = (metric: ChartMetric): string => {
    switch (metric) {
      case 'score': return '#00F19F';
      case 'avgStay': return '#0093E7';
      case 'guests': return '#FFDE00';
      default: return '#00F19F';
    }
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
          <h2 className="text-lg font-semibold text-white">Trend Analysis</h2>
          <button onClick={handleClose} className="p-2 -mr-2 text-warm-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-60px)] p-5 space-y-6">
          {/* Metric Selector - Avg Stay removed as we can't calculate it accurately per-day */}
          <div className="flex gap-2">
            {[
              { value: 'score' as ChartMetric, label: 'Score' },
              { value: 'guests' as ChartMetric, label: 'Guests' },
            ].map((metric) => (
              <button
                key={metric.value}
                onClick={() => handleMetricChange(metric.value)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeMetric === metric.value 
                    ? 'bg-teal/20 border border-teal/30 text-teal' 
                    : 'bg-warm-800 border border-transparent text-warm-400 hover:text-white'
                }`}
              >
                {metric.label}
              </button>
            ))}
          </div>

          {/* Chart */}
          <div className="bg-warm-800/50 rounded-xl p-4">
            <div className="h-48">
              {chartValues.length > 0 ? (
                <AreaChart 
                  data={chartValues} 
                  height={192}
                  color={getMetricColor(activeMetric)}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-warm-500 text-sm">
                  No data available for this period
                </div>
              )}
            </div>
          </div>

          {/* Week over Week */}
          {data.weekOverWeek.length >= 2 && (
            <section>
              <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop mb-3">
                Period Comparison
              </h3>
              <div className="bg-warm-800/50 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-whoop-divider">
                      <th className="text-left text-xs text-warm-500 font-medium p-3" />
                      {data.weekOverWeek.map((period, idx) => (
                        <th key={idx} className="text-right text-xs text-warm-400 font-medium p-3">
                          {period.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-whoop-divider">
                      <td className="text-sm text-warm-400 p-3">Score</td>
                      {data.weekOverWeek.map((period, idx) => (
                        <td key={idx} className="text-right text-sm font-medium text-white p-3">
                          {period.avgScore}
                        </td>
                      ))}
                    </tr>
                    {/* Avg Stay row removed - can't calculate accurate per-period avg stay */}
                    <tr>
                      <td className="text-sm text-warm-400 p-3">Guests</td>
                      {data.weekOverWeek.map((period, idx) => (
                        <td key={idx} className="text-right text-sm font-medium text-white p-3">
                          {period.guests.toLocaleString()}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Highlights */}
          <section>
            <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop mb-3">
              Highlights
            </h3>
            <div className="space-y-3">
              {/* Best Day */}
              <div className="bg-recovery-high/10 border border-recovery-high/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Star className="w-4 h-4 text-recovery-high" />
                  <span className="text-sm font-semibold text-recovery-high">Best</span>
                  <span className="text-sm text-white">{data.bestDay.date}</span>
                  <span className="text-sm text-warm-500">— Score {data.bestDay.score}</span>
                </div>
                {data.bestDay.label && (
                  <p className="text-xs text-warm-400 ml-6">{data.bestDay.label}</p>
                )}
              </div>

              {/* Worst Day */}
              <div className="bg-warm-800/50 border border-whoop-divider rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="w-4 h-4 text-warm-500" />
                  <span className="text-sm font-semibold text-warm-400">Needs Work</span>
                  <span className="text-sm text-white">{data.worstDay.date}</span>
                  <span className="text-sm text-warm-500">— Score {data.worstDay.score}</span>
                </div>
                {data.worstDay.label && (
                  <p className="text-xs text-warm-400 ml-6">{data.worstDay.label}</p>
                )}
              </div>
            </div>
          </section>

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

export default TrendModal;
