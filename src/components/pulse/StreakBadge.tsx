/**
 * StreakBadge - Shows current streak status
 */

import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import type { Streak } from '../../services/achievements.service';

interface StreakBadgeProps {
  streak: Streak;
  compact?: boolean;
}

export function StreakBadge({ streak, compact = false }: StreakBadgeProps) {
  if (streak.current === 0 && !compact) {
    return null;
  }
  
  const isHot = streak.current >= 7;
  const isWarm = streak.current >= 3;
  
  if (compact) {
    return (
      <div className={`
        inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium
        ${streak.current > 0
          ? isHot 
            ? 'bg-orange-100 text-orange-700' 
            : isWarm 
              ? 'bg-amber-100 text-amber-700' 
              : 'bg-warm-100 text-warm-600'
          : 'bg-warm-100 text-warm-400'
        }
      `}>
        <Flame className={`w-3 h-3 ${streak.current > 0 ? 'text-current' : 'text-warm-400'}`} />
        <span>{streak.current}</span>
      </div>
    );
  }
  
  return (
    <motion.div
      className={`
        p-3 rounded-xl border-2 flex items-center gap-3
        ${isHot 
          ? 'bg-gradient-to-r from-orange-50 to-red-50 border-orange-200' 
          : isWarm 
            ? 'bg-amber-50 border-amber-200' 
            : 'bg-warm-50 border-warm-200'
        }
      `}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      {/* Flame icon */}
      <div className={`
        w-10 h-10 rounded-full flex items-center justify-center
        ${isHot 
          ? 'bg-gradient-to-br from-orange-400 to-red-500' 
          : isWarm 
            ? 'bg-amber-400' 
            : 'bg-warm-300'
        }
      `}>
        <Flame className="w-5 h-5 text-white" />
      </div>
      
      {/* Info */}
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`text-xl font-bold ${isHot ? 'text-orange-600' : isWarm ? 'text-amber-600' : 'text-warm-700'}`}>
            {streak.current}
          </span>
          <span className="text-sm text-warm-500">night streak</span>
        </div>
        <p className="text-xs text-warm-500">
          Above {streak.threshold} Pulse Score
        </p>
      </div>
      
      {/* Best indicator */}
      {streak.current > 0 && streak.current === streak.best && (
        <div className="px-2 py-1 bg-white rounded-lg text-xs font-medium text-amber-600">
          Best!
        </div>
      )}
    </motion.div>
  );
}

export default StreakBadge;
