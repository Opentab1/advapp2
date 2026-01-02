/**
 * GoalSetterModal - Set weekly goal target
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Target } from 'lucide-react';

interface GoalSetterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSetGoal: (target: number) => void;
  currentTarget?: number;
}

const PRESET_GOALS = [75, 80, 85, 90];

export function GoalSetterModal({ isOpen, onClose, onSetGoal, currentTarget }: GoalSetterModalProps) {
  const [target, setTarget] = useState(currentTarget || 80);
  
  const handleSubmit = () => {
    onSetGoal(target);
    onClose();
  };
  
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-warm-900/50 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-warm-200">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-bold text-warm-800">Set Weekly Goal</h3>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-warm-100 transition-colors"
              >
                <X className="w-5 h-5 text-warm-400" />
              </button>
            </div>
            
            {/* Content */}
            <div className="p-5 space-y-5">
              <p className="text-sm text-warm-600">
                Set a target average Pulse Score to aim for this week. You'll see your progress on the Pulse tab.
              </p>
              
              {/* Preset buttons */}
              <div>
                <p className="text-xs text-warm-500 uppercase tracking-wide mb-2 font-medium">
                  Quick Select
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {PRESET_GOALS.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setTarget(preset)}
                      className={`
                        py-2 rounded-lg text-sm font-medium transition-colors
                        ${target === preset
                          ? 'bg-primary text-white'
                          : 'bg-warm-100 text-warm-600 hover:bg-warm-200'
                        }
                      `}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Slider */}
              <div>
                <p className="text-xs text-warm-500 uppercase tracking-wide mb-2 font-medium">
                  Custom Target
                </p>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={50}
                    max={100}
                    value={target}
                    onChange={(e) => setTarget(Number(e.target.value))}
                    className="flex-1 h-2 bg-warm-200 rounded-full appearance-none cursor-pointer accent-primary"
                  />
                  <div className="w-16 text-center">
                    <span className="text-2xl font-bold text-warm-800">{target}</span>
                  </div>
                </div>
              </div>
              
              {/* Difficulty indicator */}
              <div className={`
                p-3 rounded-xl text-sm
                ${target >= 90 
                  ? 'bg-red-50 text-red-700' 
                  : target >= 85 
                    ? 'bg-amber-50 text-amber-700' 
                    : target >= 80 
                      ? 'bg-primary-50 text-primary-700' 
                      : 'bg-green-50 text-green-700'
                }
              `}>
                {target >= 90 
                  ? '🔥 Ambitious! This will require consistently optimal conditions.'
                  : target >= 85 
                    ? '💪 Challenging but achievable with focus.'
                    : target >= 80 
                      ? '👍 A solid goal that pushes you forward.'
                      : '✅ A comfortable goal to build consistency.'
                }
              </div>
            </div>
            
            {/* Footer */}
            <div className="px-5 pb-5">
              <button
                onClick={handleSubmit}
                className="w-full py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary-dark transition-colors"
              >
                Set Goal: {target} Avg Pulse Score
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default GoalSetterModal;
