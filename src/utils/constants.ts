/**
 * Constants for Pulse Dashboard
 * 
 * Optimal ranges, thresholds, and configuration values.
 * Single source of truth for all scoring and recommendation logic.
 */

// ============ TIME SLOTS ============
// Different times have different optimal conditions

export type TimeSlot = 
  | 'weekday_happy_hour'    // Mon-Thu 4-7pm
  | 'weekday_night'         // Mon-Thu 7pm-close
  | 'friday_early'          // Fri 4-9pm
  | 'friday_peak'           // Fri 9pm-close
  | 'saturday_early'        // Sat 4-9pm
  | 'saturday_peak'         // Sat 9pm-close
  | 'sunday_funday'         // Sun all day
  | 'daytime';              // Before 4pm any day

export const TIME_SLOT_RANGES: Record<TimeSlot, {
  sound: { min: number; max: number };
  light: { min: number; max: number };
  genres: string[];
}> = {
  weekday_happy_hour: {
    sound: { min: 65, max: 72 },
    light: { min: 150, max: 400 },
    genres: ['chill', 'jazz', 'acoustic', 'lounge', 'indie'],
  },
  weekday_night: {
    sound: { min: 70, max: 78 },
    light: { min: 50, max: 200 },
    genres: ['pop', 'r&b', 'indie', 'soul', 'funk'],
  },
  friday_early: {
    sound: { min: 70, max: 75 },
    light: { min: 100, max: 300 },
    genres: ['pop', 'hip-hop', 'r&b', 'dance'],
  },
  friday_peak: {
    sound: { min: 75, max: 85 },
    light: { min: 30, max: 150 },
    genres: ['edm', 'hip-hop', 'dance', 'party', 'house', 'top 40'],
  },
  saturday_early: {
    sound: { min: 70, max: 75 },
    light: { min: 100, max: 300 },
    genres: ['pop', 'hip-hop', 'r&b', 'dance'],
  },
  saturday_peak: {
    sound: { min: 75, max: 85 },
    light: { min: 30, max: 150 },
    genres: ['edm', 'hip-hop', 'dance', 'party', 'house', 'top 40'],
  },
  sunday_funday: {
    sound: { min: 68, max: 76 },
    light: { min: 100, max: 350 },
    genres: ['feel-good', 'pop', 'brunch', 'soul', 'reggae', 'classic'],
  },
  daytime: {
    sound: { min: 60, max: 70 },
    light: { min: 200, max: 500 },
    genres: ['background', 'chill', 'acoustic', 'jazz'],
  },
};

// ============ OPTIMAL RANGES (defaults) ============
// Fallback ranges when time slot detection fails

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
// Note: Genre removed - music metadata detection is unreliable

export const FACTOR_WEIGHTS = {
  sound: 0.45,      // 45% - Most impactful for bar atmosphere
  light: 0.30,      // 30% - Sets the mood
  temperature: 0.15, // 15% - Comfort factor
  vibe: 0.10,       // 10% - Overall time/day fit
} as const;

// ============ TEMPERATURE COMFORT ============
// Optimal indoor temp based on outdoor temp

export const TEMP_COMFORT = {
  // If outdoor is hot (>80°F), indoor should be cooler
  hotOutdoor: { min: 68, max: 72 },
  // If outdoor is mild (60-80°F), indoor should be comfortable
  mildOutdoor: { min: 68, max: 74 },
  // If outdoor is cold (<60°F), indoor should be warmer
  coldOutdoor: { min: 70, max: 76 },
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

// ============ COLORS (WHOOP Palette) ============

export const SCORE_COLORS = {
  optimal: '#16EC06',  // WHOOP High Recovery Green
  good: '#FFDE00',     // WHOOP Medium Recovery Yellow
  poor: '#FF0026',     // WHOOP Low Recovery Red
  neutral: '#6C7684',  // WHOOP Muted Text
} as const;

export const RING_COLORS = {
  pulse: '#16EC06',      // WHOOP High Recovery Green
  dwell: '#0093E7',      // WHOOP Strain Blue
  reputation: '#FFDE00', // WHOOP Medium Recovery Yellow
  crowd: '#00F19F',      // WHOOP Teal
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
