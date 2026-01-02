/**
 * Pulse Score Calculation
 * 
 * Single source of truth for all scoring logic.
 * Clean, testable, well-documented.
 */

import { 
  OPTIMAL_RANGES, 
  FACTOR_WEIGHTS, 
  SCORE_THRESHOLDS,
  SCORE_COLORS,
  DWELL_TIME_THRESHOLDS,
} from './constants';

// ============ TYPES ============

export interface PulseScoreResult {
  score: number;
  status: 'optimal' | 'good' | 'poor';
  statusLabel: string;
  color: string;
  factors: {
    sound: FactorScore;
    light: FactorScore;
  };
}

export interface FactorScore {
  score: number;        // 0-100
  value: number | null; // Current sensor value
  inRange: boolean;     // Is value in optimal range?
  message: string;      // Human-readable status
}

// ============ CORE SCORING ============

/**
 * Calculate how well a value fits within an optimal range.
 * Returns 0-100 score.
 * 
 * - In range: 100
 * - Slightly out: 50-99 (linear falloff)
 * - Way out: 0-49
 */
export function calculateFactorScore(
  value: number | null | undefined,
  range: { min: number; max: number }
): number {
  if (value === null || value === undefined) return 0;
  
  // Perfect: value is in range
  if (value >= range.min && value <= range.max) {
    return 100;
  }
  
  // Calculate how far outside the range
  const rangeSize = range.max - range.min;
  const tolerance = rangeSize * 0.5; // 50% tolerance beyond range
  
  if (value < range.min) {
    const deviation = range.min - value;
    const penalty = (deviation / tolerance) * 100;
    return Math.max(0, Math.round(100 - penalty));
  } else {
    const deviation = value - range.max;
    const penalty = (deviation / tolerance) * 100;
    return Math.max(0, Math.round(100 - penalty));
  }
}

/**
 * Calculate the complete Pulse Score from sensor data.
 */
export function calculatePulseScore(
  decibels: number | null | undefined,
  light: number | null | undefined
): PulseScoreResult {
  // Calculate individual factor scores
  const soundScore = calculateFactorScore(decibels, OPTIMAL_RANGES.sound);
  const lightScore = calculateFactorScore(light, OPTIMAL_RANGES.light);
  
  // Weighted average
  const pulseScore = Math.round(
    (soundScore * FACTOR_WEIGHTS.sound) + 
    (lightScore * FACTOR_WEIGHTS.light)
  );
  
  // Determine status
  const status = getScoreStatus(pulseScore);
  const statusLabel = getScoreStatusLabel(pulseScore);
  const color = getScoreColor(pulseScore);
  
  return {
    score: pulseScore,
    status,
    statusLabel,
    color,
    factors: {
      sound: {
        score: soundScore,
        value: decibels ?? null,
        inRange: decibels !== null && decibels !== undefined && 
                 decibels >= OPTIMAL_RANGES.sound.min && 
                 decibels <= OPTIMAL_RANGES.sound.max,
        message: getSoundMessage(decibels, soundScore),
      },
      light: {
        score: lightScore,
        value: light ?? null,
        inRange: light !== null && light !== undefined && 
                 light >= OPTIMAL_RANGES.light.min && 
                 light <= OPTIMAL_RANGES.light.max,
        message: getLightMessage(light, lightScore),
      },
    },
  };
}

// ============ STATUS HELPERS ============

export function getScoreStatus(score: number | null): 'optimal' | 'good' | 'poor' {
  if (score === null) return 'poor';
  if (score >= SCORE_THRESHOLDS.optimal) return 'optimal';
  if (score >= SCORE_THRESHOLDS.good) return 'good';
  return 'poor';
}

export function getScoreStatusLabel(score: number | null): string {
  if (score === null) return 'No Data';
  if (score >= SCORE_THRESHOLDS.optimal) return 'Optimal';
  if (score >= SCORE_THRESHOLDS.good) return 'Good';
  return 'Adjust';
}

export function getScoreColor(score: number | null): string {
  if (score === null) return SCORE_COLORS.neutral;
  if (score >= SCORE_THRESHOLDS.optimal) return SCORE_COLORS.optimal;
  if (score >= SCORE_THRESHOLDS.good) return SCORE_COLORS.good;
  return SCORE_COLORS.poor;
}

// ============ FACTOR MESSAGES ============

function getSoundMessage(value: number | null | undefined, score: number): string {
  if (value === null || value === undefined) return 'No sound data';
  if (score >= 85) return 'Perfect for conversation';
  if (score >= 60) return 'Slightly elevated';
  if (value > OPTIMAL_RANGES.sound.max) return 'Too loud — guests can\'t talk';
  return 'Too quiet — needs energy';
}

function getLightMessage(value: number | null | undefined, score: number): string {
  if (value === null || value === undefined) return 'No light data';
  if (score >= 85) return 'Great ambiance';
  if (score >= 60) return 'Acceptable lighting';
  if (value !== null && value > OPTIMAL_RANGES.light.max) return 'Too bright for evening';
  return 'Very dim';
}

// ============ DWELL TIME SCORING ============

export function getDwellTimeCategory(minutes: number | null): string {
  if (minutes === null) return 'unknown';
  if (minutes >= DWELL_TIME_THRESHOLDS.excellent) return 'excellent';
  if (minutes >= DWELL_TIME_THRESHOLDS.good) return 'good';
  if (minutes >= DWELL_TIME_THRESHOLDS.fair) return 'fair';
  return 'poor';
}

export function getDwellTimeScore(minutes: number | null): number {
  if (minutes === null) return 0;
  // 120 minutes = 100 score, linear scale
  return Math.min(100, Math.round((minutes / 120) * 100));
}

export function formatDwellTime(minutes: number | null): string {
  if (minutes === null) return '--';
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${Math.round(minutes)}m`;
}

// ============ REPUTATION SCORING ============

export function getReputationScore(rating: number | null): number {
  if (rating === null) return 0;
  // 5.0 = 100, 1.0 = 0
  return Math.round(((rating - 1) / 4) * 100);
}

// ============ OCCUPANCY SCORING ============

export function getOccupancyScore(current: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.min(100, Math.round((current / capacity) * 100));
}
