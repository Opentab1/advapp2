/**
 * PeriodComparison - Unified comparison component for all time ranges
 * 
 * Adapts display based on time range:
 * - 24h: Hourly bars, today vs yesterday
 * - 7d: Daily bars, this week vs last week
 * - 30d: Weekly bars, this month vs last month
 * - 90d: Monthly bars, this quarter vs last quarter
 */

import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, Users, Clock, Zap } from 'lucide-react';
import type { PeriodData, PeriodConfig } from '../../hooks/usePeriodComparison';

interface PeriodComparisonProps {
  currentPeriod: PeriodData | null;
  previousPeriod: PeriodData | null;
  config: PeriodConfig;
  loading?: boolean;
}

export function PeriodComparison({ currentPeriod, previousPeriod, config, loading }: PeriodComparisonProps) {
  if (loading) {
    return <ComparisonSkeleton />;
  }
  
  if (!currentPeriod) {
    return (
      <div className="bg-warm-800 rounded-2xl border border-warm-700 p-6 text-center transition-colors">
        <p className="text-warm-400">Not enough data for comparison</p>
      </div>
    );
  }
  
  // Calculate deltas
  const pulseScoreDelta = previousPeriod 
    ? currentPeriod.avgPulseScore - previousPeriod.avgPulseScore 
    : null;
  const visitorsDelta = previousPeriod && previousPeriod.totalVisitors > 0
    ? Math.round(((currentPeriod.totalVisitors - previousPeriod.totalVisitors) / previousPeriod.totalVisitors) * 100)
    : null;
  const dwellDelta = previousPeriod
    ? currentPeriod.avgDwellMinutes - previousPeriod.avgDwellMinutes
    : null;
  
  // Determine comparison title based on period type
  const getTitle = () => {
    switch (config.periodType) {
      case 'hour': return 'Daily Comparison';
      case 'day': return 'Weekly Comparison';
      case 'week': return 'Monthly Comparison';
      case 'month': return 'Quarterly Comparison';
      default: return 'Period Comparison';
    }
  };
  
  return (
    <motion.div
      className="bg-warm-800 rounded-2xl border border-warm-700 overflow-hidden transition-colors"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-warm-700/50 border-b border-warm-700">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-warm-100">{getTitle()}</h3>
          <div className="flex items-center gap-2 text-xs text-warm-400">
            <span className="px-2 py-0.5 bg-primary/20 text-primary rounded font-medium">
              {config.currentLabel}
            </span>
            <span>vs</span>
            <span className="px-2 py-0.5 bg-warm-600 rounded">
              {config.previousLabel}
            </span>
          </div>
        </div>
      </div>
      
      {/* Main Stats */}
      <div className="p-4 grid grid-cols-3 gap-4">
        <ComparisonStat
          icon={Zap}
          iconColor="text-primary"
          label="Avg Pulse"
          value={currentPeriod.avgPulseScore}
          delta={pulseScoreDelta}
          format="score"
        />
        
        <ComparisonStat
          icon={Users}
          iconColor="text-green-500"
          label="Visitors"
          value={currentPeriod.totalVisitors}
          delta={visitorsDelta}
          format="percent"
        />
        
        <ComparisonStat
          icon={Clock}
          iconColor="text-amber-500"
          label="Avg Stay"
          value={currentPeriod.avgDwellMinutes}
          delta={dwellDelta}
          format="minutes"
        />
      </div>
      
      {/* Best/Worst Periods */}
      <div className="px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          {/* Best Period */}
          <div className="p-3 rounded-xl bg-green-900/20 border border-green-900/30 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-green-400" />
              <span className="text-xs font-medium text-green-400">
                Best {config.periodType === 'hour' ? 'Hour' : config.periodType === 'day' ? 'Day' : config.periodType === 'week' ? 'Week' : 'Month'}
              </span>
            </div>
            {currentPeriod.bestPeriod ? (
              <>
                <p className="text-lg font-bold text-green-300">
                  {currentPeriod.bestPeriod.label}
                </p>
                <p className="text-xs text-green-500">
                  {currentPeriod.bestPeriod.score} avg score
                </p>
              </>
            ) : (
              <p className="text-sm text-green-500">--</p>
            )}
          </div>
          
          {/* Worst Period */}
          <div className="p-3 rounded-xl bg-red-900/20 border border-red-900/30 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="w-4 h-4 text-red-400" />
              <span className="text-xs font-medium text-red-400">Needs Work</span>
            </div>
            {currentPeriod.worstPeriod ? (
              <>
                <p className="text-lg font-bold text-red-300">
                  {currentPeriod.worstPeriod.label}
                </p>
                <p className="text-xs text-red-500">
                  {currentPeriod.worstPeriod.score} avg score
                </p>
              </>
            ) : (
              <p className="text-sm text-red-500">--</p>
            )}
          </div>
        </div>
      </div>
      
      {/* Period Bars Chart */}
      {currentPeriod.periodScores.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-xs text-warm-400 mb-2">
            {config.periodType === 'hour' ? 'Hourly' : 
             config.periodType === 'day' ? 'Daily' : 
             config.periodType === 'week' ? 'Weekly' : 'Monthly'} Pulse Scores
          </p>
          <div className={`flex items-end gap-1 h-16 ${
            currentPeriod.periodScores.length > 12 ? 'overflow-x-auto' : ''
          }`}>
            {currentPeriod.periodScores.map((period, i) => {
              const prevScore = previousPeriod?.periodScores[i]?.score;
              const height = `${Math.max(10, period.score)}%`;
              
              return (
                <div 
                  key={i} 
                  className={`flex flex-col items-center gap-1 ${
                    currentPeriod.periodScores.length > 12 ? 'min-w-[20px]' : 'flex-1'
                  }`}
                >
                  <div className="w-full flex items-end gap-0.5 h-12">
                    {/* Previous period bar (faded) */}
                    {prevScore !== undefined && prevScore > 0 && (
                      <div
                        className="flex-1 bg-warm-600 rounded-t transition-colors"
                        style={{ height: `${Math.max(10, prevScore)}%` }}
                      />
                    )}
                    {/* Current period bar */}
                    <motion.div
                      className={`flex-1 rounded-t ${
                        period.isCurrent ? 'bg-primary' : 'bg-primary/70'
                      }`}
                      initial={{ height: 0 }}
                      animate={{ height }}
                      transition={{ delay: i * 0.02 }}
                    />
                  </div>
                  <span className={`text-[10px] ${
                    period.isCurrent ? 'font-bold text-primary' : 'text-warm-500'
                  }`}>
                    {currentPeriod.periodScores.length <= 12 ? period.label : 
                     (i % 3 === 0 ? period.label : '')}
                  </span>
                </div>
              );
            })}
          </div>
          
          {/* Legend */}
          <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-warm-500">
            <div className="flex items-center gap-1">
              <span className="w-3 h-2 bg-primary rounded" />
              <span>{config.currentLabel}</span>
            </div>
            {previousPeriod && (
              <div className="flex items-center gap-1">
                <span className="w-3 h-2 bg-warm-600 rounded" />
                <span>{config.previousLabel}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ============ COMPARISON STAT ============

interface ComparisonStatProps {
  icon: typeof Zap;
  iconColor: string;
  label: string;
  value: number;
  delta: number | null;
  format: 'score' | 'percent' | 'minutes';
}

function ComparisonStat({ icon: Icon, iconColor, label, value, delta, format }: ComparisonStatProps) {
  const formatValue = () => {
    if (format === 'minutes') return `${Math.round(value)}m`;
    if (format === 'score') return Math.round(value);
    return value.toLocaleString();
  };
  
  const formatDelta = () => {
    if (delta === null) return null;
    const prefix = delta > 0 ? '+' : '';
    if (format === 'minutes') return `${prefix}${Math.round(delta)}m`;
    if (format === 'percent') return `${prefix}${delta}%`;
    return `${prefix}${Math.round(delta)}`;
  };
  
  const getDeltaColor = () => {
    if (delta === null || delta === 0) return 'text-warm-500';
    return delta > 0 ? 'text-green-400' : 'text-red-400';
  };
  
  const getDeltaIcon = () => {
    if (delta === null || delta === 0) return Minus;
    return delta > 0 ? TrendingUp : TrendingDown;
  };
  
  const DeltaIcon = getDeltaIcon();
  
  return (
    <div className="text-center">
      <div className="flex justify-center mb-1">
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <p className="text-2xl font-bold text-warm-100">{formatValue()}</p>
      <p className="text-xs text-warm-400 mb-1">{label}</p>
      {delta !== null && (
        <div className={`flex items-center justify-center gap-0.5 text-xs ${getDeltaColor()}`}>
          <DeltaIcon className="w-3 h-3" />
          <span>{formatDelta()}</span>
        </div>
      )}
    </div>
  );
}

// ============ SKELETON ============

function ComparisonSkeleton() {
  return (
    <div className="bg-warm-800 rounded-2xl border border-warm-700 p-4 animate-pulse transition-colors">
      <div className="h-6 w-48 bg-warm-700 rounded mb-4" />
      <div className="grid grid-cols-3 gap-4 mb-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="text-center">
            <div className="h-8 w-8 bg-warm-700 rounded-full mx-auto mb-2" />
            <div className="h-8 w-16 bg-warm-700 rounded mx-auto mb-1" />
            <div className="h-3 w-12 bg-warm-600 rounded mx-auto" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="h-20 bg-warm-700 rounded-xl" />
        <div className="h-20 bg-warm-700 rounded-xl" />
      </div>
    </div>
  );
}

export default PeriodComparison;
