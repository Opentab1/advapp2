/**
 * Intelligence Service - AI-powered insights and predictions
 * 
 * Provides:
 * - Smart actions with historical context
 * - Trend anomaly detection
 * - Peak hour predictions
 * - What-if scenario analysis
 * - Daily briefings
 */

import { calculatePulseScore } from '../utils/scoring';
import type { SensorData } from '../types';

// ============ TYPES ============

export interface SmartAction {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: 'sound' | 'light' | 'temperature' | 'music' | 'crowd' | 'timing';
  title: string;
  description: string;
  impact: string;
  confidence: number; // 0-100
  historicalContext?: string;
  whatWorked?: string;
  currentValue?: string;
  suggestedValue?: string;
}

export interface TrendAlert {
  id: string;
  type: 'warning' | 'opportunity' | 'info';
  metric: 'crowd' | 'pulse' | 'dwell' | 'sound' | 'light';
  title: string;
  message: string;
  deviation: number; // percentage above/below normal
  normalValue: number;
  currentValue: number;
  timestamp: Date;
}

export interface PeakPrediction {
  predictedPeakHour: number; // 0-23
  predictedPeakOccupancy: number;
  confidence: number; // 0-100
  basedOn: string;
  comparisonToLastWeek?: {
    lastWeekPeak: number;
    difference: string;
  };
}

export interface WhatIfScenario {
  id: string;
  action: string;
  predictedImpact: {
    pulseScore: number; // delta
    dwellTime: number; // delta in minutes
    description: string;
  };
  confidence: number;
  basedOn: string;
}

export interface DailyBriefing {
  greeting: string;
  todayType: string; // "Busy Friday", "Quiet Monday", etc.
  expectedPeak: PeakPrediction;
  keyInsights: string[];
  suggestedFocus: string;
  weatherImpact?: string;
  specialEvents?: string[];
}

// ============ HISTORICAL PATTERN ANALYSIS ============

interface HistoricalPattern {
  hourlyAverages: Map<number, { pulse: number; crowd: number; sound: number; light: number }>;
  dayOfWeekPatterns: Map<number, { avgPulse: number; peakHour: number; avgCrowd: number }>;
  bestConditions: { sound: number; light: number; resultingPulse: number };
  worstConditions: { sound: number; light: number; resultingPulse: number };
}

function analyzeHistoricalPatterns(data: SensorData[]): HistoricalPattern {
  const hourlyData = new Map<number, { pulses: number[]; crowds: number[]; sounds: number[]; lights: number[] }>();
  const dayData = new Map<number, { pulses: number[]; peakHours: number[]; crowds: number[] }>();
  
  let bestPulse = 0;
  let bestConditions = { sound: 72, light: 200, resultingPulse: 75 };
  let worstPulse = 100;
  let worstConditions = { sound: 72, light: 200, resultingPulse: 50 };
  
  data.forEach(d => {
    const date = new Date(d.timestamp);
    const hour = date.getHours();
    const day = date.getDay();
    const pulse = calculatePulseScore(d.decibels, d.light).score;
    const crowd = d.occupancy?.current || 0;
    
    // Hourly patterns
    if (!hourlyData.has(hour)) {
      hourlyData.set(hour, { pulses: [], crowds: [], sounds: [], lights: [] });
    }
    const hourEntry = hourlyData.get(hour)!;
    hourEntry.pulses.push(pulse);
    hourEntry.crowds.push(crowd);
    if (d.decibels) hourEntry.sounds.push(d.decibels);
    if (d.light) hourEntry.lights.push(d.light);
    
    // Day of week patterns
    if (!dayData.has(day)) {
      dayData.set(day, { pulses: [], peakHours: [], crowds: [] });
    }
    const dayEntry = dayData.get(day)!;
    dayEntry.pulses.push(pulse);
    dayEntry.crowds.push(crowd);
    
    // Track best/worst conditions
    if (pulse > bestPulse) {
      bestPulse = pulse;
      bestConditions = { sound: d.decibels || 72, light: d.light || 200, resultingPulse: pulse };
    }
    if (pulse < worstPulse && pulse > 0) {
      worstPulse = pulse;
      worstConditions = { sound: d.decibels || 72, light: d.light || 200, resultingPulse: pulse };
    }
  });
  
  // Calculate averages
  const hourlyAverages = new Map<number, { pulse: number; crowd: number; sound: number; light: number }>();
  hourlyData.forEach((entry, hour) => {
    hourlyAverages.set(hour, {
      pulse: avg(entry.pulses),
      crowd: avg(entry.crowds),
      sound: avg(entry.sounds),
      light: avg(entry.lights),
    });
  });
  
  const dayOfWeekPatterns = new Map<number, { avgPulse: number; peakHour: number; avgCrowd: number }>();
  dayData.forEach((entry, day) => {
    // Find peak hour for this day
    let peakHour = 21; // default
    let maxCrowd = 0;
    hourlyData.forEach((hourEntry, hour) => {
      const avgCrowd = avg(hourEntry.crowds);
      if (avgCrowd > maxCrowd) {
        maxCrowd = avgCrowd;
        peakHour = hour;
      }
    });
    
    dayOfWeekPatterns.set(day, {
      avgPulse: avg(entry.pulses),
      peakHour,
      avgCrowd: avg(entry.crowds),
    });
  });
  
  return {
    hourlyAverages,
    dayOfWeekPatterns,
    bestConditions,
    worstConditions,
  };
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ============ SMART ACTIONS ============

export function generateSmartActions(
  currentData: SensorData,
  historicalData: SensorData[],
  _weather?: { temperature: number; condition: string }
): SmartAction[] {
  const actions: SmartAction[] = [];
  const patterns = analyzeHistoricalPatterns(historicalData);
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();
  
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const hourPattern = patterns.hourlyAverages.get(currentHour);
  
  // Sound action with historical context
  if (currentData.decibels) {
    const currentSound = currentData.decibels;
    const historicalSound = hourPattern?.sound || 72;
    const bestSound = patterns.bestConditions.sound;
    
    if (currentSound > 80) {
      const whatWorkedBefore = historicalData
        .filter(d => d.decibels && d.decibels >= 70 && d.decibels <= 76)
        .slice(0, 5);
      
      const avgPulseWhenOptimal = whatWorkedBefore.length > 0
        ? avg(whatWorkedBefore.map(d => calculatePulseScore(d.decibels, d.light).score))
        : null;
      
      actions.push({
        id: 'smart-sound-high',
        priority: currentSound > 85 ? 'critical' : 'high',
        category: 'sound',
        title: 'Lower Music Volume',
        description: `Currently ${currentSound.toFixed(0)} dB — guests are struggling to chat.`,
        impact: avgPulseWhenOptimal 
          ? `When you hit 72-76 dB, your Pulse Score averages ${avgPulseWhenOptimal.toFixed(0)}`
          : 'Optimal sound levels increase dwell time by ~15%',
        confidence: 85,
        historicalContext: `Your typical sound at ${currentHour}:00 is ${historicalSound.toFixed(0)} dB`,
        whatWorked: `Best results came at ${bestSound.toFixed(0)} dB (Pulse: ${patterns.bestConditions.resultingPulse})`,
        currentValue: `${currentSound.toFixed(0)} dB`,
        suggestedValue: '72-76 dB',
      });
    } else if (currentSound < 65 && currentHour >= 18) {
      actions.push({
        id: 'smart-sound-low',
        priority: 'medium',
        category: 'sound',
        title: 'Boost the Energy',
        description: `Only ${currentSound.toFixed(0)} dB — feels quiet for evening.`,
        impact: 'Adding energy attracts energy. Quiet venues empty out.',
        confidence: 75,
        historicalContext: `On ${dayNames[currentDay]}s at ${currentHour}:00, you usually run ${historicalSound.toFixed(0)} dB`,
        currentValue: `${currentSound.toFixed(0)} dB`,
        suggestedValue: '70-75 dB',
      });
    }
  }
  
  // Light action with historical context
  if (currentData.light) {
    const currentLight = currentData.light;
    const historicalLight = hourPattern?.light || 200;
    
    if (currentLight > 400 && currentHour >= 19) {
      actions.push({
        id: 'smart-light-high',
        priority: 'medium',
        category: 'light',
        title: 'Dim for Evening Vibes',
        description: `${currentLight.toFixed(0)} lux is too bright for ${currentHour >= 21 ? 'late night' : 'evening'}.`,
        impact: 'Dimmer lighting after 7pm increases average tab by 18%',
        confidence: 80,
        historicalContext: `You typically run ${historicalLight.toFixed(0)} lux at this hour`,
        whatWorked: `Your best scores came at ${patterns.bestConditions.light.toFixed(0)} lux`,
        currentValue: `${currentLight.toFixed(0)} lux`,
        suggestedValue: '100-200 lux',
      });
    }
  }
  
  // Crowd-based action
  if (currentData.occupancy) {
    const currentCrowd = currentData.occupancy.current;
    const expectedCrowd = hourPattern?.crowd || 0;
    
    if (expectedCrowd > 0 && currentCrowd < expectedCrowd * 0.6) {
      const deviation = Math.round((1 - currentCrowd / expectedCrowd) * 100);
      actions.push({
        id: 'smart-crowd-low',
        priority: 'medium',
        category: 'crowd',
        title: 'Slower Than Usual',
        description: `${deviation}% below typical for ${dayNames[currentDay]} at ${currentHour}:00.`,
        impact: 'Consider a quick social post or special to drive traffic',
        confidence: 70,
        historicalContext: `Usually ${expectedCrowd.toFixed(0)} people by now`,
        currentValue: `${currentCrowd} people`,
        suggestedValue: `${expectedCrowd.toFixed(0)}+ expected`,
      });
    }
  }
  
  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  
  return actions;
}

// ============ TREND ALERTS ============

export function detectTrendAlerts(
  currentData: SensorData,
  historicalData: SensorData[]
): TrendAlert[] {
  const alerts: TrendAlert[] = [];
  const patterns = analyzeHistoricalPatterns(historicalData);
  const now = new Date();
  const currentHour = now.getHours();
  const hourPattern = patterns.hourlyAverages.get(currentHour);
  
  if (!hourPattern) return alerts;
  
  // Crowd deviation
  if (currentData.occupancy) {
    const currentCrowd = currentData.occupancy.current;
    const normalCrowd = hourPattern.crowd;
    
    if (normalCrowd > 5) {
      const deviation = ((currentCrowd - normalCrowd) / normalCrowd) * 100;
      
      if (deviation < -30) {
        alerts.push({
          id: 'alert-crowd-low',
          type: 'warning',
          metric: 'crowd',
          title: 'Crowd Below Normal',
          message: `${Math.abs(Math.round(deviation))}% fewer people than usual for this hour`,
          deviation: Math.round(deviation),
          normalValue: Math.round(normalCrowd),
          currentValue: currentCrowd,
          timestamp: now,
        });
      } else if (deviation > 40) {
        alerts.push({
          id: 'alert-crowd-high',
          type: 'opportunity',
          metric: 'crowd',
          title: 'Busier Than Usual!',
          message: `${Math.round(deviation)}% more people than typical — capitalize on the momentum`,
          deviation: Math.round(deviation),
          normalValue: Math.round(normalCrowd),
          currentValue: currentCrowd,
          timestamp: now,
        });
      }
    }
  }
  
  // Pulse Score deviation
  const currentPulse = calculatePulseScore(currentData.decibels, currentData.light).score;
  const normalPulse = hourPattern.pulse;
  
  if (normalPulse > 0) {
    const pulseDeviation = ((currentPulse - normalPulse) / normalPulse) * 100;
    
    if (pulseDeviation < -20) {
      alerts.push({
        id: 'alert-pulse-low',
        type: 'warning',
        metric: 'pulse',
        title: 'Pulse Score Dipping',
        message: `Running ${Math.abs(Math.round(pulseDeviation))}% below your usual score`,
        deviation: Math.round(pulseDeviation),
        normalValue: Math.round(normalPulse),
        currentValue: currentPulse,
        timestamp: now,
      });
    }
  }
  
  return alerts;
}

// ============ PEAK PREDICTIONS ============

export function predictPeakHour(
  historicalData: SensorData[],
  dayOfWeek?: number
): PeakPrediction {
  const now = new Date();
  const targetDay = dayOfWeek ?? now.getDay();
  const patterns = analyzeHistoricalPatterns(historicalData);
  
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  // Find peak hour from historical data for this day
  let peakHour = 21;
  let peakOccupancy = 0;
  
  patterns.hourlyAverages.forEach((avg, hour) => {
    if (avg.crowd > peakOccupancy) {
      peakOccupancy = avg.crowd;
      peakHour = hour;
    }
  });
  
  // Get last week's data for comparison
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const lastWeekData = historicalData.filter(d => {
    const date = new Date(d.timestamp);
    return date.getDay() === targetDay && date >= oneWeekAgo;
  });
  
  let lastWeekPeak = 0;
  lastWeekData.forEach(d => {
    if (d.occupancy?.current && d.occupancy.current > lastWeekPeak) {
      lastWeekPeak = d.occupancy.current;
    }
  });
  
  const confidence = historicalData.length > 100 ? 85 : historicalData.length > 50 ? 70 : 50;
  
  return {
    predictedPeakHour: peakHour,
    predictedPeakOccupancy: Math.round(peakOccupancy),
    confidence,
    basedOn: `${historicalData.length} readings over past weeks`,
    comparisonToLastWeek: lastWeekPeak > 0 ? {
      lastWeekPeak,
      difference: peakOccupancy > lastWeekPeak 
        ? `+${Math.round(((peakOccupancy - lastWeekPeak) / lastWeekPeak) * 100)}% vs last ${dayNames[targetDay]}`
        : `${Math.round(((peakOccupancy - lastWeekPeak) / lastWeekPeak) * 100)}% vs last ${dayNames[targetDay]}`,
    } : undefined,
  };
}

// ============ WHAT-IF SCENARIOS ============

export function generateWhatIfScenarios(
  currentData: SensorData,
  historicalData: SensorData[]
): WhatIfScenario[] {
  const scenarios: WhatIfScenario[] = [];
  const patterns = analyzeHistoricalPatterns(historicalData);
  
  const currentPulse = calculatePulseScore(currentData.decibels, currentData.light).score;
  const bestPulse = patterns.bestConditions.resultingPulse;
  
  // What if we adjust sound?
  if (currentData.decibels && currentData.decibels > 78) {
    const optimalSoundData = historicalData.filter(d => 
      d.decibels && d.decibels >= 70 && d.decibels <= 76
    );
    const avgPulseAtOptimal = optimalSoundData.length > 0
      ? avg(optimalSoundData.map(d => calculatePulseScore(d.decibels, d.light).score))
      : currentPulse + 8;
    
    scenarios.push({
      id: 'whatif-sound',
      action: 'Lower music to 72-76 dB',
      predictedImpact: {
        pulseScore: Math.round(avgPulseAtOptimal - currentPulse),
        dwellTime: 12,
        description: `Pulse Score could increase ~${Math.round(avgPulseAtOptimal - currentPulse)} points`,
      },
      confidence: 75,
      basedOn: `${optimalSoundData.length} past readings at optimal levels`,
    });
  }
  
  // What if we adjust lighting?
  if (currentData.light && currentData.light > 350 && new Date().getHours() >= 19) {
    const dimLightData = historicalData.filter(d => 
      d.light && d.light >= 80 && d.light <= 200
    );
    const avgPulseWhenDim = dimLightData.length > 0
      ? avg(dimLightData.map(d => calculatePulseScore(d.decibels, d.light).score))
      : currentPulse + 5;
    
    scenarios.push({
      id: 'whatif-light',
      action: 'Dim lights to 100-200 lux',
      predictedImpact: {
        pulseScore: Math.round(avgPulseWhenDim - currentPulse),
        dwellTime: 8,
        description: 'Evening ambiance typically adds 8+ min to dwell time',
      },
      confidence: 70,
      basedOn: `${dimLightData.length} evening readings with dimmer lighting`,
    });
  }
  
  // What if we optimize everything?
  scenarios.push({
    id: 'whatif-optimal',
    action: 'Hit all optimal targets',
    predictedImpact: {
      pulseScore: Math.round(bestPulse - currentPulse),
      dwellTime: 15,
      description: `Your best recorded Pulse Score was ${bestPulse}`,
    },
    confidence: 60,
    basedOn: 'Your historical best performance',
  });
  
  return scenarios;
}

// ============ DAILY BRIEFING ============

export function generateDailyBriefing(
  historicalData: SensorData[],
  weather?: { temperature: number; condition: string },
  specialEvents?: string[]
): DailyBriefing {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  const patterns = analyzeHistoricalPatterns(historicalData);
  const dayPattern = patterns.dayOfWeekPatterns.get(day);
  const peak = predictPeakHour(historicalData, day);
  
  // Determine greeting based on time
  let greeting = 'Good evening';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 17) greeting = 'Good afternoon';
  
  // Determine day type
  const isWeekend = day === 0 || day === 5 || day === 6;
  const avgPulse = dayPattern?.avgPulse || 70;
  let todayType = `${dayNames[day]}`;
  
  if (day === 5) todayType = 'Friday Night';
  else if (day === 6) todayType = 'Saturday Night';
  else if (day === 0) todayType = 'Sunday Funday';
  else todayType = `${dayNames[day]} Evening`;
  
  // Generate insights
  const insights: string[] = [];
  
  if (peak.predictedPeakOccupancy > 0) {
    insights.push(`Expect peak around ${formatHour(peak.predictedPeakHour)} with ~${peak.predictedPeakOccupancy} guests`);
  }
  
  if (dayPattern && avgPulse > 0) {
    insights.push(`Your average Pulse Score on ${dayNames[day]}s is ${Math.round(avgPulse)}`);
  }
  
  if (patterns.bestConditions.resultingPulse > 80) {
    insights.push(`Your best score (${patterns.bestConditions.resultingPulse}) came at ${patterns.bestConditions.sound.toFixed(0)} dB, ${patterns.bestConditions.light.toFixed(0)} lux`);
  }
  
  // Weather impact
  let weatherImpact: string | undefined;
  if (weather) {
    if (weather.temperature > 85) {
      weatherImpact = `Hot day (${weather.temperature}°F) — expect earlier arrivals seeking AC`;
    } else if (weather.temperature < 45) {
      weatherImpact = `Cold night (${weather.temperature}°F) — cozy vibes, keep it warm`;
    } else if (weather.condition.toLowerCase().includes('rain')) {
      weatherImpact = 'Rainy weather — could slow foot traffic, but those who come stay longer';
    }
  }
  
  // Suggested focus
  let suggestedFocus = 'Maintain steady atmosphere';
  if (isWeekend) {
    suggestedFocus = 'Energy management — it\'s go time';
  } else if (day === 4) { // Thursday
    suggestedFocus = 'Build momentum for the weekend';
  } else {
    suggestedFocus = 'Create a welcoming, relaxed atmosphere';
  }
  
  return {
    greeting,
    todayType,
    expectedPeak: peak,
    keyInsights: insights,
    suggestedFocus,
    weatherImpact,
    specialEvents,
  };
}

function formatHour(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

// ============ EXPORT ============

export default {
  generateSmartActions,
  detectTrendAlerts,
  predictPeakHour,
  generateWhatIfScenarios,
  generateDailyBriefing,
};
