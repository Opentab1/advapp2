/**
 * Pulse Score Calculation
 * 
 * Context-aware scoring that adapts to time of day and day of week.
 * 
 * Factors:
 * - Sound (40%): Decibel level vs optimal for current time slot
 * - Light (25%): Lux level vs optimal for current time slot  
 * - Temperature (15%): Indoor comfort based on outdoor temp
 * - Genre (10%): Is the music right for this time slot?
 * - Vibe (10%): Overall conditions matching expectations
 */

import { 
  OPTIMAL_RANGES, 
  FACTOR_WEIGHTS, 
  SCORE_THRESHOLDS,
  SCORE_COLORS,
  DWELL_TIME_THRESHOLDS,
  TIME_SLOT_RANGES,
  TEMP_COMFORT,
  type TimeSlot,
} from './constants';

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
    genre: FactorScore;
    vibe: FactorScore;
  };
}

export interface FactorScore {
  score: number;        // 0-100
  value: number | string | null; // Current value
  inRange: boolean;     // Is value in optimal range?
  message: string;      // Human-readable status
}

// ============ TIME SLOT DETECTION ============

/**
 * Determine the current time slot based on day and hour.
 */
export function getCurrentTimeSlot(): TimeSlot {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = now.getHours();
  
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
  tempScore: number,
  genreScore: number
): number {
  // Vibe is good when everything is in sync
  const avgScore = (soundScore + lightScore + tempScore + genreScore) / 4;
  
  // Bonus for consistency (all factors similar)
  const scores = [soundScore, lightScore, tempScore, genreScore];
  const variance = scores.reduce((sum, s) => sum + Math.abs(s - avgScore), 0) / 4;
  const consistencyBonus = Math.max(0, 10 - variance / 5);
  
  return Math.min(100, Math.round(avgScore + consistencyBonus));
}

/**
 * Calculate the complete Pulse Score from sensor data.
 * Context-aware based on time of day and day of week.
 */
export function calculatePulseScore(
  decibels: number | null | undefined,
  light: number | null | undefined,
  indoorTemp?: number | null,
  outdoorTemp?: number | null,
  currentSong?: string | null,
  artist?: string | null
): PulseScoreResult {
  // Get current time slot
  const timeSlot = getCurrentTimeSlot();
  const ranges = TIME_SLOT_RANGES[timeSlot];
  
  // Calculate individual factor scores using time-appropriate ranges
  const soundScore = calculateFactorScore(decibels, ranges.sound);
  const lightScore = calculateFactorScore(light, ranges.light);
  const tempScore = calculateTempScore(indoorTemp, outdoorTemp);
  const { score: genreScore, detectedGenre } = calculateGenreScore(currentSong, artist, timeSlot);
  const vibeScore = calculateVibeScore(soundScore, lightScore, tempScore, genreScore);
  
  // Weighted average
  const pulseScore = Math.round(
    (soundScore * FACTOR_WEIGHTS.sound) + 
    (lightScore * FACTOR_WEIGHTS.light) +
    (tempScore * FACTOR_WEIGHTS.temperature) +
    (genreScore * FACTOR_WEIGHTS.genre) +
    (vibeScore * FACTOR_WEIGHTS.vibe)
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
    timeSlot,
    factors: {
      sound: {
        score: soundScore,
        value: decibels ?? null,
        inRange: decibels !== null && decibels !== undefined && 
                 decibels >= ranges.sound.min && decibels <= ranges.sound.max,
        message: getSoundMessage(decibels, soundScore, timeSlot),
      },
      light: {
        score: lightScore,
        value: light ?? null,
        inRange: light !== null && light !== undefined && 
                 light >= ranges.light.min && light <= ranges.light.max,
        message: getLightMessage(light, lightScore, timeSlot),
      },
      temperature: {
        score: tempScore,
        value: indoorTemp ?? null,
        inRange: tempScore >= 80,
        message: getTempMessage(indoorTemp, tempScore),
      },
      genre: {
        score: genreScore,
        value: detectedGenre,
        inRange: genreScore >= 80,
        message: getGenreMessage(detectedGenre, genreScore, timeSlot),
      },
      vibe: {
        score: vibeScore,
        value: timeSlot,
        inRange: vibeScore >= 80,
        message: getVibeMessage(vibeScore, timeSlot),
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
