/**
 * UnifiedActions - Single consolidated action section
 * 
 * Merges:
 * - ActionHero (main action)
 * - ActionQueue (remaining basic actions)
 * - SmartActions (AI-powered with historical context)
 * 
 * Shows one hero action + expandable queue of all remaining actions.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CheckCircle, ChevronRight, ChevronDown, Target, TrendingUp, 
  Sparkles, History, Brain, Volume2, Sun, Users, Clock, Music, Thermometer
} from 'lucide-react';
import type { PulseAction } from '../../hooks/useActions';
import type { SmartAction } from '../../services/intelligence.service';
import { haptic } from '../../utils/haptics';

// ============ TYPES ============

interface UnifiedActionsProps {
  // Basic actions from useActions
  heroAction: PulseAction | null;
  remainingActions: PulseAction[];
  completedCount: number;
  onComplete: (actionId: string) => void;
  onSeeWhy: (action: PulseAction) => void;
  
  // AI-powered actions from useIntelligence
  smartActions: SmartAction[];
}

type UnifiedAction = {
  id: string;
  type: 'basic' | 'smart';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impact: string;
  icon: any;
  // Basic action fields
  currentValue?: string;
  targetValue?: string;
  reasoning?: string[];
  // Smart action fields
  confidence?: number;
  historicalContext?: string;
  whatWorked?: string;
  suggestedValue?: string;
};

// ============ MAIN COMPONENT ============

export function UnifiedActions({
  heroAction,
  remainingActions,
  completedCount,
  onComplete,
  onSeeWhy,
  smartActions,
}: UnifiedActionsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Merge and deduplicate actions
  const allActions = mergeActions(heroAction, remainingActions, smartActions);
  const hero = allActions[0] || null;
  const queue = allActions.slice(1);
  
  // No actions - show all clear state
  if (!hero) {
    return <AllClearCard completedCount={completedCount} />;
  }
  
  return (
    <div className="space-y-3">
      {/* Hero Action */}
      <HeroCard 
        action={hero} 
        onComplete={() => {
          haptic('success');
          onComplete(hero.id);
        }}
        onSeeWhy={() => {
          if (hero.type === 'basic' && heroAction) {
            onSeeWhy(heroAction);
          }
        }}
      />
      
      {/* Queue Toggle */}
      {queue.length > 0 && (
        <motion.button
          onClick={() => {
            haptic('light');
            setIsExpanded(!isExpanded);
          }}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-warm-800 border border-warm-700 hover:bg-warm-700/50 transition-colors"
          whileTap={{ scale: 0.98 }}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-warm-300">
              {queue.length} more action{queue.length > 1 ? 's' : ''}
            </span>
            {queue.some(a => a.type === 'smart') && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-400">
                AI
              </span>
            )}
          </div>
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown className="w-4 h-4 text-warm-400" />
          </motion.div>
        </motion.button>
      )}
      
      {/* Expanded Queue */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-2">
              {queue.slice(0, 5).map((action, index) => (
                <QueueItem
                  key={action.id}
                  action={action}
                  index={index}
                  onComplete={() => {
                    haptic('success');
                    onComplete(action.id);
                  }}
                />
              ))}
              {queue.length > 5 && (
                <p className="text-xs text-warm-500 text-center py-2">
                  +{queue.length - 5} more
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============ HERO CARD ============

const PRIORITY_STYLES = {
  critical: {
    gradient: 'from-red-500 to-rose-600',
    bg: 'bg-red-900/20 border-red-800',
    label: '🚨 Do This Now',
  },
  high: {
    gradient: 'from-amber-500 to-orange-500',
    bg: 'bg-amber-900/20 border-amber-800',
    label: '⚡ Priority',
  },
  medium: {
    gradient: 'from-primary to-blue-600',
    bg: 'bg-primary/10 border-primary/30',
    label: '💡 Recommended',
  },
  low: {
    gradient: 'from-green-500 to-emerald-600',
    bg: 'bg-green-900/20 border-green-800',
    label: '✨ Nice to Have',
  },
};

interface HeroCardProps {
  action: UnifiedAction;
  onComplete: () => void;
  onSeeWhy: () => void;
}

function HeroCard({ action, onComplete, onSeeWhy }: HeroCardProps) {
  const style = PRIORITY_STYLES[action.priority];
  const Icon = action.icon;
  
  return (
    <motion.div
      className={`relative overflow-hidden rounded-2xl border-2 ${style.bg}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Priority header */}
      <div className={`bg-gradient-to-r ${style.gradient} px-4 py-2 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-white" />
          <span className="text-sm font-bold text-white uppercase tracking-wide">
            {style.label}
          </span>
        </div>
        {action.type === 'smart' && (
          <div className="flex items-center gap-1 text-white/80 text-xs">
            <Brain className="w-3 h-3" />
            <span>AI</span>
          </div>
        )}
      </div>
      
      {/* Content */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${style.gradient} flex items-center justify-center flex-shrink-0 shadow-lg`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          
          {/* Text */}
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-warm-100 mb-1">{action.title}</h3>
            <p className="text-sm text-warm-400">{action.description}</p>
          </div>
        </div>
        
        {/* Values (current → target) */}
        {(action.currentValue || action.suggestedValue) && (
          <div className="flex items-center gap-3 mt-3 p-2.5 rounded-lg bg-warm-800/60">
            {action.currentValue && (
              <div>
                <p className="text-[10px] text-warm-500 uppercase">Now</p>
                <p className="text-sm font-bold text-warm-100">{action.currentValue}</p>
              </div>
            )}
            <ChevronRight className="w-4 h-4 text-warm-500" />
            <div>
              <p className="text-[10px] text-warm-500 uppercase">Target</p>
              <p className="text-sm font-bold text-green-400">
                {action.targetValue || action.suggestedValue}
              </p>
            </div>
          </div>
        )}
        
        {/* Historical context (smart actions only) */}
        {action.historicalContext && (
          <div className="mt-3 p-2.5 rounded-lg bg-warm-800/40 border border-warm-700/50">
            <div className="flex items-center gap-2 text-xs text-warm-400">
              <History className="w-3.5 h-3.5 text-warm-500" />
              <span>{action.historicalContext}</span>
            </div>
            {action.whatWorked && (
              <div className="flex items-center gap-2 text-xs text-green-400/80 mt-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>{action.whatWorked}</span>
              </div>
            )}
          </div>
        )}
        
        {/* Impact */}
        <div className="flex items-center gap-2 mt-3 text-sm text-warm-400">
          <TrendingUp className="w-4 h-4 text-green-500" />
          <span>{action.impact}</span>
        </div>
        
        {/* Confidence bar (smart actions) */}
        {action.confidence && action.confidence > 0 && (
          <div className="flex items-center gap-2 mt-3">
            <div className="flex-1 h-1.5 bg-warm-700 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${action.confidence}%` }}
                transition={{ duration: 0.5, delay: 0.2 }}
              />
            </div>
            <span className="text-[10px] text-warm-500">{action.confidence}% confidence</span>
          </div>
        )}
        
        {/* Action buttons */}
        <div className="flex gap-3 mt-4">
          {action.type === 'basic' && action.reasoning && action.reasoning.length > 0 && (
            <motion.button
              onClick={onSeeWhy}
              className="flex-1 py-2.5 rounded-xl bg-warm-700 border border-warm-600 text-warm-200 font-medium text-sm hover:bg-warm-600 transition-colors"
              whileTap={{ scale: 0.98 }}
            >
              See Why
            </motion.button>
          )}
          <motion.button
            onClick={onComplete}
            className={`${action.type === 'basic' && action.reasoning?.length ? 'flex-1' : 'w-full'} py-2.5 rounded-xl bg-white text-warm-900 font-medium text-sm flex items-center justify-center gap-2 hover:bg-warm-100 transition-colors`}
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

// ============ QUEUE ITEM ============

const PRIORITY_DOT_COLORS = {
  critical: 'bg-red-500',
  high: 'bg-amber-500',
  medium: 'bg-primary',
  low: 'bg-green-500',
};

interface QueueItemProps {
  action: UnifiedAction;
  index: number;
  onComplete: () => void;
}

function QueueItem({ action, index, onComplete }: QueueItemProps) {
  const Icon = action.icon;
  
  return (
    <motion.div
      className="p-3 rounded-xl border border-warm-700 bg-warm-800 flex items-center gap-3"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      {/* Icon */}
      <div className="w-9 h-9 rounded-lg bg-warm-700 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-warm-300" />
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT_COLORS[action.priority]}`} />
          <p className="text-sm font-medium text-warm-100 truncate">{action.title}</p>
          {action.type === 'smart' && (
            <Brain className="w-3 h-3 text-purple-400 flex-shrink-0" />
          )}
        </div>
        {action.historicalContext ? (
          <p className="text-[10px] text-warm-500 truncate">{action.historicalContext}</p>
        ) : (
          <p className="text-xs text-warm-400 truncate">{action.description}</p>
        )}
      </div>
      
      {/* Complete button */}
      <motion.button
        onClick={onComplete}
        className="p-2 rounded-lg bg-warm-700 hover:bg-warm-600 transition-colors flex-shrink-0"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Mark as done"
      >
        <CheckCircle className="w-5 h-5 text-warm-400" />
      </motion.button>
    </motion.div>
  );
}

// ============ ALL CLEAR CARD ============

function AllClearCard({ completedCount }: { completedCount: number }) {
  const now = new Date();
  const hour = now.getHours();
  
  let message = { title: 'All Dialed In!', subtitle: 'No actions needed', emoji: '👌' };
  
  if (completedCount >= 3) {
    message = { title: "You're Crushing It!", subtitle: `${completedCount} actions done`, emoji: '🏆' };
  } else if (hour >= 19 && hour < 23) {
    message = { title: 'Peak Performance!', subtitle: "Everything's optimized", emoji: '🔥' };
  } else if (hour >= 16 && hour < 19) {
    message = { title: 'Ready for Tonight!', subtitle: 'Set up for success', emoji: '✨' };
  }
  
  return (
    <motion.div
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-green-400 via-emerald-500 to-teal-500 p-6"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <div className="flex items-center gap-4">
        <motion.div
          className="text-4xl"
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          {message.emoji}
        </motion.div>
        <div>
          <h3 className="text-lg font-bold text-white">{message.title}</h3>
          <p className="text-white/90 text-sm">{message.subtitle}</p>
        </div>
      </div>
      <Sparkles className="absolute top-3 right-3 w-5 h-5 text-white/30" />
    </motion.div>
  );
}

// ============ HELPER: MERGE ACTIONS ============

const categoryIcons: Record<string, any> = {
  sound: Volume2,
  light: Sun,
  temperature: Thermometer,
  music: Music,
  crowd: Users,
  timing: Clock,
  occupancy: Users,
  general: Sparkles,
};

function mergeActions(
  heroAction: PulseAction | null,
  remainingActions: PulseAction[],
  smartActions: SmartAction[]
): UnifiedAction[] {
  const unified: UnifiedAction[] = [];
  const seenIds = new Set<string>();
  
  // Convert basic actions
  const basicActions = heroAction ? [heroAction, ...remainingActions] : remainingActions;
  for (const action of basicActions) {
    if (seenIds.has(action.id)) continue;
    seenIds.add(action.id);
    
    unified.push({
      id: action.id,
      type: 'basic',
      priority: action.priority,
      title: action.title,
      description: action.description,
      impact: action.impact,
      icon: action.icon,
      currentValue: action.currentValue,
      targetValue: action.targetValue,
      reasoning: action.reasoning,
    });
  }
  
  // Convert and merge smart actions (avoid duplicates based on category)
  const basicCategories = new Set(basicActions.map(a => a.category));
  for (const action of smartActions) {
    // Skip if we already have a basic action for this category
    if (basicCategories.has(action.category as any)) continue;
    if (seenIds.has(action.id)) continue;
    seenIds.add(action.id);
    
    unified.push({
      id: action.id,
      type: 'smart',
      priority: action.priority,
      title: action.title,
      description: action.description,
      impact: action.impact,
      icon: categoryIcons[action.category] || Sparkles,
      currentValue: action.currentValue,
      suggestedValue: action.suggestedValue,
      confidence: action.confidence,
      historicalContext: action.historicalContext,
      whatWorked: action.whatWorked,
    });
  }
  
  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  unified.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  
  return unified;
}

export default UnifiedActions;
