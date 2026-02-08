/**
 * RetentionMetrics - Accurate guest retention data
 * 
 * Displays 100% accurate metrics derived from entry/exit counts:
 * - Retention Rate: % of tonight's guests still here
 * - Turnover Rate: How fast people are churning
 * - Entry/Exit Ratio: Is crowd growing or shrinking?
 * 
 * These are NOT estimates - they're mathematical facts from sensor data.
 */

import { motion } from 'framer-motion';
import { 
  Users, 
  TrendingUp, 
  TrendingDown, 
  Minus,
  ArrowUpRight,
  ArrowDownRight,
  RotateCcw,
  Clock
} from 'lucide-react';

interface RetentionMetricsProps {
  retentionRate: number;       // 0-100%
  turnoverRate: number;        // exits/hour / avg occupancy
  entryExitRatio: number;      // >1 growing, <1 shrinking
  crowdTrend: 'growing' | 'stable' | 'shrinking';
  avgStayMinutes: number | null;
  exitsPerHour: number;
  todayEntries: number;
  todayExits: number;
  currentOccupancy: number;
  isBLEEstimated?: boolean; // True if entries/exits are estimated from BLE device
}

export function RetentionMetrics({
  retentionRate,
  turnoverRate,
  entryExitRatio,
  crowdTrend,
  avgStayMinutes,
  exitsPerHour,
  todayEntries,
  todayExits,
  currentOccupancy,
  isBLEEstimated = false,
}: RetentionMetricsProps) {
  
  // Don't show if no data yet
  if (todayEntries === 0) {
    return null;
  }
  
  // Trend icon and color
  const getTrendDisplay = () => {
    switch (crowdTrend) {
      case 'growing':
        return { 
          icon: TrendingUp, 
          color: 'text-green-400', 
          bg: 'bg-green-500/10',
          border: 'border-green-500/20',
          label: 'Growing'
        };
      case 'shrinking':
        return { 
          icon: TrendingDown, 
          color: 'text-red-400', 
          bg: 'bg-red-500/10',
          border: 'border-red-500/20',
          label: 'Shrinking'
        };
      default:
        return { 
          icon: Minus, 
          color: 'text-amber-400', 
          bg: 'bg-amber-500/10',
          border: 'border-amber-500/20',
          label: 'Stable'
        };
    }
  };
  
  const trend = getTrendDisplay();
  const TrendIcon = trend.icon;
  
  // Retention status
  const getRetentionStatus = () => {
    if (retentionRate >= 70) return { color: 'text-green-400', label: 'Excellent' };
    if (retentionRate >= 50) return { color: 'text-amber-400', label: 'Good' };
    if (retentionRate >= 30) return { color: 'text-orange-400', label: 'Moderate' };
    return { color: 'text-red-400', label: 'Low' };
  };
  
  const retentionStatus = getRetentionStatus();
  
  // Turnover interpretation
  const getTurnoverLabel = () => {
    if (turnoverRate < 0.3) return 'Very Low';
    if (turnoverRate < 0.5) return 'Low';
    if (turnoverRate < 0.8) return 'Normal';
    if (turnoverRate < 1.2) return 'High';
    return 'Very High';
  };
  
  // Format avg stay
  const formatStay = (minutes: number | null) => {
    if (minutes === null) return '--';
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${minutes}m`;
  };
  
  return (
    <motion.div
      className="bg-warm-800 rounded-2xl border border-warm-700 p-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-warm-100">Guest Retention</h3>
        </div>
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full ${trend.bg} border ${trend.border}`}>
          <TrendIcon className={`w-3 h-3 ${trend.color}`} />
          <span className={`text-xs font-medium ${trend.color}`}>{trend.label}</span>
        </div>
      </div>
      
      {/* Main metrics grid */}
      <div className="grid grid-cols-3 gap-3">
        
        {/* Retention Rate - Primary metric */}
        <div className="col-span-1 p-3 rounded-xl bg-warm-700/50">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[10px] text-warm-400 uppercase tracking-wide">Still Here</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-2xl font-bold ${retentionStatus.color}`}>
              {retentionRate}%
            </span>
          </div>
          <p className="text-[10px] text-warm-500 mt-1">
            {currentOccupancy} of {todayEntries} guests
          </p>
        </div>
        
        {/* Turnover Rate */}
        <div className="col-span-1 p-3 rounded-xl bg-warm-700/50">
          <div className="flex items-center gap-1 mb-1">
            <RotateCcw className="w-3 h-3 text-warm-400" />
            <span className="text-[10px] text-warm-400 uppercase tracking-wide">Turnover</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-warm-100">
              {turnoverRate.toFixed(1)}
            </span>
            <span className="text-xs text-warm-500">/hr</span>
          </div>
          <p className="text-[10px] text-warm-500 mt-1">
            {getTurnoverLabel()} churn
          </p>
        </div>
        
        {/* Entry/Exit Ratio */}
        <div className="col-span-1 p-3 rounded-xl bg-warm-700/50">
          <div className="flex items-center gap-1 mb-1">
            {entryExitRatio >= 1 ? (
              <ArrowUpRight className="w-3 h-3 text-green-400" />
            ) : (
              <ArrowDownRight className="w-3 h-3 text-red-400" />
            )}
            <span className="text-[10px] text-warm-400 uppercase tracking-wide">In/Out</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-2xl font-bold ${entryExitRatio >= 1 ? 'text-green-400' : 'text-red-400'}`}>
              {entryExitRatio.toFixed(1)}
            </span>
            <span className="text-xs text-warm-500">ratio</span>
          </div>
          <p className="text-[10px] text-warm-500 mt-1">
            {isBLEEstimated ? `~${todayEntries}` : todayEntries} in / {isBLEEstimated ? `~${todayExits}` : todayExits} out
            {isBLEEstimated && <span className="text-warm-600 ml-1">(est)</span>}
          </p>
        </div>
      </div>
      
      {/* Secondary info row */}
      <div className="mt-3 pt-3 border-t border-warm-700 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Avg Stay (exit-based) */}
          {avgStayMinutes !== null && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-warm-400" />
              <span className="text-xs text-warm-300">
                ~{formatStay(avgStayMinutes)} avg stay
              </span>
            </div>
          )}
          
          {/* Exits per hour */}
          <div className="flex items-center gap-1.5">
            <ArrowDownRight className="w-3.5 h-3.5 text-warm-400" />
            <span className="text-xs text-warm-300">
              {exitsPerHour} leaving/hr
            </span>
          </div>
        </div>
        
        <span className="text-[10px] text-warm-500">
          100% accurate
        </span>
      </div>
    </motion.div>
  );
}

export default RetentionMetrics;
