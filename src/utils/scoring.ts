/**
 * Pulse Score Calculation
 * 
 * Context-aware scoring that adapts to time of day and day of week.
 * 
 * Factors:
 * - Sound (45%): Decibel level vs optimal for current time slot
 * - Light (30%): Lux level vs optimal for current time slot  
 * - Temperature (15%): Indoor comfort based on outdoor temp
 * - Vibe (10%): Overall conditions matching expectations
 * 
 * Note: Genre scoring removed - music metadata detection is unreliable
 */

import { 
  FACTOR_WEIGHTS, 
  SCORE_THRESHOLDS,
  SCORE_COLORS,
  DWELL_TIME_THRESHOLDS,
  TIME_SLOT_RANGES,
  TEMP_COMFORT,
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
    temperature: FactorScore;
    vibe: FactorScore;
  };
  // ✨ NEW: Best Night comparison data
  bestNight: BestNightProfile | null;         // The historical best night for this time slot
  isUsingHistoricalData: boolean;             // True if we're scoring against YOUR best
  proximityToBest: number | null;             // 0-100: How close to recreating your best night
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
 * Can use current time or a specific timestamp (for historical data accuracy).
 */
export function getTimeSlotFromTimestamp(timestamp: Date): TimeSlot {
  const day = timestamp.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = timestamp.getHours();
  
  // Sunday
  if (day === 0) {
    return 'sunday_funday';
  }
  
  // Saturday
  if (day === 6) {
    if (hour < 16) return 'daytime';
    if (hour < 21) return 'saturday_early';
    return 'saturday_peak';
  }
  
  // Friday
  if (day === 5) {
    if (hour < 16) return 'daytime';
    if (hour < 21) return 'friday_early';
    return 'friday_peak';
  }
  
  // Monday - Thursday
  if (hour < 16) return 'daytime';
  if (hour < 19) return 'weekday_happy_hour';
  return 'weekday_night';
}

/**
 * Determine the current time slot based on day and hour.
 */
export function getCurrentTimeSlot(): TimeSlot {
  return getTimeSlotFromTimestamp(new Date());
}

// ============ CORE SCORING ============

/**
 * Calculate how well a value fits within an optimal range.
 * Returns 0-100 score.
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
 * Calculate temperature comfort score based on indoor temp and outdoor temp.
 */
export function calculateTempScore(
  indoorTemp: number | null | undefined,
  outdoorTemp: number | null | undefined
): number {
  if (indoorTemp === null || indoorTemp === undefined) return 50; // Neutral if no data
  
  // Determine comfort range based on outdoor temp
  let comfortRange = TEMP_COMFORT.mildOutdoor;
  if (outdoorTemp !== null && outdoorTemp !== undefined) {
    if (outdoorTemp > 80) comfortRange = TEMP_COMFORT.hotOutdoor;
    else if (outdoorTemp < 60) comfortRange = TEMP_COMFORT.coldOutdoor;
  }
  
  return calculateFactorScore(indoorTemp, comfortRange);
}

/**
 * Calculate genre match score.
 * Returns 100 if genre matches expected for time slot, 50 if neutral, 0 if mismatch.
 */
export function calculateGenreScore(
  currentSong: string | null | undefined,
  artist: string | null | undefined,
  timeSlot: TimeSlot
): { score: number; detectedGenre: string | null } {
  if (!currentSong) return { score: 50, detectedGenre: null }; // Neutral if no song
  
  const expectedGenres = TIME_SLOT_RANGES[timeSlot].genres;
  const songLower = (currentSong + ' ' + (artist || '')).toLowerCase();
  
  // Simple genre detection based on keywords
  const genreKeywords: Record<string, string[]> = {
    'edm': ['edm', 'electronic', 'house', 'techno', 'bass', 'drop', 'remix'],
    'hip-hop': ['hip hop', 'hip-hop', 'rap', 'trap', 'drake', 'kendrick', 'kanye', 'jay-z'],
    'pop': ['pop', 'taylor', 'ariana', 'bieber', 'weeknd', 'dua lipa', 'harry styles'],
    'r&b': ['r&b', 'rnb', 'soul', 'usher', 'beyonce', 'sza', 'frank ocean'],
    'jazz': ['jazz', 'smooth', 'saxophone', 'trumpet', 'coltrane', 'miles davis'],
    'acoustic': ['acoustic', 'unplugged', 'guitar', 'folk'],
    'chill': ['chill', 'lofi', 'lo-fi', 'ambient', 'relaxing'],
    'dance': ['dance', 'club', 'party', 'dj'],
    'rock': ['rock', 'guitar', 'metal', 'punk'],
    'reggae': ['reggae', 'bob marley', 'island'],
    'classic': ['classic', 'oldies', '80s', '90s', 'retro'],
  };
  
  // Detect genre from song/artist
  let detectedGenre: string | null = null;
  for (const [genre, keywords] of Object.entries(genreKeywords)) {
    if (keywords.some(kw => songLower.includes(kw))) {
      detectedGenre = genre;
      break;
    }
  }
  
  // If no genre detected, return neutral
  if (!detectedGenre) return { score: 70, detectedGenre: null };
  
  // Check if detected genre matches expected
  if (expectedGenres.some(g => g.includes(detectedGenre!) || detectedGenre!.includes(g))) {
    return { score: 100, detectedGenre };
  }
  
  // Genre detected but doesn't match - penalty
  return { score: 40, detectedGenre };
}

/**
 * Calculate overall vibe score - how well all factors work together.
 */
export function calculateVibeScore(
  soundScore: number,
  lightScore: number,
  tempScore: number
): number {
  // Vibe is good when everything is in sync
  const avgScore = (soundScore + lightScore + tempScore) / 3;
  
  // Bonus for consistency (all factors similar)
  const scores = [soundScore, lightScore, tempScore];
  const variance = scores.reduce((sum, s) => sum + Math.abs(s - avgScore), 0) / 3;
  const consistencyBonus = Math.max(0, 10 - variance / 5);
  
  return Math.min(100, Math.round(avgScore + consistencyBonus));
}

/**
 * Calculate how close a current value is to a target value.
 * Returns 0-100 score based on proximity.
 * 
 * Used for comparing current conditions to YOUR best night's conditions.
 */
export function calculateProximityScore(
  current: number | null | undefined,
  target: number,
  tolerance: number // How far off is still considered "close"? (in units)
): number {
  if (current === null || current === undefined) return 0;
  
  const diff = Math.abs(current - target);
  
  if (diff === 0) return 100;
  if (diff >= tolerance) return 0;
  
  // Linear falloff within tolerance
  return Math.round(100 * (1 - diff / tolerance));
}

/**
 * Calculate overall proximity to the Best Night Profile.
 * This tells the user: "How close are you to recreating YOUR best night?"
 */
export function calculateBestNightProximity(
  decibels: number | null | undefined,
  light: number | null | undefined,
  indoorTemp: number | null | undefined,
  bestNight: BestNightProfile
): number {
  // Tolerances - how far off can you be and still be "close"?
  const SOUND_TOLERANCE = 10;  // +/- 10 dB
  const LIGHT_TOLERANCE = 100; // +/- 100 lux
  const TEMP_TOLERANCE = 5;    // +/- 5°F
  
  const soundProx = calculateProximityScore(decibels, bestNight.avgSound, SOUND_TOLERANCE);
  const lightProx = calculateProximityScore(light, bestNight.avgLight, LIGHT_TOLERANCE);
  const tempProx = calculateProximityScore(indoorTemp, bestNight.avgTemp, TEMP_TOLERANCE);
  
  // Weight sound and light more heavily (they're controllable)
  // Temp is harder to control quickly
  const weightedProx = (soundProx * 0.40) + (lightProx * 0.35) + (tempProx * 0.25);
  
  return Math.round(weightedProx);
}

/**
 * Calculate the complete Pulse Score from sensor data.
 * 
 * NEW PRIORITY (Your Historical Best First):
 * 1. Best Night Profile - YOUR proven best conditions for this time slot
 * 2. Learned ranges (from historical data analysis - what actually works)
 * 3. Manual calibration (owner-set preferences)
 * 4. Time-slot defaults (industry assumptions - fallback only)
 * 
 * The goal: Score how close current conditions are to YOUR BEST NIGHT.
 * "Your best Saturday had 142 guests at 78dB, 95 lux, 71°F. Match that!"
 * 
 * IMPORTANT: For historical data, pass the data's timestamp to get accurate scoring.
 * Without timestamp, uses current time (only correct for live data).
 */
export function calculatePulseScore(
  decibels: number | null | undefined,
  light: number | null | undefined,
  indoorTemp?: number | null,
  outdoorTemp?: number | null,
  _currentSong?: string | null,
  _artist?: string | null,
  venueId?: string | null,
  timestamp?: Date | string | null
): PulseScoreResult {
  // Note: _currentSong and _artist kept for API compatibility but not used in scoring
  void _currentSong;
  void _artist;
  
  // Get time slot from timestamp (for historical accuracy) or use current time
  const dataTime = timestamp ? (typeof timestamp === 'string' ? new Date(timestamp) : timestamp) : new Date();
  const timeSlot = getTimeSlotFromTimestamp(dataTime);
  const defaultRanges = TIME_SLOT_RANGES[timeSlot];
  
  // Track what data source we're using
  let ranges = defaultRanges;
  let weights = FACTOR_WEIGHTS;
  let isUsingHistoricalData = false;
  let bestNight: BestNightProfile | null = null;
  let proximityToBest: number | null = null;
  
  if (venueId) {
    // ✨ PRIORITY 1: Check for Best Night Profile (YOUR proven formula)
    bestNight = venueLearningService.getBestNightProfile(venueId, timeSlot);
    
    if (bestNight && bestNight.confidence >= 30) {
      isUsingHistoricalData = true;
      
      // Build ranges from best night values (+/- tolerance)
      // The "optimal" range is centered around YOUR best night's actual values
      const SOUND_TOLERANCE = 5;  // +/- 5 dB from your best
      const LIGHT_TOLERANCE = 50; // +/- 50 lux from your best
      
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
      
      // Calculate proximity to best night
      proximityToBest = calculateBestNightProximity(decibels, light, indoorTemp, bestNight);
      
      console.log(`🏆 Scoring against YOUR Best ${timeSlot}: ${bestNight.date} (${bestNight.totalGuests} guests)`);
    } else {
      // PRIORITY 2: Try learned ranges (from dwell time analysis)
      const learnedRanges = venueLearningService.getCurrentOptimalRanges(venueId);
      
      if (learnedRanges.isLearned && learnedRanges.confidence >= 30) {
        isUsingHistoricalData = true;
        ranges = {
          ...defaultRanges,
          sound: learnedRanges.sound || defaultRanges.sound,
          light: learnedRanges.light || defaultRanges.light,
        };
        
        // Use learned weights
        weights = {
          sound: learnedRanges.weights.sound,
          light: learnedRanges.weights.light,
          temperature: learnedRanges.weights.temperature,
          vibe: 0.10,
        };
        
        console.log(`🧠 Using learned optimal ranges for ${timeSlot}`);
      } else {
        // PRIORITY 3: Fall back to manual calibration
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
  
  // Calculate individual factor scores using the best available ranges
  const soundScore = calculateFactorScore(decibels, ranges.sound);
  const lightScore = calculateFactorScore(light, ranges.light);
  const tempScore = calculateTempScore(indoorTemp, outdoorTemp);
  const vibeScore = calculateVibeScore(soundScore, lightScore, tempScore);
  
  // Weighted average using dynamic or default weights
  const pulseScore = Math.round(
    (soundScore * weights.sound) + 
    (lightScore * weights.light) +
    (tempScore * weights.temperature) +
    (vibeScore * weights.vibe)
  );
  
  // Determine status with business-focused labels
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
        message: getSoundMessageWithBest(decibels, soundScore, timeSlot, bestNight),
      },
      light: {
        score: lightScore,
        value: light ?? null,
        inRange: light !== null && light !== undefined && 
                 light >= ranges.light.min && light <= ranges.light.max,
        message: getLightMessageWithBest(light, lightScore, timeSlot, bestNight),
      },
      temperature: {
        score: tempScore,
        value: indoorTemp ?? null,
        inRange: tempScore >= 80,
        message: getTempMessageWithBest(indoorTemp, tempScore, bestNight),
      },
      vibe: {
        score: vibeScore,
        value: timeSlot,
        inRange: vibeScore >= 80,
        message: getVibeMessage(vibeScore, timeSlot),
      },
    },
    // ✨ NEW: Best night comparison data
    bestNight,
    isUsingHistoricalData,
    proximityToBest,
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
  
  // Business-focused labels when using historical data
  if (isUsingHistoricalData) {
    if (score >= SCORE_THRESHOLDS.optimal) return 'Peak Performance 💰';
    if (score >= SCORE_THRESHOLDS.good) return 'Almost There';
    return 'Quick Fix Needed';
  }
  
  // Standard labels when using defaults
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
  timeSlot: TimeSlot
): string {
  if (value === null || value === undefined) return 'No sound data';
  const ranges = TIME_SLOT_RANGES[timeSlot];
  if (score >= 85) return 'Perfect energy';
  if (score >= 60) return 'Good vibe';
  if (value < ranges.sound.min) return 'Too quiet for now';
  return 'Too loud for now';
}

/**
 * Sound message that compares to your best night
 */
function getSoundMessageWithBest(
  value: number | null | undefined, 
  score: number,
  timeSlot: TimeSlot,
  bestNight: BestNightProfile | null
): string {
  if (value === null || value === undefined) return 'No sound data';
  
  // If we have a best night, compare to it!
  if (bestNight && bestNight.avgSound > 0) {
    const diff = Math.round(value - bestNight.avgSound);
    if (Math.abs(diff) <= 2) return `Matching your best (${bestNight.avgSound}dB)`;
    if (diff > 0) return `${diff}dB louder than your best`;
    return `${Math.abs(diff)}dB quieter than your best`;
  }
  
  // Fallback to standard message
  const ranges = TIME_SLOT_RANGES[timeSlot];
  if (score >= 85) return 'Perfect energy';
  if (score >= 60) return 'Good vibe';
  if (value < ranges.sound.min) return 'Too quiet for now';
  return 'Too loud for now';
}

function getLightMessage(
  value: number | null | undefined, 
  score: number,
  timeSlot: TimeSlot
): string {
  if (value === null || value === undefined) return 'No light data';
  const ranges = TIME_SLOT_RANGES[timeSlot];
  if (score >= 85) return 'Perfect ambiance';
  if (score >= 60) return 'Good mood';
  if (value !== null && value < ranges.light.min) return 'Could be brighter';
  return 'Could dim a bit';
}

/**
 * Light message that compares to your best night
 */
function getLightMessageWithBest(
  value: number | null | undefined, 
  score: number,
  timeSlot: TimeSlot,
  bestNight: BestNightProfile | null
): string {
  if (value === null || value === undefined) return 'No light data';
  
  // If we have a best night, compare to it!
  if (bestNight && bestNight.avgLight > 0) {
    const diff = Math.round(value - bestNight.avgLight);
    if (Math.abs(diff) <= 20) return `Matching your best (${bestNight.avgLight} lux)`;
    if (diff > 0) return `${diff} lux brighter than your best`;
    return `${Math.abs(diff)} lux dimmer than your best`;
  }
  
  // Fallback to standard message
  const ranges = TIME_SLOT_RANGES[timeSlot];
  if (score >= 85) return 'Perfect ambiance';
  if (score >= 60) return 'Good mood';
  if (value !== null && value < ranges.light.min) return 'Could be brighter';
  return 'Could dim a bit';
}

function getTempMessage(
  value: number | null | undefined,
  score: number
): string {
  if (value === null || value === undefined) return 'No temp data';
  if (score >= 80) return 'Comfortable';
  if (score >= 60) return 'Okay';
  if (value && value < 68) return 'Too cold';
  return 'Too warm';
}

/**
 * Temperature message that compares to your best night
 */
function getTempMessageWithBest(
  value: number | null | undefined, 
  score: number,
  bestNight: BestNightProfile | null
): string {
  if (value === null || value === undefined) return 'No temp data';
  
  // If we have a best night, compare to it!
  if (bestNight && bestNight.avgTemp > 0) {
    const diff = Math.round(value - bestNight.avgTemp);
    if (Math.abs(diff) <= 1) return `Matching your best (${bestNight.avgTemp}°F)`;
    if (diff > 0) return `${diff}°F warmer than your best`;
    return `${Math.abs(diff)}°F cooler than your best`;
  }
  
  // Fallback to standard message
  if (score >= 80) return 'Comfortable';
  if (score >= 60) return 'Okay';
  if (value && value < 68) return 'Too cold';
  return 'Too warm';
}

function getGenreMessage(
  genre: string | null,
  score: number,
  timeSlot: TimeSlot
): string {
  if (!genre) return 'No music detected';
  if (score >= 80) return `${genre} fits the vibe`;
  if (score >= 60) return `${genre} is okay`;
  return 'Maybe switch it up';
}

function getVibeMessage(
  score: number,
  timeSlot: TimeSlot
): string {
  const slotLabels: Record<TimeSlot, string> = {
    weekday_happy_hour: 'Happy Hour',
    weekday_night: 'Weeknight',
    friday_early: 'Friday vibes',
    friday_peak: 'Friday peak',
    saturday_early: 'Saturday warmup',
    saturday_peak: 'Saturday peak',
    sunday_funday: 'Sunday Funday',
    daytime: 'Daytime chill',
  };
  
  if (score >= 80) return `Nailing ${slotLabels[timeSlot]}`;
  if (score >= 60) return `Good for ${slotLabels[timeSlot]}`;
  return `Adjust for ${slotLabels[timeSlot]}`;
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
