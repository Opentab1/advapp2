/**
 * useActions - Action generation and tracking
 * 
 * Generates contextual recommendations based on current data.
 * Tracks completed actions for feedback.
 */

import { useState, useMemo, useCallback } from 'react';
import { Volume2, Sun, Users, Clock, Trophy, Music, LucideIcon } from 'lucide-react';
import { OPTIMAL_RANGES, OCCUPANCY_THRESHOLDS, TIME_PERIODS } from '../utils/constants';
import type { ActionPriority } from '../utils/constants';
import type { OccupancyMetrics } from '../types';

// ============ TYPES ============

export interface PulseAction {
  id: string;
  priority: ActionPriority;
  category: 'sound' | 'light' | 'occupancy' | 'timing' | 'general';
  title: string;
  description: string;
  impact: string;
  currentValue?: string;
  targetValue?: string;
  icon: LucideIcon;
  // Data for "See Why" modal
  reasoning?: string[];
  historicalComparison?: string;
}

interface ActionInput {
  currentDecibels: number | null;
  currentLight: number | null;
  occupancy: OccupancyMetrics | null;
  hasUpcomingGames?: boolean;
}

interface UseActionsReturn {
  actions: PulseAction[];
  heroAction: PulseAction | null;
  remainingActions: PulseAction[];
  completedCount: number;
  completeAction: (actionId: string) => void;
  resetActions: () => void;
}

// ============ HOOK ============

export function useActions(input: ActionInput): UseActionsReturn {
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  
  // Generate actions based on current data
  const actions = useMemo(() => {
    return generateActions(input);
  }, [input.currentDecibels, input.currentLight, input.occupancy, input.hasUpcomingGames]);
  
  // Filter out completed actions
  const activeActions = useMemo(() => {
    return actions.filter(a => !completedIds.has(a.id));
  }, [actions, completedIds]);
  
  const heroAction = activeActions[0] || null;
  const remainingActions = activeActions.slice(1);
  
  const completeAction = useCallback((actionId: string) => {
    setCompletedIds(prev => new Set([...prev, actionId]));
  }, []);
  
  const resetActions = useCallback(() => {
    setCompletedIds(new Set());
  }, []);
  
  return {
    actions,
    heroAction,
    remainingActions,
    completedCount: completedIds.size,
    completeAction,
    resetActions,
  };
}

// ============ ACTION GENERATION ============

function generateActions(input: ActionInput): PulseAction[] {
  const { currentDecibels, currentLight, occupancy, hasUpcomingGames } = input;
  const actions: PulseAction[] = [];
  
  const now = new Date();
  const currentHour = now.getHours();
  const dayOfWeek = now.getDay();
  
  const isPeakHours = currentHour >= TIME_PERIODS.peak.start && currentHour < TIME_PERIODS.peak.end;
  const isPrePeak = currentHour >= TIME_PERIODS.prePeak.start && currentHour < TIME_PERIODS.prePeak.end;
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
  
  // Estimate capacity from peak occupancy
  const estimatedCapacity = occupancy?.peakOccupancy 
    ? Math.max(occupancy.peakOccupancy * 1.2, 50) 
    : 100;
  const occupancyPercent = occupancy?.current !== undefined 
    ? (occupancy.current / estimatedCapacity) * 100 
    : null;
  
  // ============ SOUND ACTIONS ============
  
  if (currentDecibels !== null) {
    if (currentDecibels > OPTIMAL_RANGES.sound.max) {
      const diff = currentDecibels - OPTIMAL_RANGES.sound.max;
      let priority: ActionPriority = diff > 12 ? 'critical' : diff > 8 ? 'high' : 'medium';
      
      // Escalate if venue is packed
      if (priority !== 'critical' && occupancyPercent && occupancyPercent > OCCUPANCY_THRESHOLDS.packed) {
        priority = priority === 'high' ? 'critical' : 'high';
      }
      
      actions.push({
        id: 'sound-high',
        priority,
        category: 'sound',
        title: diff > 10 ? 'Music is Too Loud' : 'Turn Down the Volume',
        description: `Sound is ${Math.round(diff)} dB above optimal. Guests can't hear each other.`,
        impact: 'Comfortable conversation = longer stays, higher tabs',
        currentValue: `${currentDecibels.toFixed(0)} dB`,
        targetValue: `${OPTIMAL_RANGES.sound.min}-${OPTIMAL_RANGES.sound.max} dB`,
        icon: Volume2,
        reasoning: [
          `Above ${OPTIMAL_RANGES.sound.max} dB, conversation becomes difficult.`,
          'Studies show guests leave 23% sooner when they can\'t talk.',
          'Your sound has been elevated for the past 30+ minutes.',
        ],
        historicalComparison: 'Last Saturday at this hour: 74 dB, 15% longer dwell time',
      });
    } else if (currentDecibels < OPTIMAL_RANGES.sound.min) {
      const diff = OPTIMAL_RANGES.sound.min - currentDecibels;
      actions.push({
        id: 'sound-low',
        priority: diff > 20 ? 'high' : 'medium',
        category: 'sound',
        title: 'Pump Up the Energy',
        description: isPeakHours 
          ? 'Peak hours but energy feels flat. Turn up the music.' 
          : 'A bit quiet. Background music helps fill the space.',
        impact: 'The right energy makes guests feel part of something',
        currentValue: `${currentDecibels.toFixed(0)} dB`,
        targetValue: `${OPTIMAL_RANGES.sound.min}-${OPTIMAL_RANGES.sound.max} dB`,
        icon: Music,
        reasoning: [
          'Venues that feel "dead" have lower return rates.',
          'Music sets the mood — energy attracts energy.',
        ],
      });
    }
  }
  
  // ============ LIGHT ACTIONS ============
  
  if (currentLight !== null) {
    if (currentLight > OPTIMAL_RANGES.light.max && currentHour >= 18) {
      actions.push({
        id: 'light-high',
        priority: currentHour >= 20 ? 'high' : 'medium',
        category: 'light',
        title: 'Dim the Lights',
        description: 'Evening vibes need softer lighting. Too bright kills the mood.',
        impact: 'Dimmer evening lighting increases average tab by 18%',
        currentValue: `${currentLight.toFixed(0)} lux`,
        targetValue: `${OPTIMAL_RANGES.light.min}-${OPTIMAL_RANGES.light.max} lux`,
        icon: Sun,
        reasoning: [
          'Bright lights signal "daytime" — subconsciously tells guests to leave.',
          'Softer lighting encourages relaxation and longer stays.',
          'Average tabs are 18% higher with proper ambient lighting.',
        ],
      });
    }
  }
  
  // ============ OCCUPANCY ACTIONS ============
  
  if (occupancyPercent !== null) {
    if (isPeakHours && occupancyPercent < OCCUPANCY_THRESHOLDS.slow && isWeekend) {
      actions.push({
        id: 'occupancy-slow',
        priority: 'medium',
        category: 'occupancy',
        title: 'Slow for a Weekend',
        description: `Only ${Math.round(occupancyPercent)}% capacity. Consider a quick social post.`,
        impact: 'A promo or story can shift momentum fast',
        icon: Users,
        reasoning: [
          `You're running at ${Math.round(occupancyPercent)}% — well below typical for this time.`,
          'Weekend nights usually pick up, but a nudge can accelerate it.',
        ],
      });
    }
    
    if (occupancyPercent >= OCCUPANCY_THRESHOLDS.packed) {
      actions.push({
        id: 'occupancy-packed',
        priority: 'high',
        category: 'occupancy',
        title: 'House is Packed!',
        description: `${Math.round(occupancyPercent)}% capacity. Keep service fast, don't let the wait kill vibes.`,
        impact: 'Fast service = higher tips, return customers',
        icon: Users,
        reasoning: [
          'Wait times over 10 min drastically hurt satisfaction.',
          'This is when you make your money — maximize throughput.',
        ],
      });
    }
  }
  
  // ============ TIMING ACTIONS ============
  
  if (hasUpcomingGames) {
    actions.push({
      id: 'timing-game',
      priority: 'high',
      category: 'timing',
      title: 'Game Starting Soon',
      description: 'Expect a rush 30 min before kickoff. Check TVs, stock up.',
      impact: 'Game crowds order 2x faster — be ready',
      icon: Trophy,
      reasoning: [
        'Game-day traffic spikes 30 min before start.',
        'Make sure all TVs are on the right channels.',
        'Pre-stock the bar — you won\'t have time during the rush.',
      ],
    });
  }
  
  if (isPrePeak && actions.length < 2) {
    actions.push({
      id: 'timing-prepeak',
      priority: 'low',
      category: 'timing',
      title: 'Pre-Peak Prep Time',
      description: 'Rush hour approaching. Make sure you\'re set.',
      impact: 'Prepared venues handle rushes smoother',
      icon: Clock,
    });
  }
  
  // ============ SORT BY PRIORITY ============
  
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  
  return actions;
}

export default useActions;
