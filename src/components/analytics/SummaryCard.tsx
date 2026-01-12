/**
 * SummaryCard - Level 1 summary for Analytics page
 * 
 * Shows: Score, Avg Stay, Guests with deltas
 * Tap to open breakdown modal
 */

import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { haptic } from '../../utils/haptics';
import type { InsightsSummary, InsightsTimeRange } from '../../types/insights';

interface SummaryCardProps {
  data: InsightsSummary | null;
  timeRange: InsightsTimeRange;
  loading: boolean;
  onTapDetails: () => void;
}

function getTimeRangeTitle(range: InsightsTimeRange): string {
  switch (range) {
    case 'last_night': return 'Last Night';
    case '7d': return 'This Week';
    case '14d': return 'Last 14 Days';
    case '30d': return 'This Month';
    default: return 'Summary';
  }
}

function MetricBox({ 
  value, 
  label, 
  delta 
}: { 
  value: string; 
  label: string; 
  delta?: number;
}) {
  const deltaColor = delta === undefined || delta === 0 
    ? 'text-warm-400' 
    : delta > 0 
      ? 'text-recovery-high' 
      : 'text-recovery-low';
  
  const deltaText = delta === undefined || delta === 0 
    ? '' 
    : delta > 0 
      ? `↑${delta}%` 
      : `↓${Math.abs(delta)}%`;

  return (
    <div className="flex-1 text-center">
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-warm-400 mt-0.5">{label}</div>
      {deltaText && (
        <div className={`text-xs font-medium mt-0.5 ${deltaColor}`}>
          {deltaText}
        </div>
      )}
    </div>
  );
}

export function SummaryCard({ data, timeRange, loading, onTapDetails }: SummaryCardProps) {
  const handleTap = () => {
    haptic('light');
    onTapDetails();
  };

  if (loading || !data) {
    return (
      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-5 animate-pulse">
        <div className="h-4 bg-warm-700 rounded w-24 mb-4" />
        <div className="flex gap-4">
          <div className="flex-1 h-16 bg-warm-700 rounded" />
          <div className="flex-1 h-16 bg-warm-700 rounded" />
          <div className="flex-1 h-16 bg-warm-700 rounded" />
        </div>
      </div>
    );
  }

  return (
    <motion.button
      onClick={handleTap}
      className="w-full bg-whoop-panel border border-whoop-divider rounded-2xl p-5 text-left hover:border-warm-600 transition-colors"
      whileTap={{ scale: 0.98 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop">
          {getTimeRangeTitle(timeRange)}
        </h3>
        <ChevronRight className="w-4 h-4 text-warm-500" />
      </div>

      {/* Metrics Row */}
      <div className="flex gap-2 mb-4">
        <MetricBox
          value={data.score.toString()}
          label="Score"
          delta={data.scoreDelta}
        />
        <div className="w-px bg-whoop-divider" />
        <MetricBox
          value={`${data.avgStayMinutes}m`}
          label="Avg Stay"
          delta={data.avgStayDelta}
        />
        <div className="w-px bg-whoop-divider" />
        <MetricBox
          value={data.totalGuests.toString()}
          label="Guests"
          delta={data.guestsDelta}
        />
      </div>

      {/* Summary Text */}
      <p className="text-sm text-warm-300 leading-relaxed">
        "{data.summaryText}"
      </p>

      {/* Tap hint */}
      <div className="mt-3 flex items-center justify-end gap-1 text-xs text-primary">
        <span>See Why</span>
        <ChevronRight className="w-3 h-3" />
      </div>
    </motion.button>
  );
}

export default SummaryCard;
