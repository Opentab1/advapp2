import type { SensorData } from '../types';
import dynamoDBService from './dynamodb.service';
import authService from './auth.service';
import { calculateRecentDwellTime } from '../utils/dwellTime';

export interface OptimalCondition {
  factor: string;
  currentValue: number | string;
  optimalRange: { min: number; max: number } | string;
  optimalValue: string;
  isOptimal: boolean;
  priority: 'high' | 'medium' | 'low' | 'optimal';
  recommendation: string;
  potentialDwellIncrease: number; // in minutes
  icon: string;
  color: string;
}

export interface TimeSlotInsight {
  timeSlot: string;
  avgDwellTime: number;
  topGenre?: string;
  topSong?: string;
  avgOccupancy: number;
  conditions: {
    avgTemp: number;
    avgSound: number;
    avgLight: number;
  };
}

export interface PulseRecommendationsData {
  currentDwellTime: number | null;
  bestDwellTime: number;
  recommendations: OptimalCondition[];
  timeSlotInsights: TimeSlotInsight[];
  musicRecommendations: Array<{
    type: 'genre' | 'song' | 'time';
    recommendation: string;
    reason: string;
    potentialIncrease: number;
    icon: string;
  }>;
  dataQuality: {
    daysOfData: number;
    totalReadings: number;
    confidence: 'low' | 'medium' | 'high';
  };
}

class PulseRecommendationsService {
  private cache: PulseRecommendationsData | null = null;
  private lastFetch: number = 0;
  private readonly CACHE_TTL = 300000; // 5 minutes

  async getRecommendations(): Promise<PulseRecommendationsData | null> {
    const now = Date.now();
    
    if (this.cache && (now - this.lastFetch) < this.CACHE_TTL) {
      return this.cache;
    }

    try {
      const user = authService.getStoredUser();
      const venueId = user?.venueId;
      
      if (!venueId) {
        return null;
      }

      // Fetch 30 days of historical data
      const historicalData = await dynamoDBService.getHistoricalSensorData(venueId, '30d');
      
      if (!historicalData?.data || historicalData.data.length < 100) {
        return this.getInsufficientDataResponse(historicalData?.data?.length || 0);
      }

      const data = historicalData.data;
      
      // Analyze the data
      const analysis = this.analyzeHistoricalData(data);
      
      // Get current conditions (most recent reading)
      const currentData = data.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )[0];

      // Calculate current dwell time
      const currentDwellTime = calculateRecentDwellTime(data.slice(0, 100), 2);

      // Generate recommendations
      const recommendations = this.generateRecommendations(currentData, analysis);
      
      // Generate music recommendations
      const musicRecommendations = this.generateMusicRecommendations(data, analysis);
      
      // Get time slot insights
      const timeSlotInsights = this.getTimeSlotInsights(data);

      const result: PulseRecommendationsData = {
        currentDwellTime,
        bestDwellTime: analysis.bestDwellTime,
        recommendations,
        timeSlotInsights,
        musicRecommendations,
        dataQuality: {
          daysOfData: analysis.uniqueDays,
          totalReadings: data.length,
          confidence: analysis.uniqueDays >= 14 ? 'high' : analysis.uniqueDays >= 7 ? 'medium' : 'low'
        }
      };

      this.cache = result;
      this.lastFetch = now;

      return result;
    } catch (error) {
      console.error('Error getting pulse recommendations:', error);
      return null;
    }
  }

  private analyzeHistoricalData(data: SensorData[]): {
    optimalTemp: { min: number; max: number; avgDwell: number };
    optimalSound: { min: number; max: number; avgDwell: number };
    optimalLight: { min: number; max: number; avgDwell: number };
    optimalHumidity: { min: number; max: number; avgDwell: number };
    bestDwellTime: number;
    uniqueDays: number;
    topSongs: Map<string, { plays: number; avgOccupancy: number }>;
    topTimeSlots: Map<string, { avgDwell: number; avgOccupancy: number }>;
  } {
    // Group data by time windows (2-hour blocks) to calculate dwell-like metrics
    const timeWindows: Map<string, SensorData[]> = new Map();
    
    data.forEach(reading => {
      const date = new Date(reading.timestamp);
      const windowKey = `${date.toDateString()}-${Math.floor(date.getHours() / 2) * 2}`;
      if (!timeWindows.has(windowKey)) {
        timeWindows.set(windowKey, []);
      }
      timeWindows.get(windowKey)!.push(reading);
    });

    // Calculate metrics for each window
    const windowMetrics: Array<{
      temp: number;
      sound: number;
      light: number;
      humidity: number;
      occupancy: number;
      occupancyStability: number; // Higher = people staying (good dwell)
      song?: string;
      hour: number;
    }> = [];

    timeWindows.forEach((readings, key) => {
      if (readings.length < 3) return;

      const sorted = readings.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      const avgTemp = readings.reduce((s, r) => s + r.indoorTemp, 0) / readings.length;
      const avgSound = readings.reduce((s, r) => s + r.decibels, 0) / readings.length;
      const avgLight = readings.reduce((s, r) => s + r.light, 0) / readings.length;
      const avgHumidity = readings.reduce((s, r) => s + r.humidity, 0) / readings.length;
      
      const occupancies = readings.filter(r => r.occupancy?.current).map(r => r.occupancy!.current);
      const avgOccupancy = occupancies.length > 0 
        ? occupancies.reduce((s, o) => s + o, 0) / occupancies.length 
        : 0;

      // Occupancy stability: how stable/growing was occupancy (proxy for dwell)
      // If people are staying, occupancy grows or stays stable
      const firstOcc = sorted[0].occupancy?.current || 0;
      const lastOcc = sorted[sorted.length - 1].occupancy?.current || 0;
      const occupancyStability = lastOcc - firstOcc + avgOccupancy; // Combine growth with base

      const hour = new Date(readings[0].timestamp).getHours();
      const song = readings.find(r => r.currentSong)?.currentSong;

      windowMetrics.push({
        temp: avgTemp,
        sound: avgSound,
        light: avgLight,
        humidity: avgHumidity,
        occupancy: avgOccupancy,
        occupancyStability,
        song,
        hour
      });
    });

    // Sort by occupancy stability (proxy for dwell time) and take top 20%
    const sortedByDwell = [...windowMetrics].sort((a, b) => b.occupancyStability - a.occupancyStability);
    const topPerformers = sortedByDwell.slice(0, Math.ceil(sortedByDwell.length * 0.2));

    // Calculate optimal ranges from top performers
    const calcRange = (values: number[]): { min: number; max: number; avg: number } => {
      const sorted = [...values].sort((a, b) => a - b);
      const q1 = sorted[Math.floor(sorted.length * 0.25)];
      const q3 = sorted[Math.floor(sorted.length * 0.75)];
      const avg = values.reduce((s, v) => s + v, 0) / values.length;
      return { min: Math.round(q1), max: Math.round(q3), avg };
    };

    const topTemps = topPerformers.map(p => p.temp);
    const topSounds = topPerformers.map(p => p.sound);
    const topLights = topPerformers.map(p => p.light);
    const topHumidities = topPerformers.map(p => p.humidity);

    const tempRange = calcRange(topTemps);
    const soundRange = calcRange(topSounds);
    const lightRange = calcRange(topLights);
    const humidityRange = calcRange(topHumidities);

    // Track songs
    const topSongs = new Map<string, { plays: number; avgOccupancy: number }>();
    data.forEach(reading => {
      if (!reading.currentSong) return;
      const key = reading.currentSong;
      const existing = topSongs.get(key) || { plays: 0, avgOccupancy: 0 };
      const occ = reading.occupancy?.current || 0;
      topSongs.set(key, {
        plays: existing.plays + 1,
        avgOccupancy: (existing.avgOccupancy * existing.plays + occ) / (existing.plays + 1)
      });
    });

    // Track time slots
    const topTimeSlots = new Map<string, { totalDwell: number; totalOcc: number; count: number }>();
    topPerformers.forEach(p => {
      const slot = this.getTimeSlotLabel(p.hour);
      const existing = topTimeSlots.get(slot) || { totalDwell: 0, totalOcc: 0, count: 0 };
      topTimeSlots.set(slot, {
        totalDwell: existing.totalDwell + p.occupancyStability,
        totalOcc: existing.totalOcc + p.occupancy,
        count: existing.count + 1
      });
    });

    const timeSlotResults = new Map<string, { avgDwell: number; avgOccupancy: number }>();
    topTimeSlots.forEach((v, k) => {
      timeSlotResults.set(k, {
        avgDwell: v.totalDwell / v.count,
        avgOccupancy: v.totalOcc / v.count
      });
    });

    // Unique days
    const uniqueDays = new Set(data.map(d => new Date(d.timestamp).toDateString())).size;

    // Best dwell time (from top performer)
    const bestDwellTime = topPerformers.length > 0 
      ? Math.round(topPerformers[0].occupancyStability * 2) // Rough estimate in minutes
      : 60;

    return {
      optimalTemp: { min: tempRange.min, max: tempRange.max, avgDwell: bestDwellTime },
      optimalSound: { min: soundRange.min, max: soundRange.max, avgDwell: bestDwellTime },
      optimalLight: { min: lightRange.min, max: lightRange.max, avgDwell: bestDwellTime },
      optimalHumidity: { min: humidityRange.min, max: humidityRange.max, avgDwell: bestDwellTime },
      bestDwellTime,
      uniqueDays,
      topSongs,
      topTimeSlots: timeSlotResults
    };
  }

  private generateRecommendations(
    current: SensorData,
    analysis: ReturnType<typeof this.analyzeHistoricalData>
  ): OptimalCondition[] {
    const recommendations: OptimalCondition[] = [];

    // Temperature
    const tempOptimal = current.indoorTemp >= analysis.optimalTemp.min && 
                        current.indoorTemp <= analysis.optimalTemp.max;
    const tempDiff = tempOptimal ? 0 : 
      current.indoorTemp < analysis.optimalTemp.min 
        ? analysis.optimalTemp.min - current.indoorTemp
        : current.indoorTemp - analysis.optimalTemp.max;
    
    recommendations.push({
      factor: 'Temperature',
      currentValue: Math.round(current.indoorTemp),
      optimalRange: analysis.optimalTemp,
      optimalValue: `${analysis.optimalTemp.min}-${analysis.optimalTemp.max}°F`,
      isOptimal: tempOptimal,
      priority: tempOptimal ? 'optimal' : tempDiff > 5 ? 'high' : 'medium',
      recommendation: tempOptimal 
        ? 'Temperature is in your optimal range'
        : current.indoorTemp < analysis.optimalTemp.min
          ? `Increase temperature to ${analysis.optimalTemp.min}-${analysis.optimalTemp.max}°F`
          : `Decrease temperature to ${analysis.optimalTemp.min}-${analysis.optimalTemp.max}°F`,
      potentialDwellIncrease: tempOptimal ? 0 : Math.round(tempDiff * 3),
      icon: '🌡️',
      color: tempOptimal ? '#4ade80' : tempDiff > 5 ? '#f87171' : '#fbbf24'
    });

    // Sound
    const soundOptimal = current.decibels >= analysis.optimalSound.min && 
                         current.decibels <= analysis.optimalSound.max;
    const soundDiff = soundOptimal ? 0 :
      current.decibels < analysis.optimalSound.min
        ? analysis.optimalSound.min - current.decibels
        : current.decibels - analysis.optimalSound.max;

    recommendations.push({
      factor: 'Sound Level',
      currentValue: Math.round(current.decibels),
      optimalRange: analysis.optimalSound,
      optimalValue: `${analysis.optimalSound.min}-${analysis.optimalSound.max} dB`,
      isOptimal: soundOptimal,
      priority: soundOptimal ? 'optimal' : soundDiff > 10 ? 'high' : 'medium',
      recommendation: soundOptimal
        ? 'Sound level is in your optimal range'
        : current.decibels < analysis.optimalSound.min
          ? `Turn up the music to ${analysis.optimalSound.min}-${analysis.optimalSound.max} dB`
          : `Lower the volume to ${analysis.optimalSound.min}-${analysis.optimalSound.max} dB`,
      potentialDwellIncrease: soundOptimal ? 0 : Math.round(soundDiff * 1.5),
      icon: '🔊',
      color: soundOptimal ? '#4ade80' : soundDiff > 10 ? '#f87171' : '#fbbf24'
    });

    // Light
    const lightOptimal = current.light >= analysis.optimalLight.min && 
                         current.light <= analysis.optimalLight.max;
    const lightDiff = lightOptimal ? 0 :
      current.light < analysis.optimalLight.min
        ? (analysis.optimalLight.min - current.light) / 10
        : (current.light - analysis.optimalLight.max) / 10;

    recommendations.push({
      factor: 'Lighting',
      currentValue: Math.round(current.light),
      optimalRange: analysis.optimalLight,
      optimalValue: `${analysis.optimalLight.min}-${analysis.optimalLight.max} lux`,
      isOptimal: lightOptimal,
      priority: lightOptimal ? 'optimal' : lightDiff > 5 ? 'high' : 'medium',
      recommendation: lightOptimal
        ? 'Lighting is in your optimal range'
        : current.light < analysis.optimalLight.min
          ? `Increase lighting to ${analysis.optimalLight.min}-${analysis.optimalLight.max} lux`
          : `Dim lights to ${analysis.optimalLight.min}-${analysis.optimalLight.max} lux`,
      potentialDwellIncrease: lightOptimal ? 0 : Math.round(lightDiff * 2),
      icon: '💡',
      color: lightOptimal ? '#4ade80' : lightDiff > 5 ? '#f87171' : '#fbbf24'
    });

    // Humidity
    const humidityOptimal = current.humidity >= analysis.optimalHumidity.min && 
                            current.humidity <= analysis.optimalHumidity.max;
    const humidityDiff = humidityOptimal ? 0 :
      current.humidity < analysis.optimalHumidity.min
        ? analysis.optimalHumidity.min - current.humidity
        : current.humidity - analysis.optimalHumidity.max;

    recommendations.push({
      factor: 'Humidity',
      currentValue: Math.round(current.humidity),
      optimalRange: analysis.optimalHumidity,
      optimalValue: `${analysis.optimalHumidity.min}-${analysis.optimalHumidity.max}%`,
      isOptimal: humidityOptimal,
      priority: humidityOptimal ? 'optimal' : humidityDiff > 15 ? 'high' : 'low',
      recommendation: humidityOptimal
        ? 'Humidity is in your optimal range'
        : current.humidity < analysis.optimalHumidity.min
          ? `Increase humidity to ${analysis.optimalHumidity.min}-${analysis.optimalHumidity.max}%`
          : `Decrease humidity to ${analysis.optimalHumidity.min}-${analysis.optimalHumidity.max}%`,
      potentialDwellIncrease: humidityOptimal ? 0 : Math.round(humidityDiff * 0.5),
      icon: '💧',
      color: humidityOptimal ? '#4ade80' : humidityDiff > 15 ? '#f87171' : '#fbbf24'
    });

    // Sort by priority (non-optimal first, then by potential increase)
    return recommendations.sort((a, b) => {
      if (a.isOptimal && !b.isOptimal) return 1;
      if (!a.isOptimal && b.isOptimal) return -1;
      return b.potentialDwellIncrease - a.potentialDwellIncrease;
    });
  }

  private generateMusicRecommendations(
    data: SensorData[],
    analysis: ReturnType<typeof this.analyzeHistoricalData>
  ): PulseRecommendationsData['musicRecommendations'] {
    const recommendations: PulseRecommendationsData['musicRecommendations'] = [];

    // Find songs with highest occupancy correlation
    const songsByOccupancy = Array.from(analysis.topSongs.entries())
      .filter(([_, stats]) => stats.plays >= 3) // At least 3 plays
      .sort((a, b) => b[1].avgOccupancy - a[1].avgOccupancy)
      .slice(0, 5);

    if (songsByOccupancy.length > 0) {
      const topSong = songsByOccupancy[0];
      const avgOcc = Math.round(topSong[1].avgOccupancy);
      
      recommendations.push({
        type: 'song',
        recommendation: `Play "${topSong[0]}" more often`,
        reason: `Avg ${avgOcc} people in venue when playing (${topSong[1].plays} plays analyzed)`,
        potentialIncrease: Math.round(avgOcc * 0.15), // 15% of occupancy as dwell boost estimate
        icon: '🎵'
      });
    }

    // Time-based recommendations
    const timeSlots = Array.from(analysis.topTimeSlots.entries())
      .sort((a, b) => b[1].avgDwell - a[1].avgDwell);

    if (timeSlots.length > 0) {
      const bestSlot = timeSlots[0];
      recommendations.push({
        type: 'time',
        recommendation: `Optimize for ${bestSlot[0]}`,
        reason: `Your highest dwell times occur during ${bestSlot[0]} with avg ${Math.round(bestSlot[1].avgOccupancy)} people`,
        potentialIncrease: Math.round(bestSlot[1].avgDwell * 0.1),
        icon: '⏰'
      });
    }

    // Current hour recommendation
    const currentHour = new Date().getHours();
    const currentSlot = this.getTimeSlotLabel(currentHour);
    const slotData = analysis.topTimeSlots.get(currentSlot);
    
    if (slotData) {
      recommendations.push({
        type: 'time',
        recommendation: `Right now (${currentSlot}) is ${timeSlots.findIndex(t => t[0] === currentSlot) < 2 ? 'a peak' : 'not your peak'} time`,
        reason: `Historical avg: ${Math.round(slotData.avgOccupancy)} people during ${currentSlot}`,
        potentialIncrease: 0,
        icon: '📊'
      });
    }

    return recommendations;
  }

  private getTimeSlotInsights(data: SensorData[]): TimeSlotInsight[] {
    const slotData = new Map<string, {
      readings: number;
      totalOccupancy: number;
      totalTemp: number;
      totalSound: number;
      totalLight: number;
      songs: Map<string, number>;
    }>();

    // Initialize all slots
    const slots = ['6-8 AM', '8-10 AM', '10 AM-12 PM', '12-2 PM', '2-4 PM', '4-6 PM', '6-8 PM', '8-10 PM', '10 PM-12 AM', '12-2 AM', '2-4 AM', '4-6 AM'];
    slots.forEach(slot => {
      slotData.set(slot, {
        readings: 0,
        totalOccupancy: 0,
        totalTemp: 0,
        totalSound: 0,
        totalLight: 0,
        songs: new Map()
      });
    });

    data.forEach(reading => {
      const hour = new Date(reading.timestamp).getHours();
      const slot = this.getTimeSlotLabel(hour);
      const existing = slotData.get(slot)!;
      
      existing.readings++;
      existing.totalOccupancy += reading.occupancy?.current || 0;
      existing.totalTemp += reading.indoorTemp;
      existing.totalSound += reading.decibels;
      existing.totalLight += reading.light;
      
      if (reading.currentSong) {
        existing.songs.set(reading.currentSong, (existing.songs.get(reading.currentSong) || 0) + 1);
      }
    });

    const insights: TimeSlotInsight[] = [];

    slotData.forEach((stats, slot) => {
      if (stats.readings < 10) return; // Skip slots with minimal data

      const topSong = Array.from(stats.songs.entries())
        .sort((a, b) => b[1] - a[1])[0];

      insights.push({
        timeSlot: slot,
        avgDwellTime: Math.round(stats.totalOccupancy / stats.readings * 2), // Rough estimate
        topSong: topSong?.[0],
        avgOccupancy: Math.round(stats.totalOccupancy / stats.readings),
        conditions: {
          avgTemp: Math.round(stats.totalTemp / stats.readings),
          avgSound: Math.round(stats.totalSound / stats.readings),
          avgLight: Math.round(stats.totalLight / stats.readings)
        }
      });
    });

    return insights.sort((a, b) => b.avgOccupancy - a.avgOccupancy);
  }

  private getTimeSlotLabel(hour: number): string {
    if (hour >= 6 && hour < 8) return '6-8 AM';
    if (hour >= 8 && hour < 10) return '8-10 AM';
    if (hour >= 10 && hour < 12) return '10 AM-12 PM';
    if (hour >= 12 && hour < 14) return '12-2 PM';
    if (hour >= 14 && hour < 16) return '2-4 PM';
    if (hour >= 16 && hour < 18) return '4-6 PM';
    if (hour >= 18 && hour < 20) return '6-8 PM';
    if (hour >= 20 && hour < 22) return '8-10 PM';
    if (hour >= 22 && hour < 24) return '10 PM-12 AM';
    if (hour >= 0 && hour < 2) return '12-2 AM';
    if (hour >= 2 && hour < 4) return '2-4 AM';
    return '4-6 AM';
  }

  private getInsufficientDataResponse(count: number): PulseRecommendationsData {
    return {
      currentDwellTime: null,
      bestDwellTime: 0,
      recommendations: [],
      timeSlotInsights: [],
      musicRecommendations: [],
      dataQuality: {
        daysOfData: 0,
        totalReadings: count,
        confidence: 'low'
      }
    };
  }

  clearCache(): void {
    this.cache = null;
    this.lastFetch = 0;
  }
}

const pulseRecommendationsService = new PulseRecommendationsService();
export default pulseRecommendationsService;
