/**
 * GoalProgress - Weekly goal progress indicator
 */

import { motion } from 'framer-motion';
import { Target, ChevronRight } from 'lucide-react';
import type { WeeklyGoal } from '../../services/achievements.service';

interface GoalProgressProps {
  goal: WeeklyGoal | null;
  onSetGoal?: () => void;
}

export function GoalProgress({ goal, onSetGoal }: GoalProgressProps) {
  if (!goal) {
    return (
      <motion.button
        onClick={onSetGoal}
        className="w-full p-3 rounded-xl border-2 border-dashed border-warm-300 flex items-center justify-center gap-2 text-warm-500 hover:border-primary hover:text-primary transition-colors"
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
        p-3 rounded-xl border-2
        ${goal.achieved 
          ? 'bg-green-50 border-green-200' 
          : 'bg-warm-50 border-warm-200'
        }
      `}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Target className={`w-5 h-5 ${goal.achieved ? 'text-green-500' : 'text-primary'}`} />
          <span className="font-medium text-warm-800">Weekly Goal</span>
        </div>
        {goal.achieved ? (
          <span className="px-2 py-0.5 bg-green-500 text-white text-xs font-bold rounded-full">
            ✓ Achieved!
          </span>
        ) : (
          <span className="text-xs text-warm-500">{daysLeft} days left</span>
        )}
      </div>
      
      {/* Progress bar */}
      <div className="mb-2">
        <div className="flex justify-between text-sm mb-1">
          <span className="font-bold text-warm-800">{goal.currentAvg || '--'}</span>
          <span className="text-warm-500">Target: {goal.target}</span>
        </div>
        <div className="h-2 bg-warm-200 rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${goal.achieved ? 'bg-green-500' : 'bg-primary'}`}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>
      
      {/* Status */}
      <p className="text-xs text-warm-500">
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
