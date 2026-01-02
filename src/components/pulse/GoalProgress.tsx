/**
 * GoalProgress - Weekly goal progress indicator
 * Dark mode supported.
 */

import { motion } from 'framer-motion';
import { Target, ChevronRight } from 'lucide-react';
import type { WeeklyGoal } from '../../services/achievements.service';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { haptic } from '../../utils/haptics';

interface GoalProgressProps {
  goal: WeeklyGoal | null;
  onSetGoal?: () => void;
}

export function GoalProgress({ goal, onSetGoal }: GoalProgressProps) {
  const handleSetGoal = () => {
    haptic('light');
    onSetGoal?.();
  };
  
  if (!goal) {
    return (
      <motion.button
        onClick={handleSetGoal}
        className="w-full p-3 rounded-xl border-2 border-dashed border-warm-300 dark:border-warm-600 flex items-center justify-center gap-2 text-warm-500 dark:text-warm-400 hover:border-primary hover:text-primary transition-colors"
        whileTap={{ scale: 0.98 }}
      >
        <Target className="w-5 h-5" />
        <span className="font-medium">Set a Weekly Goal</span>
        <ChevronRight className="w-4 h-4" />
      </motion.button>
    );
  }
  
  const progress = Math.min(100, Math.round((goal.currentAvg / goal.target) * 100));
  const daysLeft = 7 - goal.daysTracked;
  
  return (
    <motion.div
      className={`
        p-3 rounded-xl border-2 transition-colors
        ${goal.achieved 
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' 
          : 'bg-warm-50 dark:bg-warm-800 border-warm-200 dark:border-warm-700'
        }
      `}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Target className={`w-5 h-5 ${goal.achieved ? 'text-green-500' : 'text-primary'}`} />
          <span className="font-medium text-warm-800 dark:text-warm-100">Weekly Goal</span>
        </div>
        {goal.achieved ? (
          <motion.span 
            className="px-2 py-0.5 bg-green-500 text-white text-xs font-bold rounded-full"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            ✓ Achieved!
          </motion.span>
        ) : (
          <span className="text-xs text-warm-500 dark:text-warm-400">{daysLeft} days left</span>
        )}
      </div>
      
      {/* Progress bar */}
      <div className="mb-2">
        <div className="flex justify-between text-sm mb-1">
          <AnimatedNumber 
            value={goal.currentAvg || 0} 
            className="font-bold text-warm-800 dark:text-warm-100"
          />
          <span className="text-warm-500 dark:text-warm-400">Target: {goal.target}</span>
        </div>
        <div className="h-2 bg-warm-200 dark:bg-warm-700 rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${goal.achieved ? 'bg-green-500' : 'bg-primary'}`}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>
      
      {/* Status */}
      <p className="text-xs text-warm-500 dark:text-warm-400">
        {goal.achieved
          ? '🎉 Great job! You hit your weekly goal!'
          : goal.daysTracked === 0
            ? 'Start tracking to see your progress'
            : `${goal.daysTracked} days tracked • ${goal.target - goal.currentAvg > 0 ? `${goal.target - goal.currentAvg} points to go` : 'On track!'}`
        }
      </p>
    </motion.div>
  );
}

export default GoalProgress;
