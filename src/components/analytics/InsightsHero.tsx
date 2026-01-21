/**
 * InsightsHero - WHOOP-style hero section
 * 
 * Shows ONE primary metric with context.
 * Answers: "How am I doing?"
 */

import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { InsightsSummary, InsightsTimeRange } from '../../types/insights';

interface InsightsHeroProps {
  data: InsightsSummary | null;
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

function getScoreColor(score: number): string {
  if (score >= 80) return 'text-recovery-high';
  if (score >= 50) return 'text-recovery-medium';
  return 'text-recovery-low';
}

function getScoreLabel(score: number): string {
  if (score >= 85) return 'Excellent';
  if (score >= 75) return 'Great';
  if (score >= 65) return 'Good';
  if (score >= 50) return 'Fair';
  return 'Needs Work';
}

function getDeltaContext(delta: number, timeRange: InsightsTimeRange): string {
  const comparison = timeRange === 'last_night' 
    ? 'vs previous night'
    : timeRange === '7d' 
      ? 'vs last week'
      : timeRange === '14d'
        ? 'vs previous 2 weeks'
        : 'vs last month';
  
  if (delta === 0) return `Same ${comparison}`;
  if (delta > 0) return `Up ${delta}% ${comparison}`;
  return `Down ${Math.abs(delta)}% ${comparison}`;
}

export function InsightsHero({ data, timeRange, loading }: InsightsHeroProps) {
  if (loading || !data) {
    return (
      <div className="bg-gradient-to-br from-warm-800 to-warm-900 rounded-2xl p-6 animate-pulse">
        <div className="h-4 bg-warm-700 rounded w-24 mb-4" />
        <div className="h-16 bg-warm-700 rounded w-32 mb-4" />
        <div className="h-4 bg-warm-700 rounded w-48" />
      </div>
    );
  }

  const scoreColor = getScoreColor(data.score);
  const scoreLabel = getScoreLabel(data.score);
  const deltaContext = getDeltaContext(data.scoreDelta, timeRange);
  
  const DeltaIcon = data.scoreDelta > 0 ? TrendingUp : data.scoreDelta < 0 ? TrendingDown : Minus;
  const deltaColor = data.scoreDelta > 0 ? 'text-recovery-high' : data.scoreDelta < 0 ? 'text-recovery-low' : 'text-warm-400';

  return (
    <motion.div 
      className="bg-gradient-to-br from-warm-800/80 to-warm-900/80 border border-whoop-divider rounded-2xl p-6"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Time Range Label */}
      <div className="text-xs text-warm-400 uppercase tracking-whoop mb-2">
        {getTimeRangeLabel(timeRange)}
      </div>

      {/* Primary Score */}
      <div className="flex items-end gap-3 mb-2">
        <span className={`text-6xl font-bold ${scoreColor}`}>
          {data.score}
        </span>
        <span className="text-xl text-warm-400 mb-2">
          / 100
        </span>
      </div>

      {/* Score Label */}
      <div className={`text-lg font-medium ${scoreColor} mb-3`}>
        {scoreLabel}
      </div>

      {/* Delta */}
      <div className={`flex items-center gap-1.5 text-sm ${deltaColor}`}>
        <DeltaIcon className="w-4 h-4" />
        <span>{deltaContext}</span>
      </div>

      {/* Quick Stats Row */}
      <div className="flex items-center gap-4 mt-5 pt-4 border-t border-warm-700">
        {data.totalGuests > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-warm-400 text-sm">Guests:</span>
            <span className="text-white font-semibold">{data.totalGuests.toLocaleString()}</span>
            {data.guestsDelta !== 0 && (
              <span className={`text-xs ${data.guestsDelta > 0 ? 'text-recovery-high' : 'text-recovery-low'}`}>
                {data.guestsDelta > 0 ? '↑' : '↓'}{Math.abs(data.guestsDelta)}%
              </span>
            )}
          </div>
        )}
        {data.avgStayMinutes !== null && (
          <div className="flex items-center gap-2">
            <span className="text-warm-400 text-sm">Avg Stay:</span>
            <span className="text-white font-semibold">~{data.avgStayMinutes}m</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default InsightsHero;
