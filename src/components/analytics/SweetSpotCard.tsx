/**
 * SweetSpotCard - Level 1 sweet spot summary
 * 
 * Shows: Optimal range, stay time comparison, hit percentage
 * Tap to open detailed modal
 */

import { motion } from 'framer-motion';
import { Target, ChevronRight } from 'lucide-react';
import { haptic } from '../../utils/haptics';
import { Tooltip } from '../common/Tooltip';
import type { SweetSpotData } from '../../types/insights';

// Tooltip content
const SWEETSPOT_TOOLTIPS = {
  optimalRange: 'The sound/light range where your venue has the highest average Pulse Score, based on your actual sensor data.',
  avgScore: 'Average Pulse Score when operating within this optimal range.',
  scoreDiff: 'How much higher your Pulse Score is when you hit the sweet spot vs when you don\'t.',
  hitPercentage: 'Percentage of time your venue operates within the optimal range.',
};

interface SweetSpotCardProps {
  data: SweetSpotData | null;
  loading: boolean;
  onTapDetails: () => void;
}

export function SweetSpotCard({ data, loading, onTapDetails }: SweetSpotCardProps) {
  const handleTap = () => {
    haptic('light');
    onTapDetails();
  };

  if (loading || !data) {
    return (
      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-5 animate-pulse">
        <div className="h-4 bg-warm-700 rounded w-32 mb-4" />
        <div className="h-20 bg-warm-700 rounded" />
      </div>
    );
  }

  const scoreDiff = data.optimalScore - data.outsideScore;

  return (
    <motion.button
      onClick={handleTap}
      className="w-full bg-whoop-panel border border-whoop-divider rounded-2xl p-5 text-left hover:border-warm-600 transition-colors"
      whileTap={{ scale: 0.98 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop">
          Your Sweet Spot
        </h3>
        <ChevronRight className="w-4 h-4 text-warm-500" />
      </div>

      {/* Optimal Range Callout */}
      <div className="bg-teal/10 border border-teal/30 rounded-xl p-4 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-teal/20 flex items-center justify-center">
            <Target className="w-5 h-5 text-teal" />
          </div>
          <div>
            <div className="text-lg font-bold text-teal flex items-center gap-1">
              {data.optimalRange}
              <Tooltip content={SWEETSPOT_TOOLTIPS.optimalRange} position="right">
                <span></span>
              </Tooltip>
            </div>
            <div className="text-sm text-warm-300 flex items-center gap-1">
              Avg Score: <span className="text-white font-semibold">{data.optimalScore}</span>
              <Tooltip content={SWEETSPOT_TOOLTIPS.avgScore} position="right">
                <span></span>
              </Tooltip>
            </div>
            <div className="text-xs text-warm-400 flex items-center gap-1">
              (+{scoreDiff} vs outside range)
              <Tooltip content={SWEETSPOT_TOOLTIPS.scoreDiff} position="right">
                <span></span>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>

      {/* Hit Percentage */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-warm-300 flex items-center gap-1">
          You hit this <span className="text-white font-semibold">{data.hitPercentage}%</span> of the time
          <Tooltip content={SWEETSPOT_TOOLTIPS.hitPercentage} position="top">
            <span></span>
          </Tooltip>
        </span>
        
        {/* Tap hint */}
        <div className="flex items-center gap-1 text-xs text-primary">
          <span>See Data</span>
          <ChevronRight className="w-3 h-3" />
        </div>
      </div>
    </motion.button>
  );
}

export default SweetSpotCard;
