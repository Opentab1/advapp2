/**
 * PulseBreakdownModal - Deep dive into Pulse Score
 * 
 * Shows:
 * - Overall score with clear status
 * - Factor breakdown with WHY each score is what it is
 * - What optimal looks like
 * - How to improve
 * - Historical context
 */

import { motion } from 'framer-motion';
import { Modal } from '../common/Modal';
import { Volume2, Sun, Info, TrendingUp, TrendingDown, Target, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { OPTIMAL_RANGES, FACTOR_WEIGHTS, SCORE_THRESHOLDS } from '../../utils/constants';
import { AnimatedNumber } from '../common/AnimatedNumber';

interface PulseBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  pulseScore: number | null;
  pulseStatusLabel: string;
  soundScore: number;
  lightScore: number;
  currentDecibels: number | null;
  currentLight: number | null;
}

export function PulseBreakdownModal({
  isOpen,
  onClose,
  pulseScore,
  pulseStatusLabel,
  soundScore,
  lightScore,
  currentDecibels,
  currentLight,
}: PulseBreakdownModalProps) {
  // Determine status colors
  const getStatusStyle = (score: number | null) => {
    if (score === null) return 'bg-warm-100 dark:bg-warm-700 text-warm-600 dark:text-warm-300';
    if (score >= SCORE_THRESHOLDS.optimal) return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
    if (score >= SCORE_THRESHOLDS.good) return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
    return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
  };
  
  const getStatusIcon = (score: number | null) => {
    if (score === null) return null;
    if (score >= SCORE_THRESHOLDS.optimal) return CheckCircle2;
    if (score >= SCORE_THRESHOLDS.good) return Target;
    return AlertTriangle;
  };
  
  const StatusIcon = getStatusIcon(pulseScore);
  
  // Generate insights based on scores
  const soundInsight = getSoundInsight(currentDecibels, soundScore);
  const lightInsight = getLightInsight(currentLight, lightScore);
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Pulse Score">
      <div className="space-y-6">
        {/* Main Score Hero */}
        <div className="text-center py-6 bg-warm-50 dark:bg-warm-700/50 rounded-2xl -mx-2">
          <div className="flex items-center justify-center gap-3 mb-2">
            {StatusIcon && (
              <StatusIcon className={`w-8 h-8 ${
                pulseScore !== null && pulseScore >= SCORE_THRESHOLDS.optimal ? 'text-green-500' :
                pulseScore !== null && pulseScore >= SCORE_THRESHOLDS.good ? 'text-amber-500' : 'text-red-500'
              }`} />
            )}
            <AnimatedNumber
              value={pulseScore}
              className="text-6xl font-bold text-warm-800 dark:text-warm-100"
            />
          </div>
          <p className={`inline-block px-4 py-1.5 rounded-full text-sm font-semibold ${getStatusStyle(pulseScore)}`}>
            {pulseStatusLabel}
          </p>
          
          {/* Score meaning */}
          <p className="text-sm text-warm-500 dark:text-warm-400 mt-3 px-4">
            {pulseScore !== null && pulseScore >= SCORE_THRESHOLDS.optimal
              ? 'Your venue atmosphere is ideal for guests right now.'
              : pulseScore !== null && pulseScore >= SCORE_THRESHOLDS.good
              ? 'Good conditions. Small tweaks could make it perfect.'
              : 'Some adjustments needed for optimal guest experience.'}
          </p>
        </div>
        
        {/* What makes up this score */}
        <div>
          <h4 className="text-xs font-semibold text-warm-500 dark:text-warm-400 uppercase tracking-wide mb-3">
            Score Breakdown
          </h4>
          
          <div className="space-y-4">
            {/* Sound Factor */}
            <FactorCard
              icon={Volume2}
              label="Sound Level"
              weight={Math.round(FACTOR_WEIGHTS.sound * 100)}
              score={soundScore}
              currentValue={currentDecibels !== null ? `${currentDecibels.toFixed(0)} dB` : '--'}
              optimalRange={`${OPTIMAL_RANGES.sound.min}-${OPTIMAL_RANGES.sound.max} dB`}
              insight={soundInsight}
            />
            
            {/* Light Factor */}
            <FactorCard
              icon={Sun}
              label="Light Level"
              weight={Math.round(FACTOR_WEIGHTS.light * 100)}
              score={lightScore}
              currentValue={currentLight !== null ? `${currentLight.toFixed(0)} lux` : '--'}
              optimalRange={`${OPTIMAL_RANGES.light.min}-${OPTIMAL_RANGES.light.max} lux`}
              insight={lightInsight}
            />
          </div>
        </div>
        
        {/* How it's calculated */}
        <div className="bg-warm-50 dark:bg-warm-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-warm-400" />
            <h4 className="text-xs font-semibold text-warm-500 dark:text-warm-400 uppercase tracking-wide">
              How It's Calculated
            </h4>
          </div>
          
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-warm-600 dark:text-warm-300">
              <span>Sound: {soundScore} × {Math.round(FACTOR_WEIGHTS.sound * 100)}%</span>
              <span className="font-medium text-warm-800 dark:text-warm-100">
                {(soundScore * FACTOR_WEIGHTS.sound).toFixed(0)}
              </span>
            </div>
            <div className="flex justify-between text-warm-600 dark:text-warm-300">
              <span>Light: {lightScore} × {Math.round(FACTOR_WEIGHTS.light * 100)}%</span>
              <span className="font-medium text-warm-800 dark:text-warm-100">
                {(lightScore * FACTOR_WEIGHTS.light).toFixed(0)}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t border-warm-200 dark:border-warm-600 font-semibold text-warm-800 dark:text-warm-100">
              <span>Pulse Score</span>
              <span>{pulseScore ?? '--'}</span>
            </div>
          </div>
        </div>
        
        {/* Score thresholds reference */}
        <div className="flex justify-center gap-4 text-xs text-warm-500 dark:text-warm-400">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
            <span>85+ Optimal</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span>60-84 Good</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span>&lt;60 Adjust</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ============ FACTOR CARD ============

interface FactorCardProps {
  icon: typeof Volume2;
  label: string;
  weight: number;
  score: number;
  currentValue: string;
  optimalRange: string;
  insight: { status: 'optimal' | 'warning' | 'critical'; message: string; action?: string };
}

function FactorCard({ icon: Icon, label, weight, score, currentValue, optimalRange, insight }: FactorCardProps) {
  const statusColors = {
    optimal: 'bg-green-500',
    warning: 'bg-amber-500',
    critical: 'bg-red-500',
  };
  
  const statusBg = {
    optimal: 'bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-900/30',
    warning: 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-900/30',
    critical: 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-900/30',
  };
  
  const textColors = {
    optimal: 'text-green-700 dark:text-green-400',
    warning: 'text-amber-700 dark:text-amber-400',
    critical: 'text-red-700 dark:text-red-400',
  };
  
  return (
    <div className={`rounded-xl border p-4 ${statusBg[insight.status]} transition-colors`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-9 h-9 rounded-lg ${
            label === 'Sound Level' ? 'bg-primary/10 dark:bg-primary/20' : 'bg-amber-100 dark:bg-amber-900/30'
          } flex items-center justify-center`}>
            <Icon className={`w-4.5 h-4.5 ${
              label === 'Sound Level' ? 'text-primary' : 'text-amber-600 dark:text-amber-400'
            }`} />
          </div>
          <div>
            <h5 className="text-sm font-semibold text-warm-800 dark:text-warm-100">{label}</h5>
            <span className="text-xs text-warm-500 dark:text-warm-400">{weight}% of score</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-warm-800 dark:text-warm-100">{score}</p>
          <p className="text-xs text-warm-500 dark:text-warm-400">/ 100</p>
        </div>
      </div>
      
      {/* Progress bar */}
      <div className="h-2 bg-warm-200 dark:bg-warm-600 rounded-full overflow-hidden mb-3">
        <motion.div
          className={`h-full rounded-full ${statusColors[insight.status]}`}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.5, delay: 0.1 }}
        />
      </div>
      
      {/* Current vs Optimal */}
      <div className="flex justify-between text-xs mb-3">
        <div>
          <span className="text-warm-500 dark:text-warm-400">Current: </span>
          <span className="font-medium text-warm-700 dark:text-warm-200">{currentValue}</span>
        </div>
        <div>
          <span className="text-warm-500 dark:text-warm-400">Optimal: </span>
          <span className="font-medium text-warm-700 dark:text-warm-200">{optimalRange}</span>
        </div>
      </div>
      
      {/* Insight */}
      <div className={`text-sm ${textColors[insight.status]}`}>
        <p className="font-medium">{insight.message}</p>
        {insight.action && (
          <p className="text-xs mt-1 opacity-80">→ {insight.action}</p>
        )}
      </div>
    </div>
  );
}

// ============ INSIGHT GENERATORS ============

function getSoundInsight(db: number | null, score: number): { status: 'optimal' | 'warning' | 'critical'; message: string; action?: string } {
  if (db === null) {
    return { status: 'warning', message: 'No sound data available', action: 'Check sensor connection' };
  }
  
  if (score >= 85) {
    return { status: 'optimal', message: 'Perfect level for conversation and atmosphere' };
  }
  
  if (db > OPTIMAL_RANGES.sound.max) {
    const diff = db - OPTIMAL_RANGES.sound.max;
    if (diff > 10) {
      return { 
        status: 'critical', 
        message: `${diff.toFixed(0)} dB above optimal — guests can't hear each other`,
        action: 'Lower music volume immediately'
      };
    }
    return { 
      status: 'warning', 
      message: 'Slightly loud — some guests may struggle to chat',
      action: 'Consider lowering music by a few notches'
    };
  }
  
  if (db < OPTIMAL_RANGES.sound.min) {
    return { 
      status: 'warning', 
      message: 'Too quiet — venue feels empty',
      action: 'Increase background music to add energy'
    };
  }
  
  return { status: 'optimal', message: 'Sound level is good' };
}

function getLightInsight(lux: number | null, score: number): { status: 'optimal' | 'warning' | 'critical'; message: string; action?: string } {
  if (lux === null) {
    return { status: 'warning', message: 'No light data available', action: 'Check sensor connection' };
  }
  
  const hour = new Date().getHours();
  const isEvening = hour >= 18 || hour < 4;
  
  if (score >= 85) {
    return { status: 'optimal', message: isEvening ? 'Perfect ambient lighting for evening' : 'Good daytime lighting' };
  }
  
  if (lux > OPTIMAL_RANGES.light.max) {
    if (isEvening) {
      return { 
        status: 'warning', 
        message: 'Too bright for evening ambiance',
        action: 'Dim the lights to create a cozy atmosphere'
      };
    }
    return { status: 'optimal', message: 'Bright, but acceptable for daytime' };
  }
  
  if (lux < OPTIMAL_RANGES.light.min) {
    return { 
      status: 'warning', 
      message: 'Very dim — guests may struggle to read menus',
      action: 'Increase lighting slightly'
    };
  }
  
  return { status: 'optimal', message: 'Lighting is good' };
}

export default PulseBreakdownModal;
