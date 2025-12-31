/**
 * useTimeContext - Provides time-aware expectations and comparisons
 * 
 * Addresses the "Time-of-Day Context Missing" problem:
 * - Different expectations for different times/days
 * - "For Saturday 10pm, target is 85+"
 * - Historical comparison to same time last week
 * - Anomaly detection for sudden changes
 */

import { useState, useEffect, useMemo, useCallback } from 'react';

// ============ TYPES ============

export interface TimeExpectation {
  targetScore: number;
  minAcceptable: number;
  label: string;
  description: string;
  intensity: 'dead' | 'slow' | 'building' | 'busy' | 'peak' | 'winding-down';
}

export interface ScoreContext {
  // Current expectations
  expectation: TimeExpectation;
  
  // How current score compares
  meetsTarget: boolean;
  exceedsTarget: boolean;
  belowMinimum: boolean;
  gapFromTarget: number;
  
  // Contextual messaging
  statusMessage: string;
  encouragement: string;
  
  // Time info
  currentPeriod: string;
  nextPeriodIn: number | null; // minutes until next period
  nextPeriodName: string | null;
}

export interface HistoricalComparison {
  // Same day last week
  lastWeekSameDay: {
    avgPulseScore: number | null;
    avgOccupancy: number | null;
    peakHour: number | null;
  } | null;
  
  // Comparison
  vsPulseScore: number | null;
  vsOccupancy: number | null;
  
  // Best records
  bestSameDayScore: number | null;
  bestSameDayDate: string | null;
}

export interface MetricAnomaly {
  metric: 'sound' | 'light' | 'occupancy' | 'pulse';
  timestamp: number;
  previousValue: number;
  currentValue: number;
  change: number;
  changePercent: number;
  direction: 'spike' | 'drop';
  severity: 'minor' | 'significant' | 'major';
  message: string;
}

// ============ CONSTANTS ============

// Day of week: 0 = Sunday, 1 = Monday, etc.
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Time period definitions
const TIME_PERIODS = {
  earlyDay: { start: 6, end: 11, label: 'Morning' },
  afternoon: { start: 11, end: 16, label: 'Afternoon' },
  prePeak: { start: 16, end: 19, label: 'Pre-Rush' },
  earlyPeak: { start: 19, end: 21, label: 'Early Evening' },
  peak: { start: 21, end: 24, label: 'Peak Hours' },
  latePeak: { start: 0, end: 2, label: 'Late Night' },
  afterHours: { start: 2, end: 6, label: 'After Hours' },
};

// Expected scores by day and time period
// Format: [targetScore, minAcceptable, intensity]
const EXPECTATIONS: Record<number, Record<string, [number, number, TimeExpectation['intensity']]>> = {
  // Sunday
  0: {
    earlyDay: [60, 40, 'dead'],
    afternoon: [65, 50, 'slow'],
    prePeak: [70, 55, 'slow'],
    earlyPeak: [75, 60, 'building'],
    peak: [80, 65, 'busy'],
    latePeak: [70, 55, 'winding-down'],
    afterHours: [50, 30, 'dead'],
  },
  // Monday
  1: {
    earlyDay: [55, 35, 'dead'],
    afternoon: [60, 45, 'dead'],
    prePeak: [65, 50, 'slow'],
    earlyPeak: [70, 55, 'slow'],
    peak: [75, 60, 'building'],
    latePeak: [65, 50, 'winding-down'],
    afterHours: [50, 30, 'dead'],
  },
  // Tuesday
  2: {
    earlyDay: [55, 35, 'dead'],
    afternoon: [60, 45, 'dead'],
    prePeak: [65, 50, 'slow'],
    earlyPeak: [72, 57, 'building'],
    peak: [78, 63, 'busy'],
    latePeak: [68, 53, 'winding-down'],
    afterHours: [50, 30, 'dead'],
  },
  // Wednesday
  3: {
    earlyDay: [55, 35, 'dead'],
    afternoon: [62, 47, 'slow'],
    prePeak: [68, 53, 'slow'],
    earlyPeak: [75, 60, 'building'],
    peak: [80, 65, 'busy'],
    latePeak: [70, 55, 'winding-down'],
    afterHours: [50, 30, 'dead'],
  },
  // Thursday
  4: {
    earlyDay: [58, 38, 'dead'],
    afternoon: [65, 50, 'slow'],
    prePeak: [72, 57, 'building'],
    earlyPeak: [78, 63, 'building'],
    peak: [85, 70, 'peak'],
    latePeak: [75, 60, 'busy'],
    afterHours: [55, 35, 'dead'],
  },
  // Friday
  5: {
    earlyDay: [60, 40, 'dead'],
    afternoon: [68, 53, 'slow'],
    prePeak: [75, 60, 'building'],
    earlyPeak: [82, 67, 'busy'],
    peak: [90, 75, 'peak'],
    latePeak: [82, 67, 'busy'],
    afterHours: [60, 40, 'slow'],
  },
  // Saturday
  6: {
    earlyDay: [62, 42, 'slow'],
    afternoon: [70, 55, 'building'],
    prePeak: [78, 63, 'building'],
    earlyPeak: [85, 70, 'busy'],
    peak: [92, 77, 'peak'],
    latePeak: [85, 70, 'peak'],
    afterHours: [65, 45, 'slow'],
  },
};

// ============ HELPER FUNCTIONS ============

function getCurrentPeriod(hour: number): string {
  if (hour >= 6 && hour < 11) return 'earlyDay';
  if (hour >= 11 && hour < 16) return 'afternoon';
  if (hour >= 16 && hour < 19) return 'prePeak';
  if (hour >= 19 && hour < 21) return 'earlyPeak';
  if (hour >= 21 && hour < 24) return 'peak';
  if (hour >= 0 && hour < 2) return 'latePeak';
  return 'afterHours';
}

function getNextPeriod(currentPeriod: string): { name: string; startsAt: number } | null {
  const periodOrder = ['earlyDay', 'afternoon', 'prePeak', 'earlyPeak', 'peak', 'latePeak', 'afterHours'];
  const currentIndex = periodOrder.indexOf(currentPeriod);
  
  if (currentIndex === -1 || currentIndex === periodOrder.length - 1) return null;
  
  const nextPeriodKey = periodOrder[currentIndex + 1];
  const nextPeriod = TIME_PERIODS[nextPeriodKey as keyof typeof TIME_PERIODS];
  
  return {
    name: nextPeriod.label,
    startsAt: nextPeriod.start,
  };
}

function getMinutesUntilHour(targetHour: number): number {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  let targetMinutes = targetHour * 60;
  
  if (targetMinutes <= currentMinutes) {
    targetMinutes += 24 * 60; // Next day
  }
  
  return targetMinutes - currentMinutes;
}

// ============ MAIN HOOK ============

export function useTimeContext(currentPulseScore: number | null) {
  const [now, setNow] = useState(new Date());

  // Update time every minute
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const dayOfWeek = now.getDay();
  const hour = now.getHours();
  const dayName = DAY_NAMES[dayOfWeek];
  const periodKey = getCurrentPeriod(hour);
  const periodInfo = TIME_PERIODS[periodKey as keyof typeof TIME_PERIODS];

  // Get expectations for current time
  const expectation = useMemo((): TimeExpectation => {
    const dayExpectations = EXPECTATIONS[dayOfWeek];
    const [targetScore, minAcceptable, intensity] = dayExpectations[periodKey];
    
    return {
      targetScore,
      minAcceptable,
      label: `${dayName} ${periodInfo.label}`,
      description: getIntensityDescription(intensity),
      intensity,
    };
  }, [dayOfWeek, periodKey, dayName, periodInfo.label]);

  // Calculate score context
  const scoreContext = useMemo((): ScoreContext => {
    const meetsTarget = currentPulseScore !== null && currentPulseScore >= expectation.targetScore;
    const exceedsTarget = currentPulseScore !== null && currentPulseScore >= expectation.targetScore + 5;
    const belowMinimum = currentPulseScore !== null && currentPulseScore < expectation.minAcceptable;
    const gapFromTarget = currentPulseScore !== null 
      ? currentPulseScore - expectation.targetScore 
      : 0;

    const nextPeriod = getNextPeriod(periodKey);
    const nextPeriodIn = nextPeriod ? getMinutesUntilHour(nextPeriod.startsAt) : null;

    return {
      expectation,
      meetsTarget,
      exceedsTarget,
      belowMinimum,
      gapFromTarget,
      statusMessage: getStatusMessage(currentPulseScore, expectation, gapFromTarget),
      encouragement: getEncouragement(meetsTarget, exceedsTarget, belowMinimum, expectation.intensity),
      currentPeriod: periodInfo.label,
      nextPeriodIn,
      nextPeriodName: nextPeriod?.name ?? null,
    };
  }, [currentPulseScore, expectation, periodKey, periodInfo.label]);

  return {
    dayOfWeek,
    dayName,
    hour,
    periodKey,
    currentPeriod: periodInfo.label,
    expectation,
    scoreContext,
  };
}

// ============ ATTRIBUTION HOOK ============

interface MetricHistory {
  timestamp: number;
  decibels: number | null;
  light: number | null;
  pulseScore: number | null;
  occupancy: number;
}

export function useMetricAttribution() {
  const [history, setHistory] = useState<MetricHistory[]>([]);
  const [anomalies, setAnomalies] = useState<MetricAnomaly[]>([]);

  // Add a new reading to history
  const recordMetrics = useCallback((metrics: Omit<MetricHistory, 'timestamp'>) => {
    const now = Date.now();
    
    setHistory(prev => {
      const newHistory = [...prev, { ...metrics, timestamp: now }];
      // Keep last 30 minutes of history (readings every 30 seconds = 60 readings)
      return newHistory.slice(-60);
    });

    // Check for anomalies
    setHistory(prev => {
      if (prev.length < 2) return prev;
      
      const latest = prev[prev.length - 1];
      const previous = prev[prev.length - 2];
      const newAnomalies: MetricAnomaly[] = [];

      // Check sound anomaly
      if (latest.decibels !== null && previous.decibels !== null) {
        const change = latest.decibels - previous.decibels;
        if (Math.abs(change) >= 8) {
          newAnomalies.push(createAnomaly('sound', previous.decibels, latest.decibels, previous.timestamp));
        }
      }

      // Check light anomaly
      if (latest.light !== null && previous.light !== null) {
        const change = latest.light - previous.light;
        const changePercent = Math.abs(change / previous.light) * 100;
        if (changePercent >= 30 || Math.abs(change) >= 100) {
          newAnomalies.push(createAnomaly('light', previous.light, latest.light, previous.timestamp));
        }
      }

      // Check pulse score anomaly
      if (latest.pulseScore !== null && previous.pulseScore !== null) {
        const change = latest.pulseScore - previous.pulseScore;
        if (Math.abs(change) >= 10) {
          newAnomalies.push(createAnomaly('pulse', previous.pulseScore, latest.pulseScore, previous.timestamp));
        }
      }

      if (newAnomalies.length > 0) {
        setAnomalies(prev => [...prev, ...newAnomalies].slice(-10)); // Keep last 10 anomalies
      }

      return prev;
    });
  }, []);

  // Get the most impactful recent anomaly
  const primaryAnomaly = useMemo(() => {
    if (anomalies.length === 0) return null;
    
    // Return most recent major/significant anomaly, or most recent overall
    const sorted = [...anomalies].sort((a, b) => {
      const severityOrder = { major: 0, significant: 1, minor: 2 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      return b.timestamp - a.timestamp;
    });
    
    return sorted[0];
  }, [anomalies]);

  // Clear old anomalies (older than 30 minutes)
  useEffect(() => {
    const interval = setInterval(() => {
      const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
      setAnomalies(prev => prev.filter(a => a.timestamp > thirtyMinutesAgo));
    }, 60000);
    
    return () => clearInterval(interval);
  }, []);

  return {
    history,
    anomalies,
    primaryAnomaly,
    recordMetrics,
    clearAnomalies: () => setAnomalies([]),
  };
}

// ============ HELPER FUNCTIONS ============

function createAnomaly(
  metric: MetricAnomaly['metric'],
  previousValue: number,
  currentValue: number,
  timestamp: number
): MetricAnomaly {
  const change = currentValue - previousValue;
  const changePercent = Math.abs(change / previousValue) * 100;
  const direction: MetricAnomaly['direction'] = change > 0 ? 'spike' : 'drop';
  
  let severity: MetricAnomaly['severity'] = 'minor';
  if (metric === 'sound' && Math.abs(change) >= 15) severity = 'major';
  else if (metric === 'sound' && Math.abs(change) >= 10) severity = 'significant';
  else if (metric === 'light' && changePercent >= 50) severity = 'major';
  else if (metric === 'light' && changePercent >= 35) severity = 'significant';
  else if (metric === 'pulse' && Math.abs(change) >= 20) severity = 'major';
  else if (metric === 'pulse' && Math.abs(change) >= 15) severity = 'significant';

  const time = new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  
  const messages: Record<MetricAnomaly['metric'], Record<MetricAnomaly['direction'], string>> = {
    sound: {
      spike: `Sound spiked ${Math.abs(change).toFixed(0)} dB at ${time}`,
      drop: `Sound dropped ${Math.abs(change).toFixed(0)} dB at ${time}`,
    },
    light: {
      spike: `Light increased ${changePercent.toFixed(0)}% at ${time}`,
      drop: `Light decreased ${changePercent.toFixed(0)}% at ${time}`,
    },
    pulse: {
      spike: `Pulse Score jumped ${Math.abs(change)} points at ${time}`,
      drop: `Pulse Score dropped ${Math.abs(change)} points at ${time}`,
    },
    occupancy: {
      spike: `Crowd surged at ${time}`,
      drop: `Crowd thinned at ${time}`,
    },
  };

  return {
    metric,
    timestamp,
    previousValue,
    currentValue,
    change,
    changePercent,
    direction,
    severity,
    message: messages[metric][direction],
  };
}

function getIntensityDescription(intensity: TimeExpectation['intensity']): string {
  switch (intensity) {
    case 'dead': return 'Typically very quiet';
    case 'slow': return 'Usually slow';
    case 'building': return 'Building up';
    case 'busy': return 'Busy period';
    case 'peak': return 'Peak hours';
    case 'winding-down': return 'Winding down';
    default: return '';
  }
}

function getStatusMessage(
  score: number | null,
  expectation: TimeExpectation,
  gap: number
): string {
  if (score === null) return 'Waiting for data...';
  
  if (gap >= 10) return `Crushing it! ${gap} points above target`;
  if (gap >= 5) return `Above target by ${gap} points`;
  if (gap >= 0) return `On target for ${expectation.label}`;
  if (gap >= -5) return `${Math.abs(gap)} points below target`;
  if (gap >= -15) return `Needs attention: ${Math.abs(gap)} below target`;
  return `Critical: ${Math.abs(gap)} points below target`;
}

function getEncouragement(
  meetsTarget: boolean,
  exceedsTarget: boolean,
  belowMinimum: boolean,
  intensity: TimeExpectation['intensity']
): string {
  if (exceedsTarget) {
    return intensity === 'peak' ? "Your venue is in the zone!" : "Keep this energy going!";
  }
  if (meetsTarget) {
    return "Looking good for this time.";
  }
  if (belowMinimum) {
    return "Check your factors - something needs adjustment.";
  }
  return "A few tweaks could help.";
}

export default useTimeContext;
