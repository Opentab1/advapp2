/**
 * Pulse Score Calculation
 * 
 * Context-aware scoring that adapts to time of day and day of week.
 * Based on YOUR venue's historical best performance.
 * 
 * Factors:
 * - Sound (40%): Decibel level vs your best nights
 * - Light (25%): Lux level vs your best nights
 * - Crowd (20%): Occupancy vs optimal for time slot
 * - Music (15%): Genre match to what works at your venue
 */

import { 
  FACTOR_WEIGHTS, 
  SCORE_THRESHOLDS,
  SCORE_COLORS,
  DWELL_TIME_THRESHOLDS,
  TIME_SLOT_RANGES,
  OPTIMAL_CROWD,
  GENRE_KEYWORDS,
  type TimeSlot,
} from './constants';
import venueCalibrationService from '../services/venue-calibration.service';
import venueLearningService, { type BestNightProfile } from '../services/venue-learning.service';

// ============ TYPES ============

export interface PulseScoreResult {
  score: number;
  status: 'optimal' | 'good' | 'poor';
  statusLabel: string;
  color: string;
  timeSlot: TimeSlot;
  factors: {
    sound: FactorScore;
    light: FactorScore;
    crowd: FactorScore;
    music: FactorScore;
  };
  // Best Night comparison data
  bestNight: BestNightProfile | null;
  isUsingHistoricalData: boolean;
  proximityToBest: number | null;
  // Music detection
  detectedGenres: string[];
  bestNightGenres: string[];
}

export interface FactorScore {
  score: number;        // 0-100
  value: number | string | null; // Current value
  inRange: boolean;     // Is value in optimal range?
  message: string;      // Human-readable status
}

// ============ TIME SLOT DETECTION ============

/**
 * Determine the time slot based on day and hour.
 */
export function getTimeSlotFromTimestamp(timestamp: Date): TimeSlot {
  const day = timestamp.getDay();
  const hour = timestamp.getHours();
  
  if (day === 0) return 'sunday_funday';
  
  if (day === 6) {
    if (hour < 16) return 'daytime';
    if (hour < 21) return 'saturday_early';
    return 'saturday_peak';
  }
  
  if (day === 5) {
    if (hour < 16) return 'daytime';
    if (hour < 21) return 'friday_early';
    return 'friday_peak';
  }
  
  if (hour < 16) return 'daytime';
  if (hour < 19) return 'weekday_happy_hour';
  return 'weekday_night';
}

export function getCurrentTimeSlot(): TimeSlot {
  return getTimeSlotFromTimestamp(new Date());
}

// ============ CORE SCORING FUNCTIONS ============

/**
 * Calculate how well a value fits within an optimal range.
 */
export function calculateFactorScore(
  value: number | null | undefined,
  range: { min: number; max: number }
): number {
  if (value === null || value === undefined) return 0;
  
  if (value >= range.min && value <= range.max) {
    return 100;
  }
  
  const rangeSize = range.max - range.min;
  const tolerance = rangeSize * 0.5;
  
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
 * Calculate crowd score based on occupancy vs optimal for time slot.
 * Too empty = low score, just right = high score, too packed = slight penalty
 */
export function calculateCrowdScore(
  currentOccupancy: number | null | undefined,
  estimatedCapacity: number,
  timeSlot: TimeSlot
): number {
  if (currentOccupancy === null || currentOccupancy === undefined) return 50;
  if (estimatedCapacity <= 0) return 50;
  
  const occupancyPercent = (currentOccupancy / estimatedCapacity) * 100;
  const optimal = OPTIMAL_CROWD[timeSlot];
  
  if (occupancyPercent >= optimal.min && occupancyPercent <= optimal.max) {
    return 100; // Perfect crowd level
  }
  
  if (occupancyPercent < optimal.min) {
    // Too empty - bigger penalty (feels dead)
    const deficit = optimal.min - occupancyPercent;
    return Math.max(0, Math.round(100 - deficit * 2));
  } else {
    // Too packed - smaller penalty (still has energy)
    const excess = occupancyPercent - optimal.max;
    return Math.max(20, Math.round(100 - excess * 1.5));
  }
}

/**
 * Detect genres from song title and artist name using expanded keyword matching.
 * Returns array of detected genres (a song can match multiple genres).
 */
export function detectGenres(
  currentSong: string | null | undefined,
  artist: string | null | undefined
): string[] {
  if (!currentSong && !artist) return [];
  
  const searchText = ((currentSong || '') + ' ' + (artist || '')).toLowerCase();
  const detectedGenres: string[] = [];
  
  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    if (keywords.some(kw => searchText.includes(kw.toLowerCase()))) {
      detectedGenres.push(genre);
    }
  }
  
  return detectedGenres;
}

/**
 * Calculate music/genre score.
 * Compares current genre to your best night's genres.
 * 
 * Scoring:
 * - Match to best night genre: 100
 * - Can't detect genre: 80 (neutral, no penalty)
 * - Different but compatible genre: 70
 * - Opposite of what works: 50
 */
export function calculateMusicScore(
  currentSong: string | null | undefined,
  artist: string | null | undefined,
  timeSlot: TimeSlot,
  bestNightGenres: string[]
): { score: number; detectedGenres: string[]; message: string } {
  const detectedGenres = detectGenres(currentSong, artist);
  
  // No song playing
  if (!currentSong && !artist) {
    return { 
      score: 80, 
      detectedGenres: [], 
      message: 'No music detected' 
    };
  }
  
  // Can't detect genre
  if (detectedGenres.length === 0) {
    return { 
      score: 80, 
      detectedGenres: [], 
      message: 'Genre not detected' 
    };
  }
  
  // Have best night data - compare to it
  if (bestNightGenres.length > 0) {
    const matchesBestNight = detectedGenres.some(g => 
      bestNightGenres.some(bg => 
        g === bg || g.includes(bg) || bg.includes(g)
      )
    );
    
    if (matchesBestNight) {
      return { 
        score: 100, 
        detectedGenres, 
        message: `${detectedGenres[0]} - matching your best nights!` 
      };
    } else {
      // Different genre than best nights
      return { 
        score: 70, 
        detectedGenres, 
        message: `${detectedGenres[0]} - different from your usual` 
      };
    }
  }
  
  // No best night data - use time slot defaults
  const expectedGenres = TIME_SLOT_RANGES[timeSlot].genres;
  const matchesTimeSlot = detectedGenres.some(g => 
    expectedGenres.some(eg => g.includes(eg) || eg.includes(g))
  );
  
  if (matchesTimeSlot) {
    return { 
      score: 90, 
      detectedGenres, 
      message: `${detectedGenres[0]} fits this time` 
    };
  }
  
  return { 
    score: 70, 
    detectedGenres, 
    message: `${detectedGenres[0]}` 
  };
}

/**
 * Calculate proximity to best night for sound and light.
 */
export function calculateBestNightProximity(
  decibels: number | null | undefined,
  light: number | null | undefined,
  bestNight: BestNightProfile
): number {
  const SOUND_TOLERANCE = 10;
  const LIGHT_TOLERANCE = 100;
  
  let soundProx = 50;
  let lightProx = 50;
  
  if (decibels !== null && decibels !== undefined && bestNight.avgSound > 0) {
    const diff = Math.abs(decibels - bestNight.avgSound);
    soundProx = diff === 0 ? 100 : diff >= SOUND_TOLERANCE ? 0 : Math.round(100 * (1 - diff / SOUND_TOLERANCE));
  }
  
  if (light !== null && light !== undefined && bestNight.avgLight > 0) {
    const diff = Math.abs(light - bestNight.avgLight);
    lightProx = diff === 0 ? 100 : diff >= LIGHT_TOLERANCE ? 0 : Math.round(100 * (1 - diff / LIGHT_TOLERANCE));
  }
  
  // Weight: sound 55%, light 45%
  return Math.round((soundProx * 0.55) + (lightProx * 0.45));
}

// ============ MAIN PULSE SCORE CALCULATION ============

export interface PulseScoreOptions {
  decibels: number | null | undefined;
  light: number | null | undefined;
  currentOccupancy?: number | null;
  estimatedCapacity?: number;
  currentSong?: string | null;
  artist?: string | null;
  venueId?: string | null;
  timestamp?: Date | string | null;
}

/**
 * Calculate the complete Pulse Score.
 * 
 * New formula: Sound (40%) + Light (25%) + Crowd (20%) + Music (15%)
 * 
 * Priority for targets:
 * 1. Best Night Profile - YOUR proven best conditions
 * 2. Learned ranges - from historical dwell time analysis
 * 3. Time-slot defaults - industry assumptions
 */
export function calculatePulseScore(
  decibels: number | null | undefined,
  light: number | null | undefined,
  // Legacy params for backward compatibility
  _indoorTemp?: number | null,
  _outdoorTemp?: number | null,
  currentSong?: string | null,
  artist?: string | null,
  venueId?: string | null,
  timestamp?: Date | string | null,
  // New params
  currentOccupancy?: number | null,
  estimatedCapacity?: number
): PulseScoreResult {
  // Ignore legacy temp params
  void _indoorTemp;
  void _outdoorTemp;
  
  const dataTime = timestamp ? (typeof timestamp === 'string' ? new Date(timestamp) : timestamp) : new Date();
  const timeSlot = getTimeSlotFromTimestamp(dataTime);
  const defaultRanges = TIME_SLOT_RANGES[timeSlot];
  
  // Default capacity estimate
  const capacity = estimatedCapacity || 100;
  
  let ranges = defaultRanges;
  let isUsingHistoricalData = false;
  let bestNight: BestNightProfile | null = null;
  let proximityToBest: number | null = null;
  let bestNightGenres: string[] = [];
  
  if (venueId) {
    // Try to get best night profile
    bestNight = venueLearningService.getBestNightProfile(venueId, timeSlot);
    
    if (bestNight && bestNight.confidence >= 30) {
      isUsingHistoricalData = true;
      
      // Use best night values as targets
      const SOUND_TOLERANCE = 5;
      const LIGHT_TOLERANCE = 50;
      
      ranges = {
        ...defaultRanges,
        sound: { 
          min: bestNight.avgSound - SOUND_TOLERANCE, 
          max: bestNight.avgSound + SOUND_TOLERANCE 
        },
        light: { 
          min: Math.max(0, bestNight.avgLight - LIGHT_TOLERANCE), 
          max: bestNight.avgLight + LIGHT_TOLERANCE 
        },
      };
      
      proximityToBest = calculateBestNightProximity(decibels, light, bestNight);
      bestNightGenres = bestNight.detectedGenres || [];
      
      console.log(`🏆 Scoring against YOUR Best ${timeSlot}: ${bestNight.date}`);
    } else {
      // Try learned ranges
      const learnedRanges = venueLearningService.getCurrentOptimalRanges(venueId);
      
      if (learnedRanges.isLearned && learnedRanges.confidence >= 30) {
        isUsingHistoricalData = true;
        ranges = {
          ...defaultRanges,
          sound: learnedRanges.sound || defaultRanges.sound,
          light: learnedRanges.light || defaultRanges.light,
        };
      } else {
        // Try calibration
        const calibration = venueCalibrationService.getEffectiveRanges(venueId, {
          sound: defaultRanges.sound,
          light: defaultRanges.light,
        });
        if (calibration.isCustom) {
          ranges = {
            ...defaultRanges,
            sound: calibration.sound,
            light: calibration.light,
          };
        }
      }
    }
  }
  
  // Calculate factor scores
  // Treat 0 as "no data" for sound and light (Pi Zero 2W sends 0 when sensor unavailable)
  const hasSound = decibels !== null && decibels !== undefined && decibels !== 0;
  const hasLight = light !== null && light !== undefined && light > 0;
  
  const soundScore = hasSound ? calculateFactorScore(decibels, ranges.sound) : 0;
  const lightScore = hasLight ? calculateFactorScore(light, ranges.light) : 0;
  const crowdScore = calculateCrowdScore(currentOccupancy, capacity, timeSlot);
  const musicResult = calculateMusicScore(currentSong, artist, timeSlot, bestNightGenres);
  
  // Redistribute weights for missing sensors
  // If a sensor is missing, redistribute its weight to remaining factors proportionally
  let soundWeight = FACTOR_WEIGHTS.sound;
  let lightWeight = FACTOR_WEIGHTS.light;
  let crowdWeight = FACTOR_WEIGHTS.crowd;
  let musicWeight = FACTOR_WEIGHTS.music;
  
  if (!hasSound && !hasLight) {
    // No environmental sensors - only crowd and music matter
    const totalRemaining = crowdWeight + musicWeight;
    crowdWeight = crowdWeight / totalRemaining;
    musicWeight = musicWeight / totalRemaining;
    soundWeight = 0;
    lightWeight = 0;
  } else if (!hasSound) {
    // No sound - redistribute to light, crowd, music
    const totalRemaining = lightWeight + crowdWeight + musicWeight;
    lightWeight = lightWeight / totalRemaining;
    crowdWeight = crowdWeight / totalRemaining;
    musicWeight = musicWeight / totalRemaining;
    soundWeight = 0;
  } else if (!hasLight) {
    // No light - redistribute to sound, crowd, music
    const totalRemaining = soundWeight + crowdWeight + musicWeight;
    soundWeight = soundWeight / totalRemaining;
    crowdWeight = crowdWeight / totalRemaining;
    musicWeight = musicWeight / totalRemaining;
    lightWeight = 0;
  }
  
  // Weighted average with adjusted weights
  const pulseScore = Math.round(
    (soundScore * soundWeight) + 
    (lightScore * lightWeight) +
    (crowdScore * crowdWeight) +
    (musicResult.score * musicWeight)
  );
  
  const status = getScoreStatus(pulseScore);
  const statusLabel = getScoreStatusLabel(pulseScore, isUsingHistoricalData);
  const color = getScoreColor(pulseScore);
  
  return {
    score: pulseScore,
    status,
    statusLabel,
    color,
    timeSlot,
    factors: {
      sound: {
        score: soundScore,
        value: decibels ?? null,
        inRange: decibels !== null && decibels !== undefined && 
                 decibels >= ranges.sound.min && decibels <= ranges.sound.max,
        message: getSoundMessage(decibels, soundScore, timeSlot, bestNight),
      },
      light: {
        score: lightScore,
        value: light ?? null,
        inRange: light !== null && light !== undefined && 
                 light >= ranges.light.min && light <= ranges.light.max,
        message: getLightMessage(light, lightScore, timeSlot, bestNight),
      },
      crowd: {
        score: crowdScore,
        value: currentOccupancy ?? null,
        inRange: crowdScore >= 80,
        message: getCrowdMessage(currentOccupancy, capacity, crowdScore, timeSlot),
      },
      music: {
        score: musicResult.score,
        value: currentSong || null,
        inRange: musicResult.score >= 80,
        message: musicResult.message,
      },
    },
    bestNight,
    isUsingHistoricalData,
    proximityToBest,
    detectedGenres: musicResult.detectedGenres,
    bestNightGenres,
  };
}

// ============ STATUS HELPERS ============

export function getScoreStatus(score: number | null): 'optimal' | 'good' | 'poor' {
  if (score === null) return 'poor';
  if (score >= SCORE_THRESHOLDS.optimal) return 'optimal';
  if (score >= SCORE_THRESHOLDS.good) return 'good';
  return 'poor';
}

export function getScoreStatusLabel(score: number | null, isUsingHistoricalData: boolean = false): string {
  if (score === null) return 'No Data';
  
  if (isUsingHistoricalData) {
    if (score >= SCORE_THRESHOLDS.optimal) return 'Peak Performance 💰';
    if (score >= SCORE_THRESHOLDS.good) return 'Almost There';
    return 'Quick Fix Needed';
  }
  
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

function getSoundMessage(
  value: number | null | undefined, 
  score: number,
  timeSlot: TimeSlot,
  bestNight: BestNightProfile | null
): string {
  if (value === null || value === undefined) return 'No sound data';
  
  if (bestNight && bestNight.avgSound > 0) {
    const diff = Math.round(value - bestNight.avgSound);
    if (Math.abs(diff) <= 2) return `Matching your best (${bestNight.avgSound}dB)`;
    if (diff > 0) return `${diff}dB louder than your best`;
    return `${Math.abs(diff)}dB quieter than your best`;
  }
  
  const ranges = TIME_SLOT_RANGES[timeSlot];
  if (score >= 85) return 'Perfect energy';
  if (score >= 60) return 'Good vibe';
  if (value < ranges.sound.min) return 'Too quiet for now';
  return 'Too loud for now';
}

function getLightMessage(
  value: number | null | undefined, 
  score: number,
  timeSlot: TimeSlot,
  bestNight: BestNightProfile | null
): string {
  if (value === null || value === undefined) return 'No light data';
  
  if (bestNight && bestNight.avgLight > 0) {
    const diff = Math.round(value - bestNight.avgLight);
    if (Math.abs(diff) <= 20) return `Matching your best (${bestNight.avgLight} lux)`;
    if (diff > 0) return `${diff} lux brighter than your best`;
    return `${Math.abs(diff)} lux dimmer than your best`;
  }
  
  const ranges = TIME_SLOT_RANGES[timeSlot];
  if (score >= 85) return 'Perfect ambiance';
  if (score >= 60) return 'Good mood';
  if (value < ranges.light.min) return 'Could be brighter';
  return 'Could dim a bit';
}

function getCrowdMessage(
  currentOccupancy: number | null | undefined,
  capacity: number,
  score: number,
  timeSlot: TimeSlot
): string {
  if (currentOccupancy === null || currentOccupancy === undefined) return 'No crowd data';
  
  const percent = Math.round((currentOccupancy / capacity) * 100);
  const optimal = OPTIMAL_CROWD[timeSlot];
  
  if (score >= 85) return `Perfect crowd (${percent}% full)`;
  if (score >= 60) {
    if (percent < optimal.min) return `Building up (${percent}% full)`;
    return `Packed house (${percent}% full)`;
  }
  if (percent < optimal.min) return `Quiet night (${percent}% full)`;
  return `Very packed (${percent}% full)`;
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
  return Math.round(((rating - 1) / 4) * 100);
}

// ============ OCCUPANCY SCORING ============

export function getOccupancyScore(current: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.min(100, Math.round((current / capacity) * 100));
}
