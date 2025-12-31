/**
 * WelcomeBack - Shows "Since You Left" comparison
 * 
 * Addresses the "No Memory Across Sessions" problem:
 * - Greets returning users
 * - Shows what changed since their last visit
 * - Creates emotional connection and sense of progress
 * - Provides context for current state
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  TrendingUp, 
  TrendingDown, 
  Minus,
  Clock,
  Zap,
  Volume2,
  Sun,
  Users,
  X,
  Sparkles,
  Award
} from 'lucide-react';
import type { SessionDelta, SessionSnapshot } from '../hooks/useSessionMemory';

// ============ TYPES ============

interface WelcomeBackProps {
  lastSession: SessionSnapshot | null;
  delta: SessionDelta | null;
  currentPulseScore: number | null;
  averagePulseScore: number | null;
  bestPulseScore: number | null;
  visitCount: number;
  onDismiss: () => void;
}

interface MetricDeltaProps {
  icon: typeof Volume2;
  label: string;
  change: number | null;
  unit: string;
  invertColors?: boolean; // true if decrease is good (e.g., for loud sound)
}

// ============ MAIN COMPONENT ============

export function WelcomeBack({
  lastSession,
  delta,
  currentPulseScore,
  averagePulseScore,
  bestPulseScore,
  visitCount,
  onDismiss,
}: WelcomeBackProps) {
  if (!delta || !lastSession) return null;

  // Determine the greeting message
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning!';
    if (hour < 17) return 'Good afternoon!';
    if (hour < 21) return 'Good evening!';
    return 'Welcome back!';
  }, []);

  // Determine the headline based on changes
  const headline = useMemo(() => {
    if (delta.pulseChange !== null) {
      if (delta.pulseChange >= 10) return "Things are looking up! 📈";
      if (delta.pulseChange >= 5) return "Nice improvement!";
      if (delta.pulseChange <= -10) return "Heads up - conditions changed";
      if (delta.pulseChange <= -5) return "A few things shifted";
    }
    if (delta.timeSinceLastVisit > 1440) return "Been a while! Here's what's new";
    if (delta.isSameDay) return "Welcome back to tonight's shift";
    return "Here's how things compare";
  }, [delta]);

  // Check for achievements
  const isNewBest = currentPulseScore !== null && bestPulseScore !== null && currentPulseScore > bestPulseScore;
  const isAboveAverage = currentPulseScore !== null && averagePulseScore !== null && currentPulseScore > averagePulseScore;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      className="mb-6 relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-warm-50 border border-primary/20"
    >
      {/* Close button */}
      <button
        onClick={onDismiss}
        className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-warm-200/50 transition-colors z-10"
      >
        <X className="w-4 h-4 text-warm-400" />
      </button>

      <div className="p-5">
        {/* Greeting */}
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-5 h-5 text-primary" />
          <span className="text-sm font-medium text-primary">{greeting}</span>
          <span className="text-xs text-warm-400">•</span>
          <span className="text-xs text-warm-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Last check: {delta.lastVisitFormatted}
          </span>
        </div>

        {/* Headline */}
        <h3 className="text-lg font-bold text-warm-800 mb-4">{headline}</h3>

        {/* Pulse Score Comparison */}
        {delta.pulseChange !== null && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className={`p-4 rounded-xl mb-4 ${
              delta.pulseChange >= 5 
                ? 'bg-green-50 border border-green-200' 
                : delta.pulseChange <= -5
                ? 'bg-amber-50 border border-amber-200'
                : 'bg-white border border-warm-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  delta.pulseChange >= 5 ? 'bg-green-100' : delta.pulseChange <= -5 ? 'bg-amber-100' : 'bg-warm-100'
                }`}>
                  <Zap className={`w-5 h-5 ${
                    delta.pulseChange >= 5 ? 'text-green-600' : delta.pulseChange <= -5 ? 'text-amber-600' : 'text-warm-600'
                  }`} />
                </div>
                <div>
                  <p className="text-sm text-warm-500">Pulse Score</p>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-warm-400 line-through">
                      {lastSession.pulseScore}
                    </span>
                    <span className="text-warm-300">→</span>
                    <span className={`text-xl font-bold ${
                      delta.pulseChange >= 5 ? 'text-green-600' : delta.pulseChange <= -5 ? 'text-amber-600' : 'text-warm-800'
                    }`}>
                      {currentPulseScore}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold ${
                delta.pulseChange > 0 
                  ? 'bg-green-100 text-green-700' 
                  : delta.pulseChange < 0
                  ? 'bg-red-100 text-red-700'
                  : 'bg-warm-100 text-warm-600'
              }`}>
                {delta.pulseChange > 0 ? (
                  <TrendingUp className="w-4 h-4" />
                ) : delta.pulseChange < 0 ? (
                  <TrendingDown className="w-4 h-4" />
                ) : (
                  <Minus className="w-4 h-4" />
                )}
                {delta.pulseChange > 0 ? '+' : ''}{delta.pulseChange}
              </div>
            </div>
          </motion.div>
        )}

        {/* Metric Changes */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-3 gap-2"
        >
          <MetricDelta
            icon={Volume2}
            label="Sound"
            change={delta.decibelChange}
            unit="dB"
            invertColors={true} // Decrease in loud sound is good
          />
          <MetricDelta
            icon={Sun}
            label="Light"
            change={delta.lightChange}
            unit="lux"
          />
          <MetricDelta
            icon={Users}
            label="Crowd"
            change={delta.occupancyChange}
            unit=""
          />
        </motion.div>

        {/* Achievement badges */}
        {(isNewBest || isAboveAverage) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-4 flex gap-2"
          >
            {isNewBest && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-yellow-100 to-amber-100 border border-yellow-200">
                <Award className="w-4 h-4 text-yellow-600" />
                <span className="text-xs font-bold text-yellow-700">New Personal Best!</span>
              </div>
            )}
            {isAboveAverage && !isNewBest && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 border border-green-200">
                <TrendingUp className="w-4 h-4 text-green-600" />
                <span className="text-xs font-medium text-green-700">Above your average ({averagePulseScore})</span>
              </div>
            )}
          </motion.div>
        )}

        {/* Visit streak */}
        {visitCount > 5 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-4 text-xs text-warm-400 text-center"
          >
            📊 This is check-in #{visitCount} • Keep the streak going!
          </motion.p>
        )}
      </div>
    </motion.div>
  );
}

// ============ METRIC DELTA COMPONENT ============

function MetricDelta({ icon: Icon, label, change, unit, invertColors = false }: MetricDeltaProps) {
  if (change === null) {
    return (
      <div className="p-2 rounded-lg bg-warm-50 text-center">
        <Icon className="w-4 h-4 text-warm-300 mx-auto mb-1" />
        <p className="text-xs text-warm-400">{label}</p>
        <p className="text-sm font-medium text-warm-300">--</p>
      </div>
    );
  }

  const absChange = Math.abs(change);
  const isPositive = invertColors ? change < 0 : change > 0;
  const isNegative = invertColors ? change > 0 : change < 0;
  const isNeutral = change === 0 || absChange < 1;

  return (
    <div className={`p-2 rounded-lg text-center ${
      isNeutral ? 'bg-warm-50' : isPositive ? 'bg-green-50' : 'bg-amber-50'
    }`}>
      <Icon className={`w-4 h-4 mx-auto mb-1 ${
        isNeutral ? 'text-warm-400' : isPositive ? 'text-green-500' : 'text-amber-500'
      }`} />
      <p className="text-xs text-warm-500">{label}</p>
      <div className={`flex items-center justify-center gap-0.5 text-sm font-medium ${
        isNeutral ? 'text-warm-600' : isPositive ? 'text-green-600' : 'text-amber-600'
      }`}>
        {!isNeutral && (
          change > 0 ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )
        )}
        <span>{change > 0 ? '+' : ''}{Math.round(change)}{unit}</span>
      </div>
    </div>
  );
}

// ============ COMPACT VERSION ============

export function WelcomeBackCompact({
  delta,
  onDismiss,
}: {
  delta: SessionDelta | null;
  onDismiss: () => void;
}) {
  if (!delta) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4 flex items-center justify-between px-4 py-2 rounded-xl bg-primary/5 border border-primary/10"
    >
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-primary" />
        <span className="text-sm text-warm-600">
          Last check: <span className="font-medium">{delta.lastVisitFormatted}</span>
        </span>
        {delta.pulseChange !== null && delta.pulseChange !== 0 && (
          <>
            <span className="text-warm-300">•</span>
            <span className={`text-sm font-medium flex items-center gap-1 ${
              delta.pulseChange > 0 ? 'text-green-600' : 'text-red-500'
            }`}>
              Pulse {delta.pulseChange > 0 ? '+' : ''}{delta.pulseChange}
              {delta.pulseChange > 0 ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
            </span>
          </>
        )}
      </div>
      <button onClick={onDismiss} className="p-1 hover:bg-warm-200/50 rounded-lg">
        <X className="w-3.5 h-3.5 text-warm-400" />
      </button>
    </motion.div>
  );
}

export default WelcomeBack;
