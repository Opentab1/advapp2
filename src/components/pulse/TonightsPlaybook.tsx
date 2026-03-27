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
  TrendingUp, Sparkles, DollarSign, UserPlus
} from 'lucide-react';
import { haptic } from '../../utils/haptics';
import { getCurrentTimeSlot } from '../../utils/scoring';
import { TIME_SLOT_RANGES } from '../../utils/constants';
import authService from '../../services/auth.service';
import { isDemoAccount } from '../../utils/demoData';

interface PlaybookAction {
  id: string;
  timeLabel: string; // "RIGHT NOW" or "IN 47 MINUTES"
  title: string;
  description: string;
  icon: 'sound' | 'light' | 'music' | 'crowd' | 'alert' | 'opportunity';
  status: 'current' | 'upcoming' | 'done';
  impact?: string; // Only shown if backed by venue learning data
}

// Venue pattern prop type
interface VenuePattern {
  factor: 'sound' | 'light' | 'temperature' | 'time' | 'combined';
  impact: string;
  confidence: number;
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
  // Venue learning patterns - only show impact if we have data to back it up
  venuePatterns?: VenuePattern[];
  totalDrinks?: number | null;
  drinksPerHour?: number | null;
  hasTheftFlag?: boolean;
  retentionRate?: number | null;
  pulseScore?: number | null;
  dayOfWeek?: string;
  currentHourLabel?: string;
  historicalDrop?: number | null;
}

export function TonightsPlaybook({
  currentDecibels,
  currentLight,
  currentOccupancy,
  peakPrediction,
  smartActions = [],
  venuePatterns = [],
  totalDrinks,
  drinksPerHour,
  hasTheftFlag,
  retentionRate,
  pulseScore,
  dayOfWeek,
  currentHourLabel,
  historicalDrop,
}: TonightsPlaybookProps) {
  const [completedActions, setCompletedActions] = useState<Set<string>>(new Set());

  const now = new Date();
  const currentHour = now.getHours();
  // Bar is open 11 AM – 2 AM; "business hours" = any hour >= 11 or < 2
  const isBusinessHours = currentHour >= 11 || currentHour < 2;
  const isPeakHours = (currentHour >= 20 || currentHour < 2);
  
  // Helper: Find a pattern for a specific factor with sufficient confidence
  const getPatternImpact = (factor: 'sound' | 'light' | 'temperature'): string | undefined => {
    // Only show impact if we have a pattern with 30%+ confidence
    const pattern = venuePatterns.find(p => p.factor === factor && p.confidence >= 30);
    if (pattern) {
      return `Your data: ${pattern.impact}`;
    }
    return undefined; // No fabricated claims
  };
  
  // Generate DEMO-specific smart actions - data-driven, specific, actionable
  const generateDemoActions = (): PlaybookAction[] => {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // Friday or Saturday
    
    // Time-based contextual actions
    const actions: PlaybookAction[] = [];
    
    // Action 1: Music recommendation (always show - most impactful)
    if (hour >= 20 && hour < 23) {
      actions.push({
        id: 'music-energy',
        timeLabel: 'DO THIS NOW',
        title: 'Play "Uptown Funk" or "Blinding Lights"',
        description: 'These tracks increased your retention by 23% on past Saturday nights at this hour.',
        icon: 'music',
        status: 'current',
        impact: '+$340 avg revenue when played during peak',
      });
    } else if (hour >= 17 && hour < 20) {
      actions.push({
        id: 'music-warmup',
        timeLabel: 'DO THIS NOW',
        title: 'Start building energy with mid-tempo hits',
        description: 'Your data shows crowds that hear upbeat music before 9 PM stay 18 min longer.',
        icon: 'music',
        status: 'current',
        impact: '+18 min avg stay time',
      });
    } else {
      actions.push({
        id: 'music-maintain',
        timeLabel: 'DO THIS NOW',
        title: 'Queue 3 high-energy tracks for the next 30 min',
        description: 'Consistent energy keeps your retention rate above 75%. You\'re at 78% now.',
        icon: 'music',
        status: 'current',
        impact: 'Maintain 78% retention rate',
      });
    }
    
    // Action 2: Sound level (based on current dB)
    if (currentDecibels < 75) {
      actions.push({
        id: 'sound-boost',
        timeLabel: 'DO THIS NOW',
        title: `Raise volume to 78 dB (currently ${Math.round(currentDecibels)} dB)`,
        description: 'Your best nights hit 76-80 dB during peak. Every 3 dB increase = 8% longer stays.',
        icon: 'sound',
        status: 'current',
        impact: '+$12 avg spend per guest at 78 dB',
      });
    } else if (currentDecibels > 82) {
      actions.push({
        id: 'sound-reduce',
        timeLabel: 'DO THIS NOW',
        title: `Lower volume to 78 dB (currently ${Math.round(currentDecibels)} dB)`,
        description: 'Above 82 dB, conversations drop and guests leave 22 min earlier on average.',
        icon: 'alert',
        status: 'current',
        impact: 'Prevent -22 min avg stay time',
      });
    }
    
    // Action 3: Staffing/crowd prediction
    if (hour >= 19 && hour < 21) {
      const peakTime = isWeekend ? '10:30 PM' : '9:00 PM';
      const minutesUntil = isWeekend ? (22.5 - hour) * 60 : (21 - hour) * 60;
      actions.push({
        id: 'staffing-prep',
        timeLabel: `IN ${Math.round(minutesUntil)} MIN`,
        title: 'Call in backup bartender now',
        description: `Your rush typically starts at ${peakTime}. Last week you were understaffed and lost an estimated $890.`,
        icon: 'crowd',
        status: 'upcoming',
        impact: 'Prevent $890 in lost revenue',
      });
    } else if (hour >= 21 && hour < 23) {
      actions.push({
        id: 'peak-maximize',
        timeLabel: 'PEAK HOURS',
        title: 'Push signature cocktails now',
        description: 'You\'re in your highest-revenue window. Signature drinks have 62% margin vs 45% for beer.',
        icon: 'opportunity',
        status: 'current',
        impact: '+17% margin per drink sold',
      });
    }
    
    // Action 4: Promo/announcement timing
    if (hour === 20 || hour === 21) {
      actions.push({
        id: 'promo-timing',
        timeLabel: 'IN 15 MIN',
        title: 'Announce happy hour ending (if applicable)',
        description: 'You see 35% more drink orders in the 15 min after announcing last call for specials.',
        icon: 'opportunity',
        status: 'upcoming',
        impact: '+35% orders in next 15 min',
      });
    }
    
    // Action 5: Retention alert
    if (hour >= 22 && hour < 24) {
      actions.push({
        id: 'retention-watch',
        timeLabel: 'WATCH THIS',
        title: 'Keep energy high - this is your drop-off hour',
        description: 'Historically, 30% of guests leave between 10-11 PM. High-energy music reduces this to 18%.',
        icon: 'alert',
        status: 'current',
        impact: 'Keep 12% more guests (≈ $420 revenue)',
      });
    }
    
    // If we don't have enough actions, add a general tip
    if (actions.length < 3) {
      actions.push({
        id: 'general-optimize',
        timeLabel: 'TIP',
        title: 'Check crowd distribution',
        description: 'Walk the floor and identify cold spots. Moving people to the bar increases avg spend by $8.',
        icon: 'crowd',
        status: 'upcoming',
        impact: '+$8 avg spend when bar is full',
      });
    }
    
    return actions.slice(0, 5); // Max 5 actions
  };
  
  // Generate playbook actions based on current state
  const generateActions = (): PlaybookAction[] => {
    const user = authService.getStoredUser();
    if (isDemoAccount(user?.venueId || '')) {
      return generateDemoActions();
    }
    return generateFallbackActions();
  };
  
  // Fallback action generation (kept for reference)
  const generateFallbackActions = (): PlaybookAction[] => {
    const actions: PlaybookAction[] = [];
    const timeSlot = getCurrentTimeSlot();
    const ranges = TIME_SLOT_RANGES[timeSlot];
    const hasRealSensors = currentDecibels > 0 || currentLight > 0;

    // ── VenueScope-native actions (no sensors) ─────────────────────────
    if (!hasRealSensors) {
      if (hasTheftFlag) {
        actions.push({
          id: 'vs-theft',
          timeLabel: 'REVIEW NOW',
          title: 'Unrung drinks detected',
          description: 'VenueScope flagged a discrepancy between camera counts and POS. Check the latest shift.',
          icon: 'alert',
          status: 'current',
        });
      }

      if (drinksPerHour != null && drinksPerHour > 35) {
        const overBy = Math.round(((drinksPerHour - 35) / 35) * 100);
        actions.push({
          id: 'vs-rush',
          timeLabel: 'RIGHT NOW',
          title: `Bar running hot — ${drinksPerHour.toFixed(0)} drinks/hr`,
          description: `${overBy}% above a typical peak rate${dayOfWeek ? ` for ${dayOfWeek}` : ''}. Call extra staff now before the queue builds.`,
          icon: 'crowd',
          status: 'current',
        });
      }

      if (retentionRate != null && retentionRate < 45 && isBusinessHours) {
        actions.push({
          id: 'vs-retention',
          timeLabel: 'RIGHT NOW',
          title: 'Guests leaving early',
          description: `Only ${retentionRate}% of today's guests are still here${currentHourLabel ? ` at ${currentHourLabel}` : ''}. Try a promo, announce last call for specials, or raise the energy.`,
          icon: 'alert',
          status: 'current',
        });
      }

      if (peakPrediction && peakPrediction.minutesUntil > 0 && peakPrediction.minutesUntil < 120) {
        actions.push({
          id: 'vs-peak-prep',
          timeLabel: peakPrediction.minutesUntil <= 30 ? 'SOON' : `IN ${peakPrediction.minutesUntil} MIN`,
          title: 'Rush hour approaching — stock up',
          description: `Peak expected around ${peakPrediction.hour}. Ensure ice, garnishes, and bar stock are ready.`,
          icon: 'opportunity',
          status: 'upcoming',
          impact: peakPrediction.expectedOccupancy > currentOccupancy
            ? `~${peakPrediction.expectedOccupancy - currentOccupancy} more guests expected`
            : undefined,
        });
      }

      if (actions.length === 0) {
        actions.push({
          id: 'vs-all-good',
          timeLabel: 'RIGHT NOW',
          title: totalDrinks != null && totalDrinks > 0
            ? `${totalDrinks} drinks served today`
            : 'Bar monitoring active',
          description: totalDrinks != null && totalDrinks > 0
            ? 'Drink counts are being tracked by VenueScope. Stay consistent.'
            : 'VenueScope is monitoring bar activity via CCTV.',
          icon: 'opportunity',
          status: 'current',
        });
      }

      return actions.slice(0, 4);
    }

    // ── Sensor-based actions (Pi accounts) ────────────────────────────
    const isWeekendPeak = timeSlot === 'friday_peak' || timeSlot === 'saturday_peak';
    const isHappyHour = timeSlot === 'weekday_happy_hour';
    const isDaytime = timeSlot === 'daytime';
    const contextLabel = isWeekendPeak ? 'for weekend peak' :
                         isHappyHour ? 'for happy hour' :
                         isDaytime ? 'for daytime crowd' : 'for this time';

    const soundStatus = currentDecibels >= ranges.sound.min && currentDecibels <= ranges.sound.max ? 'good' :
                        currentDecibels > ranges.sound.max ? 'high' : 'low';
    const lightStatus = currentLight >= ranges.light.min && currentLight <= ranges.light.max ? 'good' :
                        currentLight > ranges.light.max ? 'bright' : 'dim';

    const soundImpact = getPatternImpact('sound');
    const lightImpact = getPatternImpact('light');

    const timeContext = [currentHourLabel, dayOfWeek].filter(Boolean).join(' on ');
    const dropContext = historicalDrop && historicalDrop > 5 ? `, crowd is down ${historicalDrop}% vs usual` : '';

    if (soundStatus === 'good') {
      actions.push({ id: 'sound-good', timeLabel: 'RIGHT NOW', title: 'Sound is perfect', description: `${Math.round(currentDecibels)}dB is right in the sweet spot ${contextLabel}. Keep it here.`, icon: 'sound', status: 'current' });
    } else if (soundStatus === 'high') {
      const overBy = Math.round(currentDecibels - ranges.sound.max);
      actions.push({ id: 'sound-high', timeLabel: 'RIGHT NOW', title: 'Sound too loud', description: `${Math.round(currentDecibels)}dB is ${overBy}dB over target${timeContext ? ` for ${timeContext}` : ''}. Lower to ${ranges.sound.min}–${ranges.sound.max}dB — above ${ranges.sound.max}dB guests start leaving earlier.`, icon: 'alert', status: 'current', impact: soundImpact });
    } else {
      const underBy = Math.round(ranges.sound.min - currentDecibels);
      actions.push({ id: 'sound-low', timeLabel: 'RIGHT NOW', title: 'Boost the energy', description: `${Math.round(currentDecibels)}dB is ${underBy}dB below target${timeContext ? ` for ${timeContext}` : ''}${dropContext}. Raise volume to ${ranges.sound.min}–${ranges.sound.max}dB.`, icon: 'sound', status: 'current', impact: soundImpact });
    }

    if (lightStatus === 'bright' && !isDaytime) {
      actions.push({ id: 'light-dim', timeLabel: 'RIGHT NOW', title: 'Dim the lights', description: `${Math.round(currentLight)}% brightness is too high ${contextLabel}. Target ${ranges.light.min}–${ranges.light.max}% — bright lights reduce dwell time at night.`, icon: 'light', status: 'current', impact: lightImpact });
    } else if (lightStatus === 'dim' && isDaytime) {
      actions.push({ id: 'light-bright', timeLabel: 'RIGHT NOW', title: 'Brighten up', description: `${Math.round(currentLight)}% is too dim for daytime. Raise to ${ranges.light.min}–${ranges.light.max}% to keep the space inviting.`, icon: 'light', status: 'current', impact: lightImpact });
    }

    if (peakPrediction && peakPrediction.minutesUntil > 0 && peakPrediction.minutesUntil < 120) {
      const timeLabel = peakPrediction.minutesUntil <= 30 ? 'SOON' : `IN ${peakPrediction.minutesUntil} MIN`;
      const expectedIncrease = peakPrediction.expectedOccupancy - currentOccupancy;
      actions.push({ id: 'peak-prep', timeLabel, title: 'Rush hour approaching', description: `Based on past weeks, ${peakPrediction.hour} is typically your busiest${dayOfWeek ? ` on ${dayOfWeek}` : ''}. Stock ice, garnishes, and bar tools now.`, icon: 'opportunity', status: 'upcoming', impact: expectedIncrease > 0 ? `~${expectedIncrease} more guests expected` : undefined });
    }

    smartActions.slice(0, 2).forEach((action, idx) => {
      actions.push({ id: action.id, timeLabel: idx === 0 ? 'SUGGESTED' : 'ALSO CONSIDER', title: action.title, description: action.description, icon: 'opportunity', status: 'upcoming' });
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
      case 'money': return DollarSign;
      case 'retention': return UserPlus;
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
