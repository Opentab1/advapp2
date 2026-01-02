/**
 * ActionHero - The primary action card
 * 
 * Shows the single most important thing to do right now.
 * Includes "See Why" button for data reasoning.
 */

import { motion } from 'framer-motion';
import { CheckCircle, ChevronRight, Target, TrendingUp, Sparkles } from 'lucide-react';
import type { PulseAction } from '../../hooks/useActions';

interface ActionHeroProps {
  action: PulseAction | null;
  onSeeWhy: () => void;
  onComplete: () => void;
  completedCount: number;
}

const PRIORITY_STYLES = {
  critical: {
    gradient: 'from-red-500 to-rose-600',
    bg: 'bg-red-50 border-red-200',
    label: '🚨 Do This Now',
  },
  high: {
    gradient: 'from-amber-500 to-orange-500',
    bg: 'bg-amber-50 border-amber-200',
    label: '⚡ Priority Action',
  },
  medium: {
    gradient: 'from-primary to-blue-600',
    bg: 'bg-primary-50 border-primary-100',
    label: '💡 Recommended',
  },
  low: {
    gradient: 'from-green-500 to-emerald-600',
    bg: 'bg-green-50 border-green-200',
    label: '✨ Nice to Have',
  },
};

export function ActionHero({ action, onSeeWhy, onComplete, completedCount }: ActionHeroProps) {
  // No action needed - show celebration
  if (!action) {
    return <AllSetCard completedCount={completedCount} />;
  }
  
  const style = PRIORITY_STYLES[action.priority];
  const Icon = action.icon;
  
  return (
    <motion.div
      className={`relative overflow-hidden rounded-2xl border-2 ${style.bg}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Priority header */}
      <div className={`bg-gradient-to-r ${style.gradient} px-4 py-2`}>
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-white" />
          <span className="text-sm font-bold text-white uppercase tracking-wide">
            {style.label}
          </span>
        </div>
      </div>
      
      {/* Content */}
      <div className="p-5">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${style.gradient} flex items-center justify-center flex-shrink-0`}>
            <Icon className="w-6 h-6 text-white" />
          </div>
          
          {/* Text */}
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-warm-800 mb-1">{action.title}</h3>
            <p className="text-sm text-warm-600 mb-3">{action.description}</p>
            
            {/* Current → Target */}
            {action.currentValue && action.targetValue && (
              <div className="flex items-center gap-3 mb-3 p-2.5 rounded-lg bg-white/60">
                <div>
                  <p className="text-[10px] text-warm-500 uppercase">Current</p>
                  <p className="text-base font-bold text-warm-800">{action.currentValue}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-warm-400" />
                <div>
                  <p className="text-[10px] text-warm-500 uppercase">Target</p>
                  <p className="text-base font-bold text-green-600">{action.targetValue}</p>
                </div>
              </div>
            )}
            
            {/* Impact */}
            <div className="flex items-center gap-2 text-sm text-warm-600">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <span>{action.impact}</span>
            </div>
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex gap-3 mt-5">
          <motion.button
            onClick={onSeeWhy}
            className="flex-1 py-2.5 rounded-xl bg-white border border-warm-200 text-warm-700 font-medium text-sm hover:bg-warm-50 transition-colors"
            whileTap={{ scale: 0.98 }}
          >
            See Why
          </motion.button>
          <motion.button
            onClick={onComplete}
            className="flex-1 py-2.5 rounded-xl bg-warm-800 text-white font-medium text-sm flex items-center justify-center gap-2 hover:bg-warm-900 transition-colors"
            whileTap={{ scale: 0.98 }}
          >
            <CheckCircle className="w-4 h-4" />
            Done
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

// ============ ALL SET CARD ============

function AllSetCard({ completedCount }: { completedCount: number }) {
  const now = new Date();
  const hour = now.getHours();
  
  let message = { title: 'All Dialed In!', subtitle: 'No actions needed right now', emoji: '👌' };
  
  if (completedCount >= 3) {
    message = { title: "You're Crushing It!", subtitle: `${completedCount} actions completed`, emoji: '🏆' };
  } else if (hour >= 19 && hour < 23) {
    message = { title: 'Peak Performance!', subtitle: "Everything's optimized", emoji: '🔥' };
  } else if (hour >= 16 && hour < 19) {
    message = { title: 'Ready for Tonight!', subtitle: 'Set up for success', emoji: '✨' };
  }
  
  return (
    <motion.div
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-green-400 via-emerald-500 to-teal-500 p-8"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <div className="flex flex-col items-center text-center">
        <motion.div
          className="text-5xl mb-3"
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          {message.emoji}
        </motion.div>
        <h3 className="text-xl font-bold text-white mb-1">{message.title}</h3>
        <p className="text-white/90">{message.subtitle}</p>
      </div>
      
      {/* Decorative sparkles */}
      <Sparkles className="absolute top-4 right-4 w-5 h-5 text-white/30" />
      <Sparkles className="absolute bottom-4 left-4 w-4 h-4 text-white/20" />
    </motion.div>
  );
}

export default ActionHero;
