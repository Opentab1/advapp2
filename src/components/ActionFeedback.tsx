/**
 * ActionFeedback - Provides the feedback loop when completing actions
 * 
 * Addresses the "Feedback Loop is Missing" problem:
 * - Shows before/after comparison with real metrics
 * - Celebrates measurable improvements
 * - Tracks action history with impact data
 * - Provides dopamine hit on completion
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, 
  CheckCircle,
  TrendingUp,
  TrendingDown,
  Volume2,
  Sun,
  Users,
  Clock,
  Zap,
  ArrowRight,
  PartyPopper,
  Target
} from 'lucide-react';

// ============ TYPES ============

export interface ActionSnapshot {
  actionId: string;
  actionTitle: string;
  actionCategory: 'sound' | 'light' | 'occupancy' | 'timing' | 'general';
  timestamp: number; // when action was first shown
  metrics: {
    decibels: number | null;
    light: number | null;
    pulseScore: number | null;
    occupancy: number | null;
  };
}

export interface CompletedAction {
  actionId: string;
  actionTitle: string;
  actionCategory: 'sound' | 'light' | 'occupancy' | 'timing' | 'general';
  startedAt: number;
  completedAt: number;
  beforeMetrics: ActionSnapshot['metrics'];
  afterMetrics: ActionSnapshot['metrics'];
  improvement: {
    primary: { label: string; before: string; after: string; improved: boolean; } | null;
    pulseChange: number;
  };
}

interface ActionCelebrationProps {
  isOpen: boolean;
  onClose: () => void;
  action: CompletedAction | null;
}

interface ActionHistoryProps {
  completedActions: CompletedAction[];
}

// ============ ACTION CELEBRATION MODAL ============

export function ActionCelebration({ isOpen, onClose, action }: ActionCelebrationProps) {
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (isOpen && action) {
      // Show confetti for significant improvements
      if (action.improvement.pulseChange > 5 || action.improvement.primary?.improved) {
        setShowConfetti(true);
        const timer = setTimeout(() => setShowConfetti(false), 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [isOpen, action]);

  if (!isOpen || !action) return null;

  const hasImprovement = action.improvement.pulseChange > 0 || (action.improvement.primary?.improved ?? false);
  const timeTaken = Math.round((action.completedAt - action.startedAt) / 60000); // minutes

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-warm-900/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.8, opacity: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden border border-warm-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Confetti animation (CSS-based) */}
          {showConfetti && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {[...Array(20)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-2 h-2 rounded-full"
                  style={{
                    left: `${Math.random() * 100}%`,
                    backgroundColor: ['#22C55E', '#F59E0B', '#3B82F6', '#EC4899'][Math.floor(Math.random() * 4)],
                  }}
                  initial={{ y: -20, opacity: 1 }}
                  animate={{ 
                    y: 400, 
                    opacity: 0,
                    x: (Math.random() - 0.5) * 100,
                    rotate: Math.random() * 720,
                  }}
                  transition={{ 
                    duration: 2 + Math.random(), 
                    delay: Math.random() * 0.5,
                    ease: 'easeOut'
                  }}
                />
              ))}
            </div>
          )}

          {/* Header */}
          <div className={`relative px-6 py-8 text-center ${
            hasImprovement 
              ? 'bg-gradient-to-br from-green-400 to-emerald-500' 
              : 'bg-gradient-to-br from-warm-400 to-warm-500'
          }`}>
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 0.5 }}
            >
              {hasImprovement ? (
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/20 mb-4">
                  <PartyPopper className="w-8 h-8 text-white" />
                </div>
              ) : (
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/20 mb-4">
                  <CheckCircle className="w-8 h-8 text-white" />
                </div>
              )}
            </motion.div>
            <h2 className="text-xl font-bold text-white mb-1">
              {hasImprovement ? 'Nice Work!' : 'Action Completed'}
            </h2>
            <p className="text-white/90">{action.actionTitle}</p>
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 p-1 rounded-lg hover:bg-white/20 transition-colors"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Before/After Comparison */}
          <div className="p-6">
            {action.improvement.primary && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="mb-6"
              >
                <p className="text-sm text-warm-500 mb-3 text-center">Impact</p>
                <div className="flex items-center justify-center gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-warm-400 line-through">
                      {action.improvement.primary.before}
                    </p>
                    <p className="text-xs text-warm-400">Before</p>
                  </div>
                  <ArrowRight className={`w-6 h-6 ${
                    action.improvement.primary.improved ? 'text-green-500' : 'text-warm-400'
                  }`} />
                  <div className="text-center">
                    <p className={`text-2xl font-bold ${
                      action.improvement.primary.improved ? 'text-green-600' : 'text-warm-600'
                    }`}>
                      {action.improvement.primary.after}
                    </p>
                    <p className="text-xs text-warm-500">After</p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Pulse Score Change */}
            {action.improvement.pulseChange !== 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className={`p-4 rounded-xl mb-4 ${
                  action.improvement.pulseChange > 0 
                    ? 'bg-green-50 border border-green-200' 
                    : 'bg-warm-50 border border-warm-200'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <Zap className={`w-5 h-5 ${
                    action.improvement.pulseChange > 0 ? 'text-green-600' : 'text-warm-500'
                  }`} />
                  <span className="text-sm text-warm-600">Pulse Score</span>
                  <span className={`text-lg font-bold ${
                    action.improvement.pulseChange > 0 ? 'text-green-600' : 'text-red-500'
                  }`}>
                    {action.improvement.pulseChange > 0 ? '+' : ''}{action.improvement.pulseChange}
                  </span>
                </div>
              </motion.div>
            )}

            {/* Time taken */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="flex items-center justify-center gap-2 text-sm text-warm-400"
            >
              <Clock className="w-4 h-4" />
              <span>Completed in {timeTaken < 1 ? 'under a minute' : `${timeTaken} min`}</span>
            </motion.div>

            {/* Encouragement message */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-6 text-center text-sm text-warm-600 italic"
            >
              {getEncouragementMessage(action.improvement.pulseChange, hasImprovement)}
            </motion.p>
          </div>

          {/* CTA */}
          <div className="px-6 pb-6">
            <motion.button
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-warm-800 text-white font-semibold hover:bg-warm-900 transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Keep Optimizing
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ============ ACTION HISTORY COMPONENT ============

export function ActionHistory({ completedActions }: ActionHistoryProps) {
  if (completedActions.length === 0) return null;

  // Sort by most recent first
  const sorted = [...completedActions].sort((a, b) => b.completedAt - a.completedAt);
  const totalPulseGain = completedActions.reduce((sum, a) => sum + Math.max(0, a.improvement.pulseChange), 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-warm-800">Today's Wins</h3>
        {totalPulseGain > 0 && (
          <div className="flex items-center gap-1 text-sm text-green-600 font-medium">
            <TrendingUp className="w-4 h-4" />
            +{totalPulseGain} Pulse
          </div>
        )}
      </div>

      <div className="space-y-2">
        {sorted.slice(0, 5).map((action, index) => (
          <ActionHistoryCard key={`${action.actionId}-${action.completedAt}`} action={action} index={index} />
        ))}
      </div>

      {sorted.length > 5 && (
        <p className="text-center text-sm text-warm-400 mt-2">
          +{sorted.length - 5} more actions today
        </p>
      )}
    </motion.div>
  );
}

function ActionHistoryCard({ action, index }: { action: CompletedAction; index: number }) {
  const Icon = getCategoryIcon(action.actionCategory);
  const time = new Date(action.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="p-3 rounded-xl bg-green-50 border border-green-200 flex items-center gap-3"
    >
      <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
        <Icon className="w-4 h-4 text-green-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-warm-800 truncate">{action.actionTitle}</p>
        <div className="flex items-center gap-2 text-xs text-warm-500">
          <span>{time}</span>
          {action.improvement.primary && (
            <>
              <span>•</span>
              <span className="text-green-600">
                {action.improvement.primary.before} → {action.improvement.primary.after}
              </span>
            </>
          )}
        </div>
      </div>
      {action.improvement.pulseChange > 0 && (
        <div className="flex items-center gap-1 text-sm font-bold text-green-600">
          <TrendingUp className="w-3.5 h-3.5" />
          +{action.improvement.pulseChange}
        </div>
      )}
      <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
    </motion.div>
  );
}

// ============ METRIC CHANGE HIGHLIGHT ============

interface MetricChangeHighlightProps {
  label: string;
  currentValue: number | null;
  previousValue: number | null;
  unit: string;
  icon: typeof Volume2;
  optimalRange: { min: number; max: number };
}

export function MetricChangeHighlight({
  label,
  currentValue,
  previousValue,
  unit,
  icon: Icon,
  optimalRange,
}: MetricChangeHighlightProps) {
  if (currentValue === null || previousValue === null) return null;

  const change = currentValue - previousValue;
  const absChange = Math.abs(change);
  
  if (absChange < 1) return null; // No significant change

  const isInOptimal = currentValue >= optimalRange.min && currentValue <= optimalRange.max;
  const wasInOptimal = previousValue >= optimalRange.min && previousValue <= optimalRange.max;
  const isImproving = !wasInOptimal && isInOptimal;
  const isWorsening = wasInOptimal && !isInOptimal;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
        isImproving 
          ? 'bg-green-100 text-green-700 border border-green-200' 
          : isWorsening
          ? 'bg-red-100 text-red-700 border border-red-200'
          : 'bg-warm-100 text-warm-600 border border-warm-200'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {change > 0 ? (
        <TrendingUp className="w-3.5 h-3.5" />
      ) : (
        <TrendingDown className="w-3.5 h-3.5" />
      )}
      <span>
        {label} {change > 0 ? '+' : ''}{absChange.toFixed(0)} {unit}
      </span>
    </motion.div>
  );
}

// ============ HELPER FUNCTIONS ============

function getCategoryIcon(category: CompletedAction['actionCategory']) {
  switch (category) {
    case 'sound': return Volume2;
    case 'light': return Sun;
    case 'occupancy': return Users;
    case 'timing': return Clock;
    default: return Target;
  }
}

function getEncouragementMessage(pulseChange: number, hasImprovement: boolean): string {
  if (pulseChange >= 10) {
    return "Massive improvement! Your guests can feel the difference.";
  }
  if (pulseChange >= 5) {
    return "Great work! Small changes add up to big results.";
  }
  if (hasImprovement) {
    return "You're on the right track. Keep optimizing!";
  }
  return "Action logged. Changes may take a few minutes to reflect in metrics.";
}

// ============ HOOKS ============

export function useActionTracking() {
  const [actionSnapshots, setActionSnapshots] = useState<Map<string, ActionSnapshot>>(new Map());
  const [completedActions, setCompletedActions] = useState<CompletedAction[]>([]);

  // Create a snapshot when an action is first shown
  const createSnapshot = (
    actionId: string,
    actionTitle: string,
    actionCategory: ActionSnapshot['actionCategory'],
    metrics: ActionSnapshot['metrics']
  ) => {
    if (actionSnapshots.has(actionId)) return; // Already tracked

    setActionSnapshots(prev => {
      const next = new Map(prev);
      next.set(actionId, {
        actionId,
        actionTitle,
        actionCategory,
        timestamp: Date.now(),
        metrics,
      });
      return next;
    });
  };

  // Complete an action and calculate improvement
  const completeAction = (
    actionId: string,
    currentMetrics: ActionSnapshot['metrics']
  ): CompletedAction | null => {
    const snapshot = actionSnapshots.get(actionId);
    if (!snapshot) return null;

    // Calculate improvements
    const improvement = calculateImprovement(snapshot, currentMetrics);

    const completed: CompletedAction = {
      actionId: snapshot.actionId,
      actionTitle: snapshot.actionTitle,
      actionCategory: snapshot.actionCategory,
      startedAt: snapshot.timestamp,
      completedAt: Date.now(),
      beforeMetrics: snapshot.metrics,
      afterMetrics: currentMetrics,
      improvement,
    };

    setCompletedActions(prev => [...prev, completed]);

    // Remove from snapshots
    setActionSnapshots(prev => {
      const next = new Map(prev);
      next.delete(actionId);
      return next;
    });

    return completed;
  };

  // Calculate improvement based on category
  const calculateImprovement = (
    snapshot: ActionSnapshot,
    current: ActionSnapshot['metrics']
  ): CompletedAction['improvement'] => {
    const pulseChange = (current.pulseScore ?? 0) - (snapshot.metrics.pulseScore ?? 0);

    let primary: CompletedAction['improvement']['primary'] = null;

    switch (snapshot.actionCategory) {
      case 'sound':
        if (snapshot.metrics.decibels !== null && current.decibels !== null) {
          const before = snapshot.metrics.decibels;
          const after = current.decibels;
          // Improved if moved closer to 70-82 range
          const beforeDist = before > 82 ? before - 82 : before < 70 ? 70 - before : 0;
          const afterDist = after > 82 ? after - 82 : after < 70 ? 70 - after : 0;
          primary = {
            label: 'Sound',
            before: `${before.toFixed(0)} dB`,
            after: `${after.toFixed(0)} dB`,
            improved: afterDist < beforeDist,
          };
        }
        break;
      case 'light':
        if (snapshot.metrics.light !== null && current.light !== null) {
          const before = snapshot.metrics.light;
          const after = current.light;
          // Improved if moved closer to 50-350 range
          const beforeDist = before > 350 ? before - 350 : before < 50 ? 50 - before : 0;
          const afterDist = after > 350 ? after - 350 : after < 50 ? 50 - after : 0;
          primary = {
            label: 'Light',
            before: `${before.toFixed(0)} lux`,
            after: `${after.toFixed(0)} lux`,
            improved: afterDist < beforeDist,
          };
        }
        break;
      case 'occupancy':
        if (snapshot.metrics.occupancy !== null && current.occupancy !== null) {
          primary = {
            label: 'Crowd',
            before: String(snapshot.metrics.occupancy),
            after: String(current.occupancy),
            improved: current.occupancy > snapshot.metrics.occupancy,
          };
        }
        break;
    }

    return { primary, pulseChange };
  };

  return {
    actionSnapshots,
    completedActions,
    createSnapshot,
    completeAction,
  };
}

export default ActionCelebration;
