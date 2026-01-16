/**
 * useActions - Action generation and tracking
 * 
 * Generates contextual recommendations based on current data.
 * Uses YOUR venue's historical data for optimal ranges.
 * NO fabricated impact claims - only shows data we can prove.
 */

import { useState, useMemo, useCallback } from 'react';
import { Volume2, Sun, Users, Clock, Trophy, Music, LucideIcon } from 'lucide-react';
import { OCCUPANCY_THRESHOLDS, TIME_PERIODS } from '../utils/constants';
import { getCurrentTimeSlot } from '../utils/scoring';
import venueLearningService from '../services/venue-learning.service';
import authService from '../services/auth.service';
import type { ActionPriority } from '../utils/constants';
import type { OccupancyMetrics } from '../types';

// ============ TYPES ============

export interface PulseAction {
  id: string;
  priority: ActionPriority;
  category: 'sound' | 'light' | 'occupancy' | 'timing' | 'general';
  title: string;
  description: string;
  impact?: string; // Only shown if we have data to back it up
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
  
  // Get venue's historical data for optimal ranges
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  const timeSlot = getCurrentTimeSlot();
  const bestNight = venueLearningService.getBestNightProfile(venueId, timeSlot);
  const learnedRanges = venueLearningService.getCurrentOptimalRanges(venueId);
  
  // Use YOUR best night data if available, otherwise use learned ranges
  const optimalSound = bestNight 
    ? { min: bestNight.avgSound - 5, max: bestNight.avgSound + 5 }
    : learnedRanges.sound || { min: 65, max: 80 };
  
  const optimalLight = bestNight
    ? { min: Math.max(0, bestNight.avgLight - 50), max: bestNight.avgLight + 50 }
    : learnedRanges.light || { min: 30, max: 150 };
  
  const hasHistoricalData = !!bestNight || learnedRanges.isLearned;
  
  // Estimate capacity from peak occupancy
  const estimatedCapacity = occupancy?.peakOccupancy 
    ? Math.max(occupancy.peakOccupancy * 1.2, 50) 
    : 100;
  const occupancyPercent = occupancy?.current !== undefined 
    ? (occupancy.current / estimatedCapacity) * 100 
    : null;
  
  // ============ SOUND ACTIONS ============
  
  if (currentDecibels !== null) {
    if (currentDecibels > optimalSound.max) {
      const diff = currentDecibels - optimalSound.max;
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
        description: hasHistoricalData
          ? `Sound is ${Math.round(diff)} dB above your best nights for this time.`
          : `Sound is ${Math.round(diff)} dB above optimal range.`,
        // NO fabricated impact - only show if we have data
        impact: hasHistoricalData 
          ? `Your best ${timeSlot}s average ${bestNight?.avgSound || optimalSound.max} dB`
          : undefined,
        currentValue: `${currentDecibels.toFixed(0)} dB`,
        targetValue: `${optimalSound.min}-${optimalSound.max} dB`,
        icon: Volume2,
        reasoning: hasHistoricalData ? [
          `Your best nights at this time average ${bestNight?.avgSound || optimalSound.max} dB.`,
          `Currently ${Math.round(diff)} dB higher than your proven formula.`,
        ] : [
          `Sound is above the comfortable conversation range.`,
          `Consider turning down ${Math.round(diff)} dB.`,
        ],
        historicalComparison: bestNight 
          ? `Your best ${bestNight.dayOfWeek}: ${bestNight.avgSound} dB` 
          : undefined,
      });
    } else if (currentDecibels < optimalSound.min) {
      const diff = optimalSound.min - currentDecibels;
      actions.push({
        id: 'sound-low',
        priority: diff > 20 ? 'high' : 'medium',
        category: 'sound',
        title: 'Pump Up the Energy',
        description: hasHistoricalData
          ? `Sound is ${Math.round(diff)} dB below your best nights.`
          : isPeakHours 
            ? 'Peak hours but energy feels flat.' 
            : 'A bit quiet for this time.',
        impact: hasHistoricalData
          ? `Your best ${timeSlot}s average ${bestNight?.avgSound || optimalSound.min} dB`
          : undefined,
        currentValue: `${currentDecibels.toFixed(0)} dB`,
        targetValue: `${optimalSound.min}-${optimalSound.max} dB`,
        icon: Music,
        reasoning: hasHistoricalData ? [
          `Your best nights at this time average ${bestNight?.avgSound || optimalSound.min} dB.`,
          `Currently ${Math.round(diff)} dB lower.`,
        ] : [
          `Consider turning up the music.`,
        ],
      });
    }
  }
  
  // ============ LIGHT ACTIONS ============
  
  if (currentLight !== null && currentHour >= 18) {
    if (currentLight > optimalLight.max) {
      const diff = currentLight - optimalLight.max;
      actions.push({
        id: 'light-high',
        priority: currentHour >= 20 ? 'high' : 'medium',
        category: 'light',
        title: 'Dim the Lights',
        description: hasHistoricalData
          ? `Lighting is ${Math.round(diff)} lux brighter than your best nights.`
          : 'Evening lighting could be dimmer.',
        // NO fabricated "18% higher tabs" claim
        impact: hasHistoricalData
          ? `Your best ${timeSlot}s average ${bestNight?.avgLight || optimalLight.max} lux`
          : undefined,
        currentValue: `${currentLight.toFixed(0)} lux`,
        targetValue: `${optimalLight.min}-${optimalLight.max} lux`,
        icon: Sun,
        reasoning: hasHistoricalData ? [
          `Your best nights at this time average ${bestNight?.avgLight || optimalLight.max} lux.`,
          `Currently ${Math.round(diff)} lux brighter.`,
        ] : [
          `Consider dimming the lights for evening ambiance.`,
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
        description: `Running at ${Math.round(occupancyPercent)}% capacity.`,
        // No fabricated claims
        impact: bestNight 
          ? `Your best ${bestNight.dayOfWeek} had ${bestNight.peakOccupancy} at peak`
          : undefined,
        icon: Users,
        reasoning: [
          `Currently at ${Math.round(occupancyPercent)}% capacity.`,
        ],
      });
    }
    
    if (occupancyPercent >= OCCUPANCY_THRESHOLDS.packed) {
      actions.push({
        id: 'occupancy-packed',
        priority: 'high',
        category: 'occupancy',
        title: 'House is Packed!',
        description: `${Math.round(occupancyPercent)}% capacity. Keep service fast.`,
        // No fabricated claims
        icon: Users,
        reasoning: [
          `Great turnout! Keep the momentum going.`,
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
      description: 'Expect a rush before kickoff. Check TVs, stock up.',
      // No fabricated "2x faster" claim
      icon: Trophy,
      reasoning: [
        'Game-day traffic typically spikes before start.',
        'Make sure TVs are on the right channels.',
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
      icon: Clock,
    });
  }
  
  // ============ SORT BY PRIORITY ============
  
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  
  return actions;
}

export default useActions;
