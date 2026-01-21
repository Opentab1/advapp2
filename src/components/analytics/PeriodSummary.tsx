/**
 * PeriodSummary - The headline numbers bar owners care about
 * 
 * Shows: Total Guests, Avg Stay, Peak Hours
 * With comparison deltas
 */

import { motion } from 'framer-motion';
import { Users, Clock, Zap, TrendingUp, TrendingDown } from 'lucide-react';
import type { InsightsSummary, TrendData, InsightsTimeRange } from '../../types/insights';

interface PeriodSummaryProps {
  summary: InsightsSummary | null;
  trend: TrendData | null;
  timeRange: InsightsTimeRange;
  loading: boolean;
}

function getTimeRangeLabel(range: InsightsTimeRange): string {
  switch (range) {
    case 'last_night': return 'Last Night';
    case '7d': return 'This Week';
    case '14d': return 'Last 2 Weeks';
    case '30d': return 'This Month';
    default: return 'Summary';
  }
}

function StatCard({ 
  icon: Icon, 
  label, 
  value, 
  delta, 
  deltaLabel,
  highlight = false,
}: { 
  icon: typeof Users;
  label: string;
  value: string;
  delta?: number | null;
  deltaLabel?: string;
  highlight?: boolean;
}) {
  const showDelta = delta !== undefined && delta !== null && delta !== 0;
  
  return (
    <div className={`p-4 rounded-xl ${highlight ? 'bg-primary/10 border border-primary/30' : 'bg-warm-800/50 border border-warm-700'}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${highlight ? 'text-primary' : 'text-warm-400'}`} />
        <span className="text-xs text-warm-400 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {showDelta && (
        <div className={`flex items-center gap-1 mt-1 text-sm ${delta > 0 ? 'text-recovery-high' : 'text-recovery-low'}`}>
          {delta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          <span>{delta > 0 ? '+' : ''}{delta}%</span>
          {deltaLabel && <span className="text-warm-500 text-xs ml-1">{deltaLabel}</span>}
        </div>
      )}
    </div>
  );
}

export function PeriodSummary({ summary, trend, timeRange, loading }: PeriodSummaryProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 bg-warm-700 rounded w-32 animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-warm-800 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="bg-warm-800 rounded-xl p-6 text-center">
        <p className="text-warm-400">No data available for this period</p>
      </div>
    );
  }

  const comparisonLabel = timeRange === 'last_night' ? 'vs prev night' : 'vs prev period';

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Period Label */}
      <h2 className="text-lg font-bold text-white">{getTimeRangeLabel(timeRange)}</h2>
      
      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={Users}
          label="Total Guests"
          value={summary.guestsIsEstimate ? `~${summary.totalGuests.toLocaleString()}` : summary.totalGuests.toLocaleString()}
          delta={summary.guestsDelta}
          deltaLabel={comparisonLabel}
          highlight={true}
        />
        
        <StatCard
          icon={Clock}
          label="Avg Stay"
          value={summary.avgStayMinutes !== null ? `~${summary.avgStayMinutes} min` : '—'}
          delta={summary.avgStayDelta}
          deltaLabel={comparisonLabel}
        />
        
        <StatCard
          icon={Zap}
          label="Peak Hours"
          value={summary.peakHours !== 'N/A' ? summary.peakHours : '—'}
        />
        
        <StatCard
          icon={Users}
          label="Best Day"
          value={trend?.bestDay?.date || '—'}
          delta={trend?.bestDay?.score ? undefined : undefined}
        />
      </div>
    </motion.div>
  );
}

export default PeriodSummary;
