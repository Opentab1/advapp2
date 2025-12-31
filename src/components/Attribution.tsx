/**
 * Attribution - Shows what caused score changes
 * 
 * Addresses "Score dropped. But WHY?" problem:
 * - Detects anomalies in metrics
 * - Shows "Sound spiked at 9:47pm"
 * - Highlights which factor is dragging down score
 * - Provides mini-timeline of recent changes
 */

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Volume2,
  Sun,
  Users,
  Zap,
  Clock,
  X,
  ChevronRight
} from 'lucide-react';
import type { MetricAnomaly } from '../hooks/useTimeContext';

// ============ TYPES ============

interface AttributionAlertProps {
  anomaly: MetricAnomaly;
  onDismiss?: () => void;
}

interface ScoreBreakdownProps {
  soundScore: number;
  lightScore: number;
  currentDecibels: number | null;
  currentLight: number | null;
  optimalSound: { min: number; max: number };
  optimalLight: { min: number; max: number };
}

interface WhatChangedProps {
  anomalies: MetricAnomaly[];
  soundScore: number;
  lightScore: number;
  onDismiss?: () => void;
}

// ============ ATTRIBUTION ALERT ============

export function AttributionAlert({ anomaly, onDismiss }: AttributionAlertProps) {
  const getIcon = () => {
    switch (anomaly.metric) {
      case 'sound': return Volume2;
      case 'light': return Sun;
      case 'occupancy': return Users;
      case 'pulse': return Zap;
      default: return AlertTriangle;
    }
  };

  const getStyle = () => {
    if (anomaly.severity === 'major') {
      return {
        bg: 'bg-red-50',
        border: 'border-red-200',
        iconBg: 'bg-red-100',
        iconColor: 'text-red-600',
        textColor: 'text-red-800',
      };
    }
    if (anomaly.severity === 'significant') {
      return {
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        iconBg: 'bg-amber-100',
        iconColor: 'text-amber-600',
        textColor: 'text-amber-800',
      };
    }
    return {
      bg: 'bg-warm-50',
      border: 'border-warm-200',
      iconBg: 'bg-warm-100',
      iconColor: 'text-warm-600',
      textColor: 'text-warm-700',
    };
  };

  const Icon = getIcon();
  const style = getStyle();
  const TrendIcon = anomaly.direction === 'spike' ? TrendingUp : TrendingDown;
  const time = new Date(anomaly.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      className={`p-3 rounded-xl ${style.bg} border ${style.border}`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${style.iconBg}`}>
          <Icon className={`w-4 h-4 ${style.iconColor}`} />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <TrendIcon className={`w-3.5 h-3.5 ${
              anomaly.direction === 'spike' ? 'text-red-500' : 'text-blue-500'
            }`} />
            <span className={`text-sm font-medium ${style.textColor}`}>
              {anomaly.message}
            </span>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-warm-500">
            <Clock className="w-3 h-3" />
            <span>
              {anomaly.previousValue.toFixed(0)} → {anomaly.currentValue.toFixed(0)}
              {anomaly.metric === 'sound' && ' dB'}
              {anomaly.metric === 'light' && ' lux'}
            </span>
          </div>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className={`p-1 rounded-lg hover:${style.bg} transition-colors`}
          >
            <X className="w-4 h-4 text-warm-400" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ============ SCORE FACTOR BREAKDOWN ============

export function ScoreBreakdown({ 
  soundScore, 
  lightScore, 
  currentDecibels, 
  currentLight,
  optimalSound,
  optimalLight,
}: ScoreBreakdownProps) {
  // Determine which factor is the problem
  const soundIsProblem = soundScore < 60;
  const lightIsProblem = lightScore < 60;
  const primaryProblem = soundScore <= lightScore ? 'sound' : 'light';

  // Get status for each factor
  const getSoundStatus = () => {
    if (currentDecibels === null) return { status: 'unknown', message: 'No data' };
    if (currentDecibels > optimalSound.max) {
      return { 
        status: 'high', 
        message: `${(currentDecibels - optimalSound.max).toFixed(0)} dB too loud`,
        action: 'Turn down the music'
      };
    }
    if (currentDecibels < optimalSound.min) {
      return { 
        status: 'low', 
        message: `${(optimalSound.min - currentDecibels).toFixed(0)} dB too quiet`,
        action: 'Increase the energy'
      };
    }
    return { status: 'optimal', message: 'In optimal range' };
  };

  const getLightStatus = () => {
    if (currentLight === null) return { status: 'unknown', message: 'No data' };
    if (currentLight > optimalLight.max) {
      return { 
        status: 'high', 
        message: `${(currentLight - optimalLight.max).toFixed(0)} lux too bright`,
        action: 'Dim the lights'
      };
    }
    if (currentLight < optimalLight.min) {
      return { 
        status: 'low', 
        message: `${(optimalLight.min - currentLight).toFixed(0)} lux too dim`,
        action: 'Brighten up slightly'
      };
    }
    return { status: 'optimal', message: 'In optimal range' };
  };

  const soundStatus = getSoundStatus();
  const lightStatus = getLightStatus();

  return (
    <div className="space-y-2">
      <FactorBreakdownRow
        icon={Volume2}
        label="Sound"
        weight="60%"
        score={soundScore}
        value={currentDecibels}
        unit="dB"
        status={soundStatus}
        isPrimary={primaryProblem === 'sound' && soundIsProblem}
      />
      <FactorBreakdownRow
        icon={Sun}
        label="Light"
        weight="40%"
        score={lightScore}
        value={currentLight}
        unit="lux"
        status={lightStatus}
        isPrimary={primaryProblem === 'light' && lightIsProblem}
      />
    </div>
  );
}

function FactorBreakdownRow({
  icon: Icon,
  label,
  weight,
  score,
  value,
  unit,
  status,
  isPrimary,
}: {
  icon: typeof Volume2;
  label: string;
  weight: string;
  score: number;
  value: number | null;
  unit: string;
  status: { status: string; message: string; action?: string };
  isPrimary: boolean;
}) {
  const getScoreColor = () => {
    if (score >= 85) return 'text-green-600';
    if (score >= 60) return 'text-amber-600';
    return 'text-red-600';
  };

  const getBarColor = () => {
    if (score >= 85) return 'bg-green-500';
    if (score >= 60) return 'bg-amber-500';
    return 'bg-red-500';
  };

  return (
    <div className={`p-3 rounded-xl ${isPrimary ? 'bg-red-50 border border-red-200' : 'bg-warm-50'}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${isPrimary ? 'text-red-500' : 'text-warm-500'}`} />
          <span className="text-sm font-medium text-warm-800">{label}</span>
          <span className="text-xs text-warm-400">({weight})</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-warm-500">
            {value !== null ? `${value.toFixed(0)} ${unit}` : '--'}
          </span>
          <span className={`text-sm font-bold ${getScoreColor()}`}>{score}</span>
        </div>
      </div>
      
      <div className="h-1.5 bg-warm-200 rounded-full overflow-hidden mb-2">
        <div 
          className={`h-full ${getBarColor()} rounded-full transition-all`}
          style={{ width: `${score}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className={status.status === 'optimal' ? 'text-green-600' : 'text-warm-500'}>
          {status.message}
        </span>
        {status.action && isPrimary && (
          <span className="text-red-600 font-medium flex items-center gap-1">
            {status.action}
            <ChevronRight className="w-3 h-3" />
          </span>
        )}
      </div>
    </div>
  );
}

// ============ WHAT CHANGED SUMMARY ============

export function WhatChanged({ anomalies, soundScore, lightScore, onDismiss }: WhatChangedProps) {
  const recentAnomalies = useMemo(() => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    return anomalies
      .filter(a => a.timestamp > fiveMinutesAgo)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 3);
  }, [anomalies]);

  // Determine primary cause if score is low
  const primaryCause = useMemo(() => {
    const lowestScore = Math.min(soundScore, lightScore);
    if (lowestScore >= 60) return null;

    if (soundScore < lightScore) {
      return { factor: 'Sound', score: soundScore, icon: Volume2 };
    }
    return { factor: 'Light', score: lightScore, icon: Sun };
  }, [soundScore, lightScore]);

  if (recentAnomalies.length === 0 && !primaryCause) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-amber-50 border border-amber-200"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span className="text-sm font-semibold text-amber-800">What Changed?</span>
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="p-1 hover:bg-amber-100 rounded-lg">
            <X className="w-4 h-4 text-amber-400" />
          </button>
        )}
      </div>

      <div className="space-y-2">
        {/* Primary cause */}
        {primaryCause && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-white border border-amber-200">
            <primaryCause.icon className="w-4 h-4 text-red-500" />
            <span className="text-sm text-warm-700">
              <strong>{primaryCause.factor}</strong> is dragging your score
            </span>
            <span className="text-sm font-bold text-red-600 ml-auto">
              {primaryCause.score}/100
            </span>
          </div>
        )}

        {/* Recent anomalies */}
        {recentAnomalies.map((anomaly, i) => (
          <div 
            key={`${anomaly.metric}-${anomaly.timestamp}`}
            className="flex items-center gap-2 text-sm text-warm-600"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            {anomaly.message}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export default AttributionAlert;
