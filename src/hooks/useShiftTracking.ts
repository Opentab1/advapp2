/**
 * useShiftTracking - Tracks metrics throughout a shift for end-of-shift summary
 * 
 * Addresses "Shift Summary" problem:
 * - Tracks when shift started
 * - Records metric snapshots throughout
 * - Calculates shift statistics
 * - Generates end-of-shift summary
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ============ TYPES ============

export interface ShiftSnapshot {
  timestamp: number;
  pulseScore: number | null;
  decibels: number | null;
  light: number | null;
  occupancy: number;
}

export interface ShiftStats {
  // Time
  startTime: number;
  endTime: number | null;
  duration: number; // minutes
  
  // Pulse Score
  avgPulseScore: number;
  minPulseScore: number;
  maxPulseScore: number;
  pulseScoreHistory: { time: number; score: number }[];
  
  // Occupancy
  totalVisitors: number;
  peakOccupancy: number;
  peakOccupancyTime: number | null;
  avgOccupancy: number;
  
  // Environment
  avgDecibels: number | null;
  avgLight: number | null;
  
  // Time in zones
  timeInOptimal: number; // minutes with Pulse 85+
  timeInGood: number; // minutes with Pulse 60-84
  timeInNeedsWork: number; // minutes with Pulse < 60
  
  // Highlights
  bestHour: { hour: number; avgPulse: number } | null;
  worstHour: { hour: number; avgPulse: number } | null;
}

export interface ShiftSummary {
  stats: ShiftStats;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  gradeMessage: string;
  highlights: string[];
  improvements: string[];
  comparison: {
    vsPreviousShift: number | null; // pulse score difference
    vsAverage: number | null;
  };
}

export interface UseShiftTrackingOptions {
  enabled?: boolean;
  snapshotInterval?: number; // ms between snapshots
  autoDetectShift?: boolean; // auto-start when occupancy > 0
}

export interface UseShiftTrackingReturn {
  // State
  isShiftActive: boolean;
  shiftStartTime: number | null;
  currentStats: ShiftStats | null;
  
  // Actions
  startShift: () => void;
  endShift: () => ShiftSummary | null;
  recordSnapshot: (snapshot: Omit<ShiftSnapshot, 'timestamp'>) => void;
  
  // Summary
  generateSummary: () => ShiftSummary | null;
  
  // History
  previousShifts: ShiftSummary[];
  clearHistory: () => void;
}

// ============ CONSTANTS ============

const STORAGE_KEY = 'pulse_shift_history';
const MAX_SHIFT_HISTORY = 14; // Keep 2 weeks of shifts

// ============ MAIN HOOK ============

export function useShiftTracking(options: UseShiftTrackingOptions = {}): UseShiftTrackingReturn {
  const {
    enabled = true,
    snapshotInterval = 60000, // 1 minute default
    autoDetectShift = true,
  } = options;

  // State
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [shiftStartTime, setShiftStartTime] = useState<number | null>(null);
  const [snapshots, setSnapshots] = useState<ShiftSnapshot[]>([]);
  const [previousShifts, setPreviousShifts] = useState<ShiftSummary[]>([]);

  // Refs
  const lastOccupancyRef = useRef(0);

  // Load previous shifts from storage
  useEffect(() => {
    if (!enabled) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (Array.isArray(data)) {
          setPreviousShifts(data);
        }
      }
    } catch (e) {
      console.error('Failed to load shift history:', e);
    }
  }, [enabled]);

  // Auto-detect shift start
  const checkAutoStart = useCallback((occupancy: number) => {
    if (!autoDetectShift || isShiftActive) return;
    
    // Start shift when occupancy goes from 0 to > 0
    if (lastOccupancyRef.current === 0 && occupancy > 0) {
      setIsShiftActive(true);
      setShiftStartTime(Date.now());
      setSnapshots([]);
    }
    
    lastOccupancyRef.current = occupancy;
  }, [autoDetectShift, isShiftActive]);

  // Start shift manually
  const startShift = useCallback(() => {
    setIsShiftActive(true);
    setShiftStartTime(Date.now());
    setSnapshots([]);
  }, []);

  // Record a snapshot
  const recordSnapshot = useCallback((snapshot: Omit<ShiftSnapshot, 'timestamp'>) => {
    if (!isShiftActive) {
      // Check for auto-start
      checkAutoStart(snapshot.occupancy);
      if (!isShiftActive) return;
    }

    const fullSnapshot: ShiftSnapshot = {
      ...snapshot,
      timestamp: Date.now(),
    };

    setSnapshots(prev => [...prev, fullSnapshot]);
  }, [isShiftActive, checkAutoStart]);

  // Calculate current stats
  const calculateStats = useCallback((): ShiftStats | null => {
    if (!shiftStartTime || snapshots.length === 0) return null;

    const now = Date.now();
    const duration = Math.round((now - shiftStartTime) / 60000);

    // Filter valid pulse scores
    const validPulseSnapshots = snapshots.filter(s => s.pulseScore !== null);
    const pulseScores = validPulseSnapshots.map(s => s.pulseScore as number);

    // Calculate averages
    const avgPulseScore = pulseScores.length > 0
      ? Math.round(pulseScores.reduce((a, b) => a + b, 0) / pulseScores.length)
      : 0;
    
    const minPulseScore = pulseScores.length > 0 ? Math.min(...pulseScores) : 0;
    const maxPulseScore = pulseScores.length > 0 ? Math.max(...pulseScores) : 0;

    // Occupancy stats
    const occupancies = snapshots.map(s => s.occupancy);
    const peakOccupancy = Math.max(...occupancies, 0);
    const peakSnapshot = snapshots.find(s => s.occupancy === peakOccupancy);
    const avgOccupancy = Math.round(occupancies.reduce((a, b) => a + b, 0) / occupancies.length);

    // Environment averages
    const validDecibels = snapshots.filter(s => s.decibels !== null).map(s => s.decibels as number);
    const avgDecibels = validDecibels.length > 0
      ? Math.round(validDecibels.reduce((a, b) => a + b, 0) / validDecibels.length)
      : null;

    const validLight = snapshots.filter(s => s.light !== null).map(s => s.light as number);
    const avgLight = validLight.length > 0
      ? Math.round(validLight.reduce((a, b) => a + b, 0) / validLight.length)
      : null;

    // Time in zones (approximate based on snapshot frequency)
    const snapshotMinutes = snapshotInterval / 60000;
    let timeInOptimal = 0;
    let timeInGood = 0;
    let timeInNeedsWork = 0;

    validPulseSnapshots.forEach(s => {
      const score = s.pulseScore as number;
      if (score >= 85) timeInOptimal += snapshotMinutes;
      else if (score >= 60) timeInGood += snapshotMinutes;
      else timeInNeedsWork += snapshotMinutes;
    });

    // Group by hour for best/worst hour
    const hourlyScores: Record<number, number[]> = {};
    validPulseSnapshots.forEach(s => {
      const hour = new Date(s.timestamp).getHours();
      if (!hourlyScores[hour]) hourlyScores[hour] = [];
      hourlyScores[hour].push(s.pulseScore as number);
    });

    const hourlyAverages = Object.entries(hourlyScores).map(([hour, scores]) => ({
      hour: parseInt(hour),
      avgPulse: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    }));

    const bestHour = hourlyAverages.length > 0
      ? hourlyAverages.reduce((best, curr) => curr.avgPulse > best.avgPulse ? curr : best)
      : null;

    const worstHour = hourlyAverages.length > 0
      ? hourlyAverages.reduce((worst, curr) => curr.avgPulse < worst.avgPulse ? curr : worst)
      : null;

    // Estimate total visitors (simplified: sum of max hourly occupancies)
    const hourlyMaxOccupancy: Record<number, number> = {};
    snapshots.forEach(s => {
      const hour = new Date(s.timestamp).getHours();
      hourlyMaxOccupancy[hour] = Math.max(hourlyMaxOccupancy[hour] || 0, s.occupancy);
    });
    const totalVisitors = Object.values(hourlyMaxOccupancy).reduce((a, b) => a + b, 0);

    return {
      startTime: shiftStartTime,
      endTime: null,
      duration,
      avgPulseScore,
      minPulseScore,
      maxPulseScore,
      pulseScoreHistory: validPulseSnapshots.map(s => ({
        time: s.timestamp,
        score: s.pulseScore as number,
      })),
      totalVisitors,
      peakOccupancy,
      peakOccupancyTime: peakSnapshot?.timestamp ?? null,
      avgOccupancy,
      avgDecibels,
      avgLight,
      timeInOptimal: Math.round(timeInOptimal),
      timeInGood: Math.round(timeInGood),
      timeInNeedsWork: Math.round(timeInNeedsWork),
      bestHour,
      worstHour,
    };
  }, [shiftStartTime, snapshots, snapshotInterval]);

  // Generate summary
  const generateSummary = useCallback((): ShiftSummary | null => {
    const stats = calculateStats();
    if (!stats) return null;

    // Calculate grade
    const optimalPercent = stats.duration > 0 
      ? (stats.timeInOptimal / stats.duration) * 100 
      : 0;
    
    let grade: ShiftSummary['grade'];
    let gradeMessage: string;

    if (optimalPercent >= 80) {
      grade = 'A';
      gradeMessage = 'Outstanding shift! Your venue was in peak form.';
    } else if (optimalPercent >= 60) {
      grade = 'B';
      gradeMessage = 'Great shift! Most of the night was on point.';
    } else if (optimalPercent >= 40) {
      grade = 'C';
      gradeMessage = 'Decent shift. Some room for improvement.';
    } else if (optimalPercent >= 20) {
      grade = 'D';
      gradeMessage = 'Challenging night. Check what went wrong.';
    } else {
      grade = 'F';
      gradeMessage = 'Tough shift. Let\'s figure out what happened.';
    }

    // Generate highlights
    const highlights: string[] = [];
    if (stats.maxPulseScore >= 90) {
      highlights.push(`Hit ${stats.maxPulseScore} Pulse Score at peak!`);
    }
    if (stats.bestHour) {
      highlights.push(`Best hour: ${formatHour(stats.bestHour.hour)} (avg ${stats.bestHour.avgPulse})`);
    }
    if (stats.peakOccupancy > 0) {
      highlights.push(`Peak crowd: ${stats.peakOccupancy} people`);
    }
    if (stats.timeInOptimal > 30) {
      highlights.push(`${stats.timeInOptimal} minutes in optimal zone`);
    }

    // Generate improvements
    const improvements: string[] = [];
    if (stats.avgDecibels && stats.avgDecibels > 85) {
      improvements.push('Sound averaged too loud - guests may leave early');
    }
    if (stats.avgDecibels && stats.avgDecibels < 65) {
      improvements.push('Sound was quiet - energy could be higher');
    }
    if (stats.worstHour && stats.worstHour.avgPulse < 60) {
      improvements.push(`${formatHour(stats.worstHour.hour)} was rough (${stats.worstHour.avgPulse}) - investigate`);
    }
    if (stats.timeInNeedsWork > 60) {
      improvements.push('Spent over an hour below target - check factors');
    }

    // Comparison to previous shifts
    const lastShift = previousShifts[0];
    const vsPreviousShift = lastShift 
      ? stats.avgPulseScore - lastShift.stats.avgPulseScore 
      : null;
    
    const avgOfPrevious = previousShifts.length > 0
      ? previousShifts.reduce((sum, s) => sum + s.stats.avgPulseScore, 0) / previousShifts.length
      : null;
    const vsAverage = avgOfPrevious !== null 
      ? Math.round(stats.avgPulseScore - avgOfPrevious) 
      : null;

    return {
      stats: { ...stats, endTime: Date.now() },
      grade,
      gradeMessage,
      highlights,
      improvements,
      comparison: {
        vsPreviousShift,
        vsAverage,
      },
    };
  }, [calculateStats, previousShifts]);

  // End shift
  const endShift = useCallback((): ShiftSummary | null => {
    const summary = generateSummary();
    
    if (summary) {
      // Save to history
      setPreviousShifts(prev => {
        const updated = [summary, ...prev].slice(0, MAX_SHIFT_HISTORY);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        } catch (e) {
          console.error('Failed to save shift history:', e);
        }
        return updated;
      });
    }

    // Reset state
    setIsShiftActive(false);
    setShiftStartTime(null);
    setSnapshots([]);

    return summary;
  }, [generateSummary]);

  // Clear history
  const clearHistory = useCallback(() => {
    setPreviousShifts([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error('Failed to clear shift history:', e);
    }
  }, []);

  return {
    isShiftActive,
    shiftStartTime,
    currentStats: calculateStats(),
    startShift,
    endShift,
    recordSnapshot,
    generateSummary,
    previousShifts,
    clearHistory,
  };
}

// ============ HELPERS ============

function formatHour(hour: number): string {
  if (hour === 0) return '12am';
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return '12pm';
  return `${hour - 12}pm`;
}

export default useShiftTracking;
