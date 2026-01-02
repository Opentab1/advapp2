/**
 * WeeklyComparison - This week vs last week comparison
 * 
 * Shows:
 * - Pulse Score trend
 * - Traffic comparison
 * - Best/worst hours
 * 
 * Clean, professional design with dark mode support.
 */

import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, Users, Clock, Zap } from 'lucide-react';

interface WeeklyComparisonProps {
  thisWeek: WeekData | null;
  lastWeek: WeekData | null;
  loading?: boolean;
}

export interface WeekData {
  avgPulseScore: number;
  totalVisitors: number;
  peakOccupancy: number;
  avgDwellMinutes: number;
  bestHour: { hour: number; score: number } | null;
  worstHour: { hour: number; score: number } | null;
  dailyScores: number[]; // 7 days, Sun-Sat
}

export function WeeklyComparison({ thisWeek, lastWeek, loading }: WeeklyComparisonProps) {
  if (loading) {
    return <WeeklyComparisonSkeleton />;
  }
  
  if (!thisWeek) {
    return (
      <div className="bg-white dark:bg-warm-800 rounded-2xl border border-warm-200 dark:border-warm-700 p-6 text-center transition-colors">
        <p className="text-warm-500 dark:text-warm-400">Not enough data for weekly comparison</p>
      </div>
    );
  }
  
  // Calculate deltas
  const pulseScoreDelta = lastWeek 
    ? thisWeek.avgPulseScore - lastWeek.avgPulseScore 
    : null;
  const visitorsDelta = lastWeek && lastWeek.totalVisitors > 0
    ? Math.round(((thisWeek.totalVisitors - lastWeek.totalVisitors) / lastWeek.totalVisitors) * 100)
    : null;
  const dwellDelta = lastWeek
    ? thisWeek.avgDwellMinutes - lastWeek.avgDwellMinutes
    : null;
  
  return (
    <motion.div
      className="bg-white dark:bg-warm-800 rounded-2xl border border-warm-200 dark:border-warm-700 overflow-hidden transition-colors"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-warm-50 dark:bg-warm-700/50 border-b border-warm-200 dark:border-warm-700">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-warm-800 dark:text-warm-100">Weekly Comparison</h3>
          <div className="flex items-center gap-2 text-xs text-warm-500 dark:text-warm-400">
            <span className="px-2 py-0.5 bg-primary/20 text-primary rounded font-medium">This Week</span>
            <span>vs</span>
            <span className="px-2 py-0.5 bg-warm-200 dark:bg-warm-600 rounded">Last Week</span>
          </div>
        </div>
      </div>
      
      {/* Main Stats */}
      <div className="p-4 grid grid-cols-3 gap-4">
        <ComparisonStat
          icon={Zap}
          iconColor="text-primary"
          label="Avg Pulse"
          value={thisWeek.avgPulseScore}
          delta={pulseScoreDelta}
          format="score"
        />
        
        <ComparisonStat
          icon={Users}
          iconColor="text-green-500"
          label="Visitors"
          value={thisWeek.totalVisitors}
          delta={visitorsDelta}
          format="percent"
        />
        
        <ComparisonStat
          icon={Clock}
          iconColor="text-amber-500"
          label="Avg Stay"
          value={thisWeek.avgDwellMinutes}
          delta={dwellDelta}
          format="minutes"
        />
      </div>
      
      {/* Best/Worst Hours */}
      <div className="px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          {/* Best Hour */}
          <div className="p-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/30 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span className="text-xs font-medium text-green-700 dark:text-green-400">Best Hour</span>
            </div>
            {thisWeek.bestHour ? (
              <>
                <p className="text-lg font-bold text-green-800 dark:text-green-300">
                  {formatHour(thisWeek.bestHour.hour)}
                </p>
                <p className="text-xs text-green-600 dark:text-green-500">
                  {thisWeek.bestHour.score} avg score
                </p>
              </>
            ) : (
              <p className="text-sm text-green-600 dark:text-green-500">--</p>
            )}
          </div>
          
          {/* Worst Hour */}
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
              <span className="text-xs font-medium text-red-700 dark:text-red-400">Needs Work</span>
            </div>
            {thisWeek.worstHour ? (
              <>
                <p className="text-lg font-bold text-red-800 dark:text-red-300">
                  {formatHour(thisWeek.worstHour.hour)}
                </p>
                <p className="text-xs text-red-600 dark:text-red-500">
                  {thisWeek.worstHour.score} avg score
                </p>
              </>
            ) : (
              <p className="text-sm text-red-600 dark:text-red-500">--</p>
            )}
          </div>
        </div>
      </div>
      
      {/* Mini Week Chart */}
      {thisWeek.dailyScores.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-xs text-warm-500 dark:text-warm-400 mb-2">Daily Pulse Scores</p>
          <div className="flex items-end gap-1 h-16">
            {thisWeek.dailyScores.map((score, i) => {
              const lastWeekScore = lastWeek?.dailyScores[i];
              const height = `${Math.max(10, score)}%`;
              const isToday = i === new Date().getDay();
              
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end gap-0.5 h-12">
                    {/* Last week bar (faded) */}
                    {lastWeekScore !== undefined && (
                      <div
                        className="flex-1 bg-warm-200 dark:bg-warm-600 rounded-t transition-colors"
                        style={{ height: `${Math.max(10, lastWeekScore)}%` }}
                      />
                    )}
                    {/* This week bar */}
                    <motion.div
                      className={`flex-1 rounded-t ${
                        isToday ? 'bg-primary' : 'bg-primary/70'
                      }`}
                      initial={{ height: 0 }}
                      animate={{ height }}
                      transition={{ delay: i * 0.05 }}
                    />
                  </div>
                  <span className={`text-[10px] ${isToday ? 'font-bold text-primary' : 'text-warm-400 dark:text-warm-500'}`}>
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'][i]}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-warm-400 dark:text-warm-500">
            <div className="flex items-center gap-1">
              <span className="w-3 h-2 bg-primary rounded" />
              <span>This week</span>
            </div>
            {lastWeek && (
              <div className="flex items-center gap-1">
                <span className="w-3 h-2 bg-warm-200 dark:bg-warm-600 rounded" />
                <span>Last week</span>
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
    if (delta === null || delta === 0) return 'text-warm-400 dark:text-warm-500';
    return delta > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
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
      <p className="text-2xl font-bold text-warm-800 dark:text-warm-100">{formatValue()}</p>
      <p className="text-xs text-warm-500 dark:text-warm-400 mb-1">{label}</p>
      {delta !== null && (
        <div className={`flex items-center justify-center gap-0.5 text-xs ${getDeltaColor()}`}>
          <DeltaIcon className="w-3 h-3" />
          <span>{formatDelta()}</span>
        </div>
      )}
    </div>
  );
}

// ============ HELPERS ============

function formatHour(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

// ============ SKELETON ============

function WeeklyComparisonSkeleton() {
  return (
    <div className="bg-white dark:bg-warm-800 rounded-2xl border border-warm-200 dark:border-warm-700 p-4 animate-pulse transition-colors">
      <div className="h-6 w-48 bg-warm-200 dark:bg-warm-700 rounded mb-4" />
      <div className="grid grid-cols-3 gap-4 mb-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="text-center">
            <div className="h-8 w-8 bg-warm-200 dark:bg-warm-700 rounded-full mx-auto mb-2" />
            <div className="h-8 w-16 bg-warm-200 dark:bg-warm-700 rounded mx-auto mb-1" />
            <div className="h-3 w-12 bg-warm-100 dark:bg-warm-600 rounded mx-auto" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="h-20 bg-warm-100 dark:bg-warm-700 rounded-xl" />
        <div className="h-20 bg-warm-100 dark:bg-warm-700 rounded-xl" />
      </div>
    </div>
  );
}

export default WeeklyComparison;
