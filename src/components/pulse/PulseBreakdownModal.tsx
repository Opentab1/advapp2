/**
 * PulseBreakdownModal - Detailed Pulse Score breakdown
 * 
 * Shows:
 * - Overall score with status
 * - Factor breakdown (sound, light)
 * - Calculation formula
 * - Historical comparison
 */

import { motion } from 'framer-motion';
import { Modal } from '../common/Modal';
import { Volume2, Sun, Info } from 'lucide-react';
import { OPTIMAL_RANGES, FACTOR_WEIGHTS } from '../../utils/constants';

interface PulseBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  pulseScore: number | null;
  pulseStatusLabel: string;
  soundScore: number;
  lightScore: number;
  currentDecibels: number | null;
  currentLight: number | null;
  historicalComparison?: {
    lastWeekScore: number;
    difference: number;
    mainFactor: string;
  } | null;
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
  historicalComparison,
}: PulseBreakdownModalProps) {
  const statusBg = pulseScore !== null && pulseScore >= 85 
    ? 'bg-green-50 text-green-700 border-green-200' 
    : pulseScore !== null && pulseScore >= 60 
      ? 'bg-amber-50 text-amber-700 border-amber-200' 
      : 'bg-red-50 text-red-700 border-red-200';
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Pulse Score Breakdown">
      <div className="space-y-5">
        {/* Main Score */}
        <div className="text-center py-4">
          <p className="text-5xl font-bold text-warm-800">{pulseScore ?? '--'}</p>
          <p className={`inline-block mt-2 px-3 py-1 rounded-full text-sm font-medium border ${statusBg}`}>
            {pulseStatusLabel}
          </p>
        </div>
        
        {/* Factors */}
        <div className="space-y-3">
          <h4 className="text-xs text-warm-500 uppercase tracking-wide font-medium">
            Factor Breakdown
          </h4>
          
          {/* Sound */}
          <FactorRow
            icon={Volume2}
            label="Sound"
            weight={`${Math.round(FACTOR_WEIGHTS.sound * 100)}%`}
            score={soundScore}
            current={currentDecibels !== null ? `${currentDecibels.toFixed(1)} dB` : '--'}
            optimal={`${OPTIMAL_RANGES.sound.min}-${OPTIMAL_RANGES.sound.max} dB`}
          />
          
          {/* Light */}
          <FactorRow
            icon={Sun}
            label="Light"
            weight={`${Math.round(FACTOR_WEIGHTS.light * 100)}%`}
            score={lightScore}
            current={currentLight !== null ? `${currentLight.toFixed(0)} lux` : '--'}
            optimal={`${OPTIMAL_RANGES.light.min}-${OPTIMAL_RANGES.light.max} lux`}
          />
        </div>
        
        {/* Calculation */}
        <div className="p-3 rounded-xl bg-warm-50 border border-warm-200">
          <p className="text-xs text-warm-500 mb-2 flex items-center gap-1">
            <Info className="w-3 h-3" />
            How it's calculated
          </p>
          <div className="font-mono text-sm space-y-1">
            <div className="flex justify-between text-warm-600">
              <span>Sound: {soundScore} × {Math.round(FACTOR_WEIGHTS.sound * 100)}%</span>
              <span className="text-warm-800">{(soundScore * FACTOR_WEIGHTS.sound).toFixed(1)}</span>
            </div>
            <div className="flex justify-between text-warm-600">
              <span>Light: {lightScore} × {Math.round(FACTOR_WEIGHTS.light * 100)}%</span>
              <span className="text-warm-800">{(lightScore * FACTOR_WEIGHTS.light).toFixed(1)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-warm-200 font-bold text-warm-800">
              <span>Total</span>
              <span>{pulseScore ?? '--'}</span>
            </div>
          </div>
        </div>
        
        {/* Historical Comparison */}
        {historicalComparison && (
          <div className="p-3 rounded-xl bg-primary-50 border border-primary-100">
            <p className="text-sm text-primary-700">
              <strong>Last week at this time:</strong> {historicalComparison.lastWeekScore}
              {historicalComparison.difference !== 0 && (
                <span className={historicalComparison.difference > 0 ? 'text-green-600' : 'text-red-600'}>
                  {' '}({historicalComparison.difference > 0 ? '+' : ''}{historicalComparison.difference})
                </span>
              )}
            </p>
            {historicalComparison.mainFactor && (
              <p className="text-xs text-primary-600 mt-1">
                Main difference: {historicalComparison.mainFactor}
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ============ FACTOR ROW ============

interface FactorRowProps {
  icon: typeof Volume2;
  label: string;
  weight: string;
  score: number;
  current: string;
  optimal: string;
}

function FactorRow({ icon: Icon, label, weight, score, current, optimal }: FactorRowProps) {
  const barColor = score >= 85 ? 'bg-green-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500';
  const iconBg = label === 'Sound' ? 'bg-primary/10' : 'bg-amber-500/10';
  const iconColor = label === 'Sound' ? 'text-primary' : 'text-amber-500';
  
  return (
    <div className="p-3 rounded-xl bg-warm-50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}>
            <Icon className={`w-4 h-4 ${iconColor}`} />
          </div>
          <div>
            <span className="text-sm font-medium text-warm-800">{label}</span>
            <span className="text-xs text-warm-500 ml-1">({weight})</span>
          </div>
        </div>
        <span className="text-lg font-bold text-warm-800">{score}</span>
      </div>
      
      <div className="flex justify-between text-xs text-warm-500 mb-2">
        <span>Current: {current}</span>
        <span>Optimal: {optimal}</span>
      </div>
      
      <div className="h-1.5 bg-warm-200 rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${barColor}`}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </div>
  );
}

export default PulseBreakdownModal;
