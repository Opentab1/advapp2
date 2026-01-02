/**
 * Constants for Pulse Dashboard
 * 
 * Optimal ranges, thresholds, and configuration values.
 * Single source of truth for all scoring and recommendation logic.
 */

// ============ OPTIMAL RANGES ============
// These define "good" conditions for a bar/venue environment

export const OPTIMAL_RANGES = {
  sound: {
    min: 70,
    max: 78,
    unit: 'dB',
    label: 'Sound Level',
    description: 'Conversational but energetic',
  },
  light: {
    min: 50,
    max: 350,
    unit: 'lux',
    label: 'Light Level',
    description: 'Ambient bar lighting',
  },
  temperature: {
    min: 68,
    max: 74,
    unit: '°F',
    label: 'Temperature',
    description: 'Comfortable indoor temp',
  },
  humidity: {
    min: 40,
    max: 60,
    unit: '%',
    label: 'Humidity',
    description: 'Comfortable humidity',
  },
} as const;

// ============ FACTOR WEIGHTS ============
// How much each factor contributes to Pulse Score (must sum to 1.0)

export const FACTOR_WEIGHTS = {
  sound: 0.60,  // 60% - Most impactful for bar atmosphere
  light: 0.40,  // 40% - Sets the mood
} as const;

// ============ SCORE THRESHOLDS ============

export const SCORE_THRESHOLDS = {
  optimal: 85,   // 85+ = Green, Optimal
  good: 60,      // 60-84 = Yellow/Amber, Good
  // Below 60 = Red, Needs Adjustment
} as const;

// ============ OCCUPANCY THRESHOLDS ============
// As percentage of estimated capacity

export const OCCUPANCY_THRESHOLDS = {
  slow: 30,      // Below 30% = slow night
  moderate: 50,  // 30-75% = moderate
  busy: 75,      // 75-90% = busy
  packed: 90,    // 90%+ = packed
} as const;

// ============ TIME PERIODS ============
// Bar business hours (for context-aware recommendations)

export const TIME_PERIODS = {
  morning: { start: 6, end: 11, label: 'Morning' },
  afternoon: { start: 11, end: 16, label: 'Afternoon' },
  prePeak: { start: 16, end: 19, label: 'Pre-Peak' },
  peak: { start: 19, end: 23, label: 'Peak Hours' },
  lateNight: { start: 23, end: 3, label: 'Late Night' },
  closed: { start: 3, end: 6, label: 'Closed' },
} as const;

// ============ DWELL TIME THRESHOLDS ============
// Average time guests spend (in minutes)

export const DWELL_TIME_THRESHOLDS = {
  excellent: 60,  // 60+ min = excellent
  good: 45,       // 45-60 min = good
  fair: 30,       // 30-45 min = fair
  poor: 0,        // Below 30 min = needs work
} as const;

// ============ DATA FRESHNESS ============

export const DATA_FRESHNESS = {
  fresh: 60,        // Within 60 seconds = fresh
  stale: 300,       // 60-300 seconds = stale (show warning)
  disconnected: 600, // 600+ seconds = disconnected
} as const;

// ============ POLLING INTERVALS ============

export const POLLING_INTERVALS = {
  live: 15000,       // 15 seconds for live data
  occupancy: 30000,  // 30 seconds for occupancy
  weather: 5400000,  // 90 minutes for weather
} as const;

// ============ COLORS ============

export const SCORE_COLORS = {
  optimal: '#22C55E',  // Green
  good: '#F59E0B',     // Amber
  poor: '#EF4444',     // Red
  neutral: '#9CA3AF',  // Gray (no data)
} as const;

export const RING_COLORS = {
  pulse: '#22C55E',      // Dynamic based on score
  dwell: '#0077B6',      // Primary blue
  reputation: '#F59E0B', // Amber
  crowd: '#22C55E',      // Green
} as const;

// ============ ACTION PRIORITIES ============

export const ACTION_PRIORITIES = {
  critical: { order: 0, label: '🚨 Do This Now', color: 'red' },
  high: { order: 1, label: '⚡ Priority', color: 'amber' },
  medium: { order: 2, label: '💡 Recommended', color: 'blue' },
  low: { order: 3, label: '✨ Nice to Have', color: 'green' },
} as const;

// ============ TYPE EXPORTS ============

export type OptimalRangeKey = keyof typeof OPTIMAL_RANGES;
export type TimePeriodKey = keyof typeof TIME_PERIODS;
export type ActionPriority = keyof typeof ACTION_PRIORITIES;
