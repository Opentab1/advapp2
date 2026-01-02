/**
 * ActionQueue - List of remaining actions
 * 
 * Shows additional actions after the hero action.
 * Compact cards that can be completed individually.
 */

import { motion } from 'framer-motion';
import { CheckCircle } from 'lucide-react';
import type { PulseAction } from '../../hooks/useActions';

interface ActionQueueProps {
  actions: PulseAction[];
  onComplete: (actionId: string) => void;
  maxVisible?: number;
}

const PRIORITY_DOT_COLORS = {
  critical: 'bg-red-500',
  high: 'bg-amber-500',
  medium: 'bg-primary',
  low: 'bg-green-500',
};

const PRIORITY_BG_COLORS = {
  critical: 'border-red-200 bg-red-50',
  high: 'border-amber-200 bg-amber-50',
  medium: 'border-warm-200 bg-warm-50',
  low: 'border-green-200 bg-green-50',
};

export function ActionQueue({ actions, onComplete, maxVisible = 3 }: ActionQueueProps) {
  if (actions.length === 0) return null;
  
  const visibleActions = actions.slice(0, maxVisible);
  const hiddenCount = actions.length - maxVisible;
  
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-warm-800">Up Next</h3>
        <span className="text-sm text-warm-500">{actions.length} more</span>
      </div>
      
      <div className="space-y-2">
        {visibleActions.map((action, index) => (
          <ActionQueueItem
            key={action.id}
            action={action}
            index={index}
            onComplete={() => onComplete(action.id)}
          />
        ))}
        
        {hiddenCount > 0 && (
          <p className="text-xs text-warm-400 text-center pt-1">
            +{hiddenCount} more action{hiddenCount > 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  );
}

interface ActionQueueItemProps {
  action: PulseAction;
  index: number;
  onComplete: () => void;
}

function ActionQueueItem({ action, index, onComplete }: ActionQueueItemProps) {
  const Icon = action.icon;
  
  return (
    <motion.div
      className={`p-3 rounded-xl border ${PRIORITY_BG_COLORS[action.priority]} flex items-center gap-3`}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      {/* Icon */}
      <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-warm-600" />
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT_COLORS[action.priority]}`} />
          <p className="text-sm font-medium text-warm-800 truncate">{action.title}</p>
        </div>
        <p className="text-xs text-warm-500 truncate">{action.description}</p>
      </div>
      
      {/* Complete button */}
      <motion.button
        onClick={onComplete}
        className="p-2 rounded-lg bg-white hover:bg-warm-100 transition-colors flex-shrink-0"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        aria-label="Mark as done"
      >
        <CheckCircle className="w-5 h-5 text-warm-400" />
      </motion.button>
    </motion.div>
  );
}

export default ActionQueue;
