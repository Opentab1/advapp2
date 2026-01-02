/**
 * DwellBreakdownModal - Deep dive into guest dwell time
 * 
 * Shows:
 * - Average time guests stay
 * - What category that falls into
 * - WHY it matters for revenue
 * - How to improve it
 */

import { motion } from 'framer-motion';
import { Modal } from '../common/Modal';
import { Clock, DollarSign, TrendingUp, Lightbulb, AlertTriangle } from 'lucide-react';
import { getDwellTimeCategory, formatDwellTime, getDwellTimeScore } from '../../utils/scoring';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { DWELL_TIME_THRESHOLDS } from '../../utils/constants';

interface DwellBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  dwellTimeMinutes: number | null;
}

export function DwellBreakdownModal({
  isOpen,
  onClose,
  dwellTimeMinutes,
}: DwellBreakdownModalProps) {
  const category = getDwellTimeCategory(dwellTimeMinutes);
  const formatted = formatDwellTime(dwellTimeMinutes);
  const score = getDwellTimeScore(dwellTimeMinutes);
  
  const categoryConfig = {
    excellent: { 
      color: 'text-green-600 dark:text-green-400',
      bg: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', 
      icon: '🎯',
      label: 'Excellent',
      message: 'Guests love staying here — your atmosphere is working.',
      tip: null
    },
    good: { 
      color: 'text-primary',
      bg: 'bg-primary/10 dark:bg-primary/20 border-primary/20', 
      icon: '👍',
      label: 'Good',
      message: 'Solid dwell time. Small atmosphere tweaks could push it higher.',
      tip: 'Try dimming lights slightly during peak hours to encourage lingering.'
    },
    fair: { 
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800', 
      icon: '⚠️',
      label: 'Fair',
      message: 'Guests are leaving earlier than ideal. This hurts per-guest revenue.',
      tip: 'Check if sound is too loud (70-78 dB optimal) — guests leave faster when they can\'t chat.'
    },
    poor: { 
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', 
      icon: '📉',
      label: 'Needs Work',
      message: 'Low dwell time means guests aren\'t comfortable. Time to investigate.',
      tip: 'Review sound levels, lighting, and temperature. Also check service speed.'
    },
    unknown: { 
      color: 'text-warm-500',
      bg: 'bg-warm-50 dark:bg-warm-700/50 border-warm-200 dark:border-warm-700', 
      icon: '❓',
      label: 'No Data',
      message: 'Not enough entry/exit data to calculate average dwell time.',
      tip: 'Make sure your door sensors are connected and working.'
    },
  };
  
  const config = categoryConfig[category as keyof typeof categoryConfig] || categoryConfig.unknown;
  
  // Revenue impact calculation (rough estimate)
  const avgSpendPerMinute = 0.25; // ~$15/hour assumption
  const revenueImpact = dwellTimeMinutes !== null ? Math.round(dwellTimeMinutes * avgSpendPerMinute) : null;
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Dwell Time">
      <div className="space-y-6">
        {/* Hero Value */}
        <div className="text-center py-6 bg-warm-50 dark:bg-warm-700/50 rounded-2xl -mx-2">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Clock className="w-8 h-8 text-primary" />
            <span className="text-5xl font-bold text-warm-800 dark:text-warm-100">{formatted}</span>
          </div>
          <p className="text-sm text-warm-500 dark:text-warm-400">average time guests stay</p>
          
          {/* Score bar */}
          {dwellTimeMinutes !== null && (
            <div className="mt-4 mx-6">
              <div className="flex justify-between text-xs text-warm-500 dark:text-warm-400 mb-1">
                <span>Score</span>
                <span>{score}/100</span>
              </div>
              <div className="h-2 bg-warm-200 dark:bg-warm-600 rounded-full overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${
                    score >= 80 ? 'bg-green-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  initial={{ width: 0 }}
                  animate={{ width: `${score}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            </div>
          )}
        </div>
        
        {/* Category Badge + Message */}
        <div className={`p-4 rounded-xl border ${config.bg}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{config.icon}</span>
            <span className={`font-semibold ${config.color}`}>{config.label}</span>
          </div>
          <p className="text-sm text-warm-700 dark:text-warm-200">{config.message}</p>
          
          {config.tip && (
            <div className="mt-3 flex items-start gap-2 text-sm">
              <Lightbulb className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <span className="text-warm-600 dark:text-warm-300">{config.tip}</span>
            </div>
          )}
        </div>
        
        {/* Why It Matters */}
        <div className="bg-primary/5 dark:bg-primary/10 rounded-xl p-4 border border-primary/10 dark:border-primary/20">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="w-5 h-5 text-primary" />
            <h4 className="text-sm font-semibold text-warm-800 dark:text-warm-100">Why It Matters</h4>
          </div>
          <p className="text-sm text-warm-600 dark:text-warm-300 mb-3">
            Every extra 10 minutes a guest stays = roughly $2-3 more in sales. 
            {dwellTimeMinutes !== null && revenueImpact !== null && (
              <span className="block mt-1 font-medium text-primary">
                At {formatted} avg, that's ~${revenueImpact} per guest.
              </span>
            )}
          </p>
        </div>
        
        {/* What Affects Dwell Time */}
        <div>
          <h4 className="text-xs font-semibold text-warm-500 dark:text-warm-400 uppercase tracking-wide mb-3">
            What Affects Dwell Time?
          </h4>
          <div className="space-y-2">
            <FactorItem 
              color="bg-primary" 
              title="Sound Level" 
              desc="Too loud = guests can't talk = they leave" 
              optimal="70-78 dB"
            />
            <FactorItem 
              color="bg-amber-500" 
              title="Lighting" 
              desc="Evening needs dimmer, cozy lights" 
              optimal="50-350 lux"
            />
            <FactorItem 
              color="bg-green-500" 
              title="Service Speed" 
              desc="Fast refills keep people drinking" 
              optimal="< 5 min"
            />
            <FactorItem 
              color="bg-red-500" 
              title="Temperature" 
              desc="Too hot or cold = discomfort" 
              optimal="68-74°F"
            />
          </div>
        </div>
        
        {/* Thresholds Reference */}
        <div className="text-xs text-warm-400 dark:text-warm-500 text-center py-2 border-t border-warm-100 dark:border-warm-700">
          Excellent: {DWELL_TIME_THRESHOLDS.excellent}+ min • 
          Good: {DWELL_TIME_THRESHOLDS.good}-{DWELL_TIME_THRESHOLDS.excellent} min • 
          Fair: {DWELL_TIME_THRESHOLDS.fair}-{DWELL_TIME_THRESHOLDS.good} min
        </div>
      </div>
    </Modal>
  );
}

// ============ FACTOR ITEM ============

function FactorItem({ color, title, desc, optimal }: { color: string; title: string; desc: string; optimal: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-warm-50 dark:bg-warm-700/50">
      <div className={`w-2 h-2 rounded-full ${color} mt-1.5 flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-warm-800 dark:text-warm-100">{title}</span>
          <span className="text-xs text-warm-400 dark:text-warm-500">{optimal}</span>
        </div>
        <p className="text-xs text-warm-500 dark:text-warm-400 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

export default DwellBreakdownModal;
