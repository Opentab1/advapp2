/**
 * SmartActionCard - AI-powered action recommendation
 * 
 * Shows:
 * - Action recommendation
 * - Historical context ("This worked last Friday")
 * - What worked before
 * - Confidence level
 */

import { motion } from 'framer-motion';
import { 
  Volume2, Sun, Thermometer, Users, Clock, Music,
  ChevronRight, Sparkles, TrendingUp, History
} from 'lucide-react';
import type { SmartAction } from '../../services/intelligence.service';
import { haptic } from '../../utils/haptics';

interface SmartActionCardProps {
  action: SmartAction;
  onTap?: () => void;
  onComplete?: () => void;
}

const categoryIcons = {
  sound: Volume2,
  light: Sun,
  temperature: Thermometer,
  music: Music,
  crowd: Users,
  timing: Clock,
};

const priorityStyles = {
  critical: {
    bg: 'bg-red-900/30',
    border: 'border-red-800',
    badge: 'bg-red-500 text-white',
    glow: 'shadow-[0_0_20px_rgba(239,68,68,0.2)]',
  },
  high: {
    bg: 'bg-amber-900/20',
    border: 'border-amber-800/50',
    badge: 'bg-amber-500 text-white',
    glow: '',
  },
  medium: {
    bg: 'bg-warm-800',
    border: 'border-warm-700',
    badge: 'bg-warm-600 text-warm-200',
    glow: '',
  },
  low: {
    bg: 'bg-warm-800/50',
    border: 'border-warm-700/50',
    badge: 'bg-warm-700 text-warm-400',
    glow: '',
  },
};

export function SmartActionCard({ action, onTap, onComplete }: SmartActionCardProps) {
  const Icon = categoryIcons[action.category] || Sparkles;
  const style = priorityStyles[action.priority];
  
  const handleTap = () => {
    if (onTap) {
      haptic('light');
      onTap();
    }
  };
  
  const handleComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onComplete) {
      haptic('success');
      onComplete();
    }
  };
  
  return (
    <motion.div
      className={`rounded-2xl border ${style.bg} ${style.border} ${style.glow} overflow-hidden ${
        onTap ? 'cursor-pointer' : ''
      }`}
      onClick={handleTap}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={onTap ? { scale: 0.98 } : undefined}
    >
      {/* Main content */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            action.priority === 'critical' ? 'bg-red-500/20' :
            action.priority === 'high' ? 'bg-amber-500/20' :
            'bg-primary/20'
          }`}>
            <Icon className={`w-5 h-5 ${
              action.priority === 'critical' ? 'text-red-400' :
              action.priority === 'high' ? 'text-amber-400' :
              'text-primary'
            }`} />
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-base font-semibold text-warm-100">{action.title}</h4>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${style.badge}`}>
                {action.priority}
              </span>
            </div>
            
            <p className="text-sm text-warm-300">{action.description}</p>
            
            {/* Values */}
            {(action.currentValue || action.suggestedValue) && (
              <div className="flex items-center gap-2 mt-2 text-xs">
                {action.currentValue && (
                  <span className="text-warm-500">Now: {action.currentValue}</span>
                )}
                {action.currentValue && action.suggestedValue && (
                  <span className="text-warm-600">→</span>
                )}
                {action.suggestedValue && (
                  <span className="text-primary font-medium">Target: {action.suggestedValue}</span>
                )}
              </div>
            )}
          </div>
          
          {onTap && (
            <ChevronRight className="w-5 h-5 text-warm-500 flex-shrink-0" />
          )}
        </div>
        
        {/* Impact */}
        <div className="mt-3 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-green-400" />
          <p className="text-xs text-warm-400">{action.impact}</p>
        </div>
      </div>
      
      {/* Historical context footer */}
      {(action.historicalContext || action.whatWorked) && (
        <div className="px-4 py-3 bg-warm-900/50 border-t border-warm-700/50 space-y-1.5">
          {action.historicalContext && (
            <div className="flex items-center gap-2 text-xs text-warm-400">
              <History className="w-3.5 h-3.5 text-warm-500" />
              <span>{action.historicalContext}</span>
            </div>
          )}
          {action.whatWorked && (
            <div className="flex items-center gap-2 text-xs text-green-400/80">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{action.whatWorked}</span>
            </div>
          )}
          {action.confidence > 0 && (
            <div className="flex items-center gap-1.5 mt-1">
              <div className="h-1 flex-1 bg-warm-700 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-primary rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${action.confidence}%` }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                />
              </div>
              <span className="text-[10px] text-warm-500 w-8">{action.confidence}%</span>
            </div>
          )}
        </div>
      )}
      
      {/* Complete button for inline actions */}
      {onComplete && (
        <motion.button
          className="w-full py-2.5 bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
          onClick={handleComplete}
          whileTap={{ scale: 0.98 }}
        >
          Mark Complete
        </motion.button>
      )}
    </motion.div>
  );
}

// Compact version for lists
export function SmartActionRow({ action, onTap }: { action: SmartAction; onTap?: () => void }) {
  const Icon = categoryIcons[action.category] || Sparkles;
  
  return (
    <motion.div
      className="flex items-center gap-3 p-3 rounded-xl bg-warm-800 border border-warm-700 cursor-pointer hover:bg-warm-700/50 transition-colors"
      onClick={() => { haptic('light'); onTap?.(); }}
      whileTap={{ scale: 0.98 }}
    >
      <Icon className={`w-4 h-4 ${
        action.priority === 'critical' ? 'text-red-400' :
        action.priority === 'high' ? 'text-amber-400' :
        'text-primary'
      }`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-warm-100 truncate">{action.title}</p>
        {action.historicalContext && (
          <p className="text-[10px] text-warm-500 truncate">{action.historicalContext}</p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-warm-500" />
    </motion.div>
  );
}

export default SmartActionCard;
