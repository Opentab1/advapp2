import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChevronDown, 
  ChevronUp, 
  Volume2, 
  Sun, 
  Target,
  CheckCircle,
  AlertTriangle,
  XCircle
} from 'lucide-react';
import type { SensorData } from '../types';

interface PulseScoreLiveProps {
  sensorData: SensorData | null;
}

// Real optimal ranges for a bar/venue environment
const OPTIMAL_RANGES = {
  sound: { min: 70, max: 82, unit: 'dB', label: 'Sound Level' },
  light: { min: 50, max: 350, unit: 'lux', label: 'Light Level' },
};

// Factor weights (must sum to 1.0)
const WEIGHTS = {
  sound: 0.60,    // Sound is most important for bar atmosphere
  light: 0.40,    // Lighting sets the mood
};

/**
 * Calculate score for a single factor (0-100)
 * 100 = within optimal range
 * Decreases linearly as value moves away from range
 */
function calculateFactorScore(value: number | undefined, range: { min: number; max: number }): number {
  if (value === undefined || value === null) return 0;
  
  // Within optimal range = 100
  if (value >= range.min && value <= range.max) {
    return 100;
  }
  
  // Calculate how far outside the range
  const rangeSize = range.max - range.min;
  const tolerance = rangeSize * 0.5; // 50% tolerance before hitting 0
  
  if (value < range.min) {
    const deviation = range.min - value;
    return Math.max(0, Math.round(100 - (deviation / tolerance) * 100));
  } else {
    const deviation = value - range.max;
    return Math.max(0, Math.round(100 - (deviation / tolerance) * 100));
  }
}

/**
 * Get status indicator for a factor score
 */
function getStatus(score: number): { icon: typeof CheckCircle; color: string; bg: string; label: string } {
  if (score >= 85) return { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Optimal' };
  if (score >= 60) return { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: 'Okay' };
  return { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/20', label: 'Adjust' };
}

export function PulseScoreLive({ sensorData }: PulseScoreLiveProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Calculate real-time factor scores from actual sensor data
  const soundScore = calculateFactorScore(sensorData?.decibels, OPTIMAL_RANGES.sound);
  const lightScore = calculateFactorScore(sensorData?.light, OPTIMAL_RANGES.light);

  // Calculate weighted total score
  const totalScore = Math.round(
    (soundScore * WEIGHTS.sound) +
    (lightScore * WEIGHTS.light)
  );

  // Check if we have any data
  const hasData = sensorData && (sensorData.decibels || sensorData.light);

  // Overall status
  const overallStatus = getStatus(totalScore);
  const OverallIcon = overallStatus.icon;

  // Score color gradient
  const getScoreColor = (score: number) => {
    if (score >= 85) return 'from-green-500 to-emerald-600';
    if (score >= 60) return 'from-yellow-500 to-orange-500';
    return 'from-red-500 to-rose-600';
  };

  if (!hasData) {
    return (
      <div className="glass-card p-6 border border-gray-500/30">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gray-700 flex items-center justify-center">
            <Target className="w-7 h-7 text-gray-500" />
          </div>
          <div>
            <div className="text-lg font-bold text-white">🎯 PULSE SCORE</div>
            <div className="text-sm text-gray-400">Waiting for sensor data...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className={`glass-card p-6 border ${
        totalScore >= 85 ? 'border-green-500/30' :
        totalScore >= 60 ? 'border-yellow-500/30' :
        'border-red-500/30'
      }`}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header - Always Visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between gap-4 group"
      >
        <div className="flex items-center gap-4">
          {/* Score Circle */}
          <div className={`relative w-16 h-16 rounded-full bg-gradient-to-br ${getScoreColor(totalScore)} p-0.5 flex-shrink-0`}>
            <div className="w-full h-full rounded-full bg-gray-900 flex items-center justify-center">
              <span className="text-2xl font-bold text-white">{totalScore}</span>
            </div>
          </div>

          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">🎯 PULSE SCORE</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${overallStatus.bg} ${overallStatus.color}`}>
                {overallStatus.label}
              </span>
            </div>
            <p className="text-sm text-gray-400">
              {totalScore >= 85 ? 'Atmosphere is dialed in!' :
               totalScore >= 60 ? 'Good, with room to optimize' :
               'Needs adjustment'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-gray-400 group-hover:text-cyan transition-colors">
          <span className="text-sm hidden sm:inline">{isExpanded ? 'Hide' : 'Details'}</span>
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </button>

      {/* Expanded Details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="pt-6 mt-6 border-t border-white/10 space-y-4">
              {/* Factor Breakdown */}
              <div className="space-y-3">
                <FactorRow
                  icon={Volume2}
                  label="Sound Level"
                  currentValue={sensorData?.decibels}
                  unit="dB"
                  optimalRange={OPTIMAL_RANGES.sound}
                  score={soundScore}
                  weight={WEIGHTS.sound}
                />
                <FactorRow
                  icon={Sun}
                  label="Light Level"
                  currentValue={sensorData?.light}
                  unit="lux"
                  optimalRange={OPTIMAL_RANGES.light}
                  score={lightScore}
                  weight={WEIGHTS.light}
                />
              </div>

              {/* Live Calculation */}
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <p className="text-xs text-gray-500 mb-3 uppercase tracking-wide">Live Calculation</p>
                <div className="font-mono text-sm space-y-1">
                  <div className="flex justify-between text-gray-400">
                    <span>Sound: <span className="text-cyan">{soundScore}</span> × {(WEIGHTS.sound * 100).toFixed(0)}%</span>
                    <span className="text-white">{(soundScore * WEIGHTS.sound).toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Light: <span className="text-yellow-400">{lightScore}</span> × {(WEIGHTS.light * 100).toFixed(0)}%</span>
                    <span className="text-white">{(lightScore * WEIGHTS.light).toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-white/10 text-white font-bold">
                    <span>Total</span>
                    <span className={overallStatus.color}>{totalScore}</span>
                  </div>
                </div>
              </div>

              {/* Tips */}
              {totalScore < 85 && (
                <div className="p-3 rounded-lg bg-cyan/5 border border-cyan/20">
                  <p className="text-sm text-cyan font-medium mb-1">💡 Quick Tip</p>
                  <p className="text-xs text-gray-300">
                    {soundScore < lightScore
                      ? sensorData?.decibels && sensorData.decibels > OPTIMAL_RANGES.sound.max
                        ? 'Sound is too loud. Lower the music or add sound dampening.'
                        : 'Sound is too quiet. Raise the music to energize the space.'
                      : sensorData?.light && sensorData.light > OPTIMAL_RANGES.light.max
                        ? 'Too bright. Dim the lights for better ambiance.'
                        : 'Too dark. Add some ambient lighting.'
                    }
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Factor Row Component
function FactorRow({ 
  icon: Icon, 
  label, 
  currentValue, 
  unit, 
  optimalRange, 
  score, 
  weight 
}: {
  icon: typeof Volume2;
  label: string;
  currentValue: number | undefined;
  unit: string;
  optimalRange: { min: number; max: number };
  score: number;
  weight: number;
}) {
  const status = getStatus(score);
  const StatusIcon = status.icon;
  const isInRange = currentValue !== undefined && 
    currentValue >= optimalRange.min && 
    currentValue <= optimalRange.max;

  return (
    <div className="p-3 rounded-lg bg-white/5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded ${status.bg}`}>
            <Icon className={`w-4 h-4 ${status.color}`} />
          </div>
          <span className="text-sm font-medium text-white">{label}</span>
          <span className="text-xs text-gray-500">({(weight * 100).toFixed(0)}%)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-lg font-bold ${status.color}`}>{score}</span>
          <StatusIcon className={`w-4 h-4 ${status.color}`} />
        </div>
      </div>
      
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">
          Current: <span className={`font-medium ${isInRange ? 'text-green-400' : 'text-white'}`}>
            {currentValue?.toFixed(1) ?? '--'} {unit}
          </span>
        </span>
        <span className="text-gray-500">
          Optimal: {optimalRange.min}-{optimalRange.max} {unit}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <motion.div 
          className={`h-full rounded-full ${
            score >= 85 ? 'bg-green-500' :
            score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </div>
  );
}
