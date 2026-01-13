/**
 * HistoryHeader - Smart header for History page
 * 
 * Shows:
 * - Page title
 * - Date range context
 * - Data freshness indicator
 */

import { motion } from 'framer-motion';
import { BarChart2, Calendar, Clock } from 'lucide-react';
import type { TimeRange } from '../../types';

interface HistoryHeaderProps {
  timeRange: TimeRange;
  dataPoints?: number;
  lastUpdated?: Date | null;
}

export function HistoryHeader({ timeRange, dataPoints, lastUpdated }: HistoryHeaderProps) {
  const rangeLabel = getRangeLabel(timeRange);
  const dateRange = getDateRangeText(timeRange);
  
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center justify-between p-3 rounded-xl bg-warm-800/50 border border-warm-700/50">
        {/* Left: Icon + Title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <BarChart2 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-base font-semibold text-warm-100">History</p>
            <p className="text-xs text-warm-400">{rangeLabel}</p>
          </div>
        </div>
        
        {/* Right: Date range + Stats */}
        <div className="flex items-center gap-3">
          {/* Date range */}
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-warm-700/50">
            <Calendar className="w-3.5 h-3.5 text-warm-400" />
            <span className="text-xs text-warm-300">{dateRange}</span>
          </div>
          
          {/* Data points */}
          {dataPoints !== undefined && dataPoints > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-warm-700/50">
              <span className="text-xs text-warm-300">
                {dataPoints.toLocaleString()} pts
              </span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ============ HELPERS ============

function getRangeLabel(range: TimeRange): string {
  switch (range) {
    case '24h': return 'Last 24 Hours';
    case '7d': return 'Last 7 Days';
    case '14d': return 'Last 14 Days';
    case '30d': return 'Last 30 Days';
    case '90d': return 'Last 90 Days';
    default: return 'Historical Data';
  }
}

function getDateRangeText(range: TimeRange): string {
  const now = new Date();
  const end = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  
  let start: Date;
  switch (range) {
    case '24h':
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case '7d':
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '14d':
      start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    default:
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${startStr} - ${end}`;
}

export default HistoryHeader;
