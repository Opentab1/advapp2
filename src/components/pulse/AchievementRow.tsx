/**
 * AchievementRow - Compact streak + goal in a single row
 * 
 * Expandable to show full details.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Target, ChevronDown, ChevronRight } from 'lucide-react';
import type { Streak, WeeklyGoal } from '../../services/achievements.service';
import { haptic } from '../../utils/haptics';

interface AchievementRowProps {
  streak: Streak;
  goal: WeeklyGoal | null;
  onSetGoal?: () => void;
}

export function AchievementRow({ streak, goal, onSetGoal }: AchievementRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const isHotStreak = streak.current >= 7;
  const isWarmStreak = streak.current >= 3;
  
  const goalProgress = goal ? Math.min(100, Math.round((goal.currentAvg / goal.target) * 100)) : 0;
  const daysLeft = goal ? 7 - goal.daysTracked : 7;
  
  // Show nothing if no streak and no goal
  if (streak.current === 0 && !goal) {
    return (
      <motion.button
        onClick={() => { haptic('light'); onSetGoal?.(); }}
        className="w-full p-3 rounded-xl border-2 border-dashed border-warm-600 flex items-center justify-center gap-2 text-warm-400 hover:border-primary hover:text-primary transition-colors"
        whileTap={{ scale: 0.98 }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Target className="w-5 h-5" />
        <span className="font-medium">Set a Weekly Goal</span>
        <ChevronRight className="w-4 h-4" />
      </motion.button>
    );
  }
  
  return (
    <motion.div
      className="rounded-xl border border-warm-700 bg-warm-800 overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Compact Row */}
      <motion.button
        onClick={() => {
          haptic('light');
          setIsExpanded(!isExpanded);
        }}
        className="w-full p-3 flex items-center gap-4 hover:bg-warm-700/30 transition-colors"
        whileTap={{ scale: 0.99 }}
      >
        {/* Streak */}
        <div className="flex items-center gap-2">
          <div className={`
            w-8 h-8 rounded-full flex items-center justify-center
            ${isHotStreak 
              ? 'bg-gradient-to-br from-orange-400 to-red-500' 
              : isWarmStreak 
                ? 'bg-amber-500' 
                : streak.current > 0
                  ? 'bg-warm-600'
                  : 'bg-warm-700'
            }
          `}>
            <Flame className="w-4 h-4 text-white" />
          </div>
          <div className="text-left">
            <p className={`text-sm font-bold ${
              isHotStreak ? 'text-orange-400' : isWarmStreak ? 'text-amber-400' : 'text-warm-200'
            }`}>
              {streak.current}
            </p>
            <p className="text-[10px] text-warm-500">streak</p>
          </div>
        </div>
        
        {/* Divider */}
        <div className="h-8 w-px bg-warm-700" />
        
        {/* Goal */}
        {goal ? (
          <div className="flex-1 flex items-center gap-3">
            <Target className={`w-5 h-5 ${goal.achieved ? 'text-green-500' : 'text-primary'}`} />
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-warm-200">
                  {goal.currentAvg} <span className="text-warm-500">/ {goal.target}</span>
                </span>
                {goal.achieved && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded-full font-medium">
                    ✓ Done
                  </span>
                )}
              </div>
              <div className="h-1.5 bg-warm-700 rounded-full overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${goal.achieved ? 'bg-green-500' : 'bg-primary'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${goalProgress}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              haptic('light');
              onSetGoal?.();
            }}
            className="flex-1 flex items-center gap-2 text-sm text-warm-400 hover:text-primary transition-colors"
          >
            <Target className="w-4 h-4" />
            <span>Set goal</span>
          </button>
        )}
        
        {/* Expand indicator */}
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="w-4 h-4 text-warm-500" />
        </motion.div>
      </motion.button>
      
      {/* Expanded Details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 border-t border-warm-700 space-y-3">
              {/* Streak details */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-warm-400">Streak threshold</span>
                <span className="text-warm-200">{streak.threshold}+ Pulse Score</span>
              </div>
              {streak.best > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-warm-400">Best streak</span>
                  <span className={`font-medium ${streak.current === streak.best ? 'text-amber-400' : 'text-warm-200'}`}>
                    {streak.best} nights {streak.current === streak.best && '🔥'}
                  </span>
                </div>
              )}
              
              {/* Goal details */}
              {goal && (
                <>
                  <div className="h-px bg-warm-700" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-warm-400">Days tracked</span>
                    <span className="text-warm-200">{goal.daysTracked} of 7</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-warm-400">Days left</span>
                    <span className="text-warm-200">{daysLeft}</span>
                  </div>
                  {!goal.achieved && goal.target - goal.currentAvg > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-warm-400">Points to go</span>
                      <span className="text-primary font-medium">
                        +{goal.target - goal.currentAvg}
                      </span>
                    </div>
                  )}
                </>
              )}
              
              {/* Set goal button if no goal */}
              {!goal && (
                <motion.button
                  onClick={() => { haptic('light'); onSetGoal?.(); }}
                  className="w-full py-2 rounded-lg bg-primary/20 text-primary text-sm font-medium hover:bg-primary/30 transition-colors"
                  whileTap={{ scale: 0.98 }}
                >
                  Set Weekly Goal
                </motion.button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default AchievementRow;
