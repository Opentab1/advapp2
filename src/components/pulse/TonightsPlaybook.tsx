/**
 * TonightsPlaybook - Focused action card
 * 
 * Shows exactly what to do right now and what's coming.
 * Clear, actionable, no fluff.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Target, Clock, CheckCircle2, ChevronRight, 
  Volume2, Lightbulb, Users, Music, AlertTriangle,
  TrendingUp, Sparkles
} from 'lucide-react';
import { haptic } from '../../utils/haptics';

interface PlaybookAction {
  id: string;
  timeLabel: string; // "RIGHT NOW" or "IN 47 MINUTES"
  title: string;
  description: string;
  icon: 'sound' | 'light' | 'music' | 'crowd' | 'alert' | 'opportunity';
  status: 'current' | 'upcoming' | 'done';
  impact?: string; // "+32 guests expected"
}

interface TonightsPlaybookProps {
  currentDecibels: number;
  currentLight: number;
  currentOccupancy: number;
  peakPrediction?: {
    hour: string;
    expectedOccupancy: number;
    minutesUntil: number;
  };
  smartActions?: Array<{
    id: string;
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
  }>;
}

export function TonightsPlaybook({
  currentDecibels,
  currentLight,
  currentOccupancy,
  peakPrediction,
  smartActions = [],
}: TonightsPlaybookProps) {
  const [completedActions, setCompletedActions] = useState<Set<string>>(new Set());
  
  // Generate playbook actions based on current state
  const generateActions = (): PlaybookAction[] => {
    const actions: PlaybookAction[] = [];
    
    // Current state assessment
    const soundStatus = currentDecibels >= 65 && currentDecibels <= 80 ? 'good' : 
                        currentDecibels > 80 ? 'high' : 'low';
    const lightStatus = currentLight >= 30 && currentLight <= 70 ? 'good' : 
                        currentLight > 70 ? 'bright' : 'dim';
    
    // RIGHT NOW actions
    if (soundStatus === 'good') {
      actions.push({
        id: 'sound-good',
        timeLabel: 'RIGHT NOW',
        title: 'Sound is perfect',
        description: `${currentDecibels}dB is in the sweet spot. Keep it here.`,
        icon: 'sound',
        status: 'current',
      });
    } else if (soundStatus === 'high') {
      actions.push({
        id: 'sound-high',
        timeLabel: 'RIGHT NOW',
        title: 'Sound too loud',
        description: `${currentDecibels}dB may drive guests away. Lower by 10-15%.`,
        icon: 'alert',
        status: 'current',
        impact: 'Could save 15+ min of dwell time',
      });
    } else {
      actions.push({
        id: 'sound-low',
        timeLabel: 'RIGHT NOW',
        title: 'Boost the energy',
        description: `${currentDecibels}dB feels quiet. Raise volume 10-20%.`,
        icon: 'sound',
        status: 'current',
        impact: 'Higher energy = longer stays',
      });
    }
    
    // Light suggestions
    if (lightStatus === 'bright' && new Date().getHours() >= 19) {
      actions.push({
        id: 'light-dim',
        timeLabel: 'RIGHT NOW',
        title: 'Dim the lights',
        description: `Evening vibe needs lower lighting (currently ${currentLight}%).`,
        icon: 'light',
        status: 'current',
      });
    }
    
    // Peak prediction action
    if (peakPrediction && peakPrediction.minutesUntil > 0 && peakPrediction.minutesUntil < 120) {
      const timeLabel = peakPrediction.minutesUntil <= 30 
        ? 'SOON' 
        : `IN ${peakPrediction.minutesUntil} MIN`;
      
      actions.push({
        id: 'peak-prep',
        timeLabel,
        title: 'Peak hour approaching',
        description: `${peakPrediction.hour} rush coming. Queue high-energy songs.`,
        icon: 'opportunity',
        status: 'upcoming',
        impact: `+${peakPrediction.expectedOccupancy - currentOccupancy} guests expected`,
      });
    }
    
    // Add smart actions from AI
    smartActions.slice(0, 2).forEach((action, idx) => {
      actions.push({
        id: action.id,
        timeLabel: idx === 0 ? 'SUGGESTED' : 'ALSO CONSIDER',
        title: action.title,
        description: action.description,
        icon: 'opportunity',
        status: 'upcoming',
      });
    });
    
    return actions;
  };
  
  const actions = generateActions();
  const currentAction = actions.find(a => a.status === 'current' && !completedActions.has(a.id));
  const upcomingActions = actions.filter(a => a.status === 'upcoming' && !completedActions.has(a.id));
  
  const handleComplete = (actionId: string) => {
    haptic('success');
    setCompletedActions(prev => new Set([...prev, actionId]));
  };
  
  const getIcon = (iconType: string) => {
    switch (iconType) {
      case 'sound': return Volume2;
      case 'light': return Lightbulb;
      case 'music': return Music;
      case 'crowd': return Users;
      case 'alert': return AlertTriangle;
      case 'opportunity': return Sparkles;
      default: return Target;
    }
  };
  
  // All done state
  if (!currentAction && upcomingActions.length === 0) {
    return (
      <motion.div
        className="glass-card p-5"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">You're all set</h3>
            <p className="text-sm text-warm-400">Everything's optimized. Keep monitoring.</p>
          </div>
        </div>
      </motion.div>
    );
  }
  
  return (
    <motion.div
      className="glass-card overflow-hidden"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-0">
        <div>
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-teal" />
            <h3 className="font-semibold text-white">Quick Actions</h3>
          </div>
          <p className="text-xs text-text-secondary mt-1 ml-7">Fix these now to optimize</p>
        </div>
        {completedActions.size > 0 && (
          <div className="text-xs text-recovery-high flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {completedActions.size} done
          </div>
        )}
      </div>
      
      {/* Current Action (Hero) */}
      {currentAction && (
        <div className="p-4">
          <div className="text-xs font-medium text-amber-400 mb-2 tracking-wide">
            {currentAction.timeLabel}
          </div>
          
          <motion.div
            className="p-4 rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-600/5 border border-amber-500/20"
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
          >
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                currentAction.icon === 'alert' 
                  ? 'bg-red-500/20' 
                  : 'bg-amber-500/20'
              }`}>
                {(() => {
                  const IconComponent = getIcon(currentAction.icon);
                  return <IconComponent className={`w-5 h-5 ${
                    currentAction.icon === 'alert' ? 'text-red-400' : 'text-amber-400'
                  }`} />;
                })()}
              </div>
              
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-white mb-1">{currentAction.title}</h4>
                <p className="text-sm text-warm-300">{currentAction.description}</p>
                {currentAction.impact && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-emerald-400">
                    <TrendingUp className="w-3 h-3" />
                    {currentAction.impact}
                  </div>
                )}
              </div>
            </div>
            
            {/* Complete Button */}
            <motion.button
              onClick={() => handleComplete(currentAction.id)}
              className="w-full mt-4 py-3 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-xl text-amber-300 font-medium flex items-center justify-center gap-2 transition-colors"
              whileTap={{ scale: 0.97 }}
            >
              <CheckCircle2 className="w-4 h-4" />
              I Did This
            </motion.button>
          </motion.div>
        </div>
      )}
      
      {/* Upcoming Actions */}
      {upcomingActions.length > 0 && (
        <div className="px-4 pb-4 space-y-2">
          {upcomingActions.slice(0, 2).map((action, idx) => (
            <motion.div
              key={action.id}
              className="p-3 rounded-xl bg-warm-800/50 border border-warm-700 flex items-center gap-3"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 * idx }}
            >
              <div className="w-8 h-8 rounded-full bg-warm-700 flex items-center justify-center flex-shrink-0">
                <Clock className="w-4 h-4 text-warm-400" />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="text-xs text-warm-500 mb-0.5">{action.timeLabel}</div>
                <div className="text-sm font-medium text-warm-200">{action.title}</div>
                {action.impact && (
                  <div className="text-xs text-cyan-400 mt-0.5">{action.impact}</div>
                )}
              </div>
              
              <ChevronRight className="w-4 h-4 text-warm-600" />
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export default TonightsPlaybook;
