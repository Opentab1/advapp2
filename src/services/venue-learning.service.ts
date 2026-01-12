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

export interface VenueLearning {
  venueId: string;
  learningProgress: number;       // 0-100%
  dataPointsAnalyzed: number;
  weeksOfData: number;
  oldestDataDate: string | null;
  newestDataDate: string | null;
  
  // Learned ranges per time slot
  timeSlots: Partial<Record<TimeSlot, TimeSlotLearning>>;
  
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

const WEEKS_FOR_CONFIDENT = 4;
const WEEKS_FOR_HIGHLY_CONFIDENT = 8;
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
    
    // Build venue profile
    const venueProfile = this.buildVenueProfile(dataWithDwell);
    
    // Calculate learning progress
    const learningProgress = this.calculateLearningProgress(weeksOfData, historicalData.length, Object.keys(timeSlots).length);
    
    // Determine status
    let status: VenueLearning['status'] = 'insufficient_data';
    if (weeksOfData >= WEEKS_FOR_HIGHLY_CONFIDENT) status = 'highly_confident';
    else if (weeksOfData >= WEEKS_FOR_CONFIDENT) status = 'confident';
    else if (weeksOfData >= 1) status = 'learning';
    
    const learning: VenueLearning = {
      venueId,
      learningProgress,
      dataPointsAnalyzed: historicalData.length,
      weeksOfData,
      oldestDataDate: oldestDate.toISOString(),
      newestDataDate: newestDate.toISOString(),
      timeSlots,
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
   */
  private calculateLearningProgress(weeksOfData: number, dataPoints: number, timeSlotsCovered: number): number {
    // Factors:
    // - Weeks of data (40% weight) - need 8 weeks for full confidence
    // - Data points (30% weight) - need 1000+ for full confidence
    // - Time slots covered (30% weight) - need all 8 for full confidence
    
    const weekScore = Math.min(100, (weeksOfData / WEEKS_FOR_HIGHLY_CONFIDENT) * 100);
    const dataScore = Math.min(100, (dataPoints / 1000) * 100);
    const slotScore = Math.min(100, (timeSlotsCovered / 8) * 100);
    
    const progress = (weekScore * 0.4) + (dataScore * 0.3) + (slotScore * 0.3);
    return Math.round(progress);
  }
  
  private persistLearning(venueId: string, learning: VenueLearning): void {
    try {
      localStorage.setItem(`${STORAGE_KEY}_${venueId}`, JSON.stringify(learning));
    } catch (error) {
      console.error('Error persisting venue learning:', error);
    }
  }
}

export const venueLearningService = new VenueLearningService();
export default venueLearningService;
