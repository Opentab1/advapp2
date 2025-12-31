/**
 * TimeContext - Shows time-aware expectations and comparisons
 * 
 * Addresses "Is 72 good or bad RIGHT NOW?" problem:
 * - Shows target for current time/day
 * - Color codes based on meeting target
 * - Shows what period we're in
 * - Indicates next period transition
 */

import { motion } from 'framer-motion';
import { 
  Target, 
  TrendingUp, 
  TrendingDown, 
  Clock,
  AlertTriangle,
  CheckCircle,
  Zap,
  ArrowRight
} from 'lucide-react';
import type { ScoreContext, TimeExpectation } from '../hooks/useTimeContext';

// ============ TYPES ============

interface TimeContextBadgeProps {
  scoreContext: ScoreContext;
  compact?: boolean;
}

interface TargetComparisonProps {
  currentScore: number | null;
  expectation: TimeExpectation;
  scoreContext: ScoreContext;
}

interface PeriodIndicatorProps {
  currentPeriod: string;
  intensity: TimeExpectation['intensity'];
  nextPeriodIn: number | null;
  nextPeriodName: string | null;
}

// ============ TIME CONTEXT BADGE ============

export function TimeContextBadge({ scoreContext, compact = false }: TimeContextBadgeProps) {
  const { expectation, meetsTarget, exceedsTarget, belowMinimum, gapFromTarget } = scoreContext;

  const getStyle = () => {
    if (exceedsTarget) return {
      bg: 'bg-green-100',
      border: 'border-green-200',
      text: 'text-green-700',
      icon: TrendingUp,
    };
    if (meetsTarget) return {
      bg: 'bg-blue-100',
      border: 'border-blue-200',
      text: 'text-blue-700',
      icon: CheckCircle,
    };
    if (belowMinimum) return {
      bg: 'bg-red-100',
      border: 'border-red-200',
      text: 'text-red-700',
      icon: AlertTriangle,
    };
    return {
      bg: 'bg-amber-100',
      border: 'border-amber-200',
      text: 'text-amber-700',
      icon: Target,
    };
  };

  const style = getStyle();
  const Icon = style.icon;

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${style.bg} ${style.text} border ${style.border}`}>
        <Icon className="w-3 h-3" />
        <span>Target: {expectation.targetScore}</span>
        {gapFromTarget !== 0 && (
          <span className={gapFromTarget > 0 ? 'text-green-600' : 'text-red-600'}>
            ({gapFromTarget > 0 ? '+' : ''}{gapFromTarget})
          </span>
        )}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-3 rounded-xl ${style.bg} border ${style.border}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${style.text}`} />
          <div>
            <span className={`text-sm font-medium ${style.text}`}>
              {expectation.label}
            </span>
            <span className="text-xs text-warm-500 ml-2">
              Target: {expectation.targetScore}+
            </span>
          </div>
        </div>
        
        {gapFromTarget !== 0 && (
          <div className={`flex items-center gap-1 text-sm font-bold ${
            gapFromTarget > 0 ? 'text-green-600' : 'text-red-600'
          }`}>
            {gapFromTarget > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {gapFromTarget > 0 ? '+' : ''}{gapFromTarget}
          </div>
        )}
      </div>
      
      <p className={`text-xs mt-1 ${style.text} opacity-80`}>
        {scoreContext.statusMessage}
      </p>
    </motion.div>
  );
}

// ============ TARGET COMPARISON CARD ============

export function TargetComparison({ currentScore, expectation, scoreContext }: TargetComparisonProps) {
  const { meetsTarget, exceedsTarget, belowMinimum, gapFromTarget } = scoreContext;

  const getProgressColor = () => {
    if (exceedsTarget) return 'bg-green-500';
    if (meetsTarget) return 'bg-blue-500';
    if (belowMinimum) return 'bg-red-500';
    return 'bg-amber-500';
  };

  const progressPercent = currentScore !== null 
    ? Math.min(100, (currentScore / expectation.targetScore) * 100)
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-white border border-warm-200"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-warm-800">{expectation.label} Target</span>
        </div>
        <span className="text-xs text-warm-500">{expectation.description}</span>
      </div>

      {/* Visual comparison */}
      <div className="flex items-center gap-4 mb-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-warm-500">Current</span>
            <span className="text-xs text-warm-500">Target: {expectation.targetScore}</span>
          </div>
          <div className="h-3 bg-warm-100 rounded-full overflow-hidden relative">
            {/* Target marker */}
            <div 
              className="absolute top-0 bottom-0 w-0.5 bg-warm-400 z-10"
              style={{ left: '100%', transform: 'translateX(-1px)' }}
            />
            {/* Progress bar */}
            <motion.div
              className={`h-full ${getProgressColor()} rounded-full`}
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>
        
        <div className={`text-right ${
          exceedsTarget ? 'text-green-600' : 
          meetsTarget ? 'text-blue-600' : 
          belowMinimum ? 'text-red-600' : 
          'text-amber-600'
        }`}>
          <p className="text-2xl font-bold">{currentScore ?? '--'}</p>
          <p className="text-xs">
            {gapFromTarget > 0 ? '+' : ''}{gapFromTarget !== 0 ? gapFromTarget : 'On target'}
          </p>
        </div>
      </div>

      {/* Encouragement message */}
      <p className="text-xs text-warm-500 italic">
        {scoreContext.encouragement}
      </p>
    </motion.div>
  );
}

// ============ PERIOD INDICATOR ============

export function PeriodIndicator({ currentPeriod, intensity, nextPeriodIn, nextPeriodName }: PeriodIndicatorProps) {
  const getIntensityStyle = () => {
    switch (intensity) {
      case 'peak': return { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' };
      case 'busy': return { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' };
      case 'building': return { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' };
      case 'slow': return { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' };
      case 'winding-down': return { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500' };
      default: return { bg: 'bg-warm-100', text: 'text-warm-600', dot: 'bg-warm-400' };
    }
  };

  const style = getIntensityStyle();

  return (
    <div className="flex items-center gap-3">
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${style.bg}`}>
        <span className={`relative flex h-2 w-2`}>
          {intensity === 'peak' && (
            <span className={`absolute inline-flex h-full w-full rounded-full ${style.dot} opacity-75 animate-ping`} />
          )}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${style.dot}`} />
        </span>
        <span className={`text-xs font-medium ${style.text}`}>{currentPeriod}</span>
      </div>
      
      {nextPeriodIn !== null && nextPeriodName && nextPeriodIn < 60 && (
        <div className="flex items-center gap-1 text-xs text-warm-400">
          <ArrowRight className="w-3 h-3" />
          <span>{nextPeriodName} in {nextPeriodIn}m</span>
        </div>
      )}
    </div>
  );
}

// ============ INLINE TARGET HINT ============

export function InlineTargetHint({ 
  targetScore, 
  currentScore,
  label 
}: { 
  targetScore: number; 
  currentScore: number | null;
  label: string;
}) {
  if (currentScore === null) return null;
  
  const gap = currentScore - targetScore;
  const meetsTarget = gap >= 0;

  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-warm-400">{label} target:</span>
      <span className={meetsTarget ? 'text-green-600 font-medium' : 'text-amber-600 font-medium'}>
        {targetScore}
      </span>
      {gap !== 0 && (
        <span className={meetsTarget ? 'text-green-500' : 'text-red-500'}>
          ({gap > 0 ? '+' : ''}{gap})
        </span>
      )}
    </div>
  );
}

export default TimeContextBadge;
