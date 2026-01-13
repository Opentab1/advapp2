/**
 * useInsightsData - Data hook for Analytics page
 * 
 * Processes historical data into 3 levels:
 * - Level 1: Summary cards (report view)
 * - Level 2: Supporting data (modals)
 * - Level 3: Raw data (full charts)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import { calculatePulseScore } from '../utils/scoring';
import type { SensorData, TimeRange } from '../types';
import type {
  InsightsTimeRange,
  InsightsSummary,
  SweetSpotData,
  SweetSpotBucket,
  TrendData,
  HourlyData,
  FactorScore,
  PeriodComparison,
  RawDataPoint,
  InsightsData,
  SweetSpotVariable,
} from '../types/insights';

// ============ TIME RANGE MAPPING ============

function mapTimeRange(range: InsightsTimeRange): TimeRange {
  switch (range) {
    case 'last_night': return '24h';
    case '7d': return '7d';
    case '14d': return '14d';
    case '30d': return '30d';
    default: return '7d';
  }
}

function getTimeRangeLabel(range: InsightsTimeRange): string {
  switch (range) {
    case 'last_night': return 'Last Night';
    case '7d': return 'This Week';
    case '14d': return 'Last 14 Days';
    case '30d': return 'This Month';
    default: return 'Last 7 Days';
  }
}

// ============ MAIN HOOK ============

export function useInsightsData(timeRange: InsightsTimeRange): InsightsData {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawSensorData, setRawSensorData] = useState<SensorData[]>([]);
  const [previousPeriodData, setPreviousPeriodData] = useState<SensorData[]>([]);
  
  // Fetch data
  const fetchData = useCallback(async () => {
    if (!venueId) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // Fetch current period
      const apiRange = mapTimeRange(timeRange);
      const result = await apiService.getHistoricalData(venueId, apiRange);
      
      if (result?.data) {
        setRawSensorData(result.data);
      } else {
        setRawSensorData([]);
      }
      
      // Fetch previous period for comparison
      // For simplicity, fetch double the range and split
      const extendedRange = timeRange === 'last_night' ? '7d' : 
                           timeRange === '7d' ? '14d' : 
                           timeRange === '14d' ? '30d' : '90d';
      const extendedResult = await apiService.getHistoricalData(venueId, extendedRange as TimeRange);
      
      if (extendedResult?.data) {
        // Split into current and previous periods
        const now = new Date();
        const periodMs = getPeriodMs(timeRange);
        const cutoff = new Date(now.getTime() - periodMs);
        const previousCutoff = new Date(cutoff.getTime() - periodMs);
        
        const previous = extendedResult.data.filter(d => {
          const ts = new Date(d.timestamp);
          return ts >= previousCutoff && ts < cutoff;
        });
        setPreviousPeriodData(previous);
      }
      
    } catch (err: any) {
      console.error('Error fetching insights data:', err);
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [venueId, timeRange]);
  
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  
  // ============ PROCESS DATA ============
  
  // Level 1: Summary
  const summary = useMemo((): InsightsSummary | null => {
    if (rawSensorData.length === 0) return null;
    return processSummary(rawSensorData, previousPeriodData, timeRange);
  }, [rawSensorData, previousPeriodData, timeRange]);
  
  // Level 1: Sweet Spot (default to sound)
  const allSweetSpots = useMemo(() => {
    if (rawSensorData.length === 0) return null;
    return {
      sound: processSweetSpot(rawSensorData, 'sound'),
      light: processSweetSpot(rawSensorData, 'light'),
      crowd: processSweetSpot(rawSensorData, 'crowd'),
      temp: processSweetSpot(rawSensorData, 'temp'),
    };
  }, [rawSensorData]);
  
  const sweetSpot = allSweetSpots?.sound || null;
  
  // Level 1: Trend
  const trend = useMemo((): TrendData | null => {
    if (rawSensorData.length === 0) return null;
    return processTrend(rawSensorData, previousPeriodData, timeRange);
  }, [rawSensorData, previousPeriodData, timeRange]);
  
  // Level 2: Hourly data
  const hourlyData = useMemo((): HourlyData[] => {
    if (rawSensorData.length === 0) return [];
    return processHourlyData(rawSensorData);
  }, [rawSensorData]);
  
  // Level 2: Factor scores
  const factorScores = useMemo((): FactorScore[] => {
    if (rawSensorData.length === 0) return [];
    return processFactorScores(rawSensorData);
  }, [rawSensorData]);
  
  // Level 2: Comparison
  const comparison = useMemo((): PeriodComparison | null => {
    if (rawSensorData.length === 0 || previousPeriodData.length === 0) return null;
    return processComparison(rawSensorData, previousPeriodData, timeRange);
  }, [rawSensorData, previousPeriodData, timeRange]);
  
  // Level 2: Trend chart data
  const trendChartData = useMemo(() => {
    if (rawSensorData.length === 0) return [];
    return processTrendChartData(rawSensorData);
  }, [rawSensorData]);
  
  // Level 3: Raw data points
  const rawData = useMemo((): RawDataPoint[] => {
    return rawSensorData.map(d => {
      const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp);
      return {
        timestamp: new Date(d.timestamp),
        score: score || 0,
        decibels: d.decibels || 0,
        light: d.light || 0,
        occupancy: d.occupancy?.current || 0,
        dwellMinutes: null, // Calculated separately
        temperature: d.indoorTemp || 0,
      };
    });
  }, [rawSensorData]);
  
  return {
    loading,
    error,
    summary,
    sweetSpot,
    allSweetSpots,
    trend,
    hourlyData,
    factorScores,
    comparison,
    trendChartData,
    rawData,
    refresh: fetchData,
  };
}

// ============ PROCESSING FUNCTIONS ============

function getPeriodMs(range: InsightsTimeRange): number {
  switch (range) {
    case 'last_night': return 24 * 60 * 60 * 1000;
    case '7d': return 7 * 24 * 60 * 60 * 1000;
    case '14d': return 14 * 24 * 60 * 60 * 1000;
    case '30d': return 30 * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}

function processSummary(
  data: SensorData[], 
  previousData: SensorData[],
  timeRange: InsightsTimeRange
): InsightsSummary {
  // Calculate current period metrics
  let totalScore = 0;
  let scoreCount = 0;
  let hoursInZone = 0;
  let totalPeakHours = 0;
  let peakStartHour = 24;
  let peakEndHour = 0;
  
  // Group by hour for peak detection
  const hourlyScores: Record<number, number[]> = {};
  
  data.forEach(d => {
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp);
    if (score !== null) {
      totalScore += score;
      scoreCount++;
      
      const hour = new Date(d.timestamp).getHours();
      if (!hourlyScores[hour]) hourlyScores[hour] = [];
      hourlyScores[hour].push(score);
      
      // Count hours in zone (score >= 70)
      if (score >= 70) hoursInZone += 0.25; // Assuming 15-min intervals
    }
  });
  
  // Calculate total guests correctly: difference between first and last entry counts
  // (entries is cumulative, so we need the delta, not the max)
  const calculateGuestCount = (periodData: SensorData[]): number => {
    const withEntries = periodData
      .filter(d => d.occupancy?.entries !== undefined)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    if (withEntries.length < 2) {
      // Not enough data points, fall back to max entries if available
      return withEntries[0]?.occupancy?.entries || 0;
    }
    
    const firstEntries = withEntries[0].occupancy!.entries;
    const lastEntries = withEntries[withEntries.length - 1].occupancy!.entries;
    
    // Total guests = entries at end - entries at start of period
    return Math.max(0, lastEntries - firstEntries);
  };
  
  const totalGuests = calculateGuestCount(data);
  
  // Find peak hours (6pm-2am typically)
  Object.entries(hourlyScores).forEach(([hourStr, scores]) => {
    const hour = parseInt(hourStr);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avgScore >= 70 && (hour >= 18 || hour <= 2)) {
      peakStartHour = Math.min(peakStartHour, hour);
      peakEndHour = Math.max(peakEndHour, hour);
      totalPeakHours++;
    }
  });
  
  const avgScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;
  
  // Calculate previous period metrics for delta
  let prevTotalScore = 0;
  let prevScoreCount = 0;
  
  previousData.forEach(d => {
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp);
    if (score !== null) {
      prevTotalScore += score;
      prevScoreCount++;
    }
  });
  
  // Calculate previous period guests using the same correct method
  const prevTotalGuests = calculateGuestCount(previousData);
  
  const prevAvgScore = prevScoreCount > 0 ? Math.round(prevTotalScore / prevScoreCount) : avgScore;
  const scoreDelta = prevAvgScore > 0 ? Math.round(((avgScore - prevAvgScore) / prevAvgScore) * 100) : 0;
  const guestsDelta = prevTotalGuests > 0 ? Math.round(((totalGuests - prevTotalGuests) / prevTotalGuests) * 100) : 0;
  
  // Calculate avg stay based on exit velocity (same method as Live page)
  // Avg Stay = avgOccupancy / exitsPerHour * 60 (in minutes)
  const calculateAvgStay = (periodData: SensorData[]): number | null => {
    if (periodData.length < 2) return null;
    
    const sorted = [...periodData].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    // Get total exits for period
    const withExits = sorted.filter(d => d.occupancy?.exits !== undefined);
    if (withExits.length < 2) return null;
    
    const firstExits = withExits[0].occupancy!.exits;
    const lastExits = withExits[withExits.length - 1].occupancy!.exits;
    const totalExits = Math.max(0, lastExits - firstExits);
    
    // Get hours in period
    const firstTime = new Date(sorted[0].timestamp).getTime();
    const lastTime = new Date(sorted[sorted.length - 1].timestamp).getTime();
    const hoursInPeriod = Math.max(1, (lastTime - firstTime) / (1000 * 60 * 60));
    
    const exitsPerHour = totalExits / hoursInPeriod;
    
    // Get average occupancy
    const occupancies = periodData
      .filter(d => d.occupancy?.current !== undefined)
      .map(d => d.occupancy!.current);
    const avgOccupancy = occupancies.length > 0 
      ? occupancies.reduce((a, b) => a + b, 0) / occupancies.length 
      : 0;
    
    // If no exits, we can't calculate avg stay
    if (exitsPerHour < 0.5 || avgOccupancy < 1) return null;
    
    // Avg stay in minutes, capped at 3 hours
    return Math.min(180, Math.round((avgOccupancy / exitsPerHour) * 60));
  };
  
  const avgStayMinutes = calculateAvgStay(data);
  const prevAvgStay = calculateAvgStay(previousData);
  
  // Calculate delta only if both values exist
  const avgStayDelta = (avgStayMinutes !== null && prevAvgStay !== null && prevAvgStay > 0)
    ? Math.round(((avgStayMinutes - prevAvgStay) / prevAvgStay) * 100)
    : null;
  
  // Format peak hours
  const formatHour = (h: number) => h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`;
  const peakHours = peakStartHour < 24 ? `${formatHour(peakStartHour)} - ${formatHour(peakEndHour)}` : 'N/A';
  
  // Generate summary text
  let summaryText = '';
  if (avgScore >= 80) {
    summaryText = `Strong ${timeRange === 'last_night' ? 'night' : 'period'}. `;
  } else if (avgScore >= 65) {
    summaryText = `Solid ${timeRange === 'last_night' ? 'night' : 'period'}. `;
  } else {
    summaryText = `Room for improvement. `;
  }
  
  // Only mention dwell time if we have real data
  if (avgStayDelta !== null && avgStayDelta > 0) {
    summaryText += `Avg stay up ${avgStayDelta}%, `;
  }
  
  summaryText += `you stayed in the zone for ${hoursInZone.toFixed(1)} of ${totalPeakHours} peak hours.`;
  
  return {
    score: avgScore,
    scoreDelta,
    avgStayMinutes,
    avgStayDelta,
    totalGuests,
    guestsDelta,
    summaryText,
    peakHours,
    timeInZoneHours: Math.round(hoursInZone * 10) / 10,
    totalPeakHours,
  };
}

function processSweetSpot(data: SensorData[], variable: SweetSpotVariable): SweetSpotData {
  // Define buckets based on variable
  const bucketRanges: Record<SweetSpotVariable, Array<{ min: number; max: number; label: string }>> = {
    sound: [
      { min: 0, max: 65, label: '< 65 dB' },
      { min: 65, max: 70, label: '65-70 dB' },
      { min: 70, max: 75, label: '70-75 dB' },
      { min: 75, max: 82, label: '75-82 dB' },
      { min: 82, max: 90, label: '82-90 dB' },
      { min: 90, max: 999, label: '90+ dB' },
    ],
    light: [
      { min: 0, max: 30, label: '< 30 lux' },
      { min: 30, max: 70, label: '30-70 lux' },
      { min: 70, max: 150, label: '70-150 lux' },
      { min: 150, max: 999, label: '150+ lux' },
    ],
    crowd: [
      { min: 0, max: 25, label: '< 25%' },
      { min: 25, max: 50, label: '25-50%' },
      { min: 50, max: 75, label: '50-75%' },
      { min: 75, max: 100, label: '75-100%' },
    ],
    temp: [
      { min: 0, max: 65, label: '< 65°F' },
      { min: 65, max: 70, label: '65-70°F' },
      { min: 70, max: 75, label: '70-75°F' },
      { min: 75, max: 999, label: '75+°F' },
    ],
  };
  
  const ranges = bucketRanges[variable];
  const bucketData: Record<string, { staySum: number; count: number }> = {};
  ranges.forEach(r => {
    bucketData[r.label] = { staySum: 0, count: 0 };
  });
  
  // Estimate dwell time per data point (simplified)
  // In reality, this would come from actual dwell calculations
  data.forEach(d => {
    let value: number;
    switch (variable) {
      case 'sound': value = d.decibels || 0; break;
      case 'light': value = d.light || 0; break;
      case 'crowd': value = (d.occupancy?.current || 0) / 2; break; // Normalize to percentage
      case 'temp': value = d.indoorTemp || 70; break;
      default: value = 0;
    }
    
    // Find matching bucket
    const bucket = ranges.find(r => value >= r.min && value < r.max);
    if (bucket) {
      // Estimate dwell based on score (simplified heuristic)
      const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp);
      const estimatedDwell = 30 + (score || 0) * 0.3; // Base 30 min + score bonus
      bucketData[bucket.label].staySum += estimatedDwell;
      bucketData[bucket.label].count++;
    }
  });
  
  // Convert to bucket array and find optimal
  const buckets: SweetSpotBucket[] = ranges.map(r => {
    const bd = bucketData[r.label];
    const avgStay = bd.count > 0 ? Math.round(bd.staySum / bd.count) : 0;
    return {
      range: r.label,
      avgStayMinutes: avgStay,
      sampleCount: bd.count,
      isOptimal: false, // Set below
    };
  });
  
  // Find optimal bucket (highest avg stay with sufficient samples)
  const minSamples = Math.max(5, data.length * 0.05); // At least 5% of data
  let optimalIdx = 0;
  let maxStay = 0;
  buckets.forEach((b, idx) => {
    if (b.sampleCount >= minSamples && b.avgStayMinutes > maxStay) {
      maxStay = b.avgStayMinutes;
      optimalIdx = idx;
    }
  });
  buckets[optimalIdx].isOptimal = true;
  
  // Calculate outside-optimal average
  const outsideBuckets = buckets.filter((_, idx) => idx !== optimalIdx && buckets[idx].sampleCount > 0);
  const outsideStay = outsideBuckets.length > 0 
    ? Math.round(outsideBuckets.reduce((sum, b) => sum + b.avgStayMinutes * b.sampleCount, 0) / 
                 outsideBuckets.reduce((sum, b) => sum + b.sampleCount, 0))
    : 0;
  
  // Calculate hit percentage
  const totalSamples = buckets.reduce((sum, b) => sum + b.sampleCount, 0);
  const hitPercentage = totalSamples > 0 
    ? Math.round((buckets[optimalIdx].sampleCount / totalSamples) * 100)
    : 0;
  
  return {
    variable,
    buckets,
    optimalRange: buckets[optimalIdx].range,
    optimalStay: buckets[optimalIdx].avgStayMinutes,
    outsideStay,
    hitPercentage,
    totalSamples,
  };
}

function processTrend(
  data: SensorData[], 
  previousData: SensorData[],
  timeRange: InsightsTimeRange
): TrendData {
  // Helper to calculate guest count correctly
  const calcGuestCount = (periodData: SensorData[]): number => {
    const withEntries = periodData
      .filter(d => d.occupancy?.entries !== undefined)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    if (withEntries.length < 2) return withEntries[0]?.occupancy?.entries || 0;
    
    const firstEntries = withEntries[0].occupancy!.entries;
    const lastEntries = withEntries[withEntries.length - 1].occupancy!.entries;
    return Math.max(0, lastEntries - firstEntries);
  };

  // Helper to calculate avg stay from exit velocity
  const calcAvgStay = (periodData: SensorData[]): number | null => {
    if (periodData.length < 2) return null;
    
    const sorted = [...periodData].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    const withExits = sorted.filter(d => d.occupancy?.exits !== undefined);
    if (withExits.length < 2) return null;
    
    const firstExits = withExits[0].occupancy!.exits;
    const lastExits = withExits[withExits.length - 1].occupancy!.exits;
    const totalExits = Math.max(0, lastExits - firstExits);
    
    const firstTime = new Date(sorted[0].timestamp).getTime();
    const lastTime = new Date(sorted[sorted.length - 1].timestamp).getTime();
    const hoursInPeriod = Math.max(1, (lastTime - firstTime) / (1000 * 60 * 60));
    
    const exitsPerHour = totalExits / hoursInPeriod;
    
    const occupancies = periodData
      .filter(d => d.occupancy?.current !== undefined)
      .map(d => d.occupancy!.current);
    const avgOccupancy = occupancies.length > 0 
      ? occupancies.reduce((a, b) => a + b, 0) / occupancies.length 
      : 0;
    
    if (exitsPerHour < 0.5 || avgOccupancy < 1) return null;
    
    return Math.min(180, Math.round((avgOccupancy / exitsPerHour) * 60));
  };

  // Calculate current period metrics
  const dailyMetrics: Record<string, { scores: number[] }> = {};
  
  data.forEach(d => {
    const date = new Date(d.timestamp).toDateString();
    if (!dailyMetrics[date]) {
      dailyMetrics[date] = { scores: [] };
    }
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp);
    if (score) dailyMetrics[date].scores.push(score);
  });
  
  // Find best/worst days
  let bestDay = { date: '', score: 0, label: '' };
  let worstDay = { date: '', score: 100, label: '' };
  
  Object.entries(dailyMetrics).forEach(([date, metrics]) => {
    const avgScore = metrics.scores.length > 0 
      ? Math.round(metrics.scores.reduce((a, b) => a + b, 0) / metrics.scores.length)
      : 0;
    
    if (avgScore > bestDay.score) {
      bestDay = { 
        date: new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        score: avgScore,
        label: 'Peak performance'
      };
    }
    if (avgScore < worstDay.score && avgScore > 0) {
      worstDay = { 
        date: new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        score: avgScore,
        label: 'Needs attention'
      };
    }
  });
  
  // Calculate current period metrics
  const allScores = Object.values(dailyMetrics).flatMap(d => d.scores);
  const avgScore = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : 0;
  const avgStay = calcAvgStay(data);
  const totalGuests = calcGuestCount(data);
  
  // Previous period metrics
  const prevScores: number[] = [];
  previousData.forEach(d => {
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp);
    if (score) prevScores.push(score);
  });
  const prevAvgScore = prevScores.length > 0 ? Math.round(prevScores.reduce((a, b) => a + b, 0) / prevScores.length) : avgScore;
  const prevAvgStay = calcAvgStay(previousData);
  const prevTotalGuests = calcGuestCount(previousData);
  
  const guestsDelta = prevTotalGuests > 0 ? Math.round(((totalGuests - prevTotalGuests) / prevTotalGuests) * 100) : 0;
  const avgStayDelta = (avgStay !== null && prevAvgStay !== null && prevAvgStay > 0)
    ? Math.round(((avgStay - prevAvgStay) / prevAvgStay) * 100)
    : null;
  
  return {
    avgStay,
    avgStayDelta,
    totalGuests,
    guestsDelta,
    bestDay,
    worstDay,
    weekOverWeek: [
      { label: getTimeRangeLabel(timeRange), avgScore, avgStay, guests: totalGuests },
      { label: 'Previous', avgScore: prevAvgScore, avgStay: prevAvgStay, guests: prevTotalGuests },
    ],
  };
}

function processHourlyData(data: SensorData[]): HourlyData[] {
  const hourlyScores: Record<number, number[]> = {};
  
  data.forEach(d => {
    const hour = new Date(d.timestamp).getHours();
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp);
    if (score) {
      if (!hourlyScores[hour]) hourlyScores[hour] = [];
      hourlyScores[hour].push(score);
    }
  });
  
  // Find peak hour
  let peakHour = 0;
  let peakScore = 0;
  Object.entries(hourlyScores).forEach(([hour, scores]) => {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg > peakScore) {
      peakScore = avg;
      peakHour = parseInt(hour);
    }
  });
  
  // Format hours
  const formatHour = (h: number) => {
    if (h === 0) return '12am';
    if (h < 12) return `${h}am`;
    if (h === 12) return '12pm';
    return `${h - 12}pm`;
  };
  
  const getLabel = (score: number, isPeak: boolean): string => {
    if (isPeak) return 'Peak';
    if (score >= 80) return 'Strong';
    if (score >= 70) return 'Good';
    if (score >= 60) return 'Building';
    return 'Warming up';
  };
  
  return Object.entries(hourlyScores)
    .map(([hour, scores]) => {
      const h = parseInt(hour);
      const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      return {
        hour: formatHour(h),
        score: avgScore,
        label: getLabel(avgScore, h === peakHour),
        isHighlight: h === peakHour,
      };
    })
    .sort((a, b) => {
      // Sort by hour (convert back to 24h for sorting)
      const getHour24 = (h: string) => {
        const num = parseInt(h);
        if (h.includes('am')) return num === 12 ? 0 : num;
        return num === 12 ? 12 : num + 12;
      };
      return getHour24(a.hour) - getHour24(b.hour);
    });
}

function processFactorScores(data: SensorData[]): FactorScore[] {
  let soundSum = 0, lightSum = 0, crowdSum = 0, tempSum = 0;
  let count = 0;
  
  data.forEach(d => {
    const result = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp);
    soundSum += result.factors.sound.score;
    lightSum += result.factors.light.score;
    tempSum += result.factors.temperature.score;
    // Crowd score approximation
    crowdSum += (d.occupancy?.current || 0) > 20 ? 80 : 50;
    count++;
  });
  
  if (count === 0) return [];
  
  const getLabel = (score: number): string => {
    if (score >= 80) return 'In range';
    if (score >= 60) return 'Mostly good';
    return 'Needs adjustment';
  };
  
  return [
    { factor: 'sound', score: Math.round(soundSum / count), label: getLabel(soundSum / count) },
    { factor: 'light', score: Math.round(lightSum / count), label: getLabel(lightSum / count) },
    { factor: 'crowd', score: Math.round(crowdSum / count), label: getLabel(crowdSum / count) },
    { factor: 'temp', score: Math.round(tempSum / count), label: getLabel(tempSum / count) },
  ];
}

function processComparison(
  currentData: SensorData[], 
  previousData: SensorData[],
  timeRange: InsightsTimeRange
): PeriodComparison {
  // Helper to calculate avg stay from exit velocity
  const calcAvgStay = (periodData: SensorData[]): number | null => {
    if (periodData.length < 2) return null;
    
    const sorted = [...periodData].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    const withExits = sorted.filter(d => d.occupancy?.exits !== undefined);
    if (withExits.length < 2) return null;
    
    const firstExits = withExits[0].occupancy!.exits;
    const lastExits = withExits[withExits.length - 1].occupancy!.exits;
    const totalExits = Math.max(0, lastExits - firstExits);
    
    const firstTime = new Date(sorted[0].timestamp).getTime();
    const lastTime = new Date(sorted[sorted.length - 1].timestamp).getTime();
    const hoursInPeriod = Math.max(1, (lastTime - firstTime) / (1000 * 60 * 60));
    
    const exitsPerHour = totalExits / hoursInPeriod;
    
    const occupancies = periodData
      .filter(d => d.occupancy?.current !== undefined)
      .map(d => d.occupancy!.current);
    const avgOccupancy = occupancies.length > 0 
      ? occupancies.reduce((a, b) => a + b, 0) / occupancies.length 
      : 0;
    
    if (exitsPerHour < 0.5 || avgOccupancy < 1) return null;
    
    return Math.min(180, Math.round((avgOccupancy / exitsPerHour) * 60));
  };

  // Helper to calculate guest count correctly
  const calcGuestCount = (periodData: SensorData[]): number => {
    const withEntries = periodData
      .filter(d => d.occupancy?.entries !== undefined)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    if (withEntries.length < 2) return withEntries[0]?.occupancy?.entries || 0;
    
    const firstEntries = withEntries[0].occupancy!.entries;
    const lastEntries = withEntries[withEntries.length - 1].occupancy!.entries;
    return Math.max(0, lastEntries - firstEntries);
  };

  // Current period
  let currentScoreSum = 0, currentCount = 0;
  currentData.forEach(d => {
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp);
    if (score) { currentScoreSum += score; currentCount++; }
  });
  
  // Previous period
  let prevScoreSum = 0, prevCount = 0;
  previousData.forEach(d => {
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp);
    if (score) { prevScoreSum += score; prevCount++; }
  });
  
  const periodLabel = timeRange === 'last_night' ? 'vs last week same night' : 'vs previous period';
  
  return {
    current: {
      score: currentCount > 0 ? Math.round(currentScoreSum / currentCount) : 0,
      avgStay: calcAvgStay(currentData),
      guests: calcGuestCount(currentData),
    },
    previous: {
      score: prevCount > 0 ? Math.round(prevScoreSum / prevCount) : 0,
      avgStay: calcAvgStay(previousData),
      guests: calcGuestCount(previousData),
    },
    periodLabel,
  };
}

function processTrendChartData(data: SensorData[]): Array<{ date: Date; score: number; avgStay: number; guests: number }> {
  // Group data by day
  const dailyData: Record<string, { 
    rawData: SensorData[];
    scores: number[]; 
  }> = {};
  
  data.forEach(d => {
    const date = new Date(d.timestamp).toDateString();
    if (!dailyData[date]) {
      dailyData[date] = { rawData: [], scores: [] };
    }
    dailyData[date].rawData.push(d);
    const { score } = calculatePulseScore(d.decibels, d.light, d.indoorTemp, d.outdoorTemp);
    if (score) dailyData[date].scores.push(score);
  });
  
  // Helper to calculate guest count for a day
  const calcDayGuests = (dayData: SensorData[]): number => {
    const withEntries = dayData
      .filter(d => d.occupancy?.entries !== undefined)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    if (withEntries.length < 2) return withEntries[0]?.occupancy?.entries || 0;
    
    const firstEntries = withEntries[0].occupancy!.entries;
    const lastEntries = withEntries[withEntries.length - 1].occupancy!.entries;
    return Math.max(0, lastEntries - firstEntries);
  };
  
  return Object.entries(dailyData)
    .map(([dateStr, metrics]) => ({
      date: new Date(dateStr),
      score: metrics.scores.length > 0 ? Math.round(metrics.scores.reduce((a, b) => a + b, 0) / metrics.scores.length) : 0,
      avgStay: 0, // Not displayed - can't calculate accurate per-day avg stay
      guests: calcDayGuests(metrics.rawData),
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export default useInsightsData;
