/**
 * Venue Learning Service
 * 
 * Analyzes historical data to learn what conditions keep guests longest
 * at THIS specific venue. Fully personalized, no assumptions.
 * 
 * Core concept:
 * - Group data by time slot (Friday peak, Saturday peak, etc.)
 * - For each metric, find which ranges correlate with longest dwell times
 * - Build venue-specific "optimal ranges" from actual data
 * - Track learning progress (need ~8 weeks for high confidence)
 */

import type { SensorData } from '../types';
import { getCurrentTimeSlot } from '../utils/scoring';
import type { TimeSlot } from '../utils/constants';

// ============ TYPES ============

export interface LearnedRange {
  min: number;
  max: number;
  avgDwellWhenOptimal: number;  // Average dwell time when in this range
  avgDwellOverall: number;      // Average dwell time overall
  improvement: number;          // % improvement vs overall
  dataPoints: number;           // How many data points support this
  confidence: number;           // 0-100, based on data quantity
}

export interface TimeSlotLearning {
  timeSlot: TimeSlot;
  sound: LearnedRange | null;
  light: LearnedRange | null;
  temperature: LearnedRange | null;
  // Dynamic weights based on which factors matter most for this venue/time
  weights: {
    sound: number;
    light: number;
    temperature: number;
  };
  dataPoints: number;
  weeksOfData: number;
}

export interface DiscoveredPattern {
  id: string;
  description: string;
  impact: string;           // "+23% longer stays"
  confidence: number;       // 0-100
  factor: 'sound' | 'light' | 'temperature' | 'time' | 'combined';
  timeSlot?: TimeSlot;
  actionable: boolean;      // Can they act on this now?
}

/**
 * Best Night Profile - The actual conditions during YOUR best nights
 * This is what we want to recreate!
 */
export interface BestNightProfile {
  // When was this best night?
  date: string;                    // ISO date string
  dayOfWeek: string;               // "Saturday", "Friday", etc.
  timeSlot: TimeSlot;
  
  // Performance metrics (what made it "best")
  totalGuests: number;             // Total guests that night
  peakOccupancy: number;           // Max people at once
  avgDwellMinutes: number;         // Average time guests stayed
  
  // Environmental conditions during the best night
  avgSound: number;                // Average dB level
  avgLight: number;                // Average lux level
  
  // Music/Genre data from that night
  topArtists: string[];            // Artists detected during best night
  detectedGenres: string[];        // Genres detected (e.g., ["hip-hop", "r&b"])
  songCount: number;               // How many songs we tracked
  
  // Optional: Peak hour conditions (the sweet spot)
  peakHour?: number;               // What hour was peak (e.g., 22 = 10pm)
  peakHourSound?: number;          // dB during peak hour
  peakHourLight?: number;          // Lux during peak hour
  
  // Confidence in this profile
  dataPointsFromNight: number;     // How many readings we have from this night
  confidence: number;              // 0-100
}

export interface VenueLearning {
  venueId: string;
  learningProgress: number;       // 0-100%
  dataPointsAnalyzed: number;
  weeksOfData: number;
  oldestDataDate: string | null;
  newestDataDate: string | null;
  
  // Learned ranges per time slot
  timeSlots: Partial<Record<TimeSlot, TimeSlotLearning>>;
  
  // ✨ NEW: Best Night Profiles per time slot - YOUR proven formula
  bestNights: Partial<Record<TimeSlot, BestNightProfile>>;
  
  // Notable patterns discovered
  patterns: DiscoveredPattern[];
  
  // Overall venue characteristics
  venueProfile: {
    peakDayOfWeek: string;
    peakHour: number;
    avgDwellTime: number;
    bestDwellTime: number;
    worstDwellTime: number;
  } | null;
  
  lastAnalyzed: string;
  status: 'insufficient_data' | 'learning' | 'confident' | 'highly_confident';
}

// ============ CONSTANTS ============

// Time requirements
const WEEKS_FOR_CONFIDENT = 4;
const WEEKS_FOR_HIGHLY_CONFIDENT = 8;

// Data density requirements - must have BOTH time AND data volume
const MIN_POINTS_FOR_LEARNING = 50;           // Need 50+ data points to start learning
const MIN_POINTS_FOR_CONFIDENT = 200;         // Need 200+ points for "confident"
const MIN_POINTS_FOR_HIGHLY_CONFIDENT = 500;  // Need 500+ points for "highly confident"
const MIN_TIMESLOTS_FOR_CONFIDENT = 3;        // Need data in at least 3 different time slots
const MIN_TIMESLOTS_FOR_HIGHLY_CONFIDENT = 5; // Need data in at least 5 time slots

const MIN_DATA_POINTS_PER_BUCKET = 5;
const STORAGE_KEY = 'venue_learning';

// Sound buckets (dB ranges)
const SOUND_BUCKETS = [
  { min: 50, max: 60, label: '50-60dB' },
  { min: 60, max: 65, label: '60-65dB' },
  { min: 65, max: 70, label: '65-70dB' },
  { min: 70, max: 75, label: '70-75dB' },
  { min: 75, max: 80, label: '75-80dB' },
  { min: 80, max: 85, label: '80-85dB' },
  { min: 85, max: 95, label: '85-95dB' },
];

// Light buckets (lux ranges)
const LIGHT_BUCKETS = [
  { min: 0, max: 50, label: '0-50 lux' },
  { min: 50, max: 100, label: '50-100 lux' },
  { min: 100, max: 200, label: '100-200 lux' },
  { min: 200, max: 300, label: '200-300 lux' },
  { min: 300, max: 400, label: '300-400 lux' },
  { min: 400, max: 600, label: '400-600 lux' },
];

// Temperature buckets (°F ranges)
const TEMP_BUCKETS = [
  { min: 60, max: 66, label: '60-66°F' },
  { min: 66, max: 68, label: '66-68°F' },
  { min: 68, max: 70, label: '68-70°F' },
  { min: 70, max: 72, label: '70-72°F' },
  { min: 72, max: 74, label: '72-74°F' },
  { min: 74, max: 78, label: '74-78°F' },
];

// ============ MAIN SERVICE ============

class VenueLearningService {
  private cache: Map<string, VenueLearning> = new Map();
  
  /**
   * Analyze historical data and learn optimal conditions for a venue
   */
  analyzeVenue(venueId: string, historicalData: SensorData[]): VenueLearning {
    console.log(`🧠 Analyzing ${historicalData.length} data points for venue ${venueId}`);
    
    if (historicalData.length === 0) {
      return this.createEmptyLearning(venueId);
    }
    
    // Sort data by timestamp
    const sortedData = [...historicalData].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    // Calculate date range and weeks of data
    const oldestDate = new Date(sortedData[0].timestamp);
    const newestDate = new Date(sortedData[sortedData.length - 1].timestamp);
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weeksOfData = Math.max(1, Math.floor((newestDate.getTime() - oldestDate.getTime()) / msPerWeek));
    
    // Estimate dwell time for each data point
    const dataWithDwell = this.estimateDwellTimes(sortedData);
    
    // Group by time slot
    const byTimeSlot = this.groupByTimeSlot(dataWithDwell);
    
    // Analyze each time slot
    const timeSlots: Partial<Record<TimeSlot, TimeSlotLearning>> = {};
    for (const [slot, data] of Object.entries(byTimeSlot)) {
      if (data.length >= MIN_DATA_POINTS_PER_BUCKET) {
        timeSlots[slot as TimeSlot] = this.analyzeTimeSlot(slot as TimeSlot, data, weeksOfData);
      }
    }
    
    // Discover patterns
    const patterns = this.discoverPatterns(dataWithDwell, timeSlots, weeksOfData);
    
    // ✨ Find best nights per time slot
    const bestNights = this.findBestNights(dataWithDwell, byTimeSlot);
    
    // Build venue profile
    const venueProfile = this.buildVenueProfile(dataWithDwell);
    
    // Calculate learning progress
    const timeSlotsWithData = Object.keys(timeSlots).length;
    const learningProgress = this.calculateLearningProgress(weeksOfData, historicalData.length, timeSlotsWithData);
    
    // Determine status - requires BOTH time AND data density
    // This prevents showing "Personalized" when we have 8 weeks but only 10 data points
    let status: VenueLearning['status'] = 'insufficient_data';
    
    const hasMinimumData = historicalData.length >= MIN_POINTS_FOR_LEARNING;
    const hasConfidentData = historicalData.length >= MIN_POINTS_FOR_CONFIDENT 
                             && timeSlotsWithData >= MIN_TIMESLOTS_FOR_CONFIDENT;
    const hasHighlyConfidentData = historicalData.length >= MIN_POINTS_FOR_HIGHLY_CONFIDENT 
                                   && timeSlotsWithData >= MIN_TIMESLOTS_FOR_HIGHLY_CONFIDENT;
    
    // Both time AND data requirements must be met
    if (weeksOfData >= WEEKS_FOR_HIGHLY_CONFIDENT && hasHighlyConfidentData) {
      status = 'highly_confident';
    } else if (weeksOfData >= WEEKS_FOR_CONFIDENT && hasConfidentData) {
      status = 'confident';
    } else if (weeksOfData >= 1 && hasMinimumData) {
      status = 'learning';
    }
    
    console.log(`🧠 Learning status: ${status}`, {
      weeksOfData,
      dataPoints: historicalData.length,
      timeSlots: timeSlotsWithData,
      meetsLearning: hasMinimumData,
      meetsConfident: hasConfidentData,
      meetsHighlyConfident: hasHighlyConfidentData,
    });
    
    const learning: VenueLearning = {
      venueId,
      learningProgress,
      dataPointsAnalyzed: historicalData.length,
      weeksOfData,
      oldestDataDate: oldestDate.toISOString(),
      newestDataDate: newestDate.toISOString(),
      timeSlots,
      bestNights,
      patterns,
      venueProfile,
      lastAnalyzed: new Date().toISOString(),
      status,
    };
    
    // Cache and persist
    this.cache.set(venueId, learning);
    this.persistLearning(venueId, learning);
    
    console.log(`🧠 Learning complete: ${learningProgress}% confident, ${patterns.length} patterns found`);
    
    return learning;
  }
  
  /**
   * Get cached or stored learning for a venue
   */
  getLearning(venueId: string): VenueLearning | null {
    // Check memory cache first
    if (this.cache.has(venueId)) {
      return this.cache.get(venueId)!;
    }
    
    // Check localStorage
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY}_${venueId}`);
      if (stored) {
        const learning = JSON.parse(stored) as VenueLearning;
        this.cache.set(venueId, learning);
        return learning;
      }
    } catch (error) {
      console.error('Error reading venue learning:', error);
    }
    
    return null;
  }
  
  /**
   * Get learned optimal ranges for the current time slot
   */
  getCurrentOptimalRanges(venueId: string): {
    sound: { min: number; max: number } | null;
    light: { min: number; max: number } | null;
    temperature: { min: number; max: number } | null;
    weights: { sound: number; light: number; temperature: number };
    isLearned: boolean;
    confidence: number;
  } {
    const learning = this.getLearning(venueId);
    const currentSlot = getCurrentTimeSlot();
    
    if (!learning || !learning.timeSlots[currentSlot]) {
      return {
        sound: null,
        light: null,
        temperature: null,
        weights: { sound: 0.45, light: 0.30, temperature: 0.15 },
        isLearned: false,
        confidence: 0,
      };
    }
    
    const slotLearning = learning.timeSlots[currentSlot]!;
    
    return {
      sound: slotLearning.sound ? { min: slotLearning.sound.min, max: slotLearning.sound.max } : null,
      light: slotLearning.light ? { min: slotLearning.light.min, max: slotLearning.light.max } : null,
      temperature: slotLearning.temperature ? { min: slotLearning.temperature.min, max: slotLearning.temperature.max } : null,
      weights: slotLearning.weights,
      isLearned: true,
      confidence: learning.learningProgress,
    };
  }
  
  // ============ PRIVATE METHODS ============
  
  private createEmptyLearning(venueId: string): VenueLearning {
    return {
      venueId,
      learningProgress: 0,
      dataPointsAnalyzed: 0,
      weeksOfData: 0,
      oldestDataDate: null,
      newestDataDate: null,
      timeSlots: {},
      bestNights: {},
      patterns: [],
      venueProfile: null,
      lastAnalyzed: new Date().toISOString(),
      status: 'insufficient_data',
    };
  }
  
  /**
   * Estimate dwell time for each data point using occupancy changes
   */
  private estimateDwellTimes(data: SensorData[]): Array<SensorData & { estimatedDwell: number }> {
    return data.map((d, i) => {
      // Simple heuristic: Use occupancy stability and entry/exit ratio
      const entries = d.occupancy?.entries || 0;
      const exits = d.occupancy?.exits || 0;
      const current = d.occupancy?.current || 0;
      
      // If more exits than entries, dwell is lower (people leaving)
      // If stable or more entries, dwell is higher (people staying)
      let estimatedDwell = 45; // Base 45 minutes
      
      if (current > 0 && entries > 0) {
        // Rough estimate: current / turnover rate
        const turnoverRate = exits / Math.max(entries, 1);
        if (turnoverRate < 0.5) {
          estimatedDwell = 70; // Low turnover = long stays
        } else if (turnoverRate < 1) {
          estimatedDwell = 55;
        } else if (turnoverRate > 1.5) {
          estimatedDwell = 30; // High turnover = short stays
        }
      }
      
      return { ...d, estimatedDwell };
    });
  }
  
  /**
   * Group data points by time slot
   */
  private groupByTimeSlot(data: Array<SensorData & { estimatedDwell: number }>): Record<string, Array<SensorData & { estimatedDwell: number }>> {
    const groups: Record<string, Array<SensorData & { estimatedDwell: number }>> = {};
    
    for (const d of data) {
      const date = new Date(d.timestamp);
      const slot = this.getTimeSlotForDate(date);
      if (!groups[slot]) groups[slot] = [];
      groups[slot].push(d);
    }
    
    return groups;
  }
  
  private getTimeSlotForDate(date: Date): TimeSlot {
    const day = date.getDay();
    const hour = date.getHours();
    
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
  
  /**
   * Analyze a single time slot to find optimal conditions
   */
  private analyzeTimeSlot(
    timeSlot: TimeSlot,
    data: Array<SensorData & { estimatedDwell: number }>,
    weeksOfData: number
  ): TimeSlotLearning {
    // Find optimal sound range
    const soundAnalysis = this.findOptimalRange(
      data,
      d => d.decibels,
      SOUND_BUCKETS
    );
    
    // Find optimal light range
    const lightAnalysis = this.findOptimalRange(
      data,
      d => d.light,
      LIGHT_BUCKETS
    );
    
    // Find optimal temperature range
    const tempAnalysis = this.findOptimalRange(
      data,
      d => d.indoorTemp,
      TEMP_BUCKETS
    );
    
    // Calculate dynamic weights based on correlation strength
    const weights = this.calculateDynamicWeights(soundAnalysis, lightAnalysis, tempAnalysis);
    
    return {
      timeSlot,
      sound: soundAnalysis,
      light: lightAnalysis,
      temperature: tempAnalysis,
      weights,
      dataPoints: data.length,
      weeksOfData,
    };
  }
  
  /**
   * Find the range that correlates with longest dwell times
   */
  private findOptimalRange(
    data: Array<SensorData & { estimatedDwell: number }>,
    getValue: (d: SensorData) => number | undefined | null,
    buckets: Array<{ min: number; max: number; label: string }>
  ): LearnedRange | null {
    // Calculate overall average dwell
    const overallDwell = data.reduce((sum, d) => sum + d.estimatedDwell, 0) / data.length;
    
    // Calculate average dwell per bucket
    const bucketStats = buckets.map(bucket => {
      const inBucket = data.filter(d => {
        const val = getValue(d);
        return val !== null && val !== undefined && val >= bucket.min && val < bucket.max;
      });
      
      if (inBucket.length < MIN_DATA_POINTS_PER_BUCKET) {
        return { bucket, avgDwell: 0, count: 0 };
      }
      
      const avgDwell = inBucket.reduce((sum, d) => sum + d.estimatedDwell, 0) / inBucket.length;
      return { bucket, avgDwell, count: inBucket.length };
    }).filter(b => b.count >= MIN_DATA_POINTS_PER_BUCKET);
    
    if (bucketStats.length === 0) return null;
    
    // Find bucket with highest average dwell
    const best = bucketStats.reduce((a, b) => a.avgDwell > b.avgDwell ? a : b);
    
    if (best.avgDwell <= overallDwell * 1.05) {
      // No significant improvement found
      return null;
    }
    
    const improvement = ((best.avgDwell - overallDwell) / overallDwell) * 100;
    const confidence = Math.min(100, (best.count / 20) * 100); // 20+ data points = 100% confidence
    
    return {
      min: best.bucket.min,
      max: best.bucket.max,
      avgDwellWhenOptimal: Math.round(best.avgDwell),
      avgDwellOverall: Math.round(overallDwell),
      improvement: Math.round(improvement),
      dataPoints: best.count,
      confidence,
    };
  }
  
  /**
   * Calculate dynamic weights based on which factors have strongest correlation
   */
  private calculateDynamicWeights(
    sound: LearnedRange | null,
    light: LearnedRange | null,
    temp: LearnedRange | null
  ): { sound: number; light: number; temperature: number } {
    // Base weights
    let soundWeight = 0.45;
    let lightWeight = 0.30;
    let tempWeight = 0.15;
    
    // Adjust based on improvement percentages
    const soundImpact = sound?.improvement || 0;
    const lightImpact = light?.improvement || 0;
    const tempImpact = temp?.improvement || 0;
    const totalImpact = soundImpact + lightImpact + tempImpact;
    
    if (totalImpact > 0) {
      // Redistribute weights based on actual impact
      const vibeWeight = 0.10; // Keep vibe constant
      const remaining = 1 - vibeWeight;
      
      soundWeight = remaining * (soundImpact / totalImpact) || 0.33 * remaining;
      lightWeight = remaining * (lightImpact / totalImpact) || 0.33 * remaining;
      tempWeight = remaining * (tempImpact / totalImpact) || 0.33 * remaining;
      
      // Ensure minimum weights
      soundWeight = Math.max(0.15, soundWeight);
      lightWeight = Math.max(0.10, lightWeight);
      tempWeight = Math.max(0.05, tempWeight);
      
      // Normalize to sum to 0.9 (leaving 0.1 for vibe)
      const sum = soundWeight + lightWeight + tempWeight;
      soundWeight = (soundWeight / sum) * 0.9;
      lightWeight = (lightWeight / sum) * 0.9;
      tempWeight = (tempWeight / sum) * 0.9;
    }
    
    return {
      sound: Math.round(soundWeight * 100) / 100,
      light: Math.round(lightWeight * 100) / 100,
      temperature: Math.round(tempWeight * 100) / 100,
    };
  }
  
  /**
   * Discover notable patterns in the data
   */
  private discoverPatterns(
    data: Array<SensorData & { estimatedDwell: number }>,
    timeSlots: Partial<Record<TimeSlot, TimeSlotLearning>>,
    weeksOfData: number
  ): DiscoveredPattern[] {
    const patterns: DiscoveredPattern[] = [];
    const slotLabels: Record<TimeSlot, string> = {
      weekday_happy_hour: 'happy hour',
      weekday_night: 'weeknights',
      friday_early: 'Friday evenings',
      friday_peak: 'Friday nights',
      saturday_early: 'Saturday evenings',
      saturday_peak: 'Saturday nights',
      sunday_funday: 'Sundays',
      daytime: 'daytime',
    };
    
    // Pattern: Best time slot for dwell
    for (const [slot, learning] of Object.entries(timeSlots)) {
      if (learning.sound?.improvement && learning.sound.improvement >= 15) {
        patterns.push({
          id: `sound_${slot}`,
          description: `On ${slotLabels[slot as TimeSlot]}, when sound is ${learning.sound.min}-${learning.sound.max}dB, guests stay ${learning.sound.improvement}% longer`,
          impact: `+${learning.sound.improvement}% longer stays`,
          confidence: Math.min(100, weeksOfData * 12),
          factor: 'sound',
          timeSlot: slot as TimeSlot,
          actionable: true,
        });
      }
      
      if (learning.light?.improvement && learning.light.improvement >= 15) {
        patterns.push({
          id: `light_${slot}`,
          description: `On ${slotLabels[slot as TimeSlot]}, when lighting is ${learning.light.min}-${learning.light.max} lux, guests stay ${learning.light.improvement}% longer`,
          impact: `+${learning.light.improvement}% longer stays`,
          confidence: Math.min(100, weeksOfData * 12),
          factor: 'light',
          timeSlot: slot as TimeSlot,
          actionable: true,
        });
      }
    }
    
    // Sort by confidence and limit
    return patterns
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }
  
  /**
   * Build overall venue profile
   */
  private buildVenueProfile(data: Array<SensorData & { estimatedDwell: number }>): VenueLearning['venueProfile'] {
    if (data.length < 10) return null;
    
    // Find peak day
    const byDay: Record<number, number[]> = {};
    data.forEach(d => {
      const day = new Date(d.timestamp).getDay();
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(d.occupancy?.current || 0);
    });
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let peakDay = 0;
    let peakAvg = 0;
    Object.entries(byDay).forEach(([day, values]) => {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      if (avg > peakAvg) {
        peakAvg = avg;
        peakDay = parseInt(day);
      }
    });
    
    // Find peak hour
    const byHour: Record<number, number[]> = {};
    data.forEach(d => {
      const hour = new Date(d.timestamp).getHours();
      if (!byHour[hour]) byHour[hour] = [];
      byHour[hour].push(d.occupancy?.current || 0);
    });
    
    let peakHour = 21;
    let peakHourAvg = 0;
    Object.entries(byHour).forEach(([hour, values]) => {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      if (avg > peakHourAvg) {
        peakHourAvg = avg;
        peakHour = parseInt(hour);
      }
    });
    
    // Dwell stats
    const dwellTimes = data.map(d => d.estimatedDwell);
    const avgDwell = dwellTimes.reduce((a, b) => a + b, 0) / dwellTimes.length;
    const bestDwell = Math.max(...dwellTimes);
    const worstDwell = Math.min(...dwellTimes);
    
    return {
      peakDayOfWeek: dayNames[peakDay],
      peakHour,
      avgDwellTime: Math.round(avgDwell),
      bestDwellTime: Math.round(bestDwell),
      worstDwellTime: Math.round(worstDwell),
    };
  }
  
  /**
   * Calculate overall learning progress (0-100%)
   * 
   * Weights:
   * - 40% time: weeks of data (need 8 for max)
   * - 40% volume: data points (need 500+ for max)
   * - 20% coverage: time slots covered (need 5+ for max)
   */
  private calculateLearningProgress(weeksOfData: number, dataPoints: number, timeSlotsCovered: number): number {
    // Time progress - how many weeks of data do we have?
    const timeProgress = Math.min(100, (weeksOfData / WEEKS_FOR_HIGHLY_CONFIDENT) * 100);
    
    // Data volume progress - how many data points?
    const dataProgress = Math.min(100, (dataPoints / MIN_POINTS_FOR_HIGHLY_CONFIDENT) * 100);
    
    // Coverage progress - how many time slots have data?
    const slotProgress = Math.min(100, (timeSlotsCovered / MIN_TIMESLOTS_FOR_HIGHLY_CONFIDENT) * 100);
    
    // Weighted average: 40% time, 40% data, 20% coverage
    const progress = (timeProgress * 0.4) + (dataProgress * 0.4) + (slotProgress * 0.2);
    
    return Math.round(progress);
  }
  
  private persistLearning(venueId: string, learning: VenueLearning): void {
    try {
      localStorage.setItem(`${STORAGE_KEY}_${venueId}`, JSON.stringify(learning));
    } catch (error) {
      console.error('Error persisting venue learning:', error);
    }
  }
  
  /**
   * Find the BEST night for each time slot based on:
   * - Total guests (primary metric)
   * - Average dwell time (secondary metric)
   * 
   * Returns the actual conditions during those best nights.
   */
  private findBestNights(
    data: Array<SensorData & { estimatedDwell: number }>,
    byTimeSlot: Record<string, Array<SensorData & { estimatedDwell: number }>>
  ): Partial<Record<TimeSlot, BestNightProfile>> {
    const bestNights: Partial<Record<TimeSlot, BestNightProfile>> = {};
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    for (const [slot, slotData] of Object.entries(byTimeSlot)) {
      if (slotData.length < 5) continue; // Need minimum data
      
      // Group by calendar date (night)
      const byNight: Record<string, Array<SensorData & { estimatedDwell: number }>> = {};
      
      for (const d of slotData) {
        const date = new Date(d.timestamp);
        // Use date string as key (YYYY-MM-DD)
        const dateKey = date.toISOString().split('T')[0];
        if (!byNight[dateKey]) byNight[dateKey] = [];
        byNight[dateKey].push(d);
      }
      
      // Calculate metrics for each night
      const nightMetrics: Array<{
        dateKey: string;
        date: Date;
        dataPoints: Array<SensorData & { estimatedDwell: number }>;
        totalGuests: number;
        peakOccupancy: number;
        avgDwell: number;
        avgSound: number;
        avgLight: number;
        topArtists: string[];
        detectedGenres: string[];
        songCount: number;
        score: number; // Combined score for ranking
      }> = [];
      
      for (const [dateKey, nightData] of Object.entries(byNight)) {
        if (nightData.length < 3) continue; // Need at least 3 data points per night
        
        // Calculate total guests
        // Handles both raw data (cumulative) and hourly data (per-hour totals)
        const withEntries = nightData.filter(d => d.occupancy?.entries !== undefined && d.occupancy?.entries !== null);
        let totalGuests = 0;
        if (withEntries.length > 0) {
          const sorted = [...withEntries].sort((a, b) => 
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          
          const isHourlyData = (sorted[0] as any)._hourlyAggregate === true;
          
          if (isHourlyData) {
            // HOURLY DATA: Sum all entries
            totalGuests = sorted.reduce((sum, d) => sum + (d.occupancy?.entries || 0), 0);
          } else if (sorted.length >= 2) {
            // RAW DATA: latest - earliest
            const earliest = sorted[0];
            const latest = sorted[sorted.length - 1];
            totalGuests = Math.max(0, latest.occupancy!.entries - earliest.occupancy!.entries);
          }
        }
        
        // Peak occupancy
        const peakOccupancy = Math.max(...nightData.map(d => d.occupancy?.current || 0));
        
        // Average dwell time
        const avgDwell = nightData.reduce((sum, d) => sum + d.estimatedDwell, 0) / nightData.length;
        
        // Average environmental conditions
        const withSound = nightData.filter(d => d.decibels != null);
        const avgSound = withSound.length > 0 
          ? withSound.reduce((sum, d) => sum + (d.decibels || 0), 0) / withSound.length 
          : 0;
        
        const withLight = nightData.filter(d => d.light != null);
        const avgLight = withLight.length > 0 
          ? withLight.reduce((sum, d) => sum + (d.light || 0), 0) / withLight.length 
          : 0;
        
        // Collect music/artist data from this night
        const artistsPlayed: string[] = [];
        const songsPlayed: string[] = [];
        for (const d of nightData) {
          if (d.artist && !artistsPlayed.includes(d.artist)) {
            artistsPlayed.push(d.artist);
          }
          if (d.currentSong && !songsPlayed.includes(d.currentSong)) {
            songsPlayed.push(d.currentSong);
          }
        }
        
        // Detect genres from songs/artists using keyword matching
        const detectedGenres: string[] = [];
        const searchText = [...artistsPlayed, ...songsPlayed].join(' ').toLowerCase();
        
        // Import genre keywords from constants
        const genreKeywords: Record<string, string[]> = {
          'hip-hop': ['hip hop', 'hip-hop', 'rap', 'trap', 'drake', 'kendrick', 'kanye', 'jay-z', 'lil wayne', 'future', 'migos', 'cardi b', 'nicki minaj', 'j cole', 'travis scott', 'post malone'],
          'r&b': ['r&b', 'rnb', 'soul', 'usher', 'beyonce', 'sza', 'frank ocean', 'the weeknd', 'chris brown', 'rihanna', 'alicia keys', 'bruno mars'],
          'pop': ['pop', 'taylor swift', 'ariana grande', 'justin bieber', 'dua lipa', 'harry styles', 'billie eilish', 'olivia rodrigo', 'ed sheeran', 'doja cat'],
          'edm': ['edm', 'electronic', 'house', 'techno', 'calvin harris', 'marshmello', 'chainsmokers', 'david guetta', 'tiesto', 'zedd', 'martin garrix'],
          'country': ['country', 'nashville', 'luke bryan', 'morgan wallen', 'luke combs', 'chris stapleton', 'kane brown', 'jason aldean'],
          'rock': ['rock', 'guitar', 'metal', 'punk', 'foo fighters', 'red hot chili', 'green day', 'imagine dragons'],
          'latin': ['latin', 'reggaeton', 'bad bunny', 'j balvin', 'daddy yankee', 'ozuna', 'maluma', 'karol g', 'shakira'],
          'jazz': ['jazz', 'smooth', 'saxophone', 'coltrane', 'miles davis', 'norah jones'],
          'dance': ['dance', 'club', 'party', 'disco', 'funk', 'daft punk'],
        };
        
        for (const [genre, keywords] of Object.entries(genreKeywords)) {
          if (keywords.some(kw => searchText.includes(kw))) {
            detectedGenres.push(genre);
          }
        }
        
        // Combined score: prioritize total guests, then dwell time
        // Normalize: assume max 500 guests and 120 min dwell for scaling
        const guestScore = Math.min(100, (totalGuests / 200) * 100); // 200 guests = 100 score
        const dwellScore = Math.min(100, (avgDwell / 90) * 100);      // 90 min = 100 score
        const score = (guestScore * 0.6) + (dwellScore * 0.4);        // 60% guests, 40% dwell
        
        nightMetrics.push({
          dateKey,
          date: new Date(dateKey),
          dataPoints: nightData,
          totalGuests,
          peakOccupancy,
          avgDwell,
          avgSound,
          avgLight,
          topArtists: artistsPlayed.slice(0, 10),  // Top 10 artists
          detectedGenres,
          songCount: songsPlayed.length,
          score,
        });
      }
      
      if (nightMetrics.length === 0) continue;
      
      // Find the best night (highest combined score)
      const bestNight = nightMetrics.reduce((a, b) => a.score > b.score ? a : b);
      
      // Only include if we have meaningful data
      if (bestNight.totalGuests < 5 && bestNight.peakOccupancy < 5) continue;
      
      // Find peak hour within this best night
      const hourlyData: Record<number, Array<SensorData & { estimatedDwell: number }>> = {};
      for (const d of bestNight.dataPoints) {
        const hour = new Date(d.timestamp).getHours();
        if (!hourlyData[hour]) hourlyData[hour] = [];
        hourlyData[hour].push(d);
      }
      
      let peakHour = 21;
      let peakHourOccupancy = 0;
      let peakHourSound: number | undefined;
      let peakHourLight: number | undefined;
      
      for (const [hourStr, hourData] of Object.entries(hourlyData)) {
        const avgOccupancy = hourData.reduce((sum, d) => sum + (d.occupancy?.current || 0), 0) / hourData.length;
        if (avgOccupancy > peakHourOccupancy) {
          peakHourOccupancy = avgOccupancy;
          peakHour = parseInt(hourStr);
          const withSound = hourData.filter(d => d.decibels != null);
          peakHourSound = withSound.length > 0 
            ? withSound.reduce((sum, d) => sum + (d.decibels || 0), 0) / withSound.length 
            : undefined;
          const withLight = hourData.filter(d => d.light != null);
          peakHourLight = withLight.length > 0 
            ? withLight.reduce((sum, d) => sum + (d.light || 0), 0) / withLight.length 
            : undefined;
        }
      }
      
      bestNights[slot as TimeSlot] = {
        date: bestNight.dateKey,
        dayOfWeek: dayNames[bestNight.date.getDay()],
        timeSlot: slot as TimeSlot,
        totalGuests: Math.round(bestNight.totalGuests),
        peakOccupancy: Math.round(bestNight.peakOccupancy),
        avgDwellMinutes: Math.round(bestNight.avgDwell),
        avgSound: Math.round(bestNight.avgSound),
        avgLight: Math.round(bestNight.avgLight),
        topArtists: bestNight.topArtists,
        detectedGenres: bestNight.detectedGenres,
        songCount: bestNight.songCount,
        peakHour,
        peakHourSound: peakHourSound ? Math.round(peakHourSound) : undefined,
        peakHourLight: peakHourLight ? Math.round(peakHourLight) : undefined,
        dataPointsFromNight: bestNight.dataPoints.length,
        confidence: Math.min(100, bestNight.dataPoints.length * 10), // 10+ data points = 100%
      };
    }
    
    console.log(`🏆 Found best nights for ${Object.keys(bestNights).length} time slots`);
    
    return bestNights;
  }
  
  /**
   * Get the Best Night Profile for the current time slot
   */
  getBestNightProfile(venueId: string, timeSlot?: TimeSlot): BestNightProfile | null {
    const learning = this.getLearning(venueId);
    const slot = timeSlot || getCurrentTimeSlot();
    
    if (!learning || !learning.bestNights || !learning.bestNights[slot]) {
      return null;
    }
    
    return learning.bestNights[slot] || null;
  }
}

export const venueLearningService = new VenueLearningService();
export default venueLearningService;
