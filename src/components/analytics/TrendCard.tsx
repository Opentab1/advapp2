/**
 * TrendCard - Level 1 trend summary
 * 
 * Shows: Avg stay, guests with deltas, best/worst days
 * Tap to open detailed modal
 */

import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, ChevronRight, Star, AlertCircle } from 'lucide-react';
import { haptic } from '../../utils/haptics';
import type { TrendData, InsightsTimeRange } from '../../types/insights';

interface TrendCardProps {
  data: TrendData | null;
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
    default: return 'Trend';
  }
}

export function TrendCard({ data, timeRange, loading, onTapDetails }: TrendCardProps) {
  const handleTap = () => {
    haptic('light');
    onTapDetails();
  };

  if (loading || !data) {
    return (
      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-5 animate-pulse">
        <div className="h-4 bg-warm-700 rounded w-24 mb-4" />
        <div className="h-16 bg-warm-700 rounded" />
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

      {/* Metrics */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-warm-400">Avg Stay</span>
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold">{data.avgStay} min</span>
            {data.avgStayDelta !== 0 && (
              <span className={`text-xs font-medium flex items-center gap-0.5 ${
                data.avgStayDelta > 0 ? 'text-recovery-high' : 'text-recovery-low'
              }`}>
                {data.avgStayDelta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {Math.abs(data.avgStayDelta)}%
              </span>
            )}
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-sm text-warm-400">Guests</span>
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold">{data.totalGuests.toLocaleString()}</span>
            {data.guestsDelta !== 0 && (
              <span className={`text-xs font-medium flex items-center gap-0.5 ${
                data.guestsDelta > 0 ? 'text-recovery-high' : 'text-recovery-low'
              }`}>
                {data.guestsDelta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {Math.abs(data.guestsDelta)}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Best/Worst */}
      <div className="space-y-2 pt-3 border-t border-whoop-divider">
        <div className="flex items-center gap-2 text-sm">
          <Star className="w-3.5 h-3.5 text-recovery-medium" />
          <span className="text-warm-400">Best:</span>
          <span className="text-white">{data.bestDay.date}</span>
          <span className="text-warm-500">(Score: {data.bestDay.score})</span>
        </div>
        
        <div className="flex items-center gap-2 text-sm">
          <AlertCircle className="w-3.5 h-3.5 text-warm-500" />
          <span className="text-warm-400">Needs Work:</span>
          <span className="text-white">{data.worstDay.date}</span>
          <span className="text-warm-500">(Score: {data.worstDay.score})</span>
        </div>
      </div>

      {/* Tap hint */}
      <div className="mt-3 flex items-center justify-end gap-1 text-xs text-primary">
        <span>See Trend</span>
        <ChevronRight className="w-3 h-3" />
      </div>
    </motion.button>
  );
}

export default TrendCard;
